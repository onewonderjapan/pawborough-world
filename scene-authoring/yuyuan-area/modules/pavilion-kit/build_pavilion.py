"""Parametric n-gon 攒尖亭 generator (pavilion-kit, wave-1).
Blender 4.5, CPU -t 4. GLB design coords: Y-up, facade +Z, origin = platform centre at ground y=0.
Internal Blender Z-up via source-kit helpers (glb_to_blender), export export_yup=True.

Run: blender --background -t 4 --python build_pavilion.py -- --bld bld-428196085 [--norender]
Numerical authority: DESIGN_SPEC.json (spec.*), site-inputs.json (S0 derived), reference method:
asset-authoring/yuyuan-entry/v2/build.py (roof loft / tile lips / tints / reimport check).

R1 rework (2026-09-23, master review fixes):
  fix1 rect variant rebuilt in ONE footprint-aligned rect frame (u=long axis, v=short; local =
       rect rotated by +rotY, same as column placement): platform, perimeter tie/purlin rings,
       four-slope + short-ridge roof (ridge 40% of long side), 4 hip ridges landing toward the
       4 corner columns, 美人靠 parallel to the column bays (perpendicular inset), steps flush
       outside the platform edge nearest local +Z.
  fix2 rafter ends only DIRECTLY UNDER the eave (top at localEaveY-0.06 <= eave-0.05), radial
       length 0.25 (spec-length override), never above the tile lips; height follows the lifted
       eave line within the corner-reach zone (corner-sync, not fixed height).
  fix3 corner lift kernel = raised-cosine^FALLOFF along the eave perimeter (gate-v2 continuous
       walk): value LIFT at each corner, 0 at cornerReach, ZERO slope at both ends -> symmetric
       about every corner, no crease/notch at the corner point.
"""
import bpy, bmesh, sys, os, json, math, time, hashlib
from mathutils import Vector, Matrix

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
PKG = '/home/baibai/outbox/pawborough-w1-pavilion-kit-20260922'
SPEC_JSON = json.load(open(os.path.join(PKG, 'DESIGN_SPEC.json'), encoding='utf-8'))['spec']
SITE = json.load(open(os.path.join(HERE, 'site-inputs.json'), encoding='utf-8'))
SOURCE_KIT = '/home/baibai/work/onewonderjapan/pawborough-world/asset-authoring/yuyuan-entry/source-kit'
sys.path.insert(0, os.path.join(SOURCE_KIT))
from helpers import box_glb, glb_to_blender  # noqa: E402

bpy.ops.wm.read_factory_settings(use_empty=True)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
BLD = argv[argv.index('--bld') + 1] if '--bld' in argv else 'bld-428196085'
NORENDER = '--norender' in argv
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'out-pavilion-kit', 'pavilion-' + BLD)
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT, 'renders'), exist_ok=True)

S = SPEC_JSON
P = [r for r in SITE['pavilions'] if r['id'] == BLD][0]
RECT = P['variant'] == 'rect'
N = P['n']

# ---------------------------------------------------------------- derived design values (recorded in report)
PLATFORM_H = S['platform']['height']                 # 0.30
OVER_PLATFORM = S['platform']['overhangBeyondColumns']  # 0.35
COL_D = S['columns']['diameter']                     # 0.22
COL_H = S['columns']['height']                       # 2.75
BASE_D = S['columns']['baseStone']['diameter']       # 0.34
BASE_H = S['columns']['baseStone']['height']         # 0.12
BEAM_W, BEAM_H = S['beams']['tieBeam']               # 0.14 x 0.22
PURLIN = S['beams']['eavePurlin'][0]                 # 0.16
EAVE_Y = PLATFORM_H + S['roof']['eaveHeightAbovePlatform']   # 3.45 abs
OVER_EAVE = S['roof']['eaveOverhangBeyondColumns']   # 0.9
SAG = S['roof']['concaveSag']                        # 0.12
LIFT = S['roof']['cornerLift']                       # 0.55
REACH = S['roof']['cornerReach']                     # 1.2
FALLOFF = S['roof']['liftFalloffExponent']           # 2.0
RINGS = 8                                            # spec: lofted 8x6
SEGS_PER_FACET = 6
FINIAL_H, FINIAL_BASE = 0.65, 0.25
LIP_R, LIP_SPACING = 0.10, 0.24
FASCIA_H = 0.14
RAFTER_SECTIONS = (0.06, 0.06, 0.35)
RAFTER_SPACING = 0.28
SEAT_H, SEAT_DEEP, BACK_H, BACK_LEAN = 0.42, 0.32, 0.45, math.radians(12)
RAFTER_LEN = 0.25                                    # R1 fix2: radial run of the rafter end
RAFTER_DROP = 0.09                                   # rafter axis below the local eave line

if RECT:
    RX, RZ = P['Rx'], P['Rz']
    PHI = P['phi']  # footprint long axis, map angle
    # local (GLB) frame: rotate map-frame rect by +rotY -> columns sit on the footprint-aligned rect
    ROT = P['rotY']
    CR, SR = math.cos(ROT), math.sin(ROT)
    RIN_P_X, RIN_P_Z = RX + OVER_PLATFORM, RZ + OVER_PLATFORM
    RE_X, RE_Z = RX + OVER_EAVE, RZ + OVER_EAVE
    RISE = max(1.1, min(1.6, 0.5 * min(RE_X, RE_Z)))
    RIDGE_FALLBACK = True  # aspect (2Rx+1.8)/(2Rz+1.8) ~ 2:1 -> spec fallback: short ridge 40% of long side
    RH_HALF = 0.4 * RE_X          # ridge half length = 40% of the long eave side (2*RE_X) / 2
    RISE = max(1.1, min(1.6, RISE))
else:
    R = P['fit']['R']
    RIN = P['fit']['inradius']
    RE = P['fit']['eaveRadius']
    RISE = max(1.1, min(1.6, 0.5 * RE))
    COLS_XZ = P['localColumns']  # [x, z] GLB plane
    BAYS = P['bays']
    ENT = P['entranceBay']
    ENT_MID = math.radians(BAYS[ENT]['midLocalDeg'])

# R1 fix3: corner lift kernel along the eave perimeter (gate-v2 continuous walk, d = arc distance
# to the nearest corner). Raised-cosine^FALLOFF: LIFT at d=0, 0 at d=REACH, zero slope at both
# ends -> symmetric about every corner, no crease at the corner point (the old (1-d/REACH)^FALLOFF
# kernel had slope -2*LIFT/REACH at d=0 and folded the two adjacent eave segments into a notch).
def corner_f(d):
    x = min(d, REACH) / REACH
    return (0.5 * (1.0 + math.cos(math.pi * x))) ** FALLOFF


if RECT:
    def rect_pt(uv):
        """rect frame (u = footprint long axis, v = short axis; map frame) -> GLB local xz.
        local = map vector rotated by +rotY (site-inputs convention, same as column placement)."""
        u, v = uv
        return (u * CR - v * SR, u * SR + v * CR)

APEX_Y = EAVE_Y + RISE
META = {}
COLL = []


def lin(h):
    a = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in a]


WOOD_STAIN_AVG_SRGB = (68.0, 38.0, 28.2)   # measured avg of wood-stain-color.jpg (PIL, 2026-09-23)


def _srgb_lin(v255):
    v = v255 / 255.0
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4


