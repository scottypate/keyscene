// Display mode (§3.4): the same elements as Studio, stripped of chrome,
// individually movable/scalable on a transparent or chroma-key canvas.
// Runs in the second Tauri window ("display"); Studio toggles it via the
// set_display_mode command. All layout state persists in AppSettings.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  applyThemeCss,
  ChordCard,
  darkTheme,
  Keyboard,
  KeyReadout,
  PedalIndicator,
  resolveTheme,
  Staff,
  THEMES,
  type AppSettings,
  type DisplayElementId,
  type LayoutPreset,
  type StatePayload,
} from "@keyscene/shared";
import { BUILT_IN_PRESETS } from "./presets";
import { demoSettings, demoState } from "./demo";
import "./style.css";
import "./display.css";

const hasTauri = "__TAURI_INTERNALS__" in window;

// ---------- DOM scaffold ----------

const root = document.getElementById("display")!;
root.innerHTML = `
  <div id="el-keyreadout" class="ks-el ks-el-keyreadout"></div>
  <div id="el-chordcard" class="ks-el ks-el-chordcard"></div>
  <div id="el-staff" class="ks-el ks-el-staff"></div>
  <div id="el-keyboard" class="ks-el ks-el-keyboard"></div>
  <div id="el-pedals" class="ks-el ks-el-pedals"></div>

  <div class="ks-display-toolbar" id="toolbar">
    <span class="ks-toolbar-grip" data-tauri-drag-region title="Drag to move the window">⠿</span>
    <select id="preset" title="Layout preset"></select>
    <button id="preset-save" title="Save current layout as a preset">Save…</button>
    <input type="text" id="preset-name" placeholder="Preset name" hidden style="width:110px" />
    <span class="ks-toolbar-sep"></span>
    <button class="ks-chip" data-el="chordCard" title="Show/hide chord card">Chord</button>
    <button class="ks-chip" data-el="staff" title="Show/hide staff">Staff</button>
    <button class="ks-chip" data-el="keyboard" title="Show/hide keyboard">Keys</button>
    <button class="ks-chip" data-el="pedals" title="Show/hide pedals">Pedals</button>
    <button class="ks-chip" data-el="keyReadout" title="Show/hide key readout">Key</button>
    <span class="ks-toolbar-sep"></span>
    <button class="ks-swatch ks-swatch-transparent" data-bg="transparent" title="Transparent background"></button>
    <button class="ks-swatch" data-bg="#00b140" style="background:#00b140" title="Chroma green"></button>
    <button class="ks-swatch" data-bg="#ff00ff" style="background:#ff00ff" title="Chroma magenta"></button>
    <button class="ks-swatch" data-bg="#0047ab" style="background:#0047ab" title="Chroma blue"></button>
    <button class="ks-swatch" data-bg="#000000" style="background:#000" title="Black"></button>
    <input type="color" id="bg-custom" class="ks-swatch" value="#101014" title="Custom background color" />
    <span class="ks-toolbar-sep"></span>
    <select id="theme" title="Theme"></select>
    <label title="Chord-hold time: how long a name stays up when notes drop away (anti-flicker)">
      hold <input type="range" id="hold" min="0" max="2000" step="50" style="width:80px" />
      <span class="ks-hold-val" id="hold-val"></span>
    </label>
    <span class="ks-toolbar-sep"></span>
    <label title="Keep this window above every other app"><input type="checkbox" id="ontop" />on top</label>
    <label title="Clicks pass through to apps underneath; the Studio window reopens so you keep control"><input type="checkbox" id="clickthru" />click-through</label>
    <span class="ks-toolbar-sep"></span>
    <button id="help-btn" title="Setup guide">?</button>
    <button id="exit-btn" title="Back to Studio (Esc)">Studio</button>
  </div>

  <div class="ks-display-help" id="help" hidden>
    <div class="ks-display-help-card">
      <h2>Set up your scene</h2>
      <ol>
        <li><strong>Arrange:</strong> drag any element to move it, scroll over
          it to resize. Move the mouse to wake the toolbar and show/hide
          elements or pick a layout preset.</li>
        <li><strong>Background:</strong> transparent, or a solid color for
          chroma keying. Themes restyle every element.</li>
        <li><strong>Capture in OBS:</strong> add a <em>Window Capture</em> of
          “Keyscene Display”. With a solid color, add Filters → Chroma Key and
          pick that color. “on top” keeps the window above your DAW;
          “click-through” lets clicks pass to apps beneath it (the Studio
          window reopens so you keep control).</li>
      </ol>
      <p>Return to Studio anytime with <kbd>Esc</kbd> or the Studio button.
        Nothing extra is captured once the mouse settles — the toolbar and
        outlines hide themselves.</p>
      <div class="ks-dialog-actions">
        <button id="help-close">Got it</button>
      </div>
    </div>
  </div>
`;

