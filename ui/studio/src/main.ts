// Studio mode SPA (§3.3): three synced views (ChordCard, Staff, Keyboard),
// key selector + Roman numerals, settings, QWERTY fallback. All analysis
// happens in the Rust backend; this file renders StatePayload events.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  applyThemeCss,
  ChordCard,
  FONT_CHOICES,
  Keyboard,
  KEY_NAMES,
  PedalIndicator,
  resolveTheme,
  Staff,
  THEMES,
  type AppSettings,
  type DevicesPayload,
  type KeyboardSize,
  type MidiErrorPayload,
  type StatePayload,
  type Theme,
} from "@keyscene/shared";
import { demoSettings, demoState } from "./demo";
import { Qwerty } from "./qwerty";
import "./style.css";

const hasTauri = "__TAURI_INTERNALS__" in window;

// First-paint theme, before settings arrive from the backend.
const defaultTheme = THEMES.light.theme;

// ---------- DOM scaffold ----------

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="ks-toolbar">
    <span class="ks-logo" aria-label="Keyscene">
      <svg class="ks-logo-mark" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="1" y="3" width="3.2" height="14" rx="1.6" />
        <rect x="5.6" y="3" width="3.2" height="14" rx="1.6" class="ks-logo-accent" />
        <rect x="10.2" y="3" width="3.2" height="10" rx="1.6" />
        <rect x="14.8" y="3" width="3.2" height="14" rx="1.6" />
      </svg>
      <span class="ks-logo-word">Keyscene</span>
    </span>
    <select id="device" title="MIDI input device"></select>
    <select id="key" title="Key context"></select>
    <span class="ks-spacer"></span>
    <button id="toggle-card" title="Show/hide chord card">Chord</button>
    <button id="toggle-staff" title="Show/hide staff">Staff</button>
    <button id="toggle-keys" title="Show/hide keyboard">Keys</button>
    <button id="display-btn" title="Display mode: chrome-free view for OBS / screen share (Ctrl/Cmd+D)">Display</button>
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
    <div class="ks-form-row"><label for="s-theme">Theme</label>
      <select id="s-theme"></select></div>
    <div id="s-custom-theme" hidden></div>
    <div class="ks-form-row">
      <label for="s-hold" title="How long a chord name stays up when notes drop away, so names don't flicker during arpeggios">Chord hold (anti-flicker)</label>
      <span><input type="range" id="s-hold" min="0" max="2000" step="50" style="width:130px;vertical-align:middle" />
        <span id="s-hold-val" style="display:inline-block;min-width:52px;color:var(--ks-muted)"></span></span></div>
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

applyThemeCss(defaultTheme);

// ---------- components ----------

const chordCard = new ChordCard(document.getElementById("chordcard")!);
const staff = new Staff(document.getElementById("staff")!, defaultTheme);
const keyboard = new Keyboard(document.getElementById("keyboard")!, defaultTheme);
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

// Theme options + custom-theme editor (§3.4: presets + full custom colors
// and font choice).
const themeSel = document.getElementById("s-theme") as HTMLSelectElement;
{
  for (const [id, { label }] of Object.entries(THEMES)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    themeSel.appendChild(opt);
  }
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom…";
  themeSel.appendChild(custom);
}

