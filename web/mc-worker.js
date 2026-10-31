// Web Worker that owns a second Pyodide instance and runs the Monte-Carlo maths, so the
// page (globe, sky plot) stays smooth. The page drives it: every request is short, so
// "cancel" is simply the page not sending the next request.
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs";
import { loadSim } from "./pyloader.js";

let mc = null;
let currentRun = null;

const ready = loadSim(loadPyodide)
  .then((py) => { mc = py.pyimport("sim.montecarlo"); postMessage({ type: "ready" }); })
  .catch((e) => postMessage({ type: "error", message: String(e) }));

onmessage = async ({ data }) => {
  await ready;
  if (!mc) return;
  try {
    if (data.cmd === "start") {
      currentRun = data.runId;
      const info = JSON.parse(mc.mc_start(data.n, data.seed, data.pdopMax, 0.0, JSON.stringify(data.elements), data.windowS));
      postMessage({ type: "started", runId: data.runId, ...info });
    } else if (data.runId !== currentRun) {
      return;                                    // stale request from an older run
    } else if (data.cmd === "advance") {
      const adv = JSON.parse(mc.mc_advance(data.k, data.wantPoints));
      const summary = data.summaryDop ? JSON.parse(mc.mc_summary(data.summaryDop)) : null;
      postMessage({ type: "advanced", runId: data.runId, ...adv, summary });
    } else if (data.cmd === "summary") {
      postMessage({ type: "summary", runId: data.runId, summary: JSON.parse(mc.mc_summary(data.dopType)) });
    }
  } catch (e) {
    postMessage({ type: "error", message: String(e) });
  }
};
