// Monte Carlo tab: starts runs in the worker, paces them, and shows the results.
// All statistics are computed in Python (sim/montecarlo.py); this file only asks and draws.
import { drawBars, barAt } from "./histogram.js";
import { legendGradient, cssColor, FADE, UNDEFINED_RGB } from "./trialcolors.js";

const CHUNK = 20000;          // trials per request when not visualizing
const MAX_VIZ_CHUNK = 4000;   // cap on trials per request when visualizing
const SUMMARY_MS = 250;       // how often the running summary is refreshed
const MAX_TRIALS = 1_000_000;
const MIN_RATE = 1, MAX_RATE = 2000;
const DEFAULT_WINDOW_DAYS = 365, MIN_WINDOW_DAYS = 0.01, MAX_WINDOW_DAYS = 36500;   // random times are drawn from [0, window)
const BAR = "#3987e5", BAR_FEW = UNDEFINED_RGB;  // bars with >= 4 satellites / fewer than 4

const $ = (id) => document.getElementById(id);
const pct = (x, d = 2) => `${(100 * x).toFixed(d)} %`;
const f = (x, d = 2) => (x === null || x === undefined ? "–" : x.toFixed(d));

// getElements(): the elements table (rows of 6 numbers) of the satellites that are switched on
// api: the page's Python (for the common repeat period of the satellites)
// onRunState(running): a run started or ended (the page locks its time and receiver controls while it runs)
// onFeatured({lat, lon, t}): about once a second of a visualized run, one trial to show in the live view
// getMaskDeg(): the terrain's blocking angle (a cone-shaped valley), used as the elevation mask
export function initMonteCarlo(globe, { getElements, getMaskDeg, api, onRunState, onFeatured }) {
  let worker = null, ready = false, runCounter = 0, run = null, lastSummary = null;
  let lcm = { found: false, reason: "not computed yet" };    // approximate LCM of the periods (from Python)

  // ---- worker ------------------------------------------------------------------------
  function ensureWorker() {
    if (worker) return;
    $("mc-status").textContent = "Loading Python for Monte Carlo (second Pyodide instance)…";
    worker = new Worker(new URL("./mc-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => handle(e.data);
    worker.onerror = (e) => { $("mc-status").textContent = `Worker error: ${e.message}`; };
  }

  // "Recompute this week" for the Compare tab runs in the same worker.
  let faaJob = null;
  function recomputeFaa(week, onProgress) {
    ensureWorker();
    return new Promise((resolve, reject) => {
      faaJob = { resolve, reject, onProgress, week };
      if (ready) worker.postMessage({ cmd: "faa", week });
    });
  }

  function handle(m) {
    if (m.type === "faa-progress") { if (faaJob) faaJob.onProgress(m.fraction); return; }
    if (m.type === "faa-done") { if (faaJob) { faaJob.resolve(m.result); faaJob = null; } return; }
    if (m.type === "ready") {
      ready = true;
      if (faaJob) worker.postMessage({ cmd: "faa", week: faaJob.week });
      $("mc-run").disabled = false;
      $("mc-status").textContent = "Ready.";
    } else if (m.type === "error") {
      if (faaJob) { faaJob.reject(new Error(m.message)); faaJob = null; }
      $("mc-status").textContent = `Error: ${m.message}`;
      if (run) finish("Stopped by an error");
    } else if (!run || m.runId !== run.id) {
      return;                                              // reply for an older run
    } else if (m.type === "started") {
      run.started = true;
      run.lastSpawn = performance.now();
      $("r-seed").textContent = m.seed;
      $("mc-status").textContent = "Running…";
    } else if (m.type === "advanced") {
      const now = performance.now();
      run.inflight = false;
      run.done = m.done;
      $("mc-progress").value = m.done / run.n;
      if (m.points) {
        globe.spawnTrials(m.points, Math.max(run.lastSpawn, now - 250), now, run.pdopMax);
        featureOneTrial(m);
      }
      run.lastSpawn = now;
      if (m.summary) render(m.summary);
      if (m.done >= run.n && !run.finished) finish("Done.");
    } else if (m.type === "summary") {
      render(m.summary);
    }
  }

  // Every n-th trial is the "featured" trial: the live view (satellites, Earth angle, receiver, sky plot,
  // timeline) jumps to that trial's place and time. n = (trials per second) / (snaps per second), so with
  // the default 1 snap/s the view jumps about once a second.
  // The very first trial is featured too, so the view responds as soon as the run starts.
  function featureOneTrial(m) {
    const k = m.points.lat.length, first = m.done - k;
    const rate = Math.max(1, Math.round(getRate() / getSnapRate()));
    let j = -1;
    for (let idx = k - 1; idx >= 0; idx--) if ((first + idx + 1) % rate === 0) { j = idx; break; }
    if (j < 0 && first === 0) j = 0;
    if (j >= 0) onFeatured({ lat: m.points.lat[j], lon: m.points.lon[j], t: m.points.t[j], index: first + j + 1 });
  }

  // ---- the time window ---------------------------------------------------------------------
  // Random times are drawn from [0, window). The window is typed in (days), or, with the checkbox on,
  // it is the approximate least common multiple of the satellites' orbital periods (computed in Python):
  // the time after which the whole constellation looks the same again.
  const useLcm = () => $("mc-lcm").checked && lcm.found;

  function windowSeconds() {
    if (useLcm()) return lcm.seconds;
    const days = parseFloat($("mc-window").value);
    return 86400 * (Number.isFinite(days) ? Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, days)) : DEFAULT_WINDOW_DAYS);
  }

  function refreshWindow() {
    const elements = getElements();
    lcm = elements.length > 0 ? JSON.parse(api.common_period(JSON.stringify(elements)))
                              : { found: false, reason: "no satellites are switched on" };
    const running = run && !run.finished;
    $("mc-window").disabled = running || useLcm();
    if (useLcm()) $("mc-window").value = String(+lcm.days.toFixed(4));
    const days = windowSeconds() / 86400;
    $("mc-window-info").textContent = lcm.found
      ? `Common repeat period ${f(lcm.days, 2)} days (worst phase mismatch ${f(lcm.mismatch_deg, 1)}°). ` +
        `The window is ${f(days / lcm.days, 2)} repeat cycles.`
      : `No common repeat period: ${lcm.reason}.${$("mc-lcm").checked ? " Using the typed window." : ""}`;
  }
  $("mc-lcm").addEventListener("change", refreshWindow);
  $("mc-window").addEventListener("input", refreshWindow);

  // ---- run control ---------------------------------------------------------------------
  function startRun() {
    if (!ready) return;
    const n = Math.min(MAX_TRIALS, Math.max(1, parseInt($("mc-n").value, 10) || 10000));
    $("mc-n").value = n;
    const pdopMax = parseFloat($("mc-pdop").value) > 0 ? parseFloat($("mc-pdop").value) : 6;
    $("mc-pdop").value = pdopMax;
    const seedText = $("mc-seed").value.trim();
    const seed = seedText === "" || !(parseInt(seedText, 10) >= 0) ? -1 : parseInt(seedText, 10);   // -1 = random

    const elements = getElements();
    if (elements.length === 0) {
      $("mc-status").textContent = "No satellites are switched on. Use the Constellation tab.";
      return;
    }

    refreshWindow();                                        // the constellation may have changed since the last look
    const windowS = windowSeconds();

    const now = performance.now();
    run = { id: ++runCounter, n, pdopMax, started: false, done: 0, inflight: false, finished: false,
            carry: 0, lastT: now, lastSpawn: now, lastSummaryAt: 0 };
    globe.clearTrials();
    updateLegend();
    $("mc-progress").value = 0;
    setRunning(true);
    $("mc-status").textContent = "Starting…";
    worker.postMessage({ cmd: "start", runId: run.id, n, seed, pdopMax, elements, windowS, maskDeg: getMaskDeg() });
  }

  function finish(message) {
    run.finished = true;
    setRunning(false);
    $("mc-status").textContent = message;
  }

  function cancelRun() {
    finish(`Cancelled after ${run.done.toLocaleString()} trials.`);
    if (run.started) worker.postMessage({ cmd: "summary", runId: run.id, dopType: $("mc-dop").value });
  }

  function setRunning(running) {
    $("mc-run").textContent = running ? "Cancel" : "Run";
    for (const id of ["mc-n", "mc-preset", "mc-seed", "mc-pdop", "mc-window", "mc-lcm"]) $(id).disabled = running;
    onRunState(running);
    if (!running) refreshWindow();                           // the window box stays locked if "common period" is on
  }

  // Pacing loop. Without visualization: back-to-back big chunks (as fast as the worker goes).
  // With visualization: about `rate` trials per second, one request in flight at a time.
  function tick(now) {
    requestAnimationFrame(tick);
    if (!run || !run.started || run.finished || run.inflight) return;
    const viz = $("mc-viz").checked;
    let k;
    if (viz) {
      run.carry += (getRate() * (now - run.lastT)) / 1000;
      run.lastT = now;
      k = Math.min(Math.floor(run.carry), MAX_VIZ_CHUNK);
      if (k < 1) return;
      run.carry -= k;
    } else {
      k = CHUNK;
    }
    k = Math.min(k, run.n - run.done);
    const last = run.done + k >= run.n;
    const wantSummary = last || now - run.lastSummaryAt > SUMMARY_MS;
    if (wantSummary) run.lastSummaryAt = now;
    run.inflight = true;
    worker.postMessage({ cmd: "advance", runId: run.id, k, wantPoints: viz,
                         summaryDop: wantSummary ? $("mc-dop").value : null });
  }
  requestAnimationFrame(tick);

  // ---- controls --------------------------------------------------------------------------
  // The rate slider is logarithmic: position 0..1000 maps to 1..2000 trials/s.
  const rateFromSlider = (v) => Math.round(Math.exp((Math.log(MAX_RATE) * v) / 1000));
  const sliderFromRate = (r) => (1000 * Math.log(r)) / Math.log(MAX_RATE);
  const getRate = () => Math.min(MAX_RATE, Math.max(MIN_RATE, parseFloat($("mc-rate-num").value) || 200));

  $("mc-rate").addEventListener("input", () => { $("mc-rate-num").value = rateFromSlider(+$("mc-rate").value); });
  $("mc-rate-num").addEventListener("input", () => {
    $("mc-rate").value = sliderFromRate(getRate());
  });
  $("mc-viz").addEventListener("change", () => {
    const on = $("mc-viz").checked;
    $("mc-rate").disabled = $("mc-rate-num").disabled = !on;
    $("mc-snap").disabled = $("mc-snap-num").disabled = !on;
    $("mc-legend").hidden = !on;
    if (run) { run.carry = 0; run.lastT = run.lastSpawn = performance.now(); }
  });
  // Snaps per second: slider position 0..1000 maps logarithmically to 0.1..10 (the middle is 1).
  const MIN_SNAP = 0.1, MAX_SNAP = 10;
  const snapFromSlider = (v) => +(MIN_SNAP * (MAX_SNAP / MIN_SNAP) ** (v / 1000)).toFixed(2);
  const sliderFromSnap = (r) => (1000 * Math.log(r / MIN_SNAP)) / Math.log(MAX_SNAP / MIN_SNAP);
  const getSnapRate = () => Math.min(MAX_SNAP, Math.max(MIN_SNAP, parseFloat($("mc-snap-num").value) || 1));
  $("mc-snap").addEventListener("input", () => { $("mc-snap-num").value = snapFromSlider(+$("mc-snap").value); });
  $("mc-snap-num").addEventListener("input", () => { $("mc-snap").value = sliderFromSnap(getSnapRate()); });

  $("mc-preset").addEventListener("change", () => {
    if ($("mc-preset").value) $("mc-n").value = $("mc-preset").value;
    $("mc-preset").value = "";
  });
  $("mc-dop").addEventListener("change", () => {
    if (run && run.started) worker.postMessage({ cmd: "summary", runId: run.id, dopType: $("mc-dop").value });
  });
  $("mc-run").addEventListener("click", () => (run && !run.finished ? cancelRun() : startRun()));

  function updateLegend() {
    const thr = parseFloat($("mc-pdop").value) || 6;
    $("mc-legend-bar").style.background = legendGradient(thr);
    $("mc-legend-mid").textContent = `${thr} (threshold)`;
    $("mc-legend-hi").textContent = `≥ ${2 * thr}`;
    $("mc-legend-bar-old").style.background = legendGradient(thr, FADE);
    $("mc-legend-undef").style.background = cssColor(UNDEFINED_RGB);
  }
  updateLegend();
  $("mc-pdop").addEventListener("input", updateLegend);

  // ---- results ---------------------------------------------------------------------------
  function render(s) {
    if (!s.n_done) return;
    lastSummary = s;
    const T = s.dop.type.toUpperCase();
    const ns = s.nsat;

    $("r-done").textContent = `${s.n_done.toLocaleString()} / ${s.n.toLocaleString()}`;
    $("r-seed").textContent = s.seed;
    $("r-config").textContent = `${s.n_satellites} satellites / ${f(s.window_days, 1)} days`;
    $("mc-mask-note").textContent = `(elevation mask ${s.mask_deg}°)`;
    $("r-mean").textContent = `${f(ns.mean, 3)} ± ${f(ns.se, 3)}`;
    const z = ns.se ? (ns.mean - ns.expected_mean) / ns.se : null;
    $("r-check").textContent = `${f(ns.expected_mean, 3)}  (${z === null ? "–" : (z >= 0 ? "+" : "") + z.toFixed(1)} σ)`;
    $("r-minmax").textContent = `${ns.min} / ${ns.max}`;
    $("r-ge4").textContent = pct(ns.frac_ge4);
    $("r-avail-label").textContent = `Good: ≥ 4 sats and PDOP ≤ ${s.pdop_max}`;
    $("r-avail").textContent = `${pct(s.availability.p)}  (95 % CI ${pct(s.availability.lo)} – ${pct(s.availability.hi)})`;

    const names = ["undefined (< 4 sats or singular)", "median", "95th percentile", "99th percentile", "max"];
    document.querySelectorAll(".r-dop-name").forEach((el, i) => { el.textContent = `${T} ${names[i]}`; });
    $("r-undef").textContent = s.dop.n_undefined.toLocaleString();
    $("r-med").textContent = f(s.dop.median);
    $("r-p95").textContent = f(s.dop.p95);
    $("r-p99").textContent = f(s.dop.p99);
    $("r-max").textContent = f(s.dop.max);
    $("hist-dop-title").textContent = T;

    drawSatHistogram(s);
    drawDopHistogram(s);
  }

  function drawSatHistogram(s) {
    const counts = s.nsat.counts;
    const nz = counts.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
    const lo = Math.max(0, nz[0] - 1), hi = Math.min(counts.length - 1, nz[nz.length - 1] + 1);
    const bars = [], ticks = [];
    for (let n = lo; n <= hi; n++) {
      bars.push({ x0: n - 0.5, x1: n + 0.5, count: counts[n], color: n < 4 ? cssColor(BAR_FEW) : BAR, n });
      ticks.push({ x: n, label: String(n) });
    }
    drawBars($("hist-n"), { bars, xMin: lo - 0.5, xMax: hi + 0.5, ticks,
      marker: { x: s.nsat.expected_mean, label: `analytic mean ${s.nsat.expected_mean.toFixed(2)}` } });
    $("hist-n")._bars = bars;
    $("cap-n").textContent = `Violet bars: fewer than 4 satellites (no position fix). ${s.n_done.toLocaleString()} trials.`;
  }

  function drawDopHistogram(s) {
    const d = s.dop;
    if (!d.hist_counts) {
      drawBars($("hist-dop"), { bars: [], xMin: 0, xMax: 1, ticks: [], marker: null });
      $("cap-dop").textContent = "No trial has a defined DOP yet.";
      return;
    }
    const e = d.hist_edges;
    const bars = d.hist_counts.map((count, i) => ({ x0: e[i], x1: e[i + 1], count, color: BAR }));
    const ticks = [0, 1, 2, 3, 4].map((k) => { const x = e[0] + ((e[e.length - 1] - e[0]) * k) / 4; return { x, label: x.toFixed(2) }; });
    const showThr = d.type === "pdop" && s.pdop_max >= e[0] && s.pdop_max <= e[e.length - 1];
    drawBars($("hist-dop"), { bars, xMin: e[0], xMax: e[e.length - 1], ticks,
      marker: showThr ? { x: s.pdop_max, label: `threshold ${s.pdop_max}` } : null });
    $("hist-dop")._bars = bars;
    const over = d.overflow ? ` ${d.overflow.toLocaleString()} trials above ${e[e.length - 1].toFixed(2)} not shown.` : "";
    $("cap-dop").textContent = `${(s.n_done - d.n_undefined).toLocaleString()} trials with a defined ${d.type.toUpperCase()}.${over}`;
  }

  // hover: show the bar under the mouse
  $("hist-n").addEventListener("mousemove", (ev) => {
    const i = barAt($("hist-n"), ev.clientX), s = lastSummary;
    if (i < 0 || !s) return;
    const b = $("hist-n")._bars[i];
    $("cap-n").textContent = `${b.n} satellites: ${b.count.toLocaleString()} trials (${pct(b.count / s.n_done)})`;
  });
  $("hist-dop").addEventListener("mousemove", (ev) => {
    const i = barAt($("hist-dop"), ev.clientX), s = lastSummary;
    if (i < 0 || !s) return;
    const b = $("hist-dop")._bars[i];
    $("cap-dop").textContent = `${s.dop.type.toUpperCase()} ${b.x0.toFixed(2)} – ${b.x1.toFixed(2)}: ${b.count.toLocaleString()} trials (${pct(b.count / s.n_done)} of all)`;
  });
  for (const id of ["hist-n", "hist-dop"]) {
    $(id).addEventListener("mouseleave", () => { if (lastSummary) { drawSatHistogram(lastSummary); drawDopHistogram(lastSummary); } });
  }

  // charts drawn while the tab was hidden have zero width, so the tab redraws them when shown
  return { ensureWorker, refreshWindow, recomputeFaa, busy: () => !!(run && !run.finished), redraw: () => { if (lastSummary) render(lastSummary); } };
}
