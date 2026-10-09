// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*!
The page's mailbox: what lets Schwung's web manager show Piano Practice in a
browser while the Move plays it.

Schwung reaches a tool's page only through the tool's DSP parameters
(`docs/MODULES.md`, "Remote UI for overtake tools"). Everything the page shows
lives in `ui.js`, and `ui.js` cannot be read from outside — so this is a
mailbox between the two, and nothing more. It never looks inside what it holds:

  set_param("vm", json)     ui.js hands over the encoded view model — a flat
                            JSON object of JSON strings (src/view_model.mjs)
  get_param("state")        the manager reads it back, as the Tool tab's state
  get_param("rui_poll")     `rev:0:0:0`, the cheap digest the host polls; `rev`
                            moves whenever the state does
  set_param("stale", _)     ui.js says "the picture changed" without sending
                            it: rev moves, a page that is open pulls `state`,
                            and that pull is what tells ui.js to send the real one
  set_param("action", json) the page asks for something (src/actions.mjs)
  get_param("inbox")        ui.js collects what was asked: `w` or `-` (is a
                            page watching?), then each action on its own line

WATCHING IS READ OFF THE PULLS. A page is open when the manager has read
`state` recently; the shim's own `rui_poll` probes run whether anyone looks or
not, so they do not count. `ui.js` sends the full view model only while
watched, and a tiny `stale` otherwise, so a closed page costs the Move almost
nothing.

EVERYTHING HERE RUNS IN THE AUDIO CALLBACK: no allocation after `new`, no
panics, bounded copies. The one allocation is the state buffer, made once when
the instance is created.
*/

use crate::{write_bytes as write, write_u32};
use alloc::boxed::Box;
use alloc::vec;

/// The largest state the host's param channel can carry (SHADOW_PARAM_VALUE_LEN,
/// less its terminator). A larger one is refused whole: half a JSON object is
/// not a smaller picture, it is no picture.
pub const STATE_CAP: usize = 131_071;
/// A page action. The web manager sends values under 256 bytes through its
/// lossless ring, and every action src/actions.mjs makes is well under that.
pub const ACTION_CAP: usize = 255;
/// Actions waiting for ui.js. It drains them several times a second while a
/// page is open; this many is a person clicking faster than that.
pub const INBOX_LEN: usize = 32;
/// How long after the last `state` read a page still counts as open: three
/// seconds of 128-frame blocks at 44.1kHz.
pub const WATCH_BLOCKS: u32 = 3 * 44_100 / 128;

pub struct Remote {
    state: Box<[u8]>,
    state_len: usize,
    rev: u32,
    inbox: [[u8; ACTION_CAP]; INBOX_LEN],
    lens: [u8; INBOX_LEN],
    head: usize,
    queued: usize,
    since_read: u32,
}

impl Remote {
    pub fn new() -> Remote {
        Remote {
            state: vec![0u8; STATE_CAP].into_boxed_slice(),
            state_len: 0,
            rev: 0,
            inbox: [[0; ACTION_CAP]; INBOX_LEN],
            lens: [0; INBOX_LEN],
            head: 0,
            queued: 0,
            since_read: u32::MAX,
        }
    }

    /// ui.js's view model. Refused (false) when it cannot fit whole.
    pub fn set_state(&mut self, v: &[u8]) -> bool {
        let Some(dst) = self.state.get_mut(..v.len()) else {
            return false;
        };
        dst.copy_from_slice(v);
        self.state_len = v.len();
        self.rev = self.rev.wrapping_add(1);
        true
    }

    /// The picture changed and has not been sent: move rev so a page pulls.
    pub fn touch(&mut self) {
        self.rev = self.rev.wrapping_add(1);
    }

    /// A page action, queued for ui.js. Too long, or the queue full: refused
    /// whole, never truncated (a cut-off JSON object is not an action).
    pub fn push_action(&mut self, v: &[u8]) -> bool {
        if v.is_empty() || v.len() > ACTION_CAP || self.queued >= INBOX_LEN {
            return false;
        }
        let at = (self.head + self.queued) % INBOX_LEN;
        let (Some(slot), Some(len)) = (self.inbox.get_mut(at), self.lens.get_mut(at)) else {
            return false;
        };
        if let Some(dst) = slot.get_mut(..v.len()) {
            dst.copy_from_slice(v);
        }
        *len = v.len() as u8;
        self.queued += 1;
        true
    }

    /// The manager's pull. Marks the page as watching. Nothing yet sent reads
    /// as an empty object; a state too large for `out` writes nothing.
    pub fn read_state(&mut self, out: &mut [u8]) -> usize {
        self.since_read = 0;
        if self.state_len == 0 {
            return write(out, b"{}");
        }
        match self.state.get(..self.state_len) {
            Some(s) if s.len() <= out.len() => write(out, s),
            _ => 0,
        }
    }

    /// `rev:on:tick:bpm`. The transport fields are Move's, which a tool does
    /// not drive; they stay 0 so the stopped digest is byte-stable.
    pub fn poll(&self, out: &mut [u8]) -> usize {
        let mut n = write_u32(out, self.rev);
        n += out.get_mut(n..).map_or(0, |o| write(o, b":0:0:0"));
        n
    }

