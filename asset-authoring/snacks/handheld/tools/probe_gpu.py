"""Probe: can Cycles use CUDA on this machine? Renders a 64x64 spp=1 frame either way."""
import bpy, sys, time
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
for ctype in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = ctype
        prefs.get_devices()
        devs = [d for d in prefs.devices if d.type == ctype]
        for d in prefs.devices:
            d.use = (d.type == ctype)
        if devs:
            sc.cycles.device = 'GPU'
            sc.cycles.samples = 1
            sc.render.resolution_x = sc.render.resolution_y = 64
            t = time.time()
            bpy.ops.render.render(write_still=False)
            print('CUDA_PROBE_OK', ctype, [d.name for d in devs], round(time.time() - t, 1))
            sys.exit(0)
    except Exception as e:
        print('CUDA_PROBE_FAIL', ctype, repr(e))
print('CUDA_PROBE_NONE')
