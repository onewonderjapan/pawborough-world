"""F0 — unified light rig for every render path of this batch
(DESIGN_SPEC packageF.lightRig):
  Sun        energy 3.0, direction (55deg, 0, -35deg), angular diameter 1.5deg
  World      flat gray 0.55, strength 1.0
  Fill       AREA light 60 W, 8 m behind/above the ACTIVE camera (follows it)
  View       AgX Base Contrast; Cycles shadows + GI fully on

Every scene script in this batch imports and re-applies the rig before each
render (the fill re-aims per camera). scene-v1 is a frozen committed blend —
the before/after G-package therefore renders BOTH sides with this rig applied
at render time (render_scene_views.py), which is exactly the "one lighting
contract" the review asked for.

Usage:
  import light_rig
  light_rig.apply(bpy.context.scene, camera_obj)   # before each render
"""
import math

import bpy

SUN_ENERGY = 3.0
SUN_ROT = (math.radians(55.0), 0.0, math.radians(-35.0))
SUN_ANGLE = math.radians(1.5)
WORLD_GRAY = 0.55
WORLD_STRENGTH = 1.0
FILL_W = 60.0
FILL_DIST = 8.0
FILL_SIZE = 4.0


def _ensure(scene, name, kind):
    o = scene.objects.get(name)
    if o is None or o.type != 'LIGHT' or o.data.type != kind:
        old = scene.objects.get(name)
        if old is not None:
            bpy.data.objects.remove(old, do_unlink=True)
        o = bpy.data.objects.new(name, bpy.data.lights.new(name, kind))
        scene.collection.objects.link(o)
    return o


def apply(scene, camera=None):
    """Idempotently apply the rig; the fill follows `camera` when given.

    Legacy lights (scene-v1's 'sun'/'fill', any non-rig SUN/AREA/SUN-light)
    are switched OFF so every render path shares exactly one lighting set."""
    for o in scene.objects:
        if o.type == 'LIGHT' and not o.name.startswith('rig-'):
            o.data.energy = 0.0
            o.hide_render = True

    sun = _ensure(scene, 'rig-sun', 'SUN')
    sun.data.energy = SUN_ENERGY
    sun.data.angle = SUN_ANGLE
    sun.rotation_euler = SUN_ROT

    world = scene.world
    if world is None or not world.use_nodes:
        world = bpy.data.worlds.new('rig-world')
        scene.world = world
        world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg is None:
        bg = world.node_tree.nodes.new('ShaderNodeBackground')
        out = world.node_tree.nodes.get('World Output')
        world.node_tree.links.new(bg.outputs[0], out.inputs[0])
    g = WORLD_GRAY
    bg.inputs[0].default_value = (g, g, g, 1.0)
    bg.inputs[1].default_value = WORLD_STRENGTH

    fill = _ensure(scene, 'rig-fill', 'AREA')
    fill.data.energy = FILL_W
    fill.data.size = FILL_SIZE
    if camera is not None:
        loc = camera.matrix_world.translation
        fwd = (camera.matrix_world.to_quaternion() @ __import__('mathutils').Vector((0, 0, -1))).normalized()
        # 8 m behind the camera and 8 m up: "behind/above the active camera"
        place = loc - fwd * FILL_DIST
        place.z += FILL_DIST
        fill.location = place
        aim = loc + fwd * 10.0
        d = aim - fill.location
        fill.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = 'AgX - Base Contrast'
    except TypeError:
        pass
    return scene
