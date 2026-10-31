// Hand-drawn canvas histogram. Bars are drawn with height proportional to count, so you can
// check any bar against the numbers in the results table.
const AXIS = "#8b98a8", GRID = "#2a3441", MARK = "#dfe6ee";

/**
 * spec = { bars: [{x0, x1, count, color}], xMin, xMax,
 *          ticks: [{x, label}], marker: {x, label} | null }
 */
export function drawBars(canvas, spec) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === 0 || h === 0) return;                           // tab hidden
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const m = { l: 44, r: 8, t: 16, b: 22 };
  const plotW = w - m.l - m.r, plotH = h - m.t - m.b;
  const sx = (x) => m.l + ((x - spec.xMin) / (spec.xMax - spec.xMin)) * plotW;
  const yMax = Math.max(1, ...spec.bars.map((b) => b.count));
  const sy = (c) => m.t + plotH - (c / yMax) * plotH;

  ctx.font = "11px system-ui, sans-serif";
  ctx.lineWidth = 1;

  // recessive gridlines at 0, 50 %, 100 % of the tallest bar, labelled with counts
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const f of [0, 0.5, 1]) {
    const y = sy(f * yMax);
    ctx.strokeStyle = f === 0 ? AXIS : GRID;
    ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(w - m.r, y); ctx.stroke();
    ctx.fillStyle = AXIS;
    ctx.fillText(Math.round(f * yMax).toLocaleString(), m.l - 5, y);
  }

  for (const b of spec.bars) {
    const x0 = sx(b.x0) + 1, x1 = sx(b.x1) - 1;
    const top = sy(b.count);
    ctx.fillStyle = b.color;
    ctx.fillRect(x0, top, Math.max(1, x1 - x0), m.t + plotH - top);
  }

  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = AXIS;
  for (const t of spec.ticks) ctx.fillText(t.label, sx(t.x), m.t + plotH + 5);

  if (spec.marker) {
    const x = sx(spec.marker.x);
    ctx.strokeStyle = MARK; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, m.t - 4); ctx.lineTo(x, m.t + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = MARK; ctx.textBaseline = "bottom";
    ctx.textAlign = x > w - 90 ? "right" : "left";
    ctx.fillText(spec.marker.label, x + (x > w - 90 ? -4 : 4), m.t + 6);
  }
  canvas._hit = { bars: spec.bars, sx };
}

/** Index of the bar under a mouse event, or -1. */
export function barAt(canvas, clientX) {
  if (!canvas._hit) return -1;
  const x = clientX - canvas.getBoundingClientRect().left;
  const { bars, sx } = canvas._hit;
  return bars.findIndex((b) => x >= sx(b.x0) && x < sx(b.x1));
}
