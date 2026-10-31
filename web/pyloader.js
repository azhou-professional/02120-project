// Shared by the page and the Monte-Carlo worker: start Pyodide, load numpy, and copy the
// sim/*.py files into Pyodide's file system so `import sim.api` etc. work.
// Keep in step with web/sim/*.py (tests/test_pyloader.py checks this).
const PY_FILES = ["__init__.py", "constellation.py", "geometry.py", "dop.py", "presets.py", "api.py", "montecarlo.py",
                  "almanac.py", "faa.py", "ephemeris.py"];
// Data files Python reads (the 1999 GPS almanacs). Keep in step with web/data/almanac/1999 (tested).
const WEEKS = Array.from({ length: 14 }, (_, k) => 1003 + k);
const TOA = { 1003: 503808, 1005: 503808, 1010: 503808 };     // almanac reference time in each file name
const DATA_FILES = WEEKS.map((w) => `data/almanac/1999/almanac.yuma.week${w}.${TOA[w] || 589824}.txt`);

// onStep(text): optional, told when each stage starts (the page's loading screen shows it).
export async function loadSim(loadPyodide, onStep = () => {}) {
  onStep("Downloading Python (Pyodide)");
  const pyodide = await loadPyodide();
  onStep("Loading numpy");
  await pyodide.loadPackage("numpy");
  onStep("Loading the simulation files");
  pyodide.FS.mkdir("/home/pyodide/sim");
  for (const f of PY_FILES) {
    const res = await fetch(new URL(`sim/${f}`, import.meta.url), { cache: "no-cache" });
    if (!res.ok) throw new Error(`could not load sim/${f} (HTTP ${res.status})`);
    pyodide.FS.writeFile(`/home/pyodide/sim/${f}`, await res.text());
  }
  pyodide.FS.mkdirTree("/home/pyodide/data/almanac/1999");
  for (const f of DATA_FILES) {
    const res = await fetch(new URL(f, import.meta.url), { cache: "no-cache" });
    if (!res.ok) throw new Error(`could not load ${f} (HTTP ${res.status})`);
    pyodide.FS.writeFile(`/home/pyodide/${f}`, await res.text());
  }
  pyodide.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
  return pyodide;
}
