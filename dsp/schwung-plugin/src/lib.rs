/*
 * schwung-plugin — the Schwung native DSP plugin API (v2), in Rust.
 *
 * This crate exists so that the NEXT module is a Cargo.toml and an `impl`.
 * Everything dangerous about the boundary is paid for here, once: the repr(C)
 * structs, the null checks, the raw-pointer-to-slice conversions, the instance
 * lifetime. A plugin crate that uses `schwung_plugin!` needs no `unsafe` of
 * its own, which is the actual reason to split the two apart.
 *
 * THE CONTRACT THAT IS NOT NEGOTIABLE, because it is not this crate's to relax:
 * every one of these entry points runs on the SPI callback — create_instance,
 * destroy_instance, set_param, get_param, on_midi and render_block alike. No
 * allocation after construction, no locks, no file I/O, no logging. A module
 * author who infers a control thread has inferred wrong; a 2026-08 audit of
 * the fleet found ~150 violations written by people who assumed one existed.
 */
#![cfg_attr(feature = "rt", no_std)]
#![deny(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

extern crate alloc;

#[cfg(feature = "rt")]
mod alloc_shim;
mod panic_shim;

use core::ffi::{c_char, c_int, c_void};
use core::sync::atomic::{AtomicPtr, Ordering};

#[cfg(feature = "rt")]
#[global_allocator]
static ALLOC: alloc_shim::LibcAlloc = alloc_shim::LibcAlloc;

pub const MOVE_PLUGIN_API_VERSION_2: u32 = 2;
pub const MOVE_SAMPLE_RATE: u32 = 44100;
pub const MOVE_FRAMES_PER_BLOCK: usize = 128;

/* A key or value longer than this is not a key or value; it is a pointer that
 * was never NUL-terminated. Walking it forever is how a bad caller becomes our
 * crash. */
const MAX_CSTR: usize = 4096;
/* frames is a c_int off the wire. The host sends 128. */
const MAX_FRAMES: c_int = 1 << 16;

/* ---- the host's half ----------------------------------------------------- */
/*
 * Mirrors host_api_v1_t. It ends in a run of fields we do not use, and that
 * tail matters: a module whose header declares a field the host does not have
 * reads somebody else's memory and jumps into it — which boot-looped a device
 * once already. Never append to this; if the host grows one, take it from the
 * front of whatever reserved space the C header defines.
 */
#[repr(C)]
pub struct HostApiV1 {
    pub api_version: u32,
    pub sample_rate: c_int,
    pub frames_per_block: c_int,
    pub mapped_memory: *mut u8,
    pub audio_out_offset: c_int,
    pub audio_in_offset: c_int,
    pub log: Option<unsafe extern "C" fn(*const c_char)>,
    pub midi_send_internal: Option<unsafe extern "C" fn(*const u8, c_int) -> c_int>,
    pub midi_send_external: Option<unsafe extern "C" fn(*const u8, c_int) -> c_int>,
    pub get_clock_status: Option<unsafe extern "C" fn() -> c_int>,
    pub mod_emit_value: *mut c_void,
    pub mod_clear_source: *mut c_void,
    pub mod_host_ctx: *mut c_void,
    pub get_bpm: Option<unsafe extern "C" fn() -> f32>,
    pub midi_inject_to_move: Option<unsafe extern "C" fn(*const u8, c_int) -> c_int>,
    pub slot_recv_channel: Option<unsafe extern "C" fn(*mut c_void) -> c_int>,
    pub get_beat_position: Option<unsafe extern "C" fn() -> f64>,
}

/* ---- our half ------------------------------------------------------------ */
#[repr(C)]
pub struct PluginApiV2 {
    pub api_version: u32,
    pub create_instance: unsafe extern "C" fn(*const c_char, *const c_char) -> *mut c_void,
    pub destroy_instance: unsafe extern "C" fn(*mut c_void),
    pub on_midi: unsafe extern "C" fn(*mut c_void, *const u8, c_int, c_int),
    pub set_param: unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char),
    pub get_param: unsafe extern "C" fn(*mut c_void, *const c_char, *mut c_char, c_int) -> c_int,
    pub get_error: unsafe extern "C" fn(*mut c_void, *mut c_char, c_int) -> c_int,
    pub render_block: unsafe extern "C" fn(*mut c_void, *mut i16, c_int),
}

