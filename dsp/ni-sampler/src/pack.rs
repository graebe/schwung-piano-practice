// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * NISP v1 — the pack file. Little endian throughout.
 *
 *   header, 32 bytes
 *     0  magic        "NISP"
 *     4  version      u16  1
 *     6  header_len   u16  32
 *     8  rate         u32  the sample data's rate, Hz
 *    12  zone_count   u32
 *    16  zone_len     u16  32
 *    18  reserved     u16
 *    20  data_offset  u32  bytes from the start of the file
 *    24  data_frames  u32  mono i16 frames at data_offset
 *    28  reserved     u32
 *
 *   zone, 32 bytes each, zone_count of them from byte 32
 *     0  lokey  1 hikey  2 root  3 lovel  4 hivel        u8
 *     5  seq          u8   round robin position, 1-based
 *     6  seq_len      u8   how many positions the cell cycles through
 *     7  group        u8   choke group this zone belongs to, 0 none
 *     8  off_by       u8   a note in this group chokes the zone, 0 none
 *     9  flags        u8   FLAG_ONE_SHOT: note-off does not release it
 *    10  tune         i16  cents
 *    12  gain         f32  linear
 *    16  offset       u32  first frame in the data
 *    20  len          u32  frames
 *    24  release_ms   u16  fade on note-off
 *    26  veltrack     u8   percent, SFZ amp_veltrack
 *    27  reserved     u8
 *    28  off_ms       u16  fade when choked or retriggered
 *    30  reserved     u16
 *
 * Reading never trusts the file. `Pack::new` checks the header and that the
 * table and the data fit; each zone is checked again where it is used, so a
 * zone pointing outside the data plays silence instead of reading past it.
 * `Pack::validate` checks every zone at once, for load-time reporting.
 */

pub const MAGIC: [u8; 4] = *b"NISP";
pub const VERSION: u16 = 1;
pub const HEADER_LEN: usize = 32;
pub const ZONE_LEN: usize = 32;

/// Note-off does not release the zone: a drum hit rings to its own end.
pub const FLAG_ONE_SHOT: u8 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PackError {
    /// Shorter than a header, or the table or data run past the end.
    Truncated,
    BadMagic,
    UnsupportedVersion(u16),
    /// A header or zone length this reader was not written for.
    BadLayout,
    /// The rate is 0 or implausible.
    BadRate,
    /// Zone `n` breaks a rule (ranges, sequence, bounds, gain).
    BadZone(u32),
}

/// One zone, decoded. Copied into a voice when it starts, so the voice never
/// re-reads the table while it plays.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Zone {
    pub lokey: u8,
    pub hikey: u8,
    pub root: u8,
    pub lovel: u8,
    pub hivel: u8,
    pub seq: u8,
    pub seq_len: u8,
    pub group: u8,
    pub off_by: u8,
    pub flags: u8,
    pub tune: i16,
    pub gain: f32,
    pub offset: u32,
    pub len: u32,
    pub release_ms: u16,
    pub veltrack: u8,
    pub off_ms: u16,
}

impl Zone {
    pub fn matches(&self, key: u8, vel: u8) -> bool {
        (self.lokey..=self.hikey).contains(&key) && (self.lovel..=self.hivel).contains(&vel)
    }

    pub fn one_shot(&self) -> bool {
        self.flags & FLAG_ONE_SHOT != 0
    }

    fn decode(b: &[u8; ZONE_LEN]) -> Self {
        let [lokey, hikey, root, lovel, hivel, seq, seq_len, group, off_by, flags, t0, t1, g0, g1, g2, g3, o0, o1, o2, o3, l0, l1, l2, l3, r0, r1, veltrack, _, f0, f1, _, _] =
            *b;
        Zone {
            lokey,
            hikey,
            root,
            lovel,
            hivel,
            seq,
            seq_len,
            group,
            off_by,
            flags,
            tune: i16::from_le_bytes([t0, t1]),
            gain: f32::from_le_bytes([g0, g1, g2, g3]),
            offset: u32::from_le_bytes([o0, o1, o2, o3]),
            len: u32::from_le_bytes([l0, l1, l2, l3]),
            release_ms: u16::from_le_bytes([r0, r1]),
            veltrack,
            off_ms: u16::from_le_bytes([f0, f1]),
        }
    }

