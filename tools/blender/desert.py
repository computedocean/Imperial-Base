"""Desert mesas: three flat-topped, terraced outcrops generated with the A.N.T. Landscape extension.

Needs the "A.N.T.Landscape" extension enabled in Blender's preferences, so run it WITHOUT --factory-startup:
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b -P tools/blender/desert.py -- --out frontend/public/models
It can also be run inside an open Blender (Scripting tab); there it leaves the rest of the scene alone.

Each mesa is a unit model (2 x 2 footprint, up to 0.5 high, Z up in Blender) that the app scales to size
(frontend/src/world/Desert.tsx). Like the other hero models it carries two UV sets: UV0 "tile" (cube projection
for the tiling cliff texture) and UV1 "lightmap" for its baked ambient occlusion (<name>_ao.jpg).

The boulders (rock_a/b/c.glb) and the cliff texture (cliff_diff.jpg, cliff_nor.jpg) are Poly Haven CC0 assets:
namaqualand_boulder_05, namaqualand_boulder_03, boulder_01 and marble_cliff_03 (https://polyhaven.com).
The boulders were decimated to 1,500 triangles, scaled to 1 m and exported with their colour and normal maps.
"""
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402

# name, seed, noise type, noise size, height of the flat top
SPECS = [('mesa_a', 11, 'slick_rock', 1.1, 0.42), ('mesa_b', 27, 'hetero_terrain', 0.9, 0.36), ('mesa_c', 53, 'shattered_hterrain', 1.3, 0.5)]
TRIANGLES = 5000
TILE = 0.3  # one repeat of the cliff texture per 0.3 units


def only(ob):
    for o in bpy.context.scene.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob


def build(name, seed, noise, nsize, top):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    bpy.ops.mesh.landscape_add(ant_terrain_name=name, at_cursor=False, smooth_mesh=True, tri_face=False, subdivision_x=96, subdivision_y=96,
                               mesh_size=2.0, mesh_size_x=2.0, mesh_size_y=2.0, random_seed=seed, noise_size=nsize, noise_type=noise, noise_depth=7,
                               height=0.9, height_offset=0.25, edge_falloff='3', falloff_x=3.0, falloff_y=3.0, edge_level=0.0, maximum=top, minimum=0.0,
                               strata=7.0, strata_type='2', refresh=True)
    ob = bpy.context.active_object
    ob.name = ob.data.name = name
    ob.location = (0, 0, 0)
    only(ob)
    # drop the flat apron around the foot (the desert floor covers it), then thin the mesh out
    bpy.ops.object.mode_set(mode='OBJECT')
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(v.co.z < 0.004 for v in f.verts)], context='FACES')
    bm.to_mesh(me)
    bm.free()
    me.update()
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    mod = ob.modifiers.new('dec', 'DECIMATE')
    mod.ratio = min(1.0, TRIANGLES / tris)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in me.polygons:
        p.use_smooth = True
    # UV0: cube projection for the tiling texture (strata run level round the cliffs); UV1: lightmap atlas
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='tile')
    me.uv_layers.new(name='lightmap')
    me.uv_layers.active = me.uv_layers['tile']
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=TILE, correct_aspect=False, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    me.materials.clear()
    me.materials.append(bpy.data.materials.get('cliff') or bpy.data.materials.new('cliff'))
    return ob


def main():
    a = bkit.args()
    out = os.path.abspath(a.get('out', 'frontend/public/models'))
    os.makedirs(out, exist_ok=True)
    if bpy.app.background:
        bkit.reset()
        import addon_utils
        addon_utils.enable('bl_ext.blender_org.antlandscape')
    for i, spec in enumerate(SPECS):
        ob = build(*spec)
        others = [o for o in bpy.context.scene.objects if o != ob and o.type == 'MESH' and not o.hide_render]
        for o in others:
            o.hide_render = True  # nothing else may shade the bake
        bkit.lightmap_unwrap(ob, margin=0.004)
        bkit.bake_ao(ob, os.path.join(out, ob.name + '_ao.jpg'), size=int(a.get('size', '1024')), samples=int(a.get('samples', '48')), distance=0.35, ground=True, wear=False)
        bkit.export_glb(ob, os.path.join(out, ob.name + '.glb'))
        for o in others:
            o.hide_render = False
        print(f'[desert] {ob.name}: {sum(len(p.vertices) - 2 for p in ob.data.polygons)} triangles')
        ob.location = (i * 2.6 - 2.6, 4, 0)  # lay them out for viewing; export was done at the origin
    print('[desert] done')


main()
