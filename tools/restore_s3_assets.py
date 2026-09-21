#!/usr/bin/env python3
"""Restore explicitly selected, SHA-locked Pawborough assets from the private S3 archive.
Requires AWS CLI and an authorized AWS login. Defaults to inventory-only.
"""
import argparse,hashlib,json,os,subprocess,sys,uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument('--manifest',type=Path,default=ROOT/'docs/ASSET-MANIFEST.json')
 ap.add_argument('--target',type=Path,default=ROOT)
 ap.add_argument('--profile',help='Your own authorized AWS profile; never a credential value')
 ap.add_argument('--path',action='append',default=[],help='Exact manifest path; repeat to select files')
 ap.add_argument('--all',action='store_true',help='Restore the complete frozen snapshot (about 12.54GB unique objects)')
 a=ap.parse_args();m=json.loads(a.manifest.read_text(encoding='utf-8'));storage=m.get('storage',{})
 if not a.path and not a.all:
  print(json.dumps({'snapshot':m['sourceCommit'],'files':len(m['files']),'uniqueBytes':m['uniqueBytes'],'storage':storage,'next':'Choose --path <exact-path> or --all; AWS S3 access is required.'},ensure_ascii=False,indent=2));return
 if a.path and a.all:ap.error('Choose --path or --all, not both')
 if not storage.get('bucket'):raise ValueError('Archive has no configured bucket')
 bypath={f['path']:f for f in m['files']};unknown=set(a.path)-set(bypath)
 if unknown:raise ValueError('Paths absent from this snapshot: '+repr(sorted(unknown)))
 chosen=m['files'] if a.all else [bypath[x] for x in dict.fromkeys(a.path)]
 root=a.target.resolve();root.mkdir(parents=True,exist_ok=True);restored=0;reused=0
 for item in chosen:
  rel=Path(item['path']);dest=(root/rel).resolve()
  if rel.is_absolute() or '..' in rel.parts or dest==root or root not in dest.parents:raise ValueError('Unsafe path '+str(rel))
  oid=item['sha256']
  if len(oid)!=64 or any(c not in '0123456789abcdef' for c in oid):raise ValueError('Invalid digest')
  if dest.exists():
   if dest.is_file() and dest.stat().st_size==item['bytes'] and digest(dest)==oid:reused+=1;continue
   is_pointer=dest.is_file() and dest.stat().st_size<1024
   data=dest.read_text(encoding='utf-8',errors='replace') if is_pointer else ''
   if not (data.startswith('version https://git-lfs.github.com/spec/v1\n') and ('oid sha256:'+oid+'\n') in data):raise ValueError('Refusing to overwrite a different existing file: '+str(dest))
  dest.parent.mkdir(parents=True,exist_ok=True);tmp=dest.with_name(dest.name+'.download-'+uuid.uuid4().hex)
  key=storage.get('objectPrefix','objects/sha256/')+oid[:2]+'/'+oid
  cmd=['aws']
  if a.profile:cmd+=['--profile',a.profile]
  cmd+=['--region',storage['region'],'s3api','get-object','--bucket',storage['bucket'],'--key',key,'--checksum-mode','ENABLED',str(tmp)]
  subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL)
  if tmp.stat().st_size!=item['bytes'] or digest(tmp)!=oid:raise ValueError('Downloaded bytes differ; retained for inspection: '+str(tmp))
  os.replace(tmp,dest);restored+=1
  print(json.dumps({'restored':restored,'reused':reused,'total':len(chosen),'path':item['path']},ensure_ascii=False),flush=True)
 print(json.dumps({'status':'PASS','restored':restored,'reused':reused,'snapshot':m['sourceCommit']},ensure_ascii=False))
if __name__=='__main__':
 try:main()
 except Exception as exc:print(str(exc),file=sys.stderr);sys.exit(1)
