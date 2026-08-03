//! Owns the live MIDI connection: connect/disconnect, hot-plug reactions
//! (§3.1 unplug/replug survival), and pushing state to the webview.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use keyscene_midi::MidiInputConnection;
use tauri::{AppHandle, Emitter};

use crate::state::{DevicesPayload, Engine, MidiErrorPayload};

pub struct MidiHost {
    pub engine: Mutex<Engine>,
    /// Kept separate from `engine` so the midir callback (which locks
    /// `engine`) can never deadlock against connect/disconnect.
    conn: Mutex<Option<MidiInputConnection<()>>>,
    current_device: Mutex<Option<String>>,
    watcher: Mutex<Option<keyscene_midi::HotplugWatcher>>,
}

impl MidiHost {
    pub fn new(engine: Engine) -> Arc<Self> {
        Arc::new(Self {
            engine: Mutex::new(engine),
            conn: Mutex::new(None),
            current_device: Mutex::new(None),
            watcher: Mutex::new(None),
        })
    }

    pub fn current_device(&self) -> Option<String> {
        self.current_device.lock().unwrap().clone()
    }

    pub fn devices_payload(&self) -> DevicesPayload {
        DevicesPayload {
            devices: keyscene_midi::list_inputs().unwrap_or_default(),
            current: self.current_device(),
        }
    }

    pub fn emit_state(self: &Arc<Self>, app: &AppHandle) {
        let payload = self.engine.lock().unwrap().payload();
        let _ = app.emit("state", payload);
    }

    pub fn emit_devices(self: &Arc<Self>, app: &AppHandle) {
        let _ = app.emit("devices", self.devices_payload());
    }

    pub fn disconnect(self: &Arc<Self>, app: &AppHandle) {
        *self.conn.lock().unwrap() = None;
        *self.current_device.lock().unwrap() = None;
        // Release anything still sounding so no ghost chord lingers.
        self.engine.lock().unwrap().tracker.all_off();
        self.emit_state(app);
        self.emit_devices(app);
    }

    /// Connect to a port by index. On success remembers the device name in
    /// settings (§3.1 "remember last-used device") and re-emits state.
    pub fn connect(
        self: &Arc<Self>,
        app: &AppHandle,
        index: usize,
    ) -> Result<(), MidiErrorPayload> {
        let devices = keyscene_midi::list_inputs().unwrap_or_default();
        let name = devices
            .iter()
            .find(|d| d.index == index)
            .map(|d| d.name.clone())
            .ok_or_else(|| MidiErrorPayload {
                kind: "notFound".into(),
                detail: format!("no input port at index {index}"),
                device: format!("#{index}"),
            })?;

        // Drop any existing connection before opening the next one.
        *self.conn.lock().unwrap() = None;

        let host = self.clone();
        let app2 = app.clone();
        let conn = keyscene_midi::connect(index, move |_ts, bytes| {
            if let Some(msg) = keyscene_midi::parse(bytes) {
                let changed = host.engine.lock().unwrap().tracker.apply(msg);
                if changed {
                    host.emit_state(&app2);
                }
            }
        })
        .map_err(|e| MidiErrorPayload::from_connect(&e, &name))?;

        *self.conn.lock().unwrap() = Some(conn);
        *self.current_device.lock().unwrap() = Some(name.clone());
        {
            let mut engine = self.engine.lock().unwrap();
            engine.tracker.all_off();
            engine.settings.last_device = Some(name);
            engine.save_settings();
        }
        self.emit_state(app);
        self.emit_devices(app);
        Ok(())
    }

    /// Connect to the remembered device (tolerant match, ADR-002 §3), or —
    /// first run — to the only device present. Failures are silent: the UI
    /// just shows "no device", and explicit selection reports errors.
    pub fn auto_connect(self: &Arc<Self>, app: &AppHandle) {
        let devices = keyscene_midi::list_inputs().unwrap_or_default();
        let saved = self.engine.lock().unwrap().settings.last_device.clone();
        let index = match saved
            .as_deref()
            .and_then(|s| keyscene_midi::best_match(s, &devices))
        {
            Some(i) => Some(i),
            None if devices.len() == 1 => Some(0),
            None => None,
        };
        if let Some(i) = index {
            let _ = self.connect(app, i);
        }
    }

    /// Start the hot-plug watcher: reacts to unplug (drop the dead
    /// connection) and replug (reconnect to the remembered device).
    pub fn start_hotplug(self: &Arc<Self>, app: &AppHandle) {
        let host = self.clone();
        let app2 = app.clone();
        let watcher =
            keyscene_midi::spawn_hotplug_watcher(Duration::from_secs(1), move |devices| {
                let current = host.current_device();
                if let Some(cur) = &current {
                    if !devices.iter().any(|d| &d.name == cur) {
                        // Device vanished under us.
                        *host.conn.lock().unwrap() = None;
                        *host.current_device.lock().unwrap() = None;
                        host.engine.lock().unwrap().tracker.all_off();
                        host.emit_state(&app2);
                    }
                } else {
                    host.auto_connect(&app2);
                }
                host.emit_devices(&app2);
            });
        *self.watcher.lock().unwrap() = Some(watcher);
    }
}
