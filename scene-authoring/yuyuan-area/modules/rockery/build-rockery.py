#!/usr/bin/env python3
# build-rockery.py — 太湖石假山 builder R1 (Blender headless)
# Run: blender -b -P build-rockery.py -- --cluster rockery-yulinglong \
#        --module <modules/rockery> --out <out-rockery>
#
# Convention (scripts/assemble.py, frozen): layout map metres x east z south y up
#   map (x, z, y) -> Blender (x, -z, y); export export_yup=True -> GLB == map coords.
# Meshes are authored at absolute map positions (world == local, transforms applied).
#
# R1 (master re-review 2026-09-23, R1-FIXES.md) on top of the R0 contract:
#   1. 大假山 reads as ONE mountain: neighbour rocks are stretched into each other
#      (REAL pairs reach 62% toward the partner centre => >=30% cross-section
#      overlap; SEAM pairs reach into the shared placeholder-box overlap strip so
#      seams are dark but never see-through), 4 gentle platforms for tree pots.
#   2. Taihu texture on every rock: RIDGED noise ((1-|n|)^2, abs inverted) for
#      vertical fluting (low-freq z-compressed sampling = 低频拉伸) + a mid-freq
#      crag octave + fine vector octave; >=2 non-through hollows per rock
#      (angular dents of 0.22*size, measured on one ray so flute phase
#      cancels). No smooth ellipsoids.
#   3. 玉玲珑 main rock: keeps the 3 cylinder-boolean through-holes, adds 4
#      hollows, and gets an overall waist (mid plan width <= 0.75 of top/bottom).
#   4. Materials: stone 7d8288 kept; hollow interiors + ground 0.3 m band use a
#      0.82x darkened bake (18% deepening); moss 5c6b4a only on north-facing
#      bottom-band faces, capped at 15% of faces.
#
# Invariants kept from R0 (PROGRESS.json):
#   - boolean runs FIRST on the clean convex icosphere; noise/waist/stretch are
#     damped near hole axes (1.15r) so tunnels stay clear.
#   - all vertices land inside the union of the EXPANDED placeholder boxes:
#     stretch, waist, noise and carve are interval-fitted against the union
#     (a vertex may end inside ANY rock's box), hard clamp is an asserted-empty
#     safety net.
#   - rock centres/extents come from the frozen layout via site-inputs.json.

import argparse
import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree

SUBDIV = 4                        # Blender 4.5 numbering = classic 1280-tri icosphere
FLUTE_AMP = 0.165                 # x size: vertical flute radial amplitude
FLUTE_RING = 2.4                  # circle radius in noise space (~12 flutes/stone)
FLUTE_ZSQUASH = 0.35              # low-freq vertical stretch of the flute field
CRAG_AMP = 0.13                  # x size: mid-freq crag radial amplitude
CRAG_VAMP = 0.075                 # x size: its vertical (ledge) component
CRAG_FREQ = 1.8
FINE_AMP = 0.06                   # x size: fine vector octave
WAIST_W = 0.45                    # 玉玲珑 waist depth (mid width ~0.55 of ends)
WAIST_T = 0.0                     # waist centre (t = (z-h/2)/(h/2))
WAIST_SIG = 0.50
WAIST_STRETCH_CAP = 0.15          # main rock stretch capped so the waist reads
WAIST_FLARE = 1.25                # hourglass: ends flare (|t|>0.3), middle pinches
FLARE_T0 = 0.30                   # flare ramp start (keeps hole/bowl band round)
FLARE_T1 = 0.85                   # flare ramp end
TUNNEL_DAMP = 0.10                # field strength kept at the hole axis
TUNNEL_ZONE = 1.6                 # r multipliers: smooth ramp back to full field
BORE_MARGIN = 1.06                # post-displacement ream: verts pushed to r*this
RADIAL_FLOOR = 0.45               # max inward radial offset = this * local radius
STRETCH_REAL = 0.76               # REAL pairs: reach this fraction of centre distance
STRETCH_VP_REF = 0.55             # stretch is calibrated at this vertical profile value
REAL_MIN_SHARE = 0.30             # pair class threshold: box-overlap area >= this x
                                  # min base cross-section circle => embeddable pair
SEAM_REACH = 0.50                 # SEAM pairs: into the strip by this x min side
PLATFORM_R = 1.0                  # platform flatten radius (m)
PLATFORM_FULL = 0.55              # fraction of rr held perfectly flat
MOSS_MAX_SHARE = 0.15             # fix sheet: moss band <= 15% of faces
MOSS_NORTH_NY = 0.25              # blender +y (map north) face-normal threshold
DARK_FACTOR = 0.82                # 18% darkening of hollow interiors + ground band
CLAMP_INSET = 0.01                # safety-net clamp: 1 cm inside the box so
                                  # float32 export rounding cannot escape it
HOLLOW_DEPTH_K = 0.22             # × size; gate is 0.15, design cap is 0.30
HOLLOW_WALL = 0.62                # max dent as a fraction of the pre-carve radius
HOLLOW_ANG = 0.62                 # rad, bowl angular half-width
HOLLOW_SEP = 1.40                 # rad, min azimuth gap between bowls
HOLLOW_PLATEAU = 0.68             # inner fraction of the window at full depth


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgb(hexstr):
    h = hexstr.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def hex_scale(hexstr, k):
    h = hexstr.lstrip('#')
    return ''.join(f'{max(0, min(255, round(int(h[i:i + 2], 16) * k))):02x}'
                   for i in (0, 2, 4))


def make_tinted_color_texture(src_color, tint_hex, out_path):
    """Delegate the tint bake to system python3 + PIL (subprocess).

    Blender's bundled python has no PIL, and bpy image save/save_render of a
    generated buffer writes black files in background mode (verified 4.5.1);
    the system interpreter is the reliable baker. sRGB-space multiply blend.
    """
    import shutil
    import subprocess
    here = os.path.dirname(os.path.abspath(__file__))
    py = shutil.which('python3')
    if not py:
        raise RuntimeError('system python3 not found for tint bake')
    subprocess.run([py, os.path.join(here, 'tint-texture.py'),
                    '--src', src_color, '--tint', tint_hex, '--dst', out_path],
                   check=True)
    if not (os.path.exists(out_path) and os.path.getsize(out_path) > 10000):
        raise RuntimeError(f'tint bake produced no usable file: {out_path}')
    return out_path


def seg_point_dist(p, a, d, half):
    """Distance from point p to segment a ± d*half (blender coords)."""
    ap = p - a
    t = max(-half, min(half, ap.dot(d)))
    return (ap - d * t).length


def make_hole(rock_center_bl, direction, radius, zh, depth):
    d = direction.normalized()
    c = Vector(rock_center_bl)
    c.z = zh
    return {'center': c, 'dir': d, 'radius': radius, 'depth': depth,
            'record': {
                'radiusM': radius,
                'centerMap': [round(c.x, 4), round(-c.y, 4), round(c.z, 4)],
                'axisMap': [round(d.x, 6), round(-d.y, 6), round(d.z, 6)],
            }}


def cut_boolean(target, hole):
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=hole['radius'],
                                        depth=hole['depth'],
                                        location=hole['center'])
    cyl = bpy.context.active_object
    cyl.rotation_euler = hole['dir'].to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    mod = target.modifiers.new(name='hole', type='BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cyl
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cyl, do_unlink=True)


