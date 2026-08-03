//! Spike A (PLAN.md Phase 0): MIDI input latency harness.
//!
//! Measures the software-stack cost of our input path (OS MIDI routing →
//! `midir` callback) so Phase 2 can budget the remaining pipeline
//! (analysis → IPC → paint) inside the ~30ms perceived-latency target.
//!
//! Modes:
//!   list               list MIDI input ports
//!   loopback [PAIRS]   create a virtual source, send PAIRS NoteOn/NoteOff
//!                      pairs through the OS, measure send→callback latency
//!                      (unix only; on Windows use loopMIDI + `listen`)
//!   listen INDEX       connect to input port INDEX and log decoded events
//!                      with inter-arrival times (for real-hardware checks)

use std::error::Error;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use midir::{Ignore, MidiInput};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("list") | None => list(),
        Some("loopback") => {
            let pairs = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(250usize);
            loopback(pairs)
        }
        Some("listen") => match args.get(1).and_then(|s| s.parse().ok()) {
            Some(idx) => listen(idx),
            None => Err("usage: spike_a_latency listen <port-index>".into()),
        },
        Some(other) => Err(format!("unknown mode {other:?} (list | loopback | listen)").into()),
    };
    if let Err(e) = result {
        eprintln!("spike-a: error: {e}");
        std::process::exit(1);
    }
}

fn list() -> Result<(), Box<dyn Error>> {
    let ports = keyscene_midi::input_port_names()?;
    if ports.is_empty() {
        println!("No MIDI input devices found.");
    }
    for (i, p) in ports.iter().enumerate() {
        println!("[{i}] {p}");
    }
    Ok(())
}

/// Log events from a real device. Prints decoded message, midir timestamp
/// delta, and wall-clock inter-arrival time.
fn listen(index: usize) -> Result<(), Box<dyn Error>> {
    let mut midi_in = MidiInput::new("keyscene-spike-a")?;
    midi_in.ignore(Ignore::None);
    let ports = midi_in.ports();
    let port = ports.get(index).ok_or("port index out of range")?;
    let name = midi_in.port_name(port)?;
    println!("listening on [{index}] {name} — play something, Ctrl-C to stop");

    let mut last: Option<(u64, Instant)> = None;
    let _conn = midi_in.connect(
        port,
        "keyscene-spike-a-listen",
        move |ts, msg, _| {
            let now = Instant::now();
            let (dts_us, dwall) = match last {
                Some((pts, pwall)) => (ts.saturating_sub(pts), now - pwall),
                None => (0, Duration::ZERO),
            };
            last = Some((ts, now));
            println!(
                "{:>10}µs  Δts {:>8}µs  Δwall {:>8.3}ms  {}",
                ts,
                dts_us,
                dwall.as_secs_f64() * 1e3,
                decode(msg)
            );
        },
        (),
    )?;
    // Park forever; Ctrl-C exits.
    loop {
        std::thread::sleep(Duration::from_secs(3600));
    }
}

fn decode(msg: &[u8]) -> String {
    match msg {
        [s, n, v] if s & 0xf0 == 0x90 && *v > 0 => {
            format!("NoteOn  ch{} {} vel {v}", (s & 0x0f) + 1, note_name(*n))
        }
        [s, n, v] if s & 0xf0 == 0x80 || (s & 0xf0 == 0x90 && *v == 0) => {
            format!("NoteOff ch{} {}", (s & 0x0f) + 1, note_name(*n))
        }
        [s, 64, v] if s & 0xf0 == 0xb0 => format!("Sustain ch{} {v}", (s & 0x0f) + 1),
        _ => format!("{msg:02x?}"),
    }
}

fn note_name(n: u8) -> String {
    const NAMES: [&str; 12] = [
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    ];
    format!("{}{}", NAMES[n as usize % 12], (n / 12) as i8 - 1)
}

