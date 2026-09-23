#!/usr/bin/env python3
"""test_rockery.py — spec gates for pawborough-w1-rockery (pure python3, no Blender).

Run:  python3 -X utf8 test_rockery.py --out <out-rockery> --module <modules/rockery> \
         --validation <validation.json>

Spec tests (DESIGN_SPEC.json):
  1. all vertices inside expanded placeholder boxes (union of per-rock boxes)
  2. path clearance >= 0.85 m, polylines recomputed from frozen baseline layout
  3. 玉玲珑: 3 rays through the tallest rock pass (no hit, both directions)
  4. tri budget: dajiashan <= 25000, yulinglong <= 6000
  5. Khronos validator: 0 errors
  6. reimport: images connected with correct colorspace, outward normals,
     tri budget, GLB bounds within spec (union boxes) +/- 10%
"""

import argparse
import json
import math
import os
import sys
import unittest

PATH_MIN_M = 0.85


def seg_dist(px, pz, ax, az, bx, bz):
    abx, abz = bx - ax, bz - az
    ab2 = abx * abx + abz * abz
    if ab2 == 0:
        return math.hypot(px - ax, pz - az)
    t = max(0.0, min(1.0, ((px - ax) * abx + (pz - az) * abz) / ab2))
    return math.hypot(px - (ax + t * abx), pz - (az + t * abz))


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
            # outward normals: every rock (connected component) must have positive
            # signed volume — catches inverted normals regardless of winding state;
            # centroid-projection rate kept as a loose sanity signal
            vols = ch.get('componentSignedVolumes', [])
            self.assertTrue(vols, f'{cid}: no component volumes computed')
            for i, v in enumerate(vols):
                self.assertGreater(v, 0, f'{cid}: rock component {i} signed volume {v} <= 0 '
                                         '(inverted normals)')
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


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--module', required=True)
    ap.add_argument('--validation', required=True)
    ns, rest = ap.parse_known_args()
    RockeryCase.cli_args = {'out': ns.out, 'module': ns.module,
                            'validation': ns.validation}
    print('test_rockery: spec gates')
    unittest.main(verbosity=2, argv=[sys.argv[0]] + rest)
