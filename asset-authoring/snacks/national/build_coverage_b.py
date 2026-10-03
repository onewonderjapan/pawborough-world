# -*- coding: utf-8 -*-
"""Build eight distinct candidate meals (coverage batch B) for the 20261003 expansion:
1. shachamian     (fujian,     bowl,  chopsticks) golden thick noodles, rust peanut broth, shrimp, squid rings, sprouts
2. waguan-tang    (jiangxi,    bowl,  spoon)      ribbed brown clay pot, clear soup, pale pork, mushrooms, matching spoon
3. luosifen       (guangxi,    bowl,  chopsticks) white round rice noodles, bright chili oil, bamboo, wood ear, tofu skin
4. siwawa         (guizhou,    wrapped, none)     fan of 3 thin white crepe swaddle rolls, veg strips up, ivory paper support
5. suanlafen      (chongqing,  bowl,  chopsticks) thick translucent sweet-potato noodle curls, chili-red broth, peanuts
6. niangpi        (gansu,      bowl,  chopsticks) wide short wheat-starch ribbons, porous gluten chunks, red oil, cucumber
7. qinghai-yogurt (qinghai,    bowl,  spoon)      turquoise bowl, set yogurt, yellow cream skin with broken edge, gold flecks
8. sanzi          (ningxia,    cupped, none)      golden fried thread loop nest, airy curved thin rods

Outputs ONLY to:
/home/baibai/outbox/pawborough-food-coverage-20261003/assets-b/{id}.glb
/home/baibai/outbox/pawborough-food-coverage-20261003/assets-b/{id}.png
/home/baibai/outbox/pawborough-food-coverage-20261003/assets-b/manifest.json

GLB coordinate contract: Y-up, +Z cat-front (helpers design space). Static geometry only;
no floor/camera/light in GLBs. <= 8 source materials per food; GLB <= 524288 bytes;
256x256 transparent PNG <= 28672 bytes after palette quantization.

Anchors (current confirmed meal geometry contract):
- every model: root named <id>, child edible, socket_grip [0,0,0], socket_rest at model bottom
- bowl:    container / edible / utensil; leftSupport [.070,0,-.030], rightSupport [-.050,0,0],
           content [0,.030,0], bite [0,.030,0]; utensil nested toolGrip [0,0,0], toolBite [0,0,.110]
- cupped:  single edible node; leftSupport [.065,0,0], rightSupport [-.065,0,0], bite [0,.05,.02];
           bottom center y ~ -.025
- wrapped: wrapper / edible; leftSupport [.06,-.025,0], rightSupport [-.06,-.025,0], bite [0,.06,.035];
           wrapper covers lower grip only, exposed edible reaches bite
"""
import os
import sys
import math
import json
import hashlib
import subprocess
from pathlib import Path

OUT_DIR = Path('/home/baibai/outbox/pawborough-food-coverage-20261003/assets-b')
WORK_ROOT = Path(__file__).resolve().parents[3]
VERIFY_MJS = Path(__file__).with_name('build_coverage_b_verify.mjs')
SOURCE_SCRIPT_REL = 'asset-authoring/snacks/national/build_coverage_b.py'

GLB_MAX_BYTES = 524288
PNG_MAX_BYTES = 28672