/* Only ever handed out by reference, and the host never writes through it. */
unsafe impl Sync for PluginApiV2 {}

static HOST: AtomicPtr<HostApiV1> = AtomicPtr::new(core::ptr::null_mut());

/// What the host told us at init. `None` before `move_plugin_init_v2` runs.
///
/// Every function pointer on it is optional in the C — a NULL there is normal,
/// not an error — so each is an `Option<fn>` you must check.
pub fn host() -> Option<&'static HostApiV1> {
    unsafe { HOST.load(Ordering::Acquire).as_ref() }
}

#[doc(hidden)]
pub fn __set_host(p: *const HostApiV1) {
    HOST.store(p as *mut HostApiV1, Ordering::Release);
}

/* ---- the trait a module implements --------------------------------------- */
pub trait SchwungPlugin: Sized {
    /// Construct. The one place allocation is allowed. `None` means the host
    /// gets NULL and will not call anything else.
    fn create(module_dir: Option<&[u8]>, json_defaults: Option<&[u8]>) -> Option<Self>;

    /// Raw MIDI. `msg` is 1 byte for realtime, 3 for everything else.
    fn on_midi(&mut self, _msg: &[u8], _source: i32) {}

    /// `val` is `None` when the host passed NULL, which is distinct from an
    /// empty string and usually means "no value", not "empty value".
    fn set_param(&mut self, _key: &[u8], _val: Option<&[u8]>) {}

    /// Write the value into `out` and return how many bytes you wrote. `out`
    /// already excludes the byte reserved for the NUL the caller expects, so
    /// filling it completely is safe and truncation is yours to decide.
    fn get_param(&mut self, _key: &[u8], _out: &mut [u8]) -> usize {
        0
    }

    /// Interleaved stereo, `out.len() == frames * 2`.
    ///
    /// **ADD into `out`; never assign.** An overtake generator's output is
    /// mixed into the host's deferred buffer, so overwriting silences whatever
    /// else is in it. The C this replaced carried the same warning.
    fn render(&mut self, out: &mut [i16]);
}

/* ---- helpers the macro uses ---------------------------------------------- */
#[doc(hidden)]
pub mod rt {
    use super::{MAX_CSTR, MAX_FRAMES};
    use core::ffi::{c_char, c_int};

    /// NUL-terminated C string to bytes, bounded. `None` for NULL.
    ///
    /// # Safety
    /// `p` is NULL or points to a NUL-terminated string.
    pub unsafe fn cstr<'a>(p: *const c_char) -> Option<&'a [u8]> {
        if p.is_null() {
            return None;
        }
        let mut n = 0usize;
        while n < MAX_CSTR && *p.add(n) != 0 {
            n += 1;
        }
        Some(core::slice::from_raw_parts(p.cast::<u8>(), n))
    }

    /// # Safety
    /// `p` is NULL or points to at least `len` bytes.
    pub unsafe fn bytes<'a>(p: *const u8, len: c_int) -> Option<&'a [u8]> {
        if p.is_null() || len <= 0 || len > MAX_CSTR as c_int {
            return None;
        }
        Some(core::slice::from_raw_parts(p, len as usize))
    }

    /// # Safety
    /// `p` is NULL or points to at least `frames * 2` samples.
    pub unsafe fn samples<'a>(p: *mut i16, frames: c_int) -> Option<&'a mut [i16]> {
        if p.is_null() || frames <= 0 || frames > MAX_FRAMES {
            return None;
        }
        Some(core::slice::from_raw_parts_mut(p, (frames as usize) * 2))
    }
}

/*
 * Export a type implementing SchwungPlugin as a Schwung v2 DSP plugin.
 *
 *     schwung_plugin!(Piano);
 *
 * Generates the seven extern "C" shims, the static API table and
 * move_plugin_init_v2. Expand it once, at the crate root of a cdylib.
 */
