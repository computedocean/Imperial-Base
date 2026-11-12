"""Shared Blender geometry kit for Imperial Base hero models.

All primitives take THREE.JS coordinates (x right, y up, z towards the viewer / south) and metres,
so the numbers match src/world/layout.ts. They are converted to Blender (x, -z, y) internally; the
glTF exporter converts back to +Y-up, so the GLB lands in exactly the same place as the procedural kit.

Geometry accumulates in one bmesh with one material slot per MatKey name (hull, dark, black, windows,
red, amber, glass, concrete …). Three.js re-binds those names to its shared MAT materials, so the GLB
only carries geometry + two UV sets:
  * UV0 "tile"     — world-metre box projection (1 unit = 8 m) for the tiling panel textures
  * UV1 "lightmap" — non-overlapping atlas for the baked ambient-occlusion map
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

TILE = 8.0


def b(p):
    """three (x, y, z) -> blender Vector."""
    return Vector((p[0], -p[2], p[1]))


def chamfer_rect(w, d, c, cx=0.0, cz=0.0):
    """Octagonal outline (x, z) of a w×d rectangle with corners cut by c, counter-clockwise seen from above."""
    hw, hd = w / 2, d / 2
    c = min(c, hw * 0.95, hd * 0.95)
    pts = [(hw, -hd + c), (hw, hd - c), (hw - c, hd), (-hw + c, hd), (-hw, hd - c), (-hw, -hd + c), (-hw + c, -hd), (hw - c, -hd)]
    return [(cx + x, cz + z) for x, z in pts]


def rect(w, d, cx=0.0, cz=0.0):
    hw, hd = w / 2, d / 2
    return [(cx + hw, cz - hd), (cx + hw, cz + hd), (cx - hw, cz + hd), (cx - hw, cz - hd)]


class Model:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.tris = 0

    # ------------------------------------------------------------------ core
    def _mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _commit(self, tmp, mat, bevel=0.0, bevel_angle=30.0):
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        if bevel > 0:
            edges = [e for e in tmp.edges if e.is_manifold and e.calc_face_angle(0) > math.radians(bevel_angle)]
            if edges:
                bmesh.ops.bevel(tmp, geom=edges, offset=bevel, offset_type='OFFSET', segments=1, profile=0.5,
                                affect='EDGES', clamp_overlap=True)
        mi = self._mi(mat)
        vmap = {}
        for v in tmp.verts:
            vmap[v] = self.bm.verts.new(v.co)
        for f in tmp.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = mi
            nf.smooth = False
        tmp.free()

    def loft(self, mat, rings, cap=True, bevel=0.0):
        """rings: list of loops of three.js points (same count, same winding). Side quads + convex end caps."""
        tmp = bmesh.new()
        vr = [[tmp.verts.new(b(p)) for p in ring] for ring in rings]
        n = len(rings[0])
        for a, c in zip(vr[:-1], vr[1:]):
            for i in range(n):
                j = (i + 1) % n
                tmp.faces.new((a[i], a[j], c[j], c[i]))
        if cap:
            tmp.faces.new(vr[0])
            tmp.faces.new(list(reversed(vr[-1])))
        self._commit(tmp, mat, bevel)

    def prism(self, mat, outline_bottom, y0, h, outline_top=None, bevel=0.0):
        """Vertical loft between two (x, z) outlines at y0 and y0 + h."""
        top = outline_top or outline_bottom
        self.loft(mat, [[(x, y0, z) for x, z in outline_bottom], [(x, y0 + h, z) for x, z in top]], bevel=bevel)

    def box(self, mat, size, pos, rot_y=0.0, bevel=0.0):
        """Box with base at pos[1], centred on x/z (same convention as the TS Kit.box)."""
        w, h, d = size
        c, s = math.cos(rot_y), math.sin(rot_y)
        out = []
        for x, z in rect(w, d):
            out.append((pos[0] + x * c + z * s, pos[2] - x * s + z * c))
        self.prism(mat, out, pos[1], h, bevel=bevel)

    def taper(self, mat, bottom, top, h, pos, bevel=0.0):
        self.prism(mat, rect(*bottom, pos[0], pos[2]), pos[1], h, rect(*top, pos[0], pos[2]), bevel=bevel)

    def cyl(self, mat, r_top, r_bot, h, pos, seg=16, bevel=0.0):
        ring = lambda r: [(pos[0] + r * math.cos(2 * math.pi * i / seg), pos[2] + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        self.prism(mat, ring(r_bot), pos[1], h, ring(r_top), bevel=bevel)

    def beam(self, mat, p0, p1, w, d=None):
        """Square-section strut between two three.js points."""
        d = d or w
        a, c = Vector(p0), Vector(p1)
        axis = (c - a).normalized()
        up = Vector((0, 1, 0)) if abs(axis.y) < 0.95 else Vector((1, 0, 0))
        u = axis.cross(up).normalized() * (w / 2)
        v = axis.cross(u).normalized() * (d / 2)
        ring = lambda o: [tuple(o + u + v), tuple(o - u + v), tuple(o - u - v), tuple(o + u - v)]
        self.loft(mat, [ring(a), ring(c)])

    def dish(self, mat, r, depth, pos, tilt_x=0.0, rot_y=0.0, seg=16):
        """Shallow parabolic sensor dish (open bowl + rim), tilted around x then rotated around y."""
        tmp = bmesh.new()
        M = Matrix.Translation(b(pos)) @ Matrix.Rotation(rot_y, 4, 'Z') @ Matrix.Rotation(-tilt_x, 4, 'X')
        rings = []
        for k, t in enumerate((0.0, 0.5, 1.0)):
            rr = max(r * t, 0.05)
            zz = depth * t * t
            rings.append([tmp.verts.new(M @ Vector((rr * math.cos(2 * math.pi * i / seg), rr * math.sin(2 * math.pi * i / seg), zz))) for i in range(seg)])
        for a, c in zip(rings[:-1], rings[1:]):
            for i in range(seg):
                j = (i + 1) % seg
                tmp.faces.new((a[i], a[j], c[j], c[i]))
        tmp.faces.new(rings[0])
        self._commit(tmp, mat)

    def lathe_z(self, mat, cx, cy, profile, seg=24, bevel=0.0):
        """Solid of revolution about an axis parallel to Z through (cx, cy). profile: [(z, radius), ...]."""
        rings = [[(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg), z) for i in range(seg)]
                 for z, r in profile]
        if profile[0][0] > profile[-1][0]:
            rings.reverse()
        # loft() expects the first ring to face -axis; rings run towards +Z here
        self.loft(mat, [list(reversed(r)) for r in rings], bevel=bevel)

    def sphere(self, mat, r, pos, seg=20, rings=10, squash=1.0, half=None):
        """UV sphere centred on pos (three coords). half='top' / 'bottom' keeps one hemisphere (closed)."""
        lo, hi = (0, rings) if half is None else ((rings // 2, rings) if half == 'bottom' else (0, rings // 2))
        loops = []
        for k in range(lo, hi + 1):
            a = math.pi * k / rings  # 0 = top pole
            rr = max(r * math.sin(a), r * 0.02)
            y = pos[1] + r * math.cos(a) * squash
            loops.append([(pos[0] + rr * math.cos(2 * math.pi * i / seg), y, pos[2] + rr * math.sin(2 * math.pi * i / seg)) for i in range(seg)])
        self.loft(mat, list(reversed(loops)))

    def ring_xy(self, z, w, yb, yt, c):
        """Chamfered rectangular section in the XY plane at depth z (for lofting hulls along Z)."""
        h = w / 2
        c = min(c, h * 0.9, (yt - yb) * 0.45)
        pts = [(h - c, yb), (h, yb + c), (h, yt - c), (h - c, yt), (-h + c, yt), (-h, yt - c), (-h, yb + c), (-h + c, yb)]
        return [(x, y, z) for x, y in pts]

    def hull_z(self, mat, sections, bevel=0.0):
        """Loft along Z through chamfered sections [(z, width, y_bottom, y_top, chamfer), ...] in increasing z."""
        self.loft(mat, [list(reversed(self.ring_xy(*s))) for s in sections], bevel=bevel)

    # ------------------------------------------------------------------ finish
    def to_object(self):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts[:], dist=0.0005)
        self.bm.to_mesh(me)
        self.bm.free()
        me.update()
        for name in self.mats:
            m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        # UV0: world-metre box projection, matching the TS kit's 8 m tile
        uv0 = me.uv_layers.new(name='tile')
        for poly in me.polygons:
            n = poly.normal  # blender coords; three normal = (n.x, n.z, -n.y)
            ax, ay, az = abs(n.x), abs(n.z), abs(n.y)
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                x3, y3, z3 = co.x, co.z, -co.y
                if ay >= ax and ay >= az:
                    uv = (x3, z3)
                elif ax >= az:
                    uv = (z3, y3)
                else:
                    uv = (x3, y3)
                uv0.data[li].uv = (uv[0] / TILE, uv[1] / TILE)
        me.uv_layers.new(name='lightmap')
        self.tris = sum(len(p.vertices) - 2 for p in me.polygons)
        return ob


def lightmap_unwrap(ob, margin=0.003):
    me = ob.data
    me.uv_layers.active = me.uv_layers['lightmap']
    bpy.context.view_layer.objects.active = ob
    for o in list(bpy.context.scene.objects):
        o.select_set(o == ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    me.uv_layers.active = me.uv_layers['tile']


def bake_ao(ob, out_path, size=2048, samples=64, distance=6.0, ground=True, blur=1):
    """Bake ambient occlusion (Cycles, CPU) into the lightmap UV and save it as JPEG."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    if scene.world is None:
        scene.world = bpy.data.worlds.new('World')
    scene.world.light_settings.distance = distance
    gp = None
    if ground:
        bpy.ops.mesh.primitive_plane_add(size=2000, location=(0, 0, -0.02))
        gp = bpy.context.active_object
    img = bpy.data.images.new(ob.name + '_ao', size, size, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    for m in ob.data.materials:
        m.use_nodes = True
        nt = m.node_tree
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = img
        uvn = nt.nodes.new('ShaderNodeUVMap')
        uvn.uv_map = 'lightmap'
        nt.links.new(uvn.outputs['UV'], node.inputs['Vector'])
        for n in nt.nodes:
            n.select = False
        node.select = True
        nt.nodes.active = node
    for o in list(bpy.context.scene.objects):
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    ob.data.uv_layers.active = ob.data.uv_layers['lightmap']
    bpy.ops.object.bake(type='AO', margin=6, margin_type='EXTEND', use_clear=True, uv_layer='lightmap')
    ob.data.uv_layers.active = ob.data.uv_layers['tile']
    if blur:
        import numpy as np
        px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
        a = px[:, :, 0]
        for _ in range(blur):
            a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
        # lift the floor slightly so crevices stay readable rather than black
        a = 0.26 + 0.74 * np.clip(a, 0, 1)
        px[:, :, 0] = px[:, :, 1] = px[:, :, 2] = a
        img.pixels[:] = px.ravel()
    scene.view_settings.view_transform = 'Standard'
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 88
    scene.render.image_settings.color_mode = 'BW'
    img.save_render(out_path, scene=scene)
    if gp:
        bpy.data.objects.remove(gp, do_unlink=True)
    # remove bake nodes so the exporter writes plain materials
    for m in ob.data.materials:
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type in ('TEX_IMAGE', 'UVMAP'):
                nt.nodes.remove(n)
    return img


def export_glb(ob, path):
    for o in list(bpy.context.scene.objects):
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_texcoords=True,
                              export_normals=True, export_materials='EXPORT', export_image_format='NONE',
                              export_apply=True, export_yup=True)


