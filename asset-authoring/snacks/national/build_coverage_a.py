# -*- coding: utf-8 -*-
"""Build eight distinct candidate 3D meals (Wave A) for Pawborough coverage expansion:
1. lvrou-huoshao (hebei, wrapped) - 驴肉火烧
2. daoxiaomian (shanxi, bowl, chopsticks) - 刀削面
3. naidoufu (inner-mongolia, cupped) - 奶豆腐
4. shenyang-jijia (liaoning, wrapped) - 沈阳鸡架
5. jianbing-cong (shandong, wrapped) - 煎饼卷大葱
6. yaxue-fensi (jiangsu, bowl, chopsticks) - 鸭血粉丝汤
7. dingshenggao (zhejiang, cupped) - 定胜糕
8. maodoufu (anhui, bowl, chopsticks) - 毛豆腐

Outputs ONLY to:
/home/baibai/outbox/pawborough-food-coverage-20261003/assets-a/{id}.glb
/home/baibai/outbox/pawborough-food-coverage-20261003/assets-a/{id}.png
/home/baibai/outbox/pawborough-food-coverage-20261003/assets-a/manifest.json

GLB coordinate contract: Y-up, +Z cat-front.
Blender coordinate conversion: (x, y, z) -> (x, -z, y).
Limits:
- GLB <= 524288 bytes (512 KiB)
- PNG <= 28672 bytes (28 KiB) after palette quantization
- Materials <= 8 per food
- Width 0.16-0.22m, bowls 0.15m diam, max width 0.24m, height <= 0.30m
- Static geometry only; no floor/camera/light in GLB
"""
import os
import sys
import math
import json
import hashlib
import subprocess
from pathlib import Path

OUT_DIR = Path('/home/baibai/outbox/pawborough-food-coverage-20261003/assets-a')
SRC_PATH = Path(__file__).resolve()

