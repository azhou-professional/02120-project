// Web Worker that owns a second Pyodide instance and runs the Monte-Carlo maths, so the
// page (globe, sky plot) stays smooth. The page drives it: every request is short, so
// "cancel" is simply the page not sending the next request.
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs";
import { loadSim } from "./pyloader.js";

let mc = null, faa = null;
let currentRun = null;

const ready = loadSim(loadPyodide)
  .then((py) => { mc = py.pyimport("sim.montecarlo"); faa = py.pyimport("sim.faa"); postMessage({ type: "ready" }); })
  .catch((e) => postMessage({ type: "error", message: String(e) }));

onmessage = async ({ data }) => {
  await ready;
  if (!mc) return;
  try {
    if (data.cmd === "faa") {                  // recompute one week of the FAA reproduction (Compare tab)
      faa.faa_start(data.week);
      let fraction = 0;
      while (fraction < 1) {
        fraction = JSON.parse(faa.faa_advance(60)).fraction;          // one hour of minutes at a time
        postMessage({ type: "faa-progress", fraction });
        await new Promise((r) => setTimeout(r, 0));                   // let progress messages out
      }
      postMessage({ type: "faa-done", week: data.week, result: JSON.parse(faa.faa_result()) });
    } else if (data.cmd === "start") {
      currentRun = data.runId;
      const info = JSON.parse(mc.mc_start(data.n, data.seed, data.pdopMax, data.maskDeg, JSON.stringify(data.elements), data.windowS));
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
