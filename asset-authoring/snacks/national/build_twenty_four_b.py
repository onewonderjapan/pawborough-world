# -*- coding: utf-8 -*-
"""Build six distinct final-wave candidate meals (wave B) for M11:
1. hongyou-chaoshou (bowl spoon)
2. choudoufu (bowl spoon)
3. hulatang (bowl spoon)
4. changfen (bowl chopsticks)
5. qingbuliang (bowl spoon)
6. fenglisu (cupped)

Outputs ONLY to:
/home/baibai/outbox/pawborough-national-snacks-20261002/m11-assets-b/{id}.glb
/home/baibai/outbox/pawborough-national-snacks-20261002/m11-assets-b/{id}.png
/home/baibai/outbox/pawborough-national-snacks-20261002/m11-assets-b/manifest.json

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

OUT_DIR = Path('/home/baibai/outbox/pawborough-national-snacks-20261002/m11-assets-b')
SRC_PATH = Path('asset-authoring/snacks/national/build_twenty_four_b.py')


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
    # 1. HONGYOU-CHAOSHOU (bowl spoon)
    # 4-5 ivory crumpled-fold wontons with pinched corners and slight meat bulge,
    # submerged bottom in transparent red chili oil. Red oil base under wontons, sesame/scallions.
    # Clearly dumplings, no generic white balls in milk.
    # =============================================================
    def build_hongyou_chaoshou(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'jade': H.make_mat('mat_jade', 'aecbbe', roughness=0.12, specular=0.8),
            'wonton': H.make_mat('mat_wonton', 'f5ecdb', roughness=0.48),                     # ivory wonton skin
            'meat': H.make_mat('mat_meat', '943f32', roughness=0.55),                         # pork filling hint
            'red_oil': H.make_mat('mat_red_oil', 'b01809', roughness=0.15, specular=0.9),    # glowing red chili oil
            'sesame': H.make_mat('mat_sesame', 'efe5d0', roughness=0.5),                      # toasted sesame seeds
            'scallion': H.make_mat('mat_scallion', '2d851e', roughness=0.35),                 # green scallions
        }

        root = bpy.data.objects.new('hongyou-chaoshou', None)
        bpy.context.collection.objects.link(root)

        # 1. Container: Jade ceramic bowl
        build_jade_bowl(root, mats['jade'])

        # 2. Edible
        bm_edible = bmesh.new()

        # Transparent red chili oil base pool (y ~ -0.012 to -0.004)
        H.add_ellipsoid(bm_edible, (0.0, -0.007, 0.0), 0.054, 0.006, 0.054, segs_u=20, segs_v=8, y_max=-0.004, mat_idx=3)

        # Helper to construct a crumpled wonton dumpling with pinched wings and meat bulge
        def add_wonton_dumpling(bm, center_glb, rot_y_deg=0.0, scale=1.0, is_apex=False):
            cx, cy, cz = center_glb
            ang = math.radians(rot_y_deg)
            cos_a = math.cos(ang)
            sin_a = math.sin(ang)

            def rot_local(lx, ly, lz):
                rx = lx * cos_a - lz * sin_a
                rz = lx * sin_a + lz * cos_a
                return (cx + rx * scale, cy + ly * scale, cz + rz * scale)

            # Central plump meat bulge covered by wrapper
            H.add_ellipsoid(bm, center_glb, 0.0135 * scale, 0.0095 * scale, 0.0125 * scale, segs_u=16, segs_v=12, mat_idx=1)
            # Slight reddish meat filling peek underneath wrapper bottom
            H.add_ellipsoid(bm, (cx, cy - 0.002 * scale, cz), 0.0085 * scale, 0.0055 * scale, 0.0085 * scale, segs_u=10, segs_v=8, mat_idx=2)

            # Pinched crossed wings / folded wrapper skirt
            # Authentic chaoshou: corners are brought together and crossed in front,
            # leaving flared ruffles behind and on sides.
            skirt_profile = [
                # Upper pinched flap (curling up and over the front)
                [(0.000, 0.008, 0.011), (0.007, 0.009, 0.014), (0.013, 0.007, 0.010), (0.006, 0.005, 0.006)],
                # Right folded wing (pinched around to front-left)
                [(0.011, 0.003, 0.004), (0.018, 0.005, 0.008), (0.021, 0.002, -0.002), (0.014, -0.001, -0.004)],
                # Left folded wing (pinched around across the right wing)
                [(-0.011, 0.003, 0.004), (-0.018, 0.005, 0.008), (-0.021, 0.002, -0.002), (-0.014, -0.001, -0.004)],
                # Rear ruffled skirt (flaring out and rippling into the soup)
                [(-0.012, 0.002, -0.008), (-0.015, 0.006, -0.017), (0.000, 0.008, -0.020), (0.015, 0.006, -0.017)],
                [(0.012, 0.002, -0.008), (0.015, -0.002, -0.016), (0.000, -0.001, -0.019), (-0.015, -0.002, -0.016)],
                # Additional crumpled folds atop the crest
                [(-0.006, 0.009, -0.002), (0.000, 0.012, 0.002), (0.008, 0.010, -0.002), (0.000, 0.008, -0.007)],
            ]

            for quad in skirt_profile:
                v_objs = []
                for lx, ly, lz in quad:
                    gp = rot_local(lx, ly, lz)
                    v_objs.append(bm.verts.new(H.glb_to_bl(gp)))
                bm.verts.ensure_lookup_table()
                try:
                    f = bm.faces.new(v_objs)
                    f.material_index = 1
                except ValueError:
                    pass

        # 5 distinct chaoshou dumplings: 4 in circle, 1 in center mounded higher
        wonton_specs = [
            ((-0.024, 0.012, -0.018), 35, 1.05, False),
            ((0.022, 0.011, -0.020), -40, 1.02, False),
            ((-0.022, 0.013, 0.020), 125, 1.04, False),
            ((0.024, 0.012, 0.018), -135, 1.03, False),
            # Apex dumpling: crest sits right at y = 0.030 (matching content/bite anchor!)
            ((0.000, 0.018, 0.000), 10, 1.08, True),
        ]

        for wsp in wonton_specs:
            add_wonton_dumpling(bm_edible, wsp[0], wsp[1], wsp[2], wsp[3])

        # Chili oil droplets glistening on top of wonton skins
        oil_drops = [
            (-0.006, 0.029, 0.004), (0.008, 0.028, -0.003), (-0.018, 0.022, -0.012),
            (0.016, 0.021, -0.014), (-0.015, 0.022, 0.014), (0.018, 0.022, 0.012),
            (0.000, 0.024, -0.010), (0.000, 0.023, 0.012),
        ]
        for od in oil_drops:
            H.add_ellipsoid(bm_edible, od, 0.0035, 0.0014, 0.0035, segs_u=8, segs_v=6, mat_idx=3)

        # White sesame seeds sprinkled over dumplings and oil
        sesame_pts = [
            (-0.004, 0.0305, 0.001), (0.005, 0.030, 0.003), (-0.008, 0.029, -0.005),
            (0.010, 0.028, -0.006), (-0.022, 0.023, -0.015), (0.020, 0.022, -0.017),
            (-0.019, 0.023, 0.016), (0.022, 0.022, 0.015), (-0.032, 0.004, 0.002),
            (0.031, 0.003, -0.004), (0.002, 0.003, -0.034), (0.003, 0.003, 0.033),
            (-0.012, 0.026, 0.008), (0.014, 0.025, 0.007),
        ]
        for sp in sesame_pts:
            H.add_ellipsoid(bm_edible, sp, 0.0014, 0.0008, 0.0020, segs_u=6, segs_v=5, mat_idx=4)

        # Chopped green scallion rings
        scallion_pts = [
            (-0.012, 0.029, -0.002), (0.010, 0.029, 0.006), (-0.002, 0.0315, 0.006),
            (-0.018, 0.022, -0.024), (0.025, 0.019, -0.012), (-0.024, 0.021, 0.010),
            (0.014, 0.022, 0.024), (0.002, 0.002, -0.028), (-0.028, 0.002, -0.008),
            (0.027, 0.002, 0.010),
        ]
        for sc in scallion_pts:
            H.add_cylinder(bm_edible, sc, (sc[0], sc[1] + 0.0022, sc[2]), 0.0022, segs=8, mat_idx=5)

        edible_mats = [mats['jade'], mats['wonton'], mats['meat'], mats['red_oil'], mats['sesame'], mats['scallion']]
        edible_obj = H.create_mesh_object('edible', bm_edible, edible_mats, parent=root)

        # 3. Utensil: Jade spoon with wonton morsel in red chili oil
        def add_chaoshou_morsel(utensil_obj):
            bm_tf = bmesh.new()
            # Mini wonton dumpling sitting in spoon bowl
            H.add_ellipsoid(bm_tf, (0.0, 0.0, 0.0), 0.0065, 0.0042, 0.0055, segs_u=12, segs_v=8, mat_idx=0)
            # Folded pinched wings
            v1 = bm_tf.verts.new(H.glb_to_bl((0.004, 0.003, 0.004)))
            v2 = bm_tf.verts.new(H.glb_to_bl((-0.004, 0.003, 0.004)))
            v3 = bm_tf.verts.new(H.glb_to_bl((-0.002, 0.001, -0.005)))
            v4 = bm_tf.verts.new(H.glb_to_bl((0.002, 0.001, -0.005)))
            try:
                f = bm_tf.faces.new([v1, v2, v3, v4])
                f.material_index = 0
            except ValueError:
                pass
            # Red chili oil sheen
            H.add_ellipsoid(bm_tf, (0.0, 0.0025, 0.0), 0.0045, 0.0015, 0.0045, segs_u=8, segs_v=6, mat_idx=1)
            # Scallion speck
            H.add_cylinder(bm_tf, (0.001, 0.004, 0.001), (0.001, 0.0055, 0.001), 0.0014, segs=6, mat_idx=2)
            toolFood = H.create_mesh_object('toolFood', bm_tf, [mats['wonton'], mats['red_oil'], mats['scallion']], parent=utensil_obj)
            toolFood.location = Vector((0.0, -0.098, 0.002))

        build_spoon_utensil(root, mats['jade'], add_chaoshou_morsel)

        # Anchors: leftSupport, content, bite, rightSupport
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)

        glb_path = OUT_DIR / 'hongyou-chaoshou.glb'
        png_path = OUT_DIR / 'hongyou-chaoshou.png'

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

        return 'hongyou-chaoshou', glb_path, png_path

    # =============================================================
    # 2. CHOUDAOFU (bowl spoon)
    # 4 darkgold/charcoalbrown crispy tofu cubes .022edge, beveled irregular edges
    # and cracks showing pale beancurd, savory brown sauce pool/red chili flakes/green herbs.
    # Distinct hard cube silhouettes, source burn char variation sparse. Don't add stink visual gas.
    # =============================================================
    def build_choudoufu(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'jade': H.make_mat('mat_jade', 'aecbbe', roughness=0.12, specular=0.8),
            'tofu_crust': H.make_mat('mat_tofu_crust', '2b241e', roughness=0.75),             # dark charcoal/brown crispy crust
            'tofu_inner': H.make_mat('mat_tofu_inner', 'f4e8cf', roughness=0.42),             # pale tender beancurd inside
            'sauce': H.make_mat('mat_sauce', '3e1b0c', roughness=0.20, specular=0.8),        # savory brown garlic-soy sauce
            'chili': H.make_mat('mat_chili', 'ba1a0a', roughness=0.30),                       # bright red chili flakes
            'herbs': H.make_mat('mat_herbs', '2d851e', roughness=0.35),                       # chopped green herbs
        }

        root = bpy.data.objects.new('choudoufu', None)
        bpy.context.collection.objects.link(root)

        # 1. Container: Jade ceramic bowl
        build_jade_bowl(root, mats['jade'])

        # 2. Edible: 4 crispy tofu cubes with .022m edge, beveled cracks showing pale beancurd
        bm_edible = bmesh.new()

        # Savory brown sauce pool at bottom
        H.add_ellipsoid(bm_edible, (0.0, -0.008, 0.0), 0.052, 0.006, 0.052, segs_u=18, segs_v=8, y_max=-0.005, mat_idx=3)

        def add_crispy_tofu_cube(bm, center_glb, rot_deg=(0, 0, 0)):
            cx, cy, cz = center_glb
            edge = 0.022
            half = edge / 2.0
            rx, ry, rz = [math.radians(a) for a in rot_deg]
            Rx = Matrix.Rotation(rx, 3, 'X')
            Ry = Matrix.Rotation(ry, 3, 'Y')
            Rz = Matrix.Rotation(rz, 3, 'Z')
            R = Rz @ Ry @ Rx

            # Base main crust cube (.022 edge)
            H.add_box(bm, center_glb, edge, edge, edge, rot_deg=rot_deg, mat_idx=1)

            # Center puncture cavity on top face showing pale beancurd (and sauce filling)
            # Local top center offset: (0, half, 0)
            p_top_local = Vector((0.0, half, 0.0))
            p_top_glb = R @ p_top_local + Vector((cx, cy, cz))

            # Pale tender interior cavity exposed in center
            H.add_box(bm, (p_top_glb.x, p_top_glb.y - 0.0015, p_top_glb.z), 0.009, 0.004, 0.009, rot_deg=rot_deg, mat_idx=2)
            # Savory sauce pooled in cavity
            H.add_box(bm, (p_top_glb.x, p_top_glb.y - 0.0005, p_top_glb.z), 0.0075, 0.002, 0.0075, rot_deg=rot_deg, mat_idx=3)

            # Corner crack/bevel exposing pale beancurd on corner edge
            p_corner_local = Vector((half * 0.75, half * 0.85, half * 0.75))
            p_corner_glb = R @ p_corner_local + Vector((cx, cy, cz))
            H.add_box(bm, (p_corner_glb.x, p_corner_glb.y, p_corner_glb.z), 0.0045, 0.0035, 0.0045, rot_deg=rot_deg, mat_idx=2)

        # 4 tofu cubes: 3 on lower base, 1 stacked on top with apex reaching y = 0.030
        cube_specs = [
            # Cube 1 (rear-left)
            ((-0.020, 0.004, -0.016), (4, 18, -6)),
            # Cube 2 (rear-right)
            ((0.020, 0.003, -0.018), (-6, -22, 4)),
            # Cube 3 (front)
            ((0.000, 0.004, 0.022), (5, 5, -3)),
            # Cube 4 (stacked apex cube: center y=0.019, top edge at y=0.030 matching content/bite!)
            ((0.000, 0.019, 0.000), (-4, 12, 5)),
        ]

        for cs in cube_specs:
            add_crispy_tofu_cube(bm_edible, cs[0], cs[1])

        # Red chili flakes sprinkled on tofu and sauce
        chili_pts = [
            (0.001, 0.0315, 0.002), (-0.003, 0.031, -0.003), (0.004, 0.0305, -0.002),
            (-0.021, 0.016, -0.015), (0.022, 0.015, -0.016), (0.002, 0.016, 0.022),
            (-0.012, 0.003, 0.010), (0.015, 0.003, -0.005), (-0.028, -0.003, 0.005),
            (0.025, -0.003, 0.012),
        ]
        for cp in chili_pts:
            H.add_box(bm_edible, cp, 0.0032, 0.0012, 0.0032, rot_deg=(12, 35, 18), mat_idx=4)

        # Chopped green herbs (cilantro / scallion)
        herb_pts = [
            (-0.002, 0.032, 0.004), (0.003, 0.0315, 0.005), (-0.005, 0.031, -0.001),
            (-0.018, 0.017, -0.012), (0.018, 0.016, -0.014), (0.000, 0.017, 0.020),
            (-0.008, 0.018, 0.012), (0.012, 0.018, -0.004), (-0.022, 0.004, -0.008),
            (0.020, 0.004, 0.018),
        ]
        for hp in herb_pts:
            H.add_cylinder(bm_edible, hp, (hp[0], hp[1] + 0.0018, hp[2]), 0.0022, segs=8, mat_idx=5)

        edible_mats = [mats['jade'], mats['tofu_crust'], mats['tofu_inner'], mats['sauce'], mats['chili'], mats['herbs']]
        edible_obj = H.create_mesh_object('edible', bm_edible, edible_mats, parent=root)

        # 3. Utensil: Jade spoon with crispy tofu morsel with chili and sauce
        def add_choudoufu_morsel(utensil_obj):
            bm_tf = bmesh.new()
            # 8mm crispy tofu cube morsel
            H.add_box(bm_tf, (0.0, 0.0, 0.0), 0.008, 0.007, 0.008, rot_deg=(4, 15, 0), mat_idx=0)
            # Pale interior peek
            H.add_box(bm_tf, (0.0, 0.0036, 0.0), 0.0045, 0.0015, 0.0045, mat_idx=1)
            # Sauce drop
            H.add_ellipsoid(bm_tf, (0.0, 0.004, 0.0), 0.0035, 0.0012, 0.0035, segs_u=8, segs_v=6, mat_idx=2)
            # Chili flake
            H.add_box(bm_tf, (0.001, 0.005, 0.001), 0.002, 0.001, 0.002, rot_deg=(10, 20, 0), mat_idx=3)
            toolFood = H.create_mesh_object('toolFood', bm_tf, [mats['tofu_crust'], mats['tofu_inner'], mats['sauce'], mats['chili']], parent=utensil_obj)
            toolFood.location = Vector((0.0, -0.098, 0.002))

        build_spoon_utensil(root, mats['jade'], add_choudoufu_morsel)

        # Anchors: leftSupport, content, bite, rightSupport
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)

        glb_path = OUT_DIR / 'choudoufu.glb'
        png_path = OUT_DIR / 'choudoufu.png'

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

        return 'choudoufu', glb_path, png_path

    # =============================================================
    # 3. HULATANG (bowl spoon)
    # Deep amber/darkbrown soup with visible beef strips, pale gluten chunks
    # and mushroom slivers/greens, glistening surface under ingredients;
    # warm peppery broth look. Distinct soup, not flat brown pudding or noodle heap.
    # =============================================================
    def build_hulatang(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'jade': H.make_mat('mat_jade', 'aecbbe', roughness=0.12, specular=0.8),
            'broth': H.make_mat('mat_broth', '3d1d0c', roughness=0.14, specular=0.88),        # deep amber dark peppery soup broth
            'beef': H.make_mat('mat_beef', '58281a', roughness=0.55),                         # braised beef strips
            'gluten': H.make_mat('mat_gluten', 'e0d3b6', roughness=0.62),                     # pale spongy wheat gluten / mianjin
            'mushroom': H.make_mat('mat_mushroom', '1c1511', roughness=0.38, specular=0.7),  # dark wood-ear mushroom slivers
            'greens': H.make_mat('mat_greens', '2e821e', roughness=0.35),                     # green herbs / scallions
            'pepper_oil': H.make_mat('mat_pepper_oil', '9c1808', roughness=0.14, specular=0.9), # red peppery oil swirl
        }

        root = bpy.data.objects.new('hulatang', None)
        bpy.context.collection.objects.link(root)

        # 1. Container: Jade ceramic bowl
        build_jade_bowl(root, mats['jade'])

        # 2. Edible
        bm_edible = bmesh.new()

        # Rich curved broth surface filling lower bowl (y from -0.015 to 0.008)
        H.add_ellipsoid(bm_edible, (0.0, -0.004, 0.0), 0.062, 0.014, 0.062, segs_u=24, segs_v=10, y_max=0.008, mat_idx=1)

        # Red peppery oil swirl droplets glistening on broth surface
        oil_swirls = [
            (-0.025, 0.009, -0.015), (0.022, 0.009, -0.018), (-0.018, 0.009, 0.024),
            (0.026, 0.009, 0.015), (0.000, 0.009, -0.032), (0.034, 0.008, -0.005),
            (-0.035, 0.008, 0.008), (0.012, 0.010, 0.006),
        ]
        for ox, oy, oz in oil_swirls:
            H.add_ellipsoid(bm_edible, (ox, oy, oz), 0.007, 0.0012, 0.007, segs_u=8, segs_v=6, mat_idx=6)

        # Visible beef strips protruding from and floating in broth
        # Long, thin, slightly curved braised beef slivers
        beef_strips = [
            # strip 1: length ~0.028m
            [(-0.025, 0.010, -0.005), (-0.012, 0.018, -0.002), (0.002, 0.022, 0.002), (0.015, 0.016, 0.005)],
            # strip 2: crossing near center, crest reaching y = 0.030 (apex bite/content anchor!)
            [(-0.015, 0.018, 0.018), (-0.005, 0.026, 0.008), (0.000, 0.030, 0.000), (0.010, 0.024, -0.010)],
            # strip 3: rear curve
            [(-0.020, 0.012, -0.022), (-0.008, 0.019, -0.018), (0.008, 0.020, -0.016), (0.022, 0.011, -0.015)],
            # strip 4: right side
            [(0.014, 0.012, 0.020), (0.024, 0.017, 0.008), (0.028, 0.016, -0.006)],
            # strip 5: left front
            [(-0.032, 0.009, 0.010), (-0.022, 0.016, 0.016), (-0.010, 0.018, 0.022)],
        ]
        for strip in beef_strips:
            for i in range(len(strip) - 1):
                p1 = strip[i]
                p2 = strip[i + 1]
                H.add_cylinder(bm_edible, p1, p2, 0.0024, segs=8, cap1=True, cap2=True, mat_idx=2)

        # Pale spongy wheat gluten chunks (mianjin)
        gluten_chunks = [
            ((-0.010, 0.024, -0.014), 0.0065, 0.005, 0.006),
            ((0.012, 0.025, 0.014), 0.007, 0.0055, 0.0065),
            ((-0.022, 0.016, 0.006), 0.006, 0.0048, 0.0055),
            ((0.020, 0.018, -0.008), 0.0065, 0.005, 0.006),
            ((-0.002, 0.028, 0.010), 0.0055, 0.0045, 0.0055),
            ((0.005, 0.027, -0.008), 0.006, 0.005, 0.006),
            ((-0.030, 0.011, -0.012), 0.0055, 0.004, 0.005),
            ((0.032, 0.010, 0.012), 0.0055, 0.004, 0.005),
            ((0.000, 0.011, -0.026), 0.006, 0.0045, 0.0055),
            ((0.000, 0.011, 0.028), 0.006, 0.0045, 0.0055),
        ]
        for gc, rx, ry, rz in gluten_chunks:
            H.add_ellipsoid(bm_edible, gc, rx, ry, rz, segs_u=10, segs_v=8, mat_idx=3)

        # Dark wood-ear mushroom slivers
        mushroom_strips = [
            [(-0.018, 0.020, -0.008), (-0.010, 0.025, 0.004), (-0.004, 0.024, 0.014)],
            [(0.004, 0.024, -0.014), (0.014, 0.022, -0.004), (0.018, 0.018, 0.008)],
            [(-0.026, 0.013, -0.018), (-0.016, 0.016, -0.026)],
            [(0.024, 0.013, 0.018), (0.016, 0.016, 0.026)],
            [(-0.008, 0.022, 0.020), (0.002, 0.021, 0.024)],
        ]
        for ms in mushroom_strips:
            for i in range(len(ms) - 1):
                H.add_cylinder(bm_edible, ms[i], ms[i + 1], 0.0016, segs=6, cap1=True, cap2=True, mat_idx=4)

        # Green herbs (chopped cilantro and scallions)
        herb_pts = [
            (0.000, 0.0315, 0.002), (-0.006, 0.029, -0.004), (0.008, 0.028, 0.006),
            (-0.016, 0.022, -0.010), (0.018, 0.021, -0.006), (-0.014, 0.022, 0.016),
            (0.015, 0.021, 0.018), (-0.028, 0.012, 0.002), (0.026, 0.012, -0.004),
            (0.002, 0.012, -0.028),
        ]
        for hp in herb_pts:
            H.add_cylinder(bm_edible, hp, (hp[0], hp[1] + 0.0018, hp[2]), 0.0018, segs=8, mat_idx=5)

        edible_mats = [mats['jade'], mats['broth'], mats['beef'], mats['gluten'], mats['mushroom'], mats['greens'], mats['pepper_oil']]
        edible_obj = H.create_mesh_object('edible', bm_edible, edible_mats, parent=root)

        # 3. Utensil: Jade spoon with spoonful of hulatang (broth, beef strip, gluten, greens)
        def add_hulatang_morsel(utensil_obj):
            bm_tf = bmesh.new()
            # Glistening peppery broth pool in spoon
            H.add_ellipsoid(bm_tf, (0.0, 0.002, 0.0), 0.006, 0.0022, 0.008, segs_u=10, segs_v=6, mat_idx=0)
            # Mini beef strip
            H.add_cylinder(bm_tf, (-0.003, 0.003, -0.004), (0.003, 0.0035, 0.004), 0.0015, segs=6, mat_idx=1)
            # Spongy gluten chunk
            H.add_ellipsoid(bm_tf, (0.001, 0.004, -0.001), 0.0025, 0.002, 0.0025, segs_u=8, segs_v=6, mat_idx=2)
            # Dark mushroom sliver
            H.add_cylinder(bm_tf, (-0.002, 0.0032, 0.002), (0.001, 0.0035, 0.005), 0.0010, segs=6, mat_idx=3)
            # Green scallion speck
            H.add_cylinder(bm_tf, (0.0, 0.0045, 0.001), (0.0, 0.0055, 0.001), 0.0012, segs=6, mat_idx=4)
            toolFood = H.create_mesh_object('toolFood', bm_tf, [mats['broth'], mats['beef'], mats['gluten'], mats['mushroom'], mats['greens']], parent=utensil_obj)
            toolFood.location = Vector((0.0, -0.098, 0.002))

        build_spoon_utensil(root, mats['jade'], add_hulatang_morsel)

        # Anchors: leftSupport, content, bite, rightSupport
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)

        glb_path = OUT_DIR / 'hulatang.glb'
        png_path = OUT_DIR / 'hulatang.png'

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

        return 'hulatang', glb_path, png_path

    # =============================================================
    # 4. CHANGFEN (bowl chopsticks)
    # 3-4 wide white folded/rolled rice paper tubes length .10m,
    # visible paper layers/slightly translucent edges, pink shrimp or light brown filling peek at ends,
    # brown sweet soy ribbon on arranged rolls. Whole meal fits bowl radius .075.
    # Actual chopstick rice-noodle morsel visible. No round spaghetti.
    # Uses pair chopsticks instead of spoon, blunt parallel rods x±.003, length .11.
    # =============================================================
    def build_changfen(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'jade': H.make_mat('mat_jade', 'aecbbe', roughness=0.12, specular=0.8),
            'rice_paper': H.make_mat('mat_rice_paper', 'f6f4ee', roughness=0.32, specular=0.75), # translucent steamed white rice paper sheet
            'shrimp': H.make_mat('mat_shrimp', 'ea7c6e', roughness=0.45),                         # succulent pink shrimp filling
            'sweet_soy': H.make_mat('mat_sweet_soy', '2e1408', roughness=0.18, specular=0.85),   # glistening sweet dark soy sauce drizzle
            'scallion': H.make_mat('mat_scallion', '2d851e', roughness=0.35),                     # chopped green scallions
            'chopsticks': H.make_mat('mat_chopsticks', '6b3e1d', roughness=0.35),                 # dark hardwood chopsticks
        }

        root = bpy.data.objects.new('changfen', None)
        bpy.context.collection.objects.link(root)

        # 1. Container: Jade ceramic bowl
        build_jade_bowl(root, mats['jade'])

        # 2. Edible: 3 wide folded/rolled rice paper tubes length .10m nestled in bowl
        bm_edible = bmesh.new()

        # Sweet soy sauce pool in bottom of bowl
        H.add_ellipsoid(bm_edible, (0.0, -0.012, 0.0), 0.052, 0.005, 0.052, segs_u=18, segs_v=8, y_max=-0.008, mat_idx=3)

        # Helper to construct a rolled wide rice paper tube of length ~0.10m
        # Cross section is an oval/flattened roll with multiple folded sheet layers
        def add_rice_paper_roll(bm, center_glb, rx_roll=0.016, ry_roll=0.010, length=0.100, rot_y_deg=0.0):
            cx, cy, cz = center_glb
            half_len = length / 2.0
            ang = math.radians(rot_y_deg)
            cos_a = math.cos(ang)
            sin_a = math.sin(ang)

            segs_ring = 20
            segs_len = 16

            # Construct concentric spiral layers of thin rice sheet
            # Outer layer + inner overlapping fold flap
            z_steps = [-half_len + (length * iz / segs_len) for iz in range(segs_len + 1)]

            rings = []
            for cur_z in z_steps:
                # Slight wave/wrinkle along roll length
                wobble = 0.0012 * math.sin(cur_z * 70.0)
                ring_verts = []
                for ir in range(segs_ring):
                    th = 2.0 * math.pi * ir / segs_ring
                    # Flattened tube profile
                    lx = (rx_roll + wobble) * math.cos(th)
                    ly = (ry_roll + wobble * 0.5) * math.sin(th)
                    # Rotate in Y
                    gx = cx + lx * cos_a - cur_z * sin_a
                    gy = cy + ly
                    gz = cz + lx * sin_a + cur_z * cos_a
                    ring_verts.append(bm.verts.new(H.glb_to_bl((gx, gy, gz))))
                rings.append(ring_verts)

            bm.verts.ensure_lookup_table()
            for iz in range(segs_len):
                r1 = rings[iz]
                r2 = rings[iz + 1]
                for ir in range(segs_ring):
                    inxt = (ir + 1) % segs_ring
                    try:
                        f = bm.faces.new([r1[ir], r1[inxt], r2[inxt], r2[ir]])
                        f.material_index = 1
                    except ValueError:
                        pass

            # Open ends: Caps with inner fold line and peeking shrimp filling
            for is_front, z_cap in ((True, half_len), (False, -half_len)):
                cap_ring = rings[-1] if is_front else rings[0]
                # Center vert for end face
                lx_cen = 0.0
                ly_cen = 0.0
                gx_c = cx + lx_cen * cos_a - z_cap * sin_a
                gy_c = cy + ly_cen
                gz_c = cz + lx_cen * sin_a + z_cap * cos_a
                vc = bm.verts.new(H.glb_to_bl((gx_c, gy_c, gz_c)))

                for ir in range(segs_ring):
                    inxt = (ir + 1) % segs_ring
                    try:
                        if is_front:
                            f = bm.faces.new([vc, cap_ring[ir], cap_ring[inxt]])
                        else:
                            f = bm.faces.new([vc, cap_ring[inxt], cap_ring[ir]])
                        f.material_index = 1
                    except ValueError:
                        pass

                # Pink shrimp filling peeking at open end
                shrimp_x = cx - z_cap * sin_a
                shrimp_y = cy
                shrimp_z = cz + z_cap * cos_a
                H.add_ellipsoid(bm, (shrimp_x, shrimp_y, shrimp_z), 0.007, 0.0055, 0.007, segs_u=8, segs_v=6, mat_idx=2)

        # 3 wide rolls arranged in bowl:
        # Roll 1 (left): X = -0.024, length .10m
        # Roll 2 (right): X = +0.024, length .10m
        # Roll 3 (top center): X = 0.0, elevated with crest reaching y = 0.030 (matching content/bite anchor!)
        add_rice_paper_roll(bm_edible, (-0.024, 0.004, 0.0), rx_roll=0.015, ry_roll=0.009, length=0.100, rot_y_deg=3)
        add_rice_paper_roll(bm_edible, (0.024, 0.003, 0.0), rx_roll=0.015, ry_roll=0.009, length=0.100, rot_y_deg=-3)
        add_rice_paper_roll(bm_edible, (0.000, 0.019, 0.0), rx_roll=0.016, ry_roll=0.011, length=0.100, rot_y_deg=0)

        # Sweet soy sauce ribbon drizzled over top roll and between rolls
        soy_ribbon_pts = [
            (0.000, 0.0305, -0.040), (0.004, 0.0308, -0.025), (-0.003, 0.0305, -0.010),
            (0.002, 0.0305, 0.005), (-0.004, 0.0302, 0.020), (0.001, 0.0300, 0.038),
            # Drips down sides
            (-0.016, 0.018, -0.015), (0.016, 0.018, 0.012), (-0.015, 0.017, 0.022),
        ]
        for sp in soy_ribbon_pts:
            H.add_ellipsoid(bm_edible, sp, 0.0045, 0.0014, 0.0075, segs_u=8, segs_v=6, mat_idx=3)

        # Chopped scallions scattered along soy sauce ribbon
        scallion_pts = [
            (0.002, 0.0315, -0.030), (-0.003, 0.0318, -0.015), (0.003, 0.0315, 0.000),
            (-0.002, 0.0315, 0.015), (0.002, 0.0310, 0.030), (-0.018, 0.018, -0.005),
            (0.018, 0.018, 0.018), (-0.022, 0.015, 0.032), (0.022, 0.015, -0.028),
        ]
        for sc in scallion_pts:
            H.add_cylinder(bm_edible, sc, (sc[0], sc[1] + 0.002, sc[2]), 0.0022, segs=8, mat_idx=4)

        edible_mats = [mats['jade'], mats['rice_paper'], mats['shrimp'], mats['sweet_soy'], mats['scallion']]
        edible_obj = H.create_mesh_object('edible', bm_edible, edible_mats, parent=root)

        # 3. Utensil: Chopsticks with lifted rice-paper morsel (with shrimp and soy) at toolBite
        def add_changfen_morsel(utensil_obj):
            bm_tf = bmesh.new()
            # Folded translucent rice paper tube morsel held between chopstick tips
            # Dimensions ~ 0.014m length, 0.006m wide
            H.add_ellipsoid(bm_tf, (0.0, 0.0, 0.0), 0.0045, 0.0025, 0.0075, segs_u=12, segs_v=8, mat_idx=0)
            # Pink shrimp filling peek inside fold
            H.add_ellipsoid(bm_tf, (0.0, 0.0, 0.005), 0.003, 0.002, 0.003, segs_u=8, segs_v=6, mat_idx=1)
            # Sweet soy sauce glaze drop
            H.add_ellipsoid(bm_tf, (0.0, 0.0028, 0.0), 0.0035, 0.0012, 0.0045, segs_u=8, segs_v=6, mat_idx=2)
            # Scallion speck
            H.add_cylinder(bm_tf, (0.001, 0.0038, 0.001), (0.001, 0.0052, 0.001), 0.0012, segs=6, mat_idx=3)
            toolFood = H.create_mesh_object('toolFood', bm_tf, [mats['rice_paper'], mats['shrimp'], mats['sweet_soy'], mats['scallion']], parent=utensil_obj)
            toolFood.location = Vector((0.0, -0.106, 0.001))

        build_chopsticks_utensil(root, mats['chopsticks'], add_changfen_morsel)

        # Anchors: leftSupport, content, bite, rightSupport
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)

        glb_path = OUT_DIR / 'changfen.glb'
        png_path = OUT_DIR / 'changfen.png'

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

        return 'changfen', glb_path, png_path

    # =============================================================
    # 5. QINGBULIANG (bowl spoon)
    # Coconut milk base with small white/tapioca pearls .003radius,
    # red adzuki beans .006length, amber jelly cubes .012edge,
    # mango and watermelon pink chunks; colorful cool dessert,
    # ingredients visibly floating above milk surface. Distinct from plain shuangpinai.
    # Food morsel includes pearl/jelly.
    # =============================================================
    def build_qingbuliang(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'jade': H.make_mat('mat_jade', 'aecbbe', roughness=0.12, specular=0.8),
            'coconut_milk': H.make_mat('mat_coconut_milk', 'faf8f5', roughness=0.22, specular=0.75), # creamy white coconut milk
            'pearl': H.make_mat('mat_pearl', 'ebe7dd', roughness=0.18, specular=0.88),               # tapioca pearls (.003 rad)
            'adzuki': H.make_mat('mat_adzuki', '4d151c', roughness=0.38, specular=0.55),             # red adzuki beans (.006 len)
            'amber_jelly': H.make_mat('mat_amber_jelly', 'c98028', roughness=0.18, specular=0.85),   # amber jelly cubes (.012 edge)
            'mango': H.make_mat('mat_mango', 'f7a81b', roughness=0.35),                               # yellow mango chunks
            'watermelon': H.make_mat('mat_watermelon', 'e23c4a', roughness=0.32),                     # vibrant pink watermelon chunks
        }

        root = bpy.data.objects.new('qingbuliang', None)
        bpy.context.collection.objects.link(root)

        # 1. Container: Jade ceramic bowl
        build_jade_bowl(root, mats['jade'])

        # 2. Edible
        bm_edible = bmesh.new()

        # Coconut milk base pool filling bowl up to y = 0.005
        H.add_ellipsoid(bm_edible, (0.0, -0.005, 0.0), 0.060, 0.013, 0.060, segs_u=24, segs_v=10, y_max=0.005, mat_idx=1)

        # Ingredients visibly floating above milk surface:
        # A. Amber jelly cubes (.012 edge)
        jelly_specs = [
            ((-0.024, 0.014, -0.015), 0.012, (5, 20, -8)),
            ((0.020, 0.013, -0.018), 0.012, (-8, -15, 6)),
            ((-0.015, 0.014, 0.020), 0.012, (-6, 25, -5)),
            ((0.022, 0.014, 0.016), 0.012, (10, -18, 8)),
            # Apex jelly cube centered near top reaching y = 0.030 (matching content/bite anchor!)
            ((0.000, 0.024, 0.000), 0.012, (4, 12, -4)),
        ]
        for jc, sz, rot in jelly_specs:
            H.add_box(bm_edible, jc, sz, sz, sz, rot_deg=rot, mat_idx=4)

        # B. Mango yellow chunks (.012 to .014m chunks)
        mango_specs = [
            ((-0.010, 0.024, -0.014), (0.014, 0.011, 0.013), (12, 10, -5)),
            ((0.014, 0.023, 0.012), (0.013, 0.010, 0.013), (-8, -25, 10)),
            ((-0.032, 0.011, 0.005), (0.013, 0.010, 0.012), (15, 5, -12)),
            ((0.030, 0.010, -0.008), (0.014, 0.010, 0.012), (-10, -30, 8)),
        ]
        for mc, msz, rot in mango_specs:
            H.add_box(bm_edible, mc, msz[0], msz[1], msz[2], rot_deg=rot, mat_idx=5)

        # C. Watermelon vibrant pink chunks (.012 to .014m chunks)
        watermelon_specs = [
            ((0.012, 0.024, -0.012), (0.013, 0.011, 0.013), (-6, 18, 6)),
            ((-0.014, 0.023, 0.014), (0.014, 0.010, 0.013), (10, -15, -8)),
            ((0.002, 0.012, 0.032), (0.013, 0.010, 0.012), (-5, 12, -6)),
            ((-0.004, 0.011, -0.032), (0.014, 0.010, 0.012), (8, -20, 10)),
        ]
        for wc, wsz, rot in watermelon_specs:
            H.add_box(bm_edible, wc, wsz[0], wsz[1], wsz[2], rot_deg=rot, mat_idx=6)

        # D. Small white/tapioca pearls (.003 radius) clustered
        pearl_coords = [
            (-0.002, 0.0315, 0.002), (0.004, 0.031, -0.003), (-0.005, 0.0305, 0.005),
            (-0.018, 0.022, -0.005), (-0.014, 0.021, -0.008), (-0.018, 0.021, 0.002),
            (0.016, 0.022, -0.002), (0.019, 0.021, -0.006), (0.015, 0.021, 0.004),
            (-0.005, 0.022, 0.022), (0.002, 0.022, 0.024), (-0.002, 0.021, 0.026),
            (0.006, 0.022, -0.022), (-0.002, 0.021, -0.024), (0.002, 0.021, -0.026),
            (-0.026, 0.010, -0.024), (0.028, 0.010, -0.022), (-0.024, 0.010, 0.026),
            (0.026, 0.010, 0.024), (-0.038, 0.007, -0.002), (0.038, 0.007, 0.002),
        ]
        for pc in pearl_coords:
            H.add_ellipsoid(bm_edible, pc, 0.003, 0.003, 0.003, segs_u=8, segs_v=6, mat_idx=2)

        # E. Red adzuki beans (.006 length) scattered naturally
        adzuki_coords = [
            ((-0.008, 0.029, -0.006), (15, 20, 0)),
            ((0.008, 0.029, 0.006), (-20, 10, 0)),
            ((-0.022, 0.019, -0.020), (0, 35, 10)),
            ((0.024, 0.018, -0.014), (10, -25, 0)),
            ((-0.018, 0.019, 0.022), (-15, 15, 0)),
            ((0.020, 0.018, 0.024), (20, -10, 0)),
            ((-0.008, 0.011, 0.035), (0, 45, 0)),
            ((0.008, 0.011, -0.035), (0, -45, 0)),
            ((-0.036, 0.008, 0.014), (25, 0, 0)),
            ((0.036, 0.008, -0.014), (-25, 0, 0)),
        ]
        for ac, arot in adzuki_coords:
            # Ellipsoid length 0.006m, radius 0.0025m
            H.add_ellipsoid(bm_edible, ac, 0.0025, 0.0024, 0.0030, segs_u=8, segs_v=6, mat_idx=3)

        edible_mats = [
            mats['jade'], mats['coconut_milk'], mats['pearl'], mats['adzuki'],
            mats['amber_jelly'], mats['mango'], mats['watermelon']
        ]
        edible_obj = H.create_mesh_object('edible', bm_edible, edible_mats, parent=root)

        # 3. Utensil: Jade spoon with spoonful of dessert (milk, amber jelly, tapioca pearl, adzuki bean)
        def add_qingbuliang_morsel(utensil_obj):
            bm_tf = bmesh.new()
            # Coconut milk in spoon cup
            H.add_ellipsoid(bm_tf, (0.0, 0.002, 0.0), 0.0065, 0.002, 0.008, segs_u=10, segs_v=6, mat_idx=0)
            # 6mm amber jelly cube
            H.add_box(bm_tf, (-0.001, 0.004, -0.001), 0.0055, 0.0045, 0.0055, rot_deg=(5, 15, 0), mat_idx=1)
            # Tapioca pearl (.003 rad)
            H.add_ellipsoid(bm_tf, (0.0025, 0.004, 0.003), 0.0022, 0.0022, 0.0022, segs_u=6, segs_v=6, mat_idx=2)
            # Red adzuki bean (.006 len)
            H.add_ellipsoid(bm_tf, (-0.0025, 0.0035, 0.003), 0.0018, 0.0016, 0.0026, segs_u=6, segs_v=6, mat_idx=3)
            toolFood = H.create_mesh_object('toolFood', bm_tf, [mats['coconut_milk'], mats['amber_jelly'], mats['pearl'], mats['adzuki']], parent=utensil_obj)
            toolFood.location = Vector((0.0, -0.098, 0.002))

        build_spoon_utensil(root, mats['jade'], add_qingbuliang_morsel)

        # Anchors: leftSupport, content, bite, rightSupport
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)

        glb_path = OUT_DIR / 'qingbuliang.glb'
        png_path = OUT_DIR / 'qingbuliang.png'

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

        return 'qingbuliang', glb_path, png_path

    # =============================================================
    # 6. FENGLISU (cupped)
    # 2 short rectangular pineapple cakes .06×.025×.04m,
    # golden shortbread with rounded corners/surface cracks,
    # one half shows amber pineapple jam cross section.
    # Cupped edible ONLY no trays/metalcups; total width .15, height .05, bottom 0,
    # root left/right supports ±.065,0,0, bite actual top front.
    # Clearly squares, not tarts or round buns.
    # =============================================================
    def build_fenglisu(export_glb=True, render_png=True):
        reset_scene()
        mats = [
            H.make_mat('mat_shortbread', 'e6b758', roughness=0.55),       # 0: golden baked shortbread crust
            H.make_mat('mat_toasted', 'bd7928', roughness=0.62),         # 1: browned top/crust accent
            H.make_mat('mat_jam', 'bf7b1b', roughness=0.22, specular=0.85), # 2: translucent amber fibrous pineapple jam
            H.make_mat('mat_crumb', 'e0a647', roughness=0.70),          # 3: pastry crumb particles
        ]

        root = bpy.data.objects.new('fenglisu', None)
        bpy.context.collection.objects.link(root)

        # Cupped edible ONLY: No container, no utensil, no trays, no metal cups!
        bm_edible = bmesh.new()

        # Cake 1: Intact rectangular pineapple cake (left side)
        # Dimensions: width(X)=0.060m, height(Y)=0.032m, depth(Z)=0.040m
        # Centered at X = -0.042, resting on bottom y=0.0 (spanning y from 0.001 to 0.033)
        c1_cx = -0.042
        c1_cy = 0.017
        c1_cz = -0.002
        c1_sx = 0.060
        c1_sy = 0.032
        c1_sz = 0.040

        # Build rounded beveled rectangular block for Cake 1
        H.add_box(bm_edible, (c1_cx, c1_cy, c1_cz), c1_sx, c1_sy, c1_sz, rot_deg=(0, 4, 0), mat_idx=0)
        # Golden browned top surface wash
        H.add_box(bm_edible, (c1_cx, c1_cy + c1_sy * 0.49, c1_cz), c1_sx * 0.88, 0.0015, c1_sz * 0.88, rot_deg=(0, 4, 0), mat_idx=1)
        # Subtle bake score cracks on top surface
        for off_x in (-0.016, 0.0, 0.016):
            H.add_box(bm_edible, (c1_cx + off_x, c1_cy + c1_sy * 0.50, c1_cz), 0.0018, 0.0012, c1_sz * 0.75, rot_deg=(0, 4, 0), mat_idx=1)

        # Cake 2: Cut into halves, with one half showing amber pineapple jam cross section
        # Dimensions of each half: width(X)=0.030m, height(Y)=0.032m, depth(Z)=0.040m
        # To make total width reach ~0.150m (leftmost ~ -0.073, rightmost ~ +0.075):
        # Half 2A (right rear/side): intact half block resting at X = +0.052
        c2a_cx = 0.050
        c2a_cy = 0.016
        c2a_cz = -0.008
        H.add_box(bm_edible, (c2a_cx, c2a_cy, c2a_cz), 0.032, 0.032, 0.040, rot_deg=(0, -8, 0), mat_idx=0)
        H.add_box(bm_edible, (c2a_cx, c2a_cy + 0.016, c2a_cz), 0.028, 0.0015, 0.036, rot_deg=(0, -8, 0), mat_idx=1)

        # Half 2B (propped up / cut cross-section proudly facing viewer and tilted):
        # Tilted block centered at X = +0.018, rising to apex height y = 0.050 and z = 0.020
        # (matching bite anchor at [0.0, 0.050, 0.020]!)
        c2b_cx = 0.015
        c2b_cy = 0.028
        c2b_cz = 0.008
        rot_b = (-22, -12, 14)

        # Shortbread outer crust shell
        H.add_box(bm_edible, (c2b_cx, c2b_cy, c2b_cz), 0.032, 0.032, 0.036, rot_deg=rot_b, mat_idx=0)
        # Browned top crust
        H.add_box(bm_edible, (c2b_cx, c2b_cy + 0.014, c2b_cz), 0.028, 0.0016, 0.032, rot_deg=rot_b, mat_idx=1)

        # Cut face: Outer rim is golden crust (mat_idx=0), interior is rich amber pineapple jam (mat_idx=2)
        # Pineapple jam core filling (translucent amber fibrous filling)
        H.add_box(bm_edible, (c2b_cx, c2b_cy, c2b_cz), 0.024, 0.024, 0.030, rot_deg=rot_b, mat_idx=2)

        # Cut section exposed face filling disk / patch
        # Facing toward front (+Z)
        rx_b, ry_b, rz_b = [math.radians(a) for a in rot_b]
        Rx = Matrix.Rotation(rx_b, 3, 'X')
        Ry = Matrix.Rotation(ry_b, 3, 'Y')
        Rz = Matrix.Rotation(rz_b, 3, 'Z')
        R_b = Rz @ Ry @ Rx
        p_cut_local = Vector((0.0, 0.0, 0.018))
        p_cut_glb = R_b @ p_cut_local + Vector((c2b_cx, c2b_cy, c2b_cz))
        H.add_box(bm_edible, (p_cut_glb.x, p_cut_glb.y, p_cut_glb.z), 0.022, 0.022, 0.002, rot_deg=rot_b, mat_idx=2)

        # Pastry crumbs scattered at base
        crumb_pts = [
            (-0.010, 0.002, 0.020), (0.008, 0.002, 0.024), (0.032, 0.002, 0.020),
            (-0.045, 0.002, 0.024), (0.055, 0.002, 0.015), (-0.025, 0.002, -0.022),
            (0.020, 0.002, -0.022), (0.000, 0.002, 0.018),
        ]
        for cp in crumb_pts:
            H.add_ellipsoid(bm_edible, cp, 0.0018, 0.0010, 0.0018, segs_u=6, segs_v=5, mat_idx=3)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors: supports ±.065, 0, 0 and actual top front bite (0, .050, .020)
        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.050, 0.020), parent=root)

        glb_path = OUT_DIR / 'fenglisu.glb'
        png_path = OUT_DIR / 'fenglisu.png'

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
            render_thumbnail((0.0, 0.025, 0.0), 0.16, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'fenglisu', glb_path, png_path

    # =============================================================
    # EXECUTION: PASS 1 (GLBS EARLY) THEN PASS 2 (RENDERS)
    # =============================================================
    builders = [
        build_hongyou_chaoshou,
        build_choudoufu,
        build_hulatang,
        build_changfen,
        build_qingbuliang,
        build_fenglisu,
    ]

    print('=== PASS 1: DELIVERING ALL 6 GLB MODELS EARLY ===')
    for b in builders:
        b(export_glb=True, render_png=False)

    print('=== PASS 2: RENDERING ALL 6 PNG THUMBNAILS (256x256) ===')
    for b in builders:
        b(export_glb=False, render_png=True)

    print('ALL_BLENDER_TASKS_COMPLETE')


def run_node_verify_and_manifest():
    """Runs Node.js script using Three.js GLTFLoader to verify models and build canonical manifest.json."""
    node_script = """
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const outDir = '/home/baibai/outbox/pawborough-national-snacks-20261002/m11-assets-b';

