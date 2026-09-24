/*
 * piano.c — the module's own piano, so practising never depends on how the
 * Move happens to be set up.
 *
 * A tool's dsp.so is loaded into the overtake generator slot and its output is
 * MIXED into Move's audio (schwung_shim.c: "Overtake DSP generator: mix its
 * output into the deferred buffer"), so this coexists with whatever else is
 * playing rather than replacing it. No track, no instrument, no MIDI channel
 * has to be right for a note to be heard.
 *
 * Why it sounds like a struck string rather than an organ: each voice is a
 * small stack of partials whose HIGHER ones decay FASTER. That single property
 * — not the waveform — is most of what the ear reads as "struck and ringing".
 * The partials are also slightly stretched, because real piano strings are
 * stiff and their overtones sit progressively sharp of exact multiples.
 *
 * Realtime rules (docs/REALTIME_SAFETY.md): render_block runs on the audio
 * thread every 128 frames (2.9ms). Nothing here allocates, locks, waits or
 * touches the filesystem. Note events cross from the UI thread through a
 * lock-free single-producer ring.
 */

#include "host/plugin_api_v1.h"

#include <math.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ENGINE_VERSION "1"

#define MAX_VOICES 16
#define NUM_PARTIALS 4
#define SINE_BITS 11
#define SINE_SIZE (1 << SINE_BITS)
#define SINE_MASK (SINE_SIZE - 1)
#define EVENT_RING 256          /* power of two */
#define EVENT_MASK (EVENT_RING - 1)

#define EV_NOTE_ON 1
#define EV_NOTE_OFF 2
#define EV_PANIC 3        /* cut now, tails included  — CC 120, 0xFF */
#define EV_RELEASE_ALL 4  /* let go, so it rings out  — CC 123       */

typedef struct {
    uint8_t type;
    uint8_t pitch;
    uint8_t vel;
} event_t;

typedef struct {
    int active;
    int releasing;
    int pitch;
    unsigned age;               /* for oldest-voice stealing */
    float phase[NUM_PARTIALS];
    float inc[NUM_PARTIALS];
    float amp[NUM_PARTIALS];
    float decay[NUM_PARTIALS];  /* per-sample multiplier, < 1 */
    float attack;               /* 0..1 ramp, removes the click */
    float attack_inc;
    float release;              /* damper, multiplies everything once released */
} voice_t;

typedef struct {
    float sine[SINE_SIZE];
    float freq[128];
    voice_t voices[MAX_VOICES];
    unsigned counter;
    float gain;

    event_t ring[EVENT_RING];
    atomic_uint ring_w;
    atomic_uint ring_r;
} piano_t;

static const host_api_v1_t *g_host = NULL;

/* ---- event queue (UI thread -> audio thread) ----------------------------- */

static void push_event(piano_t *p, uint8_t type, uint8_t pitch, uint8_t vel) {
    unsigned w = atomic_load_explicit(&p->ring_w, memory_order_relaxed);
    unsigned r = atomic_load_explicit(&p->ring_r, memory_order_acquire);
    if (((w + 1) & EVENT_MASK) == (r & EVENT_MASK)) return;  /* full: drop */
    p->ring[w & EVENT_MASK].type = type;
    p->ring[w & EVENT_MASK].pitch = pitch;
    p->ring[w & EVENT_MASK].vel = vel;
    atomic_store_explicit(&p->ring_w, w + 1, memory_order_release);
}

static int pop_event(piano_t *p, event_t *out) {
    unsigned r = atomic_load_explicit(&p->ring_r, memory_order_relaxed);
    unsigned w = atomic_load_explicit(&p->ring_w, memory_order_acquire);
    if ((r & EVENT_MASK) == (w & EVENT_MASK)) return 0;
    *out = p->ring[r & EVENT_MASK];
    atomic_store_explicit(&p->ring_r, r + 1, memory_order_release);
    return 1;
}

/* ---- voices -------------------------------------------------------------- */

/* Seconds of decay for a partial: low notes ring far longer than high ones,
 * and within a note the upper partials die away first. */
static float partial_decay_seconds(float freq, int partial) {
    float base = 9.0f / (1.0f + freq / 110.0f);     /* ~8s at A2, ~1s at A6 */
    float shorter = 1.0f / (1.0f + 0.9f * partial); /* upper partials fade first */
    float s = base * shorter;
    return s < 0.05f ? 0.05f : s;
}

