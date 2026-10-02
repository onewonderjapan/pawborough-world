"""Build six distinct second-wave candidate meals for M10:
1. kaolengmian (wrapped)
2. niandoubao (cupped)
3. xianhuabing (cupped)
4. reganmian (bowl chopsticks)
5. jidanzi (wrapped)
6. portuguese-egg-tart (cupped)

Produces GLB models, rendered 512x512 thumbnails, and verified manifest.json.
GLB coordinate contract: Y-up, +Z front.
Models use approved cream/jade/refined soft pastry style.
Exports static geometry only; no floor/camera/light mesh in GLBs.
Model source materials <= 8; GLB < 0.75 MiB; static 512 PNG < 150 KiB.
"""
import os
import sys
import math
import json
import hashlib
import subprocess
from pathlib import Path

OUT_DIR = Path('/home/baibai/outbox/pawborough-national-snacks-20261002/m10-assets')
SRC_PATH = Path('asset-authoring/snacks/national/build_twelve.py')


def run_blender_build():
    """Runs inside Blender to generate GLB models and rendered thumbnails."""
    import bpy
    import bmesh
    from mathutils import Vector, Matrix

    script_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(script_dir))
    import helpers as H

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # -------------------------------------------------------------
    # Helper: Clear Scene
    # -------------------------------------------------------------
    def reset_scene():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.unit_settings.system = 'METRIC'

    # -------------------------------------------------------------
    # Shared Thumbnail Renderer
    # -------------------------------------------------------------
    def render_thumbnail(center_glb, target_size_m, out_png):
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = 20
        sc.cycles.device = 'CPU'
        sc.render.resolution_x = 512
        sc.render.resolution_y = 512
        sc.render.film_transparent = True
        sc.render.image_settings.file_format = 'PNG'
        sc.render.image_settings.color_mode = 'RGBA'
        sc.render.image_settings.color_depth = '8'
        sc.render.image_settings.compression = 100

        # Camera setup: 3/4 perspective view filling ~70% frame
        fov_deg = 36.0
        tan_half = math.tan(math.radians(fov_deg / 2.0))
        dist = target_size_m / (1.4 * tan_half)

        elev = math.radians(28.0)
        azim = math.radians(35.0)
        cam_x = dist * math.cos(elev) * math.sin(azim)
        cam_y = dist * math.sin(elev)
        cam_z = dist * math.cos(elev) * math.cos(azim)

        c_bl = H.glb_to_bl(center_glb)
        cam_pos_bl = c_bl + H.glb_to_bl((cam_x, cam_y, cam_z))

        cam_data = bpy.data.cameras.new('ThumbCam')
        cam_data.angle = math.radians(fov_deg)
        cam_data.clip_start = 0.005
        cam_data.clip_end = 20.0
        cam_obj = bpy.data.objects.new('ThumbCam', cam_data)
        sc.collection.objects.link(cam_obj)
        cam_obj.location = cam_pos_bl

        look_dir = (c_bl - cam_pos_bl).normalized()
        cam_obj.rotation_euler = look_dir.to_track_quat('-Z', 'Y').to_euler()
        sc.camera = cam_obj

        # Key lighting (warm directional)
        key_data = bpy.data.lights.new('KeySun', 'SUN')
        key_data.energy = 3.5
        key_data.color = (1.0, 0.98, 0.94)
        key_obj = bpy.data.objects.new('KeySun', key_data)
        sc.collection.objects.link(key_obj)
        key_dir = H.glb_to_bl((-0.5, -0.9, -0.6)).normalized()
        key_obj.rotation_euler = key_dir.to_track_quat('-Z', 'Y').to_euler()

        # Fill light (soft warm area)
        fill_data = bpy.data.lights.new('FillLight', 'AREA')
        fill_data.energy = 8.0
        fill_data.size = 0.4
        fill_data.color = (0.95, 0.92, 0.88)
        fill_obj = bpy.data.objects.new('FillLight', fill_data)
        sc.collection.objects.link(fill_obj)
        fill_obj.location = c_bl + H.glb_to_bl((-0.3, 0.2, 0.4))
        fill_dir = (c_bl - fill_obj.location).normalized()
        fill_obj.rotation_euler = fill_dir.to_track_quat('-Z', 'Y').to_euler()

        # Rim light
        rim_data = bpy.data.lights.new('RimLight', 'AREA')
        rim_data.energy = 12.0
        rim_data.size = 0.3
        rim_data.color = (1.0, 0.96, 0.90)
        rim_obj = bpy.data.objects.new('RimLight', rim_data)
        sc.collection.objects.link(rim_obj)
        rim_obj.location = c_bl + H.glb_to_bl((0.3, 0.4, -0.4))
        rim_dir = (c_bl - rim_obj.location).normalized()
        rim_obj.rotation_euler = rim_dir.to_track_quat('-Z', 'Y').to_euler()

        # Render
        sc.render.filepath = str(out_png)
        bpy.ops.render.render(write_still=True)

    # =============================================================
    # =============================================================
    # 1. KAOLENGMIAN (wrapped)
    # Width .18, maxheight .10, depth .10
    # Folded golden noodle roll with thin toasted grill marks (.004m wide),
    # open front sheet edge slightly rolled, exposed front opening (z+.025..+.05, y.035..+.065)
    # packed with yellow egg curds, redbrown sausage strips (.009-.012m radii) and bright green scallions.
    # Paper collar wrapping bottom and sides; anchors ±.075, 0, 0; bite (0, .085, .030)
    # =============================================================
    def build_kaolengmian():
        reset_scene()
        mats = [
            H.make_mat('mat_noodle', 'e6b454', roughness=0.55),       # 0: golden cooked noodle sheet
            H.make_mat('mat_grill', '8c451a', roughness=0.55),        # 1: toasted grill marks (thin .004m, warm golden-brown)
            H.make_mat('mat_egg', 'f5c442', roughness=0.42),          # 2: fluffy scrambled egg
            H.make_mat('mat_sausage', '9e3832', roughness=0.48),      # 3: savory Chinese sausage strips
            H.make_mat('mat_scallion', '328a1c', roughness=0.35),     # 4: chopped green scallions
            H.make_mat('mat_sauce', '912612', roughness=0.25, specular=0.7), # 5: chili bean sweet glaze
            H.make_mat('mat_parchment', 'ede3ce', roughness=0.75),    # 6: paper collar
        ]

        root = bpy.data.objects.new('kaolengmian', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # Folded noodle roll:
        # Cross section profile: starts at inner fold, loops down to bottom y=0.005,
        # around back z=-0.045, up to top y=0.092, down front-top passing bite (0, 0.085, 0.030),
        # with open front sheet edge slightly rolled forward at (0.068, 0.046)
        # Length along X from -0.088 to +0.088 (width ~ 0.176m)
        segs_x = 44 # 0.176 / 44 = 0.004m per face band for precise thin grill marks
        xs = [-0.088 + (0.176 * i / segs_x) for i in range(segs_x + 1)]

        # Cross section curve (y, z) in GLB
        profile_yz = [
            (0.022, 0.020),   # lower front inner lip
            (0.008, 0.002),   # bottom inner
            (0.005, -0.028),  # bottom rear
            (0.022, -0.045),  # lower rear
            (0.055, -0.046),  # mid rear
            (0.082, -0.035),  # upper rear
            (0.092, -0.010),  # top peak
            (0.091, 0.012),   # top front slope
            (0.085, 0.030),   # exact bite contact point!
            (0.076, 0.042),   # front slope
            (0.068, 0.047),   # front rolled lip upper
            (0.065, 0.045),   # front slightly rolled curl edge
        ]
        segs_p = len(profile_yz)

        grid = []
        for ix, x in enumerate(xs):
            row = []
            x_norm = abs(x) / 0.088
            end_taper = 1.0 - 0.06 * (x_norm ** 3)
            for iy, (py, pz) in enumerate(profile_yz):
                # Ensure exact coordinate at center bite point (ix = center, py=0.085, pz=0.030)
                if abs(x) < 0.006 and iy == 8:
                    cur_y = 0.085
                    cur_z = 0.030
                else:
                    cur_y = py * end_taper
                    cur_z = pz * end_taper
                v = bm_edible.verts.new(H.glb_to_bl((x, cur_y, cur_z)))
                row.append(v)
            grid.append(row)

        bm_edible.verts.ensure_lookup_table()
        # Grill stripe intervals along X: thin .004m wide uneven toasted stripes
        grill_stripes = (-0.068, -0.048, -0.028, -0.008, 0.012, 0.032, 0.052, 0.072)
        for ix in range(segs_x):
            r1 = grid[ix]
            r2 = grid[ix + 1]
            x_mid = (xs[ix] + xs[ix + 1]) / 2.0
            is_grill_band = any(abs(x_mid - g) < 0.0022 for g in grill_stripes)
            for ip in range(segs_p - 1):
                try:
                    f = bm_edible.faces.new([r1[ip], r1[ip + 1], r2[ip + 1], r2[ip]])
                    # Outer upper surface (ip between 4 and 9) gets thin .004m toasted grill marks
                    if is_grill_band and (4 <= ip <= 9) and (ip % 7 != ix % 3):
                        f.material_index = 1  # mat_grill
                    else:
                        f.material_index = 0  # mat_noodle
                except ValueError:
                    pass

        # End caps for the roll
        left_rim = [grid[0][ip] for ip in range(segs_p)]
        right_rim = [grid[-1][ip] for ip in range(segs_p)]
        try:
            f_l = bm_edible.faces.new(left_rim)
            f_l.material_index = 0
        except ValueError:
            pass
        try:
            f_r = bm_edible.faces.new(list(reversed(right_rim)))
            f_r.material_index = 0
        except ValueError:
            pass

        # Fillings packed inside the exposed front opening (z+.025..+.05, y.035..+.065):
        # 1. Redbrown Chinese sausage strips with .009-.012m radii in exposed front opening
        # Upper sausage strip (radius 0.011m)
        H.add_cylinder(bm_edible, (-0.080, 0.052, 0.032), (0.080, 0.052, 0.032), 0.011, segs=14, cap1=True, cap2=True, mat_idx=3)
        # Lower sausage strip (radius 0.0095m)
        H.add_cylinder(bm_edible, (-0.076, 0.040, 0.030), (0.076, 0.040, 0.030), 0.0095, segs=14, cap1=True, cap2=True, mat_idx=3)

        # 2. Scrambled eggs: dense clusters of fluffy yellow egg curds packing the opening
        # removing black hollow gap in z+.025..+.05, y.035..+.065
        egg_coords = []
        # Upper row tucking under the rolled lip
        for i_x in range(11):
            ex = -0.070 + 0.140 * (i_x / 10.0)
            egg_coords.append((ex, 0.061, 0.038, 0.008, 0.006, 0.008))
        # Middle row protruding forward
        for i_x in range(10):
            ex = -0.063 + 0.126 * (i_x / 9.0)
            egg_coords.append((ex, 0.048, 0.044, 0.0085, 0.007, 0.0085))
        # Lower row resting above bottom lip
        for i_x in range(11):
            ex = -0.070 + 0.140 * (i_x / 10.0)
            egg_coords.append((ex, 0.036, 0.036, 0.008, 0.0065, 0.008))
        for cx, cy, cz, rx, ry, rz in egg_coords:
            H.add_ellipsoid(bm_edible, (cx, cy, cz), rx, ry, rz, segs_u=10, segs_v=7, mat_idx=2)

        # 3. Bright green scallions sprinkled in exposed front opening
        scallion_pts = [
            (-0.065, 0.058, 0.042), (-0.050, 0.064, 0.036), (-0.036, 0.054, 0.046),
            (-0.022, 0.062, 0.039), (-0.008, 0.052, 0.046), (0.006, 0.064, 0.038),
            (0.020, 0.054, 0.046), (0.034, 0.062, 0.039), (0.048, 0.053, 0.045), (0.062, 0.060, 0.040),
            (-0.044, 0.042, 0.043), (-0.015, 0.040, 0.044), (0.014, 0.042, 0.043), (0.042, 0.039, 0.042)
        ]
        for sp in scallion_pts:
            H.add_cylinder(bm_edible, (sp[0], sp[1] - 0.001, sp[2]), (sp[0], sp[1] + 0.0018, sp[2]), 0.0030, segs=8, mat_idx=4)

        # 4. Chili glaze sauce drops glistening along edge
        sauce_pts = [
            (-0.055, 0.065, 0.044), (-0.025, 0.068, 0.043), (0.005, 0.069, 0.042),
            (0.035, 0.066, 0.043), (0.060, 0.063, 0.042)
        ]
        for sp in sauce_pts:
            H.add_ellipsoid(bm_edible, sp, 0.005, 0.0025, 0.004, segs_u=10, segs_v=6, mat_idx=5)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Parchment collar wrapper wrapping bottom and sides
        bm_wrap = bmesh.new()
        w_profile = [
            (0.038, 0.028),   # front upper collar
            (0.016, 0.022),   # front slope
            (-0.002, 0.000),  # bottom front touching base
            (-0.003, -0.048), # bottom rear
            (0.025, -0.048),  # lower rear
            (0.048, -0.046),  # rear upper collar
        ]
        w_segs_x = 24
        w_xs = [-0.090 + (0.180 * i / w_segs_x) for i in range(w_segs_x + 1)]
        w_grid = []
        for x in w_xs:
            row = []
            for wy, wz in w_profile:
                row.append(bm_wrap.verts.new(H.glb_to_bl((x, wy, wz))))
            w_grid.append(row)

        bm_wrap.verts.ensure_lookup_table()
        for ix in range(w_segs_x):
            r1 = w_grid[ix]
            r2 = w_grid[ix + 1]
            for ip in range(len(w_profile) - 1):
                try:
                    bm_wrap.faces.new([r1[ip], r1[ip + 1], r2[ip + 1], r2[ip]])
                except ValueError:
                    pass

        # Closed side caps wrapping the ends of the roll
        left_wrap_rim = [w_grid[0][ip] for ip in range(len(w_profile))]
        right_wrap_rim = [w_grid[-1][ip] for ip in range(len(w_profile))]
        try:
            bm_wrap.faces.new(left_wrap_rim)
        except ValueError:
            pass
        try:
            bm_wrap.faces.new(list(reversed(right_wrap_rim)))
        except ValueError:
            pass

        wrapper_obj = H.create_mesh_object('wrapper', bm_wrap, mats[6], parent=root)

        # Anchors (root-local):
        H.make_empty('leftSupport', (0.075, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.075, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.085, 0.030), parent=root)

        glb_path = OUT_DIR / 'kaolengmian.glb'
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path),
            export_format='GLB',
            export_yup=True,
            export_apply=True,
            export_cameras=False,
            export_lights=False
        )

        png_path = OUT_DIR / 'kaolengmian.png'
        render_thumbnail((0.0, 0.048, 0.0), 0.20, png_path)

        return 'kaolengmian', glb_path, png_path

    # =============================================================
    # 2. NIANDOUBAO (cupped)
    # Total width .16, height .065, two squat ivory/yellow sticky millet buns,
    # one subtly opened revealing red bean filling; edible ONLY.
    # Anchors ±.065, 0, 0; bite topfront (0, .060, .025).
    # =============================================================
    def build_niandoubao():
        reset_scene()
        mats = [
            H.make_mat('mat_millet_dough', 'edd99e', roughness=0.34, specular=0.65), # 0: sticky millet dough
            H.make_mat('mat_millet_sheen', 'f6e7be', roughness=0.28, specular=0.75), # 1: translucent steamed sheen
            H.make_mat('mat_redbean', '49171e', roughness=0.24, specular=0.70),      # 2: glossy sweet red bean filling
        ]

        root = bpy.data.objects.new('niandoubao', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # Build two squat sticky millet buns resting side by side:
        # Total width: 0.160m (left bun x in [-0.080, 0.000], right bun x in [0.000, 0.080])
        # Height: 0.065m. Depth ~ 0.084m.

        # Bun 1 (Left bun, intact smooth sticky bun with delicate pinched top crease)
        c1 = (-0.040, 0.030, 0.000)
        rx1, ry1, rz1 = 0.040, 0.032, 0.042
        segs_u = 32
        segs_v = 18
        verts1 = []
        for iv in range(segs_v + 1):
            phi = -math.pi / 2.0 + math.pi * iv / segs_v
            cos_p = math.cos(phi)
            sin_p = math.sin(phi)
            cur_y = c1[1] + ry1 * sin_p
            # Flat base at y = 0
            if cur_y < 0.0:
                cur_y = 0.0
            row = []
            for iu in range(segs_u):
                th = 2.0 * math.pi * iu / segs_u
                vx = c1[0] + rx1 * cos_p * math.cos(th)
                vz = c1[2] + rz1 * cos_p * math.sin(th)
                # Subtle pinch crease towards top
                if sin_p > 0.6:
                    crease = 0.0015 * math.cos(4.0 * th) * (sin_p ** 2)
                    cur_y += crease
                v = bm_edible.verts.new(H.glb_to_bl((vx, cur_y, vz)))
                row.append(v)
            verts1.append(row)

        for iv in range(segs_v):
            r1 = verts1[iv]
            r2 = verts1[iv + 1]
            for iu in range(segs_u):
                iu_n = (iu + 1) % segs_u
                try:
                    f = bm_edible.faces.new([r1[iu], r1[iu_n], r2[iu_n], r2[iu]])
                    f.material_index = 0
                except ValueError:
                    pass

        # Bun 2 (Right bun, subtly split open on front-top revealing sweet adzuki red bean filling)
        c2 = (0.040, 0.030, 0.000)
        rx2, ry2, rz2 = 0.040, 0.033, 0.042
        verts2 = []
        for iv in range(segs_v + 1):
            phi = -math.pi / 2.0 + math.pi * iv / segs_v
            cos_p = math.cos(phi)
            sin_p = math.sin(phi)
            cur_y = c2[1] + ry2 * sin_p
            if cur_y < 0.0:
                cur_y = 0.0
            row = []
            for iu in range(segs_u):
                th = 2.0 * math.pi * iu / segs_u
                vx = c2[0] + rx2 * cos_p * math.cos(th)
                vz = c2[2] + rz2 * cos_p * math.sin(th)
                # Subtly opened crack on front-top (th ~ pi/2, sin_p > 0.5)
                # We pull dough edges apart slightly around x in [0.025, 0.055], z > 0.010
                split_zone = (0.2 * math.pi < th < 0.8 * math.pi) and (sin_p > 0.55)
                if split_zone:
                    dist_cen = abs(th - 0.5 * math.pi)
                    pull = 0.003 * max(0.0, 1.0 - dist_cen / (0.3 * math.pi))
                    if th < 0.5 * math.pi:
                        vx += pull
                    else:
                        vx -= pull
                    cur_y -= 0.004 * (sin_p ** 2)
                v = bm_edible.verts.new(H.glb_to_bl((vx, cur_y, vz)))
                row.append((v, split_zone))
            verts2.append(row)

        for iv in range(segs_v):
            r1 = verts2[iv]
            r2 = verts2[iv + 1]
            for iu in range(segs_u):
                iu_n = (iu + 1) % segs_u
                v0, s0 = r1[iu]
                v1, s1 = r1[iu_n]
                v2, s2 = r2[iu_n]
                v3, s3 = r2[iu]
                try:
                    f = bm_edible.faces.new([v0, v1, v2, v3])
                    f.material_index = 0
                except ValueError:
                    pass

        # Red bean filling exposed inside the split opening of Bun 2
        bean_clusters = [
            (0.040, 0.057, 0.018), (0.035, 0.054, 0.022), (0.045, 0.055, 0.020),
            (0.032, 0.051, 0.026), (0.048, 0.052, 0.024), (0.040, 0.048, 0.028)
        ]
        for bc in bean_clusters:
            H.add_ellipsoid(bm_edible, bc, 0.0045, 0.0035, 0.0045, segs_u=10, segs_v=8, mat_idx=2)

        # Connection / seam between buns at center front, ensuring surface touches bite anchor (0, .060, .025)
        seam_center = (0.0, 0.030, 0.000)
        # Bridge mesh connecting the two buns at junction
        for y_step in range(6):
            sy = 0.010 + y_step * 0.010
            sz = 0.010 + y_step * 0.003
            H.add_ellipsoid(bm_edible, (0.0, sy, sz), 0.012, 0.006, 0.012, segs_u=10, segs_v=6, mat_idx=0)
        # Exact small lobe at bite point
        H.add_ellipsoid(bm_edible, (0.0, 0.057, 0.024), 0.006, 0.0035, 0.005, segs_u=10, segs_v=6, mat_idx=0)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors (root-local):
        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.060, 0.025), parent=root)

        glb_path = OUT_DIR / 'niandoubao.glb'
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path),
            export_format='GLB',
            export_yup=True,
            export_apply=True,
            export_cameras=False,
            export_lights=False
        )

        png_path = OUT_DIR / 'niandoubao.png'
        render_thumbnail((0.0, 0.032, 0.0), 0.18, png_path)

        return 'niandoubao', glb_path, png_path

    # =============================================================
    # 3. XIANHUABING (cupped)
    # Round flaky golden pastry .16 wide / .05 high with exposed rose-red flower filling
    # at small crack, decorative 3 soft petals / sparse sesame, toasted edge scallop.
    # Edible ONLY. Bottom at 0. Anchors ±.065, 0, 0; bite front top.
    # =============================================================
    def build_xianhuabing():
        reset_scene()
        mats = [
            H.make_mat('mat_pastry_crust', 'edd3a2', roughness=0.58),                 # 0: flaky pastry crust
            H.make_mat('mat_pastry_toast', '924716', roughness=0.52),                 # 1: toasted golden rim & highlights
            H.make_mat('mat_rose_filling', 'a81e3e', roughness=0.25, specular=0.65),  # 2: exposed rose flower filling
            H.make_mat('mat_rose_petal', 'ee8ea2', roughness=0.40, specular=0.35),    # 3: soft decorative petals
            H.make_mat('mat_sesame', 'f3ebd8', roughness=0.50),                       # 4: sparse sesame seeds
        ]

        root = bpy.data.objects.new('xianhuabing', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # Disc dimensions: width .16 (radius .080), height .050, bottom at 0
        segs_theta = 36
        segs_r = 14

        # Pastry cake profile with scalloped perimeter
        # Rings from center (r=0) to outer edge (r=.080) and down to flat base (y=0)
        # Top dome profile from y=0.050 at center down to y=0.035 at edge
        # Side wall with fluted scallop down to y=0 at base (radius .076)
        rings = []

        # Ring 0: Center vertex
        v_cen = bm_edible.verts.new(H.glb_to_bl((0.0, 0.050, 0.0)))

        # Top surface concentric rings
        top_rings = []
        for ir in range(1, 8):
            r_frac = ir / 7.0
            ring = []
            for it in range(segs_theta):
                th = 2.0 * math.pi * it / segs_theta
                # Scallop edge fluting modulation
                scallop = 0.0018 * math.cos(18.0 * th) * (r_frac ** 2)
                rad = (0.078 * r_frac) + scallop
                # Height drops smoothly from .050 to .036
                y = 0.050 - 0.014 * (r_frac ** 1.8)
                v = bm_edible.verts.new(H.glb_to_bl((rad * math.cos(th), y, rad * math.sin(th))))
                ring.append((v, r_frac, y))
            top_rings.append(ring)

        # Center fan
        r_first = top_rings[0]
        for it in range(segs_theta):
            it_n = (it + 1) % segs_theta
            try:
                f = bm_edible.faces.new([v_cen, r_first[it][0], r_first[it_n][0]])
                f.material_index = 0
            except ValueError:
                pass

        # Top rings quads
        for ir in range(len(top_rings) - 1):
            r1 = top_rings[ir]
            r2 = top_rings[ir + 1]
            for it in range(segs_theta):
                it_n = (it + 1) % segs_theta
                v0, rf0, y0 = r1[it]
                v1, rf1, y1 = r1[it_n]
                v2, rf2, y2 = r2[it_n]
                v3, rf3, y3 = r2[it]
                try:
                    f = bm_edible.faces.new([v0, v1, v2, v3])
                    # Toasted golden ring around upper rim (rf between 0.6 and 0.95)
                    if 0.65 <= (rf0 + rf2) / 2.0 <= 0.95 and it % 2 == 0:
                        f.material_index = 1  # mat_pastry_toast
                    else:
                        f.material_index = 0
                except ValueError:
                    pass

        # Outer rim / scallop side walls down to base
        rim_levels = [
            (0.080, 0.032, 1), # equator rim (max width .16)
            (0.0785, 0.018, 0),
            (0.0765, 0.005, 0),
            (0.0750, 0.000, 0), # flat bottom edge
        ]
        wall_rings = [top_rings[-1]]
        for rad_base, y_lvl, mat_idx in rim_levels:
            ring = []
            for it in range(segs_theta):
                th = 2.0 * math.pi * it / segs_theta
                scallop = 0.0020 * math.cos(18.0 * th)
                rad = rad_base + scallop
                v = bm_edible.verts.new(H.glb_to_bl((rad * math.cos(th), y_lvl, rad * math.sin(th))))
                ring.append((v, 1.0, y_lvl))
            wall_rings.append(ring)

        for ir in range(len(wall_rings) - 1):
            r1 = wall_rings[ir]
            r2 = wall_rings[ir + 1]
            for it in range(segs_theta):
                it_n = (it + 1) % segs_theta
                try:
                    f = bm_edible.faces.new([r1[it][0], r1[it_n][0], r2[it_n][0], r2[it][0]])
                    # Upper rim edge toast
                    f.material_index = 1 if ir == 0 and (it % 3 != 0) else 0
                except ValueError:
                    pass

        # Flat bottom base cap at y = 0
        v_bot = bm_edible.verts.new(H.glb_to_bl((0.0, 0.0, 0.0)))
        bot_ring = wall_rings[-1]
        for it in range(segs_theta):
            it_n = (it + 1) % segs_theta
            try:
                f = bm_edible.faces.new([v_bot, bot_ring[it_n][0], bot_ring[it][0]])
                f.material_index = 0
            except ValueError:
                pass

        # Small crack exposing rose-red flower filling at front-top
        # Located near (0.0, 0.048, 0.030)
        rose_clumps = [
            (0.000, 0.0485, 0.030), (-0.007, 0.0480, 0.026), (0.007, 0.0480, 0.026),
            (0.000, 0.0475, 0.022), (-0.005, 0.0490, 0.033), (0.005, 0.0490, 0.033)
        ]
        for rc in rose_clumps:
            H.add_ellipsoid(bm_edible, rc, 0.0048, 0.0028, 0.0048, segs_u=10, segs_v=8, mat_idx=2)

        # 3 decorative soft pink petals near center
        petals = [
            # center, angles, size
            ((-0.012, 0.0505, -0.004), 25.0, (0.008, 0.0012, 0.014)),
            ((0.014, 0.0505, -0.006), -35.0, (0.008, 0.0012, 0.013)),
            ((0.002, 0.0510, 0.010), 10.0, (0.009, 0.0012, 0.015)),
        ]
        for p_cen, p_ang, p_sz in petals:
            H.add_box(bm_edible, p_cen, p_sz[0], p_sz[1], p_sz[2], rot_deg=(0, p_ang, 0), mat_idx=3)

        # Sparse sesame seeds scattered on top crust
        sesame_pts = [
            (-0.025, 0.047, 0.020), (0.028, 0.046, 0.018), (-0.032, 0.044, -0.018),
            (0.030, 0.045, -0.022), (-0.010, 0.048, -0.032), (0.015, 0.047, -0.030),
            (-0.042, 0.041, 0.008), (0.044, 0.041, 0.005), (0.000, 0.046, -0.045)
        ]
        for sp in sesame_pts:
            H.add_ellipsoid(bm_edible, sp, 0.0022, 0.0012, 0.0016, segs_u=8, segs_v=6, mat_idx=4)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors (root-local):
        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.048, 0.030), parent=root)

        glb_path = OUT_DIR / 'xianhuabing.glb'
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path),
            export_format='GLB',
            export_yup=True,
            export_apply=True,
            export_cameras=False,
            export_lights=False
        )

        png_path = OUT_DIR / 'xianhuabing.png'
        render_thumbnail((0.0, 0.025, 0.0), 0.18, png_path)

        return 'xianhuabing', glb_path, png_path

    # =============================================================
    # 4. REGANMIAN (bowl chopsticks)
    # Open jade ceramic bowl radius .075, height .045, bottom -.025.
    # 24 distinct visible thick noodles (.0018m radius) in tangled looping paths above bowl y.015-.045.
    # Curved strands 8-16 segments around mound, rings/helix and shorter S-shapes in golden #d7a549
    # with tan darker variation #b57e2d. Center noodle mass lower than strands (y <= 0.012).
    # Topped with dark sesame sauce ribbons, scallions and crushed peanuts.
    # Chopsticks pair .11m with toolFood noodle morsel. Anchors .11m correctly retained.
    # =============================================================
    def build_reganmian():
        reset_scene()
        mats = {
            'jade': H.make_mat('mat_jade', 'aecbbe', roughness=0.12, specular=0.8),               # bowl
            'noodles': H.make_mat('mat_noodles', 'd7a549', roughness=0.48, specular=0.45),       # golden sesame noodles #d7a549
            'noodles_dark': H.make_mat('mat_noodles_dark', 'b57e2d', roughness=0.45, specular=0.45), # tan darker variation
            'sesame_sauce': H.make_mat('mat_sesame_sauce', '58280a', roughness=0.28, specular=0.65), # sauce
            'scallions': H.make_mat('mat_scallions', '307e1c', roughness=0.35),                  # scallions
            'peanuts': H.make_mat('mat_peanuts', 'c48d48', roughness=0.55),                      # peanuts
            'chopsticks': H.make_mat('mat_chopsticks', '553118', roughness=0.48, specular=0.45),  # chopsticks
        }

        root = bpy.data.objects.new('reganmian', None)
        bpy.context.collection.objects.link(root)

        # 1. Container: Jade ceramic bowl (identical to specification)
        # Radius 0.075, height 0.045, bottom at y = -0.025, lip at y = +0.020.
        bm_bowl = bmesh.new()
        segs_b = 36
        wall_thick = 0.0035
        outer_profile = [
            (-0.025, 0.038),   # Foot ring bottom
            (-0.022, 0.040),   # Foot ring junction
            (-0.015, 0.052),   # Lower body flare
            (-0.005, 0.063),   # Mid body
            (0.010, 0.071),    # Upper body
            (0.020, 0.075),    # Outer lip
        ]
        inner_profile = [
            (0.020, 0.075 - wall_thick),  # Inner lip
            (0.010, 0.0675),              # Inner upper
            (-0.005, 0.059),              # Inner mid
            (-0.015, 0.048),              # Inner lower
            (-0.0215, 0.034),             # Inner bottom edge
            (-0.0215, 0.0),               # Inner bottom center
        ]

        all_rings = []
        for py, pr in outer_profile:
            ring = []
            for i in range(segs_b):
                th = 2.0 * math.pi * i / segs_b
                ring.append(bm_bowl.verts.new(H.glb_to_bl((pr * math.cos(th), py, pr * math.sin(th)))))
            all_rings.append(ring)

        for py, pr in inner_profile[:-1]:
            ring = []
            for i in range(segs_b):
                th = 2.0 * math.pi * i / segs_b
                ring.append(bm_bowl.verts.new(H.glb_to_bl((pr * math.cos(th), py, pr * math.sin(th)))))
            all_rings.append(ring)

        bm_bowl.verts.ensure_lookup_table()
        for ir in range(len(all_rings) - 1):
            r1 = all_rings[ir]
            r2 = all_rings[ir + 1]
            for i in range(segs_b):
                inxt = (i + 1) % segs_b
                try:
                    bm_bowl.faces.new([r1[i], r1[inxt], r2[inxt], r2[i]])
                except ValueError:
                    pass

        cen_in = bm_bowl.verts.new(H.glb_to_bl((0, -0.0215, 0)))
        last_inner = all_rings[-1]
        for i in range(segs_b):
            inxt = (i + 1) % segs_b
            try:
                bm_bowl.faces.new([cen_in, last_inner[inxt], last_inner[i]])
            except ValueError:
                pass

        cen_out = bm_bowl.verts.new(H.glb_to_bl((0, -0.025, 0)))
        first_outer = all_rings[0]
        for i in range(segs_b):
            inxt = (i + 1) % segs_b
            try:
                bm_bowl.faces.new([cen_out, first_outer[i], first_outer[inxt]])
            except ValueError:
                pass

        container_obj = H.create_mesh_object('container', bm_bowl, mats['jade'], parent=root)

        # 2. Edible: 24 tangled looping thick noodle strands + toppings, no smooth mound
        bm_edible = bmesh.new()

        # Low central noodle mass down inside the bowl (lower than strands, y <= 0.012, bowl lip is at y=0.020)
        H.add_ellipsoid(bm_edible, (0.0, 0.004, 0.0), 0.055, 0.008, 0.055, segs_u=18, segs_v=8, y_max=0.012, mat_idx=0)

        # Helper to generate smooth looping cylindrical noodle curves
        def add_noodle_strand(bm, points, radius=0.0018, segs_c=8, mat_idx=0):
            for i in range(len(points) - 1):
                p1 = points[i]
                p2 = points[i + 1]
                H.add_cylinder(bm, p1, p2, radius, segs=segs_c, cap1=(i == 0), cap2=(i == len(points) - 2), mat_idx=mat_idx)

        def make_helix_strand(r_base, y_start, y_end, th_start, th_end, n_segs, r_wobble=0.004, y_wobble=0.002):
            pts = []
            for i in range(n_segs + 1):
                t = i / float(n_segs)
                th = th_start + (th_end - th_start) * t
                r = r_base + r_wobble * math.sin(4.0 * th)
                y = y_start + (y_end - y_start) * t + y_wobble * math.cos(3.0 * th)
                x = r * math.cos(th)
                z = r * math.sin(th)
                pts.append((x, y, z))
            return pts

        def make_s_strand(p_start, p_end, peak_y, n_segs, curvature=0.015):
            pts = []
            dx = p_end[0] - p_start[0]
            dz = p_end[2] - p_start[2]
            dist = math.hypot(dx, dz)
            perp_x = -dz / dist if dist > 1e-6 else 0
            perp_z = dx / dist if dist > 1e-6 else 0
            for i in range(n_segs + 1):
                t = i / float(n_segs)
                x = p_start[0] + dx * t + curvature * math.sin(math.pi * 2.0 * t) * perp_x
                z = p_start[2] + dz * t + curvature * math.sin(math.pi * 2.0 * t) * perp_z
                y = p_start[1] + (p_end[1] - p_start[1]) * t + (peak_y - max(p_start[1], p_end[1])) * math.sin(math.pi * t)
                pts.append((x, y, z))
            return pts

        # 24 distinct visible thick noodles (.0018m radius) in tangled looping paths above bowl y.015-.045
        # Overlapping curved strands 8-16 segments around mound, rings/helix and shorter S-shapes
        strands = [
            # 1. Outer perimeter helix ring 1 (14 segments)
            make_helix_strand(0.048, 0.018, 0.028, 0.0, 2.2 * math.pi, 14),
            # 2. Outer perimeter helix ring 2 (14 segments)
            make_helix_strand(0.045, 0.018, 0.026, math.pi, 3.2 * math.pi, 14),
            # 3. Mid helix ring 3 (14 segments)
            make_helix_strand(0.038, 0.022, 0.036, 0.5 * math.pi, 2.7 * math.pi, 14),
            # 4. Counter-rotating mid helix 4 (12 segments)
            make_helix_strand(0.035, 0.024, 0.038, 2.0 * math.pi, 0.0, 12),
            # 5. Inner ascending helix 5 (14 segments)
            make_helix_strand(0.026, 0.028, 0.043, 0.2 * math.pi, 2.4 * math.pi, 14),
            # 6. Low perimeter ring 6 (12 segments)
            make_helix_strand(0.052, 0.017, 0.022, 0.8 * math.pi, 2.5 * math.pi, 12),
            # 7. Figure-8 top swirl 7 (14 segments)
            [(0.026 * math.sin(2.0 * math.pi * i / 14.0), 0.036 + 0.007 * math.cos(2.0 * math.pi * i / 14.0), 0.022 * math.sin(4.0 * math.pi * i / 14.0)) for i in range(15)],
            # 8. Reverse figure-8 top swirl 8 (14 segments)
            [(0.022 * math.sin(4.0 * math.pi * i / 14.0 + 0.8), 0.035 + 0.006 * math.sin(2.0 * math.pi * i / 14.0), 0.026 * math.sin(2.0 * math.pi * i / 14.0)) for i in range(15)],
            # 9. High central ring 9 (12 segments)
            [(0.018 * math.cos(2.0 * math.pi * i / 12.0), 0.041 + 0.004 * math.sin(4.0 * math.pi * i / 12.0), 0.018 * math.sin(2.0 * math.pi * i / 12.0)) for i in range(13)],
            # 10. S-shape diagonal 10 (10 segments)
            make_s_strand((-0.045, 0.019, -0.020), (0.042, 0.021, 0.025), peak_y=0.042, n_segs=10, curvature=0.014),
            # 11. S-shape diagonal 11 (10 segments)
            make_s_strand((0.040, 0.019, -0.025), (-0.042, 0.021, 0.022), peak_y=0.040, n_segs=10, curvature=-0.014),
            # 12. S-shape cross-strand 12 (10 segments)
            make_s_strand((-0.038, 0.022, 0.030), (0.036, 0.022, -0.028), peak_y=0.044, n_segs=10, curvature=0.012),
            # 13. S-shape cross-strand 13 (10 segments)
            make_s_strand((-0.025, 0.024, -0.038), (0.025, 0.024, 0.038), peak_y=0.043, n_segs=10, curvature=-0.012),
            # 14. Transverse arc 14 (10 segments)
            make_s_strand((-0.048, 0.018, 0.005), (0.048, 0.018, -0.005), peak_y=0.038, n_segs=10, curvature=0.016),
            # 15. Longitudinal arc 15 (10 segments)
            make_s_strand((0.005, 0.018, -0.048), (-0.005, 0.018, 0.048), peak_y=0.039, n_segs=10, curvature=0.016),
            # 16. Front rim coil 16 (8 segments)
            [(-0.045, 0.018, 0.030), (-0.034, 0.023, 0.040), (-0.018, 0.026, 0.045), (0.000, 0.027, 0.046), (0.018, 0.026, 0.044), (0.034, 0.023, 0.038), (0.045, 0.018, 0.030)],
            # 17. Rear rim coil 17 (8 segments)
            [(-0.042, 0.018, -0.030), (-0.030, 0.023, -0.040), (-0.014, 0.025, -0.045), (0.005, 0.026, -0.046), (0.022, 0.025, -0.043), (0.035, 0.022, -0.038), (0.044, 0.018, -0.028)],
            # 18. Left flank arch 18 (8 segments)
            [(-0.030, 0.018, -0.035), (-0.044, 0.024, -0.020), (-0.052, 0.027, 0.000), (-0.048, 0.026, 0.020), (-0.038, 0.022, 0.032), (-0.025, 0.018, 0.038)],
            # 19. Right flank arch 19 (8 segments)
            [(0.030, 0.018, -0.035), (0.044, 0.024, -0.020), (0.052, 0.027, 0.000), (0.048, 0.026, 0.020), (0.038, 0.022, 0.032), (0.025, 0.018, 0.038)],
            # 20. Tangled diagonal bridge 20 (8 segments)
            [(-0.032, 0.022, 0.025), (-0.020, 0.030, 0.018), (-0.005, 0.038, 0.010), (0.010, 0.037, -0.005), (0.025, 0.030, -0.020)],
            # 21. Reverse diagonal bridge 21 (8 segments)
            [(0.032, 0.022, 0.025), (0.020, 0.030, 0.018), (0.005, 0.038, 0.010), (-0.010, 0.037, -0.005), (-0.025, 0.030, -0.020)],
            # 22. Curl passing content anchor (0, .018, 0) 22 (8 segments)
            [(-0.016, 0.018, 0.012), (-0.008, 0.022, 0.016), (0.000, 0.020, 0.012), (0.008, 0.018, 0.002), (-0.004, 0.019, 0.004)],
            # 23. Front center swirl 23 (8 segments)
            [(-0.020, 0.024, 0.025), (-0.010, 0.030, 0.030), (0.005, 0.034, 0.026), (0.016, 0.030, 0.020), (0.022, 0.025, 0.015)],
            # 24. High top peak knot 24 (8 segments)
            [(-0.012, 0.038, -0.012), (-0.004, 0.044, -0.004), (0.008, 0.045, 0.005), (0.016, 0.041, 0.012), (0.022, 0.035, 0.005)],
        ]

        # Build strands alternating golden #d7a549 (mat_idx=0) and tan darker #b57e2d (mat_idx=1)
        for i_s, st in enumerate(strands):
            mat_idx = 0 if (i_s % 2 == 0) else 1
            add_noodle_strand(bm_edible, st, radius=0.0018, segs_c=8, mat_idx=mat_idx)

        # Amber dark sesame paste sauce ribbons drizzled over noodles (mat_idx=2)
        sauce_ribbons = [
            [(-0.025, 0.032, -0.015), (-0.008, 0.042, -0.005), (0.012, 0.044, 0.005), (0.028, 0.035, 0.015)],
            [(-0.018, 0.036, 0.016), (0.002, 0.042, 0.018), (0.018, 0.038, 0.022), (0.028, 0.030, 0.025)],
            [(-0.032, 0.028, 0.005), (-0.012, 0.038, 0.002), (0.008, 0.041, -0.010), (0.024, 0.032, -0.018)],
            [(-0.015, 0.040, -0.020), (0.005, 0.043, -0.015), (0.020, 0.036, -0.008)],
        ]
        for sr in sauce_ribbons:
            add_noodle_strand(bm_edible, sr, radius=0.0022, segs_c=8, mat_idx=2)

        # Fresh green scallion bits (mat_idx=3)
        scallion_pts = [
            (-0.022, 0.036, -0.008), (0.018, 0.038, -0.004), (-0.008, 0.044, 0.012),
            (0.012, 0.043, 0.016), (-0.028, 0.030, 0.018), (0.026, 0.032, 0.012),
            (-0.014, 0.032, -0.022), (0.012, 0.034, -0.020), (0.002, 0.045, -0.002),
            (-0.018, 0.040, 0.005), (0.022, 0.039, 0.006), (-0.005, 0.034, 0.030),
            (0.015, 0.032, 0.028), (0.000, 0.038, -0.028)
        ]
        for sp in scallion_pts:
            H.add_cylinder(bm_edible, (sp[0], sp[1], sp[2]), (sp[0], sp[1] + 0.002, sp[2]), 0.0025, segs=8, mat_idx=3)

        # Crushed toasted peanuts (mat_idx=4)
        peanut_pts = [
            (-0.016, 0.041, 0.005), (0.020, 0.040, 0.006), (-0.005, 0.042, -0.014),
            (0.010, 0.041, -0.012), (-0.030, 0.032, -0.008), (0.028, 0.033, -0.008),
            (-0.012, 0.037, 0.022), (0.015, 0.036, 0.020), (-0.022, 0.033, 0.015),
            (0.005, 0.044, 0.010)
        ]
        for pp in peanut_pts:
            H.add_box(bm_edible, pp, 0.0035, 0.0025, 0.0035, rot_deg=(15, 30, 20), mat_idx=4)

        edible_mats = [mats['noodles'], mats['noodles_dark'], mats['sesame_sauce'], mats['scallions'], mats['peanuts']]
        edible_obj = H.create_mesh_object('edible', bm_edible, edible_mats, parent=root)

        # 3. Utensil: Distinguishable pair of chopsticks (.11m grip-to-tip, two rods offset x ±.003)
        # Local axis +Z: toolGrip at (0, 0, 0), toolBite at (0, 0, 0.110)
        # Default resting pose beside bowl at GLB (0.088, -0.0225, -0.055)
        bm_chopsticks = bmesh.new()

        # Two parallel blunt rods offset in x by ±0.003
        for x_off in (-0.003, 0.003):
            p_grip = (x_off, 0.0, 0.0)
            p_tip = (x_off, 0.0, 0.110)
            # Tapered rod: radius 0.0024 at grip to 0.0016 at tip
            # We build using cylinders segments
            p_mid = (x_off, 0.0, 0.060)
            H.add_cylinder(bm_chopsticks, p_grip, p_mid, 0.0024, segs=12, cap1=True, cap2=False, mat_idx=0)
            H.add_cylinder(bm_chopsticks, p_mid, p_tip, 0.0018, segs=12, cap1=False, cap2=True, mat_idx=0)

        utensil_glb_pos = (0.088, -0.0225, -0.055)
        utensil_obj = H.create_mesh_object('utensil', bm_chopsticks, mats['chopsticks'], parent=root, location_glb=utensil_glb_pos)

        # Tool nodes parented to utensil (in utensil local coordinates)
        toolGrip = bpy.data.objects.new('toolGrip', None)
        toolGrip.location = Vector((0.0, 0.0, 0.0))
        toolGrip.parent = utensil_obj
        bpy.context.collection.objects.link(toolGrip)

        toolBite = bpy.data.objects.new('toolBite', None)
        # Local +Z in GLB is Blender -Y
        toolBite.location = Vector((0.0, -0.110, 0.0))
        toolBite.parent = utensil_obj
        bpy.context.collection.objects.link(toolBite)

        # Small lifted noodle morsel child tagged 'toolFood' held between chopstick tips at toolBite
        bm_toolfood = bmesh.new()
        # Small looped noodle morsel
        H.add_ellipsoid(bm_toolfood, (0.0, 0.0, 0.0), 0.0045, 0.0028, 0.0055, segs_u=10, segs_v=8, mat_idx=0)
        toolFood = H.create_mesh_object('toolFood', bm_toolfood, mats['noodles'], parent=utensil_obj)
        toolFood.location = Vector((0.0, -0.106, 0.001))

        # Root-local anchors:
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('content', (0.0, 0.018, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.018, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)

        glb_path = OUT_DIR / 'reganmian.glb'
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path),
            export_format='GLB',
            export_yup=True,
            export_apply=True,
            export_cameras=False,
            export_lights=False
        )

        png_path = OUT_DIR / 'reganmian.png'
        render_thumbnail((0.020, -0.005, 0.0), 0.18, png_path)

        return 'reganmian', glb_path, png_path

    # =============================================================
    # 5. JIDANZI (wrapped)
    # Hong Kong bubble waffle: continuous thin waffle membrane fan sheet
    # (x±.08, y.015..12, z.012+.008*sin(y*15), thickness .004)
    # with 16 flattened egg-shaped bubbles radii (.012, .014, .008) touching sheet and neighboring puffs,
    # extending front +Z. Lower sheet in paper cone, upper fan warm golden #e5a035 visible.
    # No connecting rods, no open holes. Bite (0, .085, .030) on puff surface; supports ±.075 at paper edges.
    # =============================================================
    def build_jidanzi():
        reset_scene()
        mats = [
            H.make_mat('mat_waffle', 'e5a035', roughness=0.62, specular=0.25),       # 0: warm golden egg waffle
            H.make_mat('mat_waffle_toast', '9e5218', roughness=0.55, specular=0.25), # 1: crispy toasted waffle ridges
            H.make_mat('mat_parchment', 'ede3ce', roughness=0.75),    # 2: parchment cone wrapper
        ]

        root = bpy.data.objects.new('jidanzi', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # 1. Continuous thin waffle membrane:
        # Curved rectangular/fan sheet x±.08, y.015..12, z.012+.008*sin(y*15), thickness .004
        segs_y = 16
        segs_x = 20
        ys = [0.015 + (0.120 - 0.015) * iy / float(segs_y) for iy in range(segs_y + 1)]
        grid_front = []
        grid_back = []
        for iy, y in enumerate(ys):
            t_y = (y - 0.015) / (0.120 - 0.015)
            # Fan width from ±0.065 at bottom inside cone to ±0.080 at top
            half_w = 0.065 + 0.015 * t_y
            xs = [-half_w + (2.0 * half_w * ix / float(segs_x)) for ix in range(segs_x + 1)]
            row_f = []
            row_b = []
            for ix, x in enumerate(xs):
                # Mid-surface follows z.012+.008*sin(y*15) with lateral curvature hugging cone
                z_mid = 0.012 + 0.008 * math.sin(y * 15.0) - 0.035 * ((x / 0.08) ** 2)
                z_f = z_mid + 0.002
                z_b = z_mid - 0.002
                vf = bm_edible.verts.new(H.glb_to_bl((x, y, z_f)))
                vb = bm_edible.verts.new(H.glb_to_bl((x, y, z_b)))
                row_f.append(vf)
                row_b.append(vb)
            grid_front.append(row_f)
            grid_back.append(row_b)

        bm_edible.verts.ensure_lookup_table()
        # Front and back quads
        for iy in range(segs_y):
            for ix in range(segs_x):
                # Front face
                try:
                    f_f = bm_edible.faces.new([
                        grid_front[iy][ix], grid_front[iy][ix + 1],
                        grid_front[iy + 1][ix + 1], grid_front[iy + 1][ix]
                    ])
                    f_f.material_index = 0
                except ValueError:
                    pass
                # Back face (reversed winding)
                try:
                    f_b = bm_edible.faces.new([
                        grid_back[iy][ix], grid_back[iy + 1][ix],
                        grid_back[iy + 1][ix + 1], grid_back[iy][ix + 1]
                    ])
                    f_b.material_index = 0
                except ValueError:
                    pass

        # Border quads to close membrane thickness
        # Top edge
        for ix in range(segs_x):
            try:
                f_top = bm_edible.faces.new([
                    grid_front[segs_y][ix], grid_front[segs_y][ix + 1],
                    grid_back[segs_y][ix + 1], grid_back[segs_y][ix]
                ])
                f_top.material_index = 1  # crispy toasted edge
            except ValueError:
                pass
        # Bottom edge
        for ix in range(segs_x):
            try:
                f_bot = bm_edible.faces.new([
                    grid_front[0][ix + 1], grid_front[0][ix],
                    grid_back[0][ix], grid_back[0][ix + 1]
                ])
                f_bot.material_index = 0
            except ValueError:
                pass
        # Left edge
        for iy in range(segs_y):
            try:
                f_left = bm_edible.faces.new([
                    grid_front[iy][0], grid_front[iy + 1][0],
                    grid_back[iy + 1][0], grid_back[iy][0]
                ])
                f_left.material_index = 0
            except ValueError:
                pass
        # Right edge
        for iy in range(segs_y):
            try:
                f_right = bm_edible.faces.new([
                    grid_front[iy + 1][segs_x], grid_front[iy][segs_x],
                    grid_back[iy][segs_x], grid_back[iy + 1][segs_x]
                ])
                f_right.material_index = 0
            except ValueError:
                pass

        # 2. 16 Flattened egg-shaped bubbles touching sheet and neighboring puffs:
        # Radii (.012, .014, .008), extending front +Z
        bubble_layout = [
            # Row 1 (y=0.038): 3 bubbles
            [(-0.032, 0.038), (0.000, 0.038), (0.032, 0.038)],
            # Row 2 (y=0.062): 4 bubbles
            [(-0.048, 0.062), (-0.016, 0.062), (0.016, 0.062), (0.048, 0.062)],
            # Row 3 (y=0.085): 5 bubbles -> center at (0.0, 0.085)
            [(-0.064, 0.085), (-0.032, 0.085), (0.000, 0.085), (0.032, 0.085), (0.064, 0.085)],
            # Row 4 (y=0.108): 4 bubbles
            [(-0.048, 0.108), (-0.016, 0.108), (0.016, 0.108), (0.048, 0.108)],
        ]
        rx_b, ry_b, rz_b = 0.012, 0.014, 0.008
        for row in bubble_layout:
            for bx, by in row:
                z_mid = 0.012 + 0.008 * math.sin(by * 15.0) - 0.035 * ((bx / 0.08) ** 2)
                # At (0.0, 0.085), 15 * 0.085 = 1.275 rad, sin(1.275) = 0.95637
                # z_mid = 0.012 + 0.008 * 0.95637 = 0.01965m
                # bz = z_mid + 0.00235 = 0.0220m
                # Front surface bz + rz_b = 0.0220 + 0.008 = 0.0300m!
                bz = z_mid + 0.00235
                mat_i = 1 if (by > 0.100 or abs(bx) > 0.055) else 0
                H.add_ellipsoid(bm_edible, (bx, by, bz), rx_b, ry_b, rz_b, segs_u=14, segs_v=10, mat_idx=mat_i)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats[:2], parent=root)

        # 3. Parchment paper cone wrapper at bottom:
        # Base touches y=0.000, radius reaching .075 for leftSupport/rightSupport anchors (±0.075, 0.0, 0.0)
        bm_cone = bmesh.new()
        segs_c = 28
        cone_levels = [
            (0.000, 0.075, 0.000),   # base touching y=0 with radius reaching .075 at z=0 for anchors
            (0.018, 0.078, -0.004),
            (0.038, 0.082, -0.006),
            (0.055, 0.085, -0.008),  # top folded collar rim
        ]
        cone_rings = []
        for y_lvl, rx_lvl, z_cen in cone_levels:
            ring = []
            rz_lvl = rx_lvl * 0.36
            for it in range(segs_c):
                th = 2.0 * math.pi * it / segs_c
                vx = rx_lvl * math.cos(th)
                vz = z_cen + rz_lvl * math.sin(th)
                ring.append(bm_cone.verts.new(H.glb_to_bl((vx, y_lvl, vz))))
            cone_rings.append(ring)

        bm_cone.verts.ensure_lookup_table()
        for ir in range(len(cone_rings) - 1):
            r1 = cone_rings[ir]
            r2 = cone_rings[ir + 1]
            for it in range(segs_c):
                it_n = (it + 1) % segs_c
                try:
                    bm_cone.faces.new([r1[it], r1[it_n], r2[it_n], r2[it]])
                except ValueError:
                    pass

        # Closed bottom cap at y = 0
        v_cbot = bm_cone.verts.new(H.glb_to_bl((0.0, 0.0, 0.0)))
        for it in range(segs_c):
            it_n = (it + 1) % segs_c
            try:
                bm_cone.faces.new([v_cbot, cone_rings[0][it_n], cone_rings[0][it]])
            except ValueError:
                pass

        wrapper_obj = H.create_mesh_object('wrapper', bm_cone, mats[2], parent=root)

        # Anchors (root-local):
        H.make_empty('leftSupport', (0.075, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.075, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.085, 0.030), parent=root)

        glb_path = OUT_DIR / 'jidanzi.glb'
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path),
            export_format='GLB',
            export_yup=True,
            export_apply=True,
            export_cameras=False,
            export_lights=False
        )

        png_path = OUT_DIR / 'jidanzi.png'
        render_thumbnail((0.0, 0.060, 0.0), 0.20, png_path)

        return 'jidanzi', glb_path, png_path

    # =============================================================
    # 6. PORTUGUESE-EGG-TART (cupped)
    # Palm-size golden fluted pastry shell .15 diam / .035 height;
    # warm pale yellow custard filling, irregular small caramelized brown spots;
    # edible ONLY, no metal cup in hand. Bottom at 0.
    # Anchors ±.065, 0, 0; bite (0, .034, .045).
    # =============================================================
    def build_portuguese_egg_tart():
        reset_scene()
        mats = [
            H.make_mat('mat_tart_crust', 'de9f4e', roughness=0.58),                # 0: flaky puff pastry
            H.make_mat('mat_tart_toast', '823d10', roughness=0.52),                # 1: toasted brown rim fluting
            H.make_mat('mat_custard', 'fed964', roughness=0.22, specular=0.65),    # 2: glossy egg custard filling
            H.make_mat('mat_caramel_spots', '301205', roughness=0.35, specular=0.45), # 3: brulee scorched spots
        ]

        root = bpy.data.objects.new('portuguese-egg-tart', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # 1. Fluted puff pastry shell (.15 diameter, .035 height, bottom at 0)
        segs_theta = 48
        # Fluted profiles: base r=.044 at y=0, flaring up to r=.075 at y=.035
        # Outer shell levels
        shell_levels = [
            (0.000, 0.044, 0),   # flat base
            (0.008, 0.050, 0),
            (0.018, 0.061, 0),
            (0.028, 0.070, 1),
            (0.035, 0.075, 1),   # fluted outer rim
            # Rim turn-in to inner wall
            (0.033, 0.068, 0),   # inner lip
            (0.022, 0.058, 0),   # inner wall
            (0.010, 0.048, 0),   # inner bottom edge
        ]

        shell_rings = []
        for py, pr, is_toast in shell_levels:
            ring = []
            for it in range(segs_theta):
                th = 2.0 * math.pi * it / segs_theta
                # 24 radial flutes around outer upper levels
                flute = 0.0022 * math.cos(24.0 * th) if py > 0.015 else 0.0
                rad = pr + flute
                ring.append((bm_edible.verts.new(H.glb_to_bl((rad * math.cos(th), py, rad * math.sin(th)))), is_toast))
            shell_rings.append(ring)

        bm_edible.verts.ensure_lookup_table()
        for ir in range(len(shell_rings) - 1):
            r1 = shell_rings[ir]
            r2 = shell_rings[ir + 1]
            for it in range(segs_theta):
                it_n = (it + 1) % segs_theta
                v0, t0 = r1[it]
                v1, t1 = r1[it_n]
                v2, t2 = r2[it_n]
                v3, t3 = r2[it]
                try:
                    f = bm_edible.faces.new([v0, v1, v2, v3])
                    # Toasted crests on upper outer rim
                    if t0 and t1 and (it % 2 == 0):
                        f.material_index = 1  # mat_tart_toast
                    else:
                        f.material_index = 0  # mat_tart_crust
                except ValueError:
                    pass

        # Flat bottom outer base cap at y = 0
        v_base = bm_edible.verts.new(H.glb_to_bl((0.0, 0.0, 0.0)))
        bot_ring = shell_rings[0]
        for it in range(segs_theta):
            it_n = (it + 1) % segs_theta
            try:
                f = bm_edible.faces.new([v_base, bot_ring[it_n][0], bot_ring[it][0]])
                f.material_index = 0
            except ValueError:
                pass

        # Inner cup floor cap at y = 0.010
        v_inner_bot = bm_edible.verts.new(H.glb_to_bl((0.0, 0.010, 0.0)))
        cup_floor_ring = shell_rings[-1]
        for it in range(segs_theta):
            it_n = (it + 1) % segs_theta
            try:
                f = bm_edible.faces.new([v_inner_bot, cup_floor_ring[it][0], cup_floor_ring[it_n][0]])
                f.material_index = 0
            except ValueError:
                pass

        # 2. Warm pale yellow custard filling (fills cup up to y = 0.032, radius ~ .065)
        segs_c_r = 6
        custard_rings = []
        # Center custard vertex
        v_cust_cen = bm_edible.verts.new(H.glb_to_bl((0.0, 0.032, 0.0)))
        for ir in range(1, segs_c_r + 1):
            r_frac = ir / float(segs_c_r)
            rad = 0.065 * r_frac
            ring = []
            for it in range(segs_theta):
                th = 2.0 * math.pi * it / segs_theta
                # Slight depression/swirl in custard center
                y = 0.032 - 0.003 * (1.0 - (r_frac ** 2))
                ring.append(bm_edible.verts.new(H.glb_to_bl((rad * math.cos(th), y, rad * math.sin(th)))))
            custard_rings.append(ring)

        # Custard center fan
        for it in range(segs_theta):
            it_n = (it + 1) % segs_theta
            try:
                f = bm_edible.faces.new([v_cust_cen, custard_rings[0][it], custard_rings[0][it_n]])
                f.material_index = 2  # mat_custard
            except ValueError:
                pass

        # Custard quads
        for ir in range(len(custard_rings) - 1):
            r1 = custard_rings[ir]
            r2 = custard_rings[ir + 1]
            for it in range(segs_theta):
                it_n = (it + 1) % segs_theta
                try:
                    f = bm_edible.faces.new([r1[it], r1[it_n], r2[it_n], r2[it]])
                    f.material_index = 2  # mat_custard
                except ValueError:
                    pass

        # 3. Irregular caramelized brown brulee spots scattered across custard top
        caramel_spots = [
            ((0.000, 0.0315, 0.000), 0.008, 0.0018, 0.009, 12.0),
            ((-0.024, 0.0318, 0.016), 0.007, 0.0016, 0.006, -20.0),
            ((0.026, 0.0320, 0.014), 0.008, 0.0018, 0.006, 35.0),
            ((-0.015, 0.0316, -0.025), 0.006, 0.0015, 0.007, -40.0),
            ((0.022, 0.0317, -0.022), 0.007, 0.0016, 0.006, 15.0),
            ((0.000, 0.0322, 0.035), 0.007, 0.0017, 0.006, 5.0),
            ((-0.038, 0.0319, -0.005), 0.005, 0.0015, 0.005, 25.0),
            ((0.040, 0.0320, -0.002), 0.006, 0.0015, 0.005, -10.0),
        ]
        for c_pos, rx, ry, rz, rot in caramel_spots:
            H.add_ellipsoid(bm_edible, c_pos, rx, ry, rz, segs_u=10, segs_v=6, mat_idx=3)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors (root-local):
        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.034, 0.045), parent=root)

        glb_path = OUT_DIR / 'portuguese-egg-tart.glb'
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path),
            export_format='GLB',
            export_yup=True,
            export_apply=True,
            export_cameras=False,
            export_lights=False
        )

        png_path = OUT_DIR / 'portuguese-egg-tart.png'
        render_thumbnail((0.0, 0.018, 0.0), 0.17, png_path)

        return 'portuguese-egg-tart', glb_path, png_path

    # Build all six candidates
    built = []
    print('BUILDING 1/6: kaolengmian...')
    built.append(build_kaolengmian())
    print('BUILDING 2/6: niandoubao...')
    built.append(build_niandoubao())
    print('BUILDING 3/6: xianhuabing...')
    built.append(build_xianhuabing())
    print('BUILDING 4/6: reganmian...')
    built.append(build_reganmian())
    print('BUILDING 5/6: jidanzi...')
    built.append(build_jidanzi())
    print('BUILDING 6/6: portuguese-egg-tart...')
    built.append(build_portuguese_egg_tart())

    print('BLENDER_BUILD_COMPLETE', [b[0] for b in built])