// ---------- components ----------

const chordCard = new ChordCard(document.getElementById("el-chordcard")!);
const staff = new Staff(document.getElementById("el-staff")!, darkTheme);
const keyboard = new Keyboard(document.getElementById("el-keyboard")!, darkTheme);
const pedals = new PedalIndicator(document.getElementById("el-pedals")!);
const keyReadout = new KeyReadout(document.getElementById("el-keyreadout")!);

const elDom: Record<DisplayElementId, HTMLElement> = {
  chordCard: document.getElementById("el-chordcard")!,
  staff: document.getElementById("el-staff")!,
  keyboard: document.getElementById("el-keyboard")!,
  pedals: document.getElementById("el-pedals")!,
  keyReadout: document.getElementById("el-keyreadout")!,
};
const ELEMENT_IDS = Object.keys(elDom) as DisplayElementId[];

const presetSel = document.getElementById("preset") as HTMLSelectElement;
const presetName = document.getElementById("preset-name") as HTMLInputElement;
const themeSel = document.getElementById("theme") as HTMLSelectElement;
const holdInput = document.getElementById("hold") as HTMLInputElement;
const holdVal = document.getElementById("hold-val")!;
const onTop = document.getElementById("ontop") as HTMLInputElement;
const clickThru = document.getElementById("clickthru") as HTMLInputElement;
const helpOverlay = document.getElementById("help")!;

for (const [id, { label }] of Object.entries(THEMES)) {
  const opt = document.createElement("option");
  opt.value = id;
  opt.textContent = label;
  themeSel.appendChild(opt);
}
{
  const opt = document.createElement("option");
  opt.value = "custom";
  opt.textContent = "Custom";
  themeSel.appendChild(opt);
}

// ---------- state ----------

let settings: AppSettings | null = null;
let appliedTheme = "";
let dragging = false;
// Sentinel that never matches a real signature, so the first render builds.
let presetSig = "\u0000";

function applyLayout(): void {
  if (!settings) return;
  for (const id of ELEMENT_IDS) {
    const l = settings.display.elements[id];
    const dom = elDom[id];
    dom.hidden = !l.visible;
    dom.style.left = `${l.x}%`;
    dom.style.top = `${l.y}%`;
    // zoom, not transform: scale — a scaled transform layer is rasterized
    // at layout size and stretched (blurry); zoom re-lays-out so SVG and
    // text stay sharp at any scale. Positions are %, so they're unaffected.
    dom.style.setProperty("zoom", String(l.scale));
    document
      .querySelector(`.ks-chip[data-el="${id}"]`)!
      .classList.toggle("ks-active", l.visible);
  }
  const bg = settings.display.background;
  document.body.style.background = bg === "transparent" ? "transparent" : bg;
  for (const sw of document.querySelectorAll<HTMLElement>(".ks-swatch[data-bg]")) {
    sw.classList.toggle("ks-active", sw.dataset.bg === bg);
  }
}

function applyTheme(): void {
  if (!settings) return;
  const sig = `${settings.theme}|${JSON.stringify(settings.customTheme)}`;
  if (sig === appliedTheme) return;
  appliedTheme = sig;
  const theme = resolveTheme(settings.theme, settings.customTheme);
  applyThemeCss(theme);
  staff.setTheme(theme);
  keyboard.setTheme(theme);
}

let lastState: StatePayload | null = null;

/** Per-note path ("state" events): components only, no layout/chrome. */
function renderNotes(s: StatePayload): void {
  lastState = s;
  chordCard.update(s.analysis, s.pedals);
  keyReadout.update(s.analysis, s.pedals);
  if (!elDom.staff.hidden) {
    staff.render(s.analysis.spelledNotes, settings?.key ?? null);
  }
  keyboard.setNotes(s.held, s.sustained);
  pedals.update(s.pedals);
}

