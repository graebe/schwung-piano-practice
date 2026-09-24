/*
 * ab.c — render a fixed score through whichever implementation is handed to
 * it, and dump the samples.
 *
 * dlopen rather than two compiled-in engines, so both runs are driven by
 * literally the same harness instructions. If the harness were compiled twice
 * the comparison would be measuring the compiler as much as the engine.
 *
 *   ab <path-to-dsp.so> <out.raw>
 */
#include "host/plugin_api_v1.h"

#include <dlfcn.h>
#include <stdio.h>
#include <string.h>

#define FRAMES MOVE_FRAMES_PER_BLOCK

static plugin_api_v2_t *api;
static void *inst;
static FILE *out;

static void render(int blocks) {
    for (int b = 0; b < blocks; b++) {
        int16_t buf[FRAMES * 2];
        memset(buf, 0, sizeof(buf));
        api->render_block(inst, buf, FRAMES);
        fwrite(buf, sizeof(int16_t), FRAMES * 2, out);
    }
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: ab <dsp.so> <out.raw>\n"); return 2; }

    void *lib = dlopen(argv[1], RTLD_NOW);
    if (!lib) { fprintf(stderr, "dlopen: %s\n", dlerror()); return 2; }
    move_plugin_init_v2_fn init =
        (move_plugin_init_v2_fn)dlsym(lib, MOVE_PLUGIN_INIT_V2_SYMBOL);
    if (!init) { fprintf(stderr, "no %s\n", MOVE_PLUGIN_INIT_V2_SYMBOL); return 2; }

    host_api_v1_t host;
    memset(&host, 0, sizeof(host));
    host.sample_rate = MOVE_SAMPLE_RATE;
    host.frames_per_block = FRAMES;

    api = init(&host);
    inst = api->create_instance("/tmp", "{}");
    if (!inst) { fprintf(stderr, "no instance\n"); return 2; }

    out = fopen(argv[2], "wb");
    if (!out) { fprintf(stderr, "cannot write %s\n", argv[2]); return 2; }

    /* Silence, so a DC offset or a stuck voice shows up before anything plays. */
    render(4);

    /* Single notes across the range: the frequency table, the stretch, and the
     * partial that must be silenced above Nyquist rather than aliased. */
    for (int pitch = 21; pitch <= 108; pitch += 11) {
        char msg[32];
        snprintf(msg, sizeof(msg), "%d:100", pitch);
        api->set_param(inst, "n", msg);
        render(6);
        snprintf(msg, sizeof(msg), "%d:0", pitch);
        api->set_param(inst, "n", msg);
        render(4);
    }

    /* A held chord: one write, four voices, overlapping decays. */
    api->set_param(inst, "n", "48:90,55:90,60:90,64:90");
    render(40);
    api->set_param(inst, "n", "48:0,55:0,60:0,64:0");
    render(20);

    /* Velocity, which drives brightness as well as level. */
    for (int vel = 1; vel <= 127; vel += 42) {
        char msg[32];
        snprintf(msg, sizeof(msg), "72:%d", vel);
        api->set_param(inst, "n", msg);
        render(8);
    }
    api->set_param(inst, "panic", "1");
    render(2);

    /* Twenty notes into sixteen voices: the stealing order has to match, and
     * it is the case most likely to diverge if `age` is handled differently. */
    for (int i = 0; i < 20; i++) {
        char msg[32];
        snprintf(msg, sizeof(msg), "%d:%d", 40 + i * 2, 60 + i);
        api->set_param(inst, "n", msg);
        render(1);
    }
    render(30);

    /* Panic mid-decay: the cut must land on the same sample. */
    api->set_param(inst, "panic", "1");
    render(4);

    /* CC 123 mid-decay: released, not cut — the tail shape is the assertion. */
    api->set_param(inst, "n", "60:100,64:100,67:100");
    render(10);
    if (api->on_midi) {
        const uint8_t all_notes_off[3] = { 0xB0, 123, 0 };
        api->on_midi(inst, all_notes_off, 3, 0);
    }
    render(60);

    /* Retrigger: same pitch twice must reuse its voice, not stack. */
    api->set_param(inst, "n", "60:100");
    render(3);
    api->set_param(inst, "n", "60:100");
    render(20);

    /* Gain, and the soft knee at the top of it. */
    api->set_param(inst, "gain", "0.9");
    api->set_param(inst, "n", "36:127,40:127,43:127,47:127,50:127,55:127");
    render(30);

    fclose(out);
    api->destroy_instance(inst);
    return 0;
}
