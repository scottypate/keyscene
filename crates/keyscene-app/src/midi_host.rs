//! Owns the live MIDI connection: connect/disconnect, hot-plug reactions
//! (§3.1 unplug/replug survival), and pushing state to the webview.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use keyscene_midi::MidiInputConnection;
use tauri::{AppHandle, Emitter};

use crate::state::{AppSettings, DevicesPayload, Engine, MidiErrorPayload};

/// Recover the guard from a poisoned mutex: a panic elsewhere must not
/// permanently kill the MIDI callback and every command.
fn relock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

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

    pub fn lock_engine(&self) -> MutexGuard<'_, Engine> {
        relock(&self.engine)
    }

    pub fn current_device(&self) -> Option<String> {
        relock(&self.current_device).clone()
    }

    pub fn devices_payload(&self) -> DevicesPayload {
        DevicesPayload {
            devices: keyscene_midi::list_inputs().unwrap_or_default(),
            current: self.current_device(),
        }
    }

    pub fn emit_state(self: &Arc<Self>, app: &AppHandle) {
        let payload = self.lock_engine().payload();
        let _ = app.emit("state", payload);
    }

    /// Emit the current settings ("settings" event) — call after any
    /// settings mutation. Never called from the per-note hot path.
    pub fn emit_settings(self: &Arc<Self>, app: &AppHandle) {
        let settings = self.lock_engine().settings.clone();
        let _ = app.emit("settings", settings);
    }

    /// Persist settings without holding the engine lock during disk I/O
    /// (the midir callback contends on that lock).
    pub fn save_settings(self: &Arc<Self>) {
        let (settings, path): (AppSettings, _) = {
            let engine = self.lock_engine();
            (engine.settings.clone(), engine.settings_path.clone())
        };
        settings.save(&path);
    }

    pub fn emit_devices(self: &Arc<Self>, app: &AppHandle) {
        let _ = app.emit("devices", self.devices_payload());
    }

    pub fn disconnect(self: &Arc<Self>, app: &AppHandle) {
        *relock(&self.conn) = None;
        *relock(&self.current_device) = None;
        // Release anything still sounding so no ghost chord lingers.
        self.lock_engine().tracker.all_off();
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
        *relock(&self.conn) = None;

        let host = self.clone();
        let app2 = app.clone();
        let conn = keyscene_midi::connect(index, move |_ts, bytes| {
            if let Some(msg) = keyscene_midi::parse(bytes) {
                let changed = relock(&host.engine).tracker.apply(msg);
                if changed {
                    host.emit_state(&app2);
                }
            }
        })
        .map_err(|e| MidiErrorPayload::from_connect(&e, &name))?;

        *relock(&self.conn) = Some(conn);
        *relock(&self.current_device) = Some(name.clone());
        {
            let mut engine = self.lock_engine();
            engine.tracker.all_off();
            engine.settings.last_device = Some(name);
        }
        self.save_settings();
        self.emit_state(app);
        self.emit_settings(app);
        self.emit_devices(app);
        Ok(())
    }

    /// Connect to the remembered device (tolerant match, ADR-002 §3), or —
    /// first run — to the only device present. A missing device stays
    /// silent (the UI just shows "no device"), but a busy one surfaces the
    /// ADR-002 loopMIDI guidance — that panel exists precisely for the
    /// DAW-holds-the-port-at-startup case.
    pub fn auto_connect(self: &Arc<Self>, app: &AppHandle) {
        let devices = keyscene_midi::list_inputs().unwrap_or_default();
        let saved = self.lock_engine().settings.last_device.clone();
        let index = match saved
            .as_deref()
            .and_then(|s| keyscene_midi::best_match(s, &devices))
        {
            Some(i) => Some(i),
            None if devices.len() == 1 => Some(0),
            None => None,
        };
        if let Some(i) = index {
            if let Err(err) = self.connect(app, i) {
                if err.kind == "deviceBusy" {
                    let _ = app.emit("midi-error", err);
                }
            }
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
                        *relock(&host.conn) = None;
                        *relock(&host.current_device) = None;
                        host.lock_engine().tracker.all_off();
                        host.emit_state(&app2);
                    }
                } else {
                    host.auto_connect(&app2);
                }
                host.emit_devices(&app2);
            });
        *relock(&self.watcher) = Some(watcher);
    }
}
