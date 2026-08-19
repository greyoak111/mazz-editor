import bpy
import os
import sys


def main():
    if "--" not in sys.argv:
        raise RuntimeError("MAZZ_OUTPUT_REQUIRED")
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) != 1:
        raise RuntimeError("MAZZ_OUTPUT_REQUIRED")
    output_path = os.path.abspath(values[0])
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = output_path
    bpy.ops.render.render(write_still=True)
    print("MAZZ_BLENDER_OUTPUT=" + output_path)


if __name__ == "__main__":
    main()
