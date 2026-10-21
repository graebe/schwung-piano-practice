// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * Manifest + SFZ in, NISP out.
 *
 * A pack is cut from an SFZ instrument at its default controller state:
 *
 *   1. Every active region becomes part of a CELL: one key range, one
 *      velocity range, one round robin position. Regions that share a cell
 *      are the same strike heard through different microphones, so they are
 *      mixed — each at the gain the instrument gives it — into one mono take.
 *   2. The manifest thins the cells: which velocity layers to keep (the kept
 *      ones are stretched to cover 1..127 between them) and how many round
 *      robins. A `piece` list keeps only the keys it names and moves them.
 *   3. Each take starts at its first audible frame (less a short pre-roll)
 *      and ends where it has died away or at the manifest's cap for its key,
 *      with a fade.
 *   4. One scale for the whole pack puts the loudest take at -headroom dBFS,
 *      so every layer keeps its loudness relative to the others.
 */
use crate::audio::{self, Mono};
use crate::sfz::{self, Instrument, Region};
use ni_sampler::{Pack, PackWriter, Zone, FLAG_ONE_SHOT};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    /// The SFZ file, relative to the source directory ...
    pub sfz: Option<String>,
    /// ... or the samples themselves, for an instrument too small to have
    /// one: each a file in the source directory played on one key.
    #[serde(default)]
    pub sample: Vec<PlainSample>,
    #[serde(default = "default_rate")]
    pub rate: u32,
    /// The pack may not exceed this many MB (10^6 bytes).
    pub budget_mb: f64,
    #[serde(default = "default_headroom")]
    pub headroom_db: f32,
    /// Which velocity layers to keep, 1-based from the softest. All if absent.
    pub velocity_layers: Option<Vec<usize>>,
    /// Keep round robin positions 1..=n. All if absent.
    pub round_robins: Option<u8>,
    /// A take starts at its first frame above its peak + start_db ...
    #[serde(default = "default_start_db")]
    pub start_db: f32,
    /// ... less this much.
    #[serde(default = "default_preroll")]
    pub preroll_ms: f32,
    /// A take ends after its last frame above its peak + silence_db ...
    #[serde(default = "default_silence_db")]
    pub silence_db: f32,
    /// ... or below the pack's loudest take + floor_db, whichever is
    /// sooner: a soft note is over once it is inaudible in the whole mix ...
    #[serde(default = "default_floor_db")]
    pub floor_db: f32,
    /// ... or at the cap for its root key, `[key, seconds]` points
    /// interpolated, whichever is sooner; then fades over fade_ms.
    pub max_seconds: Vec<(u8, f32)>,
    #[serde(default = "default_fade")]
    pub fade_ms: f32,
    /// Drums: note-off does not stop a hit.
    #[serde(default)]
    pub one_shot: bool,
    /// Override the instrument's release (ampeg_release) and off_time.
    pub release_ms: Option<u16>,
    pub off_ms: Option<u16>,
    /// Only these keys, moved. Every key, as it is, if absent.
    #[serde(default)]
    pub piece: Vec<Piece>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlainSample {
    pub file: String,
    pub key: u8,
    #[serde(default)]
    pub volume_db: f32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Piece {
    pub name: String,
    pub from: u8,
    pub to: u8,
    #[serde(default)]
    pub group: u8,
    #[serde(default)]
    pub off_by: u8,
    /// Added to every region of this piece, dB: the instrument's balance
    /// between pieces where the module needs another.
    #[serde(default)]
    pub trim_db: f32,
}

fn default_rate() -> u32 {
    44100
}
fn default_headroom() -> f32 {
    1.0
}
fn default_start_db() -> f32 {
    -50.0
}
fn default_preroll() -> f32 {
    1.0
}
fn default_silence_db() -> f32 {
    -60.0
}
fn default_floor_db() -> f32 {
    -72.0
}
fn default_fade() -> f32 {
    100.0
}

impl Manifest {
    pub fn parse(text: &str) -> Result<Self, String> {
        let m: Manifest = toml::from_str(text).map_err(|e| e.to_string())?;
        if m.sfz.is_some() == !m.sample.is_empty() {
            return Err("name either an sfz or [[sample]]s, not both or neither".into());
        }
        if m.max_seconds.is_empty() {
            return Err("max_seconds needs at least one [key, seconds] point".into());
        }
        if m.velocity_layers.as_ref().is_some_and(|l| l.is_empty() || l.contains(&0)) {
            return Err("velocity_layers are 1-based and must name at least one".into());
        }
        Ok(m)
    }

    /// The tail cap for `key`, interpolated between the points given.
    pub fn cap_seconds(&self, key: u8) -> f32 {
        let mut pts = self.max_seconds.clone();
        pts.sort_by_key(|(k, _)| *k);
        let (first, last) = (pts[0], pts[pts.len() - 1]);
        if key <= first.0 {
            return first.1;
        }
        if key >= last.0 {
            return last.1;
        }
        for w in pts.windows(2) {
            let [(k0, s0), (k1, s1)] = [w[0], w[1]];
            if (k0..=k1).contains(&key) {
                return s0 + (s1 - s0) * (key - k0) as f32 / (k1 - k0).max(1) as f32;
            }
        }
        last.1
    }
}

/// One strike: what plays it and where it sits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct CellKey {
    lokey: u8,
    hikey: u8,
    root: u8,
    lovel: u8,
    hivel: u8,
    seq: u8,
}

