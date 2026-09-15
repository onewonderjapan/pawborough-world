"""Shared temple components: profile-lofted roof shells, door frame, wing walls.

Everything runs inside Blender on top of mb_lib (same GLB-coordinate contract:
Y up, facade +Z, origin at the central threshold front edge). Design values
come from kit/temple-shanmen.config.json; nothing here invents dimensions.

Roof method (DESIGN.md constraint): ONE continuous thin shell per roof band,
lofted from the JSON section profile resampled to 10-16 segments — never
stacks of boxes faking a curve. Shells are true slabs: top surface, closed
underside 0.12 m below, and edge closures, so eave corners read from below.
"""
import math

import bmesh
import bpy
from helpers import box_glb, glb_to_blender  # noqa: F401  (glb_to_blender re-exported)


# --------------------------------------------------------------------------
# monotone cubic interpolation (Fritsch-Carlson) over the JSON section samples

def monotone_cubic(samples):
    """samples: [[t, y], ...] sorted by t. Returns y(t) callable, monotone."""
    ts = [s[0] for s in samples]
    ys = [s[1] for s in samples]
    n = len(ts)
    dx = [ts[i + 1] - ts[i] for i in range(n - 1)]
    slope = [(ys[i + 1] - ys[i]) / dx[i] if dx[i] > 0 else 0.0 for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = slope[0], slope[-1]
    for i in range(1, n - 1):
        if slope[i - 1] * slope[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * dx[i] + dx[i - 1], dx[i] + 2 * dx[i - 1]
            m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i])

    def y(t):
        t = max(ts[0], min(ts[-1], t))
        i = n - 2
        for k in range(n - 1):
            if t <= ts[k + 1] + 1e-12:
                i = k
                break
        h = ts[i + 1] - ts[i]
        u = (t - ts[i]) / h
        h00 = (1 + 2 * u) * (1 - u) ** 2
        h10 = u * (1 - u) ** 2
        h01 = u * u * (3 - 2 * u)
        h11 = u * u * (u - 1)
        return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]

    return y


def drop_lut(profile_samples, segments):
    """Normalized drop 0..1 from a half-slope profile [[t,y],...]:
    drop(ridge)=0, drop(eave)=1, same concavity as the section samples."""
    y = monotone_cubic(profile_samples)
    y0, y1 = y(0.0), y(1.0)
    span = y0 - y1
    return [max(0.0, min(1.0, (y0 - y(j / segments)) / span)) for j in range(segments + 1)]


# --------------------------------------------------------------------------
# small vector helpers on GLB triples

def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def quad_out(L, name, pts, mat, uvs, hint):
    """Quad with winding corrected against an approximate outward direction,
    so hand-listed faces can never export inward normals."""
    n = _cross(_sub(pts[1], pts[0]), _sub(pts[3], pts[0]))
    if _dot(n, hint) < 0:
        pts = list(reversed(pts))
        uvs = list(reversed(uvs))
    return L.mesh(name, list(pts), [(0, 1, 2, 3)], mat, list(uvs))


def tri_out(L, name, pts, mat, uvs, hint):
    n = _cross(_sub(pts[1], pts[0]), _sub(pts[2], pts[0]))
    if _dot(n, hint) < 0:
        pts = list(reversed(pts))
        uvs = list(reversed(uvs))
    return L.mesh(name, list(pts), [(0, 1, 2)], mat, list(uvs))


# --------------------------------------------------------------------------
# oriented geometry for the diagonal wing walls (built per side, never mirrored)

def make_oriented(start, end):
    """Local frame for a wing wall: local +x runs start->end, local +z is the
    front normal (kept on the +Z viewer side), local +y is world +Y."""
    dx, dz = end[0] - start[0], end[2] - start[2]
    length = math.hypot(dx, dz)
    lx = (dx / length, 0.0, dz / length)
    lz = (-dz / length, 0.0, dx / length)
    if lz[2] < 0:
        lz = (-lz[0], 0.0, -lz[2])
    return length, lx, lz


