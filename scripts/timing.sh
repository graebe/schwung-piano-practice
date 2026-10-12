# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
#
# shellcheck shell=bash
#
# Copied from neon-ingvy-audio-plugins (scripts/timing.sh) so this module's
# stages land in the same log in the same shape; keep the two identical.
# How long each build and test stage takes, logged the same way by every
# script that builds or tests. Source it, do not run it.
#
#   ni_time_stage <stage> [--build <dir>] [--preset <name>] [--here] -- <command...>
#
# runs the command, prints nothing of its own, returns the command's exit
# status, and appends ONE JSON line to the timing log:
#
#   time        when the stage started, ISO 8601 in UTC
#   run         one id for every stage of one top-level invocation (a script
#               a script calls inherits its caller's), so a run reads as one
#   sha, branch, worktree
#               the checkout it ran in (git; NI_TIMING_SHA/_BRANCH/_WORKTREE
#               when there is no git to ask, as inside a container)
#   script      the script that was run (NI_TIMING_SCRIPT overrides)
#   stage       what the caller calls it: build, ctest, pluginval NITranceGate
#   preset      --preset, or NI_TIMING_PRESET; null when there is none
#   build_type, generator, archs
#               from --build's CMakeCache.txt; null without one
#   duration_s  wall time, to the millisecond
#   exit_code   the command's
#   ccache_hits, ccache_misses
#               what `ccache --print-stats` counted during the stage. ccache's
#               counters are the machine's, not the stage's: another build
#               running at the same time is counted too. null without ccache
#   cpus, load1 the processors, and the one-minute load average at the start
#   host        the machine (NI_TIMING_HOST overrides, for a container)
#
# A stage given --build also gets its build directory's .ninja_log copied
# next to the log, as ninja/<time>-<script>-<stage>.ninja_log, for per-target
# analysis (scripts/build-timings.py reads the log; the copies are for
# `ninja -t` and ninjatracing).
#
# THE LOG LIVES OUTSIDE EVERY CHECKOUT, so removing a worktree or a build
# directory never removes it: ~/Library/Logs/neon-ingvy/build-timings.jsonl on
# macOS, $XDG_STATE_HOME/neon-ingvy/build-timings.jsonl (~/.local/state by
# default) elsewhere; NI_TIMING_LOG names another file. Inside a container
# nothing is logged unless the caller passed NI_TIMING_LOG in -- a container's
# home is thrown away with it.
#
# The command runs in a subshell, with the caller's errexit setting: a stage
# fails as it would have without the timing, and returns its status rather
# than ending the caller (a caller under set -e that wants it to end the
# script writes `ni_time_stage ... || exit`). --here runs it in the caller's
# own shell instead, as `<command> || status=$?` would -- for a shell function
# that sets variables its caller reads afterwards. A failure to write the log
# is reported once and never fails the stage.
#
# Runs under macOS's bash 3.2 as well as bash 5.

ni_timing_log() {
    if [ -n "${NI_TIMING_LOG:-}" ]; then
        printf '%s\n' "$NI_TIMING_LOG"
    elif [ "${NI_INSIDE:-}" = 1 ] || [ -f /.dockerenv ]; then
        return 1
    elif [ "$(uname -s)" = Darwin ]; then
        printf '%s\n' "$HOME/Library/Logs/neon-ingvy/build-timings.jsonl"
    else
        printf '%s\n' "${XDG_STATE_HOME:-$HOME/.local/state}/neon-ingvy/build-timings.jsonl"
    fi
}

