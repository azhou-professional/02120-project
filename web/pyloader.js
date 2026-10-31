// Shared by the page and the Monte-Carlo worker: start Pyodide, load numpy, and copy the
// sim/*.py files into Pyodide's file system so `import sim.api` etc. work.
// Keep in step with web/sim/*.py (tests/test_pyloader.py checks this).
const PY_FILES = ["__init__.py", "constellation.py", "geometry.py", "dop.py", "presets.py", "api.py", "montecarlo.py"];

export async function loadSim(loadPyodide) {
  const pyodide = await loadPyodide();
  await pyodide.loadPackage("numpy");
  pyodide.FS.mkdir("/home/pyodide/sim");
  for (const f of PY_FILES) {
    const res = await fetch(new URL(`sim/${f}`, import.meta.url), { cache: "no-cache" });
    if (!res.ok) throw new Error(`could not load sim/${f} (HTTP ${res.status})`);
    pyodide.FS.writeFile(`/home/pyodide/sim/${f}`, await res.text());
  }
  pyodide.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
  return pyodide;
}
