//! Keys and key-driven spelling (spec §1, §5.2).

use crate::pitch::{above, ivl, SpelledPc, LETTERS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Major,
    Minor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Key {
    pub tonic: SpelledPc,
    pub mode: Mode,
}

impl Key {
    /// Canonical name, the inverse of [`Key::from_name`]: "Eb", "F#m".
    pub fn name(&self) -> String {
        match self.mode {
            Mode::Major => self.tonic.to_string(),
            Mode::Minor => format!("{}m", self.tonic),
        }
    }
}

/// Wire shape: the canonical key name string ("C", "F#m"), matching
/// [`KEY_NAMES`] entries so the UI round-trips it via `Key::from_name`.
impl serde::Serialize for Key {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.name())
    }
}

const MAJ_SCALE: [&str; 7] = ["P1", "M2", "M3", "P4", "P5", "M6", "M7"];
const NAT_MIN_SCALE: [&str; 7] = ["P1", "M2", "m3", "P4", "P5", "m6", "m7"];

/// The 24 supported keys (spec §1).
pub const KEY_NAMES: [&str; 24] = [
    "C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F", "Am", "Em", "Bm", "F#m",
    "C#m", "G#m", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm",
];

impl Key {
    /// Parse "Eb", "F#m", "Am" …
    pub fn from_name(name: &str) -> Option<Self> {
        let (tonic_str, mode) = match name.strip_suffix('m') {
            Some(t) => (t, Mode::Minor),
            None => (name, Mode::Major),
        };
        Some(Self {
            tonic: SpelledPc::parse(tonic_str)?,
            mode,
        })
    }

    /// Diatonic degree spellings (natural minor for minor keys).
    pub fn degrees(&self) -> [SpelledPc; 7] {
        let scale = match self.mode {
            Mode::Major => MAJ_SCALE,
            Mode::Minor => NAT_MIN_SCALE,
        };
        scale.map(|s| above(self.tonic, ivl(s).unwrap()))
    }

    /// Diatonic pc set; minor includes the raised 7th (harmonic frame).
    pub fn diatonic_mask(&self) -> u16 {
        let mut mask: u16 = self.degrees().iter().map(|d| 1u16 << d.pc()).sum();
        if self.mode == Mode::Minor {
            mask |= 1 << self.leading_pc();
        }
        mask
    }

    pub fn leading_pc(&self) -> u8 {
        (self.tonic.pc() + 11) % 12
    }

    /// LoF center of the key (spec §5.2).
    pub fn center(&self) -> i32 {
        self.tonic.lof()
            + match self.mode {
                Mode::Major => 2,
                Mode::Minor => -1,
            }
    }

    /// Spec §5.2: non-chord-context spelling of a pc — nearest to the key
    /// center on the line of fifths, ≤1 accidental, ties flatwise; in minor
    /// the leading tone is always the raised 7th. White-note enharmonics
    /// (Fb, Cb, E#, B#) carry a 3-fifths penalty: a bare pc 4 in Db is E,
    /// not Fb — they only appear when decisively closer to the key
    /// (Cb in Db, E# in F#) so chart-style naturals win the near-ties.
    pub fn spell_pc(&self, pc: u8) -> SpelledPc {
        if self.mode == Mode::Minor && pc == self.leading_pc() {
            let seventh = self.degrees()[6];
            return SpelledPc::new(seventh.letter, seventh.acc + 1);
        }
        let is_white_pc = [0, 2, 4, 5, 7, 9, 11].contains(&pc);
        let mut best: Option<((i32, i32), SpelledPc)> = None;
        for letter in 0..LETTERS.len() as u8 {
            for acc in -1i8..=1 {
                let sp = SpelledPc::new(letter, acc);
                if sp.pc() != pc {
                    continue;
                }
                let penalty = if acc != 0 && is_white_pc { 3 } else { 0 };
                let cand = ((sp.lof() - self.center()).abs() + penalty, sp.lof());
                if best.is_none_or(|(b, _)| cand < b) {
                    best = Some((cand, sp));
                }
            }
        }
        best.unwrap().1
    }
}