# Target 8 foods specification
FOOD_SPECS = [
    {
        "id": "lvrou-huoshao",
        "name": "驴肉火烧",
        "regionId": "hebei",
        "poseProfile": "wrapped",
        "utensilKind": None,
        "visualIdentity": "Golden rectangular folded baked bread with exposed dark shredded meat and green pepper; open ivory paper cuff; distinct from round roujiamo.",
        "requiredParts": ["edible", "wrapper"],
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.025, 0.0],
            "leftSupport": [0.06, -0.025, 0.0],
            "rightSupport": [-0.06, -0.025, 0.0],
            "bite": [0.0, 0.06, 0.035]
        }
    },
    {
        "id": "daoxiaomian",
        "name": "刀削面",
        "regionId": "shanxi",
        "poseProfile": "bowl",
        "utensilKind": "chopsticks",
        "visualIdentity": "Wide tapering ribbon noodles, beef-red broth, scallion rounds; visibly different from round thin noodles.",
        "requiredParts": ["container", "edible", "utensil"],
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
        "id": "naidoufu",
        "name": "奶豆腐",
        "regionId": "inner-mongolia",
        "poseProfile": "cupped",
        "utensilKind": None,
        "visualIdentity": "Three ivory pressed milk curd slabs with clean rectangular cut faces and subtle browned top edges; no bowl.",
        "requiredParts": ["edible"],
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.025, 0.0],
            "leftSupport": [0.065, 0.0, 0.0],
            "rightSupport": [-0.065, 0.0, 0.0],
            "bite": [0.0, 0.05, 0.02]
        }
    },
    {
        "id": "shenyang-jijia",
        "name": "沈阳鸡架",
        "regionId": "liaoning",
        "poseProfile": "wrapped",
        "utensilKind": None,
        "visualIdentity": "Roasted irregular chicken frame portions with amber skin, sesame and exposed pale rib arcs; paper food sleeve; avoid generic skewers.",
        "requiredParts": ["container", "edible", "wrapper"],
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.025, 0.0],
            "leftSupport": [0.06, -0.025, 0.0],
            "rightSupport": [-0.06, -0.025, 0.0],
            "bite": [0.0, 0.06, 0.035]
        }
    },
    {
        "id": "jianbing-cong",
        "name": "煎饼卷大葱",
        "regionId": "shandong",
        "poseProfile": "wrapped",
        "utensilKind": None,
        "visualIdentity": "Tan layered rolled crepe with visible vivid green scallion stalk ends, open paper grip around lower half.",
        "requiredParts": ["edible", "wrapper"],
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.025, 0.0],
            "leftSupport": [0.06, -0.025, 0.0],
            "rightSupport": [-0.06, -0.025, 0.0],
            "bite": [0.0, 0.06, 0.035]
        }
    },
    {
        "id": "yaxue-fensi",
        "name": "鸭血粉丝汤",
        "regionId": "jiangsu",
        "poseProfile": "bowl",
        "utensilKind": "chopsticks",
        "visualIdentity": "Glass vermicelli translucent cream loops, dark maroon duck blood cubes, golden tofu puffs and coriander in pale broth.",
        "requiredParts": ["container", "edible", "utensil"],
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
        "id": "dingshenggao",
        "name": "定胜糕",
        "regionId": "zhejiang",
        "poseProfile": "cupped",
        "utensilKind": None,
        "visualIdentity": "Pair of pinkish white hourglass-shaped steamed rice cakes with clear narrow waist and flared square flower-like top; red bean stripe.",
        "requiredParts": ["edible"],
        "expectedAnchors": {
            "socket_grip": [0.0, 0.0, 0.0],
            "socket_rest": [0.0, -0.025, 0.0],
            "leftSupport": [0.065, 0.0, 0.0],
            "rightSupport": [-0.065, 0.0, 0.0],
            "bite": [0.0, 0.05, 0.02]
        }
    },
    {
        "id": "maodoufu",
        "name": "毛豆腐",
        "regionId": "anhui",
        "poseProfile": "bowl",
        "utensilKind": "chopsticks",
        "visualIdentity": "Golden seared tofu rectangles in shallow jade dish, crisp dark grilled patches, creamy fuzzy unseared face edges and red chili garnish.",
        "requiredParts": ["container", "edible", "utensil"],
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
    }
]


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

    def reset_scene():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.unit_settings.system = 'METRIC'

    # -------------------------------------------------------------
    # Shared Thumbnail Renderer (256x256, transparent, Cycles CPU, threads=4)
    # -------------------------------------------------------------
    def render_thumbnail(center_glb, target_size_m, out_png):
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = 16
        sc.cycles.device = 'CPU'
        sc.render.threads_mode = 'FIXED'
        sc.render.threads = 4
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

        # Key sun light
        key_data = bpy.data.lights.new('KeySun', 'SUN')
        key_data.energy = 3.5
        key_data.color = (1.0, 0.98, 0.94)
        key_obj = bpy.data.objects.new('KeySun', key_data)
        sc.collection.objects.link(key_obj)
        key_dir = H.glb_to_bl((-0.5, -0.9, -0.6)).normalized()
        key_obj.rotation_euler = key_dir.to_track_quat('-Z', 'Y').to_euler()

        # Fill light
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
    # Shared Helper: Ceramic Jade Bowl Container
    # Outer radius 0.075 (0.15m diam), height -0.025 to +0.020.
    # -------------------------------------------------------------
    def build_jade_bowl(root, mat_jade):
        bm_bowl = bmesh.new()
        segs_b = 32
        wall_thick = 0.0035
        outer_profile = [
            (-0.025, 0.038),
            (-0.022, 0.040),
            (-0.015, 0.052),
            (-0.005, 0.063),
            (0.010, 0.071),
            (0.020, 0.075),
        ]
        inner_profile = [
            (0.020, 0.075 - wall_thick),
            (0.010, 0.0675),
            (-0.005, 0.059),
            (-0.015, 0.048),
            (-0.0215, 0.034),
            (-0.0215, 0.0),
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
    # Shared Helper: Shallow Jade Dish Container (for maodoufu)
    # Outer radius 0.075, foot at -0.025, rim at +0.016.
    # -------------------------------------------------------------
    def build_shallow_dish(root, mat_dish):
        bm_dish = bmesh.new()
        segs_b = 32
        wall_thick = 0.003
        outer_profile = [
            (-0.025, 0.045),
            (-0.022, 0.046),
            (-0.012, 0.058),
            (-0.002, 0.067),
            (0.016, 0.075),
        ]
        inner_profile = [
            (0.016, 0.075 - wall_thick),
            (-0.001, 0.064),
            (-0.010, 0.054),
            (-0.018, 0.040),
            (-0.018, 0.0),
        ]

        all_rings = []
        for py, pr in outer_profile:
            ring = []
            for i in range(segs_b):
                th = 2.0 * math.pi * i / segs_b
                ring.append(bm_dish.verts.new(H.glb_to_bl((pr * math.cos(th), py, pr * math.sin(th)))))
            all_rings.append(ring)

        for py, pr in inner_profile[:-1]:
            ring = []
            for i in range(segs_b):
                th = 2.0 * math.pi * i / segs_b
                ring.append(bm_dish.verts.new(H.glb_to_bl((pr * math.cos(th), py, pr * math.sin(th)))))
            all_rings.append(ring)

        bm_dish.verts.ensure_lookup_table()
        for ir in range(len(all_rings) - 1):
            r1 = all_rings[ir]
            r2 = all_rings[ir + 1]
            for i in range(segs_b):
                inxt = (i + 1) % segs_b
                try:
                    bm_dish.faces.new([r1[i], r1[inxt], r2[inxt], r2[i]])
                except ValueError:
                    pass

        cen_in = bm_dish.verts.new(H.glb_to_bl((0, -0.018, 0)))
        last_inner = all_rings[-1]
        for i in range(segs_b):
            inxt = (i + 1) % segs_b
            try:
                bm_dish.faces.new([cen_in, last_inner[inxt], last_inner[i]])
            except ValueError:
                pass

        cen_out = bm_dish.verts.new(H.glb_to_bl((0, -0.025, 0)))
        first_outer = all_rings[0]
        for i in range(segs_b):
            inxt = (i + 1) % segs_b
            try:
                bm_dish.faces.new([cen_out, first_outer[i], first_outer[inxt]])
            except ValueError:
                pass

        return H.create_mesh_object('container', bm_dish, mat_dish, parent=root)

    # -------------------------------------------------------------
    # Shared Helper: Chopsticks Utensil (parallel blunt rods)
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
    # Extra Geometry Helpers
    # -------------------------------------------------------------
    def add_flat_ribbon(bm, pts_glb, width=0.010, thickness=0.002, mat_idx=0):
        """Creates a smooth flat ribbon (e.g. for noodles) along a list of 3D centerpoints."""
        if len(pts_glb) < 2:
            return
        segs = len(pts_glb)
        ring_verts = []
        for i in range(segs):
            p = Vector(pts_glb[i])
            if i == 0:
                tang = (Vector(pts_glb[1]) - p).normalized()
            elif i == segs - 1:
                tang = (p - Vector(pts_glb[i - 1])).normalized()
            else:
                tang = (Vector(pts_glb[i + 1]) - Vector(pts_glb[i - 1])).normalized()

            up = Vector((0, 1, 0)) if abs(tang.y) < 0.9 else Vector((0, 0, 1))
            side = tang.cross(up).normalized() * (width / 2.0)
            norm = tang.cross(side).normalized() * (thickness / 2.0)

            c_bl = H.glb_to_bl(p)
            s_bl = H.glb_to_bl(side)
            n_bl = H.glb_to_bl(norm)

            v0 = bm.verts.new(c_bl - s_bl - n_bl)
            v1 = bm.verts.new(c_bl + s_bl - n_bl)
            v2 = bm.verts.new(c_bl + s_bl + n_bl)
            v3 = bm.verts.new(c_bl - s_bl + n_bl)
            ring_verts.append((v0, v1, v2, v3))

        bm.verts.ensure_lookup_table()
        for i in range(segs - 1):
            r1 = ring_verts[i]
            r2 = ring_verts[i + 1]
            for j in range(4):
                jnxt = (j + 1) % 4
                try:
                    f = bm.faces.new([r1[j], r1[jnxt], r2[jnxt], r2[j]])
                    f.material_index = mat_idx
                except ValueError:
                    pass

        # End caps
        try:
            f0 = bm.faces.new([ring_verts[0][0], ring_verts[0][3], ring_verts[0][2], ring_verts[0][1]])
            f0.material_index = mat_idx
        except ValueError:
            pass
        try:
            f1 = bm.faces.new([ring_verts[-1][0], ring_verts[-1][1], ring_verts[-1][2], ring_verts[-1][3]])
            f1.material_index = mat_idx
        except ValueError:
            pass

    def add_tube_curve(bm, pts_glb, radius=0.003, segs_circ=8, mat_idx=0):
        """Creates a smooth round tube along a list of 3D centerpoints."""
        if len(pts_glb) < 2:
            return
        segs = len(pts_glb)
        rings = []
        for i in range(segs):
            p = Vector(pts_glb[i])
            if i == 0:
                tang = (Vector(pts_glb[1]) - p).normalized()
            elif i == segs - 1:
                tang = (p - Vector(pts_glb[i - 1])).normalized()
            else:
                tang = (Vector(pts_glb[i + 1]) - Vector(pts_glb[i - 1])).normalized()

            up = Vector((0, 1, 0)) if abs(tang.y) < 0.9 else Vector((0, 0, 1))
            side = tang.cross(up).normalized() * radius
            norm = tang.cross(side).normalized() * radius

            c_bl = H.glb_to_bl(p)
            s_bl = H.glb_to_bl(side)
            n_bl = H.glb_to_bl(norm)

            ring = []
            for ic in range(segs_circ):
                th = 2.0 * math.pi * ic / segs_circ
                pt = c_bl + s_bl * math.cos(th) + n_bl * math.sin(th)
                ring.append(bm.verts.new(pt))
            rings.append(ring)

        bm.verts.ensure_lookup_table()
        for i in range(segs - 1):
            r1 = rings[i]
            r2 = rings[i + 1]
            for ic in range(segs_circ):
                icnxt = (ic + 1) % segs_circ
                try:
                    f = bm.faces.new([r1[ic], r1[icnxt], r2[icnxt], r2[ic]])
                    f.material_index = mat_idx
                except ValueError:
                    pass

        # End caps
        c0 = bm.verts.new(H.glb_to_bl(pts_glb[0]))
        for ic in range(segs_circ):
            icnxt = (ic + 1) % segs_circ
            try:
                f = bm.faces.new([c0, rings[0][icnxt], rings[0][ic]])
                f.material_index = mat_idx
            except ValueError:
                pass
        c1 = bm.verts.new(H.glb_to_bl(pts_glb[-1]))
        for ic in range(segs_circ):
            icnxt = (ic + 1) % segs_circ
            try:
                f = bm.faces.new([c1, rings[-1][ic], rings[-1][icnxt]])
                f.material_index = mat_idx
            except ValueError:
                pass

    def add_ring(bm, center_glb, radius_major=0.005, radius_minor=0.0015, axis='Y', segs_major=16, segs_minor=8, mat_idx=0):
        """Creates a torus/ring (e.g. scallion round)."""
        cx, cy, cz = center_glb
        verts_grid = []
        for im in range(segs_major):
            th_m = 2.0 * math.pi * im / segs_major
            row = []
            if axis == 'Y':
                cm = Vector((cx + radius_major * math.cos(th_m), cy, cz + radius_major * math.sin(th_m)))
                rad_dir = Vector((math.cos(th_m), 0, math.sin(th_m)))
                up_dir = Vector((0, 1, 0))
            else:
                cm = Vector((cx + radius_major * math.cos(th_m), cy + radius_major * math.sin(th_m), cz))
                rad_dir = Vector((math.cos(th_m), math.sin(th_m), 0))
                up_dir = Vector((0, 0, 1))

            for jm in range(segs_minor):
                th_j = 2.0 * math.pi * jm / segs_minor
                pt = cm + (rad_dir * math.cos(th_j) + up_dir * math.sin(th_j)) * radius_minor
                row.append(bm.verts.new(H.glb_to_bl(pt)))
            verts_grid.append(row)

        bm.verts.ensure_lookup_table()
        for im in range(segs_major):
            im_next = (im + 1) % segs_major
            r1 = verts_grid[im]
            r2 = verts_grid[im_next]
            for jm in range(segs_minor):
                jm_next = (jm + 1) % segs_minor
                try:
                    f = bm.faces.new([r1[jm], r1[jm_next], r2[jm_next], r2[jm]])
                    f.material_index = mat_idx
                except ValueError:
                    pass

    # =============================================================
    # 1. LVROU-HUOSHAO (hebei, wrapped)
    # Golden rectangular folded baked bread with exposed dark shredded meat and green pepper;
    # open ivory paper cuff; distinct from round roujiamo.
    # =============================================================
    def build_lvrou_huoshao():
        reset_scene()
        mats = [
            H.make_mat('mat_crust', 'cb8a3c', roughness=0.55),
            H.make_mat('mat_toast', '7e3d12', roughness=0.50),
            H.make_mat('mat_meat', '441c10', roughness=0.40, specular=0.65),
            H.make_mat('mat_pepper', '298c1e', roughness=0.35, specular=0.7),
            H.make_mat('mat_paper', 'eee6d6', roughness=0.80),
        ]

        root = bpy.data.objects.new('lvrou-huoshao', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # Golden rectangular folded bread pocket:
        # Spans X from -0.078 to +0.078 (width 0.156m)
        # Height Y from -0.020 to +0.065 (top edge passes bite y=0.060, z=0.035)
        # Thickness Z from -0.020 to +0.020
        # Main rectangular baked body with rounded bevels
        segs_x = 24
        xs = [-0.078 + (0.156 * i / segs_x) for i in range(segs_x + 1)]
        # Profile: starts inside top fold, rounds down back, loops bottom at y=-0.020, rises front to top slit opening
        profile_yz = [
            (0.040, -0.012),  # inner pocket top back
            (0.062, -0.016),  # upper back crest
            (0.050, -0.020),  # upper back outer
            (0.015, -0.022),  # mid back
            (-0.015, -0.018), # lower back
            (-0.020, -0.008), # bottom rear
            (-0.020, 0.008),  # bottom front
            (-0.015, 0.018),  # lower front
            (0.015, 0.022),   # mid front
            (0.040, 0.020),   # upper front lip below slit
            (0.036, 0.010),   # inner front fold
        ]
        grid = []
        for ix, x in enumerate(xs):
            row = []
            x_factor = 1.0 - (2.0 * abs(x) / 0.160) ** 4
            for py, pz in profile_yz:
                pz_mod = pz * (0.85 + 0.15 * x_factor)
                if abs(x) > 0.070:
                    py_mod = py - 0.006 * (abs(x) - 0.070) / 0.008
                else:
                    py_mod = py
                row.append(bm_edible.verts.new(H.glb_to_bl((x, py_mod, pz_mod))))
            grid.append(row)

        bm_edible.verts.ensure_lookup_table()
        for ix in range(segs_x):
            r1 = grid[ix]
            r2 = grid[ix + 1]
            for ip in range(len(profile_yz) - 1):
                try:
                    f = bm_edible.faces.new([r1[ip], r1[ip + 1], r2[ip + 1], r2[ip]])
                    f.material_index = 0
                except ValueError:
                    pass

        # Side end caps
        for end_row, rev in [(grid[0], True), (grid[-1], False)]:
            verts_cap = [end_row[k] for k in [1, 2, 3, 4, 5, 6, 7, 8, 9]]
            if rev:
                verts_cap.reverse()
            try:
                f = bm_edible.faces.new(verts_cap)
                f.material_index = 0
            except ValueError:
                pass

        # Crispy toasted blister spots on top/front crust
        blisters = [
            (-0.052, 0.048, -0.018, 0.012, 0.006, 0.003),
            (-0.020, 0.058, -0.016, 0.015, 0.005, 0.003),
            (0.025, 0.056, -0.017, 0.014, 0.006, 0.003),
            (0.055, 0.046, -0.018, 0.010, 0.005, 0.003),
            (-0.035, 0.022, 0.022, 0.014, 0.007, 0.002),
            (0.015, 0.025, 0.022, 0.016, 0.006, 0.002),
            (0.048, 0.018, 0.021, 0.012, 0.005, 0.002),
        ]
        for bx, by, bz, rx, ry, rz in blisters:
            H.add_ellipsoid(bm_edible, (bx, by, bz), rx, ry, rz, segs_u=8, segs_v=6, mat_idx=1)

        # Exposed dark shredded donkey meat filling bursting from top slit:
        # Covers X from -0.065 to +0.065, height Y from 0.035 to 0.064, Z from -0.006 to +0.022
        meat_coords = [
            (-0.050, 0.045, 0.006, 0.018, 0.009, 0.008),
            (-0.030, 0.052, 0.009, 0.020, 0.011, 0.010),
            (-0.010, 0.058, 0.012, 0.022, 0.012, 0.011),
            (0.010, 0.056, 0.013, 0.022, 0.012, 0.011),
            (0.032, 0.050, 0.010, 0.020, 0.010, 0.010),
            (0.050, 0.044, 0.007, 0.016, 0.008, 0.008),
            # Front bulging shredded clusters reaching towards bite (0, 0.06, 0.035)
            (0.000, 0.060, 0.026, 0.016, 0.009, 0.010),
            (-0.020, 0.055, 0.022, 0.014, 0.008, 0.009),
            (0.022, 0.054, 0.024, 0.015, 0.008, 0.009),
        ]
        for mx, my, mz, rx, ry, rz in meat_coords:
            H.add_ellipsoid(bm_edible, (mx, my, mz), rx, ry, rz, segs_u=10, segs_v=8, mat_idx=2)

        # Shredded meat fiber strips
        for sx, sy, sz, lx, ly, lz in [
            (-0.040, 0.055, 0.012, 0.025, 0.004, 0.004),
            (-0.015, 0.062, 0.018, 0.028, 0.005, 0.005),
            (0.015, 0.061, 0.020, 0.026, 0.005, 0.005),
            (0.035, 0.052, 0.015, 0.024, 0.004, 0.004),
        ]:
            H.add_box(bm_edible, (sx, sy, sz), lx, ly, lz, rot_deg=(5, 12, -4), mat_idx=2)

        # Fresh green pepper slivers/dices
        pepper_pts = [
            (-0.042, 0.052, 0.016), (-0.025, 0.058, 0.020), (-0.008, 0.062, 0.028),
            (0.008, 0.061, 0.030), (0.024, 0.057, 0.026), (0.040, 0.050, 0.018),
            (-0.018, 0.050, 0.014), (0.016, 0.052, 0.016), (-0.032, 0.046, 0.012),
            (0.032, 0.045, 0.014), (0.000, 0.056, 0.022),
        ]
        for px, py, pz in pepper_pts:
            H.add_box(bm_edible, (px, py, pz), 0.005, 0.004, 0.005, rot_deg=(12, 25, 8), mat_idx=3)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats[:4], parent=root)

        # Open ivory paper cuff (wrapper) wrapping lower grip only (y from -0.025 to +0.018)
        bm_wrapper = bmesh.new()
        segs_w = 20
        xs_w = [-0.082 + (0.164 * i / segs_w) for i in range(segs_w + 1)]
        cuff_yz = [
            (0.018, -0.024),
            (-0.010, -0.025),
            (-0.025, -0.015),
            (-0.025, 0.015),
            (-0.010, 0.025),
            (0.018, 0.024),
        ]
        w_grid = []
        for ix, x in enumerate(xs_w):
            row = []
            for py, pz in cuff_yz:
                row.append(bm_wrapper.verts.new(H.glb_to_bl((x, py, pz))))
            w_grid.append(row)

        bm_wrapper.verts.ensure_lookup_table()
        for ix in range(segs_w):
            r1 = w_grid[ix]
            r2 = w_grid[ix + 1]
            for ip in range(len(cuff_yz) - 1):
                try:
                    f = bm_wrapper.faces.new([r1[ip], r1[ip + 1], r2[ip + 1], r2[ip]])
                    f.material_index = 0
                except ValueError:
                    pass

        # Wrapper side flaps
        for end_row, rev in [(w_grid[0], True), (w_grid[-1], False)]:
            verts_cap = [end_row[k] for k in range(len(cuff_yz))]
            if rev:
                verts_cap.reverse()
            try:
                f = bm_wrapper.faces.new(verts_cap)
                f.material_index = 0
            except ValueError:
                pass

        wrapper_obj = H.create_mesh_object('wrapper', bm_wrapper, mats[4], parent=root)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.06, -0.025, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.06, -0.025, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.06, 0.035), parent=root)

        return root, (0.0, 0.025, 0.0), 0.18

    # =============================================================
    # 2. DAOXIAOMIAN (shanxi, bowl, chopsticks)
    # Wide tapering ribbon noodles, beef-red broth, scallion rounds;
    # visibly different from round thin noodles.
    # =============================================================
    def build_daoxiaomian():
        reset_scene()
        mats = [
            H.make_mat('mat_bowl', 'c6ded2', roughness=0.18, specular=0.85),
            H.make_mat('mat_broth', '781e0e', roughness=0.15, specular=0.9),
            H.make_mat('mat_noodle', 'f7f0e0', roughness=0.55),
            H.make_mat('mat_beef', '42180e', roughness=0.45),
            H.make_mat('mat_scallion', '2ea020', roughness=0.35),
            H.make_mat('mat_chopsticks', '382215', roughness=0.40),
        ]

        root = bpy.data.objects.new('daoxiaomian', None)
        bpy.context.collection.objects.link(root)

        # Container: Jade bowl
        build_jade_bowl(root, mats[0])

        # Edible: Broth disc + Shanxi wide tapering ribbon noodles + braised beef + scallion rounds
        bm_edible = bmesh.new()

        # Soup disc at y = 0.012
        segs_soup = 32
        r_soup = 0.069
        c_soup = bm_edible.verts.new(H.glb_to_bl((0.0, 0.012, 0.0)))
        soup_ring = []
        for i in range(segs_soup):
            th = 2.0 * math.pi * i / segs_soup
            soup_ring.append(bm_edible.verts.new(H.glb_to_bl((r_soup * math.cos(th), 0.012, r_soup * math.sin(th)))))
        bm_edible.verts.ensure_lookup_table()
        for i in range(segs_soup):
            inxt = (i + 1) % segs_soup
            try:
                f = bm_edible.faces.new([c_soup, soup_ring[i], soup_ring[inxt]])
                f.material_index = 1
            except ValueError:
                pass

        # Shanxi knife-cut noodles (wide flat tapering willow-leaf strips)
        noodle_splines = [
            [(-0.048, 0.015, -0.020), (-0.025, 0.026, -0.015), (0.005, 0.028, -0.010), (0.035, 0.024, -0.005), (0.052, 0.016, -0.002)],
            [(-0.040, 0.016, 0.010), (-0.018, 0.027, 0.018), (0.012, 0.030, 0.020), (0.038, 0.026, 0.016), (0.050, 0.015, 0.008)],
            [(-0.025, 0.015, -0.045), (-0.010, 0.028, -0.025), (0.002, 0.031, 0.000), (0.015, 0.028, 0.025), (0.022, 0.016, 0.045)],
            [(-0.035, 0.016, -0.030), (-0.022, 0.025, -0.005), (-0.005, 0.029, 0.012), (0.020, 0.024, 0.028), (0.042, 0.016, 0.035)],
            [(-0.050, 0.015, 0.000), (-0.028, 0.024, -0.018), (0.000, 0.028, -0.028), (0.026, 0.026, -0.022), (0.046, 0.015, -0.015)],
            [(0.035, 0.016, -0.035), (0.015, 0.027, -0.012), (-0.010, 0.030, 0.005), (-0.030, 0.025, 0.022), (-0.045, 0.015, 0.035)],
            [(-0.015, 0.016, -0.048), (-0.005, 0.026, -0.020), (0.010, 0.031, 0.002), (0.022, 0.027, 0.022), (0.030, 0.016, 0.045)],
            [(-0.042, 0.015, 0.025), (-0.020, 0.026, 0.005), (0.005, 0.029, -0.008), (0.028, 0.026, -0.012), (0.048, 0.015, -0.022)],
        ]
        for spl in noodle_splines:
            add_flat_ribbon(bm_edible, spl, width=0.012, thickness=0.0024, mat_idx=2)

        # Braised beef cubes in center
        beef_blocks = [
            (-0.018, 0.026, -0.005, 0.014, 0.012, 0.014, (6, 15, -4)),
            (0.012, 0.028, -0.008, 0.016, 0.013, 0.015, (-4, 20, 8)),
            (-0.005, 0.030, 0.015, 0.015, 0.012, 0.013, (12, -8, 10)),
            (0.018, 0.025, 0.012, 0.013, 0.011, 0.012, (-10, 5, -6)),
            (-0.026, 0.024, 0.008, 0.012, 0.010, 0.011, (5, -12, 4)),
        ]
        for bx, by, bz, lx, ly, lz, rot in beef_blocks:
            H.add_box(bm_edible, (bx, by, bz), lx, ly, lz, rot_deg=rot, mat_idx=3)

        # Crisp scallion rings scattered on top
        scallion_locs = [
            (-0.035, 0.028, -0.012), (-0.015, 0.032, -0.022), (0.010, 0.031, -0.025),
            (0.028, 0.027, -0.015), (-0.025, 0.031, 0.022), (0.000, 0.033, 0.028),
            (0.025, 0.030, 0.022), (-0.008, 0.032, -0.002), (0.015, 0.032, 0.005),
            (0.032, 0.024, 0.005), (-0.038, 0.025, 0.008), (0.005, 0.029, -0.016),
        ]
        for sx, sy, sz in scallion_locs:
            add_ring(bm_edible, (sx, sy, sz), radius_major=0.0035, radius_minor=0.0012, axis='Y', mat_idx=4)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats[1:5], parent=root)

        # Utensil: Chopsticks with knife-cut ribbon noodle morsel
        def add_daoxiaomian_morsel(utensil_obj):
            bm_tf = bmesh.new()
            # Wide tapering noodle strip folded over chopstick tips
            noodle_fold = [
                (-0.002, 0.002, -0.008),
                (0.000, 0.003, -0.002),
                (0.002, 0.002, 0.005),
                (0.000, -0.001, 0.009),
            ]
            add_flat_ribbon(bm_tf, noodle_fold, width=0.008, thickness=0.002, mat_idx=0)
            # Scallion speck
            H.add_cylinder(bm_tf, (0.001, 0.0035, 0.001), (0.001, 0.005, 0.001), 0.0016, segs=8, mat_idx=1)
            toolFood = H.create_mesh_object('toolFood', bm_tf, [mats[2], mats[4]], parent=utensil_obj)
            toolFood.location = Vector((0.0, -0.106, 0.001))

        build_chopsticks_utensil(root, mats[5], add_daoxiaomian_morsel)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)

        return root, (0.0, 0.020, 0.0), 0.18

    # =============================================================
    # 3. NAIDOUFU (inner-mongolia, cupped)
    # Three ivory pressed milk curd slabs with clean rectangular cut faces
    # and subtle browned top edges; no bowl.
    # =============================================================
    def build_naidoufu():
        reset_scene()
        mats = [
            H.make_mat('mat_curd', 'faf5e4', roughness=0.65),
            H.make_mat('mat_curd_brown', 'b67b34', roughness=0.58),
            H.make_mat('mat_butter', 'f4e09e', roughness=0.45, specular=0.6),
        ]

        root = bpy.data.objects.new('naidoufu', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # Three pressed milk curd slabs:
        # Sits at bottom y ~ -0.025, reaches bite at [0.0, 0.05, 0.02]
        # Slab dimensions: length ~0.082m, width ~0.045m, thickness ~0.019m
        # Slabs arranged in a handsome overlapping fan
        slabs = [
            # 1: Left-rear slab
            ((-0.042, 0.010, -0.015), 0.078, 0.020, 0.044, (8, -12, 6)),
            # 2: Center main slab (passes bite y=0.050, z=0.020)
            ((0.000, 0.018, 0.005), 0.082, 0.020, 0.046, (-4, 2, -2)),
            # 3: Right-front slab
            ((0.042, 0.010, 0.016), 0.078, 0.020, 0.044, (-8, 14, -6)),
        ]
        for sc, sx, sy, sz, srot in slabs:
            H.add_box(bm_edible, sc, sx, sy, sz, rot_deg=srot, mat_idx=0)
            # Subtle browned toasted edges on top face
            rx, ry, rz = srot
            top_y_off = sy / 2.0 + 0.0008
            H.add_box(bm_edible, (sc[0], sc[1] + top_y_off, sc[2]), sx * 0.94, 0.0016, sz * 0.94, rot_deg=srot, mat_idx=1)
            # Decorative pressed lattice grooves / butter highlights
            for g_off in (-0.020, 0.0, 0.020):
                H.add_box(bm_edible, (sc[0] + g_off, sc[1] + top_y_off + 0.0005, sc[2]), 0.0025, 0.0012, sz * 0.85, rot_deg=srot, mat_idx=2)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.05, 0.02), parent=root)

        return root, (0.0, 0.020, 0.0), 0.18

    # =============================================================
    # 4. SHENYANG-JIJIA (liaoning, wrapped)
    # Roasted irregular chicken frame portions with amber skin, sesame
    # and exposed pale rib arcs; paper food sleeve; avoid generic skewers.
    # =============================================================
    def build_shenyang_jijia():
        reset_scene()
        mats = [
            H.make_mat('mat_amber_skin', 'b45214', roughness=0.32, specular=0.75),
            H.make_mat('mat_roast_meat', '56200e', roughness=0.45),
            H.make_mat('mat_bone', 'ebe4d4', roughness=0.60),
            H.make_mat('mat_sesame', 'f5eee0', roughness=0.50),
            H.make_mat('mat_spice', '982210', roughness=0.55),
            H.make_mat('mat_sleeve', 'd4b88e', roughness=0.80),
        ]

        root = bpy.data.objects.new('shenyang-jijia', None)
        bpy.context.collection.objects.link(root)

        bm_container = bmesh.new()

        # Roasted chicken skeleton frame portions:
        # Central vertebral/keel bone axis running Y from -0.010 to +0.065
        keel_pts = [
            (0.000, -0.010, -0.005),
            (0.002, 0.015, 0.000),
            (0.000, 0.040, 0.012),
            (-0.002, 0.062, 0.026),
        ]
        add_tube_curve(bm_container, keel_pts, radius=0.009, segs_circ=8, mat_idx=1)

        # Curved pale rib bone arcs protruding through savory meat
        rib_splines = [
            # Left ribs
            [(0.000, 0.015, 0.002), (-0.025, 0.020, 0.012), (-0.052, 0.028, 0.010), (-0.068, 0.038, 0.004)],
            [(0.000, 0.030, 0.008), (-0.028, 0.036, 0.020), (-0.055, 0.046, 0.016), (-0.070, 0.054, 0.008)],
            [(0.000, 0.045, 0.015), (-0.025, 0.052, 0.028), (-0.048, 0.060, 0.024), (-0.060, 0.066, 0.015)],
            # Right ribs
            [(0.000, 0.015, 0.002), (0.025, 0.020, 0.012), (0.052, 0.028, 0.010), (0.068, 0.038, 0.004)],
            [(0.000, 0.030, 0.008), (0.028, 0.036, 0.020), (0.055, 0.046, 0.016), (0.070, 0.054, 0.008)],
            [(0.000, 0.045, 0.015), (0.025, 0.052, 0.028), (0.048, 0.060, 0.024), (0.060, 0.066, 0.015)],
        ]
        for r_spl in rib_splines:
            add_tube_curve(bm_container, r_spl, radius=0.0032, segs_circ=8, mat_idx=2)

        container_obj = H.create_mesh_object('container', bm_container, mats[:5], parent=root)

        bm_edible = bmesh.new()

        # Savory roasted chicken meat & amber caramelized skin clinging to frame
        meat_portions = [
            ((0.000, 0.025, 0.010), 0.025, 0.020, 0.018),
            ((-0.032, 0.035, 0.012), 0.022, 0.016, 0.015),
            ((0.032, 0.035, 0.012), 0.022, 0.016, 0.015),
            ((-0.022, 0.052, 0.022), 0.018, 0.014, 0.014),
            ((0.022, 0.052, 0.022), 0.018, 0.014, 0.014),
            # Apex portion passing bite [0, 0.06, 0.035]
            ((0.000, 0.060, 0.030), 0.018, 0.012, 0.014),
        ]
        for mc, rx, ry, rz in meat_portions:
            H.add_ellipsoid(bm_edible, mc, rx, ry, rz, segs_u=10, segs_v=8, mat_idx=0)

        # White sesame seeds sprinkled over amber roasted skin
        sesame_coords = [
            (-0.018, 0.058, 0.028), (-0.006, 0.062, 0.032), (0.008, 0.061, 0.033),
            (0.020, 0.056, 0.028), (-0.028, 0.048, 0.022), (0.028, 0.048, 0.022),
            (0.000, 0.052, 0.024), (-0.012, 0.042, 0.018), (0.015, 0.042, 0.018),
            (-0.038, 0.038, 0.018), (0.038, 0.038, 0.018), (0.000, 0.032, 0.015),
        ]
        for sx, sy, sz in sesame_coords:
            H.add_ellipsoid(bm_edible, (sx, sy, sz), 0.0016, 0.0010, 0.0022, segs_u=6, segs_v=5, mat_idx=3)

        # Chili powder / spice flecks
        spice_coords = [
            (-0.010, 0.055, 0.030), (0.012, 0.058, 0.031), (-0.022, 0.052, 0.026),
            (0.022, 0.052, 0.026), (0.000, 0.045, 0.020), (-0.030, 0.040, 0.020),
            (0.030, 0.040, 0.020),
        ]
        for px, py, pz in spice_coords:
            H.add_box(bm_edible, (px, py, pz), 0.003, 0.002, 0.003, rot_deg=(8, 15, 6), mat_idx=4)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats[:5], parent=root)

        # Paper food sleeve (wrapper) wrapping lower grip only (y from -0.025 to +0.015)
        bm_sleeve = bmesh.new()
        segs_sl = 20
        xs_sl = [-0.082 + (0.164 * i / segs_sl) for i in range(segs_sl + 1)]
        sleeve_yz = [
            (0.015, -0.025),
            (-0.010, -0.026),
            (-0.025, -0.018),
            (-0.025, 0.018),
            (-0.010, 0.026),
            (0.015, 0.025),
        ]
        sl_grid = []
        for ix, x in enumerate(xs_sl):
            row = []
            for py, pz in sleeve_yz:
                row.append(bm_sleeve.verts.new(H.glb_to_bl((x, py, pz))))
            sl_grid.append(row)

        bm_sleeve.verts.ensure_lookup_table()
        for ix in range(segs_sl):
            r1 = sl_grid[ix]
            r2 = sl_grid[ix + 1]
            for ip in range(len(sleeve_yz) - 1):
                try:
                    f = bm_sleeve.faces.new([r1[ip], r1[ip + 1], r2[ip + 1], r2[ip]])
                    f.material_index = 0
                except ValueError:
                    pass

        for end_row, rev in [(sl_grid[0], True), (sl_grid[-1], False)]:
            verts_cap = [end_row[k] for k in range(len(sleeve_yz))]
            if rev:
                verts_cap.reverse()
            try:
                f = bm_sleeve.faces.new(verts_cap)
                f.material_index = 0
            except ValueError:
                pass

        wrapper_obj = H.create_mesh_object('wrapper', bm_sleeve, mats[5], parent=root)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.06, -0.025, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.06, -0.025, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.06, 0.035), parent=root)

        return root, (0.0, 0.025, 0.0), 0.18

    # =============================================================
    # 5. JIANBING-CONG (shandong, wrapped)
    # Tan layered rolled crepe with visible vivid green scallion stalk ends,
    # open paper grip around lower half.
    # =============================================================
    def build_jianbing_cong():
        reset_scene()
        mats = [
            H.make_mat('mat_crepe', 'cba570', roughness=0.65),
            H.make_mat('mat_crepe_toast', '966632', roughness=0.60),
            H.make_mat('mat_sauce', '3a1a0c', roughness=0.35, specular=0.7),
            H.make_mat('mat_scallion_white', 'ebf4e2', roughness=0.45),
            H.make_mat('mat_scallion_green', '1f7a20', roughness=0.35, specular=0.65),
            H.make_mat('mat_paper', 'eee7d8', roughness=0.80),
        ]

        root = bpy.data.objects.new('jianbing-cong', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # Rolled Shandong grain crepe (pair of tight rolls side by side):
        # Spans X from -0.075 to +0.075 (width 0.150m)
        # Height Y from -0.020 to +0.052
        for roll_idx, xc in enumerate((-0.038, 0.038)):
            segs_th = 20
            segs_len = 16
            ys_roll = [-0.020 + (0.072 * i / segs_len) for i in range(segs_len + 1)]
            grid_roll = []
            for iy, y in enumerate(ys_roll):
                row = []
                for ith in range(segs_th):
                    th = 2.0 * math.pi * ith / segs_th
                    rx = 0.030
                    rz = 0.022
                    px = xc + rx * math.cos(th)
                    pz = rz * math.sin(th)
                    # Overlap spiral ridge
                    if 0.2 * math.pi < th < 0.45 * math.pi:
                        px += 0.0018 * math.cos(th)
                        pz += 0.0018 * math.sin(th)
                    row.append(bm_edible.verts.new(H.glb_to_bl((px, y, pz))))
                grid_roll.append(row)

            bm_edible.verts.ensure_lookup_table()
            for iy in range(segs_len):
                r1 = grid_roll[iy]
                r2 = grid_roll[iy + 1]
                for ith in range(segs_th):
                    ith_nxt = (ith + 1) % segs_th
                    try:
                        f = bm_edible.faces.new([r1[ith], r1[ith_nxt], r2[ith_nxt], r2[ith]])
                        f.material_index = 0
                    except ValueError:
                        pass

            # Bottom cap
            try:
                fb = bm_edible.faces.new([grid_roll[0][k] for k in range(segs_th)])
                fb.material_index = 0
            except ValueError:
                pass

            # Dark sweet bean sauce brush in spiral core
            H.add_cylinder(bm_edible, (xc, 0.030, 0.0), (xc, 0.052, 0.0), 0.009, segs=10, mat_idx=2)

        # Toasted blister spots on crepe body
        blister_pts = [
            (-0.045, 0.015, 0.022), (-0.030, 0.035, 0.021), (-0.048, 0.045, 0.018),
            (0.045, 0.015, 0.022), (0.030, 0.035, 0.021), (0.048, 0.045, 0.018),
            (-0.035, -0.005, 0.020), (0.035, -0.005, 0.020),
        ]
        for bx, by, bz in blister_pts:
            H.add_ellipsoid(bm_edible, (bx, by, bz), 0.012, 0.006, 0.0025, segs_u=8, segs_v=6, mat_idx=1)

        # Whole fresh scallions (大葱) projecting prominently out of top opening:
        # Lower white stem from y = 0.035 to 0.052
        # Upper emerald green leafy stalks reaching up to y = 0.068, passing bite [0, 0.06, 0.035]!
        scallion_stems = [
            # Roll 1 (left)
            [(-0.038, 0.035, 0.002), (-0.036, 0.048, 0.008), (-0.032, 0.058, 0.018), (-0.025, 0.066, 0.028)],
            [(-0.045, 0.038, -0.004), (-0.048, 0.050, 0.002), (-0.052, 0.062, 0.012), (-0.055, 0.068, 0.020)],
            # Roll 2 (right)
            [(0.038, 0.035, 0.002), (0.036, 0.048, 0.008), (0.032, 0.058, 0.018), (0.025, 0.066, 0.028)],
            [(0.045, 0.038, -0.004), (0.048, 0.050, 0.002), (0.052, 0.062, 0.012), (0.055, 0.068, 0.020)],
            # Central arching stalk pointing directly towards bite [0, 0.06, 0.035]
            [(0.000, 0.040, 0.008), (0.000, 0.052, 0.020), (0.000, 0.062, 0.032), (0.000, 0.068, 0.038)],
        ]
        for s_idx, s_spl in enumerate(scallion_stems):
            # Lower half white
            add_tube_curve(bm_edible, s_spl[:2], radius=0.0055, segs_circ=8, mat_idx=3)
            # Upper half vivid green
            add_tube_curve(bm_edible, s_spl[1:], radius=0.0048, segs_circ=8, mat_idx=4)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats[:5], parent=root)

        # Paper grip (wrapper) wrapping lower grip only (y from -0.025 to +0.016)
        bm_paper = bmesh.new()
        segs_pw = 20
        xs_pw = [-0.080 + (0.160 * i / segs_pw) for i in range(segs_pw + 1)]
        paper_yz = [
            (0.016, -0.026),
            (-0.010, -0.027),
            (-0.025, -0.018),
            (-0.025, 0.018),
            (-0.010, 0.027),
            (0.016, 0.026),
        ]
        p_grid = []
        for ix, x in enumerate(xs_pw):
            row = []
            for py, pz in paper_yz:
                row.append(bm_paper.verts.new(H.glb_to_bl((x, py, pz))))
            p_grid.append(row)

        bm_paper.verts.ensure_lookup_table()
        for ix in range(segs_pw):
            r1 = p_grid[ix]
            r2 = p_grid[ix + 1]
            for ip in range(len(paper_yz) - 1):
                try:
                    f = bm_paper.faces.new([r1[ip], r1[ip + 1], r2[ip + 1], r2[ip]])
                    f.material_index = 0
                except ValueError:
                    pass

        for end_row, rev in [(p_grid[0], True), (p_grid[-1], False)]:
            verts_cap = [end_row[k] for k in range(len(paper_yz))]
            if rev:
                verts_cap.reverse()
            try:
                f = bm_paper.faces.new(verts_cap)
                f.material_index = 0
            except ValueError:
                pass

        wrapper_obj = H.create_mesh_object('wrapper', bm_paper, mats[5], parent=root)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.06, -0.025, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.06, -0.025, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.06, 0.035), parent=root)

        return root, (0.0, 0.025, 0.0), 0.18

    # =============================================================
    # 6. YAXUE-FENSI (jiangsu, bowl, chopsticks)
    # Glass vermicelli translucent cream loops, dark maroon duck blood cubes,
    # golden tofu puffs and coriander in pale broth.
    # =============================================================
    def build_yaxue_fensi():
        reset_scene()
        mats = [
            H.make_mat('mat_bowl', 'c2dcd0', roughness=0.18, specular=0.85),
            H.make_mat('mat_broth', 'dcd2bf', roughness=0.20, specular=0.80),
            H.make_mat('mat_vermicelli', 'eeebe0', roughness=0.35, specular=0.65),
            H.make_mat('mat_duck_blood', '380d14', roughness=0.25, specular=0.85),
            H.make_mat('mat_tofu_puff', 'c48a32', roughness=0.65),
            H.make_mat('mat_coriander', '24821a', roughness=0.40),
            H.make_mat('mat_chopsticks', '362014', roughness=0.40),
        ]

        root = bpy.data.objects.new('yaxue-fensi', None)
        bpy.context.collection.objects.link(root)

        # Container: Jade bowl
        build_jade_bowl(root, mats[0])

        # Edible: Pale broth + glass vermicelli loops + duck blood cubes + fried tofu puffs + coriander
        bm_edible = bmesh.new()

        # Broth surface disc at y = 0.012
        segs_soup = 32
        r_soup = 0.069
        c_soup = bm_edible.verts.new(H.glb_to_bl((0.0, 0.012, 0.0)))
        soup_ring = []
        for i in range(segs_soup):
            th = 2.0 * math.pi * i / segs_soup
            soup_ring.append(bm_edible.verts.new(H.glb_to_bl((r_soup * math.cos(th), 0.012, r_soup * math.sin(th)))))
        bm_edible.verts.ensure_lookup_table()
        for i in range(segs_soup):
            inxt = (i + 1) % segs_soup
            try:
                f = bm_edible.faces.new([c_soup, soup_ring[i], soup_ring[inxt]])
                f.material_index = 1
            except ValueError:
                pass

        # Glass vermicelli translucent cream loops (tangling across bowl)
        vermicelli_loops = [
            [(-0.045, 0.014, -0.015), (-0.025, 0.022, -0.030), (0.005, 0.025, -0.020), (0.025, 0.020, -0.005), (0.045, 0.015, -0.010)],
            [(-0.035, 0.015, 0.020), (-0.010, 0.024, 0.032), (0.015, 0.026, 0.025), (0.035, 0.022, 0.015), (0.048, 0.014, 0.022)],
            [(-0.020, 0.015, -0.040), (-0.005, 0.025, -0.015), (0.010, 0.028, 0.010), (0.020, 0.024, 0.035), (0.015, 0.015, 0.048)],
            [(-0.040, 0.015, -0.005), (-0.020, 0.026, 0.008), (0.002, 0.029, 0.012), (0.024, 0.025, -0.008), (0.042, 0.015, -0.025)],
            [(0.035, 0.015, -0.035), (0.012, 0.025, -0.018), (-0.015, 0.028, -0.005), (-0.030, 0.024, 0.015), (-0.042, 0.014, 0.032)],
            [(-0.030, 0.016, -0.025), (-0.010, 0.027, -0.002), (0.015, 0.028, 0.005), (0.030, 0.023, -0.018), (0.040, 0.015, -0.030)],
        ]
        for v_loop in vermicelli_loops:
            add_tube_curve(bm_edible, v_loop, radius=0.0022, segs_circ=6, mat_idx=2)

        # Dark maroon duck blood curd cubes
        blood_cubes = [
            (-0.022, 0.024, -0.012, 0.015, 0.012, 0.014, (6, 18, -4)),
            (0.015, 0.025, -0.016, 0.016, 0.013, 0.015, (-5, 12, 6)),
            (-0.005, 0.027, 0.018, 0.017, 0.013, 0.015, (10, -8, 8)),
            (0.024, 0.023, 0.012, 0.015, 0.012, 0.013, (-8, 5, -6)),
            (-0.032, 0.020, 0.010, 0.014, 0.011, 0.013, (4, -15, 5)),
            (0.002, 0.028, -0.002, 0.016, 0.013, 0.015, (0, 25, 0)),
        ]
        for bx, by, bz, lx, ly, lz, rot in blood_cubes:
            H.add_box(bm_edible, (bx, by, bz), lx, ly, lz, rot_deg=rot, mat_idx=3)

        # Golden fried tofu puffs (spongy irregular cubes)
        tofu_puffs = [
            (-0.030, 0.025, -0.028, 0.018, 0.014, 0.016, (8, -12, 5)),
            (0.028, 0.026, -0.025, 0.017, 0.015, 0.017, (-6, 22, -8)),
            (-0.018, 0.027, 0.032, 0.018, 0.014, 0.016, (12, 8, -4)),
            (0.022, 0.026, 0.028, 0.017, 0.015, 0.017, (-10, -14, 6)),
            (0.035, 0.022, 0.000, 0.016, 0.013, 0.015, (5, 5, 10)),
        ]
        for tx, ty, tz, lx, ly, lz, rot in tofu_puffs:
            H.add_box(bm_edible, (tx, ty, tz), lx, ly, lz, rot_deg=rot, mat_idx=4)

        # Fresh green coriander / cilantro sprigs
        coriander_locs = [
            (-0.012, 0.031, -0.015), (0.010, 0.032, -0.008), (-0.005, 0.033, 0.012),
            (0.018, 0.030, 0.018), (-0.025, 0.029, 0.005), (0.000, 0.033, -0.022),
            (0.028, 0.028, -0.010), (-0.015, 0.031, 0.025),
        ]
        for cx, cy, cz in coriander_locs:
            H.add_box(bm_edible, (cx, cy, cz), 0.006, 0.002, 0.006, rot_deg=(15, 30, 10), mat_idx=5)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats[1:6], parent=root)

        # Utensil: Chopsticks with duck blood & vermicelli morsel
        def add_yaxue_morsel(utensil_obj):
            bm_tf = bmesh.new()
            # Duck blood cube held between chopstick tips
            H.add_box(bm_tf, (0.0, 0.001, -0.002), 0.007, 0.006, 0.007, rot_deg=(5, 15, 0), mat_idx=0)
            # Vermicelli strand looped around it
            v_loop = [(-0.002, 0.003, -0.006), (0.001, 0.004, 0.000), (0.002, 0.002, 0.006)]
            add_tube_curve(bm_tf, v_loop, radius=0.0012, segs_circ=6, mat_idx=1)
            toolFood = H.create_mesh_object('toolFood', bm_tf, [mats[3], mats[2]], parent=utensil_obj)
            toolFood.location = Vector((0.0, -0.106, 0.001))

        build_chopsticks_utensil(root, mats[6], add_yaxue_morsel)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)

        return root, (0.0, 0.020, 0.0), 0.18

    # =============================================================
    # 7. DINGSHENGGAO (zhejiang, cupped)
    # Pair of pinkish white hourglass-shaped steamed rice cakes with clear narrow waist
    # and flared square flower-like top; red bean stripe.
    # =============================================================
    def build_dingshenggao():
        reset_scene()
        mats = [
            H.make_mat('mat_cake_pink', 'efbdc6', roughness=0.72),
            H.make_mat('mat_cake_white', 'fae8ec', roughness=0.70),
            H.make_mat('mat_redbean', '4a141a', roughness=0.50),
            H.make_mat('mat_osmanthus', 'dba028', roughness=0.55),
        ]

        root = bpy.data.objects.new('dingshenggao', None)
        bpy.context.collection.objects.link(root)

        bm_edible = bmesh.new()

        # Pair of Dingsheng steamed rice cakes side by side:
        # Centers at x = -0.038 and +0.038
        # Sits at y = -0.025, narrow waist at y = +0.010, flared petal top reaches y = +0.052, passing bite [0, 0.05, 0.02]!
        cake_centers = [-0.038, 0.038]
        for cake_idx, cx in enumerate(cake_centers):
            segs_th = 24
            # Profile levels along Y from bottom -0.025 to top +0.052:
            # (py, rx, rz)
            levels = [
                (-0.025, 0.034, 0.030),  # base bottom
                (-0.015, 0.032, 0.028),  # lower base
                (-0.005, 0.026, 0.023),  # taper into waist
                (0.010, 0.018, 0.016),   # NARROW WAIST (clear hourglass cinch!)
                (0.025, 0.027, 0.024),   # flare out above waist
                (0.040, 0.035, 0.031),   # upper body
                (0.052, 0.037, 0.033),   # flared top petal lip
            ]

            rings = []
            for py, rx, rz in levels:
                ring = []
                for ith in range(segs_th):
                    th = 2.0 * math.pi * ith / segs_th
                    # 4-lobed square-flower modulation (cos(4*th))
                    mod = 1.0 + 0.12 * math.cos(4.0 * th)
                    px = cx + rx * mod * math.cos(th)
                    pz = rz * mod * math.sin(th)
                    ring.append(bm_edible.verts.new(H.glb_to_bl((px, py, pz))))
                rings.append(ring)

            bm_edible.verts.ensure_lookup_table()
            for il in range(len(levels) - 1):
                r1 = rings[il]
                r2 = rings[il + 1]
                for ith in range(segs_th):
                    ith_nxt = (ith + 1) % segs_th
                    try:
                        f = bm_edible.faces.new([r1[ith], r1[ith_nxt], r2[ith_nxt], r2[ith]])
                        # White rice flour gradient at top and bottom, pink in main body
                        f.material_index = 0 if il in (1, 2, 3, 4) else 1
                    except ValueError:
                        pass

            # Bottom cap
            c_bot = bm_edible.verts.new(H.glb_to_bl((cx, -0.025, 0.0)))
            for ith in range(segs_th):
                ith_nxt = (ith + 1) % segs_th
                try:
                    f = bm_edible.faces.new([c_bot, rings[0][ith_nxt], rings[0][ith]])
                    f.material_index = 1
                except ValueError:
                    pass

            # Top cap with embossed lozenge
            c_top = bm_edible.verts.new(H.glb_to_bl((cx, 0.051, 0.0)))
            for ith in range(segs_th):
                ith_nxt = (ith + 1) % segs_th
                try:
                    f = bm_edible.faces.new([c_top, rings[-1][ith], rings[-1][ith_nxt]])
                    f.material_index = 0
                except ValueError:
                    pass

            # Sweet red bean paste stripe along the waist indent and top center
            H.add_box(bm_edible, (cx, 0.010, 0.0), 0.038, 0.005, 0.034, rot_deg=(0, 45, 0), mat_idx=2)
            H.add_box(bm_edible, (cx, 0.0515, 0.0), 0.018, 0.002, 0.018, rot_deg=(0, 45, 0), mat_idx=2)

            # Osmanthus flower specks on top face
            osmanthus_pts = [
                (cx - 0.012, 0.052, -0.010), (cx + 0.010, 0.052, -0.012),
                (cx - 0.008, 0.052, 0.012), (cx + 0.012, 0.052, 0.008),
                (cx, 0.052, 0.016), (cx, 0.052, -0.016),
            ]
            for ox, oy, oz in osmanthus_pts:
                H.add_box(bm_edible, (ox, oy, oz), 0.0025, 0.001, 0.0025, rot_deg=(5, 20, 5), mat_idx=3)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats, parent=root)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.05, 0.02), parent=root)

        return root, (0.0, 0.020, 0.0), 0.18

    # =============================================================
    # 8. MAODOUFU (anhui, bowl, chopsticks)
    # Golden seared tofu rectangles in shallow jade dish, crisp dark grilled patches,
    # creamy fuzzy unseared face edges and red chili garnish.
    # =============================================================
    def build_maodoufu():
        reset_scene()
        mats = [
            H.make_mat('mat_dish', 'b8dcc7', roughness=0.18, specular=0.85),
            H.make_mat('mat_tofu_crust', 'cb8e30', roughness=0.55),
            H.make_mat('mat_tofu_fuzz', 'f6f1e6', roughness=0.85),
            H.make_mat('mat_sear_mark', '4e220a', roughness=0.50),
            H.make_mat('mat_chili_sauce', 'a62010', roughness=0.25, specular=0.85),
            H.make_mat('mat_scallion', '2c8c1e', roughness=0.40),
            H.make_mat('mat_chopsticks', '362014', roughness=0.40),
        ]

        root = bpy.data.objects.new('maodoufu', None)
        bpy.context.collection.objects.link(root)

        # Container: Shallow jade dish (outer diam 0.15m, radius 0.075m, rim at +0.016, foot at -0.025)
        build_shallow_dish(root, mats[0])

        # Edible: 4 seared hairy tofu blocks in shallow dish + chili sauce + scallions
        bm_edible = bmesh.new()

        # Sauce pool in shallow dish base
        segs_sauce = 28
        r_sauce = 0.055
        c_sauce = bm_edible.verts.new(H.glb_to_bl((0.0, -0.010, 0.0)))
        sauce_ring = []
        for i in range(segs_sauce):
            th = 2.0 * math.pi * i / segs_sauce
            sauce_ring.append(bm_edible.verts.new(H.glb_to_bl((r_sauce * math.cos(th), -0.010, r_sauce * math.sin(th)))))
        bm_edible.verts.ensure_lookup_table()
        for i in range(segs_sauce):
            inxt = (i + 1) % segs_sauce
            try:
                f = bm_edible.faces.new([c_sauce, sauce_ring[i], sauce_ring[inxt]])
                f.material_index = 3  # chili/soy dipping sauce
            except ValueError:
                pass

        # 4 seared Huizhou hairy tofu rectangular slabs
        # Tofu size: length ~0.045m, width ~0.026m, thickness ~0.018m
        tofu_blocks = [
            ((-0.024, 0.008, -0.018), 0.044, 0.018, 0.026, (6, 12, -4)),
            ((0.024, 0.008, -0.018), 0.044, 0.018, 0.026, (-4, -10, 6)),
            ((-0.022, 0.012, 0.018), 0.044, 0.018, 0.026, (-6, -14, 4)),
            ((0.022, 0.012, 0.018), 0.044, 0.018, 0.026, (8, 16, -6)),
        ]
        for tc, lx, ly, lz, rot in tofu_blocks:
            # 1. Main fuzzy white mycelium block
            H.add_box(bm_edible, tc, lx, ly, lz, rot_deg=rot, mat_idx=1)
            # 2. Golden seared top face (raised slightly by 0.0005m)
            H.add_box(bm_edible, (tc[0], tc[1] + ly / 2.0 + 0.0006, tc[2]), lx * 0.90, 0.0012, lz * 0.90, rot_deg=rot, mat_idx=0)
            # 3. Dark charred grilled sear stripes on top face
            for s_off in (-0.010, 0.0, 0.010):
                H.add_box(bm_edible, (tc[0] + s_off, tc[1] + ly / 2.0 + 0.0012, tc[2]), 0.0032, 0.0008, lz * 0.85, rot_deg=rot, mat_idx=2)
            # 4. Red chili sauce dollop / sliver on top
            H.add_box(bm_edible, (tc[0], tc[1] + ly / 2.0 + 0.0018, tc[2]), 0.010, 0.0015, 0.008, rot_deg=rot, mat_idx=3)

        # Chopped scallion garnish on tofu blocks
        scallion_pts = [
            (-0.028, 0.020, -0.018), (-0.018, 0.021, -0.015), (0.020, 0.020, -0.018),
            (0.028, 0.021, -0.015), (-0.026, 0.024, 0.018), (-0.016, 0.025, 0.020),
            (0.018, 0.024, 0.018), (0.026, 0.025, 0.020), (0.000, 0.015, 0.000),
        ]
        for sx, sy, sz in scallion_pts:
            H.add_cylinder(bm_edible, (sx, sy, sz), (sx, sy + 0.002, sz), 0.0018, segs=8, mat_idx=4)

        edible_obj = H.create_mesh_object('edible', bm_edible, mats[1:6], parent=root)

        # Utensil: Chopsticks with seared tofu morsel & chili fleck
        def add_maodoufu_morsel(utensil_obj):
            bm_tf = bmesh.new()
            # Golden seared tofu cube with fuzzy edge
            H.add_box(bm_tf, (0.0, 0.001, -0.002), 0.008, 0.007, 0.008, rot_deg=(5, 12, 0), mat_idx=0)
            # Chili sauce fleck on top
            H.add_box(bm_tf, (0.001, 0.005, -0.001), 0.003, 0.0015, 0.003, rot_deg=(10, 0, 5), mat_idx=1)
            toolFood = H.create_mesh_object('toolFood', bm_tf, [mats[1], mats[4]], parent=utensil_obj)
            toolFood.location = Vector((0.0, -0.106, 0.001))

        build_chopsticks_utensil(root, mats[6], add_maodoufu_morsel)

        # Anchors
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, -0.025, 0.0), parent=root)
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)

        return root, (0.0, 0.020, 0.0), 0.18

    # =============================================================
    # Master Build Dispatcher
    # =============================================================
    builders = [
        ('lvrou-huoshao', build_lvrou_huoshao),
        ('daoxiaomian', build_daoxiaomian),
        ('naidoufu', build_naidoufu),
        ('shenyang-jijia', build_shenyang_jijia),
        ('jianbing-cong', build_jianbing_cong),
        ('yaxue-fensi', build_yaxue_fensi),
        ('dingshenggao', build_dingshenggao),
        ('maodoufu', build_maodoufu),
    ]

    active_builders = [b for b in builders if not selected_ids or b[0] in selected_ids]

    for food_id, fn in active_builders:
        print(f'=== BUILDING {food_id} ===')
        glb_path = OUT_DIR / f'{food_id}.glb'
        png_path = OUT_DIR / f'{food_id}.png'

        root_obj, center_glb, target_size = fn()

        # Export GLB with selected meal and children only
        bpy.ops.object.select_all(action='DESELECT')
        root_obj.select_set(True)
        for child in root_obj.children_recursive:
            child.select_set(True)
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
        print(f'EXPORTED_GLB: {glb_path} ({glb_path.stat().st_size} bytes)')

        # Render thumbnail
        render_thumbnail(center_glb, target_size, png_path)
        print(f'RENDERED_PNG: {png_path} ({png_path.stat().st_size} bytes)')

    print('ALL_BLENDER_TASKS_COMPLETE')


