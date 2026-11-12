"""The march leader: a generated figure (Tripo, text-to-3D, T-pose) made game-ready.

  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/leader.py -- \
      --src "<the exported .glb>" --out frontend/public/models [--preview dir] [--triangles 8000] [--texture 1024]

The source model is not in the repository (17 MB, 400,000 triangles, 4K textures). It was generated on
studio.tripo3d.ai with the H2.5 generator from the prompt "tall sinister hooded leader, long black robes, deep hood"
and exported as GLB. This script:
  1. stands it 1.85 m tall on the ground, centred, facing +Z in three.js;
  2. bends the outstretched arms down to the sides (the model has no skeleton, so the vertices beyond each
     shoulder are rotated about the shoulder with a smooth falloff);
  3. decimates it and shrinks its textures;
  4. exports leader.glb WITH its own material and textures (unlike the bkit models, which the app re-materials).
The app loads it in frontend/src/personnel/March.tsx; the code-built figure there remains the fallback.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402

HEIGHT = 1.85
ARM_DOWN = math.radians(62)   # how far the arms swing down from the T-pose
SHOULDER = 0.21               # shoulder joint, metres from the centre line
FALLOFF = 0.14                # width of the blend from torso to arm


def main():
    a = bkit.args()
    src = os.path.abspath(a['src'])
    out = os.path.abspath(a.get('out', 'frontend/public/models'))
    tris = int(a.get('triangles', '8000'))
    tex = int(a.get('texture', '1024'))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in bpy.context.scene.objects:
        o.select_set(o.type == 'MESH')
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # the generator leaves stray fragments floating away from the figure: drop small pieces that sit off to the
    # front or back of the main body (the arms run sideways, so they are never caught by this)
    bpy.ops.mesh.separate(type='LOOSE')
    parts = sorted([o for o in bpy.context.scene.objects if o.type == 'MESH'], key=lambda o: -len(o.data.vertices))
    allco = np.array([o.matrix_world @ v.co for o in parts for v in o.data.vertices])
    mid_y = float(np.median(allco[:, 1]))
    tall = float(np.percentile(allco[:, 2], 99.5) - np.percentile(allco[:, 2], 0.5))
    total = len(allco)
    for o in parts[1:]:
        c = sum((v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)
        # Blender axes after import: X across, Y front-back, Z up; the robe is about 0.15 body heights deep
        if abs(c.y - mid_y) > 0.22 * tall and len(o.data.vertices) < 0.02 * total:
            print(f'[leader] dropped a stray fragment of {len(o.data.vertices)} vertices')
            bpy.data.objects.remove(o, do_unlink=True)
    parts = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in bpy.context.scene.objects:
        o.select_set(o.type == 'MESH')
    ob = parts[0]
    bpy.context.view_layer.objects.active = ob
    if len(parts) > 1:
        bpy.ops.object.join()
    me = ob.data

    # 1. stand it on the ground at the right height (Blender: X across, -Y front, Z up)
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    lo, hi = co.min(0), co.max(0)
    s = HEIGHT / (hi[2] - lo[2])
    co = (co - [float(np.median(co[:, 0])), float(np.median(co[:, 1])), lo[2]]) * s

    # the generator leaves the figure turned a little about the vertical: square it up so the arms run along X
    # (principal axis of the arm-height slice), taking the smaller turn so the face stays towards -Y
    band = co[(co[:, 2] > 0.68 * HEIGHT) & (co[:, 2] < 0.85 * HEIGHT)][:, :2]
    band = band - band.mean(0)
    vals, vecs = np.linalg.eigh(band.T @ band)
    ax = vecs[:, int(np.argmax(vals))]
    turn = -math.atan2(ax[1], ax[0])
    turn = (turn + math.pi / 2) % math.pi - math.pi / 2
    c, sn = math.cos(turn), math.sin(turn)
    co[:, 0], co[:, 1] = co[:, 0] * c - co[:, 1] * sn, co[:, 0] * sn + co[:, 1] * c
    co[:, 0] -= (co[:, 0].min() + co[:, 0].max()) / 2
    print(f'[leader] squared up by {math.degrees(turn):.1f} degrees')

    # 2. arms down: the arm is whatever lies beyond the shoulder; its height is where the far end of it is
    far =np.abs(co[:, 0]) > 0.8 * np.abs(co[:, 0]).max()
    zs = float(np.median(co[far, 2]))
    for side in (1, -1):
        x = co[:, 0] * side
        w = np.clip((x - SHOULDER) / FALLOFF, 0, 1)
        w = w * w * (3 - 2 * w)
        # arm and sleeve only: nothing below the bottom of the sleeve (the robe's hem flares out as wide as the arms)
        zcut = float(co[x > 0.5, 2].min()) - 0.1
        w *= np.clip((co[:, 2] - zcut) / 0.06, 0, 1)
        ang = w * ARM_DOWN
        dx, dz = x - SHOULDER, co[:, 2] - zs
        c, sn = np.cos(ang), np.sin(ang)
        nx = SHOULDER + dx * c + dz * sn
        nz = zs - dx * sn + dz * c
        m = w > 0
        co[m, 0] = nx[m] * side
        co[m, 2] = nz[m]
        hand = co[(x > 0.8 * x.max())]
        print(f'[leader] hand {"+" if side > 0 else "-"}x (blender xyz): {np.round(np.median(hand, 0), 3).tolist()}')
    co[:, 2] -= co[:, 2].min()
    me.vertices.foreach_set('co', co.ravel())
    me.update()

    # 3. reduce
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    mod = ob.modifiers.new('dec', 'DECIMATE')
    mod.ratio = min(1.0, tris / n)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in me.polygons:
        p.use_smooth = True
    for i in bpy.data.images:
        if i.size[0] > tex:
            i.scale(tex, tex)
    ob.name = me.name = 'leader'
    for o in list(bpy.context.scene.objects):
        if o != ob:
            bpy.data.objects.remove(o, do_unlink=True)
    print(f'[leader] {sum(len(p.vertices) - 2 for p in me.polygons)} triangles, size {tuple(round(v, 3) for v in ob.dimensions)}')

    # 4. export with its own material and textures
    os.makedirs(out, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'leader.glb'), export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85, export_yup=True)

    if a.get('preview'):
        sc = bpy.context.scene
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        sc.collection.objects.link(cam)
        sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
        sun.data.energy = 4
        sun.rotation_euler = (0.9, 0, 0.6)
        sc.collection.objects.link(sun)
        sc.world = bpy.data.worlds.new('w')
        sc.world.color = (0.5, 0.5, 0.55)
        sc.camera = cam
        for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
            try:
                sc.render.engine = e
                break
            except TypeError:
                pass
        sc.render.resolution_x, sc.render.resolution_y = 700, 900
        for name, pos in (('front', (0.4, -3.6, 1.3)), ('side', (3.4, -1.2, 1.3)), ('back', (-0.6, 3.6, 1.4))):
            cam.location = pos
            cam.rotation_euler = (Vector((0, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(os.path.abspath(a['preview']), f'leader_{name}.png')
            bpy.ops.render.render(write_still=True)
    print('[leader] done')


main()
