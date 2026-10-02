from pathlib import Path
import json, hashlib, base64, shutil, re, subprocess, mimetypes, argparse, datetime

parser = argparse.ArgumentParser(description="Export a versioned Pawborough static runtime allowlist")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()

R = Path(__file__).resolve().parents[1]
A = R / 'scene-authoring/yuyuan-area'
P = args.output.resolve()
(P / 'artifacts').mkdir(parents=True, exist_ok=True)

head = subprocess.check_output(['git', '-C', str(R), 'rev-parse', 'HEAD'], text=True).strip()
version = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y%m%d') + '-main-' + head[:8]
root = P / 'site'
prefix = 'versions/' + version
root.mkdir(exist_ok=True)

paths = set(json.loads((R / 'deploy/runtime-paths.json').read_text(encoding='utf-8'))['paths'])
paths.discard('/')
paths.add('/out/fangbang-route.json')

# Five lightweight JSON inputs
for name in [
    'food-catalog.json',
    'play-vendors.json',
    'food-pose-profiles.json',
    'world-art-style.json',
    'street-life.json',
]:
    paths.add('/inputs/' + name)

# Derive food resources from CURRENT inputs/play-foods.json
play_foods_manifest = json.loads((A / 'inputs/play-foods.json').read_text(encoding='utf-8'))
foods_list = play_foods_manifest.get('foods', [])
for f in foods_list:
    m_rel = f['path'].lstrip('/')
    m_src = (A / m_rel).resolve()
    assert m_src.is_file(), f"Food model missing: {m_src}"
    mb = m_src.read_bytes()
    assert len(mb) == f['bytes'], f"Food model bytes mismatch for {f.get('id')}: {len(mb)} vs {f.get('bytes')}"
    assert hashlib.sha256(mb).hexdigest() == f['sha256'], f"Food model sha mismatch for {f.get('id')}"
    paths.add('/' + m_rel)
    if 'thumbnail' in f and isinstance(f['thumbnail'], dict) and 'path' in f['thumbnail']:
        t_rel = f['thumbnail']['path'].lstrip('/')
        t_src = (A / t_rel).resolve()
        assert t_src.is_file(), f"Food thumb missing: {t_src}"
        tb = t_src.read_bytes()
        assert len(tb) == f['thumbnail']['bytes'], f"Food thumb bytes mismatch for {f.get('id')}: {len(tb)} vs {f['thumbnail'].get('bytes')}"
        assert hashlib.sha256(tb).hexdigest() == f['thumbnail']['sha256'], f"Food thumb sha mismatch for {f.get('id')}"
        paths.add('/' + t_rel)

zone_manifest = json.loads((A / 'out-zone/zones-manifest.json').read_text(encoding='utf-8'))
for zone in zone_manifest['zones']:
    for file in [zone.get('file'), zone.get('cm', {}).get('file')]:
        if file:
            paths.add('/out/' + file)

for f in (A / 'web').rglob('*'):
    if f.is_file() and f.suffix in ['.js', '.css']:
        paths.add('/' + str(f.relative_to(A)))

for directory in ['player', 'world']:
    for f in (R / 'src' / directory).rglob('*.js'):
        paths.add('/vendor-src/' + str(f.relative_to(R / 'src')))

def source(path):
    for pre, d in [('/out/', A / 'out-zone'), ('/vendor-src/', R / 'src'), ('/vendor/', R / 'node_modules')]:
        if path.startswith(pre):
            return d / path[len(pre):]
    return A / path.lstrip('/')

url_roots = ['out', 'web', 'vendor-src', 'vendor', 'node_modules', 'resources', 'modules', 'lighting', 'inputs']
pattern = re.compile(r'''(["'`])/(?:''' + '|'.join(re.escape(x) for x in url_roots) + r''')/''')

def rewrite(s):
    return pattern.sub(lambda m: m.group(0)[0] + '/' + prefix + m.group(0)[1:], s)

