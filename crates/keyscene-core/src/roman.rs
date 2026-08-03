//! Roman numeral derivation (spec §4).

use crate::analyze::{Candidate, RnConvention};
use crate::key::{Key, Mode};
use crate::pitch::SpelledPc;
use crate::vocab::Template;

const NUMERALS: [&str; 7] = ["I", "II", "III", "IV", "V", "VI", "VII"];

pub(crate) fn roman(
    top: &Candidate,
    root_sp: SpelledPc,
    key: &Key,
    convention: RnConvention,
    pc_mask: u16,
    inversion: Option<u8>,
) -> Option<String> {
    let t = top.template;
    let diatonic = pc_mask & !key.diatonic_mask() == 0;

    if !diatonic {
        if let Some(s) = secondary(top, key, convention, inversion) {
            return Some(s);
        }
    }

    // Degree + accidental prefix from the spelled root (spec §4).
    let degrees = key.degrees();
    let tonic_letter = key.tonic.letter;
    let step = (root_sp.letter + 7 - tonic_letter) % 7;
    let expected_lof = degrees[step as usize].lof();
    let mut diff = root_sp.lof() - expected_lof;
    // Minor degree 7: natural (subtonic) and raised (leading tone) are both
    // prefix-free references.
    if key.mode == Mode::Minor && step == 6 && diff == 7 {
        diff = 0;
    }
    if diff % 7 != 0 {
        return None; // unspellable degree (double-accidental root vs key)
    }
    let prefix = match diff / 7 {
        0 => String::new(),
        n if n < 0 => "b".repeat((-n) as usize),
        n => "#".repeat(n as usize),
    };

    let lower = matches!(convention, RnConvention::Textbook) && t.has_m3;
    let numeral = case(NUMERALS[step as usize], lower);
    let tail = tail_for(t, convention, lower);
    let (tail, fig) = apply_figures(&tail, t, inversion);
    Some(format!("{}{}{}{}", prefix, numeral, tail, fig))
}

/// Returns (tail, figures) with inversion figures applied per spec §4.
fn apply_figures(tail: &str, t: &Template, inversion: Option<u8>) -> (String, String) {
    let is_triad = t.entries.len() == 3;
    match inversion {
        Some(inv) if is_triad && tail.chars().count() <= 1 => {
            // triads (tail "", "°", "+"): 6 / 64
            let fig = if inv == 1 { "6" } else { "64" };
            (tail.to_string(), fig.to_string())
        }
        Some(inv) if tail == "7" => {
            let fig = match inv {
                1 => "65",
                2 => "43",
                _ => "42",
            };
            (String::new(), fig.to_string())
        }
        _ => (tail.to_string(), String::new()),
    }
}

fn case(numeral: &str, lower: bool) -> String {
    if lower {
        numeral.to_lowercase()
    } else {
        numeral.to_string()
    }
}

/// Quality tail after the numeral (spec §4).
fn tail_for(t: &Template, convention: RnConvention, lower: bool) -> String {
    match (t.id.as_str(), convention) {
        ("min", RnConvention::Quality) => "m".to_string(),
        ("maj", _) | ("min", _) => String::new(),
        ("dim", _) => "\u{b0}".to_string(),
        ("aug", _) => "+".to_string(),
        ("dim7", _) => "\u{b0}7".to_string(),
        ("m7b5", RnConvention::Textbook) => "\u{f8}7".to_string(),
        ("mmaj7", RnConvention::Textbook) => "maj7".to_string(),
        _ => {
            let sym = t.symbol.as_str();
            if lower {
                sym.strip_prefix('m').unwrap_or(sym).to_string()
            } else {
                sym.to_string()
            }
        }
    }
}

/// Secondary dominants and leading-tone chords (spec §4).
fn secondary(
    top: &Candidate,
    key: &Key,
    convention: RnConvention,
    inversion: Option<u8>,
) -> Option<String> {
    let t = top.template;
    let degrees = key.degrees();
    let is_dominant =
        t.id == "maj" || (t.has_interval("M3") && t.has_interval("m7") && !t.has_interval("M7"));
    let is_leading = matches!(t.id.as_str(), "dim" | "dim7" | "m7b5");
    if !is_dominant && !is_leading {
        return None;
    }
    // Targets: degrees 2..6, matched uniquely by pc.
    for (target, degree) in degrees.iter().enumerate().take(6).skip(1) {
        let target_pc = degree.pc();
        if is_dominant && top.root_pc == (target_pc + 7) % 12 {
            let tail = if t.id == "maj" {
                String::new()
            } else {
                tail_for(t, convention, false)
            };
            let (tail, fig) = apply_figures(&tail, t, inversion);
            return Some(format!(
                "V{}{}/{}",
                tail,
                fig,
                target_numeral(target, key, convention)
            ));
        }
        if is_leading && top.root_pc == (target_pc + 11) % 12 {
            let tail = match t.id.as_str() {
                "dim" => "\u{b0}",
                "dim7" => "\u{b0}7",
                _ => "\u{f8}7",
            };
            return Some(format!(
                "vii{}/{}",
                tail,
                target_numeral(target, key, convention)
            ));
        }
    }
    None
}

fn target_numeral(target: usize, key: &Key, convention: RnConvention) -> String {
    let lower = matches!(convention, RnConvention::Textbook)
        && match key.mode {
            // diatonic triad quality on that degree
            Mode::Major => [false, true, true, false, false, true, true][target],
            Mode::Minor => [true, true, false, true, false, false, false][target],
        };
    case(NUMERALS[target], lower)
}