def _tint_factor(tint_hex, avg_srgb):
    """glTF baseColorFactor x texture = product; choose factor so product averages tint_hex."""
    f = []
    for i in range(3):
        t = int(tint_hex[i * 2:i * 2 + 2], 16)
        f.append(_srgb_lin(t) / _srgb_lin(max(avg_srgb[i], 1.0)))
    return f


def mat(name, color='ffffff', rough=.8, metal=0, base=None, normal=None, tint=None,
        nstrength=.8, tile=(1, 1), alpha=None, tint_avg=None, source='constant material'):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*lin(color), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if alpha:
        m.blend_method = 'CLIP'
        t = nt.nodes.new('ShaderNodeTexImage')
        t.extension = 'REPEAT'
        t.image = bpy.data.images.load(alpha, check_existing=True)
        t.image.colorspace_settings.name = 'sRGB'
        t.image.pack()
        nt.links.new(t.outputs['Color'], p.inputs['Base Color'])
        nt.links.new(t.outputs['Alpha'], p.inputs['Alpha'])
        META[name] = {'tileMeters': list(tile), 'alpha': os.path.basename(alpha), 'doubleSided': True,
                      'roughness': rough, 'textures': {'color+alpha': os.path.basename(alpha)}, 'source': source}
        return m
    paths = {}
    if base:
        paths['color'] = base
    if normal:
        paths['normal'] = normal
    for ch, path in paths.items():
        t = nt.nodes.new('ShaderNodeTexImage')
        t.extension = 'REPEAT'
        t.image = bpy.data.images.load(path, check_existing=True)
        t.image.colorspace_settings.name = 'sRGB' if ch == 'color' else 'Non-Color'
        t.image.pack()
        if ch == 'normal':
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.inputs['Strength'].default_value = nstrength
            nt.links.new(t.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
        else:
            if tint:
                mix = nt.nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                mix.blend_type = 'MULTIPLY'
                mix.inputs['Factor'].default_value = 1.0
                fac = _tint_factor(tint, tint_avg) if tint_avg else lin(tint)
                mix.inputs[7].default_value = (*fac, 1)
                nt.links.new(t.outputs['Color'], mix.inputs[6])
                nt.links.new(mix.outputs[2], p.inputs['Base Color'])
            else:
                nt.links.new(t.outputs['Color'], p.inputs['Base Color'])
    META[name] = {'tileMeters': list(tile), 'colorSrgb': color, 'tintSrgb': tint, 'roughness': rough,
                  'metallic': metal,
                  'textures': {k: os.path.basename(v) for k, v in paths.items()},
                  'normalConvention': 'OpenGL', 'source': source}
    return m


TEXDIR = os.path.join(SOURCE_KIT, 'textures')
M = {
    'tile': mat('pav-tile', base=os.path.join(TEXDIR, 'roof-color.jpg'),
                normal=os.path.join(TEXDIR, 'roof-normal.png'), tile=(1.44, 1.36), rough=.72,
                source='source-kit analytic roof relief (project), 1.44x1.36 m/tile per spec'),
    'timber': mat('pav-timber', base=os.path.join(TEXDIR, 'wood-stain-color.jpg'),
                  tint='6a2e22', tint_avg=WOOD_STAIN_AVG_SRGB, tile=(0.6, 0.9), rough=.65,
                  source='source-kit wood-stain; glTF factor normalized so product averages 6a2e22 per spec'),
    'stone': mat('pav-grey-stone', color='8f8b83', rough=.92,
                 source='design_inference: constant grey stone for platform/steps/base stones'),
    'dark': mat('pav-dark-lacquer', color='3a3632', rough=.55,
                source='design_inference: dark eave lacquer for fascia/soffit/finial (G12 eave band)'),
    'lat-a': mat('pav-hanglo-fret', alpha=os.path.join(HERE, 'textures', 'lattice-fret.png'),
                 rough=.6, source='analytic PIL lattice A (万字 fret), new texture 1/2'),
    'lat-b': mat('pav-hanglo-slat', alpha=os.path.join(HERE, 'textures', 'lattice-slat.png'),
                 rough=.6, source='analytic PIL lattice B (直棂 slat), new texture 2/2'),
}

PART = 'body'


def tag(o, part):
    o['part'] = part
    return o


def box(name, center, size, m, part='body', collision=False, rot_y_deg=None, reachable=None):
    o = tag(box_glb(name, center, size, M[m], META[M[m].name]['tileMeters'], 0), part)
    if rot_y_deg:
        # Blender rotZ(-theta) == glTF rotY(+theta) (source-kit Y-up<->Z-up mapping)
        o.rotation_mode = 'XYZ'
        o.rotation_euler = (0.0, 0.0, math.radians(-rot_y_deg))
    if collision:
        COLL.append({'name': name, 'type': 'box', 'center': [round(v, 4) for v in center],
                     'size': [round(v, 4) for v in size], 'rotYDeg': rot_y_deg or 0.0,
                     'reachable': True if reachable is None else reachable})
    return o


def mesh(name, verts, faces, m, part='body', uvs=None, smooth=False, matobj=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([glb_to_blender(v) for v in verts], [], faces)
    me.update()
    me.materials.append(matobj if matobj else M[m])
    uv = me.uv_layers.new(name='UVMap')
    if uvs:
        for p in me.polygons:
            for li in p.loop_indices:
                uv.data[li].uv = uvs[me.loops[li].vertex_index]
    else:
        tile = META[(matobj or M[m]).name]['tileMeters']
        for p in me.polygons:
            for li in p.loop_indices:
                v = verts[me.loops[li].vertex_index]
                nn = p.normal
                ax = max(range(3), key=lambda k: abs(nn[k]))
                a, b = ((v[2], v[1]) if ax == 0 else (v[0], v[1]) if ax == 1 else (v[0], v[2]))
                uv.data[li].uv = (a / tile[0], b / tile[1])
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return tag(o, part)


def tube(name, outer, inner, m, part='body', y_top=None):
    """Closed box-section polygonal ring between outer/inner loops (same point count)."""
    n_pts = len(outer)
    verts, faces = [], []
    verts += [(*p,) for p in outer] + [(*p,) for p in inner]
    for i in range(n_pts):
        j = (i + 1) % n_pts
        faces.append((i, j, j + n_pts, i + n_pts))                       # outer wall
        faces.append((n_pts + j, n_pts + i, i, j))                       # inner wall (inward normal)
    # top and bottom rings close the section
    top_o = [(p[0], y_top, p[2]) for p in outer]
    top_i = [(p[0], y_top, p[2]) for p in inner]
    base = len(verts)
    verts += top_o + top_i
    for i in range(n_pts):
        j = (i + 1) % n_pts
        faces.append((base + i, base + j, base + n_pts + j, base + n_pts + i))     # top flat
        faces.append((j, i, base + n_pts + i, base + n_pts + j))                   # bottom flat
    return mesh(name, verts, faces, m, part)


def cyl_to(name, a, b, r, m, part='roof', sides=8, cap_a=True, cap_b=True):
    """Cylinder/rod between GLB points a-b."""
    va, vb = glb_to_blender(a), glb_to_blender(b)
    d = vb - va
    q = d.to_track_quat('Z', 'Y')
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=d.length,
                                        location=(va + vb) / 2)
    o = bpy.context.object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = q
    o.data.materials.append(M[m])
    uv = o.data.uv_layers.new(name='UVMap')
    tile = META[M[m].name]['tileMeters']
    for p in o.data.polygons:
        for li in p.loop_indices:
            co = o.data.vertices[o.data.loops[li].vertex_index].co
            nn = p.normal
            ax = max(range(3), key=lambda k: abs(nn[k]))
            uu, vv = ((-co.z, co.y) if ax == 0 else (co.x, -co.z) if ax == 1 else (co.x, co.y))
            uv.data[li].uv = (uu / tile[0], vv / tile[1])
    return tag(o, part)


def box_between(name, p0, p1, width, thick, m, part='roof', up_hint=(0, 1, 0)):
    """Box with cross-section width x thick swept from p0 to p1 (GLB coords, arbitrary direction)."""
    a, b = glb_to_blender(p0), glb_to_blender(p1)
    ax = (b - a)
    L = ax.length
    ax.normalize()
    up = Vector(up_hint)
    v = ax.cross(up)
    if v.length < 1e-6:
        v = ax.cross(Vector((1, 0, 0)))
    v.normalize()
    u = v.cross(ax).normalized()   # second cross-section axis
    A = a - v * (width / 2) - u * (thick / 2)
    verts = []
    for end in (0, L):
        for dv, du in ((0, 0), (width, 0), (width, thick), (0, thick)):
            verts.append(tuple(A + ax * end + v * dv + u * du))
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    o = mesh(name, verts, faces, m, part)
    # mesh() applied glb_to_blender to already-blender coords; undo by converting back
    me = o.data
    for vtx in me.vertices:
        vtx.co = Vector((vtx.co.x, vtx.co.z, -vtx.co.y))
    me.update()
    return o


def eave_trim(eave_loop, inner_ref):
    """Fascia + R1-fix2 rafters + tile lips along a closed eave loop (arc-length walked).

    R1 fix2: rafter ends sit DIRECTLY UNDER the eave line (axis RAFTER_DROP below the local
    lifted eave height -> top at eave-0.06 <= eave-0.05), radial run RAFTER_LEN, never above
    the tile lips; within the corner-reach zone the height follows the lifted eave (corner-sync).
    Returns the min clearance (rafter top vs eave-0.05) for the build report."""
    NE = len(eave_loop)
    margins = []
    next_lip = LIP_SPACING / 2
    next_raf = 0.0
    for i in range(NE):
        a = eave_loop[i]
        b = eave_loop[(i + 1) % NE]
        seg = math.hypot(b[0] - a[0], b[2] - a[2])
        tx, tz = (b[0] - a[0]) / seg, (b[2] - a[2]) / seg
        nx_, nz_ = -tz, tx
        # fascia 0.14 hanging from the eave line
        mesh('eave-fascia', [a, b, (b[0], b[1] - FASCIA_H, b[2]), (a[0], a[1] - FASCIA_H, a[2])],
             [(0, 3, 2, 1)], 'dark', 'roof')
        inner_pt = inner_ref[i]
        # rafters every 0.28
        pos = next_raf
        while pos < seg:
            t = pos / seg
            px, pz = a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t
            ey = a[1] + (b[1] - a[1]) * t   # lifted eave height at the rafter position
            dxi, dzi = inner_pt[0] - px, inner_pt[2] - pz
            dl = math.hypot(dxi, dzi) or 1.0
            ytip = ey - RAFTER_DROP         # axis; cross-section 0.06 -> top at ey-0.06
            tip = (px, ytip, pz)
            st = (px + dxi / dl * RAFTER_LEN, ytip, pz + dzi / dl * RAFTER_LEN)
            box_between(f'rafter-{i}-{int(pos * 100)}', st, tip,
                        RAFTER_SECTIONS[0], RAFTER_SECTIONS[1], 'timber', 'roof')
            margins.append((ey - 0.05) - (ytip + RAFTER_SECTIONS[1] / 2))
            assert margins[-1] >= -1e-9, 'R1 fix2 violated: rafter above eave-0.05'
            pos += RAFTER_SPACING
        next_raf = pos - seg
        # tile lips every 0.24
        pos = next_lip
        while pos < seg:
            t = pos / seg
            mx, my, mz = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t
            prof = []
            for rs in (-0.08, 0.08):
                for kk in range(7):
                    ang = kk * math.pi / 6
                    prof.append((mx + tx * (LIP_R * math.cos(ang)) + nx_ * rs,
                                 my + LIP_R * math.sin(ang) - 0.02,
                                 mz + tz * (LIP_R * math.cos(ang)) + nz_ * rs))
            mesh(f'tile-lip-{i}-{int(pos * 100)}', prof, [(kk, kk + 7, kk + 8, kk + 1) for kk in range(6)],
                 'tile', 'roof')
            pos += LIP_SPACING
        next_lip = pos - seg
    return margins


# ================================================================== platform + steps
GROUP = 'body'
if RECT:
    # R1 fix1: platform rect in the SAME footprint-aligned frame as the columns/roof
    # (the old build placed it axis-aligned in the local frame -> rotated vs the whole building)
    rc = [rect_pt((RIN_P_X, RIN_P_Z)), rect_pt((-RIN_P_X, RIN_P_Z)),
          rect_pt((-RIN_P_X, -RIN_P_Z)), rect_pt((RIN_P_X, -RIN_P_Z))]
    corners = [(x, PLATFORM_H, z) for x, z in rc]
    lo = [(x, 0, z) for x, z in rc]
    mesh('platform', lo + corners,
         [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7), (3, 2, 1, 0)],
         'stone', 'body')
    # steps flush OUTSIDE the platform edge whose outward normal is nearest local +Z (facade)
    side_rect = [(1, 0), (0, 1), (-1, 0), (0, -1)]
    best, STEP_SIDE = -2.0, 0
    for si, (nu, nv) in enumerate(side_rect):
        lz = nu * SR + nv * CR
        if lz > best:
            best, STEP_SIDE = lz, si
    nu, nv = side_rect[STEP_SIDE]
    line_d = RIN_P_X if nu else RIN_P_Z            # centre->edge-line distance of this side
    ml = rect_pt((nu * line_d, nv * line_d))       # edge midpoint, local xz
    nl = rect_pt((nu, nv))                         # outward normal, unit, local xz
    STEP_NL = (nl[0], nl[1])                       # kept for the report (rail loop reuses nl)
    tr = rect_pt((-nv, nu))                        # tangent along the edge, unit
    STEP_YAW = round(math.degrees(math.atan2(tr[1], tr[0])), 3)