const specs = {
  'hongyou-chaoshou': {
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
  'choudoufu': {
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
  'hulatang': {
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
  'changfen': {
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
  'qingbuliang': {
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
  'fenglisu': {
    profile: 'cupped',
    utensilKind: 'none',
    requiredParts: ['edible'],
    expectedAnchors: {
      leftSupport: [0.065, 0.0, 0.0],
      rightSupport: [-0.065, 0.0, 0.0],
      bite: [0.0, 0.050, 0.020]
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
    sourceScript: 'asset-authoring/snacks/national/build_twenty_four_b.py',
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
        run_blender_build()
    except ImportError:
        # Running from shell / standard python
        print('Starting headless Blender build for 6 M11 candidate snacks (Wave B)...')
        cmd = ['blender', '--background', '--python', str(SRC_PATH)]
        res = subprocess.run(cmd)
        if res.returncode != 0:
            print(f'Blender failed with code {res.returncode}', file=sys.stderr)
            sys.exit(res.returncode)

        print('Optimizing rendered 256x256 PNG thumbnails to <60KiB...')
        try:
            from PIL import Image
            for png_file in OUT_DIR.glob('*.png'):
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
        print('ALL_SIX_M11_B_SNACKS_BUILT_AND_VERIFIED_SUCCESSFULLY!')


if __name__ == '__main__':
    main()
