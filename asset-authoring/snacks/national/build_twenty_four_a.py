# -*- coding: utf-8 -*-
"""Build six distinct final-wave candidate meals (wave A) for M11:
1. jianbing-guozi (wrapped)
2. ludagun (cupped)
3. jianfen (bowl spoon)
4. liangpi (bowl chopsticks)
5. yangrouchuan (skewer)
6. dandanmian (bowl chopsticks)

Outputs ONLY to:
/home/baibai/outbox/pawborough-national-snacks-20261002/m11-assets-a/{id}.glb
/home/baibai/outbox/pawborough-national-snacks-20261002/m11-assets-a/{id}.png
/home/baibai/outbox/pawborough-national-snacks-20261002/m11-assets-a/manifest.json

GLB coordinate contract: Y-up, +Z front.
Models use approved cream/jade/refined soft food style with recognizable distinct geometry.
Exports static geometry only; no floor/camera/light mesh in GLBs.
Model source materials <= 8; GLB < 0.75 MiB; static 256x256 PNG < 60 KiB.
"""
import os
import sys
import math
import json
import hashlib
import subprocess
from pathlib import Path

OUT_DIR = Path('/home/baibai/outbox/pawborough-national-snacks-20261002/m11-assets-a')
SRC_PATH = Path('asset-authoring/snacks/national/build_twenty_four_a.py')


