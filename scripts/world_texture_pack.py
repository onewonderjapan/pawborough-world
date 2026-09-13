"""Repack exact embedded GLB image bytes after exporter image-cache operations."""
import bpy,json,struct
def pack_source_images(source):
 raw=source.read_bytes();cursor=12;document=None;binary=None
 while cursor<len(raw):
  length,kind=struct.unpack_from('<II',raw,cursor);chunk=raw[cursor+8:cursor+8+length];cursor+=8+length
  if kind==0x4e4f534a:document=json.loads(chunk)
  elif kind==0x004e4942:binary=chunk
 assert document is not None and binary is not None
 payload={}
 for item in document.get('images',[]):
  view=document['bufferViews'][item['bufferView']];assert view.get('buffer',0)==0
  start=view.get('byteOffset',0);payload[item['name']]=binary[start:start+view['byteLength']]
 count=0
 for im in bpy.data.images:
  if im.source!='FILE':continue
  if im.name not in payload:raise ValueError('Image is not in the frozen source GLB: '+im.name)
  data=payload[im.name];im.pack(data=data,data_len=len(data));assert im.packed_file;count+=1
 return count
