"""C-template r02: deform approved A teacher neutral mesh toward C-adult proportions.

Route: template_fit. Reads teacher/neutral-standing.glb (approved base), applies
region-weighted smooth deformation, exports static GLB + blend. Texture/topology inherited.

r02 changes vs r01 (per analysis/LEAD_REVIEW_C_R01.md):
  1. Head gets ONE uniform scale (0.9) about its centre; transition only at the neck
     root (y band, shifted back at ear heights). No more ellipsoidal radius falloff that
     squeezed the face middle. A low-z guard keeps front-leg columns out of the head op.
  2. r01 belly_tuck removed (it also lifted hind paws). Replaced by a ground-anchored
     monotone height map: feet stay on the ground, knees/hocks rise progressively,
     chest/hips and everything above shoulder height rise a constant +0.020.
  3. Four soles grounded individually by spatial cluster; the source hind +x foot
     (1.70mm high) is lowered smoothly. Torso/chest/waist ops carry a low-z guard so
     they never touch paws. Ear elongation dropped so ears share the uniform head scale.
"""
import json
import hashlib
from pathlib import Path
import numpy as np
import bpy

import argparse, sys
parser = argparse.ArgumentParser(description='Measured A-template deformation example: remeasure before changing source assets')
parser.add_argument('--input', required=True)
parser.add_argument('--parameters', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
OUT = Path(args.output).resolve()
GLB = Path(args.input).resolve()
if any((OUT / n).exists() for n in ('model.glb', 'model.blend')):
    raise FileExistsError('Use a fresh output directory to preserve the previous candidate')
P = json.loads(Path(args.parameters).read_text(encoding='utf-8'))
D = P['deformation']


def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


sha = hashlib.sha256(GLB.read_bytes()).hexdigest()
assert sha == P['base_sha256'], f'teacher GLB sha mismatch: {sha}'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(GLB))
ob = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
assert np.allclose(np.array(ob.matrix_world), np.eye(4), atol=1e-9), 'expected identity transform'

mesh = ob.data
V0 = np.array([list(v.co) for v in mesh.vertices])
V = V0.copy()
n = len(V)
x, y, z = V[:, 0], V[:, 1], V[:, 2]

# source foot clusters, measured before any edit (thresholds from probe_r02.json)
FOOT = D['foot_grounding']
feet_sel = z < FOOT['cluster_z_max']
feet = {}
for gname, gmask in [('front', feet_sel & (y < -0.02)), ('hind', feet_sel & (y > 0.02))]:
    gy = V[gmask]
    xs = np.median(gy[:, 0])
    for sname, smask in [('neg_x', gy[:, 0] < xs), ('pos_x', gy[:, 0] >= xs)]:
        C = gy[smask]
        feet[f'{gname}_{sname}'] = {
            'min_z': float(C[:, 2].min()),
            'bbox_xy': [[float(C[:, 0].min()), float(C[:, 1].min())],
                        [float(C[:, 0].max()), float(C[:, 1].max())]],
        }

# --- 1. head: single uniform scale, transition only at the neck root ----------------
H = D['head']
hc = np.array(H['center_xyz'])
sc = H['uniform_scale']
s_ear = ss(H['neck_transition']['z_ramp'][0], H['neck_transition']['z_ramp'][1], z)
w_y = np.maximum(1.0 - ss(H['neck_transition']['full_y_edge_low_z'], H['neck_transition']['zero_y_edge_low_z'], y), s_ear)
w_legguard = ss(H['leg_guard_z'][0], H['leg_guard_z'][1], z)
w_head = w_y * w_legguard
V = V + w_head[:, None] * ((hc + (V - hc) * sc) - V)

# small muzzle forward push on the deformed front face (mid-height band)
mz = w_head * ss(-0.15, -0.18, V[:, 1]) * ss(0.155, 0.19, V[:, 2]) * (1.0 - ss(0.235, 0.265, V[:, 2]))
V[:, 1] -= D['muzzle_push_forward_m'] * mz

# --- 2. torso: conservative lengthen + chest/waist width, feet excluded -------------
ts = D['torso_stretch']
w_t = ss(ts['rise_band_y'][0], ts['rise_band_y'][1], V[:, 1]) \
    * (1.0 - ss(ts['fall_band_y'][0], ts['fall_band_y'][1], V[:, 1])) \
    * ss(ts['z_guard'][0], ts['z_guard'][1], V[:, 2])