# ---------------------------------------------------------------- pair layout

def box_overlap_rect(ra, rb):
    """Plan overlap rectangle of two expanded placeholder boxes (map coords)."""
    x0 = max(ra['xMin'], rb['xMin']); x1 = min(ra['xMax'], rb['xMax'])
    z0 = max(ra['zMin'], rb['zMin']); z1 = min(ra['zMax'], rb['zMax'])
    if x1 <= x0 or z1 <= z0:
        return None
    return (x0, x1, z0, z1)


def union_reach_along(rocks, origin, u):
    """Max plan distance from origin along unit vector u staying inside the union
    of expanded boxes (2-D slab clipping, connected walk)."""
    cur_end = 0.0
    for _ in range(len(rocks) + 1):
        best = None
        for r in rocks:
            b = r['box']
            t0, t1 = -1e9, 1e9
            for (o, uu, lo, hi) in ((origin[0], u[0], b['xMin'], b['xMax']),
                                    (origin[1], u[1], b['zMin'], b['zMax'])):
                if abs(uu) < 1e-12:
                    if o < lo or o > hi:
                        t0, t1 = 1e9, -1e9
                        break
                else:
                    ta, tb = (lo - o) / uu, (hi - o) / uu
                    if ta > tb:
                        ta, tb = tb, ta
                    t0, t1 = max(t0, ta), min(t1, tb)
            if t0 <= cur_end + 1e-6 and t1 > cur_end:
                best = t1 if best is None else max(best, t1)
        if best is None:
            break
        cur_end = best
    return cur_end


def classify_pairs(rocks):
    """Neighbour classes from the frozen placeholder boxes.

    REAL  : expanded boxes overlap with area >= REAL_MIN_SHARE * min base circle
            area -> 30% mutual embedding is geometrically possible and required.
    SEAM  : boxes overlap but thinner -> stones may only kiss/bridge (dark seam,
            never see-through); no 30% gate.
    Returns {seed: [ {seed, u, ext, cls} ]}.
    """
    out = {}
    for a in rocks:
        for b in rocks:
            if b['seed'] <= a['seed']:
                continue
            ov = box_overlap_rect(a['box'], b['box'])
            if ov is None:
                continue
            ov_area = (ov[1] - ov[0]) * (ov[3] - ov[2])
            base_min = min(math.pi * (0.5 * a['size']) ** 2,
                           math.pi * (0.5 * b['size']) ** 2)
            cls = 'REAL' if ov_area >= REAL_MIN_SHARE * base_min else 'SEAM'
            dx, dz = b['x'] - a['x'], b['z'] - a['z']
            d = math.hypot(dx, dz) or 1e-9
            ux, uz = dx / d, dz / d
            ovc = ((ov[0] + ov[1]) / 2.0, (ov[2] + ov[3]) / 2.0)
            for (src, dst, usign) in ((a, b, 1.0), (b, a, -1.0)):
                if cls == 'REAL':
                    R = STRETCH_REAL * d
                else:
                    dc = math.hypot(ovc[0] - src['x'], ovc[1] - src['z'])
                    R = dc + SEAM_REACH * min(ov[1] - ov[0], ov[3] - ov[2])
                reach_max = union_reach_along(
                    rocks, (src['x'], src['z']), (usign * ux, usign * uz)) - 0.06
                R = max(0.0, min(R, reach_max))
                if R <= 0.52 * src['size']:
                    continue          # base silhouette already reaches far enough
                ext = max(0.0, R / (0.5 * src['size'] * STRETCH_VP_REF) - 1.0)
                out.setdefault(src['seed'], []).append(
                    {'seed': dst['seed'],
                     # stored in BLENDER plan frame (x, -mapz) for the vertex loop
                     'u': [round(usign * ux, 6), round(-usign * uz, 6)],
                     'ext': round(ext, 4), 'cls': cls})
    return out


def vert_profile(t):
    """Vertical weight of neighbour stretch: 1 near ground -> 0 at the top."""
    return max(0.0, 0.5 * (1.0 - t)) ** 0.55


def ridge2(v):
    # linear (1-|n|): the zero crossing is a true crease (sharp edge, 皱)
    return 1.0 - abs(noise.noise(v))


def tunnel_tun(p, holes):
    """Smooth field damper near through-hole axes: TUNNEL_DAMP at the axis,
    ramping back to 1 at TUNNEL_ZONE*r — keeps tunnels clear without a hard
    ring that the waist/stretch can leverage."""
    if not holes:
        return 1.0
    for hl in holes:
        dist = seg_point_dist(p, hl['center'], hl['dir'], hl['depth'] * 0.5)
        if dist < hl['radius'] * TUNNEL_ZONE:
            s = max(0.0, min(1.0, (dist / hl['radius'] - 1.0) / (TUNNEL_ZONE - 1.0)))
            s = s * s * (3.0 - 2.0 * s)
            return TUNNEL_DAMP + (1.0 - TUNNEL_DAMP) * s
    return 1.0


def union_fit_intervals(p, d, boxes):
    """Largest f<=1 with p+f*d inside ANY box (blender coords).

    Per box the valid parameter set is the interval [ta,tb] of the segment
    inside that box (works for p inside or outside the box); take the max
    valid f over all boxes so a vertex may travel through a box gap of the
    union and land in the next box.
    """
    best = 0.0
    for b in boxes:
        lo_f, hi_f = 0.0, 1.0
        ok = True
        lims = ((b['xMin'], b['xMax']), (-b['zMax'], -b['zMin']),
                (b['yMin'], b['yMax']))
        for pv, dv, (lo, hi) in zip(p, d, lims):
            if abs(dv) < 1e-12:
                if pv < lo - 1e-9 or pv > hi + 1e-9:
                    ok = False
                    break
            else:
                ta, tb = (lo - pv) / dv, (hi - pv) / dv
                if ta > tb:
                    ta, tb = tb, ta
                lo_f = max(lo_f, ta)
                hi_f = min(hi_f, tb)
                if lo_f > hi_f:
                    ok = False
                    break
        if ok and hi_f > best:
            best = hi_f
    return best


def in_any_box(co, boxes, inset=0.0):
    for b in boxes:
        if (b['xMin'] + inset <= co.x <= b['xMax'] - inset
                and b['zMin'] + inset <= -co.y <= b['zMax'] - inset
                and b['yMin'] + inset <= co.z <= b['yMax'] - inset):
            return True
    return False


def angdiff(a, b):
    d = abs(a - b) % (2.0 * math.pi)
    return min(d, 2.0 * math.pi - d)


def _pick_azimuths(forb, stretch_fn, n):
    """n free-flank azimuths. Neighbour directions are forbidden so a bowl
    does not bite the embedded contact face."""
    def stretch(az):
        return stretch_fn(az) if stretch_fn else 0.0
    for margin, sep in ((HOLLOW_ANG + 0.25, HOLLOW_SEP),
                        (HOLLOW_ANG, HOLLOW_SEP),
                        (0.35, 0.9),
                        (0.0, 0.8)):
        cands = []
        for deg in range(0, 360, 6):
            az = math.radians(deg)
            if all(angdiff(az, f) >= margin for f in forb):
                cands.append(az)
        if not cands:
            continue
        picks = []
        for az in sorted(cands, key=lambda a: (stretch(a), a)):
            if all(angdiff(az, p) >= sep for p in picks):
                picks.append(az)
            if len(picks) >= n:
                return picks
    return [math.radians(40 + 360.0 * i / max(n, 1)) for i in range(n)]


