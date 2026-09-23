#!/usr/bin/env python3
"""make_records.py — generate collision.json, map-authoring.json, manifest.json.

Run: python3 make_records.py --module <modules/rockery> --out <out-rockery>

collision.json   one UNEXPANDED placeholder box per rock (x±0.6size, z±0.6size, y 0..h),
                 map coordinates, per DESIGN_SPEC 'collision'
map-authoring.json  material provenance incl. the PIL-style tinted bake
manifest.json    sha256/bytes of each delivered GLB (cross-checked with validator)
"""
import argparse
import hashlib
import json
import os

STONES = ('rockery-dajiashan', 'rockery-yulinglong')


def sha256(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--module', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--validation', required=True)
    args = ap.parse_args()

    site = json.load(open(os.path.join(args.module, 'site-inputs.json')))
    val = json.load(open(args.validation))
    vres = {r['file'].split('/')[-1]: r for r in val['results']}

    # collision: one unexpanded placeholder box per rock
    collision = {'coordinateSystem': 'layout map metres: x east, z south, y up (GLB == map coords)',
                 'clusters': {}}
    for cid in STONES:
        boxes = []
        for r in site['clusters'][cid]['rocks']:
            hx = 0.6 * r['size']
            boxes.append({'rockSeed': r['seed'], 'x': r['x'], 'z': r['z'],
                          'xMin': round(r['x'] - hx, 3), 'xMax': round(r['x'] + hx, 3),
                          'zMin': round(r['z'] - hx, 3), 'zMax': round(r['z'] + hx, 3),
                          'yMin': 0.0, 'yMax': r['h']})
        collision['clusters'][cid] = {'rockCount': len(boxes), 'boxes': boxes}
    with open(os.path.join(args.module, 'collision.json'), 'w') as f:
        json.dump(collision, f, indent=1)

    # map-authoring: material record
    stone = site['material']['stone']
    ma = {
        'stone': {
            'family': stone['family'],
            'sourceColor': stone['textures']['color'],
            'sourceNormal': stone['textures']['normal'],
            'sourceNote': 'imported by absolute path from MAIN repo source-kit; gitignored in worktrees',
            'derived': [{
                'file': 'out-rockery/textures/plaster-tint-7d8288.jpg',
                'kind': 'analytic tint bake',
                'method': 'linear-space multiply of sRGB source color by linear tint',
                'tintSrgbHex': stone['tintSrgbHex'],
                'resolution': '1K (source)',
                'role': 'Base Color (sRGB)',
            }],
            'normal': {'colorspace': 'Non-Color', 'node': 'NormalMap', 'strength': stone['normalStrength'],
                       'gltf': 'normalTexture.scale=0.6'},
            'roughness': stone['roughness'],
            'tileM': stone['tileM'],
            'uv': 'world-space cube projection (dominant normal axis), tiles every 2.5 m',
            'moss': {**site['material']['mossOptional'], 'applied': 'constant-color material slot '
                                                                       'on ground band faces; share per cluster in build-<id>.record.json'},
        },
    }
    with open(os.path.join(args.module, 'map-authoring.json'), 'w') as f:
        json.dump(ma, f, indent=1)

    # manifest: sha256 per delivered GLB
    manifest = {'glbs': {}}
    for cid in STONES:
        p = os.path.join(args.out, f'{cid}.glb')
        vr = vres[f'{cid}.glb']
        manifest['glbs'][cid] = {
            'path': p,
            'sha256': sha256(p),
            'bytes': os.path.getsize(p),
            'validatorSha256': vr['sha256'],
            'validatorErrors': vr['errors'],
            'validatorWarnings': vr['warnings'],
            'tris': vr['info'].get('totalTriangleCount'),
            'shaMatch': sha256(p) == vr['sha256'],
        }
    with open(os.path.join(args.module, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print('RECORDS_DONE collision map-authoring manifest',
          all(m['shaMatch'] for m in manifest['glbs'].values()))


main()
