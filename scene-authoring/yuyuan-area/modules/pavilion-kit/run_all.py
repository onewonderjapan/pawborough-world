#!/usr/bin/env python3
"""Orchestrator: build all 5 pavilions (Blender sequential, -t 4), validate, blank-guard, package.
Run: python3 run_all.py [--only bld-...]
Outputs: out-pavilion-kit/<module>/... + manifest.json + placements.json; copies to artifacts.
"""
import json, os, subprocess, sys, shutil, hashlib, time

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.dirname(os.path.dirname(HERE))          # scene-authoring/yuyuan-area
OUTROOT = os.path.join(AREA, 'out-pavilion-kit')
ART = os.environ.get(
    'PAV_ARTIFACTS_DIR',
    '/home/baibai/outbox/pawborough-w1-pavilion-kit-20260922/artifacts/pavilion-kit')
MAIN = '/home/baibai/work/onewonderjapan/pawborough-world'
BLENDER = os.path.expanduser('~/.local/bin/blender')
SITE = json.load(open(os.path.join(HERE, 'site-inputs.json'), encoding='utf-8'))
ONLY = None
if '--only' in sys.argv:
    ONLY = sys.argv[sys.argv.index('--only') + 1]

os.makedirs(ART, exist_ok=True)


def blank_guard(path):
    """Spec guard + colour-diversity: catches two-tone 'ground+sky only' frames too."""
    from PIL import Image
    import numpy as np
    im = Image.open(path)
    g = np.asarray(im.convert('L'), dtype=np.float32)
    std = float(g.std())
    q = (g.astype(np.uint8) // 32).flatten()
    dom = float(np.bincount(q, minlength=8).max() / q.size)
    im_small = im.convert('RGB').resize((160, 120))
    colors = len(set(im_small.getdata()))
    return {'luminanceStd': round(std, 2), 'dominantFraction': round(dom, 4),
            'quantizedColors': colors,
            'blank': bool(std < 2.0 or dom > 0.95 or colors < 16)}


def main():
    pavilions = [p for p in SITE['pavilions'] if not ONLY or p['id'] == ONLY]
    log = {}
    for P in pavilions:
        bid = P['id']
        t0 = time.time()
        outdir = os.path.join(OUTROOT, 'pavilion-' + bid)
        shutil.rmtree(outdir, ignore_errors=True)
        os.makedirs(os.path.join(outdir, 'renders'), exist_ok=True)
        cmd = [BLENDER, '--background', '-t', '4', '--python',
               os.path.join(HERE, 'build_pavilion.py'), '--', '--bld', bid]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
        ready = [l for l in r.stdout.splitlines() if l.startswith('PAVILION_READY')]
        log[bid] = {'blenderExit': r.returncode, 'ready': bool(ready)}
        if not ready:
            log[bid]['tail'] = (r.stderr or r.stdout)[-2000:]
            print('BUILD FAIL', bid); print(log[bid]['tail']); sys.exit(2)
        print(ready[0])

        # blank guard on renders
        rg = {}
        for v in ('front', 'three-quarter', 'top', 'under-eave'):
            rg[v] = blank_guard(os.path.join(outdir, 'renders', v + '.png'))
            if rg[v]['blank']:
                print('BLANK FRAME', bid, v, rg[v]); sys.exit(3)
        json.dump(rg, open(os.path.join(outdir, 'render-log.json'), 'w'), indent=1)
        log[bid]['renderGuard'] = rg

        # Khronos validator (0 errors required)
        rep = os.path.join(outdir, 'validator.json')
        vr = subprocess.run(['node', os.path.join(MAIN, 'scripts', 'validate_all.cjs'),
                             '--files', f'pavilion-{bid}/model.glb', '--root', OUTROOT,
                             '--report', rep], capture_output=True, text=True, timeout=300)
        vj = json.load(open(rep))
        res = vj['results'][0]
        errs = res.get('error') or 0
        log[bid]['validator'] = {'exit': vr.returncode, 'errors': errs, 'warnings': res.get('warning', 0)}
        if vr.returncode != 0 or errs:
            print('VALIDATOR FAIL', bid, json.dumps(res)[:1500]); sys.exit(4)
        print('validator 0 errors,', res.get('warning', 0), 'warnings')

        # copy binaries to artifacts (GLB, blend, renders, validator report)
        adir = os.path.join(ART, 'pavilion-' + bid)
        os.makedirs(os.path.join(adir, 'renders'), exist_ok=True)
        shutil.copy2(os.path.join(outdir, 'model.glb'), adir)
        shutil.copy2(os.path.join(outdir, 'pavilion.blend'), adir)
        shutil.copy2(os.path.join(outdir, 'validator.json'), adir)
        for v in ('front', 'three-quarter', 'top', 'under-eave'):
            shutil.copy2(os.path.join(outdir, 'renders', v + '.png'),
                         os.path.join(adir, 'renders', v + '.png'))
        log[bid]['secs'] = round(time.time() - t0, 1)

    json.dump(log, open(os.path.join(OUTROOT, 'build-log.json'), 'w'), indent=1)

    # ---- placements.json (assemble.py instance convention) + manifest.json
    placements, manifest = [], {}
    for P in SITE['pavilions']:
        bid = P['id']
        outdir = os.path.join(OUTROOT, 'pavilion-' + bid)
        rep = json.load(open(os.path.join(outdir, 'build-report.json')))
        glb = os.path.join(outdir, 'model.glb')
        sha = hashlib.sha256(open(glb, 'rb').read()).hexdigest()
        placements.append({
            'id': 'pavilion-' + bid,
            'module': 'pavilion-' + bid,
            'zh': P['zh'],
            'layoutObjectId': bid,
            'zone': 'garden', 'lod': 'L1',
            'position': P['centroid'],
            'rotY': P['rotY'],
            'sourcePath': f'scene-authoring/yuyuan-area/out-pavilion-kit/pavilion-{bid}/model.glb',
            'sha256': sha,
            'ownerAdopted': False,
            'axis': 'GLB Y-up, facade +Z, origin platform centre at ground y=0; scale 1; '
                    'rotY = atan2(dx,dz) of layout facade.dir (assemble.py Blender Z-yaw convention)',
        })
        manifest[bid] = {'module': 'pavilion-' + bid, 'zh': P['zh'],
                         'glbBytes': os.path.getsize(glb), 'sha256': sha,
                         'triangles': rep['measured']['triangles']['total'],
                         'validator': '0 errors'}
    json.dump({'packageId': 'pawborough-w1-pavilion-kit-20260922',
               'note': 'for lead integration; pavilions are NOT yet in baseline/layout.json instances (frozen); '
                       'lead step will append these to instances and re-assemble',
               'conventions': SITE['conventions'],
               'placements': placements},
              open(os.path.join(OUTROOT, 'placements.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    json.dump(manifest, open(os.path.join(OUTROOT, 'manifest.json'), 'w', encoding='utf-8'), indent=1)
    shutil.copy2(os.path.join(OUTROOT, 'placements.json'), os.path.join(ART, 'placements.json'))
    shutil.copy2(os.path.join(OUTROOT, 'manifest.json'), os.path.join(ART, 'manifest.json'))
    print('PLACEMENTS + MANIFEST written:', len(placements), 'pavilions')


if __name__ == '__main__':
    main()