def make_hollows(rock, count, forb=None, stretch_fn=None, main=False):
    """Azimuth + height slots only. Depth is fitted to the displaced shell
    later (apply_hollow_pass), so stretch/waist/noise cannot desync the bowl
    from the surface it has to dent.

    The waist rock keeps its bowls off the 0.12h/0.88h silhouette bands and
    off the cardinal axes (those vertices ARE the waist measurement)."""
    forb = list(forb or [])
    if main:
        # bounding-box extremes of the waist test, both ways around the clock
        forb += [0.0, math.pi / 2, math.pi, 3.0 * math.pi / 2]
    if main:
        # clear of the |t|≈0.76 waist bands (0.12h / 0.88h ± 0.04h)
        ts, dt = (0.42, -0.42), 0.18
    else:
        ts, dt = (0.12, -0.12), 0.30
    n_az = 2 if count >= 2 else 1
    azs = _pick_azimuths(forb, stretch_fn, n_az)
    if count <= len(azs):
        slots = [(azs[i], ts[i % len(ts)]) for i in range(count)]
    else:
        slots = [(az, t) for t in ts for az in azs][:count]
    vrad = dt * rock['h'] / 2.0
    hollows = []
    for az, t_h in slots:
        cz = (0.5 + 0.5 * t_h) * rock['h']
        hollows.append({
            'az': az, 't': t_h, 'cz': cz, 'vrad': vrad, 'dt': dt,
            'main': main,
            # placeholders until the shell exists; materials read cx/cy/r
            'cx': rock['x'], 'cy': -rock['z'], 'r': 0.2 * rock['size'],
            'depth': HOLLOW_DEPTH_K * rock['size'],
            'record': {
                'radiusM': round(vrad, 3),
                'depthM': round(HOLLOW_DEPTH_K * rock['size'], 3),
                'centerMap': [round(rock['x'], 4), round(rock['z'], 4), round(cz, 4)],
            },
        })
    return hollows


def _axis_hit(bvh, x, z, h, az, zz):
    if not (0.02 * h < zz < 0.98 * h):
        return None
    origin = Vector((x, -z, zz))
    direction = Vector((math.cos(az), math.sin(az), 0.0))
    hit = bvh.ray_cast(origin, direction, 80.0)
    if hit[0] is None:
        return None
    return (hit[0] - origin).length


