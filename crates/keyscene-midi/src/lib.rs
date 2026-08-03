//! keyscene-midi: device enumeration, input streams, hot-plug detection.
//!
//! Requirements (PLAN.md §3.1): all channels by default, sustain/soft/
//! sostenuto pedal tracking, QWERTY fallback, graceful multi-client
//! degradation on Windows.

use midir::MidiInput;

/// List the names of all currently available MIDI input ports.
pub fn input_port_names() -> Result<Vec<String>, midir::InitError> {
    let midi_in = MidiInput::new("keyscene")?;
    Ok(midi_in
        .ports()
        .iter()
        .filter_map(|p| midi_in.port_name(p).ok())
        .collect())
}
