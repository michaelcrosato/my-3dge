# /// script
# requires-python = "==3.11.*"
# dependencies = ["bpy==4.5.14"]
# ///
"""Convert an animation library to glTF binary (.glb), the one format `node x anim import` reads (tools/anim/import.ts):
the armature, its skinned mesh (if any) and every action as its own animation. Copied from my-3d2dge:tools/to-glb.py
(PLAN.md WP 8.5): optional, never run by the tests, with Blender's Python module pinned (bpy 4.5.14, the newest of the
4.5 LTS line, the newest line at least 12 months old; it needs Python 3.11).
  .blend  a Blender project (Quaternius' Universal Animation Library 2 [Source], Mesh2Motion's assets)
  .fbx    FBX (most asset-store packs; the CMU motion-capture conversions)
  .bvh    BioVision motion capture (CMU, 100STYLE): a skeleton and one motion, no mesh

Needs Blender's Python module (no Blender install, no display); uv reads the pin above:
    uv run tools/anim/to-glb.py library.blend .cache/anim/src/library.glb [--deform-only] [--list]
or in a virtual environment:
    python3.11 -m venv .cache/bpyenv && .cache/bpyenv/bin/pip install bpy==4.5.14
    .cache/bpyenv/bin/python tools/anim/to-glb.py library.fbx .cache/anim/src/library.glb
or with a Blender install:
    blender -b --python tools/anim/to-glb.py -- library.fbx library.glb

--deform-only  exports only the bones that move the mesh (a Rigify rig's DEF- bones, without its controls)
--list         prints the armatures, meshes and actions it finds, and writes nothing
"""
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
flags = {a for a in argv if a.startswith('--')}
paths = [a for a in argv if not a.startswith('--')]
if len(paths) < 1 or (len(paths) < 2 and '--list' not in flags):
    print(__doc__)
    sys.exit(2)
src, kind = paths[0], paths[0].lower().rsplit('.', 1)[-1]
if kind == 'blend':
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if kind == 'fbx':
        bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=False)
    elif kind == 'bvh':
        bpy.ops.import_anim.bvh(filepath=src, update_scene_fps=True, update_scene_duration=True)
    elif kind in ('glb', 'gltf'):
        bpy.ops.import_scene.gltf(filepath=src)
    else:
        sys.exit('unknown file type: ' + src)

arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
actions = sorted(bpy.data.actions, key=lambda a: a.name)
print(f'{src}: {len(arms)} armature(s) {[a.name for a in arms]}, {len(meshes)} skinned mesh(es), {len(actions)} action(s)')
for a in actions:
    lo, hi = a.frame_range
    print(f'  {a.name}: frames {lo:g}-{hi:g}')
if '--list' in flags:
    sys.exit(0)
if not arms:
    sys.exit('no armature in ' + src)

# every action becomes one animation; the exporter samples each one on the armature it was made for
for o in bpy.data.objects:
    o.hide_set(False)
    o.hide_viewport = False
bpy.ops.export_scene.gltf(
    filepath=paths[1], export_format='GLB',
    export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_step=1,
    export_skins=True, export_def_bones='--deform-only' in flags, export_morph=False,
    export_draco_mesh_compression_enable=False, export_apply=False, export_yup=True,
    export_materials='EXPORT', export_image_format='NONE')
print('wrote', paths[1])