def optimize_pngs(target_ids=None):
    """Optimizes and quantizes rendered 256x256 thumbnails to <= 28672 bytes."""
    from PIL import Image

    print('Optimizing rendered 256x256 PNG thumbnails to <= 28672 bytes...')
    if target_ids:
        png_files = [OUT_DIR / f'{tid}.png' for tid in target_ids]
    else:
        png_files = list(OUT_DIR.glob('*.png'))
    for png_file in png_files:
        if not png_file.exists():
            continue
        im = Image.open(png_file)
        im.save(png_file, 'PNG', optimize=True)
        sz = png_file.stat().st_size
        print(f'{png_file.name}: initial optimized size = {sz} bytes')

        if sz > 20000:
            print(f'Quantizing {png_file.name} ({sz} bytes > 20000 bytes)...')
            # Use FASTOCTREE for RGBA transparency preservation
            im_q = im.quantize(colors=128, method=Image.Quantize.FASTOCTREE)
            im_q.save(png_file, 'PNG', optimize=True)
            sz = png_file.stat().st_size
            print(f'Quantized {png_file.name} (128 colors) -> {sz} bytes')

        if sz > 28672:
            im_q = im.quantize(colors=64, method=Image.Quantize.FASTOCTREE)
            im_q.save(png_file, 'PNG', optimize=True)
            sz = png_file.stat().st_size
            print(f'Quantized {png_file.name} (64 colors) -> {sz} bytes')

        if sz > 28672:
            raise RuntimeError(f'{png_file.name} exceeds 28672 bytes after quantization: {sz} bytes')