def local_to_world(start, lx, lz, p):
    return (start[0] + lx[0] * p[0] + lz[0] * p[2],
            p[1],
            start[2] + lx[2] * p[0] + lz[2] * p[2])


def obox(L, name, start, lx, lz, center_local, size_local, mat, collision=False, bevel=0.008):
    """Oriented box on a wing-wall frame. Built as a connected 8-vertex box
    (helpers.box_glb: metric loop UVs, bevel, outward normals), then yawed as
    an object. Collision record is a world-space OBB (theta = GLB yaw about +Y
    that maps +X onto lx), with the center pre-rotated so obbToWorld()
    reproduces the world box exactly."""
    yaw = math.atan2(-lx[2], lx[0])
    vx = lx[0] * center_local[0] + lz[0] * center_local[2]
    vz = lx[2] * center_local[0] + lz[2] * center_local[2]
    world_c = (start[0] + vx, center_local[1], start[2] + vz)
    o = L.tag(box_glb(name, world_c, size_local, L.M[mat],
                      L.META[L.M[mat].name]['tileMeters'], bevel))
    o.rotation_euler = (0.0, 0.0, -yaw)  # GLB +Y yaw -> Blender -Z yaw
    if collision:
        ct, st = math.cos(yaw), math.sin(yaw)
        # obbToWorld computes pos + R(theta)*center; store R(-theta)*world_c
        center_stored = [ct * world_c[0] - st * world_c[2], world_c[1],
                         st * world_c[0] + ct * world_c[2]]
        s = [abs(size_local[0]), abs(size_local[1]), abs(size_local[2])]
        reach = [s[0] * abs(ct) + s[2] * abs(st), s[1], s[0] * abs(st) + s[2] * abs(ct)]
        L.COLL.append({'name': name, 'group': L.GROUP, 'type': 'box',
                       'min': [world_c[0] - reach[0] / 2, world_c[1] - reach[1] / 2, world_c[2] - reach[2] / 2],
                       'max': [world_c[0] + reach[0] / 2, world_c[1] + reach[1] / 2, world_c[2] + reach[2] / 2],
                       'obb': {'pos': [0, 0, 0], 'theta': yaw,
                               'center': center_stored, 'size': list(size_local)}})
    return o


# --------------------------------------------------------------------------
# center roof: hip shell with short ridge, corner lift, closed underside

