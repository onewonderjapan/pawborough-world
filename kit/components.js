// Kit components shared by more than one module family, extracted from the
// frozen builders (plain-v1 / legacy cloth+pharmacy / corner). Each component
// reproduces the frozen geometry EXACTLY at the reference parameters and
// exposes only design-level knobs. Reference values live in the configs;
// nothing here invents new Shanghai dimensions.
//
// Coordinate frame: module local, meters, facade +Z, front-wall center bottom
// at origin — same as mb_lib and the frozen collision.json sidecars.

// Street post pair: timber facade post + stone foot. Shared by plain (2
// posts), legacy cloth/pharmacy (4 posts) and corner (3 posts) families.
// Frozen reference: post (.20, h, .24) wood, foot (.34, .7, .35) stone.
export function street_post(L, { prefix = '', x, post_height, y = 3.5, z = 0.08,
                                 post_size = [0.20, null, 0.24], foot = true,
                                 foot_size = [0.34, 0.7, 0.35], foot_y = 0.35 }) {
  const [pw, , pd] = post_size;
  L.box(prefix + 'facade-post', (x, y, z), (pw, post_height, pd), 'wood', .01, true);
  if (foot) L.box(prefix + 'stone-post-foot', (x, foot_y, z), foot_size, 'stone', .016, true);
}

// Upper facade band: sill wall, header wall, window piers and windows.
// Shared by every module family; the frozen builders differ only in window
// type ('shutter' plain family vs 'ornate' legacy family), counts and the two
// band heights. Wall thickness .26, front z offset -.13 — frozen values.
export function upper_window_band(L, { x, z, W, eave,
                                        sill_wall = [4.25, 1.0],       // [centerY, height]
                                        header_from = 6.6,
                                        window_type = 'shutter',
                                        window_y = 5.65, window_w = 1.4, window_h = 1.8,
                                        pier_y = 5.65, pier_h = 1.85,
                                        count = null, window_centers_ratio = null }) {
  L.box('upper-sill-wall', (x, sill_wall[0], z - .13), (W - .5, sill_wall[1], .26), 'plaster', 0);
  L.box('upper-header-wall', (x, (header_from + eave) / 2, z - .13), (W - .5, eave - header_from, .26), 'plaster', 0);
  // opening centers: explicit ratios of W, or evenly spread 'count' bays (frozen rule)
  const centers = window_centers_ratio
    ? window_centers_ratio.map(r => x + W * r)
    : (() => { const n = count ?? (W <= 11 ? 3 : 4);
               return Array.from({length: n}, (_, i) => x - W / 2 + W * (i + .5) / n); })();
  const openings = centers.map(cx => [cx - window_w / 2 - .05 / window_w * 0 - .75 + (window_w - 1.4) / 2,
                                      cx + window_w / 2 + .75 - (window_w - 1.4) / 2]);
  let start = x - W / 2 + .2;
  for (const [lo, hi] of [...openings, [x + W / 2 - .2, x + W / 2 - .2]]) {
    if (lo > start) L.box('upper-window-pier', ((start + lo) / 2, pier_y, z - .13), (lo - start, pier_h, .26), 'plaster', 0);
    start = hi;
  }
  for (const cx of centers) {
    if (window_type === 'shutter') L.shutter_window(cx, window_y, z + .02, window_w, window_h);
    else if (window_type === 'ornate') L.window(cx, window_y, z + .02, window_w, window_h);
    else throw new Error(`unknown window type ${window_type}`);
  }
  return centers;
}
