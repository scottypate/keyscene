//! Generates the expected-results table for docs/phase2-manual-test.md.
//! Run: cargo run -p keyscene-core --example phase2_script
//! The doc's table is this output, pasted — regenerate after engine changes.

use keyscene_core::{analyze, Key, Settings};

fn note_name(midi: u8) -> String {
    const N: [&str; 12] = [
        "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
    ];
    format!("{}{}", N[(midi % 12) as usize], (midi / 12) as i32 - 1)
}

fn main() {
    // (key context, notes, what the step exercises)
    let steps: &[(&str, &[u8], &str)] = &[
        ("C", &[60, 64, 67], "major triad"),
        ("C", &[55, 59, 62, 65], "dominant 7th"),
        ("C", &[57, 60, 64, 67], "minor 7th"),
        ("C", &[57, 60, 65], "1st-inversion slash"),
        ("C", &[62, 65, 69, 72], "ii7"),
        ("C", &[64, 68, 71], "secondary dominant, G# not Ab"),
        ("C", &[58, 62, 65], "borrowed bVII"),
        ("C", &[60, 64, 67, 71, 74], "extended maj9"),
        ("C", &[48, 52, 56, 58, 63], "altered dominant, multi-name"),
        ("C", &[60, 65, 70], "quartal stack"),
        ("Eb", &[63, 67, 70], "flat-key spelling"),
        ("Eb", &[58, 62, 65, 68], "V7 in flat key"),
        ("Eb", &[48, 51, 55, 58], "vi7 in flat key"),
        ("Eb", &[53, 56, 60, 63], "ii7 in flat key"),
        ("Am", &[57, 60, 64], "minor tonic"),
        ("Am", &[64, 68, 71, 74], "V7 in minor, G# leading tone"),
        ("Am", &[56, 59, 62, 65], "leading-tone dim7"),
        ("Am", &[62, 65, 69, 72], "iv7 in minor"),
        ("", &[61, 65, 68], "no key: accidental preference"),
        ("", &[50, 57, 66, 73], "wide sus voicing across octaves"),
    ];

    let settings = Settings::default();
    println!("| # | Key | Play | Expect name | Alternates | Spelling | RN |");
    println!("|---|-----|------|-------------|------------|----------|----|");
    for (i, (key_name, notes, what)) in steps.iter().enumerate() {
        let key = if key_name.is_empty() {
            None
        } else {
            Key::from_name(key_name)
        };
        let a = analyze(notes, key, &settings);
        let names: Vec<&str> = a.chord_names.iter().map(|n| n.text.as_str()).collect();
        let played: Vec<String> = notes.iter().map(|&n| note_name(n)).collect();
        let spelled: Vec<String> = a.spelled_notes.iter().map(|s| s.to_string()).collect();
        println!(
            "| {} | {} | {} | **{}** | {} | {} | {} |",
            i + 1,
            if key_name.is_empty() { "—" } else { key_name },
            played.join(" "),
            names.first().copied().unwrap_or("(none)"),
            if names.len() > 1 {
                names[1..names.len().min(4)].join(", ")
            } else {
                "—".into()
            },
            spelled.join(" "),
            a.roman_numeral.as_deref().unwrap_or("—"),
        );
        let _ = what;
    }
}