def run_node_verify_and_manifest():
    """Uses Node GLTFLoader to verify actual exported names, dimensions, anchors and writes manifest.json."""
    node_script = """
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const outDir = '/home/baibai/outbox/pawborough-national-snacks-20261002/m10-assets';
const specs = {
  'kaolengmian': {
    profile: 'wrapped',
    utensilKind: 'none',
    requiredParts: ['edible', 'wrapper'],
    expectedAnchors: {
      leftSupport: [0.075, 0.0, 0.0],
      rightSupport: [-0.075, 0.0, 0.0],
      bite: [0.0, 0.085, 0.030]
    }
  },
  'niandoubao': {
    profile: 'cupped',
    utensilKind: 'none',
    requiredParts: ['edible'],
    expectedAnchors: {
      leftSupport: [0.065, 0.0, 0.0],
      rightSupport: [-0.065, 0.0, 0.0],
      bite: [0.0, 0.060, 0.025]
    }
  },
  'xianhuabing': {
    profile: 'cupped',
    utensilKind: 'none',
    requiredParts: ['edible'],
    expectedAnchors: {
      leftSupport: [0.065, 0.0, 0.0],
      rightSupport: [-0.065, 0.0, 0.0],
      bite: [0.0, 0.048, 0.030]
    }
  },
  'reganmian': {
    profile: 'bowl',
    utensilKind: 'chopsticks',
    requiredParts: ['container', 'edible', 'utensil'],
    expectedAnchors: {
      leftSupport: [0.070, 0.0, -0.030],
      content: [0.0, 0.018, 0.0],
      bite: [0.0, 0.018, 0.0],
      rightSupport: [-0.050, 0.0, 0.0],
      toolGrip: [0.0, 0.0, 0.0],
      toolBite: [0.0, 0.0, 0.110]
    }
  },
  'jidanzi': {
    profile: 'wrapped',
    utensilKind: 'none',
    requiredParts: ['edible', 'wrapper'],
    expectedAnchors: {
      leftSupport: [0.075, 0.0, 0.0],
      rightSupport: [-0.075, 0.0, 0.0],
      bite: [0.0, 0.085, 0.030]
    }
  },
  'portuguese-egg-tart': {
    profile: 'cupped',
    utensilKind: 'none',
    requiredParts: ['edible'],
    expectedAnchors: {
      leftSupport: [0.065, 0.0, 0.0],
      rightSupport: [-0.065, 0.0, 0.0],
      bite: [0.0, 0.034, 0.045]
    }
  }
};

const sha256File = filepath => {
  const buf = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(buf).digest('hex');
};

const parseGlb = filepath => {
  const buf = fs.readFileSync(filepath);
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject);
  });
};

async function verifyAll() {
  const manifest = {
    schemaVersion: 1,
    milestone: 'M10',
    generatedAt: new Date().toISOString(),
    sourceScript: 'asset-authoring/snacks/national/build_twelve.py',
    renderStatus: 'rendered_cycles_software_512x512_transparent',
    verificationStatus: 'verified_node_gltf_loader_m10_candidate',
    foods: {}
  };

  const ids = Object.keys(specs);
  for (const id of ids) {
    const spec = specs[id];
    const glbPath = path.join(outDir, `${id}.glb`);
    const pngPath = path.join(outDir, `${id}.png`);

    if (!fs.existsSync(glbPath)) throw new Error(`Missing ${glbPath}`);
    if (!fs.existsSync(pngPath)) throw new Error(`Missing ${pngPath}`);

    const glbStats = fs.statSync(glbPath);
    const pngStats = fs.statSync(pngPath);

    if (glbStats.size > 786432) throw new Error(`${id}.glb exceeds 0.75MiB: ${glbStats.size} bytes`);
    if (pngStats.size > 153600) throw new Error(`${id}.png exceeds 150KB: ${pngStats.size} bytes`);

    const glbSha = sha256File(glbPath);
    const pngSha = sha256File(pngPath);

    const gltf = await parseGlb(glbPath);
    const root = gltf.scene.getObjectByName(id);
    if (!root) throw new Error(`${id}: missing root node with id name`);

    // Model bounds
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const min = [box.min.x, box.min.y, box.min.z];
    const max = [box.max.x, box.max.y, box.max.z];
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

    const foodReport = {
      id,
      profile: spec.profile,
      utensilKind: spec.utensilKind,
      glbPath,
      pngPath,
      glbBytes: glbStats.size,
      glbSha256: glbSha,
      thumbnailBytes: pngStats.size,
      thumbnailSha256: pngSha,
      modelBounds: {
        min: min.map(v => Math.round(v * 10000) / 10000),
        max: max.map(v => Math.round(v * 10000) / 10000),
        size: size.map(v => Math.round(v * 10000) / 10000)
      },
      partNames: [],
      anchors: {}
    };

    // Verify required parts
    for (const partName of spec.requiredParts) {
      const partObj = root.getObjectByName(partName);
      if (!partObj) throw new Error(`${id} missing part: ${partName}`);
      foodReport.partNames.push(partName);
    }

    // Verify anchors
    for (const [anchorName, expectedPos] of Object.entries(spec.expectedAnchors)) {
      let anchorObj;
      if (anchorName === 'toolGrip' || anchorName === 'toolBite') {
        const utensil = root.getObjectByName('utensil');
        if (!utensil) throw new Error(`${id} missing utensil for anchor ${anchorName}`);
        anchorObj = utensil.getObjectByName(anchorName);
      } else {
        anchorObj = root.getObjectByName(anchorName);
      }

      if (!anchorObj) throw new Error(`${id} missing anchor ${anchorName}`);
      const actualPos = anchorObj.position.toArray().map(v => Math.round(v * 10000) / 10000);
      foodReport.anchors[anchorName] = actualPos;

      for (let i = 0; i < 3; i++) {
        if (Math.abs(actualPos[i] - expectedPos[i]) > 0.003) {
          throw new Error(`${id} anchor ${anchorName}[${i}] mismatch: expected ${expectedPos[i]}, got ${actualPos[i]}`);
        }
      }
    }

    if (id === 'reganmian') {
      const utensil = root.getObjectByName('utensil');
      const toolFood = utensil.getObjectByName('toolFood');
      if (!toolFood) throw new Error('reganmian utensil missing toolFood child');
    }

    console.log(`[VERIFIED] ${id}: glb=${glbStats.size}B, png=${pngStats.size}B, parts=${foodReport.partNames.join(',')}`);
    manifest.foods[id] = foodReport;
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n');
  console.log('MANIFEST_WRITTEN', manifestPath);
}

verifyAll().catch(err => {
  console.error('VERIFICATION_FAILED:', err);
  process.exit(1);
});
""";
    node_proc = subprocess.run(['node', '--input-type=module', '-e', node_script], capture_output=True, text=True)
    print(node_proc.stdout)
    if node_proc.returncode != 0:
        print(node_proc.stderr, file=sys.stderr)
        sys.exit(node_proc.returncode)


def main():
    try:
        import bpy
        # Running inside Blender Python
        run_blender_build()
    except ImportError:
        # Running from shell / standard python
        print('Starting headless Blender build for 6 M10 candidate snacks...')
        cmd = ['blender', '--background', '--python', str(SRC_PATH)]
        res = subprocess.run(cmd)
        if res.returncode != 0:
            print(f'Blender failed with code {res.returncode}', file=sys.stderr)
            sys.exit(res.returncode)

        print('Optimizing rendered PNG thumbnails...')
        try:
            from PIL import Image
            for png_file in OUT_DIR.glob('*.png'):
                im = Image.open(png_file)
                im.save(png_file, 'PNG', optimize=True)
        except Exception as e:
            print('PIL optimization note:', e)

        print('Running Node.js GLTFLoader verification and writing manifest.json...')
        run_node_verify_and_manifest()
        print('ALL_SIX_M10_SNACKS_BUILT_AND_VERIFIED_SUCCESSFULLY!')


if __name__ == '__main__':
    main()