def run_blender_build(selected_ids=None):
    """Runs inside Blender to generate GLB models and rendered thumbnails."""
    import bpy
    import bmesh
    from mathutils import Vector

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
    # Scene reset
    # -------------------------------------------------------------
    def reset_scene():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.unit_settings.system = 'METRIC'

    # -------------------------------------------------------------
    # Shared Thumbnail Renderer (256x256 transparent, Cycles CPU, 4 threads)
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

        key_data = bpy.data.lights.new('KeySun', 'SUN')
        key_data.energy = 3.5
        key_data.color = (1.0, 0.98, 0.94)
        key_obj = bpy.data.objects.new('KeySun', key_data)
        sc.collection.objects.link(key_obj)
        key_dir = H.glb_to_bl((-0.5, -0.9, -0.6)).normalized()
        key_obj.rotation_euler = key_dir.to_track_quat('-Z', 'Y').to_euler()

        fill_data = bpy.data.lights.new('FillLight', 'AREA')
        fill_data.energy = 8.0
        fill_data.size = 0.4
        fill_data.color = (0.95, 0.92, 0.88)
        fill_obj = bpy.data.objects.new('FillLight', fill_data)
        sc.collection.objects.link(fill_obj)
        fill_obj.location = c_bl + H.glb_to_bl((-0.3, 0.2, 0.4))
        fill_obj.rotation_euler = (c_bl - fill_obj.location).normalized().to_track_quat('-Z', 'Y').to_euler()

        rim_data = bpy.data.lights.new('RimLight', 'AREA')
        rim_data.energy = 12.0
        rim_data.size = 0.3
        rim_data.color = (1.0, 0.96, 0.90)
        rim_obj = bpy.data.objects.new('RimLight', rim_data)
        sc.collection.objects.link(rim_obj)
        rim_obj.location = c_bl + H.glb_to_bl((0.3, 0.4, -0.4))
        rim_obj.rotation_euler = (c_bl - rim_obj.location).normalized().to_track_quat('-Z', 'Y').to_euler()

        sc.render.filepath = str(out_png)
        bpy.ops.render.render(write_still=True)

    # -------------------------------------------------------------
    # Local geometry helpers (extend, never modify, helpers.py)
    # -------------------------------------------------------------
    def recalc_normals(bm):
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    def add_tube_path(bm, points_glb, radius, segs=8, mat_idx=0, closed=False):
        """Chain of cylinders along a polyline; rounded enough for noodles/rods."""
        pts = list(points_glb)
        n = len(pts)
        for i in range(n - 1):
            H.add_cylinder(bm, pts[i], pts[i + 1], radius, segs=segs,
                           cap1=(i == 0), cap2=(i == n - 2), mat_idx=mat_idx)
        if closed and n >= 3:
            H.add_cylinder(bm, pts[-1], pts[0], radius, segs=segs, cap1=False, cap2=False, mat_idx=mat_idx)

    def add_vessel(bm, outer_profile, inner_profile, segs=36, mat_idx=0,
                   radius_mod=None, squash=(1.0, 1.0), center=(0.0, 0.0)):
        """Lathe-built open vessel from (py, pr) profiles bottom->lip (m11 jade bowl pattern)."""
        all_rings = []

        def push_ring(py, pr):
            row = []
            for i in range(segs):
                th = 2.0 * math.pi * i / segs
                r = pr * (radius_mod(th) if radius_mod else 1.0)
                x = center[0] + r * math.cos(th) * squash[0]
                z = center[1] + r * math.sin(th) * squash[1]
                row.append(bm.verts.new(H.glb_to_bl((x, py, z))))
            all_rings.append(row)

        for py, pr in outer_profile:
            push_ring(py, pr)
        for py, pr in inner_profile[:-1]:
            push_ring(py, pr)

        bm.verts.ensure_lookup_table()
        for ir in range(len(all_rings) - 1):
            r1 = all_rings[ir]
            r2 = all_rings[ir + 1]
            for i in range(segs):
                inxt = (i + 1) % segs
                try:
                    bm.faces.new([r1[i], r1[inxt], r2[inxt], r2[i]])
                except ValueError:
                    pass

        cen_in = bm.verts.new(H.glb_to_bl((center[0], inner_profile[-1][0], center[1])))
        last_inner = all_rings[-1]
        for i in range(segs):
            inxt = (i + 1) % segs
            try:
                bm.faces.new([cen_in, last_inner[inxt], last_inner[i]])
            except ValueError:
                pass

        cen_out = bm.verts.new(H.glb_to_bl((center[0], outer_profile[0][0], center[1])))
        first_outer = all_rings[0]
        for i in range(segs):
            inxt = (i + 1) % segs
            try:
                bm.faces.new([cen_out, first_outer[i], first_outer[inxt]])
            except ValueError:
                pass

    def add_torus(bm, center_glb, R, r_tube, segs_major=16, segs_minor=8, squash_z=1.0, mat_idx=0):
        cx, cy, cz = center_glb
        rings = []
        for i in range(segs_major):
            th = 2.0 * math.pi * i / segs_major
            cos_t, sin_t = math.cos(th), math.sin(th)
            ring = []
            for j in range(segs_minor):
                ph = 2.0 * math.pi * j / segs_minor
                rr = R + r_tube * math.cos(ph)
                px = cx + rr * cos_t
                py = cy + r_tube * math.sin(ph)
                pz = cz + rr * sin_t * squash_z
                ring.append(bm.verts.new(H.glb_to_bl((px, py, pz))))
            rings.append(ring)
        bm.verts.ensure_lookup_table()
        for i in range(segs_major):
            r1 = rings[i]
            r2 = rings[(i + 1) % segs_major]
            for j in range(segs_minor):
                jn = (j + 1) % segs_minor
                try:
                    bm.faces.new([r1[j], r1[jn], r2[jn], r2[j]])
                except ValueError:
                    pass

    def add_flat_ribbon(bm, points, width=0.009, thickness=0.0018, mat_idx=0):
        """Thin rectangular cross-section ribbon along a polyline (m11 liangpi pattern)."""
        n_pts = len(points)
        if n_pts < 2:
            return
        frames = []
        for i in range(n_pts):
            p_bl = H.glb_to_bl(Vector(points[i]))
            if i == 0:
                tangent = (H.glb_to_bl(Vector(points[1])) - p_bl).normalized()
            elif i == n_pts - 1:
                tangent = (p_bl - H.glb_to_bl(Vector(points[-2]))).normalized()
            else:
                tangent = (H.glb_to_bl(Vector(points[i + 1])) - H.glb_to_bl(Vector(points[i - 1]))).normalized()
            up = Vector((0, 0, 1)) if abs(tangent.z) < 0.9 else Vector((0, 1, 0))
            normal = tangent.cross(up).normalized()
            binormal = tangent.cross(normal).normalized()
            hw, ht = width / 2.0, thickness / 2.0
            frames.append([
                bm.verts.new(p_bl - normal * hw - binormal * ht),
                bm.verts.new(p_bl + normal * hw - binormal * ht),
                bm.verts.new(p_bl + normal * hw + binormal * ht),
                bm.verts.new(p_bl - normal * hw + binormal * ht),
            ])
        bm.verts.ensure_lookup_table()
        for i in range(n_pts - 1):
            f1, f2 = frames[i], frames[i + 1]
            for k in range(4):
                kn = (k + 1) % 4
                try:
                    face = bm.faces.new([f1[k], f1[kn], f2[kn], f2[k]])
                    face.material_index = mat_idx
                except ValueError:
                    pass
        try:
            bm.faces.new(frames[0]).material_index = mat_idx
        except ValueError:
            pass
        try:
            bm.faces.new(list(reversed(frames[-1]))).material_index = mat_idx
        except ValueError:
            pass

    def add_helix_curl(bm, center, R, r_tube, turns, height, phase=0.0, mat_idx=0, segs_per_turn=22):
        """Tight coiled noodle curl (suanlafen sweet potato noodle)."""
        cx, cy0, cz = center
        steps = max(8, int(turns * segs_per_turn))
        pts = []
        for s in range(steps + 1):
            t = s / steps
            th = phase + 2.0 * math.pi * turns * t
            px = cx + R * math.cos(th)
            pz = cz + R * math.sin(th) * 0.92
            py = cy0 + height * t
            pts.append((px, py, pz))
        add_tube_path(bm, pts, r_tube, segs=8, mat_idx=mat_idx)

    def add_shrimp(bm, center, azimuth_deg, scale=1.0, mat_idx=0):
        """Curved C shrimp lying on noodles: tapered arc body, segment ridges, tail fan."""
        cx, cy, cz = center
        az = math.radians(azimuth_deg)
        cos_a, sin_a = math.cos(az), math.sin(az)
        R_arc = 0.016 * scale
        steps = 9
        pts = []
        for s in range(steps + 1):
            t = s / steps
            ang = math.radians(-95.0 + 190.0 * t)
            px = cx
            py = cy + R_arc * 0.72 * (math.sin(ang) + 0.62)
            pz = cz + R_arc * math.cos(ang) * 0.94
            pts.append((px, py, pz))
        # tapered arc body built as chained cylinders with decreasing radius
        for i in range(steps):
            r0 = (0.0056 - 0.0026 * (i / steps)) * scale
            r1 = (0.0056 - 0.0026 * ((i + 1) / steps)) * scale
            mid_r = (r0 + r1) * 0.5
            H.add_cylinder(bm, pts[i], pts[i + 1], mid_r, segs=10, cap1=(i == 0), cap2=(i == steps - 1), mat_idx=mat_idx)
        # segment ridges on the back
        for i in range(1, 6):
            t = i / 6.0
            ang = math.radians(-70.0 + 150.0 * t)
            bx = cx
            by = cy + (R_arc * 0.72 * (math.sin(ang) + 0.62)) + 0.0032 * scale
            bz = cz + R_arc * math.cos(ang) * 0.94
            H.add_box(bm, (bx, by, bz), 0.0075 * scale, 0.0022 * scale, 0.0042 * scale,
                      rot_deg=(0, 8.0 * i - 20.0, azimuth_deg + 90.0), mat_idx=mat_idx)
        # tail fan at the head end (t near 0 side)
        t_end = pts[0]
        H.add_box(bm, (t_end[0], t_end[1] + 0.0025 * scale, t_end[2] + 0.0035 * scale),
                  0.0075 * scale, 0.0018 * scale, 0.0090 * scale,
                  rot_deg=(14, 0, azimuth_deg + 130.0), mat_idx=mat_idx)
        H.add_box(bm, (t_end[0], t_end[1] - 0.0022 * scale, t_end[2] + 0.0038 * scale),
                  0.0062 * scale, 0.0018 * scale, 0.0075 * scale,
                  rot_deg=(-10, 0, azimuth_deg + 150.0), mat_idx=mat_idx)

    def add_sprout(bm, base, tilt_deg, azimuth_deg, stem_len=0.020, mat_stem=0, mat_head=0):
        """Bean sprout: curved ivory-green stem with small head bud and two leaflets."""
        bx, by, bz = base
        tilt = math.radians(tilt_deg)
        az = math.radians(azimuth_deg)
        pts = []
        for s in range(4):
            t = s / 3.0
            lean = math.sin(tilt) * stem_len * t
            up = math.cos(tilt) * stem_len * t
            px = bx + lean * math.cos(az) + 0.0022 * math.sin(t * 2.6)
            py = by + up
            pz = bz + lean * math.sin(az)
            pts.append((px, py, pz))
        add_tube_path(bm, pts, 0.0011, segs=6, mat_idx=mat_stem)
        head = pts[-1]
        H.add_ellipsoid(bm, head, 0.0022, 0.0042, 0.0022, segs_u=8, segs_v=6, mat_idx=mat_head)
        H.add_ellipsoid(bm, (head[0] + 0.0022, head[1] - 0.0035, head[2]),
                        0.0016, 0.0022, 0.0010, segs_u=6, segs_v=4, mat_idx=mat_stem)

    # -------------------------------------------------------------
    # Vessels (bowl contract: outer radius .075, bottom -.025, support plane fixed)
    # -------------------------------------------------------------
    def build_porcelain_bowl(root, mat, rim_color=None):
        """Standard m11 jade-bowl silhouette, any ceramic color."""
        bm_v = bmesh.new()
        wall = 0.0035
        outer = [
            (-0.025, 0.038),
            (-0.022, 0.040),
            (-0.015, 0.052),
            (-0.005, 0.063),
            (0.010, 0.071),
            (0.020, 0.075),
        ]
        inner = [
            (0.020, 0.075 - wall),
            (0.010, 0.0675),
            (-0.005, 0.059),
            (-0.015, 0.048),
            (-0.0215, 0.034),
            (-0.0215, 0.0),
        ]
        add_vessel(bm_v, outer, inner, segs=36, mat_idx=0)
        recalc_normals(bm_v)
        return H.create_mesh_object('container', bm_v, mat, parent=root)

    def build_clay_pot(root, mat):
        """Ribbed warm brown clay pot: squatter belly, pulled shoulder, thick rolled lip."""
        bm_v = bmesh.new()
        outer = [
            (-0.025, 0.034),
            (-0.021, 0.041),
            (-0.013, 0.054),
            (-0.004, 0.065),
            (0.004, 0.070),
            (0.012, 0.070),
            (0.019, 0.064),
            (0.024, 0.060),
            (0.027, 0.061),
            (0.029, 0.0635),
        ]
        inner = [
            (0.029, 0.053),
            (0.024, 0.051),
            (0.019, 0.055),
            (0.012, 0.061),
            (0.004, 0.061),
            (-0.004, 0.055),
            (-0.013, 0.044),
            (-0.019, 0.032),
            (-0.019, 0.0),
        ]

        def ribs(th):
            return 1.0 + 0.014 * (0.5 + 0.5 * math.sin(th * 9.0))

        add_vessel(bm_v, outer, inner, segs=48, mat_idx=0, radius_mod=ribs)
        recalc_normals(bm_v)
        return H.create_mesh_object('container', bm_v, mat, parent=root)

    def build_turquoise_bowl(root, mat):
        """Squat rounded yogurt bowl, same support plane."""
        bm_v = bmesh.new()
        wall = 0.0035
        outer = [
            (-0.025, 0.037),
            (-0.020, 0.046),
            (-0.010, 0.060),
            (0.002, 0.070),
            (0.012, 0.0745),
            (0.021, 0.0755),
        ]
        inner = [
            (0.021, 0.0755 - wall),
            (0.012, 0.0705),
            (0.002, 0.0660),
            (-0.010, 0.0555),
            (-0.0185, 0.040),
            (-0.0185, 0.0),
        ]
        add_vessel(bm_v, outer, inner, segs=36, mat_idx=0)
        recalc_normals(bm_v)
        return H.create_mesh_object('container', bm_v, mat, parent=root)

    # -------------------------------------------------------------
    # Utensils (m11 patterns; spoon scoop is a hollow oval)
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

    def build_spoon_utensil(root, mat_spoon, tool_food_fn):
        """Spoon with visibly hollow oval scoop; tips/scoop rim at z=.110."""
        bm_spoon = bmesh.new()
        H.add_cylinder(bm_spoon, (0.0, 0.0, 0.0), (0.0, 0.004, 0.088), 0.0026, segs=14, cap1=True, cap2=False, mat_idx=0)
        # hollow oval scoop: lathe around +Y at scoop center, oval squash (x .88, z 1.30)
        sco_c = (0.0, 0.005, 0.0975)
        outer = [
            (-0.0040, 0.0006),
            (-0.0034, 0.0034),
            (-0.0016, 0.0068),
            (0.0008, 0.0090),
            (0.0032, 0.0096),
        ]
        inner = [
            (0.0028, 0.0090),
            (0.0002, 0.0070),
            (-0.0012, 0.0038),
            (-0.0014, 0.0020),
        ]
        add_vessel(bm_spoon, outer, inner, segs=24, mat_idx=0, center=(sco_c[0], sco_c[2]), squash=(0.88, 1.30))
        recalc_normals(bm_spoon)
        utensil_glb_pos = (0.088, -0.0225, -0.055)
        utensil_obj = H.create_mesh_object('utensil', bm_spoon, mat_spoon, parent=root, location_glb=utensil_glb_pos)

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
    # Anchor / socket helpers
    # -------------------------------------------------------------
    def add_common_sockets(root, rest_y):
        H.make_empty('socket_grip', (0.0, 0.0, 0.0), parent=root)
        H.make_empty('socket_rest', (0.0, rest_y, 0.0), parent=root)

    def add_bowl_anchors(root):
        H.make_empty('leftSupport', (0.070, 0.0, -0.030), parent=root)
        H.make_empty('content', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.030, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.050, 0.0, 0.0), parent=root)
        add_common_sockets(root, -0.025)

    def finalize(id_name, center_glb, target_size):
        glb_path = OUT_DIR / f'{id_name}.glb'
        png_path = OUT_DIR / f'{id_name}.png'
        if glb_path.exists():
            os.remove(glb_path)
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path),
            export_format='GLB',
            export_yup=True,
            export_apply=True,
            export_cameras=False,
            export_lights=False
        )
        size = os.path.getsize(glb_path)
        if size > GLB_MAX_BYTES:
            raise RuntimeError(f'{id_name}.glb exceeds {GLB_MAX_BYTES} bytes: {size}')
        print(f'EXPORTED_GLB: {glb_path} ({size} bytes)')
        return id_name, center_glb, target_size, glb_path, png_path

    # =============================================================
    # 1. SHACHAMIAN (bowl, chopsticks)
    # Golden thick noodles nested in rings over rust peanut-brown broth,
    # curved shrimp, ivory squid rings, standing green sprouts.
    # =============================================================
    def build_shachamian(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'bowl': H.make_mat('mat_bowl', 'efe6d6', roughness=0.15, specular=0.8),
            'noodle': H.make_mat('mat_noodle', 'e3ac4e', roughness=0.42, specular=0.45),
            'broth': H.make_mat('mat_broth', '7e4222', roughness=0.20, specular=0.85),
            'shrimp': H.make_mat('mat_shrimp', 'd9602c', roughness=0.35, specular=0.55),
            'squid': H.make_mat('mat_squid', 'ece2d0', roughness=0.30, specular=0.6),
            'sprout': H.make_mat('mat_sprout', '77b04a', roughness=0.38),
        }
        chop_mat = H.make_mat('mat_chopsticks', '553118', roughness=0.48, specular=0.45)

        root = bpy.data.objects.new('shachamian', None)
        bpy.context.collection.objects.link(root)

        build_porcelain_bowl(root, mats['bowl'])

        bm = bmesh.new()
        # rust peanut broth pool (y <= .012)
        H.add_ellipsoid(bm, (0.0, 0.002, 0.0), 0.056, 0.010, 0.056, segs_u=28, segs_v=12, y_max=0.012, mat_idx=2)
        # thick golden noodle nest: concentric oval rings (distinct from dandanmian tangle)
        ring_count = 10
        for k in range(ring_count):
            R = 0.016 + 0.0032 * k
            py = 0.016 + 0.0024 * k + 0.0016 * math.sin(k * 1.7)
            pts = []
            steps = 30
            for s in range(steps + 1):
                th = 2.0 * math.pi * s / steps
                rr = R * (1.0 + 0.035 * math.sin(th * 2.0 + k))
                pts.append((rr * math.cos(th), py + 0.0012 * math.sin(th * 3.0 + k), rr * math.sin(th) * 0.92))
            add_tube_path(bm, pts, 0.0030, segs=8, mat_idx=1, closed=True)
        # key strand passing through content/bite (0, .030, 0)
        key_pts = [(-0.030, 0.025, -0.014), (-0.015, 0.028, -0.006), (0.0, 0.030, 0.0), (0.015, 0.029, 0.007), (0.030, 0.025, 0.015)]
        add_tube_path(bm, key_pts, 0.0030, segs=8, mat_idx=1)
        # a few draped strands from rim over the nest
        for i in range(5):
            a0 = i * (2.0 * math.pi / 5.0) + 0.4
            pts = []
            for s in range(7):
                t = s / 6.0
                rr = 0.050 - 0.036 * t
                th = a0 + t * 0.9
                py = 0.018 + 0.020 * math.sin(t * math.pi)
                pts.append((rr * math.cos(th), py, rr * math.sin(th)))
            add_tube_path(bm, pts, 0.0030, segs=8, mat_idx=1)
        # curved shrimp
        add_shrimp(bm, (-0.024, 0.038, 0.012), azimuth_deg=25.0, scale=0.95, mat_idx=3)
        add_shrimp(bm, (0.022, 0.040, -0.016), azimuth_deg=145.0, scale=0.9, mat_idx=3)
        add_shrimp(bm, (0.008, 0.044, 0.030), azimuth_deg=80.0, scale=0.8, mat_idx=3)
        # ivory squid rings
        for c, R in (((-0.034, 0.030, -0.020), 0.0085), ((0.038, 0.028, 0.014), 0.0080), ((0.004, 0.032, -0.034), 0.0075)):
            add_torus(bm, c, R, 0.0022, segs_major=16, segs_minor=8, mat_idx=4)
        # standing green sprouts
        sprouts = [
            ((-0.012, 0.042, 0.006), 16, 20), ((0.030, 0.040, 0.024), 24, -40),
            ((-0.036, 0.038, 0.012), 20, 70), ((0.014, 0.044, -0.028), 18, 160),
            ((-0.004, 0.046, 0.020), 12, -15), ((0.042, 0.034, -0.006), 26, 110),
        ]
        for base, tilt, az in sprouts:
            add_sprout(bm, base, tilt, az, stem_len=0.021, mat_stem=5, mat_head=5)
        recalc_normals(bm)
        H.create_mesh_object('edible', bm, [mats['noodle'], mats['broth'], mats['shrimp'], mats['squid'], mats['sprout']], parent=root)

        def add_morsel(utensil_obj):
            bm_tf = bmesh.new()
            loop_pts = [(-0.002, 0.001, -0.007), (0.0, 0.003, -0.002), (0.002, 0.002, 0.004), (0.0, -0.001, 0.005)]
            add_tube_path(bm_tf, loop_pts, 0.0026, segs=6, mat_idx=0)
            H.add_ellipsoid(bm_tf, (0.0, 0.005, 0.0), 0.0035, 0.0022, 0.0035, segs_u=6, segs_v=5, mat_idx=2)
            tf = H.create_mesh_object('toolFood', bm_tf, [mats['noodle'], mats['shrimp']], parent=utensil_obj)
            tf.location = Vector((0.0, -0.106, 0.001))

        build_chopsticks_utensil(root, chop_mat, add_morsel)
        add_bowl_anchors(root)

        info = finalize('shachamian', (0.020, -0.005, 0.0), 0.18)
        if render_png:
            render_thumbnail(info[1], info[2], info[4])
            print(f'RENDERED_PNG: {info[4]}')
        return info

    # =============================================================
    # 2. WAGUAN-TANG (bowl, spoon)
    # Ribbed brown clay pot with thick lip; clear amber soup, pale pork
    # chunks, whole mushrooms, scallion, gold oil flecks; matching clay spoon.
    # =============================================================
    def build_waguan_tang(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'clay': H.make_mat('mat_clay', '9a5f3c', roughness=0.55, specular=0.35),
            'broth': H.make_mat('mat_broth', 'c9a86a', roughness=0.18, specular=0.8),
            'pork': H.make_mat('mat_pork', 'd8b48e', roughness=0.60),
            'shroom_cap': H.make_mat('mat_shroom_cap', '7a5232', roughness=0.50),
            'shroom_stem': H.make_mat('mat_shroom_stem', 'd9c9a8', roughness=0.55),
            'scallion': H.make_mat('mat_scallion', '5d9640', roughness=0.40),
            'oil': H.make_mat('mat_oil', 'd9b25f', roughness=0.20, specular=0.7),
        }

        root = bpy.data.objects.new('waguan-tang', None)
        bpy.context.collection.objects.link(root)

        build_clay_pot(root, mats['clay'])

        bm = bmesh.new()
        # clear amber soup surface
        H.add_ellipsoid(bm, (0.0, 0.004, 0.0), 0.050, 0.007, 0.050, segs_u=24, segs_v=10, y_max=0.010, mat_idx=1)
        # pale pork chunks (rounded irregular cubes), center chunk at content point
        pork_specs = [
            ((0.0, 0.016, 0.0), (0.012, 0.010, 0.012), (6, 14, -4)),
            ((-0.026, 0.013, -0.014), (0.011, 0.009, 0.011), (-10, 30, 8)),
            ((0.028, 0.012, 0.012), (0.010, 0.009, 0.011), (12, -22, -8)),
            ((-0.012, 0.012, 0.030), (0.010, 0.008, 0.010), (8, 20, 14)),
            ((0.018, 0.013, -0.030), (0.010, 0.008, 0.010), (-14, -18, 6)),
        ]
        for c, s, r in pork_specs:
            H.add_box(bm, c, s[0], s[1], s[2], rot_deg=r, mat_idx=2)
            # soft top bevel strip
            H.add_box(bm, (c[0], c[1] + s[1] * 0.42, c[2]), s[0] * 0.8, 0.0016, s[2] * 0.8, rot_deg=r, mat_idx=2)
        # whole mushrooms: cap dome + stem
        def add_whole_mushroom(c, cap_r, cap_h, tilt_deg, az_deg):
            H.add_ellipsoid(bm, (c[0], c[1] + cap_h * 0.5, c[2]), cap_r, cap_h, cap_r, segs_u=14, segs_v=8,
                            y_min=c[1] - 0.001, mat_idx=3)
            H.add_cylinder(bm, c, (c[0], c[1] - 0.007, c[2]), 0.0026, segs=10, cap1=True, cap2=True, mat_idx=4)
        add_whole_mushroom((0.0, 0.026, 0.006), 0.0105, 0.007, 0.0, 0.0)
        add_whole_mushroom((-0.030, 0.022, 0.016), 0.009, 0.006, 0.0, 0.0)
        add_whole_mushroom((0.026, 0.021, -0.024), 0.0085, 0.006, 0.0, 0.0)
        # mushroom slices
        for c, az in (((-0.006, 0.024, -0.024), 30.0), ((0.016, 0.024, 0.026), -55.0)):
            a = math.radians(az)
            H.add_ellipsoid(bm, c, 0.0075, 0.0022, 0.0075, segs_u=10, segs_v=6, y_min=c[1] - 0.002, mat_idx=4)
        # scallion rings
        for i in range(9):
            r = 0.006 + 0.030 * ((i * 7) % 9) / 9.0
            th = i * 2.39996
            x, z = r * math.cos(th), r * math.sin(th)
            y = 0.014 + 0.003 * math.sin(i * 3.1)
            H.add_cylinder(bm, (x, y, z), (x, y + 0.0035, z), 0.0022, segs=8, mat_idx=5)
        # gold oil droplets on the clear soup
        for i in range(8):
            r = 0.008 + 0.034 * ((i * 5) % 8) / 8.0
            th = i * 2.39996 + 1.1
            x, z = r * math.cos(th), r * math.sin(th)
            H.add_ellipsoid(bm, (x, 0.0115, z), 0.0032, 0.0008, 0.0032, segs_u=8, segs_v=5, mat_idx=6)
        recalc_normals(bm)
        H.create_mesh_object('edible', bm, [mats['broth'], mats['pork'], mats['shroom_cap'], mats['shroom_stem'], mats['scallion'], mats['oil']], parent=root)

        def add_morsel(utensil_obj):
            bm_tf = bmesh.new()
            H.add_box(bm_tf, (0.0, 0.0, 0.0), 0.0080, 0.0065, 0.0080, rot_deg=(5, 12, 0), mat_idx=0)
            H.add_ellipsoid(bm_tf, (0.002, 0.005, 0.001), 0.0055, 0.0022, 0.0055, segs_u=8, segs_v=6, y_min=0.002, mat_idx=1)
            tf = H.create_mesh_object('toolFood', bm_tf, [mats['pork'], mats['shroom_cap']], parent=utensil_obj)
            tf.location = Vector((0.0, -0.101, 0.003))

        build_spoon_utensil(root, mats['clay'], add_morsel)
        add_bowl_anchors(root)

        info = finalize('waguan-tang', (0.020, -0.002, 0.0), 0.17)
        if render_png:
            render_thumbnail(info[1], info[2], info[4])
            print(f'RENDERED_PNG: {info[4]}')
        return info

    # =============================================================
    # 3. LUOSIFEN (bowl, chopsticks)
    # White round rice noodles draped, bright chili oil, beige bamboo shoot
    # strips, black wood ear curls, golden fried tofu skins.
    # =============================================================
    def build_luosifen(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'bowl': H.make_mat('mat_bowl', '8e3324', roughness=0.18, specular=0.7),
            'noodle': H.make_mat('mat_noodle', 'f1ebdf', roughness=0.38, specular=0.4),
            'oil': H.make_mat('mat_oil', 'cc2f0e', roughness=0.18, specular=0.9),
            'bamboo': H.make_mat('mat_bamboo', 'c8b482', roughness=0.50),
            'wood_ear': H.make_mat('mat_wood_ear', '2a1c16', roughness=0.25, specular=0.6),
            'tofu_skin': H.make_mat('mat_tofu_skin', 'd9a441', roughness=0.55),
            'scallion': H.make_mat('mat_scallion', '4d9428', roughness=0.35),
        }
        chop_mat = H.make_mat('mat_chopsticks', '553118', roughness=0.48, specular=0.45)

        root = bpy.data.objects.new('luosifen', None)
        bpy.context.collection.objects.link(root)

        build_porcelain_bowl(root, mats['bowl'])

        bm = bmesh.new()
        # bright chili oil pool
        H.add_ellipsoid(bm, (0.0, 0.002, 0.0), 0.056, 0.010, 0.056, segs_u=28, segs_v=12, y_max=0.012, mat_idx=2)
        # white round rice noodles: hanging drape loops rim->center (distinct structure)
        for i in range(14):
            a0 = i * (2.0 * math.pi / 14.0) + 0.15 * (i % 3)
            sag = 0.016 + 0.006 * ((i * 3) % 4) / 3.0
            pts = []
            for s in range(9):
                t = s / 8.0
                th = a0 + math.pi * t + 0.25 * math.sin(i * 1.3)
                rr = 0.046 - 0.030 * math.sin(t * math.pi) + 0.004 * math.sin(t * 4.0 + i)
                py = 0.040 - sag * math.sin(t * math.pi) + 0.003 * math.cos(t * 3.0 + i)
                pts.append((rr * math.cos(th), py, rr * math.sin(th)))
            add_tube_path(bm, pts, 0.0022, segs=8, mat_idx=1)
        # key strand through (0, .030, 0)
        key_pts = [(-0.026, 0.026, 0.014), (-0.012, 0.029, 0.006), (0.0, 0.030, 0.0), (0.013, 0.028, -0.007), (0.026, 0.024, -0.013)]
        add_tube_path(bm, key_pts, 0.0022, segs=8, mat_idx=1)
        # beige bamboo shoot strips (flat, slightly curved)
        bamboo_specs = [
            [(-0.030, 0.026, 0.008), (-0.012, 0.032, 0.004), (0.008, 0.034, 0.010), (0.026, 0.030, 0.018)],
            [(0.010, 0.028, -0.026), (0.000, 0.034, -0.012), (-0.012, 0.035, 0.002), (-0.024, 0.031, 0.012)],
            [(-0.036, 0.024, -0.008), (-0.020, 0.030, -0.014), (0.002, 0.032, -0.018), (0.020, 0.028, -0.014)],
        ]
        for pts in bamboo_specs:
            add_flat_ribbon(bm, pts, width=0.009, thickness=0.0020, mat_idx=3)
        # black wood ear curls: arced ruffled sheets
        wood_specs = [
            ((-0.020, 0.034, -0.006), 0.011, 30.0),
            ((0.024, 0.032, 0.010), 0.0095, 120.0),
            ((0.004, 0.036, 0.024), 0.009, -70.0),
            ((-0.034, 0.028, 0.020), 0.0085, 200.0),
        ]
        for c, R, az in wood_specs:
            a = math.radians(az)
            pts = []
            for s in range(7):
                t = -1.0 + 2.0 * s / 6.0
                ph = t * 2.2
                px = c[0] + R * math.sin(ph) * math.cos(a) - 0.0025 * (t * t)
                py = c[1] + 0.006 * math.cos(ph * 0.8) + 0.0035 * (1.0 - t * t) * 0.4
                pz = c[2] + R * math.sin(ph) * math.sin(a)
                pts.append((px, py, pz))
            add_flat_ribbon(bm, pts, width=0.012, thickness=0.0014, mat_idx=4)
        # golden fried tofu skins: puffy blistered sheets
        tofu_specs = [
            ((-0.004, 0.040, 0.008), (0.020, 0.003, 0.014), (8, 22, 10)),
            ((0.026, 0.036, -0.014), (0.016, 0.003, 0.012), (-10, -30, -14)),
            ((-0.030, 0.034, -0.018), (0.014, 0.003, 0.011), (12, 40, 6)),
        ]
        for c, s, r in tofu_specs:
            H.add_box(bm, c, s[0], s[1], s[2], rot_deg=r, mat_idx=5)
            for k in range(4):
                H.add_ellipsoid(bm, (c[0] + 0.005 * math.cos(k * 1.9) * s[0] / 0.02,
                                     c[1] + s[1] * 0.55,
                                     c[2] + 0.005 * math.sin(k * 1.9) * s[2] / 0.014),
                                0.0030, 0.0018, 0.0030, segs_u=6, segs_v=5, mat_idx=5)
        # scallion flecks
        for i in range(10):
            r = 0.005 + 0.036 * ((i * 7) % 10) / 10.0
            th = i * 2.39996 + 0.8
            x, z = r * math.cos(th), r * math.sin(th)
            y = 0.036 + 0.004 * math.sin(i * 2.7)
            H.add_cylinder(bm, (x, y, z), (x, y + 0.0022, z), 0.0020, segs=6, mat_idx=6)
        recalc_normals(bm)
        H.create_mesh_object('edible', bm, [mats['noodle'], mats['oil'], mats['bamboo'], mats['wood_ear'], mats['tofu_skin'], mats['scallion']], parent=root)

        def add_morsel(utensil_obj):
            bm_tf = bmesh.new()
            loop_pts = [(-0.0018, 0.001, -0.006), (0.0, 0.003, -0.001), (0.0018, 0.002, 0.004), (0.0, -0.001, 0.005)]
            add_tube_path(bm_tf, loop_pts, 0.0020, segs=6, mat_idx=0)
            H.add_box(bm_tf, (0.001, 0.006, 0.0), 0.0065, 0.0016, 0.0050, rot_deg=(10, 18, 0), mat_idx=1)
            tf = H.create_mesh_object('toolFood', bm_tf, [mats['noodle'], mats['tofu_skin']], parent=utensil_obj)
            tf.location = Vector((0.0, -0.106, 0.001))

        build_chopsticks_utensil(root, chop_mat, add_morsel)
        add_bowl_anchors(root)

        info = finalize('luosifen', (0.020, -0.005, 0.0), 0.18)
        if render_png:
            render_thumbnail(info[1], info[2], info[4])
            print(f'RENDERED_PNG: {info[4]}')
        return info

    # =============================================================
    # 4. SIWAWA (wrapped, no utensil)
    # Fan of 3 thin white crepe swaddle rolls along +Z, veg strips projecting
    # upward reaching bite (0,.06,.035); ivory paper sleeve on lower grip only.
    # =============================================================
    def build_siwawa(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'crepe': H.make_mat('mat_crepe', 'f2ead8', roughness=0.50),
            'carrot': H.make_mat('mat_carrot', 'd97a2a', roughness=0.45),
            'cucumber': H.make_mat('mat_cucumber', '58a83c', roughness=0.40),
            'sprout_y': H.make_mat('mat_sprout_y', 'd9c25e', roughness=0.45),
            'paper': H.make_mat('mat_paper', 'ede3ce', roughness=0.80),
        }

        root = bpy.data.objects.new('siwawa', None)
        bpy.context.collection.objects.link(root)

        bm = bmesh.new()
        # three fanned crepe rolls, axes along +Z, slight outward splay
        roll_specs = [(-0.046, 7.5), (0.0, 0.0), (0.046, -7.5)]
        for x0, splay_deg in roll_specs:
            spl = math.radians(splay_deg)
            n_seg = 6
            z0, z1 = -0.048, 0.052
            pts = []
            radii = []
            for s in range(n_seg + 1):
                t = s / n_seg
                z = z0 + (z1 - z0) * t
                taper = 0.0135 - 0.0022 * t
                cx = x0 + math.tan(spl) * (z - 0.0)
                pts.append((cx, 0.0135, z))
                radii.append(taper)
            # tube body with per-segment radius (tapered roll)
            for i in range(n_seg):
                H.add_cylinder(bm, pts[i], pts[i + 1], (radii[i] + radii[i + 1]) * 0.5, segs=16,
                               cap1=(i == 0), cap2=(i == n_seg - 1), mat_idx=0)
            # front opening: recessed ivory disk hint (inner spiral ring)
            tip = pts[-1]
            H.add_ellipsoid(bm, (tip[0], tip[1], tip[2] - 0.002), radii[-1] * 0.72, radii[-1] * 0.72, 0.0022,
                            segs_u=12, segs_v=8, mat_idx=0)
            # veggie strips projecting upward from the top of each roll
            strip_colors = [1, 2, 3]
            n_strips = 5
            for k in range(n_strips):
                t = 0.35 + 0.5 * (k / (n_strips - 1.0))
                z = z0 + (z1 - z0) * t
                cx = x0 + math.tan(spl) * z
                mat_i = strip_colors[(k + int(x0 * 100)) % 3]
                h = (0.040 + 0.008 * ((k * 7) % 3)) * (1.0 if abs(x0) < 0.01 else 0.85)
                lean = math.radians(-12 + 6 * k)
                base = (cx + 0.004 * math.cos(k * 2.1), 0.0135 + radii[int(t * n_seg)] * 0.85, z)
                top = (base[0] + math.sin(lean) * h * 0.5, base[1] + math.cos(lean) * h, base[2] + math.sin(lean) * h * 0.3)
                H.add_cylinder(bm, base, top, 0.0013, segs=6, cap1=True, cap2=True, mat_idx=mat_i)
                H.add_box(bm, top, 0.0016, 0.0075, 0.0018, rot_deg=(lean * 40.0, 10 * k, 0), mat_idx=mat_i)
        recalc_normals(bm)
        H.create_mesh_object('edible', bm, [mats['crepe'], mats['carrot'], mats['cucumber'], mats['sprout_y']], parent=root)

        # ivory paper support sleeve: lower grip only (z -.052..+.014), open front,
        # so exposed rolls and veg strips reach bite (0, .06, .035)
        bm_w = bmesh.new()
        arc_specs = []
        steps = 10
        for s in range(steps + 1):
            arc_specs.append(math.radians(-160.0 + 320.0 * s / steps))  # wrap angle around Y axis
        zs = [-0.052, -0.020, 0.014]
        rr_out = 0.063
        for zi in range(len(zs) - 1):
            col_lo, col_hi = [], []
            for ang in arc_specs:
                px = rr_out * math.cos(ang)
                col_lo.append(bm_w.verts.new(H.glb_to_bl((px, -0.006, zs[zi]))))
                col_hi.append(bm_w.verts.new(H.glb_to_bl((px, 0.032, zs[zi + 1]))))
            bm_w.verts.ensure_lookup_table()
            n = len(arc_specs)
            for i in range(n - 1):
                try:
                    bm_w.faces.new([col_lo[i], col_lo[i + 1], col_hi[i + 1], col_hi[i]])
                except ValueError:
                    pass
            try:
                bm_w.faces.new(col_hi)
            except ValueError:
                pass
            try:
                bm_w.faces.new(list(reversed(col_lo)))
            except ValueError:
                pass
        recalc_normals(bm_w)
        H.create_mesh_object('wrapper', bm_w, mats['paper'], parent=root)

        H.make_empty('leftSupport', (0.06, -0.025, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.06, -0.025, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.06, 0.035), parent=root)
        add_common_sockets(root, 0.0)

        info = finalize('siwawa', (0.0, 0.022, 0.005), 0.13)
        if render_png:
            render_thumbnail(info[1], info[2], info[4])
            print(f'RENDERED_PNG: {info[4]}')
        return info

    # =============================================================
    # 5. SUANLAFEN (bowl, chopsticks)
    # Thick translucent dark-brown sweet potato noodle HELIX curls,
    # chili-red broth, toasted peanuts, scallion flecks. Dark slate bowl.
    # =============================================================
    def build_suanlafen(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'bowl': H.make_mat('mat_bowl', '3c3a40', roughness=0.20, specular=0.7),
            'noodle': H.make_mat('mat_noodle', '54301a', roughness=0.28, specular=0.55),
            'broth': H.make_mat('mat_broth', 'a81f0c', roughness=0.18, specular=0.9),
            'peanut': H.make_mat('mat_peanut', 'c08a3e', roughness=0.55),
            'scallion': H.make_mat('mat_scallion', '3f9428', roughness=0.35),
        }
        chop_mat = H.make_mat('mat_chopsticks', '553118', roughness=0.48, specular=0.45)

        root = bpy.data.objects.new('suanlafen', None)
        bpy.context.collection.objects.link(root)

        build_porcelain_bowl(root, mats['bowl'])

        bm = bmesh.new()
        # chili-red broth pool
        H.add_ellipsoid(bm, (0.0, 0.002, 0.0), 0.056, 0.010, 0.056, segs_u=28, segs_v=12, y_max=0.012, mat_idx=2)
        # thick helix curls
        curls = [
            ((0.0, 0.016, 0.0), 0.015, 0.0042, 1.8, 0.020, 0.0),
            ((-0.028, 0.014, -0.012), 0.014, 0.0038, 1.6, 0.017, 1.2),
            ((0.030, 0.014, 0.010), 0.0145, 0.0038, 1.7, 0.017, 2.4),
            ((-0.014, 0.015, 0.030), 0.013, 0.0038, 1.5, 0.016, 3.1),
            ((0.018, 0.015, -0.028), 0.0135, 0.0038, 1.6, 0.016, 4.0),
            ((-0.040, 0.013, 0.014), 0.012, 0.0036, 1.4, 0.015, 5.2),
            ((0.042, 0.013, -0.008), 0.012, 0.0036, 1.4, 0.015, 0.7),
            ((-0.006, 0.020, -0.042), 0.011, 0.0036, 1.4, 0.014, 2.0),
            ((0.006, 0.021, 0.044), 0.011, 0.0036, 1.4, 0.014, 3.6),
        ]
        for c, R, rt, tn, h, ph in curls:
            add_helix_curl(bm, c, R, rt, tn, h, phase=ph, mat_idx=1)
        # central stacked curl peaking at content point
        add_helix_curl(bm, (0.0, 0.020, 0.002), 0.012, 0.0040, 1.5, 0.016, phase=0.8, mat_idx=1)
        # toasted whole peanuts
        for i in range(11):
            r = 0.006 + 0.034 * ((i * 7) % 11) / 11.0
            th = i * 2.39996 + 1.7
            x, z = r * math.cos(th), r * math.sin(th)
            y = 0.024 + 0.010 * (1.0 - (r / 0.042) ** 2) + 0.002 * math.sin(i * 3.3)
            H.add_ellipsoid(bm, (x, y, z), 0.0042, 0.0030, 0.0050, segs_u=10, segs_v=7, mat_idx=3)
        # scallion flecks
        for i in range(12):
            r = 0.005 + 0.036 * ((i * 5) % 12) / 12.0
            th = i * 2.39996 + 0.4
            x, z = r * math.cos(th), r * math.sin(th)
            y = 0.030 + 0.008 * (1.0 - (r / 0.042) ** 2) + 0.002 * math.cos(i * 2.1)
            H.add_cylinder(bm, (x, y, z), (x, y + 0.0024, z), 0.0020, segs=6, mat_idx=4)
        recalc_normals(bm)
        H.create_mesh_object('edible', bm, [mats['noodle'], mats['broth'], mats['peanut'], mats['scallion']], parent=root)

        def add_morsel(utensil_obj):
            bm_tf = bmesh.new()
            pts = [(-0.004, 0.0, -0.004), (0.0, 0.003, 0.0), (0.004, 0.005, 0.003)]
            add_tube_path(bm_tf, pts, 0.0036, segs=8, mat_idx=0)
            H.add_ellipsoid(bm_tf, (-0.003, -0.002, -0.002), 0.0035, 0.0025, 0.0040, segs_u=8, segs_v=6, mat_idx=1)
            tf = H.create_mesh_object('toolFood', bm_tf, [mats['noodle'], mats['peanut']], parent=utensil_obj)
            tf.location = Vector((0.0, -0.106, 0.001))

        build_chopsticks_utensil(root, chop_mat, add_morsel)
        add_bowl_anchors(root)

        info = finalize('suanlafen', (0.020, -0.005, 0.0), 0.18)
        if render_png:
            render_thumbnail(info[1], info[2], info[4])
            print(f'RENDERED_PNG: {info[4]}')
        return info

    # =============================================================
    # 6. NIANGPI (bowl, chopsticks)
    # Wide SHORT yellow-beige wheat starch ribbons stacked flat, LARGE porous
    # pale gluten chunks with bumps, red oil, thin round cucumber slices.
    # =============================================================
    def build_niangpi(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'bowl': H.make_mat('mat_bowl', 'efe8da', roughness=0.15, specular=0.8),
            'ribbon': H.make_mat('mat_ribbon', 'e4cd8e', roughness=0.35, specular=0.5),
            'gluten': H.make_mat('mat_gluten', 'e9dcc0', roughness=0.60),
            'oil': H.make_mat('mat_oil', 'b3260e', roughness=0.18, specular=0.85),
            'cucumber': H.make_mat('mat_cucumber', '4f9a30', roughness=0.40),
        }
        chop_mat = H.make_mat('mat_chopsticks', '553118', roughness=0.48, specular=0.45)

        root = bpy.data.objects.new('niangpi', None)
        bpy.context.collection.objects.link(root)

        build_porcelain_bowl(root, mats['bowl'])

        bm = bmesh.new()
        # red oil pool
        H.add_ellipsoid(bm, (0.0, 0.002, 0.0), 0.054, 0.009, 0.054, segs_u=26, segs_v=10, y_max=0.010, mat_idx=3)
        # wide SHORT ribbon pieces laid in two flat-ish layers, crisscrossed orientations
        angle_families = [0.0, 45.0, 90.0, 135.0]
        piece_idx = 0
        for layer, (y_base, spread) in enumerate([(0.016, 0.040), (0.024, 0.032)]):
            for fam_i, base_ang in enumerate(angle_families):
                for k in range(2):
                    a = math.radians(base_ang + 14.0 * k + 6.0 * layer)
                    ca, sa = math.cos(a), math.sin(a)
                    cx_off = 0.014 * math.cos(piece_idx * 2.4) * (1 if layer else -1)
                    cz_off = 0.014 * math.sin(piece_idx * 2.4)
                    half = 0.026 + 0.005 * ((piece_idx * 3) % 3) / 2.0
                    pts = []
                    for s in range(5):
                        t = s / 4.0
                        u = (t - 0.5) * 2.0 * half
                        w = 0.006 * math.sin(t * math.pi * 1.6 + piece_idx)
                        py = y_base + 0.005 * layer + 0.0035 * math.sin(t * math.pi)
                        pts.append((u * ca + cx_off + w * (-sa), py, u * sa + cz_off + w * ca))
                    add_flat_ribbon(bm, pts, width=0.013, thickness=0.0024, mat_idx=1)
                    piece_idx += 1
        # apex ribbon fold through content point
        apex_pts = [(-0.024, 0.028, -0.010), (-0.010, 0.032, -0.004), (0.0, 0.030, 0.0), (0.012, 0.031, 0.007), (0.024, 0.027, 0.012)]
        add_flat_ribbon(bm, apex_pts, width=0.013, thickness=0.0024, mat_idx=1)
        # LARGE porous gluten chunks with surface bumps
        def add_gluten_chunk(c, rx, rz, h, twist_deg, seed):
            n_sides = 7
            n_slices = 4
            slices = []
            for i_sl in range(n_slices):
                v_frac = i_sl / (n_slices - 1)
                py = c[1] - h / 2.0 + h * v_frac
                taper = 1.0 - 0.20 * ((2.0 * v_frac - 1.0) ** 2)
                ring = []
                for i_s in range(n_sides):
                    th = 2.0 * math.pi * i_s / n_sides + math.radians(twist_deg)
                    wob = 1.0 + 0.16 * math.sin(3.0 * th + seed) + 0.10 * math.cos(2.0 * th + seed)
                    ring.append(bm.verts.new(H.glb_to_bl((c[0] + rx * math.cos(th) * taper * wob, py,
                                                           c[2] + rz * math.sin(th) * taper * wob))))
                slices.append(ring)
            bm.verts.ensure_lookup_table()
            for i_sl in range(n_slices - 1):
                r1, r2 = slices[i_sl], slices[i_sl + 1]
                for i_s in range(n_sides):
                    i_sn = (i_s + 1) % n_sides
                    try:
                        bm.faces.new([r1[i_s], r1[i_sn], r2[i_sn], r2[i_s]])
                    except ValueError:
                        pass
            try:
                bm.faces.new(slices[0])
            except ValueError:
                pass
            try:
                bm.faces.new(list(reversed(slices[-1])))
            except ValueError:
                pass
            # porous bumps
            for k in range(4):
                th = k * 1.7 + seed
                ph = k * 1.1
                H.add_ellipsoid(bm, (c[0] + rx * 0.55 * math.cos(th), c[1] + h * 0.3 * math.sin(ph),
                                     c[2] + rz * 0.55 * math.sin(th)),
                                0.0022, 0.0018, 0.0022, segs_u=6, segs_v=5, mat_idx=2)
        add_gluten_chunk((0.0, 0.030, 0.004), 0.0105, 0.0095, 0.017, 12.0, 0.4)
        add_gluten_chunk((-0.026, 0.027, -0.012), 0.0095, 0.009, 0.016, -20.0, 1.9)
        add_gluten_chunk((0.027, 0.026, -0.010), 0.009, 0.0085, 0.015, 30.0, 3.2)
        add_gluten_chunk((-0.012, 0.025, 0.028), 0.0085, 0.008, 0.014, 8.0, 4.6)
        add_gluten_chunk((0.016, 0.024, 0.030), 0.008, 0.008, 0.014, -35.0, 5.5)
        # thin round cucumber slices (disks, some leaning)
        cuke_specs = [
            ((-0.018, 0.040, 0.006), (75.0, 10.0, 0.0)),
            ((0.020, 0.038, 0.014), (70.0, -25.0, 30.0)),
            ((0.002, 0.042, -0.012), (80.0, 15.0, 60.0)),
            ((-0.032, 0.034, 0.014), (18.0, 0.0, 0.0)),
            ((0.034, 0.032, -0.016), (22.0, 0.0, 45.0)),
        ]
        for c, r in cuke_specs:
            H.add_ellipsoid(bm, c, 0.0078, 0.0013, 0.0078, segs_u=14, segs_v=8, mat_idx=4)
        # red oil drizzle
        drips = [
            [(-0.020, 0.042, -0.004), (-0.004, 0.045, 0.002), (0.014, 0.043, 0.008)],
            [(0.006, 0.041, -0.014), (0.020, 0.038, -0.006), (0.030, 0.035, 0.004)],
            [(-0.014, 0.041, 0.014), (0.0, 0.044, 0.018), (0.012, 0.040, 0.020)],
        ]
        for d in drips:
            for i in range(len(d) - 1):
                H.add_cylinder(bm, d[i], d[i + 1], 0.0016, segs=6, cap1=True, cap2=True, mat_idx=3)
        recalc_normals(bm)
        H.create_mesh_object('edible', bm, [mats['ribbon'], mats['gluten'], mats['oil'], mats['cucumber']], parent=root)

        def add_morsel(utensil_obj):
            bm_tf = bmesh.new()
            fold_pts = [(-0.006, 0.001, -0.003), (0.0, 0.003, 0.0), (0.006, 0.001, 0.003)]
            add_flat_ribbon(bm_tf, fold_pts, width=0.008, thickness=0.0020, mat_idx=0)
            H.add_ellipsoid(bm_tf, (0.0, 0.005, 0.0), 0.0035, 0.0025, 0.0035, segs_u=8, segs_v=6, mat_idx=1)
            tf = H.create_mesh_object('toolFood', bm_tf, [mats['ribbon'], mats['gluten']], parent=utensil_obj)
            tf.location = Vector((0.0, -0.106, 0.001))

        build_chopsticks_utensil(root, chop_mat, add_morsel)
        add_bowl_anchors(root)

        info = finalize('niangpi', (0.020, -0.005, 0.0), 0.18)
        if render_png:
            render_thumbnail(info[1], info[2], info[4])
            print(f'RENDERED_PNG: {info[4]}')
        return info

    # =============================================================
    # 7. QINGHAI-YOGURT (bowl, spoon)
    # Turquoise squat bowl, ivory set yogurt dome, yellow cream skin with one
    # broken glossy peeled edge, gold flecks. Ivory ceramic spoon.
    # =============================================================
    def build_qinghai_yogurt(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'bowl': H.make_mat('mat_bowl', '35a39a', roughness=0.15, specular=0.8),
            'yogurt': H.make_mat('mat_yogurt', 'f3ede0', roughness=0.45),
            'skin': H.make_mat('mat_skin', 'e8c96a', roughness=0.35),
            'skin_gloss': H.make_mat('mat_skin_gloss', 'e3c055', roughness=0.12, specular=0.9),
            'gold': H.make_mat('mat_gold', 'caa64e', roughness=0.30, specular=0.6),
        }
        spoon_mat = H.make_mat('mat_spoon', 'f0e8d8', roughness=0.30, specular=0.6)

        root = bpy.data.objects.new('qinghai-yogurt', None)
        bpy.context.collection.objects.link(root)

        build_turquoise_bowl(root, mats['bowl'])

        bm = bmesh.new()
        # ivory set yogurt dome reaching bowl lip
        H.add_ellipsoid(bm, (0.0, 0.008, 0.0), 0.056, 0.024, 0.056, segs_u=28, segs_v=14, y_max=0.030, mat_idx=1)
        # yellow cream skin layer
        H.add_ellipsoid(bm, (0.0, 0.0265, 0.0), 0.0505, 0.008, 0.0505, segs_u=28, segs_v=10, y_min=0.0290, y_max=0.0335, mat_idx=2)
        # broken glossy edge: peeled flap curling up at the front (+z)
        flap_pts = []
        for s in range(6):
            t = s / 5.0
            px = 0.014 * math.sin(t * math.pi)
            py = 0.0325 + 0.0060 * math.sin(t * math.pi * 0.9)
            pz = 0.036 + 0.012 * t
            flap_pts.append((px, py, pz))
        add_flat_ribbon(bm, flap_pts, width=0.026, thickness=0.0016, mat_idx=3)
        # exposed white yogurt under the broken skin edge
        H.add_ellipsoid(bm, (0.0, 0.0292, 0.040), 0.014, 0.0022, 0.008, segs_u=12, segs_v=6, y_max=0.0305, mat_idx=1)
        # subtle gold flecks on the skin
        for i in range(8):
            r = 0.008 + 0.032 * ((i * 7) % 8) / 8.0
            th = i * 2.39996 + 0.6
            x, z = r * math.cos(th), r * math.sin(th) * 0.9
            if z > 0.030:
                z = 0.030
            H.add_ellipsoid(bm, (x, 0.0342, z), 0.0016, 0.0007, 0.0016, segs_u=6, segs_v=4, mat_idx=4)
        recalc_normals(bm)
        H.create_mesh_object('edible', bm, [mats['yogurt'], mats['skin'], mats['skin_gloss'], mats['gold']], parent=root)

        def add_morsel(utensil_obj):
            bm_tf = bmesh.new()
            H.add_ellipsoid(bm_tf, (0.0, 0.0, 0.0), 0.0065, 0.0040, 0.0075, segs_u=12, segs_v=8, y_min=-0.003, mat_idx=0)
            H.add_box(bm_tf, (0.001, 0.005, 0.0), 0.0080, 0.0014, 0.0060, rot_deg=(8, 14, 0), mat_idx=1)
            tf = H.create_mesh_object('toolFood', bm_tf, [mats['yogurt'], mats['skin']], parent=utensil_obj)
            tf.location = Vector((0.0, -0.101, 0.003))

        build_spoon_utensil(root, spoon_mat, add_morsel)
        add_bowl_anchors(root)

        info = finalize('qinghai-yogurt', (0.020, 0.000, 0.0), 0.17)
        if render_png:
            render_thumbnail(info[1], info[2], info[4])
            print(f'RENDERED_PNG: {info[4]}')
        return info

    # =============================================================
    # 8. SANZI (cupped, no utensil)
    # Golden deep-fried thread loop nest: layered airy thin rods along X with
    # end curls plus crest arcs; bottom center ~ -.025, bite near top center.
    # =============================================================
    def build_sanzi(export_glb=True, render_png=True):
        reset_scene()
        mats = {
            'gold': H.make_mat('mat_gold', 'd9a742', roughness=0.50),
            'deep': H.make_mat('mat_deep', 'bd8a30', roughness=0.50),
        }

        root = bpy.data.objects.new('sanzi', None)
        bpy.context.collection.objects.link(root)

        bm = bmesh.new()
        # layered long rods along X with sinus weave and upward end curls
        layers = [(-0.022, 0.020, 3), (-0.012, 0.017, 4), (-0.002, 0.019, 4), (0.010, 0.016, 3), (0.021, 0.018, 3)]
        strand_idx = 0
        for ly, amp, n_rod in layers:
            for k in range(n_rod):
                z_c = -amp + (2.0 * amp) * (k + 0.5) / n_rod + 0.0025 * math.sin(strand_idx * 2.3)
                phase = strand_idx * 1.31
                mat_i = strand_idx % 2
                pts = []
                steps = 12
                for s in range(steps + 1):
                    t = s / steps
                    x = -0.082 + 0.164 * t
                    z = z_c + 0.005 * math.sin(t * math.pi * 2.2 + phase)
                    y = ly + 0.004 * math.sin(t * math.pi * 3.1 + phase * 1.7)
                    # end curls rising at both tips
                    if t < 0.12:
                        e = (0.12 - t) / 0.12
                        y += 0.010 * e * e
                        z += 0.004 * e
                    elif t > 0.88:
                        e = (t - 0.88) / 0.12
                        y += 0.010 * e * e
                        z -= 0.004 * e
                    pts.append((x, y, z))
                add_tube_path(bm, pts, 0.0013, segs=8, mat_idx=mat_i)
                strand_idx += 1
        # crest arcs over the top reaching the bite zone
        crest_specs = [
            (0.010, 0.048, 0.6, 0), (0.000, 0.050, 2.1, 1), (-0.010, 0.046, 3.4, 0),
            (0.020, 0.044, 4.2, 1), (-0.020, 0.045, 5.0, 1),
        ]
        for z_c, peak, phase, mat_i in crest_specs:
            pts = []
            steps = 14
            for s in range(steps + 1):
                t = s / steps
                x = -0.072 + 0.144 * t
                y = 0.018 + (peak - 0.018) * math.sin(t * math.pi) ** 0.9
                z = z_c + 0.006 * math.sin(t * math.pi * 1.8 + phase)
                pts.append((x, y, z))
            add_tube_path(bm, pts, 0.0013, segs=8, mat_idx=mat_i)
        # a couple of crossing loops near the front for the nest feel
        for z0, dir_sign in ((0.024, 1.0), (-0.026, -1.0)):
            pts = []
            for s in range(11):
                t = s / 10.0
                ang = math.pi * t
                x = -0.05 + 0.10 * t
                y = 0.006 + 0.016 * math.sin(ang)
                z = z0 + dir_sign * 0.010 * math.sin(2.0 * ang)
                pts.append((x, y, z))
            add_tube_path(bm, pts, 0.0013, segs=8, mat_idx=0)
        recalc_normals(bm)
        H.create_mesh_object('edible', bm, [mats['gold'], mats['deep']], parent=root)

        H.make_empty('leftSupport', (0.065, 0.0, 0.0), parent=root)
        H.make_empty('rightSupport', (-0.065, 0.0, 0.0), parent=root)
        H.make_empty('bite', (0.0, 0.05, 0.02), parent=root)
        add_common_sockets(root, -0.025)

        info = finalize('sanzi', (0.0, 0.008, 0.0), 0.16)
        if render_png:
            render_thumbnail(info[1], info[2], info[4])
            print(f'RENDERED_PNG: {info[4]}')
        return info

    # =============================================================
    # EXECUTION: PASS 1 (GLBS EARLY) THEN PASS 2 (RENDERS)
    # =============================================================
    builders = [
        ('shachamian', build_shachamian),
        ('waguan-tang', build_waguan_tang),
        ('luosifen', build_luosifen),
        ('siwawa', build_siwawa),
        ('suanlafen', build_suanlafen),
        ('niangpi', build_niangpi),
        ('qinghai-yogurt', build_qinghai_yogurt),
        ('sanzi', build_sanzi),
    ]

    if selected_ids:
        active_builders = [(bid, fn) for bid, fn in builders if bid in selected_ids]
        if not active_builders:
            raise RuntimeError(f'No matching builders for selected ids: {selected_ids}')
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
    """Runs outbox verify.mjs (Node GLTFLoader) to verify exports and write manifest.json."""
    if not VERIFY_MJS.exists():
        raise RuntimeError(f'Missing verifier: {VERIFY_MJS}')
    node_proc = subprocess.run(
        ['node', str(VERIFY_MJS)],
        cwd=str(WORK_ROOT),
        capture_output=True, text=True, timeout=600,
    )
    print(node_proc.stdout)
    if node_proc.returncode != 0:
        print(node_proc.stderr, file=sys.stderr)
        sys.exit(node_proc.returncode)

    manifest_path = OUT_DIR / 'manifest.json'
    with open(manifest_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    foods = data.get('foods', [])
    print(f'Manifest confirmed: {len(foods)} foods at {manifest_path}')
    for food in foods:
        print(f"  - {food['id']}: glb={food['bytes']}B png={food['thumbnail']['bytes']}B "
              f"sizeM={food.get('dimensionsM')}")


def main():
    try:
        import bpy  # noqa: F401
        selected = []
        if '--' in sys.argv:
            idx = sys.argv.index('--')
            selected = [a for a in sys.argv[idx + 1:] if not a.startswith('-')]
        run_blender_build(selected_ids=selected if selected else None)
    except ImportError:
        # Standard python entry: launch headless Blender safely with absolute script path
        script_abs = Path(__file__).resolve()
        target_ids = [arg for arg in sys.argv[1:] if not arg.startswith('-')]
        env = dict(os.environ)
        env['CUDA_VISIBLE_DEVICES'] = ''
        if target_ids:
            print(f'Starting headless Blender build for selected coverage-B foods: {target_ids}...')
            cmd = ['blender', '--background', '--threads', '4', '--python', str(script_abs), '--'] + target_ids
        else:
            print('Starting headless Blender build for 8 coverage-B foods...')
            cmd = ['blender', '--background', '--threads', '4', '--python', str(script_abs)]

        res = subprocess.run(cmd, env=env)
        if res.returncode != 0:
            print(f'Blender failed with code {res.returncode}', file=sys.stderr)
            sys.exit(res.returncode)

        print(f'Optimizing rendered 256x256 PNG thumbnails to <= {PNG_MAX_BYTES} bytes...')
        try:
            from PIL import Image
            qmethod = Image.Quantize.FASTOCTREE if hasattr(Image, 'Quantize') else Image.FASTOCTREE
            targets_png = [OUT_DIR / f'{tid}.png' for tid in target_ids] if target_ids else sorted(OUT_DIR.glob('*.png'))
            for png_file in targets_png:
                if not png_file.exists() or png_file.name == 'manifest.json':
                    continue
                for attempt_colors in (None, 256, 128, 64):
                    im = Image.open(png_file).convert('RGBA')
                    if attempt_colors is None:
                        im.save(png_file, 'PNG', optimize=True)
                    else:
                        im_q = im.quantize(colors=attempt_colors, method=qmethod)
                        im_q.save(png_file, 'PNG', optimize=True)
                    sz = png_file.stat().st_size
                    if sz <= PNG_MAX_BYTES:
                        break
                if sz > PNG_MAX_BYTES:
                    raise RuntimeError(f'{png_file.name} still exceeds {PNG_MAX_BYTES} bytes: {sz}')
                print(f'{png_file.name}: {sz} bytes')
        except ImportError:
            print('Pillow unavailable; skipping PNG quantization', file=sys.stderr)

        print('Running Node.js GLTFLoader verification and writing manifest.json...')
        run_node_verify_and_manifest()
        print('COVERAGE_B_BUILT_AND_VERIFIED_SUCCESSFULLY!')


if __name__ == '__main__':
    main()
