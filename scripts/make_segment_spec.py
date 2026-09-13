"""Compute the Fangbang segment spec from frozen map data. GLB world: Y-up, X east, Z south.

Map local coords (inputs/map/map-data.json): x east, y south (y+ = south, matching GLB +Z).
worldOrigin is the map-space point that becomes GLB (0,0,0); ground at GLB y=0.

Sources:
- street centerline: OSM snapshot 2019 road 238219466 tail + 238219464 head, trimmed to ~90m.
- corner: 光启路 road 39697507 branches south at map (65.7,-21.6).
All positions downstream are DESIGN values assembled on this line; not a 1990s survey.
"""
from pathlib import Path
import json, math

ROOT = Path(__file__).resolve().parents[1]
MAP = json.loads((ROOT.parent / 'inputs/map/map-data.json').read_text(encoding='utf-8'))

WORLD_ORIGIN = (53.5, -17.4)          # map (x,y) at GLB (0,0)
STREET_HALF_ROAD = 4.25               # design: 8.5m curb-to-curb
SIDEWALK_W = 1.35                     # design
FRONT_LINE = STREET_HALF_ROAD + SIDEWALK_W   # 5.6m centerline->front wall
BRANCH_HALF = 2.75                    # design 光启路 5.5m wide
LANE_W = 2.2                          # design 支弄

def to_glb(p):
    return (p[0] - WORLD_ORIGIN[0], p[1] - WORLD_ORIGIN[1])

# centerline control points (map coords), from roads 238219466 / 39697507 junction eastward
ctrl_map = [
    (53.5, -17.4),    # west anchor (segment start, midpoint interpolation toward 河南南路 side)
    (65.7, -21.6),    # 光启路 junction centerline point
    (79.1, -23.1),
    (94.4, -21.9),
    (102.6, -21.0),
    (111.8, -16.7),
    (129.2, -6.5),
    (138.5, -0.5),    # east anchor (trimmed before 144.4 to keep ~90m)
]


def chaikin(pts, iterations=2):
    """Corner-cutting smoothing so straight buildings can chain along the front line."""
    for _ in range(iterations):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out.append((a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25))
            out.append((a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75))
        out.append(pts[-1])
        pts = out
    return pts


ctrl = [to_glb(p) for p in chaikin(ctrl_map, 2)]

# resample by cumulative chord length
samples = []
for i in range(len(ctrl) - 1):
    (x0, z0), (x1, z1) = ctrl[i], ctrl[i + 1]
    d = math.hypot(x1 - x0, z1 - z0)
    n = max(2, int(d / 1.0))
    for k in range(n):
        t = k / n
        samples.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t))
samples.append(ctrl[-1])

