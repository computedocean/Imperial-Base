"""Heavy assault walker: hero model in five parts (original interpretation of a four-legged armoured transport).

Run (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/walker.py -- --out frontend/public/models --preview <dir>

The walker is posed in code (frontend/src/vehicles/Walker.tsx), so each moving part is its own GLB, in the same
frame as the code-built part it replaces:
  walker_body   origin = centre of the belly line, nose +Z
  walker_head   origin = neck joint
  walker_thigh  built along +Y, centred; hip at -Y, knee at +Y
  walker_shin   built along +Y, centred; knee at -Y, ankle at +Y
  walker_foot   origin = centre of the sole
Material names are the aircraft MatKey names: hull, gun, dark, navRed.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import Model  # noqa: E402

THIGH, SHIN, HIP_X, HIP_Z, HIP_DROP = 8.2, 7.6, 3.9, 5.4, 0.2
X = (1, 0, 0)
Z = (0, 0, 1)


def bolts(m, mat, centre, axis_x, r, n, size=0.14):
    """Ring of bolt heads around an axle that runs along X."""
    for k in range(n):
        a = 2 * math.pi * k / n
        m.box(mat, [size, size, size], [centre[0] + axis_x, centre[1] + math.cos(a) * r - size / 2, centre[2] + math.sin(a) * r], bevel=0.02)


def build_body():
    m = Model('walker_body')
    rnd = random.Random(1980)
    m.hull_z('hull', [(-10.2, 5.0, 1.2, 5.6, 0.9), (-8.0, 6.6, 0.3, 6.9, 1.1), (6.2, 6.6, 0.3, 6.9, 1.1), (9.2, 4.8, 1.0, 5.8, 0.9)], bevel=0.08)
    for sx in (1, -1):
        # side armour: a slab carrying four framed plates, each with an inset panel and corner bolts
        m.box('gun', [0.3, 4.4, 12.6], [sx * 3.36, 1.6, -0.9], bevel=0.08)
        for i in range(4):
            z = -5.6 + i * 3.15
            m.box('hull', [0.18, 3.9, 2.8], [sx * 3.5, 1.85, z], bevel=0.05)
            if i != 1:
                m.box('hull', [0.1, 2.9, 1.9], [sx * 3.62, 2.35, z], bevel=0.04)
                for k in range(3):
                    m.box('dark', [0.12, 0.08, 1.5], [sx * 3.66, 2.6 + k * 0.22, z])
            for dy in (0.25, 3.5):
                for dz in (-1.2, 1.2):
                    m.box('dark', [0.1, 0.14, 0.14], [sx * 3.6, 1.85 + dy, z + dz], bevel=0.02)
        # the big side hatch: frame, door, hinges, handle
        m.box('gun', [0.16, 3.0, 2.4], [sx * 3.6, 1.8, -2.45], bevel=0.05)
        m.box('dark', [0.14, 2.6, 2.0], [sx * 3.66, 2.0, -2.45], bevel=0.04)
        m.box('gun', [0.14, 0.1, 1.2], [sx * 3.72, 3.2, -2.45])
        for dy in (2.3, 4.1):
            m.box('gun', [0.2, 0.3, 0.3], [sx * 3.7, dy, -3.5], bevel=0.04)
        # upper chamfer: ventilation louvres and a grab rail
        for k in range(9):
            m.box('dark', [0.5, 0.1, 0.9], [sx * 2.95, 6.45, -6.4 + k * 1.5], bevel=0.02)
        m.tube('gun', (sx * 3.45, 6.3, -7.0), (sx * 3.45, 6.3, 5.4), 0.06, seg=6)
        for k in range(6):
            m.tube('gun', (sx * 3.3, 6.2, -6.8 + k * 2.4), (sx * 3.45, 6.3, -6.8 + k * 2.4), 0.05, seg=5)
        # drive housings over each hip: armoured box, axle drum, hub, bolts, a hydraulic line
        for sz in (1, -1):
            hz = sz * HIP_Z
            m.box('gun', [1.5, 2.6, 4.4], [sx * 3.5, -0.7, hz], bevel=0.25)
            m.box('hull', [0.2, 1.3, 3.2], [sx * 4.2, 0.5, hz], bevel=0.06)
            m.lathe('dark', (sx * 4.1, -HIP_DROP, hz), (sx, 0, 0), [(0, 1.75), (0.5, 1.75)], seg=22, bevel=0.05)
            m.lathe('gun', (sx * 4.1, -HIP_DROP, hz), (sx, 0, 0), [(0.4, 1.25), (0.72, 1.25), (0.84, 0.95), (0.84, 0.4), (0.7, 0.4)], seg=18, bevel=0.03)
            bolts(m, 'gun', (sx * 4.1, -HIP_DROP, hz), sx * 0.52, 1.5, 10)
            m.tube('dark', (sx * 3.2, 1.9, hz - sz * 1.6), (sx * 4.0, 1.0, hz - sz * 1.9), 0.1, seg=6)
    # belly: keel, troop-bay doors, ribs
    m.box('gun', [3.6, 1.0, 15.0], [0, -0.4, -0.8], bevel=0.2)
    m.box('dark', [2.2, 0.7, 6.0], [0, -0.75, -0.8], bevel=0.15)
    for i in range(9):
        m.box('gun', [5.6, 0.3, 0.35], [0, 0.08, -7.2 + i * 1.7], bevel=0.05)
    # dorsal spine: housings, hatches, antenna, exhaust stacks
    m.box('gun', [2.6, 0.5, 13.0], [0, 6.75, -1.0], bevel=0.12)
    for i in range(5):
        m.box('dark', [1.8, 0.3, 0.8], [0, 7.15, -6.0 + i * 2.6], bevel=0.06)
        m.box('gun', [0.5, 0.2, 0.5], [(-1) ** i * 0.9, 7.22, -4.7 + i * 2.6], bevel=0.04)
    m.cyl('gun', 0.55, 0.6, 0.3, [0, 7.2, 4.9], seg=14, bevel=0.04)
    m.cyl('dark', 0.4, 0.4, 0.34, [0, 7.2, 4.9], seg=12)
    m.tube('gun', (0.9, 7.2, -8.0), (0.9, 9.6, -8.0), 0.08, 0.04, seg=6)
    for sx in (1, -1):
        m.cyl('dark', 0.28, 0.32, 0.9, [sx * 0.8, 7.2, -6.9], seg=10, bevel=0.03)
    # rear drive block: frame, grille, ladder rungs
    m.box('gun', [3.8, 3.0, 1.0], [0, 1.9, -10.4], bevel=0.2)
    m.box('dark', [2.4, 1.6, 0.4], [0, 2.6, -10.9], bevel=0.08)
    for k in range(6):
        m.box('gun', [2.2, 0.08, 0.1], [0, 2.75 + k * 0.24, -11.12])
    for k in range(5):
        m.tube('gun', (-0.5, 4.6 + k * 0.42, -10.3), (0.5, 4.6 + k * 0.42, -10.3), 0.05, seg=5)
    # small plating and equipment boxes on the nose and tail slopes
    for _ in range(26):
        x = (rnd.random() * 2 - 1) * 2.2
        fore = rnd.random() < 0.5
        z = 6.6 + rnd.random() * 2.2 if fore else -8.4 - rnd.random() * 1.4
        m.box(rnd.choice(['gun', 'dark', 'hull']), [0.4 + rnd.random() * 0.8, 0.12 + rnd.random() * 0.16, 0.3 + rnd.random() * 0.6], [x, 5.9 + (0 if fore else 0.0) - abs(z - (6.2 if fore else -8.0)) * (0.36 if fore else 0.58), z], bevel=0.03)
    # neck: flexible tunnel with ribs and a collar where it leaves the hull
    m.lathe('dark', (0, 3.3, 9.0), Z, [(0, 1.45), (4.8, 1.25)], seg=18)
    for i in range(5):
        m.lathe('gun', (0, 3.3, 9.33 + i * 0.95), Z, [(0, 1.5), (0.06, 1.57), (0.3, 1.57), (0.36, 1.5)], seg=18)
    m.lathe('gun', (0, 3.3, 8.7), Z, [(0, 2.0), (0.5, 2.0), (0.7, 1.7)], seg=18, bevel=0.05)
    for sx in (1, -1):
        m.tube('dark', (sx * 1.7, 3.3, 9.2), (sx * 1.45, 3.3, 13.6), 0.1, seg=6)
    m.sphere('navRed', 0.22, [0, 7.6, -9.4], seg=10, rings=6)
    return m


def build_head():
    m = Model('walker_head')
    m.hull_z('hull', [(-0.4, 3.9, -1.9, 1.9, 0.7), (2.6, 4.5, -2.1, 2.2, 0.8), (5.0, 4.1, -1.8, 1.7, 0.7), (6.6, 2.9, -1.1, 0.7, 0.5)], bevel=0.07)
    m.lathe('gun', (0, 0, -0.75), Z, [(0, 1.7), (0.4, 1.9)], seg=18, bevel=0.04)       # neck collar
    # viewport: recessed frame with the glowing slit, a brow above it
    m.box('dark', [2.4, 0.62, 0.2], [0, -0.2, 6.62], bevel=0.04)
    m.box('navRed', [2.0, 0.18, 0.12], [0, 0.02, 6.7])
    m.box('gun', [2.7, 0.14, 0.34], [0, 0.44, 6.66], bevel=0.03)
    for sx in (1, -1):
        m.box('gun', [0.12, 0.6, 0.26], [sx * 1.26, -0.19, 6.66], bevel=0.02)
        # cheek armour with an inset plate, temple blaster, chin cannon
        m.box('gun', [0.4, 2.4, 3.4], [sx * 2.3, -1.1, 2.6], bevel=0.1)
        m.box('hull', [0.14, 1.7, 2.5], [sx * 2.5, -0.75, 2.6], bevel=0.05)
        for k in range(3):
            m.box('dark', [0.12, 0.08, 1.2], [sx * 2.56, -0.2 + k * 0.24, 2.3])
        m.lathe('gun', (sx * 2.55, -0.2, 3.1), Z, [(0, 0.34), (0.2, 0.44), (1.6, 0.44), (1.75, 0.3)], seg=12, bevel=0.03)
        m.lathe('dark', (sx * 2.55, -0.2, 4.8), Z, [(0, 0.17), (2.0, 0.17), (2.0, 0.22), (2.2, 0.22)], seg=10)
        m.lathe('gun', (sx * 0.95, -2.2, 3.1), Z, [(0, 0.3), (0.3, 0.36), (2.6, 0.36), (2.75, 0.24)], seg=12, bevel=0.03)
        m.lathe('dark', (sx * 0.95, -2.2, 5.8), Z, [(0, 0.2), (2.8, 0.2), (2.8, 0.29), (3.3, 0.29), (3.3, 0.12)], seg=10)
        for k in range(3):
            m.lathe('gun', (sx * 0.95, -2.2, 6.3 + k * 0.6), Z, [(0, 0.24), (0.16, 0.24)], seg=10)
    m.box('gun', [2.8, 0.7, 2.6], [0, -2.4, 3.6], bevel=0.12)                           # chin block
    m.box('dark', [1.2, 0.3, 1.8], [0, -2.5, 3.8], bevel=0.05)
    m.box('gun', [2.4, 0.4, 3.4], [0, 2.05, 2.4], bevel=0.1)                            # crown plate
    for k in range(4):
        m.box('dark', [1.6, 0.12, 0.3], [0, 2.42, 1.3 + k * 0.7], bevel=0.02)
    m.cyl('gun', 0.3, 0.34, 0.3, [1.2, 2.2, 0.3], seg=10, bevel=0.03)
    m.tube('gun', (1.2, 2.4, 0.3), (1.2, 3.8, 0.3), 0.05, 0.03, seg=5)
    return m


def piston(m, x, y0, y1, z, r=0.16):
    """Hydraulic ram running along Y: fat cylinder, bright rod, end caps."""
    mid = y0 + (y1 - y0) * 0.55
    m.tube('gun', (x, y0, z), (x, mid, z), r, seg=10)
    m.tube('hull', (x, mid, z), (x, y1, z), r * 0.55, seg=8)
    for y in (y0, y1):
        m.box('dark', [r * 2.6, r * 2.2, r * 2.6], [x, y - r * 1.1, z], bevel=0.03)


def build_thigh():
    m = Model('walker_thigh')
    m.box('hull', [1.7, THIGH - 1.0, 2.2], [0, -(THIGH - 1.0) / 2, 0], bevel=0.2)
    m.box('gun', [1.9, THIGH * 0.45, 1.5], [0, -0.6 - THIGH * 0.225, 0], bevel=0.12)
    m.box('dark', [0.5, THIGH - 2.4, 2.5], [0, -(THIGH - 2.4) / 2, 0], bevel=0.08)
    for k in range(5):                                                       # armour ribs across the front and back
        for sz in (1, -1):
            m.box('gun', [1.5, 0.22, 0.14], [0, -2.6 + k * 1.15, sz * 1.14], bevel=0.03)
    for sx in (1, -1):
        m.box('hull', [0.12, 2.6, 1.4], [sx * 0.9, 0.3, 0], bevel=0.04)
        piston(m, sx * 0.62, -3.3, 2.9, 1.42)
    m.lathe('gun', (-1.0, -THIGH / 2, 0), X, [(0, 1.15), (2.0, 1.15)], seg=18, bevel=0.06)          # hip collar
    m.lathe('gun', (-1.15, THIGH / 2, 0), X, [(0, 1.3), (0.12, 1.45), (2.18, 1.45), (2.3, 1.3)], seg=20, bevel=0.04)  # knee
    m.lathe('dark', (-1.25, THIGH / 2, 0), X, [(0, 0.9), (2.5, 0.9)], seg=14, bevel=0.03)
    for sx in (1, -1):
        bolts(m, 'dark', (0, THIGH / 2, 0), sx * 1.17 - 0.07, 1.18, 8)
    return m


def build_shin():
    m = Model('walker_shin')
    m.box('hull', [1.4, SHIN - 1.2, 1.8], [0, -0.1 - (SHIN - 1.2) / 2, 0], bevel=0.16)
    m.box('gun', [1.6, SHIN * 0.4, 1.2], [0, 1.0 - SHIN * 0.2, 0], bevel=0.1)
    m.box('dark', [0.4, SHIN - 2.6, 2.1], [0, -(SHIN - 2.6) / 2, 0], bevel=0.06)
    for k in range(4):
        for sz in (1, -1):
            m.box('gun', [1.2, 0.2, 0.12], [0, -2.9 + k * 0.95, sz * 0.94], bevel=0.03)
    for sx in (1, -1):
        m.box('hull', [0.12, 2.2, 1.1], [sx * 0.74, -2.9, 0], bevel=0.04)
        piston(m, sx * 0.5, -2.4, 3.0, -1.16, r=0.14)
    m.lathe('gun', (-0.95, SHIN / 2, 0), X, [(0, 0.9), (0.1, 1.0), (1.8, 1.0), (1.9, 0.9)], seg=18, bevel=0.04)       # ankle
    m.lathe('dark', (-1.03, SHIN / 2, 0), X, [(0, 0.6), (2.06, 0.6)], seg=12)
    return m


def build_foot():
    m = Model('walker_foot')
    m.cyl('dark', 2.62, 2.62, 0.25, [0, 0.015, 0], seg=28, bevel=0.03)
    m.cyl('gun', 2.3, 2.6, 0.9, [0, 0.0, 0], seg=28, bevel=0.06)
    m.cyl('hull', 1.5, 2.25, 0.7, [0, 0.85, 0], seg=28, bevel=0.05)
    m.cyl('gun', 1.15, 1.3, 0.35, [0, 1.5, 0], seg=18, bevel=0.04)          # ankle socket
    for i in range(4):                                                       # toe flaps with a hinge and a tread plate
        a = 2 * math.pi * i / 4 + math.pi / 4
        s, c = math.sin(a), math.cos(a)
        m.box('gun', [0.9, 0.62, 1.5], [s * 2.1, 0.44, c * 2.1], rot_y=a, bevel=0.1)
        m.box('hull', [0.7, 0.1, 1.0], [s * 2.15, 1.06, c * 2.15], rot_y=a, bevel=0.03)
        m.box('dark', [1.1, 0.2, 0.3], [s * 1.45, 1.0, c * 1.45], rot_y=a, bevel=0.04)
    for i in range(16):                                                      # rim bolts and sole cleats
        a = 2 * math.pi * i / 16
        m.box('dark', [0.16, 0.16, 0.16], [math.sin(a) * 2.48, 0.5, math.cos(a) * 2.48], rot_y=a, bevel=0.02)
        if i % 2 == 0:
            m.box('dark', [0.3, 0.3, 0.7], [math.sin(a) * 1.85, 1.2, math.cos(a) * 1.85], rot_y=a, bevel=0.04)
    return m


PARTS = [(build_head, 1024, 3.0), (build_thigh, 1024, 2.5), (build_shin, 1024, 2.5), (build_foot, 1024, 2.0), (build_body, 2048, 4.0)]


def main():
    a = bkit.args()
    out = os.path.abspath(a.get('out', 'frontend/public/models'))
    prev = a.get('preview')
    scale = int(a.get('size', '2048')) / 2048
    os.makedirs(out, exist_ok=True)
    bkit.reset()
    bkit.TILE = 5.0
    ob = img = None
    for build, size, dist in PARTS:
        if ob is not None:
            bkit.bpy.data.objects.remove(ob, do_unlink=True)
        m = build()
        ob = m.to_object()
        print(f'[walker] {m.name}: {m.tris} triangles, materials {m.mats}')
        bkit.lightmap_unwrap(ob, margin=0.003)
        img = bkit.bake_ao(ob, os.path.join(out, m.name + '_ao.jpg'), size=max(256, int(size * scale)), samples=int(a.get('samples', '48')),
                           distance=dist, ground=False)
        bkit.export_glb(ob, os.path.join(out, m.name + '.glb'))
    if prev:
        os.makedirs(prev, exist_ok=True)
        bkit.PREVIEW_COLORS.update({'gun': (0.3, 0.31, 0.33)})
        bkit.preview(ob, img, os.path.join(os.path.abspath(prev), 'walker_body.png'), (20, 12, 22), (0, 3, 0), ground=False, lens=40)
    print('[walker] done')


main()
