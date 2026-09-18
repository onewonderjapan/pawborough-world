"""C3 reopen check — proves scene-v1.blend is a self-contained video source:
missing (unpacked) images must be 0 and the v1_cameras collection must carry
exactly 26 contract cameras.

Run: blender -b kit/out/scene-v1/scene-v1.blend -P kit/check_scene_v1.py
Exit 0 iff missing_images==0 and cameras==26.
"""
import sys
import bpy

missing = [img.name for img in bpy.data.images
           if img.source == 'FILE' and not img.packed_file]
cam_col = bpy.data.collections.get('v1_cameras')
cams = [o for o in cam_col.objects if o.type == 'CAMERA'] if cam_col else []
print(f'CHECK missing_images={len(missing)} cameras={len(cams)}')
if missing:
    print('MISSING:', ', '.join(missing[:10]))
if cams:
    print('CAMERA_IDS:', ', '.join(sorted(o.name.replace('cam__', '') for o in cams)))
ok = len(missing) == 0 and len(cams) == 26
print('SCENE_V1_CHECK', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
