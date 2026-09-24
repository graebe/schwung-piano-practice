/*
 * The allocator, over libc.
 *
 * no_std has none of its own, and this crate needs exactly one allocation in
 * its life: the plugin instance, in create_instance. Everything after that —
 * every parameter write, every MIDI message, every rendered block — runs on
 * the SPI callback and must not allocate at all.
 */
use core::alloc::{GlobalAlloc, Layout};
use core::ffi::c_void;
use core::ptr;

/* no_std means rustc links no default libraries, so libc has to be asked for
 * by name — malloc and memcpy are not free-floating symbols. */
#[link(name = "c")]
extern "C" {
    fn posix_memalign(memptr: *mut *mut c_void, alignment: usize, size: usize) -> i32;
    fn calloc(nmemb: usize, size: usize) -> *mut c_void;
    fn free(ptr: *mut c_void);
}

/* calloc and plain malloc only promise max_align_t. Anything asking for more
 * has to go through posix_memalign, which is the reason this is not four
 * lines. */
const MAX_ALIGN: usize = 16;

pub struct LibcAlloc;

unsafe impl GlobalAlloc for LibcAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.size() == 0 {
            return layout.align() as *mut u8; /* dangling but aligned */
        }
        /* posix_memalign wants a power of two that is also a multiple of the
         * pointer size; Layout guarantees the first, this guarantees the second. */
        let align = if layout.align() < core::mem::size_of::<*mut c_void>() {
            core::mem::size_of::<*mut c_void>()
        } else {
            layout.align()
        };
        let mut out: *mut c_void = ptr::null_mut();
        if posix_memalign(&mut out, align, layout.size()) != 0 {
            return ptr::null_mut();
        }
        out.cast()
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        if layout.size() == 0 {
            return layout.align() as *mut u8;
        }
        if layout.align() <= MAX_ALIGN {
            return calloc(1, layout.size()).cast();
        }
        let p = self.alloc(layout);
        if !p.is_null() {
            ptr::write_bytes(p, 0, layout.size());
        }
        p
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        if layout.size() == 0 {
            return;
        }
        free(ptr.cast());
    }
}
