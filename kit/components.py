"""Kit components shared by more than one module family, extracted from the
frozen builders (plain-v1 / legacy cloth+pharmacy / corner). Each component
reproduces the frozen geometry exactly at the reference parameters and exposes
only design-level knobs. Reference values live in the configs; nothing here
invents new dimensions.

Coordinate frame: module local, metres, facade +Z, front-wall centre bottom at
origin — same as mb_lib and the frozen collision.json sidecars.

Run inside Blender (kit/build_sample.py imports this).
"""
import math


def street_post(L, x, post_height, prefix='', y=3.5, z=0.08,
                post_size=(0.20, None, 0.24), foot=False,
                foot_size=(0.34, 0.7, 0.35), foot_y=0.35):
    """Street post pair: timber facade post + stone foot.

    Shared by plain (2 posts), legacy cloth/pharmacy (4) and corner (3)
    families. Frozen reference: post (.20, h, .24) wood, foot (.34, .7, .35)
    stone, both collision=True.
    """
    pw, _, pd = post_size
    L.box(prefix + 'facade-post', (x, y, z), (pw, post_height, pd), 'wood', .01, True)
    if foot:
        L.box(prefix + 'stone-post-foot', (x, foot_y, z), foot_size, 'stone', .016, True)


def upper_window_band(L, x, z, W, eave, window_type='shutter',
                      sill_wall=(4.25, 1.0),
                      header_from=6.6,
                      window_y=5.65, window_w=1.4, window_h=1.8,
                      pier_y=5.65, pier_h=1.85,
                      count=None, window_centers=None):
    """Upper facade band: sill wall, header wall, piers, windows.

    Shared by every module family; frozen builders differ only in window type
    ('shutter' plain vs 'ornate' legacy), counts and band heights. Wall
    thickness .26 at front z offset -.13 (frozen). Opening pad .05 each side.
    """
    cy, ch = sill_wall
    L.box('upper-sill-wall', (x, cy, z - .13), (W - .5, ch, .26), 'plaster', 0)
    L.box('upper-header-wall', (x, (header_from + eave) / 2, z - .13), (W - .5, eave - header_from, .26), 'plaster', 0)
    if window_centers is None:
        n = count if count is not None else (3 if W <= 11 else 4)  # frozen spread rule
        window_centers = [x - W / 2 + W * (i + .5) / n for i in range(n)]
    pad = window_w / 2 + .05
    openings = [(cx - pad, cx + pad) for cx in window_centers]
    start = x - W / 2 + .2
    for lo, hi in openings + [(x + W / 2 - .2, x + W / 2 - .2)]:
        if lo > start:
            L.box('upper-window-pier', ((start + lo) / 2, pier_y, z - .13), (lo - start, pier_h, .26), 'plaster', 0)
        start = hi
    for cx in window_centers:
        if window_type == 'shutter':
            L.shutter_window(cx, window_y, z + .02, window_w, window_h)
        elif window_type == 'ornate':
            L.window(cx, window_y, z + .02, window_w, window_h)
        else:
            raise ValueError(f'unknown window type {window_type!r}')
    return window_centers


# ---- walls with real openings -------------------------------------------
#
# Generic segmented-wall system shared by the east-edge background shops
# (gable walls with windows / a closed side door, closed front walls with a
# closed door + display window, brick foundation bands interrupted by doors).
# Nothing here knows building ids: walls are described by an axis, an outer
# face coordinate, a u-range along the wall and an opening list.
#
#   axis 'x': wall plane is perpendicular to X (gable wall); u runs along Z.
#   axis 'z': wall plane is perpendicular to Z (front/back wall); u runs along X.
#   `plane`   coordinate of the wall's OUTER face (GLB axes, facade at z=0).
#   `inward`  +1/-1: unit direction from the outer face into the building
#             along the wall normal.
#   openings  [{u, y, w, h, kind, ...}] — kind 'window' | 'door' | 'display'
#             gets a real recessed assembly (frame/glass/panel, 0.10-0.12 m
#             deep — never a painted black rectangle); kind 'hole' just gaps
#             the wall (caller adds its own closure).

