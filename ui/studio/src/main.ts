// Studio mode SPA (§3.3): three synced views (ChordCard, Staff, Keyboard),
// key selector + Roman numerals, settings, QWERTY fallback. All analysis
// happens in the Rust backend; this file renders StatePayload events.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  applyThemeCss,
  ChordCard,
  darkTheme,
  Keyboard,
  KEY_NAMES,
  PedalIndicator,
  Staff,
  type AppSettings,
  type DevicesPayload,
  type KeyboardSize,
  type MidiErrorPayload,
  type StatePayload,
} from "@keyscene/shared";
import { Qwerty } from "./qwerty";
import "./style.css";

const hasTauri = "__TAURI_INTERNALS__" in window;

// ---------- DOM scaffold ----------

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="ks-toolbar">
    <span class="ks-logo">Keyscene</span>
    <select id="device" title="MIDI input device"></select>
    <select id="key" title="Key context"></select>
    <span class="ks-spacer"></span>
    <button id="toggle-card" title="Show/hide chord card">Chord</button>
    <button id="toggle-staff" title="Show/hide staff">Staff</button>
    <button id="toggle-keys" title="Show/hide keyboard">Keys</button>
    <button id="settings-btn" title="Settings">⚙</button>
  </div>
  <div class="ks-main">
    <div id="chordcard" class="ks-panel ks-chordcard"></div>
    <div id="staff" class="ks-panel ks-staff"></div>
    <div id="keyboard" class="ks-panel ks-keyboard"></div>
  </div>
  <div class="ks-status">
    <div id="pedals"></div>
    <span id="device-status"></span>
    <span class="ks-spacer"></span>
    <span id="qwerty-hint"></span>
  </div>

  <dialog id="settings-dialog">
    <h2>Settings</h2>
    <div class="ks-form-row"><label for="s-lang">Note names</label>
      <select id="s-lang">
        <option value="english">English (C D E)</option>
        <option value="german">German (C D E … H)</option>
        <option value="solfege">Solfège (Do Re Mi)</option>
      </select></div>
    <div class="ks-form-row"><label for="s-acc">Accidentals</label>
      <select id="s-acc">
        <option value="auto">Automatic</option>
        <option value="sharps">Prefer sharps</option>
        <option value="flats">Prefer flats</option>
      </select></div>
    <div class="ks-form-row"><label for="s-rn">Roman numerals</label>
      <select id="s-rn">
        <option value="textbook">Textbook (I, iii, V7)</option>
        <option value="quality">Quality (I, IIIm, V7)</option>
      </select></div>
    <div class="ks-form-row"><label for="s-sustained">Include pedal-sustained notes in analysis</label>
      <input type="checkbox" id="s-sustained" /></div>
    <div class="ks-form-row"><label for="s-kbsize">Keyboard size</label>
      <select id="s-kbsize">
        <option value="49">49 keys</option>
        <option value="61">61 keys</option>
        <option value="76">76 keys</option>
        <option value="88">88 keys</option>
      </select></div>
    <div class="ks-form-row"><label for="s-channel">MIDI channels</label>
      <select id="s-channel"></select></div>
    <div class="ks-dialog-actions">
      <button id="settings-close">Done</button>
    </div>
  </dialog>

  <dialog id="busy-dialog">
    <h2>Your MIDI device is in use</h2>
    <p id="busy-detail" style="font-size:13px; color: var(--ks-muted)"></p>
    <p style="font-size:13px; margin-top:8px">
      On this version of Windows, only one app can open a MIDI device at a
      time — your DAW probably has it. Two ways to fix this:</p>
    <h3>Option 1 — close the other app</h3>
    <p style="font-size:13px">Close the DAW (or its MIDI preferences), then pick the device again.</p>
    <h3>Option 2 — share the device with loopMIDI (free)</h3>
    <ol class="ks-help-steps">
      <li>Install loopMIDI from tobias-erichsen.de</li>
      <li>In loopMIDI, click “+” to create a port named:
        <code class="ks-help-code">Keyscene Share</code></li>
      <li>In your DAW, add a MIDI send/output to “Keyscene Share”</li>
      <li>In Keyscene, select “Keyscene Share” as the input device</li>
    </ol>
    <p style="font-size:12px; color: var(--ks-muted)">
      On Windows 11 with Windows MIDI Services active, devices are shareable
      and this panel never appears.</p>
    <div class="ks-dialog-actions">
      <button id="busy-close">Close</button>
    </div>
  </dialog>
