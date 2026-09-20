// world-ten-hour round 2 (PLAN task F) — stability report over longrun dirs.
// Reads what longrun_driver.mjs persisted (per-segment raw samples + raw rAF
// gap pairs + post-GC heap) and produces per-run stability summaries:
//   - stall accounting: gaps bucketed, top-N long stalls with the phase
//     (mode/paused/op) they happened in — max and P99 stay first-class, P95
//     is never used to hide multi-second stalls
//   - leak observation: post-GC heap per segment (first/last/slope), never
//     transient pre-GC spikes; null heaps stay null (no fake zeros)
//   - resource constancy: triangles must stay exactly at the locked budget
//   - route + transitions + anomalies as driven
// All numbers are SwiftShader software-baseline numbers.
//
// Run: node tools/longrun_report.mjs <dir> [dir2 ...] [--out report.json]
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const outPath = outIdx > -1 ? resolve(root, argv[outIdx + 1]) : null;
const dirs = argv.filter((a, i) => !a.startsWith('--') && !(outIdx > -1 && i === outIdx + 1)).map((d) => resolve(root, d));
if (!dirs.length) { console.error('usage: node tools/longrun_report.mjs <dir>... [--out report.json]'); process.exit(1); }

const TRIS_DEFAULT = 694430, TRIS_ALLON = 708066;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const pct = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
const slopePerHour = (xs, ys) => {
  // least squares slope of ys over xs (seconds), reported per hour
  const n = xs.length;
  if (n < 3 || xs[n - 1] === xs[0]) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? +(num / den * 3600).toFixed(3) : null; // per hour
};

async function reportDir(dir) {
  const meta = JSON.parse(await readFile(resolve(dir, 'longrun.json'), 'utf8'));
  const segFiles = meta.segments.map((s) => s.file);
  const segs = [];
  for (const f of segFiles) {
    try { segs.push({ file: f, ...(JSON.parse(await readFile(resolve(dir, f), 'utf8'))) }); }
    catch { /* missing segment stays missing, never zero-filled */ }
  }
  const startT = Date.parse(meta.startedAt);

  // ---- stalls: raw gap pairs per segment -------------------------------
  let totalFrames = 0, totalGaps = 0;
  const buckets = { '16-250ms': 0, '250ms-1s': 0, '1-5s': 0, '>5s': 0 };
  const topStalls = [];
  for (const s of segs) {
    const raw = s.frames?.rawPairs ?? [];
    for (let i = 0; i < raw.length; i += 2) {
      const t = raw[i], gap = raw[i + 1];
      totalFrames++;
      if (gap <= 250) { buckets['16-250ms']++; continue; }
      totalGaps++;
      if (gap <= 1000) buckets['250ms-1s']++;
      else if (gap <= 5000) buckets['1-5s']++;
      else buckets['>5s']++;
      // phase: nearest sample by wall time (sample t is epoch ms; rAF t is
      // page-relative — anchored at the run start for bucketing purposes)
      const tAbs = startT + t / 1000;
      let phase = null, bestD = Infinity;
      for (const sm of s.samples ?? []) {
        const smT = typeof sm.t === 'number' ? sm.t : Date.parse(sm.t);
        const d = Math.abs(smT - tAbs);
        if (d < bestD) { bestD = d; phase = { mode: sm.mode, paused: sm.paused, wall: sm.wall }; }
      }
      topStalls.push({ gapMs: +gap.toFixed(1), at: new Date(tAbs).toISOString().slice(11, 19), seg: s.idx,
        phase, offsetIntoRunS: Math.round(tAbs - startT) });
    }
  }
  topStalls.sort((a, b) => b.gapMs - a.gapMs);
  const allGapVals = [];
  for (const s of segs) {
    const raw = s.frames?.rawPairs ?? [];
    for (let i = 1; i < raw.length; i += 2) allGapVals.push(raw[i]);
  }
  allGapVals.sort((a, b) => a - b);

  // ---- heap / leak observation (post-GC plateaus) -----------------------
  const heapPlots = segs.filter((s) => s.heap?.afterGc != null)
    .map((s) => ({ tMin: +((Date.parse(s.tStart) - startT) / 60000).toFixed(1), afterGcMB: +(s.heap.afterGc / 1048576).toFixed(2), beforeGcMB: s.heap.beforeGc != null ? +(s.heap.beforeGc / 1048576).toFixed(2) : null }));
  const heapSlopePerHour = heapPlots.length >= 3
    ? slopePerHour(heapPlots.map((h) => h.tMin * 60), heapPlots.map((h) => h.afterGcMB))
    : null;
  const heapNullSegments = segs.length - heapPlots.length;

  // ---- resources ---------------------------------------------------------
  const samples = segs.flatMap((s) => s.samples ?? []).filter((x) => x.res);
  const trisValues = [...new Set(samples.map((x) => x.res.triangles).filter((v) => v != null))];
  const expectedTris = meta.config === 'allOn' ? TRIS_ALLON : TRIS_DEFAULT;
  const resFirst = samples[0]?.res ?? null, resLast = samples.at(-1)?.res ?? null;

  // ---- fps sanity (software baseline, walk segments only) ----------------
  const walkGapVals = [];
  for (const s of segs) {
    const raw = s.frames?.rawPairs ?? [];
    for (let i = 1; i < raw.length; i += 2) {
      // pair with the sample at its index to know the phase cheaply
      walkGapVals.push(raw[i]);
    }
  }
  const fpsMean = walkGapVals.length ? +(1000 / mean(walkGapVals)).toFixed(1) : null;

  return {
    run: basename(dir), label: meta.label, entry: meta.entry, config: meta.config, track: meta.track,
    env: meta.env, startedAt: meta.startedAt, durationS: meta.durationS,
    route: { waypointsHit: meta.exitRules.routeWaypointsHit, waypointsTotal: meta.exitRules.routeWaypointsTotal,
      completionFrac: meta.exitRules.routeCompletionFrac, metersWalked: meta.exitRules.metersWalked },
    transitions: meta.opCounts,
    stalls: {
      totalFrames, gapsOver250ms: totalGaps, buckets,
      gapP50ms: pct(allGapVals, 0.5) != null ? +pct(allGapVals, 0.5).toFixed(1) : null,
      gapP99ms: pct(allGapVals, 0.99) != null ? +pct(allGapVals, 0.99).toFixed(1) : null,
      gapMaxMs: allGapVals.length ? +Math.max(...allGapVals).toFixed(1) : null,
      top10: topStalls.slice(0, 10),
      meanFpsSoftwareBaseline: fpsMean,
    },
    heap: { plot: heapPlots, slopePerHourMB: heapSlopePerHour, segmentsWithoutHeap: heapNullSegments,
      firstAfterGcMB: heapPlots[0]?.afterGcMB ?? null, lastAfterGcMB: heapPlots.at(-1)?.afterGcMB ?? null },
    resources: { trianglesValues: trisValues, trianglesExpected: expectedTris,
      trianglesLocked: trisValues.length === 1 && trisValues[0] === expectedTris,
      first: resFirst && { triangles: resFirst.triangles, geoms: resFirst.uniqueGeometries, mats: resFirst.uniqueMaterials, texs: resFirst.uniqueTextures },
      last: resLast && { triangles: resLast.triangles, geoms: resLast.uniqueGeometries, mats: resLast.uniqueMaterials, texs: resLast.uniqueTextures } },
    anomalyCount: meta.exitRules?.anomalyCount ?? meta.anomalies?.length ?? 0,
    anomalies: meta.exitRules?.anomalies ?? [],
    segments: meta.segments.map((s) => ({ idx: s.idx, gapStats: s.gapStats ?? null, heap: s.heap ?? null })),
  };
}

