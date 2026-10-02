from pathlib import Path
import json,hashlib,base64,shutil,re,subprocess,mimetypes,argparse,datetime
parser=argparse.ArgumentParser(description="Export a versioned Pawborough static runtime allowlist")
parser.add_argument("--output",type=Path,required=True)
args=parser.parse_args()
R=Path(__file__).resolve().parents[1];A=R/'scene-authoring/yuyuan-area';P=args.output.resolve();(P/'artifacts').mkdir(parents=True,exist_ok=True);head=subprocess.check_output(['git','-C',str(R),'rev-parse','HEAD'],text=True).strip();version=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y%m%d')+'-main-'+head[:8];root=P/'site';prefix='versions/'+version
root.mkdir(exist_ok=True);paths=set(json.loads((R/'deploy/runtime-paths.json').read_text(encoding='utf-8'))['paths']);paths.discard('/');paths.add('/out/fangbang-route.json')
zone_manifest=json.loads((A/'out-zone/zones-manifest.json').read_text(encoding='utf-8'))
for zone in zone_manifest['zones']:
 for file in [zone.get('file'),zone.get('cm',{}).get('file')]:
  if file:paths.add('/out/'+file)
for f in (A/'web').rglob('*'):
 if f.is_file() and f.suffix in ['.js','.css']:paths.add('/'+str(f.relative_to(A)))
for directory in ['player','world']:
 for f in (R/'src'/directory).rglob('*.js'):paths.add('/vendor-src/'+str(f.relative_to(R/'src')))
def source(path):
 for pre,d in [('/out/',A/'out-zone'),('/vendor-src/',R/'src'),('/vendor/',R/'node_modules')]:
  if path.startswith(pre):return d/path[len(pre):]
 return A/path.lstrip('/')
url_roots=['out','web','vendor-src','vendor','node_modules','resources','modules','lighting','inputs']
pattern=re.compile(r'''(["'`])/(?:'''+ '|'.join(re.escape(x) for x in url_roots)+r''')/''')
def rewrite(s):return pattern.sub(lambda m:m.group(0)[0]+'/'+prefix+m.group(0)[1:],s)
for path in sorted(paths):
 src=source(path).resolve();assert src.is_relative_to(R.resolve()),str(src);assert src.is_file(),str(src);dst=root/prefix/path.lstrip('/');dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
 if path.startswith(('/web/','/vendor-src/')) and dst.suffix=='.js':dst.write_text(rewrite(dst.read_text(encoding='utf-8')),encoding='utf-8')
 if path.startswith('/inputs/play-') and dst.suffix=='.json':
  d=json.loads(dst.read_text(encoding='utf-8'))
  if path.endswith('play-character.json'):d={k:v for k,v in d.items() if k in ['actorId','labelZh','path','sha256','bytes','heightM']};d['path']=prefix+'/'+d['path']
  elif path.endswith('play-closed-facades.json'):d={'facades':{k:v for k,v in d['facades'].items() if k in ['path','sha256','bytes','root','closedCount','plaqueText']}};d['facades']['path']=prefix+'/'+d['facades']['path']
  elif path.endswith('play-vehicle.json'):d={'vehicle':d['vehicle']};d['vehicle']['path']=prefix+'/'+d['vehicle']['path']
  elif path.endswith('play-foods.json'):
   d={'foods':[{k:v for k,v in f.items() if k not in ['source','sourcePath','originalPath','note']} for f in d['foods']]}
   for f in d['foods']:f['path']=prefix+'/'+f['path']
  dst.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
html=(A/'web/index.html').read_text(encoding='utf-8');html=rewrite(html);html=html.replace('<title>全域底模 v2 · 豫园 / 城隍庙 / 小吃商业街</title>','<title>Pawborough · 灰猫逛上海（试玩版）</title>');html=html.replace('// Keep recovery UI independent',"const publicEntry = new URL(location.href); if (!publicEntry.searchParams.has('play')) { publicEntry.searchParams.set('play','1'); publicEntry.searchParams.set('at','center'); history.replaceState(null,'',publicEntry); }\n// Keep recovery UI independent")
html=html.replace('当前本地网址','当前网址').replace('当前本地','当前');html=html.replace('</body>','<aside style="position:fixed;right:8px;bottom:3px;font:10px system-ui;color:#eee;text-shadow:0 1px 2px #222;z-index:5">OneWonder 试玩版 · 地图数据 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" style="color:inherit">© OpenStreetMap contributors</a></aside></body>')
(root/'index.html').write_text(html,encoding='utf-8');(root/'404.html').write_text('<!doctype html><meta charset="utf-8"><title>页面不存在</title><h1>页面不存在</h1><a href="/">回到 Pawborough</a>',encoding='utf-8')
for f in [R/'licenses/THREE-LICENSE.txt',R/'licenses/BASIS-UNIVERSAL-LICENSE.txt',R/'node_modules/@dimforge/rapier3d-compat/LICENSE',R/'node_modules/three/LICENSE']:
 if f.is_file():d=root/prefix/'licenses'/f.name;d.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,d)
hashes=["'sha256-"+base64.b64encode(hashlib.sha256(s.encode('utf-8')).digest()).decode('ascii')+"'" for s in re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',html,re.S)]
csp="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' "+' '.join(hashes)+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; media-src 'self'; upgrade-insecure-requests"
(P/'artifacts/HEADERS.json').write_text(json.dumps({'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
files=[];mime={'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.glb':'model/gltf-binary','.ktx2':'image/ktx2','.json':'application/json','.html':'text/html','.css':'text/css'}
for f in sorted(root.rglob('*')):
 if not f.is_file():continue
 path=str(f.relative_to(root))
 if path.startswith('versions/') and not path.startswith(prefix+'/'):continue
 b=f.read_bytes();files.append({'path':path,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'contentType':mime.get(f.suffix,mimetypes.guess_type(path)[0] or 'application/octet-stream'),'cacheControl':'public,max-age=31536000,immutable' if path.startswith('versions/') else 'no-cache,max-age=0,must-revalidate'})
manifest={'version':version,'sourceHead':head,'entry':'/','files':files,'bytes':sum(f['bytes'] for f in files),'excluded':['Blend工程','参考照片/视频','旧输出/审查目录','原始素材归档','AWS凭证/本机配置'],'externalServices':[]}
(P/'artifacts/PUBLIC-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'version':version,'files':len(files),'bytes':manifest['bytes'],'MiB':round(manifest['bytes']/2**20,2)},ensure_ascii=False))
