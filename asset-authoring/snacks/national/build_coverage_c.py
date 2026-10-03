# -*- coding: utf-8 -*-
"""Pawborough Food Coverage Expansion: Batch C (8 candidate 3D meals & thumbnails).

Foods built in this batch:
1. nang (新疆馕, cupped, utensil: None)
2. zanba (西藏糌粑, cupped, utensil: None)
3. shengjianbao (上海生煎包, cupped, utensil: None)
4. tangou (江苏桂花糖藕, bowl, utensil: spoon)
5. ningbo-tangyuan (浙江宁波汤圆, bowl, utensil: spoon)
6. mashu (福建麻薯, cupped, utensil: None)
7. boboji (四川钵钵鸡, skewer, utensil: None)
8. xiajiao (广东虾饺, cupped, utensil: None)

Outputs ONLY to:
/home/baibai/outbox/pawborough-food-coverage-20261003/assets-c/{id}.glb
/home/baibai/outbox/pawborough-food-coverage-20261003/assets-c/{id}.png
/home/baibai/outbox/pawborough-food-coverage-20261003/assets-c/manifest.json
/home/baibai/outbox/pawborough-food-coverage-20261003/assets-c/verify.mjs
"""
import os
import sys
import math
import json
import hashlib
import subprocess
from pathlib import Path

OUT_DIR = Path('/home/baibai/outbox/pawborough-food-coverage-20261003/assets-c')
SRC_REL = Path('asset-authoring/snacks/national/build_coverage_c.py')

