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
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use midi_host::MidiHost;
use state::{AppSettings, DevicesPayload, Engine, MidiErrorPayload, StatePayload};

type Host<'a> = State<'a, Arc<MidiHost>>;

const DISPLAY: &str = "display";
const MAIN: &str = "main";

#[tauri::command]
fn get_state(host: Host) -> StatePayload {
    host.lock_engine().payload()
}

#[tauri::command]
fn get_settings(host: Host) -> AppSettings {
    host.lock_engine().settings.clone()
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
        let mut engine = host.lock_engine();
        if settings.channel_mask != engine.settings.channel_mask {
            engine.tracker.set_channel_mask(settings.channel_mask);
        }
        engine.settings = settings;
    }
    host.save_settings();
    host.emit_settings(&app);
    // Engine settings (key, include_sustained) change the analysis too.
    host.emit_state(&app);
}

// ---- Display mode (§3.4) ------------------------------------------------
//
// The Display window is a second, transparent + borderless webview created
// lazily on first use and hidden (not destroyed) on exit, so idle RAM stays
// low before first use and later toggles are instant. It is created hidden
// and shown from `display_ready` after the page's first paint — the
// WebView2 white-flash mitigation recorded in Spike C.

/// Show the display window with the persisted window options applied, and
/// hide/show Studio accordingly. With click-through on, the Studio window
/// stays visible as the control surface (the display can't take clicks).
fn show_display(app: &AppHandle, host: &Arc<MidiHost>) {
    let opts = host.lock_engine().settings.display.clone();
    if let Some(w) = app.get_webview_window(DISPLAY) {
        let _ = w.set_always_on_top(opts.always_on_top);
        let _ = w.set_ignore_cursor_events(opts.click_through);
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(main) = app.get_webview_window(MAIN) {
        if opts.click_through {
            let _ = main.show();
        } else {
            let _ = main.hide();
        }
    }
    let _ = app.emit("display-mode", true);
}

fn hide_display(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(DISPLAY) {
        // Always drop click-through on exit so the window is controllable
        // the moment it reappears.
        let _ = w.set_ignore_cursor_events(false);
        let _ = w.hide();
    }
    if let Some(main) = app.get_webview_window(MAIN) {
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit("display-mode", false);
}

#[tauri::command]
fn set_display_mode(app: AppHandle, host: Host, on: bool) {
    if !on {
        hide_display(&app);
        return;
    }
    if app.get_webview_window(DISPLAY).is_some() {
        show_display(&app, &host);
    } else {
        let _ = WebviewWindowBuilder::new(&app, DISPLAY, WebviewUrl::App("display.html".into()))
            .title("Keyscene Display")
            .inner_size(1280.0, 720.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .visible(false)
            .build();
        // shown by display_ready once the page has painted
    }
}

/// Called by the display page after its first render.
#[tauri::command]
fn display_ready(app: AppHandle, host: Host) {
    show_display(&app, &host);
}

/// Window-affecting display options; persisted and applied live.
#[tauri::command]
fn set_display_opts(app: AppHandle, host: Host, always_on_top: bool, click_through: bool) {
    {
        let mut engine = host.lock_engine();
        engine.settings.display.always_on_top = always_on_top;
        engine.settings.display.click_through = click_through;
    }
    host.save_settings();
    if let Some(w) = app.get_webview_window(DISPLAY) {
        let _ = w.set_always_on_top(always_on_top);
        let _ = w.set_ignore_cursor_events(click_through);
        let display_visible = w.is_visible().unwrap_or(false);
        if let Some(main) = app.get_webview_window(MAIN) {
            if click_through {
                let _ = main.show();
            } else if display_visible {
                let _ = main.hide();
            }
        }
    }
    host.emit_settings(&app);
}

/// QWERTY fallback (§3.1): synthesized on the lowest listened channel so a
/// narrow channel filter never mutes the on-screen keyboard.
fn qwerty_channel(tracker: &NoteTracker) -> u8 {
    tracker.channel_mask().trailing_zeros().min(15) as u8
}

#[tauri::command]
fn note_event(app: AppHandle, host: Host, on: bool, midi: u8) {
    let changed = {
        let mut engine = host.lock_engine();
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
        let mut engine = host.lock_engine();
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
            // A missing config dir must not crash before any window exists;
            // fall back to a temp path and run without durable settings.
            let settings_path = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("keyscene"))
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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    // A hidden display window would keep the process alive
                    // after Studio closes — treat Studio close as app exit.
                    MAIN => window.app_handle().exit(0),
                    // Closing the borderless display (e.g. Cmd+W) must not
                    // strand the user with zero visible windows.
                    DISPLAY => {
                        api.prevent_close();
                        hide_display(window.app_handle());
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            get_settings,
            get_devices,
            select_device,
            disconnect_device,
            set_settings,
            note_event,
            sustain_event,
            set_display_mode,
            display_ready,
            set_display_opts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running keyscene");
}