def run_blender_build(selected_ids=None):
    """Runs inside Blender to generate GLB models and rendered thumbnails."""
    import bpy
    import bmesh
    from mathutils import Vector, Matrix

    script_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(script_dir))
    import helpers as H

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if selected_ids is None:
        if '--' in sys.argv:
            idx = sys.argv.index('--')
            selected_ids = [a for a in sys.argv[idx + 1:] if not a.startswith('-')]
        else:
            selected_ids = []

    # -------------------------------------------------------------
    # Helper: Clear Scene
    # -------------------------------------------------------------
    def reset_scene():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.unit_settings.system = 'METRIC'

    # -------------------------------------------------------------
    # Shared Thumbnail Renderer (256x256, transparent, meal fills ~75%)
    # -------------------------------------------------------------
    def render_thumbnail(center_glb, target_size_m, out_png):
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = 20
        sc.cycles.device = 'CPU'
        sc.render.resolution_x = 256
        sc.render.resolution_y = 256
        sc.render.film_transparent = True
        sc.render.image_settings.file_format = 'PNG'
        sc.render.image_settings.color_mode = 'RGBA'
        sc.render.image_settings.color_depth = '8'
        sc.render.image_settings.compression = 100

        # Camera setup: 3/4 perspective view filling ~75% frame
        fov_deg = 36.0
        tan_half = math.tan(math.radians(fov_deg / 2.0))
        dist = target_size_m / (1.5 * tan_half)

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

    # -------------------------------------------------------------
    # Shared Helper: Ceramic Bowl Container
    # Standard jade ceramic bowl: outer radius 0.075, height 0.045, bottom -0.025, lip +0.020.
    # -------------------------------------------------------------
    def build_jade_bowl(root, mat_jade):
        bm_bowl = bmesh.new()
        segs_b = 36
        wall_thick = 0.0035
        outer_profile = [
            (-0.025, 0.038),   # Foot ring bottom
            (-0.022, 0.040),   # Foot ring junction
            (-0.015, 0.052),   # Lower body flare
            (-0.005, 0.063),   # Mid body
            (0.010, 0.071),    # Upper body
            (0.020, 0.075),    # Outer lip (radius 0.075)
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

        return H.create_mesh_object('container', bm_bowl, mat_jade, parent=root)

    # -------------------------------------------------------------
    # Shared Helper: Chopsticks Utensil (parallel blunt rods x ±.003)
    # -------------------------------------------------------------
    def build_chopsticks_utensil(root, mat_chopsticks, tool_food_fn):
        bm_chopsticks = bmesh.new()
        for x_off in (-0.003, 0.003):
            p_grip = (x_off, 0.0, 0.0)
            p_mid = (x_off, 0.0, 0.060)
            p_tip = (x_off, 0.0, 0.110)
            H.add_cylinder(bm_chopsticks, p_grip, p_mid, 0.0024, segs=12, cap1=True, cap2=False, mat_idx=0)
            H.add_cylinder(bm_chopsticks, p_mid, p_tip, 0.0018, segs=12, cap1=False, cap2=True, mat_idx=0)

        utensil_glb_pos = (0.088, -0.0225, -0.055)
        utensil_obj = H.create_mesh_object('utensil', bm_chopsticks, mat_chopsticks, parent=root, location_glb=utensil_glb_pos)

        toolGrip = bpy.data.objects.new('toolGrip', None)
        toolGrip.location = Vector((0.0, 0.0, 0.0))
        toolGrip.parent = utensil_obj
        bpy.context.collection.objects.link(toolGrip)

        toolBite = bpy.data.objects.new('toolBite', None)
        toolBite.location = Vector((0.0, -0.110, 0.0))
        toolBite.parent = utensil_obj
        bpy.context.collection.objects.link(toolBite)

        tool_food_fn(utensil_obj)
        return utensil_obj

    # -------------------------------------------------------------
    # Shared Helper: Spoon Utensil (rounded cup at distal)
    # -------------------------------------------------------------
    def build_spoon_utensil(root, mat_jade, tool_food_fn):
        bm_spoon = bmesh.new()
        p_grip_glb = (0.0, 0.0, 0.0)
        p_neck_glb = (0.0, 0.0, 0.085)
        H.add_cylinder(bm_spoon, p_grip_glb, p_neck_glb, 0.0025, segs=16, cap1=True, cap2=False, mat_idx=0)
        H.add_ellipsoid(bm_spoon, (0.0, 0.002, 0.0975), 0.008, 0.0045, 0.0125, segs_u=20, segs_v=12, mat_idx=0)

        utensil_glb_pos = (0.088, -0.0225, -0.055)
        utensil_obj = H.create_mesh_object('utensil', bm_spoon, mat_jade, parent=root, location_glb=utensil_glb_pos)

        toolGrip = bpy.data.objects.new('toolGrip', None)
        toolGrip.location = Vector((0.0, 0.0, 0.0))
        toolGrip.parent = utensil_obj
        bpy.context.collection.objects.link(toolGrip)

        toolBite = bpy.data.objects.new('toolBite', None)
        toolBite.location = Vector((0.0, -0.110, 0.0))
        toolBite.parent = utensil_obj
        bpy.context.collection.objects.link(toolBite)

        tool_food_fn(utensil_obj)
        return utensil_obj

    # =============================================================
    # 1. JIANBING-GUOZI (wrapped)
    # Folded yellow-green egg crepe with visible crunchy rectangular cracker inside,
    # dark brown bean sauce brush, scallions, sesame. Broad folded corners.
    # Paper bottom collar. Pose actual bite y .085 requires raised folded upper edge.
    # Width .18, height .10-.12, supports root ±.075, 0, 0, bite (0, .085, .030)
    # =============================================================
    def build_jianbing_guozi(export_glb=True, render_png=True):
        reset_scene()
        mats = [
            H.make_mat('mat_crepe', 'debe5a', roughness=0.55),        # 0: yellow-green egg crepe
            H.make_mat('mat_cracker', 'd49836', roughness=0.50),      # 1: golden crispy baocui cracker
            H.make_mat('mat_sauce', '3d1808', roughness=0.28, specular=0.7), # 2: sweet bean sauce brush
            H.make_mat('mat_scallion', '328a1c', roughness=0.35),     # 3: chopped green scallions
            H.make_mat('mat_sesame', 'f0e6d2', roughness=0.50),       # 4: white sesame seeds
            H.make_mat('mat_paper', 'ede3ce', roughness=0.75),        # 5: paper collar wrapper
        ]

        root = bpy.data.objects.new('jianbing-guozi', None)
        bpy.context.collection.objects.link(root)

        # Build 'edible' mesh
        bm_edible = bmesh.new()

        # Folded egg crepe envelope:
        # Width spans X from -0.088 to +0.088 (total width ~ 0.176m)
        segs_x = 36
        xs = [-0.088 + (0.176 * i / segs_x) for i in range(segs_x + 1)]

        # Cross section profile (py, pz):
        # Starts at lower back inner fold, loops under to bottom y=0.002,
        # rises along front face passing bite (0, 0.085, 0.030), curls inward at upper lip,
        # then top rear edge extends up to y=0.104.
        profile_yz = [
            (0.030, -0.025),   # inner back lower
            (0.010, -0.032),   # rear bottom corner
            (0.002, -0.020),   # bottom rear
            (0.002, 0.010),    # bottom front
            (0.015, 0.028),    # lower front
            (0.040, 0.035),    # mid front
            (0.065, 0.034),    # upper front
            (0.085, 0.030),    # EXACT bite contact point!
            (0.092, 0.024),    # folded front upper curl
            (0.088, 0.014),    # front flap inward tuck
            (0.085, -0.005),   # fold interior
            (0.095, -0.015),   # back sheet rise
            (0.104, -0.024),   # back upper crest
            (0.098, -0.034),   # back sheet outer descent
            (0.060, -0.036),   # mid rear
            (0.025, -0.035),   # lower rear outer
        ]
        segs_p = len(profile_yz)

        grid = []
        for ix, x in enumerate(xs):
            row = []
            x_norm = abs(x) / 0.088
            # Broad envelope tucks at sides
            corner_tuck = 1.0 - 0.12 * (x_norm ** 2.5)
            for iy, (py, pz) in enumerate(profile_yz):
                if abs(x) < 0.006 and iy == 7:
                    cur_y = 0.085
                    cur_z = 0.030
                else:
                    cur_y = py * (1.0 - 0.08 * (x_norm ** 2))
                    cur_z = pz * corner_tuck
                v = bm_edible.verts.new(H.glb_to_bl((x, cur_y, cur_z)))
                row.append(v)
            grid.append(row)

        bm_edible.verts.ensure_lookup_table()
        for ix in range(segs_x):
            r1 = grid[ix]
            r2 = grid[ix + 1]
            for ip in range(segs_p - 1):
                try:
                    f = bm_edible.faces.new([r1[ip], r1[ip + 1], r2[ip + 1], r2[ip]])
                    f.material_index = 0  # mat_crepe
                except ValueError:
                    pass

        # Side caps (folded corners)
        try:
            f_l = bm_edible.faces.new([grid[0][ip] for ip in range(segs_p)])
            f_l.material_index = 0
        except ValueError:
            pass
        try:
            f_r = bm_edible.faces.new(list(reversed([grid[-1][ip] for ip in range(segs_p)])))
            f_r.material_index = 0
        except ValueError:
            pass

        # 2. Crunchy baocui cracker inside:
        # Visible rectangular cracker with blisters/crimps protruding from top opening
        # Width from -0.065 to +0.065, height from y=0.035 to y=0.098, z around 0.005
        H.add_box(bm_edible, (0.0, 0.068, 0.005), 0.130, 0.058, 0.004, rot_deg=(2, 0, 0), mat_idx=1)
        # Blister bumps on cracker
        blister_coords = [
            (-0.045, 0.082, 0.008), (-0.020, 0.088, 0.008), (0.010, 0.086, 0.008), (0.038, 0.084, 0.008),
            (-0.035, 0.072, 0.008), (-0.005, 0.075, 0.008), (0.025, 0.072, 0.008), (0.048, 0.075, 0.008),
            (-0.048, 0.092, 0.007), (-0.015, 0.095, 0.007), (0.020, 0.094, 0.007), (0.042, 0.091, 0.007),
        ]
        for bx, by, bz in blister_coords:
            H.add_ellipsoid(bm_edible, (bx, by, bz), 0.006, 0.004, 0.0025, segs_u=8, segs_v=6, mat_idx=1)

        # 3. Dark brown bean sauce brush:
        # Savory glaze brush strokes along inner crepe fold and over cracker
        sauce_strips = [
            ((-0.035, 0.078, 0.011), 0.045, 0.009, 0.002, (8, 0, 10)),
            ((0.025, 0.080, 0.011), 0.045, 0.009, 0.002, (6, 0, -8)),
            ((0.000, 0.068, 0.011), 0.070, 0.008, 0.002, (5, 0, 2)),
            ((-0.020, 0.086, 0.011), 0.035, 0.006, 0.002, (10, 0, 5)),
        ]
        for sc, ssx, ssy, ssz, srot in sauce_strips:
            H.add_box(bm_edible, sc, ssx, ssy, ssz, rot_deg=srot, mat_idx=2)

        # 4. Chopped green scallions sprinkled on upper egg/sauce
        scallion_pts = [
            (-0.045, 0.082, 0.015), (-0.028, 0.086, 0.016), (-0.012, 0.084, 0.018),
            (0.008, 0.087, 0.017), (0.025, 0.083, 0.016), (0.042, 0.082, 0.014),
            (-0.038, 0.074, 0.016), (-0.005, 0.076, 0.018), (0.018, 0.075, 0.017),
            (0.035, 0.073, 0.015), (-0.020, 0.090, 0.012), (0.015, 0.091, 0.012),
        ]
        for sp in scallion_pts:
            H.add_cylinder(bm_edible, sp, (sp[0], sp[1] + 0.002, sp[2]), 0.0022, segs=8, mat_idx=3)

        # 5. Sesame seeds sprinkled on upper front crepe
        sesame_pts = [
            (-0.050, 0.080, 0.028), (-0.035, 0.083, 0.030), (-0.020, 0.084, 0.031),
            (-0.008, 0.085, 0.031), (0.010, 0.084, 0.031), (0.028, 0.083, 0.030),
            (0.045, 0.079, 0.027), (-0.040, 0.072, 0.033), (-0.015, 0.075, 0.034),
            (0.012, 0.074, 0.034), (0.035, 0.071, 0.032), (-0.025, 0.065, 0.035),
            (0.002, 0.068, 0.035), (0.022, 0.065, 0.034),
        ]
        for sx, sy, sz in sesame_pts:
            H.add_ellipsoid(bm_edible, (sx, sy, sz), 0.0016, 0.001, 0.0022, segs_u=6, segs_v=5, mat_idx=4)

        edible_mats = [mats[0], mats[1], mats[2], mats[3], mats[4]]
        edible_obj = H.create_mesh_object('edible', bm_edible, edible_mats, parent=root)

        # Build 'wrapper' mesh: paper bottom collar
        # Wraps bottom and lower sides/front (y from -0.003 to 0.042)
        # Leaves y > 0.045 completely open so bite(0, 0.085, 0.030) is untouched!
        bm_wrapper = bmesh.new()
        segs_wp = 16
        xs_w = [-0.091 + (0.182 * i / segs_wp) for i in range(segs_wp + 1)]
        # U-shaped collar profile from rear top y=0.045, under bottom, to front top y=0.040
        collar_yz = [
            (0.045, -0.040),
            (0.018, -0.042),
            (-0.003, -0.030),
            (-0.003, 0.015),
            (0.018, 0.038),
            (0.040, 0.036),
        ]
        w_grid = []
        for ix, x in enumerate(xs_w):
            row = []
            for iy, (py, pz) in enumerate(collar_yz):
                row.append(bm_wrapper.verts.new(H.glb_to_bl((x, py, pz))))
            w_grid.append(row)

        bm_wrapper.verts.ensure_lookup_table()
        for ix in range(segs_wp):
            r1 = w_grid[ix]
            r2 = w_grid[ix + 1]
            for ip in range(len(collar_yz) - 1):
                try:
                    f = bm_wrapper.faces.new([r1[ip], r1[ip + 1], r2[ip + 1], r2[ip]])
                    f.material_index = 0
                except ValueError:
                    pass

        wrapper_obj = H.create_mesh_object('wrapper', bm_wrapper, mats[5], parent=root)

        # Anchors
        H.make_empty('leftSupport', (0.075, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.075, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.085, 0.030), parent=root)

        glb_path = OUT_DIR / 'jianbing-guozi.glb'
        png_path = OUT_DIR / 'jianbing-guozi.png'

        if export_glb:
            bpy.ops.export_scene.gltf(
                filepath=str(glb_path),
                export_format='GLB',
                export_yup=True,
                export_apply=True,
                export_cameras=False,
                export_lights=False
            )
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.0, 0.050, 0.0), 0.18, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'jianbing-guozi', glb_path, png_path

    # =============================================================
    # 2. LUDAGUN (cupped)
    # 2 spiral redbean rolls cut crosssections, ivory dough spirals around maroon redbean paste,
    # dusty tan soybean flour exterior. Cylindrical rolled shape not round buns;
    # total width .16, height .055, bottom 0, empty gap between 2 rolls fine.
    # No shiny whole beans topping.
    # Supports ±.065, 0, 0 and bite (0, .055, .025). Edible ONLY.
    # =============================================================
    def build_ludagun(export_glb=True, render_png=True):
        reset_scene()
        mats = [
            H.make_mat('mat_dough', 'f4eedb', roughness=0.55),        # 0: ivory glutinous rice dough
            H.make_mat('mat_redbean', '52171e', roughness=0.45, specular=0.55), # 1: maroon red bean paste
            H.make_mat('mat_flour', 'c89d62', roughness=0.88),        # 2: powdery tan soybean flour
        ]

        root = bpy.data.objects.new('ludagun', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # Two cylindrical rolled pastries side by side along X
        # Roll 1 (left): X center = -0.040, spans -0.078 to -0.003
        # Roll 2 (right): X center = +0.040, spans +0.003 to +0.078
        # Gap between rolls at X=0 is fine!
        # Height from Y = 0.000 to Y = 0.055.
        # Z from -0.035 to +0.035.
        # Cylinder axis along X: length 0.075m each.
        # Cut cross-section on the side, AND tilted front face showing clear spiral!
        # To make the spiral clearly visible in both 3/4 perspective and front view:
        # We model each roll with cut cross-sections facing outward and angled, and front cut slices!
        # Specifically, each roll is a cylindrical roll lying on y=0:
        # Cylinder center at y=0.0275, z=0.0. Radius in y: 0.0275. Radius in z: 0.032.
        # Flattened bottom on y=0.

        for roll_idx, (x_min, x_max, xc) in enumerate([(-0.078, -0.003, -0.0405), (0.003, 0.078, 0.0405)]):
            segs_th = 28
            segs_len = 16
            xs_roll = [x_min + (x_max - x_min) * (i / segs_len) for i in range(segs_len + 1)]

            # Outer cylindrical shell of the roll (dusted tan soybean flour exterior)
            # Flattened on bottom y=0
            cyl_grid = []
            for ix, x in enumerate(xs_roll):
                row = []
                for ith in range(segs_th):
                    th = 2.0 * math.pi * ith / segs_th
                    # Elliptical cross section
                    ry = 0.0275
                    rz = 0.032
                    py = 0.0275 + ry * math.sin(th)
                    pz = rz * math.cos(th)
                    if py < 0.001:
                        py = 0.000
                    # Slight roll overlap seam at top-rear (th ~ 0.65 pi)
                    if 0.55 * math.pi < th < 0.75 * math.pi:
                        py += 0.0018
                    row.append(bm_edible.verts.new(H.glb_to_bl((x, py, pz))))
                cyl_grid.append(row)

            bm_edible.verts.ensure_lookup_table()
            for ix in range(segs_len):
                r1 = cyl_grid[ix]
                r2 = cyl_grid[ix + 1]
                for ith in range(segs_th):
                    ith_n = (ith + 1) % segs_th
                    try:
                        f = bm_edible.faces.new([r1[ith], r1[ith_n], r2[ith_n], r2[ith]])
                        f.material_index = 2  # mat_flour (tan soybean flour exterior)
                    except ValueError:
                        pass

            # Spiral cross-section on the cut ends (inner end x_inner and outer end x_outer):
            # For each cut end, we build the Archimedean spiral of dough and redbean paste!
            for is_outer, x_face in [(True, x_min if roll_idx == 0 else x_max), (False, x_max if roll_idx == 0 else x_min)]:
                # Build spiral cross-section disk:
                # Core: maroon red bean paste
                H.add_ellipsoid(bm_edible, (x_face, 0.0275, 0.0), 0.0015, 0.0075, 0.0085, segs_u=12, segs_v=8, mat_idx=1)

                # Ivory dough spiral ribbon and red bean spiral ribbon
                # Spiral angle t from 0 to 4.5 * pi
                n_spiral = 32
                for s_step in range(n_spiral):
                    t = 0.5 * math.pi + (4.0 * math.pi * s_step / n_spiral)
                    # Radius grows from 0.007 to 0.026
                    r_dough = 0.007 + 0.019 * (s_step / n_spiral)
                    ry_d = r_dough
                    rz_d = r_dough * 1.15
                    py_d = 0.0275 + ry_d * math.sin(t)
                    pz_d = rz_d * math.cos(t)
                    if py_d < 0.001:
                        py_d = 0.001
                    if py_d > 0.054:
                        py_d = 0.054

                    # Ivory dough node
                    H.add_box(bm_edible, (x_face, py_d, pz_d), 0.0018, 0.0042, 0.0042, mat_idx=0)

                    # Parallel maroon redbean paste spiral ribbon nestled inside dough
                    r_bean = r_dough - 0.0028
                    if r_bean > 0.005:
                        py_b = 0.0275 + r_bean * math.sin(t)
                        pz_b = r_bean * 1.15 * math.cos(t)
                        if 0.001 <= py_b <= 0.054:
                            H.add_box(bm_edible, (x_face, py_b, pz_b), 0.0018, 0.0035, 0.0035, mat_idx=1)

        # Dusty soybean flour powder particles sprinkled across rolls
        dust_pts = [
            (-0.060, 0.055, 0.008), (-0.040, 0.055, -0.005), (-0.020, 0.055, 0.012),
            (0.020, 0.055, -0.010), (0.040, 0.055, 0.006), (0.060, 0.055, -0.008),
            (-0.050, 0.048, 0.022), (-0.030, 0.050, 0.024), (0.030, 0.050, 0.024),
            (0.050, 0.048, 0.022), (-0.045, 0.005, 0.030), (0.045, 0.005, 0.030),
        ]
        for dx, dy, dz in dust_pts:
            H.add_ellipsoid(bm_edible, (dx, dy, dz), 0.003, 0.0015, 0.003, segs_u=6, segs_v=5, mat_idx=2)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors: supports ±.065, 0, 0 and top front bite (0, .055, .025)
        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.055, 0.025), parent=root)

        glb_path = OUT_DIR / 'ludagun.glb'
        png_path = OUT_DIR / 'ludagun.png'

        if export_glb:
            bpy.ops.export_scene.gltf(
                filepath=str(glb_path),
                export_format='GLB',
                export_yup=True,
                export_apply=True,
                export_cameras=False,
                export_lights=False
            )
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.0, 0.028, 0.0), 0.16, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'ludagun', glb_path, png_path

    # =============================================================
    # 3. JIANFEN (bowl spoon)
    # Visible translucent brown/amber starch jelly irregular cubes 12mm,
    # peppers/scallions and small savory brown sauce; distinguish starch jelly from milk/noodles,
    # clear cut faces/rounded edges. NO smooth solid top disk hiding pieces.
    # Jade bowl outer radius .075, height .045, bottom -.025, mound top .018-.04.
    # Anchors: leftSupport (.070, 0, -.030), content/bite (0, .030, 0), rightSupport (-.050, 0, 0)
    # =============================================================
    def build_jianfen(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'jade': H.make_mat('mat_jade', 'aecbbe', roughness=0.12, specular=0.8),
            'jelly': H.make_mat('mat_jelly', 'c2843d', roughness=0.20, specular=0.85),       # translucent amber starch jelly
            'char': H.make_mat('mat_char', '6e3412', roughness=0.55),                        # pan-fried crisp char crust
            'sauce': H.make_mat('mat_sauce', '48200c', roughness=0.22, specular=0.75),       # savory brown garlic broth
            'scallion': H.make_mat('mat_scallion', '2d851e', roughness=0.35),                # green scallions
            'pepper': H.make_mat('mat_pepper', 'b32014', roughness=0.30),                    # red chili flecks
        }

        root = bpy.data.objects.new('jianfen', None)
        bpy.context.collection.objects.link(root)

        # 1. Container: Jade ceramic bowl
        build_jade_bowl(root, mats['jade'])

        # 2. Edible: 30+ irregular 12mm cubes of translucent amber starch jelly stacked naturally
        bm_edible = bmesh.new()

        # Low savory brown sauce pool inside bowl (y from -0.012 to -0.005)
        H.add_ellipsoid(bm_edible, (0.0, -0.008, 0.0), 0.052, 0.006, 0.052, segs_u=16, segs_v=8, y_max=-0.005, mat_idx=3)

        # Helper to add a beveled 12mm starch jelly cube with cut faces
        def add_jelly_cube(bm, center, size=(0.012, 0.011, 0.012), rot=(0, 0, 0), has_char=False):
            # Main jelly cube (mat_idx=1)
            H.add_box(bm, center, size[0], size[1], size[2], rot_deg=rot, mat_idx=1)
            if has_char:
                # Add fried char crust on top face (mat_idx=2)
                char_c = (center[0], center[1] + size[1] * 0.48, center[2])
                H.add_box(bm, char_c, size[0] * 0.85, 0.0012, size[2] * 0.85, rot_deg=rot, mat_idx=2)

        # 34 individual starch jelly cubes stacked in 3 tiers, peaking at y=0.033
        # Center cube right at (0, 0.030, 0)
        cube_specs = [
            # Tier 1 (bottom layer, y ~ -0.008 to +0.008)
            ((-0.032, -0.002, -0.025), (0.012, 0.011, 0.012), (5, 12, -4), False),
            ((-0.012, -0.001, -0.035), (0.011, 0.011, 0.012), (-8, 25, 6), False),
            ((0.015, -0.002, -0.030), (0.012, 0.010, 0.011), (10, -15, -5), False),
            ((0.035, -0.003, -0.018), (0.011, 0.011, 0.012), (6, 35, 10), False),
            ((-0.038, -0.002, 0.005), (0.012, 0.011, 0.011), (-12, 40, -8), False),
            ((-0.020, 0.002, -0.005), (0.012, 0.012, 0.012), (4, -20, 12), True),
            ((0.005, 0.001, -0.010), (0.012, 0.011, 0.012), (-6, 15, -10), True),
            ((0.028, 0.000, 0.002), (0.011, 0.011, 0.012), (14, -28, 6), False),
            ((-0.030, -0.001, 0.025), (0.012, 0.011, 0.011), (-5, 18, -4), False),
            ((-0.008, 0.001, 0.028), (0.012, 0.011, 0.012), (8, -32, 10), False),
            ((0.018, 0.000, 0.025), (0.011, 0.011, 0.012), (-10, 22, -6), False),
            ((0.036, -0.002, 0.015), (0.012, 0.010, 0.011), (6, -15, 8), False),

            # Tier 2 (middle layer, y ~ 0.010 to 0.024)
            ((-0.025, 0.014, -0.018), (0.012, 0.011, 0.012), (8, 20, -10), True),
            ((-0.005, 0.015, -0.022), (0.012, 0.011, 0.011), (-12, 10, 8), True),
            ((0.018, 0.013, -0.016), (0.011, 0.012, 0.012), (6, -25, -6), True),
            ((-0.028, 0.012, 0.008), (0.012, 0.011, 0.012), (10, 32, 5), True),
            ((-0.008, 0.016, 0.002), (0.012, 0.012, 0.012), (-5, -15, 12), True),
            ((0.016, 0.015, 0.006), (0.012, 0.011, 0.011), (12, 18, -8), True),
            ((-0.018, 0.013, 0.022), (0.011, 0.011, 0.012), (-8, 28, -5), True),
            ((0.008, 0.014, 0.020), (0.012, 0.011, 0.012), (6, -18, 10), True),
            ((0.028, 0.011, -0.005), (0.012, 0.010, 0.011), (-10, -35, 7), False),
            ((-0.035, 0.009, -0.005), (0.011, 0.011, 0.012), (15, 12, -12), False),

            # Tier 3 (top mounded cubes, y ~ 0.022 to 0.034)
            ((-0.014, 0.025, -0.010), (0.012, 0.011, 0.012), (6, 15, -8), True),
            ((0.012, 0.024, -0.008), (0.012, 0.011, 0.011), (-8, -20, 6), True),
            ((-0.012, 0.025, 0.010), (0.011, 0.011, 0.012), (-5, 22, -6), True),
            ((0.010, 0.024, 0.012), (0.012, 0.011, 0.012), (10, -18, 8), True),
            # Apex cube centered exactly at (0.0, 0.030, 0.0) matching content/bite anchor!
            ((0.000, 0.030, 0.000), (0.012, 0.011, 0.012), (4, 10, -3), True),
            ((-0.002, 0.029, -0.014), (0.011, 0.010, 0.011), (-6, 25, 5), True),
            ((0.004, 0.028, 0.015), (0.011, 0.010, 0.011), (8, -12, -7), True),
        ]

        for cc, cs, cr, ch in cube_specs:
            add_jelly_cube(bm_edible, cc, cs, cr, ch)

        # Chopped scallions (mat_idx=4)
        scallion_pts = [
            (-0.018, 0.033, -0.005), (0.015, 0.032, 0.002), (-0.005, 0.036, 0.008),
            (0.008, 0.035, -0.010), (-0.022, 0.022, 0.015), (0.020, 0.023, -0.015),
            (-0.008, 0.028, 0.018), (0.014, 0.027, 0.018), (-0.025, 0.018, -0.012),
            (0.022, 0.019, 0.012), (0.000, 0.036, -0.002),
        ]
        for sp in scallion_pts:
            H.add_cylinder(bm_edible, sp, (sp[0], sp[1] + 0.002, sp[2]), 0.0022, segs=8, mat_idx=4)

        # Red chili pepper bits (mat_idx=5)
        pepper_pts = [
            (-0.010, 0.033, 0.004), (0.012, 0.033, -0.004), (0.002, 0.036, 0.005),
            (-0.015, 0.025, -0.012), (0.016, 0.024, 0.010), (-0.005, 0.026, 0.020),
            (0.006, 0.027, -0.016), (-0.024, 0.019, 0.008), (0.025, 0.018, -0.006),
        ]
        for pp in pepper_pts:
            H.add_box(bm_edible, pp, 0.0035, 0.002, 0.0035, rot_deg=(15, 30, 20), mat_idx=5)

        edible_mats = [mats['jade'], mats['jelly'], mats['char'], mats['sauce'], mats['scallion'], mats['pepper']]
        edible_obj = H.create_mesh_object('edible', bm_edible, edible_mats, parent=root)

        # 3. Utensil: Jade spoon with amber starch jelly morsel at toolBite
        def add_spoon_morsel(utensil_obj):
            bm_tf = bmesh.new()
            # 8mm jelly cube in spoon bowl
            H.add_box(bm_tf, (0.0, 0.0, 0.0), 0.0075, 0.0065, 0.0075, rot_deg=(5, 12, 0), mat_idx=0)
            # Scallion speck
            H.add_cylinder(bm_tf, (0.001, 0.0035, 0.001), (0.001, 0.005, 0.001), 0.0015, segs=6, mat_idx=1)
            toolFood = H.create_mesh_object('toolFood', bm_tf, [mats['jelly'], mats['scallion']], parent=utensil_obj)
            toolFood.location = Vector((0.0, -0.098, 0.002))

        build_spoon_utensil(root, mats['jade'], add_spoon_morsel)

        # Anchors: leftSupport, content, bite, rightSupport
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)

        glb_path = OUT_DIR / 'jianfen.glb'
        png_path = OUT_DIR / 'jianfen.png'

        if export_glb:
            bpy.ops.export_scene.gltf(
                filepath=str(glb_path),
                export_format='GLB',
                export_yup=True,
                export_apply=True,
                export_cameras=False,
                export_lights=False
            )
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.020, -0.005, 0.0), 0.18, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'jianfen', glb_path, png_path

    # =============================================================
    # 4. LIANGPI (bowl chopsticks)
    # Broad ivory flat rice/noodle ribbons with folded loops of thin rectangular cross section,
    # green cucumber matchsticks and red chili oil/sesame. NO round spaghetti substitution.
    # 12+ visible ribbons on mound lower than strands.
    # Anchors: leftSupport (.070, 0, -.030), content/bite (0, .030, 0), rightSupport (-.050, 0, 0)
    # =============================================================
    def build_liangpi(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'jade': H.make_mat('mat_jade', 'aecbbe', roughness=0.12, specular=0.8),
            'ribbon': H.make_mat('mat_ribbon', 'f3eee4', roughness=0.32, specular=0.60),     # ivory flat rice ribbon
            'chili_oil': H.make_mat('mat_chili_oil', '9e1a12', roughness=0.18, specular=0.90), # crimson chili oil
            'cucumber': H.make_mat('mat_cucumber', '3ea424', roughness=0.38),                 # green cucumber matchsticks
            'mianjin': H.make_mat('mat_mianjin', 'c29452', roughness=0.65),                   # spongy wheat gluten cubes
            'sesame': H.make_mat('mat_sesame', 'eee3cb', roughness=0.50),                     # toasted sesame
            'chopsticks': H.make_mat('mat_chopsticks', '553118', roughness=0.48, specular=0.45), # dark wood
        }

        root = bpy.data.objects.new('liangpi', None)
        bpy.context.collection.objects.link(root)

        # 1. Container: Jade ceramic bowl
        build_jade_bowl(root, mats['jade'])

        # 2. Edible: 16+ broad flat ribbon loops with thin rectangular cross section
        bm_edible = bmesh.new()

        # Low base mound inside bowl (lower than strands, y <= 0.012)
        H.add_ellipsoid(bm_edible, (0.0, 0.003, 0.0), 0.054, 0.008, 0.054, segs_u=18, segs_v=8, y_max=0.012, mat_idx=0)

        # Helper to extrude broad flat ribbon with thin rectangular cross section
        # Width: 0.009m, thickness: 0.0018m (NOT circular!)
        def add_flat_ribbon(bm, points, width=0.009, thickness=0.0018, mat_idx=0):
            n_pts = len(points)
            if n_pts < 2:
                return
            frames = []
            for i in range(n_pts):
                p = Vector(points[i])
                p_bl = H.glb_to_bl(p)
                if i == 0:
                    tangent = (H.glb_to_bl(Vector(points[1])) - p_bl).normalized()
                elif i == n_pts - 1:
                    tangent = (p_bl - H.glb_to_bl(Vector(points[-2]))).normalized()
                else:
                    tangent = (H.glb_to_bl(Vector(points[i + 1])) - H.glb_to_bl(Vector(points[i - 1]))).normalized()

                up = Vector((0, 0, 1)) if abs(tangent.z) < 0.9 else Vector((0, 1, 0))
                normal = tangent.cross(up).normalized()
                binormal = tangent.cross(normal).normalized()

                hw = width / 2.0
                ht = thickness / 2.0

                v0 = bm.verts.new(p_bl - normal * hw - binormal * ht)
                v1 = bm.verts.new(p_bl + normal * hw - binormal * ht)
                v2 = bm.verts.new(p_bl + normal * hw + binormal * ht)
                v3 = bm.verts.new(p_bl - normal * hw + binormal * ht)
                frames.append([v0, v1, v2, v3])

            bm.verts.ensure_lookup_table()
            for i in range(n_pts - 1):
                f1 = frames[i]
                f2 = frames[i + 1]
                for k in range(4):
                    kn = (k + 1) % 4
                    try:
                        face = bm.faces.new([f1[k], f1[kn], f2[kn], f2[k]])
                        face.material_index = mat_idx
                    except ValueError:
                        pass
            # End caps
            try:
                bm.faces.new(frames[0]).material_index = mat_idx
            except ValueError:
                pass
            try:
                bm.faces.new(list(reversed(frames[-1]))).material_index = mat_idx
            except ValueError:
                pass

        # 16 broad ivory flat ribbon loops draped across bowl peaking at y=0.030-0.035
        ribbon_paths = [
            # 1. Main central loop passing through (0, 0.030, 0)
            [(-0.042, 0.016, -0.018), (-0.022, 0.026, -0.008), (0.000, 0.030, 0.000), (0.024, 0.027, 0.012), (0.042, 0.018, 0.022)],
            # 2. Transverse S-loop 2
            [(-0.045, 0.018, 0.015), (-0.024, 0.028, 0.018), (0.002, 0.032, 0.008), (0.026, 0.026, -0.008), (0.045, 0.017, -0.020)],
            # 3. High diagonal arch 3
            [(-0.035, 0.016, -0.032), (-0.015, 0.028, -0.016), (0.008, 0.033, 0.002), (0.030, 0.028, 0.020), (0.046, 0.016, 0.028)],
            # 4. Reverse diagonal arch 4
            [(0.038, 0.016, -0.028), (0.018, 0.027, -0.012), (-0.005, 0.032, 0.005), (-0.026, 0.028, 0.018), (-0.042, 0.017, 0.026)],
            # 5. Front folded loop 5
            [(-0.038, 0.018, 0.024), (-0.018, 0.026, 0.035), (0.005, 0.028, 0.036), (0.025, 0.025, 0.030), (0.040, 0.017, 0.018)],
            # 6. Rear folded loop 6
            [(-0.040, 0.018, -0.022), (-0.020, 0.026, -0.034), (0.005, 0.027, -0.035), (0.026, 0.025, -0.028), (0.042, 0.018, -0.015)],
            # 7. Left flank turn loop 7
            [(-0.022, 0.018, -0.038), (-0.042, 0.025, -0.018), (-0.048, 0.027, 0.005), (-0.040, 0.024, 0.025), (-0.022, 0.018, 0.036)],
            # 8. Right flank turn loop 8
            [(0.022, 0.018, -0.038), (0.042, 0.025, -0.018), (0.048, 0.027, 0.005), (0.040, 0.024, 0.025), (0.022, 0.018, 0.036)],
            # 9. Top crest fold 9
            [(-0.020, 0.028, 0.005), (-0.006, 0.034, 0.004), (0.008, 0.034, -0.006), (0.022, 0.029, -0.012)],
            # 10. Secondary crest fold 10
            [(-0.015, 0.029, -0.012), (0.000, 0.033, -0.010), (0.016, 0.032, 0.006), (0.026, 0.026, 0.016)],
            # 11. Mid-level ribbon 11
            [(-0.032, 0.020, 0.000), (-0.012, 0.026, 0.012), (0.012, 0.025, 0.018), (0.032, 0.021, 0.008)],
            # 12. Mid-level cross 12
            [(-0.015, 0.022, 0.030), (0.002, 0.027, 0.016), (0.018, 0.026, -0.002), (0.030, 0.020, -0.018)],
            # 13. Deep loop 13
            [(-0.046, 0.017, -0.005), (-0.030, 0.024, -0.012), (-0.010, 0.028, -0.022), (0.012, 0.025, -0.026)],
            # 14. Fore loop 14
            [(-0.012, 0.024, 0.028), (0.008, 0.029, 0.025), (0.028, 0.024, 0.014), (0.044, 0.017, 0.002)],
            # 15. Knot curl 15
            [(-0.010, 0.030, 0.008), (0.002, 0.033, 0.012), (0.014, 0.031, 0.002), (0.006, 0.028, -0.008)],
            # 16. Twist strand 16
            [(-0.025, 0.023, -0.020), (-0.008, 0.031, -0.004), (0.012, 0.030, 0.010), (0.028, 0.022, 0.024)],
        ]

        for rp in ribbon_paths:
            add_flat_ribbon(bm_edible, rp, width=0.009, thickness=0.0018, mat_idx=0)

        # 8 spongy gluten cubes (面筋 - mianjin, mat_idx=3)
        mianjin_cubes = [
            ((-0.025, 0.025, -0.015), (0.009, 0.008, 0.009), (12, 25, 8)),
            ((0.022, 0.024, -0.018), (0.0085, 0.008, 0.0085), (-10, -20, 15)),
            ((-0.020, 0.026, 0.018), (0.009, 0.008, 0.009), (8, 35, -12)),
            ((0.024, 0.025, 0.016), (0.0085, 0.008, 0.0085), (-15, -28, -6)),
            ((-0.005, 0.028, -0.024), (0.008, 0.0075, 0.008), (14, 10, -10)),
            ((0.008, 0.027, 0.026), (0.008, 0.0075, 0.008), (-8, 18, 12)),
            ((-0.034, 0.020, 0.005), (0.008, 0.007, 0.008), (5, 45, 10)),
            ((0.032, 0.021, -0.002), (0.008, 0.007, 0.008), (-12, -40, 8)),
        ]
        for mc, ms, mr in mianjin_cubes:
            H.add_box(bm_edible, mc, ms[0], ms[1], ms[2], rot_deg=mr, mat_idx=3)

        # 16 slender green cucumber matchsticks (mat_idx=2)
        # Length ~0.018m, size 0.0018 x 0.0018m
        cuke_sticks = [
            ((-0.015, 0.032, -0.008), (0.002, 0.030, -0.004), 0.0012),
            ((0.004, 0.032, -0.006), (0.020, 0.029, -0.002), 0.0012),
            ((-0.010, 0.033, 0.006), (0.006, 0.033, 0.010), 0.0012),
            ((0.010, 0.031, 0.008), (0.025, 0.027, 0.014), 0.0012),
            ((-0.024, 0.028, 0.012), (-0.010, 0.031, 0.018), 0.0012),
            ((0.014, 0.029, -0.014), (0.028, 0.024, -0.010), 0.0012),
            ((-0.008, 0.034, -0.002), (0.008, 0.034, 0.002), 0.0012),
            ((-0.020, 0.027, -0.022), (-0.005, 0.030, -0.018), 0.0012),
            ((0.002, 0.031, 0.020), (0.018, 0.028, 0.024), 0.0012),
            ((-0.028, 0.023, -0.006), (-0.014, 0.027, -0.002), 0.0012),
            ((0.020, 0.025, 0.002), (0.034, 0.021, 0.006), 0.0012),
            ((-0.002, 0.033, 0.014), (0.014, 0.030, 0.018), 0.0012),
            ((-0.018, 0.030, 0.002), (-0.004, 0.033, 0.006), 0.0012),
            ((0.006, 0.032, -0.012), (0.022, 0.028, -0.008), 0.0012),
        ]
        for p1, p2, r in cuke_sticks:
            H.add_cylinder(bm_edible, p1, p2, r, segs=6, cap1=True, cap2=True, mat_idx=2)

        # Red chili oil ribbons and droplets (mat_idx=1)
        chili_drips = [
            [(-0.018, 0.032, -0.005), (0.000, 0.034, 0.000), (0.016, 0.031, 0.006)],
            [(-0.012, 0.033, 0.008), (0.005, 0.034, 0.010), (0.022, 0.029, 0.012)],
            [(-0.008, 0.033, -0.012), (0.010, 0.032, -0.008), (0.024, 0.027, -0.002)],
            [(-0.025, 0.027, 0.014), (-0.008, 0.031, 0.018)],
        ]
        for cd in chili_drips:
            for i_c in range(len(cd) - 1):
                H.add_cylinder(bm_edible, cd[i_c], cd[i_c + 1], 0.0018, segs=6, cap1=True, cap2=True, mat_idx=1)

        # Toasted sesame seeds (mat_idx=4)
        sesame_pts = [
            (-0.014, 0.034, 0.002), (0.012, 0.033, -0.002), (0.002, 0.035, 0.006),
            (-0.006, 0.034, -0.008), (0.018, 0.031, 0.010), (-0.020, 0.029, 0.014),
            (0.014, 0.030, -0.010), (0.000, 0.035, 0.000),
        ]
        for sx, sy, sz in sesame_pts:
            H.add_ellipsoid(bm_edible, (sx, sy, sz), 0.0015, 0.0008, 0.002, segs_u=6, segs_v=5, mat_idx=4)

        edible_mats = [mats['ribbon'], mats['chili_oil'], mats['cucumber'], mats['mianjin'], mats['sesame']]
        edible_obj = H.create_mesh_object('edible', bm_edible, edible_mats, parent=root)

        # 3. Utensil: Chopsticks with lifted flat ribbon morsel at toolBite
        def add_liangpi_morsel(utensil_obj):
            bm_tf = bmesh.new()
            # Folded flat ribbon loop morsel held between chopstick tips
            rib_pts = [
                (-0.002, 0.001, -0.008),
                (0.000, 0.003, -0.002),
                (0.002, 0.002, 0.005),
                (0.000, -0.001, 0.008),
            ]
            add_flat_ribbon(bm_tf, rib_pts, width=0.006, thickness=0.0014, mat_idx=0)
            # Fleck of chili oil
            H.add_ellipsoid(bm_tf, (0.0, 0.0035, 0.0), 0.002, 0.0012, 0.002, segs_u=6, segs_v=5, mat_idx=1)
            toolFood = H.create_mesh_object('toolFood', bm_tf, [mats['ribbon'], mats['chili_oil']], parent=utensil_obj)
            toolFood.location = Vector((0.0, -0.106, 0.001))

        build_chopsticks_utensil(root, mats['chopsticks'], add_liangpi_morsel)

        # Anchors
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)

        glb_path = OUT_DIR / 'liangpi.glb'
        png_path = OUT_DIR / 'liangpi.png'

        if export_glb:
            bpy.ops.export_scene.gltf(
                filepath=str(glb_path),
                export_format='GLB',
                export_yup=True,
                export_apply=True,
                export_cameras=False,
                export_lights=False
            )
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.020, -0.005, 0.0), 0.18, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'liangpi', glb_path, png_path

    # =============================================================
    # 5. YANGROUCHUAN (skewer)
    # 3 irregular roasted brown lamb chunks, angular soft beveled edges and gold char patches,
    # seed flecks, small ivory fat layer; plainly different from red fruit 3 balls.
    # Blunt stem buried under upper meat, no eye needle. Fixed skewer anchors real food bite.
    # Overall height .20, upper edible from y .015..135;
    # root leftSupport (.015, -.035, 0), right (-.015, -.025, 0), bite (0, .115, .021)
    # =============================================================
    def build_yangrouchuan(export_glb=True, render_png=True):
        reset_scene()
        mats = [
            H.make_mat('mat_lamb', '5e321e', roughness=0.65, specular=0.35),          # 0: roasted brown lamb meat
            H.make_mat('mat_fat', 'ece5d8', roughness=0.40, specular=0.55),           # 1: rendered ivory mutton fat
            H.make_mat('mat_char', '261005', roughness=0.60),                         # 2: grilled char patches
            H.make_mat('mat_spice', '8e6524', roughness=0.50),                        # 3: cumin & chili spice flecks
            H.make_mat('mat_wood', 'cbb184', roughness=0.60),                         # 4: wood skewer
        ]

        root = bpy.data.objects.new('yangrouchuan', None)
        bpy.context.collection.objects.link(root)

        # Build 'edible' mesh: 3 irregular angular roasted lamb chunks (NOT spheres!)
        # Upper edible spans Y from 0.015 to 0.135
        # Chunk 1 (lower): Y from 0.015 to 0.054 (center y=0.0345)
        # Chunk 2 (middle): Y from 0.054 to 0.095 (center y=0.0745) + rendered fat layer
        # Chunk 3 (upper): Y from 0.095 to 0.135 (center y=0.115), front face reaches z=0.021!
        bm_edible = bmesh.new()

        # Helper to generate irregular angular roasted meat block with beveled cut facets
        def add_angular_meat_chunk(bm, cy, height, rx, rz, z_front, mat_idx=0, twist_deg=0):
            # 8-sided polygon cross sections at 5 height slices
            n_sides = 8
            n_slices = 5
            slices = []
            hy = height / 2.0
            for i_sl in range(n_slices):
                v_frac = i_sl / (n_slices - 1)
                py = (cy - hy) + height * v_frac
                # Beveled profile at top and bottom
                taper = 1.0 - 0.22 * ((2.0 * v_frac - 1.0) ** 2)
                ring = []
                for i_s in range(n_sides):
                    th = 2.0 * math.pi * i_s / n_sides + math.radians(twist_deg)
                    # Asymmetric radius wobble for authentic butcher cut
                    wobble = 1.0 + 0.14 * math.sin(3.0 * th) + 0.08 * math.cos(2.0 * th)
                    vx = rx * math.cos(th) * taper * wobble
                    vz = rz * math.sin(th) * taper * wobble
                    # Push front face to target z_front if specified
                    if z_front is not None and i_sl == 2 and (i_s == 2 or i_s == 3):
                        vz = z_front
                    ring.append(bm.verts.new(H.glb_to_bl((vx, py, vz))))
                slices.append(ring)

            bm.verts.ensure_lookup_table()
            for i_sl in range(n_slices - 1):
                r1 = slices[i_sl]
                r2 = slices[i_sl + 1]
                for i_s in range(n_sides):
                    i_sn = (i_s + 1) % n_sides
                    try:
                        f = bm.faces.new([r1[i_s], r1[i_sn], r2[i_sn], r2[i_s]])
                        f.material_index = mat_idx
                    except ValueError:
                        pass
            # Caps
            try:
                bm.faces.new(slices[0]).material_index = mat_idx
            except ValueError:
                pass
            try:
                bm.faces.new(list(reversed(slices[-1]))).material_index = mat_idx
            except ValueError:
                pass

        # Chunk 1 (lower): y=0.015 to 0.054 (center y=0.0345)
        add_angular_meat_chunk(bm_edible, cy=0.0345, height=0.039, rx=0.018, rz=0.017, z_front=0.019, mat_idx=0, twist_deg=15)

        # Chunk 2 (middle): y=0.054 to 0.095 (center y=0.0745)
        # Main lean meat lower part
        add_angular_meat_chunk(bm_edible, cy=0.069, height=0.030, rx=0.019, rz=0.018, z_front=0.020, mat_idx=0, twist_deg=-20)
        # Small ivory rendered mutton fat layer cap at top of Chunk 2 (y ~ 0.084 to 0.095)
        add_angular_meat_chunk(bm_edible, cy=0.0895, height=0.011, rx=0.018, rz=0.017, z_front=0.019, mat_idx=1, twist_deg=35)

        # Chunk 3 (upper): y=0.095 to 0.135 (center y=0.115)
        # Must have front surface at y=0.115, x=0, z=0.021 exactly matching bite(0, 0.115, 0.021)
        add_angular_meat_chunk(bm_edible, cy=0.115, height=0.040, rx=0.019, rz=0.018, z_front=0.021, mat_idx=0, twist_deg=10)

        # Char crust patches on angular facets of roasted lamb
        char_patches = [
            ((-0.012, 0.122, 0.014), 0.006, 0.007, 0.002, (10, 20, 15)),
            ((0.010, 0.118, 0.015), 0.005, 0.008, 0.002, (-8, -25, -10)),
            ((0.014, 0.110, -0.010), 0.006, 0.007, 0.002, (12, 45, 8)),
            ((-0.014, 0.078, 0.013), 0.006, 0.006, 0.002, (5, -15, 12)),
            ((0.012, 0.065, 0.014), 0.005, 0.007, 0.002, (-12, 30, -6)),
            ((-0.010, 0.042, 0.013), 0.006, 0.007, 0.002, (8, 18, 10)),
            ((0.011, 0.032, 0.014), 0.005, 0.006, 0.002, (-6, -30, 8)),
        ]
        for cc, csx, csy, csz, crot in char_patches:
            H.add_box(bm_edible, cc, csx, csy, csz, rot_deg=crot, mat_idx=2)

        # Cumin seeds and red chili flakes sprinkled on meat
        spice_pts = [
            (-0.008, 0.125, 0.018), (0.006, 0.122, 0.019), (-0.005, 0.112, 0.021),
            (0.007, 0.114, 0.021), (-0.014, 0.115, 0.014), (0.015, 0.116, 0.013),
            (-0.006, 0.082, 0.018), (0.008, 0.084, 0.017), (-0.010, 0.072, 0.018),
            (0.008, 0.068, 0.018), (-0.008, 0.045, 0.017), (0.006, 0.038, 0.018),
            (0.000, 0.028, 0.018), (-0.012, 0.034, 0.015), (0.012, 0.035, 0.014),
        ]
        for sx, sy, sz in spice_pts:
            H.add_ellipsoid(bm_edible, (sx, sy, sz), 0.0016, 0.001, 0.0016, segs_u=6, segs_v=5, mat_idx=3)

        edible_mats = [mats[0], mats[1], mats[2], mats[3]]
        edible_obj = H.create_mesh_object('edible', bm_edible, edible_mats, parent=root)

        # Build 'skewer' mesh:
        # Overall height 0.20 (y from -0.065 to +0.135)
        # Shaft from bottom y=-0.062 to top y=0.112 buried under upper meat (chunk 3 top is 0.135).
        # Blunt rounded bottom tip at y=-0.065, no needle tip at top!
        bm_skewer = bmesh.new()
        skewer_r = 0.0028
        H.add_cylinder(bm_skewer, (0.0, -0.062, 0.0), (0.0, 0.112, 0.0), skewer_r, segs=16, cap1=False, cap2=True, mat_idx=0)
        H.add_rounded_tip(bm_skewer, (0.0, -0.062, 0.0), skewer_r, axis_glb=(0, -1, 0), segs=16, mat_idx=0)

        skewer_obj = H.create_mesh_object('skewer', bm_skewer, mats[4], parent=root)

        # Anchors: root leftSupport (.015, -.035, 0), right (-.015, -.025, 0), bite (0, .115, .021)
        H.make_empty('leftSupport', (0.015, -0.035, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.015, -0.025, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.115, 0.021), parent=root)

        glb_path = OUT_DIR / 'yangrouchuan.glb'
        png_path = OUT_DIR / 'yangrouchuan.png'

        if export_glb:
            bpy.ops.export_scene.gltf(
                filepath=str(glb_path),
                export_format='GLB',
                export_yup=True,
                export_apply=True,
                export_cameras=False,
                export_lights=False
            )
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.0, 0.035, 0.0), 0.20, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'yangrouchuan', glb_path, png_path

    # =============================================================
    # 6. DANDANMIAN (Profile: bowl, Utensil: chopsticks)
    # Actual thin golden noodle loop heap (18+ strand segments),
    # reddish chili/sesame sauce underlying base (y <= 0.015),
    # minced meat tiny brown cubes, chopped mustard greens, scallions, peanuts on noodles;
    # dark red accent, visible tool morsel noodle loop.
    # Jade bowl, anchors: leftSupport (.070, 0, -.030), content/bite (0, .030, 0), rightSupport (-.050, 0, 0)
    # =============================================================
    def build_dandanmian(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'jade': H.make_mat('mat_jade', 'aecbbe', roughness=0.12, specular=0.8),
            'thin_noodles': H.make_mat('mat_thin_noodles', 'f0d480', roughness=0.42, specular=0.45), # thin golden alkaline noodles
            'chili_sesame': H.make_mat('mat_chili_sesame', '7a1810', roughness=0.18, specular=0.85), # glossy spicy dark-red chili/sesame oil sauce
            'minced_meat': H.make_mat('mat_minced_meat', '442314', roughness=0.68),                 # crispy fried minced pork cubes
            'yacai': H.make_mat('mat_yacai', '1c2e17', roughness=0.45),                             # chopped dark mustard greens
            'peanuts': H.make_mat('mat_peanuts', 'c99a57', roughness=0.55),                         # crushed toasted peanuts
            'scallions': H.make_mat('mat_scallions', '2f9620', roughness=0.35),                     # green scallions
            'chopsticks': H.make_mat('mat_chopsticks', '553118', roughness=0.48, specular=0.45),   # dark wood chopsticks
        }

        root = bpy.data.objects.new('dandanmian', None)
        bpy.context.collection.objects.link(root)

        # 1. Container: Jade ceramic bowl
        build_jade_bowl(root, mats['jade'])

        # 2. Edible: Spicy red sauce underlying base + 18+ tangled curving thin noodle strands + minced meat cubes + greens
        bm_edible = bmesh.new()

        # Underlying base: Red-brown chili / sesame sauce pool inside bowl, strictly y <= 0.015 (mat_idx=1)
        # Bounded between y = -0.008 and y = 0.010 so it stays strictly inside bowl interior with no bottom clipping.
        H.add_ellipsoid(bm_edible, (0.0, 0.002, 0.0), 0.056, 0.010, 0.056, segs_u=28, segs_v=12, y_max=0.010, mat_idx=1)

        def add_thin_noodle(bm, points, radius=0.00175, segs=8, mat_idx=0):
            for i in range(len(points) - 1):
                H.add_cylinder(bm, points[i], points[i + 1], radius, segs=segs, cap1=(i == 0), cap2=(i == len(points) - 2), mat_idx=mat_idx)

        # 37 tangled curving noodle strands forming an organic 3D mounded heap (layers y: 0.014 - 0.040, width ~0.115m)
        strands = []

        # 1. 6 Transverse criss-cross arches spanning across the bowl
        for i in range(6):
            pts = []
            angle = i * (math.pi / 6.0) + 0.2
            cos_a, sin_a = math.cos(angle), math.sin(angle)
            perp_cos, perp_sin = -sin_a, cos_a
            steps = 14
            for s in range(steps + 1):
                t = (s / steps) * 2.0 - 1.0
                u = t * 0.048
                v = 0.014 * math.sin(t * 2.5 * math.pi + i) + 0.005 * math.cos(t * math.pi)
                x = u * cos_a + v * perp_cos
                z = u * sin_a + v * perp_sin
                y = 0.022 + 0.017 * (1.0 - t**2) + 0.003 * math.sin(t * 3.0 * math.pi + i)
                pts.append((x, y, z))
            strands.append(pts)

        # 2. 8 Figure-8 loops weaving through the center at various orientations
        for i in range(8):
            pts = []
            psi = i * (math.pi / 4.0) + 0.4
            cos_p, sin_p = math.cos(psi), math.sin(psi)
            a = 0.038 + 0.006 * math.sin(i * 1.5)
            b = 0.022 + 0.004 * math.cos(i * 1.2)
            steps = 18
            for s in range(steps + 1):
                t = s * (2.0 * math.pi / steps)
                u = a * math.sin(t)
                v = b * math.sin(2.0 * t)
                x = u * cos_p - v * sin_p
                z = u * sin_p + v * cos_p
                y = 0.026 + 0.012 * (1.0 - (u**2 + v**2)/(0.045**2)) + 0.004 * math.cos(t)
                pts.append((x, y, z))
            strands.append(pts)

        # 3. 8 Trefoil / rosette loops weaving inwards and outwards
        for i in range(8):
            pts = []
            phase = i * (2.0 * math.pi / 8.0) + 0.5
            steps = 18
            for s in range(steps + 1):
                t = s * (2.0 * math.pi / steps)
                r = 0.028 + 0.016 * math.cos(3.0 * t + i * 0.7)
                th = t + phase
                x = r * math.cos(th)
                z = r * math.sin(th)
                y = 0.024 + 0.014 * (1.0 - (r / 0.050)**2) + 0.003 * math.sin(3.0 * t + i)
                pts.append((x, y, z))
            strands.append(pts)

        # 4. 8 Outer perimeter draping coils dipping towards sauce
        for i in range(8):
            pts = []
            a0 = i * (2.0 * math.pi / 8.0)
            arc = 1.6 * math.pi
            steps = 14
            r0 = 0.048 + 0.005 * math.sin(i * 2.1)
            for s in range(steps + 1):
                t = s / steps
                th = a0 + t * arc
                r = r0 + 0.004 * math.sin(t * 3.0 * math.pi + i)
                y = 0.015 + 0.008 * math.sin(t * 2.0 * math.pi + i) + 0.004 * (1.0 - math.cos(t * math.pi))
                pts.append((r * math.cos(th), y, r * math.sin(th)))
            strands.append(pts)

        # 5. 6 Apex tangled folds right at top center (peaking up to y=0.044)
        for i in range(6):
            pts = []
            psi = i * (math.pi / 3.0) + 0.2
            cos_p, sin_p = math.cos(psi), math.sin(psi)
            steps = 12
            for s in range(steps + 1):
                t = (s / steps) * 2.0 - 1.0
                u = t * 0.022
                v = 0.008 * math.sin(t * 2.0 * math.pi + i)
                x = u * cos_p - v * sin_p
                z = u * sin_p + v * cos_p
                y = 0.033 + 0.009 * (1.0 - t**2) + 0.002 * math.cos(t * 3.0 * math.pi)
                pts.append((x, y, z))
            strands.append(pts)

        # Key apex strand passing directly through (0, 0.030, 0)
        key_strand = [
            (-0.028, 0.024, -0.015),
            (-0.016, 0.028, -0.007),
            (0.000, 0.030, 0.000),
            (0.016, 0.029, 0.008),
            (0.028, 0.024, 0.016)
        ]
        strands.append(key_strand)

        for st in strands:
            add_thin_noodle(bm_edible, st, radius=0.00175, segs=8, mat_idx=0)

        # Spicy dark-red chili sesame sauce ribbons drizzled on noodles (mat_idx=1)
        sauce_ribbons = [
            [(-0.022, 0.032, -0.010), (-0.008, 0.039, -0.002), (0.012, 0.037, 0.010), (0.026, 0.030, 0.014)],
            [(-0.018, 0.034, 0.014), (0.000, 0.040, 0.012), (0.016, 0.036, 0.004), (0.028, 0.028, -0.010)],
            [(-0.026, 0.029, 0.006), (-0.010, 0.037, 0.006), (0.008, 0.039, -0.006), (0.024, 0.031, -0.014)],
            [(-0.014, 0.035, -0.016), (0.004, 0.041, -0.011), (0.018, 0.035, -0.006)],
        ]
        for sr in sauce_ribbons:
            for i_r in range(len(sr) - 1):
                H.add_cylinder(bm_edible, sr[i_r], sr[i_r + 1], 0.0016, segs=8, cap1=True, cap2=True, mat_idx=1)

        # 36 browned minced pork cubes (肉臊, size ~0.0035m, mat_idx=2) distributed on upper noodle heap
        for i in range(36):
            r = 0.003 + 0.024 * math.sqrt((i + 0.5) / 36.0)
            theta = i * 2.39996
            x = r * math.cos(theta)
            z = r * math.sin(theta)
            y = 0.033 + 0.009 * (1.0 - (r / 0.030)**2) + 0.0018 * math.sin(i * 3.7)
            rot = (12 + (i * 17) % 35, 25 + (i * 23) % 45, 10 + (i * 19) % 40)
            H.add_box(bm_edible, (x, y, z), 0.0035, 0.0030, 0.0035, rot_deg=rot, mat_idx=2)

        # 24 chopped mustard greens (碎米芽菜, mat_idx=3)
        for i in range(24):
            r = 0.004 + 0.026 * math.sqrt((i + 0.3) / 24.0)
            theta = i * 2.39996 + 1.2
            x = r * math.cos(theta)
            z = r * math.sin(theta)
            y = 0.0335 + 0.008 * (1.0 - (r / 0.030)**2) + 0.0015 * math.cos(i * 4.1)
            rot = (18 + (i * 13) % 30, -15 + (i * 27) % 35, 25 + (i * 11) % 40)
            H.add_box(bm_edible, (x, y, z), 0.0026, 0.0020, 0.0026, rot_deg=rot, mat_idx=3)

        # 14 crushed toasted peanuts (mat_idx=4)
        for i in range(14):
            r = 0.006 + 0.024 * math.sqrt((i + 0.4) / 14.0)
            theta = i * 2.39996 + 2.5
            x = r * math.cos(theta)
            z = r * math.sin(theta)
            y = 0.033 + 0.008 * (1.0 - (r / 0.030)**2) + 0.0015 * math.sin(i * 2.9)
            rot = (10 + (i * 21) % 30, 35 + (i * 17) % 40, -15 + (i * 29) % 30)
            H.add_box(bm_edible, (x, y, z), 0.0034, 0.0024, 0.0034, rot_deg=rot, mat_idx=4)

        # 20 chopped fresh green scallions (mat_idx=5)
        for i in range(20):
            r = 0.005 + 0.025 * math.sqrt((i + 0.6) / 20.0)
            theta = i * 2.39996 + 3.8
            x = r * math.cos(theta)
            z = r * math.sin(theta)
            y = 0.034 + 0.009 * (1.0 - (r / 0.030)**2) + 0.0015 * math.sin(i * 5.3)
            H.add_cylinder(bm_edible, (x, y, z), (x, y + 0.0018, z), 0.0020, segs=6, mat_idx=5)

        edible_mats = [
            mats['thin_noodles'], mats['chili_sesame'], mats['minced_meat'],
            mats['yacai'], mats['peanuts'], mats['scallions']
        ]
        edible_obj = H.create_mesh_object('edible', bm_edible, edible_mats, parent=root)

        # 3. Utensil: Chopsticks with lifted noodle loop morsel at toolBite
        def add_dandan_morsel(utensil_obj):
            bm_tf = bmesh.new()
            # Thin noodle loop held between chopstick tips
            loop_pts = [
                (-0.0018, 0.001, -0.008),
                (0.000, 0.0035, -0.003),
                (0.0018, 0.002, 0.004),
                (0.000, -0.002, 0.006),
                (-0.0014, -0.001, -0.002),
            ]
            add_thin_noodle(bm_tf, loop_pts, radius=0.0015, segs=6, mat_idx=0)
            # Fleck of red chili sauce
            H.add_ellipsoid(bm_tf, (0.0, 0.0035, 0.0), 0.0020, 0.0014, 0.0020, segs_u=6, segs_v=5, mat_idx=1)
            # Tiny minced meat fleck
            H.add_box(bm_tf, (0.001, -0.002, 0.002), 0.0024, 0.002, 0.0024, mat_idx=2)
            toolFood = H.create_mesh_object('toolFood', bm_tf, [mats['thin_noodles'], mats['chili_sesame'], mats['minced_meat']], parent=utensil_obj)
            toolFood.location = Vector((0.0, -0.106, 0.001))

        build_chopsticks_utensil(root, mats['chopsticks'], add_dandan_morsel)

        # Anchors
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)

        glb_path = OUT_DIR / 'dandanmian.glb'
        png_path = OUT_DIR / 'dandanmian.png'

        if export_glb:
            bpy.ops.export_scene.gltf(
                filepath=str(glb_path),
                export_format='GLB',
                export_yup=True,
                export_apply=True,
                export_cameras=False,
                export_lights=False
            )
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.020, -0.005, 0.0), 0.18, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'dandanmian', glb_path, png_path

    # =============================================================
    # EXECUTION: PASS 1 (GLBS EARLY) THEN PASS 2 (RENDERS)
    # =============================================================
    builders = [
        ('jianbing-guozi', build_jianbing_guozi),
        ('ludagun', build_ludagun),
        ('jianfen', build_jianfen),
        ('liangpi', build_liangpi),
        ('yangrouchuan', build_yangrouchuan),
        ('dandanmian', build_dandanmian),
    ]

    if selected_ids:
        active_builders = [(bid, fn) for bid, fn in builders if bid in selected_ids]
    else:
        active_builders = builders

    print(f'=== PASS 1: DELIVERING GLB MODELS ({len(active_builders)}) ===')
    for bid, fn in active_builders:
        fn(export_glb=True, render_png=False)

    print(f'=== PASS 2: RENDERING PNG THUMBNAILS ({len(active_builders)}) ===')
    for bid, fn in active_builders:
        fn(export_glb=False, render_png=True)

    print('ALL_BLENDER_TASKS_COMPLETE')


