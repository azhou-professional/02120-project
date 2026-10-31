// Polar sky plot: zenith at the centre, horizon at the outer circle, north at the top,
// azimuth increasing clockwise (east to the right).

export const PLANE_COLORS = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948"];

export function drawSkyplot(canvas, snap) {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  if (size === 0) return;                                   // tab hidden: nothing to draw (and arc() would throw)
  canvas.width = canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2, cy = size / 2, R = size / 2 - 22;
  const radius = (el) => R * (90 - el) / 90;               // elevation -> distance from centre
  const point = (az, el) => {
    const a = az * Math.PI / 180;
    return [cx + radius(el) * Math.sin(a), cy - radius(el) * Math.cos(a)];
  };

  ctx.strokeStyle = "#2a3441"; ctx.fillStyle = "#8b98a8"; ctx.lineWidth = 1;
  ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";

  for (const el of [0, 30, 60]) {                           // elevation rings
    ctx.beginPath(); ctx.arc(cx, cy, radius(el), 0, 2 * Math.PI); ctx.stroke();
    if (el > 0) ctx.fillText(`${el}°`, cx + 10, cy - radius(el) + 8);
  }
  for (const az of [0, 90, 180, 270]) {                     // cardinal spokes
    const [x, y] = point(az, 0);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
  }
  const [nx, ny] = point(0, -8), [ex, ey] = point(90, -8), [sx, sy] = point(180, -8), [wx, wy] = point(270, -8);
  ctx.fillText("N", nx, ny); ctx.fillText("E", ex, ey); ctx.fillText("S", sx, sy); ctx.fillText("W", wx, wy);

  ctx.setLineDash([4, 4]); ctx.strokeStyle = "#4fc3f7";     // elevation mask
  ctx.beginPath(); ctx.arc(cx, cy, radius(snap.mask_deg), 0, 2 * Math.PI); ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = "left";
  snap.names.forEach((name, i) => {
    if (!snap.visible[i]) return;
    const [x, y] = point(snap.az[i], snap.el[i]);
    ctx.fillStyle = PLANE_COLORS[snap.planes[i]];
    ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = "#dfe6ee"; ctx.fillText(name, x + 9, y);
  });
}