const THEME_TOKENS: [keyof Theme, string][] = [
  ["bg", "Background"],
  ["panel", "Panels"],
  ["ink", "Ink"],
  ["muted", "Muted text"],
  ["accent", "Accent / held notes"],
  ["sustain", "Sustained notes"],
  ["keyWhite", "White keys"],
  ["keyBlack", "Black keys"],
  ["keyEdge", "Key outlines"],
];
const customEditor = document.getElementById("s-custom-theme")!;
const customInputs = new Map<keyof Theme, HTMLInputElement>();
{
  for (const [token, label] of THEME_TOKENS) {
    const row = document.createElement("div");
    row.className = "ks-form-row";
    const lab = document.createElement("label");
    lab.textContent = label;
    const input = document.createElement("input");
    input.type = "color";
    input.addEventListener("input", () => {
      if (!settings) return;
      pushSettingsSoon({
        customTheme: { ...settings.customTheme, [token]: input.value },
      });
    });
    customInputs.set(token, input);
    row.append(lab, input);
    customEditor.appendChild(row);
  }
  const row = document.createElement("div");
  row.className = "ks-form-row";
  const lab = document.createElement("label");
  lab.textContent = "Font";
  const fontSel = document.createElement("select");
  fontSel.id = "s-font";
  for (const [id, { label }] of Object.entries(FONT_CHOICES)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    fontSel.appendChild(opt);
  }
  fontSel.addEventListener("change", () => {
    if (!settings) return;
    void pushSettings({
      customTheme: {
        ...settings.customTheme,
        font: FONT_CHOICES[fontSel.value].stack,
      },
    });
  });
  row.append(lab, fontSel);
  customEditor.appendChild(row);
}

// ---------- state ----------

let settings: AppSettings | null = null;
let lastState: StatePayload | null = null;
let appliedTheme = "";
let displayActive = false;

function applyTheme(s: AppSettings): void {
  const sig = `${s.theme}|${JSON.stringify(s.customTheme)}`;
  if (sig === appliedTheme) return;
  appliedTheme = sig;
  const theme = resolveTheme(s.theme, s.customTheme);
  applyThemeCss(theme);
  staff.setTheme(theme);
  keyboard.setTheme(theme);
}

/** Per-note path ("state" events): components only, no settings DOM. */
function renderNotes(s: StatePayload): void {
  lastState = s;
  chordCard.update(s.analysis, s.pedals);
  if (!panels.showStaff.hidden) {
    staff.render(s.analysis.spelledNotes, settings?.key ?? null);
  }
  keyboard.setNotes(s.held, s.sustained, s.analysis.spelledNotes);
  pedalIndicator.update(s.pedals);
}

/** Settings path ("settings" events): rare, user-initiated. */
function renderSettings(s: AppSettings): void {
  // A local edit is being debounced — don't let the (stale) broadcast
  // revert the control the user is touching; our push re-syncs shortly.
  if (pushTimer !== null) return;
  settings = s;
  applyTheme(s);
  chordCard.setHoldMs(s.holdMs);
  keyboard.setSize(s.keyboardSize);

  keySel.value = s.key ?? "";
  for (const k of ["showChordCard", "showStaff", "showKeyboard"] as const) {
    panels[k].hidden = !s[k];
    toggles[k].classList.toggle("ks-active", s[k]);
  }
  (document.getElementById("s-lang") as HTMLSelectElement).value = s.engine.nameLanguage;
  (document.getElementById("s-acc") as HTMLSelectElement).value = s.engine.accidentalPref;
  (document.getElementById("s-rn") as HTMLSelectElement).value = s.engine.rnConvention;
  (document.getElementById("s-sustained") as HTMLInputElement).checked = s.includeSustained;
  (document.getElementById("s-kbsize") as HTMLSelectElement).value = String(s.keyboardSize);
  (document.getElementById("s-channel") as HTMLSelectElement).value = String(s.channelMask);

  themeSel.value = s.theme;
  customEditor.hidden = s.theme !== "custom";
  const resolved = resolveTheme(s.theme, s.customTheme);
  for (const [token, input] of customInputs) {
    if (input !== document.activeElement) input.value = resolved[token];
  }
  const fontSel = document.getElementById("s-font") as HTMLSelectElement;
  const fontId = Object.entries(FONT_CHOICES).find(([, f]) => f.stack === resolved.font)?.[0];
  fontSel.value = fontId ?? "system";
  (document.getElementById("s-hold") as HTMLInputElement).value = String(s.holdMs);
  document.getElementById("s-hold-val")!.textContent = `${s.holdMs} ms`;

  // Key context or a just-unhidden panel changes what the staff shows.
  if (!panels.showStaff.hidden && lastState) {
    staff.render(lastState.analysis.spelledNotes, s.key);
  }
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
  // QWERTY is the no-hardware fallback — only pitch its instructions
  // when there is no device to play.
  qwertyHint.hidden = Boolean(d.current);
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

async function pushSettings(patch: Partial<AppSettings>): Promise<void> {
  if (!settings) return;
  settings = { ...settings, ...patch };
  if (pushTimer !== null) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await invoke("set_settings", { settings }).catch(() => {});
}

/** Debounced variant for continuous inputs (sliders, color pickers) —
 *  each raw `input` tick otherwise hits disk + broadcast in the backend. */
function pushSettingsSoon(patch: Partial<AppSettings>): void {
  if (!settings) return;
  settings = { ...settings, ...patch };
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (settings) void invoke("set_settings", { settings }).catch(() => {});
  }, 200);
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

