//! Device enumeration, connection, and hot-plug detection.
//!
//! midir has no hot-plug callback API, so [`spawn_hotplug_watcher`] polls
//! the port list. Connection errors are classified so the app can show the
//! targeted Windows "device busy" help panel (§3.1, ADR-002) instead of a
//! generic error.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use midir::{MidiInput, MidiInputConnection};

/// One MIDI input port as shown to the UI.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub index: usize,
    pub name: String,
}

/// Why a connect failed, in product terms (§3.1).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "detail")]
pub enum ConnectError {
    /// Another client (typically a DAW) holds the port — single-client
    /// WinMM. Drives the loopMIDI help panel; never shown on macOS.
    DeviceBusy(String),
    /// The port disappeared between enumeration and connect.
    NotFound(String),
    Other(String),
}

impl std::fmt::Display for ConnectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectError::DeviceBusy(d) => write!(f, "device busy: {d}"),
            ConnectError::NotFound(d) => write!(f, "device not found: {d}"),
            ConnectError::Other(d) => write!(f, "{d}"),
        }
    }
}

/// Heuristic classification of a connect-failure message. WinMM's
/// MMSYSERR_ALLOCATED surfaces as "allocated"; other stacks say "busy" or
/// "in use". Documented, unit-tested, and conservative: unknown text stays
/// `Other` so we never show the loopMIDI panel for the wrong reason.
pub fn classify_connect_failure(detail: &str) -> ConnectError {
    let lower = detail.to_lowercase();
    if ["allocated", "busy", "in use", "already open"]
        .iter()
        .any(|s| lower.contains(s))
    {
        ConnectError::DeviceBusy(detail.to_string())
    } else {
        ConnectError::Other(detail.to_string())
    }
}

/// List input ports.
pub fn list_inputs() -> Result<Vec<DeviceInfo>, midir::InitError> {
    let midi_in = MidiInput::new("keyscene")?;
    Ok(midi_in
        .ports()
        .iter()
        .enumerate()
        .filter_map(|(index, p)| {
            midi_in
                .port_name(p)
                .ok()
                .map(|name| DeviceInfo { index, name })
        })
        .collect())
}

/// Pick the port matching a remembered device name. WMS-redirected and
/// classic WinMM views of the same hardware compose names differently
/// (ADR-002 §3), so matching is tolerant: exact, then case-insensitive,
/// then substring either way, then best word overlap.
pub fn best_match(saved: &str, ports: &[DeviceInfo]) -> Option<usize> {
    if saved.is_empty() {
        return None;
    }
    if let Some(d) = ports.iter().find(|d| d.name == saved) {
        return Some(d.index);
    }
    let saved_l = saved.to_lowercase();
    if let Some(d) = ports.iter().find(|d| d.name.to_lowercase() == saved_l) {
        return Some(d.index);
    }
    if let Some(d) = ports.iter().find(|d| {
        let n = d.name.to_lowercase();
        n.contains(&saved_l) || saved_l.contains(&n)
    }) {
        return Some(d.index);
    }
    let saved_words: Vec<&str> = saved_l.split_whitespace().collect();
    ports
        .iter()
        .map(|d| {
            let name_l = d.name.to_lowercase();
            let score = saved_words
                .iter()
                .filter(|w| w.len() > 1 && name_l.contains(*w))
                .count();
            (score, d.index)
        })
        .filter(|&(score, _)| score > 0)
        .max_by_key(|&(score, _)| score)
        .map(|(_, index)| index)
}

/// Open an input port by index. `on_message` receives (timestamp_micros,
/// raw bytes) on midir's callback thread; keep it cheap (parse + send on a
/// channel).
pub fn connect(
    index: usize,
    mut on_message: impl FnMut(u64, &[u8]) + Send + 'static,
) -> Result<MidiInputConnection<()>, ConnectError> {
    let mut midi_in = MidiInput::new("keyscene").map_err(|e| ConnectError::Other(e.to_string()))?;
    // Listen to everything; filtering happens in NoteTracker.
    midi_in.ignore(midir::Ignore::None);
    let ports = midi_in.ports();
    let port = ports
        .get(index)
        .ok_or_else(|| ConnectError::NotFound(format!("port index {index}")))?;
    midi_in
        .connect(
            port,
            "keyscene-in",
            move |ts, bytes, _| on_message(ts, bytes),
            (),
        )
        .map_err(|e| classify_connect_failure(&e.to_string()))
}

/// Handle to the hot-plug polling thread; dropping it stops the thread.
pub struct HotplugWatcher {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Drop for HotplugWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Poll the port list every `interval`, calling `on_change` with the new
/// list whenever it differs (covers plug AND unplug, §3.1).
pub fn spawn_hotplug_watcher(
    interval: Duration,
    mut on_change: impl FnMut(Vec<DeviceInfo>) + Send + 'static,
) -> HotplugWatcher {
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let handle = std::thread::Builder::new()
        .name("keyscene-midi-hotplug".into())
        .spawn(move || {
            let mut last: Option<Vec<DeviceInfo>> = None;
            while !stop2.load(Ordering::Relaxed) {
                if let Ok(now) = list_inputs() {
                    if last.as_ref() != Some(&now) {
                        let first = last.is_none();
                        last = Some(now.clone());
                        // Skip the initial snapshot; the app already
                        // enumerated at startup.
                        if !first {
                            on_change(now);
                        }
                    }
                }
                // Sleep in short slices so drop() joins promptly.
                let mut slept = Duration::ZERO;
                while slept < interval && !stop2.load(Ordering::Relaxed) {
                    let slice = Duration::from_millis(50).min(interval - slept);
                    std::thread::sleep(slice);
                    slept += slice;
                }
            }
        })
        .expect("spawn hotplug watcher");
    HotplugWatcher {
        stop,
        handle: Some(handle),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ports(names: &[&str]) -> Vec<DeviceInfo> {
        names
            .iter()
            .enumerate()
            .map(|(index, n)| DeviceInfo {
                index,
                name: n.to_string(),
            })
            .collect()
    }

    #[test]
    fn busy_classification() {
        assert!(matches!(
            classify_connect_failure("The specified resource is already allocated"),
            ConnectError::DeviceBusy(_)
        ));
        assert!(matches!(
            classify_connect_failure("Port is in use by another application"),
            ConnectError::DeviceBusy(_)
        ));
        assert!(matches!(
            classify_connect_failure("unknown driver error 7"),
            ConnectError::Other(_)
        ));
    }

    #[test]
    fn best_match_exact_then_fuzzy() {
        let p = ports(&["IAC Driver Bus 1", "Roland FP-30X", "loopMIDI Port"]);
        assert_eq!(best_match("Roland FP-30X", &p), Some(1));
        assert_eq!(best_match("roland fp-30x", &p), Some(1));
        // WMS recomposed name still finds the hardware (substring).
        assert_eq!(best_match("FP-30X", &p), Some(1));
        assert_eq!(best_match("Roland FP-30X MIDI 1 [WMS]", &p), Some(1));
        assert_eq!(best_match("Nord Stage 4", &p), None);
        assert_eq!(best_match("", &p), None);
    }
}
