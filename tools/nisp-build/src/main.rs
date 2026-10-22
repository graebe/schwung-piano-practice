// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * nisp-build — cut a NISP pack for a Neon Ingvy Schwung module out of an SFZ
 * instrument, as a manifest describes.
 *
 *   nisp-build build <manifest.toml> --source <dir> --out <pack.nisp> [--report <file>]
 *   nisp-build inspect <instrument.sfz>
 *
 * `build` prints a summary and writes the per-zone report beside it (or to
 * --report), so a pack's contents can be reviewed in a diff.
 */
mod audio;
mod build;
mod sfz;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

fn inspect(path: &str) -> Result<(), String> {
    let inst = sfz::load(&PathBuf::from(path))?;
    let active: Vec<_> = inst.regions.iter().filter(|r| inst.active(r)).collect();
    println!("regions: {}, active: {}, sample root: {}", inst.regions.len(), active.len(), inst.sample_root.display());
    let mut keys: BTreeMap<u8, usize> = BTreeMap::new();
    let mut opcodes: BTreeMap<&str, usize> = BTreeMap::new();
    for r in &active {
        *keys.entry(r.lokey()).or_default() += 1;
        for k in r.opcodes.keys() {
            *opcodes.entry(k).or_default() += 1;
        }
    }
    println!("active regions by lokey: {keys:?}");
    for (k, n) in opcodes {
        println!("  {k}: {n}");
    }
    Ok(())
}

fn flag(args: &[String], name: &str) -> Option<PathBuf> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(PathBuf::from)
}

fn run_build(manifest: &str, args: &[String]) -> Result<(), String> {
    let source = flag(args, "--source").ok_or("--source <dir> is required")?;
    let out = flag(args, "--out").ok_or("--out <pack.nisp> is required")?;
    let report_path = flag(args, "--report").unwrap_or_else(|| out.with_extension("report.txt"));
    let text = std::fs::read_to_string(manifest).map_err(|e| format!("{manifest}: {e}"))?;
    let m = build::Manifest::parse(&text).map_err(|e| format!("{manifest}: {e}"))?;
    let t0 = Instant::now();
    let (bytes, report) = build::build(&m, &source)?;
    let over = build::over_budget(&m, &report);
    if over.is_none() {
        std::fs::write(&out, &bytes).map_err(|e| format!("{}: {e}", out.display()))?;
    }
    /* The report is committed beside the pack, so it holds nothing that
     * changes between two builds of the same pack. */
    let summary = format!(
        "{}: {} zones, {:.2} MB, {:.1} s of audio, scale {:+.1} dB",
        out.display(),
        report.zones,
        report.bytes as f64 / 1e6,
        report.seconds,
        report.scale_db,
    );
    let mut text = format!("{summary}\n\n");
    for l in &report.lines {
        text.push_str(l);
        text.push('\n');
    }
    std::fs::write(&report_path, text).map_err(|e| format!("{}: {e}", report_path.display()))?;
    println!("{summary}, built in {:.1} s\nreport: {}", t0.elapsed().as_secs_f64(), report_path.display());
    over.map_or(Ok(()), |e| Err(format!("{e}; nothing written but the report")))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1..).unwrap_or_default() {
        [cmd, path] if cmd == "inspect" => inspect(path),
        [cmd, manifest, rest @ ..] if cmd == "build" => run_build(manifest, rest),
        _ => Err("usage: nisp-build build <manifest.toml> --source <dir> --out <pack.nisp> [--report <file>]\n       nisp-build inspect <instrument.sfz>".into()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("nisp-build: {e}");
            ExitCode::FAILURE
        }
    }
}
