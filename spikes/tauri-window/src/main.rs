//! Spike C (PLAN.md Phase 0): exercise every window capability Display mode
//! needs — transparent, borderless, always-on-top, click-through — and log
//! which calls succeed on this OS. Findings land in docs/spike-notes.md.
//!
//! Run: `cargo run` (in this directory).
//! `SPIKE_AUTOCLOSE=<secs>` exits automatically after the toggle sequence.

use std::time::Duration;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::{WebviewUrl, WebviewWindowBuilder};
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("keyscene spike C")
                .inner_size(520.0, 340.0)
                .position(240.0, 240.0)
                .transparent(true)
                .decorations(false)
                .shadow(false)
                .always_on_top(true)
                .build()?;
            let w = win.clone();
            // Window methods are cross-thread safe in Tauri 2 (they proxy
            // through the event loop), so a plain thread can drive the tour.
            std::thread::spawn(move || exercise(w));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn exercise(w: tauri::WebviewWindow) {
    let step = |name: &str, r: tauri::Result<()>| match r {
        Ok(()) => println!("spike-c: {name}: ok"),
        Err(e) => println!("spike-c: {name}: ERR {e}"),
    };
    std::thread::sleep(Duration::from_millis(1500));
    step("set_always_on_top(false)", w.set_always_on_top(false));
    step("set_always_on_top(true)", w.set_always_on_top(true));
    step(
        "click-through ON  (set_ignore_cursor_events)",
        w.set_ignore_cursor_events(true),
    );
    std::thread::sleep(Duration::from_millis(800));
    step(
        "click-through OFF (set_ignore_cursor_events)",
        w.set_ignore_cursor_events(false),
    );
    step("set_decorations(true)", w.set_decorations(true));
    std::thread::sleep(Duration::from_millis(800));
    step("set_decorations(false)", w.set_decorations(false));
    step("set_shadow(true)", w.set_shadow(true));
    step("set_shadow(false)", w.set_shadow(false));
    println!("spike-c: toggle tour complete");
    if let Ok(v) = std::env::var("SPIKE_AUTOCLOSE") {
        let secs: u64 = v.parse().unwrap_or(3);
        std::thread::sleep(Duration::from_secs(secs));
        println!("spike-c: autoclosing");
        std::process::exit(0);
    }
}
