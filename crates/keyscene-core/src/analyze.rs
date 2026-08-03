//! Chord matching, ranking, spelling and formatting (spec §2, §3, §5).

use crate::key::Key;
use crate::pitch::{above, MidiNote, SpelledNote, SpelledPc};
use crate::roman;
use crate::vocab::{vocab, Family, Template};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccidentalPref {
    #[default]
    Auto,
    Sharps,
    Flats,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RnConvention {
    #[default]
    Textbook,
    Quality,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NameLanguage {
    #[default]
    English,
    German,
    Solfege,
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub accidental_pref: AccidentalPref,
    pub rn_convention: RnConvention,
    pub name_language: NameLanguage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NameKind {
    Chord,
    Polychord,
    Quartal,
    Cluster,
    Dyad,
    Single,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ChordName {
    pub text: String,
    pub kind: NameKind,
    pub score: i32,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    /// All valid interpretations, ranked; `[0]` is the display name.
    pub chord_names: Vec<ChordName>,
    /// One per input note, aligned with the sorted deduped input.
    pub spelled_notes: Vec<SpelledNote>,
    pub roman_numeral: Option<String>,
    /// Interval names from the bass, simple-reduced.
    pub intervals: Vec<String>,
    pub bass_note: Option<SpelledNote>,
    pub inversion: Option<u8>,
    /// Fewer than 3 distinct pitch classes sounding.
    pub is_partial: bool,
}

/// A ranked template match, kept for spelling/RN derivation.
pub(crate) struct Candidate {
    pub score: i32,
    pub root_pc: u8,
    pub template: &'static Template,
    /// Indices of absent opt entries.
    pub absent: Vec<usize>,
}

impl Candidate {
    fn sort_symbol(&self) -> String {
        let mut s = self.template.symbol.clone();
        for &i in &self.absent {
            s.push_str(&self.template.entries[i].suf);
        }
        s
    }
}

pub fn analyze(notes: &[MidiNote], key: Option<Key>, settings: &Settings) -> Analysis {
    let mut sorted: Vec<MidiNote> = notes.iter().copied().filter(|&n| n < 128).collect();
    sorted.sort_unstable();
    sorted.dedup();
    if sorted.is_empty() {
        return Analysis::default();
    }
    let bass = sorted[0];
    let bass_pc = bass % 12;
    let mut pcs: Vec<u8> = Vec::new(); // distinct pcs, in ascending-midi order
    let mut pc_mask: u16 = 0;
    for &n in &sorted {
        if pc_mask & (1 << (n % 12)) == 0 {
            pc_mask |= 1 << (n % 12);
            pcs.push(n % 12);
        }
    }

    let mut analysis = Analysis {
        is_partial: pcs.len() < 3,
        intervals: sorted[1..]
            .iter()
            .map(|&n| dyad_name(((n as i16 - bass as i16) % 12) as u8).to_string())
            .collect(),
        ..Default::default()
    };

    // pc -> spelling, filled by whichever interpretation wins.
    let mut spell: BTreeMap<u8, SpelledPc> = BTreeMap::new();

    match pcs.len() {
        1 if sorted.len() == 1 => {
            let sp = context_spelling(pcs[0], key, settings);
            spell.insert(pcs[0], sp);
            analysis.chord_names.push(ChordName {
                text: sp.to_string(),
                kind: NameKind::Single,
                score: 0,
            });
        }
        1 | 2 => {
            // Two distinct pcs, or one pc across octaves (P8 dyad).
            for &pc in &pcs {
                spell.insert(pc, context_spelling(pc, key, settings));
            }
            let upper_pc = *pcs.last().unwrap();
            let semis = (upper_pc + 12 - bass_pc) % 12;
            let semis = if semis == 0 { 12 } else { semis };
            let text = format!(
                "{}·{} ({})",
                spell[&bass_pc],
                spell[&upper_pc],
                dyad_name(semis % 12)
            );
            if semis == 7 {
                analysis.chord_names.push(ChordName {
                    text: format!("{}5", spell[&bass_pc]),
                    kind: NameKind::Chord,
                    score: 10,
                });
            }
            analysis.chord_names.push(ChordName {
                text,
                kind: NameKind::Dyad,
                score: 0,
            });
        }
        _ => {
            let cands = candidates(pc_mask, &pcs, bass_pc, key);
            // Slash-bass readings (§3.4): the notes above the bass as a
            // chord (`Cm6/F`, `C/Db`). Ranked in the common pool — usually
            // alternates, the primary name only when nothing matches `P`.
            let upper_pcs: Vec<u8> = pcs.iter().copied().filter(|&p| p != bass_pc).collect();
            let upper_mask = pc_mask & !(1u16 << bass_pc);
            let mut slash: Vec<Candidate> = Vec::new();
            if upper_pcs.len() >= 3 {
                slash = candidates(upper_mask, &upper_pcs, bass_pc, key);
                // A same-root same-template exact match already reads the
                // bass as a chord tone — the bass-less re-reading is the
                // same chord and would only duplicate it.
                slash.retain(|s| {
                    !cands
                        .iter()
                        .any(|c| c.root_pc == s.root_pc && c.template.id == s.template.id)
                });
                for c in &mut slash {
                    c.score -= 25;
                }
            }
            // (score, root, sort symbol, text, kind, is slash-bass)
            let mut named: Vec<(i32, u8, String, String, NameKind, bool)> = Vec::new();
            for c in &cands {
                let root_sp = root_spelling(c, &pcs, key, settings);
                let tones = tone_spellings(root_sp, c.template, pc_mask, c.root_pc);
                let mut text = format!("{}{}", root_sp, c.sort_symbol());
                if bass_pc != c.root_pc {
                    text.push('/');
                    text.push_str(&tones[&bass_pc].to_string());
                }
                named.push((
                    c.score,
                    c.root_pc,
                    c.sort_symbol(),
                    text,
                    NameKind::Chord,
                    false,
                ));
            }
            for c in &slash {
                let root_sp = root_spelling(c, &upper_pcs, key, settings);
                let text = format!(
                    "{}{}/{}",
                    root_sp,
                    c.sort_symbol(),
                    context_spelling(bass_pc, key, settings)
                );
                named.push((
                    c.score,
                    c.root_pc,
                    c.sort_symbol(),
                    text,
                    NameKind::Chord,
                    true,
                ));
            }
            if let Some((upper, lower)) = polychord(&pcs, bass_pc) {
                let fmt = |(root, minor): (u8, bool)| {
                    let fam = if minor { Family::Min } else { Family::Maj };
                    let sp = default_root(root, fam, settings.accidental_pref);
                    format!("{}{}", sp, if minor { "m" } else { "" })
                };
                named.push((
                    40 + 25, // lower triad always contains the bass
                    bass_pc,
                    String::new(),
                    format!("{}|{}", fmt(upper), fmt(lower)),
                    NameKind::Polychord,
                    false,
                ));
            }
            if sorted.len() >= 3 && sorted.windows(2).all(|w| w[1] - w[0] == 5) {
                let sp = context_spelling(bass_pc, key, settings);
                named.push((
                    30,
                    bass_pc,
                    String::new(),
                    format!("{} quartal({})", sp, sorted.len()),
                    NameKind::Quartal,
                    false,
                ));
            }
            named.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
            let mut seen: Vec<&str> = Vec::new();
            for (score, _, _, text, kind, _) in &named {
                if seen.contains(&text.as_str()) {
                    continue;
                }
                seen.push(text);
                analysis.chord_names.push(ChordName {
                    text: text.clone(),
                    kind: *kind,
                    score: *score,
                });
            }

            match named.first() {
                // Top-ranked template interpretation dictates spelling (§5.1)
                // and drives the Roman numeral / inversion fields. The first
                // exact entry in `named` is always `cands[0]` (same sort key).
                Some((_, _, _, _, NameKind::Chord, false)) => {
                    if let Some(top) = cands.first() {
                        let root_sp = root_spelling(top, &pcs, key, settings);
                        spell = tone_spellings(root_sp, top.template, pc_mask, top.root_pc);
                        analysis.inversion = inversion_of(top, bass_pc);
                        if let Some(k) = key {
                            analysis.roman_numeral = roman::roman(
                                top,
                                root_sp,
                                &k,
                                settings.rn_convention,
                                pc_mask,
                                analysis.inversion,
                            );
                        }
                    }
                }
                // Slash-bass reading on top: upper tones spell per §5.1; the
                // bass falls through to §5.2 below. No inversion, no RN.
                Some((_, _, _, _, NameKind::Chord, true)) => {
                    if let Some(top) = slash.first() {
                        let root_sp = root_spelling(top, &upper_pcs, key, settings);
                        spell = tone_spellings(root_sp, top.template, upper_mask, top.root_pc);
                    }
                }
                _ => {}
            }
            if spell.is_empty() {
                if let Some((upper, lower)) = polychord(&pcs, bass_pc) {
                    for &(root, minor) in &[lower, upper] {
                        let fam = if minor { Family::Min } else { Family::Maj };
                        let root_sp = default_root(root, fam, settings.accidental_pref);
                        let third = if minor { "m3" } else { "M3" };
                        for iv in ["P1", third, "P5"] {
                            let sp = above(root_sp, crate::pitch::ivl(iv).unwrap());
                            spell.insert(sp.pc(), sp);
                        }
                    }
                }
            }
            for &pc in &pcs {
                spell
                    .entry(pc)
                    .or_insert_with(|| context_spelling(pc, key, settings));
            }
            if analysis.chord_names.is_empty() {
                let text = pcs
                    .iter()
                    .map(|pc| spell[pc].to_string())
                    .collect::<Vec<_>>()
                    .join("\u{b7}");
                analysis.chord_names.push(ChordName {
                    text,
                    kind: NameKind::Cluster,
                    score: 0,
                });
            }
        }
    }

    analysis.spelled_notes = sorted
        .iter()
        .map(|&n| SpelledNote::from_midi(n, spell[&(n % 12)]))
        .collect();
    analysis.bass_note = analysis.spelled_notes.first().copied();
    analysis
}

fn dyad_name(semis: u8) -> &'static str {
    [
        "P8", "m2", "M2", "m3", "M3", "P4", "TT", "P5", "m6", "M6", "m7", "M7",
    ][semis as usize]
}

/// Spec §3.1 matching + §3.2 ranking. Sorted best-first.
pub(crate) fn candidates(
    pc_mask: u16,
    pcs: &[u8],
    bass_pc: u8,
    key: Option<Key>,
) -> Vec<Candidate> {
    let diatonic = key.map(|k| k.diatonic_mask());
    let mut out: Vec<Candidate> = Vec::new();
    let mut roots: Vec<u8> = pcs.to_vec();
    roots.sort_unstable();
    for &r in &roots {
        let rel = rotate(pc_mask, r);
        for t in vocab() {
            if rel & t.required_mask != t.required_mask || rel & !t.full_mask != 0 {
                continue;
            }
            let absent: Vec<usize> = t
                .entries
                .iter()
                .enumerate()
                .filter(|(_, e)| e.opt && rel & (1 << (e.ivl.semis % 12)) == 0)
                .map(|(i, _)| i)
                .collect();
            let mut score = t.weight + if bass_pc == r { 25 } else { 0 } + 3 * pcs.len() as i32
                - 6 * absent.len() as i32;
            if let Some(d) = diatonic {
                if d & (1 << r) != 0 {
                    score += 10;
                }
                if pc_mask & !d == 0 {
                    score += 5;
                }
            }
            out.push(Candidate {
                score,
                root_pc: r,
                template: t,
                absent,
            });
        }
    }
    out.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(a.root_pc.cmp(&b.root_pc))
            .then(a.sort_symbol().cmp(&b.sort_symbol()))
    });
    out
}

/// Rotate a pc mask so `root` becomes bit 0.
fn rotate(mask: u16, root: u8) -> u16 {
    let m = mask as u32;
    (((m >> root) | (m << (12 - root as u32))) & 0xfff) as u16
}

/// Spell every input pc that is a tone of the template (spec §5.1).
fn tone_spellings(
    root_sp: SpelledPc,
    template: &Template,
    pc_mask: u16,
    root_pc: u8,
) -> BTreeMap<u8, SpelledPc> {
    let mut m = BTreeMap::new();
    for e in &template.entries {
        let pc = (root_pc + e.ivl.semis) % 12;
        if pc_mask & (1 << pc) != 0 {
            m.insert(pc, above(root_sp, e.ivl));
        }
    }
    m
}

/// Root spelling (spec §5.3): chord-aware in a key, default tables otherwise.
fn root_spelling(c: &Candidate, pcs: &[u8], key: Option<Key>, settings: &Settings) -> SpelledPc {
    let pc_mask: u16 = pcs.iter().map(|&p| 1u16 << p).sum();
    match key {
        Some(k) => {
            let mut best: Option<((i64, i32), SpelledPc)> = None;
            for letter in 0..7u8 {
                for acc in -2i8..=2 {
                    let cand = SpelledPc::new(letter, acc);
                    if cand.pc() != c.root_pc {
                        continue;
                    }
                    let tones = tone_spellings(cand, c.template, pc_mask, c.root_pc);
                    if tones.values().any(|t| t.acc.abs() > 2) {
                        continue;
                    }
                    // mean |LoF - center|, scaled to stay in integers
                    let sum: i64 = tones
                        .values()
                        .map(|t| ((t.lof() - k.center()).abs() as i64) * 1000)
                        .sum();
                    let rank = (sum / tones.len() as i64, cand.lof());
                    if best.is_none_or(|(b, _)| rank < b) {
                        best = Some((rank, cand));
                    }
                }
            }
            best.expect("some root spelling always exists").1
        }
        None => default_root(c.root_pc, c.template.family, settings.accidental_pref),
    }
}

/// Default root tables (spec §5.3).
pub(crate) fn default_root(pc: u8, family: Family, pref: AccidentalPref) -> SpelledPc {
    let natural = [
        Some("C"),
        None,
        Some("D"),
        None,
        Some("E"),
        Some("F"),
        None,
        Some("G"),
        None,
        Some("A"),
        None,
        Some("B"),
    ][pc as usize];
    if let Some(n) = natural {
        return SpelledPc::parse(n).unwrap();
    }
    let table: [&str; 5] = match pref {
        AccidentalPref::Sharps => ["C#", "D#", "F#", "G#", "A#"],
        AccidentalPref::Flats => ["Db", "Eb", "Gb", "Ab", "Bb"],
        AccidentalPref::Auto => match family {
            Family::Maj => ["Db", "Eb", "F#", "Ab", "Bb"],
            Family::Min => ["C#", "Eb", "F#", "G#", "Bb"],
            Family::Dim => ["C#", "D#", "F#", "G#", "A#"],
        },
    };
    let idx = match pc {
        1 => 0,
        3 => 1,
        6 => 2,
        8 => 3,
        _ => 4,
    };
    SpelledPc::parse(table[idx]).unwrap()
}

/// Non-chord-context spelling (spec §5.2): key rule or bare-note table.
fn context_spelling(pc: u8, key: Option<Key>, settings: &Settings) -> SpelledPc {
    match key {
        Some(k) => k.spell_pc(pc),
        None => default_root(pc, Family::Maj, settings.accidental_pref),
    }
}

/// Spec §3.3: inversion index, None for tension basses.
fn inversion_of(c: &Candidate, bass_pc: u8) -> Option<u8> {
    if bass_pc == c.root_pc {
        return None;
    }
    let entry = c
        .template
        .entries
        .iter()
        .find(|e| (c.root_pc + e.ivl.semis) % 12 == bass_pc)?;
    if entry.tension {
        return None;
    }
    let mut core: Vec<&crate::vocab::Entry> = c
        .template
        .entries
        .iter()
        .filter(|e| !e.tension && e.ivl.steps > 0)
        .collect();
    core.sort_by_key(|e| e.ivl.steps);
    core.iter()
        .position(|e| e.name == entry.name)
        .map(|i| i as u8 + 1)
}

/// Spec §3.4: partition into two disjoint complete maj/min triads.
/// Returns ((upper_root, upper_minor), (lower_root, lower_minor)).
fn polychord(pcs: &[u8], bass_pc: u8) -> Option<((u8, bool), (u8, bool))> {
    if pcs.len() != 6 {
        return None;
    }
    let mask: u16 = pcs.iter().map(|&p| 1u16 << p).sum();
    let triad = |root: u8, minor: bool| -> u16 {
        let third = if minor { 3 } else { 4 };
        (1 << root) | (1 << ((root + third) % 12)) | (1 << ((root + 7) % 12))
    };
    for r1 in 0..12u8 {
        for m1 in [false, true] {
            let t1 = triad(r1, m1);
            if mask & t1 != t1 {
                continue;
            }
            for r2 in 0..12u8 {
                for m2 in [false, true] {
                    let t2 = triad(r2, m2);
                    if t1 & t2 != 0 || t1 | t2 != mask {
                        continue;
                    }
                    let (a, b) = ((r1, m1), (r2, m2));
                    // lower = the triad containing the bass
                    return if t1 & (1 << bass_pc) != 0 {
                        Some((b, a))
                    } else {
                        Some((a, b))
                    };
                }
            }
        }
    }
    None
}

/// Display-language mapping (spec §5.4): affects letters only.
pub fn note_display(sp: SpelledPc, lang: NameLanguage) -> String {
    match lang {
        NameLanguage::English => sp.to_string(),
        NameLanguage::German => {
            if sp.letter == 6 && sp.acc == 0 {
                "H".to_string()
            } else if sp.letter == 6 && sp.acc == -1 {
                "B".to_string()
            } else {
                sp.to_string()
            }
        }
        NameLanguage::Solfege => {
            let syllable = ["Do", "Re", "Mi", "Fa", "Sol", "La", "Si"][sp.letter as usize];
            format!("{}{}", syllable, sp.acc_str())
        }
    }
}
