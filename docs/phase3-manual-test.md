# Phase 3 manual acceptance script

PLAN.md §4 Phase 3 acceptance: OBS window-capture test on **both OSes**
produces clean keyable output; a non-developer can build a stream layout in
under 5 minutes following in-app guidance; RAM under the §1.3 target
(~150 MB idle) while rendering at 60 fps.

Run once per OS (macOS + Windows). Record date/OS/OBS version at the
bottom. Build first: `npm run build` in `ui/studio`, then
`cargo run -p keyscene-app`.

## A. Mode toggle & window behavior

1. Click **Display** in the Studio toolbar (or press Ctrl/Cmd+D).
   - Studio hides; a borderless, chrome-free window appears with the
     five elements (chord card, staff, keyboard, pedals, key readout).
   - First run only: the "Set up your scene" guidance card appears.
2. Press **Esc** → back to Studio. Toggle again with Ctrl/Cmd+D from
   Studio; the button reads "Exit Display" while active.
3. Move the mouse: the floating toolbar fades in; leave the mouse still
   for ~3 s: toolbar and hover outlines disappear completely (nothing
   extra can be captured on stream).
4. Drag the ⠿ grip: the whole window moves (borderless drag).
5. Enable **on top**: window stays above the DAW/other apps. Disable: it
   doesn't.
6. Enable **click-through**: clicks land on apps underneath, and the
   Studio window automatically reappears as the control surface. Exit
   Display from Studio; re-enter: window is controllable again
   (click-through is re-applied but Studio stays available).
7. macOS: Cmd+W on the display window must NOT strand you — Studio
   reappears. Closing the Studio window quits the app even after Display
   mode has been used.

## B. Elements, layouts, presets

1. Drag each element; scroll-wheel over each element scales it
   (0.25×–4×). Play notes while dragging — analysis keeps updating.
2. Toggle each of the 5 element chips off/on.
3. Apply each built-in preset: Default, Stream, Lesson, Tutorial
   recording — element positions/visibility and background all change.
4. Arrange a custom layout, **Save…** it under a name, switch to a
   built-in, then re-apply the saved preset — layout returns exactly.
5. Quit and relaunch the app: last layout, background, theme, and saved
   presets are all intact (settings.json).

## C. Backgrounds & themes

1. Cycle background swatches: transparent, chroma green, magenta, blue,
   black, and a custom color from the picker.
2. Transparent: the desktop is visible through the window
   (macOS: requires the macOSPrivateApi build, already configured).
   Windows: verify no white flash when the display window first opens.
3. Apply all 8 themes from the display toolbar and confirm every element
   restyles (staff ink, keyboard keys, chord card, fonts on Classic /
   Chalkboard). Repeat one theme change from Studio settings — both
   windows follow.
4. Custom theme: Studio Settings → Theme → Custom… — tweak colors and
   font; both Studio and Display update live.

## D. Anti-flicker (chord hold)

1. Set hold to 0 ms. Slowly arpeggiate C–E–G–Bb up and down: the chord
   card churns through note/dyad names (this is the failure mode).
2. Set hold to 250 ms and repeat: on the way up names upgrade instantly;
   on the way down the full chord name holds instead of flickering.
   Roman numeral readout behaves the same.
3. Set hold to 2000 ms: released chords linger visibly for ~2 s.

## E. OBS capture (the acceptance test)

1. OBS → add **Window Capture** of "Keyscene Display".
2. Solid-color background (chroma green) + OBS Filters → Chroma Key:
   clean keyed output, no fringing at element edges, toolbar absent when
   the mouse is idle, key highlights animate smoothly while playing.
3. macOS: check whether window capture delivers the transparent window
   with alpha; if the OS composites it opaquely, note it — chroma key is
   the documented reliable path until the Phase 4 browser source.
4. Leave OBS capturing for 5 minutes of playing: no stutter in OBS.

## F. Five-minute layout test (non-developer)

Hand the app to someone who hasn't seen it. Task: "make a stream layout —
keyboard at the bottom, chord name top-right, green screen background —
and get it into OBS." They may only use the in-app guidance (first-run
card, the **?** button). Target: under 5 minutes. Record the time.

## G. Performance budget (§1.3)

1. Studio idle (no notes, device connected): note RSS in Activity
   Monitor / Task Manager. Target < ~150 MB.
2. Enter Display mode, hold a big chord, wiggle sustain, capture in OBS:
   CPU stays low (single-digit % on a modern machine), animation visually
   60 fps. Note RSS again — the second webview must not blow the budget.
   Record both numbers below.

## Results

| Date | OS | OBS | A | B | C | D | E | F (time) | G (RAM idle / display) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |  |  |