y0 = ts['anchor_y']
V[:, 1] = y0 + (V[:, 1] - y0) * (1.0 + (ts['factor'] - 1.0) * w_t)

for key in ('chest_width_factor', 'waist_width_factor'):
    cw = D[key]
    w_c = ss(cw['region_y'][0] - cw['ramp'], cw['region_y'][0] + cw['ramp'], V[:, 1]) \
        * (1.0 - ss(cw['region_y'][1] - cw['ramp'], cw['region_y'][1] + cw['ramp'], V[:, 1])) \
        * ss(cw['z_guard'][0], cw['z_guard'][1], V[:, 2])
    V[:, 0] *= 1.0 + (cw['factor'] - 1.0) * w_c

# --- 3. ground-anchored height lift (replaces r01 belly_tuck + leg_stretch) ---------
hl = D['height_lift']
lift = hl['lift_max_m'] * ss(hl['z_start'], hl['z_full'], V[:, 2])
V[:, 2] += lift

# --- 4. per-foot grounding (never via global minZ) ----------------------------------
fade = 1.0 - ss(FOOT['fade_z'][0], FOOT['fade_z'][1], V[:, 2])
grounded = {}
for name, f in feet.items():
    (xlo, ylo), (xhi, yhi) = f['bbox_xy']
    m = FOOT['bbox_margin_m']
    in_foot = (V[:, 2] < FOOT['cluster_z_max'] + 0.005) \
        & (V[:, 0] > xlo - m) & (V[:, 0] < xhi + m) \
        & (V[:, 1] > ylo - m) & (V[:, 1] < yhi + m)
    dz = f['min_z']
    V[in_foot, 2] -= dz * fade[in_foot]
    grounded[name] = {'source_min_z': f['min_z'], 'shift_m': -dz, 'verts_moved': int(in_foot.sum())}

for v, co in zip(mesh.vertices, V):
    v.co = co
mesh.validate()
mesh.update()
bpy.ops.object.select_all(action='DESELECT')
ob.select_set(True)
bpy.context.view_layer.objects.active = ob
bpy.ops.object.shade_smooth()
ob.name = 'C_Adult_TemplateFit_r02'

bpy.ops.file.pack_all()
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT / 'model.glb'), use_selection=True,
                          export_format='GLB', export_animations=False)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'model.blend'))

moved = float(np.abs(V - V0).max())
final_feet = {}
zy, zx = V[:, 2], V[:, 0]
sel_f = zy < FOOT['cluster_z_max'] + 0.005
for name, f in feet.items():
    (xlo, ylo), (xhi, yhi) = f['bbox_xy']
    m = FOOT['bbox_margin_m']
    in_foot = sel_f & (zx > xlo - m) & (zx < xhi + m) & (ylo - m < V[:, 1]) & (V[:, 1] < yhi + m)
    final_feet[name] = float(zy[in_foot].min())

imgs = [{'name': i.name, 'size': list(i.size), 'packed': bool(i.packed_file)} for i in bpy.data.images if i.name != 'Render Result']
stats = {
    'vertices': int(len(mesh.vertices)),
    'triangles': int(sum(len(p.vertices) - 2 for p in mesh.polygons)),
    'bounds': {'min': V.min(axis=0).tolist(), 'max': V.max(axis=0).tolist()},
    'max_vertex_displacement_m': moved,
    'head_weight': {'full_gt_0p95': int((w_head > 0.95).sum()),
                    'transition_0p05_0p95': int(((w_head > 0.05) & (w_head <= 0.95)).sum())},
    'lift': {'applied_max_m': float(lift.max()), 'verts_full_lift': int((lift > hl['lift_max_m'] - 1e-6).sum())},
    'feet': grounded,
    'feet_final_min_z': final_feet,
    'uv_layers': [u.name for u in mesh.uv_layers],
    'materials': [ms.name for ms in ob.data.materials if ms],
    'images': imgs,
    'base_sha256': sha,
}
(OUT / 'BUILD_STATS.json').write_text(json.dumps(stats, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(stats, ensure_ascii=False))
