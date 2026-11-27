"""The march leader, rebuilt with arms and legs: a rigged, walking hooded knight (original design).

  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/knight.py -- \
      --src tools/blender/assets/animated_human_cc0.glb --out frontend/public/models [--preview dir]

Source body: "Animated Human" by Quaternius (CC0 1.0, https://poly.pizza/m/c3Ibh9I3udk), saved in
tools/blender/assets/ already turned to face -Y and scaled to 1.85 m. It brings a humanoid skeleton and Walk/Idle
animations. This script dresses it: a fitted tunic split at the front below the belt so the legs show when he walks,
flared sleeves, a deep hood that shadows the face, a long cloak that hangs behind the arms, a belt with sash tails,
boots, gloves and a dark undersuit painted onto the body, and a saber hilt bound to the right hand. Every garment is
weighted to the skeleton, so it moves with the walk. The blade itself is drawn by the app (March.tsx) at the
`BladeMount` empty, so it can ignite and glow.

Exports knight.glb (skinned, animations Walk and Idle only, own materials) into --out.
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

PREFIX = 'KN_'
HEIGHT = 1.85
KEEP_ACTIONS = ('Walk', 'WalkSaber')
# The right arm while the blade is lit: elbow bent forward 45 degrees from the walk's arm-down frame, wrist turned
# so the blade points forward and down past his right side, direction (-0.35, -0.55, -0.76) in Blender. Worked out
# against this rig and build_hilt()'s grip by rotating the wrist onto that direction.
SABER_HOLD = {
    'RightArm': (0.9107, 0.3865, 0.067, 0.1299),
    'RightForeArm': (0.8295, 0.1894, -0.0384, -0.5239),
    'RightHand': (0.5506, -0.1944, -0.0122, 0.8118),
}


# ---------------------------------------------------------------------------------------------- arguments
def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = {}
    for i, tok in enumerate(argv):
        if tok.startswith('--'):
            nxt = argv[i + 1] if i + 1 < len(argv) else None
            out[tok[2:]] = nxt if nxt is not None and not nxt.startswith('--') else '1'
    return out


# ---------------------------------------------------------------------------------------------- rig
def find_rig():
    for o in bpy.data.objects:
        if o.type == 'MESH' and not o.name.startswith(PREFIX):
            mod = next((m for m in o.modifiers if m.type == 'ARMATURE' and m.object), None)
            if mod:
                root = mod.object
                while root.parent:
                    root = root.parent
                return root, mod.object, o
    raise RuntimeError('no skinned body found')


def body_points(body, density=6):
    """World-space points over the body's whole surface (corners and a grid inside every triangle), so a thin
    horizontal slice always finds the body even though the mesh is low-poly."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    mw = ev.matrix_world
    co = [mw @ v.co for v in me.vertices]
    pts = list(co)
    n = density
    for tri in me.loop_triangles:
        a, b, c = (co[i] for i in tri.vertices)
        for i in range(n + 1):
            for k in range(n + 1 - i):
                u, v = i / n, k / n
                pts.append(a + (b - a) * u + (c - a) * v)
    ev.to_mesh_clear()
    return pts


