# ADR-002: MIDI backend strategy & Windows compatibility matrix

- **Status**: accepted (macOS measured; Windows rows documented, verification protocol below — see "Pending measurements")
- **Date**: 2026-08-03
- **Context**: PLAN.md §2.1, §2.3.3, §3.1. Spike A harness: `cargo run -p keyscene-midi --bin spike_a_latency`.

## Decision

Use **`midir` 0.10 with its default OS backends** (CoreMIDI on macOS, WinMM on
Windows) as the single input path for v1. Do **not** adopt the Windows MIDI
Services (WMS) SDK or midir's WinRT backend now; instead rely on WMS's
WinMM-compatibility redirection on Win11 24H2+ and ship the §3.1 "device busy"
help panel (loopMIDI instructions) for older Windows. Re-evaluate a native WMS
adapter when the SDK stabilizes (tracked for v1.x, backlog).

## Measured: macOS 15 (Darwin 25.5.0), CoreMIDI, midir 0.10

Spike A loopback (virtual source → OS router → `midir` callback, 500 messages,
debug build):

| metric | send → callback |
|---|---|
| min | 0.019 ms |
| median | 0.049 ms |
| mean | 0.052 ms |
| p95 | 0.095 ms |
| p99 | 0.124 ms |
| max | 0.129 ms |

Conclusion: the OS-routing + callback layer costs ~0.05 ms — effectively zero
against the ~30 ms end-to-end perceived-latency budget (§2.3.2). The whole
budget remains available for analysis, IPC to the webview, and paint. Hardware
USB/BLE transport adds latency upstream of this measurement, but that part is
identical for every app on the machine and outside our control.

Also verified on macOS: virtual ports (`midir::os::unix::VirtualOutput`) work;
CoreMIDI is inherently multi-client (a DAW and Keyscene can open the same
device simultaneously); virtual sources appear to other apps within ~400 ms of
creation.

## Windows compatibility matrix

"Documented" = from platform/midir documentation and vendor announcements,
believed correct as of 2026-08. "Measured" rows get filled by running Spike A
on real hardware/VMs (protocol below).

| OS | Backend reached by midir | Multi-client (DAW + Keyscene on same device)? | Virtual ports | Status |
|---|---|---|---|---|
| Windows 10 | WinMM | **No** — second open of an in-use port fails | No OS support — user installs loopMIDI | documented, needs measurement |
| Win11 pre-24H2 | WinMM | No (same as Win10) | loopMIDI | documented, needs measurement |
| Win11 24H2/25H2 with Windows MIDI Services active | WinMM calls redirected through WMS service | **Yes** — WMS is multi-client by default, including for legacy WinMM apps once the compatibility layer is active | WMS supports app-created endpoints, but not via WinMM/midir — still loopMIDI for us | documented, needs measurement |
| Win11 24H2+, WMS rollout not yet applied | WinMM (classic) | No | loopMIDI | documented, needs measurement |

Product consequences (already in PLAN.md §3.1, reaffirmed):

1. Detect "port open failed because another client holds it" and show the
   targeted help panel with loopMIDI copy-paste setup — this is the Win10 and
   pre-WMS Win11 experience.
2. On Win11 with WMS active the same `midir` code just works multi-client; we
   must detect that and *not* show the warning. Detection approach to verify
   during Phase 2: attempt the open and only branch on failure (avoids version
   sniffing entirely — preferred), plus optional registry/service check
   (`MidiSrv` running) for diagnostics.
3. Port names may differ between WinMM-classic and WMS-redirected views of the
   same hardware (WMS composes endpoint names differently). The device-memory
   feature ("remember last-used device", §3.1) must match tolerantly
   (substring/fuzzy), not by exact string.

## Pending measurements (protocol)

On each Windows row above, with a hardware controller attached:

1. `cargo run -p keyscene-midi --bin spike_a_latency list` — record exact port
   names seen (compare WMS vs classic naming).
2. Open the device in a DAW (Reaper is free-ish and easy), then run
   `... spike_a_latency listen <idx>` — record whether the open succeeds
   (multi-client check) and the exact error text when it fails (drives the
   help-panel copy and the failure-detection branch).
3. `... spike_a_latency listen <idx>` alone; play; sanity-check Δwall
   inter-arrival jitter while holding chords.
4. Record Windows build (`winver`), WMS service state
   (`sc query MidiSrv`), and whether the "Windows MIDI Services" settings page
   exists.

CI note: GitHub `windows-latest` runners build the harness (already in the
workspace) but have no MIDI devices and an unknown WMS state, so the matrix
cannot be filled from CI — it needs a human with hardware once, before Phase 2
sign-off.

## Alternatives considered

- **midir `winrt` backend**: multi-client on Win10+, but UWP MIDI has known
  higher latency/jitter, spotty driver behavior, and midir's WinRT path is far
  less used. WMS makes it a dead end (Microsoft positions WMS as the
  replacement for both).
- **Native WMS SDK adapter now**: multi-client + app-to-app MIDI natively, but
  the C++/COM SDK + Rust bindings story is immature and it only helps the
  newest Windows. The WinMM-redirection path gives us the main benefit
  (multi-client) with zero code. Revisit for virtual-port UX in v1.x.
- **RtMidi via FFI / other crates**: no advantage over midir (midir *is* the
  maintained Rust RtMidi analogue) and adds C++ build pain on Windows.
