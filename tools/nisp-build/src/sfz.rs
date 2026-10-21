// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * SFZ, as far as nisp-build needs it: read an instrument the way an ARIA
 * player would on load, and hand back every region with the opcodes it
 * inherits.
 *
 *   preprocess  `#define $NAME value` and `#include "file"`, in file order,
 *               anywhere on a line (ARIA files put several on one). `$NAME`
 *               expands to the LONGEST name defined at that point, so
 *               `$MIC_$ART` is $MIC then `_` then $ART, and $VEL10 beats $VEL1.
 *               Includes resolve against the top-level file's directory, as
 *               ARIA's do.
 *   parse       `<header>` and `opcode=value`. A value runs to the next
 *               `name=`, `<` or line end, so a sample path may hold spaces.
 *   flatten     <control> → <global> → <master> → <group> → <region>, each
 *               level reset when its parent starts again. <curve>, <effect>
 *               and <midi> bodies are kept apart (curves are read; the others
 *               are not ours).
 *
 * Which regions would sound, and how loud, is `Instrument::active` and
 * `Region::gain` — evaluated at the instrument's own default controller
 * state (set_cc / set_hdcc in <control>), which is how its author mixed it.
 */
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub type Opcodes = BTreeMap<String, String>;

#[derive(Debug, Clone)]
pub struct Region {
    pub opcodes: Opcodes,
}

#[derive(Debug, Default)]
pub struct Instrument {
    /// The directory sample paths are relative to: the file's own directory
    /// joined with <control>'s default_path.
    pub sample_root: PathBuf,
    pub control: Opcodes,
    pub regions: Vec<Region>,
    /// <curve> definitions by curve_index: 128 points, 0..1.
    pub curves: BTreeMap<u32, Vec<f32>>,
}

/* ---- preprocess ----------------------------------------------------------- */

struct Pre {
    root: PathBuf,
    defines: Vec<(String, String)>,
    out: String,
    depth: usize,
}

impl Pre {
    fn expand(&self, text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut rest = text;
        while let Some(i) = rest.find('$') {
            out.push_str(&rest[..i]);
            let tail = &rest[i..];
            let best = self
                .defines
                .iter()
                .filter(|(name, _)| tail.starts_with(name.as_str()))
                .max_by_key(|(name, _)| name.len());
            match best {
                Some((name, value)) => {
                    out.push_str(value);
                    rest = &tail[name.len()..];
                }
                None => {
                    out.push('$');
                    rest = &tail[1..];
                }
            }
        }
        out.push_str(rest);
        out
    }

    fn define(&mut self, name: &str, value: &str) {
        let value = self.expand(value);
        match self.defines.iter_mut().find(|(n, _)| n == name) {
            Some(slot) => slot.1 = value,
            None => self.defines.push((name.to_string(), value)),
        }
    }

    fn file(&mut self, path: &Path) -> Result<(), String> {
        if self.depth > 32 {
            return Err(format!("{}: includes nest deeper than 32", path.display()));
        }
        let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        self.depth += 1;
        self.text(&strip_comments(&text))?;
        self.depth -= 1;
        Ok(())
    }

    fn text(&mut self, text: &str) -> Result<(), String> {
        for line in text.lines() {
            let mut rest = line;
            loop {
                let Some(at) = rest.find('#') else {
                    self.emit(rest);
                    break;
                };
                self.emit(&rest[..at]);
                let after = &rest[at..];
                if let Some(args) = after.strip_prefix("#define") {
                    let mut words = args.split_whitespace();
                    let (Some(name), Some(value)) = (words.next(), words.next()) else {
                        return Err(format!("bad #define: {line}"));
                    };
                    self.define(name, value);
                    self.out.push(' ');
                    rest = skip_words(args, 2);
                } else if let Some(args) = after.strip_prefix("#include") {
                    let args = args.trim_start();
                    let quoted = args.strip_prefix('"').and_then(|a| a.find('"').map(|end| (&a[..end], &a[end + 1..])));
                    let Some((name, tail)) = quoted else {
                        return Err(format!("bad #include: {line}"));
                    };
                    let name = self.expand(name);
                    self.file(&self.root.join(name))?;
                    self.out.push(' ');
                    rest = tail;
                } else {
                    /* A literal '#' (a sharp in a note name or a file name). */
                    self.out.push('#');
                    rest = &after[1..];
                }
            }
            self.out.push('\n');
        }
        Ok(())
    }