def center_roof(L, rc):
    hw = rc['widthM'] / 2
    ridge_y = rc['ridgeY']
    ridge_half = rc['ridgeLengthM'] / 2
    z_mid = rc['ridgeZ']
    zf, zr = rc['frontEaveZ'], rc['rearEaveZ']
    eave_y = rc['frontEaveY']
    lift = rc['cornerLiftM']
    lift_start = rc['cornerLiftStartX']
    thick = rc['shellThicknessM']
    seg = rc['resampleSegments']
    drops = drop_lut(rc['halfSlopeProfileTY'], seg)
    nu = 12

    def top_y(x):
        a = abs(x)
        if a <= ridge_half:
            return ridge_y
        w = (a - ridge_half) / max(1e-6, hw - ridge_half)
        w = w * w * (3 - 2 * w)  # smoothstep hip beyond the ridge ends
        return ridge_y + (rc['hipEndTopY'] - ridge_y) * w

    def eave_y_at(x):
        a = abs(x)
        k = max(0.0, (a - lift_start) / max(1e-6, hw - lift_start))
        return eave_y + lift * k * k

    for side in (1, -1):
        z_end = zf if side > 0 else zr
        run = abs(z_end - z_mid)
        grid_t, grid_b, uvs = [], [], []
        for j in range(seg + 1):
            t = j / seg
            d = drops[j]
            for i in range(nu + 1):
                x = -hw + 2 * hw * i / nu
                ty, ey = top_y(x), eave_y_at(x)
                y = ty - (ty - ey) * d
                grid_t.append((x, y, z_mid + side * run * t))
                grid_b.append((x, y - thick, z_mid + side * run * t))
                uvs.append((x / 1.44, run * t / 1.36))
        n = len(grid_t)
        faces = []
        for j in range(seg):
            for i in range(nu):
                a = j * (nu + 1) + i
                b, c, dd = a + 1, a + nu + 2, a + nu + 1
                # top surface +Y, underside (offset block) reversed
                faces.append((a, dd, c, b) if side > 0 else (a, b, c, dd))
                faces.append((n + a, n + b, n + c, n + dd) if side > 0 else (n + a, n + dd, n + c, n + b))
        # hip-end rings: close the shell sides at x = +/-hw
        for i_col, hint in ((0, (-1, 0, 0)), (nu, (1, 0, 0))):
            for j in range(seg):
                a = j * (nu + 1) + i_col
                a2 = (j + 1) * (nu + 1) + i_col
                quad_out(L, 'center-roof-hip-ring',
                         [grid_t[a], grid_t[a2], grid_b[a2], grid_b[a]], 'roof',
                         [(j / seg * run / 1.44, 0), ((j + 1) / seg * run / 1.44, 0),
                          ((j + 1) / seg * run / 1.44, .12), (j / seg * run / 1.44, .12)], hint)
        L.mesh('center-roof-shell', grid_t + grid_b, faces, 'roof', uvs + uvs)
        # eave fascia: closes the shell edge top->bottom along the outer row
        hint = (0, 0, 1) if side > 0 else (0, 0, -1)
        for i in range(nu):
            a = seg * (nu + 1) + i
            quad_out(L, 'center-roof-eave-fascia',
                     [grid_t[a], grid_t[a + 1], grid_b[a + 1], grid_b[a]],
                     'dark',
                     [(grid_t[a][0] / 1.44, 0), (grid_t[a + 1][0] / 1.44, 0),
                      (grid_t[a + 1][0] / 1.44, .1), (grid_t[a][0] / 1.44, .1)], hint)
    L.cyl('center-ridge-roll', (-ridge_half, ridge_y + .06, z_mid), (ridge_half, ridge_y + .06, z_mid),
          .11, 'roof', 10)
    L.box('center-ridge-base', (0, ridge_y - .02, z_mid), (ridge_half * 2 + .18, .13, .34), 'roof', .01)


# --------------------------------------------------------------------------
# shoulder roof: continuous shell from the front outline, ridge, rear eave

