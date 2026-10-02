"""Build atomic three distinct national snacks for M05:
1. roujiamo (wrapped)
2. tanghulu (skewer)
3. shuangpinai (bowl spoon)

Produces GLB models, rendered 512x512 thumbnails, and verified manifest.json.
Exports static geometry only; no external textures/paths; <1MiB GLB, <150KB PNG.
"""
import os
import sys
import math
import json
import hashlib
import subprocess
from pathlib import Path

OUT_DIR = Path('/home/baibai/outbox/pawborough-national-snacks-20261002/m05-assets')
SRC_PATH = Path('asset-authoring/snacks/national/build_six.py')


def run_blender_build():
    """Runs inside Blender to generate GLB models and rendered thumbnails."""
    import bpy
    import bmesh
    from mathutils import Vector

    script_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(script_dir))
    import helpers as H

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # -------------------------------------------------------------
    # Shared material definitions
    # -------------------------------------------------------------
    def init_materials():
        return {
            # Pastry & fillings
            'bun': H.make_mat('mat_bun', 'd8a460', roughness=0.65),
            'bun_toast': H.make_mat('mat_bun_toast', '7a3814', roughness=0.55),
            'meat': H.make_mat('mat_meat', '75432c', roughness=0.75, specular=0.3),  # brown#75432c, low gloss rough.75
            'herbs': H.make_mat('mat_herbs', '3c7d2c', roughness=0.45),
            'sesame': H.make_mat('mat_sesame', 'f2e4ca', roughness=0.5),
            'parchment': H.make_mat('mat_parchment', 'ede3ce', roughness=0.75),
            # Hawthorn candied skewer
            'hawthorn': H.make_mat('mat_hawthorn', 'b0141e', roughness=0.10, specular=0.85, clearcoat=0.8),
            'glaze': H.make_mat('mat_glaze', 'ffe4eb', roughness=0.03, specular=0.98, clearcoat=1.0),  # clear/light pink
            'wood': H.make_mat('mat_wood', 'cbb184', roughness=0.6),
            # Jade porcelain bowl & milk pudding
            'jade': H.make_mat('mat_jade', 'aecbbe', roughness=0.12, specular=0.8),  # gentle jade #aecbbe
            'porcelain': H.make_mat('mat_porcelain', 'e2ece5', roughness=0.15, specular=0.7),
            'pudding': H.make_mat('mat_pudding', 'fff0ce', roughness=0.22, specular=0.55),  # warm custard pudding #fff0ce
            'mango': H.make_mat('mat_mango', 'f59e1b', roughness=0.14, specular=0.75),  # amber mango .006-.008m
            'leaf': H.make_mat('mat_leaf', '2d8825', roughness=0.35, specular=0.4),  # small green leaf
        }


    # -------------------------------------------------------------
    # Helper: Clear Scene
    # -------------------------------------------------------------
    def reset_scene():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.unit_settings.system = 'METRIC'

    # -------------------------------------------------------------
    # Render Thumbnail Helper
    # -------------------------------------------------------------
    def render_thumbnail(center_glb, target_size_m, out_png):
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = 24
        sc.cycles.device = 'CPU'
        sc.render.resolution_x = 512
        sc.render.resolution_y = 512
        sc.render.film_transparent = True
        sc.render.image_settings.file_format = 'PNG'
        sc.render.image_settings.color_mode = 'RGBA'
        sc.render.image_settings.color_depth = '8'
        sc.render.image_settings.compression = 100

        # Camera setup: 3/4 perspective view
        # Distance chosen so object fills ~70% frame
        fov_deg = 36.0
        tan_half = math.tan(math.radians(fov_deg / 2.0))
        dist = target_size_m / (1.4 * tan_half)

        # 30 deg elevation, 35 deg azimuth
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

        # Key lighting
        key_data = bpy.data.lights.new('KeySun', 'SUN')
        key_data.energy = 3.5
        key_data.color = (1.0, 0.98, 0.94)
        key_obj = bpy.data.objects.new('KeySun', key_data)
        sc.collection.objects.link(key_obj)
        key_dir = H.glb_to_bl((-0.5, -0.9, -0.6)).normalized()
        key_obj.rotation_euler = key_dir.to_track_quat('-Z', 'Y').to_euler()

        # Fill light (soft warm)
        fill_data = bpy.data.lights.new('FillLight', 'AREA')
        fill_data.energy = 8.0
        fill_data.size = 0.4
        fill_data.color = (0.95, 0.92, 0.88)
        fill_obj = bpy.data.objects.new('FillLight', fill_data)
        sc.collection.objects.link(fill_obj)
        fill_obj.location = c_bl + H.glb_to_bl((-0.3, 0.2, 0.4))
        fill_dir = (c_bl - fill_obj.location).normalized()
        fill_obj.rotation_euler = fill_dir.to_track_quat('-Z', 'Y').to_euler()

        # Rim / Back light
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
    # 1. ROUJIAMO (wrapped)
    # -------------------------------------------------------------
    def build_roujiamo():
        reset_scene()
        mats = init_materials()

        root = bpy.data.objects.new('roujiamo', None)
        bpy.context.collection.objects.link(root)

        # Build 'edible' mesh: Flatter Baiji bun (.18m diameter) + shredded braised meat strips + green herbs + toasted flecks
        bm_edible = bmesh.new()

        # Upper Bun:
        # Baiji bread profile: flat-topped toasted center ("tiger back" and "iron ring"), visibly flatter
        # Diameter: 0.18m in horizontal plane (rx = 0.090, rz = 0.085)
        # Top around y = 0.090 (0.089 at center)
        # bite anchor is at (0, 0.085, 0.030), which sits directly on actual exposed upper bread front surface.
        segs_u = 36
        segs_v = 16
        top_verts = []

        rx = 0.090
        rz = 0.085

        for iv in range(segs_v + 1):
            r_norm = iv / segs_v
            # Exact drop profile ensuring (0, 0.085, 0.030) sits on surface
            base_y = 0.0880 - 0.0238 * ((r_norm / 0.82) ** 2.4) if r_norm <= 0.82 else 0.0642 - 0.0282 * math.sin((r_norm - 0.82) / 0.18 * math.pi / 2.0)
            row = []
            for iu in range(segs_u):
                theta = 2.0 * math.pi * iu / segs_u
                vx = rx * r_norm * math.cos(theta)
                vz = rz * r_norm * math.sin(theta)
                cur_y = base_y
                # Slit opening: front rim lifts higher for vz > 0.032 to showcase meat filling
                if vz > 0.032 and abs(vx) < 0.078:
                    lift_frac = (vz - 0.032) / (rz - 0.032)
                    cur_y += 0.022 * (lift_frac ** 1.1) * max(0.0, math.cos(vx / rx * (math.pi / 2.0)))
                v = bm_edible.verts.new(H.glb_to_bl((vx, cur_y, vz)))
                row.append((v, cur_y, r_norm))
            top_verts.append(row)

        for iv in range(segs_v):
            r1 = top_verts[iv]
            r2 = top_verts[iv + 1]
            for iu in range(segs_u):
                iu_n = (iu + 1) % segs_u
                v0, y0, d0 = r1[iu]
                v1, y1, d1 = r1[iu_n]
                v2, y2, d2 = r2[iu_n]
                v3, y3, d3 = r2[iu]
                f_verts = [v0, v1, v2, v3]
                unique = []
                for v in f_verts:
                    if v not in unique:
                        unique.append(v)
                if len(unique) >= 3:
                    try:
                        f = bm_edible.faces.new(unique)
                        avg_d = (d0 + d1 + d2 + d3) / 4.0
                        avg_y = (y0 + y1 + y2 + y3) / 4.0
                        # Toasted crust: authentic Baiji bread iron ring and chrysanthemum center
                        if (0.36 < avg_d < 0.68 and avg_y > 0.076) or (avg_d < 0.15 and avg_y > 0.086):
                            f.material_index = 1  # mat_bun_toast
                        else:
                            f.material_index = 0  # mat_bun
                    except ValueError:
                        pass

        # Bottom Bun:
        # Lower bun, flat base from y = -0.005 to 0.024
        bot_verts = []
        for iv in range(segs_v + 1):
            r_norm = iv / segs_v
            phi = (math.pi / 2.0) * r_norm
            cur_y_base = 0.024 - 0.029 * math.cos(phi)
            row = []
            for iu in range(segs_u):
                theta = 2.0 * math.pi * iu / segs_u
                vx = rx * r_norm * math.cos(theta)
                vz = rz * r_norm * math.sin(theta)
                cur_y = cur_y_base
                # Slit opening: lower rim dips slightly at front
                if vz > 0.035 and abs(vx) < 0.078:
                    dip_frac = (vz - 0.035) / (rz - 0.035)
                    cur_y -= 0.006 * dip_frac * max(0.0, math.cos(vx / rx * (math.pi / 2.0)))
                v = bm_edible.verts.new(H.glb_to_bl((vx, cur_y, vz)))
                row.append(v)
            bot_verts.append(row)

        for iv in range(segs_v):
            r1 = bot_verts[iv]
            r2 = bot_verts[iv + 1]
            for iu in range(segs_u):
                iu_n = (iu + 1) % segs_u
                v0 = r1[iu]
                v1 = r1[iu_n]
                v2 = r2[iu_n]
                v3 = r2[iu]
                f_verts = [v0, v3, v2, v1]
                unique = []
                for v in f_verts:
                    if v not in unique:
                        unique.append(v)
                if len(unique) >= 3:
                    try:
                        f = bm_edible.faces.new(unique)
                        f.material_index = 0
                    except ValueError:
                        pass

        # Shredded Pulled Pork Filling in slit (front +Z, brown #75432c, low gloss rough.75)
        # Deep cavity filler
        H.add_ellipsoid(bm_edible, (0.0, 0.035, 0.040), 0.068, 0.012, 0.026, segs_u=16, segs_v=10, mat_idx=2)
        H.add_ellipsoid(bm_edible, (-0.032, 0.036, 0.050), 0.036, 0.011, 0.022, segs_u=14, segs_v=8, mat_idx=2)
        H.add_ellipsoid(bm_edible, (0.032, 0.036, 0.050), 0.036, 0.011, 0.022, segs_u=14, segs_v=8, mat_idx=2)

        # 34 irregular thin strips / shredded braised meat clearly in opening
        meat_strips = [
            # Frontmost protruding strands (clearly visible spilling out of the opening)
            ((0.000, 0.038, 0.078), 0.0045, 0.0028, 0.024, (6, 15, -8)),
            ((-0.014, 0.040, 0.076), 0.0046, 0.0028, 0.022, (-6, -20, 12)),
            ((0.015, 0.038, 0.077), 0.0042, 0.0026, 0.023, (8, 22, -10)),
            ((-0.006, 0.046, 0.072), 0.0038, 0.0026, 0.020, (-10, -8, 15)),
            ((0.008, 0.045, 0.073), 0.0042, 0.0026, 0.021, (10, 12, -6)),
            ((-0.026, 0.038, 0.074), 0.0045, 0.0028, 0.022, (5, -28, -8)),
            ((0.028, 0.039, 0.073), 0.0044, 0.0028, 0.021, (-8, 30, 12)),
            ((-0.038, 0.036, 0.068), 0.0048, 0.0028, 0.022, (6, -25, 10)),
            ((0.040, 0.037, 0.067), 0.0044, 0.0026, 0.023, (-5, 26, -12)),
            ((-0.050, 0.034, 0.060), 0.0040, 0.0026, 0.020, (10, -38, 8)),
            ((0.052, 0.035, 0.058), 0.0040, 0.0026, 0.020, (-10, 38, -8)),
            # Layered mid-depth strips
            ((-0.018, 0.036, 0.066), 0.0048, 0.0028, 0.024, (-4, 18, 6)),
            ((0.020, 0.035, 0.067), 0.0045, 0.0027, 0.023, (6, -15, -10)),
            ((-0.002, 0.033, 0.068), 0.0050, 0.0030, 0.025, (0, 5, 4)),
            ((-0.032, 0.044, 0.064), 0.0040, 0.0024, 0.019, (-8, -32, 12)),
            ((0.034, 0.045, 0.063), 0.0042, 0.0025, 0.019, (10, 28, -14)),
            ((-0.044, 0.040, 0.056), 0.0042, 0.0026, 0.020, (5, -42, 10)),
            ((0.046, 0.041, 0.055), 0.0042, 0.0026, 0.020, (-6, 38, -10)),
            ((-0.012, 0.048, 0.062), 0.0038, 0.0024, 0.018, (12, -12, -8)),
            ((0.014, 0.047, 0.063), 0.0038, 0.0025, 0.018, (-10, 16, 8)),
            # Edge & corner fills
            ((-0.008, 0.038, 0.082), 0.0036, 0.0022, 0.018, (8, -12, 18)),
            ((0.010, 0.037, 0.083), 0.0034, 0.0023, 0.018, (-5, 14, -15)),
            ((-0.022, 0.036, 0.078), 0.0038, 0.0024, 0.020, (4, -26, 10)),
            ((0.024, 0.037, 0.077), 0.0038, 0.0024, 0.020, (-6, 22, -12)),
            ((-0.058, 0.032, 0.050), 0.0036, 0.0024, 0.017, (10, -48, 5)),
            ((0.059, 0.033, 0.049), 0.0036, 0.0024, 0.017, (-10, 45, -6)),
            ((-0.030, 0.030, 0.070), 0.0045, 0.0026, 0.021, (2, 20, -5)),
            ((0.030, 0.030, 0.069), 0.0045, 0.0026, 0.021, (-3, -18, 7)),
            ((-0.016, 0.030, 0.074), 0.0042, 0.0025, 0.020, (3, -15, 6)),
            ((0.018, 0.030, 0.073), 0.0042, 0.0025, 0.020, (-4, 18, -6)),
        ]
        for c, sx, sy, sz, rot in meat_strips:
            H.add_box(bm_edible, c, sx, sy, sz, rot_deg=rot, mat_idx=2)

        # Sparse green herbs scattered in meat filling
        herb_strips = [
            ((-0.016, 0.044, 0.074), 0.0038, 0.0012, 0.0045, (12, -25, 10)),
            ((0.014, 0.042, 0.076), 0.0040, 0.0012, 0.0045, (-8, 30, -15)),
            ((0.002, 0.048, 0.070), 0.0042, 0.0012, 0.0040, (5, 5, 20)),
            ((-0.030, 0.041, 0.069), 0.0038, 0.0012, 0.0042, (10, -38, -10)),
            ((0.028, 0.042, 0.068), 0.0038, 0.0012, 0.0042, (-10, 32, 12)),
            ((-0.008, 0.036, 0.078), 0.0035, 0.0012, 0.0038, (4, 15, -8)),
            ((0.022, 0.037, 0.075), 0.0038, 0.0012, 0.0040, (-6, -20, 14)),
            ((-0.042, 0.036, 0.060), 0.0034, 0.0012, 0.0035, (8, -45, 6)),
            ((0.044, 0.037, 0.059), 0.0034, 0.0012, 0.0035, (-8, 42, -8)),
        ]
        for c, sx, sy, sz, rot in herb_strips:
            H.add_box(bm_edible, c, sx, sy, sz, rot_deg=rot, mat_idx=3)

        # Toasted sesame seeds on top bun (y ~ 0.078 to 0.089)
        sesame_pts = [
            (-0.045, 0.078, 0.012), (-0.030, 0.084, 0.018), (-0.015, 0.087, 0.015),
            (0.000, 0.088, 0.020), (0.018, 0.086, 0.017), (0.035, 0.082, 0.014),
            (-0.025, 0.085, -0.010), (0.000, 0.088, -0.012), (0.022, 0.085, -0.008),
            (-0.040, 0.080, -0.015), (0.035, 0.081, -0.012), (-0.010, 0.088, 0.002),
            (0.010, 0.088, 0.003), (-0.020, 0.086, 0.026), (0.015, 0.085, 0.028),
            (-0.035, 0.082, 0.005), (0.030, 0.084, 0.005), (-0.005, 0.089, -0.020),
            (0.008, 0.089, -0.018), (-0.018, 0.087, -0.022), (0.016, 0.087, -0.020)
        ]
        for sx, sy, sz in sesame_pts:
            H.add_ellipsoid(bm_edible, (sx, sy, sz), 0.0022, 0.0011, 0.0014, segs_u=6, segs_v=4, mat_idx=4)

        edible_mats = [mats['bun'], mats['bun_toast'], mats['meat'], mats['herbs'], mats['sesame']]
        edible_obj = H.create_mesh_object('edible', bm_edible, edible_mats, parent=root)

        # Build 'wrapper' mesh: parchment collar wrapping bottom third ONLY with folded corner
        # rx=0.0915, rz=0.0865, y from -0.010 to 0.016 (leaving opening clear)
        bm_wrap = bmesh.new()
        w_segs = 36
        w_y_bot = -0.010
        w_y_top = 0.016
        w_rx = 0.0915
        w_rz = 0.0865

        r_bot = []
        r_top = []
        for i in range(w_segs):
            th = 2.0 * math.pi * i / w_segs
            vx = w_rx * math.cos(th)
            vz = w_rz * math.sin(th)
            y_t = w_y_top
            # Crisp folded corner at front-right (theta ~ 0.40 to 0.85 rad)
            if 0.38 < th < 0.82:
                y_t = w_y_top - 0.007 * math.sin((th - 0.38) / 0.44 * math.pi)
                vx *= 1.04
                vz *= 1.04
            r_bot.append(bm_wrap.verts.new(H.glb_to_bl((vx, w_y_bot, vz))))
            r_top.append(bm_wrap.verts.new(H.glb_to_bl((vx, y_t, vz))))

        bm_wrap.verts.ensure_lookup_table()
        for i in range(w_segs):
            inxt = (i + 1) % w_segs
            try:
                bm_wrap.faces.new([r_bot[i], r_bot[inxt], r_top[inxt], r_top[i]])
            except ValueError:
                pass

        # Folded corner flap folding downward
        f_corner_verts = [
            H.glb_to_bl((w_rx * math.cos(0.38), w_y_top, w_rz * math.sin(0.38))),
            H.glb_to_bl((w_rx * 1.06 * math.cos(0.60), w_y_top - 0.010, w_rz * 1.06 * math.sin(0.60))),
            H.glb_to_bl((w_rx * math.cos(0.82), w_y_top, w_rz * math.sin(0.82))),
        ]
        cv = [bm_wrap.verts.new(p) for p in f_corner_verts]
        try:
            bm_wrap.faces.new(cv)
            bm_wrap.faces.new([cv[0], cv[2], cv[1]])
        except ValueError:
            pass

        # Bottom cap under bun
        bot_center = bm_wrap.verts.new(H.glb_to_bl((0, w_y_bot, 0)))
        for i in range(w_segs):
            inxt = (i + 1) % w_segs
            try:
                bm_wrap.faces.new([bot_center, r_bot[inxt], r_bot[i]])
            except ValueError:
                pass

        wrapper_obj = H.create_mesh_object('wrapper', bm_wrap, mats['parchment'], parent=root)

        # Anchors (root-local):
        H.make_empty('leftSupport', (+0.075, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.075, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.085, 0.030), parent=root)

        glb_path = OUT_DIR / 'roujiamo.glb'
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path),
            export_format='GLB',
            export_yup=True,
            export_apply=True,
            export_cameras=False,
            export_lights=False
        )

        png_path = OUT_DIR / 'roujiamo.png'
        render_thumbnail((0.0, 0.042, 0.0), 0.19, png_path)

        return 'roujiamo', glb_path, png_path

    # -------------------------------------------------------------
    # 2. TANGHULU (skewer)
    # -------------------------------------------------------------
    def build_tanghulu():
        reset_scene()
        mats = init_materials()

        root = bpy.data.objects.new('tanghulu', None)
        bpy.context.collection.objects.link(root)

        # Build 'edible' mesh: 3 candied hawthorn fruits + clear/light-pink glaze highlights
        # 3 round lobes 0.04m diameter staggered vertically from y 0.015 to 0.135
        # Lobe 1: center (0, 0.035, 0), radius 0.020 (y: 0.015 to 0.055)
        # Lobe 2: center (0, 0.075, 0.002), radius 0.020 (y: 0.055 to 0.095)
        # Lobe 3: center (0, 0.115, 0.001), radius 0.020 (y: 0.095 to 0.135)
        # Front of Lobe 3 at y=0.115 is at z = 0.001 + 0.020 = 0.021! Matches bite(0, 0.115, 0.021)
        bm_edible = bmesh.new()

        lobes = [
            ((0.0, 0.035, 0.0), 0.020, 0.020, 0.020),
            ((0.0, 0.075, 0.002), 0.020, 0.020, 0.020),
            ((0.0, 0.115, 0.001), 0.020, 0.020, 0.020),
        ]
        for c, rx, ry, rz in lobes:
            H.add_ellipsoid(bm_edible, c, rx, ry, rz, segs_u=28, segs_v=18, mat_idx=0)

        # Candy glaze highlights:
        # Clear / light pink small highlight patches on fruit surfaces, NOT tan wood, NO upper cone.
        glaze_patches = [
            # Lobe 3 highlights
            ((0.006, 0.125, 0.015), 0.005, 0.006, 0.002),
            ((-0.007, 0.118, 0.016), 0.004, 0.005, 0.0018),
            ((0.014, 0.115, 0.008), 0.003, 0.006, 0.003),
            # Lobe 2 highlights
            ((0.008, 0.082, 0.016), 0.005, 0.006, 0.002),
            ((-0.008, 0.072, 0.016), 0.004, 0.005, 0.0018),
            ((-0.014, 0.076, 0.008), 0.003, 0.006, 0.003),
            # Lobe 1 highlights
            ((0.007, 0.042, 0.015), 0.005, 0.005, 0.002),
            ((-0.008, 0.032, 0.015), 0.004, 0.005, 0.0018),
            # Subtle crystal candy drips between lobes
            ((0.000, 0.055, 0.017), 0.0035, 0.006, 0.002),
            ((0.000, 0.095, 0.017), 0.0035, 0.006, 0.002),
        ]
        for (gx, gy, gz), grx, gry, grz in glaze_patches:
            H.add_ellipsoid(bm_edible, (gx, gy, gz), grx, gry, grz, segs_u=10, segs_v=8, mat_idx=1)

        edible_obj = H.create_mesh_object('edible', bm_edible, [mats['hawthorn'], mats['glaze']], parent=root)

        # Build 'skewer' mesh: wooden skewer with blunt shaft end buried UNDER top edible fruit surface
        # Shaft ends at y = 0.112 with capped blunt end (buried inside Lobe 3, edible top is 0.135; no wood above edible top)
        # Rounded blunt tip at bottom y = -0.060
        bm_skewer = bmesh.new()
        skewer_r = 0.0028
        H.add_cylinder(bm_skewer, (0.0, -0.057, 0.0), (0.0, 0.112, 0.0), skewer_r, segs=16, cap1=False, cap2=True, mat_idx=0)
        H.add_rounded_tip(bm_skewer, (0.0, -0.0572, 0.0), skewer_r, axis_glb=(0, -1, 0), segs=16, mat_idx=0)

        skewer_obj = H.create_mesh_object('skewer', bm_skewer, mats['wood'], parent=root)

        # Anchors (root-local):
        H.make_empty('leftSupport', (+0.015, -0.035, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.015, -0.025, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.115, 0.021), parent=root)

        glb_path = OUT_DIR / 'tanghulu.glb'
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path),
            export_format='GLB',
            export_yup=True,
            export_apply=True,
            export_cameras=False,
            export_lights=False
        )

        png_path = OUT_DIR / 'tanghulu.png'
        render_thumbnail((0.0, 0.040, 0.0), 0.20, png_path)

        return 'tanghulu', glb_path, png_path

    # -------------------------------------------------------------
    # 3. SHUANGPINAI (bowl spoon)
    # -------------------------------------------------------------
    def build_shuangpinai():
        reset_scene()
        mats = init_materials()

        root = bpy.data.objects.new('shuangpinai', None)
        bpy.context.collection.objects.link(root)

        # Build 'container' mesh: open porcelain bowl with gentle jade rim and outerbody #aecbbe
        # Outer radius 0.075, height 0.045, bottom at y = -0.025, lip at y = +0.020.
        bm_bowl = bmesh.new()
        segs_b = 36
        wall_thick = 0.0035
        outer_profile = [
            (-0.025, 0.038),   # Foot ring bottom
            (-0.022, 0.040),   # Foot ring junction
            (-0.015, 0.052),   # Lower body flare
            (-0.005, 0.063),   # Mid body
            (0.010, 0.071),    # Upper body
            (0.020, 0.075),    # Outer lip (outer radius 0.075)
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

        # Container assigned gentle jade porcelain material #aecbbe
        container_obj = H.create_mesh_object('container', bm_bowl, mats['jade'], parent=root)

        # Build 'edible' mesh: warm custard pudding #fff0ce lobes + amber mango cubes .006-.008m + one small green leaf
        bm_edible = bmesh.new()

        # Base milk pudding surface filling bowl up to y = 0.006
        pud_base_r = 0.067
        pud_base_segs = 32
        pud_cen = bm_edible.verts.new(H.glb_to_bl((0, 0.006, 0)))
        pud_ring = []
        for i in range(pud_base_segs):
            th = 2.0 * math.pi * i / pud_base_segs
            pud_ring.append(bm_edible.verts.new(H.glb_to_bl((pud_base_r * math.cos(th), 0.006, pud_base_r * math.sin(th)))))
        bm_edible.verts.ensure_lookup_table()
        for i in range(pud_base_segs):
            inxt = (i + 1) % pud_base_segs
            try:
                f = bm_edible.faces.new([pud_cen, pud_ring[i], pud_ring[inxt]])
                f.material_index = 0
            except ValueError:
                pass

        # Two distinct double-skin milk custard pudding lobes with warm custard color #fff0ce
        H.add_ellipsoid(bm_edible, (-0.022, 0.009, 0.0), 0.033, 0.011, 0.033, segs_u=24, segs_v=12, y_min=0.006, mat_idx=0)
        H.add_ellipsoid(bm_edible, (0.022, 0.009, 0.0), 0.033, 0.011, 0.033, segs_u=24, segs_v=12, y_min=0.006, mat_idx=0)

        # Amber mango cubes .006-.008m (actual 3D faceted cubes)
        mango_cubes = [
            ((0.000, 0.0195, 0.000), 0.0078, 0.0072, 0.0078, (5, 15, 8)),
            ((-0.010, 0.0190, 0.008), 0.0076, 0.0070, 0.0076, (-8, 28, 6)),
            ((0.010, 0.0190, -0.008), 0.0076, 0.0070, 0.0076, (10, -25, -6)),
            ((-0.008, 0.0190, -0.010), 0.0072, 0.0068, 0.0072, (6, 45, 12)),
            ((0.011, 0.0190, 0.008), 0.0074, 0.0070, 0.0074, (-12, -35, 5)),
            ((-0.016, 0.0175, 0.000), 0.0070, 0.0065, 0.0070, (15, 60, -10)),
            ((0.016, 0.0175, -0.002), 0.0070, 0.0065, 0.0070, (-10, -50, 15)),
            ((0.001, 0.0260, 0.001), 0.0068, 0.0062, 0.0068, (8, 20, -12)),
        ]
        for c, sx, sy, sz, rot in mango_cubes:
            H.add_box(bm_edible, c, sx, sy, sz, rot_deg=rot, mat_idx=1)

        # One small green leaf (mint leaf) resting atop mango cubes
        leaf_pts = [
            H.glb_to_bl((0.004, 0.026, -0.006)),  # stem
            H.glb_to_bl((-0.003, 0.0285, 0.002)),  # left edge
            H.glb_to_bl((0.011, 0.0285, 0.002)),   # right edge
            H.glb_to_bl((0.004, 0.0305, 0.011)),   # tip
        ]
        lv = [bm_edible.verts.new(p) for p in leaf_pts]
        try:
            f1 = bm_edible.faces.new([lv[0], lv[1], lv[3]])
            f1.material_index = 2
            f2 = bm_edible.faces.new([lv[0], lv[3], lv[2]])
            f2.material_index = 2
            f1_b = bm_edible.faces.new([lv[0], lv[3], lv[1]])
            f1_b.material_index = 2
            f2_b = bm_edible.faces.new([lv[0], lv[2], lv[3]])
            f2_b.material_index = 2
        except ValueError:
            pass

        edible_obj = H.create_mesh_object('edible', bm_edible, [mats['pudding'], mats['mango'], mats['leaf']], parent=root)

        # Build 'utensil' (spoon):
        # Resting beside bowl on table at GLB (0.088, -0.0225, -0.055)
        # Local +Z in GLB is Blender -Y
        bm_spoon = bmesh.new()
        p_grip_glb = (0.0, 0.0, 0.0)
        p_neck_glb = (0.0, 0.0, 0.085)
        H.add_cylinder(bm_spoon, p_grip_glb, p_neck_glb, 0.0025, segs=16, cap1=True, cap2=False, mat_idx=0)
        # Spoon bowl (distal end from z = 0.085 to 0.110, length 0.025)
        H.add_ellipsoid(bm_spoon, (0.0, 0.002, 0.0975), 0.008, 0.0045, 0.0125, segs_u=20, segs_v=12, mat_idx=0)

        utensil_glb_pos = (0.088, -0.0225, -0.055)
        utensil_obj = H.create_mesh_object('utensil', bm_spoon, mats['jade'], parent=root, location_glb=utensil_glb_pos)

        # Tool nodes parented to utensil (in utensil local coordinates):
        toolGrip = bpy.data.objects.new('toolGrip', None)
        toolGrip.location = Vector((0.0, 0.0, 0.0))
        toolGrip.parent = utensil_obj
        bpy.context.collection.objects.link(toolGrip)

        toolBite = bpy.data.objects.new('toolBite', None)
        toolBite.location = Vector((0.0, -0.110, 0.0))
        toolBite.parent = utensil_obj
        bpy.context.collection.objects.link(toolBite)

        # Luscious visible custard cream blob child tagged 'toolFood' resting in spoon bowl at toolBite
        bm_toolfood = bmesh.new()
        H.add_ellipsoid(bm_toolfood, (0.0, 0.0, 0.0), 0.0055, 0.0038, 0.0062, segs_u=12, segs_v=10, mat_idx=0)
        toolFood = H.create_mesh_object('toolFood', bm_toolfood, mats['pudding'], parent=utensil_obj)
        toolFood.location = Vector((0.0, -0.104, 0.0035))

        # Root-local anchors:
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('content', (0.0, 0.018, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.018, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)

        glb_path = OUT_DIR / 'shuangpinai.glb'
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path),
            export_format='GLB',
            export_yup=True,
            export_apply=True,
            export_cameras=False,
            export_lights=False
        )

        png_path = OUT_DIR / 'shuangpinai.png'
        render_thumbnail((0.02, -0.005, 0.0), 0.17, png_path)

        return 'shuangpinai', glb_path, png_path


    # Build all three
    built = []
    print('BUILDING ROUJIAMO...')
    built.append(build_roujiamo())
    print('BUILDING TANGHULU...')
    built.append(build_tanghulu())
    print('BUILDING SHUANGPINAI...')
    built.append(build_shuangpinai())
    print('BLENDER_BUILD_COMPLETE', [b[0] for b in built])