    fn emit(&mut self, text: &str) {
        let expanded = self.expand(text);
        self.out.push_str(&expanded);
    }
}

/// The text after the first `n` whitespace-separated words of `s`.
fn skip_words(s: &str, n: usize) -> &str {
    let mut rest = s;
    for _ in 0..n {
        rest = rest.trim_start();
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        rest = &rest[end..];
    }
    rest
}

fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        let line = rest.find("//");
        let block = rest.find("/*");
        match (line, block) {
            (Some(l), b) if b.is_none_or(|b| l < b) => {
                out.push_str(&rest[..l]);
                rest = rest[l..].find('\n').map_or("", |n| &rest[l + n..]);
            }
            (_, Some(b)) => {
                out.push_str(&rest[..b]);
                rest = rest[b..].find("*/").map_or("", |e| &rest[b + e + 2..]);
            }
            _ => {
                out.push_str(rest);
                return out;
            }
        }
    }
}

/* ---- parse ------------------------------------------------------------------ */

#[derive(Debug, PartialEq)]
enum Token {
    Header(String),
    Opcode(String, String),
}

fn is_name(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Does `s` (just past some whitespace) start a new opcode or header?
fn starts_token(s: &str) -> bool {
    if s.starts_with('<') {
        return true;
    }
    let name_len = s.find(|c: char| !is_name(c)).unwrap_or(s.len());
    name_len > 0 && s[name_len..].starts_with('=')
}

fn tokenize(text: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    for line in text.lines() {
        let mut rest = line.trim();
        while !rest.is_empty() {
            if let Some(h) = rest.strip_prefix('<') {
                let end = h.find('>').unwrap_or(h.len());
                tokens.push(Token::Header(h[..end].trim().to_string()));
                rest = h.get(end + 1..).unwrap_or("").trim_start();
                continue;
            }
            let Some(eq) = rest.find('=') else { break };
            let name = rest[..eq].trim();
            let value_start = &rest[eq + 1..];
            let mut end = value_start.len();
            for (i, c) in value_start.char_indices() {
                if c.is_whitespace() && starts_token(value_start[i..].trim_start()) {
                    end = i;
                    break;
                }
            }
            if !name.is_empty() && name.chars().all(is_name) {
                tokens.push(Token::Opcode(name.to_string(), value_start[..end].trim().to_string()));
            }
            rest = value_start[end..].trim_start();
        }
    }
    tokens
}

/* ---- flatten ------------------------------------------------------------------ */

pub fn load(path: &Path) -> Result<Instrument, String> {
    let root = path.parent().unwrap_or(Path::new(".")).to_path_buf();
    let mut pre = Pre { root: root.clone(), defines: Vec::new(), out: String::new(), depth: 0 };
    pre.file(path)?;
    let mut inst = flatten(&tokenize(&pre.out));
    let default_path = inst.control.get("default_path").cloned().unwrap_or_default();
    inst.sample_root = root.join(default_path.replace('\\', "/"));
    Ok(inst)
}

/// An instrument without a file: one region per sample, each on its key.
pub fn from_samples<'a>(root: &Path, samples: impl Iterator<Item = (&'a str, u8, f32)>) -> Instrument {
    let regions = samples
        .map(|(file, key, db)| {
            let opcodes = [("sample", file.to_string()), ("key", key.to_string()), ("volume", db.to_string())];
            Region { opcodes: opcodes.into_iter().map(|(k, v)| (k.to_string(), v)).collect() }
        })
        .collect();
    Instrument { sample_root: root.to_path_buf(), regions, ..Default::default() }
}

