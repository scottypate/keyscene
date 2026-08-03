//! Spelled pitches, the line of fifths, and interval arithmetic.
//! Normative rules: docs/engine-spec.md §1.

pub type MidiNote = u8;

pub const LETTERS: [char; 7] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
pub const NAT_PC: [u8; 7] = [0, 2, 4, 5, 7, 9, 11];
/// Line-of-fifths position of each natural letter (C D E F G A B).
pub const LOF_BASE: [i32; 7] = [0, 2, 4, -1, 1, 3, 5];

/// A spelled pitch class: letter index (0=C … 6=B) + accidental (-2..=2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SpelledPc {
    pub letter: u8,
    pub acc: i8,
}

impl SpelledPc {
    pub fn new(letter: u8, acc: i8) -> Self {
        Self { letter, acc }
    }

    pub fn pc(self) -> u8 {
        (NAT_PC[self.letter as usize] as i16 + self.acc as i16).rem_euclid(12) as u8
    }

    /// Position on the line of fifths (each sharp +7, each flat −7).
    pub fn lof(self) -> i32 {
        LOF_BASE[self.letter as usize] + 7 * self.acc as i32
    }

    pub fn acc_str(self) -> &'static str {
        match self.acc {
            -2 => "bb",
            -1 => "b",
            0 => "",
            1 => "#",
            2 => "##",
            _ => "?",
        }
    }

    /// Parse "Eb", "F#", "Bbb", "C".
    pub fn parse(s: &str) -> Option<Self> {
        let mut chars = s.chars();
        let first = chars.next()?;
        let letter = LETTERS.iter().position(|&c| c == first)? as u8;
        let acc = match chars.as_str() {
            "" => 0,
            "b" => -1,
            "bb" => -2,
            "#" => 1,
            "##" => 2,
            _ => return None,
        };
        Some(Self { letter, acc })
    }
}

impl core::fmt::Display for SpelledPc {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}{}", LETTERS[self.letter as usize], self.acc_str())
    }
}

/// Wire shape: `{"letter":"E","acc":-1,"text":"Eb"}` — letter as the plain
/// letter name, acc as -2..=2, text as the English spelling.
impl serde::Serialize for SpelledPc {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("SpelledPc", 3)?;
        st.serialize_field("letter", &LETTERS[self.letter as usize].to_string())?;
        st.serialize_field("acc", &self.acc)?;
        st.serialize_field("text", &self.to_string())?;
        st.end()
    }
}

/// A spelled pitch: spelled pc + scientific octave, tied to a MIDI note.
/// The octave satisfies natural(letter, octave) + acc == midi, so midi 59
/// spelled C-flat renders as "Cb4" (spec §1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpelledNote {
    pub sp: SpelledPc,
    pub octave: i32,
    pub midi: MidiNote,
}

impl SpelledNote {
    pub fn from_midi(midi: MidiNote, sp: SpelledPc) -> Self {
        let natural = midi as i32 - sp.acc as i32;
        Self {
            sp,
            octave: natural.div_euclid(12) - 1,
            midi,
        }
    }
}

impl core::fmt::Display for SpelledNote {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}{}", self.sp, self.octave)
    }
}

/// Wire shape: `{"letter":"C","acc":1,"octave":4,"midi":61,"text":"C#4"}` —
/// letter/octave/acc match the ui/shared Staff note-spec (ADR-001).
impl serde::Serialize for SpelledNote {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("SpelledNote", 5)?;
        st.serialize_field("letter", &LETTERS[self.sp.letter as usize].to_string())?;
        st.serialize_field("acc", &self.sp.acc)?;
        st.serialize_field("octave", &self.octave)?;
        st.serialize_field("midi", &self.midi)?;
        st.serialize_field("text", &self.to_string())?;
        st.end()
    }
}

/// An interval as (letter steps, semitones), octave-reduced (spec §1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ivl {
    pub steps: u8,
    pub semis: u8,
}

/// Interval name lookup. Tension names (9/11/13) reduce to their simple
/// letter steps; `is_tension` distinguishes them for inversion logic.
pub fn ivl(name: &str) -> Option<Ivl> {
    let (steps, semis) = match name {
        "P1" => (0, 0),
        "m2" | "m9" => (1, 1),
        "M2" | "M9" => (1, 2),
        "A2" | "A9" => (1, 3),
        "m3" => (2, 3),
        "M3" => (2, 4),
        "P4" | "P11" => (3, 5),
        "A4" | "A11" => (3, 6),
        "d5" => (4, 6),
        "P5" => (4, 7),
        "A5" => (4, 8),
        "m6" | "m13" => (5, 8),
        "M6" | "M13" => (5, 9),
        "A6" => (5, 10),
        "d7" => (6, 9),
        "m7" => (6, 10),
        "M7" => (6, 11),
        _ => return None,
    };
    Some(Ivl { steps, semis })
}

pub fn is_tension(name: &str) -> bool {
    matches!(name, "m9" | "M9" | "A9" | "P11" | "A11" | "m13" | "M13")
}

/// Spell the pitch class an interval above a spelled root (spec §5.1).
pub fn above(root: SpelledPc, iv: Ivl) -> SpelledPc {
    let letter = (root.letter + iv.steps) % 7;
    let mut acc =
        (root.pc() as i16 + iv.semis as i16 - NAT_PC[letter as usize] as i16).rem_euclid(12);
    if acc > 6 {
        acc -= 12;
    }
    SpelledPc {
        letter,
        acc: acc as i8,
    }
}