def shoulder_roof(L, rs, side, profile_samples):
    x0, x1 = rs['xSpans'][1 if side > 0 else 0]
    outline = monotone_cubic(rs['frontOutlineAbsXY'])
    ridge_y = rs['ridgeY']
    z_mid = rs['ridgeZ']
    zf, zr = rs['frontEaveZ'], rs['rearEaveZ']
    rear_drop = rs['rearEaveDropFromFront']
    thick = rs['shellThicknessM']
    seg = rs['resampleSegments']
    drops = drop_lut(profile_samples, seg)
    nu = 10
    xa = rs['frontOutlineAbsXY'][0][0]

    def sect(x):
        f = outline(min(max(abs(x), xa), rs['frontOutlineAbsXY'][-1][0]))
        return f, max(ridge_y, f + .02), f - rear_drop

    for sdir in (1, -1):
        z_end = zf if sdir > 0 else zr
        run = abs(z_end - z_mid)
        grid_t, grid_b, uvs = [], [], []
        for j in range(seg + 1):
            t = j / seg
            d = drops[j]
            for i in range(nu + 1):
                x = x0 + (x1 - x0) * i / nu
                f, g, r = sect(x)
                ey = f if sdir > 0 else r
                y = g - (g - ey) * d
                grid_t.append((x, y, z_mid + sdir * run * t))
                grid_b.append((x, y - thick, z_mid + sdir * run * t))
                uvs.append((x / 1.44, run * t / 1.36))
        n = len(grid_t)
        faces = []
        for j in range(seg):
            for i in range(nu):
                a = j * (nu + 1) + i
                b, c, dd = a + 1, a + nu + 2, a + nu + 1
                faces.append((a, dd, c, b) if sdir > 0 else (a, b, c, dd))
                faces.append((n + a, n + b, n + c, n + dd) if sdir > 0 else (n + a, n + dd, n + c, n + b))
        # inner edge ring tucks under the central shell (still closed, not open)
        for j in range(seg):
            a = j * (nu + 1)
            a2 = (j + 1) * (nu + 1)
            quad_out(L, 'shoulder-inner-ring',
                     [grid_t[a], grid_t[a2], grid_b[a2], grid_b[a]], 'roof',
                     [(j / seg * run / 1.44, 0), ((j + 1) / seg * run / 1.44, 0),
                      ((j + 1) / seg * run / 1.44, .12), (j / seg * run / 1.44, .12)],
                     (-1 if side > 0 else 1, 0, 0))
        L.mesh('shoulder-roof-shell', grid_t + grid_b, faces, 'roof', uvs + uvs)
        hint = (0, 0, 1) if sdir > 0 else (0, 0, -1)
        for i in range(nu):
            a = seg * (nu + 1) + i
            quad_out(L, 'shoulder-eave-fascia',
                     [grid_t[a], grid_t[a + 1], grid_b[a + 1], grid_b[a]],
                     'dark',
                     [(grid_t[a][0] / 1.44, 0), (grid_t[a + 1][0] / 1.44, 0),
                      (grid_t[a + 1][0] / 1.44, .1), (grid_t[a][0] / 1.44, .1)], hint)
    # outer rising edge (wing-tip sweep) + verge caps, built per slope half
    for sdir in (1, -1):
        z_end = zf if sdir > 0 else zr
        run = abs(z_end - z_mid)
        edge = []
        for j in range(seg + 1):
            t = j / seg
            x = x1
            f, g, r = sect(x)
            ey = f if sdir > 0 else r
            edge.append((x, g - (g - ey) * drops[j], z_mid + sdir * run * t))
        hint = (1 if side > 0 else -1, 0, 0)
        xw = x1 + (0.006 if side > 0 else -0.006)  # proud of the shell edge plane
        for a, b in zip(edge, edge[1:]):
            quad_out(L, 'shoulder-wing-edge',
                     [(xw, a[1] - .02, a[2]), (xw, b[1] - .02, b[2]),
                      (xw, b[1] - .27, b[2]), (xw, a[1] - .27, a[2])],
                     'dark',
                     [(a[2] / 1.44, 0), (b[2] / 1.44, 0), (b[2] / 1.44, .2), (a[2] / 1.44, .2)], hint)
            L.rod('shoulder-wing-edge-cap', (a[0], a[1] + .02, a[2]), (b[0], b[1] + .02, b[2]), .07, 'roof')


# --------------------------------------------------------------------------
# door frame: columns, lintel band, interior reveals, open-folded lattice leaves

def shoulder_surface_y(rs, profile_samples, x, z):
    """Continuous top-surface height of a shoulder shell at world (x, z) —
    used to tuck closure walls under the shell. Mirrors shoulder_roof math."""
    outline = monotone_cubic(rs['frontOutlineAbsXY'])
    xa = rs['frontOutlineAbsXY'][0][0]
    f = outline(min(max(abs(x), xa), rs['frontOutlineAbsXY'][-1][0]))
    g = max(rs['ridgeY'], f + .02)
    r = f - rs['rearEaveDropFromFront']
    y_profile = monotone_cubic(profile_samples)
    y0, y1 = y_profile(0.0), y_profile(1.0)
    drop = lambda t: max(0.0, min(1.0, (y0 - y_profile(t)) / (y0 - y1)))  # noqa: E731
    z_mid, zf, zr = rs['ridgeZ'], rs['frontEaveZ'], rs['rearEaveZ']
    if z >= z_mid:
        t = (z - z_mid) / (zf - z_mid)
        return g - (g - f) * drop(min(1.0, max(0.0, t)))
    t = (z_mid - z) / (z_mid - zr)
    return g - (g - r) * drop(min(1.0, max(0.0, t)))