_EPS = 1e-4


def _wb(L, axis, plane, inward, u, y, d, du, dy, dd, mat, bevel=0.0, collision=False, name='wall-part'):
    """Box attached to a wall: center at depth d (measured from the outer face
    along inward), full depth extent dd. Builds the same GLB-space boxes as
    mb_lib.box with per-face metric loop UV."""
    if axis == 'x':
        c, s = (plane + inward * d, y, u), (dd, dy, du)
    else:
        c, s = (u, y, plane + inward * d), (du, dy, dd)
    return L.box(name, c, s, mat, bevel, collision)


def _merge(spans):
    spans = sorted(s for s in spans if s[1] - s[0] > _EPS)
    out = []
    for lo, hi in spans:
        if out and lo <= out[-1][1] + _EPS:
            out[-1][1] = max(out[-1][1], hi)
        else:
            out.append([lo, hi])
    return out


def wall_with_openings(L, axis, plane, inward, u0, u1, y0, y1, thickness,
                       material='plaster', openings=(), name='wall', collision=True):
    """Wall from y0..y1, u0..u1 with real openings. The wall is built as
    horizontal bands between opening edges and u-segments inside each band, so
    every opening is a genuine hole through the wall (piers, sills and lintels
    are wall-thickness geometry, not decals). Returns the openings."""
    cuts = {y0, y1}
    for o in openings:
        cuts.add(max(y0, min(y1, o['y'] - o['h'] / 2)))
        cuts.add(max(y0, min(y1, o['y'] + o['h'] / 2)))
    ys = sorted(cuts)
    for bi, (ya, yb) in enumerate(zip(ys, ys[1:])):
        if yb - ya <= _EPS:
            continue
        holes = _merge([[_clamp(o['u'] - o['w'] / 2, u0, u1), _clamp(o['u'] + o['w'] / 2, u0, u1)]
                        for o in openings if o['y'] - o['h'] / 2 < yb - _EPS and o['y'] + o['h'] / 2 > ya + _EPS])
        segs = []
        cursor = u0
        for lo, hi in holes:
            if lo > cursor + _EPS:
                segs.append((cursor, lo))
            cursor = max(cursor, hi)
        if u1 > cursor + _EPS:
            segs.append((cursor, u1))
        for si, (a, b) in enumerate(segs):
            _wb(L, axis, plane, inward, (a + b) / 2, (ya + yb) / 2, thickness / 2,
                b - a, yb - ya, thickness, material, 0, collision, f'{name}-b{bi}s{si}')
    return openings


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def window_on_wall(L, axis, plane, inward, u, y, w, h, recess=0.10, thickness=0.28,
                   name='gable-window'):
    """Closed timber window recessed `recess` behind the outer face: real
    reveal lining, glass, stiles/rails, two shutter panels, protruding stone
    sill. Same part language as mb_lib.shutter_window, in wall coordinates."""
    _wb(L, axis, plane, inward, u, y, recess / 2, w + .16, h + .16, recess + .04, 'dark', 0, False, f'{name}-reveal')
    _wb(L, axis, plane, inward, u, y, recess, w, h, .025, 'glass', 0, False, f'{name}-glass')
    for du in (-w / 2, w / 2):
        _wb(L, axis, plane, inward, u + du, y, .02, .075, h + .14, .13, 'wood', .005, False, f'{name}-stile')
    for dy in (-h / 2, h / 2):
        _wb(L, axis, plane, inward, u, y + dy, .03, w + .12, .075, .13, 'wood', .004, False, f'{name}-rail')
    for du in (-w * .22, w * .16):
        _wb(L, axis, plane, inward, u + du, y, recess - .025, w * .38, h * .92, .045, 'wood', .006, False, f'{name}-shutter')
    _wb(L, axis, plane, inward, u, y - h / 2 - .07, -.04, w + .3, .14, .28, 'stone', .012, False, f'{name}-sill')


