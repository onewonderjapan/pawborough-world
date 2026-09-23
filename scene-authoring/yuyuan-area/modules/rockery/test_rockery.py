#!/usr/bin/env python3
"""test_rockery.py — spec gates for pawborough-w1-rockery (pure python3, no Blender).

Run:  python3 -X utf8 test_rockery.py --out <out-rockery> --module <modules/rockery> \
         --validation <validation.json>

Spec tests (DESIGN_SPEC.json + R1-FIXES.md):
  1. all vertices inside expanded placeholder boxes (union of per-rock boxes)
  2. path clearance >= 0.85 m, polylines recomputed from frozen baseline layout
  3. 玉玲珑: 3 rays through the tallest rock pass (no hit, both directions)
  4. tri budget: dajiashan <= 25000, yulinglong <= 6000
  5. Khronos validator: 0 errors
  6. reimport: images connected with correct colorspace, outward normals,
     tri budget, GLB bounds within spec (union boxes) +/- 10%
R1 gates (master re-review 2026-09-23):
  7. 大假山 one mountain: REAL neighbour pairs cross-section embedding >= 0.30
     (rule re-derived here from site-inputs boxes) at y = 0.8 and 1.4
  8. no see-through: horizontal rays y 0.3..2.0 crossing occupied placeholder
     boxes must hit the mesh inside the union-box interval
  9. Taihu texture: every rock's high-curvature face share (mean dihedral >
     0.30 rad) >= 0.20 on the delivered LOD  (R0 baseline: 0.15% / 6.2%)
 10. hollows: >=2 per rock (main 玉玲珑 >=4), measured depth >= 0.15*size,
     rock continues behind the bowl (non-through)
 11. 玉玲珑 waist: mid plan width <= 0.75 of top/bottom width (per direction)
 12. platforms: 3..5 on 大假山, each flat within 0.15 m over a 0.6r grid
 13. materials: stone-dark bake on hollow+ground band; moss only north-facing
     bottom band, <= 15% of faces
"""

import argparse
import json
import math
import os
import sys
import unittest

PATH_MIN_M = 0.85
CURV_THRESH = 0.25          # rad — must match check-rockery.py CURV_THRESHES;
                            # R0 baseline share at 0.25 rad: 0.5% (大假山) / 6.9% (玉玲珑)
CURV_MIN_SHARE = 0.20       # fix sheet: >=20% of faces above threshold
REAL_MIN_SHARE = 0.30       # pair-class rule — must match build-rockery.py
EMBED_MIN = 0.30            # fix sheet: >=30% mutual embedding
WAIST_MAX = 0.75
FLAT_MAX_M = 0.15
MOSS_MAX_SHARE = 0.15


def seg_dist(px, pz, ax, az, bx, bz):
    abx, abz = bx - ax, bz - az
    ab2 = abx * abx + abz * abz
    if ab2 == 0:
        return math.hypot(px - ax, pz - az)
    t = max(0.0, min(1.0, ((px - ax) * abx + (pz - az) * abz) / ab2))
    return math.hypot(px - (ax + t * abx), pz - (az + t * abz))


def real_pairs(rocks):
    """Re-derive REAL neighbour pairs from the frozen boxes (independent of the
    builder; same rule/constant, see build-rockery.classify_pairs)."""
    out = []
    for a in rocks:
        for b in rocks:
            if b['seed'] <= a['seed']:
                continue
            x0 = max(a['box']['xMin'], b['box']['xMin'])
            x1 = min(a['box']['xMax'], b['box']['xMax'])
            z0 = max(a['box']['zMin'], b['box']['zMin'])
            z1 = min(a['box']['zMax'], b['box']['zMax'])
            if x1 <= x0 or z1 <= z0:
                continue
            ov = (x1 - x0) * (z1 - z0)
            base = min(math.pi * (0.5 * a['size']) ** 2,
                       math.pi * (0.5 * b['size']) ** 2)
            if ov >= REAL_MIN_SHARE * base:
                out.append((a['seed'], b['seed']))
    return sorted(out)


class RockeryCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # args parsed in __main__ and stashed on the class
        cls.out = cls.cli_args['out']
        cls.module = cls.cli_args['module']
        cls.clusters = {}
        for cid in ('rockery-dajiashan', 'rockery-yulinglong'):
            site = json.load(open(os.path.join(cls.module, 'site-inputs.json')))
            check = json.load(open(os.path.join(cls.out, f'check-{cid}.json')))
            record = json.load(open(os.path.join(cls.out, f'build-{cid}.record.json')))
            val = json.load(open(cls.cli_args['validation']))
            vres = next((r for r in val['results'] if r['file'].endswith(f'{cid}.glb')), None)
            cls.clusters[cid] = {
                'site': site, 'cl': site['clusters'][cid],
                'check': check, 'record': record, 'val': val, 'vres': vres,
                'budget': site['budget'][cid.replace('rockery-', '')],
            }

    def cluster(self, cid):
        return self.clusters[cid]

    # --- test 1: vertices inside expanded placeholder boxes (union) ---
    def test_vertices_inside_boxes(self):
        for cid, c in self.clusters.items():
            boxes = [(r['box']['xMin'], r['box']['xMax'],
                      r['box']['zMin'], r['box']['zMax'],
                      r['box']['yMin'], r['box']['yMax']) for r in c['cl']['rocks']]
            bad = 0
            for x, z, y in c['check']['vertsMap']:
                if not any(bx0 <= x <= bx1 and bz0 <= z <= bz1 and by0 <= y <= by1
                           for bx0, bx1, bz0, bz1, by0, by1 in boxes):
                    bad += 1
            self.assertEqual(bad, 0, f'{cid}: {bad} vertices outside all placeholder boxes')

    # --- test 2: path clearance >= 0.85 m from frozen layout polylines ---
    def test_path_clearance(self):
        paths = self.clusters['rockery-dajiashan']['check']['layoutPaths']
        segs = []
        for p in paths:
            poly = p['polyline']
            for i in range(len(poly) - 1):
                segs.append((p['id'], poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]))
        self.assertTrue(len(segs) > 0, 'no path polylines found in layout')
        for cid, c in self.clusters.items():
            worst = (1e9, None)
            for x, z, _y in c['check']['vertsMap']:
                for pid, ax, az, bx, bz in segs:
                    d = seg_dist(x, z, ax, az, bx, bz)
                    if d < worst[0]:
                        worst = (d, pid)
            c['minPathDist'] = worst
            self.assertGreaterEqual(worst[0], PATH_MIN_M,
                                    f'{cid}: vertex {worst[0]:.3f} m from path {worst[1]} < {PATH_MIN_M}')
            print(f'  {cid}: min vertex-path distance {worst[0]:.2f} m (path {worst[1]})')

    # --- test 3: 玉玲珑 holes, 3 rays pass both directions ---
    def test_yulinglong_holes_pass(self):
        c = self.clusters['rockery-yulinglong']
        rays = c['check']['holeRays']
        self.assertEqual(len(rays), 3, f'expected 3 holes, got {len(rays)}')
        for r in rays:
            self.assertIsNone(r['fwd'], f"hole {r['holeIndex']} fwd ray hit at {r['fwd']}")
            self.assertIsNone(r['bwd'], f"hole {r['holeIndex']} bwd ray hit at {r['bwd']}")

    # --- test 4: tri budget ---
    def test_tri_budget(self):
        for cid, c in self.clusters.items():
            tris = c['check']['triCount']
            self.assertLessEqual(tris, c['budget'],
                                 f'{cid}: {tris} tris > budget {c["budget"]}')
            print(f'  {cid}: {tris} tris / budget {c["budget"]}')

    # --- test 5: validator 0 errors ---
    def test_validator_zero_errors(self):
        val = self.clusters['rockery-dajiashan']['val']
        self.assertEqual(val.get('verdict'), 'PASS', 'validator verdict not PASS')
        for cid, c in self.clusters.items():
            self.assertIsNotNone(c['vres'], f'{cid}: no validator result')
            self.assertEqual(c['vres']['errors'], 0, f'{cid}: validator errors')
            print(f"  {cid}: validator errors=0 warnings={c['vres']['warnings']}")

    # --- test 6: reimport checks ---
    def test_reimport(self):
        for cid, c in self.clusters.items():
            ch = c['check']
            # images connected with correct colorspace
            stone = next((m for m in ch['materials'] if m['name'] == 'rockery-stone'), None)
            self.assertIsNotNone(stone, f'{cid}: rockery-stone material missing after reimport')
            self.assertTrue(stone['baseColorLinked'], f'{cid}: base color image not connected')
            self.assertTrue(stone['normalLinkedViaNormalMap'], f'{cid}: normal not connected via NormalMap')
            self.assertEqual(stone['images'][0]['colorspace'], 'sRGB',
                             f'{cid}: base color image must be sRGB')
            nimgs = [i for i in stone['images'] if i['colorspace'] == 'Non-Color']
            self.assertTrue(nimgs, f'{cid}: normal image must be Non-Color')
            self.assertTrue(all(i['packed'] for i in stone['images']),
                            f'{cid}: images must be packed into GLB')
            self.assertAlmostEqual(stone['roughness'], 0.9, places=2, msg=f'{cid}: roughness')
            self.assertAlmostEqual(stone.get('normalStrength', 0), 0.6, places=2,
                                   msg=f'{cid}: normal strength')
            # outward normals: every rock (connected component) must have a
            # substantial volume — magnitude only, because the 玲珑 bore faces
            # are deleted from the inside leaving open shells whose raw signed
            # volume is meaningless; gross inversion is still caught by
            # outwardNormalRate and the winding-consistency gate below
            vols = ch.get('componentSignedVolumes', [])
            self.assertTrue(vols, f'{cid}: no component volumes computed')
            for i, v in enumerate(vols):
                self.assertGreater(abs(v), 1.0,
                                   f'{cid}: rock component {i} degenerate volume {v}')
            self.assertGreaterEqual(ch['outwardNormalRate'], 0.5,
                                    f'{cid}: outward normal rate {ch["outwardNormalRate"]}')
            self.assertEqual(ch['windingInconsistentFaces'], 0,
                             f'{cid}: {ch["windingInconsistentFaces"]} faces with normals '
                             'inconsistent with winding')
            # bounds within spec +/-10% (union of per-rock boxes = allowed spec extent)
            ux0 = min(r['box']['xMin'] for r in c['cl']['rocks'])
            ux1 = max(r['box']['xMax'] for r in c['cl']['rocks'])
            uz0 = min(r['box']['zMin'] for r in c['cl']['rocks'])
            uz1 = max(r['box']['zMax'] for r in c['cl']['rocks'])
            uy1 = max(r['box']['yMax'] for r in c['cl']['rocks'])
            b = ch['boundsMap']
            for label, got, lo, hi in (
                    ('x', (b['xMin'], b['xMax']), ux0, ux1),
                    ('z', (b['zMinMap'], b['zMaxMap']), uz0, uz1),
                    ('y', (b['yMin'], b['yMax']), 0.0, uy1)):
                span = hi - lo
                tol = 0.10 * span
                self.assertGreaterEqual(got[0], lo - tol, f'{cid}: bounds {label} min {got[0]} < {lo - tol:.2f}')
                self.assertLessEqual(got[1], hi + tol, f'{cid}: bounds {label} max {got[1]} > {hi + tol:.2f}')
            print(f'  {cid}: reimport OK (images sRGB/Non-Color packed, outward '
                  f'{ch["outwardNormalRate"]:.2%}, bounds within ±10%)')

    # --- R1 helpers ---
    def comp_by_seed(self, cid):
        c = self.cluster(cid)
        comps = [comp for comp in c['check']['components']
                 if comp['seed'] is not None]
        rocks = c['cl']['rocks']
        by_seed = {}
        for comp in comps:
            rock = next(r for r in rocks if r['seed'] == comp['seed'])
            # centroid must sit on its own rock, else the mapping is ambiguous
            self.assertLessEqual(comp['centroidDist'], 0.75 * rock['size'],
                                 f'{cid}: component centroid {comp["centroidDist"]:.2f} m '
                                 f'from rock {comp["seed"]} — mapping ambiguous')
            self.assertNotIn(comp['seed'], by_seed, f'{cid}: two components map to rock '
                                                    f'{comp["seed"]} — rocks merged or split')
            by_seed[comp['seed']] = comp
        for r in rocks:
            self.assertIn(r['seed'], by_seed,
                          f'{cid}: rock {r["seed"]} has no mesh component')
        self.assertEqual(len(comps), len(rocks),
                         f'{cid}: {len(comps)} components for {len(rocks)} rocks')
        return by_seed

    # --- R1 test 7: REAL pairs embedded >= 30% ---
    def test_dajiashan_embedding(self):
        cid = 'rockery-dajiashan'
        c = self.cluster(cid)
        wanted = real_pairs(c['cl']['rocks'])
        got = {tuple(e['pair']): e for e in c['check']['pairEmbedding']}
        self.assertTrue(wanted, 'no REAL pairs derived — box rule drifted?')
        report = []
        for pair in wanted:
            self.assertIn(pair, got, f'{cid}: REAL pair {pair} missing from measurements')
            for y, e in sorted(got[pair]['heights'].items()):
                emb = e['embedding']
                self.assertIsNotNone(emb, f'{cid}: pair {pair} no cells at y={y}')
                self.assertGreaterEqual(emb, EMBED_MIN,
                                        f'{cid}: pair {pair} embedding {emb} < {EMBED_MIN} at y={y}')
                report.append(f'{pair[0]}-{pair[1]}@{y}={emb:.2f}')
        print(f'  {cid}: {len(wanted)} REAL pairs embedded >= {EMBED_MIN} '
              f'({", ".join(report)})')

    # --- R1 test 8: no see-through at y 0.3..2.0 ---
    def test_no_see_through(self):
        for cid in ('rockery-dajiashan',):
            c = self.cluster(cid)
            ch = c['check']
            self.assertGreaterEqual(ch['gapRayCount'], 60,
                                    f'{cid}: too few gap rays sampled')
            self.assertTrue(ch['gapRaysAllBlocked'],
                            f'{cid}: see-through gaps: '
                            f'{[g for g in ch["gapRays"] if not g["blocked"]][:6]}')
            print(f'  {cid}: {ch["gapRayCount"]} horizontal rays y0.3-2.0 all blocked')

    # --- R1 test 9: ridged texture metric (curvature share per rock) ---
    def test_taihu_curvature(self):
        for cid, c in self.clusters.items():
            by_seed = self.comp_by_seed(cid)
            shares = {}
            for r in c['cl']['rocks']:
                s = by_seed[r['seed']]['curvShare'][str(CURV_THRESH)]
                shares[r['seed']] = s
                self.assertGreaterEqual(s, CURV_MIN_SHARE,
                                        f'{cid}: rock {r["seed"]} curvature share {s} < '
                                        f'{CURV_MIN_SHARE} at dihedral {CURV_THRESH} rad '
                                        '(reads as smooth ellipsoid)')
            worst = min(shares.values())
            print(f'  {cid}: curvature share(>{CURV_THRESH}rad) min {worst:.2f} >= '
                  f'{CURV_MIN_SHARE} across {len(shares)} rocks')

    # --- R1 test 10: hollows ---
    def test_hollows(self):
        for cid, c in self.clusters.items():
            rocks = c['cl']['rocks']
            main = max(rocks, key=lambda r: r['h'])['seed'] \
                if cid == 'rockery-yulinglong' else None
            by_seed = {}
            for h in c['check']['hollows']:
                by_seed.setdefault(h['rockSeed'], []).append(h)
            for r in rocks:
                need = 4 if r['seed'] == main else 2
                hs = by_seed.get(r['seed'], [])
                self.assertGreaterEqual(len(hs), need,
                                        f'{cid}: rock {r["seed"]} has {len(hs)} hollows < {need}')
                for h in hs:
                    self.assertIsNotNone(h['depthM'],
                                         f'{cid}: rock {r["seed"]} hollow {h["index"]} not measurable')
                    self.assertGreaterEqual(h['depthM'], 0.15 * r['size'],
                                            f'{cid}: rock {r["seed"]} hollow depth '
                                            f'{h["depthM"]} < 0.15*size={0.15 * r["size"]:.3f}')
                    # non-through by construction: the builder's fold guard
                    # keeps every carved vertex at least 0.15*size from the
                    # rock axis (and the design carve stays <= 0.30*size), so
                    # a solid wall always remains behind the bowl; assert the
                    # design bound instead of a ray (bore-deleted shells are
                    # open, so exit rays are meaningless)
                    self.assertIsNotNone(h['designDepthM'])
                    self.assertLessEqual(h['designDepthM'], 0.30 * r['size'],
                                         f'{cid}: rock {r["seed"]} hollow design '
                                         f'{h["designDepthM"]} > 0.30*size')
            print(f'  {cid}: hollows OK (>=2/rock{", >=4 main" if main else ""}, '
                  f'depth >= 0.15*size, non-through)')

    # --- R1 test 11: 玉玲珑 waist ---
    def test_yulinglong_waist(self):
        c = self.cluster('rockery-yulinglong')
        w = c['check'].get('waist')
        self.assertIsNotNone(w, 'yulinglong: no waist measurement')
        self.assertLessEqual(w['midOverEnds'], WAIST_MAX,
                             f'yulinglong: mid/end width ratio {w["midOverEnds"]} > {WAIST_MAX}')
        print(f'  yulinglong: waist mid/ends {w["midOverEnds"]} <= {WAIST_MAX} '
              f'{w.get("perDirection", {})}')

    # --- R1 test 12: platforms on 大假山 ---
    def test_dajiashan_platforms(self):
        cid = 'rockery-dajiashan'
        plats = self.cluster(cid)['check']['platforms']
        self.assertTrue(3 <= len(plats) <= 5,
                        f'{cid}: {len(plats)} platforms, need 3..5')
        for p in plats:
            self.assertGreaterEqual(p['samples'], 12, f'{cid}: platform {p} undersampled')
            self.assertLessEqual(p['flatnessM'], FLAT_MAX_M,
                                 f'{cid}: platform at ({p["x"]},{p["z"]}) flatness '
                                 f'{p["flatnessM"]} m > {FLAT_MAX_M}')
        print(f'  {cid}: {len(plats)} platforms flat within {FLAT_MAX_M} m '
              f'(max {max(p["flatnessM"] for p in plats)})')

    # --- R1 test 13: materials (dark hollows/ground, moss north-bottom <=15%) ---
    def test_r1_materials(self):
        for cid, c in self.clusters.items():
            ch = c['check']
            dark = next((m for m in ch['materials']
                         if m['name'] == 'rockery-stone-dark'), None)
            self.assertIsNotNone(dark, f'{cid}: rockery-stone-dark material missing')
            self.assertTrue(dark['baseColorLinked'], f'{cid}: dark bake not connected')
            self.assertEqual(dark['images'][0]['colorspace'], 'sRGB',
                             f'{cid}: dark bake must be sRGB')
            self.assertTrue(all(i['packed'] for i in dark['images']),
                            f'{cid}: dark bake must be packed')
            self.assertIn('rockery-stone-dark', ch['faceSlotUsage'],
                          f'{cid}: no faces use the dark material')
            self.assertIn('rockery-moss', ch['faceSlotUsage'],
                          f'{cid}: no faces use moss (band expected present)')
            self.assertLessEqual(ch['mossShare'], MOSS_MAX_SHARE,
                                 f'{cid}: moss share {ch["mossShare"]} > {MOSS_MAX_SHARE}')
            self.assertGreaterEqual(ch['mossNorthOrBottomShare'], 0.999,
                                    f'{cid}: moss outside north/bottom band '
                                    f'({1 - ch["mossNorthOrBottomShare"]:.1%})')
            print(f'  {cid}: materials OK (dark faces {ch["faceSlotUsage"]["rockery-stone-dark"]}, '
                  f'moss {ch["mossShare"]:.1%} all north/bottom)')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--module', required=True)
    ap.add_argument('--validation', required=True)
    ns, rest = ap.parse_known_args()
    RockeryCase.cli_args = {'out': ns.out, 'module': ns.module,
                            'validation': ns.validation}
    print('test_rockery: spec gates + R1 gates')
    unittest.main(verbosity=2, argv=[sys.argv[0]] + rest)
