"""Mazz-owned, fixed-mode Blender capability script.

The caller supplies only one of the adapter-owned modes after ``--`` and a
staged output path.  No user-provided Python, command, environment or
additional Blender flags are evaluated here.
"""

import json
import os
import sys

import bpy


def fail(message):
    sys.stderr.write(message + "\n")
    raise SystemExit(2)


def arguments():
    try:
        separator = sys.argv.index("--")
        values = sys.argv[separator + 1:]
    except ValueError:
        fail("MAZZ_ARGUMENT_SEPARATOR_MISSING")
    if len(values) == 1:
        return "render", values[0]
    if len(values) != 2:
        fail("MAZZ_ARGUMENT_CONTRACT_INVALID")
    mode, output = values
    if mode not in ("inspect", "export-obj"):
        fail("MAZZ_MODE_NOT_ALLOWED")
    if not os.path.isabs(output):
        fail("MAZZ_OUTPUT_MUST_BE_ABSOLUTE")
    return mode, output


def inspect_scene(output):
    scene = bpy.context.scene
    payload = {
        "schema": "mazz.blender-inspection/v1",
        "scene": scene.name,
        "frame": int(scene.frame_current),
        "frameStart": int(scene.frame_start),
        "frameEnd": int(scene.frame_end),
        "engine": str(scene.render.engine),
        "objects": [
            {"name": obj.name, "type": obj.type}
            for obj in sorted(bpy.data.objects, key=lambda item: item.name)
        ],
    }
    with open(output, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        handle.write("\n")


def export_obj(output):
    # Blender 4.3+ exposes the OBJ exporter under bpy.ops.wm.obj_export.
    # The adapter's supported-version matrix keeps this operation explicit.
    result = bpy.ops.wm.obj_export(filepath=output, export_materials=False)
    if "FINISHED" not in result:
        fail("MAZZ_OBJ_EXPORT_FAILED")


def render_frame(output):
    bpy.context.scene.render.filepath = output
    result = bpy.ops.render.render(write_still=True)
    if "FINISHED" not in result:
        fail("MAZZ_RENDER_FAILED")


def main():
    mode, output = arguments()
    os.makedirs(os.path.dirname(output), exist_ok=True)
    if mode == "render":
        render_frame(output)
    elif mode == "inspect":
        inspect_scene(output)
    else:
        export_obj(output)
    sys.stdout.write("MAZZ_BLENDER_CAPABILITY_COMPLETE\n")


main()