else:
    # platform prism: vertices at the column angles so flats parallel the bays
    col_ang = [math.atan2(c[1], c[0]) for c in COLS_XZ]
    plat_verts = [((RIN + OVER_PLATFORM) * math.cos(a), 0.0, (RIN + OVER_PLATFORM) * math.sin(a))
                  for a in col_ang]
    top = [(x, PLATFORM_H, z) for x, _, z in plat_verts]
    n = len(plat_verts)
    faces = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    fan_t = [(0, k + 1, k + 2) for k in range(n - 2)]
    mesh('platform', plat_verts + top, faces + fan_t + [(k + n + 2, k + n + 1, n) for k in range(n - 2)],
         'stone', 'body')
    plat_loop = top
    STEP_DIR = ENT_MID  # local plane angle of entrance bay midpoint

# 3 steps, 0.10 rise, width 1.2, tread 0.3 (design_inference)
if RECT:
    for k in range(3):
        h = PLATFORM_H - 0.10 * k
        cd = 0.15 + 0.30 * k
        box(f'step-{k}', (ml[0] + nl[0] * cd, h / 2, ml[1] + nl[1] * cd),
            (1.2, h, 0.3), 'stone', 'body', collision=True, rot_y_deg=STEP_YAW, reachable=True)
else:
    pr, pz = math.cos(STEP_DIR), math.sin(STEP_DIR)
    edge = RIN + OVER_PLATFORM
    STEP_YAW = round(90 - math.degrees(STEP_DIR), 3)
    for k in range(3):
        h = PLATFORM_H - 0.10 * k
        cdist = edge + 0.15 + 0.30 * k
        box(f'step-{k}', (pr * cdist, h / 2, pz * cdist), (1.2, h, 0.3), 'stone', 'body',
            collision=True, rot_y_deg=STEP_YAW, reachable=True)