struct Source {
    path: PathBuf,
    gain: f32,
    offset: usize,
    end: Option<usize>,
}

struct Cell {
    /// The piece's name, for the report.
    name: String,
    key: CellKey,
    seq_len: u8,
    zone: Zone,
    sources: Vec<Source>,
}

#[derive(Debug)]
pub struct Report {
    pub zones: usize,
    pub bytes: usize,
    pub seconds: f64,
    pub scale_db: f32,
    pub lines: Vec<String>,
}

/// The budget, checked: a pack over it is an error that still has a report.
pub fn over_budget(manifest: &Manifest, report: &Report) -> Option<String> {
    (report.bytes as f64 > manifest.budget_mb * 1e6)
        .then(|| format!("{:.1} MB is over the {} MB budget", report.bytes as f64 / 1e6, manifest.budget_mb))
}

pub fn build(manifest: &Manifest, source_dir: &Path) -> Result<(Vec<u8>, Report), String> {
    let inst = match &manifest.sfz {
        Some(f) => sfz::load(&source_dir.join(f))?,
        None => sfz::from_samples(source_dir, manifest.sample.iter().map(|s| (s.file.as_str(), s.key, s.volume_db))),
    };
    let cells = plan(manifest, &inst)?;
    if cells.is_empty() {
        return Err("no region of the instrument survived the manifest".into());
    }

    let mixes = render_all(manifest, &cells)?;
    let loudest = mixes.iter().map(|t| audio::peak(t)).fold(0.0f32, f32::max);
    if loudest <= 0.0 {
        return Err("every take is silent".into());
    }
    let scale = audio::db(-manifest.headroom_db) / loudest;
    let floor = loudest * audio::db(manifest.floor_db);
    let takes: Vec<Vec<f32>> = cells.iter().zip(mixes).map(|(c, mix)| finish(manifest, c, mix, floor)).collect();

    let mut w = PackWriter::new(manifest.rate);
    let mut lines = Vec::new();
    for (cell, take) in cells.iter().zip(&takes) {
        let scaled: Vec<f32> = take.iter().map(|s| s * scale).collect();
        w.push(cell.zone, &audio::to_i16(&scaled)).map_err(|e| format!("{:?}: {e:?}", cell.key))?;
        lines.push(format!(
            "{:<8} key {:>3}-{:<3} root {:>3} vel {:>3}-{:<3} rr {}/{}  {:>6.2} s  peak {:>6.1} dBFS  mics {}",
            cell.name,
            cell.key.lokey,
            cell.key.hikey,
            cell.key.root,
            cell.zone.lovel,
            cell.zone.hivel,
            cell.key.seq,
            cell.seq_len,
            take.len() as f32 / manifest.rate as f32,
            20.0 * (audio::peak(&scaled)).max(1e-9).log10(),
            cell.sources.len(),
        ));
    }
    let bytes = w.to_bytes();
    Pack::validate(&bytes).map_err(|e| format!("the pack written does not read back: {e:?}"))?;
    let report = Report {
        zones: cells.len(),
        bytes: bytes.len(),
        seconds: w.data_frames() as f64 / manifest.rate as f64,
        scale_db: 20.0 * scale.log10(),
        lines,
    };
    Ok((bytes, report))
}

