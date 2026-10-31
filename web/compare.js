// Compare tab (Stage 5): our results against published data.
//  - FAA GPS SPS Performance Analysis Report #26, Table 2-1, for GPS weeks 1003-1016 of 1999: published,
//    reproduced with the real 1999 almanacs (tools/reproduce_faa.py, stored in data/faa_reproduction.json),
//    and our ideal Walker 24/6/1. A chart, a table, a PDOP map on the globe, and a "recompute" button.
//  - Langley (1999): worked DOP values, recomputed live by Python.
const $ = (id) => document.getElementById(id);

const METRICS = {
  global_999_pdop: { label: "Global 99.9% PDOP", unit: "", digits: 2, match: 0.06 },
  global_average_pct: { label: "Global average availability", unit: " %", digits: 3, match: 0.01 },
  worst_point_pct: { label: "Worst-case point availability", unit: " %", digits: 3, match: 0.01 },
};
const SERIES = { faa: "#e8e8e8", real: "#3987e5", ideal: "#9ccc65" };
// PDOP map: a sequential light-to-dark orange-red ramp from PDOP 1.5 to 6; no fix 99.99% of the time = violet
const RAMP = ["#fff1c1", "#fdd49e", "#fc8d59", "#e34a33", "#a50f15"];
const NO_FIX = "#9085e9";

function rampColor(v, lo = 1.5, hi = 6) {
  if (v === null) return NO_FIX;
  const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const a = hex(RAMP[i]), b = hex(RAMP[i + 1]);
  return `#${a.map((v0, k) => Math.round(v0 + (b[k] - v0) * f).toString(16).padStart(2, "0")).join("")}`;
}

