"""Small Blender helpers: GLB design coordinates, connected boxes, metric loop UV.
Import this module inside Blender Python. It never exports or edits files itself.
"""
import bpy
import bmesh
from mathutils import Vector


def glb_to_blender(point):
    x, y, z = point
    return Vector((x, -z, y))


def blender_to_glb(point):
    return Vector((point.x, point.z, -point.y))


def box_glb(name, center, size, material=None, tile_m=(1.0, 1.0), bevel=0.008):
    """Create a connected 8-vertex box in Blender Z-up from a GLB Y-up brief.
    UV is per loop, so geometric vertices can be shared without losing UV seams.
    """
    hx, hy, hz = [float(v) / 2 for v in size]
    if min(hx, hy, hz) <= 0 or min(tile_m) <= 0:
        raise ValueError('Box dimensions and tile meters must be positive')
    if min(hx, hy, hz) < .006:   # thin boxes: bevel degenerates -> render artifacts
        bevel = 0
    source = [(-hx,-hy,-hz),(hx,-hy,-hz),(hx,hy,-hz),(-hx,hy,-hz),
              (-hx,-hy,hz),(hx,-hy,hz),(hx,hy,hz),(-hx,hy,hz)]
    faces = [(0,3,2,1),(4,5,6,7),(0,4,7,3),(1,2,6,5),(0,1,5,4),(3,7,6,2)]
    mesh = bpy.data.meshes.new(name + '_mesh')
    mesh.from_pydata([glb_to_blender(p) for p in source], [], faces)
    mesh.update()
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
    obj = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(obj)
    obj.location = glb_to_blender(center)
    if material is not None:
        mesh.materials.append(material)
    uv = mesh.uv_layers.new(name='UVMap')
    for face in mesh.polygons:
        normal = blender_to_glb(face.normal)
        axis = max(range(3), key=lambda i: abs(normal[i]))
        for li in face.loop_indices:
            p = blender_to_glb(mesh.vertices[mesh.loops[li].vertex_index].co) + Vector(center)
            u, v = ((-p.z, p.y) if axis == 0 else (p.x, -p.z) if axis == 1 else (p.x, p.y))
            uv.data[li].uv = (u / tile_m[0], v / tile_m[1])
    if bevel > 0:
        bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new('VisibleEdgeBevel', 'BEVEL')
        mod.width = min(float(bevel), min(hx, hy, hz) * 0.4)
        mod.segments = 2; mod.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj['design_glb_center'] = list(center); obj['design_glb_size'] = list(size)
    obj['uv_tile_m'] = list(tile_m)
    return obj
