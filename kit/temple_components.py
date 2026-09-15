"""Shared temple components: profile-lofted roof shells, door frame, wing walls.

Everything runs inside Blender on top of mb_lib (same GLB-coordinate contract:
Y up, facade +Z, origin at the central threshold front edge). Design values
come from kit/temple-shanmen.config.json; nothing here invents dimensions.

Roof method (DESIGN.md constraint): ONE continuous thin shell per roof band,
lofted from the JSON section profile resampled to 10-16 segments — never
stacks of boxes faking a curve. Shells are true slabs: top surface, closed
underside offset along the surface normal, and edge closures.

T2 repair (lead review 20260915): wing walls use ONE explicit right-handed
local frame (lx, +Y, lz = lx x ly) shared by the wall body, every decoration,
the tile cap and the OBB collision record. The viewer-facing side is
`front` (+1 or -1) — never a handedness flip. The Blender object yaw is
GLB-yaw signed (+Z in Blender for +Y in GLB), fixing the old mirrored walls.

T3 repair (DESIGN_REVISION.json): shoulder shells follow
  baseY(t) = ridgeY - (ridgeY-eaveBaselineY)*drop(t)
  y(x,t)   = baseY(t) + (frontOutline(|x|)-eaveBaselineY)*smoothstep(0.5,1,t)^2
The ridge line stays at exactly ridgeY for every shoulder x; the outline lift
lives only toward the eaves (t>=0.5). Rear eave keeps the 0.18m drop. There is
no max(ridgeY, outline) elevation anywhere.
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
        return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * m[i + 1]

    return y


def drop_lut(profile_samples, segments):
    """Normalized drop 0..1 from a half-slope profile [[t,y],...]:
    drop(ridge)=0, drop(eave)=1, same concavity as the section samples."""
    y = monotone_cubic(profile_samples)
    y0, y1 = y(0.0), y(1.0)
    span = y0 - y1
    return [max(0.0, min(1.0, (y0 - y(j / segments)) / span)) for j in range(segments + 1)]


def make_drop_fn(profile_samples, segments):
    """Continuous drop(t): piecewise-linear over drop_lut samples. Exact at the
    grid knots t=j/segments, so shells sampled on the grid and analytic surface
    functions share bit-identical values."""
    lut = drop_lut(profile_samples, segments)

    def drop(t):
        t = max(0.0, min(1.0, t))
        u = t * segments
        i = min(segments - 1, int(u))
        return lut[i] + (lut[i + 1] - lut[i]) * (u - i)

    return drop


def smoothstep(edge0, edge1, x):
    t = max(0.0, min(1.0, (x - edge0) / max(1e-9, edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


# --------------------------------------------------------------------------
# small vector helpers on GLB triples

def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a):
    l = math.sqrt(_dot(a, a))
    return (a[0] / l, a[1] / l, a[2] / l)


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
# T2: oriented geometry for the diagonal wing walls (built per side, never
# mirrored). ONE right-handed frame: lx along start->end, ly = world +Y,
# lz = lx x ly (proper rotation, det +1, winding preserved). `front` is the
# sign that puts a local +z offset on the viewer (+Z world) side.

def make_oriented(start, end):
    dx, dz = end[0] - start[0], end[2] - start[2]
    length = math.hypot(dx, dz)
    lx = (dx / length, 0.0, dz / length)
    lz = (-dz / length, 0.0, dx / length)  # = lx x (0,1,0); never flipped
    front = 1 if lz[2] > 0 else -1
    return length, lx, lz, front


def local_to_world(start, lx, lz, p):
    return (start[0] + lx[0] * p[0] + lz[0] * p[2],
            p[1],
            start[2] + lx[2] * p[0] + lz[2] * p[2])


def obox(L, name, start, lx, lz, center_local, size_local, mat, collision=False, bevel=0.008):
    """Oriented box on a wing-wall frame. Built as a connected 8-vertex box
    (helpers.box_glb: metric loop UVs, bevel, outward normals), then yawed as
    an object with the GLB-correct sign: GLB(x,y,z)->Blender(x,-z,y) maps a
    +Y GLB yaw to the SAME-signed +Z Blender yaw. Collision record is a
    world-space OBB (theta = GLB yaw about +Y mapping +X onto lx), with the
    center pre-rotated so obbToWorld() reproduces the world box exactly."""
    yaw = math.atan2(-lx[2], lx[0])
    vx = lx[0] * center_local[0] + lz[0] * center_local[2]
    vz = lx[2] * center_local[0] + lz[2] * center_local[2]
    world_c = (start[0] + vx, center_local[1], start[2] + vz)
    o = L.tag(box_glb(name, world_c, size_local, L.M[mat],
                      L.META[L.M[mat].name]['tileMeters'], bevel))
    o.rotation_euler = (0.0, 0.0, yaw)  # GLB +Y yaw == Blender +Z yaw (same sign)
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
# surface functions (single source of truth for shells, closures and tests)

def center_surface_fn(rc, profile_samples):
    """Top surface of the center hip shell, y(x, z), mirroring center_roof()."""
    hw = rc['widthM'] / 2
    ridge_y = rc['ridgeY']
    ridge_half = rc['ridgeLengthM'] / 2
    z_mid = rc['ridgeZ']
    zf, zr = rc['frontEaveZ'], rc['rearEaveZ']
    eave_y = rc['frontEaveY']
    lift = rc['cornerLiftM']
    lift_start = rc['cornerLiftStartX']
    drop = make_drop_fn(profile_samples, rc['resampleSegments'])

    def top_y(x):
        a = abs(x)
        if a <= ridge_half:
            return ridge_y
        # clamped smoothstep: stays inside [ridge, hipEndTopY] even if probed
        # beyond the shell half-width (seam skirts sample this function)
        return ridge_y + (rc['hipEndTopY'] - ridge_y) * smoothstep(ridge_half, hw, a)

    def eave_y_at(x):
        a = abs(x)
        k = min(1.0, max(0.0, (a - lift_start) / max(1e-6, hw - lift_start)))
        return eave_y + lift * k * k

    def y(x, z):
        if z >= z_mid:
            t = min(1.0, max(0.0, (z - z_mid) / (zf - z_mid)))
        else:
            t = min(1.0, max(0.0, (z_mid - z) / (z_mid - zr)))
        ty, ey = top_y(x), eave_y_at(x)
        return ty - (ty - ey) * drop(t)

    return y


def shoulder_surface_fn(rs, profile_samples):
    """T3 DESIGN_REVISION equation. Front silhouette (t=1) is exactly the
    outline; ridge (t=0) is exactly ridgeY for every shoulder x; the outline
    lift decays as smoothstep(0.5,1,t)^2 so nothing is extruded along the
    depth. Rear eave keeps rearEaveDropFromFront."""
    outline = monotone_cubic(rs['frontOutlineAbsXY'])
    xa = rs['frontOutlineAbsXY'][0][0]
    xb = rs['frontOutlineAbsXY'][-1][0]
    ridge_y = rs['ridgeY']
    base = rs['eaveBaselineY']
    rear_drop = rs['rearEaveDropFromFront']
    z_mid, zf, zr = rs['ridgeZ'], rs['frontEaveZ'], rs['rearEaveZ']
    drop = make_drop_fn(profile_samples, rs['resampleSegments'])

    def y(x, z):
        f = outline(min(max(abs(x), xa), xb))
        if z >= z_mid:
            t = min(1.0, max(0.0, (z - z_mid) / (zf - z_mid)))
            outline_eave, baseline_eave = f, base
        else:
            t = min(1.0, max(0.0, (z_mid - z) / (z_mid - zr)))
            outline_eave, baseline_eave = f - rear_drop, base - rear_drop
        base_y = ridge_y - (ridge_y - baseline_eave) * drop(t)
        lift = (outline_eave - baseline_eave) * smoothstep(0.5, 1.0, t) ** 2
        return base_y + lift

    return y


def _surface_normal(f, x, z, h=0.01):
    dydx = (f(x + h, z) - f(x - h, z)) / (2 * h)
    dydz = (f(x, z + h) - f(x, z - h)) / (2 * h)
    return _norm((-dydx, 1.0, -dydz))


# --------------------------------------------------------------------------
# center roof: hip shell with short ridge, corner lift, closed underside

def center_roof(L, rc, profile_samples=None):
    hw = rc['widthM'] / 2
    ridge_y = rc['ridgeY']
    ridge_half = rc['ridgeLengthM'] / 2
    z_mid = rc['ridgeZ']
    zf, zr = rc['frontEaveZ'], rc['rearEaveZ']
    thick = rc['shellThicknessM']
    seg = rc['resampleSegments']
    surface = center_surface_fn(rc, profile_samples if profile_samples else rc['halfSlopeProfileTY'])
    nu = 12

    for side in (1, -1):
        z_end = zf if side > 0 else zr
        run = abs(z_end - z_mid)
        grid_t, grid_b, uvs = [], [], []
        for j in range(seg + 1):
            t = j / seg
            for i in range(nu + 1):
                x = -hw + 2 * hw * i / nu
                y = surface(x, z_mid + side * run * t)
                n = _surface_normal(surface, x, z_mid + side * run * t)
                grid_t.append((x, y, z_mid + side * run * t))
                grid_b.append((x, y - thick * n[1], z_mid + side * run * t - thick * n[2]))
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
    L.box('center-ridge-base', (0, ridge_y - .02, z_mid), (ridge_half * 2 + .18, .13, .52), 'roof', .01)


# --------------------------------------------------------------------------
# shoulder roof: T3 equation shell, normal-offset soffit, real seam closure

def shoulder_roof(L, rs, side, profile_samples, center_srf=None):
    span = rs['xSpans'][1 if side > 0 else 0]
    x_lo, x_hi = min(span), max(span)  # grid always runs +x so winding stays fixed
    x_in = x_lo if abs(x_lo) < abs(x_hi) else x_hi   # seam edge (nearest center)
    x_out = x_hi if abs(x_lo) < abs(x_hi) else x_lo  # wing-tip sweep edge
    nu = 10
    i_in = 0 if x_in == x_lo else nu  # column index of the seam edge
    ridge_y = rs['ridgeY']
    z_mid = rs['ridgeZ']
    zf, zr = rs['frontEaveZ'], rs['rearEaveZ']
    thick = rs['shellThicknessM']
    seg = rs['resampleSegments']
    surface = shoulder_surface_fn(rs, profile_samples)

    for sdir in (1, -1):
        z_end = zf if sdir > 0 else zr
        run = abs(z_end - z_mid)
        grid_t, grid_b, uvs = [], [], []
        for j in range(seg + 1):
            t = j / seg
            for i in range(nu + 1):
                x = x_lo + (x_hi - x_lo) * i / nu
                z = z_mid + sdir * run * t
                y = surface(x, z)
                n = _surface_normal(surface, x, z)
                grid_t.append((x, y, z))
                grid_b.append((x, y - thick * n[1], z - thick * n[2]))
                uvs.append((x / 1.44, run * t / 1.36))
        n = len(grid_t)
        faces = []
        for j in range(seg):
            for i in range(nu):
                a = j * (nu + 1) + i
                b, c, dd = a + 1, a + nu + 2, a + nu + 1
                faces.append((a, dd, c, b) if sdir > 0 else (a, b, c, dd))
                faces.append((n + a, n + b, n + c, n + dd) if sdir > 0 else (n + a, n + dd, n + c, n + b))
        # seam-edge ring (column i_in) tucks under the central shell; closed,
        # not open — on the seam edge for BOTH sides (the old left build
        # closed the outer edge instead)
        for j in range(seg):
            a = j * (nu + 1) + i_in
            a2 = (j + 1) * (nu + 1) + i_in
            quad_out(L, 'shoulder-inner-ring',
                     [grid_t[a], grid_t[a2], grid_b[a2], grid_b[a]], 'roof',
                     [(j / seg * run / 1.44, 0), ((j + 1) / seg * run / 1.44, 0),
                      ((j + 1) / seg * run / 1.44, .12), (j / seg * run / 1.44, .12)],
                     (-side, 0, 0))
        L.mesh('shoulder-roof-shell', grid_t + grid_b, faces, 'roof', uvs + uvs)
        hint = (0, 0, 1) if sdir > 0 else (0, 0, -1)
        for i in range(nu):
            a = seg * (nu + 1) + i
            quad_out(L, 'shoulder-eave-fascia',
                     [grid_t[a], grid_t[a + 1], grid_b[a + 1], grid_b[a]],
                     'dark',
                     [(grid_t[a][0] / 1.44, 0), (grid_t[a + 1][0] / 1.44, 0),
                      (grid_t[a + 1][0] / 1.44, .1), (grid_t[a][0] / 1.44, .1)], hint)
    # outer rising edge (wing-tip sweep at x_out, now localized to the eave
    # third) + caps
    for sdir in (1, -1):
        z_end = zf if sdir > 0 else zr
        run = abs(z_end - z_mid)
        edge = [(x_out, surface(x_out, z_mid + sdir * run * j / seg), z_mid + sdir * run * j / seg)
                for j in range(seg + 1)]
        hint = (side, 0, 0)
        xw = x_out + side * 0.006  # proud of the shell edge plane
        for a, b in zip(edge, edge[1:]):
            quad_out(L, 'shoulder-wing-edge',
                     [(xw, a[1] - .02, a[2]), (xw, b[1] - .02, b[2]),
                      (xw, b[1] - .27, b[2]), (xw, a[1] - .27, a[2])],
                     'dark',
                     [(a[2] / 1.44, 0), (b[2] / 1.44, 0), (b[2] / 1.44, .2), (a[2] / 1.44, .2)], hint)
            L.rod('shoulder-wing-edge-cap', (a[0], a[1] + .02, a[2]), (b[0], b[1] + .02, b[2]), .07, 'roof')
    # real seam closure: skirt from the shoulder inner top edge up under the
    # central shell soffit, so the junction reads closed (no horizontal shelf
    # or see-through band between the two shells).
    if center_srf is not None:
        shoulder_seam_skirt(L, rs, side, surface, center_srf)


def shoulder_seam_skirt(L, rs, side, shoulder_srf, center_srf):
    span = rs['xSpans'][1 if side > 0 else 0]
    x0 = span[0] if abs(span[0]) < abs(span[1]) else span[1]  # seam edge
    xs = x0 + side * .02
    zf, zr, zm = rs['frontEaveZ'], rs['rearEaveZ'], rs['ridgeZ']
    seg = rs['resampleSegments']
    c_thick = .12  # center shellThicknessM; sampled soffit = top - thickness
    for sdir in (1, -1):
        z_end = zf if sdir > 0 else zr
        run = abs(z_end - zm)
        for j in range(seg):
            z1 = zm + sdir * run * j / seg
            z2 = zm + sdir * run * (j + 1) / seg
            y1 = shoulder_srf(x0, z1) - .01
            y2 = shoulder_srf(x0, z2) - .01
            c1 = max(y1, center_srf(xs, z1) - c_thick - .02)
            c2 = max(y2, center_srf(xs, z2) - c_thick - .02)
            if c1 - y1 < .005 and c2 - y2 < .005:
                continue  # already tucked under the center shell here
            v = min((y1 + c1) / 2, (y2 + c2) / 2)
            quad_out(L, 'shoulder-seam-skirt',
                     [(xs, y1, z1), (xs, y2, z2), (xs, c2, z2), (xs, c1, z1)], 'dark',
                     [(z1 / 1.44, y1 / 1.36), (z2 / 1.44, y2 / 1.36),
                      (z2 / 1.44, c2 / 1.36), (z1 / 1.44, c1 / 1.36)], (side, 0, 0))
            quad_out(L, 'shoulder-seam-skirt-inner',
                     [(xs, y1, z1), (xs, y2, z2), (xs, c2, z2), (xs, c1, z1)], 'dark',
                     [(z1 / 1.44, y1 / 1.36), (z2 / 1.44, y2 / 1.36),
                      (z2 / 1.44, c2 / 1.36), (z1 / 1.44, c1 / 1.36)], (-side, 0, 0))


# --------------------------------------------------------------------------
# T3 tile ribs: finite continuous half-round tubes following the slope

def rib_tube(L, name, surface, x, t0, t1, z_mid, z_end, r, sections, mat='roof'):
    """One half-round rib: a 6-gon tube whose centerline follows the roof
    surface offset along the surface normal (about half buried), `sections`
    straight sections, open at the ridge end (hidden) and a fan cap at the
    eave end so the eave reads as a rounded tile course in section."""
    pts = []
    for s in range(sections + 1):
        t = t0 + (t1 - t0) * s / sections
        z = z_mid + z_end * t
        y = surface(x, z)
        n = _surface_normal(surface, x, z)
        pts.append((x + n[0] * r * .55, y + n[1] * r * .55, z + n[2] * r * .55))
    tang = []
    for s in range(sections + 1):
        a = pts[max(0, s - 1)]
        b = pts[min(sections, s + 1)]
        tang.append(_norm(_sub(b, a)))
    rings = []
    for p, t_hat in zip(pts, tang):
        u = _norm((0.0, 1.0, 0.0) if abs(t_hat[1]) < .9 else (1.0, 0.0, 0.0))
        u = _norm(_sub(u, (t_hat[0] * _dot(u, t_hat), t_hat[1] * _dot(u, t_hat), t_hat[2] * _dot(u, t_hat))))
        v = _cross(t_hat, u)
        rings.append([(p[0] + r * (math.cos(k * math.pi / 3) * u[0] + math.sin(k * math.pi / 3) * v[0]),
                       p[1] + r * (math.cos(k * math.pi / 3) * u[1] + math.sin(k * math.pi / 3) * v[1]),
                       p[2] + r * (math.cos(k * math.pi / 3) * u[2] + math.sin(k * math.pi / 3) * v[2]))
                      for k in range(6)])
    verts, faces, uvs = [], [], []
    for ring in rings:
        verts.extend(ring)
        uvs.extend([((ring[k][0] + ring[k][2]) / 1.44, ring[k][1] / 1.36) for k in range(6)])
    for s in range(sections):
        for k in range(6):
            k2 = (k + 1) % 6
            a = s * 6 + k
            b = s * 6 + k2
            c = (s + 1) * 6 + k2
            d = (s + 1) * 6 + k
            faces.append((a, b, c, d))
    cap_c = len(verts)
    verts.append(pts[-1])
    uvs.append((pts[-1][0] / 1.44, pts[-1][1] / 1.36))
    end_hat = tang[-1]
    for k in range(6):
        k2 = (k + 1) % 6
        nrm = _cross(_sub(rings[-1][k2], pts[-1]), _sub(rings[-1][k], pts[-1]))
        tri = (cap_c, (sections) * 6 + k, (sections) * 6 + k2)
        if _dot(nrm, end_hat) < 0:
            faces.append(tri)
        else:
            faces.append((tri[0], tri[2], tri[1]))
    return L.mesh(name, verts, faces, mat, uvs)


def add_roof_ribs(L, roof_cfg, profile_samples):
    """Continuous tile ribs on the visible FRONT slopes only (center + both
    shoulders). Returns the rib objects so the caller can count the triangles
    against tileRibs.budgetExtraTrisMax."""
    rc, rs = roof_cfg['center'], roof_cfg['shoulders']
    tr = rs['tileRibs']
    spacing, r, sections = tr['spacingChosenM'], tr['radiusChosenM'], tr['stripSections']
    t0, t1 = .10, 1.0
    ribs = []
    center_srf = center_surface_fn(rc, profile_samples)
    run_c = rc['frontEaveZ'] - rc['ridgeZ']
    hw = rc['widthM'] / 2
    x = -hw + spacing / 2
    while x <= hw - spacing / 2 + 1e-9:
        ribs.append(rib_tube(L, 'roof-tile-rib', center_srf, x, t0, t1,
                             rc['ridgeZ'], run_c, r, sections))
        x += spacing
    sh_srf = shoulder_surface_fn(rs, profile_samples)
    run_s = rs['frontEaveZ'] - rs['ridgeZ']
    for side in (1, -1):
        x0, x1 = rs['xSpans'][1 if side > 0 else 0]
        x = min(x0, x1) + spacing / 2
        while x <= max(x0, x1) - spacing / 2 + 1e-9:
            ribs.append(rib_tube(L, 'roof-tile-rib', sh_srf, x, t0, t1,
                                 rs['ridgeZ'], run_s, r, sections))
            x += spacing
    return ribs


# --------------------------------------------------------------------------
# door frame: columns, lintel band, interior reveals, open-folded lattice leaves

def shoulder_surface_y(rs, profile_samples, x, z):
    """Continuous top-surface height of a shoulder shell at world (x, z) —
    used to tuck closure walls under the shell. Mirrors the T3 equation."""
    return shoulder_surface_fn(rs, profile_samples)(x, z)


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
# wing wall: oriented stone wall, frame grid, relief panel, tile cap.
# T2: every decoration offset uses the same right-handed frame and the
# viewer-facing sign; protrusions stay inside the design band 0.015-0.06 m.

def wing_wall(L, w, side):
    start = w[f'{side}Start']
    end = w[f'{side}End']
    length, lx, lz, front = make_oriented(start, end)
    h = w['heightM']
    t = w['thicknessM']
    cap_max = w['tileCapMaxY']
    pw, ph = w['panelWH']
    pcx = w['panelCenterAlongWallFrac'] * length
    fz = front * t / 2  # viewer-facing face plane in local z
    nf = (lz[0] * front, 0.0, lz[2] * front)  # world viewer-side normal

    obox(L, 'wing-wall-body', start, lx, lz, (length / 2, h / 2, 0), (length, h, t), 'stone', True)
    obox(L, 'wing-base-course', start, lx, lz, (length / 2, .14, 0), (length, .28, t + .07), 'stone', True)
    obox(L, 'wing-coping', start, lx, lz, (length / 2, h - .02, 0), (length, .16, t + .06), 'stone')

    fw = .16
    pcy = .5 + ph / 2
    # thin 16-24mm strips get no bevel: chamfered end faces on the rotated
    # frame produce degenerate UV derivatives (zero-length exported tangents)
    for u0, v0, uw, vh, name in [
        (pcx - pw / 2 - fw, .5, fw, ph + 2 * fw, 'wing-frame-left'),
        (pcx + pw / 2, .5, fw, ph + 2 * fw, 'wing-frame-right'),
        (pcx - pw / 2 - fw, .5 - fw, pw + 2 * fw, fw, 'wing-frame-bottom'),
        (pcx - pw / 2 - fw, .5 + ph, pw + 2 * fw, fw, 'wing-frame-top'),
    ]:
        obox(L, name, start, lx, lz, (u0 + uw / 2, v0 + vh / 2, fz + front * .012), (uw, vh, .024), 'stone', bevel=0)
    for v in (1.62, 2.98):
        obox(L, 'wing-field-band', start, lx, lz, (length / 2, v, fz + front * .008), (length - .3, .09, .016), 'stone', bevel=0)

    # relief panel: exact 0..1 UV plate (square normal texture) on the front face
    pts = [local_to_world(start, lx, lz, p) for p in [
        (pcx - pw / 2, pcy - ph / 2, fz + front * .015), (pcx + pw / 2, pcy - ph / 2, fz + front * .015),
        (pcx + pw / 2, pcy + ph / 2, fz + front * .015), (pcx - pw / 2, pcy + ph / 2, fz + front * .015)]]
    quad_out(L, 'wing-relief-panel', pts, 'relief',
             [(0, 0), (1, 0), (1, 1), (0, 1)], nf)
    # proud diamond strips + corner bosses (geometry, not texture); front
    # surfaces stay within the 0.03-0.06 m relief depth band
    dw, dv = pw * .30, ph * .30
    for (u0, v0, uw, vh) in [
        (pcx - dw, pcy - dv, dw * 2, .05), (pcx - dw, pcy + dv - .05, dw * 2, .05),
        (pcx - dw, pcy - dv, .05, dv * 2), (pcx + dw - .05, pcy - dv, .05, dv * 2),
    ]:
        obox(L, 'wing-diamond-strip', start, lx, lz, (u0 + uw / 2, v0 + vh / 2, fz + front * .035),
             (uw, vh, .05), 'stone')
    for du, dv2 in ((-dw, -dv), (dw, -dv), (-dw, dv), (dw, dv)):
        obox(L, 'wing-corner-boss', start, lx, lz, (pcx + du, pcy + dv2, fz + front * .030),
             (.09, .09, .06), 'stone')

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
