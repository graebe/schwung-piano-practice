/*
 * The OTHER panic.
 *
 * Nothing in this tree should ever reach here — the audio path denies
 * indexing, unwrap and expect precisely so that a Rust panic is unreachable
 * rather than merely unlikely. This exists because no_std requires it and
 * because if the unreachable happens on the SPI callback, aborting is the only
 * defensible thing left: unwinding out through `extern "C"` is undefined
 * behaviour, and a plugin fault on that thread takes MoveOriginal down with it.
 *
 * Not to be confused with the MIDI panic the synth implements (CC 120, CC 123,
 * System Reset), which is a feature and lives in the piano crate.
 */
#[cfg(feature = "rt")]
use core::panic::PanicInfo;

#[link(name = "c")]
extern "C" {
    fn abort() -> !;
}

/*
 * A stub, and it is never called.
 *
 * The profile says panic = "abort", but the precompiled `alloc` rlib that
 * ships with the toolchain was built for unwinding, so it still references the
 * personality routine. Rebuilding core and alloc to match (-Z build-std) needs
 * nightly; an unreachable stub is the stable way to satisfy the linker. If
 * this is ever reached, panic = "abort" has silently stopped applying.
 */
#[cfg(feature = "rt")]
#[no_mangle]
extern "C" fn rust_eh_personality() {}

#[cfg(feature = "rt")]
#[panic_handler]
fn on_panic(_info: &PanicInfo) -> ! {
    unsafe { abort() }
}