    #[cfg(any(test, feature = "std"))]
    fn encode(&self) -> [u8; ZONE_LEN] {
        let [t0, t1] = self.tune.to_le_bytes();
        let [g0, g1, g2, g3] = self.gain.to_le_bytes();
        let [o0, o1, o2, o3] = self.offset.to_le_bytes();
        let [l0, l1, l2, l3] = self.len.to_le_bytes();
        let [r0, r1] = self.release_ms.to_le_bytes();
        let [f0, f1] = self.off_ms.to_le_bytes();
        [
            self.lokey, self.hikey, self.root, self.lovel, self.hivel, self.seq, self.seq_len, self.group,
            self.off_by, self.flags, t0, t1, g0, g1, g2, g3, o0, o1, o2, o3, l0, l1, l2, l3, r0, r1,
            self.veltrack, 0, f0, f1, 0, 0,
        ]
    }

    /// The rules a zone must keep, `data_frames` being the pack's.
    fn check(&self, data_frames: u32) -> bool {
        self.lokey <= self.hikey
            && self.hikey <= 127
            && self.root <= 127
            && self.lovel <= self.hivel
            && self.hivel <= 127
            && self.seq >= 1
            && self.seq <= self.seq_len
            && self.veltrack <= 100
            && self.gain.is_finite()
            && self.gain >= 0.0
            && self.len > 0
            && self.offset.checked_add(self.len).is_some_and(|end| end <= data_frames)
    }
}

/// A borrowed view over the bytes of a NISP file. Cheap to make: `new` reads
/// the 32-byte header and nothing else, so a host may keep the bytes and make
/// a fresh view for every block.
#[derive(Clone, Copy, Debug)]
pub struct Pack<'a> {
    rate: u32,
    zones: &'a [u8],
    data: &'a [u8],
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    let s = b.get(at..at + 2)?;
    Some(u16::from_le_bytes([*s.first()?, *s.get(1)?]))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    let s = b.get(at..at + 4)?;
    Some(u32::from_le_bytes([*s.first()?, *s.get(1)?, *s.get(2)?, *s.get(3)?]))
}

impl<'a> Pack<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self, PackError> {
        let header = bytes.get(..HEADER_LEN).ok_or(PackError::Truncated)?;
        if header.get(..4) != Some(&MAGIC[..]) {
            return Err(PackError::BadMagic);
        }
        let field16 = |at| u16_at(header, at).ok_or(PackError::Truncated);
        let field32 = |at| u32_at(header, at).ok_or(PackError::Truncated);
        let version = field16(4)?;
        if version != VERSION {
            return Err(PackError::UnsupportedVersion(version));
        }
        if field16(6)? as usize != HEADER_LEN || field16(16)? as usize != ZONE_LEN {
            return Err(PackError::BadLayout);
        }
        let rate = field32(8)?;
        if !(8_000..=384_000).contains(&rate) {
            return Err(PackError::BadRate);
        }
        let zone_count = field32(12)? as usize;
        let data_offset = field32(20)? as usize;
        let data_frames = field32(24)? as usize;

        let table_end = zone_count
            .checked_mul(ZONE_LEN)
            .and_then(|n| n.checked_add(HEADER_LEN))
            .ok_or(PackError::Truncated)?;
        if data_offset < table_end {
            return Err(PackError::BadLayout);
        }
        let zones = bytes.get(HEADER_LEN..table_end).ok_or(PackError::Truncated)?;
        let data_end = data_frames
            .checked_mul(2)
            .and_then(|n| n.checked_add(data_offset))
            .ok_or(PackError::Truncated)?;
        let data = bytes.get(data_offset..data_end).ok_or(PackError::Truncated)?;
        Ok(Pack { rate, zones, data })
    }

    /// `new`, then every zone checked: what a loader calls once, so a broken
    /// file is reported where it is opened rather than heard as gaps.
    pub fn validate(bytes: &'a [u8]) -> Result<Self, PackError> {
        let pack = Self::new(bytes)?;
        for i in 0..pack.zone_count() {
            let ok = pack.zone(i).is_some_and(|z| z.check(pack.data_frames()));
            if !ok {
                return Err(PackError::BadZone(i as u32));
            }
        }
        Ok(pack)
    }

    pub fn rate(&self) -> u32 {
        self.rate
    }

    pub fn zone_count(&self) -> usize {
        self.zones.len() / ZONE_LEN
    }

    pub fn data_frames(&self) -> u32 {
        (self.data.len() / 2) as u32
    }

    /// Zone `i`, if it exists and keeps the rules.
    pub fn zone(&self, i: usize) -> Option<Zone> {
        let start = i.checked_mul(ZONE_LEN)?;
        let raw: &[u8; ZONE_LEN] = self.zones.get(start..start + ZONE_LEN)?.try_into().ok()?;
        let z = Zone::decode(raw);
        z.check(self.data_frames()).then_some(z)
    }

    /// Frame `i` of the data as -1..1, 0 outside it.
    #[inline]
    pub fn frame(&self, i: u32) -> f32 {
        let at = i as usize * 2;
        match self.data.get(at..at + 2) {
            Some(&[a, b]) => i16::from_le_bytes([a, b]) as f32 * (1.0 / 32768.0),
            _ => 0.0,
        }
    }
}