# cumulative arc length
arc = [0.0]
for a, b in zip(samples, samples[1:]):
    arc.append(arc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
TOTAL = arc[-1]

def at(s):
    """point + eastward tangent + south-facing facade normal at arc length s"""
    s = max(0.0, min(TOTAL, s))
    for i in range(len(arc) - 1):
        if arc[i] <= s <= arc[i + 1]:
            t = (s - arc[i]) / max(1e-9, arc[i + 1] - arc[i])
            (x0, z0), (x1, z1) = samples[i], samples[i + 1]
            px, pz = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
            dx, dz = x1 - x0, z1 - z0
            L = math.hypot(dx, dz)
            tx, tz = dx / L, dz / L
            # north-side facade dir: perpendicular, pointing from north row toward street (south-ish)
            fx, fz = -tz, tx
            return (px, pz), (tx, tz), (fx, fz)
    raise ValueError(s)

def s_of_map_point(mx, mz):
    x, z = to_glb((mx, mz))
    best, bs = 1e9, 0.0
    for i in range(len(samples)):
        d = math.hypot(samples[i][0] - x, samples[i][1] - z)
        if d < best:
            best, bs = d, arc[i]
    return bs, best

corner_s, _ = s_of_map_point(65.7, -21.6)
theatre_s, theatre_off = s_of_map_point(74.92, -16.09)
catwall_poi_s, catwall_off = s_of_map_point(144.92, -32.09)

spec = {
    'id': 'fangbang-xuanhu-90m',
    'generated': '2026-09-13T00:55:00+09:00',
    'world': {
        'axis': 'GLB Y-up, X east, Z south; module facade +Z, depth -Z, origin front-wall center bottom',
        'worldOriginMapSpace': list(WORLD_ORIGIN),
        'worldOriginNote': 'GLB(x,z) = map(x - 53.5, y + 17.4); map y+ is south',
        'groundY': 0.0,
        'mapSource': 'inputs/map/map-data.json roads 238219466/238219464 (OSM snapshot 2019-01-01, design reuse)',
    },
    'era': [1990, 2000],
    'catWallException': 2023,
    'centerlineCtrlGlb': [list(c) for c in ctrl],
    'lengthMeters': round(TOTAL, 2),
    'designWidths': {
        'roadCurbToCurb': STREET_HALF_ROAD * 2,
        'sidewalkEachSide': SIDEWALK_W,
        'frontLineOffset': FRONT_LINE,
        'branchGuangqi': BRANCH_HALF * 2,
        'lane': LANE_W,
        'basis': 'design values inside the 6-9m street / 1.8-3m lane trial range; OSM 12m is 2019 current-state, not 1990s survey',
    },
    'anchors': {
        'westEnd': {'s': 0.0, 'glb': list(samples[0]), 'connectsTo': '方浜中路 continues west toward 河南南路 (outside segment)'},
        'eastEnd': {'s': round(TOTAL, 2), 'glb': list(samples[-1]), 'connectsTo': '方浜中路 continues east toward 东门路/童涵春 (outside segment)'},
        'cornerGuangqi': {'s': round(corner_s, 2), 'glb': list(at(corner_s)[0]), 'branchDir': 'south (GLB +Z); road 39697507'},
        'theatreXuanhu': {'s': round(theatre_s, 2), 'glb': [round(v, 2) for v in to_glb((74.92, -16.09))],
                          'offsetFromCenterline': round(theatre_off, 2),
                          'note': 'anchor sits on the SOUTH frontage band; kept as open forecourt gap in the south row (design)'},
        'catWallPoi': {'s': round(catwall_poi_s, 2), 'glb': [round(v, 2) for v in to_glb((144.92, -32.09))],
                       'offsetFromCenterline': round(catwall_off, 2),
                       'note': 'map POI is set back and beyond visual check; mural node is placed ON the north frontage inside this segment as a design adjustment'},
    },
    'designAdjustments': [
        'centerline smoothed with two Chaikin corner-cutting passes over the 2019 OSM polyline so straight building modules can chain wall-to-wall; the raw OSM kinks are not reproducible with rigid-width shopfronts',
        'cat mural wall moved from set-back POI marker to the north street frontage inside this segment (design; POI flagged 示意 in map data)',
        'theatre forecourt: south row left open at the 玄扈台 anchor so the landmark anchor is not buried inside a building; theatre building itself out of scope',
        '支弄A/支弄B positions are invented design values (no 2019 OSM lane exists in this stretch)',
        'street width 8.5m + 1.35m sidewalks is a trial value; 1990s true section unsurveyed',
    ],
}

out = ROOT / 'world'
out.mkdir(exist_ok=True)
(out / 'segment-spec.json').write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# dense centerline table for downstream scripts
line = [{'s': round(a, 3), 'x': round(p[0], 4), 'z': round(p[1], 4)} for a, p in zip(arc, samples)]
(out / 'segment.json').write_text(json.dumps({
    'axis': 'GLB Y-up X east Z south',
    'samplesMeters': line,
    'lengthMeters': round(TOTAL, 3),
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('segment length', round(TOTAL, 2), 'm')
print('corner s', round(corner_s, 2), '| theatre s', round(theatre_s, 2), 'off', round(theatre_off, 2), '| catwall poi s', round(catwall_poi_s, 2), 'off', round(catwall_off, 2))
print('west', samples[0], 'east', samples[-1])
