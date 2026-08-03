//! Pure note/pedal state machine (PLAN.md §3.1).
//!
//! Tracks held notes, sustained notes (CC64), sostenuto-captured notes
//! (CC66), and the soft pedal (CC67), with per-channel filtering. No I/O:
//! feed it parsed [`MidiMsg`]s, read back note sets. Sustained notes are
//! tracked separately from held notes so analysis can include or exclude
//! them (user toggle).

/// A parsed MIDI channel message. `ch` is 0-based (0..16).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MidiMsg {
    NoteOn { ch: u8, note: u8, vel: u8 },
    NoteOff { ch: u8, note: u8 },
    Control { ch: u8, cc: u8, value: u8 },
}

/// Parse a complete MIDI message. NoteOn with velocity 0 is normalized to
/// NoteOff (§3.1). Returns None for system messages and anything we don't
/// track.
pub fn parse(bytes: &[u8]) -> Option<MidiMsg> {
    let (&status, rest) = bytes.split_first()?;
    let ch = status & 0x0F;
    match status & 0xF0 {
        0x80 => Some(MidiMsg::NoteOff {
            ch,
            note: *rest.first()?,
        }),
        0x90 => {
            let note = *rest.first()?;
            let vel = *rest.get(1)?;
            Some(if vel == 0 {
                MidiMsg::NoteOff { ch, note }
            } else {
                MidiMsg::NoteOn { ch, note, vel }
            })
        }
        0xB0 => Some(MidiMsg::Control {
            ch,
            cc: *rest.first()?,
            value: *rest.get(1)?,
        }),
        _ => None,
    }
}

pub const CC_SUSTAIN: u8 = 64;
pub const CC_SOSTENUTO: u8 = 66;
pub const CC_SOFT: u8 = 67;
pub const CC_ALL_SOUND_OFF: u8 = 120;
pub const CC_ALL_NOTES_OFF: u8 = 123;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pedals {
    pub sustain: bool,
    pub sostenuto: bool,
    pub soft: bool,
}

/// Held/sustained note tracker. Note identity is the MIDI note number
/// across all listened channels (the same note held on two channels counts
/// once and stays down until both release).
#[derive(Debug, Clone)]
pub struct NoteTracker {
    /// Bit i of `channel_mask` = listen to channel i. Default: all 16.
    channel_mask: u16,
    /// Per-note count of channels currently holding it down.
    held: [u8; 128],
    /// Ringing because the sustain pedal was down at release.
    sustained: [bool; 128],
    /// Captured by the sostenuto pedal at its press.
    sostenuto_notes: [bool; 128],
    pedals: Pedals,
}

impl Default for NoteTracker {
    fn default() -> Self {
        Self {
            channel_mask: 0xFFFF,
            held: [0; 128],
            sustained: [false; 128],
            sostenuto_notes: [false; 128],
            pedals: Pedals::default(),
        }
    }
}