    /// What ui.js collects: `w` while a page is open, else `-`, then one action
    /// per line, as many whole ones as `out` holds; the rest wait their turn.
    pub fn drain_inbox(&mut self, out: &mut [u8]) -> usize {
        let mut n = write(out, if self.watched() { b"w" } else { b"-" });
        while self.queued > 0 {
            let len = self.lens.get(self.head).copied().unwrap_or(0) as usize;
            if n + 1 + len > out.len() {
                break;
            }
            n += out.get_mut(n..).map_or(0, |o| write(o, b"\n"));
            if let Some(action) = self.inbox.get(self.head).and_then(|a| a.get(..len)) {
                n += out.get_mut(n..).map_or(0, |o| write(o, action));
            }
            self.head = (self.head + 1) % INBOX_LEN;
            self.queued -= 1;
        }
        n
    }

    /// Called once per audio block.
    pub fn tick(&mut self) {
        self.since_read = self.since_read.saturating_add(1);
    }

    pub fn watched(&self) -> bool {
        self.since_read < WATCH_BLOCKS
    }
}

impl Default for Remote {
    fn default() -> Self {
        Remote::new()
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::indexing_slicing)]
mod tests {
    use super::*;

    fn read(f: impl FnOnce(&mut [u8]) -> usize, cap: usize) -> alloc::string::String {
        let mut buf = vec![0u8; cap];
        let n = f(&mut buf);
        alloc::string::String::from_utf8(buf[..n].to_vec()).unwrap()
    }

    #[test]
    fn nothing_sent_reads_as_an_empty_object_at_rev_zero() {
        let mut r = Remote::new();
        assert_eq!(read(|o| r.poll(o), 64), "0:0:0:0");
        assert_eq!(read(|o| r.read_state(o), 64), "{}");
    }

    #[test]
    fn a_state_reads_back_whole_and_moves_rev() {
        let mut r = Remote::new();
        assert!(r.set_state(br#"{"screen":"\"menu\""}"#));
        assert_eq!(read(|o| r.poll(o), 64), "1:0:0:0");
        assert_eq!(read(|o| r.read_state(o), 64), r#"{"screen":"\"menu\""}"#);
        r.touch();
        assert_eq!(read(|o| r.poll(o), 64), "2:0:0:0");
    }

    #[test]
    fn a_state_too_large_is_refused_and_one_too_large_to_read_writes_nothing() {
        let mut r = Remote::new();
        assert!(!r.set_state(&vec![b'x'; STATE_CAP + 1]));
        assert_eq!(read(|o| r.poll(o), 64), "0:0:0:0");
        assert!(r.set_state(&[b'x'; 100]));
        assert_eq!(read(|o| r.read_state(o), 50), "");
        assert!(r.set_state(&vec![b'x'; STATE_CAP]));
        assert_eq!(read(|o| r.read_state(o), STATE_CAP).len(), STATE_CAP);
    }

    #[test]
    fn a_page_is_watching_only_after_a_state_pull_and_for_three_seconds() {
        let mut r = Remote::new();
        assert!(!r.watched());
        assert_eq!(read(|o| r.drain_inbox(o), 8), "-");
        let _ = read(|o| r.read_state(o), 8);
        assert!(r.watched());
        assert_eq!(read(|o| r.drain_inbox(o), 8), "w");
        for _ in 0..WATCH_BLOCKS {
            r.tick();
        }
        assert!(!r.watched());
        /* The digest the shim polls does not count as a page looking. */
        let _ = read(|o| r.poll(o), 16);
        assert!(!r.watched());
    }

    #[test]
    fn actions_drain_in_order_whole_and_wait_when_they_do_not_fit() {
        let mut r = Remote::new();
        assert!(r.push_action(br#"{"type":"open"}"#));
        assert!(r.push_action(br#"{"type":"back"}"#));
        /* Room for the flag and the first only. */
        assert_eq!(read(|o| r.drain_inbox(o), 20), "-\n{\"type\":\"open\"}");
        assert_eq!(read(|o| r.drain_inbox(o), 64), "-\n{\"type\":\"back\"}");
        assert_eq!(read(|o| r.drain_inbox(o), 64), "-");
    }

    #[test]
    fn a_bad_action_is_refused_whole_never_cut() {
        let mut r = Remote::new();
        assert!(!r.push_action(b""));
        assert!(!r.push_action(&vec![b'x'; ACTION_CAP + 1]));
        for _ in 0..INBOX_LEN {
            assert!(r.push_action(b"{}"));
        }
        assert!(!r.push_action(b"{}"), "full");
        let all = read(|o| r.drain_inbox(o), 4096);
        assert_eq!(all.matches("{}").count(), INBOX_LEN);
        /* The ring wraps: after draining it takes INBOX_LEN more. */
        for _ in 0..INBOX_LEN {
            assert!(r.push_action(b"{}"));
        }
    }
}