# ================================================================== columns + base stones
if RECT:
    col_xz = []
    for sx in (1, -1):
        for sz in (1, -1):
            mx = RX * sx
            mz = RZ * sz
            amap = math.atan2(mz, mx)          # footprint-aligned rect in MAP frame
            al = amap + P['rotY']              # local = map + rotY (site-inputs convention)
            col_xz.append((math.hypot(mx, mz) * math.cos(al), math.hypot(mx, mz) * math.sin(al)))
else:
    col_xz = [(c[0], c[1]) for c in COLS_XZ]

for i, (cx, cz) in enumerate(col_xz):
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=COL_D / 2, depth=COL_H,
                                        location=glb_to_blender((cx, PLATFORM_H + COL_H / 2, cz)))
    o = bpy.context.object
    tag(o, 'body')
    o.data.materials.append(M['timber'])
    o.name = f'column-{i}'
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=BASE_D / 2, depth=BASE_H,
                                        location=glb_to_blender((cx, PLATFORM_H + BASE_H / 2, cz)))
    o2 = bpy.context.object
    tag(o2, 'body')
    o2.data.materials.append(M['stone'])
    o2.name = f'base-stone-{i}'
    COLL.append({'name': f'column-{i}', 'type': 'box', 'center': [round(cx, 4), round(PLATFORM_H + BASE_H + (COL_H - BASE_H) / 2, 4), round(cz, 4)],
                 'size': [COL_D + 0.01, round(COL_H - BASE_H, 4), COL_D + 0.01], 'rotYDeg': 0, 'reachable': True})
    COLL.append({'name': f'base-stone-{i}', 'type': 'box', 'center': [round(cx, 4), round(PLATFORM_H + BASE_H / 2, 4), round(cz, 4)],
                 'size': [BASE_D + 0.02, BASE_H, BASE_D + 0.02], 'rotYDeg': 0, 'reachable': True})

# ================================================================== tie beam + eave purlin rings
def ring_loop(rad, y):
    pts = []
    for k in range(N):
        th = math.atan2(col_xz[k][1], col_xz[k][0])
        pts.append((rad * math.cos(th), y, rad * math.sin(th)))
    return pts

RING_JOBS = (('tie-beam', PLATFORM_H + COL_H, BEAM_H, BEAM_W / 2),
             ('eave-purlin', PLATFORM_H + COL_H + BEAM_H, PURLIN, PURLIN / 2))
if RECT:
    # R1 fix1: beams follow the RECT PERIMETER. The old ring walked the 4 corner angles at the
    # corner radius, which strung diagonal chords across the pavilion interior.
    def rect_ring(half_u, half_v, y):
        pts = []
        for u_, v_ in ((half_u, half_v), (-half_u, half_v), (-half_u, -half_v), (half_u, -half_v)):
            px, pz = rect_pt((u_, v_))
            pts.append((px, y, pz))                # tube() point order is (x, y, z)
        return pts
    for name, y0, hh, half_w in RING_JOBS:
        tube(name, rect_ring(RX + half_w, RZ + half_w, y0),
             rect_ring(max(RX - half_w, 0.01), max(RZ - half_w, 0.01), y0),
             'timber', 'body', y_top=y0 + hh)
else:
    RAD_RING = R
    for name, y0, hh, half_w in RING_JOBS:
        outer = ring_loop(RAD_RING + half_w, y0)
        inner = ring_loop(RAD_RING - half_w, y0)
        tube(name, outer, inner, 'timber', 'body', y_top=y0 + hh)

# ================================================================== 挂落 hanglo (alpha lattice plane per bay, incl. entrance: hangs at 2.70-3.05, above reach)
if RECT:
    # R1 fix1: panel inset PERPENDICULAR to the column side (rect frame); the old midpoint-vector
    # scaling moved panels radially, i.e. diagonally off the rotated rect sides.
    rect_cc = [(RX, RZ), (-RX, RZ), (-RX, -RZ), (RX, -RZ)]     # CCW column rect corners
    for k in range(4):
        a_r, b_r = rect_cc[k], rect_cc[(k + 1) % 4]
        A, B = rect_pt(a_r), rect_pt(b_r)
        L = math.hypot(B[0] - A[0], B[1] - A[1])
        tx, tz = (B[0] - A[0]) / L, (B[1] - A[1]) / L
        d_r = (b_r[0] - a_r[0], b_r[1] - a_r[1])
        dl = math.hypot(*d_r)
        nx_r, nz_r = d_r[1] / dl, -d_r[0] / dl                 # outward normal, rect frame
        cx, cz = rect_pt(((a_r[0] + b_r[0]) / 2 - nx_r * 0.06,
                          (a_r[1] + b_r[1]) / 2 - nz_r * 0.06))
        w = L - 0.24
        v0 = (cx + tx * w / 2, PLATFORM_H + COL_H - 0.35, cz + tz * w / 2)
        v1 = (cx - tx * w / 2, PLATFORM_H + COL_H - 0.35, cz - tz * w / 2)
        v2 = (v1[0], v1[1] + 0.35, v1[2])
        v3 = (v0[0], v0[1] + 0.35, v0[2])
        muv = w / 0.6
        uvs = [(0, 0), (muv, 0), (muv, 0.35 / 0.6), (0, 0.35 / 0.6)]
        mesh(f'hanglo-s{k}', [v0, v1, v2, v3], [(0, 1, 2, 3)], None, 'body', uvs=uvs,
             matobj=M['lat-a'] if k % 2 == 0 else M['lat-b'])
else:
    rin_here = R * math.cos(math.pi / N)
    for k in range(N):
        m = math.radians(BAYS[k]['midLocalDeg'])
        chord = BAYS[k]['chord']
        rr = rin_here - 0.06
        w = chord - 0.24
        cx, cz = rr * math.cos(m), rr * math.sin(m)
        yaw = m - math.pi / 2
        ca, sa = math.cos(yaw), math.sin(yaw)
        v0 = (cx + ca * w / 2, PLATFORM_H + COL_H - 0.35, cz + sa * w / 2)
        v1 = (cx - ca * w / 2, PLATFORM_H + COL_H - 0.35, cz - sa * w / 2)
        v2 = (v1[0], v1[1] + 0.35, v1[2])
        v3 = (v0[0], v0[1] + 0.35, v0[2])
        muv = w / 0.6
        uvs = [(0, 0), (muv, 0), (muv, 0.35 / 0.6), (0, 0.35 / 0.6)]
        mesh(f'hanglo-{k}', [v0, v1, v2, v3], [(0, 1, 2, 3)], None, 'body', uvs=uvs,
             matobj=M['lat-a'] if k % 2 == 0 else M['lat-b'])