def run_node_verification(target_ids=None):
    """Runs Node.js GLTFLoader to verify actual exported names, dimensions, anchors and writes manifest.json."""
    verify_script_path = OUT_DIR / 'verify.mjs'

    verify_script_content = """import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as THREE from '__PB_SNACK_PROJECT_ROOT__/node_modules/three/build/three.module.js';
import { GLTFLoader } from '__PB_SNACK_PROJECT_ROOT__/node_modules/three/examples/jsm/loaders/GLTFLoader.js';

const outDir = '/home/baibai/outbox/pawborough-food-coverage-20261003/assets-a';

const specs = """ + json.dumps({s['id']: s for s in FOOD_SPECS}, indent=2) + """;

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
  console.log('--- Starting Node.js GLTFLoader Verification ---');
  const foodEntries = [];
  const targetIds = process.argv.slice(2);
  const ids = targetIds.length > 0 ? targetIds : Object.keys(specs);

  for (const id of ids) {
    const spec = specs[id];
    const glbPath = path.join(outDir, `${id}.glb`);
    const pngPath = path.join(outDir, `${id}.png`);

    if (!fs.existsSync(glbPath)) throw new Error(`Missing ${glbPath}`);
    if (!fs.existsSync(pngPath)) throw new Error(`Missing ${pngPath}`);

    const glbStats = fs.statSync(glbPath);
    const pngStats = fs.statSync(pngPath);

    if (glbStats.size > 524288) throw new Error(`${id}.glb exceeds 524288 bytes: ${glbStats.size}`);
    if (pngStats.size > 28672) throw new Error(`${id}.png exceeds 28672 bytes: ${pngStats.size}`);

    // Verify PNG dimensions: 256x256
    const pngBuf = fs.readFileSync(pngPath);
    const pngWidth = pngBuf.readUInt32BE(16);
    const pngHeight = pngBuf.readUInt32BE(20);
    if (pngWidth !== 256 || pngHeight !== 256) {
      throw new Error(`${id}.png dimensions mismatch: expected 256x256, got ${pngWidth}x${pngHeight}`);
    }

    const glbSha = sha256File(glbPath);
    const pngSha = sha256File(pngPath);

    const gltf = await parseGlb(glbPath);
    const root = gltf.scene.getObjectByName(id);
    if (!root) throw new Error(`${id}: missing root node with id name`);

    // Verify no lights or cameras in exported GLB
    gltf.scene.traverse((obj) => {
      if (obj.isLight) throw new Error(`${id}: found light ${obj.name} in GLB`);
      if (obj.isCamera) throw new Error(`${id}: found camera ${obj.name} in GLB`);
      const p = obj.position.toArray();
      const s = obj.scale.toArray();
      if (![...p, ...s].every(Number.isFinite)) {
        throw new Error(`${id}: non-finite transform in object ${obj.name}`);
      }
    });

    // Compute bounding box
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const min = [box.min.x, box.min.y, box.min.z];
    const max = [box.max.x, box.max.y, box.max.z];
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

    if (![...min, ...max, ...size].every(Number.isFinite)) {
      throw new Error(`${id}: non-finite bounding box values`);
    }

    // Check size contract
    if (size[0] > 0.24 || size[2] > 0.24) {
      throw new Error(`${id}: meal width exceeds 0.24m: size=[${size.join(',')}]`);
    }
    if (size[1] > 0.30) {
      throw new Error(`${id}: meal height exceeds 0.30m: size=[${size.join(',')}]`);
    }

    // Verify required parts
    for (const partName of spec.requiredParts) {
      const partObj = root.getObjectByName(partName);
      if (!partObj) throw new Error(`${id}: missing required part ${partName}`);
    }

    // Verify anchors
    const recordedAnchors = {};
    for (const [anchorName, expectedPos] of Object.entries(spec.expectedAnchors)) {
      let anchorObj;
      if (anchorName === 'toolGrip' || anchorName === 'toolBite') {
        const utensil = root.getObjectByName('utensil');
        if (!utensil) throw new Error(`${id}: missing utensil for anchor ${anchorName}`);
        anchorObj = utensil.getObjectByName(anchorName);
      } else {
        anchorObj = root.getObjectByName(anchorName);
      }

      if (!anchorObj) throw new Error(`${id}: missing anchor ${anchorName}`);
      const actualPos = anchorObj.position.toArray().map(v => Math.round(v * 10000) / 10000);
      recordedAnchors[anchorName] = actualPos;

      for (let i = 0; i < 3; i++) {
        if (Math.abs(actualPos[i] - expectedPos[i]) > 0.005) {
          throw new Error(`${id} anchor ${anchorName}[${i}] mismatch: expected ${expectedPos[i]}, got ${actualPos[i]}`);
        }
      }
    }

    // Utensil specific verification
    if (spec.utensilKind !== null) {
      const utensil = root.getObjectByName('utensil');
      if (!utensil) throw new Error(`${id}: missing utensil object`);
      const toolFood = utensil.getObjectByName('toolFood');
      if (!toolFood) throw new Error(`${id}: utensil missing toolFood child`);
    }

    const foodEntry = {
      id: spec.id,
      name: spec.name,
      regionId: spec.regionId,
      poseProfile: spec.poseProfile,
      utensilKind: spec.utensilKind,
      path: `${id}.glb`,
      bytes: glbStats.size,
      sha256: glbSha,
      thumbnail: {
        path: `${id}.png`,
        bytes: pngStats.size,
        sha256: pngSha
      },
      dimensionsM: [
        Math.round(size[0] * 10000) / 10000,
        Math.round(size[1] * 10000) / 10000,
        Math.round(size[2] * 10000) / 10000
      ],
      anchors: recordedAnchors,
      requiredParts: spec.requiredParts,
      sourceScript: "asset-authoring/snacks/national/build_coverage_a.py"
    };

    console.log(`[VERIFIED] ${id}: glb=${glbStats.size}B, png=${pngStats.size}B, dims=${foodEntry.dimensionsM.join('x')}`);
    foodEntries.push(foodEntry);
  }

  let finalFoods = foodEntries;
  if (targetIds.length > 0) {
    const manifestPath = path.join(outDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (Array.isArray(prev.foods)) {
          const verifiedMap = new Map(foodEntries.map(e => [e.id, e]));
          finalFoods = prev.foods.map(e => verifiedMap.get(e.id) || e);
          for (const [eId, e] of verifiedMap) {
            if (!finalFoods.some(f => f.id === eId)) finalFoods.push(e);
          }
        }
      } catch (err) {
        console.warn('Could not read existing manifest:', err);
      }
    }
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    batch: 'coverage-a',
    sourceScript: 'asset-authoring/snacks/national/build_coverage_a.py',
    foods: finalFoods
  };

  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n');
  console.log('MANIFEST_WRITTEN:', manifestPath);
}

verifyAll().catch(err => {
  console.error('VERIFICATION_FAILED:', err);
  process.exit(1);
});
"""

    verify_script_content = verify_script_content.replace('__PB_SNACK_PROJECT_ROOT__', str(Path(__file__).resolve().parents[3]))
    with open(verify_script_path, 'w', encoding='utf-8') as f:
        f.write(verify_script_content)

    print(f'Wrote verifier script to {verify_script_path}')

    node_cmd = ['node', str(verify_script_path)]
    if target_ids:
        node_cmd.extend(target_ids)
    work_root = Path(__file__).resolve().parents[3]
    proc = subprocess.run(node_cmd, cwd=str(work_root), capture_output=True, text=True)
    print(proc.stdout)
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        raise RuntimeError(f'Node verification failed with exit code {proc.returncode}')


