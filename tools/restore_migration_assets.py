#!/usr/bin/env python3
"""Restore SHA-locked assets from a local preservation cache, or explicitly from private S3."""
from pathlib import Path
import argparse,json,hashlib,shutil,subprocess,uuid,sys
ROOT=Path(__file__).resolve().parents[1]
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(4*1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--manifest',type=Path,default=ROOT/'docs/MIGRATION-ASSETS.json');ap.add_argument('--target',type=Path,default=ROOT);ap.add_argument('--cache',type=Path);ap.add_argument('--download',action='store_true');ap.add_argument('--profile');ap.add_argument('--all',action='store_true');ap.add_argument('--path',action='append',default=[]);a=ap.parse_args();m=json.loads(a.manifest.read_text(encoding='utf-8'))
 if not a.all and not a.path:print(json.dumps({'files':len(m['files']),'uniqueBytes':m['uniqueBytes'],'state':m.get('state'),'next':'Select --all or --path; use --cache or explicit --download --profile'},ensure_ascii=False));return
 if a.all and a.path:ap.error('Choose --all or --path')
 chosen=m['files'] if a.all else [f for f in m['files'] if f['path'] in a.path]
 if not a.all and set(a.path)-{f['path'] for f in chosen}:ap.error('Unknown manifest path')
 root=a.target.resolve();restored=reused=0
 for item in chosen:
  rel=Path(item['path']);dest=(root/rel).resolve();sha=item['sha256']
  if rel.is_absolute() or '..' in rel.parts or root not in dest.parents:raise ValueError('Unsafe manifest path')
  if len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha):raise ValueError('Invalid SHA')
  if dest.exists():
   if dest.is_file() and dest.stat().st_size==item['bytes'] and digest(dest)==sha:reused+=1;continue
   raise ValueError('Refusing to overwrite different file: '+str(dest))
  dest.parent.mkdir(parents=True,exist_ok=True);tmp=dest.with_name(dest.name+'.restore-'+uuid.uuid4().hex)
  cached=a.cache/sha[:2]/sha if a.cache else None
  if cached and cached.is_file():shutil.copyfile(cached,tmp)
  elif a.download:
   s=m['storage'];cmd=['aws']+(['--profile',a.profile] if a.profile else [])+['--region',s['region'],'s3api','get-object','--bucket',s['bucket'],'--key',s.get('objectPrefix','objects/sha256/')+sha[:2]+'/'+sha,'--checksum-mode','ENABLED',str(tmp)];subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL)
  else:raise FileNotFoundError('Asset absent from cache; remote download not enabled: '+item['path'])
  if tmp.stat().st_size!=item['bytes'] or digest(tmp)!=sha:raise ValueError('Asset SHA mismatch; inspection file retained: '+str(tmp))
  tmp.rename(dest);restored+=1
 print(json.dumps({'status':'PASS','restored':restored,'reused':reused,'total':len(chosen),'target':str(root)},ensure_ascii=False))
if __name__=='__main__':
 try:main()
 except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