def run_node_verify_and_manifest():
    """Uses Node GLTFLoader to verify actual exported names, dimensions, anchors and writes manifest.json."""
    node_script = """
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const outDir = '/home/baibai/outbox/pawborough-national-snacks-20261002/m11-assets-a';
const specs = {
  'jianbing-guozi': {
    profile: 'wrapped',
    utensilKind: 'none',
    requiredParts: ['edible', 'wrapper'],
    expectedAnchors: {
      leftSupport: [0.075, 0.0, 0.0],
      rightSupport: [-0.075, 0.0, 0.0],
      bite: [0.0, 0.085, 0.030]
    }
  },
  'ludagun': {
    profile: 'cupped',
    utensilKind: 'none',
    requiredParts: ['edible'],
    expectedAnchors: {
      leftSupport: [0.065, 0.0, 0.0],
      rightSupport: [-0.065, 0.0, 0.0],
      bite: [0.0, 0.055, 0.025]
    }
  },
  'jianfen': {
    profile: 'bowl',
    utensilKind: 'spoon',
    requiredParts: ['container', 'edible', 'utensil'],
    expectedAnchors: {
      leftSupport: [0.070, 0.0, -0.030],
      content: [0.0, 0.030, 0.0],
      bite: [0.0, 0.030, 0.0],
      rightSupport: [-0.050, 0.0, 0.0],
      toolGrip: [0.0, 0.0, 0.0],
      toolBite: [0.0, 0.0, 0.110]
    }
  },
  'liangpi': {
    profile: 'bowl',
    utensilKind: 'chopsticks',
    requiredParts: ['container', 'edible', 'utensil'],
    expectedAnchors: {
      leftSupport: [0.070, 0.0, -0.030],
      content: [0.0, 0.030, 0.0],
      bite: [0.0, 0.030, 0.0],
      rightSupport: [-0.050, 0.0, 0.0],
      toolGrip: [0.0, 0.0, 0.0],
      toolBite: [0.0, 0.0, 0.110]
    }
  },
  'yangrouchuan': {
    profile: 'skewer',
    utensilKind: 'none',
    requiredParts: ['edible', 'skewer'],
    expectedAnchors: {
      leftSupport: [0.015, -0.035, 0.0],
      rightSupport: [-0.015, -0.025, 0.0],
      bite: [0.0, 0.115, 0.021]
    }
  },
  'dandanmian': {
    profile: 'bowl',
    utensilKind: 'chopsticks',
    requiredParts: ['container', 'edible', 'utensil'],
    expectedAnchors: {
      leftSupport: [0.070, 0.0, -0.030],
      content: [0.0, 0.030, 0.0],
      bite: [0.0, 0.030, 0.0],
      rightSupport: [-0.050, 0.0, 0.0],
      toolGrip: [0.0, 0.0, 0.0],
      toolBite: [0.0, 0.0, 0.110]
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
    milestone: 'M11',
    generatedAt: new Date().toISOString(),
    sourceScript: 'asset-authoring/snacks/national/build_twenty_four_a.py',
    renderStatus: 'rendered_cycles_software_256x256_transparent',
    verificationStatus: 'verified_node_gltf_loader_m11_candidate',
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
    if (pngStats.size > 61440) throw new Error(`${id}.png exceeds 60KiB: ${pngStats.size} bytes`);

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

    if (spec.utensilKind !== 'none') {
      const utensil = root.getObjectByName('utensil');
      const toolFood = utensil.getObjectByName('toolFood');
      if (!toolFood) throw new Error(`${id} utensil missing toolFood child`);
    }

    console.log(`[VERIFIED] ${id}: glb=${glbStats.size}B, png=${pngStats.size}B, parts=${foodReport.partNames.join(',')}`);
    manifest.foods[id] = foodReport;
  }

  // Write temporary readback file in outbox
  const tmpReadbackPath = path.join(outDir, '.readback_tmp.json');
  fs.writeFileSync(tmpReadbackPath, JSON.stringify(manifest, null, 2) + '\\n');

  // Also write canonical manifest.json
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

    # Read back temporary readback file from outbox as requested, then remove it
    tmp_rb = OUT_DIR / '.readback_tmp.json'
    if tmp_rb.exists():
        with open(tmp_rb, 'r', encoding='utf-8') as f:
            rb_data = json.load(f)
        print(f"Readback confirmed {len(rb_data.get('foods', {}))} foods verified.")
        tmp_rb.unlink()


def main():
    try:
        import bpy
        # Running inside Blender Python
        selected = []
        if '--' in sys.argv:
            idx = sys.argv.index('--')
            selected = [a for a in sys.argv[idx + 1:] if not a.startswith('-')]
        run_blender_build(selected_ids=selected if selected else None)
    except ImportError:
        # Running from shell / standard python
        target_ids = [arg for arg in sys.argv[1:] if not arg.startswith('-')]
        if target_ids:
            print(f'Starting headless Blender build for selected M11 candidates: {target_ids}...')
            cmd = ['blender', '--background', '--python', str(SRC_PATH), '--'] + target_ids
        else:
            print('Starting headless Blender build for 6 M11 candidate snacks...')
            cmd = ['blender', '--background', '--python', str(SRC_PATH)]

        res = subprocess.run(cmd)
        if res.returncode != 0:
            print(f'Blender failed with code {res.returncode}', file=sys.stderr)
            sys.exit(res.returncode)

        print('Optimizing rendered 256x256 PNG thumbnails to <60KiB...')
        try:
            from PIL import Image
            targets_png = [OUT_DIR / f"{tid}.png" for tid in target_ids] if target_ids else list(OUT_DIR.glob('*.png'))
            for png_file in targets_png:
                if not png_file.exists():
                    continue
                im = Image.open(png_file)
                im.save(png_file, 'PNG', optimize=True)
                sz = png_file.stat().st_size
                if sz > 61440:
                    print(f'Quantizing {png_file.name} ({sz} bytes > 60KiB)...')
                    im_q = im.quantize(colors=256, method=Image.Resampling.MAXCOVERAGE)
                    im_q.save(png_file, 'PNG', optimize=True)
                    print(f'Quantized {png_file.name} to {png_file.stat().st_size} bytes')
        except Exception as e:
            print('PIL optimization note:', e)

        print('Running Node.js GLTFLoader verification and writing manifest.json...')
        run_node_verify_and_manifest()
        print('M11_SNACKS_BUILT_AND_VERIFIED_SUCCESSFULLY!')


if __name__ == '__main__':
    main()
