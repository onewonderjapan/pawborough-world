#!/usr/bin/env python3
# build-rockery-r2.py — R2 (lead rebuild): one SDF shell per box-overlap group.
# Run: blender -b -t 4 -P build-rockery-r2.py -- --cluster <id> --module <modules/rockery> --out <out-rockery-r2>
#
# Why R2 replaces the R1 builder: R1 inserted 16 separately displaced meshes into
# each other to reach "embedding >= 30%"; 27–36% of the faces ended up buried in
# neighbours, the intersection seams read as torn shards and 玉玲珑 kept 318 open
# boundary edges. R2 evaluates the whole rockery as one signed distance field:
#   rocks (stacked ellipsoid lumps) --smooth-min--> mass
#   + ridged vertical-fold noise (瘦/皱)
#   ∩ placeholder box union (soft)        -> every vertex stays in its box
#   − hollows (non-through bowls), − 玉玲珑 bores (through-holes, 漏/透)
#   ∩ platform caps (flat ledges on 大假山)
# then extracts the zero level set with surface nets (numpy), voxel-remeshes it
# watertight, decimates to budget and assigns stone / dark / moss faces.
# Coordinates: field axes (X, Y, Z) = map (x east, y up, z south); Blender = (x, -z, y);
# GLB export_yup gives back map coordinates (same convention as R0/R1).

import argparse
import json
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

MOSS_MAX_SHARE = 0.15
MOSS_NORTH_NY = 0.25          # Blender +y = map north
DARK_FACTOR = 0.82            # hollow interiors + ground band 18% darker
BOX_SHRINK = 0.08             # field is clipped this far inside each box (decimate slack)

PARAMS = {
    'rockery-dajiashan': dict(voxel=0.11, smooth_k=0.9, lump_k=0.55, radius_k=0.47,
                              fold_amp=0.55, fold_freq=0.62, fold_ysquash=0.22,
                              crag_amp=0.18, crag_freq=1.5, fine_amp=0.05, fine_freq=4.0,
                              hollow_r=(0.12, 0.17), hollow_e=0.34, hollow_ry=1.35, hollow_rd=1.6,
                              hollow_wobble=0.28, massif=0.95, hill_k=0.42, edge_taper=1.6),
    'rockery-yulinglong': dict(voxel=0.055, smooth_k=0.45, lump_k=0.35, radius_k=0.46,
                               fold_amp=0.30, fold_freq=1.4, fold_ysquash=0.2,
                               crag_amp=0.11, crag_freq=2.6, fine_amp=0.03, fine_freq=6.5,
                               hollow_r=(0.11, 0.16), hollow_e=0.34, hollow_ry=1.4, hollow_rd=1.6,
                               hollow_wobble=0.3, massif=0.0, hill_k=0.22, edge_taper=1.0),
}


# ---------------------------------------------------------------- noise ----
class Perlin:
    """Vectorised 3D gradient noise, output roughly in [-1, 1]."""
    GRAD = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
                     [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
                     [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]], dtype=np.float64)

    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        p = rng.permutation(256)
        self.perm = np.concatenate([p, p]).astype(np.int64)

    def __call__(self, P):
        Pf = np.floor(P)
        Xi = Pf.astype(np.int64) & 255
        f = P - Pf
        u = f * f * f * (f * (f * 6 - 15) + 10)
        perm = self.perm
        X, Y, Z = Xi[:, 0], Xi[:, 1], Xi[:, 2]
        out = 0.0
        acc = []
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    h = perm[perm[perm[X + dx] + Y + dy] + Z + dz] % 12
                    g = self.GRAD[h]
                    d = f - np.array([dx, dy, dz], dtype=np.float64)
                    acc.append(((dx, dy, dz), np.einsum('ij,ij->i', g, d)))
        # trilinear blend of the 8 corner dots
        def lerp(a, b, t):
            return a + t * (b - a)
        v = {k: val for k, val in acc}
        x00 = lerp(v[(0, 0, 0)], v[(1, 0, 0)], u[:, 0])
        x10 = lerp(v[(0, 1, 0)], v[(1, 1, 0)], u[:, 0])
        x01 = lerp(v[(0, 0, 1)], v[(1, 0, 1)], u[:, 0])
        x11 = lerp(v[(0, 1, 1)], v[(1, 1, 1)], u[:, 0])
        y0 = lerp(x00, x10, u[:, 1])
        y1 = lerp(x01, x11, u[:, 1])
        out = lerp(y0, y1, u[:, 2])
        return out * 1.4


