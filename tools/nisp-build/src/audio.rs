// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * Audio in and the edits nisp-build makes to it: decode to mono f32, resample,
 * find where the sound starts and stops, fade.
 */
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};
use std::path::Path;

/// A recording, mono, -1..1.
pub struct Mono {
    pub rate: u32,
    pub frames: Vec<f32>,
}

/// Decode a FLAC or WAV file and fold it to mono (the channels' mean).
pub fn decode(path: &Path) -> Result<Mono, String> {
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    let fail = |e: &dyn std::fmt::Display| format!("{}: {e}", path.display());
    let (rate, channels, interleaved) = match ext.as_deref() {
        Some("flac") => {
            let mut r = claxon::FlacReader::open(path).map_err(|e| fail(&e))?;
            let info = r.streaminfo();
            let scale = 1.0 / (1u64 << (info.bits_per_sample - 1)) as f32;
            let samples = r.samples().map(|s| s.map(|v| v as f32 * scale)).collect::<Result<Vec<_>, _>>();
            (info.sample_rate, info.channels as usize, samples.map_err(|e| fail(&e))?)
        }
        Some("wav") => {
            let mut r = hound::WavReader::open(path).map_err(|e| fail(&e))?;
            let spec = r.spec();
            let samples: Result<Vec<f32>, _> = match spec.sample_format {
                hound::SampleFormat::Float => r.samples::<f32>().collect(),
                hound::SampleFormat::Int => {
                    let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
                    r.samples::<i32>().map(|s| s.map(|v| v as f32 * scale)).collect()
                }
            };
            (spec.sample_rate, spec.channels as usize, samples.map_err(|e| fail(&e))?)
        }
        _ => return Err(format!("{}: not a .flac or .wav", path.display())),
    };
    if channels == 0 {
        return Err(format!("{}: no channels", path.display()));
    }
    let frames = interleaved.chunks_exact(channels).map(|f| f.iter().sum::<f32>() / channels as f32).collect();
    Ok(Mono { rate, frames })
}

/// `m` at `rate`, through rubato's FFT resampler (a fixed ratio, the whole
/// clip at once, its delay trimmed). Unchanged when the rates already agree.
pub fn resample(m: Mono, rate: u32) -> Result<Mono, String> {
    if m.rate == rate || m.frames.is_empty() {
        return Ok(Mono { rate, ..m });
    }
    let mut r = Fft::<f32>::new(m.rate as usize, rate as usize, 1024, 1, FixedSync::Input)
        .map_err(|e| format!("resampler: {e}"))?;
    let input = InterleavedSlice::new(&m.frames[..], 1, m.frames.len()).map_err(|e| format!("resampler: {e}"))?;
    let out = r.process_all(&input, m.frames.len(), None).map_err(|e| format!("resampler: {e}"))?;
    Ok(Mono { rate, frames: out.take_data() })
}

pub fn peak(frames: &[f32]) -> f32 {
    frames.iter().fold(0.0f32, |p, s| p.max(s.abs()))
}

pub fn db(x: f32) -> f32 {
    10f32.powf(x / 20.0)
}

/// The first frame above `threshold`, less `preroll` frames: where the
/// sound starts, keeping the breath before the transient.
pub fn start(frames: &[f32], threshold: f32, preroll: usize) -> usize {
    frames.iter().position(|s| s.abs() > threshold).map_or(0, |i| i.saturating_sub(preroll))
}

/// One past the last frame above `threshold`: where the sound has died.
pub fn end(frames: &[f32], threshold: f32) -> usize {
    frames.iter().rposition(|s| s.abs() > threshold).map_or(0, |i| i + 1)
}

/// A raised-cosine fade over the last `n` frames.
pub fn fade_out(frames: &mut [f32], n: usize) {
    let n = n.min(frames.len());
    let from = frames.len() - n;
    for (i, s) in frames[from..].iter_mut().enumerate() {
        let t = (i + 1) as f32 / n as f32;
        *s *= 0.5 + 0.5 * (std::f32::consts::PI * t).cos();
    }
}

/// -1..1 to i16, rounded and clamped.
pub fn to_i16(frames: &[f32]) -> Vec<i16> {
    frames.iter().map(|s| (s * 32767.0).round().clamp(-32768.0, 32767.0) as i16).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wav_decodes_to_the_mean_of_its_channels() {
        let path = std::env::temp_dir().join(format!("nisp-audio-{}.wav", std::process::id()));
        let spec = hound::WavSpec { channels: 2, sample_rate: 22050, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        let mut w = hound::WavWriter::create(&path, spec).unwrap();
        for (l, r) in [(16384i16, 0i16), (-32768, -32768)] {
            w.write_sample(l).unwrap();
            w.write_sample(r).unwrap();
        }
        w.finalize().unwrap();
        let m = decode(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert_eq!(m.rate, 22050);
        assert_eq!(m.frames, [0.25, -1.0]);
        assert!(decode(Path::new("x.mp3")).is_err());
    }

    #[test]
    fn resampling_keeps_duration_and_pitch() {
        let tone: Vec<f32> = (0..48000).map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / 48000.0).sin() * 0.5).collect();
        let m = resample(Mono { rate: 48000, frames: tone }, 44100).unwrap();
        assert_eq!(m.rate, 44100);
        assert!((m.frames.len() as i64 - 44100).abs() <= 1, "{}", m.frames.len());
        let mid = &m.frames[4410..39690];
        let crossings = mid.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        assert!((crossings as f32 / 0.8 - 440.0).abs() < 3.0, "{crossings} rising crossings in 0.8 s");
        assert!((peak(mid) - 0.5).abs() < 0.01);
        let same = resample(Mono { rate: 44100, frames: vec![0.1, 0.2] }, 44100).unwrap();
        assert_eq!(same.frames, [0.1, 0.2]);
    }

    #[test]
    fn start_end_and_fade() {
        let f = [0.0, 0.001, 0.0, 0.5, -0.4, 0.002, 0.0];
        assert_eq!(start(&f, 0.01, 1), 2);
        assert_eq!(start(&f, 0.01, 9), 0);
        assert_eq!(end(&f, 0.01), 5);
        assert_eq!(start(&[0.0; 3], 0.1, 0), 0);
        assert_eq!(end(&[0.0; 3], 0.1), 0);
        let mut g = vec![1.0; 4];
        fade_out(&mut g, 2);
        assert_eq!(g[..2], [1.0, 1.0]);
        assert!((g[2] - 0.5).abs() < 1e-6 && g[3].abs() < 1e-6);
        assert_eq!(to_i16(&[1.0, -2.0, 0.5]), [32767, -32768, 16384]);
        assert!((db(-6.0) - 0.501).abs() < 0.001);
    }
}