/// The cells to build, with their zones decided and their velocity ranges
/// re-spanned over the layers kept.
fn plan(m: &Manifest, inst: &Instrument) -> Result<Vec<Cell>, String> {
    let mut cells: BTreeMap<CellKey, Cell> = BTreeMap::new();
    for r in inst.regions.iter().filter(|r| inst.active(r)) {
        let piece = if m.piece.is_empty() {
            None
        } else {
            match m.piece.iter().find(|p| r.lokey() <= p.from && p.from <= r.hikey()) {
                Some(p) => Some(p),
                None => continue,
            }
        };
        let seq = r.seq_position();
        if m.round_robins.is_some_and(|n| seq > n) {
            continue;
        }
        let (lokey, hikey, root) = match piece {
            Some(p) => (p.to, p.to, p.to),
            None => (r.lokey(), r.hikey(), r.root()),
        };
        let key = CellKey { lokey, hikey, root, lovel: r.lovel(), hivel: r.hivel(), seq };
        let path = inst.sample_path(r).ok_or_else(|| format!("a region without a sample: {:?}", r.opcodes))?;
        let trim = piece.map_or(1.0, |p| audio::db(p.trim_db));
        let source = Source {
            path,
            gain: inst.gain(r) * trim,
            offset: r.f32("offset").map_or(0, |v| v.max(0.0) as usize),
            end: r.f32("end").map(|v| v.max(0.0) as usize + 1),
        };
        let cell = cells.entry(key).or_insert_with(|| Cell { name: piece.map_or(String::new(), |p| p.name.clone()), key, seq_len: 1, zone: zone_for(m, inst, r, piece, key), sources: Vec::new() });
        cell.sources.push(source);
    }

    /* Round robins: the cell's length is how many of its positions survived. */
    let mut positions: BTreeMap<(u8, u8, u8, u8), u8> = BTreeMap::new();
    for k in cells.keys() {
        let n = positions.entry((k.lokey, k.hikey, k.lovel, k.hivel)).or_default();
        *n = (*n).max(k.seq);
    }

    /* Velocity layers, per key range, softest first. */
    let mut layers: BTreeMap<(u8, u8), Vec<(u8, u8)>> = BTreeMap::new();
    for k in cells.keys() {
        let l = layers.entry((k.lokey, k.hikey)).or_default();
        if !l.contains(&(k.lovel, k.hivel)) {
            l.push((k.lovel, k.hivel));
        }
    }
    let mut spans: BTreeMap<(u8, u8, u8, u8), (u8, u8)> = BTreeMap::new();
    for ((lokey, hikey), mut l) in layers {
        l.sort();
        let kept: Vec<(u8, u8)> = match &m.velocity_layers {
            Some(want) => want.iter().filter_map(|i| l.get(i - 1).copied()).collect(),
            None => l.clone(),
        };
        let mut lo = 1u8;
        for (i, (v0, v1)) in kept.iter().enumerate() {
            let hi = if i + 1 == kept.len() { 127 } else { *v1 };
            spans.insert((lokey, hikey, *v0, *v1), (lo, hi));
            lo = hi.saturating_add(1);
        }
    }

    let mut out = Vec::new();
    for (k, mut cell) in cells {
        let Some(&(lovel, hivel)) = spans.get(&(k.lokey, k.hikey, k.lovel, k.hivel)) else { continue };
        cell.seq_len = positions.get(&(k.lokey, k.hikey, k.lovel, k.hivel)).copied().unwrap_or(1);
        cell.zone.lovel = lovel;
        cell.zone.hivel = hivel;
        cell.zone.seq = k.seq;
        cell.zone.seq_len = cell.seq_len;
        if k.seq > cell.seq_len {
            return Err(format!("{k:?}: round robin position past its cell's length"));
        }
        out.push(cell);
    }
    Ok(out)
}

