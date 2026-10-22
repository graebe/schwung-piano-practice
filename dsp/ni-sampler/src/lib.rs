// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * ni-sampler — recorded instruments for the Neon Ingvy Schwung modules.
 *
 * Two halves, one crate, so the format cannot drift between the thing that
 * writes it and the things that read it:
 *
 *   pack     NISP, the file: a header, a zone table, mono i16 sample data.
 *            `Pack` is a borrowed, zero-copy view; `PackWriter` (feature
 *            "std") is nisp-build's.
 *   sampler  `Sampler<V>`: V voices over a pack. Zone pick by key, velocity
 *            and round robin, pitch by resampling (4-point Hermite), SFZ-style
 *            velocity tracking, release fades and choke groups.
 *
 * The sampler never owns the pack. Every call that reads sample data takes a
 * `&Pack`, so the bytes can live wherever the host keeps them — a Box filled
 * in `create` on the Move, a region of linear memory in the browser — and no
 * one needs a self-referential struct or a leaked allocation to hold both.
 *
 * Shared by Piano Practice (canonical copy) and Drums Practice (vendored;
 * scripts/check-vendored.sh there keeps it identical).
 *
 * no_std, no alloc, no unsafe. EVERYTHING the sampler does runs on an audio
 * thread, so no allocation, no locks, no I/O and — through the denies below —
 * no reachable panic. A corrupt pack is silence, never a fault.
 */
#![cfg_attr(not(any(test, feature = "std")), no_std)]
#![forbid(unsafe_code)]
#![deny(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

pub mod pack;
mod sampler;

pub use pack::{Pack, PackError, Zone, FLAG_ONE_SHOT};
#[cfg(any(test, feature = "std"))]
pub use pack::PackWriter;
pub use sampler::{Retrigger, Sampler};