static void voice_start(piano_t *p, voice_t *v, int pitch, int vel) {
    float f0 = p->freq[pitch & 127];
    float velf = (float)vel / 127.0f;
    /* Harder strikes are brighter, not just louder — the upper partials come
     * up much faster with velocity than the fundamental does. */
    float bright = 0.25f + 0.75f * velf * velf;

    v->active = 1;
    v->releasing = 0;
    v->pitch = pitch;
    v->age = ++p->counter;
    v->attack = 0.0f;
    v->attack_inc = 1.0f / (0.004f * (float)MOVE_SAMPLE_RATE);  /* ~4ms */
    v->release = 1.0f;

    for (int i = 0; i < NUM_PARTIALS; i++) {
        int n = i + 1;
        /* Stiff-string stretch: overtones sit progressively sharp. */
        float stretch = sqrtf(1.0f + 0.0004f * (float)(n * n));
        float f = f0 * (float)n * stretch;
        if (f > (float)MOVE_SAMPLE_RATE * 0.45f) {
            v->amp[i] = 0.0f;   /* above Nyquist: silence rather than alias */
            v->inc[i] = 0.0f;
            v->decay[i] = 1.0f;
            v->phase[i] = 0.0f;
            continue;
        }
        v->phase[i] = 0.0f;
        v->inc[i] = f * (float)SINE_SIZE / (float)MOVE_SAMPLE_RATE;
        v->amp[i] = velf * powf(bright, (float)i) / (float)(n * n);
        float secs = partial_decay_seconds(f0, i);
        v->decay[i] = expf(-1.0f / (secs * (float)MOVE_SAMPLE_RATE));
    }
}

static void voice_release(voice_t *v) {
    if (!v->active || v->releasing) return;
    v->releasing = 1;
}

static voice_t *pick_voice(piano_t *p, int pitch) {
    /* Retrigger the same pitch first, so repeated notes do not stack up. */
    for (int i = 0; i < MAX_VOICES; i++) {
        if (p->voices[i].active && p->voices[i].pitch == pitch) return &p->voices[i];
    }
    for (int i = 0; i < MAX_VOICES; i++) {
        if (!p->voices[i].active) return &p->voices[i];
    }
    /* All busy: take the one that has been going longest. */
    voice_t *oldest = &p->voices[0];
    for (int i = 1; i < MAX_VOICES; i++) {
        if (p->voices[i].age < oldest->age) oldest = &p->voices[i];
    }
    return oldest;
}

static void apply_event(piano_t *p, const event_t *e) {
    if (e->type == EV_PANIC) {
        for (int i = 0; i < MAX_VOICES; i++) p->voices[i].active = 0;
        return;
    }
    if (e->type == EV_RELEASE_ALL) {
        /* Released rather than cut. All Notes Off is the polite one, and it is
         * what a host broadcasts on the way out — cutting sixteen voices dead
         * there would click on every close. */
        for (int i = 0; i < MAX_VOICES; i++) {
            if (p->voices[i].active) voice_release(&p->voices[i]);
        }
        return;
    }
    if (e->type == EV_NOTE_ON) {
        voice_start(p, pick_voice(p, e->pitch), e->pitch, e->vel ? e->vel : 1);
        return;
    }
    for (int i = 0; i < MAX_VOICES; i++) {
        if (p->voices[i].active && p->voices[i].pitch == e->pitch) voice_release(&p->voices[i]);
    }
}

/* ---- plugin interface ---------------------------------------------------- */

static void *create_instance(const char *module_dir, const char *json_defaults) {
    (void)module_dir;
    (void)json_defaults;
    piano_t *p = (piano_t *)calloc(1, sizeof(piano_t));
    if (!p) return NULL;
    for (int i = 0; i < SINE_SIZE; i++) {
        p->sine[i] = sinf(6.28318530718f * (float)i / (float)SINE_SIZE);
    }
    for (int i = 0; i < 128; i++) {
        p->freq[i] = 440.0f * powf(2.0f, ((float)i - 69.0f) / 12.0f);
    }
    p->gain = 0.22f;
    atomic_store(&p->ring_w, 0);
    atomic_store(&p->ring_r, 0);
    return p;
}

static void destroy_instance(void *instance) {
    free(instance);
}

static void set_param(void *instance, const char *key, const char *val) {
    piano_t *p = (piano_t *)instance;
    if (!p || !key) return;

    if (strcmp(key, "n") == 0 && val) {
        /*
         * A comma-separated list of "pitch:velocity", velocity 0 meaning off:
         *
         *     60:100,64:100,67:100
         *
         * A list rather than one note per call because the overtake parameter
         * channel is a single-slot mailbox — three calls in a row for a chord
         * would overwrite each other and two of the notes would never arrive.
         * One write carries the whole frame's worth.
         */
        const char *cur = val;
        while (*cur) {
            int pitch = -1, vel = 0;
            if (sscanf(cur, "%d:%d", &pitch, &vel) == 2 && pitch >= 0 && pitch < 128) {
                push_event(p, vel > 0 ? EV_NOTE_ON : EV_NOTE_OFF, (uint8_t)pitch, (uint8_t)vel);
            }
            const char *comma = strchr(cur, ',');
            if (!comma) break;
            cur = comma + 1;
        }
        return;
    }
    if (strcmp(key, "panic") == 0) {
        push_event(p, EV_PANIC, 0, 0);
        return;
    }
    if (strcmp(key, "gain") == 0 && val) {
        float g = (float)atof(val);
        if (g >= 0.0f && g <= 1.0f) p->gain = g;
        return;
    }
}