fn zone_for(m: &Manifest, inst: &Instrument, r: &Region, piece: Option<&Piece>, k: CellKey) -> Zone {
    let ms = |s: f32| (s * 1000.0).round().clamp(0.0, u16::MAX as f32) as u16;
    let tune = inst.modulated(r, "tune", 0.0) + 100.0 * inst.modulated(r, "transpose", 0.0);
    Zone {
        lokey: k.lokey,
        hikey: k.hikey,
        root: k.root,
        lovel: k.lovel,
        hivel: k.hivel,
        seq: k.seq,
        seq_len: 1,
        group: piece.map_or(0, |p| p.group),
        off_by: piece.map_or(0, |p| p.off_by),
        flags: if m.one_shot { FLAG_ONE_SHOT } else { 0 },
        tune: tune.round().clamp(i16::MIN as f32, i16::MAX as f32) as i16,
        gain: 1.0,
        offset: 0,
        len: 0,
        release_ms: m.release_ms.unwrap_or_else(|| ms(inst.modulated(r, "ampeg_release", 0.001))),
        veltrack: inst.modulated(r, "amp_veltrack", 100.0).round().clamp(0.0, 100.0) as u8,
        off_ms: m.off_ms.unwrap_or_else(|| r.f32("off_time").map_or(6, ms)),
    }
}

/// Every cell's take, on as many threads as there are cores.
fn render_all(m: &Manifest, cells: &[Cell]) -> Result<Vec<Vec<f32>>, String> {
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    let chunk = cells.len().div_ceil(threads).max(1);
    std::thread::scope(|s| {
        let handles: Vec<_> = cells
            .chunks(chunk)
            .map(|part| s.spawn(move || part.iter().map(|c| render(m, c)).collect::<Result<Vec<_>, String>>()))
            .collect();
        let mut out = Vec::with_capacity(cells.len());
        for h in handles {
            out.extend(h.join().map_err(|_| "a render thread panicked".to_string())??);
        }
        Ok(out)
    })
}

/// One cell's sources mixed, from the first audible frame, unscaled.
fn render(m: &Manifest, cell: &Cell) -> Result<Vec<f32>, String> {
    let mut mix: Vec<f32> = Vec::new();
    for src in &cell.sources {
        let raw = audio::decode(&src.path)?;
        let end = src.end.unwrap_or(raw.frames.len()).min(raw.frames.len());
        let cut = raw.frames.get(src.offset.min(end)..end).unwrap_or_default().to_vec();
        let Mono { frames, .. } = audio::resample(Mono { rate: raw.rate, frames: cut }, m.rate)?;
        if mix.len() < frames.len() {
            mix.resize(frames.len(), 0.0);
        }
        for (a, b) in mix.iter_mut().zip(&frames) {
            *a += b * src.gain;
        }
    }
    let peak = audio::peak(&mix);
    if peak <= 0.0 {
        return Err(format!("{}: silent", cell.sources.first().map_or(String::new(), |s| s.path.display().to_string())));
    }
    let from = audio::start(&mix, peak * audio::db(m.start_db), (m.preroll_ms * 0.001 * m.rate as f32) as usize);
    mix.drain(..from);
    Ok(mix)
}

