// Canvas fitting (player-experience batch A) — the renderer buffer must match
// the container's REAL CSS size, with the pixel ratio capped (default 1, at
// most 1.5). The 20260920 defect: the renderer was created with
// setPixelRatio(1) and NO setSize/observer, so the buffer stayed at the
// three.js 300x150 default while CSS stretched it across #app — every real
// screenshot rendered at severe low resolution. DOM-free on purpose: the page
// wires a ResizeObserver; node tests drive these functions with fakes.

export const DPR_CAP = 1.5;

// `requested`: ?dpr= query value (string | number | nullish). Default 1,
// clamped to [1, DPR_CAP] — never below CSS resolution, never above the cap.
export function resolvePixelRatio(requested) {
  const v = Number(requested);
  if (!Number.isFinite(v)) return 1;
  return Math.min(DPR_CAP, Math.max(1, v));
}

export function computeCanvasFit(cssW, cssH, pixelRatio) {
  const w = Number(cssW), h = Number(cssH);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return {
    css: [w, h],
    buffer: [Math.round(w * pixelRatio), Math.round(h * pixelRatio)],
    aspect: w / h,
  };
}

// Applies one fit to renderer + camera. updateStyle=false: the page CSS owns
// the canvas layout (width/height 100%), the renderer owns the buffer only.
// Returns false (and touches nothing) on a degenerate measurement — a
// mid-layout observer callback must not collapse the buffer to 0.
export function applyCanvasFit(renderer, camera, cssW, cssH, pixelRatio) {
  const fit = computeCanvasFit(cssW, cssH, pixelRatio);
  if (!fit) return false;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(fit.css[0], fit.css[1], false);
  camera.aspect = fit.aspect;
  camera.updateProjectionMatrix();
  return true;
}
