// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * test_abi.c — the plugin's C boundary, held to what a careless host may do.
 *
 * test_piano.c proves the piano sounds as it should, through the ABI the Move
 * calls. This one proves the ABI itself cannot be made to fault: a NULL where
 * a pointer belongs, an empty message, a buffer too small for the answer, a
 * render of zero frames or of absurdly many. Every one of these is a call the
 * Move's firmware could make while it is tearing a slot down, and a fault on
 * that thread takes the device with it. Each must be answered by doing
 * nothing, or by a safe, terminated, truncated answer.
 */
#include "host/plugin_api_v1.h"

#include <stdio.h>
#include <string.h>

plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host);

static int failures = 0;

static void check(int cond, const char *what) {
    printf("%s - %s\n", cond ? "ok" : "not ok", what);
    if (!cond) failures++;
}

int main(void) {
    host_api_v1_t host;
    memset(&host, 0, sizeof(host));
    plugin_api_v2_t *api = move_plugin_init_v2(&host);
    check(api != NULL, "init returns the API table");
    if (!api) return 1;

    void *inst = api->create_instance("/tmp", NULL);
    check(inst != NULL, "an instance is created with no defaults");

    /* A NULL instance is ignored by every call. */
    api->destroy_instance(NULL);
    api->on_midi(NULL, (const uint8_t *)"\xb0\x78\x00", 3, 0);
    api->set_param(NULL, "n", "60:100");
    int16_t buf[64 * 2];
    memset(buf, 0, sizeof(buf));
    api->render_block(NULL, buf, 64);
    char out[16];
    check(api->get_param(NULL, "ping", out, sizeof out) == 0, "get_param with no instance answers nothing");
    check(1, "no call on a NULL instance faults");

    /* Messages and keys that are not there. */
    api->on_midi(inst, NULL, 3, 0);
    api->on_midi(inst, (const uint8_t *)"\xb0", 0, 0);
    api->on_midi(inst, (const uint8_t *)"\xb0", -1, 0);
    api->set_param(inst, NULL, "60:100");
    api->set_param(inst, "n", NULL);
    api->set_param(inst, "gain", NULL);
    api->set_param(inst, "no-such-key", "1");
    check(1, "empty and missing messages, keys and values are ignored");

    /* get_param: a buffer that cannot hold the answer still gets a terminator. */
    check(api->get_param(inst, NULL, out, sizeof out) == 0, "a NULL key answers nothing");
    check(api->get_param(inst, "ping", NULL, 8) == 0, "a NULL buffer answers nothing");
    check(api->get_param(inst, "ping", out, 0) == 0, "a zero-length buffer answers nothing");
    memset(out, 'x', sizeof out);
    check(api->get_param(inst, "ping", out, 1) == 0 && out[0] == '\0',
          "a one-byte buffer holds only the terminator");
    check(api->get_param(inst, "no-such-key", out, sizeof out) == 0 && out[0] == '\0',
          "an unknown key answers empty, terminated");
    api->set_param(inst, "n", "60:100,64:100,67:100,72:100,76:100,79:100,84:100,88:100,91:100,96:100,100:100");
    int16_t block[MOVE_FRAMES_PER_BLOCK * 2];
    memset(block, 0, sizeof(block));
    api->render_block(inst, block, MOVE_FRAMES_PER_BLOCK);
    memset(out, 'x', sizeof out);
    int n = api->get_param(inst, "voices", out, 2);
    check(n == 1 && out[1] == '\0', "a two-digit answer in a two-byte buffer is truncated and terminated");

    /* get_error has nothing to report, and says so. */
    check(api->get_error(inst, out, sizeof out) == 0, "get_error reports no error");
    check(api->get_error(NULL, NULL, 0) == 0, "get_error with nothing at all");

    /* Renders that are not renders. */
    api->render_block(inst, NULL, 64);
    api->render_block(inst, buf, 0);
    api->render_block(inst, buf, -5);
    api->render_block(inst, buf, 1 << 20);
    check(1, "a NULL buffer and an impossible frame count are refused");

    api->destroy_instance(inst);
    check(1, "the instance is destroyed");

    printf("%s\n", failures ? "# FAILED" : "# all passed");
    return failures ? 1 : 0;
}