def run_node_verify_and_manifest():
    """Uses Node GLTFLoader to verify actual exported names, dimensions, anchors and writes manifest.json."""
    node_script = """
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const outDir = '/home/baibai/outbox/pawborough-national-snacks-20261002/m05-assets';
const ids = ['roujiamo', 'tanghulu', 'shuangpinai'];

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
    milestone: 'M05',
    generatedAt: new Date().toISOString(),
    sourceScript: 'asset-authoring/snacks/national/build_six.py',
    renderStatus: 'rendered_eevee_software_512x512_transparent',
    verificationStatus: 'verified_node_gltf_loader',
    foods: {}
  };

  for (const id of ids) {
    const glbPath = path.join(outDir, `${id}.glb`);
    const pngPath = path.join(outDir, `${id}.png`);

    if (!fs.existsSync(glbPath)) throw new Error(`Missing ${glbPath}`);
    if (!fs.existsSync(pngPath)) throw new Error(`Missing ${pngPath}`);

    const glbStats = fs.statSync(glbPath);
    const pngStats = fs.statSync(pngPath);

    if (glbStats.size > 1048576) throw new Error(`${id}.glb exceeds 1MiB: ${glbStats.size} bytes`);
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

    if (id === 'roujiamo') {
      const edible = root.getObjectByName('edible');
      const wrapper = root.getObjectByName('wrapper');
      if (!edible) throw new Error('roujiamo missing part edible');
      if (!wrapper) throw new Error('roujiamo missing part wrapper');
      foodReport.partNames = ['edible', 'wrapper'];

      const leftSupport = root.getObjectByName('leftSupport');
      const rightSupport = root.getObjectByName('rightSupport');
      const bite = root.getObjectByName('bite');
      if (!leftSupport || !rightSupport || !bite) throw new Error('roujiamo missing required anchors');

      foodReport.anchors = {
        leftSupport: leftSupport.position.toArray().map(v => Math.round(v * 10000) / 10000),
        rightSupport: rightSupport.position.toArray().map(v => Math.round(v * 10000) / 10000),
        bite: bite.position.toArray().map(v => Math.round(v * 10000) / 10000)
      };

      // Verify anchor coordinates
      if (Math.abs(foodReport.anchors.leftSupport[0] - 0.075) > 0.002) throw new Error('leftSupport X mismatch');
      if (Math.abs(foodReport.anchors.rightSupport[0] - (-0.075)) > 0.002) throw new Error('rightSupport X mismatch');
      if (Math.abs(foodReport.anchors.bite[1] - 0.085) > 0.002) throw new Error('bite Y mismatch');
      if (Math.abs(foodReport.anchors.bite[2] - 0.030) > 0.002) throw new Error('bite Z mismatch');
      console.log('roujiamo verified OK');
    } else if (id === 'tanghulu') {
      const edible = root.getObjectByName('edible');
      const skewer = root.getObjectByName('skewer');
      if (!edible) throw new Error('tanghulu missing part edible');
      if (!skewer) throw new Error('tanghulu missing part skewer');
      foodReport.partNames = ['edible', 'skewer'];

      const leftSupport = root.getObjectByName('leftSupport');
      const rightSupport = root.getObjectByName('rightSupport');
      const bite = root.getObjectByName('bite');
      if (!leftSupport || !rightSupport || !bite) throw new Error('tanghulu missing required anchors');

      foodReport.anchors = {
        leftSupport: leftSupport.position.toArray().map(v => Math.round(v * 10000) / 10000),
        rightSupport: rightSupport.position.toArray().map(v => Math.round(v * 10000) / 10000),
        bite: bite.position.toArray().map(v => Math.round(v * 10000) / 10000)
      };

      if (Math.abs(foodReport.anchors.leftSupport[0] - 0.015) > 0.002) throw new Error('leftSupport X mismatch');
      if (Math.abs(foodReport.anchors.leftSupport[1] - (-0.035)) > 0.002) throw new Error('leftSupport Y mismatch');
      if (Math.abs(foodReport.anchors.bite[1] - 0.115) > 0.002) throw new Error('bite Y mismatch');
      if (Math.abs(foodReport.anchors.bite[2] - 0.021) > 0.002) throw new Error('bite Z mismatch');
      console.log('tanghulu verified OK');
    } else if (id === 'shuangpinai') {
      const container = root.getObjectByName('container');
      const edible = root.getObjectByName('edible');
      const utensil = root.getObjectByName('utensil');
      if (!container) throw new Error('shuangpinai missing part container');
      if (!edible) throw new Error('shuangpinai missing part edible');
      if (!utensil) throw new Error('shuangpinai missing part utensil');
      foodReport.partNames = ['container', 'edible', 'utensil'];

      const toolGrip = utensil.getObjectByName('toolGrip');
      const toolBite = utensil.getObjectByName('toolBite');
      const toolFood = utensil.getObjectByName('toolFood');
      if (!toolGrip || !toolBite) throw new Error('utensil missing toolGrip or toolBite');
      if (!toolFood) throw new Error('utensil missing toolFood morsel');

      const leftSupport = root.getObjectByName('leftSupport');
      const content = root.getObjectByName('content');
      const bite = root.getObjectByName('bite');
      const rightSupport = root.getObjectByName('rightSupport');
      if (!leftSupport || !content || !bite || !rightSupport) throw new Error('shuangpinai missing required root anchors');

      foodReport.anchors = {
        leftSupport: leftSupport.position.toArray().map(v => Math.round(v * 10000) / 10000),
        content: content.position.toArray().map(v => Math.round(v * 10000) / 10000),
        bite: bite.position.toArray().map(v => Math.round(v * 10000) / 10000),
        rightSupport: rightSupport.position.toArray().map(v => Math.round(v * 10000) / 10000),
        toolGrip: toolGrip.position.toArray().map(v => Math.round(v * 10000) / 10000),
        toolBite: toolBite.position.toArray().map(v => Math.round(v * 10000) / 10000)
      };

      if (Math.abs(foodReport.anchors.leftSupport[0] - 0.070) > 0.002) throw new Error('leftSupport X mismatch');
      if (Math.abs(foodReport.anchors.leftSupport[2] - (-0.030)) > 0.002) throw new Error('leftSupport Z mismatch');
      if (Math.abs(foodReport.anchors.bite[1] - 0.018) > 0.002) throw new Error('bite Y mismatch');
      if (Math.abs(foodReport.anchors.content[1] - 0.018) > 0.002) throw new Error('content Y mismatch');
      if (Math.abs(foodReport.anchors.rightSupport[0] - (-0.050)) > 0.002) throw new Error('rightSupport X mismatch');
      if (Math.abs(foodReport.anchors.toolBite[2] - 0.110) > 0.002) throw new Error('toolBite Z mismatch');
      console.log('shuangpinai verified OK');
    }

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
        print('Starting headless Blender build...')
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

        print('Running Node.js GLTFLoader verification...')
        run_node_verify_and_manifest()
        print('ALL_SNACKS_BUILT_AND_VERIFIED_SUCCESSFULLY!')


if __name__ == '__main__':
    main()