`;

applyThemeCss(darkTheme);

// ---------- components ----------

const chordCard = new ChordCard(document.getElementById("chordcard")!);
const staff = new Staff(document.getElementById("staff")!, darkTheme);
const keyboard = new Keyboard(document.getElementById("keyboard")!, darkTheme);
const pedalIndicator = new PedalIndicator(document.getElementById("pedals")!);

const deviceSel = document.getElementById("device") as HTMLSelectElement;
const keySel = document.getElementById("key") as HTMLSelectElement;
const deviceStatus = document.getElementById("device-status")!;
const qwertyHint = document.getElementById("qwerty-hint")!;
const settingsDialog = document.getElementById("settings-dialog") as HTMLDialogElement;
const busyDialog = document.getElementById("busy-dialog") as HTMLDialogElement;

const panels = {
  showChordCard: document.getElementById("chordcard")!,
  showStaff: document.getElementById("staff")!,
  showKeyboard: document.getElementById("keyboard")!,
} as const;
const toggles = {
  showChordCard: document.getElementById("toggle-card") as HTMLButtonElement,
  showStaff: document.getElementById("toggle-staff") as HTMLButtonElement,
  showKeyboard: document.getElementById("toggle-keys") as HTMLButtonElement,
} as const;

// Key selector options.
{
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No key";
  keySel.appendChild(none);
  for (const name of KEY_NAMES) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name.endsWith("m")
      ? `${name.slice(0, -1)} minor`
      : `${name} major`;
    keySel.appendChild(opt);
  }
}

// Channel filter options.
{
  const chSel = document.getElementById("s-channel") as HTMLSelectElement;
  const all = document.createElement("option");
  all.value = "65535";
  all.textContent = "All channels";
  chSel.appendChild(all);
  for (let ch = 0; ch < 16; ch++) {
    const opt = document.createElement("option");
    opt.value = String(1 << ch);
    opt.textContent = `Channel ${ch + 1} only`;
    chSel.appendChild(opt);
  }
}

// ---------- state ----------

let settings: AppSettings | null = null;

function renderState(s: StatePayload): void {
  settings = s.settings;
  chordCard.update(s.analysis);
  staff.render(s.analysis.spelledNotes, s.settings.key);
  keyboard.setSize(s.settings.keyboardSize);
  keyboard.setNotes(s.held, s.sustained);
  pedalIndicator.update(s.pedals);

  keySel.value = s.settings.key ?? "";
  for (const k of ["showChordCard", "showStaff", "showKeyboard"] as const) {
    panels[k].hidden = !s.settings[k];
    toggles[k].classList.toggle("ks-active", s.settings[k]);
  }
  (document.getElementById("s-lang") as HTMLSelectElement).value = s.settings.engine.nameLanguage;
  (document.getElementById("s-acc") as HTMLSelectElement).value = s.settings.engine.accidentalPref;
  (document.getElementById("s-rn") as HTMLSelectElement).value = s.settings.engine.rnConvention;
  (document.getElementById("s-sustained") as HTMLInputElement).checked = s.settings.includeSustained;
  (document.getElementById("s-kbsize") as HTMLSelectElement).value = String(s.settings.keyboardSize);
  (document.getElementById("s-channel") as HTMLSelectElement).value = String(s.settings.channelMask);
}

function renderDevices(d: DevicesPayload): void {
  deviceSel.replaceChildren();
  const none = document.createElement("option");
  none.value = "-1";
  none.textContent = d.devices.length ? "No device (QWERTY only)" : "No MIDI devices — QWERTY active";
  deviceSel.appendChild(none);
  for (const dev of d.devices) {
    const opt = document.createElement("option");
    opt.value = String(dev.index);
    opt.textContent = dev.name;
    deviceSel.appendChild(opt);
  }
  const current = d.devices.find((dev) => dev.name === d.current);
  deviceSel.value = current ? String(current.index) : "-1";
  deviceStatus.textContent = d.current ? `Connected: ${d.current}` : "No MIDI device connected";
}

async function pushSettings(patch: Partial<AppSettings>): Promise<void> {
  if (!settings) return;
  settings = { ...settings, ...patch };
  await invoke("set_settings", { settings });
}

// ---------- wiring ----------

deviceSel.addEventListener("change", async () => {
  const index = Number(deviceSel.value);
  try {
    if (index < 0) {
      await invoke("disconnect_device");
    } else {
      await invoke("select_device", { index });
    }
  } catch (e) {
    showMidiError(e as MidiErrorPayload);
  }
});

keySel.addEventListener("change", () => {
  void pushSettings({ key: keySel.value || null });
});

for (const k of ["showChordCard", "showStaff", "showKeyboard"] as const) {
  toggles[k].addEventListener("click", () => {
    if (settings) void pushSettings({ [k]: !settings[k] } as Partial<AppSettings>);
  });
}

document.getElementById("settings-btn")!.addEventListener("click", () => settingsDialog.showModal());
document.getElementById("settings-close")!.addEventListener("click", () => settingsDialog.close());
document.getElementById("busy-close")!.addEventListener("click", () => busyDialog.close());

document.getElementById("s-lang")!.addEventListener("change", (e) => {
  if (!settings) return;
  void pushSettings({
    engine: { ...settings.engine, nameLanguage: (e.target as HTMLSelectElement).value as never },
  });
});
document.getElementById("s-acc")!.addEventListener("change", (e) => {
  if (!settings) return;
  void pushSettings({
    engine: { ...settings.engine, accidentalPref: (e.target as HTMLSelectElement).value as never },
  });
});
document.getElementById("s-rn")!.addEventListener("change", (e) => {
  if (!settings) return;
  void pushSettings({
    engine: { ...settings.engine, rnConvention: (e.target as HTMLSelectElement).value as never },
  });
});
document.getElementById("s-sustained")!.addEventListener("change", (e) => {
  void pushSettings({ includeSustained: (e.target as HTMLInputElement).checked });
});
document.getElementById("s-kbsize")!.addEventListener("change", (e) => {
  void pushSettings({ keyboardSize: Number((e.target as HTMLSelectElement).value) as KeyboardSize });
});
document.getElementById("s-channel")!.addEventListener("change", (e) => {
  void pushSettings({ channelMask: Number((e.target as HTMLSelectElement).value) });
});

function showMidiError(err: MidiErrorPayload): void {
  if (err && err.kind === "deviceBusy") {
    document.getElementById("busy-detail")!.textContent =
      `${err.device}: ${err.detail}`;
    busyDialog.showModal();
  } else {
    deviceStatus.textContent = `MIDI error: ${err?.detail ?? String(err)}`;
  }
}

// QWERTY fallback → backend note events (same pipeline as hardware input).
const qwerty = new Qwerty({
  noteOn: (midi) => void invoke("note_event", { on: true, midi }).catch(() => {}),
  noteOff: (midi) => void invoke("note_event", { on: false, midi }).catch(() => {}),
  sustain: (down) => void invoke("sustain_event", { down }).catch(() => {}),
  octaveChanged: (base) => updateQwertyHint(base),
});

function updateQwertyHint(base: number): void {
  const octave = Math.floor(base / 12) - 1;
  qwertyHint.textContent = `QWERTY: A–' play · Z/X octave (C${octave}) · Space sustain`;
}
updateQwertyHint(qwerty.octaveBase);