// Display mode (§3.4): button + Ctrl/Cmd+D. The backend swaps windows and
// broadcasts "display-mode" so the button label tracks the real state
// (Studio stays visible as the control surface when click-through is on).
const displayBtn = document.getElementById("display-btn") as HTMLButtonElement;

function setDisplayMode(on: boolean): void {
  void invoke("set_display_mode", { on }).catch(() => {});
}
displayBtn.addEventListener("click", () => setDisplayMode(!displayActive));
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();
    setDisplayMode(!displayActive);
  }
});

function onDisplayMode(on: boolean): void {
  displayActive = on;
  displayBtn.textContent = on ? "Exit Display" : "Display";
  displayBtn.classList.toggle("ks-active", on);
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
themeSel.addEventListener("change", () => {
  if (!settings) return;
  // First switch to Custom: seed the editor from the theme on screen so
  // the user tweaks what they see instead of starting from scratch.
  if (themeSel.value === "custom" && Object.keys(settings.customTheme).length === 0) {
    const current = resolveTheme(settings.theme, settings.customTheme);
    void pushSettings({ theme: "custom", customTheme: { ...current } });
  } else {
    void pushSettings({ theme: themeSel.value });
  }
});
document.getElementById("s-hold")!.addEventListener("input", (e) => {
  const holdMs = Number((e.target as HTMLInputElement).value);
  document.getElementById("s-hold-val")!.textContent = `${holdMs} ms`;
  chordCard.setHoldMs(holdMs);
  pushSettingsSoon({ holdMs });
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
  qwertyHint.textContent = `Type to play: A–' keys · Z/X octave (C${octave}) · Space sustain`;
}
updateQwertyHint(qwerty.octaveBase);

// ---------- startup ----------

async function start(): Promise<void> {
  if (!hasTauri) {
    deviceStatus.textContent = "Browser preview — run the Keyscene app for MIDI";
    if (new URLSearchParams(location.search).has("demo")) {
      // Canned state (src/demo.ts) so components render without the shell.
      renderSettings(demoSettings());
      renderNotes(demoState());
    }
    return;
  }
  await listen<StatePayload>("state", (e) => renderNotes(e.payload));
  await listen<AppSettings>("settings", (e) => renderSettings(e.payload));
  await listen<DevicesPayload>("devices", (e) => renderDevices(e.payload));
  await listen<MidiErrorPayload>("midi-error", (e) => showMidiError(e.payload));
  await listen<boolean>("display-mode", (e) => onDisplayMode(e.payload));
  renderSettings(await invoke<AppSettings>("get_settings"));
  renderNotes(await invoke<StatePayload>("get_state"));
  renderDevices(await invoke<DevicesPayload>("get_devices"));
}

start().catch((e: unknown) => {
  // A failed bootstrap must be visible, not a blank window.
  deviceStatus.textContent = `Startup failed: ${String(e)}`;
});
