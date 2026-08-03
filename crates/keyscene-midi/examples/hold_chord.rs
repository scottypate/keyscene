//! Dev helper: create a virtual MIDI source and hold a chord, so the app
//! can be exercised with real MIDI and no hardware (macOS/Linux only —
//! WinMM has no virtual ports, ADR-002).
//!
//! Run: cargo run -p keyscene-midi --example hold_chord -- 60 64 67
//! Holds the notes for 15 s (SECS env var overrides), then releases.

#[cfg(unix)]
fn main() {
    use midir::os::unix::VirtualOutput;

    let notes: Vec<u8> = std::env::args()
        .skip(1)
        .filter_map(|a| a.parse().ok())
        .collect();
    let notes = if notes.is_empty() {
        vec![60, 64, 67]
    } else {
        notes
    };
    let secs: u64 = std::env::var("SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(15);

    let out = midir::MidiOutput::new("keyscene-test").expect("midi output");
    let mut conn = out
        .create_virtual("Keyscene Test Source")
        .expect("virtual port");
    // Give listeners a moment to see the new port (hot-plug poll is 1 s).
    std::thread::sleep(std::time::Duration::from_secs(3));
    for &n in &notes {
        conn.send(&[0x90, n, 80]).unwrap();
    }
    println!("holding {notes:?} for {secs}s");
    std::thread::sleep(std::time::Duration::from_secs(secs));
    for &n in &notes {
        conn.send(&[0x80, n, 0]).unwrap();
    }
    std::thread::sleep(std::time::Duration::from_millis(200));
}

#[cfg(not(unix))]
fn main() {
    eprintln!("virtual MIDI ports are not available on Windows (use loopMIDI)");
}