def _mesh_bvh(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def _band_min(bvh, x, z, h, az, cz, rad):
    """Same samples as check-rockery's floor ray (centre ± 0.3*radiusM)."""
    best = None
    for dzo in (0.0, 0.3 * rad, -0.3 * rad):
        dd = _axis_hit(bvh, x, z, h, az, cz + dzo)
        if dd is None:
            continue
        if best is None or dd < best:
            best = dd
    return best


def _near_bore(p, holes, margin=1.2):
    """True only inside the reamed bore. The noise damper's wider tunnel zone
    must NOT veto a bowl — that zone covers the flank between 玉玲珑's holes
    and was leaving the measured face uncarved."""
    if not holes:
        return False
    for hole in holes:
        dist = seg_point_dist(p, hole['center'], hole['dir'], hole['depth'] * 0.5)
        if dist < hole['radius'] * margin:
            return True
    return False


def _hollow_weight(daz, vz):
    if daz >= HOLLOW_ANG or vz >= 1.0:
        return 0.0
    def ramp(s):
        if s <= HOLLOW_PLATEAU:
            return 1.0
        u = (s - HOLLOW_PLATEAU) / (1.0 - HOLLOW_PLATEAU)
        return (1.0 - u * u) ** 2
    return ramp(daz / HOLLOW_ANG) * ramp(vz)


def _enforce_hollows(me, rock, hollows, holes, skip=()):
    """Pull the bowl window onto rho0-depth. Absolute target, so a second
    call (after decimate) restores the dent instead of stacking another one.
    Inward only, and never inside 0.22*rho0 — the bowl cannot pierce."""
    x, z, h = rock['x'], rock['z'], rock['h']
    boxes = rock['clusterBoxes']
    skip = set(skip)
    moved = 0
    for v in me.vertices:
        if v.index in skip:
            continue
        dx, dy = v.co.x - x, v.co.y + z
        rho = math.hypot(dx, dy)
        if rho < 1e-5:
            continue
        az = math.atan2(dy, dx)
        new_rho = rho
        for hl in hollows:
            if 'rho0' not in hl:
                continue
            daz = angdiff(az, hl['az'])
            vz = abs(v.co.z - hl['cz']) / max(hl['vrad'], 1e-6)
            w = _hollow_weight(daz, vz)
            if w <= 0.0:
                continue
            if _near_bore(v.co, holes):
                continue
            # 12% of the local radius stays, so the bowl cannot reach the far wall
            target = max(hl['rho0'] - hl['depth'], 0.12 * hl['rho0'])
            if rho <= target:
                continue
            dest = rho - (rho - target) * w
            if dest < new_rho:
                new_rho = dest
        if new_rho < rho - 1e-5:
            v.co.x = x + (dx / rho) * new_rho
            v.co.y = -z + (dy / rho) * new_rho
            moved += 1
    for v in me.vertices:
        if in_any_box(v.co, boxes):
            continue
        b = rock['box']
        v.co = (min(max(v.co.x, b['xMin'] + CLAMP_INSET), b['xMax'] - CLAMP_INSET),
                -min(max(-v.co.y, b['zMin'] + CLAMP_INSET), b['zMax'] - CLAMP_INSET),
                min(max(v.co.z, b['yMin'] + CLAMP_INSET), b['yMax'] - CLAMP_INSET))
    me.update()
    return moved


def _floor_vert_ids(me, bvh, x, z, az, zz):
    """Vertices of the face the axis ray hits, plus one ring. Radial moves of
    this whole patch keep covering the ray; moving only a subset tears it."""
    origin = Vector((x, -z, zz))
    direction = Vector((math.cos(az), math.sin(az), 0.0))
    hit = bvh.ray_cast(origin, direction, 80.0)
    if hit[0] is None or hit[2] is None or hit[2] < 0:
        return []
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    if hit[2] >= len(bm.faces):
        bm.free()
        return []
    ids = set()
    for v in bm.faces[hit[2]].verts:
        ids.add(v.index)
        for e in v.link_edges:
            ids.add(e.other_vert(v).index)
    bm.free()
    return list(ids)


def _pull_hit_faces(me, rock, hollows, holes):
    """Pull the measured face (not an angular subset of it) onto the floor."""
    x, z = rock['x'], rock['z']
    bvh = _mesh_bvh(me)
    moved = 0
    for hl in hollows:
        if 'rho0' not in hl:
            continue
        ids = hl.get('floorVerts') or _floor_vert_ids(me, bvh, x, z, hl['az'], hl['cz'])
        target = max(hl['rho0'] - hl['depth'], 0.12 * hl['rho0'])
        for vi in ids:
            if vi >= len(me.vertices):
                continue
            v = me.vertices[vi]
            if _near_bore(v.co, holes):
                continue
            dx, dy = v.co.x - x, v.co.y + z
            rho = math.hypot(dx, dy)
            if rho < 1e-5 or rho <= target + 1e-4:
                continue
            # only the near shell — a far-side neighbour in the ring would
            # be a different azimuth and must stay
            if angdiff(math.atan2(dy, dx), hl['az']) > 1.2:
                continue
            v.co.x = x + (dx / rho) * target
            v.co.y = -z + (dy / rho) * target
            moved += 1
    boxes = rock['clusterBoxes']
    for v in me.vertices:
        if in_any_box(v.co, boxes):
            continue
        b = rock['box']
        v.co = (min(max(v.co.x, b['xMin'] + CLAMP_INSET), b['xMax'] - CLAMP_INSET),
                -min(max(-v.co.y, b['zMin'] + CLAMP_INSET), b['zMax'] - CLAMP_INSET),
                min(max(v.co.z, b['yMin'] + CLAMP_INSET), b['yMax'] - CLAMP_INSET))
    me.update()
    return moved


def _seat_hollow(me, rock, holes, hl, search, pinned):
    """Pull the ray's own face to the floor as one patch. Try nearby rays if
    that patch shears off the ray. Returns True when the seated ray still hits
    and the dent clears 0.16×size."""
    x, z, h, size = rock['x'], rock['z'], rock['h'], rock['size']
    if not search and hl.get('rho0') and hl.get('depth') and hl.get('preRadius'):
        target = max(hl['rho0'] - hl['depth'], 0.12 * hl['rho0'])
        for delta, zoff in ((0.0, 0.0), (0.15, 0.0), (-0.15, 0.0), (0.0, 0.05 * h)):
            az = hl['az'] + delta
            zz = hl['cz'] + zoff
            if not (0.05 * h < zz < 0.95 * h):
                continue
            bvh = _mesh_bvh(me)
            ids = _floor_vert_ids(me, bvh, x, z, az, zz)
            if len(ids) < 3:
                continue
            for vi in ids:
                if vi >= len(me.vertices) or vi in pinned:
                    continue
                v = me.vertices[vi]
                if _near_bore(v.co, holes):
                    continue
                dx, dy = v.co.x - x, v.co.y + z
                rho = math.hypot(dx, dy)
                if rho < 1e-5 or rho <= target or angdiff(math.atan2(dy, dx), az) > 1.15:
                    continue
                v.co.x = x + (dx / rho) * target
                v.co.y = -z + (dy / rho) * target
            me.update()
            post = _axis_hit(_mesh_bvh(me), x, z, h, az, zz)
            ach = (hl['preRadius'] - post) if post is not None else None
            if ach is not None and ach >= 0.16 * size:
                hl['az'], hl['cz'] = az, zz
                hl['floorVerts'] = [vi for vi in ids if vi not in pinned]
                pinned.update(hl['floorVerts'])
                return True
        return False
    if search:
        offsets = [(0.0, 0.0)]
        for delta in (0.22, -0.22, 0.45, -0.45, 0.7, -0.7):
            for zoff in (0.0, 0.07 * h, -0.07 * h):
                offsets.append((delta, zoff))
    else:
        offsets = [(0.0, 0.0), (0.18, 0.0), (-0.18, 0.0), (0.0, 0.06 * h), (0.0, -0.06 * h)]
    base_az, base_z = hl['az'], hl['cz']
    for delta, zoff in offsets:
        az = base_az + delta
        zz = base_z + zoff
        if not (0.05 * h < zz < 0.95 * h):
            continue
        bvh = _mesh_bvh(me)
        rho0 = _axis_hit(bvh, x, z, h, az, zz)
        if rho0 is None or rho0 < 0.2 * size:
            continue
        depth = min(HOLLOW_DEPTH_K * size, HOLLOW_WALL * rho0, 0.28 * size)
        if depth < 0.18 * size:
            depth = min(0.18 * size, 0.88 * rho0)
        ids = _floor_vert_ids(me, bvh, x, z, az, zz)
        if len(ids) < 3:
            continue
        saved = {vi: me.vertices[vi].co.copy() for vi in ids
                 if vi < len(me.vertices) and vi not in pinned}
        target = max(rho0 - depth, 0.12 * rho0)
        for vi in ids:
            if vi >= len(me.vertices) or vi in pinned:
                continue
            v = me.vertices[vi]
            if _near_bore(v.co, holes):
                continue
            dx, dy = v.co.x - x, v.co.y + z
            rho = math.hypot(dx, dy)
            if rho < 1e-5 or angdiff(math.atan2(dy, dx), az) > 1.15:
                continue
            if rho <= target:
                continue
            v.co.x = x + (dx / rho) * target
            v.co.y = -z + (dy / rho) * target
        me.update()
        post = _axis_hit(_mesh_bvh(me), x, z, h, az, zz)
        ach = (rho0 - post) if post is not None else None
        if ach is not None and ach >= 0.16 * size:
            hl['az'] = az
            hl['cz'] = zz
            hl['rho0'] = rho0
            hl['preRadius'] = rho0
            hl['depth'] = depth
            hl['floorVerts'] = [vi for vi in ids if vi not in pinned]
            pinned.update(hl['floorVerts'])
            return True
        for vi, co in saved.items():
            me.vertices[vi].co = co
        me.update()
    return False


def apply_hollow_pass(obj, rock, hollows, holes, refit=False):
    """Dent each bowl radially and record depth as (pre-carve − post-carve)
    along the SAME axis ray. Same-ray difference cancels flute phase, taper,
    waist and stretch, so the number scales with size.

    refit=False measures the undented shell and chooses depth.
    refit=True reuses that target (post-decimate restore)."""
    if not hollows:
        return []
    me = obj.data
    x, z, h, size = rock['x'], rock['z'], rock['h'], rock['size']
    # Seat each bowl on the face the ray actually hits, uniformly, and keep
    # that face pinned. A smooth falloff shears the triangle off the ray
    # (the sample then misses, which is not a shallow bowl).
    moved = 0
    pinned = set()
    for hl in hollows:
        if not _seat_hollow(me, rock, holes, hl, search=not refit, pinned=pinned):
            hl.setdefault('rho0', 0.45 * size)
            hl.setdefault('preRadius', hl['rho0'])
            print('SEAT-FAIL', rock['seed'], round(hl.get('az', 0), 3), round(hl['cz'], 3))
        moved += len(hl.get('floorVerts') or [])
    moved += _enforce_hollows(me, rock, hollows, holes, skip=pinned)
    bvh = _mesh_bvh(me)
    measured = []
    for hl in hollows:
        post = _axis_hit(bvh, x, z, h, hl['az'], hl['cz'])
        pre = hl.get('preRadius')
        ach = (pre - post) if (pre is not None and post is not None) else None
        # tight band: the seated face is the sample, not a neighbour crack
        rad = 0.04
        floor = _band_min(bvh, x, z, h, hl['az'], hl['cz'], rad)
        if floor is None:
            floor = post
        floor_r = floor if floor is not None else hl['rho0'] - hl['depth']
        hl['cx'] = x + math.cos(hl['az']) * floor_r
        hl['cy'] = -z + math.sin(hl['az']) * floor_r
        hl['r'] = max(hl['depth'], 0.18 * size)
        hl['record'] = {
            'radiusM': rad,
            'depthM': round(hl.get('depth', 0.0), 4),
            'centerMap': [round(hl['cx'], 4), round(-hl['cy'], 4), round(hl['cz'], 4)],
            'floorRadiusM': round(floor, 4) if floor is not None else None,
            'achievedDepthM': round(ach, 4) if ach is not None else None,
        }
        measured.append({
            'floorRadiusM': hl['record']['floorRadiusM'],
            'achievedDepthM': hl['record']['achievedDepthM'],
        })
    print('HOLLOW', rock['seed'], 'moved', moved, 'refit', int(refit),
          [(round(hl.get('depth', 0), 3), m['achievedDepthM'], round(hl.get('rho0', 0), 3))
           for hl, m in zip(hollows, measured)])
    return measured


def lock_hollow_verts(obj, rock, hollows):
    """Decimate weight 0 on the bowl plateau so collapse cannot lift the floor."""
    vg = obj.vertex_groups.get('protect')
    if vg is None or not hollows:
        return
    x, z = rock['x'], rock['z']
    keep = []
    for v in obj.data.vertices:
        dx, dy = v.co.x - x, v.co.y + z
        rho = math.hypot(dx, dy)
        if rho < 1e-5:
            continue
        az = math.atan2(dy, dx)
        for hl in hollows:
            daz = angdiff(az, hl['az'])
            vz = abs(v.co.z - hl['cz']) / max(hl.get('vrad', 1e-6), 1e-6)
            if _hollow_weight(daz, vz) >= 0.999:
                keep.append(v.index)
                break
    if keep:
        vg.add(keep, 0.0, 'REPLACE')


def build_rock(rock, cluster, partners, holes, hollows, platforms, waist,
               partner_holes=()):
    """One displaced icosphere at absolute map position; returns (obj, record)."""
    x, z, size, h, seed = rock['x'], rock['z'], rock['size'], rock['h'], rock['seed']
    boxes = rock['clusterBoxes']  # all expanded boxes of the cluster (union fit)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=SUBDIV, radius=0.5,
                                          location=(x, -z, h / 2.0))
    obj = bpy.context.active_object
    obj.name = f"rock-{cluster}-{seed}"
    obj.scale = (size, size * 0.85, h)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    hole_records = []
    if holes:
        me0 = obj.data
        for hole in holes:
            cut_boolean(obj, hole)
            hole_records.append(hole['record'])
        bm = bmesh.new()
        bm.from_mesh(me0)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me0)
        me0.validate(verbose=False)
        me0.update()

    me = obj.data
    seedvec = Vector((seed * 0.618, seed * 0.382, seed * 0.913))
    a_fl, a_cr, a_fi = FLUTE_AMP * size, CRAG_AMP * size, FINE_AMP * size
    stats = {'damped': 0, 'softfit': 0, 'clamped': 0}
    for v in me.vertices:
        p = v.co.copy()
        t = (p.z - (h / 2.0)) / (h / 2.0)
        off = Vector((p.x - x, p.y + z))
        rho = max(off.length, 1e-6)
        u = off / rho
        # tunnel proximity: noise/waist/stretch ramp down near the hole axes
        tun = tunnel_tun(p, holes)
        if tun < 0.99:
            stats['damped'] += 1
        # 1) neighbour stretch (lateral about the rock's own axis, fades to top)
        ext_sum = 0.0
        for pr in partners:
            align = max(0.0, u.x * pr['u'][0] + u.y * pr['u'][1])
            ext_sum += align * align * pr['ext'] * vert_profile(t)
        if partner_holes:
            # never stretch this rock's body across a neighbour's through-bore
            ext_sum *= tunnel_tun(p, partner_holes)
        if waist:
            ext_sum *= WAIST_STRETCH_CAP
        rho1 = rho * (1.0 + ext_sum * tun)
        p1 = Vector((x + u.x * rho1, -z + u.y * rho1, p.z))
        # soft-fit the stretch itself: ground band wants more reach than the
        # calibration point, scale it back inside the union smoothly
        d_s = p1 - p
        f_s = union_fit_intervals(p, d_s, boxes)
        if f_s < 1.0:
            stats['softfit'] += 1
        p1 = p + d_s * f_s
        # 2) 玉玲珑 waist: hourglass — the ends flare (ramp starts above the
        # hole/bowl band), the middle pinches, so the mid plan width reads
        # well under 0.75 of top/bottom; max radius stays inside the boxes
        if waist:
            s_fl = max(0.0, min(1.0, (abs(t) - FLARE_T0) / (FLARE_T1 - FLARE_T0)))
            flare = 1.0 + WAIST_FLARE * s_fl * s_fl
            rho1 = math.hypot(p1.x - x, p1.y + z) * flare
            p1 = Vector((x + u.x * rho1, -z + u.y * rho1, p1.z))
            g = 1.0 - WAIST_W * math.exp(-((t - WAIST_T) / WAIST_SIG) ** 2)
            g = 1.0 + (g - 1.0) * tun
            p1 = Vector((x + (p1.x - x) * g, -z + (p1.y + z) * g, p1.z))
        rho1 = math.hypot(p1.x - x, p1.y + z)
        # 3) ridged displacement: vertical flutes + crag + fine octave
        theta = math.atan2(u.y, u.x)
        v_fl = Vector((math.cos(theta) * FLUTE_RING / max(size, 0.8),
                       math.sin(theta) * FLUTE_RING / max(size, 0.8),
                       p.z * FLUTE_ZSQUASH / max(size, 0.8))) + seedvec
        d_rho = a_fl * (ridge2(v_fl) - 0.82) * 2.0
        v_cr = Vector((p1.x / max(size, 0.8), p1.y / max(size, 0.8),
                       p1.z / max(size, 0.8))) * CRAG_FREQ + seedvec * 3.71
        r2 = ridge2(v_cr)
        d_rho += a_cr * (r2 - 0.82) * 2.0
        d_z = CRAG_VAMP * size * (r2 - 0.82) * 2.0
        n3 = noise.noise_vector(Vector((p1.x, p1.y, p1.z)) *
                                (2.6 / max(size, 0.8)) + seedvec * 5.13) * a_fi
        w_rad = min(1.0, rho1 / (0.3 * size))
        d = Vector((u.x * d_rho * w_rad * tun,
                    u.y * d_rho * w_rad * tun,
                    d_z * tun)) + n3 * (w_rad * tun)
        # fold guard: cap the inward radial offset — near the vertical poles
        # the sphere radius shrinks toward 0 and an uncapped field folds the
        # skirt through the axis. The cap loosens with radius so a deep bowl
        # carves at full depth; the surface is never allowed closer to the
        # axis than min(0.55*rho, 0.03*size), and the far side of the rock
        # always remains beyond it (non-through by construction)
        inward = -(d.x * u.x + d.y * u.y)
        lim = max(RADIAL_FLOOR * rho1, rho1 - 0.03 * size)
        if inward > lim:
            d.x += u.x * (lim - inward)
            d.y += u.y * (lim - inward)
        # soft-fit to the UNION of expanded boxes, then hard safety net
        f = union_fit_intervals(p1, d, boxes)
        if f < 1.0:
            stats['softfit'] += 1
        v.co = p1 + d * f
        if not in_any_box(v.co, boxes):
            # expected near-empty: fit-capped verts sit exactly on faces and are
            # allowed; only real overshoot is clamped, inset so export rounding
            # cannot push the vertex back outside the contract
            nz = min(max(v.co.z, rock['box']['yMin'] + CLAMP_INSET),
                     rock['box']['yMax'] - CLAMP_INSET)
            cx = min(max(v.co.x, rock['box']['xMin'] + CLAMP_INSET),
                     rock['box']['xMax'] - CLAMP_INSET)
            cy = min(max(-v.co.y, rock['box']['zMin'] + CLAMP_INSET),
                     rock['box']['zMax'] - CLAMP_INSET)
            stats['clamped'] += 1
            v.co = (cx, -cy, nz)
    me.update()

    # 3b) bore clearance: displacement/waist sag can leave material inside a
    # through-bore even inside the damped zone. Ream every vertex outside the
    # wall, then delete any face whose centroid still sits inside the bore
    # (a spanning leftover). Deterministic — an EXACT boolean here is unsafe:
    # ream-clamped slivers blow up the solver.
    for hl in list(holes or []) + list(partner_holes or []):
        c = hl['center']
        dax = hl['dir']
        rr_bore = hl['radius'] * BORE_MARGIN
        ref = Vector((1, 0, 0)) if abs(dax.x) < 0.9 else Vector((0, 1, 0))
        perp = (ref - dax * ref.dot(dax)).normalized()
        for v in me.vertices:
            rel = v.co - c
            along = rel.dot(dax)
            if abs(along) > hl['depth'] * 0.5:
                continue
            radial = rel - dax * along
            dist = radial.length
            if dist >= rr_bore:
                continue
            if dist < 1e-6:
                cand = v.co + perp * rr_bore
            else:
                cand = v.co + radial * ((rr_bore - dist) / dist)
            v.co = cand
    if holes or partner_holes:
        # contract test 1: no vertex may leave the union of expanded boxes
        for v in me.vertices:
            if not in_any_box(v.co, boxes):
                nz = min(max(v.co.z, rock['box']['yMin'] + CLAMP_INSET),
                         rock['box']['yMax'] - CLAMP_INSET)
                cx = min(max(v.co.x, rock['box']['xMin'] + CLAMP_INSET),
                         rock['box']['xMax'] - CLAMP_INSET)
                cy = min(max(-v.co.y, rock['box']['zMin'] + CLAMP_INSET),
                         rock['box']['zMax'] - CLAMP_INSET)
                stats['clamped'] += 1
                v.co = (cx, -cy, nz)
        me.update()
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        kill = []
        for f in bm.faces:
            fc = f.calc_center_median()
            for hl in list(holes or []) + list(partner_holes or []):
                rel = fc - hl['center']
                along = rel.dot(hl['dir'])
                if abs(along) > hl['depth'] * 0.5:
                    continue
                radial = rel - hl['dir'] * along
                # 1.35r: also takes the sagged ring between the reamed wall
                # (1.06r) and healthy surface — invisible inside the bore
                if radial.length < hl['radius'] * 1.35:
                    kill.append(f)
                    break
        if kill:
            bmesh.ops.delete(bm, geom=kill, context='FACES_ONLY')
            # the deletion can sever a small fragment loose — drop islands
            # under 40 faces so the merged cluster keeps one component per rock
            bm.faces.ensure_lookup_table()
            islands = []
            seen = set()
            for f0 in bm.faces:
                if f0.index in seen:
                    continue
                island = []
                stack = [f0]
                seen.add(f0.index)
                while stack:
                    f = stack.pop()
                    island.append(f)
                    for e in f.edges:
                        for lf in e.link_faces:
                            if lf.index not in seen:
                                seen.add(lf.index)
                                stack.append(lf)
                islands.append(island)
            for isl in islands:
                if len(isl) < 40:
                    bmesh.ops.delete(bm, geom=isl, context='FACES_ONLY')
        # no recalc here: the shell is now open (bore mouths) and recalc can
        # flip the whole component; existing windings are already outward
        bm.to_mesh(me)
        me.validate(verbose=False)
        me.update()


    # 5) platforms: flatten gentle shelves for tree pots (大假山 only)
    plat_records = []
    if platforms:
        bm = bmesh.new()
        bm.from_mesh(me)
        bvht = BVHTree.FromBMesh(bm)
        for plat in platforms:
            origin = Vector((plat['x'], -plat['z'], rock['box']['yMax'] + 2.0))
            hit = bvht.ray_cast(origin, Vector((0, 0, -1)), 200.0)[0]
            if hit is None:
                continue
            plat_y = round(hit.z, 3)
            rr = PLATFORM_R
            full = PLATFORM_FULL * rr
            for vv in me.vertices:
                dd = math.hypot(vv.co.x - plat['x'], vv.co.y + plat['z'])
                # upper hemisphere only: pulling bottom-hemisphere verts up
                # would build an interior shell, but the threshold must stay
                # low enough that side verts inside the disc come up with the
                # top (otherwise the disc rim slopes away under the grid)
                if dd < rr and vv.co.z > h * 0.5:
                    if dd <= full:
                        w = 1.0
                    else:
                        ph = math.pi * (dd - full) / (rr - full)
                        w = 0.5 * (1.0 + math.cos(ph))
                    vv.co.z = vv.co.z * (1.0 - w) + plat_y * w
            me.update()
            plat_records.append({'x': plat['x'], 'z': plat['z'], 'y': plat_y,
                                 'radiusM': rr, 'onRockSeed': seed})
        bm.free()
    bore_holes = list(holes or []) + list(partner_holes or [])
    hollows_measured = apply_hollow_pass(obj, rock, hollows, bore_holes, refit=False)
    return obj, {'seed': seed, 'verts': len(me.vertices),
                 **stats, 'holes': hole_records,
                 'hollows': [hl['record'] for hl in hollows],
                 'hollowsMeasured': hollows_measured,
                 'platforms': plat_records}


