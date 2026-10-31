// The constellation: which satellites exist, which are switched on, and the Constellation tab
// that edits them. The numbers (orbits, validation, ring paths) come from Python (sim/api.py);
// this file keeps the list, the colours and the labels, and draws the controls.

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
  const usedColors = () => [...groups.map((g) => g.color), ...sats.filter((s) => s.color).map((s) => s.color)];
  const newColor = (chosen) => chosen || randomColor(usedColors());

  // ---- changing the constellation -----------------------------------------------------------
  function sync() {
    const info = JSON.parse(api.set_constellation(JSON.stringify(sats.map((s) => s.elements)),
                                                  JSON.stringify(sats.map((s) => s.enabled))));
    const firstOnRing = (r) => info.ring_of.indexOf(r);
    hooks.globe.setConstellation({
      colors: sats.map(colorOf),
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

  // ---- drawing the tab ------------------------------------------------------------------------------------
  function renderPresets() {
    $("cs-presets").innerHTML = presetList.map((p) => {
      const present = groups.some((g) => g.preset === p.key);
      const g = groups.find((x) => x.preset === p.key);
      return `<div class="row preset"><span class="swatch" style="background:${g ? g.color : SYSTEM_COLORS[p.system]}"></span>` +
             `<span class="grow">${escapeHtml(p.label)} <span class="muted">(${p.count})</span></span>` +
             `<button class="secondary" data-act="preset" data-key="${p.key}">${present ? "Remove" : "Add"}</button></div>`;
    }).join("");
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
    $("cs-list").innerHTML = rows || `<div class="muted">No satellites. Add a constellation above.</div>`;
    $("cs-list").querySelectorAll('input[data-act="grp-toggle"]').forEach((box) => {
      const members = sats.filter((s) => s.group === +box.dataset.g);
      const on = members.filter((s) => s.enabled).length;
      box.indeterminate = on > 0 && on < members.length;       // some on, some off
    });
    $("cs-count").textContent = `(${sats.filter((s) => s.enabled).length} on of ${sats.length})`;
  }

  function render() { renderPresets(); renderList(); applyLock(); }

  // While locked every control in the tab is disabled; unlocking brings back the forms' own on/off state.
  function applyLock() {
    if (locked) $("tab-cs").querySelectorAll("input, button").forEach((el) => { el.disabled = true; });
  }

  function setLocked(on) {
    locked = on;
    $("cs-lock-note").hidden = !on;
    if (!on) $("tab-cs").querySelectorAll("input, button").forEach((el) => { el.disabled = false; });
    render();
    if (!on) { updateSatelliteForm(); updateWalkerForm(); }      // the Add buttons depend on the forms being valid
  }

  // ---- the controls ------------------------------------------------------------------------------------------
  const message = (id, text, isError) => { $(id).textContent = text; $(id).classList.toggle("err", isError); };

  $("cs-presets").addEventListener("click", (e) => {
    const b = e.target.closest('[data-act="preset"]');
    if (!b) return;
    const g = groups.find((x) => x.preset === b.dataset.key);
    try { g ? removeGroup(g.id) : addPreset(b.dataset.key); } catch (err) { message("cs-msg", err.message, true); }
  });

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

  // add one satellite
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
    $("cs-ell").disabled = geo;
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
    $("cs-add").disabled = !r.ok;
    return r;
  }
  $("tab-cs").querySelectorAll("#cs-circ-fields input, #cs-ell-fields input, #cs-geo-fields input, #cs-ell, #cs-geo")
    .forEach((el) => el.addEventListener("input", updateSatelliteForm));
  $("cs-add").addEventListener("click", () => {
    const r = updateSatelliteForm();
    if (!r.ok) return;
    try {
      const label = addCustomSatellite(r.elements);
      message("cs-msg", `Added ${label}.`, false);
    } catch (err) { message("cs-msg", err.message, true); }
  });

  // add a Walker constellation
  const walkerParams = () => ({ T: num("cs-w-T"), P: num("cs-w-P"), F: num("cs-w-F"), alt: num("cs-w-alt"), inc: num("cs-w-inc") });
  function updateWalkerForm() {
    const r = JSON.parse(api.walker_from_form(JSON.stringify(walkerParams())));
    message("cs-w-msg", r.ok ? `${r.elements.length} satellites in ${walkerParams().P} planes` : r.error, !r.ok);
    $("cs-w-add").disabled = !r.ok;
    return r;
  }
  $("tab-cs").querySelectorAll("#cs-walker input").forEach((el) => el.addEventListener("input", updateWalkerForm));
  $("cs-w-add").addEventListener("click", () => {
    const r = updateWalkerForm();
    if (!r.ok) return;
    const p = walkerParams();
    try { addWalker(p.T, p.P, p.F, r); } catch (err) { message("cs-w-msg", err.message, true); }
  });

  updateSatelliteForm();
  updateWalkerForm();

  return { addPreset, addCustomSatellite, addWalker, toggleSat, setLocked, decorate, activeElements, count: () => sats.length,
           groupColors: () => groups.map((g) => ({ label: g.label, color: g.color })) };
}