#[macro_export]
macro_rules! schwung_plugin {
    ($ty:ty) => {
        unsafe extern "C" fn __schwung_create(
            dir: *const core::ffi::c_char,
            defaults: *const core::ffi::c_char,
        ) -> *mut core::ffi::c_void {
            let d = $crate::rt::cstr(dir);
            let j = $crate::rt::cstr(defaults);
            match <$ty as $crate::SchwungPlugin>::create(d, j) {
                Some(p) => alloc::boxed::Box::into_raw(alloc::boxed::Box::new(p)).cast(),
                None => core::ptr::null_mut(),
            }
        }

        unsafe extern "C" fn __schwung_destroy(inst: *mut core::ffi::c_void) {
            if inst.is_null() {
                return;
            }
            drop(alloc::boxed::Box::from_raw(inst.cast::<$ty>()));
        }

        unsafe extern "C" fn __schwung_on_midi(
            inst: *mut core::ffi::c_void,
            msg: *const u8,
            len: core::ffi::c_int,
            source: core::ffi::c_int,
        ) {
            let Some(p) = inst.cast::<$ty>().as_mut() else { return };
            let Some(m) = $crate::rt::bytes(msg, len) else { return };
            <$ty as $crate::SchwungPlugin>::on_midi(p, m, source as i32);
        }

        unsafe extern "C" fn __schwung_set_param(
            inst: *mut core::ffi::c_void,
            key: *const core::ffi::c_char,
            val: *const core::ffi::c_char,
        ) {
            let Some(p) = inst.cast::<$ty>().as_mut() else { return };
            let Some(k) = $crate::rt::cstr(key) else { return };
            <$ty as $crate::SchwungPlugin>::set_param(p, k, $crate::rt::cstr(val));
        }

        unsafe extern "C" fn __schwung_get_param(
            inst: *mut core::ffi::c_void,
            key: *const core::ffi::c_char,
            buf: *mut core::ffi::c_char,
            buf_len: core::ffi::c_int,
        ) -> core::ffi::c_int {
            let Some(p) = inst.cast::<$ty>().as_mut() else { return 0 };
            let Some(k) = $crate::rt::cstr(key) else { return 0 };
            if buf.is_null() || buf_len <= 0 {
                return 0;
            }
            /* Reserve the last byte for the terminator: callers read this with
             * atoi and strcmp, so an unterminated buffer is a bug that shows
             * up as garbage rather than as a failure. */
            let cap = (buf_len as usize) - 1;
            let out = core::slice::from_raw_parts_mut(buf.cast::<u8>(), buf_len as usize);
            let Some(writable) = out.get_mut(..cap) else { return 0 };
            let n = <$ty as $crate::SchwungPlugin>::get_param(p, k, writable);
            let n = if n > cap { cap } else { n };
            if let Some(slot) = out.get_mut(n) {
                *slot = 0;
            }
            n as core::ffi::c_int
        }

        unsafe extern "C" fn __schwung_get_error(
            _inst: *mut core::ffi::c_void,
            _buf: *mut core::ffi::c_char,
            _buf_len: core::ffi::c_int,
        ) -> core::ffi::c_int {
            0
        }

        unsafe extern "C" fn __schwung_render(
            inst: *mut core::ffi::c_void,
            out: *mut i16,
            frames: core::ffi::c_int,
        ) {
            let Some(p) = inst.cast::<$ty>().as_mut() else { return };
            let Some(buf) = $crate::rt::samples(out, frames) else { return };
            <$ty as $crate::SchwungPlugin>::render(p, buf);
        }

        static __SCHWUNG_API: $crate::PluginApiV2 = $crate::PluginApiV2 {
            api_version: $crate::MOVE_PLUGIN_API_VERSION_2,
            create_instance: __schwung_create,
            destroy_instance: __schwung_destroy,
            on_midi: __schwung_on_midi,
            set_param: __schwung_set_param,
            get_param: __schwung_get_param,
            get_error: __schwung_get_error,
            render_block: __schwung_render,
        };

        #[no_mangle]
        pub extern "C" fn move_plugin_init_v2(
            host: *const $crate::HostApiV1,
        ) -> *const $crate::PluginApiV2 {
            $crate::__set_host(host);
            &__SCHWUNG_API
        }
    };
}
