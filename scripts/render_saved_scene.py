import bpy
from pathlib import Path
WS=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(WS/'world/scene.blend'))
s=bpy.context.scene;s.render.resolution_x=640;s.render.resolution_y=360;s.cycles.samples=8;s.render.threads_mode='FIXED';s.render.threads=4
s.render.filepath=str(WS.parent/'artifacts/lead-review/scene-reopened-render.png');bpy.ops.render.render(write_still=True)
print('SAVED_SCENE_RENDERED')
