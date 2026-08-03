# Phase 2 manual acceptance script

PLAN.md §4 Phase 2 acceptance: play 20 predefined chords on hardware on
**both OSes**; correct names/spellings/RNs render in <50 ms perceived; app
survives device unplug/replug; QWERTY input works with no hardware.

Run once per OS (macOS + Windows) with a hardware controller. Record
date/OS/device at the bottom. Automated coverage (engine vectors, tracker
unit tests) already guards correctness; this script verifies the *wired
app* end to end.

## Setup

1. Build the UI, then launch: `npm run build` in `ui/`, then
   `cargo run -p keyscene-app`.
2. Connect the MIDI controller **after** launch (this also exercises
   hot-plug attach). Confirm it appears in the device dropdown and, if it
   is the only device, auto-connects.
3. Leave settings at defaults (English names, auto accidentals, textbook
   RNs, sustained notes included, all channels, 61-key view).

## The 20 chords

Select the key shown in the Key column from the toolbar before playing the
row ("—" = "No key"). Every row must show the expected name, staff
spelling, and Roman numeral. Expected values below are generated from the
engine — regenerate after engine changes with:
`cargo run -p keyscene-core --example phase2_script`

| # | Key | Play | Expect name | Alternates | Spelling | RN |
|---|-----|------|-------------|------------|----------|----|
| 1 | C | C4 E4 G4 | **C** | — | C4 E4 G4 | I |
| 2 | C | G3 B3 D4 F4 | **G7** | — | G3 B3 D4 F4 | V7 |
| 3 | C | A3 C4 E4 G4 | **Am7** | C6/A | A3 C4 E4 G4 | vi7 |
| 4 | C | A3 C4 F4 | **F/A** | — | A3 C4 F4 | IV6 |
| 5 | C | D4 F4 A4 C5 | **Dm7** | F6/D | D4 F4 A4 C5 | ii7 |
| 6 | C | E4 Ab4 B4 | **E** | — | E4 G#4 B4 | V/vi |
| 7 | C | Bb3 D4 F4 | **Bb** | — | Bb3 D4 F4 | bVII |
| 8 | C | C4 E4 G4 B4 D5 | **Cmaj9** | — | C4 E4 G4 B4 D5 | Imaj9 |
| 9 | C | C3 E3 Ab3 Bb3 Eb4 | **C7(#5#9)** | C7(#9b13) | C3 E3 G#3 Bb3 D#4 | V7(#5#9)/IV |
| 10 | C | C4 F4 Bb4 | **C7sus4(no5)** | Fsus4/C, Bbsus2/C, C quartal(3) | C4 F4 Bb4 | I7sus4 |
| 11 | Eb | Eb4 G4 Bb4 | **Eb** | — | Eb4 G4 Bb4 | I |
| 12 | Eb | Bb3 D4 F4 Ab4 | **Bb7** | — | Bb3 D4 F4 Ab4 | V7 |
| 13 | Eb | C3 Eb3 G3 Bb3 | **Cm7** | Eb6/C | C3 Eb3 G3 Bb3 | vi7 |
| 14 | Eb | F3 Ab3 C4 Eb4 | **Fm7** | Ab6/F | F3 Ab3 C4 Eb4 | ii7 |
| 15 | Am | A3 C4 E4 | **Am** | C6(no5)/A | A3 C4 E4 | i |
| 16 | Am | E4 Ab4 B4 D5 | **E7** | — | E4 G#4 B4 D5 | V7 |
| 17 | Am | Ab3 B3 D4 F4 | **G#dim7** | Ddim7/Ab, E#dim7/G#, Bdim7/Ab | G#3 B3 D4 F4 | vii°7 |
| 18 | Am | D4 F4 A4 C5 | **Dm7** | F6/D | D4 F4 A4 C5 | iv7 |
| 19 | — | C#4 F4 Ab4 | **Db** | — | Db4 F4 Ab4 | — |
| 20 | — | D3 A3 F#4 C#5 | **Dmaj7** | — | D3 A3 F#4 C#5 | — |

Notes: the "Play" column names keys on the controller (sharps/flats there
are arbitrary); the "Spelling" column is what the staff must show — row 6
is the marquee check that E major in the key of C spells **G#**, never Ab.
Row 9 is the multi-name altered-dominant flagship. Row 17's alternates
exercise dim7 symmetry.

- [ ] All 20 rows correct on macOS
- [ ] All 20 rows correct on Windows

## Perceived latency

- [ ] While playing row 1–5 as a progression at a moderate tempo, the
  name/staff/keyboard update feels instantaneous (<50 ms perceived; no
  visible lag between keypress and render).

## Pedals & sustained notes

- [ ] Hold C4 E4 G4, press sustain, release keys: keyboard shows the three
  keys in the dimmer sustain color, chord name stays "C", "sus" dot lit.
- [ ] Settings → uncheck "Include pedal-sustained notes": display clears
  while only pedal holds notes; re-check restores.
- [ ] Sustain pedal up: sustained notes clear.
- [ ] (If the controller has one) soft pedal lights the "soft" dot.

## Device unplug / replug

- [ ] Unplug the controller mid-chord: no crash; keyboard clears (no stuck
  notes); status bar shows no device.
- [ ] Replug: device reappears in dropdown and reconnects automatically
  (remembered device); playing works again without touching the UI.
- [ ] Quit and relaunch: last device reconnects automatically.

## QWERTY (no hardware)

- [ ] Disconnect/select "No device": A W S E D F T G Y H U J K … play
  notes; Z/X shift octave; Space acts as sustain. Chord rows 1, 2, 6
  reproducible from the QWERTY keys.
- [ ] With the settings dialog open, typing in controls does NOT trigger
  notes.

## Settings persistence

- [ ] Change: key = Eb, language = German, keyboard = 88, hide staff.
  Quit, relaunch: all four restored. (Settings live in the app config dir,
  `settings.json`.)
- [ ] German language check: Bb3 D4 F4 in key Eb names the chord starting
  with "B" (German B = our Bb); B natural displays as "H".

## Channels

- [ ] Set the controller to transmit on channel 2; Settings → "Channel 2
  only": notes register. Switch filter to "Channel 1 only": silence.
  Restore "All channels" (the default): notes register again.

## Windows-only: multi-client behavior (fills ADR-002 matrix)

With a DAW holding the device (Reaper), select it in Keyscene:

- [ ] Win10 / Win11-pre-WMS: the targeted "device is in use" help panel
  appears (loopMIDI instructions), NOT a generic error.
- [ ] Win11 24H2+ with Windows MIDI Services: no panel; both apps receive
  input simultaneously.
- [ ] Record exact port names + error text in ADR-002 "Pending
  measurements".

## Sign-off

| OS | Device | Date | Tester | Result |
|----|--------|------|--------|--------|
| macOS | | | | |
| Windows | | | | |
