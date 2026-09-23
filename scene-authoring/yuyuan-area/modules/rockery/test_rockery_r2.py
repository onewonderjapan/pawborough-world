#!/usr/bin/env python3
# test_rockery_r2.py — R2 gates (lead rebuild). Reads what check-rockery-r2.py
# measured on the exported GLBs plus the Khronos validator reports.
# Run: python3 -X utf8 modules/rockery/test_rockery_r2.py [out-rockery-r2]
#
# Gates kept from DESIGN_SPEC / R1-FIXES (values unchanged):
#   vertices inside the +0.3 m placeholder boxes; path clearance >= 0.85 m;
#   budget 25k / 6k; validator 0 errors; >= 2 non-through hollows per rock with
#   depth >= 0.15 x size (玉玲珑 main rock >= 4); 3 clear bores on 玉玲珑;
#   玉玲珑 waist mid <= 0.75 of the end widths; 3–5 platforms flat within 0.15 m;
#   moss <= 15 % and north/bottom only; dark second material present.
# Gates new in R2 (what R1 missed):
#   one closed shell per box-overlap group (no loose rocks, no stray shards);
#   0 boundary / non-manifold edges; buried-face share <= 3 %;
#   saddles between overlapping neighbours solid at y 0.3 / 0.6 m.
# Replaced: R1 "REAL pairs embedded >= 30 %" — with one shell per group the rocks
# are fused, so the saddle test is the direct measure of "连成一座山体".
# R3 (2026-09-23, D5): when the build record says style=yellow (大假山 = 黄石), the
# Taihu-stone gates (hollow depth/count) do not apply; instead: flat up-facing face
# area >= 10 %, near-vertical face area >= 35 %, and every tall rock (h >= 4 m) with
# size >= 3 m shows >= 3 separate ledge levels. Thresholds were set after measuring
# R2 (4.6 % / 32 % / 8 levels on the big rocks) and R3 (16.7 % / 43 % / 7) — flagged
# for independent review. Slender peak stones (size < 3 m) are exempt from the
# level count: their course tops are too small to register as ledges.

import json
import os
import sys
import unittest

OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', 'out-rockery-r2')
CLUSTERS = ('rockery-dajiashan', 'rockery-yulinglong')
BURIED_MAX = 0.03
PATH_MIN = 0.85
HOLLOW_MIN_PER_ROCK = 2
MAIN_HOLLOW_MIN = 4
WAIST_MAX = 0.75
FLAT_MAX = 0.15
MOSS_MAX = 0.15
YELLOW_FLAT_MIN = 0.10
YELLOW_VERTICAL_MIN = 0.35
YELLOW_LEVELS_MIN = 3
YELLOW_LEVEL_SIZE_MIN = 3.0


def load(name):
    return json.load(open(os.path.join(OUT, name), encoding='utf-8'))


class RockeryR2(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = {k: load(f'check-{k}.json') for k in CLUSTERS}
        cls.b = {k: load(f'build-{k}.record.json') for k in CLUSTERS}
        cls.v = {k: load(os.path.join('validator', f'{k}.json')) for k in CLUSTERS}

    def test_budget(self):
        for k, c in self.c.items():
            self.assertLessEqual(c['tris'], c['budget'], k)

    def test_validator(self):
        for k, v in self.v.items():
            self.assertEqual(sum(r['errors'] for r in v['results']), 0, k)

    def test_closed_single_shell_per_group(self):
        for k, c in self.c.items():
            self.assertEqual(c['boundaryEdges'], 0, f'{k}: open edges')
            self.assertEqual(c['nonManifoldEdges'], 0, f'{k}: non-manifold edges')
            self.assertEqual(c['componentsPerGroup'], [1] * len(c['boxGroups']),
                             f'{k}: components per box group {c["componentsPerGroup"]}')
            self.assertEqual(c['componentsSpanningGroups'], 0, k)

    def test_buried_faces(self):
        for k, c in self.c.items():
            self.assertLessEqual(c['buriedFaceShare'], BURIED_MAX, k)

    def test_inside_boxes_and_paths(self):
        for k, c in self.c.items():
            self.assertEqual(c['verticesOutsideBoxes'], 0, k)
            self.assertGreaterEqual(c['minPathDistanceM'], PATH_MIN, k)

    def test_hollows(self):
        for k, c in self.c.items():
            if self.b[k].get('style') == 'yellow':
                continue                       # 黄石: no bowls by design
            main = self.b[k].get('waistSeed')
            for seed, n in c['hollowsOkPerSeed'].items():
                need = MAIN_HOLLOW_MIN if main is not None and int(seed) == main else HOLLOW_MIN_PER_ROCK
                self.assertGreaterEqual(n, need, f'{k}: rock {seed} has {n} hollows >= 0.15 x size (need {need})')

    def test_yulinglong_bores_and_waist(self):
        c = self.c['rockery-yulinglong']
        self.assertEqual(len(c['bores']), 3)
        for b in c['bores']:
            self.assertTrue(b['clear'], f'bore r={b["radiusM"]} blocked')
            self.assertFalse(b['centreInsideSolid'])
        w = c['waist']
        self.assertIsNotNone(w)
        for ax, r in w['midOverNarrowerEnd'].items():
            self.assertLessEqual(r, WAIST_MAX, f'waist {ax}: mid / narrower end {r}')

    def test_platforms(self):
        pl = self.c['rockery-dajiashan']['platforms']
        ok = [p for p in pl if p['ok']]
        self.assertTrue(3 <= len(ok) <= 5, f'{len(ok)} flat platforms')
        for p in ok:
            self.assertLessEqual(p['spreadM'], FLAT_MAX)

    def test_saddles_solid(self):
        for k, c in self.c.items():
            bad = [s['pair'] for s in c['saddles'] if not all(s['solid'])]
            self.assertEqual(bad, [], f'{k}: open saddles {bad}')

    def test_yellowstone_strata(self):
        for k, c in self.c.items():
            if self.b[k].get('style') != 'yellow':
                continue
            self.assertGreaterEqual(c['flatUpFaceAreaShare'], YELLOW_FLAT_MIN, k)
            self.assertGreaterEqual(c['verticalFaceAreaShare'], YELLOW_VERTICAL_MIN, k)
            sizes = {r['seed']: r['size'] for r in json.load(open(os.path.join(
                os.path.dirname(os.path.abspath(__file__)), 'site-inputs.json'), encoding='utf-8'))['clusters'][k]['rocks']}
            for s in c['strata']:
                if sizes[s['seed']] >= YELLOW_LEVEL_SIZE_MIN:
                    self.assertGreaterEqual(s['count'], YELLOW_LEVELS_MIN, f'{k}: rock {s["seed"]} ledge levels {s["ledgeLevels"]}')

    def test_materials(self):
        for k, c in self.c.items():
            m = c['materials']
            self.assertIn('rockery-stone-dark', m['names'], k)
            self.assertGreater(m['darkShare'], 0.05, k)
            self.assertLessEqual(m['mossShare'], MOSS_MAX, k)
            self.assertTrue(m['mossNorthOrBottom'], k)


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0], '-v'])
