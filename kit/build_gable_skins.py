"""Street sideface skins (山墙/背面外皮) builder — expansion batch package 2, M2.

One run exports ONE skin GLB per face (skins/<module>-<rec>.glb) plus per-face
collision sidecars, all authored in WORLD coordinates: each entry carries the
module-LOCAL wall box (copied from the delivered collision records) and the
module instance placement; the placement is baked in here (obbToWorld
convention), so the page can add the GLBs at identity.

Skin language (DESIGN_SPEC.secondPackage_visibleSideFaces.skinModule): plaster
face + brick base 0.9 + wood band 0.12 + gray-tile coping 0.28; rear skins add
a small window 0.6x0.8 (sill 1.8) and a rear door 0.9x2.0 (design_inference).
Thickness 0.06, offset 0.05 off the delivered wall box (never coplanar).
One thin-box collider per face. No new textures (shared palette only).

Run:
  blender -b --factory-startup -t 4 -P kit/build_gable_skins.py -- \
      --config kit/gable-skin.config.json --out kit/out/sidefaces
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
import bmesh  # noqa: E402
import mb_lib as L  # noqa: E402
import temple_components as C  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
sys.stdout.reconfigure(line_buffering=True)
p = argparse.ArgumentParser()
p.add_argument('--config', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
p.add_argument('--only', type=str, default=None, help='build a single target id')
a = p.parse_args(argv)

cfg = json.loads(a.config.read_text(encoding='utf-8'))
T0 = time.time()

SCHEMA = {
    'sampleId': None, 'family': None, 'units': None, 'axis': None, 'basedOn': None,
    'reference': {'imageId': None, 'referenceEra': None, 'historicalAccuracyVerified': None,
                  'dimensionsAreDesign': None},
    'skin': {'thicknessM': None, 'offsetM': None, 'brickBaseH': None, 'woodBandH': None,
             'copingH': None, 'rearWindowM': None, 'rearDoorM': None},
    'instancesSource': None,
    'mBatchFrozen': None,
    'targets': [{'id': None, 'module': None, 'centered': None,
                 'placement': {'positionGlb': None, 'rotationYRad': None, 'yawRad': None},
                 'faces': [{'kind': None, 'rec': None, 'localBox': {'center': None, 'size': None},
                            'offsetOverrideM': None, 'tSign': None, 'endShrinkM': None, 'note': None}],
                 'note': None}],
}


FACE_OPTIONAL_KEYS = ('note', 'offsetOverrideM', 'tSign', 'endShrinkM')
PLACEMENT_OPTIONAL_KEYS = ('yawRad', 'rotationYRad')


def check_keys(obj, spec, path):
    problems = []
    if not isinstance(obj, dict):
        return [f'{path}: expected object']
    optional = set()
    if path.endswith('.faces[0]'):
        optional |= set(FACE_OPTIONAL_KEYS)
    if path.endswith('.placement'):
        optional |= set(PLACEMENT_OPTIONAL_KEYS)
    extra = sorted(set(obj) - set(spec))
    missing = sorted((set(spec) - set(obj)) - optional)
    if extra:
        problems.append(f'{path}: unknown keys {extra}')
    if missing:
        problems.append(f'{path}: missing keys {missing}')
    for k, sub in spec.items():
        if sub is not None and k in obj:
            if isinstance(sub, dict) and isinstance(obj[k], dict):
                problems += check_keys(obj[k], sub, f'{path}.{k}')
            elif isinstance(sub, list) and isinstance(obj[k], list) and obj[k]:
                problems += check_keys(obj[k][0], sub[0], f'{path}.{k}[0]')
    return problems


def validate(c):
    pr = check_keys(c, SCHEMA, 'config')
    if c['units'] != 'meters':
        pr.append('units must be meters')
    if c['reference']['dimensionsAreDesign'] is not True:
        pr.append('dimensions must be flagged design (not survey)')
    sk = c['skin']
    if (sk['thicknessM'], sk['offsetM']) != (0.06, 0.05):
        pr.append('skin thickness 0.06 / offset 0.05 are frozen')
    if sk['brickBaseH'] != 0.9 or sk['woodBandH'] != 0.12 or sk['copingH'] != 0.28:
        pr.append('base 0.9 / band 0.12 / coping 0.28 are frozen')
    if sk['rearWindowM'][:2] != [0.6, 0.8] or sk['rearWindowM'][2] != 1.8:
        pr.append('rear window 0.6x0.8 sill 1.8 is frozen')
    if sk['rearDoorM'] != [0.9, 2.0]:
        pr.append('rear door 0.9x2.0 is frozen')
    for t in c['targets']:
        if not t['faces']:
            pr.append(f"{t['id']}: no faces")
    return pr


problems = validate(cfg)
if problems:
    print('CONFIG_INVALID', problems)
    sys.exit(2)
print(f'CONFIG_OK {cfg["sampleId"]} targets={len(cfg["targets"])} ({time.time() - T0:.1f}s)')

L.reset_scene()
L.build_materials()

sk = cfg['skin']
TH, OFF = sk['thicknessM'], sk['offsetM']
out = a.out
out.mkdir(parents=True, exist_ok=True)

totals = {'faces': 0, 'tris': 0, 'colliders': []}
face_reports = []


def build_face(target, face):
    """Build one face's skin; return (objects, collider, outward).
    CENTERED mode (target.centered=true): geometry at the box-local origin —
    the dataset script computes per-instance transforms (obbToWorld semantics)."""
    mod = target['module']
    centered = bool(target.get('centered'))
    pos = target['placement']['positionGlb'] if not centered else [0, 0, 0]
    yaw = target['placement'].get('rotationYRad', target['placement'].get('yawRad', 0.0))
    if centered:
        yaw = 0.0
    c, s = math.cos(yaw), math.sin(yaw)
    lx = (c, 0.0, -s)   # world direction of module-local +X (x, y, z)
    lz = (s, 0.0, c)    # world direction of module-local +Z
    lc = face['localBox']['center']
    ls = face['localBox']['size']
    kind = face['kind']
    # thickness axis = smallest horizontal dimension; length axis = the other
    t_axis = 0 if ls[0] <= ls[2] else 2
    l_axis = 2 - t_axis
    out_sign = (face.get('tSign', 1) if centered else (1 if lc[t_axis] >= 0 else -1))
    hw = ls[t_axis] / 2
    y0, y1 = lc[1] - ls[1] / 2, lc[1] + ls[1] / 2
    length = ls[l_axis]
    extra = face.get('offsetOverrideM') or 0.0
    t_out = lc[t_axis] + out_sign * (hw + OFF + extra + TH / 2)
    # outward direction in world (thickness axis, signed away from the module)
    if t_axis == 0:
        outward = (c * out_sign, -s * out_sign)
    else:
        outward = (s * out_sign, c * out_sign)

    def el(name, t_center, l_center, y_c, t_size, l_size, h, mat, collision=False):
        cl = [0.0, 0.0, 0.0]
        cl[t_axis] = t_center
        cl[l_axis] = l_center
        cl[1] = y_c
        sz = [0.0, 0.0, 0.0]
        sz[t_axis] = t_size
        sz[l_axis] = l_size
        sz[1] = h
        return C.obox(L, name, pos, lx, lz, cl, sz, mat, collision=collision, bevel=0)

    objs = []
    # R1-05(A): skins die into the perpendicular walls — shrink the length axis
    # 0.05 at each end so the slab never pokes into the neighbour's corner
    # (side wall x band vs back wall overshoot). Guard: only for length > 1.
    end_shrink = face.get('endShrinkM', 0.05)
    length_c = length - 2 * end_shrink
    l_center = lc[l_axis] if not centered else 0.0
    tmid = t_out
    objs.append(el('skin-brick-base', tmid, l_center, y0 + sk['brickBaseH'] / 2,
                   TH, length_c, sk['brickBaseH'], 'brick'))
    panel_top = y1 - sk['copingH'] - sk['woodBandH']
    objs.append(el('skin-plaster-panel', tmid, l_center, (y0 + sk['brickBaseH'] + panel_top) / 2,
                   TH, length_c, panel_top - (y0 + sk['brickBaseH']), 'plaster'))
    objs.append(el('skin-wood-band', tmid, l_center, y1 - sk['copingH'] - sk['woodBandH'] / 2,
                   TH, length_c + 0.04, sk['woodBandH'], 'wood'))
    objs.append(el('skin-coping', tmid, l_center, y1 - sk['copingH'] / 2,
                   TH, length_c + 0.1, sk['copingH'], 'roof'))
    if kind == 'rear':
        ww, wh, sill = sk['rearWindowM']
        dw, dh = sk['rearDoorM']
        face_z = tmid + out_sign * (TH / 2 + 0.012)
        wy = y0 + sill + wh / 2
        wx_l = l_center - length_c * 0.2
        dx_l = l_center + length_c * 0.2
        objs.append(el('skin-window-recess', face_z, wx_l, wy, 0.05, ww, wh, 'dark'))
        objs.append(el('skin-door-slab', face_z, dx_l, y0 + dh / 2, 0.05, dw, dh, 'dark'))
        for dyy in (y0 + sill - 0.04, y0 + sill + wh + 0.04):
            objs.append(el('skin-window-frame', face_z, wx_l, dyy, 0.06, ww + 0.12, 0.07, 'wood'))
        for dxx in (wx_l - ww / 2 - 0.04, wx_l + ww / 2 + 0.04):
            objs.append(el('skin-window-frame', face_z, dxx, wy, 0.06, 0.07, wh + 0.2, 'wood'))
        for dxx in (dx_l - dw / 2 - 0.04, dx_l + dw / 2 + 0.04):
            objs.append(el('skin-door-frame', face_z, dxx, y0 + dh / 2, 0.06, 0.07, dh + 0.1, 'wood'))
        objs.append(el('skin-door-frame', face_z, dx_l, y0 + dh + 0.05, 0.06, dw + 0.16, 0.07, 'wood'))
        objs.append(el('skin-door-sill', face_z, dx_l, y0 + 0.04, 0.1, dw + 0.2, 0.08, 'stone'))
    # one thin-box collider for the whole face slab
    col = el('skin-collider', tmid, l_center, (y0 + y1) / 2, TH, length_c, y1 - y0, 'plaster', collision=True)
    objs.append(col)
    return objs, outward


def tris_of(objs):
    total = 0
    for o in objs:
        o.data.calc_loop_triangles()
        total += len(o.data.loop_triangles)
    return total


def export_face(face_id, objs):
    for o in bpy.context.scene.objects:
        o.hide_select = False
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    fp = out / 'skins' / f'{face_id}.glb'
    fp.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(fp), export_format='GLB', export_yup=True,
                              export_apply=True, export_animations=False, export_tangents=True,
                              export_image_format='JPEG', export_jpeg_quality=92,
                              export_cameras=False, export_lights=False, use_selection=True)
    data = fp.read_bytes()
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def delete_objs(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.object.delete()


for target in cfg['targets']:
    if a.only and target['id'] != a.only:
        continue
    for face in target['faces']:
        face_id = face['rec'] if target.get('centered') else f"{target['module']}-{face['rec']}"
        before_objs = set(bpy.context.scene.objects)
        objs, outward = build_face(target, face)
        new_objs = [o for o in bpy.context.scene.objects if o not in before_objs]
        tris = tris_of(new_objs)
        meta = export_face(face_id, new_objs)
        collider = [r for r in L.COLL if r['name'] == 'skin-collider'][-1]
        collider['outward'] = [round(v, 6) for v in outward]
        totals['faces'] += 1
        totals['tris'] += tris
        totals['colliders'].append({
            'name': f"gableskin:{face_id}", 'group': 'gableskin', 'type': 'box',
            'min': collider['min'], 'max': collider['max'], 'obb': collider['obb'],
            'outward': collider['outward'],
        })
        face_reports.append({'faceId': face_id, 'target': target['id'], 'kind': face['kind'],
                             'module': target['module'], 'rec': face['rec'],
                             'tris': tris, 'budget': 1500, 'pass': tris <= 1500, **meta})
        print(f"BUILT {face_id} tris={tris} bytes={meta['bytes']}")
        delete_objs(new_objs)

if totals['faces'] == 0:
    print('NOTHING_BUILT')
    sys.exit(4)
if totals['tris'] > 8000:
    print('BUDGET_FAIL total tris', totals['tris'])
    sys.exit(5)
for r in face_reports:
    if not r['pass']:
        print('BUDGET_FAIL', r['faceId'], r['tris'])
        sys.exit(5)

(out / 'faces.json').write_text(json.dumps({
    'config': str(a.config), 'faces': face_reports, 'totalTris': totals['tris'],
    'colliders': totals['colliders'],
    'axis': 'glTF Y-up; WORLD records (placement baked in; obbToWorld reproduces every box)',
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'materials.json').write_text(json.dumps(L.META, ensure_ascii=False, indent=2) + '\n',
                                    encoding='utf-8')
used = dict(cfg)
used['configSha256'] = hashlib.sha256(a.config.read_bytes()).hexdigest()
(out / 'config-used.json').write_text(json.dumps(used, ensure_ascii=False, indent=2) + '\n',
                                      encoding='utf-8')
print(f"GABLE_SKINS_READY faces={totals['faces']} tris={totals['tris']} "
      f"total={time.time() - T0:.1f}s")