fn flatten(tokens: &[Token]) -> Instrument {
    #[derive(PartialEq)]
    enum Level {
        Outside,
        Control,
        Global,
        Master,
        Group,
        Region,
        Curve,
        Other,
    }
    let mut inst = Instrument::default();
    let (mut global, mut master, mut group, mut region, mut curve) =
        (Opcodes::new(), Opcodes::new(), Opcodes::new(), Opcodes::new(), Opcodes::new());
    let mut level = Level::Outside;

    let finish = |level: &Level, inst: &mut Instrument, global: &Opcodes, master: &Opcodes, group: &Opcodes, region: &mut Opcodes, curve: &mut Opcodes| {
        match level {
            Level::Region => {
                let mut all = global.clone();
                all.extend(master.clone());
                all.extend(group.clone());
                all.extend(std::mem::take(region));
                inst.regions.push(Region { opcodes: all });
            }
            Level::Curve => {
                if let Some(index) = curve.get("curve_index").and_then(|v| v.parse::<u32>().ok()) {
                    inst.curves.insert(index, curve_points(curve));
                }
                curve.clear();
            }
            _ => {}
        }
    };

    for t in tokens {
        match t {
            Token::Header(h) => {
                finish(&level, &mut inst, &global, &master, &group, &mut region, &mut curve);
                level = match h.as_str() {
                    "control" => Level::Control,
                    "global" => {
                        global.clear();
                        master.clear();
                        group.clear();
                        Level::Global
                    }
                    "master" => {
                        master.clear();
                        group.clear();
                        Level::Master
                    }
                    "group" => {
                        group.clear();
                        Level::Group
                    }
                    "region" => Level::Region,
                    "curve" => Level::Curve,
                    _ => Level::Other,
                };
            }
            Token::Opcode(k, v) => {
                let target = match level {
                    Level::Control => &mut inst.control,
                    Level::Global => &mut global,
                    Level::Master => &mut master,
                    Level::Group => &mut group,
                    Level::Region => &mut region,
                    Level::Curve => &mut curve,
                    Level::Outside | Level::Other => continue,
                };
                target.insert(k.clone(), v.clone());
            }
        }
    }
    finish(&level, &mut inst, &global, &master, &group, &mut region, &mut curve);
    inst
}

/// A <curve>'s v000..v127, linearly interpolated between the points given.
fn curve_points(curve: &Opcodes) -> Vec<f32> {
    let mut given: Vec<(usize, f32)> = curve
        .iter()
        .filter_map(|(k, v)| Some((k.strip_prefix('v')?.parse::<usize>().ok()?, v.parse::<f32>().ok()?)))
        .filter(|(i, _)| *i < 128)
        .collect();
    given.sort_by_key(|(i, _)| *i);
    if given.first().is_none_or(|(i, _)| *i != 0) {
        given.insert(0, (0, 0.0));
    }
    if given.last().is_none_or(|(i, _)| *i != 127) {
        given.push((127, 1.0));
    }
    let mut points = vec![0.0; 128];
    for pair in given.windows(2) {
        let [(i0, y0), (i1, y1)] = [pair[0], pair[1]];
        for (i, p) in points.iter_mut().enumerate().take(i1 + 1).skip(i0) {
            let t = if i1 > i0 { (i - i0) as f32 / (i1 - i0) as f32 } else { 0.0 };
            *p = y0 + (y1 - y0) * t;
        }
    }
    points
}

/* ---- evaluation ---------------------------------------------------------------- */

/// A key: a MIDI number, or a note name with c4 = 60 (`c#4`, `Eb2`, `C-1`).
pub fn parse_key(s: &str) -> Option<u8> {
    if let Ok(n) = s.parse::<i32>() {
        return u8::try_from(n).ok().filter(|n| *n <= 127);
    }
    let mut chars = s.chars();
    let pc = match chars.next()?.to_ascii_lowercase() {
        'c' => 0,
        'd' => 2,
        'e' => 4,
        'f' => 5,
        'g' => 7,
        'a' => 9,
        'b' => 11,
        _ => return None,
    };
    let rest: String = chars.collect();
    let (shift, octave) = if let Some(o) = rest.strip_prefix('#') {
        (1, o)
    } else if let Some(o) = rest.strip_prefix('b') {
        (-1, o)
    } else {
        (0, rest.as_str())
    };
    let n = (octave.parse::<i32>().ok()? + 1) * 12 + pc + shift;
    u8::try_from(n).ok().filter(|n| *n <= 127)
}