/** Settings path ("settings" events): rare, user-initiated. */
function renderSettings(s: AppSettings): void {
  // Local display edits (drag/scale/hold/theme) may not have been pushed
  // yet; a settings broadcast must not snap them back to the stale backend
  // copy. Keep the local values until our own push lands.
  let next = s;
  if (settings && (dragging || pushTimer !== null)) {
    next = {
      ...next,
      display: settings.display,
      holdMs: settings.holdMs,
      theme: settings.theme,
      customTheme: settings.customTheme,
    };
  }
  settings = next;
  chordCard.setHoldMs(settings.holdMs);
  keyReadout.setHoldMs(settings.holdMs);
  keyReadout.setKey(settings.key);
  keyboard.setSize(settings.keyboardSize);

  applyTheme();
  applyLayout();

  themeSel.value = settings.theme;
  holdInput.value = String(settings.holdMs);
  holdVal.textContent = `${settings.holdMs} ms`;
  onTop.checked = settings.display.alwaysOnTop;
  clickThru.checked = settings.display.clickThrough;
  // Only rebuild the preset dropdown when the saved-preset list actually
  // changed (a rebuild would close an open dropdown mid-performance).
  const sig = userPresets()
    .map((p) => p.name)
    .join("|");
  if (sig !== presetSig) {
    presetSig = sig;
    rebuildPresetOptions();
  }
  // Key context or a just-unhidden staff element needs a refresh.
  if (!elDom.staff.hidden && lastState) {
    staff.render(lastState.analysis.spelledNotes, settings.key);
  }
}

// ---------- settings push (debounced for drag/resize streams) ----------

let pushTimer: ReturnType<typeof setTimeout> | null = null;

function pushSettingsSoon(): void {
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (settings && hasTauri) void invoke("set_settings", { settings });
  }, 300);
}

function pushSettingsNow(): void {
  if (pushTimer !== null) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (settings && hasTauri) void invoke("set_settings", { settings });
}

// ---------- drag + wheel-resize ----------

for (const id of ELEMENT_IDS) {
  const dom = elDom[id];

  dom.addEventListener("pointerdown", (e) => {
    if (!settings || e.button !== 0) return;
    e.preventDefault();
    dom.setPointerCapture(e.pointerId);
    dom.classList.add("ks-dragging");
    dragging = true;
    const start = e;
    const orig = { ...settings.display.elements[id] };

    const onMove = (ev: PointerEvent): void => {
      if (!settings) return;
      const l = settings.display.elements[id];
      l.x = clamp(orig.x + ((ev.clientX - start.clientX) / innerWidth) * 100, -20, 98);
      l.y = clamp(orig.y + ((ev.clientY - start.clientY) / innerHeight) * 100, -20, 98);
      applyLayout();
    };
    const onUp = (): void => {
      dom.classList.remove("ks-dragging");
      dragging = false;
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointercancel", onUp);
      dom.removeEventListener("lostpointercapture", onUp);
      pushSettingsSoon();
    };
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    // A cancelled gesture must not leave `dragging` stuck (it gates
    // settings sync and the toolbar auto-hide) or stack move handlers.
    dom.addEventListener("pointercancel", onUp);
    dom.addEventListener("lostpointercapture", onUp);
  });

  dom.addEventListener(
    "wheel",
    (e) => {
      if (!settings) return;
      e.preventDefault();
      const l = settings.display.elements[id];
      l.scale = clamp(l.scale * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 0.25, 4);
      applyLayout();
      pushSettingsSoon();
    },
    { passive: false },
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---------- toolbar: auto-hide ----------

let editTimer: ReturnType<typeof setTimeout> | null = null;

function wakeToolbar(): void {
  document.body.classList.add("ks-editing");
  if (editTimer !== null) clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    if (!dragging) document.body.classList.remove("ks-editing");
  }, 2500);
}
window.addEventListener("pointermove", wakeToolbar);
// Keep it awake while the pointer is over it.
document.getElementById("toolbar")!.addEventListener("pointerenter", wakeToolbar);

// ---------- toolbar: presets ----------

function userPresets(): LayoutPreset[] {
  return settings?.display.presets ?? [];
}

function rebuildPresetOptions(): void {
  const current = presetSel.value;
  presetSel.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Layout…";
  presetSel.appendChild(placeholder);
  const groups: [string, LayoutPreset[]][] = [
    ["Built-in", BUILT_IN_PRESETS],
    ["Saved", userPresets()],
  ];
  for (const [label, presets] of groups) {
    if (presets.length === 0) continue;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const p of presets) {
      const opt = document.createElement("option");
      opt.value = `${label}:${p.name}`;
      opt.textContent = p.name;
      g.appendChild(opt);
    }
    presetSel.appendChild(g);
  }
  presetSel.value = current;
  if (presetSel.selectedIndex < 0) presetSel.value = "";
}

presetSel.addEventListener("change", () => {
  if (!settings || !presetSel.value) return;
  const [group, name] = [
    presetSel.value.slice(0, presetSel.value.indexOf(":")),
    presetSel.value.slice(presetSel.value.indexOf(":") + 1),
  ];
  const pool = group === "Built-in" ? BUILT_IN_PRESETS : userPresets();
  const preset = pool.find((p) => p.name === name);
  if (!preset) return;
  settings.display.background = preset.background;
  settings.display.elements = structuredClone(preset.elements);
  applyLayout();
  pushSettingsNow();
});

