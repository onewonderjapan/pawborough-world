from pathlib import Path
import bpy,sys
WS=Path(__file__).resolve().parents[1];sys.path.insert(0,str(WS/'scripts'))
from world_texture_pack import pack_source_images
bpy.ops.wm.open_mainfile(filepath=str(WS/'world/scene.blend'))
count=pack_source_images(WS/'world/street.glb')
bpy.ops.wm.save_as_mainfile(filepath=str(WS/'world/scene.blend'))
print('REPACKED_SOURCE_IMAGES',count)
