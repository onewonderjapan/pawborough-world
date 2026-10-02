"""Geometry and material helpers for Pawborough national snacks.
Design coords: GLB Y-up, +Z cat-front.
Blender internal: Z-up, -Y front.
"""
import math
import bpy
import bmesh
from mathutils import Vector, Matrix


def srgb_to_linear(hex_code):
    hex_code = hex_code.lstrip('#')
    c = [int(hex_code[i:i+2], 16) / 255.0 for i in (0, 2, 4)]
    return [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c]


def make_mat(name, hex_color, roughness=0.5, metallic=0.0, specular=0.5, clearcoat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    lin = srgb_to_linear(hex_color)
    bsdf.inputs['Base Color'].default_value = (*lin, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = specular
    elif 'Specular' in bsdf.inputs:
        bsdf.inputs['Specular'].default_value = specular
    return m


def glb_to_bl(p):
    """Convert GLB coordinate (x, y, z) [Y-up, Z-front] to Blender (x, -z, y) [Z-up, -Y-front]."""
    return Vector((p[0], -p[2], p[1]))


def bl_to_glb(p):
    """Convert Blender coordinate to GLB."""
    return Vector((p[0], p[2], -p[1]))


def make_empty(name, glb_pos=(0, 0, 0), parent=None, size=0.005):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = size
    e.location = glb_to_bl(glb_pos)
    bpy.context.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
    return e


def add_uv_coords(mesh):
    """Generate automatic cubic/planar UVMap for clean glTF export."""
    uv = mesh.uv_layers.new(name='UVMap')
    for face in mesh.polygons:
        normal = face.normal
        # Dominant axis in Blender coords
        axis = max(range(3), key=lambda i: abs(normal[i]))
        for li in face.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            if axis == 0:
                u, v = co.y * 5.0, co.z * 5.0
            elif axis == 1:
                u, v = co.x * 5.0, co.z * 5.0
            else:
                u, v = co.x * 5.0, co.y * 5.0
            uv.data[li].uv = (u, v)


def create_mesh_object(name, bm, materials=None, parent=None, location_glb=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name + '_mesh')
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    add_uv_coords(mesh)
    for p in mesh.polygons:
        p.use_smooth = True

    obj = bpy.data.objects.new(name, mesh)
    if materials:
        if isinstance(materials, list):
            for m in materials:
                obj.data.materials.append(m)
        else:
            obj.data.materials.append(materials)
    obj.location = glb_to_bl(location_glb)
    bpy.context.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


# Procedural shapes in GLB design space (x, y, z)
def add_ellipsoid(bm, center_glb, rx, ry, rz, segs_u=24, segs_v=16, y_min=None, y_max=None, mat_idx=0):
    cx, cy, cz = center_glb
    verts_grid = []
    for iv in range(segs_v + 1):
        phi = -math.pi / 2.0 + math.pi * iv / segs_v
        cos_phi = math.cos(phi)
        sin_phi = math.sin(phi)
        cur_y = cy + ry * sin_phi
        if y_min is not None and cur_y < y_min:
            cur_y = y_min
        if y_max is not None and cur_y > y_max:
            cur_y = y_max
        row = []
        for iu in range(segs_u):
            theta = 2.0 * math.pi * iu / segs_u
            vx = cx + rx * cos_phi * math.cos(theta)
            vz = cz + rz * cos_phi * math.sin(theta)
            # Convert to Blender coords (vx, -vz, cur_y)
            v = bm.verts.new(glb_to_bl((vx, cur_y, vz)))
            row.append(v)
        verts_grid.append(row)

    bm.verts.ensure_lookup_table()
    for iv in range(segs_v):
        r1 = verts_grid[iv]
        r2 = verts_grid[iv + 1]
        for iu in range(segs_u):
            iu_next = (iu + 1) % segs_u
            v0 = r1[iu]
            v1 = r1[iu_next]
            v2 = r2[iu_next]
            v3 = r2[iu]
            # Avoid degenerate faces
            f_verts = []
            for v in (v0, v1, v2, v3):
                if v not in f_verts:
                    f_verts.append(v)
            if len(f_verts) >= 3:
                try:
                    f = bm.faces.new(f_verts)
                    f.material_index = mat_idx
                except ValueError:
                    pass


def add_cylinder(bm, p1_glb, p2_glb, radius, segs=16, cap1=True, cap2=True, mat_idx=0):
    v1 = glb_to_bl(p1_glb)
    v2 = glb_to_bl(p2_glb)
    axis = (v2 - v1).normalized()
    length = (v2 - v1).length
    if length < 1e-6:
        return
    # Find perpendicular vector
    up = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((0, 1, 0))
    radial_u = axis.cross(up).normalized() * radius
    radial_v = axis.cross(radial_u).normalized() * radius

    ring1 = []
    ring2 = []
    for i in range(segs):
        ang = 2.0 * math.pi * i / segs
        offset = radial_u * math.cos(ang) + radial_v * math.sin(ang)
        ring1.append(bm.verts.new(v1 + offset))
        ring2.append(bm.verts.new(v2 + offset))

    bm.verts.ensure_lookup_table()
    for i in range(segs):
        i_next = (i + 1) % segs
        try:
            f = bm.faces.new([ring1[i], ring1[i_next], ring2[i_next], ring2[i]])
            f.material_index = mat_idx
        except ValueError:
            pass

    if cap1:
        c1 = bm.verts.new(v1)
        for i in range(segs):
            i_next = (i + 1) % segs
            try:
                f = bm.faces.new([c1, ring1[i_next], ring1[i]])
                f.material_index = mat_idx
            except ValueError:
                pass

    if cap2:
        c2 = bm.verts.new(v2)
        for i in range(segs):
            i_next = (i + 1) % segs
            try:
                f = bm.faces.new([c2, ring2[i], ring2[i_next]])
                f.material_index = mat_idx
            except ValueError:
                pass


def add_rounded_tip(bm, center_glb, radius, axis_glb=(0, -1, 0), segs=16, mat_idx=0):
    """Add a smooth hemisphere cap pointing in axis_glb direction."""
    c_bl = glb_to_bl(center_glb)
    dir_bl = glb_to_bl(axis_glb).normalized()
    up = Vector((0, 0, 1)) if abs(dir_bl.z) < 0.9 else Vector((0, 1, 0))
    u_bl = dir_bl.cross(up).normalized() * radius
    v_bl = dir_bl.cross(u_bl).normalized() * radius

    rings = []
    steps_v = 6
    for iv in range(steps_v + 1):
        phi = (math.pi / 2.0) * (iv / steps_v)
        cos_phi = math.cos(phi)
        sin_phi = math.sin(phi)
        ring = []
        for iu in range(segs):
            theta = 2.0 * math.pi * iu / segs
            pos = c_bl + (u_bl * math.cos(theta) + v_bl * math.sin(theta)) * cos_phi + dir_bl * (radius * sin_phi)
            ring.append(bm.verts.new(pos))
        rings.append(ring)

    bm.verts.ensure_lookup_table()
    for iv in range(steps_v):
        r1 = rings[iv]
        r2 = rings[iv + 1]
        for iu in range(segs):
            iu_next = (iu + 1) % segs
            f_verts = [r1[iu], r1[iu_next], r2[iu_next], r2[iu]]
            unique = []
            for v in f_verts:
                if v not in unique:
                    unique.append(v)
            if len(unique) >= 3:
                try:
                    f = bm.faces.new(unique)
                    f.material_index = mat_idx
                except ValueError:
                    pass


def add_box(bm, center_glb, size_x, size_y, size_z, rot_deg=(0, 0, 0), mat_idx=0):
    """Add a box centered at center_glb with dimensions (size_x, size_y, size_z) in GLB coords and Euler rotation."""
    cx, cy, cz = center_glb
    sx, sy, sz = size_x / 2.0, size_y / 2.0, size_z / 2.0

    rx, ry, rz = [math.radians(a) for a in rot_deg]
    corners = [
        Vector((-sx, -sy, -sz)),
        Vector((sx, -sy, -sz)),
        Vector((sx, sy, -sz)),
        Vector((-sx, sy, -sz)),
        Vector((-sx, -sy, sz)),
        Vector((sx, -sy, sz)),
        Vector((sx, sy, sz)),
        Vector((-sx, sy, sz)),
    ]
    Rx = Matrix.Rotation(rx, 3, 'X')
    Ry = Matrix.Rotation(ry, 3, 'Y')
    Rz = Matrix.Rotation(rz, 3, 'Z')
    R = Rz @ Ry @ Rx

    c_vec = Vector((cx, cy, cz))
    verts = []
    for c in corners:
        p_glb = R @ c + c_vec
        verts.append(bm.verts.new(glb_to_bl(p_glb)))

    bm.verts.ensure_lookup_table()
    faces_idx = [
        (0, 4, 5, 1),  # -Y
        (3, 2, 6, 7),  # +Y
        (4, 5, 6, 7),  # +Z
        (1, 0, 3, 2),  # -Z
        (0, 4, 7, 3),  # -X
        (1, 2, 6, 5),  # +X
    ]
    for fi in faces_idx:
        try:
            f = bm.faces.new([verts[i] for i in fi])
            f.material_index = mat_idx
        except ValueError:
            pass