for path in sorted(paths):
    src = source(path).resolve()
    assert src.is_relative_to(R.resolve()), str(src)
    assert src.is_file(), str(src)
    dst = root / prefix / path.lstrip('/')
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    if path.startswith(('/web/', '/vendor-src/')) and dst.suffix == '.js':
        dst.write_text(rewrite(dst.read_text(encoding='utf-8')), encoding='utf-8')
    if path.startswith('/inputs/') and dst.suffix == '.json':
        d = json.loads(dst.read_text(encoding='utf-8'))
        if path.endswith('play-character.json'):
            bad = {'note', 'sourceRepository', 'sourceHead', 'sourceArtifact', 'source', 'sourcePath', 'originalPath'}
            d = {k: v for k, v in d.items() if k not in bad}
            if 'path' in d:
                d['path'] = prefix + '/' + d['path'].lstrip('/')
            if 'runtimeFoodRig' in d and isinstance(d['runtimeFoodRig'], dict):
                d['runtimeFoodRig'] = {k: v for k, v in d['runtimeFoodRig'].items() if k != 'method'}
        elif path.endswith('play-closed-facades.json'):
            d = {'facades': {k: v for k, v in d['facades'].items() if k in ['path', 'sha256', 'bytes', 'root', 'closedCount', 'plaqueText']}}
            d['facades']['path'] = prefix + '/' + d['facades']['path'].lstrip('/')
        elif path.endswith('play-vehicle.json'):
            d = {'vehicle': d['vehicle']}
            d['vehicle']['path'] = prefix + '/' + d['vehicle']['path'].lstrip('/')
        elif path.endswith('play-foods.json'):
            clean_foods = []
            for item in d.get('foods', []):
                cf = {k: v for k, v in item.items() if k not in ['source', 'sourcePath', 'originalPath', 'note']}
                cf['path'] = prefix + '/' + cf['path'].lstrip('/')
                if 'thumbnail' in cf and isinstance(cf['thumbnail'], dict):
                    thumb = {k: v for k, v in cf['thumbnail'].items() if k not in ['source', 'sourcePath', 'originalPath', 'note']}
                    if 'path' in thumb:
                        thumb['path'] = prefix + '/' + thumb['path'].lstrip('/')
                    cf['thumbnail'] = thumb
                clean_foods.append(cf)
            d = {'foods': clean_foods}
        elif path.endswith('food-catalog.json'):
            d = {k: v for k, v in d.items() if k not in ['note', 'source', 'sourcePath', 'originalPath']}
            if 'foods' in d and isinstance(d['foods'], list):
                d['foods'] = [{k: v for k, v in item.items() if k not in ['note', 'source', 'sourcePath', 'originalPath']} for item in d['foods']]
        elif path.endswith('play-vendors.json'):
            d = {k: v for k, v in d.items() if k not in ['note', 'source', 'sourcePath', 'originalPath']}
            if 'vendors' in d and isinstance(d['vendors'], list):
                d['vendors'] = [{k: v for k, v in item.items() if k not in ['note', 'source', 'sourcePath', 'originalPath']} for item in d['vendors']]
        elif path.endswith('food-pose-profiles.json'):
            d = {k: v for k, v in d.items() if k not in ['note', 'source', 'sourcePath', 'originalPath']}
            if 'profiles' in d and isinstance(d['profiles'], list):
                d['profiles'] = [{k: v for k, v in item.items() if k not in ['note', 'source', 'sourcePath', 'originalPath']} for item in d['profiles']]
        elif path.endswith('world-art-style.json'):
            d = {k: v for k, v in d.items() if k not in ['note', 'source', 'sourcePath', 'originalPath']}
        elif path.endswith('street-life.json'):
            d = {k: v for k, v in d.items() if k not in ['note', 'source', 'sourcePath', 'originalPath', 'placement']}
        dst.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if path == '/out/assemble-stats.json' and dst.suffix == '.json':
        txt = dst.read_text(encoding='utf-8')
        txt = re.sub(r'/home/[^"\'\s]*?/scene-authoring/yuyuan-area/', prefix + '/', txt)
        dst.write_text(txt, encoding='utf-8')