document.getElementById("preset-save")!.addEventListener("click", () => {
  if (presetName.hidden) {
    presetName.hidden = false;
    presetName.focus();
    return;
  }
  saveCurrentPreset();
});
presetName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveCurrentPreset();
  if (e.key === "Escape") presetName.hidden = true;
  e.stopPropagation();
});

function saveCurrentPreset(): void {
  const name = presetName.value.trim();
  if (!settings || !name) return;
  const preset: LayoutPreset = {
    name,
    background: settings.display.background,
    elements: structuredClone(settings.display.elements),
  };
  const others = settings.display.presets.filter((p) => p.name !== name);
  settings.display.presets = [...others, preset];
  presetName.value = "";
  presetName.hidden = true;
  rebuildPresetOptions();
  presetSel.value = `Saved:${name}`;
  pushSettingsNow();
}

// ---------- toolbar: elements, background, theme, hold ----------

for (const chip of document.querySelectorAll<HTMLButtonElement>(".ks-chip[data-el]")) {
  chip.addEventListener("click", () => {
    if (!settings) return;
    const id = chip.dataset.el as DisplayElementId;
    settings.display.elements[id].visible = !settings.display.elements[id].visible;
    applyLayout();
    pushSettingsNow();
  });
}

for (const sw of document.querySelectorAll<HTMLButtonElement>(".ks-swatch[data-bg]")) {
  sw.addEventListener("click", () => {
    if (!settings) return;
    settings.display.background = sw.dataset.bg!;
    applyLayout();
    pushSettingsNow();
  });
}
document.getElementById("bg-custom")!.addEventListener("input", (e) => {
  if (!settings) return;
  settings.display.background = (e.target as HTMLInputElement).value;
  applyLayout();
  pushSettingsSoon();
});

themeSel.addEventListener("change", () => {
  if (!settings) return;
  settings.theme = themeSel.value;
  applyTheme();
  pushSettingsNow();
});

holdInput.addEventListener("input", () => {
  if (!settings) return;
  settings.holdMs = Number(holdInput.value);
  holdVal.textContent = `${settings.holdMs} ms`;
  chordCard.setHoldMs(settings.holdMs);
  keyReadout.setHoldMs(settings.holdMs);
  pushSettingsSoon();
});

// ---------- toolbar: window options, help, exit ----------

function pushDisplayOpts(): void {
  if (!settings) return;
  settings.display.alwaysOnTop = onTop.checked;
  settings.display.clickThrough = clickThru.checked;
  if (hasTauri) {
    void invoke("set_display_opts", {
      alwaysOnTop: onTop.checked,
      clickThrough: clickThru.checked,
    });
  }
}
onTop.addEventListener("change", pushDisplayOpts);
clickThru.addEventListener("change", pushDisplayOpts);

function showHelp(): void {
  helpOverlay.hidden = false;
}
document.getElementById("help-btn")!.addEventListener("click", showHelp);
document.getElementById("help-close")!.addEventListener("click", () => {
  helpOverlay.hidden = true;
  if (settings && !settings.displayHelpSeen) {
    settings.displayHelpSeen = true;
    pushSettingsNow();
  }
});

function exitDisplay(): void {
  pushSettingsNow();
  if (hasTauri) void invoke("set_display_mode", { on: false });
}
document.getElementById("exit-btn")!.addEventListener("click", exitDisplay);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && helpOverlay.hidden) exitDisplay();
  if (e.key === "Escape" && !helpOverlay.hidden) helpOverlay.hidden = true;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();
    exitDisplay();
  }
});

// ---------- startup ----------

async function start(): Promise<void> {
  if (!hasTauri) {
    renderSettings(demoSettings());
    renderNotes(demoState());
    wakeToolbar();
    return;
  }
  await listen<StatePayload>("state", (e) => renderNotes(e.payload));
  await listen<AppSettings>("settings", (e) => renderSettings(e.payload));
  renderSettings(await invoke<AppSettings>("get_settings"));
  renderNotes(await invoke<StatePayload>("get_state"));
  if (settings && !settings.displayHelpSeen) showHelp();
  wakeToolbar();
  // Tell the backend the first paint happened so it can reveal the window
  // (avoids the WebView2 white flash recorded in Spike C).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => void invoke("display_ready").catch(() => {}));
  });
}

start().catch((e: unknown) => {
  console.error("keyscene display bootstrap failed:", e);
});