def door_frame(L, fr, op):
    sz = fr['stoneColumnSize']
    cz = fr['stoneColumnZ']
    lint_y0, lint_y1 = fr['lintelBandY']
    for row_z in (cz, fr['rearColumnZ']):
        for sx in fr['stoneColumnX']:
            L.box('stone-column', (sx, sz[1] / 2, row_z), (sz[0], sz[1], sz[2]), 'stone', .012, True)
            ps = fr['plinthSize']
            off = fr.get('plinthOffsetOutM', 0.0)
            L.box('stone-plinth', (sx + (1 if sx > 0 else -1) * off, ps[1] / 2, row_z),
                  (ps[0], ps[1], ps[2]), 'stone', .014, True)
    span = max(abs(fr['stoneColumnX'][0]), abs(fr['stoneColumnX'][1])) + sz[0] / 2
    L.box('door-lintel-beam', (0, (lint_y0 + lint_y1) / 2, cz), (2 * span, lint_y1 - lint_y0, sz[2] + .06),
          'wood', .01, True)
    # bottom trim just above the clear opening (the plaque sits on the lintel top)
    L.box('door-lintel-trim', (0, lint_y0 + .04, cz), (2 * span - .2, .08, sz[2] - .10), 'dark', .008)
    # interior reveal walls closing the passage sides between the column rows
    for sgn in (-1, 1):
        x_lo, x_hi = sorted((sgn * fr['revealWallX'][0], sgn * fr['revealWallX'][1]))
        z_a, z_b = cz - sz[2] / 2, -fr['depthM']
        L.box('passage-reveal-wall',
              ((x_lo + x_hi) / 2, fr['revealWallTopY'] / 2, (z_a + z_b) / 2),
              (x_hi - x_lo, fr['revealWallTopY'], abs(z_b - z_a)), 'dark', 0, True)
    # open lattice leaves folded flat against the side bays, outside the corridor
    leaf = op['doorLeaves']
    for sgn in (-1, 1):
        x_in = sgn * (op['clearWidthM'] / 2)
        cx_l = x_in + sgn * leaf['leafWidthM'] / 2
        zc = leaf['standoffZ'] + leaf['leafThicknessM'] / 2
        L.box('lattice-door-leaf', (cx_l, leaf['leafHeightM'] / 2 + .05, zc),
              (leaf['leafWidthM'], leaf['leafHeightM'], leaf['leafThicknessM']), 'dark', 0, True)
        for k in range(1, 6):
            L.box('leaf-lattice-bar', (x_in + sgn * leaf['leafWidthM'] * k / 6,
                                       leaf['leafHeightM'] / 2 + .05, zc + leaf['leafThicknessM'] / 2 + .012),
                  (.035, leaf['leafHeightM'] - .22, .024), 'wood', 0)
        for k in range(4):
            L.box('leaf-lattice-rail', (cx_l, .35 + k * (leaf['leafHeightM'] - .5) / 3,
                                        zc + leaf['leafThicknessM'] / 2 + .012),
                  (leaf['leafWidthM'] - .12, .05, .024), 'wood', 0)
        L.box('leaf-frame-edge', (x_in + sgn * .045, leaf['leafHeightM'] / 2 + .05, zc),
              (.09, leaf['leafHeightM'], leaf['leafThicknessM'] + .05), 'wood', .006)


# --------------------------------------------------------------------------
# wing wall: oriented stone wall, frame grid, relief panel, tile cap