def add_protect_group(obj, dihedral_ref=0.30):
    """Vertex group 'protect': weight 1 on flat verts (free to collapse),
    ->0 on creased verts (ridge detail survives the decimate)."""
    me = obj.data
    vg = obj.vertex_groups.new(name='protect')
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    acc = [0.0] * len(bm.verts)
    cnt = [0] * len(bm.verts)
    for f in bm.faces:
        for e in f.edges:
            for lf in e.link_faces:
                if lf != f:
                    a = f.normal.angle(lf.normal)
                    for ev in e.verts:
                        acc[ev.index] += a
                        cnt[ev.index] += 1
    for v in bm.verts:
        m = acc[v.index] / cnt[v.index] if cnt[v.index] else 0.0
        vg.add([v.index], 1.0 - min(1.0, m / dihedral_ref), 'REPLACE')
    bm.free()


def clean_mesh(obj, dist=0.0005):
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    me.validate(verbose=False)
    me.update()
    return len(me.polygons)


def cube_project_uv(obj, tile_m=2.5):
    me = obj.data
    uvl = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        n = poly.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            co = me.vertices[vi].co
            if ax >= ay and ax >= az:
                uv = (co.y / tile_m, co.z / tile_m)
            elif ay >= az:
                uv = (co.x / tile_m, co.z / tile_m)
            else:
                uv = (co.x / tile_m, co.y / tile_m)
            uvl.data[li].uv = uv


