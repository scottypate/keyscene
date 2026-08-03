//! keyscene-core: pure analysis engine.
//!
//! Input: active pitches + optional key context + settings.
//! Output: `Analysis` (chord names, spelled notes, Roman numerals, intervals).
//!
//! Ground rules (PLAN.md §2.1, §3.2):
//! - Pure functions only: no I/O, no UI, no globals, deterministic.
//! - Must compile to native, WASM, and (later) behind a C ABI.
//! - Normative behavior lives in docs/engine-spec.md; changes require
//!   test vectors in the same PR.

#![forbid(unsafe_code)]

/// A MIDI note number (0-127).
pub type MidiNote = u8;

/// Placeholder for the Phase 1 engine. Exists so the workspace builds
/// end-to-end from day one.
pub fn engine_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_nonempty() {
        assert!(!engine_version().is_empty());
    }
}