def closed_door_on_wall(L, axis, plane, inward, u, y, w, h, recess=0.12, frame=.09,
                        name='side-door'):
    """Closed door with a real recessed panel: timber jambs + head around the
    opening, lacquer panel at recess depth (collision on — the door reads as
    shut, nobody walks through a fake opening). y = panel center height."""
    d_reveal = recess + .04
    for du in (-(w / 2 + frame / 2), w / 2 + frame / 2):
        _wb(L, axis, plane, inward, u + du, y, d_reveal / 2 - .02, frame, h + frame, d_reveal, 'wood', .005, False, f'{name}-jamb')
    _wb(L, axis, plane, inward, u, y + h / 2 + frame / 2, d_reveal / 2 - .02, w + 2 * frame, frame, d_reveal, 'wood', .005, False, f'{name}-head')
    _wb(L, axis, plane, inward, u, y, recess, w, h, .06, 'dark', .008, True, f'{name}-panel')


def display_window_on_wall(L, axis, plane, inward, u, y, w, h, recess=0.12,
                           counter_h=0.42, name='display-window'):
    """Shallow shop display window: dark reveal, upper glass, proud timber
    counter face in the lower band (frozen counter reads via its proud sill),
    protruding stone counter top. The visible solid faces — reveal panel,
    counter face, counter top — carry matching collision (SC-F1); the glass
    pane sits embedded inside the reveal void, so it stays collision-free
    (no invisible collider, geometry unchanged)."""
    _wb(L, axis, plane, inward, u, y, recess / 2, w + .16, h + .14, recess + .04, 'dark', 0, True, f'{name}-reveal')
    gh = h - counter_h - .06
    _wb(L, axis, plane, inward, u, y + counter_h / 2 + gh / 2 + .03, recess - .04, w - .12, gh, .025, 'glass', 0, False, f'{name}-glass')
    _wb(L, axis, plane, inward, u, y - h / 2 + counter_h / 2, -.02, w - .06, counter_h, .24, 'wood', .008, True, f'{name}-counter-face')
    _wb(L, axis, plane, inward, u, y - h / 2 + counter_h + .035, -.05, w + .12, .07, .32, 'stone', .008, True, f'{name}-counter-top')


def straight_canopy(L, x, y, z0, w, projection, thickness=0.07):
    """Straight (non-curved) shallow canopy: slab + front trim board + timber
    brackets. Top surface at y, projecting `projection` from the facade z0."""
    L.box('straight-canopy-slab', (x, y - thickness / 2, z0 + projection / 2 - .05),
          (w, thickness, projection + .05), 'roof', 0)
    L.box('straight-canopy-trim', (x, y - thickness - .06, z0 + projection - .01),
          (w, .12, .05), 'dark', 0)
    for xx in (x - w * .38, x + w * .38):
        L.box('canopy-bracket', (xx, y - .3, z0 + .015), (.12, .55, .1), 'wood', .006)
        L.rod('canopy-brace', (xx, y - .55, z0 - .02), (xx, y - .06, z0 + .18), .045, 'wood')


# ---- street-completion batch 20260915: shallow display-window props ------
#
# Append to kit/components.py. Design props INSIDE the existing display-window
# reveal of the east-shop builder. Constraints from the batch plan:
#   - props only occupy the shallow void behind the display glass (local z
#     -0.1325..-0.26; facade outer face z=0, glass pane z -0.1075..-0.1325,
#     wall inner face -0.26) — no full interior is implied
#   - only frozen palette materials (clothB/clothC/clothR, scroll, wood)
#     — zero new textures, no reference-photo textures
#   - no collision entries (props sit behind glass, never walkable)
#   - fabric rolls are low-poly 8-sided ELLIPTICAL prisms (0.13 x 0.10 section)
#     because the round-bolt diameter would pierce the glass in a 0.13m void
#
# Front-wall coordinates (axis 'z', plane 0, inward -1): u runs along X,
# local z negative = behind the outer face.