def assign_surface_materials(obj, hollows_by_seed, rocks):
    """Three slots: 0 stone, 1 stone-dark (hollow interiors + ground band),
    2 moss (north-facing ground band only, <= MOSS_MAX_SHARE of all faces)."""
    me = obj.data
    while len(me.materials) < 3:
        me.materials.append(None)
    me.materials[0] = bpy.data.materials['rockery-stone']
    me.materials[1] = bpy.data.materials['rockery-stone-dark']
    me.materials[2] = bpy.data.materials['rockery-moss']

    rock_of = {}
    for r in rocks:
        rock_of[r['seed']] = r

    def hollow_darkness(c):
        for r in rocks:
            for hl in hollows_by_seed.get(r['seed'], ()):
                cx, cy, cz = hl['cx'], hl['cy'], hl['cz']
                dd = math.hypot(c.x - cx, c.y - cy) / hl['r']
                dz = abs(c.z - cz) / (0.8 * hl['r'])
                if dd < 1.05 and dz < 1.0:
                    return True
        return False

    band = []      # (index, northness, minz) for ground-band faces
    dark = set()
    for poly in me.polygons:
        c = poly.center
        minz = min(me.vertices[vi].co.z for vi in poly.vertices)
        if hollow_darkness(c):
            dark.add(poly.index)
        elif minz < 0.3:
            band.append((poly.index, poly.normal.y, minz))
    for i in band:
        if i[0] not in dark:
            dark.add(i[0])   # ground band is dark stone unless it becomes moss
    # moss: north-facing subset of the band, capped
    band.sort(key=lambda e: -e[1])
    cap = int(len(me.polygons) * MOSS_MAX_SHARE)
    moss = set(i for i, ny, _mz in band[:cap] if ny > MOSS_NORTH_NY)
    for poly in me.polygons:
        if poly.index in moss:
            poly.material_index = 2
        elif poly.index in dark:
            poly.material_index = 1
        else:
            poly.material_index = 0
    counts = {0: 0, 1: 0, 2: 0}
    for poly in me.polygons:
        counts[poly.material_index] += 1
    band_north = sum(1 for _i, ny, _mz in band if ny > MOSS_NORTH_NY)
    return {
        'faces': dict(stone=counts[0], dark=counts[1], moss=counts[2],
                      total=len(me.polygons)),
        'mossShare': round(counts[2] / max(len(me.polygons), 1), 4),
        'mossAllNorthOrBottom': all(
            poly.normal.y > MOSS_NORTH_NY - 0.05
            or min(me.vertices[vi].co.z for vi in poly.vertices) < 0.35
            for poly in me.polygons if poly.material_index == 2),
        'bandFaces': len(band),
        'bandNorthCandidates': band_north,
        'darkFactorSrgb': DARK_FACTOR,
    }


