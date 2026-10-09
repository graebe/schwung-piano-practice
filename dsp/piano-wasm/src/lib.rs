// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * piano-wasm — piano-engine for the browser, as raw WebAssembly exports.
 *
 * No wasm-bindgen: the surface is eleven numbers-in, numbers-out functions and
 * two buffers in linear memory, which an AudioWorklet can drive with nothing
 * but `WebAssembly.Instance`. The engine is the one the Move runs; this crate
 * only adapts its calls, so it holds the module's one piece of global state
 * and the only `unsafe` on this side of the split.
 *
 * THE ABI (all integers u32, all floats f32):
 *
 *   pp_init(sample_rate) -> ok      A fresh, silent engine at that rate.
 *                                   Refuses (0) anything outside 8000..=384000,
 *                                   leaving the previous engine in place.
 *   pp_buf_ptr() -> *mut u8         The note-list buffer, pp_buf_cap() bytes.
 *   pp_buf_cap() -> u32             Write ASCII there, then call pp_notes.
 *   pp_notes(len)                   Queue the first `len` bytes of the buffer
 *                                   as an `n` list — the device's syntax,
 *                                   "60:100,64:0", velocity 0 a release.
 *                                   `len` beyond the capacity is truncated,
 *                                   as the device truncates at 4096.
 *   pp_panic()                      Queue a cut (CC 120 on the device).
 *   pp_release_all()                Queue a release of every voice (CC 123).
 *   pp_gain(g) -> ok                0..=1; anything else refused (0).
 *   pp_render(frames) -> frames     Apply what is queued, then render up to
 *                                   pp_out_cap() frames; returns how many.
 *                                   0 before pp_init.
 *   pp_out_ptr() -> *const f32      MONO f32 in -1..=1, `frames` of them. The
 *   pp_out_cap() -> u32             caller copies it to every channel.
 *   pp_voices() -> u32              Sounding voices, for tests and meters.
 *
 * The buffers live in a static, so their addresses never change — but the
 * memory they live in can grow, and a JS view over it is detached when it
 * does. Re-create the view whenever `memory.buffer` is a new object.
 */
#![cfg(target_arch = "wasm32")]
#![no_std]
#![deny(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use core::cell::UnsafeCell;
use piano_engine::Engine;

/// The device reads at most 4096 bytes of a parameter value; so does this.
const NOTES_CAP: usize = 4096;
/// Frames per pp_render. The browser asks for 128; tests ask for more.
const OUT_CAP: usize = 4096;

const MIN_RATE: f32 = 8000.0;
const MAX_RATE: f32 = 384_000.0;

struct State {
    engine: Slot,
    notes: [u8; NOTES_CAP],
    out: [f32; OUT_CAP],
}

/*
 * Option<Engine>, but with an explicit tag. Option would hide None in a niche
 * of the engine (a bool set to 2), which makes the static's initial bytes
 * non-zero and drags ~30KB of them into the module's data section. Tag 0 and
 * zeroed buffers leave the whole static zero, so it costs nothing to ship.
 */
#[repr(u8)]
#[allow(clippy::large_enum_variant)] // one static, and no allocator to box into
enum Slot {
    Empty = 0,
    Ready(Engine) = 1,
}

impl Slot {
    fn get(&mut self) -> Option<&mut Engine> {
        match self {
            Slot::Ready(e) => Some(e),
            Slot::Empty => None,
        }
    }
}

struct Global(UnsafeCell<State>);

/* The Sync below is true only without shared-memory threads; refuse the build
 * that would make it false rather than trust nobody tries. */
#[cfg(target_feature = "atomics")]
compile_error!("piano-wasm's global state assumes a single thread; build without +atomics");

// SAFETY: wasm32-unknown-unknown without the `atomics` target feature has one
// thread, and this module is only ever built for it (the `cfg` above). Nothing
// can observe STATE concurrently.
unsafe impl Sync for Global {}

static STATE: Global = Global(UnsafeCell::new(State {
    engine: Slot::Empty,
    notes: [0; NOTES_CAP],
    out: [0.0; OUT_CAP],
}));

/// Run `f` with the module state. Every export goes through here exactly once
/// and none calls another, so the `&mut` is the only reference for its life.
fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    // SAFETY: single-threaded (see `Global`), and not re-entrant: exports do
    // not call back into JS or into each other, so no second `&mut` exists
    // while this one does. JS writes to `notes` only between calls.
    f(unsafe { &mut *STATE.0.get() })
}

#[unsafe(no_mangle)]
pub extern "C" fn pp_init(sample_rate: f32) -> u32 {
    if !(MIN_RATE..=MAX_RATE).contains(&sample_rate) {
        return 0;
    }
    with(|s| s.engine = Slot::Ready(Engine::new(sample_rate)));
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn pp_buf_ptr() -> *mut u8 {
    with(|s| s.notes.as_mut_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn pp_buf_cap() -> u32 {
    NOTES_CAP as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn pp_notes(len: u32) {
    with(|s| {
        let n = (len as usize).min(NOTES_CAP);
        if let (Some(e), Some(list)) = (s.engine.get(), s.notes.get(..n)) {
            e.set_notes(list);
        }
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn pp_panic() {
    with(|s| s.engine.get().map(Engine::panic));
}

#[unsafe(no_mangle)]
pub extern "C" fn pp_release_all() {
    with(|s| s.engine.get().map(Engine::release_all));
}

#[unsafe(no_mangle)]
pub extern "C" fn pp_gain(g: f32) -> u32 {
    with(|s| s.engine.get().is_some_and(|e| e.set_gain(g))) as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn pp_render(frames: u32) -> u32 {
    with(|s| {
        let n = (frames as usize).min(OUT_CAP);
        match (s.engine.get(), s.out.get_mut(..n)) {
            (Some(e), Some(out)) => {
                e.render_f32(out);
                n as u32
            }
            _ => 0,
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pp_out_ptr() -> *const f32 {
    with(|s| s.out.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn pp_out_cap() -> u32 {
    OUT_CAP as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn pp_voices() -> u32 {
    with(|s| s.engine.get().map_or(0, |e| e.active_voices())) as u32
}

/* The engine cannot panic (its denies forbid every way to), so this is never
 * reached; a trap is the honest answer if it ever is. */
#[panic_handler]
fn on_panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
