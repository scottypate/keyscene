//! App settings (persisted) and the payloads crossing the IPC boundary.
//! Wire shapes mirror ui/shared/src/types.ts — keep the two in sync.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use keyscene_core::{analyze, Analysis, Key};
use keyscene_midi::{NoteTracker, Pedals};
use serde::{Deserialize, Serialize};

/// One movable Display-mode element (§3.4). x/y in percent of the window
/// (top-left corner), scale multiplies the element's base size.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ElementLayout {
    pub visible: bool,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}

impl Default for ElementLayout {
    fn default() -> Self {
        Self {
            visible: true,
            x: 0.0,
            y: 0.0,
            scale: 1.0,
        }
    }
}

fn at(x: f64, y: f64, visible: bool) -> ElementLayout {
    ElementLayout {
        visible,
        x,
        y,
        scale: 1.0,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DisplayElements {
    pub chord_card: ElementLayout,
    pub staff: ElementLayout,
    pub keyboard: ElementLayout,
    pub pedals: ElementLayout,
    pub key_readout: ElementLayout,
}

impl Default for DisplayElements {
    fn default() -> Self {
        // Mirrors the "Default" built-in preset in ui/studio/src/display.ts.
        Self {
            chord_card: at(31.0, 8.0, true),
            staff: at(34.0, 32.0, true),
            keyboard: at(11.0, 64.0, true),
            pedals: at(45.0, 92.0, true),
            key_readout: at(4.0, 8.0, true),
        }
    }
}

/// A user-saved Display layout (§3.4). Built-ins live in the UI, not here.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutPreset {
    pub name: String,
    pub background: String,
    pub elements: DisplayElements,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DisplaySettings {
    /// "transparent" or a CSS color (solid = chroma-key background).
    pub background: String,
    pub always_on_top: bool,
    pub click_through: bool,
    pub elements: DisplayElements,
    pub presets: Vec<LayoutPreset>,
}

impl Default for DisplaySettings {
    fn default() -> Self {
        Self {
            background: "transparent".into(),
            always_on_top: false,
            click_through: false,
            elements: DisplayElements::default(),
            presets: Vec::new(),
        }
    }
}

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
    /// Theme preset id (ui/shared THEMES) or "custom".
    pub theme: String,
    /// Token overrides used when theme == "custom"; opaque to the backend.
    pub custom_theme: HashMap<String, String>,
    /// Chord-hold anti-flicker time in ms (§3.4); 0 disables.
    pub hold_ms: u32,
    pub display: DisplaySettings,
    /// First-run Display-mode guidance has been dismissed.
    pub display_help_seen: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            engine: keyscene_core::Settings::default(),
            include_sustained: true,
            channel_mask: 0xFFFF,
            keyboard_size: 88,
            last_device: None,
            key: None,
            show_chord_card: true,
            show_staff: true,
            show_keyboard: true,
            theme: "light".into(),
            custom_theme: HashMap::new(),
            hold_ms: 0,
            display: DisplaySettings::default(),
            display_help_seen: false,
        }
    }
}

impl AppSettings {
    pub fn selected_key(&self) -> Option<Key> {
        self.key.as_deref().and_then(Key::from_name)
    }

    pub fn load(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(s) => match serde_json::from_str::<Self>(&s) {
                Ok(settings) => settings.sanitized(),
                Err(e) => {
                    // Keep the evidence instead of silently overwriting a
                    // corrupt (or hand-edited) file with defaults.
                    eprintln!("keyscene: settings.json unreadable ({e}); backing up");
                    let _ = std::fs::rename(path, path.with_extension("json.bak"));
                    Self::default()
                }
            },
            Err(_) => Self::default(),
        }
    }

    /// Clamp values a hand-edited or migrated file could break the UI with.
    fn sanitized(mut self) -> Self {
        if ![49, 61, 76, 88].contains(&self.keyboard_size) {
            self.keyboard_size = 88;
        }
        self.hold_ms = self.hold_ms.min(2000);
        self
    }

    /// Atomic save: a crash mid-write must never truncate the settings.
    pub fn save(&self, path: &Path) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let Ok(json) = serde_json::to_string_pretty(self) else {
            return;
        };
        let tmp = path.with_extension("json.tmp");
        let ok = std::fs::write(&tmp, json).is_ok()
            && std::fs::File::open(&tmp).and_then(|f| f.sync_all()).is_ok()
            && std::fs::rename(&tmp, path).is_ok();
        if !ok {
            eprintln!("keyscene: failed to save settings to {}", path.display());
        }
    }
}

/// Note-driven UI state, emitted as the "state" event on every MIDI change
/// and returned by get_state. Settings travel separately on the "settings"
/// event (emitted only when they change) so the per-note hot path stays
/// lean and the UI never rewrites settings controls mid-performance.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatePayload {
    pub analysis: Analysis,
    pub held: Vec<u8>,
    pub sustained: Vec<u8>,
    pub pedals: Pedals,
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
        }
    }
}