# ================================================================== roof
GROUP = 'roof'
if not RECT:
    # ---- 攒尖: eave loop sampled per facet (SEGS_PER_FACET), corner lift/reach with falloff
    vtx_angles = [math.atan2(c[1], c[0]) for c in col_xz]
    def eave_point(fi, t):
        a0 = vtx_angles[fi % N]
        a1 = vtx_angles[(fi + 1) % N]
        if a1 < a0:
            a1 += 2 * math.pi
        th = a0 + (a1 - a0) * t
        # cornerReach = falloff distance along the eave (build.py tipReach semantics); no radial overshoot
        c0 = (RE * math.cos(a0), RE * math.sin(a0))
        c1 = (RE * math.cos(a1), RE * math.sin(a1))
        seg = math.hypot(c1[0] - c0[0], c1[1] - c0[1])
        d = min(t, 1 - t) * seg
        f = corner_f(d)   # R1 fix3: continuous perimeter kernel, symmetric at the corner
        y = EAVE_Y - SAG * math.sin(math.pi * t) + LIFT * f
        return (RE * math.cos(th), y, RE * math.sin(th), LIFT * f)

    E = []
    for fi in range(N):
        for s in range(SEGS_PER_FACET):
            E.append(eave_point(fi, s / SEGS_PER_FACET))
    NE = len(E)
    apex = (0.0, APEX_Y, 0.0)

    def ring(t):
        out = []
        for e in E:
            base = e[1] - e[3]
            tt = t ** 1.5
            out.append((e[0] * (1 - t), base + (APEX_Y - base) * tt + e[3] * (1 - t) ** 2.2, e[2] * (1 - t)))
        return out

    rings = [ring(j / RINGS) for j in range(RINGS + 1)]
    verts, uvs, faces = [], [], []
    per = 0.0
    plen = [0.0]
    for i in range(NE):
        a, b = E[i], E[(i + 1) % NE]
        per += math.hypot(b[0] - a[0], b[2] - a[2])
        plen.append(per)
    slope = math.hypot(RE, RISE) * 1.08
    for j, rg in enumerate(rings):
        for i, p in enumerate(rg):
            verts.append(p)
            uvs.append((plen[i] / 1.44, j / RINGS * slope / 1.36))
    for j in range(RINGS):
        for i in range(NE):
            a = j * NE + i
            b = j * NE + (i + 1) % NE
            c = b + NE
            d = a + NE
            faces.append((a, d, c, b))  # winding: normal outward+up (derived, glb y-up)
    ai = len(verts)
    verts.append(apex)
    uvs.append((0.5, slope / 1.36))
    for i in range(NE):
        faces.append(((RINGS - 1) * NE + (i + 1) % NE, (RINGS - 1) * NE + i, ai))
    roof = mesh('roof-surface', verts, faces, 'tile', 'roof', uvs=uvs, smooth=True)
    eave_loop = [(e[0], e[1], e[2]) for e in E]

    # ---- soffit (flat, bay-mid polygon) + R1 trim: fascia / rafters / lips along the loop
    soff = []
    for k in range(N):
        # soffit vertices at bay-mid angles so the flat covers the bays; corners stay open
        a0 = vtx_angles[k]
        a1 = vtx_angles[(k + 1) % N]
        if a1 < a0:
            a1 += 2 * math.pi
        th = (a0 + a1) / 2
        rr = (RE + 0.3 * 0) * 0.985
        soff.append((rr * math.cos(th), EAVE_Y - SAG - 0.05, rr * math.sin(th)))
    ctr = (0.0, EAVE_Y - SAG - 0.05, 0.0)
    nf = [tuple(reversed((0, k + 1, k + 2))) for k in range(N - 2)]
    mesh('eave-soffit', [ctr] + soff, nf, 'dark', 'roof')

    RAFTER_MARGINS = eave_trim(eave_loop, rings[2])

    # ---- hip ridges: n rods (r 0.07) from corners to apex, tile; sampled on rings 2/5/8 (tri budget)
    vtx_idx = [fi * SEGS_PER_FACET for fi in range(N)]
    for ci in vtx_idx:
        prev = (eave_loop[ci][0], eave_loop[ci][1] + 0.04, eave_loop[ci][2])
        for j in (2, 5, RINGS):
            q = rings[j][ci] if j < RINGS else apex
            q = (q[0], q[1] + 0.045, q[2])
            cyl_to(f'hip-ridge-{ci}-{j}', prev, q, 0.07, 'tile', 'roof', 8)
            prev = q

    # ---- 宝顶 gourd finial (lathe 12 sides), dark lacquer
    prof = [(0.185, 0.0), (0.185, 0.05), (0.16, 0.09), (0.16, FINIAL_BASE),
            (0.10, FINIAL_BASE + 0.04), (0.145, FINIAL_BASE + 0.15), (0.145, FINIAL_BASE + 0.27),
            (0.075, FINIAL_BASE + 0.36), (0.13, FINIAL_BASE + 0.44), (0.13, FINIAL_BASE + 0.55),
            (0.05, FINIAL_BASE + 0.62), (0.012, FINIAL_BASE + FINIAL_H)]
    fv, ff = [], []
    y0 = APEX_Y - 0.06
    sides_n = 12
    for pi_, (pr_, py_) in enumerate(prof):
        for kk in range(sides_n):
            ang = 2 * math.pi * kk / sides_n
            fv.append((pr_ * math.cos(ang), y0 + py_, pr_ * math.sin(ang)))
    for pi_ in range(len(prof) - 1):
        for kk in range(sides_n):
            k2 = (kk + 1) % sides_n
            ff.append((pi_ * sides_n + kk, pi_ * sides_n + k2, (pi_ + 1) * sides_n + k2, (pi_ + 1) * sides_n + kk))
    mesh('baoding-finial', fv, ff, 'dark', 'roof', smooth=True)