impl Instrument {
    /// Controller `cc`'s value at load, 0..=1: set_hdcc, else set_cc / 127,
    /// else 0.
    pub fn cc(&self, cc: u32) -> f32 {
        if let Some(v) = self.control.get(&format!("set_hdcc{cc}")).and_then(|v| v.parse::<f32>().ok()) {
            return v.clamp(0.0, 1.0);
        }
        self.control
            .get(&format!("set_cc{cc}"))
            .and_then(|v| v.parse::<f32>().ok())
            .map_or(0.0, |v| (v / 127.0).clamp(0.0, 1.0))
    }

    /// `curve` applied to `x` in 0..1: a <curve> the file defines, else the
    /// SFZ built-ins 0 (linear), 2 (inverted), 4 (x²), 5 (√x), 6 (√(1-x)).
    pub fn curve(&self, index: u32, x: f32) -> f32 {
        if let Some(points) = self.curves.get(&index) {
            return points.get((x * 127.0).round() as usize).copied().unwrap_or(0.0);
        }
        match index {
            2 => 1.0 - x,
            4 => x * x,
            5 => x.sqrt(),
            6 => (1.0 - x).sqrt(),
            _ => x,
        }
    }

    /// Would `r` sound at the default controller state, as an attack?
    /// Release triggers, keyswitches other than the default, and CC
    /// windows the default state falls outside of all say no.
    pub fn active(&self, r: &Region) -> bool {
        let trigger = r.opcodes.get("trigger").map_or("attack", String::as_str);
        if trigger != "attack" && trigger != "first" {
            return false;
        }
        if r.opcodes.keys().any(|k| k.starts_with("on_locc") || k.starts_with("on_hicc")) {
            return false; /* triggered by a controller, not a note */
        }
        if r.opcodes.contains_key("sw_down") || r.opcodes.contains_key("sw_up") || r.opcodes.contains_key("sw_previous") {
            return false;
        }
        if let Some(last) = r.opcodes.get("sw_last") {
            let default = r.opcodes.get("sw_default");
            if default.and_then(|d| parse_key(d)) != parse_key(last) {
                return false;
            }
        }
        for (k, v) in &r.opcodes {
            let (Some(cc), bound) = (k.strip_prefix("locc").or(k.strip_prefix("hicc")), k.starts_with("lo")) else {
                continue;
            };
            let (Ok(cc), Ok(limit)) = (cc.parse::<u32>(), v.parse::<f32>()) else { continue };
            let value = (self.cc(cc) * 127.0).round();
            if (bound && value < limit) || (!bound && value > limit) {
                return false;
            }
        }
        true
    }

    /// `name` plus every `name_onccN` at the default controller state,
    /// shaped by `name_curveccN`: an additive modulation, as SFZ defines
    /// volume, tune, ampeg_release and amp_veltrack.
    pub fn modulated(&self, r: &Region, name: &str, default: f32) -> f32 {
        let mut v = r.f32(name).unwrap_or(default);
        let prefix = format!("{name}_oncc");
        for (k, depth) in &r.opcodes {
            let Some(cc) = k.strip_prefix(&prefix).and_then(|n| n.parse::<u32>().ok()) else { continue };
            let Ok(depth) = depth.parse::<f32>() else { continue };
            let curve = r.opcodes.get(&format!("{name}_curvecc{cc}")).and_then(|c| c.parse().ok()).unwrap_or(0);
            v += depth * self.curve(curve, self.cc(cc));
        }
        v
    }

