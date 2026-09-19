"""Shared reusable detail modules for the lanes-v2 construction batch.

Three components (DESIGN_SPEC.targets.reusableModules), all built from the
frozen mb_lib palette with zero new textures and metre-based UVs:

  rear_service_door(...)  — closed rear service door in a thickened wall bay
                            (door recess has real depth, not a texture)
  high_window(...)        — high window with recess + timber frame + stone sill
  corner_cap(...)         — gable corner / brick-plinth junction cap with a
                            timber corner post and coping end cap

Module-local convention for both lanes: origin = portal centre at floor level,
+Z = inward (into the lane), +X = right-handed horizontal. A wall on one side
sits at |x| = wall inner face; `side` is +1 (local +X face) or -1 (local -X).
"""
import math


def quad(L, name, pts, m, uv=None):
    verts = [tuple(pt) for pt in pts]
    uvs = uv or [(0, 0), (1, 0), (1, 1), (0, 1)]
    return L.mesh(name, verts, [(0, 1, 2, 3)], m, uvs)


def high_window(L, side, x_face, s, y0, y1, w, wall_t=0.24, name_prefix='hiwin'):
    """High window recessed into a wall whose inner face runs along x = x_face.

    side = +1 → wall occupies x > x_face (window opens toward -X).
    Real recess depth = min(0.14, wall_t - 0.02) so the dark box never pokes
    through the back of a thin wall; glass, timber frame, stone sill.
    """
    d = min(0.14, wall_t - 0.02)
    x_in = x_face + side * d          # back plane of the recess
    xg = x_face - side * 0.022        # glass plane (slightly proud)
    L.box(f'{name_prefix}-recess', (side * (abs(x_face) + d / 2), (y0 + y1) / 2, s),
          (d, y1 - y0 + 0.16, w + 0.16), 'inner', 0)
    L.box(f'{name_prefix}-glass', (xg, (y0 + y1) / 2, s), (0.024, y1 - y0 - 0.14, w - 0.14), 'glass', 0)
    for ds in (-w / 2, w / 2):
        L.box(f'{name_prefix}-stile', (x_face + side * 0.012, (y0 + y1) / 2, s + ds),
              (0.11, y1 - y0 + 0.12, 0.07), 'wood', 0.004)
    for dy in (y0, y1):
        L.box(f'{name_prefix}-rail', (x_face + side * 0.018, dy, s),
              (0.11, 0.07, w + 0.1), 'wood', 0.004)
    L.box(f'{name_prefix}-sill', (x_face - side * 0.07, y0 - 0.07, s),
          (0.24, 0.1, w + 0.22), 'stone', 0.008)


def rear_service_door(L, side, x_face, s_center, w=1.0, h=2.05, recess=0.25, bay_len=1.7, wall_h=3.3):
    """Closed rear service door in a thickened wall bay (凹口), ring-built.

    No booleans: the niche is assembled from a back wall, two side piers and a
    head, so the recess has real depth; the closed door panel sits at the back
    of the niche with a proud timber frame at the mouth. Collision: two pier
    boxes + head + back wall make the bay solid (closed door blocks passage).
    """
    bay_t = recess + 0.12
    x_out = x_face + side * bay_t
    x_back = x_face + side * recess          # niche back plane
    pier_w = (bay_len - w) / 2 - 0.02
    # back wall + head + two piers enclose the niche
    L.box('rear-door-backwall', ((x_back + x_out) / 2, wall_h / 2, s_center),
          (bay_t - recess, wall_h, bay_len), 'plaster', 0.006, True)
    L.box('rear-door-head', ((x_face + x_back) / 2, (h + wall_h) / 2, s_center),
          (recess, wall_h - h, bay_len), 'plaster', 0.006, True)
    for sgn in (-1, 1):
        L.box('rear-door-pier', ((x_face + x_out) / 2, wall_h / 2, s_center + sgn * (w / 2 + 0.02 + pier_w / 2)),
              (bay_t, wall_h, pier_w), 'plaster', 0.006, True)
    # closed door panel deep in the niche + proud timber frame at the mouth
    L.box('rear-door-panel', (x_back - side * 0.028, h / 2, s_center), (0.055, h, w), 'dark', 0.006)
    for sgn in (-1, 1):
        L.box('rear-door-jamb', (x_face - side * 0.02, h / 2, s_center + sgn * (w / 2 + 0.045)),
              (0.08, h + 0.08, 0.07), 'wood', 0.004)
    L.box('rear-door-lintel', (x_face - side * 0.02, h + 0.04, s_center), (0.08, 0.08, w + 0.18), 'wood', 0.004)
    L.box('rear-door-threshold', (x_face - side * 0.03, 0.02, s_center), (0.16, 0.06, w + 0.16), 'stone', 0.006)


def corner_cap(L, x_wall_face, s_end, side, wall_h=3.3, depth_sign=1, name='corner'):
    """Gable corner / plinth junction cap where a side wall meets an end wall.

    x_wall_face = inner face of the side wall; s_end = s of the end wall face
    (the corner post sits at their intersection); side = which local X side the
    side wall is on (+1 / -1); depth_sign = +1 if the wall continues toward -s
    from the corner (end of run), giving the coping an end cap.
    """
    x_mid = x_wall_face + side * 0.06
    # timber corner post reads the junction
    L.box(f'{name}-post', (x_wall_face + side * 0.09, wall_h / 2, s_end + depth_sign * 0.09),
          (0.18, wall_h, 0.18), 'wood', 0.006)
    # brick plinth return wrapping the post base
    L.box(f'{name}-plinth-return', (x_wall_face + side * 0.015, 0.3, s_end + depth_sign * 0.09),
          (0.05, 0.6, 0.26), 'brick', 0.004)
    # coping end cap closing the wall top at the corner
    L.box(f'{name}-coping-cap', (x_mid, wall_h + 0.06, s_end + depth_sign * 0.02),
          (0.3, 0.12, 0.08), 'roof', 0.006)