/// A mix cut where it dies away — below its own peak + silence_db or the
/// pack's `floor`, whichever comes first — or at its key's cap, and faded.
fn finish(m: &Manifest, cell: &Cell, mix: Vec<f32>, floor: f32) -> Vec<f32> {
    let rate = m.rate as f32;
    let died = audio::end(&mix, (audio::peak(&mix) * audio::db(m.silence_db)).max(floor));
    let cap = (m.cap_seconds(cell.key.root) * rate) as usize;
    let mut take = mix;
    take.truncate(died.min(cap).max(1));
    audio::fade_out(&mut take, (m.fade_ms * 0.001 * rate) as usize);
    take
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_wav(path: &Path, rate: u32, frames: &[f32]) {
        let spec = hound::WavSpec { channels: 1, sample_rate: rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for s in frames {
            w.write_sample(*s).unwrap();
        }
        w.finalize().unwrap();
    }

    /// A drum-like instrument: two mics per strike, two velocity layers,
    /// three round robins, a keyswitched region that must not sound.
    fn fixture(dir: &Path) {
        fs::create_dir_all(dir.join("S")).unwrap();
        let hit = |amp: f32| -> Vec<f32> {
            let mut f = vec![0.0; 100];
            f.extend((0..4410).map(|i| amp * (1.0 - i as f32 / 4410.0)));
            f.extend(vec![0.0; 2000]);
            f
        };
        for (vel, amp) in [("soft", 0.2f32), ("loud", 0.8)] {
            for rr in 1..=3 {
                write_wav(&dir.join(format!("S/close_{vel}_{rr}.wav")), 44100, &hit(amp));
                write_wav(&dir.join(format!("S/room_{vel}_{rr}.wav")), 44100, &hit(amp / 2.0));
            }
        }
        let mut sfz = String::from("<control> default_path=S/ set_cc7=127\n<global> amp_veltrack=50 off_time=0.01 sw_default=c0\n");
        for mic in ["close", "room"] {
            let vol = if mic == "room" { "volume=-6.0206" } else { "" };
            sfz.push_str(&format!("<group> key=38 seq_length=3 {vol}\n"));
            for (vel, lo, hi) in [("soft", 1, 64), ("loud", 65, 127)] {
                for rr in 1..=3 {
                    sfz.push_str(&format!("<region> lovel={lo} hivel={hi} seq_position={rr} sample={mic}_{vel}_{rr}.wav\n"));
                }
            }
        }
        sfz.push_str("<group> key=40 sw_last=c#0 <region> sample=close_loud_1.wav\n");
        fs::write(dir.join("kit.sfz"), sfz).unwrap();
    }

    fn manifest(extra: &str) -> Manifest {
        Manifest::parse(&format!("sfz = \"kit.sfz\"\nbudget_mb = 1\nmax_seconds = [[0, 10.0]]\nfade_ms = 1\n{extra}")).unwrap()
    }

    #[test]
    fn a_kit_becomes_a_pack_with_mics_mixed_and_levels_kept() {
        let dir = std::env::temp_dir().join(format!("nisp-build-{}", std::process::id()));
        fixture(&dir);
        let m = manifest("one_shot = true\nround_robins = 2\n[[piece]]\nname = \"snare\"\nfrom = 38\nto = 38\ngroup = 3\noff_by = 4\n");
        let (bytes, report) = build(&m, &dir).unwrap();
        let p = Pack::validate(&bytes).unwrap();
        assert_eq!(report.zones, 4, "2 layers x 2 of 3 round robins; the keyswitched region is out");
        let zones: Vec<Zone> = (0..p.zone_count()).map(|i| p.zone(i).unwrap()).collect();
        for z in &zones {
            assert_eq!((z.lokey, z.root, z.seq_len, z.group, z.off_by, z.veltrack, z.off_ms), (38, 38, 2, 3, 4, 50, 10));
            assert!(z.one_shot());
        }
        let peak_of = |z: &Zone| (z.offset..z.offset + z.len).map(|i| p.frame(i).abs()).fold(0.0, f32::max);
        let (soft, loud) = (peak_of(&zones[0]), peak_of(&zones[2]));
        assert!((loud - audio::db(-1.0)).abs() < 0.001, "the loudest take sits at -1 dBFS: {loud}");
        assert!((loud / soft - 4.0).abs() < 0.01, "and the layers keep their ratio: {}", loud / soft);
        assert_eq!((zones[0].lovel, zones[0].hivel, zones[2].lovel, zones[2].hivel), (1, 64, 65, 127));
        let z = &zones[0];
        assert!(z.len < 4410 + 100, "the lead-in and the silent tail are trimmed: {}", z.len);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn kept_velocity_layers_stretch_to_cover_every_velocity() {
        let dir = std::env::temp_dir().join(format!("nisp-build-layers-{}", std::process::id()));
        fixture(&dir);
        let m = manifest("velocity_layers = [2]\nround_robins = 1\n");
        let (bytes, report) = build(&m, &dir).unwrap();
        let p = Pack::new(&bytes).unwrap();
        assert_eq!(report.zones, 1);
        let z = p.zone(0).unwrap();
        assert_eq!((z.lovel, z.hivel, z.seq, z.seq_len), (1, 127, 1, 1));
        assert!(!z.one_shot());
        let tiny = Manifest { budget_mb: 0.0001, ..manifest("") };
        let (_, report) = build(&tiny, &dir).unwrap();
        assert!(over_budget(&tiny, &report).unwrap().contains("budget"));
        assert!(over_budget(&manifest(""), &report).is_none());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn plain_samples_need_no_sfz() {
        let dir = std::env::temp_dir().join(format!("nisp-build-plain-{}", std::process::id()));
        fixture(&dir);
        let m = Manifest::parse(
            "budget_mb = 1\nmax_seconds = [[0, 1.0]]\none_shot = true\n\
             [[sample]]\nfile = \"S/close_loud_1.wav\"\nkey = 1\n\
             [[sample]]\nfile = \"S/close_soft_1.wav\"\nkey = 0\nvolume_db = 6\n",
        )
        .unwrap();
        let (bytes, report) = build(&m, &dir).unwrap();
        fs::remove_dir_all(&dir).unwrap();
        assert_eq!(report.zones, 2);
        let p = Pack::new(&bytes).unwrap();
        let (a, b) = (p.zone(0).unwrap(), p.zone(1).unwrap());
        assert_eq!((a.lokey, a.root, b.lokey), (0, 0, 1), "ordered by key");
        assert_eq!((a.veltrack, a.lovel, a.hivel), (100, 1, 127));
        let peak_of = |z: &Zone| (z.offset..z.offset + z.len).map(|i| p.frame(i).abs()).fold(0.0, f32::max);
        assert!((peak_of(&b) / peak_of(&a) - 2.0).abs() < 0.01, "0.8 against 0.2 raised 6 dB");
    }

    #[test]
    fn a_manifest_says_what_is_wrong_with_it() {
        assert!(Manifest::parse("budget_mb = 1\nmax_seconds = [[0, 1.0]]").unwrap_err().contains("either"));
        assert!(Manifest::parse("sfz = \"a\"\nbudget_mb = 1\nmax_seconds = []").unwrap_err().contains("max_seconds"));
        assert!(Manifest::parse("sfz = \"a\"\nbudget_mb = 1\nmax_seconds = [[0, 1.0]]\nvelocity_layers = [0]").is_err());
        assert!(Manifest::parse("sfz = \"a\"\nbudget_mb = 1\nmax_seconds = [[0, 1.0]]\nbogus = 1").is_err());
    }

    #[test]
    fn the_cap_interpolates_between_its_points() {
        let m = Manifest::parse("sfz = \"a\"\nbudget_mb = 1\nmax_seconds = [[60, 8.0], [21, 12.0], [108, 2.0]]").unwrap();
        assert_eq!(m.cap_seconds(0), 12.0);
        assert_eq!(m.cap_seconds(21), 12.0);
        assert!((m.cap_seconds(40) - 10.0513).abs() < 0.01);
        assert_eq!(m.cap_seconds(60), 8.0);
        assert_eq!(m.cap_seconds(127), 2.0);
    }
}
