// Learning panel: a wide overlay over the globe with the equations, worked examples and limitations.
// The text itself is plain HTML in index.html (<div id="learn">), so it can be read and edited there.
// KaTeX (loaded from the CDN in index.html) typesets the maths the first time the panel opens; if it
// did not load (no internet), the LaTeX source stays visible, which is still readable.
// The numbers in the worked examples are checked against the Python code by tests/test_learning.py.

const $ = (id) => document.getElementById(id);

export function initLearning() {
  const panel = $("learn");
  const btn = $("tab-btn-learn");
  let typeset = false;

  function open() {
    panel.hidden = false;
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    if (!typeset && window.renderMathInElement) {
      window.renderMathInElement(panel, {
        delimiters: [
          { left: "\\[", right: "\\]", display: true },     // \[ ... \]  equation on its own line
          { left: "\\(", right: "\\)", display: false },    // \( ... \)  inside a sentence
        ],
        throwOnError: false,                                // a typo shows in red instead of breaking the page
      });
      typeset = true;
    }
    panel.focus();
  }

  function close() {
    panel.hidden = true;
    btn.classList.remove("active");
    btn.setAttribute("aria-selected", "false");
  }

  btn.addEventListener("click", () => (panel.hidden ? open() : close()));
  $("learn-close").addEventListener("click", close);
  // clicking any other tab (Live, Monte Carlo, ...) closes the Learning panel
  for (const other of document.querySelectorAll(".tab")) {
    if (other !== btn) other.addEventListener("click", close);
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) close(); });
  // the table of contents scrolls inside the panel rather than jumping the whole page
  for (const a of panel.querySelectorAll("nav a")) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      panel.querySelector(a.getAttribute("href")).scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}