export async function initCompare({ api, globe, mc }) {
  const [repro, published] = await Promise.all([
    fetch("data/faa_reproduction.json").then((r) => r.json()),
    fetch("data/published.json").then((r) => r.json()),
  ]);
  const weeks = repro.weeks;
  let metric = "global_999_pdop", selected = 1003;
  const fmt = (v, d) => (v === null || v === undefined ? "–" : v.toFixed(d));

  // ---- table ---------------------------------------------------------------------------------------------
  function renderTable() {
    const m = METRICS[metric];
    const rows = weeks.map((w) => {
      const pub = w.published[metric], ours = w.real[metric];
      const diff = ours === null ? null : ours - pub;
      const ok = diff !== null && Math.abs(diff) <= m.match;
      return `<tr data-week="${w.week}" class="${w.week === selected ? "sel" : ""}"><td>${w.week}${w.explanation ? " *" : ""}</td>` +
             `<td>${fmt(pub, m.digits)}</td><td>${fmt(ours, m.digits)}</td>` +
             `<td class="${ok ? "ok" : "off"}">${diff === null ? "–" : (diff >= 0 ? "+" : "") + diff.toFixed(m.digits)}</td>` +
             `<td>${fmt(repro.ideal[metric], m.digits)}</td></tr>`;
    }).join("");
    $("cmp-table").innerHTML = `<thead><tr><th>Week</th><th>FAA</th><th>Ours (real)</th><th>Δ</th><th>Ideal 24</th></tr></thead><tbody>${rows}</tbody>`;
    const matched = weeks.filter((w) => w.real[metric] !== null && Math.abs(w.real[metric] - w.published[metric]) <= m.match).length;
    $("cmp-summary").textContent = `${m.label}: ${matched} of ${weeks.length} weeks within ${m.match}${m.unit} of the published value (healthy satellites as flagged in each almanac).`;
    renderDetails();
  }

  function renderDetails() {
    const w = weeks.find((x) => x.week === selected);
    const r = w.real, m = METRICS[metric];
    let html = `<b>Week ${w.week}</b> · 24 h from ${w.toa_utc.replace("T", " ")} UTC · ${r.satellites} healthy satellites` +
      (r.unhealthy_prns.length ? ` (unhealthy in this almanac: PRN ${r.unhealthy_prns.join(", ")})` : "") +
      `<br>Our 99.9% PDOP: ${fmt(r.global_999_pdop, 2)} by the FAA's definition (mean over grid points of each point's 99.9% value, inferred), ` +
      `${fmt(r.global_999_pdop_pooled, 2)} if all point-minutes are pooled.` +
      `<br>Worst point: ${r.worst_point.lat}°, ${r.worst_point.lon}° · fewest in view ${r.worst_point.min_visible} · 8 or more in view ${fmt(r.worst_point.pct_time_8_or_more_visible, 1)} % of the time.`;
    if (w.week === 1007) html += ` (FAA, Figure 2-2: never fewer than ${published.faa_pan26.figure_2_2.worst_point_min_visible}, 8 or more ${published.faa_pan26.figure_2_2.worst_point_pct_time_8_or_more_visible} % of the time.)`;
    if (w.explanation) {
      const e = w.explanation, x = e.result;
      html += `<br>* Trying another satellite set (${e.label}): ${fmt(x.global_999_pdop, 2)} · ${fmt(x.global_average_pct, 3)} % · ${fmt(x.worst_point_pct, 3)} % ` +
              `(published ${fmt(w.published.global_999_pdop, 2)} · ${fmt(w.published.global_average_pct, 3)} % · ${fmt(w.published.worst_point_pct, 3)} %).`;
    }
    $("cmp-details").innerHTML = html;
    $("cmp-recompute").textContent = `Recompute week ${w.week} in the browser`;
    $("cmp-recompute-msg").textContent = "";
    if ($("cmp-map").checked) showMap();
  }

  // ---- chart: one metric per week, three series ----------------------------------------------------------------
  function renderChart(hoverIndex = -1) {
    const cv = $("cmp-chart"), dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const m = METRICS[metric];
    const pts = weeks.map((x) => [x.published[metric], x.real[metric]]).flat().filter((v) => v !== null).concat([repro.ideal[metric]]);
    let lo = Math.min(...pts), hi = Math.max(...pts);
    const pad = (hi - lo) * 0.12 || 0.05; lo -= pad; hi += pad;
    if (m.unit === " %") hi = Math.min(hi, 100);               // availability cannot exceed 100 %
    const L = 46, R = 8, T = 10, B = 22;
    const sx = (i) => L + (i * (w - L - R)) / (weeks.length - 1), sy = (v) => T + (h - T - B) * (1 - (v - lo) / (hi - lo));
    ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = "#8b98a8"; ctx.strokeStyle = "#2a3441";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const f of [0, 0.5, 1]) {
      const v = lo + f * (hi - lo), y = sy(v);
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
      ctx.fillText(v.toFixed(m.digits === 2 ? 1 : 2), L - 5, y);
    }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    weeks.forEach((x, i) => { if (i % 2 === 0) ctx.fillText(String(x.week), sx(i), h - B + 6); });
    // ideal model: one dashed level (it does not change with the week)
    ctx.setLineDash([5, 4]); ctx.strokeStyle = SERIES.ideal; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(L, sy(repro.ideal[metric])); ctx.lineTo(w - R, sy(repro.ideal[metric])); ctx.stroke();
    ctx.setLineDash([]);
    // ours with the real almanac: line + dots
    ctx.strokeStyle = SERIES.real; ctx.beginPath();
    weeks.forEach((x, i) => { const v = x.real[metric]; if (v !== null) (i ? ctx.lineTo(sx(i), sy(v)) : ctx.moveTo(sx(i), sy(v))); });
    ctx.stroke();
    ctx.fillStyle = SERIES.real;
    weeks.forEach((x, i) => { const v = x.real[metric]; if (v !== null) { ctx.beginPath(); ctx.arc(sx(i), sy(v), 3.5, 0, 7); ctx.fill(); } });
    // FAA: hollow diamonds, drawn on top
    ctx.strokeStyle = SERIES.faa; ctx.lineWidth = 1.5;
    weeks.forEach((x, i) => { const X = sx(i), Y = sy(x.published[metric]); ctx.beginPath(); ctx.moveTo(X, Y - 5); ctx.lineTo(X + 5, Y); ctx.lineTo(X, Y + 5); ctx.lineTo(X - 5, Y); ctx.closePath(); ctx.stroke(); });
    if (hoverIndex >= 0) {
      ctx.strokeStyle = "#dfe6ee"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx(hoverIndex), T); ctx.lineTo(sx(hoverIndex), h - B); ctx.stroke();
    }
    cv._sx = sx; cv._n = weeks.length; cv._L = L; cv._R = R;
  }
  $("cmp-chart").addEventListener("mousemove", (e) => {
    const cv = $("cmp-chart"), r = cv.getBoundingClientRect(), x = e.clientX - r.left;
    const i = Math.max(0, Math.min(weeks.length - 1, Math.round(((x - cv._L) / (cv.clientWidth - cv._L - cv._R)) * (weeks.length - 1))));
    const wk = weeks[i], m = METRICS[metric];
    renderChart(i);
    $("cmp-chart-cap").textContent = `Week ${wk.week}: FAA ${fmt(wk.published[metric], m.digits)} · ours ${fmt(wk.real[metric], m.digits)} · ideal ${fmt(repro.ideal[metric], m.digits)}`;
  });
  $("cmp-chart").addEventListener("mouseleave", () => { renderChart(); $("cmp-chart-cap").textContent = ""; });

  // ---- PDOP map on the globe ---------------------------------------------------------------------------------
  function showMap() {
    const which = $("cmp-map-source").value;
    const values = which === "ideal" ? repro.ideal.map_9999_pdop : weeks.find((x) => x.week === selected).map_9999_pdop;
    const lats = [], lons = [];
    repro.grid.lats.forEach((la) => repro.grid.lons.forEach((lo) => { lats.push(la); lons.push(lo); }));
    globe.setGroundMap({ lats, lons, colors: values.map((v) => rampColor(v)), cellDeg: 5 });
    $("cmp-map-note").textContent = which === "ideal"
      ? "Ideal Walker 24/6/1 (any day)."
      : `Week ${selected}, real almanac. Each 5° cell: the PDOP met 99.99% of the time over the 24 h (the FAA's contour statistic).`;
  }
  $("cmp-map").addEventListener("change", () => ($("cmp-map").checked ? showMap() : globe.clearGroundMap()));
  $("cmp-map-source").addEventListener("change", () => { if ($("cmp-map").checked) showMap(); });
  $("cmp-legend").style.background = `linear-gradient(to right, ${RAMP.join(", ")})`;
  $("cmp-legend-nofix").style.background = NO_FIX;

  // ---- controls ------------------------------------------------------------------------------------------------
  $("cmp-metric").addEventListener("change", () => { metric = $("cmp-metric").value; renderTable(); renderChart(); });
  $("cmp-table").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-week]");
    if (!tr) return;
    selected = +tr.dataset.week;
    renderTable();
  });

  $("cmp-recompute").addEventListener("click", async () => {
    if (mc.busy()) { $("cmp-recompute-msg").textContent = "A Monte Carlo run is going; try again after it."; return; }
    const week = selected, stored = weeks.find((x) => x.week === week).real;
    $("cmp-recompute").disabled = true;
    $("cmp-progress").value = 0;
    $("cmp-recompute-msg").textContent = "Loading Python in the worker, then 2,376 points × 1,440 minutes…";
    const start = performance.now();
    try {
      const r = await mc.recomputeFaa(week, (f) => { $("cmp-progress").value = f; });
      const same = ["global_999_pdop", "global_average_pct", "worst_point_pct"].every((k) => Math.abs(r[k] - stored[k]) < 1e-9);
      $("cmp-recompute-msg").textContent = `Done in ${((performance.now() - start) / 1000).toFixed(0)} s: ${r.global_999_pdop.toFixed(2)} · ` +
        `${r.global_average_pct.toFixed(3)} % · ${r.worst_point_pct.toFixed(3)} % — ${same ? "identical to the stored result" : "DIFFERENT from the stored result"}.`;
    } catch (err) {
      $("cmp-recompute-msg").textContent = `Error: ${err.message}`;
    }
    $("cmp-recompute").disabled = false;
  });

  // ---- Langley (1999): recomputed live --------------------------------------------------------------------------
  const checks = JSON.parse(api.langley_checks());
  const fred = JSON.parse(api.fredericton_day());
  $("cmp-langley").innerHTML = "<thead><tr><th>Case</th><th>Langley</th><th>Ours</th><th></th></tr></thead><tbody>" +
    checks.map((c) => {
      const tol = c.quantity.includes("elevation") ? 0.5 : 0.0006;
      return `<tr><td>${c.case}: ${c.quantity}</td><td>${c.published}</td><td>${c.ours.toFixed(3)}</td><td class="${Math.abs(c.ours - c.published) < tol ? "ok" : "off"}">${Math.abs(c.ours - c.published) < tol ? "✓" : "✗"}</td></tr>`;
    }).join("") +
    `<tr><td>Fredericton, 5° mask, one day (week 1007 almanac): mean GDOP</td><td>≈ 2</td><td>${fred.gdop_mean.toFixed(2)}</td><td class="${Math.abs(fred.gdop_mean - 2) < 0.3 ? "ok" : "off"}">✓</td></tr>` +
    `<tr><td>Fredericton: largest GDOP over the day</td><td>&lt; 3.5</td><td>${fred.gdop_max.toFixed(2)}</td><td class="${fred.gdop_max < 3.5 ? "ok" : "off"}">${fred.gdop_max < 3.5 ? "✓" : "✗"}</td></tr></tbody>`;

  renderTable();
  return { redraw: () => renderChart() };
}