def wing_wall(L, w, side):
    start = w[f'{side}Start']
    end = w[f'{side}End']
    length, lx, lz = make_oriented(start, end)
    h = w['heightM']
    t = w['thicknessM']
    cap_max = w['tileCapMaxY']
    pw, ph = w['panelWH']
    pcx = w['panelCenterAlongWallFrac'] * length
    fz = t / 2

    obox(L, 'wing-wall-body', start, lx, lz, (length / 2, h / 2, 0), (length, h, t), 'stone', True)
    obox(L, 'wing-base-course', start, lx, lz, (length / 2, .14, 0), (length, .28, t + .07), 'stone', True)
    obox(L, 'wing-coping', start, lx, lz, (length / 2, h - .02, 0), (length, .16, t + .06), 'stone')

    fw = .16
    pcy = .5 + ph / 2
    for u0, v0, uw, vh, name in [
        (pcx - pw / 2 - fw, .5, fw, ph + 2 * fw, 'wing-frame-left'),
        (pcx + pw / 2, .5, fw, ph + 2 * fw, 'wing-frame-right'),
        (pcx - pw / 2 - fw, .5 - fw, pw + 2 * fw, fw, 'wing-frame-bottom'),
        (pcx - pw / 2 - fw, .5 + ph, pw + 2 * fw, fw, 'wing-frame-top'),
    ]:
        obox(L, name, start, lx, lz, (u0 + uw / 2, v0 + vh / 2, fz + .012), (uw, vh, .024), 'stone')
    for v in (1.62, 2.98):
        obox(L, 'wing-field-band', start, lx, lz, (length / 2, v, fz + .008), (length - .3, .09, .016), 'stone')

    # relief panel: exact 0..1 UV plate (square normal texture) on the front face
    pts = [local_to_world(start, lx, lz, p) for p in [
        (pcx - pw / 2, pcy - ph / 2, fz + .015), (pcx + pw / 2, pcy - ph / 2, fz + .015),
        (pcx + pw / 2, pcy + ph / 2, fz + .015), (pcx - pw / 2, pcy + ph / 2, fz + .015)]]
    quad_out(L, 'wing-relief-panel', pts, 'relief',
             [(0, 0), (1, 0), (1, 1), (0, 1)], lz)
    # proud diamond strips + corner bosses (geometry, not texture)
    dw, dv = pw * .30, ph * .30
    for (u0, v0, uw, vh) in [
        (pcx - dw, pcy - dv, dw * 2, .05), (pcx - dw, pcy + dv - .05, dw * 2, .05),
        (pcx - dw, pcy - dv, .05, dv * 2), (pcx + dw - .05, pcy - dv, .05, dv * 2),
    ]:
        obox(L, 'wing-diamond-strip', start, lx, lz, (u0 + uw / 2, v0 + vh / 2, fz + .04),
             (uw, vh, w['reliefDepthM'][1]), 'stone')
    for du, dv2 in ((-dw, -dv), (dw, -dv), (-dw, dv), (dw, dv)):
        obox(L, 'wing-corner-boss', start, lx, lz, (pcx + du, pcy + dv2, fz + .048),
             (.09, .09, .08), 'stone')

    # tile cap: two sloped quads meeting at a ridge line following the wall
    ov = .10
    base_y = h + .05
    for sdir in (-1, 1):
        p = [local_to_world(start, lx, lz, q) for q in [
            (-ov, base_y, sdir * (t / 2 + ov)), (length + ov, base_y, sdir * (t / 2 + ov)),
            (length + ov, cap_max, 0), (-ov, cap_max, 0)]]
        quad_out(L, 'wing-tile-cap', p, 'roof',
                 [(-ov / 1.44, 0), ((length + ov) / 1.44, 0),
                  ((length + ov) / 1.44, .32), (-ov / 1.44, .32)], (0, 1, 0))
    for u, hint_sign in ((-ov, -1), (length + ov, 1)):
        pts = [local_to_world(start, lx, lz, q) for q in
               [(u, base_y, -(t / 2 + ov)), (u, base_y, t / 2 + ov), (u, cap_max, 0)]]
        tri_out(L, 'wing-cap-end', pts, 'dark',
                [(0, 0), (.3, 0), (.15, .32)], (hint_sign * lx[0], 0, hint_sign * lx[2]))
    a = local_to_world(start, lx, lz, (-ov, cap_max + .03, 0))
    b = local_to_world(start, lx, lz, (length + ov, cap_max + .03, 0))
    L.cyl('wing-cap-ridge-roll', a, b, .075, 'roof', 8)
