//! keyscene-core: pure analysis engine.
//!
//! Input: active pitches + optional key context + settings.
//! Output: [`Analysis`] (chord names, spelled notes, Roman numerals,
//! intervals).
//!
//! Ground rules (PLAN.md §2.1, §3.2):
//! - Pure functions only: no I/O, no UI, no globals, deterministic.
//! - Must compile to native, WASM, and (later) behind a C ABI.
//! - Normative behavior lives in docs/engine-spec.md; changes require
//!   test vectors in the same PR.

#![forbid(unsafe_code)]

mod analyze;
mod key;
mod pitch;
mod roman;
mod suggest;
mod vocab;

pub use analyze::{
    analyze, note_display, AccidentalPref, Analysis, ChordName, NameKind, NameLanguage,
    RnConvention, Settings,
};
pub use key::{Key, Mode, KEY_NAMES};
pub use pitch::{MidiNote, SpelledNote, SpelledPc};
pub use suggest::suggest_keys;

pub fn engine_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c_major_triad() {
        let a = analyze(&[60, 64, 67], None, &Settings::default());
        assert_eq!(a.chord_names[0].text, "C");
        assert_eq!(
            a.spelled_notes
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>(),
            ["C4", "E4", "G4"]
        );
        assert!(!a.is_partial);
    }

    #[test]
    fn display_languages() {
        let b = SpelledPc::parse("B").unwrap();
        let bb = SpelledPc::parse("Bb").unwrap();
        assert_eq!(note_display(b, NameLanguage::German), "H");
        assert_eq!(note_display(bb, NameLanguage::German), "B");
        assert_eq!(note_display(b, NameLanguage::English), "B");
        let fs = SpelledPc::parse("F#").unwrap();
        assert_eq!(note_display(fs, NameLanguage::Solfege), "Fa#");
    }

    #[test]
    fn key_suggestion_prefers_c_major_for_c_scale() {
        let mut w = [0.0f32; 12];
        for pc in [0, 2, 4, 5, 7, 9, 11] {
            w[pc] = 1.0;
        }
        w[0] = 2.0; // tonic emphasis
        let top = suggest_keys(&w);
        assert_eq!(top.len(), 3);
        assert_eq!(top[0].0, Key::from_name("C").unwrap());
    }
}
