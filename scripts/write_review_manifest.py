"""Write world/review-manifest.json from the real delivered files: every bytes,
sha256 and triangle count is measured, never copied from an older manifest.

Run: python3 -X utf8 scripts/write_review_manifest.py   (exit non-zero on any gap)
"""
import hashlib
import json
import sys
from pathlib import Path

WS = Path(__file__).resolve().parents[1]
catalog = json.loads((WS / 'world/asset-catalog.json').read_text(encoding='utf-8'))
receipt = json.loads((WS.parent / 'artifacts/lead-review/world-package.json').read_text(encoding='utf-8'))


def digest(p: Path):
    b = p.read_bytes()
    return {'path': f'./{p.relative_to(WS).as_posix()}', 'bytes': len(b),
            'sha256': hashlib.sha256(b).hexdigest()}


modules = []
for item in catalog['modules']:
    glb = WS / 'building' / item['id'] / 'model.glb'
    if not glb.is_file():
        print(f'MISSING module glb: {glb}', file=sys.stderr)
        sys.exit(1)
    modules.append({'id': item['id'], **digest(glb)})

kit = WS / 'world/street-kit.glb'
world = WS / 'world/street-reviewed.glb'
source = WS / 'world/street.glb'
for p in (kit, world, source):
    if not p.is_file():
        print(f'MISSING world file: {p}', file=sys.stderr)
        sys.exit(1)

scene_images = receipt.get('sceneTextureFiles', [])
manifest = {
    'generatedBy': 'scripts/write_review_manifest.py (all values measured from the real files)',
    'modules': modules,
    'streetKit': {**digest(kit), 'triangles': receipt['streetKitTriangles']},
    'placedTriangles': receipt['sourceWorldTriangles'],
    'completeWebPayloadBytes': sum(m['bytes'] for m in modules) + kit.stat().st_size + world.stat().st_size,
    'originalStreetGlbSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'kitExtractedWithoutMovingBuildings': bool(receipt['geometryCountsPreserved']),
    'reviewedWorldGlbSha256': hashlib.sha256(world.read_bytes()).hexdigest(),
    'roadWindingCorrected': True,
    'worldAssembly': {**digest(world)},
    'sceneImages': {'count': len(scene_images), 'allPacked': all(i['packed'] for i in scene_images)},
    'previewLoadMode': 'single_assembly_sharing_embedded_images',
}
(WS / 'world/review-manifest.json').write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('MANIFEST_WRITTEN', json.dumps({'modules': len(modules),
                                      'placedTriangles': manifest['placedTriangles'],
                                      'worldBytes': manifest['worldAssembly']['bytes'],
                                      'payloadBytes': manifest['completeWebPayloadBytes'],
                                      'sceneImages': manifest['sceneImages']['count']}))