/*
 * The panic messages, and deliberately nothing else.
 *
 * Notes arrive through set_param("n", ...), because the overtake parameter
 * channel is a single-slot mailbox and one write has to carry a whole chord.
 * Handling note on/off here as well would sound every note twice. What MIDI is
 * for is the thing the parameter channel cannot express: somebody ELSE asking
 * for silence.
 *
 *   CC 120  All Sound Off   cut now
 *   CC 123  All Notes Off   release
 *   0xFF    System Reset    cut now
 *
 * Never channel-scoped. This instrument occupies no channel, so honouring one
 * and ignoring another would make the silence conditional on a number nobody
 * set — and a panic that works on 1 of 16 channels is worse than none, because
 * it looks like it should have worked.
 *
 * Runs on the SPI callback, like set_param, so the ring keeps its single
 * producer. Nothing here allocates, blocks or logs.
 */
static void on_midi(void *instance, const uint8_t *msg, int len, int source) {
    piano_t *p = (piano_t *)instance;
    (void)source;
    if (!p || !msg || len < 1) return;
    if (msg[0] == 0xFF) {
        push_event(p, EV_PANIC, 0, 0);
        return;
    }
    if (len < 3 || (msg[0] & 0xF0) != 0xB0) return;
    if (msg[1] == 120) push_event(p, EV_PANIC, 0, 0);
    else if (msg[1] == 123) push_event(p, EV_RELEASE_ALL, 0, 0);
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    piano_t *p = (piano_t *)instance;
    if (!p || !key || !buf || buf_len <= 0) return 0;
    if (strcmp(key, "ping") == 0) {
        return snprintf(buf, (size_t)buf_len, "%s", ENGINE_VERSION);
    }
    if (strcmp(key, "voices") == 0) {
        int n = 0;
        for (int i = 0; i < MAX_VOICES; i++) if (p->voices[i].active) n++;
        return snprintf(buf, (size_t)buf_len, "%d", n);
    }
    return 0;
}

static int get_error(void *instance, char *buf, int buf_len) {
    (void)instance;
    (void)buf;
    (void)buf_len;
    return 0;
}

static void render_block(void *instance, int16_t *out, int frames) {
    piano_t *p = (piano_t *)instance;
    if (!p || !out) return;

    event_t e;
    while (pop_event(p, &e)) apply_event(p, &e);

    for (int f = 0; f < frames; f++) {
        float mix = 0.0f;

        for (int vi = 0; vi < MAX_VOICES; vi++) {
            voice_t *v = &p->voices[vi];
            if (!v->active) continue;

            if (v->attack < 1.0f) {
                v->attack += v->attack_inc;
                if (v->attack > 1.0f) v->attack = 1.0f;
            }
            if (v->releasing) {
                /* The damper falls: ~120ms to silence, as a key release does. */
                v->release *= 0.99975f;
            }

            float sum = 0.0f;
            for (int i = 0; i < NUM_PARTIALS; i++) {
                if (v->amp[i] <= 0.0f) continue;
                unsigned idx = (unsigned)v->phase[i] & SINE_MASK;
                sum += p->sine[idx] * v->amp[i];
                v->phase[i] += v->inc[i];
                if (v->phase[i] >= (float)SINE_SIZE) v->phase[i] -= (float)SINE_SIZE;
                v->amp[i] *= v->decay[i];
            }

            float out_v = sum * v->attack * v->release;
            mix += out_v;

            /* Retire once inaudible, so dead voices stop costing anything. */
            if (v->release < 0.0008f) {
                v->active = 0;
            } else {
                float loudest = 0.0f;
                for (int i = 0; i < NUM_PARTIALS; i++) {
                    if (v->amp[i] > loudest) loudest = v->amp[i];
                }
                if (loudest < 0.00008f) v->active = 0;
            }
        }

        mix *= p->gain;
        /* Soft knee rather than a hard clip: a stacked chord should compress,
         * not buzz. */
        if (mix > 1.0f) mix = 1.0f;
        else if (mix < -1.0f) mix = -1.0f;
        else mix = mix - (mix * mix * mix) / 3.0f;

        int32_t s = (int32_t)(mix * 26000.0f);
        if (s > 32767) s = 32767;
        if (s < -32768) s = -32768;

        /* The host zeroes this buffer before the call; add so we stay correct
         * even if that ever changes. */
        out[f * 2] = (int16_t)(out[f * 2] + s);
        out[f * 2 + 1] = (int16_t)(out[f * 2 + 1] + s);
    }
}

static plugin_api_v2_t g_api = {
    .api_version = MOVE_PLUGIN_API_VERSION_2,
    .create_instance = create_instance,
    .destroy_instance = destroy_instance,
    .on_midi = on_midi,
    .set_param = set_param,
    .get_param = get_param,
    .get_error = get_error,
    .render_block = render_block,
};

plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host) {
    g_host = host;
    return &g_api;
}