# ------------------------------------------------------------ sdf prims ----
def sd_ellipsoid(P, c, r):
    q = (P - c) / r
    k0 = np.linalg.norm(q, axis=1)
    k1 = np.linalg.norm((P - c) / (r * r), axis=1)
    return np.where(k1 > 1e-9, k0 * (k0 - 1.0) / np.maximum(k1, 1e-9), -r.min())


def sd_box(P, lo, hi):
    c = (lo + hi) * 0.5
    h = (hi - lo) * 0.5
    q = np.abs(P - c) - h
    return np.linalg.norm(np.maximum(q, 0.0), axis=1) + np.minimum(q.max(axis=1), 0.0)


def sd_capsule(P, a, b, r):
    pa = P - a
    ba = b - a
    t = np.clip(pa @ ba / (ba @ ba), 0.0, 1.0)
    return np.linalg.norm(pa - t[:, None] * ba, axis=1) - r


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


# ------------------------------------------------------------ the field ----
class RockeryField:
    def __init__(self, cluster, rocks, prm):
        self.cluster = cluster
        self.rocks = rocks
        self.prm = prm
        self.noise_fold = Perlin(7001 + len(rocks))
        self.noise_crag = Perlin(9103 + len(rocks))
        self.noise_fine = Perlin(5209 + len(rocks))
        self.lumps = []           # per rock: list of (centre, radii)
        self.waist_seed = None
        self.hollows = []         # filled by place_hollows()
        self.bores = []           # through-holes (玉玲珑)
        self.platforms = []       # filled by place_platforms()
        self.boxes = []
        for r in rocks:
            b = r['box']
            self.boxes.append((np.array([b['xMin'], b['yMin'], b['zMin']]) + BOX_SHRINK,
                               np.array([b['xMax'], b['yMax'], b['zMax']]) - BOX_SHRINK))
        if cluster == 'rockery-yulinglong':
            self.waist_seed = max(rocks, key=lambda r: r['h'])['seed']
        self._make_lumps()
        self.ridge_pairs = []
        if prm.get('hill_k', 0) > 0:
            for i, a in enumerate(rocks):
                for b in rocks[i + 1:]:
                    A, B = a['box'], b['box']
                    ox = min(A['xMax'], B['xMax']) - max(A['xMin'], B['xMin'])
                    oz = min(A['zMax'], B['zMax']) - max(A['zMin'], B['zMin'])
                    if ox > 0.3 and oz > 0.3:
                        self.ridge_pairs.append((a, b))

    # stacked ellipsoid lumps: a tall rock gets 3 offset lumps (瘦, leaning),
    # a squat rock 2 wide ones; offsets are seeded so rebuilds are identical
    def _make_lumps(self):
        rk = self.prm['radius_k']
        for r in self.rocks:
            rng = np.random.default_rng(r['seed'] * 7919 + len(self.rocks))
            size, h = r['size'], r['h']
            c0 = np.array([r['x'], 0.0, r['z']])
            tall = h / size > 1.25
            lumps = []
            if tall:
                n = 3
                for i in range(n):
                    t = (i + 0.5) / n
                    off = rng.uniform(-0.16, 0.16, 2) * size
                    rx = rk * size * rng.uniform(0.78, 1.0) * (1.0 - 0.18 * t)
                    rz = rk * size * rng.uniform(0.70, 0.92) * (1.0 - 0.18 * t)
                    ry = h / n * 0.78
                    cy = h * t
                    lumps.append((c0 + np.array([off[0], cy, off[1]]), np.array([rx, ry, rz])))
                # top lump reaches h
                c, rr = lumps[-1]
                c[1] = h - rr[1]
            else:
                off = rng.uniform(-0.08, 0.08, 2) * size
                lumps.append((c0 + np.array([0.0, h * 0.42, 0.0]),
                              np.array([rk * size, h * 0.55, rk * size * 0.86])))
                lumps.append((c0 + np.array([off[0], h * 0.68, off[1]]),
                              np.array([rk * size * 0.72, h * 0.34, rk * size * 0.64])))
                c, rr = lumps[-1]
                c[1] = h - rr[1]
            self.lumps.append(lumps)

    def base(self, P):
        """Smooth union of rocks + folds + crags, clipped to the box union."""
        k_l, k_r = self.prm['lump_k'], self.prm['smooth_k']
        d = None
        for r, lumps in zip(self.rocks, self.lumps):
            Q = P
            if r['seed'] == self.waist_seed:
                # 玉玲珑 main rock: pinch the middle, flare the top (瘦)
                t = (P[:, 1] / r['h'])
                s = 1.0 - 0.42 * np.exp(-((t - 0.48) / 0.17) ** 2) + 0.10 * np.clip((t - 0.7) / 0.3, 0, 1)
                Q = P.copy()
                Q[:, 0] = r['x'] + (P[:, 0] - r['x']) / s
                Q[:, 2] = r['z'] + (P[:, 2] - r['z']) / s
            dr = None
            for c, rr in lumps:
                e = sd_ellipsoid(Q, c, rr)
                dr = e if dr is None else smin(dr, e, k_l * r['size'] * 0.35 + 0.1)
            if r['seed'] == self.waist_seed:
                dr = dr * 0.8   # the pinch stretches the field; keep it conservative
            d = dr if d is None else smin(d, dr, k_r)
        prm = self.prm
        # 山体基座 (大假山): a heightfield massif over the box union of each
        # overlap group — low plateau + a hill under every rock, tapering to the
        # ground near the box edges — so the peaks grow out of one mountain body
        if prm['massif'] > 0 or prm['hill_k'] > 0:
            db2 = None
            for lo, hi in self.boxes:
                q = np.abs(P[:, [0, 2]] - (lo[[0, 2]] + hi[[0, 2]]) * 0.5) - (hi[[0, 2]] - lo[[0, 2]]) * 0.5
                e = np.linalg.norm(np.maximum(q, 0.0), axis=1) + np.minimum(q.max(axis=1), 0.0)
                db2 = e if db2 is None else np.minimum(db2, e)
            taper = np.clip(-db2 / prm['edge_taper'], 0.0, 1.0)
            taper = taper * taper * (3 - 2 * taper)
            t2 = np.clip((-db2 + 0.25) / 0.9, 0.0, 1.0)
            t2 = t2 * t2 * (3 - 2 * t2)             # narrow taper for hills/ridges (corridors are thin)
            H = np.zeros(len(P))
            for r in self.rocks:
                rr = np.hypot(P[:, 0] - r['x'], P[:, 2] - r['z']) / (0.95 * r['size'])
                hill = prm['hill_k'] * r['h'] * np.clip(1.0 - rr * rr, 0.0, 1.0) ** 1.5
                H = np.maximum(H, hill)
            # ridges between overlapping neighbours: peaks joined by saddles
            for a, b in self.ridge_pairs:
                A = np.array([a['x'], a['z']]); B = np.array([b['x'], b['z']])
                AB = B - A
                t = np.clip(((P[:, [0, 2]] - A) @ AB) / (AB @ AB), 0.0, 1.0)
                w = np.linalg.norm(P[:, [0, 2]] - (A + t[:, None] * AB), axis=1)
                W = 0.42 * min(a['size'], b['size'])
                hr = 0.45 * min(a['h'], b['h']) * (0.85 + 0.15 * np.cos(math.pi * (2 * t - 1)))
                H = np.maximum(H, hr * np.clip(1.0 - (w / W) ** 2, 0.0, 1.0) ** 1.5)
            nz = 0.35 * self.noise_crag(P[:, [0, 2, 1]] * np.array([0.5, 0.5, 0.0]) + 3.3)
            H = np.maximum(H * t2, prm['massif'] * taper) + nz * t2 \
                - 0.6 * (1.0 - t2)          # sink below ground at box edges (no slab skirts)
            dm = (P[:, 1] - H) * 0.55
            d = smin(d, dm, 0.6)
        # vertical folds: ridged noise sampled with y squashed (low freq in y)
        F = P * np.array([prm['fold_freq'], prm['fold_freq'] * prm['fold_ysquash'], prm['fold_freq']])
        ridged = 1.0 - np.abs(self.noise_fold(F))
        d = d - prm['fold_amp'] * (ridged ** 3 - 0.3)
        C = P * prm['crag_freq']
        d = d - prm['crag_amp'] * (1.0 - np.abs(self.noise_crag(C)) - 0.5)
        d = d + prm['fine_amp'] * self.noise_fine(P * prm['fine_freq'])
        # soft clip to the placeholder box union and cut flat just below ground
        db = None
        for lo, hi in self.boxes:
            e = sd_box(P, lo, hi)
            db = e if db is None else np.minimum(db, e)
        d = smax(d, db, 0.12)
        d = np.maximum(d, -(P[:, 1] + 0.26))
        return d

    def full(self, P):
        d = self.base(P)
        for pl in self.platforms:
            rr = np.hypot(P[:, 0] - pl['x'], P[:, 2] - pl['z'])
            cap = np.where(rr < pl['r'], P[:, 1] - pl['y'], -1e3)
            d = np.maximum(d, cap)
        wob = self.prm.get('hollow_wobble', 0.0)
        for hl in self.hollows:
            c = np.array(hl['c']); rr = np.array(hl['radii'])
            near = np.linalg.norm(P - c, axis=1) < max(rr.max(), hl['rd']) * 1.8   # only perturb near the bowl
            if not near.any():
                continue
            d_ = np.array(hl['dir']); up_ = np.array([0.0, 1.0, 0.0])
            sd_ = np.cross(d_, up_); sd_ /= np.linalg.norm(sd_)
            Q = P[near] - c
            L = np.stack([Q @ d_, Q @ sd_, Q @ up_], axis=1)
            e = sd_ellipsoid(L, np.zeros(3), np.array([hl['rd'], rr[0], rr[1]]))
            e = e + wob * rr.min() * self.noise_crag(P[near] * (2.2 / rr.min()) + hl['seed'])
            dn = d[near]
            d[near] = smax(dn, -e, 0.06)
        for bo in self.bores:
            e = sd_capsule(P, np.array(bo['a']), np.array(bo['b']), bo['r'])
            d = smax(d, -e, 0.05)
        return d

    # ---- feature placement (all from the base field, before carving) ----
    def surface_along(self, origin, direction, tmax, step=0.02):
        ts = np.arange(0.0, tmax, step)
        P = origin[None, :] + ts[:, None] * direction[None, :]
        v = self.base(P)
        inside = v < 0
        if not inside[0]:
            return None
        idx = np.argmax(~inside)
        if idx == 0:
            return None
        return float(ts[idx - 1] + step * v[idx - 1] / (v[idx - 1] - v[idx]))

    def place_platforms(self, seeds):
        for seed in seeds:
            r = next(rr for rr in self.rocks if rr['seed'] == seed)
            rad = min(1.0, 0.26 * r['size'])
            tops = []
            for a in np.linspace(0, 2 * math.pi, 12, endpoint=False):
                for rr_ in (0.0, 0.5 * rad, rad):
                    x = r['x'] + rr_ * math.cos(a)
                    z = r['z'] + rr_ * math.sin(a)
                    ys = np.arange(r['h'] + 0.6, -0.3, -0.02)
                    P = np.stack([np.full_like(ys, x), ys, np.full_like(ys, z)], axis=1)
                    v = self.base(P)
                    hit = np.argmax(v < 0)
                    tops.append(ys[hit] if v[hit] < 0 else -1.0)
            y = min(tops) - 0.04
            if y < 0.6 * r['h']:
                print('PLATFORM_SKIP', seed, round(y, 2))
                continue
            self.platforms.append({'seed': seed, 'x': r['x'], 'z': r['z'], 'r': rad, 'y': round(float(y), 3)})

    def place_hollows(self, per_rock, main_extra=0):
        """Non-through bowls on the outward side of each rock (away from the
        group centroid and from neighbours), at 0.3–0.75 h."""
        cx = np.mean([r['x'] for r in self.rocks])
        cz = np.mean([r['z'] for r in self.rocks])
        prm = self.prm
        for r in self.rocks:
            rng = np.random.default_rng(r['seed'] * 131 + 17)
            size, h = r['size'], r['h']
            away = np.array([r['x'] - cx, r['z'] - cz])
            for o in self.rocks:
                if o is r:
                    continue
                dv = np.array([r['x'] - o['x'], r['z'] - o['z']])
                dist = np.linalg.norm(dv)
                if 0 < dist < (r['size'] + o['size']) * 0.75:
                    away += dv / dist * 2.0
            base_az = math.atan2(away[1], away[0]) if np.linalg.norm(away) > 1e-6 else rng.uniform(0, 2 * math.pi)
            n = per_rock + (main_extra if r['seed'] == self.waist_seed else 0)
            placed = []
            tries = 0
            while len(placed) < n and tries < 400:
                tries += 1
                az = base_az + rng.uniform(-1.3, 1.3)
                yt = rng.uniform(0.15, 0.88) if r['seed'] == self.waist_seed else rng.uniform(0.3, 0.72)
                if any(abs(math.remainder(az - a2, 2 * math.pi)) < 0.75 and abs(yt - y2) < 0.25
                       for a2, y2 in placed):
                    continue
                if r['seed'] == self.waist_seed and any(
                        abs(yt * h - bo['y']) < 0.45 and
                        min(abs(math.remainder(az - math.atan2(bo['dir'][2], bo['dir'][0]), math.pi)), 9) < 0.6
                        for bo in self.bores):
                    continue
                y = yt * h
                if any(math.hypot(r['x'] - pl['x'], r['z'] - pl['z']) < pl['r'] + 0.4 and y > pl['y'] - 1.0
                       for pl in self.platforms):
                    continue
                d = np.array([math.cos(az), 0.0, math.sin(az)])
                o = np.array([r['x'], y, r['z']])
                t = self.surface_along(o, d, 1.2 * size + 1.0)
                if t is None or t < (0.2 if r['seed'] == self.waist_seed else 0.3) * size:
                    continue
                s = o + d * t
                # outer surface must face open air for 0.6 m (not a neighbour's flank)
                probe = s + d * np.linspace(0.08, 0.6, 8)[:, None]
                if (self.base(probe) < 0).any():
                    continue
                rr = rng.uniform(*prm['hollow_r']) * size
                rd = prm['hollow_rd'] * rr          # semi-axis along the opening direction
                e = prm['hollow_e'] * rd            # centre sits this far behind the surface
                c = s - d * e
                radii = [rr, rr * prm['hollow_ry'], rr]
                # keep the bowl non-through: remaining wall behind the bottom
                bottom = s - d * (e + rd)
                wall = self.surface_along(bottom, -d, 3 * size)  # distance to the back face
                if wall is not None and wall < 0.18 * size:
                    continue
                placed.append((az, yt))
                self.hollows.append({'seed': r['seed'], 'c': c.tolist(), 'radii': radii, 'rd': rd,
                                     'dir': d.tolist(), 'surface': s.tolist(),
                                     'designDepthM': round(e + rd, 3), 'size': size})
            if len(placed) < n:
                print('HOLLOW_SHORT', r['seed'], len(placed), 'of', n)

    def place_bores(self):
        """玉玲珑: 3 through-holes along directions free of neighbours, plus the
        mouths stay inside the main rock's box."""
        r = next(rr for rr in self.rocks if rr['seed'] == self.waist_seed)
        size, h = r['size'], r['h']
        specs = [(0.30, 0.22, math.radians(90 + 12)),   # (radius, height frac, azimuth)
                 (0.26, 0.47, math.radians(90 - 20)),
                 (0.28, 0.72, math.radians(90 + 32))]
        for rad, yf, az in specs:
            d = np.array([math.cos(az), 0.08, math.sin(az)])
            d /= np.linalg.norm(d)
            c = np.array([r['x'], yf * h, r['z']])
            half = 0.9 * size
            self.bores.append({'a': (c - d * half).tolist(), 'b': (c + d * half).tolist(),
                               'r': rad, 'y': yf * h, 'dir': d.tolist(), 'centre': c.tolist()})


