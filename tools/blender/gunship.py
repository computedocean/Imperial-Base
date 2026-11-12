"""Bounty hunter's gunship: hero model (original interpretation of a bare-metal ex-military patrol craft).

Run (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/gunship.py -- --out frontend/public/models --preview <dir>

Modelled around the centre of the fuselage, nose towards +Z, up +Y, metres (three.js coordinates), to match
frontend/src/aircraft/models/Gunship.tsx. The landing gear and engine glow stay procedural there (they animate).
Material names are the aircraft MatKey names: hull, gun, dark, glass, stripe.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import Model  # noqa: E402

POD = dict(x=6.7, y=0.5, r=1.95, front=2.4, rear=-7.2)
FUSELAGE = [(-11.4, 3.4, -1.3, 1.5, 0.5), (-7.0, 4.8, -1.9, 2.3, 0.7), (3.2, 4.8, -1.9, 2.5, 0.7),
            (8.0, 3.7, -1.5, 2.1, 0.6), (11.6, 1.7, -0.7, 0.9, 0.3)]
CANOPY = [(4.6, 2.7, 2.3, 3.35, 0.45), (7.6, 2.5, 1.95, 3.1, 0.45), (10.4, 1.3, 0.8, 1.6, 0.25)]


def section_at(z):
    """Fuselage section (width, y_bottom, y_top) at station z."""
    for a, c in zip(FUSELAGE[:-1], FUSELAGE[1:]):
        if a[0] <= z <= c[0]:
            k = (z - a[0]) / (c[0] - a[0])
            return tuple(a[i] + (c[i] - a[i]) * k for i in (1, 2, 3))
    return FUSELAGE[-1][1:4]


def side_yaw(z, sx):
    """Yaw that lays a plate flat against the tapering side of the fuselage at station z."""
    for a, c in zip(FUSELAGE[:-1], FUSELAGE[1:]):
        if a[0] <= z <= c[0]:
            return math.atan(sx * (c[1] - a[1]) / 2 / (c[0] - a[0]))
    return 0.0


def build():
    m = Model('gunship')
    rnd = random.Random(2019)
    tones = ['hull', 'hull', 'hull', 'gun']

    # ------------------------------------------------------------ fuselage
    m.hull_z('hull', FUSELAGE, bevel=0.06)
    # side plating: rows of raised plates that follow the taper of the hull
    for sx in (1, -1):
        for row, (y0, h) in enumerate(((-1.25, 0.95), (-0.2, 1.05), (0.95, 0.75))):
            z = -10.6
            while z < 9.6:
                length = 0.9 + rnd.random() * 1.5
                zm = z + length / 2
                w, yb, yt = section_at(zm)
                span = yt - yb
                yy = yb + (y0 + 1.9) / 4.4 * span
                hh = h / 4.4 * span
                if not (row == 1 and -5.2 < zm < -1.4) and rnd.random() > 0.12:      # leave the cargo hatch clear
                    m.box(rnd.choice(tones), [0.07 + rnd.random() * 0.05, hh - 0.08, length - 0.08], [sx * (w / 2 + 0.01), yy, zm], rot_y=side_yaw(zm, sx), bevel=0.02)
                z += length
        # cargo hatch: frame, door, handle bar, step
        m.box('gun', [0.16, 2.9, 3.6], [sx * 2.4, -1.35, -3.3], bevel=0.05)
        m.box('hull', [0.12, 2.5, 3.2], [sx * 2.47, -1.15, -3.3], bevel=0.04)
        m.box('dark', [0.1, 2.3, 0.1], [sx * 2.53, -1.05, -3.3])
        for dz in (-1.2, 1.2):
            m.box('dark', [0.1, 0.35, 0.7], [sx * 2.53, 0.5, -3.3 + dz], bevel=0.02)
        m.box('gun', [0.5, 0.1, 2.6], [sx * 2.6, -1.5, -3.3], bevel=0.02)
        # vertical frames, markings, intake grilles
        for z in (0.4, 2.6, 4.8, -6.2, -8.4):
            w, yb, yt = section_at(z)
            m.box('gun', [0.12, (yt - yb) * 0.8, 0.16], [sx * (w / 2 + 0.01), yb + (yt - yb) * 0.1, z], rot_y=side_yaw(z, sx), bevel=0.02)
        m.box('stripe', [0.1, 0.5, 2.4], [sx * 2.24, 1.3, 4.6], bevel=0.02)
        for k in range(5):
            m.box('dark', [0.14, 0.09, 1.3], [sx * 2.44, 0.2 + k * 0.2, 1.5])
        # nose cannons under the cockpit
        m.lathe('gun', (sx * 1.05, -1.1, 7.6), (0, 0, 1), [(0, 0.3), (0.5, 0.3), (0.6, 0.24), (3.0, 0.24), (3.1, 0.3), (3.4, 0.3)], seg=12, bevel=0.02)
        m.lathe('dark', (sx * 1.05, -1.1, 10.9), (0, 0, 1), [(0, 0.12), (1.2, 0.12), (1.2, 0.17), (1.5, 0.17)], seg=10)
        m.box('gun', [0.5, 0.5, 1.4], [sx * 1.05, -1.0, 8.2], bevel=0.06)

    # roof plating either side of the spine, and belly plating
    for sx in (1, -1):
        z = -6.6
        while z < 3.4:
            length = 1.0 + rnd.random() * 1.4
            w, yb, yt = section_at(z + length / 2)
            if rnd.random() > 0.15:
                m.box(rnd.choice(tones), [0.75, 0.06 + rnd.random() * 0.05, length - 0.08], [sx * 1.25, yt - 0.01, z + length / 2], bevel=0.02)
            z += length
    for _ in range(26):
        z = -9 + rnd.random() * 15
        w, yb, yt = section_at(z)
        x = (rnd.random() * 2 - 1) * (w / 2 - 1.0)
        if abs(x) < 1.4:
            continue
        m.box(rnd.choice(['gun', 'dark', 'hull']), [0.3 + rnd.random() * 0.5, 0.12 + rnd.random() * 0.14, 0.4 + rnd.random() * 0.9], [x, yb - 0.2, z], bevel=0.02)

    # ------------------------------------------------------------ cockpit: glazed greenhouse with a full frame
    m.hull_z('glass', CANOPY)
    rings = [m.ring_xy(*s) for s in CANOPY]
    lift = lambda p: (p[0] * 1.01, p[1] + 0.01, p[2])
    for a, c in zip(rings[:-1], rings[1:]):
        for i in (1, 2, 3, 4, 5, 6):                                       # longitudinal frames (skip the two under the floor)
            m.beam('gun', lift(a[i]), lift(c[i]), 0.1)
    for ring in rings:
        for i in range(1, 6):                                              # hoops
            m.beam('gun', lift(ring[i]), lift(ring[i + 1]), 0.1)
    m.box('gun', [2.9, 0.34, 0.5], [0, 2.2, 4.4], bevel=0.05)              # canopy sill
    m.box('dark', [1.2, 0.18, 0.9], [0, 0.72, 10.5], bevel=0.04)           # nose sensor block
    m.tube('gun', (0, 0.3, 11.5), (0, 0.3, 12.5), 0.1, 0.05, seg=8)        # nose probe

    # ------------------------------------------------------------ dorsal spine, sensors, belly keel
    m.box('gun', [1.5, 0.5, 9.5], [0, 2.3, -3.6], bevel=0.12)
    for i in range(5):
        m.box('dark', [1.1, 0.3, 0.7], [0, 2.78, -7.2 + i * 1.75], bevel=0.05)
        m.box('gun', [0.3, 0.16, 0.5], [(-1) ** i * 0.5, 2.8, -6.4 + i * 1.75], bevel=0.03)
    for sx in (1, -1):
        m.tube('dark', (sx * 0.62, 2.72, -8.0), (sx * 0.62, 2.72, 0.9), 0.07, seg=6)   # conduits along the spine
    m.tube('gun', (0.9, 2.3, -5.2), (0.9, 4.6, -5.2), 0.1, 0.05, seg=8)
    m.tube('gun', (0.9, 3.9, -5.2), (0.9, 3.9, -4.4), 0.03, seg=5)
    m.cyl('gun', 0.3, 0.38, 0.3, [-0.9, 2.5, -1.0], seg=10, bevel=0.03)
    m.dish('hull', 0.75, 0.25, [-0.9, 3.0, -1.0], tilt_x=0.7, seg=16)
    m.box('gun', [2.6, 0.6, 12], [0, -2.3, -1.2], bevel=0.15)
    for i in range(7):
        m.box('dark', [2.8, 0.34, 0.3], [0, -2.36, -6.2 + i * 1.7], bevel=0.04)
    for x, z in ((0, 6.6), (2.0, -6.4), (-2.0, -6.4)):                      # landing gear bays
        m.box('dark', [1.3, 0.2, 1.7], [x, -2.0 if x else -1.9, z], bevel=0.03)

    # ------------------------------------------------------------ stub wings and the two engine pods
    for sx in (1, -1):
        def mirror(pts):
            o = [(sx * x, z) for x, z in pts]
            return o if sx > 0 else list(reversed(o))
        m.prism('hull', mirror([(2.2, -5.6), (5.2, -5.0), (5.2, 0.6), (2.2, 1.6)]), POD['y'] - 0.3, 0.6, bevel=0.08)
        m.prism('gun', mirror([(2.6, -4.6), (4.8, -4.2), (4.8, -0.4), (2.6, 0.2)]), POD['y'] + 0.3, 0.07, bevel=0.02)
        m.prism('gun', mirror([(2.6, -4.6), (4.8, -4.2), (4.8, -0.4), (2.6, 0.2)]), POD['y'] - 0.37, 0.07, bevel=0.02)
        for k in range(4):                                                  # wing ribs and leading-edge strip
            m.box('dark', [2.3, 0.05, 0.12], [sx * 3.7, POD['y'] + 0.37, -3.9 + k * 1.1])
        m.beam('dark', (sx * 2.3, POD['y'], 1.5), (sx * 5.1, POD['y'], 0.6), 0.2, 0.3)
        for dz in (-1.0, -3.2):                                             # fuel and power lines to the pod
            m.tube('gun', (sx * 2.3, POD['y'] + 0.55, dz), (sx * 5.0, POD['y'] + 1.0, dz), 0.09, seg=6)
        # under-wing cannon
        m.box('gun', [0.5, 0.5, 1.6], [sx * 3.6, POD['y'] - 0.85, -1.0], bevel=0.06)
        m.tube('dark', (sx * 3.6, POD['y'] - 0.6, -0.3), (sx * 3.6, POD['y'] - 0.6, 2.4), 0.12, seg=8)

        c = (sx * POD['x'], POD['y'], 0.0)
        Z = (0, 0, 1)
        R = POD['r']
        m.lathe('hull', c, Z, [(POD['rear'] - 0.1, R * 0.97), (POD['rear'], R), (POD['front'] - 0.6, R)], seg=28)
        # intake: rolled lip, dark throat, spike and guide vanes
        m.lathe('gun', c, Z, [(POD['front'] - 0.9, R * 1.01), (POD['front'] - 0.7, R * 1.08), (POD['front'] + 0.25, R * 1.08), (POD['front'] + 0.42, R * 1.0),
                              (POD['front'] + 0.42, R * 0.88), (POD['front'] - 0.1, R * 0.82)], seg=28, bevel=0.03)
        m.lathe('dark', c, Z, [(POD['front'] - 0.16, R * 0.84), (POD['front'] - 0.1, R * 0.84)], seg=24)
        m.lathe('gun', c, Z, [(POD['front'] - 0.1, R * 0.5), (POD['front'] + 0.9, R * 0.22), (POD['front'] + 1.35, 0.06)], seg=14)
        for k in range(10):
            a = 2 * math.pi * k / 10
            ca, sa = math.cos(a), math.sin(a)
            m.beam('gun', (c[0] + ca * R * 0.3, c[1] + sa * R * 0.3, POD['front'] + 0.2), (c[0] + ca * R * 0.86, c[1] + sa * R * 0.86, POD['front'] + 0.2), 0.07, 0.3)
        # bands, access panels and piping along the pod
        m.lathe('stripe', c, Z, [(POD['front'] - 2.5, R * 1.02), (POD['front'] - 1.95, R * 1.02)], seg=28, bevel=0.02)
        for z in (POD['front'] - 3.6, -3.9, -5.6):
            m.lathe('gun', c, Z, [(z, R * 1.03), (z + 0.32, R * 1.03)], seg=28, bevel=0.02)
        for k in range(12):
            a = 2 * math.pi * (k + 0.5) / 12
            ca, sa = math.cos(a), math.sin(a)
            if k % 3 == 0:
                m.beam('gun', (c[0] + ca * R, c[1] + sa * R, POD['rear'] + 0.4), (c[0] + ca * R, c[1] + sa * R, POD['front'] - 2.7), 0.18, 0.34)
            elif rnd.random() < 0.7:
                z0 = -6.4 + rnd.random() * 4
                m.beam(rnd.choice(['hull', 'gun', 'dark']), (c[0] + ca * R, c[1] + sa * R, z0), (c[0] + ca * R, c[1] + sa * R, z0 + 0.8 + rnd.random() * 1.6), 0.5 + rnd.random() * 0.3, 0.12)
            if k % 4 == 1:
                m.tube('dark', (c[0] + ca * (R + 0.1), c[1] + sa * (R + 0.1), POD['rear'] + 0.6), (c[0] + ca * (R + 0.1), c[1] + sa * (R + 0.1), POD['front'] - 1.2), 0.06, seg=5)
        # exhaust: tapered nozzle, petals, dark throat with a turbine hub
        m.lathe('gun', c, Z, [(POD['rear'] + 0.2, R * 0.99), (POD['rear'] - 0.2, R * 0.97), (POD['rear'] - 1.35, R * 0.82), (POD['rear'] - 1.35, R * 0.74), (POD['rear'] - 1.0, R * 0.72)], seg=28, bevel=0.02)
        m.lathe('dark', c, Z, [(POD['rear'] - 1.06, R * 0.73), (POD['rear'] - 1.0, R * 0.73)], seg=24)
        m.lathe('gun', c, Z, [(POD['rear'] - 1.3, 0.2), (POD['rear'] - 1.0, 0.5)], seg=12)
        for k in range(14):
            a = 2 * math.pi * k / 14
            ca, sa = math.cos(a), math.sin(a)
            m.beam('dark', (c[0] + ca * R * 0.99, c[1] + sa * R * 0.99, POD['rear'] - 0.15), (c[0] + ca * R * 0.85, c[1] + sa * R * 0.85, POD['rear'] - 1.3), 0.5, 0.06)

    # ------------------------------------------------------------ stern: ramp door, frame, hydraulic struts
    m.box('gun', [3.0, 2.5, 0.3], [0, -1.25, -11.45], bevel=0.08)
    m.box('dark', [2.3, 1.9, 0.2], [0, -1.0, -11.6], bevel=0.05)
    for i in range(4):
        m.box('gun', [2.1, 0.08, 0.1], [0, -0.8 + i * 0.45, -11.72])
    for sx in (1, -1):
        m.tube('gun', (sx * 1.35, 0.9, -11.3), (sx * 1.35, -1.0, -11.75), 0.08, seg=6)
        m.box('gun', [0.3, 0.3, 0.3], [sx * 1.35, 0.8, -11.4], bevel=0.04)
    for _ in range(14):
        x, y = (rnd.random() * 2 - 1) * 1.4, 1.35 + rnd.random() * 0.0
        m.box(rnd.choice(['gun', 'dark']), [0.2 + rnd.random() * 0.4, 0.1 + rnd.random() * 0.15, 0.15], [x, 0.95 + rnd.random() * 0.4, -11.5], bevel=0.02)
    return m


def main():
    a = bkit.args()
    out = os.path.abspath(a.get('out', 'frontend/public/models'))
    prev = a.get('preview')
    os.makedirs(out, exist_ok=True)
    bkit.reset()
    bkit.TILE = 4.0
    m = build()
    ob = m.to_object()
    print(f'[gunship] {m.tris} triangles, materials {m.mats}')
    bkit.lightmap_unwrap(ob, margin=0.002)
    img = bkit.bake_ao(ob, os.path.join(out, 'gunship_ao.jpg'), size=int(a.get('size', '2048')), samples=int(a.get('samples', '48')),
                       distance=2.0, ground=False)
    bkit.export_glb(ob, os.path.join(out, 'gunship.glb'))
    if prev:
        os.makedirs(prev, exist_ok=True)
        bkit.PREVIEW_COLORS.update({'hull': (0.66, 0.67, 0.69), 'gun': (0.3, 0.31, 0.33), 'stripe': (0.55, 0.42, 0.12)})
        bkit.preview(ob, img, os.path.join(os.path.abspath(prev), 'gunship.png'), (17, 9, 22), (0, 0.3, -1), ground=False, lens=40)
    print('[gunship] done')


main()
