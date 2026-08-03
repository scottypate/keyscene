//! keyscene-app: desktop shell backend.
//!
//! Becomes the Tauri 2.x backend in Phase 0 Spike C. For now it is a
//! plain binary proving the workspace wires together (and doubles as the
//! console harness for Spike A).

fn main() {
    println!("keyscene {} (engine)", keyscene_core::engine_version());
    match keyscene_midi::input_port_names() {
        Ok(ports) if ports.is_empty() => println!("No MIDI input devices found."),
        Ok(ports) => {
            println!("MIDI inputs:");
            for p in ports {
                println!("  - {p}");
            }
        }
        Err(e) => eprintln!("MIDI init failed: {e}"),
    }
}