# ---------------------------------------------------------- surface nets ----
def surface_nets(F, origin, h):
    nx, ny, nz = F.shape
    inside = F < 0
    corners = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    cv = {c: F[c[0]:nx - 1 + c[0], c[1]:ny - 1 + c[1], c[2]:nz - 1 + c[2]] for c in corners}
    edges = []
    for a in corners:
        for b in corners:
            if a < b and sum(abs(a[t] - b[t]) for t in range(3)) == 1:
                edges.append((a, b))
    acc = np.zeros(cv[(0, 0, 0)].shape + (3,), dtype=np.float32)
    cnt = np.zeros(cv[(0, 0, 0)].shape, dtype=np.int16)
    for a, b in edges:
        va, vb = cv[a], cv[b]
        m = (va < 0) != (vb < 0)
        t = np.where(m, va / np.where(m, va - vb, 1.0), 0.0)
        for ax in range(3):
            acc[..., ax] += np.where(m, a[ax] + t * (b[ax] - a[ax]), 0.0)
        cnt += m
    active = cnt > 0
    vid = -np.ones(active.shape, dtype=np.int64)
    idx = np.argwhere(active)
    vid[active] = np.arange(len(idx))
    local = acc[active] / cnt[active][:, None]
    verts = origin[None, :] + (idx + local) * h
    faces = []
    # axis 0 (x-edges): cells (i, j-1..j, k-1..k)
    s0 = inside[:-1, 1:-1, 1:-1]; s1 = inside[1:, 1:-1, 1:-1]
    m = s0 != s1
    I, J, K = np.nonzero(m)
    J += 1; K += 1
    q = np.stack([vid[I, J - 1, K - 1], vid[I, J, K - 1], vid[I, J, K], vid[I, J - 1, K]], axis=1)
    flip = ~s0[m]
    q[flip] = q[flip][:, ::-1]
    faces.append(q)
    # axis 1 (y-edges): b=z, c=x
    s0 = inside[1:-1, :-1, 1:-1]; s1 = inside[1:-1, 1:, 1:-1]
    m = s0 != s1
    I, J, K = np.nonzero(m)
    I += 1; K += 1
    q = np.stack([vid[I - 1, J, K - 1], vid[I - 1, J, K], vid[I, J, K], vid[I, J, K - 1]], axis=1)
    flip = ~s0[m]
    q[flip] = q[flip][:, ::-1]
    faces.append(q)
    # axis 2 (z-edges): b=x, c=y
    s0 = inside[1:-1, 1:-1, :-1]; s1 = inside[1:-1, 1:-1, 1:]
    m = s0 != s1
    I, J, K = np.nonzero(m)
    I += 1; J += 1
    q = np.stack([vid[I - 1, J - 1, K], vid[I, J - 1, K], vid[I, J, K], vid[I - 1, J, K]], axis=1)
    flip = ~s0[m]
    q[flip] = q[flip][:, ::-1]
    faces.append(q)
    return verts, np.concatenate(faces)