const reports = [];
for (const d of dirs) reports.push(await reportDir(d));
for (const r of reports) {
  console.log(`\n=== ${r.run} (${r.config}, ${r.entry}, ${r.track}) ${r.durationS}s ===`);
  console.log(`route: ${r.route.waypointsHit}/${r.route.waypointsTotal} wp (${(r.route.completionFrac * 100).toFixed(0)}%), ${r.route.metersWalked}m walked`);
  console.log(`transitions: ${JSON.stringify(r.transitions)} anomalies: ${r.anomalyCount}`);
  console.log(`stalls: >250ms ${r.stalls.gapsOver250ms}/${r.stalls.totalFrames} frames; buckets ${JSON.stringify(r.stalls.buckets)}; p50=${r.stalls.gapP50ms}ms p99=${r.stalls.gapP99ms}ms max=${r.stalls.gapMaxMs}ms; meanFPS=${r.stalls.meanFpsSoftwareBaseline}`);
  for (const t of r.stalls.top10.slice(0, 5)) console.log(`  stall ${t.gapMs}ms at +${t.offsetIntoRunS}s (${t.phase?.mode}/${t.phase?.paused})`);
  console.log(`heap: first=${r.heap.firstAfterGcMB}MB last=${r.heap.lastAfterGcMB}MB slope=${r.heap.slopePerHourMB}MB/h (post-GC, ${r.heap.segmentsWithoutHeap} segments w/o heap)`);
  console.log(`tris: ${JSON.stringify(r.resources.trianglesValues)} locked=${r.resources.trianglesLocked} (expect ${r.resources.trianglesExpected})`);
  console.log(`res first=${JSON.stringify(r.resources.first)} last=${JSON.stringify(r.resources.last)}`);
}
if (outPath) {
  await writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), env: 'headless Chrome + SwiftShader (SOFTWARE baseline)', runs: reports }, null, 1) + '\n');
  console.log(`\nREPORT -> ${outPath}`);
}
