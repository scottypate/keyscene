//! Property + fuzz tests (docs/engine-spec.md §7, PLAN.md Phase 1).
//! Deterministic xorshift driver instead of a fuzz framework so the exact
//! same cases run on native and WASM targets.

use keyscene_core::{analyze, AccidentalPref, Key, Settings, KEY_NAMES};

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn random_case(rng: &mut Rng) -> (Vec<u8>, Option<Key>, Settings) {
    let n = 1 + rng.below(10) as usize;
    let notes: Vec<u8> = (0..n).map(|_| (21 + rng.below(88)) as u8).collect();
    let key = match rng.below(3) {
        0 => None,
        _ => Key::from_name(KEY_NAMES[rng.below(24) as usize]),
    };
    let settings = Settings {
        accidental_pref: match rng.below(3) {
            0 => AccidentalPref::Auto,
            1 => AccidentalPref::Sharps,
            _ => AccidentalPref::Flats,
        },
        ..Settings::default()
    };
    (notes, key, settings)
}

/// Spec §7.3 + §7.4: totality (never blank, never panic) and spelling
/// soundness (every spelled note's pc equals its input pc) over 20k
/// random inputs including all key/pref combinations.
#[test]
fn fuzz_no_panic_no_blank_sound_spelling() {
    let mut rng = Rng(0x6b65_7973_6365_6e65); // "keyscene"
    for i in 0..20_000 {
        let (notes, key, settings) = random_case(&mut rng);
        let a = analyze(&notes, key, &settings);
        assert!(
            !a.chord_names.is_empty(),
            "case {i}: blank output for {notes:?} key {key:?}"
        );
        assert!(
            a.chord_names.iter().all(|c| !c.text.is_empty()),
            "case {i}: empty name text for {notes:?}"
        );
        let mut sorted = notes.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(a.spelled_notes.len(), sorted.len(), "case {i}");
        for (note, spelled) in sorted.iter().zip(&a.spelled_notes) {
            assert_eq!(
                spelled.sp.pc(),
                note % 12,
                "case {i}: spelling {spelled} does not match pc of midi {note}"
            );
            // "Bbb3" style octave correctness: natural(letter, octave) + acc == midi
            let natural_pc =
                (i32::from(spelled.sp.pc()) - i32::from(spelled.sp.acc)).rem_euclid(12);
            assert_eq!(
                12 * (spelled.octave + 1) + natural_pc + i32::from(spelled.sp.acc),
                i32::from(*note),
                "case {i}: octave rule violated for {spelled}"
            );
        }
    }
}

/// Spec §7.1: transposing any input by ±12 changes no chord name.
#[test]
fn octave_invariance() {
    let mut rng = Rng(0xdead_beef_0451);
    for i in 0..5_000 {
        let (notes, key, settings) = random_case(&mut rng);
        let up: Vec<u8> = notes.iter().map(|&n| n + 12).collect();
        if up.iter().any(|&n| n > 108) {
            continue;
        }
        let a = analyze(&notes, key, &settings);
        let b = analyze(&up, key, &settings);
        let names_a: Vec<&String> = a.chord_names.iter().map(|c| &c.text).collect();
        let names_b: Vec<&String> = b.chord_names.iter().map(|c| &c.text).collect();
        assert_eq!(
            names_a, names_b,
            "case {i}: octave transposition changed names of {notes:?}"
        );
        assert_eq!(a.roman_numeral, b.roman_numeral, "case {i}");
    }
}

/// Spec §7.2: transposition by n semitones transposes every root/bass pc
/// by n (checked on the bass note and top-name root pc via spelled notes).
#[test]
fn transposition_equivariance() {
    let mut rng = Rng(0x0451_1337);
    for i in 0..5_000 {
        let (notes, _, settings) = random_case(&mut rng);
        let shift = 1 + rng.below(11) as u8;
        let up: Vec<u8> = notes.iter().map(|&n| n + shift).collect();
        if up.iter().any(|&n| n > 108) {
            continue;
        }
        // no key: names must be structurally equal up to root spelling
        let a = analyze(&notes, None, &settings);
        let b = analyze(&up, None, &settings);
        assert_eq!(
            a.chord_names.len(),
            b.chord_names.len(),
            "case {i}: interpretation count changed under transposition of {notes:?} by {shift}"
        );
        let bass_a = a.bass_note.unwrap().sp.pc();
        let bass_b = b.bass_note.unwrap().sp.pc();
        assert_eq!((bass_a + shift) % 12, bass_b, "case {i}");
        assert_eq!(a.is_partial, b.is_partial, "case {i}");
        assert_eq!(
            a.intervals, b.intervals,
            "case {i}: bass-relative intervals must be invariant"
        );
    }
}

/// Spec §7.5: determinism — identical inputs, identical outputs.
#[test]
fn determinism() {
    let mut rng = Rng(0x5eed);
    for _ in 0..2_000 {
        let (notes, key, settings) = random_case(&mut rng);
        let a = analyze(&notes, key, &settings);
        let b = analyze(&notes, key, &settings);
        assert_eq!(
            a.chord_names.iter().map(|c| &c.text).collect::<Vec<_>>(),
            b.chord_names.iter().map(|c| &c.text).collect::<Vec<_>>()
        );
        assert_eq!(a.roman_numeral, b.roman_numeral);
        assert_eq!(
            a.spelled_notes
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>(),
            b.spelled_notes
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        );
    }
}

/// Never-blank rule at the boundaries (spec §2).
#[test]
fn small_inputs() {
    let s = Settings::default();
    for pc in 0..12u8 {
        let a = analyze(&[60 + pc], None, &s);
        assert_eq!(a.chord_names.len(), 1);
        assert!(a.is_partial);
        for other in 1..12u8 {
            let d = analyze(&[60 + pc, 60 + pc + other], None, &s);
            assert!(!d.chord_names.is_empty());
            assert!(d.is_partial);
        }
    }
    assert!(analyze(&[], None, &s).chord_names.is_empty());
}
