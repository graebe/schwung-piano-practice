// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * Reading a file the module ships, from `create` — and only from there, and
 * only in an overtake module, whose create_instance runs on Schwung's worker
 * thread (see the crate comment). Everywhere else it is blocking I/O on the
 * audio thread.
 *
 * libc rather than std, because the shipped cdylib is no_std. The unsafe is
 * here so a plugin crate's `create` stays safe code.
 */
use alloc::vec::Vec;
use core::ffi::{c_char, c_int, c_long, c_void};

/// No file a module ships is this large; anything that claims to be is not
/// one of ours.
pub const MAX_FILE: usize = 256 * 1024 * 1024;

#[link(name = "c")]
extern "C" {
    fn open(path: *const c_char, flags: c_int, ...) -> c_int;
    fn read(fd: c_int, buf: *mut c_void, count: usize) -> isize;
    fn close(fd: c_int) -> c_int;
    fn lseek(fd: c_int, offset: c_long, whence: c_int) -> c_long;
}

const O_RDONLY: c_int = 0;
const SEEK_SET: c_int = 0;
const SEEK_END: c_int = 2;

/// Closes the descriptor on every way out.
struct Fd(c_int);

impl Drop for Fd {
    fn drop(&mut self) {
        // SAFETY: the descriptor was opened by `read_file` and is closed once.
        unsafe { close(self.0) };
    }
}

/// `module_dir`/`rel`, whole, or `None` if it cannot be read completely or
/// is larger than MAX_FILE. A path holding a NUL byte is refused.
pub fn read_file(module_dir: &[u8], rel: &[u8]) -> Option<Vec<u8>> {
    if module_dir.contains(&0) || rel.contains(&0) {
        return None;
    }
    let mut path = Vec::with_capacity(module_dir.len() + rel.len() + 2);
    path.extend_from_slice(module_dir);
    path.push(b'/');
    path.extend_from_slice(rel);
    path.push(0);

    // SAFETY: `path` is NUL-terminated and outlives the call.
    let fd = unsafe { open(path.as_ptr().cast(), O_RDONLY) };
    if fd < 0 {
        return None;
    }
    let fd = Fd(fd);
    // SAFETY: plain syscalls on a descriptor we own.
    let size = unsafe { lseek(fd.0, 0, SEEK_END) };
    if size < 0 || size as u64 > MAX_FILE as u64 || unsafe { lseek(fd.0, 0, SEEK_SET) } != 0 {
        return None;
    }
    let size = size as usize;
    let mut buf: Vec<u8> = Vec::new();
    buf.try_reserve_exact(size).ok()?;
    buf.resize(size, 0);
    let mut got = 0usize;
    while got < size {
        let rest = buf.get_mut(got..)?;
        // SAFETY: `rest` is valid for `rest.len()` writable bytes.
        let n = unsafe { read(fd.0, rest.as_mut_ptr().cast(), rest.len()) };
        if n <= 0 {
            return None;
        }
        got += n as usize;
    }
    Some(buf)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::indexing_slicing)]
mod tests {
    extern crate std;
    use super::*;

    #[test]
    fn reads_a_whole_file_and_refuses_what_it_cannot() {
        let dir = std::env::temp_dir().join(std::format!("schwung-fs-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("samples")).unwrap();
        let data: Vec<u8> = (0..200_000u32).map(|i| i as u8).collect();
        std::fs::write(dir.join("samples/x.nisp"), &data).unwrap();
        std::fs::write(dir.join("empty"), b"").unwrap();
        let d = dir.to_str().unwrap().as_bytes();
        assert_eq!(read_file(d, b"samples/x.nisp").unwrap(), data);
        assert_eq!(read_file(d, b"empty").unwrap(), Vec::<u8>::new());
        assert!(read_file(d, b"missing").is_none());
        assert!(read_file(d, b"samples").is_none(), "a directory is not a file");
        assert!(read_file(d, b"x\0y").is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