else:
    # ---- rect variant (R1 fix1 rebuild): four slopes + short ridge, ALL in the footprint-aligned
    # rect frame (u=long, v=short), transformed to local by rect_pt. The old build rotated only
    # the eave loop and left ridge/soffit/loft targets on the local axes -> twisted surfaces,
    # floating soffit planes and a diagonal ridge.
    def eave_loop_rect():
        corn = [(-RE_X, -RE_Z), (RE_X, -RE_Z), (RE_X, RE_Z), (-RE_X, RE_Z)]   # rect frame
        nseg = (10, 6, 10, 6)
        pts = []
        for k in range(4):
            a = corn[k]
            b = corn[(k + 1) % 4]
            for i in range(nseg[k]):
                t = i / nseg[k]
                u = a[0] + (b[0] - a[0]) * t
                v = a[1] + (b[1] - a[1]) * t
                seglen = math.hypot(b[0] - a[0], b[1] - a[1])
                d = min(t, 1 - t) * seglen
                f = corner_f(d)            # R1 fix3: continuous perimeter kernel
                sag = SAG * math.sin(math.pi * t)
                lx, lz = rect_pt((u, v))
                pts.append((lx, EAVE_Y - sag + LIFT * f, lz, LIFT * f, u, v))
        return pts
    ER = eave_loop_rect()
    E = [list(p[:4]) for p in ER]
    EU = [p[4:] for p in ER]                   # rect-frame (u,v) of each eave point
    NE = len(E)
    RY = APEX_Y

    def ridge_target_uv(u, v):
        return (max(-RH_HALF, min(RH_HALF, u)), 0.0)

    def ring_rect(t):
        out = []
        for e, (u, v) in zip(E, EU):
            ru, rv = ridge_target_uv(u, v)
            tt = t ** 1.5
            base = e[1] - e[3]
            uu, vv = u + (ru - u) * t, v + (rv - v) * t
            lx, lz = rect_pt((uu, vv))
            out.append((lx, base + (RY - base) * tt + e[3] * (1 - t) ** 2.2, lz))
        return out
    rings = [ring_rect(j / RINGS) for j in range(RINGS + 1)]
    verts, uvs, faces = [], [], []
    per = 0.0
    plen = [0.0]
    for i in range(NE):
        a, b = E[i], E[(i + 1) % NE]
        per += math.hypot(b[0] - a[0], b[2] - a[2])
        plen.append(per)
    slope = math.hypot(min(RE_X, RE_Z), RISE) * 1.08
    for j, rg in enumerate(rings):
        for i, p in enumerate(rg):
            verts.append(p)
            uvs.append((plen[i] / 1.44, j / RINGS * slope / 1.36))
    for j in range(RINGS):
        for i in range(NE):
            a = j * NE + i
            b = j * NE + (i + 1) % NE
            faces.append((a, a + NE, b + NE, b))  # winding: normal outward+up
    roof = mesh('roof-surface', verts, faces, 'tile', 'roof', uvs=uvs, smooth=True)
    eave_loop = [(e[0], e[1], e[2]) for e in E]

    # flat soffit under the rect roof, in the same rect frame (was axis-aligned local = floated off)
    sy = EAVE_Y - SAG - 0.05
    sc_uv = [(-RE_X * 0.98, -RE_Z * 0.98), (RE_X * 0.98, -RE_Z * 0.98),
             (RE_X * 0.98, RE_Z * 0.98), (-RE_X * 0.98, RE_Z * 0.98)]
    sc = [(rect_pt(p)[0], sy, rect_pt(p)[1]) for p in sc_uv]
    mesh('eave-soffit', sc, [(2, 1, 0, 3)], 'dark', 'roof')

    RAFTER_MARGINS = eave_trim(eave_loop, rings[2])

    # hip rods: 4, from the eave corners (on the corner-column diagonals) up to the short-ridge
    # ENDS (sampled rings 2/5/RINGS like gate v2), tile
    corner_idx = [0, 10, 16, 26]
    HIP_FEET, HIP_TOPS = [], []
    for ci in corner_idx:
        HIP_FEET.append([round(eave_loop[ci][0], 4), round(eave_loop[ci][1], 4), round(eave_loop[ci][2], 4)])
        prev = (eave_loop[ci][0], eave_loop[ci][1] + 0.04, eave_loop[ci][2])
        for j in (2, 5, RINGS):
            q = rings[j][ci]
            q = (q[0], q[1] + 0.045, q[2])
            cyl_to(f'hip-ridge-{ci}-{j}', prev, q, 0.07, 'tile', 'roof', 8)
            prev = q
        HIP_TOPS.append([round(prev[0], 4), round(prev[1], 4), round(prev[2], 4)])
    # 正脊 ridge box along the rect u axis (rotated with the building)
    box('main-ridge', (0, RY + 0.10, 0), (2 * RH_HALF + 0.3, 0.16, 0.14), 'tile', 'roof',
        rot_y_deg=round(math.degrees(ROT), 3))