/// Builds a NISP file. nisp-build's half; never compiled for a runtime.
#[cfg(any(test, feature = "std"))]
#[derive(Default)]
pub struct PackWriter {
    rate: u32,
    zones: Vec<Zone>,
    data: Vec<i16>,
}

#[cfg(any(test, feature = "std"))]
impl PackWriter {
    pub fn new(rate: u32) -> Self {
        PackWriter { rate, ..Default::default() }
    }

    /// Append `frames` and a zone that plays them. `zone.offset` and
    /// `zone.len` are set here; the rest is the caller's.
    pub fn push(&mut self, mut zone: Zone, frames: &[i16]) -> Result<(), PackError> {
        let at = self.zones.len() as u32;
        zone.offset = u32::try_from(self.data.len()).map_err(|_| PackError::BadZone(at))?;
        zone.len = u32::try_from(frames.len()).map_err(|_| PackError::BadZone(at))?;
        let end = zone.offset.checked_add(zone.len).ok_or(PackError::BadZone(at))?;
        if !zone.check(end) {
            return Err(PackError::BadZone(at));
        }
        self.data.extend_from_slice(frames);
        self.zones.push(zone);
        Ok(())
    }

    pub fn zones(&self) -> &[Zone] {
        &self.zones
    }

    pub fn data_frames(&self) -> usize {
        self.data.len()
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let data_offset = HEADER_LEN + self.zones.len() * ZONE_LEN;
        let mut out = Vec::with_capacity(data_offset + self.data.len() * 2);
        out.extend_from_slice(&MAGIC);
        out.extend_from_slice(&VERSION.to_le_bytes());
        out.extend_from_slice(&(HEADER_LEN as u16).to_le_bytes());
        out.extend_from_slice(&self.rate.to_le_bytes());
        out.extend_from_slice(&(self.zones.len() as u32).to_le_bytes());
        out.extend_from_slice(&(ZONE_LEN as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&(data_offset as u32).to_le_bytes());
        out.extend_from_slice(&(self.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        for z in &self.zones {
            out.extend_from_slice(&z.encode());
        }
        for s in &self.data {
            out.extend_from_slice(&s.to_le_bytes());
        }
        out
    }
}

/* Tests may index and panic: a failed assertion is how they report. */
#[cfg(test)]
#[allow(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    pub(crate) fn zone(lokey: u8, hikey: u8, root: u8) -> Zone {
        Zone { lokey, hikey, root, lovel: 1, hivel: 127, seq: 1, seq_len: 1, gain: 1.0, veltrack: 0, ..Default::default() }
    }

    fn two_zone_pack() -> Vec<u8> {
        let mut w = PackWriter::new(44100);
        w.push(zone(0, 59, 48), &[1, 2, 3]).unwrap();
        let mut hi = zone(60, 127, 72);
        hi.tune = -7;
        hi.gain = 0.5;
        hi.release_ms = 300;
        hi.off_ms = 1000;
        hi.veltrack = 73;
        hi.flags = FLAG_ONE_SHOT;
        hi.group = 1;
        hi.off_by = 2;
        w.push(hi, &[i16::MIN, i16::MAX]).unwrap();
        w.to_bytes()
    }

    #[test]
    fn a_written_pack_reads_back_field_for_field() {
        let bytes = two_zone_pack();
        let p = Pack::validate(&bytes).unwrap();
        assert_eq!(p.rate(), 44100);
        assert_eq!(p.zone_count(), 2);
        assert_eq!(p.data_frames(), 5);
        let z = p.zone(1).unwrap();
        assert_eq!((z.lokey, z.hikey, z.root, z.offset, z.len), (60, 127, 72, 3, 2));
        assert_eq!((z.tune, z.gain, z.release_ms, z.off_ms, z.veltrack), (-7, 0.5, 300, 1000, 73));
        assert_eq!((z.group, z.off_by), (1, 2));
        assert!(z.one_shot());
        assert!(!p.zone(0).unwrap().one_shot());
        assert_eq!(p.frame(0), 1.0 / 32768.0);
        assert_eq!(p.frame(3), -1.0);
        assert_eq!(p.frame(5), 0.0, "past the end is silence");
        assert!(p.zone(2).is_none());
    }

    #[test]
    fn every_truncation_is_an_error_never_a_panic() {
        let bytes = two_zone_pack();
        for n in 0..bytes.len() {
            assert!(Pack::validate(&bytes[..n]).is_err(), "{n} bytes accepted");
        }
    }

    #[test]
    fn a_bad_header_names_what_is_wrong() {
        let good = two_zone_pack();
        let mut b = good.clone();
        b[0] = b'X';
        assert_eq!(Pack::new(&b).unwrap_err(), PackError::BadMagic);
        let mut b = good.clone();
        b[4] = 2;
        assert_eq!(Pack::new(&b).unwrap_err(), PackError::UnsupportedVersion(2));
        let mut b = good.clone();
        b[16] = 31;
        assert_eq!(Pack::new(&b).unwrap_err(), PackError::BadLayout);
        let mut b = good.clone();
        b[8..12].copy_from_slice(&0u32.to_le_bytes());
        assert_eq!(Pack::new(&b).unwrap_err(), PackError::BadRate);
        let mut b = good.clone();
        b[20..24].copy_from_slice(&40u32.to_le_bytes());
        assert_eq!(Pack::new(&b).unwrap_err(), PackError::BadLayout, "data overlaps the table");
        let mut b = good;
        b[12..16].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(Pack::new(&b).is_err());
    }

    #[test]
    fn a_zone_outside_the_data_is_refused_where_it_is_used() {
        let mut b = two_zone_pack();
        let len_at = HEADER_LEN + ZONE_LEN + 20;
        b[len_at..len_at + 4].copy_from_slice(&99u32.to_le_bytes());
        assert!(Pack::new(&b).is_ok(), "new reads only the header");
        assert_eq!(Pack::validate(&b).unwrap_err(), PackError::BadZone(1));
        assert!(Pack::new(&b).unwrap().zone(1).is_none());
        assert!(Pack::new(&b).unwrap().zone(0).is_some());
    }

    #[test]
    fn the_writer_refuses_a_zone_that_breaks_the_rules() {
        let mut w = PackWriter::new(48000);
        let mut z = zone(10, 5, 7);
        assert_eq!(w.push(z, &[0]), Err(PackError::BadZone(0)));
        z = zone(0, 127, 60);
        z.seq = 2;
        assert!(w.push(z, &[0]).is_err(), "seq beyond seq_len");
        z = zone(0, 127, 60);
        z.gain = f32::NAN;
        assert!(w.push(z, &[0]).is_err());
        assert!(w.push(zone(0, 127, 60), &[]).is_err(), "no frames");
        assert!(w.zones().is_empty());
        assert_eq!(w.data_frames(), 0);
    }

    #[test]
    fn zone_matching_is_inclusive_on_both_ends() {
        let mut z = zone(60, 62, 61);
        z.lovel = 10;
        z.hivel = 20;
        assert!(z.matches(60, 10) && z.matches(62, 20));
        assert!(!z.matches(59, 15) && !z.matches(63, 15));
        assert!(!z.matches(61, 9) && !z.matches(61, 21));
    }
}