# A JSON string, or null for an empty one.
_ni_json_str() {
    if [ -z "$1" ]; then
        printf 'null'
        return
    fi
    local s=$1
    s=${s//\\/\\\\}
    s=${s//\"/\\\"}
    s=${s//$'\t'/\\t}
    s=${s//$'\n'/\\n}
    s=${s//$'\r'/\\r}
    printf '"%s"' "$s"
}

# A JSON number, or null for anything that is not one.
_ni_json_num() {
    case "$1" in
        ''|*[!0-9.-]*) printf 'null' ;;
        *) printf '%s' "$1" ;;
    esac
}

# Seconds since the epoch, to the millisecond where the platform can say.
_ni_now() {
    local t
    t=$(date +%s.%N 2>/dev/null)
    case "$t" in
        *N*|'') perl -MTime::HiRes=time -e 'printf "%.3f\n", time' 2>/dev/null || date +%s ;;
        *) printf '%.3f\n' "$t" ;;
    esac
}

# ccache's hit and miss counters, "<hits> <misses>", or nothing.
_ni_ccache_counts() {
    command -v ccache >/dev/null 2>&1 || return 0
    ccache --print-stats 2>/dev/null | awk -F'\t' '
        $1 == "direct_cache_hit" || $1 == "preprocessed_cache_hit" { hits += $2 }
        $1 == "cache_miss" { misses += $2; seen = 1 }
        END { if (seen) print hits + 0, misses + 0 }'
}

_ni_load1() {
    if [ -r /proc/loadavg ]; then
        cut -d' ' -f1 /proc/loadavg
    else
        sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' | awk '{ print $1 }'
    fi
}

_ni_cpus() {
    getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null
}

# A CMakeCache.txt entry, or nothing.
_ni_cache() {
    [ -f "$1/CMakeCache.txt" ] || return 0
    sed -n "s/^$2:[A-Z]*=//p" "$1/CMakeCache.txt" | head -n 1
}

ni_time_stage() {
    local stage=$1 build='' preset=${NI_TIMING_PRESET:-} here=0
    shift
    while [ $# -gt 0 ]; do
        case "$1" in
            --build) build=$2; shift 2 ;;
            --preset) preset=$2; shift 2 ;;
            --here) here=1; shift ;;
            --) shift; break ;;
            *) echo "ni_time_stage: unknown option $1 (the command follows --)" >&2; return 2 ;;
        esac
    done
    [ $# -gt 0 ] || { echo "ni_time_stage $stage: no command after --" >&2; return 2; }

    # One run id for the whole invocation, inherited by the scripts it calls.
    if [ -z "${NI_TIMING_RUN:-}" ]; then
        NI_TIMING_RUN="$(date -u +%Y%m%dT%H%M%SZ)-$$"
        export NI_TIMING_RUN
    fi

    local log
    log=$(ni_timing_log) || log=''
    local started load1 counts_before t0
    started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    load1=$(_ni_load1)
    counts_before=$(_ni_ccache_counts)
    t0=$(_ni_now)

    local rc=0 errexit=0
    if [ "$here" = 1 ]; then
        "$@" || rc=$?
    else
        case $- in *e*) errexit=1 ;; esac
        set +e
        ( if [ "$errexit" = 1 ]; then set -e; fi; "$@" )
        rc=$?
        if [ "$errexit" = 1 ]; then set -e; fi
    fi

    [ -n "$log" ] || return "$rc"

    local t1 counts_after hits='' misses=''
    t1=$(_ni_now)
    counts_after=$(_ni_ccache_counts)
    if [ -n "$counts_before" ] && [ -n "$counts_after" ]; then
        local h0 m0 h1 m1
        read -r h0 m0 <<< "$counts_before"
        read -r h1 m1 <<< "$counts_after"
        hits=$(( h1 - h0 ))
        misses=$(( m1 - m0 ))
    fi

    # The script that was run -- $0, so a helper sourced into it (this file,
    # cross-common.sh) is never named instead -- from the repository root.
    local script=${NI_TIMING_SCRIPT:-$0}
    case "$script" in
        */scripts/*) script="scripts/${script##*/scripts/}" ;;
        */modules/*) script="modules/${script##*/modules/}" ;;
    esac

    local sha=${NI_TIMING_SHA:-} branch=${NI_TIMING_BRANCH:-} worktree=${NI_TIMING_WORKTREE:-}
    [ -n "$sha" ] || sha=$(git rev-parse --short=12 HEAD 2>/dev/null || true)
    [ -n "$branch" ] || branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    [ -n "$worktree" ] || worktree=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

    local build_type='' generator='' archs=''
    if [ -n "$build" ]; then
        build_type=$(_ni_cache "$build" CMAKE_BUILD_TYPE)
        generator=$(_ni_cache "$build" CMAKE_GENERATOR)
        archs=$(_ni_cache "$build" CMAKE_OSX_ARCHITECTURES)
        [ -n "$archs" ] || archs=$(_ni_cache "$build" CMAKE_SYSTEM_PROCESSOR)
        [ -n "$archs" ] || archs=$(uname -m)
    fi

    local duration host
    duration=$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.3f", b - a }')
    host=${NI_TIMING_HOST:-$(hostname -s 2>/dev/null || hostname 2>/dev/null || true)}

    local line
    line="{\"time\":$(_ni_json_str "$started"),\"run\":$(_ni_json_str "$NI_TIMING_RUN")"
    line+=",\"sha\":$(_ni_json_str "$sha"),\"branch\":$(_ni_json_str "$branch")"
    line+=",\"worktree\":$(_ni_json_str "$worktree"),\"script\":$(_ni_json_str "$script")"
    line+=",\"stage\":$(_ni_json_str "$stage"),\"preset\":$(_ni_json_str "$preset")"
    line+=",\"build_type\":$(_ni_json_str "$build_type"),\"generator\":$(_ni_json_str "$generator")"
    line+=",\"archs\":$(_ni_json_str "$archs"),\"duration_s\":$(_ni_json_num "$duration")"
    line+=",\"exit_code\":$rc,\"ccache_hits\":$(_ni_json_num "$hits")"
    line+=",\"ccache_misses\":$(_ni_json_num "$misses"),\"cpus\":$(_ni_json_num "$(_ni_cpus)")"
    line+=",\"load1\":$(_ni_json_num "$load1"),\"host\":$(_ni_json_str "$host")}"

    if mkdir -p "$(dirname "$log")" 2>/dev/null && printf '%s\n' "$line" >> "$log" 2>/dev/null; then
        if [ -n "$build" ] && [ -f "$build/.ninja_log" ]; then
            local name
            name="$(date -u +%Y%m%dT%H%M%SZ)-$(basename "$script" .sh)-$stage.ninja_log"
            name=$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '_')
            mkdir -p "$(dirname "$log")/ninja" && cp "$build/.ninja_log" "$(dirname "$log")/ninja/$name" 2>/dev/null || true
        fi
    elif [ -z "${_NI_TIMING_WARNED:-}" ]; then
        echo "note: the timing log $log could not be written; stages still run" >&2
        _NI_TIMING_WARNED=1
    fi
    return "$rc"
}