html = (A / 'web/index.html').read_text(encoding='utf-8')
html = rewrite(html)
html = html.replace('<title>全域底模 v2 · 豫园 / 城隍庙 / 小吃商业街</title>', '<title>Pawborough · 灰猫逛上海（试玩版）</title>')
html = html.replace(
    '// Keep recovery UI independent',
    "const publicEntry = new URL(location.href); if (!publicEntry.searchParams.has('play')) { publicEntry.searchParams.set('play','1'); publicEntry.searchParams.set('at','center'); history.replaceState(null,'',publicEntry); }\n// Keep recovery UI independent"
)
html = html.replace('当前本地网址', '当前网址').replace('当前本地', '当前')
html = html.replace('</body>', '<aside style="position:fixed;right:8px;bottom:3px;font:10px system-ui;color:#eee;text-shadow:0 1px 2px #222;z-index:5">OneWonder 试玩版 · 地图数据 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" style="color:inherit">© OpenStreetMap contributors</a></aside></body>')
(root / 'index.html').write_text(html, encoding='utf-8')
(root / '404.html').write_text('<!doctype html><meta charset="utf-8"><title>页面不存在</title><h1>页面不存在</h1><a href="/">回到 Pawborough</a>', encoding='utf-8')

for f in [
    R / 'licenses/THREE-LICENSE.txt',
    R / 'licenses/BASIS-UNIVERSAL-LICENSE.txt',
    R / 'node_modules/@dimforge/rapier3d-compat/LICENSE',
    R / 'node_modules/three/LICENSE',
]:
    if f.is_file():
        d = root / prefix / 'licenses' / f.name
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, d)

hashes = ["'sha256-" + base64.b64encode(hashlib.sha256(s.encode('utf-8')).digest()).decode('ascii') + "'" for s in re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', html, re.S)]
csp = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' " + ' '.join(hashes) + "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; media-src 'self'; upgrade-insecure-requests"
(P / 'artifacts/HEADERS.json').write_text(json.dumps({'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Resource budgets reporting in artifacts
new_foods = [f for f in foods_list if f.get('id') not in ['xiaolongbao', 'congyoubing', 'youdunzi']]
model_bytes_total = sum(f['bytes'] for f in new_foods)
thumb_bytes_total = sum(f['thumbnail']['bytes'] for f in foods_list if 'thumbnail' in f)
budgets = {
    'models': {
        'count': len(new_foods),
        'bytes': model_bytes_total,
        'limitBytes': 24 * 1024 * 1024,
        'withinBudget': model_bytes_total <= 24 * 1024 * 1024
    },
    'thumbnails': {
        'count': len([f for f in foods_list if 'thumbnail' in f]),
        'bytes': thumb_bytes_total,
        'limitBytes': 2 * 1024 * 1024,
        'withinBudget': thumb_bytes_total <= 2 * 1024 * 1024
    }
}
(P / 'artifacts/RESOURCE-BUDGETS.json').write_text(json.dumps(budgets, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

files = []
mime = {
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.wasm': 'application/wasm',
    '.glb': 'model/gltf-binary',
    '.ktx2': 'image/ktx2',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.json': 'application/json',
    '.html': 'text/html',
    '.css': 'text/css',
    '.txt': 'text/plain'
}

for f in sorted(root.rglob('*')):
    if not f.is_file():
        continue
    path = str(f.relative_to(root))
    if path.startswith('versions/') and not path.startswith(prefix + '/'):
        continue
    b = f.read_bytes()
    files.append({
        'path': path,
        'bytes': len(b),
        'sha256': hashlib.sha256(b).hexdigest(),
        'contentType': mime.get(f.suffix, mimetypes.guess_type(path)[0] or 'application/octet-stream'),
        'cacheControl': 'public,max-age=31536000,immutable' if path.startswith('versions/') else 'no-cache,max-age=0,must-revalidate'
    })

manifest = {
    'version': version,
    'sourceHead': head,
    'entry': '/',
    'files': files,
    'bytes': sum(f['bytes'] for f in files),
    'excluded': ['Blend工程', '参考照片/视频', '旧输出/审查目录', '原始素材归档', 'AWS凭证/本机配置'],
    'externalServices': []
}
(P / 'artifacts/PUBLIC-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'version': version, 'files': len(files), 'bytes': manifest['bytes'], 'MiB': round(manifest['bytes'] / 2**20, 2)}, ensure_ascii=False))
