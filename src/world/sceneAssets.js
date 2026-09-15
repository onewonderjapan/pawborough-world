// SC-F3: ONE inventory of everything a scene carries beyond the base
// assembly. loadStats.bytesTotal, record.trianglesExpected,
// version.additionalAssets and the version fingerprint all derive from this
// list, so a new dataset asset kind joins by adding an entry here — never by
// patching four separate formulas again (the street-completion surface
// pavement was exactly such a missing branch: loaded, walk-checked and
// byte-validated, yet absent from every statistic and from the fingerprint).
//
// The dataset surface (street-completion tail pavement) is part of the scene
// BY DESIGN and loads in BOTH modes: assets=off holds back the refined
// shopfront replacement blocks only, never the walkable ground. The legacy
// 'assets-off' fingerprint marker therefore keeps its meaning ("shopfront
// comparison") while the surface entry stays present in either mode; the
// record carries an assetsOffScope note so the distinction is explicit.

export const SURFACE_ID = 'dataset-surface';

export function surfaceEntry(manifest) {
  const s = manifest?.streetCompletion?.surface;
  if (!s) return null;
  return { kind: 'surface', id: SURFACE_ID, glb: s.path, bytes: s.bytes, sha256: s.sha256, triangles: s.triangles ?? 0 };
}

export function assetEntry(a) {
  return { kind: 'asset', id: a.id, glb: a.glb, bytes: a.bytes, sha256: a.sha256, triangles: a.triangles ?? 0 };
}

// Entries for everything actually loaded: refined shop assets only when their
// block is enabled, the surface whenever the dataset declares it.
export function loadedSceneAssets(manifest, assetInfos, assetsEnabled) {
  const entries = assetsEnabled ? assetInfos.map(assetEntry) : [];
  const surface = surfaceEntry(manifest);
  if (surface) entries.push(surface);
  return entries;
}

export function expectedTriangles(baseTriangles, entries) {
  const extra = entries.reduce((s, a) => s + (a.triangles || 0), 0);
  return { base: baseTriangles, extra, total: baseTriangles + extra };
}

export function sceneFingerprint(manifest, entries, assetsEnabled) {
  return [
    `glb-sha256-${manifest.worldAssembly.sha256}`,
    ...(assetsEnabled ? entries.filter(e => e.kind === 'asset').map(a => `${a.id}:${a.sha256}`) : ['assets-off']),
    ...entries.filter(e => e.kind === 'surface').map(a => `${a.id}:${a.sha256}`),
  ].join('+');
}
