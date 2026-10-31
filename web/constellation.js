// The constellation: which satellites exist, which are switched on, and the Constellation tab
// that edits them. The numbers (orbits, validation, ring paths) come from Python (sim/api.py);
// this file keeps the list, the colours and the labels, and draws the controls.

import { drawThumb, spin } from "./thumbs.js";

const $ = (id) => document.getElementById(id);

const MAX_SATELLITES = 300;                      // same limit as sim/api.py
const SYSTEM_COLORS = { gps: "#3987e5", galileo: "#eda100", beidou: "#d55181" };

// ---- colours -------------------------------------------------------------------------------------------
// New groups (and new single satellites) get a random hue at fixed saturation and lightness, so they stay
// bright on the dark background. To keep them easy to tell apart, the hue is drawn at random among the
// candidate hues that are farthest from the hues already in use.
function hexFromHsl(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function hueOf(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return null;                                   // grey: no hue
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
export function randomColor(usedColors) {
  const used = usedColors.map(hueOf).filter((h) => h !== null);
  const offset = Math.random() * 10;
  const candidates = Array.from({ length: 36 }, (_, k) => (k * 10 + offset) % 360)
    .map((h) => ({ h, gap: used.length ? Math.min(...used.map((u) => hueGap(h, u))) : 180 }));
  const best = Math.max(...candidates.map((c) => c.gap));
  const good = candidates.filter((c) => c.gap >= 0.8 * best);      // the farthest few, then pick one at random
  return hexFromHsl(good[Math.floor(Math.random() * good.length)].h, 0.7, 0.6);
}

const nf = (x, d = 0) => x.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const hm = (s) => `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * hooks.globe: the globe (setConstellation); hooks.onChange(): called after every change.
 * Returns the functions the rest of the page needs.
 */
export function initConstellation(api, hooks) {
  const presetList = JSON.parse(api.preset_info());
  let groups = [];                // {id, label, color, preset (key) | null}
  let sats = [];                  // {label, group (id), enabled, elements, color (own colour, or null = the group's)}
  let nextGroupId = 1, customCount = 0, walkerCount = 0, customGroupId = null;
  let locked = false;             // true while a Monte Carlo run is using the constellation: no changes
  const openGroups = new Set();

  const groupOf = (s) => groups.find((g) => g.id === s.group);
  const colorOf = (s) => s.color || groupOf(s).color;
  // which low-poly model to draw: the preset's system (gps, galileo, beidou) or a generic one
  const modelOf = (s) => {
    const g = groupOf(s);
    return g.preset ? presetList.find((p) => p.key === g.preset).system : "generic";
  };
  const usedColors = () => [...groups.map((g) => g.color), ...sats.filter((s) => s.color).map((s) => s.color)];
  const newColor = (chosen) => chosen || randomColor(usedColors());

  // ---- changing the constellation -----------------------------------------------------------
  function sync() {
    const info = JSON.parse(api.set_constellation(JSON.stringify(sats.map((s) => s.elements)),
                                                  JSON.stringify(sats.map((s) => s.enabled))));
    const firstOnRing = (r) => info.ring_of.indexOf(r);
    hooks.globe.setConstellation({
      colors: sats.map(colorOf),
      models: sats.map(modelOf),
      normals: info.normals,
      ringOf: info.ring_of,
      paths: info.paths,
      ringColors: info.paths.map((_, r) => colorOf(sats[firstOnRing(r)])),
      ringActive: info.paths.map((_, r) => sats.some((s, i) => info.ring_of[i] === r && s.enabled)),
    });
  }

  function changed() {
    sync();
    render();
    hooks.onChange();
  }

  function room(n) {
    if (sats.length + n > MAX_SATELLITES) throw new Error(`at most ${MAX_SATELLITES} satellites are allowed`);
  }

  function addPreset(key) {
    if (locked || groups.some((g) => g.preset === key)) return;
    const info = presetList.find((p) => p.key === key);
    const data = JSON.parse(api.preset_elements(key));
    room(data.elements.length);
    const group = { id: nextGroupId++, label: info.label, color: SYSTEM_COLORS[info.system], preset: key };
    groups.push(group);
    data.elements.forEach((elements, i) => sats.push({ label: `${info.short}-${data.names[i]}`, group: group.id, enabled: true, elements, color: null }));
    changed();
  }

  function removeGroup(id) {
    if (locked) return;
    groups = groups.filter((g) => g.id !== id);
    sats = sats.filter((s) => s.group !== id);
    if (id === customGroupId) customGroupId = null;
    changed();
  }

  // Each added single satellite gets its own colour (random unless one was chosen).
  function addCustomSatellite(elements, chosenColor = null) {
    if (locked) return "";
    room(1);
    const color = newColor(chosenColor);
    if (customGroupId === null || !groups.some((g) => g.id === customGroupId)) {
      customGroupId = nextGroupId++;
      groups.push({ id: customGroupId, label: "Added satellites", color, preset: null });
    }
    customCount += 1;
    sats.push({ label: `X${customCount}`, group: customGroupId, enabled: true, elements, color });
    changed();
    return `X${customCount}`;
  }

  // A new Walker set is one group in one colour (random unless one was chosen).
  function addWalker(T, P, F, data, chosenColor = null) {
    if (locked) return;
    room(data.elements.length);
    walkerCount += 1;
    const group = { id: nextGroupId++, label: `Walker ${T}/${P}/${F} (#${walkerCount})`, color: newColor(chosenColor), preset: null };
    groups.push(group);
    data.elements.forEach((elements, i) => sats.push({ label: `W${walkerCount}-${data.names[i]}`, group: group.id, enabled: true, elements, color: null }));
    changed();
  }

  function toggleSat(i) {
    if (!locked && sats[i]) { sats[i].enabled = !sats[i].enabled; changed(); }
  }

  function setGroupEnabled(id, on) {
    if (locked) return;
    sats.forEach((s) => { if (s.group === id) s.enabled = on; });
    changed();
  }

  function deleteSat(i) {
    if (locked) return;
    const id = sats[i].group;
    sats.splice(i, 1);
    if (!sats.some((s) => s.group === id)) groups = groups.filter((g) => g.id !== id);
    changed();
  }

  // Colour pickers: a group's colour applies to all its satellites (their own colours are cleared);
  // a satellite's colour applies to that satellite only. `live` = while the picker is still open:
  // update the globe and plots but do not redraw the list (that would close the picker).
  function setGroupColor(id, color, live) {
    if (locked) return;
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    g.color = color;
    sats.forEach((s) => { if (s.group === id) s.color = null; });
    live ? (sync(), hooks.onChange()) : changed();
  }
  function setSatColor(i, color, live) {
    if (locked || !sats[i]) return;
    sats[i].color = color;
    live ? (sync(), hooks.onChange()) : changed();
  }

  function reset() {
    if (locked) return;
    groups = []; sats = []; customGroupId = null; customCount = 0; walkerCount = 0;
    addPreset("gps");
  }

  // ---- what the rest of the page asks for -------------------------------------------------------------
  function decorate(snap) {                      // add the page-side information to a snapshot from Python
    snap.labels = sats.map((s) => s.label);
    snap.colors = sats.map(colorOf);
    snap.groupLabels = sats.map((s) => groupOf(s).label);
    return snap;
  }
  const activeElements = () => sats.filter((s) => s.enabled).map((s) => s.elements);

  // ---- drawing the tab and the "Add satellites" cards ----------------------------------------------------------
  const PRESET_TEXT = {
    gps: "Walker 24/6/1 · 20,182 km · 55°", galileo: "Walker 24/3/1 · 23,222 km · 56°",
    beidou_meo: "Walker 24/3/1 · 21,528 km · 55°", beidou_igso_geo: "3 inclined geosynchronous + 3 geostationary",
  };
  const CUSTOM_CARDS = [
    { kind: "single", title: "Single satellite", text: "Circular or elliptical orbit" },
    { kind: "geo", title: "Geostationary", text: "Hangs over one longitude" },
    { kind: "walker", title: "Walker constellation", text: "T satellites in P planes, phasing F" },
  ];
  const card = (attrs, model, color, title, text, state, present) =>
    `<button class="card${present ? " present" : ""}" ${attrs}><canvas width="240" height="140" data-model="${model}" data-color="${color}"></canvas>` +
    `<span class="t">${escapeHtml(title)}</span><span class="d">${escapeHtml(text)}</span><span class="state">${state}</span></button>`;

  function renderCards() {
    $("cs-presets").innerHTML =
      presetList.map((p) => {
        const g = groups.find((x) => x.preset === p.key);
        return card(`data-act="preset" data-key="${p.key}"`, p.system, g ? g.color : SYSTEM_COLORS[p.system],
                    `${p.label} (${p.count})`, PRESET_TEXT[p.key], g ? "Added ✓ · click to remove" : "Click to add", !!g);
      }).join("") +
      CUSTOM_CARDS.map((c) => card(`data-act="form" data-kind="${c.kind}"`, "generic", "#b0bec5", c.title, c.text, "Set up…", false)).join("");
    $("cs-presets").querySelectorAll("canvas").forEach((cv) => drawThumb(cv, cv.dataset.model, cv.dataset.color));
  }

  function describe(s) {
    const [a, ecc, inc] = s.elements;
    return `a ${nf(a)} km · i ${nf(inc, 1)}°${ecc > 0 ? ` · e ${nf(ecc, 2)}` : ""}`;
  }

  function renderList() {
    const rows = groups.map((g) => {
      const members = sats.map((s, i) => ({ s, i })).filter(({ s }) => s.group === g.id);
      const on = members.filter(({ s }) => s.enabled).length;
      const custom = g.preset === null;
      const items = members.map(({ s, i }) =>
        `<div class="sat-row"><input type="color" class="pick" data-act="sat-color" data-i="${i}" value="${colorOf(s)}" title="Colour of ${escapeHtml(s.label)}" aria-label="Colour of ${escapeHtml(s.label)}">` +
        `<label><input type="checkbox" data-act="sat-toggle" data-i="${i}" ${s.enabled ? "checked" : ""}> ` +
        `<span class="name">${escapeHtml(s.label)}</span> <span class="muted">${describe(s)}</span></label>` +
        (custom ? `<button class="x" data-act="sat-del" data-i="${i}" title="Delete this satellite" aria-label="Delete ${escapeHtml(s.label)}">×</button>` : "") +
        `</div>`).join("");
      return `<details data-g="${g.id}" ${openGroups.has(g.id) ? "open" : ""}><summary>` +
             `<input type="checkbox" data-act="grp-toggle" data-g="${g.id}" ${on === members.length ? "checked" : ""} aria-label="Switch ${escapeHtml(g.label)} on or off"> ` +
             `<input type="color" class="pick" data-act="grp-color" data-g="${g.id}" value="${g.color}" title="Colour of the whole group" aria-label="Colour of ${escapeHtml(g.label)}">` +
             `${escapeHtml(g.label)} <span class="muted">${on}/${members.length}</span>` +
             `<button class="x" data-act="grp-del" data-g="${g.id}" title="Remove this whole group" aria-label="Remove ${escapeHtml(g.label)}">×</button>` +
             `</summary>${items}</details>`;
    }).join("");
    $("cs-list").innerHTML = rows || `<div class="muted">No satellites. Use "Add satellites…".</div>`;
    $("cs-list").querySelectorAll('input[data-act="grp-toggle"]').forEach((box) => {
      const members = sats.filter((s) => s.group === +box.dataset.g);
      const on = members.filter((s) => s.enabled).length;
      box.indeterminate = on > 0 && on < members.length;       // some on, some off
    });
    $("cs-count").textContent = `(${sats.filter((s) => s.enabled).length} on of ${sats.length})`;
  }

  function render() { if (!$("add-dialog").hidden) renderCards(); renderList(); applyLock(); }

  // While locked every control is disabled (and the Add dialog closed); unlocking brings back the forms' own state.
  const lockable = () => [...$("tab-cs").querySelectorAll("input, button"), ...$("add-dialog").querySelectorAll("input, button")];
  function applyLock() {
    if (locked) lockable().forEach((el) => { el.disabled = true; });
  }

  function setLocked(on) {
    locked = on;
    if (on) closeDialog();
    $("cs-lock-note").hidden = !on;
    if (!on) lockable().forEach((el) => { el.disabled = false; });
    render();
    if (!on) { updateSatelliteForm(); updateWalkerForm(); }      // the Add buttons depend on the forms being valid
  }

  // ---- the controls ------------------------------------------------------------------------------------------
  const message = (id, text, isError) => { $(id).textContent = text; $(id).classList.toggle("err", isError); };

  $("cs-list").addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.act === "sat-toggle") toggleSat(+t.dataset.i);
    else if (t.dataset.act === "grp-toggle") setGroupEnabled(+t.dataset.g, t.checked);
    else if (t.dataset.act === "grp-color") setGroupColor(+t.dataset.g, t.value, false);
    else if (t.dataset.act === "sat-color") setSatColor(+t.dataset.i, t.value, false);
  });
  $("cs-list").addEventListener("input", (e) => {                // dragging inside an open colour picker
    const t = e.target;
    if (t.dataset.act === "grp-color") setGroupColor(+t.dataset.g, t.value, true);
    else if (t.dataset.act === "sat-color") setSatColor(+t.dataset.i, t.value, true);
  });
  $("cs-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    e.preventDefault();                                          // a button inside <summary> must not fold the group
    if (b.dataset.act === "sat-del") deleteSat(+b.dataset.i);
    else if (b.dataset.act === "grp-del") removeGroup(+b.dataset.g);
  });
  $("cs-list").addEventListener("toggle", (e) => {               // remember which groups are unfolded
    const id = +e.target.dataset.g;
    if (id) e.target.open ? openGroups.add(id) : openGroups.delete(id);
  }, true);

  $("cs-reset").addEventListener("click", reset);

  // ---- orbit preview: dashed rings and ghost satellites on the globe, not yet added ------------------------------
  function preview(elements, color, model = "generic") {
    if (!elements || elements.length === 0) { hooks.globe.clearPreview(); return; }
    const pv = JSON.parse(api.preview(JSON.stringify(elements), hooks.getTime()));
    hooks.globe.setPreview({ ...pv, color, models: elements.map(() => model) });
  }
  const PREVIEW_COLOR = "#ffffff";
  const chosen = (pre) => ($(`${pre}color-random`).checked ? null : $(`${pre}color`).value);

  // ---- the dialog ----------------------------------------------------------------------------------------------------
  let stopSpin = null, view = "cards";
  function openDialog() {
    if (locked) return;
    $("add-dialog").hidden = false;
    showView("cards");
  }
  function closeDialog() {
    $("add-dialog").hidden = true;
    if (stopSpin) { stopSpin(); stopSpin = null; }
    hooks.globe.clearPreview();
  }
  function showView(kind) {
    view = kind;
    const cards = kind === "cards";
    $("cs-presets").hidden = !cards;
    $("dlg-back").hidden = cards;
    $("dlg-form-sat").hidden = !(kind === "single" || kind === "geo");
    $("dlg-form-walker").hidden = kind !== "walker";
    $("dlg-title").textContent = { cards: "Add satellites", single: "Single satellite", geo: "Geostationary satellite", walker: "Walker constellation" }[kind];
    hooks.globe.clearPreview();
    if (cards) { renderCards(); return; }
    if (kind === "single" || kind === "geo") {
      $("cs-geo").checked = kind === "geo";
      updateSatelliteForm();
    } else {
      updateWalkerForm();
    }
  }
  $("cs-open-add").addEventListener("click", openDialog);
  $("dlg-close").addEventListener("click", closeDialog);
  $("dlg-back").addEventListener("click", () => showView("cards"));

  $("cs-presets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || locked) return;
    if (b.dataset.act === "form") { showView(b.dataset.kind); return; }
    const g = groups.find((x) => x.preset === b.dataset.key);
    try { g ? removeGroup(g.id) : addPreset(b.dataset.key); } catch (err) { message("cs-msg", err.message, true); }
    hooks.globe.clearPreview();
  });
  // hovering a card: its model turns; hovering a preset also previews its orbits
  $("cs-presets").addEventListener("mouseover", (e) => {
    const b = e.target.closest(".card");
    if (!b || b.contains(e.relatedTarget)) return;
    if (stopSpin) stopSpin();
    const cv = b.querySelector("canvas");
    stopSpin = spin(cv, cv.dataset.model, cv.dataset.color);
    if (b.dataset.act === "preset" && !groups.some((g) => g.preset === b.dataset.key)) {
      const p = presetList.find((x) => x.key === b.dataset.key);
      preview(JSON.parse(api.preset_elements(p.key)).elements, SYSTEM_COLORS[p.system], p.system);
    }
  });
  $("cs-presets").addEventListener("mouseout", (e) => {
    const b = e.target.closest(".card");
    if (!b || b.contains(e.relatedTarget)) return;
    if (stopSpin) { stopSpin(); stopSpin = null; }
    hooks.globe.clearPreview();
  });

  // ---- the single-satellite / geostationary form ----------------------------------------------------------------------
  const num = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
  const satelliteParams = () => ({
    geo: $("cs-geo").checked, lon: num("cs-lon"), alt: num("cs-alt"), inc: num("cs-inc"), raan: num("cs-raan"),
    phase: num("cs-phase"), elliptical: $("cs-ell").checked, apogee: num("cs-ap"), argp: num("cs-argp"),
  });

  function updateSatelliteForm() {
    const geo = $("cs-geo").checked, ell = $("cs-ell").checked;
    $("cs-circ-fields").hidden = geo;
    $("cs-geo-fields").hidden = !geo;
    $("cs-ell-fields").hidden = geo || !ell;
    $("cs-ell").disabled = geo || locked;
    $("cs-alt-label").textContent = ell ? "Perigee alt. (km)" : "Altitude (km)";
    const r = JSON.parse(api.orbit_from_form(JSON.stringify(satelliteParams())));
    if (r.ok) {
      const i = r.info;
      message("cs-msg", i.ecc === 0
        ? `Circular orbit, altitude ${nf(i.perigee_alt_km)} km, period ${hm(i.period_s)}`
        : `Semi-major axis ${nf(i.a_km)} km, e = ${nf(i.ecc, 3)}, altitude ${nf(i.perigee_alt_km)} to ${nf(i.apogee_alt_km)} km, period ${hm(i.period_s)}`, false);
    } else {
      message("cs-msg", r.error, true);
    }
    $("cs-add").disabled = !r.ok || locked;
    const formOpen = !$("add-dialog").hidden && !$("dlg-form-sat").hidden;
    if (formOpen) r.ok ? preview([r.elements], chosen("cs-") || PREVIEW_COLOR) : hooks.globe.clearPreview();
    return r;
  }
  document.querySelectorAll("#cs-circ-fields input, #cs-ell-fields input, #cs-geo-fields input, #cs-ell, #cs-geo")
    .forEach((el) => el.addEventListener("input", updateSatelliteForm));
  $("cs-add").addEventListener("mouseenter", updateSatelliteForm);       // hovering Add shows (refreshes) the preview
  $("cs-add").addEventListener("click", () => {
    const r = updateSatelliteForm();
    if (!r.ok) return;
    try {
      const label = addCustomSatellite(r.elements, chosen("cs-"));
      message("cs-msg", `Added ${label}.`, false);
    } catch (err) { message("cs-msg", err.message, true); }
  });

  // ---- the Walker form -------------------------------------------------------------------------------------------------
  const walkerParams = () => ({ T: num("cs-w-T"), P: num("cs-w-P"), F: num("cs-w-F"), alt: num("cs-w-alt"), inc: num("cs-w-inc") });
  function updateWalkerForm() {
    const r = JSON.parse(api.walker_from_form(JSON.stringify(walkerParams())));
    message("cs-w-msg", r.ok ? `${r.elements.length} satellites in ${walkerParams().P} planes` : r.error, !r.ok);
    $("cs-w-add").disabled = !r.ok || locked;
    const formOpen = !$("add-dialog").hidden && !$("dlg-form-walker").hidden;
    if (formOpen) r.ok ? preview(r.elements, chosen("cs-w-") || PREVIEW_COLOR) : hooks.globe.clearPreview();
    return r;
  }
  document.querySelectorAll("#cs-walker input").forEach((el) => el.addEventListener("input", updateWalkerForm));
  $("cs-w-add").addEventListener("mouseenter", updateWalkerForm);
  $("cs-w-add").addEventListener("click", () => {
    const r = updateWalkerForm();
    if (!r.ok) return;
    const p = walkerParams();
    try {
      addWalker(p.T, p.P, p.F, r, chosen("cs-w-"));
      message("cs-w-msg", `Added Walker ${p.T}/${p.P}/${p.F}.`, false);
    } catch (err) { message("cs-w-msg", err.message, true); }
  });

  // the colour controls: picking a colour turns "random" off; both refresh the preview
  for (const pre of ["cs-", "cs-w-"]) {
    const refresh = () => (pre === "cs-" ? updateSatelliteForm() : updateWalkerForm());
    $(`${pre}color`).addEventListener("input", () => { $(`${pre}color-random`).checked = false; refresh(); });
    $(`${pre}color-random`).addEventListener("change", refresh);
  }

  updateSatelliteForm();
  updateWalkerForm();

  return { addPreset, addCustomSatellite, addWalker, toggleSat, setLocked, decorate, activeElements, count: () => sats.length,
           openDialog, closeDialog, groupColors: () => groups.map((g) => ({ label: g.label, color: g.color })) };
}