PREVIEW_COLORS = {
    'hull': (0.62, 0.64, 0.67), 'dark': (0.42, 0.44, 0.47), 'light': (0.75, 0.76, 0.78), 'black': (0.03, 0.035, 0.04),
    'concrete': (0.46, 0.42, 0.37), 'glass': (0.02, 0.035, 0.05), 'stripe': (0.6, 0.45, 0.12),
}
EMISSIVE = {'windows': ((1.0, 0.78, 0.5), 6.0), 'red': ((1.0, 0.12, 0.06), 40.0), 'amber': ((1.0, 0.55, 0.12), 30.0),
            'whiteLight': ((0.9, 0.95, 1.0), 25.0), 'holo': ((0.3, 0.7, 1.0), 15.0)}


def preview(ob, ao_img, out_png, cam_loc, cam_target, res=(1280, 720), lens=35, ground=True, clip_end=5000):
    """Quick Eevee beauty render of the model (AO multiplied into a flat albedo) for review.
    ground=False leaves out the ground plane (for ships, which are modelled around their own centre)."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    for m in ob.data.materials:
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        nt.links.new(bsdf.outputs[0], out.inputs[0])
        if m.name in EMISSIVE:
            col, s = EMISSIVE[m.name]
            bsdf.inputs['Base Color'].default_value = (0.02, 0.02, 0.02, 1)
            bsdf.inputs['Emission Color'].default_value = (*col, 1)
            bsdf.inputs['Emission Strength'].default_value = s
            continue
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = ao_img
        uvn = nt.nodes.new('ShaderNodeUVMap')
        uvn.uv_map = 'lightmap'
        nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        mul.inputs[6].default_value = (*PREVIEW_COLORS.get(m.name, (0.5, 0.5, 0.5)), 1)
        nt.links.new(tex.outputs['Color'], mul.inputs[7])
        nt.links.new(mul.outputs[2], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.55
        bsdf.inputs['Metallic'].default_value = 0.25 if m.name != 'glass' else 0.9
    # sun + sky
    sun_d = bpy.data.lights.new('sun', 'SUN')
    sun_d.energy = 4.0
    sun_d.angle = math.radians(2)
    sun = bpy.data.objects.new('sun', sun_d)
    sun.rotation_euler = (math.radians(52), 0, math.radians(35))
    scene.collection.objects.link(sun)
    w = scene.world
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.55, 0.45, 0.36, 1)
    bg.inputs[1].default_value = 0.6
    if ground:
        bpy.ops.mesh.primitive_plane_add(size=3000, location=(0, 0, -0.03))
        gp = bpy.context.active_object
        gm = bpy.data.materials.new('ground_prev')
        gm.use_nodes = True
        gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.24, 0.17, 1)
        gp.data.materials.append(gm)
    cam_d = bpy.data.cameras.new('cam')
    cam_d.lens = lens
    cam_d.clip_end = clip_end
    cam = bpy.data.objects.new('cam', cam_d)
    cam.location = b(cam_loc)
    direction = b(cam_target) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = out_png
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    bpy.ops.render.render(write_still=True)


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = {}
    for i in range(0, len(argv) - 1, 2):
        out[argv[i].lstrip('-')] = argv[i + 1]
    return out


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
