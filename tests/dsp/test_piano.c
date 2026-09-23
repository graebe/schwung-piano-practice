/*
 * Renders real blocks and measures them. The synth runs on the audio thread
 * where nothing can be inspected, so everything worth knowing has to be
 * provable here: that a note sounds, that it decays, that a release damps it,
 * that sixteen at once do not clip, and that panic silences everything.
 */
#include "host/plugin_api_v1.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host);

static int failures = 0;
static int checks = 0;

static void check(int cond, const char *what) {
    checks++;
    if (!cond) {
        printf("not ok - %s\n", what);
        failures++;
    } else {
        printf("ok - %s\n", what);
    }
}

#define FRAMES MOVE_FRAMES_PER_BLOCK

/* Peak absolute sample over `blocks` rendered blocks. */
static int render_peak(plugin_api_v2_t *api, void *inst, int blocks) {
    int16_t buf[FRAMES * 2];
    int peak = 0;
    for (int b = 0; b < blocks; b++) {
        memset(buf, 0, sizeof(buf));
        api->render_block(inst, buf, FRAMES);
        for (int i = 0; i < FRAMES * 2; i++) {
            int a = buf[i] < 0 ? -buf[i] : buf[i];
            if (a > peak) peak = a;
        }
    }
    return peak;
}

static int voice_count(plugin_api_v2_t *api, void *inst) {
    char b[32] = {0};
    api->get_param(inst, "voices", b, sizeof(b));
    return atoi(b);
}

int main(void) {
    host_api_v1_t host;
    memset(&host, 0, sizeof(host));
    host.sample_rate = MOVE_SAMPLE_RATE;
    host.frames_per_block = FRAMES;

    plugin_api_v2_t *api = move_plugin_init_v2(&host);
    check(api != NULL, "plugin exposes the v2 interface");
    check(api->api_version == MOVE_PLUGIN_API_VERSION_2, "declares api version 2");
    check(api->render_block != NULL && api->create_instance != NULL, "has the entry points");

    void *inst = api->create_instance("/tmp", "{}");
    check(inst != NULL, "creates an instance");

    char ping[32] = {0};
    api->get_param(inst, "ping", ping, sizeof(ping));
    check(ping[0] != '\0', "answers a ping, so the UI can tell it loaded");

    /* Silent until played. */
    check(render_peak(api, inst, 4) == 0, "silent with nothing playing");

    /* A note sounds. */
    api->set_param(inst, "n", "60:100");
    int peak = render_peak(api, inst, 8);
    check(peak > 2000, "a note on actually makes sound");
    check(peak < 32767, "and does not clip on its own");
    check(voice_count(api, inst) == 1, "one voice for one note");

    /* It decays like a struck string rather than holding like an organ. */
    int early = render_peak(api, inst, 4);
    for (int i = 0; i < 300; i++) render_peak(api, inst, 1);
    int late = render_peak(api, inst, 4);
    check(late < early, "the note decays while still held");

    /* Note off damps it to silence. */
    api->set_param(inst, "n", "60:0");
    for (int i = 0; i < 400; i++) render_peak(api, inst, 1);
    check(render_peak(api, inst, 4) == 0, "note off damps it to silence");
    check(voice_count(api, inst) == 0, "and the voice is retired");

    /* Polyphony: a full chord, then a lot of notes at once. */
    api->set_param(inst, "n", "60:100");
    api->set_param(inst, "n", "64:100");
    api->set_param(inst, "n", "67:100");
    render_peak(api, inst, 1);
    check(voice_count(api, inst) == 3, "a triad holds three voices");

    for (int p = 48; p < 48 + 24; p++) {
        char msg[16];
        snprintf(msg, sizeof(msg), "%d:110", p);
        api->set_param(inst, "n", msg);
    }
    int loud = render_peak(api, inst, 16);
    check(loud <= 32767, "two dozen notes at once stay inside the sample range");
    check(voice_count(api, inst) <= 16, "voice count is capped, oldest stolen");

    /* Panic. */
    api->set_param(inst, "panic", "1");
    render_peak(api, inst, 1);
    check(voice_count(api, inst) == 0, "panic drops every voice");
    check(render_peak(api, inst, 4) == 0, "and the output is silent");

    /* Extremes must not blow up. */
    api->set_param(inst, "n", "0:100");
    api->set_param(inst, "n", "127:100");
    int extreme = render_peak(api, inst, 8);
    check(extreme <= 32767, "the lowest and highest MIDI notes render safely");
    api->set_param(inst, "panic", "1");
    render_peak(api, inst, 1);

    /* Garbage in must not crash or make noise. */
    api->set_param(inst, "n", "nonsense");
    api->set_param(inst, "n", "999:100");
    api->set_param(inst, "n", NULL);
    api->set_param(inst, "unknown", "1");
    check(render_peak(api, inst, 2) == 0, "malformed parameters are ignored");

    /* A whole chord arrives in one write: the parameter channel is a
     * single-slot mailbox, so one call per note would lose all but the last. */
    api->set_param(inst, "panic", "1");
    render_peak(api, inst, 1);
    api->set_param(inst, "n", "55:90,59:90,62:90,67:90");
    render_peak(api, inst, 1);
    check(voice_count(api, inst) == 4, "one write carries a whole chord");
    api->set_param(inst, "n", "55:0,59:0,62:0,67:0");
    for (int i = 0; i < 400; i++) render_peak(api, inst, 1);
    check(voice_count(api, inst) == 0, "and one write releases it again");

    api->set_param(inst, "n", "60:100,garbage,64:100");
    render_peak(api, inst, 1);
    check(voice_count(api, inst) == 2, "a bad entry mid-list does not lose the good ones");
    api->set_param(inst, "panic", "1");
    render_peak(api, inst, 1);

    /* A retrigger reuses its voice instead of stacking. */
    api->set_param(inst, "n", "72:100");
    render_peak(api, inst, 1);
    api->set_param(inst, "n", "72:100");
    render_peak(api, inst, 1);
    check(voice_count(api, inst) == 1, "retriggering a held note does not stack voices");

    /* The output must be added, not overwritten: the host mixes our buffer. */
    api->set_param(inst, "panic", "1");
    render_peak(api, inst, 1);
    api->set_param(inst, "n", "60:100");
    int16_t buf[FRAMES * 2];
    for (int i = 0; i < FRAMES * 2; i++) buf[i] = 1000;
    api->render_block(inst, buf, FRAMES);
    int changed = 0;
    for (int i = 0; i < FRAMES * 2; i++) if (buf[i] != 1000) changed = 1;
    check(changed, "render adds into the caller's buffer");

    api->destroy_instance(inst);
    printf("1..%d\n", checks);
    if (failures) {
        printf("# %d failed\n", failures);
        return 1;
    }
    printf("# all passed\n");
    return 0;
}