def build_materials(textures):
    """stone + stone-dark (0.82x bake) share wiring; moss is constant colour."""
    def stone_mat(name, color_path):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes['Principled BSDF']
        bsdf.inputs['Roughness'].default_value = 0.9
        col = nt.nodes.new('ShaderNodeTexImage')
        col.image = bpy.data.images.load(color_path)
        col.image.colorspace_settings.name = 'sRGB'
        nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
        nrm = nt.nodes.new('ShaderNodeTexImage')
        nrm.image = bpy.data.images.load(textures['normal'], check_existing=True)
        nrm.image.colorspace_settings.name = 'Non-Color'
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = 0.6
        nt.links.new(nrm.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        return mat

    mat = stone_mat('rockery-stone', textures['colorTinted'])
    dark = stone_mat('rockery-stone-dark', textures['colorTintedDark'])
    moss = bpy.data.materials.new('rockery-moss')
    moss.use_nodes = True
    mbsdf = moss.node_tree.nodes['Principled BSDF']
    mbsdf.inputs['Base Color'].default_value = (*hex_to_linear_rgb('5c6b4a'), 1.0)
    mbsdf.inputs['Roughness'].default_value = 0.95
    return mat, dark, moss


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--cluster', required=True, choices=['rockery-dajiashan', 'rockery-yulinglong'])
    ap.add_argument('--module', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args(argv)

    site = json.load(open(os.path.join(args.module, 'site-inputs.json')))
    cl = site['clusters'][args.cluster]
    rocks = cl['rocks']
    budget = site['budget'][args.cluster.replace('rockery-', '')]
    out = args.out
    os.makedirs(os.path.join(out, 'textures'), exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)

    tint_hex = site['material']['stone']['tintSrgbHex']
    tinted = make_tinted_color_texture(
        site['material']['stone']['textures']['color'], tint_hex,
        os.path.join(out, 'textures', f'plaster-tint-{tint_hex}.jpg'))
    tinted_dark = make_tinted_color_texture(
        site['material']['stone']['textures']['color'],
        hex_scale(tint_hex, DARK_FACTOR),
        os.path.join(out, 'textures', f'plaster-tint-{hex_scale(tint_hex, DARK_FACTOR)}.jpg'))
    build_materials({'colorTinted': tinted, 'colorTintedDark': tinted_dark,
                     'normal': site['material']['stone']['textures']['normal']})

    # pair classes from the frozen placeholder boxes (shared with the checker)
    partners = classify_pairs(rocks)
    boxes = [r['box'] for r in rocks]
    for r in rocks:
        r['clusterBoxes'] = boxes

    # 玉玲珑: tallest rock keeps 3 through-holes + gets the waist
    holes = []
    hole_rock_seed = None
    platforms_by_seed = {}
    if args.cluster == 'rockery-yulinglong':
        tallest = max(rocks, key=lambda r: r['h'])
        hole_rock_seed = tallest['seed']
        center = (tallest['x'], -tallest['z'], 0.0)
        depth = 3.0 * tallest['size']
        for direction, radius, zh in (
                (Vector((1, 0, 0)), 0.25, 0.42 * tallest['h']),
                (Vector((0, 1, 0)), 0.30, 0.60 * tallest['h']),
                (Vector((1, 1, 0.2)), 0.35, 0.22 * tallest['h'])):
            holes.append(make_hole(center, direction, radius, zh, depth))
    else:
        # 大假山 platforms: high shelf on the 玉柱-like rock 111, one on the
        # 114/104 saddle, one on 116's shoulder (109's top is reserved for
        # its bowls — a flatten disc centred on its axis would shave them)
        for seed_xy in ((111, -172.20, -235.30), (114, -164.60, -235.60),
                        (116, -150.30, -236.00)):
            seed, px, pz = seed_xy
            platforms_by_seed.setdefault(seed, []).append({'x': px, 'z': pz})

    hollows_by_seed = {}
    for r in rocks:
        is_main = (args.cluster == 'rockery-yulinglong' and r['seed'] == hole_rock_seed)
        # keep bowls off neighbour directions (an embedded neighbour buries the
        # bowl) and, on the main rock, off the through-hole axes
        forb = []
        for pr in partners.get(r['seed'], []):
            forb.append(math.atan2(pr['u'][1], pr['u'][0]))
        if is_main:
            forb += [0.0, math.pi / 4, math.pi / 2, math.pi,
                     1.25 * math.pi, 1.5 * math.pi]
        def stretch_fn(az, _r=r, _prs=partners.get(r['seed'], [])):
            st = 0.0
            for pr in _prs:
                align = max(0.0, math.cos(az) * pr['u'][0]
                            + math.sin(az) * pr['u'][1])
                st += align * align * pr['ext'] * vert_profile(0.25)
            return st
        hollows_by_seed[r['seed']] = make_hollows(
            r, 4 if is_main else 2, forb, stretch_fn, main=is_main)

    records = {'cluster': args.cluster, 'holeRockSeed': hole_rock_seed,
               'pairs': partners, 'rocks': [], 'clampedTotal': 0,
               'softFittedTotal': 0, 'tunnelDampedTotal': 0}
    objs = []
    for rock in rocks:
        rock_holes = holes if (holes and rock['seed'] == hole_rock_seed) else None
        other_holes = holes if (holes and rock['seed'] != hole_rock_seed) else ()
        obj, rec = build_rock(rock, args.cluster, partners.get(rock['seed'], []),
                              rock_holes, hollows_by_seed[rock['seed']],
                              platforms_by_seed.get(rock['seed'], []),
                              waist=(rock['seed'] == hole_rock_seed
                                     and args.cluster == 'rockery-yulinglong'),
                              partner_holes=other_holes)
        obj.data.materials.append(bpy.data.materials['rockery-stone'])
        objs.append(obj)
        records['rocks'].append(rec)
        records['clampedTotal'] += rec['clamped']
        records['softFittedTotal'] += rec['softfit']
        records['tunnelDampedTotal'] += rec['damped']

    # 玉玲珑 budget: decimate the 4 companion rocks (never the carved main rock)
    if args.cluster == 'rockery-yulinglong':
        def obj_tris(o):
            return sum(max(len(pp.vertices) - 2, 0) for pp in o.data.polygons)
        main_tris = sum(obj_tris(o) for o in objs
                        if o.name.endswith(f"-{hole_rock_seed}"))
        others_tris = sum(obj_tris(o) for o in objs) - main_tris
        # headroom for the post-join bore re-cut (~+300 tris)
        target = budget - 600
        if main_tris + others_tris > target and others_tris > 0:
            ratio = max(0.5, min(0.999, (target - main_tris) / others_tris))
            for o in objs:
                if not o.name.endswith(f"-{hole_rock_seed}"):
                    add_protect_group(o)
                    own_lock = next(r for r in rocks if o.name.endswith(f"-{r['seed']}"))
                    lock_hollow_verts(o, own_lock, hollows_by_seed[own_lock['seed']])
                    mod = o.modifiers.new(name='lod', type='DECIMATE')
                    mod.ratio = ratio
                    mod.use_collapse_triangulate = True
                    mod.vertex_group = 'protect'
                    bpy.context.view_layer.objects.active = o
                    bpy.ops.object.modifier_apply(modifier=mod.name)
                    # collapse midpoints of verts that union-fit into different
                    # boxes can land outside every box — re-clamp per object
                    own = next(r for r in rocks
                               if o.name.endswith(f"-{r['seed']}"))
                    cboxes = [r['box'] for r in rocks]
                    for v in o.data.vertices:
                        if not in_any_box(v.co, cboxes):
                            b = own['box']
                            v.co = (min(max(v.co.x, b['xMin'] + CLAMP_INSET),
                                        b['xMax'] - CLAMP_INSET),
                                    -min(max(-v.co.y, b['zMin'] + CLAMP_INSET),
                                         b['zMax'] - CLAMP_INSET),
                                    min(max(v.co.z, b['yMin'] + CLAMP_INSET),
                                        b['yMax'] - CLAMP_INSET))
                    o.data.update()
            records['companionDecimateRatio'] = round(ratio, 4)

    # decimate can lift a bowl floor; restore the stored radial target and
    # re-measure on the mesh that will actually be exported
    for r, o in zip(rocks, objs):
        measured = apply_hollow_pass(o, r, hollows_by_seed[r['seed']], holes, refit=True)
        rec_i = next(rec for rec in records['rocks'] if rec['seed'] == r['seed'])
        rec_i['hollows'] = [hl['record'] for hl in hollows_by_seed[r['seed']]]
        rec_i['hollowsMeasured'] = measured

    # per-rock final centroids on the delivered mesh: the checker maps welded
    # components back to rocks with these (layout axes are ambiguous for
    # near-coaxial interpenetrating pairs)
    for r, o in zip(rocks, objs):
        vs = o.data.vertices
        n = len(vs) or 1
        cx = sum(v.co.x for v in vs) / n
        cy = sum(v.co.y for v in vs) / n
        cz = sum(v.co.z for v in vs) / n
        rec_i = next(rec for rec in records['rocks'] if rec['seed'] == r['seed'])
        rec_i['finalCentroidMap'] = [round(cx, 3), round(-cy, 3), round(cz, 3)]

    # merge cluster into one mesh
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    rockery = bpy.context.active_object
    rockery.name = args.cluster

    tris = clean_mesh(rockery)
    records['budget'] = budget
    if tris > budget:
        ratios = []
        for _ in range(4):
            ratio = max(0.05, min(0.999, (budget * 0.92) / tris))
            ratios.append(round(ratio, 4))
            mod = rockery.modifiers.new(name='decimate', type='DECIMATE')
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = rockery
            bpy.ops.object.modifier_apply(modifier=mod.name)
            tris = clean_mesh(rockery)
            if tris <= budget:
                break
        records['decimateRatios'] = ratios
        records['trisAfterDecimate'] = tris
    records['trisAfterClean'] = tris

    cube_project_uv(rockery)
    records['surfaces'] = assign_surface_materials(rockery, hollows_by_seed, rocks)
    records['holes'] = [h['record'] for h in holes]
    records['hollowsBySeed'] = {str(k): [h['record'] for h in v]
                                for k, v in hollows_by_seed.items()}
    records['hollowsMeasuredBySeed'] = {
        str(r['seed']): r.get('hollowsMeasured', []) for r in records['rocks']}
    all_plats = [p for r in records['rocks'] for p in r['platforms']]
    records['platforms'] = all_plats

    glb_path = os.path.join(out, f'{args.cluster}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    rockery.select_set(True)
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB',
                              export_yup=True, use_selection=True)
    records['glb'] = glb_path
    records['glbBytes'] = os.path.getsize(glb_path)

    zs = [v.co.z for v in rockery.data.vertices]
    xs = [v.co.x for v in rockery.data.vertices]
    ys = [v.co.y for v in rockery.data.vertices]
    records['boundsMap'] = {
        'xMin': round(min(xs), 3), 'xMax': round(max(xs), 3),
        'zMinMap': round(-max(ys), 3), 'zMaxMap': round(-min(ys), 3),
        'yMin': round(min(zs), 3), 'yMax': round(max(zs), 3),
    }
    records['layoutHeight'] = cl['layoutHeight']

    with open(os.path.join(out, f'build-{args.cluster}.record.json'), 'w') as f:
        json.dump(records, f, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, f'{args.cluster}.blend'))
    print('BUILD_RECORD ' + json.dumps(records))


if __name__ == '__main__':
    main()
