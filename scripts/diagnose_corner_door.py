"""R1 diagnostic: measure the corner module's branch-side door region in the real GLB.

Run: blender -b --factory-startup -t 4 -P diagnose_corner_door.py -- --glb building/corner/model.glb --out ../artifacts/diagnostics/corner-door-diagnosis.json

Scans every triangle whose world AABB intersects the branch-door region, then
reports (a) exact coplanar overlapping triangle pairs (the z-fight candidates:
same plane, overlap measured on the two in-plane axes), (b) skirt/wall material
triangles crossing the door-opening volume (brick passing through the doorway),
(c) door-region part inventory. Pure geometry from the reimported GLB - the same
script runs on the repaired module and must report zero findings there.

Imported verts already live in Blender Z-up space (the GLB was exported with
yup conversion), so GLB-coords regions are converted with glb_box().
"""
import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--glb', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)


def glb_box(lo, hi):
    """GLB Y-up AABB -> Blender Z-up AABB (recompute per-axis min/max)."""
    a = Vector((lo[0], -hi[2], lo[1]))
    b = Vector((hi[0], -lo[2], hi[1]))
    return (Vector((min(a[i], b[i]) for i in range(3))), Vector((max(a[i], b[i]) for i in range(3))))


# region of interest, module-local GLB coords (Y up, facade +Z, branch facade -X)
ROI_GLB = (Vector((-5.6, -0.2, -7.3)), Vector((-4.6, 2.6, -5.1)))  # lo, hi
ROI = glb_box(ROI_GLB[0], ROI_GLB[1])
# door-opening volume, slightly inset: skirt/wall material must never enter here
OPENING = glb_box(Vector((-5.30, 0.0, -6.604)), Vector((-5.06, 2.1, -5.556)))
CROSS_MATERIALS = {'blue-gray-brick', 'weathered-lime-plaster'}
A = p.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(A.glb.resolve()))
bpy.context.view_layer.update()


def tri_verts(o):
    me = o.data
    me.calc_loop_triangles()
    for t in me.loop_triangles:
        yield [o.matrix_world @ me.vertices[i].co for i in t.vertices]


tris = []
for o in bpy.context.scene.objects:
    if o.type != 'MESH':
        continue
    mat = o.data.materials[0].name if o.data.materials else '?'
    for v in tri_verts(o):
        lo = Vector((min(q[i] for q in v) for i in range(3)))
        hi = Vector((max(q[i] for q in v) for i in range(3)))
        if all(lo[i] <= ROI[1][i] and hi[i] >= ROI[0][i] for i in range(3)):
            n = (v[1] - v[0]).cross(v[2] - v[0])
            if n.length > 1e-12:
                n.normalize()
            tris.append({'mat': mat, 'v': [tuple(round(c, 5) for c in q) for q in v],
                         'n': tuple(round(c, 4) for c in n),
                         'lo': lo, 'hi': hi})

# (a) coplanar z-fight candidates: identical plane, overlap on the two IN-PLANE
# axes (the normal-axis extent is ~0 for coplanar faces and must not be required)
buckets = {}
for t in tris:
    n = t['n']
    d = round(sum(n[i] * t['v'][0][i] for i in range(3)), 4)
    buckets.setdefault((n, d), []).append(t)

coplanar_overlaps = []
for key, group in buckets.items():
    if len(group) < 2 or abs(key[0][0]) < .99:  # only X-facing planes matter at this facade
        continue
    flat = (1, 2)  # blender y/z are the in-plane axes for an X-facing plane
    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            a, b = group[i], group[j]
            if a['mat'] == b['mat'] and a['v'] == b['v']:
                continue
            if sum(a['n'][k] * b['n'][k] for k in range(3)) < .99:
                continue  # opposite/backing faces at one plane do not fight
            shared = len({*a['v']} & {*b['v']})
            if shared >= 2:
                continue  # two triangles of one surface (shared edge), not a fight
            ov = [min(a['hi'][k], b['hi'][k]) - max(a['lo'][k], b['lo'][k]) for k in flat]
            if all(v > 1e-4 for v in ov):
                coplanar_overlaps.append({
                    'plane': {'normal': list(key[0]), 'offset': key[1]},
                    'overlapExtent': [round(v, 4) for v in ov],
                    'a': {'mat': a['mat'], 'verts': a['v']},
                    'b': {'mat': b['mat'], 'verts': b['v']}})

# (b) skirt/wall solids crossing the opening volume (AABB test, not centroid:
# one big facade quad has its centroid far from the doorway it crosses)
door_blockers = []
for t in tris:
    if t['mat'] not in CROSS_MATERIALS:
        continue
    ov = [min(t['hi'][k], OPENING[1][k]) - max(t['lo'][k], OPENING[0][k]) for k in range(3)]
    if any(v < -1e-4 for v in ov):
        continue  # AABBs do not even intersect
    axis = max(range(3), key=lambda k: abs(t['n'][k]))
    flat = [k for k in range(3) if k != axis]
    if all(ov[k] > 1e-4 for k in flat):
        # real-area intersection with the opening interior; a zero-thickness
        # facade face still counts when its two in-plane axes overlap
        door_blockers.append({'mat': t['mat'],
                              'aabbLo': [round(c, 4) for c in t['lo']],
                              'aabbHi': [round(c, 4) for c in t['hi']],
                              'verts': t['v']})

inventory = {}
for t in tris:
    inventory[t['mat']] = inventory.get(t['mat'], 0) + 1

report = {
    'glb': str(A.glb.resolve()),
    'regionOfInterestGlb': {'lo': list(ROI_GLB[0]), 'hi': list(ROI_GLB[1])},
    'regionOfInterestBlender': {'lo': list(ROI[0]), 'hi': list(ROI[1])},
    'trianglesInRegion': len(tris),
    'materialTriangleCounts': inventory,
    'coplanarOverlappingPairs': coplanar_overlaps,
    'coplanarOverlapCount': len(coplanar_overlaps),
    'openingCrossedBy': door_blockers,
    'openingCrossedCount': len(door_blockers),
    'verdict': 'PASS' if not coplanar_overlaps and not door_blockers else 'FAIL',
}
A.out.parent.mkdir(parents=True, exist_ok=True)
A.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('CORNER_DOOR_DIAG', json.dumps({'verdict': report['verdict'],
                                      'coplanar': report['coplanarOverlapCount'],
                                      'crossed': report['openingCrossedCount']}))