def main():
    try:
        import bpy
        # Inside Blender
        selected = []
        if '--' in sys.argv:
            idx = sys.argv.index('--')
            selected = [a for a in sys.argv[idx + 1:] if not a.startswith('-')]
        run_blender_build(selected_ids=selected if selected else None)
    except ImportError:
        # Standard Python entry
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        target_ids = [arg for arg in sys.argv[1:] if not arg.startswith('-')]

        env = os.environ.copy()
        env['CUDA_VISIBLE_DEVICES'] = ''

        if target_ids:
            print(f'Starting headless Blender build for selected candidate snacks: {target_ids}...')
            cmd = ['blender', '--background', '--python', str(SRC_PATH), '--'] + target_ids
        else:
            print('Starting headless Blender build for all 8 coverage wave A candidate snacks...')
            cmd = ['blender', '--background', '--python', str(SRC_PATH)]

        res = subprocess.run(cmd, env=env)
        if res.returncode != 0:
            print(f'Blender failed with code {res.returncode}', file=sys.stderr)
            sys.exit(res.returncode)

        optimize_pngs(target_ids=target_ids if target_ids else None)
        run_node_verification(target_ids=target_ids if target_ids else None)
        print('COVERAGE_WAVE_A_BUILT_AND_VERIFIED_SUCCESSFULLY!')


if __name__ == '__main__':
    main()