// ---------- startup ----------

// Browser-only dev preview: `vite dev` + ?demo renders a canned state so
// components can be worked on without the Tauri shell.
function demoState(): StatePayload {
  return {
    analysis: {
      chordNames: [
        { text: "C7(#5#9)", kind: "chord", score: 90 },
        { text: "C7(#9b13)", kind: "chord", score: 80 },
      ],
      spelledNotes: [
        { letter: "C", acc: 0, octave: 3, midi: 48, text: "C3" },
        { letter: "E", acc: 0, octave: 3, midi: 52, text: "E3" },
        { letter: "G", acc: 1, octave: 3, midi: 56, text: "G#3" },
        { letter: "B", acc: -1, octave: 3, midi: 58, text: "Bb3" },
        { letter: "D", acc: 1, octave: 4, midi: 63, text: "D#4" },
      ],
      romanNumeral: "V7(#5#9)/IV",
      intervals: ["M3", "A5", "m7", "A9"],
      bassNote: { letter: "C", acc: 0, octave: 3, midi: 48, text: "C3" },
      inversion: 0,
      isPartial: false,
    },
    held: [48, 52, 56, 58, 63],
    sustained: [],
    pedals: { sustain: false, sostenuto: false, soft: false },
    settings: {
      engine: { accidentalPref: "auto", rnConvention: "textbook", nameLanguage: "english" },
      includeSustained: true,
      channelMask: 0xffff,
      keyboardSize: 61,
      lastDevice: null,
      key: "C",
      showChordCard: true,
      showStaff: true,
      showKeyboard: true,
    },
  };
}

async function start(): Promise<void> {
  if (!hasTauri) {
    deviceStatus.textContent = "Browser preview — run the Keyscene app for MIDI";
    if (new URLSearchParams(location.search).has("demo")) {
      renderState(demoState());
    }
    return;
  }
  await listen<StatePayload>("state", (e) => renderState(e.payload));
  await listen<DevicesPayload>("devices", (e) => renderDevices(e.payload));
  await listen<MidiErrorPayload>("midi-error", (e) => showMidiError(e.payload));
  renderState(await invoke<StatePayload>("get_state"));
  renderDevices(await invoke<DevicesPayload>("get_devices"));
}

void start();