# ================================================================== 美人靠 rails (skip entrance bay)
def rail_bay(p0, p1, support, tagname, nx_=None, nz_=None):
    """Seat + leaning back rail + 2 posts + top cap between column-line points p0,p1 (GLB xz).
    support = platform-edge distance from centre along the bay outward normal.
    (nx_,nz_) = outward normal of the bay in local xz; default = radial midpoint direction
    (identical for regular polygons; the rect variant passes the true side normal, R1 fix1)."""
    mx, mz = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    tx, tz = (p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L
    if nx_ is None:
        rad = math.hypot(mx, mz)
        nx_, nz_ = mx / rad, mz / rad          # outward
    inset = support
    yawb = round(90 - math.degrees(math.atan2(tx, tz)), 3)
    # seat board (top at platform + 0.42). Placement target = perpendicular distance `inset-...`
    # from the ORIGIN along the outward normal, realised from the bay midpoint:
    # offset = target - d_col (d_col = perpendicular distance of the column side line).
    # For regular bays d_col == R and this equals the old radial placement exactly.
    d_col = mx * nx_ + mz * nz_
    sl = L - 0.34
    off_s = inset - SEAT_DEEP / 2 + 0.02 - d_col
    seat_c = (mx + nx_ * off_s, PLATFORM_H + SEAT_H - 0.05, mz + nz_ * off_s)
    box(f'seat-{tagname}', seat_c, (sl, 0.10, SEAT_DEEP - 0.04), 'timber', 'rail',
        collision=True, rot_y_deg=yawb)
    # back rail: bottom at the seat OUTER edge, leaning 12 deg outward
    b0r = inset - 0.10 - d_col
    bx0, bz0 = mx + nx_ * b0r, mz + nz_ * b0r
    lean = BACK_H * math.sin(BACK_LEAN)
    wp0 = (bx0, PLATFORM_H + SEAT_H - 0.02, bz0)
    wp1 = (bx0 + nx_ * lean, PLATFORM_H + SEAT_H + BACK_H * math.cos(BACK_LEAN), bz0 + nz_ * lean)
    # explicit thin box: axis = lean direction, width along bay tangent, thickness horizontal outward
    hx, hz = -tz, tx           # horizontal perp of the tangent (for thickness offset)
    y0b, y1b = wp0[1], wp1[1]
    bv, bf = [], []
    for e, (cy, dy_rad) in enumerate(((wp0[1], 0.0), (wp1[1], lean))):
        for ws in (-sl / 2, sl / 2):
            for ts in (-0.025, 0.025):
                bx = bx0 + tx * ws + (nx_ * dy_rad) + (nx_ * 0 + tz * 0) * ts + tx * 0
                # thickness offset along horizontal outward is wrong for a leaning panel; use perp (hx,hz)
                bvx = bx0 + tx * ws + nx_ * dy_rad + hx * ts * 0 + hx * 0
                bvx = bx0 + tx * ws + nx_ * dy_rad + hx * ts * 0
                bv.append((bx0 + tx * ws + nx_ * dy_rad + hx * ts * 0 + tz * 0,
                           cy,
                           bz0 + tz * ws + nz_ * dy_rad + hz * ts * 0 + tx * 0))
    bx_ = []
    for (cy, dr) in ((y0b, 0.0), (y1b, lean)):
        for ws in (-sl / 2, sl / 2):
            for ts in (-0.025, 0.025):
                bx_.append((bx0 + tx * ws + nx_ * dr + hx * ts, cy, bz0 + tz * ws + nz_ * dr + hz * ts))
    # vertex order: idx = e*4 + w*2 + t  (e: bottom/top, w: -/+width, t: -/+thick)
    def bi(e, w, t):
        return e * 4 + w * 2 + t
    bf = [(bi(0, 0, 0), bi(0, 1, 0), bi(0, 1, 1), bi(0, 0, 1)),
          (bi(1, 0, 1), bi(1, 1, 1), bi(1, 1, 0), bi(1, 0, 0)),
          (bi(0, 0, 0), bi(0, 0, 1), bi(1, 0, 1), bi(1, 0, 0)),
          (bi(0, 1, 0), bi(1, 1, 0), bi(1, 1, 1), bi(0, 1, 1)),
          (bi(0, 0, 1), bi(0, 1, 1), bi(1, 1, 1), bi(1, 0, 1)),
          (bi(0, 0, 0), bi(1, 0, 0), bi(1, 1, 0), bi(0, 1, 0))]
    mesh(f'back-rail-{tagname}', bx_, bf, 'timber', 'rail')
    COLL.append({'name': f'back-rail-{tagname}', 'type': 'obb',
                 'p0': [round(wp0[0], 4), round(wp0[1], 4), round(wp0[2], 4)],
                 'p1': [round(wp1[0], 4), round(wp1[1], 4), round(wp1[2], 4)],
                 'width': round(sl, 3), 'thick': 0.06, 'reachable': True})
    # end posts climbing to the top of the lean
    for s in (-1, 1):
        off = sl / 2 - 0.05
        px, pz = bx0 + tx * off * s + nx_ * lean / 2, bz0 + tz * off * s + nz_ * lean / 2
        box(f'post-{tagname}-{s}', (px, PLATFORM_H + SEAT_H + BACK_H * math.cos(BACK_LEAN) / 2, pz),
            (0.06, BACK_H * math.cos(BACK_LEAN) + 0.04, 0.06), 'timber', 'rail', collision=True)
    # top cap
    box(f'top-cap-{tagname}', ((wp0[0] + wp1[0]) / 2, wp1[1] + 0.02, (wp0[2] + wp1[2]) / 2),
        (sl + 0.1, 0.04, 0.12), 'timber', 'rail', rot_y_deg=yawb, collision=True)

if RECT:
    # R1 fix1: rails PARALLEL to the column bays, perpendicular-inset from each side line.
    # The old build scaled the side-midpoint vector radially -> rails ran diagonally across
    # the interior. Entrance side = side whose outward normal is nearest local +Z (steps side).
    cc = [(RX, RZ), (-RX, RZ), (-RX, -RZ), (RX, -RZ)]          # CCW column rect corners
    ent_best, ENT_SIDE = -2.0, 0
    for k in range(4):
        a_r, b_r = cc[k], cc[(k + 1) % 4]
        d_r = (b_r[0] - a_r[0], b_r[1] - a_r[1])
        dl = math.hypot(*d_r)
        nlx, nlz = rect_pt((d_r[1] / dl, -d_r[0] / dl))        # outward normal, local
        if nlz > ent_best:
            ent_best, ENT_SIDE = nlz, k
    for k in range(4):
        if k == ENT_SIDE:
            continue
        a_r, b_r = cc[k], cc[(k + 1) % 4]
        d_r = (b_r[0] - a_r[0], b_r[1] - a_r[1])
        dl = math.hypot(*d_r)
        nx_r, nz_r = d_r[1] / dl, -d_r[0] / dl
        nl = rect_pt((nx_r, nz_r))
        A, B = rect_pt(a_r), rect_pt(b_r)
        support = RIN_P_X if abs(nl[0]) >= abs(nl[1]) else RIN_P_Z   # platform side-line distance
        rail_bay(A, B, support, f's{k}', nl[0], nl[1])
else:
    for k in range(N):
        if k == ENT:
            continue
        a = col_xz[k]
        b = col_xz[(k + 1) % N]
        rail_bay(a, b, RIN + OVER_PLATFORM, f'b{k}')

# ================================================================== platform collider (AABB)
if not RECT:
    plat_xs = [v[0] for v in plat_verts]
    plat_zs = [v[2] for v in plat_verts]
    COLL.append({'name': 'platform', 'type': 'box', 'center': [0, PLATFORM_H / 2, 0],
                 'size': [round(max(plat_xs) - min(plat_xs), 3), PLATFORM_H, round(max(plat_zs) - min(plat_zs), 3)],
                 'rotYDeg': 0, 'reachable': True})
else:
    # R1 fix1: platform is the footprint-aligned rect rotated by rotY -> collider yaw matches
    # (obb convention: local +X -> (cos th, sin th) = rect u axis when th = rotY)
    COLL.append({'name': 'platform', 'type': 'box', 'center': [0, PLATFORM_H / 2, 0],
                 'size': [round(2 * RIN_P_X, 3), PLATFORM_H, round(2 * RIN_P_Z, 3)],
                 'rotYDeg': round(math.degrees(ROT), 3), 'reachable': True})

# ================================================================== finalize: join per (part, material), triangulate
bpy.ops.object.select_all(action='DESELECT')
parts = {}
for o in list(bpy.context.scene.objects):
    if o.type == 'MESH':
        parts.setdefault((o.get('part', 'misc'), o.data.materials[0].name if o.data.materials else 'none'), []).append(o)


def finalize(items, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in items:
        o.select_set(True)
    bpy.context.view_layer.objects.active = items[0]
    if len(items) > 1:
        bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(o.data)
    bm.free()
    # open single-surface parts (roof): make the dominant normal face GLB +Y (up)
    me = o.data
    me.calc_loop_triangles()
    s = 0.0
    for t in me.loop_triangles:
        s += t.normal.z          # blender z == glb y
    if name.startswith('roof__') and s < 0:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
        bm.to_mesh(me)
        bm.free()
    o.data.calc_loop_triangles()
    bpy.ops.object.select_all(action='DESELECT')
    return o


final = []
for (grp, material), items in sorted(parts.items()):
    final.append(finalize(items, grp + '__' + material))

# ================================================================== hierarchy: root <id> -> body/roof/rail
root = bpy.data.objects.new(BLD, None)
root.empty_display_size = 2
bpy.context.collection.objects.link(root)
tri = {}
for grp in ('body', 'roof', 'rail'):
    sub = bpy.data.objects.new(grp, None)
    sub.empty_display_size = 1
    sub.parent = root
    bpy.context.collection.objects.link(sub)
    tot = 0
    for o in final:
        if o.name.startswith(grp + '__'):
            o.parent = sub
            tot += len(o.data.loop_triangles)
    tri[grp] = tot
tri['total'] = sum(tri.values())

for image in bpy.data.images:
    if image.filepath:
        image.pack()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'pavilion.blend'))

# ================================================================== export GLB
glb_path = os.path.join(OUT, 'model.glb')
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
for ch in root.children_recursive:
    ch.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_yup=True, export_apply=True,
                          use_selection=True, export_animations=False, export_tangents=False,  # PLAN fallback: tangent errors on untextured prims; normal-map tangents derived by client
                          export_image_format='AUTO', export_cameras=False, export_lights=False)
glb_bytes = os.path.getsize(glb_path)
sha = hashlib.sha256(open(glb_path, 'rb').read()).hexdigest()

# ================================================================== bounds + report values
xs = [v.co.x for o in final for v in o.data.vertices]
ys = [v.co.z for o in final for v in o.data.vertices]   # blender z == glb y
zs = [-v.co.y for o in final for v in o.data.vertices]  # blender -y == glb z
roof_surface_objs = [o for o in final if o.name.startswith('roof__pav-tile')]
roof_top = max(max(v.co.z for v in o.data.vertices) for o in roof_surface_objs)
body_top = max(max(v.co.z for v in o.data.vertices) for o in final if o.name.startswith('body__'))
bounds = {'min': [round(min(xs), 3), round(min(ys), 3), round(min(zs), 3)],
          'max': [round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)]}