/// Round-trip through the OS MIDI router via a virtual source. This bounds
/// the OS-routing + midir-callback cost; a hardware controller adds USB/BLE
/// transport on top, which we cannot measure without a reference rig.
#[cfg(unix)]
fn loopback(pairs: usize) -> Result<(), Box<dyn Error>> {
    use midir::os::unix::VirtualOutput;
    use midir::MidiOutput;

    const PORT_NAME: &str = "keyscene-spike-a-src";
    let midi_out = MidiOutput::new("keyscene-spike-a")?;
    let mut conn_out = midi_out.create_virtual(PORT_NAME)?;
    // Give the OS a moment to surface the new virtual source.
    std::thread::sleep(Duration::from_millis(400));

    let mut midi_in = MidiInput::new("keyscene-spike-a-in")?;
    midi_in.ignore(Ignore::None);
    let ports = midi_in.ports();
    let port = ports
        .iter()
        .find(|p| {
            midi_in
                .port_name(p)
                .map(|n| n.contains(PORT_NAME))
                .unwrap_or(false)
        })
        .ok_or("virtual source did not appear as an input port")?;

    let epoch = Instant::now();
    let (tx, rx) = mpsc::channel::<(Vec<u8>, Duration)>();
    let _conn_in = midi_in.connect(
        port,
        "keyscene-spike-a-loopback",
        move |_ts, msg, _| {
            let _ = tx.send((msg.to_vec(), epoch.elapsed()));
        },
        (),
    )?;

    println!("spike-a: loopback over virtual source, {pairs} NoteOn/NoteOff pairs…");
    let mut sent: Vec<(Vec<u8>, Duration)> = Vec::with_capacity(pairs * 2);
    for i in 0..pairs {
        let note = 36 + (i % 48) as u8;
        for msg in [[0x90, note, 100], [0x80, note, 0]] {
            sent.push((msg.to_vec(), epoch.elapsed()));
            conn_out.send(&msg)?;
            std::thread::sleep(Duration::from_millis(4));
        }
    }

    let mut received = Vec::with_capacity(sent.len());
    while received.len() < sent.len() {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(r) => received.push(r),
            Err(_) => break,
        }
    }
    if received.len() != sent.len() {
        println!(
            "warning: sent {} messages, received {} (lost {})",
            sent.len(),
            received.len(),
            sent.len() - received.len()
        );
    }

    let mut latencies_us: Vec<u64> = sent
        .iter()
        .zip(&received)
        .map(|((smsg, sat), (rmsg, rat))| {
            assert_eq!(smsg, rmsg, "out-of-order or corrupted delivery");
            rat.saturating_sub(*sat).as_micros() as u64
        })
        .collect();
    latencies_us.sort_unstable();
    report(&latencies_us);
    Ok(())
}

#[cfg(not(unix))]
fn loopback(_pairs: usize) -> Result<(), Box<dyn Error>> {
    Err(
        "virtual MIDI ports are not supported by the OS API on Windows. \
         Install loopMIDI, create a port, feed it from another tool, and use \
         `listen` — or run this on a Win11 24H2+ box once Windows MIDI \
         Services virtual-device support is wired up (see ADR-002)."
            .into(),
    )
}

#[cfg(unix)]
fn report(sorted_us: &[u64]) {
    if sorted_us.is_empty() {
        println!("no samples");
        return;
    }
    let pct = |p: f64| sorted_us[((sorted_us.len() - 1) as f64 * p) as usize];
    let mean = sorted_us.iter().sum::<u64>() as f64 / sorted_us.len() as f64;
    println!(
        "\nsend → midir-callback latency ({} samples):",
        sorted_us.len()
    );
    println!("  min    {:>8.3} ms", sorted_us[0] as f64 / 1e3);
    println!("  median {:>8.3} ms", pct(0.50) as f64 / 1e3);
    println!("  mean   {:>8.3} ms", mean / 1e3);
    println!("  p95    {:>8.3} ms", pct(0.95) as f64 / 1e3);
    println!("  p99    {:>8.3} ms", pct(0.99) as f64 / 1e3);
    println!(
        "  max    {:>8.3} ms",
        sorted_us[sorted_us.len() - 1] as f64 / 1e3
    );
    let budget_ms = 30.0;
    let p99_ms = pct(0.99) as f64 / 1e3;
    println!(
        "\nverdict: OS-routing+callback p99 = {p99_ms:.3} ms of the {budget_ms:.0} ms \
         end-to-end budget (§2.3.2) → leaves {:.1} ms for analysis + IPC + paint",
        budget_ms - p99_ms
    );
}
