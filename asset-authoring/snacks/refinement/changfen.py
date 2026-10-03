"""Pawborough fresh-shrimp changfen pilot v5.
Thin open rice-sheet geometry with rounded filling bulges and shared deformation
across the selected cut. Geometry refined by Gemini Flash; root tunes and checks
materials against the actual Three.js game. The earlier planar-UV normal map
made the rice dark and rigid in-game, so v4 uses geometric normals, base color
and roughness textures with thin-sheet transmission. No emissive light hack.
Original national asset remains read-only. Outputs are local candidates.
"""

import sys
import os
import math
import json
import hashlib
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

# Import helpers read-only
REPO_ROOT = Path(__file__).resolve().parents[3]
SYS_PATH = str(REPO_ROOT / 'asset-authoring/snacks/national')
if SYS_PATH not in sys.path:
    sys.path.append(SYS_PATH)
import helpers as H

OUTBOX = Path(os.environ.get('OUTBOX', '/home/baibai/outbox/pawborough-food-refinement-20261003'))
OUT_3D = OUTBOX / '3d' / 'v5'


def ensure_dirs():
    OUT_3D.mkdir(parents=True, exist_ok=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Ensure a clean default scene exists
    if not bpy.data.scenes:
        bpy.data.scenes.new('Scene')
    bpy.context.window.scene = bpy.data.scenes[0]


def create_baked_textures():
    """Create 512x512 image textures for rice skin to bundle inside GLB."""
    size = 512
    # 1. Base color map: moist steamed rice paper with micro-warmth
    img_bc = bpy.data.images.new("tex_rice_skin_baseColor", width=size, height=size, alpha=False)
    # 2. Roughness map: silky moisture variation
    img_rough = bpy.data.images.new("tex_rice_skin_roughness", width=size, height=size, alpha=False)
    # 3. Normal map: fine micro-folds
    img_norm = bpy.data.images.new("tex_rice_skin_normal", width=size, height=size, alpha=False)

    pixels_bc = [0.0] * (size * size * 4)
    pixels_rough = [0.0] * (size * size * 4)
    pixels_norm = [0.0] * (size * size * 4)

    for y in range(size):
        v = y / size
        for x in range(size):
            u = x / size
            idx = (y * size + x) * 4
            # Procedural soft rice fold pattern
            wave1 = math.sin(u * 20.0 * math.pi) * 0.5 + 0.5
            wave2 = math.sin(v * 30.0 * math.pi + u * 10.0) * 0.5 + 0.5
            grain = (math.sin(u * 120.0) * math.cos(v * 120.0)) * 0.04

            # Base color: subtle ivory/pearl rice paper [0.95, 0.94, 0.91]
            base_r = 0.95 + grain * 0.2
            base_g = 0.94 + grain * 0.2
            base_b = 0.91 + grain * 0.15
            pixels_bc[idx] = max(0.0, min(1.0, base_r))
            pixels_bc[idx + 1] = max(0.0, min(1.0, base_g))
            pixels_bc[idx + 2] = max(0.0, min(1.0, base_b))
            pixels_bc[idx + 3] = 1.0

            # Roughness: silky moist sheen, wider wet/dry streak variation
            r_val = 0.26 + 0.10 * wave1 + 0.03 * wave2 + grain
            pixels_rough[idx] = r_val
            pixels_rough[idx + 1] = r_val
            pixels_rough[idx + 2] = r_val
            pixels_rough[idx + 3] = 1.0

            # Normal: tangent space normal (R=X, G=Y, B=Z)
            dx = math.cos(u * 20.0 * math.pi) * 0.15
            dy = math.cos(v * 30.0 * math.pi) * 0.15
            pixels_norm[idx] = 0.5 + dx * 0.5
            pixels_norm[idx + 1] = 0.5 + dy * 0.5
            pixels_norm[idx + 2] = 1.0
            pixels_norm[idx + 3] = 1.0

    img_bc.pixels = pixels_bc
    img_rough.pixels = pixels_rough
    img_norm.pixels = pixels_norm

    img_rough.colorspace_settings.name = 'Non-Color'
    img_norm.colorspace_settings.name = 'Non-Color'

    img_bc.pack()
    img_rough.pack()
    img_norm.pack()

    return img_bc, img_rough, img_norm


def apply_coat(m, coat_weight, coat_roughness):
    """Write clearcoat directly on the Principled BSDF (Blender 4.x names with
    legacy fallback); helpers.make_mat accepts a clearcoat arg but never sets it."""
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    pairs = (
        (('Coat Weight', 'Clearcoat'), coat_weight),
        (('Coat Roughness', 'Clearcoat Roughness'), coat_roughness),
    )
    for names, val in pairs:
        for nm in names:
            if nm in bsdf.inputs:
                bsdf.inputs[nm].default_value = val
                break


def build_materials():
    """Build all 6 materials with proper PBR BSDF and textures."""
    img_bc, img_rough, img_norm = create_baked_textures()

    mats = {}

    # 1. mat_porcelain (shallow white porcelain dish)
    m_porcelain = H.make_mat('mat_porcelain', '#f4f4f0', roughness=0.12, specular=0.88)
    mats['porcelain'] = m_porcelain

    # 2. mat_rice_skin (steamed moist rice skin with baked maps, silky not rubbery)
    m_rice = bpy.data.materials.new('mat_rice_skin')
    m_rice.use_nodes = True
    nt = m_rice.node_tree
    bsdf = nt.nodes.get('Principled BSDF')

    # Connect base color image
    tex_bc_node = nt.nodes.new('ShaderNodeTexImage')
    tex_bc_node.image = img_bc
    nt.links.new(tex_bc_node.outputs['Color'], bsdf.inputs['Base Color'])

    # Connect roughness image
    tex_rough_node = nt.nodes.new('ShaderNodeTexImage')
    tex_rough_node.image = img_rough
    if 'Roughness' in bsdf.inputs:
        nt.links.new(tex_rough_node.outputs['Color'], bsdf.inputs['Roughness'])

    # Use mesh normals: the old planar-UV normal map flattened/darkened the
    # actual GLB skin. Compare material-probe/normal-off-translucent.png.
    bsdf.inputs['IOR'].default_value = 1.33
    transmission = bsdf.inputs.get('Transmission Weight') or bsdf.inputs.get('Transmission')
    if transmission is not None:
        transmission.default_value = 0.45
    specular = bsdf.inputs.get('Specular IOR Level') or bsdf.inputs.get('Specular')
    if specular is not None:
        specular.default_value = 0.35
    apply_coat(m_rice, 0.25, 0.18)

    mats['rice_skin'] = m_rice

    # 3. mat_shrimp (light orange-pink cooked shrimp meat)
    m_shrimp = H.make_mat('mat_shrimp', '#f0907a', roughness=0.35, specular=0.6)
    mats['shrimp'] = m_shrimp

    # 4. mat_soy_sauce (amber brown soy with glossy coat; no near-black slab)
    m_soy = H.make_mat('mat_soy_sauce', '#4b220c', roughness=0.10, specular=0.70)
    apply_coat(m_soy, coat_weight=0.25, coat_roughness=0.06)
    mats['soy_sauce'] = m_soy

    # 5. mat_chopsticks (fine dark hardwood chopsticks)
    m_chop = H.make_mat('mat_chopsticks', '#422415', roughness=0.32, specular=0.65)
    mats['chopsticks'] = m_chop

    # 6. mat_scallion (fresh chopped scallion rings)
    m_scallion = H.make_mat('mat_scallion', '#28801b', roughness=0.35, specular=0.45)
    mats['scallion'] = m_scallion

    return mats


def build_porcelain_plate(root, mat_porcelain):
    """Build shallow white porcelain oval plate (0.23m x 0.16m x 0.014m)."""
    bm = bmesh.new()

    # GLB dimensions: Rx = 0.115, Rz = 0.080, Height Y = 0.014
    # Profile rings from bottom to top:
    # (rx, rz, y_glb)
    profile_rings = [
        (0.000, 0.000, 0.0018),   # Recessed under-center
        (0.045, 0.028, 0.0015),   # Recessed under-floor
        (0.075, 0.048, 0.0000),   # Foot ring bottom contact (Y = 0)
        (0.080, 0.052, 0.0020),   # Outer foot slope
        (0.098, 0.065, 0.0070),   # Outer underside body flare
        (0.115, 0.080, 0.0140),   # Outer rim top crest
        (0.106, 0.072, 0.0135),   # Inner rim lip
        (0.094, 0.060, 0.0070),   # Inner basin side wall
        (0.086, 0.053, 0.0038),   # Basin floor perimeter
        (0.040, 0.025, 0.0035),   # Basin floor mid
        (0.000, 0.000, 0.0033),   # Basin floor center
    ]

    segs = 32
    ring_verts = []

    for rx, rz, y_glb in profile_rings:
        ring = []
        if rx == 0.0 and rz == 0.0:
            v = bm.verts.new(H.glb_to_bl((0.0, y_glb, 0.0)))
            ring = [v] * segs
        else:
            for iseg in range(segs):
                ang = 2.0 * math.pi * iseg / segs
                gx = rx * math.cos(ang)
                gz = rz * math.sin(ang)
                v = bm.verts.new(H.glb_to_bl((gx, y_glb, gz)))
                ring.append(v)
        ring_verts.append(ring)

    bm.verts.ensure_lookup_table()

    for iring in range(len(profile_rings) - 1):
        r1 = ring_verts[iring]
        r2 = ring_verts[iring + 1]
        for iseg in range(segs):
            inxt = (iseg + 1) % segs
            v0 = r1[iseg]
            v1 = r1[inxt]
            v2 = r2[inxt]
            v3 = r2[iseg]
            f_verts = []
            for v in (v0, v1, v2, v3):
                if v not in f_verts:
                    f_verts.append(v)
            if len(f_verts) >= 3:
                try:
                    f = bm.faces.new(f_verts)
                    f.material_index = 0
                except ValueError:
                    pass

    obj = H.create_mesh_object('container', bm, mat_porcelain, parent=root)
    return obj


def build_soy_sauce(root, mat_soy_sauce):
    """Build a thin amber puddle with a slightly irregular meniscus edge as an
    independent mesh child of root. rx ~0.075 / rz ~0.047, film thickness
    < 1 mm, white plate floor left visible around it."""
    bm = bmesh.new()
    segs = 36
    base_rx = 0.0715
    base_rz = 0.0455

    def wob(ang):
        # gentle irregular silhouette (not a perfect ellipse, not a rectangle)
        return (1.0
                + 0.050 * math.sin(3.0 * ang + 1.3)
                + 0.030 * math.sin(5.0 * ang + 0.6)
                + 0.020 * math.sin(2.0 * ang - 0.9))

    def ring(kx, ky, wscale):
        out = []
        for iseg in range(segs):
            ang = 2.0 * math.pi * iseg / segs
            w = 1.0 + (wob(ang) - 1.0) * wscale
            gx = base_rx * kx * w * math.cos(ang)
            gz = base_rz * kx * w * math.sin(ang)
            out.append(bm.verts.new(H.glb_to_bl((gx, ky, gz))))
        return out

    center = [bm.verts.new(H.glb_to_bl((0.0, 0.00425, 0.0)))] * segs
    rings_data = [
        ring(0.40, 0.00425, 0.35),
        ring(0.78, 0.00435, 0.65),
        ring(0.965, 0.00450, 1.0),
        ring(1.0, 0.00445, 1.0),    # outer meniscus crest
    ]
    # lip curling down to the plate floor (y 0.0033-0.0038 basin)
    lip = []
    for iseg in range(segs):
        ang = 2.0 * math.pi * iseg / segs
        gx = base_rx * 1.035 * wob(ang) * math.cos(ang)
        gz = base_rz * 1.035 * wob(ang) * math.sin(ang)
        lip.append(bm.verts.new(H.glb_to_bl((gx, 0.00375, gz))))

    ring_verts = [center] + rings_data + [lip]

    bm.verts.ensure_lookup_table()
    for ir in range(len(ring_verts) - 1):
        r1 = ring_verts[ir]
        r2 = ring_verts[ir + 1]
        for iseg in range(segs):
            inxt = (iseg + 1) % segs
            f_verts = []
            for v in (r1[iseg], r1[inxt], r2[inxt], r2[iseg]):
                if v not in f_verts:
                    f_verts.append(v)
            if len(f_verts) >= 3:
                try:
                    f = bm.faces.new(f_verts)
                    f.material_index = 0
                except ValueError:
                    pass

    obj = H.create_mesh_object('sauce', bm, mat_soy_sauce, parent=root)
    return obj


def get_folded_rice_cross_section():
    """Return an open folded sheet curve in local (z, y) coordinates.
    Points trace an open spiral wrap with visible top flap and inner envelope flap.
    """
    # z_local, y_local (meters) relative to roll center
    # Top flap starts at outer top right with visible open step edge
    return [
        (0.0070, 0.0126),   # 0: Visible outer flap lip / seam edge
        (0.0020, 0.0130),   # 1: Top crest
        (-0.0050, 0.0125),  # 2: Top left curve
        (-0.0110, 0.0108),  # 3: Left shoulder
        (-0.0145, 0.0078),  # 4: Left side flank
        (-0.0150, 0.0038),  # 5: Lower left corner
        (-0.0120, 0.0010),  # 6: Bottom left
        (-0.0050, 0.0004),  # 7: Bottom floor
        (0.0050, 0.0004),   # 8: Bottom floor
        (0.0120, 0.0010),   # 9: Bottom right
        (0.0150, 0.0038),   # 10: Lower right corner
        (0.0145, 0.0075),   # 11: Right side flank
        (0.0115, 0.0105),   # 12: Inward fold upper curve
        (0.0055, 0.0112),   # 13: Under the outer top flap
        (-0.0010, 0.0100),  # 14: Inside ceiling
        (-0.0070, 0.0072),  # 15: Wrapping inside around shrimp cavity
        (-0.0030, 0.0042),  # 16: Inner envelope flap open end
    ]


def add_curved_shrimp(bm, center_glb, length_scale=1.0, rot_y_deg=0.0, mat_idx=1):
    """Natural ~140 deg C-curved shrimp meat.

    The cross section now rotates with the arc: for each arc sample the XZ
    tangent is taken and the lateral normal is (-tangentZ, tangentX). Ring
    point = arcCenter + lateralN*(radius*cos(phi)) + Y*(radius*0.85*sin(phi)).
    Caps use the true first/last arc centers; winding is recalc'd outward and
    shading is smooth (create_mesh_object marks all polys smooth).
    """
    cx, cy, cz = center_glb
    ang_rad = math.radians(rot_y_deg)
    ca = math.cos(ang_rad)
    sa = math.sin(ang_rad)

    num_steps = 13          # 14 arc samples
    segs_ring = 12
    span = math.radians(140.0)
    half = span * 0.5
    r_arc = 0.0090 * length_scale
    thick0 = 0.0042 * length_scale
    # C-arc center placed so the chord midpoint lands on center_glb
    acx_local = -r_arc * math.cos(half)

    rings = []
    centers = []
    shrimp_faces = []

    for i in range(num_steps + 1):
        t = i / num_steps
        th = -half + span * t

        # local arc center offset -> world (rotate around GLB Y)
        ox = acx_local * ca
        oz = -acx_local * sa
        acx = cx + ox
        acz = cz + oz

        # arc point offset in local XZ, then rotate
        px_loc = r_arc * math.cos(th)
        pz_loc = r_arc * math.sin(th)
        gx = cx + (acx_local + px_loc) * ca - pz_loc * sa
        gz = cz + (acx_local + px_loc) * sa + pz_loc * ca

        # tangent of the arc in world XZ
        tx = (-math.sin(th)) * ca - math.cos(th) * sa
        tz = (-math.sin(th)) * sa + math.cos(th) * ca
        tl = math.hypot(tx, tz) or 1.0
        tx /= tl
        tz /= tl
        # tangent-orthogonal lateral normal in the XZ plane
        nx = -tz
        nz = tx

        # plump head, gently segmented, tapering tail
        thick = thick0 * (1.0 - 0.58 * t) * (1.0 + 0.08 * math.sin(t * math.pi * 5.0))
        thick = max(thick, thick0 * 0.20)
        bow_y = 0.0006 * math.sin(t * math.pi)
        cy_i = cy + bow_y

        centers.append(bm.verts.new(H.glb_to_bl((gx, cy_i, gz))))
        ring = []
        for ir in range(segs_ring):
            phi = 2.0 * math.pi * ir / segs_ring
            rx = thick * math.cos(phi)
            ry = (thick * 0.85) * math.sin(phi)
            px = gx + nx * rx
            py = cy_i + ry
            pz = gz + nz * rx
            ring.append(bm.verts.new(H.glb_to_bl((px, py, pz))))
        rings.append(ring)

    bm.verts.ensure_lookup_table()
    for i in range(num_steps):
        r1 = rings[i]
        r2 = rings[i + 1]
        for ir in range(segs_ring):
            inxt = (ir + 1) % segs_ring
            try:
                f = bm.faces.new([r1[ir], r1[inxt], r2[inxt], r2[ir]])
                f.material_index = mat_idx
                shrimp_faces.append(f)
            except ValueError:
                pass

    # Caps at the true first / last arc centers
    for c_v, ring in ((centers[0], rings[0]), (centers[-1], rings[-1])):
        for ir in range(segs_ring):
            inxt = (ir + 1) % segs_ring
            try:
                f = bm.faces.new([c_v, ring[inxt], ring[ir]])
                f.material_index = mat_idx
                shrimp_faces.append(f)
            except ValueError:
                pass

    # Outward winding for the closed shrimp shell
    if shrimp_faces:
        bmesh.ops.recalc_face_normals(bm, faces=shrimp_faces)


def add_scallion_ring(bm, pos_glb, radius=0.0022, height=0.0016, mat_idx=2):
    """Add a hollow scallion ring."""
    cx, cy, cz = pos_glb
    segs = 8
    thick = 0.0006
    r_out = radius
    r_in = radius - thick

    ring_out_b = []
    ring_out_t = []
    ring_in_b = []
    ring_in_t = []

    for i in range(segs):
        ang = 2.0 * math.pi * i / segs
        dx = math.cos(ang)
        dz = math.sin(ang)

        ring_out_b.append(bm.verts.new(H.glb_to_bl((cx + r_out * dx, cy, cz + r_out * dz))))
        ring_out_t.append(bm.verts.new(H.glb_to_bl((cx + r_out * dx, cy + height, cz + r_out * dz))))
        ring_in_b.append(bm.verts.new(H.glb_to_bl((cx + r_in * dx, cy, cz + r_in * dz))))
        ring_in_t.append(bm.verts.new(H.glb_to_bl((cx + r_in * dx, cy + height, cz + r_in * dz))))

    bm.verts.ensure_lookup_table()
    for i in range(segs):
        inxt = (i + 1) % segs
        # Outer wall
        try:
            f = bm.faces.new([ring_out_b[i], ring_out_b[inxt], ring_out_t[inxt], ring_out_t[i]])
            f.material_index = mat_idx
        except ValueError:
            pass
        # Inner wall
        try:
            f = bm.faces.new([ring_in_b[inxt], ring_in_b[i], ring_in_t[i], ring_in_t[inxt]])
            f.material_index = mat_idx
        except ValueError:
            pass
        # Top lip
        try:
            f = bm.faces.new([ring_out_t[i], ring_out_t[inxt], ring_in_t[inxt], ring_in_t[i]])
            f.material_index = mat_idx
        except ValueError:
            pass
        # Bottom lip
        try:
            f = bm.faces.new([ring_out_b[inxt], ring_out_b[i], ring_in_b[i], ring_in_b[inxt]])
            f.material_index = mat_idx
        except ValueError:
            pass


def create_folded_roll_segment(name, x_start, x_end, z_center, y_base, num_x_steps=12,
                               shrimps_info=None, scallions_info=None, mats=None, parent=None,
                               roll_shrimps=None):
    """Create a thin folded rice sheet segment with thickness, open cut ends, and internal shrimp.

    Longitudinal sampling per piece (long pieces use ~36). Soft staggered
    ripples and occasional lip droop ride on top; the phase comes from
    z_center and global cur_x so the three rolls differ while the two segments
    of one roll (rice-piece-0 and rice-piece-1) stay continuous across the cut.
    """
    bm = bmesh.new()
    cross_pts = get_folded_rice_cross_section()
    num_pts = len(cross_pts)
    length = x_end - x_start
    roll_phase = z_center * 37.0
    lip_max_y = max(ly for _, ly in cross_pts)
    skin_shrimps = roll_shrimps if roll_shrimps is not None else (shrimps_info or [])

    # Extrude cross section along X
    outer_rings = []
    inner_rings = []
    sheet_thickness = 0.00085  # 0.85mm authentic rice sheet thickness

    for ix in range(num_x_steps + 1):
        t_x = ix / num_x_steps
        cur_x = x_start + length * t_x

        # Gentle longitudinal irregularity: smooth low-frequency undulations (~1.5–2mm total amplitude)
        # Low frequency waves (lambda ~7-14cm) along the 14.5cm roll
        wobble_y = (0.0012 * math.sin(cur_x * 45.0 + roll_phase)
                    + 0.0006 * math.sin(cur_x * 85.0 + roll_phase * 0.7))
        wobble_z = 0.0008 * math.cos(cur_x * 50.0 + roll_phase * 1.2)

        # Soft width variation along length (~1–2mm peak-to-peak width change)
        width_var = 0.0007 * math.sin(cur_x * 55.0 + roll_phase * 1.4 + 0.8)

        # Occasional falling lip: smooth gentle drape on outer flap edge
        droop_wave = max(0.0, math.sin(cur_x * 52.0 + roll_phase * 2.1))

        # Local rounded shrimp bulges: evaluate smooth 3D rounded mounds over all shrimps in roll
        # Shrimp lifts upper skin by ~2.2-2.5mm and gently widens flanks by ~1-1.5mm
        shrimp_bulge_y = 0.0
        shrimp_bulge_z_factor = 0.0
        for s_info in skin_shrimps:
            sx = s_info['pos'][0]
            s_scale = s_info.get('scale', 1.0)
            dx = cur_x - sx
            rx_shrimp = 0.022 * s_scale
            if abs(dx) < rx_shrimp:
                u = abs(dx) / rx_shrimp
                # Smooth cosine bell curve (C1 continuous at center and boundary)
                fx = 0.5 * (1.0 + math.cos(math.pi * u))
                shrimp_bulge_y += 0.0024 * s_scale * fx
                shrimp_bulge_z_factor += 0.0010 * s_scale * fx

        ring_out = []
        ring_in = []

        for ip in range(num_pts):
            lz, ly = cross_pts[ip]
            gx = cur_x

            # Normalization and falloffs across cross-section:
            # Bottom floor (ly <= 0.0018) rests on plate/sauce and does not lift off
            t_floor = max(0.0, min(1.0, (ly - 0.0018) / 0.0085))
            top_factor = t_floor * t_floor * (3.0 - 2.0 * t_floor)

            # Lateral falloff for top dome
            norm_lz = lz / 0.015
            lat_falloff = max(0.0, 1.0 - 0.35 * (norm_lz ** 2))

            # Outer flap lip droop
            lip_f = max(0.0, (ly - 0.0090) / max(lip_max_y - 0.0090, 1e-6))
            droop_y = -0.0012 * (lip_f ** 2) * droop_wave

            # Total vertical position: base + profile + longitudinal wave + shrimp dome + lip droop
            bulge_y = shrimp_bulge_y * top_factor * lat_falloff
            gy = y_base + ly + wobble_y * (0.5 + 0.5 * top_factor) + bulge_y + droop_y

            # Total lateral position: center + lz + width variation + longitudinal drift + shrimp flank expansion
            bulge_z = shrimp_bulge_z_factor * norm_lz * top_factor
            gz = z_center + lz + norm_lz * width_var + wobble_z + bulge_z

            # Normal offset for physical thickness
            # Approximate outward normal from center
            n_len = math.hypot(lz, ly - 0.006)
            nz = (lz / n_len) if n_len > 1e-5 else 0.0
            ny = ((ly - 0.006) / n_len) if n_len > 1e-5 else 1.0

            vo = bm.verts.new(H.glb_to_bl((gx, gy, gz)))
            vi = bm.verts.new(H.glb_to_bl((gx, gy - ny * sheet_thickness, gz - nz * sheet_thickness)))
            ring_out.append(vo)
            ring_in.append(vi)

        outer_rings.append(ring_out)
        inner_rings.append(ring_in)

    bm.verts.ensure_lookup_table()

    # Create outer surface faces
    for ix in range(num_x_steps):
        r1 = outer_rings[ix]
        r2 = outer_rings[ix + 1]
        for ip in range(num_pts - 1):
            try:
                f = bm.faces.new([r1[ip], r2[ip], r2[ip + 1], r1[ip + 1]])
                f.material_index = 0
            except ValueError:
                pass

    # Create inner surface faces (reversed winding)
    for ix in range(num_x_steps):
        r1 = inner_rings[ix]
        r2 = inner_rings[ix + 1]
        for ip in range(num_pts - 1):
            try:
                f = bm.faces.new([r1[ip + 1], r2[ip + 1], r2[ip], r1[ip]])
                f.material_index = 0
            except ValueError:
                pass

    # Connect edge seams along X: Point 0 (top outer flap lip) and Point 16 (inner flap lip)
    for ix in range(num_x_steps):
        # Outer flap lip seam
        try:
            f0 = bm.faces.new([outer_rings[ix][0], inner_rings[ix][0], inner_rings[ix + 1][0], outer_rings[ix + 1][0]])
            f0.material_index = 0
        except ValueError:
            pass
        # Inner flap lip seam
        try:
            f16 = bm.faces.new([inner_rings[ix][-1], outer_rings[ix][-1], outer_rings[ix + 1][-1], inner_rings[ix + 1][-1]])
            f16.material_index = 0
        except ValueError:
            pass

    # Cut ends (x = x_start and x = x_end): Connect rim between outer and inner ring
    # These show the true folded cross-section layers!
    for is_end, ring_idx in ((False, 0), (True, -1)):
        ro = outer_rings[ring_idx]
        ri = inner_rings[ring_idx]
        for ip in range(num_pts - 1):
            try:
                if is_end:
                    f = bm.faces.new([ro[ip], ri[ip], ri[ip + 1], ro[ip + 1]])
                else:
                    f = bm.faces.new([ro[ip + 1], ri[ip + 1], ri[ip], ro[ip]])
                f.material_index = 0
            except ValueError:
                pass

    # Add shrimp fillings inside
    if shrimps_info:
        for s in shrimps_info:
            add_curved_shrimp(bm, s['pos'], length_scale=s.get('scale', 1.0),
                              rot_y_deg=s.get('rot_y', 0.0), mat_idx=1)

    # Add scallions on top
    if scallions_info:
        for sc in scallions_info:
            sc_pos = sc['pos']
            sc_x = sc_pos[0]
            sc_wobble_y = (0.0012 * math.sin(sc_x * 45.0 + roll_phase)
                           + 0.0006 * math.sin(sc_x * 85.0 + roll_phase * 0.7))
            sc_bulge_y = 0.0
            for s_info in skin_shrimps:
                sx = s_info['pos'][0]
                s_scale = s_info.get('scale', 1.0)
                dx = sc_x - sx
                rx_shrimp = 0.022 * s_scale
                if abs(dx) < rx_shrimp:
                    u = abs(dx) / rx_shrimp
                    fx = 0.5 * (1.0 + math.cos(math.pi * u))
                    sc_bulge_y += 0.0024 * s_scale * fx
            sc_y_adj = sc_pos[1] + sc_wobble_y + sc_bulge_y
            add_scallion_ring(bm, (sc_x, sc_y_adj, sc_pos[2]),
                              radius=sc.get('radius', 0.0022),
                              height=sc.get('height', 0.0016), mat_idx=2)

    mesh_mats = [mats['rice_skin'], mats['shrimp'], mats['scallion']]
    obj = H.create_mesh_object(name, bm, mesh_mats, parent=parent)
    # Bake the soft tint of shrimp beneath thin rice into vertex color. This
    # keeps the filling legible at the small held-food size, alongside actual
    # closed shrimp geometry at open cuts and thin-sheet transmission.
    tint = obj.data.color_attributes.new(name='filling_under_skin', type='FLOAT_COLOR', domain='CORNER')
    obj.data.color_attributes.active_color = tint
    for poly in obj.data.polygons:
        for loop_index in poly.loop_indices:
            pos = H.bl_to_glb(obj.data.vertices[obj.data.loops[loop_index].vertex_index].co)
            influence = 0.0
            if poly.material_index == 0:
                for info in skin_shrimps:
                    dx = (pos.x - info['pos'][0]) / 0.012
                    dz = (pos.z - info['pos'][2]) / 0.011
                    influence = max(influence, math.exp(-0.5 * (dx*dx + dz*dz)))
                # Gentle warm translucency, never exposed painted pink patches.
                influence *= 0.25 * max(0.0, min(1.0, (pos.y - y_base - 0.003) / 0.008))
            tint.data[loop_index].color = (1.0, 1.0 - 0.4*influence, 1.0 - 0.55*influence, 1.0)

    return obj


def build_edible_group(root, mats):
    """Build edible Group containing independent rice-piece-0..3 objects.
    rice-piece-0 is the selected cut portion of length 0.0375m located at +X on Roll A.
    """
    edible_grp = bpy.data.objects.new('edible', None)
    bpy.context.collection.objects.link(edible_grp)
    edible_grp.parent = root

    y_base = 0.0042  # Sits right above soy sauce

    # 3 rolls:
    # Roll A (front-left): Z = -0.038
    # Roll B (center): Z = 0.000
    # Roll C (back-right): Z = +0.038

    # Roll A is cut into:
    # - rice-piece-0: X = +0.035 to +0.0725 (length 0.0375m, center X = +0.05375, Z = -0.038)
    # - rice-piece-1: X = -0.0725 to +0.035 (length 0.1075m, center X = -0.01875, Z = -0.038)
    # Cooked curved shrimps around visible cut end (X = 0.035) raised by ~2mm (from 0.0076 to 0.0096)
    # so cut section shows actual filling rather than sunken disconnected shards.
    p0_shrimps = [
        {'pos': (0.046, 0.0096, -0.038), 'scale': 1.15, 'rot_y': 22.0}
    ]
    p0_scallions = [
        {'pos': (0.056, 0.0168, -0.036)}
    ]

    p1_shrimps = [
        {'pos': (-0.045, 0.0074, -0.038), 'scale': 1.05, 'rot_y': -10.0},
        {'pos': (0.024, 0.0096, -0.038), 'scale': 1.15, 'rot_y': -22.0}
    ]
    p1_scallions = [
        {'pos': (-0.025, 0.0168, -0.037)},
        {'pos': (0.012, 0.0168, -0.039)}
    ]

    # Shared Roll A shrimps list so rice-piece-0 and rice-piece-1 seam stays continuous
    roll_a_shrimps = p1_shrimps + p0_shrimps

    p0 = create_folded_roll_segment('rice-piece-0', 0.035, 0.0725, -0.038, y_base,
                                    num_x_steps=14, shrimps_info=p0_shrimps,
                                    scallions_info=p0_scallions, mats=mats, parent=edible_grp,
                                    roll_shrimps=roll_a_shrimps)

    p1 = create_folded_roll_segment('rice-piece-1', -0.0725, 0.035, -0.038, y_base,
                                    num_x_steps=36, shrimps_info=p1_shrimps,
                                    scallions_info=p1_scallions, mats=mats, parent=edible_grp,
                                    roll_shrimps=roll_a_shrimps)

    # Roll B: rice-piece-2 (Z = 0.000, length 0.145m)
    p2_shrimps = [
        {'pos': (-0.048, 0.0071, 0.000), 'scale': 1.0, 'rot_y': -5.0},
        {'pos': (0.000, 0.0071, 0.000), 'scale': 1.1, 'rot_y': 12.0},
        {'pos': (0.048, 0.0071, 0.000), 'scale': 1.05, 'rot_y': -15.0}
    ]
    p2_scallions = [
        {'pos': (-0.030, 0.0168, 0.002)},
        {'pos': (0.020, 0.0168, -0.002)}
    ]
    p2 = create_folded_roll_segment('rice-piece-2', -0.0725, 0.0725, 0.000, y_base,
                                    num_x_steps=36, shrimps_info=p2_shrimps,
                                    scallions_info=p2_scallions, mats=mats, parent=edible_grp,
                                    roll_shrimps=p2_shrimps)

    # Roll C: rice-piece-3 (Z = +0.038, length 0.145m)
    p3_shrimps = [
        {'pos': (-0.045, 0.0071, 0.038), 'scale': 1.05, 'rot_y': 10.0},
        {'pos': (0.005, 0.0071, 0.038), 'scale': 1.0, 'rot_y': -8.0},
        {'pos': (0.050, 0.0071, 0.038), 'scale': 1.0, 'rot_y': 20.0}
    ]
    p3_scallions = [
        {'pos': (-0.010, 0.0168, 0.036)},
        {'pos': (0.035, 0.0168, 0.040)}
    ]
    p3 = create_folded_roll_segment('rice-piece-3', -0.0725, 0.0725, 0.038, y_base,
                                    num_x_steps=36, shrimps_info=p3_shrimps,
                                    scallions_info=p3_scallions, mats=mats, parent=edible_grp,
                                    roll_shrimps=p3_shrimps)

    return edible_grp, [p0, p1, p2, p3]


def build_utensil_tree(root, mats):
    """Build utensil subtree with chopstick-L, chopstick-R, toolGrip, toolBite, tipL, tipR, and toolFood.
    Chopsticks clamp toolFood (width 0.028m, length 0.035m) at toolBite.
    toolFood is default hidden.
    """
    # utensil parent object
    # In rest state, placed at side of plate
    utensil_glb_pos = (0.088, 0.018, -0.045)
    utensil_obj = bpy.data.objects.new('utensil', None)
    utensil_obj.location = H.glb_to_bl(utensil_glb_pos)
    bpy.context.collection.objects.link(utensil_obj)
    utensil_obj.parent = root

    # In utensil local space:
    # toolGrip is at [0.0, 0.0, -0.106] in GLB (Blender: [0.0, 0.106, 0.0])
    # toolBite is at [0.0, 0.0, 0.106] in GLB (Blender: [0.0, -0.106, 0.0])
    # Chopsticks run from grip to bite:
    # chopstick-L: grip at (-0.0045, 0.0, -0.106), tip at (-0.0140, 0.0, 0.106)
    # chopstick-R: grip at (+0.0045, 0.0, -0.106), tip at (+0.0140, 0.0, 0.106)
    # Distance between tips = 0.0280m!
    # Tip distance exactly clamps toolFood width 0.0280m!

    bm_chop_l = bmesh.new()
    H.add_cylinder(bm_chop_l, (-0.0045, 0.0, -0.106), (-0.0140, 0.0, 0.106), 0.0024, segs=12, cap1=True, cap2=True)
    chop_l = H.create_mesh_object('chopstick-L', bm_chop_l, mats['chopsticks'], parent=utensil_obj)

    bm_chop_r = bmesh.new()
    H.add_cylinder(bm_chop_r, (+0.0045, 0.0, -0.106), (+0.0140, 0.0, 0.106), 0.0024, segs=12, cap1=True, cap2=True)
    chop_r = H.create_mesh_object('chopstick-R', bm_chop_r, mats['chopsticks'], parent=utensil_obj)

    # Anchors in utensil local space
    toolGrip = bpy.data.objects.new('toolGrip', None)
    toolGrip.location = H.glb_to_bl((0.0, 0.0, -0.106))
    toolGrip.parent = utensil_obj
    bpy.context.collection.objects.link(toolGrip)

    toolBite = bpy.data.objects.new('toolBite', None)
    toolBite.location = H.glb_to_bl((0.0, 0.0, 0.106))
    toolBite.parent = utensil_obj
    bpy.context.collection.objects.link(toolBite)

    tipL = bpy.data.objects.new('tipL', None)
    tipL.location = H.glb_to_bl((-0.0140, 0.0, 0.106))
    tipL.parent = utensil_obj
    bpy.context.collection.objects.link(tipL)

    tipR = bpy.data.objects.new('tipR', None)
    tipR.location = H.glb_to_bl((+0.0140, 0.0, 0.106))
    tipR.parent = utensil_obj
    bpy.context.collection.objects.link(tipR)

    # toolFood: clamped cut morsel (width 0.028m, length 0.035m, height 0.013m)
    # Centered at toolBite [0.0, 0.0, 0.106]
    # Local Z ranges from 0.106 - 0.0175 to 0.106 + 0.0175
    # Local X ranges from -0.0140 to +0.0140 (clamped by chopstick tips!)
    bm_tf = bmesh.new()
    tf_shrimps = [{'pos': (0.0, 0.0, 0.106), 'scale': 0.85, 'rot_y': 25.0}]
    tf_scallions = [{'pos': (0.002, 0.0065, 0.106)}]

    # Build thin folded skin slice in utensil local space
    # Extrude along GLB Z from 0.0885 to 0.1235 (length 0.035m)
    cross_pts = get_folded_rice_cross_section()
    # Scale cross section to width 0.028m (x spans -0.014 to +0.014)
    # cross_pts original spans z from -0.015 to +0.015 (span 0.030)
    scale_w = 0.028 / 0.030
    num_pts = len(cross_pts)
    num_steps = 10
    z_min = 0.106 - 0.0175
    z_max = 0.106 + 0.0175

    tf_out_rings = []
    tf_in_rings = []
    thickness = 0.00085

    for iz in range(num_steps + 1):
        tz = iz / num_steps
        cur_z = z_min + 0.035 * tz
        wobble = 0.0004 * math.sin(cur_z * 80.0)

        ring_out = []
        ring_in = []
        for ip in range(num_pts):
            lz, ly = cross_pts[ip]
            gx = lz * scale_w
            gy = (ly - 0.0065) + wobble
            gz = cur_z

            n_len = math.hypot(lz, ly - 0.006)
            nx = (lz / n_len) if n_len > 1e-5 else 0.0
            ny = ((ly - 0.006) / n_len) if n_len > 1e-5 else 1.0

            vo = bm_tf.verts.new(H.glb_to_bl((gx, gy, gz)))
            vi = bm_tf.verts.new(H.glb_to_bl((gx - nx * thickness, gy - ny * thickness, gz)))
            ring_out.append(vo)
            ring_in.append(vi)
        tf_out_rings.append(ring_out)
        tf_in_rings.append(ring_in)

    bm_tf.verts.ensure_lookup_table()
    for iz in range(num_steps):
        r1 = tf_out_rings[iz]
        r2 = tf_out_rings[iz + 1]
        for ip in range(num_pts - 1):
            try:
                f = bm_tf.faces.new([r1[ip], r2[ip], r2[ip + 1], r1[ip + 1]])
                f.material_index = 0
            except ValueError:
                pass

    for iz in range(num_steps):
        r1 = tf_in_rings[iz]
        r2 = tf_in_rings[iz + 1]
        for ip in range(num_pts - 1):
            try:
                f = bm_tf.faces.new([r1[ip + 1], r2[ip + 1], r2[ip], r1[ip]])
                f.material_index = 0
            except ValueError:
                pass

    # Connect lips
    for iz in range(num_steps):
        try:
            f0 = bm_tf.faces.new([tf_out_rings[iz][0], tf_in_rings[iz][0], tf_in_rings[iz + 1][0], tf_out_rings[iz + 1][0]])
            f0.material_index = 0
        except ValueError:
            pass
        try:
            f16 = bm_tf.faces.new([tf_in_rings[iz][-1], tf_out_rings[iz][-1], tf_out_rings[iz + 1][-1], tf_in_rings[iz + 1][-1]])
            f16.material_index = 0
        except ValueError:
            pass

    # Open cut ends
    for is_end, ring_idx in ((False, 0), (True, -1)):
        ro = tf_out_rings[ring_idx]
        ri = tf_in_rings[ring_idx]
        for ip in range(num_pts - 1):
            try:
                if is_end:
                    f = bm_tf.faces.new([ro[ip], ri[ip], ri[ip + 1], ro[ip + 1]])
                else:
                    f = bm_tf.faces.new([ro[ip + 1], ri[ip + 1], ri[ip], ro[ip]])
                f.material_index = 0
            except ValueError:
                pass

    # Add small peeking shrimp inside
    add_curved_shrimp(bm_tf, (0.0, -0.0004, 0.106), length_scale=0.85, rot_y_deg=20.0, mat_idx=1)

    toolFood = H.create_mesh_object('toolFood', bm_tf, [mats['rice_skin'], mats['shrimp']], parent=utensil_obj)
    # Default hidden: carry does not show extra floating mouthful
    toolFood['visible'] = False
    toolFood['defaultHidden'] = True
    toolFood.hide_viewport = True
    toolFood.hide_render = True

    return utensil_obj


def build_anchors(root):
    """Build all required root anchors."""
    # socket_grip: holder origin [0, 0, 0]
    H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
    # socket_rest: plate rest origin [0, 0, 0]
    H.make_empty('socket_rest', (0.0, 0.0, 0.0), parent=root)
    # leftSupport: under-plate support (+X ~0.085, Y bottom ~0.0, Z ~-0.010)
    H.make_empty('leftSupport', (0.085, 0.000, -0.010), parent=root)
    # rightSupport: legacy standby (-0.085, 0.0, -0.010)
    H.make_empty('rightSupport', (-0.085, 0.000, -0.010), parent=root)
    # content: center of selected portion rice-piece-0 (+0.0538, 0.011, -0.038)
    H.make_empty('content', (0.0538, 0.011, -0.038), parent=root)
    # bite: bite anchor
    H.make_empty('bite', (0.0538, 0.011, -0.038), parent=root)


def setup_world_and_lighting():
    """Create warm studio lighting and background for food photography."""
    scene = bpy.context.scene
    world = scene.world
    if not world:
        world = bpy.data.worlds.new('World')
        scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (0.92, 0.91, 0.88, 1.0)
        bg.inputs['Strength'].default_value = 0.85

    # Key light: warm soft directional
    key_data = bpy.data.lights.new('KeyLight', type='SUN')
    key_data.energy = 3.2
    key_data.color = (1.0, 0.98, 0.94)
    key_obj = bpy.data.objects.new('KeyLight', key_data)
    key_obj.location = (0.35, -0.35, 0.45)
    key_obj.rotation_euler = (math.radians(45), math.radians(15), math.radians(40))
    bpy.context.collection.objects.link(key_obj)

    # Fill light: cool soft fill
    fill_data = bpy.data.lights.new('FillLight', type='SUN')
    fill_data.energy = 1.6
    fill_data.color = (0.94, 0.96, 1.0)
    fill_obj = bpy.data.objects.new('FillLight', fill_data)
    fill_obj.location = (-0.35, -0.35, 0.35)
    fill_obj.rotation_euler = (math.radians(40), math.radians(-25), math.radians(-50))
    bpy.context.collection.objects.link(fill_obj)

    return [key_obj, fill_obj]


def render_views(render_objs_to_remove):
    """Render the 3 required PNG views (into the versioned OUT_3D directory):
    1. 3/4 full plate (changfen_3quarter.png)
    2. Fold edge close-up (changfen_fold_edge.png)
    3. Chopstick tips clamping segment close-up (changfen_bite_section.png)
    """
    scene = bpy.context.scene
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 768
    scene.render.image_settings.file_format = 'PNG'

    cam_data = bpy.data.cameras.new('RenderCam')
    cam_data.lens = 60.0
    cam_obj = bpy.data.objects.new('RenderCam', cam_data)
    bpy.context.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    # Create aim target empty
    aim_target = bpy.data.objects.new('AimTarget', None)
    bpy.context.collection.objects.link(aim_target)
    track_mod = cam_obj.constraints.new(type='TRACK_TO')
    track_mod.target = aim_target
    track_mod.track_axis = 'TRACK_NEGATIVE_Z'
    track_mod.up_axis = 'UP_Y'

    # 1. 3/4 Full Plate View
    aim_target.location = (0.01, 0.0, 0.010)
    cam_data.lens = 55.0
    cam_obj.location = (0.16, -0.26, 0.22)
    scene.render.filepath = str(OUT_3D / 'changfen_3quarter.png')
    bpy.ops.render.render(write_still=True)
    print(f"Rendered: {scene.render.filepath}")

    # 2. Fold Edge Close-up View
    # Focus on the cut face of rice-piece-0 (X = 0.035, GLB Z = -0.038 -> Blender Y = +0.038)
    aim_target.location = (0.035, 0.038, 0.011)
    cam_data.lens = 95.0
    cam_obj.location = (0.095, -0.035, 0.065)
    scene.render.filepath = str(OUT_3D / 'changfen_fold_edge.png')
    bpy.ops.render.render(write_still=True)
    print(f"Rendered: {scene.render.filepath}")

    # 3. Chopstick Tip Bite Close-up View
    toolFood = bpy.data.objects.get('toolFood')
    if toolFood:
        toolFood.hide_render = False
        toolFood.hide_viewport = False

    # Target toolBite in world space
    utensil = bpy.data.objects.get('utensil')
    u_loc = utensil.location if utensil else Vector((0, 0, 0))
    # In Blender coords, toolBite is at u_loc + (0, -0.106, 0)
    bite_world = Vector((u_loc.x, u_loc.y - 0.106, u_loc.z))
    aim_target.location = bite_world

    cam_data.lens = 110.0
    cam_obj.location = (bite_world.x + 0.065, bite_world.y - 0.075, bite_world.z + 0.055)
    scene.render.filepath = str(OUT_3D / 'changfen_bite_section.png')
    bpy.ops.render.render(write_still=True)
    print(f"Rendered: {scene.render.filepath}")

    # Restore toolFood default hidden
    if toolFood:
        toolFood.hide_render = True
        toolFood.hide_viewport = True

    # Remove temporary camera, target and lights
    bpy.data.objects.remove(cam_obj, do_unlink=True)
    bpy.data.objects.remove(aim_target, do_unlink=True)
    for l_obj in render_objs_to_remove:
        bpy.data.objects.remove(l_obj, do_unlink=True)


def build_changfen_model():
    ensure_dirs()
    reset_scene()

    mats = build_materials()

    root = bpy.data.objects.new('changfen', None)
    bpy.context.collection.objects.link(root)

    # 1. Container: White porcelain shallow plate
    plate_obj = build_porcelain_plate(root, mats['porcelain'])

    # 2. Sauce: Independent root child mesh
    sauce_obj = build_soy_sauce(root, mats['soy_sauce'])

    # 3. Edible: Group with rice-piece-0..3
    edible_grp, pieces = build_edible_group(root, mats)

    # 4. Utensil: chopstick-L/R, toolFood, tipL/R, toolGrip/Bite
    utensil_obj = build_utensil_tree(root, mats)

    # 5. Root Anchors
    build_anchors(root)

    # Save .blend file
    blend_path = OUT_3D / 'changfen-v5.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    print(f"SAVED_BLEND: {blend_path}")

    # Render 3 PNG views
    lights = setup_world_and_lighting()
    render_views(lights)

    # Export GLB (no cameras, no lights, no ground)
    glb_path = OUT_3D / 'changfen-v5.glb'
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True
    )
    print(f"EXPORTED_GLB: {glb_path}")

    # Inspect model metrics
    file_bytes = glb_path.stat().st_size
    with open(glb_path, 'rb') as f:
        glb_data = f.read()
    sha256 = hashlib.sha256(glb_data).hexdigest()

    # Count triangles and materials
    tot_tris = 0
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            tot_tris += sum(len(p.vertices) - 2 for p in obj.data.polygons)

    tot_mats = len(bpy.data.materials)

    # Tip distance check
    tipL = bpy.data.objects.get('tipL')
    tipR = bpy.data.objects.get('tipR')
    tip_dist = (tipL.location - tipR.location).length if (tipL and tipR) else 0.0

    inspection = {
        "file": str(glb_path),
        "version": "v5",
        "sha256": sha256,
        "fileBytes": file_bytes,
        "triangles": tot_tris,
        "materials": tot_mats,
        "tipDistanceM": round(tip_dist, 5),
        "budget": {
            "maxBytes": 1572864,
            "maxTriangles": 16000,
            "maxMaterials": 8,
            "bytesPass": file_bytes <= 1572864,
            "trisPass": tot_tris <= 16000,
            "matsPass": tot_mats <= 8
        },
        "fixes": {
            "shrimp": "tangent-orthogonal rotating sections, 14 arc pts x 12 ring pts, 140deg C-bend, true end caps, recalc outward normals",
            "sauce": {
                "baseColor": "#4b220c",
                "roughness": 0.10,
                "specular": 0.70,
                "coatWeight": 0.25,
                "coatRoughness": 0.06,
                "puddleRxM": 0.075,
                "puddleRzM": 0.047,
                "meniscusIrregular": True,
                "thinFilm": True
            },
            "rice": {
                "openFoldedLayersKept": True,
                "longSamplesLongPieces": 36,
                "rippleAmpM": 0.0012,
                "lipDroopM": 0.0013,
                "phasePerRoll": True,
                "bakedMapsInGlb": ["tex_rice_skin_baseColor", "tex_rice_skin_roughness"],
                "transmission": 0.45,
                "fillingCue": "soft spatial vertex tint over actual shrimp; cut mesh remains visible",
                "ior": 1.33,
                "normalMethod": "smooth mesh normals; defective planar micro-normal map removed"
            }
        },
        "anchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, 0.0, 0.0],
            "leftSupport": [0.085, 0.0, -0.010],
            "rightSupport": [-0.085, 0.0, -0.010],
            "content": [0.0538, 0.011, -0.038],
            "bite": [0.0538, 0.011, -0.038],
            "toolGrip": [0.0, 0.0, -0.106],
            "toolBite": [0.0, 0.0, 0.106],
            "tipL": [-0.014, 0.0, 0.106],
            "tipR": [0.014, 0.0, 0.106]
        },
        "hierarchy": {
            "root": "changfen",
            "staticNodes": ["container", "sauce"],
            "edibleGroup": "edible",
            "ediblePieces": [p.name for p in pieces],
            "selectedPortion": "rice-piece-0",
            "utensilSubtree": "utensil",
            "chopsticks": ["chopstick-L", "chopstick-R"],
            "toolFood": "toolFood",
            "toolFoodDefaultHidden": True
        }
    }

    with open(OUT_3D / 'inspection.json', 'w', encoding='utf-8') as f:
        json.dump(inspection, f, indent=2, ensure_ascii=False)
    print(f"SAVED_INSPECTION: {OUT_3D / 'inspection.json'}")

    # Generate recipe.json (structure unchanged from v2)
    recipe = {
        "id": "changfen",
        "name": "广式鲜虾肠粉",
        "profile": "bowl",
        "utensilKind": "chopsticks",
        "containerKind": "shallowPlate",
        "selectedPortionName": "rice-piece-0",
        "staticNodes": [
            "container",
            "sauce"
        ],
        "toolFoodDefaultHidden": True,
        "specs": {
            "plateLengthM": 0.23,
            "plateWidthM": 0.16,
            "plateHeightM": 0.014,
            "rollCount": 3,
            "rollLengthM": 0.145,
            "rollSpacingM": 0.038,
            "toolBiteWidthM": 0.028,
            "toolFoodLengthM": 0.035,
            "chopstickLengthM": 0.212
        },
        "anchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, 0.0, 0.0],
            "leftSupport": [0.085, 0.0, -0.010],
            "rightSupport": [-0.085, 0.0, -0.010],
            "content": [0.0538, 0.011, -0.038],
            "bite": [0.0538, 0.011, -0.038],
            "toolGrip": [0.0, 0.0, -0.106],
            "toolBite": [0.0, 0.0, 0.106],
            "tipL": [-0.014, 0.0, 0.106],
            "tipR": [0.014, 0.0, 0.106]
        }
    }

    with open(OUT_3D / 'recipe.json', 'w', encoding='utf-8') as f:
        json.dump(recipe, f, indent=2, ensure_ascii=False)

    recipe_repo_path = REPO_ROOT / 'asset-authoring/snacks/refinement/recipe.json'
    with open(recipe_repo_path, 'w', encoding='utf-8') as f:
        json.dump(recipe, f, indent=2, ensure_ascii=False)

    print(f"SAVED_RECIPES: {OUT_3D / 'recipe.json'} and {recipe_repo_path}")


if __name__ == '__main__':
    build_changfen_model()
