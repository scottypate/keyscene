//! Normative vector tests (docs/engine-spec.md §8). Vector files are
//! embedded so the identical suite runs on native and WASM targets.

use keyscene_core::{analyze, AccidentalPref, Key, RnConvention, Settings};
use serde::Deserialize;

#[derive(Deserialize)]
struct SpellingVec {
    id: String,
    notes: Vec<u8>,
    key: Option<String>,
    #[serde(default)]
    accidental_pref: Option<String>,
    expect: Vec<String>,
}

#[derive(Deserialize)]
struct NamingVec {
    id: String,
    notes: Vec<u8>,
    key: Option<String>,
    #[serde(default)]
    accidental_pref: Option<String>,
    expect_top: Option<String>,
    #[serde(default)]
    expect_alternates_include: Vec<String>,
}

#[derive(Deserialize)]
struct RomanVec {
    id: String,
    notes: Vec<u8>,
    key: String,
    convention: String,
    expect: Option<String>,
}

fn settings(pref: &Option<String>, convention: Option<&str>) -> Settings {
    Settings {
        accidental_pref: match pref.as_deref() {
            Some("sharps") => AccidentalPref::Sharps,
            Some("flats") => AccidentalPref::Flats,
            _ => AccidentalPref::Auto,
        },
        rn_convention: match convention {
            Some("quality") => RnConvention::Quality,
            _ => RnConvention::Textbook,
        },
        ..Settings::default()
    }
}

fn key_of(name: &Option<String>) -> Option<Key> {
    name.as_ref()
        .map(|n| Key::from_name(n).expect("bad key in vector"))
}

#[test]
fn spelling_vectors() {
    let vecs: Vec<SpellingVec> =
        serde_json::from_str(include_str!("vectors/spelling.json")).unwrap();
    assert!(
        vecs.len() >= 200,
        "PLAN.md Phase 1 requires >=200 spelling vectors"
    );
    let mut failures = Vec::new();
    for v in &vecs {
        let a = analyze(
            &v.notes,
            key_of(&v.key),
            &settings(&v.accidental_pref, None),
        );
        let got: Vec<String> = a.spelled_notes.iter().map(|s| s.to_string()).collect();
        if got != v.expect {
            failures.push(format!("{}: expected {:?}, got {:?}", v.id, v.expect, got));
        }
    }
    assert!(
        failures.is_empty(),
        "{} spelling failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn naming_vectors() {
    let vecs: Vec<NamingVec> = serde_json::from_str(include_str!("vectors/naming.json")).unwrap();
    assert!(
        vecs.len() >= 300,
        "PLAN.md Phase 1 requires >=300 naming vectors"
    );
    let mut failures = Vec::new();
    for v in &vecs {
        let a = analyze(
            &v.notes,
            key_of(&v.key),
            &settings(&v.accidental_pref, None),
        );
        let names: Vec<&str> = a.chord_names.iter().map(|c| c.text.as_str()).collect();
        if let Some(expect_top) = &v.expect_top {
            if names.first() != Some(&expect_top.as_str()) {
                failures.push(format!(
                    "{}: expected top {:?}, got {:?} (all: {:?})",
                    v.id,
                    expect_top,
                    names.first(),
                    names
                ));
            }
        }
        for alt in &v.expect_alternates_include {
            if !names.contains(&alt.as_str()) {
                failures.push(format!(
                    "{}: expected alternate {:?} in {:?}",
                    v.id, alt, names
                ));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} naming failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn roman_vectors() {
    let vecs: Vec<RomanVec> = serde_json::from_str(include_str!("vectors/roman.json")).unwrap();
    assert!(
        vecs.len() >= 100,
        "PLAN.md Phase 1 requires >=100 Roman-numeral vectors"
    );
    let mut failures = Vec::new();
    for v in &vecs {
        let key = Some(Key::from_name(&v.key).expect("bad key in vector"));
        let a = analyze(&v.notes, key, &settings(&None, Some(&v.convention)));
        if a.roman_numeral != v.expect {
            failures.push(format!(
                "{}: expected {:?}, got {:?} (top: {:?})",
                v.id,
                v.expect,
                a.roman_numeral,
                a.chord_names.first().map(|c| &c.text)
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} roman failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