_ROLL_PALETTE = ('clothC', 'clothB', 'clothR')  # 米白 / 灰蓝 / 棕红


def _ellip_prism(L, name, x_a, x_b, y_c, z_c, ry, rz, mat, sides=8):
    """Horizontal low-poly elliptical prism, axis along X, in GLB space.
    Section is ry (vertical) x rz (depth) centered at (y_c, z_c)."""
    ring_a, ring_b = [], []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        ring_a.append((x_a, y_c + ry * math.cos(a), z_c + rz * math.sin(a)))
        ring_b.append((x_b, y_c + ry * math.cos(a), z_c + rz * math.sin(a)))
    verts = ring_a + ring_b
    faces = [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, 2 * sides)))
    return L.mesh(name, verts, faces, mat)


def fabric_rolls(L, u_center, span_w, counter_y, count=6,
                 roll_len=0.70, roll_rx=0.11, roll_rz=0.048, shelf=False,
                 depth=0.18, name='display-roll'):
    """Cloth bolts lying horizontally in the display reveal.

    counter_y = top of the proud stone counter; bolts rest on it, split onto
    an optional mid shelf (+0.42 above the bolt tops) when shelf=True. The
    whole row stays centered on u_center and within span_w - 0.2; bolt axes
    run along the facade at local z = -depth (behind the glass inner face
    -0.1325 for roll_rz + 0.01 <= depth - 0.1325, clear of the wall -0.26).
    """
    if count < 1:
        return
    gap = min(0.45, max(0.05, (span_w - 0.4 - count * 2 * roll_rx) / max(1, count - 1) * 0.55))
    rows = [counter_y + roll_rx + 0.01]
    if shelf:
        shelf_y = counter_y + 2 * roll_rx + 0.34
        L.box(name + '-shelf', (u_center, shelf_y, -0.18),
              (min(span_w - 0.3, count * (2 * roll_rx + gap)), 0.035, 0.07), 'wood', 0.004)
        rows.append(shelf_y + 0.0175 + roll_rx + 0.01)
    per_row = -(-count // len(rows))  # ceil split: front row first
    k = 0
    for y_c in rows:
        n_row = min(per_row, count - k)
        total = n_row * 2 * roll_rx + (n_row - 1) * gap
        if total > span_w - 0.2:
            raise ValueError(f'{name}: {n_row} bolts need {total:.2f}m > window {span_w - 0.2:.2f}m')
        x0 = u_center - total / 2 + roll_rx
        for i in range(n_row):
            xc = x0 + i * (2 * roll_rx + gap)
            _ellip_prism(L, f'{name}-{k}', xc - roll_len / 2, xc + roll_len / 2,
                         y_c, -depth, roll_rx, roll_rz, _ROLL_PALETTE[k % 3])
            k += 1


def framed_panels(L, u_center, span_w, counter_y, count=3,
                  panel_w=0.52, panel_h=0.72, depth=0.175, name='display-panel'):
    """Embroidery display frames standing on the counter.

    Original geometric inlay only: wood frame + scroll ground recessed behind
    the frame front, thin cloth strips standing slightly proud of the ground
    (raised-embroidery reading). Colors cycle through the frozen cloth palette.
    No reference-photo texture anywhere.
    """
    if count < 1:
        return
    gap = 0.18
    total = count * panel_w + (count - 1) * gap
    if total > span_w - 0.2:
        raise ValueError(f'{name}: {count} panels need {total:.2f}m > window {span_w - 0.2:.2f}m')
    x0 = u_center - total / 2 + panel_w / 2
    for k in range(count):
        xc = x0 + k * (panel_w + gap)
        yc = counter_y + panel_h / 2 + 0.02
        col = _ROLL_PALETTE[k % 3]
        col2 = _ROLL_PALETTE[(k + 1) % 3]
        L.box(f'{name}-frame-{k}', (xc, yc, -depth), (panel_w, panel_h, 0.035), 'wood', 0.005)
        L.box(f'{name}-ground-{k}', (xc, yc, -(depth - 0.006)), (panel_w - 0.09, panel_h - 0.09, 0.012), 'scroll', 0)
        L.box(f'{name}-stripe-v1-{k}', (xc - panel_w * 0.16, yc, -(depth - 0.019)), (0.035, panel_h - 0.2, 0.008), col, 0)
        L.box(f'{name}-stripe-v2-{k}', (xc + panel_w * 0.16, yc, -(depth - 0.019)), (0.035, panel_h - 0.2, 0.008), col2, 0)
        L.box(f'{name}-stripe-h-{k}', (xc, yc + panel_h * 0.12, -(depth - 0.019)), (panel_w - 0.16, 0.035, 0.008), col, 0)
        L.box(f'{name}-stripe-h2-{k}', (xc, yc - panel_h * 0.18, -(depth - 0.019)), (panel_w - 0.16, 0.022, 0.008), col2, 0)


def front_boarding(L, segments, bottom_y, top_y, plank_w=0.58, gap=0.015,
                   thickness=0.03, name='front-boarding'):
    """Vertical timber planks closing the lower front wall (皮货店).

    segments = list of (u_lo, u_hi) wall spans to board; opening columns are
    already excluded by the caller (margin covers the proud door frame and the
    stone counter-top overhang). Planks stand proud of the plaster face at
    local z 0..thickness. No collision entries — the wall behind collides.
    """
    for si, (lo, hi) in enumerate(segments):
        span = hi - lo
        if span < plank_w * 0.6:
            continue
        n = max(1, int((span + gap) / (plank_w + gap)))
        pitch = (span - gap) / n - gap
        used = n * pitch + (n - 1) * gap
        x0 = lo + (span - used) / 2 + pitch / 2
        for k in range(n):
            L.box(f'{name}-{si}p{k}', (x0 + k * (pitch + gap), (bottom_y + top_y) / 2, thickness / 2),
                  (pitch, top_y - bottom_y, thickness), 'wood', 0.004)


def display_niche_on_wall(L, axis, plane, inward, u, y, w, h, recess=0.12,
                          counter_h=0.42, name='display-niche'):
    """Open display niche for prop-carrying shopfronts (street-completion batch).

    Same opening language as display_window_on_wall (proud timber counter face,
    protruding stone top) but the reveal is a real frame — side jambs + head
    band — around an open niche: no glass, and a warm 'inner' back panel at the
    wall's inner face so sunlight reaches the shallow display props. The frozen
    solid-plug display_window_on_wall stays untouched for 128/129.
    """
    _wb(L, axis, plane, inward, u, y + h / 2 - 0.04, recess / 2 - 0.02, w + 0.16, 0.08, recess, 'dark', 0, False, f'{name}-head')
    for du in (-w / 2 + 0.035, w / 2 - 0.035):
        _wb(L, axis, plane, inward, u + du, y, recess / 2 - 0.02, 0.07, h - 0.08, recess, 'dark', 0, False, f'{name}-jamb')
    _wb(L, axis, plane, inward, u, y, recess + 0.125, w - 0.07, h - 0.08, 0.02, 'inner', 0, False, f'{name}-back')
    _wb(L, axis, plane, inward, u, y - h / 2 + counter_h / 2, -.02, w - .06, counter_h, .24, 'wood', .008, False, f'{name}-counter-face')
    _wb(L, axis, plane, inward, u, y - h / 2 + counter_h + .035, -.05, w + .12, .07, .32, 'stone', .008, False, f'{name}-counter-top')