def evaluate_grid(field, lo, hi, h):
    xs = np.arange(lo[0], hi[0] + h, h)
    ys = np.arange(lo[1], hi[1] + h, h)
    zs = np.arange(lo[2], hi[2] + h, h)
    F = np.empty((len(xs), len(ys), len(zs)), dtype=np.float32)
    YY, ZZ = np.meshgrid(ys, zs, indexing='ij')
    for i, x in enumerate(xs):          # slab by slab keeps memory flat
        P = np.stack([np.full(YY.size, x), YY.ravel(), ZZ.ravel()], axis=1)
        F[i] = field.full(P).reshape(YY.shape)
    F[0, :, :] = F[-1, :, :] = 1.0
    F[:, 0, :] = F[:, -1, :] = 1.0
    F[:, :, 0] = F[:, :, -1] = 1.0
    return F, np.array([xs[0], ys[0], zs[0]])


# ------------------------------------------------------------- materials ----
def hex_to_linear_rgb(hexstr):
    h = hexstr.lstrip('#')
    def s2l(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(s2l(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def hex_scale(hexstr, k):
    h = hexstr.lstrip('#')
    return ''.join(f'{max(0, min(255, round(int(h[i:i + 2], 16) * k))):02x}' for i in (0, 2, 4))


def tinted_texture(src, tint_hex, dst):
    import shutil
    import subprocess
    if not os.path.exists(dst):
        subprocess.run([shutil.which('python3'), os.path.join(HERE, 'tint-texture.py'),
                        '--src', src, '--tint', tint_hex, '--dst', dst], check=True)
    return dst


def build_materials(site, out):
    st = site['material']['stone']
    tint = st['tintSrgbHex']
    os.makedirs(os.path.join(out, 'textures'), exist_ok=True)
    col = tinted_texture(st['textures']['color'], tint, os.path.join(out, 'textures', f'plaster-tint-{tint}.jpg'))
    dk = hex_scale(tint, DARK_FACTOR)
    cold = tinted_texture(st['textures']['color'], dk, os.path.join(out, 'textures', f'plaster-tint-{dk}.jpg'))

    def stone(name, color_path):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes['Principled BSDF']
        bsdf.inputs['Roughness'].default_value = st['roughness']
        c = nt.nodes.new('ShaderNodeTexImage')
        c.image = bpy.data.images.load(color_path)
        c.image.colorspace_settings.name = 'sRGB'
        nt.links.new(c.outputs['Color'], bsdf.inputs['Base Color'])
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(st['textures']['normal'], check_existing=True)
        n.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = st['normalStrength']
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        return mat
    m0 = stone('rockery-stone', col)
    m1 = stone('rockery-stone-dark', cold)
    m2 = bpy.data.materials.new('rockery-moss')
    m2.use_nodes = True
    b = m2.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*hex_to_linear_rgb(site['material']['mossOptional']['tintSrgbHex']), 1.0)
    b.inputs['Roughness'].default_value = 0.95
    return [m0, m1, m2]


def assign_faces(obj, field):
    me = obj.data
    hol = [(Vector((hl['c'][0], -hl['c'][2], hl['c'][1])),
            [max(hl['radii'][0], hl['rd'])] * 3) for hl in field.hollows]
    bores = [(Vector((b['a'][0], -b['a'][2], b['a'][1])), Vector((b['b'][0], -b['b'][2], b['b'][1])), b['r'])
             for b in field.bores]

    def in_hollow(c):
        for cc, (rx, ry, rz) in hol:
            d = c - cc
            if (d.x / (rx * 1.15)) ** 2 + (d.y / (rz * 1.15)) ** 2 + (d.z / (ry * 1.15)) ** 2 < 1.0:
                return True
        for a, b, r in bores:
            ab = b - a
            t = max(0.0, min(1.0, (c - a).dot(ab) / ab.length_squared))
            if (a + ab * t - c).length < r * 1.35:
                return True
        return False
    band = []
    dark = set()
    for p in me.polygons:
        c = p.center
        if in_hollow(c):
            dark.add(p.index)
        elif c.z < 0.3:
            band.append((p.index, p.normal.y))
            dark.add(p.index)
    band.sort(key=lambda e: -e[1])
    cap = int(len(me.polygons) * MOSS_MAX_SHARE * 0.9)
    moss = set(i for i, ny in band[:cap] if ny > MOSS_NORTH_NY)
    for p in me.polygons:
        p.material_index = 2 if p.index in moss else (1 if p.index in dark else 0)
    n = len(me.polygons)
    cnt = [0, 0, 0]
    for p in me.polygons:
        cnt[p.material_index] += 1
    return {'faces': {'stone': cnt[0], 'dark': cnt[1], 'moss': cnt[2], 'total': n},
            'mossShare': round(cnt[2] / n, 4), 'darkShare': round(cnt[1] / n, 4)}


def cube_uv(obj, tile):
    me = obj.data
    uvl = me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        n = p.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax >= ay and ax >= az:
                uv = (co.y / tile, co.z / tile)
            elif ay >= az:
                uv = (co.x / tile, co.z / tile)
            else:
                uv = (co.x / tile, co.y / tile)
            uvl.data[li].uv = uv


def mesh_stats(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    nm = sum(1 for e in bm.edges if not e.is_manifold)
    bnd = sum(1 for e in bm.edges if e.is_boundary)
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    bm.free()
    return {'tris': tris, 'nonManifoldEdges': nm, 'boundaryEdges': bnd}


# ------------------------------------------------------------------ main ----
def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--cluster', required=True, choices=list(PARAMS))
    ap.add_argument('--module', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args(argv)
    site = json.load(open(os.path.join(args.module, 'site-inputs.json'), encoding='utf-8'))
    cl = site['clusters'][args.cluster]
    rocks = cl['rocks']
    budget = site['budget'][args.cluster.replace('rockery-', '')]
    prm = PARAMS[args.cluster]
    os.makedirs(args.out, exist_ok=True)

    field = RockeryField(args.cluster, rocks, prm)
    if args.cluster == 'rockery-dajiashan':
        # 4 ledges: the 104/114 saddle, 115, 118 shoulders, 116 top (tree slots)
        field.place_platforms([104, 115, 118, 116, 109])
        field.platforms = field.platforms[:5]
        field.place_hollows(per_rock=4)
    else:
        field.place_bores()
        field.place_hollows(per_rock=4, main_extra=3)

    lo = np.array([min(b[0][0] for b in field.boxes), -0.4, min(b[0][2] for b in field.boxes)]) - 0.3
    hi = np.array([max(b[1][0] for b in field.boxes), max(b[1][1] for b in field.boxes), max(b[1][2] for b in field.boxes)]) + 0.3
    import time
    t0 = time.time()
    F, org = evaluate_grid(field, lo, hi, prm['voxel'])
    t1 = time.time()
    verts, quads = surface_nets(F, org, prm['voxel'])
    print('FIELD', F.shape, 'eval %.1fs' % (t1 - t0), 'verts', len(verts), 'quads', len(quads))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    V = np.stack([verts[:, 0], -verts[:, 2], verts[:, 1]], axis=1)
    me = bpy.data.meshes.new(args.cluster)
    me.from_pydata(V.tolist(), [], quads.tolist())
    me.validate()
    obj = bpy.data.objects.new(args.cluster, me)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    raw = mesh_stats(obj)
    print('RAW', raw)

    # watertight pass: voxel remesh at the field resolution (fixes the rare
    # ambiguous surface-nets cells), then decimate to budget
    mod = obj.modifiers.new('remesh', 'REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = prm['voxel']
    mod.adaptivity = 0.0
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    seen = set(); parts = []
    for f in bm.faces:
        if f.index in seen:
            continue
        st = [f]; seen.add(f.index); comp = []
        while st:
            x = st.pop(); comp.append(x)
            for e in x.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index); st.append(g)
        parts.append(comp)
    big = max(len(c) for c in parts)
    small = [c for c in parts if len(c) < max(400, 0.01 * big)]
    bmesh.ops.delete(bm, geom=[f for c in small for f in c], context='FACES')
    bm.to_mesh(obj.data); bm.free()
    rem = mesh_stats(obj)
    rem['partsKept'] = len(parts) - len(small); rem['smallPartsRemoved'] = len(small)
    print('REMESH', rem)
    target = int(budget * 0.94)
    for _ in range(3):
        cur = mesh_stats(obj)['tris']
        if cur <= target:
            break
        mod = obj.modifiers.new('dec', 'DECIMATE')
        mod.ratio = max(0.01, target / cur)
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-4)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    # box safety net: decimate collapse can nudge a vertex a few cm; clamp to the
    # nearest box (boxes carry the +0.3 m expansion already)
    clamped = 0
    for v in obj.data.vertices:
        x, zmap, y = v.co.x, -v.co.y, v.co.z
        ok = False
        best = None
        for r in rocks:
            b = r['box']
            if b['xMin'] <= x <= b['xMax'] and b['zMin'] <= zmap <= b['zMax'] and b['yMin'] <= y <= b['yMax']:
                ok = True
                break
            dx = max(b['xMin'] - x, 0, x - b['xMax'])
            dz = max(b['zMin'] - zmap, 0, zmap - b['zMax'])
            dy = max(b['yMin'] - y, 0, y - b['yMax'])
            dd = dx * dx + dy * dy + dz * dz
            if best is None or dd < best[0]:
                best = (dd, b)
        if not ok:
            b = best[1]
            x = min(max(x, b['xMin'] + 0.01), b['xMax'] - 0.01)
            zmap = min(max(zmap, b['zMin'] + 0.01), b['zMax'] - 0.01)
            y = min(max(y, b['yMin'] + 0.01), b['yMax'] - 0.01)
            v.co = (x, -zmap, y)
            clamped += 1
    obj.data.update()
    fin = mesh_stats(obj)
    print('FINAL', fin, 'clamped', clamped)

    mats = build_materials(site, args.out)
    for m in mats:
        obj.data.materials.append(m)
    cube_uv(obj, site['material']['stone'].get('tileM', 2.5))
    surf = assign_faces(obj, field)
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(38))

    glb = os.path.join(args.out, f'{args.cluster}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_yup=True, use_selection=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.out, f'{args.cluster}.blend'))
    rec = {
        'builder': 'build-rockery-r2.py', 'cluster': args.cluster, 'params': prm,
        'grid': {'shape': list(F.shape), 'voxelM': prm['voxel'], 'evalSeconds': round(t1 - t0, 1)},
        'raw': raw, 'remesh': rem, 'final': fin, 'clampedVerts': clamped, 'budget': budget,
        'glb': glb, 'glbBytes': os.path.getsize(glb), 'surfaces': surf,
        'waistSeed': field.waist_seed,
        'hollows': field.hollows, 'bores': field.bores, 'platforms': field.platforms,
        'lumps': [[{'c': c.tolist(), 'r': rr.tolist()} for c, rr in L] for L in field.lumps],
    }
    json.dump(rec, open(os.path.join(args.out, f'build-{args.cluster}.record.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('BUILD_DONE', json.dumps({k: rec[k] for k in ('final', 'clampedVerts', 'glbBytes', 'surfaces')}))
    print('HOLLOWS', len(field.hollows), 'BORES', len(field.bores), 'PLATFORMS', len(field.platforms))


if __name__ == '__main__':
    main()
