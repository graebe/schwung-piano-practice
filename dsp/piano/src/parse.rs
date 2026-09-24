/*
 * Byte parsing for the parameter channel.
 *
 * This is the one place the C was genuinely easy to get wrong: sscanf("%d:%d")
 * plus strchr, on a caller-supplied string, on the SPI callback. Everything
 * here is total — every input maps to Some or None, nothing allocates, nothing
 * can panic — and the garbage cases the C tests already fire at it are the
 * reason the functions return Option rather than a sentinel.
 */

/// A signed decimal integer, whole-slice. `None` on anything else, including
/// empty, a lone sign, or trailing rubbish.
pub fn int(s: &[u8]) -> Option<i32> {
    let (neg, digits) = match s.split_first() {
        Some((b'-', rest)) => (true, rest),
        Some((b'+', rest)) => (false, rest),
        _ => (false, s),
    };
    if digits.is_empty() {
        return None;
    }
    let mut v: i32 = 0;
    for &c in digits {
        if !c.is_ascii_digit() {
            return None;
        }
        /* Saturating, not wrapping: a long run of digits is nonsense input,
         * and nonsense must not become a valid-looking small number. */
        v = v.saturating_mul(10).saturating_add((c - b'0') as i32);
    }
    Some(if neg { -v } else { v })
}

/// A decimal float, enough of one for a gain value. No exponent, no hex, no
/// infinity — the parameter channel never carries them.
pub fn float(s: &[u8]) -> Option<f32> {
    let (neg, rest) = match s.split_first() {
        Some((b'-', r)) => (true, r),
        Some((b'+', r)) => (false, r),
        _ => (false, s),
    };
    if rest.is_empty() {
        return None;
    }
    let mut whole: f64 = 0.0;
    let mut frac: f64 = 0.0;
    let mut scale: f64 = 1.0;
    let mut seen_digit = false;
    let mut in_frac = false;
    for &c in rest {
        match c {
            b'.' if !in_frac => in_frac = true,
            b'0'..=b'9' => {
                seen_digit = true;
                if in_frac {
                    scale *= 0.1;
                    frac += ((c - b'0') as f64) * scale;
                } else {
                    whole = whole * 10.0 + ((c - b'0') as f64);
                }
            }
            _ => return None,
        }
    }
    if !seen_digit {
        return None;
    }
    let v = (whole + frac) as f32;
    Some(if neg { -v } else { v })
}

/// One `pitch:velocity` pair. `None` if either half is missing or not a number
/// — which is what makes a malformed entry mid-list lose only itself.
pub fn note(entry: &[u8]) -> Option<(u8, u8)> {
    let colon = entry.iter().position(|&c| c == b':')?;
    let pitch = int(entry.get(..colon)?)?;
    let vel = int(entry.get(colon + 1..)?)?;
    if !(0..128).contains(&pitch) {
        return None;
    }
    let vel = vel.clamp(0, 127) as u8;
    Some((pitch as u8, vel))
}

/// Split a comma-separated note list. Borrows; allocates nothing.
pub fn notes(list: &[u8]) -> impl Iterator<Item = &[u8]> {
    list.split(|&c| c == b',')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integers_are_total() {
        assert_eq!(int(b"0"), Some(0));
        assert_eq!(int(b"127"), Some(127));
        assert_eq!(int(b"-5"), Some(-5));
        assert_eq!(int(b""), None);
        assert_eq!(int(b"-"), None);
        assert_eq!(int(b"12a"), None);
        assert_eq!(int(b"nonsense"), None);
        /* Nonsense must not wrap into a plausible number. */
        assert_eq!(int(b"99999999999999999999"), Some(i32::MAX));
    }

    #[test]
    fn floats_cover_what_the_gain_key_sends() {
        assert_eq!(float(b"0"), Some(0.0));
        assert_eq!(float(b"1"), Some(1.0));
        assert_eq!(float(b"0.22"), Some(0.22f64 as f32));
        assert_eq!(float(b".5"), Some(0.5));
        assert_eq!(float(b""), None);
        assert_eq!(float(b"."), None);
        assert_eq!(float(b"1.2.3"), None);
        assert_eq!(float(b"abc"), None);
    }

    #[test]
    fn a_note_needs_both_halves_and_a_real_pitch() {
        assert_eq!(note(b"60:100"), Some((60, 100)));
        assert_eq!(note(b"0:1"), Some((0, 1)));
        assert_eq!(note(b"127:0"), Some((127, 0)));
        assert_eq!(note(b"60"), None, "no colon");
        assert_eq!(note(b"60:"), None, "no velocity");
        assert_eq!(note(b":100"), None, "no pitch");
        assert_eq!(note(b"999:100"), None, "pitch out of range");
        assert_eq!(note(b"garbage"), None);
        assert_eq!(note(b"60:999"), Some((60, 127)), "velocity clamps");
    }

    #[test]
    fn a_bad_entry_loses_only_itself() {
        let parsed: alloc::vec::Vec<_> = notes(b"60:100,garbage,64:100").map(note).collect();
        assert_eq!(parsed, [Some((60, 100)), None, Some((64, 100))]);
    }
}