def normalize(root, arm, body):
    """Rest pose, facing -Y, 1.85 m tall, feet on the ground, centred. Safe to run again."""
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    mw = arm.matrix_world
    toe = mw @ arm.data.bones['LeftToeBase'].head_local
    foot = mw @ arm.data.bones['LeftFoot'].head_local
    fwd = (toe - foot)
    yaw = math.atan2(fwd.x, -fwd.y)  # angle from -Y
    root.rotation_mode = 'XYZ'
    root.rotation_euler.z -= yaw
    bpy.context.view_layer.update()
    pts = body_points(body)
    lo = min(p.z for p in pts)
    hi = max(p.z for p in pts)
    root.scale *= HEIGHT / (hi - lo)
    bpy.context.view_layer.update()
    pts = body_points(body)
    root.location.z -= min(p.z for p in pts)
    root.location.x -= (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    bpy.context.view_layer.update()
    hips = arm.matrix_world @ arm.data.bones['Hips'].head_local
    root.location.y -= hips.y
    bpy.context.view_layer.update()


def walk_forward(arm):
    """His facing direction while walking, averaged over the cycle (the Walk action turns the hips, so the rest pose
    can face elsewhere). Forward = (left hip - right hip) x up."""
    sc = bpy.context.scene
    walk = next(a for a in bpy.data.actions if a.name.endswith('Walk'))
    ad = arm.animation_data
    ad.action = walk
    if hasattr(ad, 'action_slot') and walk.slots:
        ad.action_slot = walk.slots[0]
    arm.data.pose_position = 'POSE'
    f0, f1 = (int(x) for x in walk.frame_range)
    acc = Vector((0, 0, 0))
    for f in range(f0, f1 + 1, 2):
        sc.frame_set(f)
        mw = arm.matrix_world
        left = mw @ arm.pose.bones['LeftUpLeg'].head - mw @ arm.pose.bones['RightUpLeg'].head
        acc += left.cross(Vector((0, 0, 1)))
    sc.frame_set(f0)
    acc.z = 0
    return acc.normalized()


def face_walk_forward(root, arm):
    """Turn the whole rig so he walks towards -Y in Blender (+Z in three.js), then centre him again."""
    fwd = walk_forward(arm)
    yaw = math.atan2(fwd.x, -fwd.y)
    root.rotation_euler.z -= yaw
    bpy.context.view_layer.update()
    fwd2 = walk_forward(arm)
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    hips = arm.matrix_world @ arm.data.bones['Hips'].head_local
    root.location.x -= hips.x
    root.location.y -= hips.y
    bpy.context.view_layer.update()
    return math.degrees(yaw), fwd2


def joints(arm):
    mw = arm.matrix_world
    return {b.name: mw @ b.head_local for b in arm.data.bones}


# ---------------------------------------------------------------------------------------------- measuring
class Section:
    def __init__(self, cx, cy, rx, ryf, ryb):
        self.cx, self.cy, self.rx, self.ryf, self.ryb = cx, cy, rx, ryf, ryb


def section(pts, z, band=0.03, xlim=0.4):
    sel = [p for p in pts if abs(p.z - z) < band and abs(p.x) < xlim]
    if len(sel) < 3:
        return None
    cx = 0.0
    ys = [p.y for p in sel]
    cy = (min(ys) + max(ys)) / 2
    rx = max(abs(p.x - cx) for p in sel)
    return Section(cx, cy, rx, cy - min(ys), max(ys) - cy)


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------------------------- building
def ring(cx, cy, rx, ryf, ryb, z, phis, fold=0.0, seed=0.0, nfold=9):
    out = []
    for p in phis:
        s, c = math.sin(p), math.cos(p)
        ry = ryf * (1 + c) / 2 + ryb * (1 - c) / 2
        f = 1 + fold * math.sin(p * nfold + seed) * (0.65 + 0.35 * math.sin(p * 4 + 1.3 + seed))
        out.append(Vector((cx + s * rx * f, cy - c * ry * f, z)))
    return out


def arc(gap, n, around_back=True):
    """n angles (from the front, -Y) covering everything except a gap centred on the front."""
    a0 = gap / 2
    a1 = 2 * math.pi - gap / 2
    return [lerp(a0, a1, i / (n - 1)) for i in range(n)]


def collection():
    col = bpy.data.collections.get(PREFIX + 'knight')
    if not col:
        col = bpy.data.collections.new(PREFIX + 'knight')
        bpy.context.scene.collection.children.link(col)
    return col


def loft(name, rings, closed=False):
    """Quad surface through a list of rings of equal length (points in world space)."""
    me = bpy.data.meshes.new(PREFIX + name)
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    m = len(rings[0])
    for i in range(len(rings) - 1):
        for j in range(m if closed else m - 1):
            k = (j + 1) % m
            bm.faces.new((vs[i][j], vs[i][k], vs[i + 1][k], vs[i + 1][j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(PREFIX + name, me)
    collection().objects.link(ob)
    return ob


def tube(name, path, radii, seg=18):
    """A tube along a polyline, radius per path point (used for sleeves)."""
    rings = []
    for i, p in enumerate(path):
        d = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((0, 1, 0))
        u = d.cross(up).normalized()
        v = u.cross(d).normalized()
        rings.append([p + (math.cos(a) * u + math.sin(a) * v) * radii[i] for a in (2 * math.pi * k / seg for k in range(seg))])
    return loft(name, rings, closed=True)


def outward(ob, axis_y=0.0):
    """Make every face normal point away from the body's vertical axis."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    inward = 0
    for f in bm.faces:
        c = f.calc_center_median()
        radial = Vector((c.x, c.y - axis_y, 0))
        if f.normal.dot(radial) < 0:
            inward += 1
    if inward > len(bm.faces) / 2:
        for f in bm.faces:
            f.normal_flip()
    bm.to_mesh(me)
    bm.free()


def material(name, color, rough=0.85, metal=0.0, sheen=0.0, emit=None):
    m = bpy.data.materials.get(PREFIX + name) or bpy.data.materials.new(PREFIX + name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    rgb = tuple(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    lin = tuple((c / 12.92) if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)
    bsdf.inputs['Base Color'].default_value = (*lin, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    # no sheen by default: three.js reads Blender's white default sheen tint as a strong pale glaze on dark cloth
    if 'Sheen Weight' in bsdf.inputs:
        bsdf.inputs['Sheen Weight'].default_value = sheen
        bsdf.inputs['Sheen Roughness'].default_value = 0.6
    if emit and 'Emission Color' in bsdf.inputs:
        e = tuple(int(emit[i:i + 2], 16) / 255 for i in (1, 3, 5))
        bsdf.inputs['Emission Color'].default_value = (*e, 1)
        bsdf.inputs['Emission Strength'].default_value = 2.0
    m.diffuse_color = (*lin, 1)
    return m


def finish(ob, arm, weights, mats, thickness=0.0):
    """Materials, weights, thickness, smooth shading, then bind to the skeleton."""
    for m in mats:
        ob.data.materials.append(m)
    groups = {}
    for vi, wd in enumerate(weights):
        for bone, w in wd.items():
            if w <= 1e-4:
                continue
            g = groups.get(bone) or ob.vertex_groups.new(name=bone)
            groups[bone] = g
            g.add([vi], w, 'REPLACE')
    for p in ob.data.polygons:
        p.use_smooth = True
    if thickness:
        mod = ob.modifiers.new('thickness', 'SOLIDIFY')
        mod.thickness = thickness
        mod.offset = -1
        mod.use_rim = True
        mod.use_even_offset = True
        mod.material_offset = 1 if len(mats) > 1 else 0
        mod.material_offset_rim = 1 if len(mats) > 1 else 0
    ob.parent = arm
    ob.matrix_parent_inverse = arm.matrix_world.inverted()
    am = ob.modifiers.new('skeleton', 'ARMATURE')
    am.object = arm


def blend(*pairs):
    out = {}
    tot = sum(w for _, w in pairs)
    for b, w in pairs:
        out[b] = out.get(b, 0) + w / tot
    return out


def side_legs(x, amount):
    """Split a leg influence between the two thighs by the vertex's side."""
    left = smooth(-0.08, 0.08, x)
    return [('LeftUpLeg', amount * left), ('RightUpLeg', amount * (1 - left))]


def torso_bones(z, j):
    """Spine weights by height, from the skeleton's own joint heights."""
    hz, sz, s1, s2, nz = (j[n].z for n in ('Hips', 'Spine', 'Spine1', 'Spine2', 'Neck'))
    if z <= sz:
        t = smooth(hz, sz, z)
        return [('Hips', 1 - t), ('Spine', t)]
    if z <= s1:
        t = smooth(sz, s1, z)
        return [('Spine', 1 - t), ('Spine1', t)]
    if z <= s2:
        t = smooth(s1, s2, z)
        return [('Spine1', 1 - t), ('Spine2', t)]
    t = smooth(s2, nz, z)
    return [('Spine2', 1 - t * 0.5), ('Neck', t * 0.5)]


# ---------------------------------------------------------------------------------------------- garments
def build_tunic(pts, j, arm, M):
    hips = section(pts, j['Hips'].z - 0.04, 0.04, 0.4)
    zs = [lerp(0.42, 0.86, i / 13) for i in range(14)] + [lerp(0.90, 1.38, i / 12) for i in range(13)] + [1.42, 1.455, 1.48, 1.50]
    N = 44
    rings = []
    for z in zs:
        if z < 0.88:
            t = (0.88 - z) / (0.88 - 0.42)
            s = hips
            rx, ryf, ryb = s.rx + 0.035 + 0.11 * t, s.ryf + 0.03 + 0.07 * t, s.ryb + 0.035 + 0.08 * t
            gap = 0.12 + 1.0 * t ** 1.2
            fold = 0.055 * t
            cy = s.cy
        else:
            xl = 0.26 if z > 1.25 else 0.40
            if z > 1.465:
                xl = 0.13
            s = section(pts, z, 0.025, xl) or hips
            pad = 0.028 if z < 1.40 else 0.022
            rx, ryf, ryb = s.rx + pad, s.ryf + pad, s.ryb + pad
            if 1.44 < z < 1.475:  # shoulder tops round off towards the collar
                rx = lerp(rx, 0.14, smooth(1.44, 1.475, z))
            gap = 0.55 * smooth(1.36, 1.50, z)  # a shallow V at the collar
            fold = 0.0
            cy = s.cy
        rings.append(ring(0.0, cy, rx, ryf, ryb, z, arc(gap, N), fold, 0.7))
    ob = loft('tunic', rings)
    outward(ob)
    W = []
    for v in ob.data.vertices:
        z, x = v.co.z, v.co.x
        if z < 0.92:
            t = smooth(0.92, 0.45, z)
            front = max(0.0, -(v.co.y - hips.cy)) / max(0.01, hips.ryf + 0.1)
            leg = t * (0.30 + 0.45 * min(1.0, front))
            W.append(blend(('Hips', 1 - leg), *side_legs(x, leg)))
        else:
            pairs = torso_bones(z, j)
            if z > 1.36 and abs(x) > 0.12:
                sh = 'LeftShoulder' if x > 0 else 'RightShoulder'
                pairs.append((sh, 0.6 * smooth(0.12, 0.22, abs(x))))
            W.append(blend(*pairs))
    finish(ob, arm, W, [M['tunic'], M['tunic_in']], 0.006)
    return ob


def build_sleeves(j, arm, M):
    obs = []
    for side, s in (('Left', 1), ('Right', -1)):
        A = j[side + 'Arm'].copy()
        A.x -= s * 0.05
        E = j[side + 'ForeArm']
        Wr = j[side + 'Hand']
        path, radii, part = [], [], []
        for i in range(8):
            t = i / 7
            path.append(A.lerp(E, t)); radii.append(lerp(0.088, 0.066, t)); part.append(t * 0.5)
        for i in range(1, 9):
            t = i / 8
            path.append(E.lerp(Wr, t)); radii.append(lerp(0.066, 0.10, t ** 1.6)); part.append(0.5 + t * 0.5)
        ob = tube(side.lower() + '_sleeve', path, radii)
        W = []
        seg = 18
        for vi, v in enumerate(ob.data.vertices):
            k = vi // seg
            u = part[min(k, len(part) - 1)]
            if u < 0.5:
                a = smooth(0.38, 0.5, u)
                pairs = [(side + 'Arm', 1 - a * 0.5), (side + 'ForeArm', a * 0.5)]
                if u < 0.12:
                    pairs.append((side + 'Shoulder', 0.5 * (1 - u / 0.12)))
            else:
                a = smooth(0.5, 0.62, u)
                pairs = [(side + 'Arm', 0.5 * (1 - a)), (side + 'ForeArm', 0.5 + 0.5 * a)]
            W.append(blend(*pairs))
        finish(ob, arm, W, [M['tunic'], M['tunic_in']], 0.005)
        obs.append(ob)
    return obs


def build_hood(pts, j, arm, M):
    head = j['Head']
    top = j['HeadTop_End'].z if 'HeadTop_End' in j else HEIGHT
    z0 = top - 0.19          # where the dome starts: about eye level
    peak = top + 0.085       # the hood stands clear of the skull
    zs = [lerp(1.44, z0 - 0.02, i / 6) for i in range(7)] + [lerp(z0, peak, (i / 15) ** 0.8) for i in range(16)]
    N = 44
    hs = section(pts, z0, 0.03, 0.15)
    rings = []
    for z in zs:
        if z < z0:
            s = section(pts, z, 0.025, 0.15 if z > 1.55 else 0.20) or hs
            rx = s.rx + (0.075 if z > 1.52 else 0.055)
            ryb = s.ryb + 0.12
            ryf = s.ryf + 0.075
            cy = s.cy
        else:
            # an ellipsoid dome: rounded, roomy at the back, never pinched to a point
            k = (z - z0) / (peak - z0)
            d = math.sqrt(max(0.0, 1 - k * k))
            rx = (hs.rx + 0.085) * d
            ryb = (hs.ryb + 0.13) * d
            ryf = (hs.ryf + 0.085) * d
            cy = hs.cy + 0.015 * k
        if z < 1.52:
            gap = 1.75
        elif z < z0 + 0.09:
            gap = lerp(1.75, 0.95, smooth(1.52, 1.60, z))
        else:
            gap = lerp(0.95, 0.0, smooth(z0 + 0.09, z0 + 0.19, z))
        phis = arc(gap, N)
        r = ring(0.0, cy + 0.01, max(rx, 0.004), max(ryf, 0.004), max(ryb, 0.004), z, phis, 0.012, 2.1, 6)
        # the brim juts forward over the face and droops, so the eyes sit in shadow
        brim = smooth(z0 - 0.02, z0 + 0.12, z) * (1 - smooth(z0 + 0.16, z0 + 0.22, z))
        for i, p in enumerate(r):
            frontness = max(0.0, math.cos(phis[i])) ** 1.5
            p.y -= 0.075 * brim * frontness
            p.z -= 0.035 * brim * frontness
        rings.append(r)
    ob = loft('hood', rings)
    outward(ob, head.y)
    W = []
    for v in ob.data.vertices:
        z = v.co.z
        t = smooth(1.50, 1.64, z)
        W.append(blend(('Head', 0.85 * t), ('Neck', 0.15 + 0.5 * (1 - t)), ('Spine2', 0.4 * (1 - t))))
    finish(ob, arm, W, [M['cloak'], M['hood_in']], 0.008)
    return ob


def build_cloak(pts, j, arm, M):
    zs = [1.505, 1.49, 1.47, 1.45, 1.42] + [lerp(1.38, 0.07, i / 34) for i in range(35)]
    N = 46
    rings = []
    chest = section(pts, 1.30, 0.03, 0.26)
    for z in zs:
        t = smooth(1.38, 0.07, z)
        if z > 1.40:
            s = section(pts, z, 0.02, 0.13 if z > 1.47 else 0.26)
            rx = s.rx + (0.075 if z > 1.47 else 0.055)
            ryf, ryb, cy = s.ryf + 0.06, s.ryb + 0.055, s.cy
        else:
            s = section(pts, max(z, 1.02), 0.03, 0.26) or chest
            rx = max(0.30, s.rx + 0.06) + 0.09 * t
            ryf = s.ryf + 0.07
            ryb = s.ryb + 0.06 + 0.13 * t
            cy = s.cy
        phi0 = lerp(0.55, 1.42, smooth(1.505, 1.20, z))  # wraps the shoulders at the top, behind the arms below
        phis = [lerp(phi0, 2 * math.pi - phi0, i / (N - 1)) for i in range(N)]
        rings.append(ring(0.0, cy, rx, ryf, ryb, z, phis, 0.045 * t, 0.4, 7))
    ob = loft('cloak', rings)
    outward(ob)
    W = []
    for v in ob.data.vertices:
        z, x = v.co.z, v.co.x
        if z > 1.36:
            pairs = [('Spine2', 0.6), ('Neck', 0.4 * smooth(1.40, 1.50, z) + 0.05)]
            if abs(x) > 0.12:
                pairs.append(('LeftShoulder' if x > 0 else 'RightShoulder', 0.7 * smooth(0.12, 0.25, abs(x))))
        elif z > 0.95:
            pairs = torso_bones(z, j)
        else:
            sway = 0.28 * smooth(0.95, 0.15, z)
            pairs = [('Hips', 1 - sway), *side_legs(x, sway)]
        W.append(blend(*pairs))
    finish(ob, arm, W, [M['cloak'], M['cloak_in']], 0.009)
    return ob


def build_belt(pts, j, arm, M):
    z0 = j['Hips'].z + 0.035
    s = section(pts, z0, 0.03, 0.4)
    rings = [ring(0.0, s.cy, s.rx + 0.04, s.ryf + 0.04, s.ryb + 0.04, z, arc(0.0, 44)) for z in (z0 - 0.035, z0 + 0.035)]
    belt = loft('belt', rings, closed=True)
    outward(belt)
    W = [blend(('Hips', 0.7), ('Spine', 0.3)) for _ in belt.data.vertices]
    finish(belt, arm, W, [M['leather']], 0.01)
    # buckle: a small plate at the front
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, s.cy - s.ryf - 0.052, z0))
    bk = bpy.context.active_object
    bk.name = PREFIX + 'buckle'
    bk.data.name = PREFIX + 'buckle'
    bk.scale = (0.07, 0.012, 0.058)
    bpy.ops.object.transform_apply(scale=True)
    for c in bk.users_collection:
        c.objects.unlink(bk)
    collection().objects.link(bk)
    finish(bk, arm, [blend(('Hips', 1.0)) for _ in bk.data.vertices], [M['metal']])
    # two sash tails hanging in front of the split skirt
    obs = [belt, bk]
    for sx in (-0.05, 0.05):
        rs = []
        for i in range(10):
            zz = lerp(z0 - 0.03, z0 - 0.42, i / 9)
            y = s.cy - s.ryf - 0.055 - 0.02 * (i / 9)
            w = lerp(0.028, 0.034, i / 9)
            rs.append([Vector((sx - w, y, zz)), Vector((sx + w, y, zz))])
        tail = loft('sash_' + ('l' if sx > 0 else 'r'), rs)
        Wt = []
        for v in tail.data.vertices:
            k = smooth(z0, z0 - 0.42, v.co.z) * 0.45
            Wt.append(blend(('Hips', 1 - k), *side_legs(sx * 4, k)))
        finish(tail, arm, Wt, [M['sash'], M['sash']], 0.004)
        obs.append(tail)
    return obs


def build_hilt(j, arm, M):
    """Saber hilt in the right hand: emitter shroud, ridged grip, pommel. BladeMount marks the emitter."""
    hand = j['RightHand']
    parts = []
    def cyl(r, d, z, name):
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=r, depth=d, location=(0, 0, z))
        o = bpy.context.active_object
        o.name = name
        parts.append(o)
        return o
    cyl(0.017, 0.035, -0.115, 'pommel')
    cyl(0.020, 0.012, -0.093, 'pommel_ring')
    for k in range(6):
        cyl(0.0175, 0.010, -0.075 + k * 0.022, 'ridge%d' % k)
    cyl(0.0155, 0.15, -0.02, 'grip')
    cyl(0.021, 0.05, 0.075, 'shroud')
    cyl(0.024, 0.008, 0.103, 'emitter_lip')
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    h = bpy.context.active_object
    h.name = PREFIX + 'hilt'
    h.data.name = PREFIX + 'hilt'
    for c in h.users_collection:
        c.objects.unlink(h)
    collection().objects.link(h)
    h.data.materials.append(M['hilt'])
    for p in h.data.polygons:
        p.use_smooth = True
    # held in the fist: the grip runs across the palm, blade pointing forward from the thumb side
    h.rotation_euler = (math.radians(90), 0, 0)
    h.location = hand + Vector((-0.07, -0.015, -0.02))
    bpy.context.view_layer.update()
    mw = h.matrix_world.copy()
    h.parent = arm
    h.parent_type = 'BONE'
    h.parent_bone = 'RightHand'
    bpy.context.view_layer.update()
    h.matrix_world = mw
    mount = bpy.data.objects.new('BladeMount', None)
    collection().objects.link(mount)
    mount.empty_display_size = 0.05
    mount.parent = h
    mount.location = (0, 0, 0.107)
    return h


def paint_body(body, M):
    """Boots, gloves, undersuit and face on the body itself, by the bone that moves each face most."""
    names = {g.index: g.name for g in body.vertex_groups}
    def dominant(v):
        best = max(v.groups, key=lambda g: g.weight, default=None)
        return names.get(best.group, '') if best else ''
    body.data.materials.clear()
    for k in ('suit', 'boots', 'gloves', 'skin'):
        body.data.materials.append(M[k])
    vb = [dominant(v) for v in body.data.vertices]
    for p in body.data.polygons:
        bones = [vb[i] for i in p.vertices]
        b = max(set(bones), key=bones.count)
        if 'Hand' in b:
            p.material_index = 2
        elif b.endswith('Foot') or 'Toe' in b or b in ('LeftLeg', 'RightLeg'):
            p.material_index = 1
        elif b.startswith('Head'):
            p.material_index = 3
        else:
            p.material_index = 0
        p.use_smooth = True


def grip_fingers(arm):
    """Curl the right hand's fingers round the hilt in every kept action."""
    pb = arm.pose.bones
    names = [n for n in ('RightHandIndex1', 'RightHandIndex2', 'RightHandIndex3', 'RightHandThumb1', 'RightHandThumb2') if n in pb]
    curl = {'RightHandIndex1': 70, 'RightHandIndex2': 80, 'RightHandIndex3': 60, 'RightHandThumb1': 20, 'RightHandThumb2': 35}
    ad = arm.animation_data
    for act in [a for a in bpy.data.actions if any(a.name.endswith('|' + k) or a.name == k for k in KEEP_ACTIONS)]:
        ad.action = act
        if hasattr(ad, 'action_slot') and act.slots:
            ad.action_slot = act.slots[0]
        f0, f1 = (int(x) for x in act.frame_range)
        for n in names:
            b = pb[n]
            b.rotation_mode = 'QUATERNION'
            from mathutils import Euler
            b.rotation_quaternion = Euler((math.radians(curl[n]), 0, 0)).to_quaternion()
            for f in (f0, f1):
                b.keyframe_insert('rotation_quaternion', frame=f)
        for n in names:
            pb[n].rotation_quaternion = (1, 0, 0, 0)


def action_fcurves(act):
    """F-curves of an action, for both the legacy and the slotted (Blender 4.4+) action layout."""
    if getattr(act, 'fcurves', None) is not None and len(act.fcurves):
        return list(act.fcurves)
    from bpy_extras import anim_utils
    out = []
    for slot in act.slots:
        cb = anim_utils.action_get_channelbag_for_slot(act, slot)
        if cb:
            out += list(cb.fcurves)
    return out


def make_saber_walk(arm):
    """WalkSaber: the Walk with the right arm held steady in SABER_HOLD (legs, body and left arm unchanged)."""
    walk = next(a for a in bpy.data.actions if a.name.endswith('|Walk') or a.name == 'Walk')
    old = next((a for a in bpy.data.actions if a.name.endswith('WalkSaber')), None)
    if old:
        bpy.data.actions.remove(old)
    sab = walk.copy()
    sab.name = walk.name.replace('Walk', 'WalkSaber')
    f0, f1 = walk.frame_range
    for fc in action_fcurves(sab):
        for bone, q in SABER_HOLD.items():
            if fc.data_path == 'pose.bones["%s"].rotation_quaternion' % bone:
                fc.keyframe_points.clear()
                for f in (f0, f1):
                    fc.keyframe_points.insert(f, q[fc.array_index], options={'FAST'})
                fc.update()
    return sab


def keep_actions(arm):
    for a in list(bpy.data.actions):
        if not any(a.name.endswith('|' + k) or a.name == k for k in KEEP_ACTIONS):
            bpy.data.actions.remove(a)
    walk = next(a for a in bpy.data.actions if a.name.endswith('Walk'))
    arm.animation_data.action = walk
    if hasattr(arm.animation_data, 'action_slot') and walk.slots:
        arm.animation_data.action_slot = walk.slots[0]


def materials():
    return {
        'cloak': material('cloak', '#16120f', 0.92),
        'cloak_in': material('cloak_in', '#2a1c16', 0.9),
        'hood_in': material('hood_in', '#070605', 1.0),
        'tunic': material('tunic', '#2b2520', 0.88),
        'tunic_in': material('tunic_in', '#1a1613', 0.9),
        'sash': material('sash', '#3a2f26', 0.85),
        'leather': material('leather', '#1d1510', 0.5),
        'boots': material('boots', '#140f0c', 0.42),
        'gloves': material('gloves', '#18120e', 0.48),
        'suit': material('suit', '#121214', 0.8),
        'skin': material('skin', '#5c4234', 0.7),  # reads as a face in the hood's shadow (shadow maps are too coarse to darken it)
        'metal': material('metal', '#8b9097', 0.32, 0.9),
        'hilt': material('hilt', '#a3a8ae', 0.28, 0.95),
    }


def clear_previous():
    for o in list(bpy.data.objects):
        if o.name.startswith(PREFIX) or o.name.startswith('TMP_') or o.name == 'BladeMount':
            bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.name.startswith(PREFIX) and me.users == 0:
            bpy.data.meshes.remove(me)


def build():
    root, arm, body = find_rig()
    clear_previous()
    normalize(root, arm, body)
    pts = body_points(body)
    j = joints(arm)
    M = materials()
    paint_body(body, M)
    parts = [build_tunic(pts, j, arm, M), *build_sleeves(j, arm, M), build_hood(pts, j, arm, M), build_cloak(pts, j, arm, M), *build_belt(pts, j, arm, M), build_hilt(j, arm, M)]
    keep_actions(arm)
    make_saber_walk(arm)
    grip_fingers(arm)
    keep_actions(arm)
    turned, fwd = face_walk_forward(root, arm)
    print('turned %.1f deg so he walks towards %s' % (turned, tuple(round(v, 3) for v in fwd)))
    arm.data.pose_position = 'POSE'
    return root, arm, body, parts


def export(root, path):
    bpy.ops.object.select_all(action='DESELECT')
    def sel(o):
        o.hide_set(False)
        o.select_set(True)
        for c in o.children:
            sel(c)
    sel(root)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_animation_mode='ACTIONS',
                              export_apply=True, export_extras=False, export_yup=True)


def main():
    a = args()
    if 'src' in a:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(a['src']))
    root, arm, body, parts = build()
    if 'out' in a:
        out = os.path.abspath(a['out'])
        os.makedirs(out, exist_ok=True)
        export(root, os.path.join(out, 'knight.glb'))
        print('exported', os.path.join(out, 'knight.glb'))


if __name__ == '__main__':
    main()