impl NoteTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn channel_mask(&self) -> u16 {
        self.channel_mask
    }

    /// Set the listened-channel mask. Notes already sounding from
    /// now-filtered channels are released as if a NoteOff arrived.
    pub fn set_channel_mask(&mut self, mask: u16) {
        self.channel_mask = mask;
        if mask == 0xFFFF {
            return;
        }
        // We don't retain per-channel origin (piano use case: one note
        // space), so a mask narrowing conservatively clears everything —
        // the next played notes rebuild state under the new mask.
        self.all_off();
    }

    /// Release everything (panic button / device switch).
    pub fn all_off(&mut self) {
        self.held = [0; 128];
        self.sustained = [false; 128];
        self.sostenuto_notes = [false; 128];
    }

    pub fn pedals(&self) -> Pedals {
        self.pedals
    }

    /// Apply a message. Returns true if the *sounding* state (notes or
    /// pedals) changed, i.e. the app should re-analyze / re-render.
    pub fn apply(&mut self, msg: MidiMsg) -> bool {
        let ch = match msg {
            MidiMsg::NoteOn { ch, .. }
            | MidiMsg::NoteOff { ch, .. }
            | MidiMsg::Control { ch, .. } => ch,
        };
        if self.channel_mask & (1 << ch) == 0 {
            return false;
        }
        match msg {
            MidiMsg::NoteOn { note, .. } => {
                let n = note as usize;
                self.held[n] = self.held[n].saturating_add(1);
                // A re-struck note is held again; it is no longer merely
                // sustained.
                self.sustained[n] = false;
                true
            }
            MidiMsg::NoteOff { note, .. } => {
                let n = note as usize;
                if self.held[n] == 0 {
                    return false;
                }
                self.held[n] -= 1;
                if self.held[n] > 0 {
                    return false;
                }
                if self.pedals.sustain || self.sostenuto_notes[n] {
                    self.sustained[n] = true;
                }
                true
            }
            MidiMsg::Control { cc, value, .. } => {
                let down = value >= 64;
                match cc {
                    CC_SUSTAIN => {
                        if self.pedals.sustain == down {
                            return false;
                        }
                        self.pedals.sustain = down;
                        if !down {
                            // Keep ringing only what sostenuto still holds.
                            for n in 0..128 {
                                if self.sustained[n] && !self.sostenuto_keeps(n) {
                                    self.sustained[n] = false;
                                }
                            }
                        }
                        true
                    }
                    CC_SOSTENUTO => {
                        if self.pedals.sostenuto == down {
                            return false;
                        }
                        self.pedals.sostenuto = down;
                        if down {
                            // Capture exactly the notes held at press time.
                            for n in 0..128 {
                                self.sostenuto_notes[n] = self.held[n] > 0;
                            }
                        } else {
                            for n in 0..128 {
                                if self.sostenuto_notes[n] {
                                    self.sostenuto_notes[n] = false;
                                    if self.sustained[n] && !self.pedals.sustain {
                                        self.sustained[n] = false;
                                    }
                                }
                            }
                        }
                        true
                    }
                    CC_SOFT => {
                        if self.pedals.soft == down {
                            return false;
                        }
                        self.pedals.soft = down;
                        true
                    }
                    // All Sound Off: silence everything immediately.
                    CC_ALL_SOUND_OFF => {
                        let sounding =
                            self.held.iter().any(|&c| c > 0) || self.sustained.iter().any(|&s| s);
                        if !sounding {
                            return false;
                        }
                        self.held = [0; 128];
                        self.sustained = [false; 128];
                        true
                    }
                    // All Notes Off: release every held key as if a NoteOff
                    // arrived — a down sustain pedal still keeps them ringing.
                    CC_ALL_NOTES_OFF => {
                        let mut changed = false;
                        for n in 0..128 {
                            if self.held[n] > 0 {
                                self.held[n] = 0;
                                if self.pedals.sustain || self.sostenuto_notes[n] {
                                    self.sustained[n] = true;
                                }
                                changed = true;
                            }
                        }
                        changed
                    }
                    _ => false,
                }
            }
        }
    }

    fn sostenuto_keeps(&self, n: usize) -> bool {
        self.pedals.sostenuto && self.sostenuto_notes[n]
    }

    /// Notes with a key physically down.
    pub fn held_notes(&self) -> Vec<u8> {
        (0..128u8).filter(|&n| self.held[n as usize] > 0).collect()
    }

    /// Notes ringing only because of a pedal (not held).
    pub fn sustained_notes(&self) -> Vec<u8> {
        (0..128u8)
            .filter(|&n| self.held[n as usize] == 0 && self.sustained[n as usize])
            .collect()
    }

    /// The set analysis should see: held, plus sustained when included.
    pub fn sounding(&self, include_sustained: bool) -> Vec<u8> {
        (0..128u8)
            .filter(|&n| {
                self.held[n as usize] > 0 || (include_sustained && self.sustained[n as usize])
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on(ch: u8, note: u8) -> MidiMsg {
        MidiMsg::NoteOn { ch, note, vel: 80 }
    }
    fn off(ch: u8, note: u8) -> MidiMsg {
        MidiMsg::NoteOff { ch, note }
    }
    fn cc(ch: u8, cc_: u8, value: u8) -> MidiMsg {
        MidiMsg::Control { ch, cc: cc_, value }
    }

    #[test]
    fn parse_normalizes_velocity_zero_noteon() {
        assert_eq!(
            parse(&[0x90, 60, 0]),
            Some(MidiMsg::NoteOff { ch: 0, note: 60 })
        );
        assert_eq!(
            parse(&[0x91, 60, 100]),
            Some(MidiMsg::NoteOn {
                ch: 1,
                note: 60,
                vel: 100
            })
        );
        assert_eq!(
            parse(&[0x85, 60, 64]),
            Some(MidiMsg::NoteOff { ch: 5, note: 60 })
        );
        assert_eq!(
            parse(&[0xB0, 64, 127]),
            Some(MidiMsg::Control {
                ch: 0,
                cc: 64,
                value: 127
            })
        );
        assert_eq!(parse(&[0xF8]), None); // clock
        assert_eq!(parse(&[0x90, 60]), None); // truncated
    }

    #[test]
    fn hold_and_release() {
        let mut t = NoteTracker::new();
        assert!(t.apply(on(0, 60)));
        assert!(t.apply(on(0, 64)));
        assert_eq!(t.held_notes(), vec![60, 64]);
        assert!(t.apply(off(0, 60)));
        assert_eq!(t.held_notes(), vec![64]);
        assert_eq!(t.sustained_notes(), Vec::<u8>::new());
        assert_eq!(t.sounding(true), vec![64]);
    }

    #[test]
    fn sustain_pedal_keeps_released_notes() {
        let mut t = NoteTracker::new();
        t.apply(on(0, 60));
        t.apply(cc(0, CC_SUSTAIN, 127));
        t.apply(off(0, 60));
        assert_eq!(t.held_notes(), Vec::<u8>::new());
        assert_eq!(t.sustained_notes(), vec![60]);
        assert_eq!(t.sounding(true), vec![60]);
        assert_eq!(t.sounding(false), Vec::<u8>::new());
        // Pedal up: note stops ringing.
        assert!(t.apply(cc(0, CC_SUSTAIN, 0)));
        assert_eq!(t.sustained_notes(), Vec::<u8>::new());
    }

    #[test]
    fn restrike_moves_note_from_sustained_to_held() {
        let mut t = NoteTracker::new();
        t.apply(cc(0, CC_SUSTAIN, 127));
        t.apply(on(0, 60));
        t.apply(off(0, 60));
        assert_eq!(t.sustained_notes(), vec![60]);
        t.apply(on(0, 60));
        assert_eq!(t.held_notes(), vec![60]);
        assert_eq!(t.sustained_notes(), Vec::<u8>::new());
        // Release with pedal still down: sustained again.
        t.apply(off(0, 60));
        assert_eq!(t.sustained_notes(), vec![60]);
    }

    #[test]
    fn sostenuto_captures_only_notes_held_at_press() {
        let mut t = NoteTracker::new();
        t.apply(on(0, 48)); // bass note
        t.apply(cc(0, CC_SOSTENUTO, 127));
        t.apply(on(0, 72)); // played after press: NOT captured
        t.apply(off(0, 48));
        t.apply(off(0, 72));
        assert_eq!(t.sustained_notes(), vec![48]);
        // Sostenuto up, sustain not down: 48 stops.
        t.apply(cc(0, CC_SOSTENUTO, 0));
        assert_eq!(t.sustained_notes(), Vec::<u8>::new());
    }

    #[test]
    fn sustain_takes_over_from_sostenuto() {
        let mut t = NoteTracker::new();
        t.apply(on(0, 48));
        t.apply(cc(0, CC_SOSTENUTO, 127));
        t.apply(cc(0, CC_SUSTAIN, 127));
        t.apply(off(0, 48));
        t.apply(cc(0, CC_SOSTENUTO, 0));
        // Sustain still down: keeps ringing.
        assert_eq!(t.sustained_notes(), vec![48]);
        t.apply(cc(0, CC_SUSTAIN, 0));
        assert_eq!(t.sustained_notes(), Vec::<u8>::new());
    }

    #[test]
    fn sustain_release_keeps_sostenuto_notes() {
        let mut t = NoteTracker::new();
        t.apply(on(0, 48));
        t.apply(cc(0, CC_SOSTENUTO, 127)); // captures 48
        t.apply(cc(0, CC_SUSTAIN, 127));
        t.apply(on(0, 60));
        t.apply(off(0, 48));
        t.apply(off(0, 60));
        assert_eq!(t.sustained_notes(), vec![48, 60]);
        // Sustain up: 60 drops, sostenuto-captured 48 keeps ringing.
        t.apply(cc(0, CC_SUSTAIN, 0));
        assert_eq!(t.sustained_notes(), vec![48]);
    }

    #[test]
    fn channel_filtering() {
        let mut t = NoteTracker::new();
        t.set_channel_mask(1 << 2); // channel 3 (0-based 2) only
        assert!(!t.apply(on(0, 60)));
        assert!(t.apply(on(2, 64)));
        assert_eq!(t.held_notes(), vec![64]);
        // Pedal on a filtered channel is ignored too.
        assert!(!t.apply(cc(0, CC_SUSTAIN, 127)));
        assert!(!t.pedals().sustain);
    }

    #[test]
    fn same_note_on_two_channels_needs_both_releases() {
        let mut t = NoteTracker::new();
        t.apply(on(0, 60));
        t.apply(on(1, 60));
        assert!(!t.apply(off(0, 60)), "still held by channel 1");
        assert_eq!(t.held_notes(), vec![60]);
        assert!(t.apply(off(1, 60)));
        assert_eq!(t.held_notes(), Vec::<u8>::new());
    }

    #[test]
    fn soft_pedal_is_state_only() {
        let mut t = NoteTracker::new();
        assert!(t.apply(cc(0, CC_SOFT, 127)));
        assert!(t.pedals().soft);
        assert!(!t.apply(cc(0, CC_SOFT, 127)), "no change, no re-render");
        assert!(t.apply(cc(0, CC_SOFT, 0)));
        assert!(!t.pedals().soft);
    }

    #[test]
    fn unmatched_noteoff_is_ignored() {
        let mut t = NoteTracker::new();
        assert!(!t.apply(off(0, 60)));
    }

    #[test]
    fn all_sound_off_silences_everything() {
        let mut t = NoteTracker::new();
        t.apply(cc(0, CC_SUSTAIN, 127));
        t.apply(on(0, 60));
        t.apply(on(0, 64));
        t.apply(off(0, 60)); // ringing under the pedal
        assert!(t.apply(cc(0, CC_ALL_SOUND_OFF, 0)));
        assert_eq!(t.sounding(true), Vec::<u8>::new());
        assert!(!t.apply(cc(0, CC_ALL_SOUND_OFF, 0)), "already silent");
        assert!(t.pedals().sustain, "pedal state itself is untouched");
    }

    #[test]
    fn all_notes_off_respects_sustain() {
        let mut t = NoteTracker::new();
        t.apply(cc(0, CC_SUSTAIN, 127));
        t.apply(on(0, 60));
        assert!(t.apply(cc(0, CC_ALL_NOTES_OFF, 0)));
        assert_eq!(t.held_notes(), Vec::<u8>::new());
        assert_eq!(t.sustained_notes(), vec![60], "rings until pedal up");
        t.apply(cc(0, CC_SUSTAIN, 0));
        assert_eq!(t.sounding(true), Vec::<u8>::new());
    }
}