SPECS = [
    {
        "id": "nang",
        "name": "馕",
        "regionId": "xinjiang",
        "poseProfile": "cupped",
        "utensilKind": None,
        "requiredParts": ["edible"],
        "visualIdentity": "Round golden flatbread with thick raised rim, densely stamped small center holes, sesame dots and caramel toasted patches.",
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.025, 0.0],
            "leftSupport": [0.065, 0.0, 0.0],
            "rightSupport": [-0.065, 0.0, 0.0],
            "bite": [0.0, 0.05, 0.02]
        }
    },
    {
        "id": "zanba",
        "name": "糌粑",
        "regionId": "tibet",
        "poseProfile": "cupped",
        "utensilKind": None,
        "requiredParts": ["edible"],
        "visualIdentity": "Three tan hand-pressed barley dough pieces with thumb indentations and coarse grain flecks; small gold/ivory support napkin optional but not edible.",
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.025, 0.0],
            "leftSupport": [0.065, 0.0, 0.0],
            "rightSupport": [-0.065, 0.0, 0.0],
            "bite": [0.0, 0.05, 0.02]
        }
    },
    {
        "id": "shengjianbao",
        "name": "生煎包",
        "regionId": "shanghai",
        "poseProfile": "cupped",
        "utensilKind": None,
        "requiredParts": ["edible"],
        "visualIdentity": "Three small pleated buns with clear crisp caramelized flat bottoms, white dough tops, black sesame and green scallion.",
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.025, 0.0],
            "leftSupport": [0.065, 0.0, 0.0],
            "rightSupport": [-0.065, 0.0, 0.0],
            "bite": [0.0, 0.05, 0.02]
        }
    },
    {
        "id": "tangou",
        "name": "桂花糖藕",
        "regionId": "jiangsu",
        "poseProfile": "bowl",
        "utensilKind": "spoon",
        "requiredParts": ["container", "edible", "utensil"],
        "visualIdentity": "Distinct sliced reddish-brown lotus root discs with 7 visible ivory rice-filled circular holes, amber syrup and small yellow osmanthus petals.",
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.025, 0.0],
            "leftSupport": [0.070, 0.0, -0.030],
            "rightSupport": [-0.050, 0.0, 0.0],
            "content": [0.0, 0.030, 0.0],
            "bite": [0.0, 0.030, 0.0],
            "toolGrip": [0.0, 0.0, 0.0],
            "toolBite": [0.0, 0.0, 0.110]
        }
    },
    {
        "id": "ningbo-tangyuan",
        "name": "宁波汤圆",
        "regionId": "zhejiang",
        "poseProfile": "bowl",
        "utensilKind": "spoon",
        "requiredParts": ["container", "edible", "utensil"],
        "visualIdentity": "Ivory glutinous rice balls in clear light sweet soup; one split ball exposes black sesame center; round spoon morsel.",
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.025, 0.0],
            "leftSupport": [0.070, 0.0, -0.030],
            "rightSupport": [-0.050, 0.0, 0.0],
            "content": [0.0, 0.030, 0.0],
            "bite": [0.0, 0.030, 0.0],
            "toolGrip": [0.0, 0.0, 0.0],
            "toolBite": [0.0, 0.0, 0.110]
        }
    },
    {
        "id": "mashu",
        "name": "麻薯",
        "regionId": "fujian",
        "poseProfile": "cupped",
        "utensilKind": None,
        "requiredParts": ["edible"],
        "visualIdentity": "Three soft flattened pale rice cakes coated with tan peanut powder, one split shows black sesame center, irregular powder speckles.",
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.025, 0.0],
            "leftSupport": [0.065, 0.0, 0.0],
            "rightSupport": [-0.065, 0.0, 0.0],
            "bite": [0.0, 0.05, 0.02]
        }
    },
    {
        "id": "boboji",
        "name": "钵钵鸡",
        "regionId": "sichuan",
        "poseProfile": "skewer",
        "utensilKind": None,
        "requiredParts": ["edible", "skewer"],
        "visualIdentity": "Three bamboo skewers carrying recognizable golden chicken, pale lotus root slice and green vegetable; glossy chili oil/sesame on food, safe blunt grips.",
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.120, 0.0],
            "leftSupport": [0.025, -0.070, 0.0],
            "rightSupport": [-0.025, -0.070, 0.0],
            "bite": [0.0, 0.055, 0.025]
        }
    },
    {
        "id": "xiajiao",
        "name": "虾饺",
        "regionId": "guangdong",
        "poseProfile": "cupped",
        "utensilKind": None,
        "requiredParts": ["edible"],
        "visualIdentity": "Three crescent translucent ivory dumplings with pleated ridges and subtle peach shrimp core, arranged in shallow ivory paper support.",
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.025, 0.0],
            "leftSupport": [0.065, 0.0, 0.0],
            "rightSupport": [-0.065, 0.0, 0.0],
            "bite": [0.0, 0.05, 0.02]
        }
    }
]


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
    # Shared Thumbnail Renderer (256x256, transparent RGBA, threads 4, samples 16)
    # -------------------------------------------------------------
    def render_thumbnail(center_glb, target_size_m, out_png):
        sc = bpy.context.scene
        sc.render.threads_mode = 'FIXED'
        sc.render.threads = 4
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = 16
        sc.cycles.device = 'CPU'
        sc.render.resolution_x = 256
        sc.render.resolution_y = 256
        sc.render.film_transparent = True
        sc.render.image_settings.file_format = 'PNG'
        sc.render.image_settings.color_mode = 'RGBA'
        sc.render.image_settings.color_depth = '8'
        sc.render.image_settings.compression = 100

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

        sc.render.filepath = str(out_png)
        bpy.ops.render.render(write_still=True)

    # -------------------------------------------------------------
    # Shared Helper: Export Selected Meal and Children Only
    # -------------------------------------------------------------
    def export_meal_glb(root_obj, glb_path):
        bpy.ops.object.select_all(action='DESELECT')

        def select_rec(o):
            o.select_set(True)
            for ch in o.children:
                select_rec(ch)

        select_rec(root_obj)
        bpy.context.view_layer.objects.active = root_obj

        bpy.ops.export_scene.gltf(
            filepath=str(glb_path),
            export_format='GLB',
            use_selection=True,
            export_yup=True,
            export_apply=True,
            export_cameras=False,
            export_lights=False
        )

    # -------------------------------------------------------------
    # Shared Helper: Standard Jade Ceramic Bowl Container
    # Outer radius 0.075, diameter 0.150m, foot ring bottom at y = -0.025, lip at y = +0.020.
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
    # Shared Helper: Spoon Utensil (oval cup at distal, toolGrip + toolBite)
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

        # In Blender coords (X, -Z, Y), GLB (0, 0, 0.110) corresponds to (0.0, -0.110, 0.0)
        toolBite = bpy.data.objects.new('toolBite', None)
        toolBite.location = Vector((0.0, -0.110, 0.0))
        toolBite.parent = utensil_obj
        bpy.context.collection.objects.link(toolBite)

        tool_food_fn(utensil_obj)
        return utensil_obj

    # =============================================================
    # 1. NANG (新疆馕, cupped)
    # "Round golden flatbread with thick raised rim, densely stamped small center holes,
    # sesame dots and caramel toasted patches."
    # =============================================================
    def build_nang(export_glb=True, render_png=True):
        reset_scene()
        mats = [
            H.make_mat('mat_crust_golden', 'deaa57', roughness=0.55),        # 0: golden baked crust
            H.make_mat('mat_toasted_caramel', '78330c', roughness=0.45),     # 1: dark caramel toasted blister patches
            H.make_mat('mat_center_pale', 'ebd09b', roughness=0.62),         # 2: pressed floury center disc
            H.make_mat('mat_stamp_holes', '542407', roughness=0.40),         # 3: stamped hole dimples
            H.make_mat('mat_sesame', 'f8eedb', roughness=0.50),              # 4: white sesame dots
        ]

        root = bpy.data.objects.new('nang', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # Center and orientation for comfortable hand cradling:
        # Paws support at ±0.065, bottom cradled at y ≈ -0.025, top front rim reaches bite [0, 0.05, 0.02].
        # Diameter ~0.170m (radius 0.085m).
        cy = 0.008
        cz = -0.045
        tilt_ang = math.radians(22.0)
        sin_t = math.sin(tilt_ang)
        cos_t = math.cos(tilt_ang)

        segs_r = 36
        # Radial cross section profile (r, h_top, h_bot) in flatbread local frame
        # r = 0 to 0.084m
        profile = [
            (0.000, 0.001, -0.006),
            (0.020, 0.002, -0.006),
            (0.040, 0.003, -0.006),
            (0.055, 0.006, -0.007),
            (0.066, 0.014, -0.008),  # Inner rim shoulder
            (0.074, 0.016, -0.008),  # Rim crest
            (0.081, 0.008, -0.007),  # Outer rim shoulder
            (0.084, -0.002, -0.005), # Outer rim edge
        ]

        top_rings = []
        bot_rings = []

        for r, h_top, h_bot in profile:
            t_ring = []
            b_ring = []
            for i in range(segs_r):
                phi = 2.0 * math.pi * i / segs_r
                lx = r * math.cos(phi)
                lu = r * math.sin(phi)

                # World GLB coordinates
                wx = lx
                wy_t = cy + lu * sin_t + h_top * cos_t
                wz_t = cz + lu * cos_t - h_top * sin_t
                t_ring.append(bm_edible.verts.new(H.glb_to_bl((wx, wy_t, wz_t))))

                wy_b = cy + lu * sin_t + h_bot * cos_t
                wz_b = cz + lu * cos_t - h_bot * sin_t
                b_ring.append(bm_edible.verts.new(H.glb_to_bl((wx, wy_b, wz_b))))

            top_rings.append(t_ring)
            bot_rings.append(b_ring)

        bm_edible.verts.ensure_lookup_table()

        # Connect top surface rings
        for ir in range(len(top_rings) - 1):
            r1 = top_rings[ir]
            r2 = top_rings[ir + 1]
            mat_i = 2 if ir < 3 else 0  # center pale vs golden crust
            for i in range(segs_r):
                inxt = (i + 1) % segs_r
                try:
                    f = bm_edible.faces.new([r1[i], r2[i], r2[inxt], r1[inxt]])
                    f.material_index = mat_i
                except ValueError:
                    pass

        # Connect bottom surface rings
        for ir in range(len(bot_rings) - 1):
            r1 = bot_rings[ir]
            r2 = bot_rings[ir + 1]
            for i in range(segs_r):
                inxt = (i + 1) % segs_r
                try:
                    f = bm_edible.faces.new([r1[i], r1[inxt], r2[inxt], r2[i]])
                    f.material_index = 0
                except ValueError:
                    pass

        # Bridge outer rim perimeter
        outer_top = top_rings[-1]
        outer_bot = bot_rings[-1]
        for i in range(segs_r):
            inxt = (i + 1) % segs_r
            try:
                f = bm_edible.faces.new([outer_top[i], outer_top[inxt], outer_bot[inxt], outer_bot[i]])
                f.material_index = 0
            except ValueError:
                pass

        # Center caps
        c_top = top_rings[0][0]
        c_bot = bot_rings[0][0]

        # Stamped small center holes (traditional chekich stamp pattern)
        stamp_radii = [0.014, 0.026, 0.038, 0.048]
        stamp_counts = [6, 12, 16, 20]
        for s_r, s_cnt in zip(stamp_radii, stamp_counts):
            for i in range(s_cnt):
                ang = 2.0 * math.pi * i / s_cnt
                lx = s_r * math.cos(ang)
                lu = s_r * math.sin(ang)
                h_top = 0.003
                wx = lx
                wy = cy + lu * sin_t + h_top * cos_t
                wz = cz + lu * cos_t - h_top * sin_t
                H.add_box(bm_edible, (wx, wy, wz), 0.0028, 0.0020, 0.0028, rot_deg=(22, 0, math.degrees(ang)), mat_idx=3)

        # Caramel toasted blister patches along the raised rim
        toasted_angles = [0.2, 0.75, 1.4, 2.1, 2.9, 3.7, 4.5, 5.2, 5.9]
        for a in toasted_angles:
            lx = 0.073 * math.cos(a)
            lu = 0.073 * math.sin(a)
            wx = lx
            wy = cy + lu * sin_t + 0.0165 * cos_t
            wz = cz + lu * cos_t - 0.0165 * sin_t
            H.add_ellipsoid(bm_edible, (wx, wy, wz), 0.009, 0.0035, 0.007, segs_u=8, segs_v=6, mat_idx=1)

        # White sesame seeds scattered over the rim and center
        sesame_coords = [
            (0.010, 0.015), (-0.015, 0.020), (0.025, -0.010), (-0.030, -0.015),
            (0.065, 0.030), (-0.060, 0.035), (0.055, -0.045), (-0.050, -0.050),
            (0.070, 0.000), (-0.072, 0.010), (0.000, 0.072), (0.015, -0.068),
            (0.035, 0.055), (-0.038, 0.050), (0.048, -0.040), (-0.042, -0.045),
            (0.020, 0.035), (-0.022, 0.038), (0.012, -0.025), (-0.018, -0.028),
        ]
        for lx, lu in sesame_coords:
            r = math.hypot(lx, lu)
            h = 0.015 if r > 0.060 else 0.003
            wx = lx
            wy = cy + lu * sin_t + (h + 0.001) * cos_t
            wz = cz + lu * cos_t - (h + 0.001) * sin_t
            H.add_ellipsoid(bm_edible, (wx, wy, wz), 0.0016, 0.0009, 0.0016, segs_u=6, segs_v=4, mat_idx=4)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.050, 0.020), parent=root)

        glb_path = OUT_DIR / 'nang.glb'
        png_path = OUT_DIR / 'nang.png'

        if export_glb:
            export_meal_glb(root, glb_path)
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.0, 0.015, 0.0), 0.19, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'nang', glb_path, png_path

    # =============================================================
    # 2. ZANBA (西藏糌粑, cupped)
    # "Three tan hand-pressed barley dough pieces with thumb indentations and coarse grain flecks;
    # small gold/ivory support napkin optional but not edible."
    # =============================================================
    def build_zanba(export_glb=True, render_png=True):
        reset_scene()
        mats = [
            H.make_mat('mat_zanba_dough', 'bda076', roughness=0.72),       # 0: roasted highland barley dough tan
            H.make_mat('mat_zanba_grain', '58371c', roughness=0.85),       # 1: coarse dark roasted barley flecks
            H.make_mat('mat_butter_sheen', 'd8a855', roughness=0.38, specular=0.7), # 2: yak butter sheen on thumb impression
        ]

        root = bpy.data.objects.new('zanba', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # Three hand-pressed quenelle/dough pieces with thumb indentations:
        # Piece 1 (left base)
        c1 = (-0.042, -0.005, 0.002)
        H.add_ellipsoid(bm_edible, c1, 0.038, 0.018, 0.022, segs_u=20, segs_v=14, mat_idx=0)
        # Thumb indentation on upper front
        H.add_ellipsoid(bm_edible, (-0.042, 0.006, 0.014), 0.016, 0.007, 0.011, segs_u=12, segs_v=8, mat_idx=2)

        # Piece 2 (right base)
        c2 = (0.042, -0.005, 0.002)
        H.add_ellipsoid(bm_edible, c2, 0.038, 0.018, 0.022, segs_u=20, segs_v=14, mat_idx=0)
        # Thumb indentation
        H.add_ellipsoid(bm_edible, (0.042, 0.006, 0.014), 0.016, 0.007, 0.011, segs_u=12, segs_v=8, mat_idx=2)

        # Piece 3 (center top, resting upon pieces 1 and 2, crest reaches bite [0, 0.05, 0.02])
        c3 = (0.000, 0.026, 0.010)
        H.add_ellipsoid(bm_edible, c3, 0.036, 0.018, 0.020, segs_u=20, segs_v=14, mat_idx=0)
        # Pronounced thumb indentation facing viewer
        H.add_ellipsoid(bm_edible, (0.000, 0.038, 0.019), 0.018, 0.006, 0.012, segs_u=14, segs_v=10, mat_idx=2)

        # Coarse roasted highland barley grain flecks scattered on all 3 pieces
        grain_pts = [
            (-0.025, 0.005, 0.018), (-0.055, -0.002, 0.016), (-0.035, -0.016, 0.012),
            (-0.060, 0.008, 0.008), (-0.020, -0.012, -0.010), (-0.050, 0.010, -0.012),
            (0.025, 0.005, 0.018), (0.055, -0.002, 0.016), (0.035, -0.016, 0.012),
            (0.060, 0.008, 0.008), (0.020, -0.012, -0.010), (0.050, 0.010, -0.012),
            (-0.012, 0.032, 0.024), (0.015, 0.034, 0.022), (0.025, 0.024, 0.018),
            (-0.026, 0.025, 0.018), (0.000, 0.046, 0.014), (0.005, 0.016, 0.025),
            (-0.015, 0.018, 0.024), (0.018, 0.042, 0.012), (-0.022, 0.040, 0.010),
        ]
        for gx, gy, gz in grain_pts:
            H.add_box(bm_edible, (gx, gy, gz), 0.0025, 0.0020, 0.0025, rot_deg=(15, 25, 35), mat_idx=1)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.050, 0.020), parent=root)

        glb_path = OUT_DIR / 'zanba.glb'
        png_path = OUT_DIR / 'zanba.png'

        if export_glb:
            export_meal_glb(root, glb_path)
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.0, 0.012, 0.0), 0.18, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'zanba', glb_path, png_path

    # =============================================================
    # 3. SHENGJIANBAO (上海生煎包, cupped)
    # "Three small pleated buns with clear crisp caramelized flat bottoms, white dough tops,
    # black sesame and green scallion."
    # =============================================================
    def build_shengjianbao(export_glb=True, render_png=True):
        reset_scene()
        mats = [
            H.make_mat('mat_bun_white', 'f6f3ea', roughness=0.52),           # 0: soft white steamed dough
            H.make_mat('mat_crisp_bottom', '662b09', roughness=0.35, specular=0.65), # 1: crispy caramelized bottom crust
            H.make_mat('mat_black_sesame', '181716', roughness=0.28, specular=0.70), # 2: black sesame seeds
            H.make_mat('mat_scallion', '2a8a1e', roughness=0.32),            # 3: chopped green scallions
            H.make_mat('mat_pleat_crease', 'e5dece', roughness=0.55),        # 4: pinched pleat crease shading
        ]

        root = bpy.data.objects.new('shengjianbao', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        def add_shengjian_bun(cx, cy, cz, scale=1.0):
            r_bun = 0.026 * scale
            h_base = 0.019 * scale
            bot_y = cy - h_base

            # Crisp caramelized flat bottom crust plate
            H.add_cylinder(bm_edible, (cx, bot_y, cz), (cx, bot_y + 0.0035 * scale, cz),
                           r_bun * 0.90, segs=20, cap1=True, cap2=True, mat_idx=1)

            # Plump white bun dome
            H.add_ellipsoid(bm_edible, (cx, cy, cz), r_bun, h_base * 0.95, r_bun,
                            segs_u=24, segs_v=14, y_min=bot_y + 0.003 * scale, mat_idx=0)

            # Pinched spiral pleat ridges on top crown
            pleat_y = cy + h_base * 0.82
            H.add_ellipsoid(bm_edible, (cx, pleat_y, cz), 0.008 * scale, 0.0035 * scale, 0.008 * scale,
                            segs_u=12, segs_v=8, mat_idx=4)
            for ip in range(8):
                p_ang = 2.0 * math.pi * ip / 8.0
                px = cx + 0.009 * scale * math.cos(p_ang)
                pz = cz + 0.009 * scale * math.sin(p_ang)
                H.add_box(bm_edible, (px, pleat_y - 0.001, pz), 0.003 * scale, 0.002 * scale, 0.003 * scale,
                          rot_deg=(10, math.degrees(p_ang), 15), mat_idx=4)

            # Black sesame seeds
            sesame_offsets = [
                (0.005, 0.006), (-0.006, 0.007), (0.008, -0.005), (-0.007, -0.006),
                (0.012, 0.002), (-0.011, 0.003), (0.002, 0.013), (-0.003, -0.012),
                (0.009, 0.010), (-0.010, 0.009), (0.004, -0.009), (-0.005, 0.011)
            ]
            for ox, oz in sesame_offsets:
                sx = cx + ox * scale
                sz = cz + oz * scale
                sy = cy + h_base * 0.88 + 0.001
                H.add_ellipsoid(bm_edible, (sx, sy, sz), 0.0015 * scale, 0.0009 * scale, 0.0015 * scale,
                                segs_u=6, segs_v=4, mat_idx=2)

            # Scallion bits
            scallion_offsets = [
                (0.007, 0.012), (-0.012, 0.008), (0.014, -0.008), (-0.008, -0.014),
                (0.000, 0.016), (0.015, 0.005), (-0.014, -0.003), (0.003, -0.015)
            ]
            for ox, oz in scallion_offsets:
                sx = cx + ox * scale
                sz = cz + oz * scale
                sy = cy + h_base * 0.85 + 0.0015
                H.add_box(bm_edible, (sx, sy, sz), 0.0032 * scale, 0.0012 * scale, 0.0032 * scale,
                          rot_deg=(8, 35, 12), mat_idx=3)

        # Bun 1 (left front)
        add_shengjian_bun(-0.040, -0.005, 0.015, scale=1.0)
        # Bun 2 (right front)
        add_shengjian_bun(0.040, -0.005, 0.015, scale=1.0)
        # Bun 3 (center top / rear, crown apex reaches y = 0.050, z = 0.020)
        add_shengjian_bun(0.000, 0.018, -0.008, scale=1.05)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.050, 0.020), parent=root)

        glb_path = OUT_DIR / 'shengjianbao.glb'
        png_path = OUT_DIR / 'shengjianbao.png'

        if export_glb:
            export_meal_glb(root, glb_path)
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.0, 0.012, 0.0), 0.18, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'shengjianbao', glb_path, png_path

    # =============================================================
    # 4. TANGOU (江苏桂花糖藕, bowl spoon)
    # "Distinct sliced reddish-brown lotus root discs with 7 visible ivory rice-filled circular holes,
    # amber syrup and small yellow osmanthus petals."
    # =============================================================
    def build_tangou(export_glb=True, render_png=True):
        reset_scene()
        mats = [
            H.make_mat('mat_jade_bowl', '82a48d', roughness=0.25, specular=0.8),    # 0: jade bowl
            H.make_mat('mat_lotus_root', '852f1b', roughness=0.40),                  # 1: braised reddish-brown lotus root
            H.make_mat('mat_rice_filling', 'eee7d6', roughness=0.45),                # 2: ivory glutinous rice plugs
            H.make_mat('mat_amber_syrup', 'b56214', roughness=0.15, specular=0.9),  # 3: glossy amber sugar syrup
            H.make_mat('mat_osmanthus', 'ebb726', roughness=0.35),                   # 4: yellow osmanthus petals
        ]

        root = bpy.data.objects.new('tangou', None)
        bpy.context.collection.objects.link(root)

        # 1. Container: Jade bowl
        build_jade_bowl(root, mats[0])

        # 2. Utensil: Spoon with miniature lotus root morsel in toolFood
        def build_tangou_tool_food(utensil_obj):
            bm_tf = bmesh.new()
            # Mini lotus slice morsel in spoon bowl
            c_tf = (0.0, 0.004, 0.098)
            H.add_cylinder(bm_tf, (c_tf[0], c_tf[1] - 0.0015, c_tf[2]), (c_tf[0], c_tf[1] + 0.0015, c_tf[2]),
                           0.006, segs=14, cap1=True, cap2=True, mat_idx=1)
            # Center rice hole
            H.add_cylinder(bm_tf, (c_tf[0], c_tf[1] - 0.0016, c_tf[2]), (c_tf[0], c_tf[1] + 0.0016, c_tf[2]),
                           0.0015, segs=8, cap1=True, cap2=True, mat_idx=2)
            # Osmanthus petal on top
            H.add_box(bm_tf, (c_tf[0] + 0.001, c_tf[1] + 0.0018, c_tf[2] + 0.001), 0.0018, 0.0006, 0.0018, mat_idx=4)
            H.create_mesh_object('toolFood', bm_tf, mats, parent=utensil_obj)

        build_spoon_utensil(root, mats[0], build_tangou_tool_food)

        # 3. Edible in bowl:
        bm_edible = bmesh.new()

        # Amber syrup pool at bottom of bowl
        H.add_cylinder(bm_edible, (0.0, -0.015, 0.0), (0.0, -0.008, 0.0), 0.052, segs=28, cap1=True, cap2=True, mat_idx=3)

        # Helper to build a lotus root slice with 7 ivory rice-filled circular holes
        def add_lotus_slice(cx, cy, cz, rot_deg=(0, 0, 0), radius=0.023, thick=0.009):
            rx, ry, rz = [math.radians(a) for a in rot_deg]
            R = Matrix.Rotation(rz, 3, 'Z') @ Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X')
            p1_local = Vector((0.0, -thick / 2.0, 0.0))
            p2_local = Vector((0.0, thick / 2.0, 0.0))
            c_vec = Vector((cx, cy, cz))
            p1 = R @ p1_local + c_vec
            p2 = R @ p2_local + c_vec

            # Outer lotus root disc
            H.add_cylinder(bm_edible, (p1.x, p1.y, p1.z), (p2.x, p2.y, p2.z), radius, segs=24, cap1=True, cap2=True, mat_idx=1)

            # 7 circular holes filled with ivory rice:
            # 1 central hole + 6 in a concentric ring at r = 0.0125
            hole_positions = [(0.0, 0.0)]
            for ih in range(6):
                ang = 2.0 * math.pi * ih / 6.0
                hole_positions.append((0.0125 * math.cos(ang), 0.0125 * math.sin(ang)))

            h_rad = 0.0032
            for hx, hz in hole_positions:
                hp1_l = Vector((hx, -thick / 2.0 - 0.0003, hz))
                hp2_l = Vector((hx, thick / 2.0 + 0.0003, hz))
                hp1 = R @ hp1_l + c_vec
                hp2 = R @ hp2_l + c_vec
                H.add_cylinder(bm_edible, (hp1.x, hp1.y, hp1.z), (hp2.x, hp2.y, hp2.z), h_rad, segs=10, cap1=True, cap2=True, mat_idx=2)

            # Amber syrup glaze drizzle on top face
            glaze_l = Vector((0.0, thick / 2.0 + 0.0006, 0.0))
            glaze_p = R @ glaze_l + c_vec
            H.add_ellipsoid(bm_edible, (glaze_p.x, glaze_p.y, glaze_p.z), radius * 0.75, 0.0012, radius * 0.75, segs_u=12, segs_v=8, mat_idx=3)

        # 4 overlapping sliced lotus root discs fanning gracefully in the bowl
        slices = [
            (0.016, -0.004, -0.022, (18, 12, -8)),
            (-0.018, -0.001, -0.008, (22, -15, 6)),
            (0.012, 0.005, 0.010, (26, 10, -5)),
            (-0.010, 0.011, 0.024, (30, -8, 4)),
        ]
        for sx, sy, sz, srot in slices:
            add_lotus_slice(sx, sy, sz, rot_deg=srot)

        # Yellow osmanthus flower petals scattered on slices and syrup
        osmanthus_pts = [
            (0.012, 0.016, 0.025), (-0.005, 0.017, 0.028), (-0.020, 0.012, 0.020),
            (0.022, 0.010, 0.012), (0.002, 0.012, 0.008), (-0.015, 0.008, 0.002),
            (0.018, 0.003, -0.012), (-0.022, 0.002, -0.015), (0.005, 0.000, -0.025),
            (0.038, -0.007, -0.005), (-0.036, -0.007, 0.010), (0.028, -0.007, 0.030),
            (-0.025, -0.007, -0.030), (0.000, -0.007, 0.040), (-0.035, -0.007, -0.015)
        ]
        for ox, oy, oz in osmanthus_pts:
            H.add_box(bm_edible, (ox, oy, oz), 0.0022, 0.0008, 0.0022, rot_deg=(12, 40, 20), mat_idx=4)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors (matching bowl contract)
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)

        glb_path = OUT_DIR / 'tangou.glb'
        png_path = OUT_DIR / 'tangou.png'

        if export_glb:
            export_meal_glb(root, glb_path)
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.020, -0.005, 0.0), 0.18, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'tangou', glb_path, png_path

    # =============================================================
    # 5. NINGBO-TANGYUAN (浙江宁波汤圆, bowl spoon)
    # "Ivory glutinous rice balls in clear light sweet soup; one split ball exposes black sesame center;
    # round spoon morsel."
    # =============================================================
    def build_ningbo_tangyuan(export_glb=True, render_png=True):
        reset_scene()
        mats = [
            H.make_mat('mat_jade_bowl', '82a48d', roughness=0.25, specular=0.8),          # 0: jade bowl
            H.make_mat('mat_tangyuan_skin', 'faf7f0', roughness=0.35, specular=0.6),      # 1: ivory glutinous rice dough
            H.make_mat('mat_sesame_lava', '141212', roughness=0.18, specular=0.88),       # 2: molten glossy black sesame center
            H.make_mat('mat_sweet_soup', 'dbeff0', roughness=0.10, specular=0.95),        # 3: clear light sweet soup
            H.make_mat('mat_garnish', 'c44026', roughness=0.40),                          # 4: goji berry accent
        ]

        root = bpy.data.objects.new('ningbo-tangyuan', None)
        bpy.context.collection.objects.link(root)

        # 1. Container: Jade bowl
        build_jade_bowl(root, mats[0])

        # 2. Utensil: Spoon with round ivory tangyuan morsel in toolFood
        def build_tangyuan_tool_food(utensil_obj):
            bm_tf = bmesh.new()
            # Round ivory tangyuan ball resting in spoon bowl
            H.add_ellipsoid(bm_tf, (0.0, 0.0045, 0.098), 0.0068, 0.0055, 0.0068, segs_u=16, segs_v=12, mat_idx=1)
            H.create_mesh_object('toolFood', bm_tf, mats, parent=utensil_obj)

        build_spoon_utensil(root, mats[0], build_tangyuan_tool_food)

        # 3. Edible in bowl:
        bm_edible = bmesh.new()

        # Clear light sweet soup surface plane
        H.add_cylinder(bm_edible, (0.0, -0.012, 0.0), (0.0, -0.002, 0.0), 0.062, segs=32, cap1=True, cap2=True, mat_idx=3)

        # 5 Intact ivory tangyuan balls floating in the soup
        tangyuan_pos = [
            (-0.026, 0.005, -0.024),
            (0.026, 0.005, -0.024),
            (-0.034, 0.006, 0.006),
            (0.034, 0.006, 0.006),
            (0.018, 0.007, 0.028),
        ]
        for tx, ty, tz in tangyuan_pos:
            H.add_ellipsoid(bm_edible, (tx, ty, tz), 0.0145, 0.0135, 0.0145, segs_u=20, segs_v=14, mat_idx=1)

        # ONE SPLIT BALL positioned prominently in front/center:
        # Exposes black sesame molten filling oozing out
        sp_c = (-0.012, 0.006, 0.020)
        # Outer split shell (ivory skin with opening)
        H.add_ellipsoid(bm_edible, sp_c, 0.0145, 0.0135, 0.0145, segs_u=20, segs_v=14, mat_idx=1)
        # Molten black sesame core exposed at the cleft
        H.add_ellipsoid(bm_edible, (sp_c[0] + 0.002, sp_c[1] + 0.005, sp_c[2] + 0.004),
                        0.0095, 0.0075, 0.0095, segs_u=14, segs_v=10, mat_idx=2)
        # Droplet of molten black sesame spilling onto the soup surface
        H.add_ellipsoid(bm_edible, (sp_c[0] + 0.008, sp_c[1] - 0.001, sp_c[2] + 0.012),
                        0.0045, 0.0018, 0.0045, segs_u=10, segs_v=6, mat_idx=2)

        # Garnish: 2 goji berries floating in the soup
        H.add_ellipsoid(bm_edible, (0.005, 0.000, -0.015), 0.0045, 0.0020, 0.0025, mat_idx=4)
        H.add_ellipsoid(bm_edible, (-0.010, 0.000, -0.035), 0.0040, 0.0018, 0.0022, mat_idx=4)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)

        glb_path = OUT_DIR / 'ningbo-tangyuan.glb'
        png_path = OUT_DIR / 'ningbo-tangyuan.png'

        if export_glb:
            export_meal_glb(root, glb_path)
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.020, -0.005, 0.0), 0.18, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'ningbo-tangyuan', glb_path, png_path

    # =============================================================
    # 6. MASHU (福建麻薯, cupped)
    # "Three soft flattened pale rice cakes coated with tan peanut powder, one split shows black sesame center,
    # irregular powder speckles."
    # =============================================================
    def build_mashu(export_glb=True, render_png=True):
        reset_scene()
        mats = [
            H.make_mat('mat_peanut_powder', 'cba163', roughness=0.75),       # 0: warm tan roasted peanut powder coating
            H.make_mat('mat_mochi_dough', 'f1eee5', roughness=0.40, specular=0.5), # 1: pale chewy mochi rice dough
            H.make_mat('mat_sesame_core', '181615', roughness=0.22, specular=0.78), # 2: black sesame paste core
            H.make_mat('mat_powder_clumps', 'b58847', roughness=0.85),       # 3: crushed peanut powder granules
        ]

        root = bpy.data.objects.new('mashu', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # Three soft flattened squishy mochi cakes
        # Cake 1 (left base)
        H.add_ellipsoid(bm_edible, (-0.044, -0.008, 0.010), 0.028, 0.015, 0.026, segs_u=20, segs_v=14, mat_idx=0)

        # Cake 2 (right base)
        H.add_ellipsoid(bm_edible, (0.044, -0.008, 0.010), 0.028, 0.015, 0.026, segs_u=20, segs_v=14, mat_idx=0)

        # Cake 3 (center top / SPLIT: crest reaches y = 0.050, z = 0.020)
        c3 = (0.000, 0.020, -0.008)
        H.add_ellipsoid(bm_edible, c3, 0.027, 0.016, 0.025, segs_u=20, segs_v=14, mat_idx=0)

        # SPLIT opening at front-top of Cake 3:
        # Tear rim exposing pale mochi dough
        H.add_ellipsoid(bm_edible, (0.000, 0.028, 0.012), 0.015, 0.009, 0.012, segs_u=14, segs_v=10, mat_idx=1)
        # Black sesame paste core inside the tear
        H.add_ellipsoid(bm_edible, (0.000, 0.029, 0.014), 0.010, 0.0065, 0.008, segs_u=12, segs_v=8, mat_idx=2)

        # Irregular roasted peanut powder speckles/granules scattered across cakes
        powder_pts = [
            (-0.020, -0.002, 0.024), (-0.060, -0.005, 0.018), (-0.035, 0.006, 0.016),
            (0.020, -0.002, 0.024), (0.060, -0.005, 0.018), (0.035, 0.006, 0.016),
            (-0.015, 0.012, 0.020), (0.015, 0.012, 0.020), (0.000, 0.006, 0.025),
            (-0.018, 0.035, 0.005), (0.018, 0.035, 0.005), (0.000, 0.040, -0.010),
            (-0.048, -0.015, 0.012), (0.048, -0.015, 0.012), (-0.005, -0.018, 0.018),
            (-0.030, -0.018, 0.005), (0.030, -0.018, 0.005), (0.000, -0.022, 0.015),
        ]
        for px, py, pz in powder_pts:
            H.add_ellipsoid(bm_edible, (px, py, pz), 0.0022, 0.0014, 0.0022, segs_u=6, segs_v=4, mat_idx=3)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.050, 0.020), parent=root)

        glb_path = OUT_DIR / 'mashu.glb'
        png_path = OUT_DIR / 'mashu.png'

        if export_glb:
            export_meal_glb(root, glb_path)
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.0, 0.012, 0.0), 0.18, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'mashu', glb_path, png_path

    # =============================================================
    # 7. BOBOJI (四川钵钵鸡, skewer)
    # "Three bamboo skewers carrying recognizable golden chicken, pale lotus root slice and green vegetable;
    # glossy chili oil/sesame on food, safe blunt grips."
    # =============================================================
    def build_boboji(export_glb=True, render_png=True):
        reset_scene()
        mats = [
            H.make_mat('mat_bamboo', 'ceb07d', roughness=0.65),             # 0: bamboo skewer wood
            H.make_mat('mat_chicken', 'db9f54', roughness=0.45, specular=0.6), # 1: golden chicken meat
            H.make_mat('mat_lotus', 'ebdcc4', roughness=0.50),               # 2: crunchy pale lotus root
            H.make_mat('mat_green_veg', '308822', roughness=0.40, specular=0.5), # 3: fresh green vegetable
            H.make_mat('mat_chili_oil', 'a82210', roughness=0.18, specular=0.85), # 4: glossy spicy chili oil
            H.make_mat('mat_sesame', 'f7eedb', roughness=0.50),              # 5: white sesame seeds
        ]

        root = bpy.data.objects.new('boboji', None)
        bpy.context.collection.objects.link(root)

        # 1. Separate Skewer Object containing three bamboo skewers with safe blunt grips
        bm_skewer = bmesh.new()
        skewer_x = [-0.024, 0.000, 0.024]
        skewer_top_y = [0.068, 0.076, 0.068]
        stem_bot_y = -0.120

        for sx, sty in zip(skewer_x, skewer_top_y):
            # Bamboo stick cylinder from stem base to top
            H.add_cylinder(bm_skewer, (sx, stem_bot_y, 0.0), (sx, sty, 0.0), 0.0022, segs=12, cap1=True, cap2=True, mat_idx=0)
            # Safe rounded blunt cap at bottom
            H.add_rounded_tip(bm_skewer, (sx, stem_bot_y, 0.0), 0.0022, axis_glb=(0, -1, 0), segs=12, mat_idx=0)
            # Safe rounded blunt cap at top (avoid sharp end at face)
            H.add_rounded_tip(bm_skewer, (sx, sty, 0.0), 0.0022, axis_glb=(0, 1, 0), segs=12, mat_idx=0)

        skewer_obj = H.create_mesh_object('skewer', bm_skewer, mats[0], parent=root)

        # 2. Edible Object containing chicken, lotus root, and green vegetable
        bm_edible = bmesh.new()

        # Skewer 1 (left): Golden chicken pieces
        ch_pts = [
            (-0.024, 0.015, 0.000, 0.013, 0.010, 0.012),
            (-0.024, 0.034, 0.002, 0.014, 0.011, 0.013),
            (-0.024, 0.051, 0.001, 0.012, 0.009, 0.011),
        ]
        for cx, cy, cz, rx, ry, rz in ch_pts:
            H.add_ellipsoid(bm_edible, (cx, cy, cz), rx, ry, rz, segs_u=16, segs_v=12, mat_idx=1)

        # Skewer 2 (center): Pale lotus root slice
        # Center lotus slice (diameter ~0.046m, thickness ~0.007m)
        lotus_c = (0.000, 0.035, 0.012)
        H.add_cylinder(bm_edible, (lotus_c[0], lotus_c[1] - 0.020, lotus_c[2]), (lotus_c[0], lotus_c[1] + 0.020, lotus_c[2]),
                       0.022, segs=22, cap1=True, cap2=True, mat_idx=2)
        # Open circular holes around the skewer
        for ih in range(6):
            ang = 2.0 * math.pi * ih / 6.0
            hx = lotus_c[0] + 0.012 * math.cos(ang)
            hy = lotus_c[1] + 0.012 * math.sin(ang)
            # Indented air holes
            H.add_cylinder(bm_edible, (hx, hy, lotus_c[2] - 0.005), (hx, hy, lotus_c[2] + 0.005),
                           0.0032, segs=8, cap1=True, cap2=True, mat_idx=4)

        # Skewer 3 (right): Green vegetable leaves (folded bok choy)
        veg_pts = [
            (0.024, 0.015, 0.000, 0.015, 0.010, 0.013),
            (0.024, 0.033, 0.001, 0.016, 0.011, 0.014),
            (0.024, 0.049, 0.002, 0.014, 0.010, 0.012),
        ]
        for vx, vy, vz, rx, ry, rz in veg_pts:
            H.add_ellipsoid(bm_edible, (vx, vy, vz), rx, ry, rz, segs_u=16, segs_v=12, mat_idx=3)

        # Glossy chili oil glaze drips
        oil_pts = [
            (-0.022, 0.042, 0.012), (-0.024, 0.022, 0.011), (-0.020, 0.010, -0.010),
            (0.000, 0.052, 0.020), (0.010, 0.038, 0.015), (-0.008, 0.028, 0.014),
            (0.022, 0.044, 0.012), (0.024, 0.025, 0.011), (0.020, 0.012, -0.010),
        ]
        for ox, oy, oz in oil_pts:
            H.add_ellipsoid(bm_edible, (ox, oy, oz), 0.005, 0.003, 0.004, segs_u=8, segs_v=6, mat_idx=4)

        # White sesame seeds
        sesame_pts = [
            (-0.022, 0.046, 0.014), (-0.018, 0.032, 0.013), (-0.026, 0.018, 0.012),
            (0.005, 0.050, 0.022), (-0.005, 0.042, 0.018), (0.008, 0.026, 0.016),
            (0.022, 0.048, 0.014), (0.026, 0.035, 0.013), (0.020, 0.019, 0.012),
        ]
        for sx, sy, sz in sesame_pts:
            H.add_ellipsoid(bm_edible, (sx, sy, sz), 0.0016, 0.0010, 0.0016, segs_u=6, segs_v=4, mat_idx=5)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors (matching skewer contract)
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.120, 0.0), parent=root)
        H.make_empty('leftSupport', (0.025, -0.070, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.025, -0.070, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.055, 0.025), parent=root)

        glb_path = OUT_DIR / 'boboji.glb'
        png_path = OUT_DIR / 'boboji.png'

        if export_glb:
            export_meal_glb(root, glb_path)
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.0, -0.010, 0.0), 0.23, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'boboji', glb_path, png_path

    # =============================================================
    # 8. XIAJIAO (广东虾饺, cupped)
    # "Three crescent translucent ivory dumplings with pleated ridges and subtle peach shrimp core,
    # arranged in shallow ivory paper support."
    # =============================================================
    def build_xiajiao(export_glb=True, render_png=True):
        reset_scene()
        mats = [
            H.make_mat('mat_crystal_skin', 'f4ede3', roughness=0.30, specular=0.78),  # 0: translucent crystal dumpling wrapper
            H.make_mat('mat_pleats', 'ded3c1', roughness=0.35),                       # 1: pleated ridge creases
            H.make_mat('mat_shrimp_core', 'e88270', roughness=0.40, specular=0.65),  # 2: pink/peach tender shrimp core
            H.make_mat('mat_dimsum_paper', 'f6f3eb', roughness=0.85),                # 3: shallow ivory paper support liner
        ]

        root = bpy.data.objects.new('xiajiao', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # Shallow round dim sum parchment paper liner at bottom
        H.add_cylinder(bm_edible, (0.0, -0.025, 0.0), (0.0, -0.0235, 0.0), 0.075, segs=32, cap1=True, cap2=True, mat_idx=3)

        # Helper to construct crescent Har Gow dumpling with pleated back
        def add_har_gow(cx, cy, cz, rot_deg=(0, 0, 0), scale=1.0):
            rx, ry, rz = [math.radians(a) for a in rot_deg]
            R = Matrix.Rotation(rz, 3, 'Z') @ Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X')
            c_vec = Vector((cx, cy, cz))

            # Inner peach shrimp core
            shrimp_p = R @ Vector((0.0, 0.005 * scale, 0.002 * scale)) + c_vec
            H.add_ellipsoid(bm_edible, (shrimp_p.x, shrimp_p.y, shrimp_p.z),
                            0.020 * scale, 0.012 * scale, 0.014 * scale, segs_u=16, segs_v=10, mat_idx=2)

            # Translucent crystal wrapper (crescent shape)
            skin_p = R @ Vector((0.0, 0.006 * scale, 0.000)) + c_vec
            H.add_ellipsoid(bm_edible, (skin_p.x, skin_p.y, skin_p.z),
                            0.026 * scale, 0.016 * scale, 0.018 * scale, segs_u=20, segs_v=14, mat_idx=0)

            # Delicate pleated ridge folds on the outer curved back (+Y, -Z local)
            for ip in range(9):
                ang = -math.pi * 0.45 + (math.pi * 0.90 * ip / 8.0)
                lx = 0.024 * scale * math.sin(ang)
                ly = 0.018 * scale * math.cos(ang * 0.6)
                lz = -0.014 * scale * math.cos(ang)
                p_pleat = R @ Vector((lx, ly, lz)) + c_vec
                H.add_box(bm_edible, (p_pleat.x, p_pleat.y, p_pleat.z),
                          0.0035 * scale, 0.0040 * scale, 0.0025 * scale,
                          rot_deg=(rot_deg[0], rot_deg[1] + math.degrees(ang), rot_deg[2]), mat_idx=1)

        # Three dumplings arranged gracefully on the paper support
        # Dumpling 1 (left)
        add_har_gow(-0.038, -0.008, 0.015, rot_deg=(5, 30, 0), scale=1.0)
        # Dumpling 2 (right)
        add_har_gow(0.038, -0.008, 0.015, rot_deg=(5, -30, 0), scale=1.0)
        # Dumpling 3 (center top, elevated, crest reaching y = 0.050, z = 0.020)
        add_har_gow(0.000, 0.018, -0.010, rot_deg=(18, 0, 0), scale=1.06)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.050, 0.020), parent=root)

        glb_path = OUT_DIR / 'xiajiao.glb'
        png_path = OUT_DIR / 'xiajiao.png'

        if export_glb:
            export_meal_glb(root, glb_path)
            print(f'EXPORTED_GLB: {glb_path}')

        if render_png:
            render_thumbnail((0.0, 0.012, 0.0), 0.18, png_path)
            print(f'RENDERED_PNG: {png_path}')

        return 'xiajiao', glb_path, png_path

    # =============================================================
    # EXECUTION: PASS 1 (GLBs) THEN PASS 2 (PNG THUMBNAILS)
    # =============================================================
    builders = [
        ('nang', build_nang),
        ('zanba', build_zanba),
        ('shengjianbao', build_shengjianbao),
        ('tangou', build_tangou),
        ('ningbo-tangyuan', build_ningbo_tangyuan),
        ('mashu', build_mashu),
        ('boboji', build_boboji),
        ('xiajiao', build_xiajiao),
    ]

    selected_ids = []
    if '--' in sys.argv:
        idx = sys.argv.index('--')
        selected_ids = [a for a in sys.argv[idx + 1:] if not a.startswith('-')]

    active_builders = [(bid, fn) for bid, fn in builders if bid in selected_ids] if selected_ids else builders

    print(f'=== PASS 1: EXPORTING GLB MODELS ({len(active_builders)}) ===')
    for bid, fn in active_builders:
        fn(export_glb=True, render_png=False)

    print(f'=== PASS 2: RENDERING PNG THUMBNAILS ({len(active_builders)}) ===')
    for bid, fn in active_builders:
        fn(export_glb=False, render_png=True)

    print('ALL_BLENDER_TASKS_COMPLETE')


