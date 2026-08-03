//! keyscene-app: Tauri 2 desktop shell (Phase 2, Studio mode MVP).
//!
//! Wires keyscene-midi input through keyscene-core analysis and pushes
//! `StatePayload`s to the Studio SPA. QWERTY fallback notes arrive as
//! commands and flow through the exact same tracker → analyze pipeline as
//! hardware input (§3.1).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod midi_host;
mod state;

use std::sync::Arc;

use keyscene_midi::{MidiMsg, NoteTracker, CC_SUSTAIN};
use tauri::{AppHandle, Manager, State};

use midi_host::MidiHost;
use state::{AppSettings, DevicesPayload, Engine, MidiErrorPayload, StatePayload};

type Host<'a> = State<'a, Arc<MidiHost>>;

#[tauri::command]
fn get_state(host: Host) -> StatePayload {
    host.engine.lock().unwrap().payload()
}

#[tauri::command]
fn get_devices(host: Host) -> DevicesPayload {
    host.devices_payload()
}

#[tauri::command]
fn select_device(app: AppHandle, host: Host, index: usize) -> Result<(), MidiErrorPayload> {
    host.connect(&app, index)
}

#[tauri::command]
fn disconnect_device(app: AppHandle, host: Host) {
    host.disconnect(&app);
}

#[tauri::command]
fn set_settings(app: AppHandle, host: Host, settings: AppSettings) {
    {
        let mut engine = host.engine.lock().unwrap();
        if settings.channel_mask != engine.settings.channel_mask {
            engine.tracker.set_channel_mask(settings.channel_mask);
        }
        engine.settings = settings;
        engine.save_settings();
    }
    host.emit_state(&app);
}

/// QWERTY fallback (§3.1): synthesized on the lowest listened channel so a
/// narrow channel filter never mutes the on-screen keyboard.
fn qwerty_channel(tracker: &NoteTracker) -> u8 {
    tracker.channel_mask().trailing_zeros().min(15) as u8
}

#[tauri::command]
fn note_event(app: AppHandle, host: Host, on: bool, midi: u8) {
    let changed = {
        let mut engine = host.engine.lock().unwrap();
        let ch = qwerty_channel(&engine.tracker);
        let msg = if on {
            MidiMsg::NoteOn {
                ch,
                note: midi,
                vel: 80,
            }
        } else {
            MidiMsg::NoteOff { ch, note: midi }
        };
        engine.tracker.apply(msg)
    };
    if changed {
        host.emit_state(&app);
    }
}

#[tauri::command]
fn sustain_event(app: AppHandle, host: Host, down: bool) {
    let changed = {
        let mut engine = host.engine.lock().unwrap();
        let ch = qwerty_channel(&engine.tracker);
        engine.tracker.apply(MidiMsg::Control {
            ch,
            cc: CC_SUSTAIN,
            value: if down { 127 } else { 0 },
        })
    };
    if changed {
        host.emit_state(&app);
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let settings_path = app
                .path()
                .app_config_dir()
                .expect("app config dir")
                .join("settings.json");
            let settings = AppSettings::load(&settings_path);
            let mut tracker = NoteTracker::new();
            tracker.set_channel_mask(settings.channel_mask);
            let host = MidiHost::new(Engine {
                tracker,
                settings,
                settings_path,
            });
            host.auto_connect(app.handle());
            host.start_hotplug(app.handle());
            app.manage(host);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            get_devices,
            select_device,
            disconnect_device,
            set_settings,
            note_event,
            sustain_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running keyscene");
}