    /// The region's linear gain at the default controller state: the volume
    /// opcodes of every level in dB, times amplitude and each amplitude_oncc
    /// (a percentage of the controller's curved value, as ARIA applies it).
    pub fn gain(&self, r: &Region) -> f32 {
        let db: f32 = ["global_volume", "master_volume", "group_volume"]
            .iter()
            .map(|k| r.f32(k).unwrap_or(0.0))
            .sum::<f32>()
            + self.modulated(r, "volume", 0.0);
        let mut amp = ["global_amplitude", "master_amplitude", "group_amplitude", "amplitude"]
            .iter()
            .map(|k| r.f32(k).unwrap_or(100.0) / 100.0)
            .product::<f32>();
        for (k, depth) in &r.opcodes {
            let Some(cc) = k.strip_prefix("amplitude_oncc").and_then(|n| n.parse::<u32>().ok()) else { continue };
            let Ok(depth) = depth.parse::<f32>() else { continue };
            let curve = r.opcodes.get(&format!("amplitude_curvecc{cc}")).and_then(|c| c.parse().ok()).unwrap_or(0);
            amp *= depth / 100.0 * self.curve(curve, self.cc(cc));
        }
        10f32.powf(db / 20.0) * amp
    }

    pub fn sample_path(&self, r: &Region) -> Option<PathBuf> {
        Some(self.sample_root.join(r.opcodes.get("sample")?.replace('\\', "/")))
    }
}

impl Region {
    pub fn f32(&self, k: &str) -> Option<f32> {
        self.opcodes.get(k)?.parse().ok()
    }

    fn key_opcode(&self, k: &str) -> Option<u8> {
        parse_key(self.opcodes.get(k)?)
    }

    pub fn lokey(&self) -> u8 {
        self.key_opcode("lokey").or(self.key_opcode("key")).unwrap_or(0)
    }

    pub fn hikey(&self) -> u8 {
        self.key_opcode("hikey").or(self.key_opcode("key")).unwrap_or(127)
    }

    pub fn root(&self) -> u8 {
        self.key_opcode("pitch_keycenter").or(self.key_opcode("key")).unwrap_or(60)
    }

    pub fn lovel(&self) -> u8 {
        self.f32("lovel").map_or(1, |v| v.clamp(1.0, 127.0) as u8)
    }

    pub fn hivel(&self) -> u8 {
        self.f32("hivel").map_or(127, |v| v.clamp(1.0, 127.0) as u8)
    }