def optimize_png_thumbnails():
    """Optimizes rendered 256x256 PNG thumbnails to guarantee file size <= 28672 bytes."""
    print('Optimizing PNG thumbnails to <= 28672 bytes...')
    from PIL import Image

    for spec in SPECS:
        fid = spec['id']
        png_file = OUT_DIR / f"{fid}.png"
        if not png_file.exists():
            continue

        im = Image.open(png_file)
        im.save(png_file, 'PNG', optimize=True)
        sz = png_file.stat().st_size
        print(f'{fid}.png initial size: {sz} bytes')

        if sz > 28672:
            for n_colors in (256, 192, 128, 96, 64):
                im_q = im.quantize(colors=n_colors)
                im_q.save(png_file, 'PNG', optimize=True)
                sz = png_file.stat().st_size
                if sz <= 28672:
                    print(f'Quantized {fid}.png with {n_colors} colors -> {sz} bytes')
                    break


def run_node_verify_and_manifest():
    """Generates /home/baibai/outbox/pawborough-food-coverage-20261003/assets-c/verify.mjs

    and runs it using project's Node GLTFLoader to produce manifest.json.
    """
    verify_mjs_path = OUT_DIR / 'verify.mjs'

    mjs_code = """import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as THREE from '__PB_SNACK_PROJECT_ROOT__/node_modules/three/build/three.module.js';
import { GLTFLoader } from '__PB_SNACK_PROJECT_ROOT__/node_modules/three/examples/jsm/loaders/GLTFLoader.js';

const outDir = '/home/baibai/outbox/pawborough-food-coverage-20261003/assets-c';
const specs = """ + json.dumps(SPECS, indent=2, ensure_ascii=False) + """;

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
    milestone: 'pawborough-food-coverage-20261003',
    generatedAt: new Date().toISOString(),
    sourceScript: 'asset-authoring/snacks/national/build_coverage_c.py',
    renderStatus: 'rendered_cycles_software_256x256_transparent',
    verificationStatus: 'verified_node_gltf_loader_coverage_c',
    foods: []
  };

  for (const spec of specs) {
    const id = spec.id;
    const glbFilename = `${id}.glb`;
    const pngFilename = `${id}.png`;
    const glbPath = path.join(outDir, glbFilename);
    const pngPath = path.join(outDir, pngFilename);

    if (!fs.existsSync(glbPath)) throw new Error(`Missing ${glbPath}`);
    if (!fs.existsSync(pngPath)) throw new Error(`Missing ${pngPath}`);

    const glbStats = fs.statSync(glbPath);
    const pngStats = fs.statSync(pngPath);

    if (glbStats.size > 524288) throw new Error(`${id}.glb exceeds 524288 bytes: ${glbStats.size} bytes`);
    if (pngStats.size > 28672) throw new Error(`${id}.png exceeds 28672 bytes: ${pngStats.size} bytes`);

    // Verify PNG dimensions: 256x256
    const pngBuf = fs.readFileSync(pngPath);
    const pngW = pngBuf.readUInt32BE(16);
    const pngH = pngBuf.readUInt32BE(20);
    if (pngW !== 256 || pngH !== 256) throw new Error(`${id}.png dimensions not 256x256: ${pngW}x${pngH}`);

    const glbSha = sha256File(glbPath);
    const pngSha = sha256File(pngPath);

    const gltf = await parseGlb(glbPath);
    const root = gltf.scene.getObjectByName(id);
    if (!root) throw new Error(`${id}: missing root node with id name`);

    // Ensure no cameras or lights in exported GLB
    let cameraCount = 0;
    let lightCount = 0;
    root.traverse(child => {
      if (child.isCamera) cameraCount++;
      if (child.isLight) lightCount++;
    });
    if (cameraCount > 0 || lightCount > 0) {
      throw new Error(`${id} exported GLB contains cameras (${cameraCount}) or lights (${lightCount})`);
    }

    // Model bounds
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const min = [box.min.x, box.min.y, box.min.z];
    const max = [box.max.x, box.max.y, box.max.z];
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

    for (let i = 0; i < 3; i++) {
      if (!Number.isFinite(min[i]) || !Number.isFinite(max[i]) || !Number.isFinite(size[i])) {
        throw new Error(`${id} non-finite bounds`);
      }
    }

    // Size constraints: width <= 0.24m, height <= 0.30m (except skewer <= 0.35m)
    if (size[0] > 0.24) throw new Error(`${id} width exceeds 0.24m: ${size[0]}`);
    const maxHeight = spec.poseProfile === 'skewer' ? 0.35 : 0.30;
    if (size[1] > maxHeight) throw new Error(`${id} height exceeds ${maxHeight}m: ${size[1]}`);

    // Verify required parts
    const verifiedParts = [];
    for (const partName of spec.requiredParts) {
      const partObj = root.getObjectByName(partName);
      if (!partObj) throw new Error(`${id} missing required part: ${partName}`);
      verifiedParts.push(partName);
    }

    // Verify utensil & toolFood for bowl models
    if (spec.utensilKind !== null && spec.utensilKind !== 'none') {
      const utensil = root.getObjectByName('utensil');
      if (!utensil) throw new Error(`${id} missing utensil object`);
      const toolFood = utensil.getObjectByName('toolFood');
      if (!toolFood) throw new Error(`${id} utensil missing toolFood child`);
    }

    // Verify anchors
    const verifiedAnchors = {};
    for (const [anchorName, expectedPos] of Object.entries(spec.expectedAnchors)) {
      let anchorObj;
      if (anchorName === 'toolGrip' || anchorName === 'toolBite') {
        const utensil = root.getObjectByName('utensil');
        if (!utensil) throw new Error(`${id} missing utensil for anchor ${anchorName}`);
        anchorObj = utensil.getObjectByName(anchorName);
      } else {
        anchorObj = root.getObjectByName(anchorName);
      }

      if (!anchorObj) throw new Error(`${id} missing anchor: ${anchorName}`);
      const actualPos = anchorObj.position.toArray().map(v => Math.round(v * 10000) / 10000);
      verifiedAnchors[anchorName] = actualPos;

      for (let i = 0; i < 3; i++) {
        if (Math.abs(actualPos[i] - expectedPos[i]) > 0.005) {
          throw new Error(`${id} anchor ${anchorName}[${i}] mismatch: expected ${expectedPos[i]}, got ${actualPos[i]}`);
        }
      }
    }

    const foodEntry = {
      id: spec.id,
      name: spec.name,
      regionId: spec.regionId,
      poseProfile: spec.poseProfile,
      utensilKind: spec.utensilKind,
      path: glbFilename,
      bytes: glbStats.size,
      sha256: glbSha,
      thumbnail: {
        path: pngFilename,
        bytes: pngStats.size,
        sha256: pngSha
      },
      dimensionsM: {
        width: Math.round(size[0] * 10000) / 10000,
        height: Math.round(size[1] * 10000) / 10000,
        depth: Math.round(size[2] * 10000) / 10000,
        min: min.map(v => Math.round(v * 10000) / 10000),
        max: max.map(v => Math.round(v * 10000) / 10000),
        size: size.map(v => Math.round(v * 10000) / 10000)
      },
      anchors: verifiedAnchors,
      requiredParts: verifiedParts,
      sourceScript: 'asset-authoring/snacks/national/build_coverage_c.py'
    };

    manifest.foods.push(foodEntry);
    console.log(`[VERIFIED] ${id} (${spec.name}): GLB=${glbStats.size}B, PNG=${pngStats.size}B, w=${foodEntry.dimensionsM.width}m, h=${foodEntry.dimensionsM.height}m`);
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n');
  console.log('MANIFEST_WRITTEN:', manifestPath);
}

verifyAll().catch(err => {
  console.error('VERIFICATION_FAILED:', err);
  process.exit(1);
});
"""

    mjs_code = mjs_code.replace('__PB_SNACK_PROJECT_ROOT__', str(Path(__file__).resolve().parents[3]))
    verify_mjs_path.write_text(mjs_code, encoding='utf-8')
    print(f'Wrote verifier script to {verify_mjs_path}')

    node_cmd = ['node', str(verify_mjs_path)]
    print(f'Running independent Node GLTFLoader verification: {" ".join(node_cmd)}...')
    workroot = str(Path(__file__).resolve().parents[3])
    res = subprocess.run(node_cmd, capture_output=True, text=True, cwd=workroot)
    print(res.stdout)
    if res.returncode != 0:
        print(res.stderr, file=sys.stderr)
        sys.exit(res.returncode)

    print('ALL_FOODS_VERIFIED_AND_MANIFEST_GENERATED_SUCCESSFULLY!')


def main():
    try:
        import bpy
        # Running inside Blender python
        run_blender_build()
    except ImportError:
        # Running from standard python entrypoint
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        src_file = Path(__file__).resolve()

        print('=== STARTING BLENDER WORKER (Batch C: 8 foods) ===')
        env = os.environ.copy()
        env['CUDA_VISIBLE_DEVICES'] = ''

        cmd = [
            'blender',
            '--background',
            '--threads', '4',
            '--python', str(src_file)
        ]
        if '--' in sys.argv:
            idx = sys.argv.index('--')
            cmd.extend(sys.argv[idx:])

        res = subprocess.run(cmd, env=env)
        if res.returncode != 0:
            print(f'Blender worker failed with exit code {res.returncode}', file=sys.stderr)
            sys.exit(res.returncode)

        print('=== OPTIMIZING PNG THUMBNAILS ===')
        optimize_png_thumbnails()

        print('=== RUNNING NODE GLTFLOADER VERIFIER ===')
        run_node_verify_and_manifest()

        print('=== BATCH C COMPLETE ===')


if __name__ == '__main__':
    main()
