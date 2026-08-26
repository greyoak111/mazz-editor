"""Create a tiny deterministic .blend input for the opt-in W94D real probe.

This is test setup only; the product capability itself invokes the fixed
Mazz-owned capability script and never accepts this script from a user.
"""
import sys
import bpy

tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(tail) != 1:
    raise SystemExit("expected one output .blend path")

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 64
scene.render.resolution_y = 64
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = True
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
bpy.context.object.name = "W94DProbeCube"
bpy.ops.object.light_add(type="POINT", location=(3, -3, 4))
bpy.context.object.data.energy = 800
bpy.ops.object.camera_add(location=(4, -4, 3))
camera = bpy.context.object
camera.rotation_euler = (0.9, 0, 0.8)
scene.camera = camera
bpy.ops.wm.save_as_mainfile(filepath=tail[0])
