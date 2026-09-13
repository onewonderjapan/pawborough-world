"""Kit components shared by more than one module family, extracted from the
frozen builders (plain-v1 / legacy cloth+pharmacy / corner). Each component
reproduces the frozen geometry exactly at the reference parameters and exposes
only design-level knobs. Reference values live in the configs; nothing here
invents new dimensions.

Coordinate frame: module local, metres, facade +Z, front-wall centre bottom at
origin — same as mb_lib and the frozen collision.json sidecars.

Run inside Blender (kit/build_sample.py imports this).
"""


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