r1_record = {
    'cornerKernel': 'raised-cosine^2.0 along eave perimeter (gate-v2 continuous walk); '
                    'LIFT at corner, 0 at cornerReach, zero slope at both ends (no corner crease)',
    'rafterRule': 'axis localEaveY-0.09 -> top eaveY-0.06 (<= eave-0.05), radial length 0.25, '
                  'below tile lips; height follows lifted eave line (corner-sync)',
    'rafterTopMarginMin': round(min(RAFTER_MARGINS), 4),
}
if RECT:
    r1_record.update({
        'rectFrame': 'u=footprint long axis, v=short; local = rotY(rect); platform, rings, roof, '
                     'ridge, soffit, rails and steps all share this frame (R1 fix1)',
        'stepsSide': 'platform edge nearest local +Z, flush outside (stepsSideNormalLocal)',
        'stepsSideNormalLocal': [round(STEP_NL[0], 4), round(STEP_NL[1], 4)],
        'hipRidgeFeetLocal': HIP_FEET,
        'hipRidgeTopsLocal': HIP_TOPS,
        'ridgeHalf': RH_HALF,
    })

report = {
    'id': BLD, 'zh': P['zh'], 'variant': P['variant'], 'n': N,
    'module': 'pavilion-' + BLD,
    'design': {'R': (P['fit']['R'] if not RECT else None), 'Rx': (RX if RECT else None), 'Rz': (RZ if RECT else None),
               'rotY': P['rotY'], 'platformH': PLATFORM_H, 'columnH': COL_H,
               'eaveY': EAVE_Y, 'rise': round(RISE, 4), 'apexY': round(APEX_Y, 4),
               'ridgeFallback': (True if RECT else False),
               'ridgeHalf': (round(RH_HALF, 4) if RECT else None),
               'cornerLift': LIFT, 'cornerReach': REACH, 'concaveSag': SAG,
               'finialTop': round(APEX_Y - 0.06 + FINIAL_BASE + FINIAL_H, 3) if not RECT else None},
    'measured': {'roofTopY': round(roof_top, 4), 'bodyTopY': round(body_top, 4),
                 'boundsGLB': bounds,
                 'triangles': tri, 'glbBytes': glb_bytes, 'sha256': sha},
    'r1': r1_record,
    'assumptions': {
        'riseFormula': 'clamp(0.5 * eaveRadius, 1.1, 1.6)' if not RECT else 'clamp(0.5 * min(eaveRx,eaveRz), 1.1, 1.6) -> clamped 1.1',
        'ridgeFallback': 'rect aspect ~2:1 -> spec PLAN.md fallback: short ridge 40% of long side, four slopes + ridge',
        'bevels': 'none (tri budget); silhouette + materials carry edges',
        'steps': ('3 x 0.10 rise, width 1.2, tread 0.3, flush outside the platform edge nearest '
                  'local +Z (R1 fix1)') if RECT else
                 '3 x 0.10 rise, width 1.2, tread 0.3, at entrance bay midpoint (offset from +Z recorded in site-inputs)',
        'soffit': 'flat dark soffit at y=3.28 closes under-eave view (build.py method)',
        'finialRect': 'no gourd on ridge fallback roof; 正脊 box instead' if RECT else 'gourd finial per spec',
        'r1': 'master-review rework: rect single-frame rebuild / rafters under eave L0.25 / '
              'raised-cosine corner kernel (see r1 record)',
    },
    'buildSeconds': round(time.time() - T0, 1),
}
json.dump(report, open(os.path.join(OUT, 'build-report.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
json.dump({'axis': 'glTF Y-up, origin platform centre at ground y=0, facade +Z',
           'id': BLD, 'zh': P['zh'], 'reachableBand': [0, 2.4],
           'rotYDeg': 'box yaw; glb local +X -> (cos th, sin th), +Z -> (-sin th, cos th), th=radians(rotYDeg)',
           'method': 'vertex-level: every GLB vertex 0<=y<=2.4 must be inside >=1 collider (+0.01 margin)',
           'colliders': COLL}, open(os.path.join(OUT, 'collision.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
json.dump(META, open(os.path.join(OUT, 'materials.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# ================================================================== reimport check
check = bpy.data.scenes.new('GLB_REIMPORT_CHECK')
bpy.context.window.scene = check
bpy.ops.import_scene.gltf(filepath=glb_path)
mats = []
for m in {m for o in check.objects if o.type == 'MESH' for m in o.data.materials if m}:
    p = [n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED']
    imgs = [{'image': n.image.name, 'size': list(n.image.size), 'colorSpace': n.image.colorspace_settings.name}
            for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
    mats.append({'name': m.name, 'hasPrincipled': bool(p), 'alphaMode': getattr(m, 'blend_method', None),
                 'imageNodes': imgs})
nodes_tree = [{'name': o.name, 'parent': (o.parent.name if o.parent else None)} for o in check.objects]
reimport = {'imported': True, 'meshes': len([o for o in check.objects if o.type == 'MESH']),
            'materials': mats, 'nodeTree': nodes_tree}
json.dump(reimport, open(os.path.join(OUT, 'reimport-check.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

# ================================================================== renders (Cycles CPU, 4 views) + blank guard
if not NORENDER:
    bpy.context.window.scene = bpy.data.scenes['Scene']
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 1200
    sc.render.resolution_y = 900
    sc.render.film_transparent = False
    try:
        sc.view_settings.look = 'None'
        sc.view_settings.view_transform = 'Standard'
    except Exception:
        pass

    world = bpy.data.worlds.get('World') or bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.75, 0.78, 0.82, 1)
    bg.inputs[1].default_value = 0.7
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(52), 0, math.radians(35))
    bpy.context.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, -0.001, 0))
    ground = bpy.context.object
    ground.name = 'render-ground'
    gm = bpy.data.materials.new('render-ground')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.52, 0.5, 0.47, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
    ground.data.materials.append(gm)

    def add_cam(name, pos_glb, look_glb, lens=50):
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        cam.data.lens = lens
        bpy.context.collection.objects.link(cam)
        p = glb_to_blender(pos_glb)
        l = glb_to_blender(look_glb)
        cam.location = p
        d = l - p
        cam.rotation_mode = 'QUATERNION'
        cam.rotation_quaternion = (-d).to_track_quat('Z', 'Y')  # camera looks along local -Z
        return cam

    if RECT:
        reach = math.hypot(RE_X, RE_Z)
    else:
        reach = RE + 0.3
    dist = max(5.0, reach * 3.1)
    cams = {
        'front': add_cam('cam-front', (0, 1.9, dist), (0, 1.9, 0), 40),
        'three-quarter': add_cam('cam-3q', (dist * 0.62, dist * 0.46, dist * 0.75), (0, 1.75, 0), 40),
        'top': add_cam('cam-top', (0, reach * 3.6, 0.02), (0, 0, 0), 45),
        'under-eave': add_cam('cam-under', (reach * 0.5, 0.95, reach * 1.05), (0, 2.95, 0), 21),
    }
    # blank-frame guard runs in the orchestrator (system python3 + PIL); Blender py has no PIL
    render_log = {}
    for name, cam in cams.items():
        sc.camera = cam
        sc.render.filepath = os.path.join(OUT, 'renders', name + '.png')
        bpy.ops.render.render(write_still=True)
        render_log[name] = {'path': sc.render.filepath}
    json.dump(render_log, open(os.path.join(OUT, 'render-log.json'), 'w', encoding='utf-8'), indent=1)

print('PAVILION_READY', BLD, 'tris', tri['total'], 'bytes', glb_bytes,
      'roofTop', round(roof_top, 3), 'apexExpected', round(APEX_Y, 3), 'secs', round(time.time() - T0, 1))
