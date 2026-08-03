//! keyscene-midi: device enumeration, input streams, hot-plug detection.
//!
//! Requirements (PLAN.md §3.1): all channels by default, sustain/soft/
//! sostenuto pedal tracking, QWERTY fallback (frontend feeds synthetic
//! NoteOn/NoteOff through the same [`NoteTracker`]), graceful multi-client
//! degradation on Windows (see [`ConnectError::DeviceBusy`]).

mod service;
mod tracker;

pub use service::{
    best_match, classify_connect_failure, connect, list_inputs, spawn_hotplug_watcher,
    ConnectError, DeviceInfo, HotplugWatcher,
};
pub use tracker::{parse, MidiMsg, NoteTracker, Pedals, CC_SOFT, CC_SOSTENUTO, CC_SUSTAIN};

/// Re-export so dependents can hold a connection without a direct midir dep.
pub use midir::MidiInputConnection;

/// List the names of all currently available MIDI input ports.
pub fn input_port_names() -> Result<Vec<String>, midir::InitError> {
    Ok(list_inputs()?.into_iter().map(|d| d.name).collect())
}