    pub fn seq_position(&self) -> u8 {
        self.f32("seq_position").map_or(1, |v| v.clamp(1.0, 100.0) as u8)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pre(text: &str) -> String {
        let mut p = Pre { root: PathBuf::new(), defines: Vec::new(), out: String::new(), depth: 0 };
        p.text(&strip_comments(text)).unwrap();
        p.out
    }

    #[test]
    fn defines_expand_longest_first_and_in_order() {
        let out = pre("#define $V 1 #define $VEL 2\n#define $VEL10 3\nx=$VEL10_$VEL_$V $NOPE");
        assert!(out.contains("x=3_2_1 $NOPE"), "{out}");
    }

    #[test]
    fn a_define_can_be_redefined_and_uses_earlier_ones() {
        let out = pre("#define $A one\n#define $B $A-two\na=$B\n#define $A three\nb=$A");
        assert!(out.contains("a=one-two") && out.contains("b=three"), "{out}");
    }

    #[test]
    fn comments_go_and_sharps_in_names_stay() {
        let out = pre("sample=D#1v1.flac // the D#\n/* block\n */ key=c#4");
        assert!(out.contains("sample=D#1v1.flac"));
        assert!(!out.contains("the D"));
        assert!(out.contains("key=c#4"));
    }

    #[test]
    fn values_may_hold_spaces_up_to_the_next_opcode() {
        let t = tokenize("<region> region_label=10 one sample=Kit A/snare 1.flac lovel=3\n<group>key=36");
        assert_eq!(
            t,
            [
                Token::Header("region".into()),
                Token::Opcode("region_label".into(), "10 one".into()),
                Token::Opcode("sample".into(), "Kit A/snare 1.flac".into()),
                Token::Opcode("lovel".into(), "3".into()),
                Token::Header("group".into()),
                Token::Opcode("key".into(), "36".into()),
            ]
        );
    }

    #[test]
    fn regions_inherit_down_the_levels_and_levels_reset() {
        let t = tokenize(
            "<control>default_path=S/ set_cc7=127\n<global>volume=-1 amplitude_oncc7=50\n<master>tune=5\n\
             <group>key=36 <region>sample=a.flac <region>sample=b.flac key=38\n\
             <master>tune=7 <region>sample=c.flac\n<curve>curve_index=9 v064=1",
        );
        let inst = flatten(&t);
        assert_eq!(inst.regions.len(), 3);
        let [a, b, c] = [&inst.regions[0], &inst.regions[1], &inst.regions[2]];
        assert_eq!((a.lokey(), a.root(), b.lokey()), (36, 36, 38));
        assert_eq!(c.opcodes.get("tune").map(String::as_str), Some("7"));
        assert!(!c.opcodes.contains_key("key"), "a new master drops the old group");
        assert_eq!(inst.cc(7), 1.0);
        let g = inst.gain(a);
        assert!((g - 10f32.powf(-1.0 / 20.0) * 0.5).abs() < 1e-6, "{g}");
        assert_eq!(inst.curve(9, 64.0 / 127.0), 1.0);
        assert!((inst.curve(9, 32.0 / 127.0) - 0.5).abs() < 0.01);
    }

    #[test]
    fn the_default_state_decides_which_regions_sound() {
        let t = tokenize(
            "<control>set_cc20=0 set_hdcc21=0.5\n<global>sw_default=c0\n\
             <region>sample=a sw_last=c0 <region>sample=b sw_last=c#0\n\
             <region>sample=c trigger=release <region>sample=d locc20=1\n\
             <region>sample=e hicc21=63 <region>sample=f locc21=64 hicc21=64\n\
             <region>sample=g on_locc64=64",
        );
        let inst = flatten(&t);
        let on: Vec<&str> = inst
            .regions
            .iter()
            .filter(|r| inst.active(r))
            .map(|r| r.opcodes["sample"].as_str())
            .collect();
        assert_eq!(on, ["a", "f"]);
    }

    #[test]
    fn modulated_adds_each_controllers_share() {
        let t = tokenize("<control>set_hdcc99=0.73 set_hdcc72=0.5\n<region>amp_veltrack_oncc99=-100 ampeg_release_oncc72=2 sample=x");
        let inst = flatten(&t);
        let r = &inst.regions[0];
        assert!((inst.modulated(r, "amp_veltrack", 100.0) - 27.0).abs() < 1e-4);
        assert!((inst.modulated(r, "ampeg_release", 0.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn note_names_put_middle_c_at_60() {
        assert_eq!(parse_key("c4"), Some(60));
        assert_eq!(parse_key("C#0"), Some(13));
        assert_eq!(parse_key("Eb2"), Some(39));
        assert_eq!(parse_key("c-1"), Some(0));
        assert_eq!(parse_key("21"), Some(21));
        assert_eq!(parse_key("128"), None);
        assert_eq!(parse_key("h2"), None);
    }

    #[test]
    fn includes_resolve_against_the_top_file() {
        let dir = std::env::temp_dir().join(format!("nisp-sfz-{}", std::process::id()));
        fs::create_dir_all(dir.join("Data")).unwrap();
        fs::write(dir.join("Data/k.txt"), "#define $K 40\n").unwrap();
        fs::write(dir.join("Data/r.txt"), "<region> key=$K sample=$S.flac").unwrap();
        fs::write(dir.join("i.sfz"), "<control> default_path=Samples/\n#include \"Data/k.txt\"\n#define $S snare\n<group> #include \"Data/r.txt\" lovel=5").unwrap();
        let inst = load(&dir.join("i.sfz")).unwrap();
        fs::remove_dir_all(&dir).unwrap();
        assert_eq!(inst.regions.len(), 1);
        let r = &inst.regions[0];
        assert_eq!((r.lokey(), r.lovel()), (40, 5), "an opcode after <region> is the region's");
        assert_eq!(inst.sample_path(r).unwrap(), dir.join("Samples/snare.flac"));
    }
}
