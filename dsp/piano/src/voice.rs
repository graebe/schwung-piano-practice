/*
 * One piano voice: four stretched partials under a shared attack and damper.
 *
 * A direct port of the C. The numbers are not adjustable-looking constants to
 * be tidied — each was tuned by ear against the hardware, so they are carried
 * across verbatim and the A/B test fails if any of them moves.
 */
use libm::{expf, powf, sqrtf};

pub const NUM_PARTIALS: usize = 4;
pub const SAMPLE_RATE: f32 = 44100.0;
pub const SINE_BITS: u32 = 11;
pub const SINE_SIZE: usize = 1 << SINE_BITS;
pub const SINE_MASK: u32 = (SINE_SIZE - 1) as u32;

#[derive(Clone, Copy)]
pub struct Voice {
    pub active: bool,
    pub releasing: bool,
    pub pitch: u8,
    /// For oldest-voice stealing.
    pub age: u32,
    pub phase: [f32; NUM_PARTIALS],
    pub inc: [f32; NUM_PARTIALS],
    pub amp: [f32; NUM_PARTIALS],
    /// Per-sample multiplier, < 1.
    pub decay: [f32; NUM_PARTIALS],
    /// 0..1 ramp; removes the click.
    pub attack: f32,
    pub attack_inc: f32,
    /// Damper: multiplies everything once released.
    pub release: f32,
}

impl Default for Voice {
    fn default() -> Self {
        Self {
            active: false,
            releasing: false,
            pitch: 0,
            age: 0,
            phase: [0.0; NUM_PARTIALS],
            inc: [0.0; NUM_PARTIALS],
            amp: [0.0; NUM_PARTIALS],
            decay: [1.0; NUM_PARTIALS],
            attack: 0.0,
            attack_inc: 0.0,
            release: 1.0,
        }
    }
}

/* Seconds of decay for a partial: low notes ring far longer than high ones,
 * and within a note the upper partials die away first. */
fn partial_decay_seconds(freq: f32, partial: usize) -> f32 {
    let base = 9.0 / (1.0 + freq / 110.0); /* ~8s at A2, ~1s at A6 */
    let shorter = 1.0 / (1.0 + 0.9 * partial as f32); /* upper partials fade first */
    let s = base * shorter;
    if s < 0.05 {
        0.05
    } else {
        s
    }
}

impl Voice {
    pub fn start(&mut self, f0: f32, pitch: u8, vel: u8, age: u32) {
        let velf = vel as f32 / 127.0;
        /* Harder strikes are brighter, not just louder — the upper partials
         * come up much faster with velocity than the fundamental does. */
        let bright = 0.25 + 0.75 * velf * velf;

        self.active = true;
        self.releasing = false;
        self.pitch = pitch;
        self.age = age;
        self.attack = 0.0;
        self.attack_inc = 1.0 / (0.004 * SAMPLE_RATE); /* ~4ms */
        self.release = 1.0;

        for i in 0..NUM_PARTIALS {
            let n = (i + 1) as f32;
            /* Stiff-string stretch: overtones sit progressively sharp. */
            let stretch = sqrtf(1.0 + 0.0004 * (n * n));
            let f = f0 * n * stretch;
            let (phase, inc, amp, decay) = if f > SAMPLE_RATE * 0.45 {
                /* Above Nyquist: silence rather than alias. */
                (0.0, 0.0, 0.0, 1.0)
            } else {
                (
                    0.0,
                    f * SINE_SIZE as f32 / SAMPLE_RATE,
                    velf * powf(bright, i as f32) / (n * n),
                    expf(-1.0 / (partial_decay_seconds(f0, i) * SAMPLE_RATE)),
                )
            };
            if let (Some(p), Some(c), Some(a), Some(d)) = (
                self.phase.get_mut(i),
                self.inc.get_mut(i),
                self.amp.get_mut(i),
                self.decay.get_mut(i),
            ) {
                (*p, *c, *a, *d) = (phase, inc, amp, decay);
            }
        }
    }

    pub fn release(&mut self) {
        if !self.active || self.releasing {
            return;
        }
        self.releasing = true;
    }

    /// One sample. Advances the voice and returns its contribution.
    pub fn tick(&mut self, sine: &[f32; SINE_SIZE]) -> f32 {
        if self.attack < 1.0 {
            self.attack += self.attack_inc;
            if self.attack > 1.0 {
                self.attack = 1.0;
            }
        }
        if self.releasing {
            /* The damper falls: ~120ms to silence, as a key release does. */
            self.release *= 0.99975;
        }

        let mut sum = 0.0f32;
        for i in 0..NUM_PARTIALS {
            let (Some(amp), Some(phase), Some(inc), Some(decay)) = (
                self.amp.get_mut(i).map(|a| *a),
                self.phase.get_mut(i).map(|p| *p),
                self.inc.get(i).copied(),
                self.decay.get(i).copied(),
            ) else {
                continue;
            };
            if amp <= 0.0 {
                continue;
            }
            let idx = (phase as u32 & SINE_MASK) as usize;
            if let Some(s) = sine.get(idx) {
                sum += s * amp;
            }
            let mut next = phase + inc;
            if next >= SINE_SIZE as f32 {
                next -= SINE_SIZE as f32;
            }
            if let Some(p) = self.phase.get_mut(i) {
                *p = next;
            }
            if let Some(a) = self.amp.get_mut(i) {
                *a = amp * decay;
            }
        }

        let out = sum * self.attack * self.release;

        /* Retire once inaudible, so dead voices stop costing anything. */
        if self.release < 0.0008 {
            self.active = false;
        } else {
            let mut loudest = 0.0f32;
            for a in self.amp.iter() {
                if *a > loudest {
                    loudest = *a;
                }
            }
            if loudest < 0.00008 {
                self.active = false;
            }
        }
        out
    }
}
