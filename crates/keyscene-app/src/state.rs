//! App settings (persisted) and the payloads crossing the IPC boundary.
//! Wire shapes mirror ui/shared/src/types.ts — keep the two in sync.

use std::path::{Path, PathBuf};

use keyscene_core::{analyze, Analysis, Key};
use keyscene_midi::{NoteTracker, Pedals};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub engine: keyscene_core::Settings,
    /// Analysis includes pedal-sustained notes (§3.1 user toggle).
    pub include_sustained: bool,
    /// Bit i = listen to MIDI channel i. 0xFFFF = all (the default; §3.1).
    pub channel_mask: u16,
    pub keyboard_size: u8,
    /// Remembered device name; matched tolerantly on reconnect (ADR-002).
    pub last_device: Option<String>,
    /// Selected key name ("C", "F#m"); None = no key context.
    pub key: Option<String>,
    pub show_chord_card: bool,
    pub show_staff: bool,
    pub show_keyboard: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            engine: keyscene_core::Settings::default(),
            include_sustained: true,
            channel_mask: 0xFFFF,
            keyboard_size: 61,
            last_device: None,
            key: None,
            show_chord_card: true,
            show_staff: true,
            show_keyboard: true,
        }
    }
}

impl AppSettings {
    pub fn selected_key(&self) -> Option<Key> {
        self.key.as_deref().and_then(Key::from_name)
    }

    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(path, json);
        }
    }
}

/// Full UI state, emitted as the "state" event and returned by get_state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatePayload {
    pub analysis: Analysis,
    pub held: Vec<u8>,
    pub sustained: Vec<u8>,
    pub pedals: Pedals,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicesPayload {
    pub devices: Vec<keyscene_midi::DeviceInfo>,
    pub current: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiErrorPayload {
    pub kind: String,
    pub detail: String,
    pub device: String,
}

impl MidiErrorPayload {
    pub fn from_connect(err: &keyscene_midi::ConnectError, device: &str) -> Self {
        let (kind, detail) = match err {
            keyscene_midi::ConnectError::DeviceBusy(d) => ("deviceBusy", d.clone()),
            keyscene_midi::ConnectError::NotFound(d) => ("notFound", d.clone()),
            keyscene_midi::ConnectError::Other(d) => ("other", d.clone()),
        };
        Self {
            kind: kind.into(),
            detail,
            device: device.into(),
        }
    }
}

/// Analysis-side state: the tracker plus settings, guarded by one mutex.
pub struct Engine {
    pub tracker: NoteTracker,
    pub settings: AppSettings,
    pub settings_path: PathBuf,
}

impl Engine {
    pub fn payload(&self) -> StatePayload {
        let sounding = self.tracker.sounding(self.settings.include_sustained);
        let analysis = analyze(
            &sounding,
            self.settings.selected_key(),
            &self.settings.engine,
        );
        StatePayload {
            analysis,
            held: self.tracker.held_notes(),
            sustained: self.tracker.sustained_notes(),
            pedals: self.tracker.pedals(),
            settings: self.settings.clone(),
        }
    }

    pub fn save_settings(&self) {
        self.settings.save(&self.settings_path);
    }
}
