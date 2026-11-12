"""Light freighter — hero model (original interpretation of the famous Corellian saucer).

Run (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/freighter.py -- --out frontend/public/models --preview <dir>

Modelled around the centre of the disc, nose towards +Z, up +Y, metres (three.js coordinates), to match
frontend/src/aircraft/models/Freighter.tsx. The landing gear, ramp and engine glow stay procedural there
(they animate). Material names are the aircraft MatKey names: xwhite, gun, dark, glass, stripe, hull.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import Model  # noqa: E402

R = 12.4
PROFILE = [(0.6, 2.32), (3.0, 2.2), (6.5, 1.7), (11.8, 0.55), (12.3, 0.4)]  # (radius, height) of the upper hull


def deck_y(r):
    """Height of the upper hull at radius r."""
    for (r0, y0), (r1, y1) in zip(PROFILE[:-1], PROFILE[1:]):
        if r <= r1:
            return y0 + (y1 - y0) * (r - r0) / (r1 - r0)
    return PROFILE[-1][1]


def polar(r, a):
    """Point on the deck plan at radius r, bearing a (0 = bow, +x to port)."""
    return math.sin(a) * r, math.cos(a) * r


def tube_x(m, mat, r, x0, x1, y, z, seg=18, bevel=0.0):
    ring = lambda x: [(x, y + r * math.cos(2 * math.pi * i / seg), z + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    m.loft(mat, [ring(min(x0, x1)), ring(max(x0, x1))], bevel=bevel)


def build():
    m = Model('freighter')
    rnd = random.Random(1977)
    SEG = 56

    # ------------------------------------------------------------ saucer: stacked rings, upper and lower
    for (r0, y0), (r1, y1) in zip(PROFILE[:-1], PROFILE[1:]):
        m.cyl('xwhite', r0, r1, y0 - y1, [0, y1, 0], seg=SEG)            # upper
        m.cyl('xwhite', r1, r0, y0 - y1, [0, -y0, 0], seg=SEG)           # lower (mirrored)
    m.cyl('xwhite', 12.3, 12.3, 0.8, [0, -0.4, 0], seg=SEG)
    m.cyl('dark', 12.36, 12.36, 0.5, [0, -0.25, 0], seg=SEG)             # equatorial trench
    for i in range(44):                                                  # trench machinery, except across the stern engines
        a = 2 * math.pi * i / 44 + 0.05
        if math.cos(a) < -0.6:
            continue
        x, z = polar(R + 0.02, a)
        m.box(rnd.choice(['gun', 'gun', 'hull']), [0.45 + rnd.random() * 0.5, 0.22 + rnd.random() * 0.2, 0.26], [x, -0.2 + rnd.random() * 0.1, z], rot_y=a, bevel=0.03)

    # ------------------------------------------------------------ deck plating: raised wedge panels in rings, top and bottom
    def panel(mat, r_in, r_out, a0, a1, lift, top=True):
        """A plate following the hull slope between two radii and two bearings."""
        ring = []
        for rr, aa in ((r_in, a0), (r_out, a0), (r_out, a1), (r_in, a1)):
            x, z = polar(rr, aa)
            ring.append((x, deck_y(rr), z))
        s = 1 if top else -1
        lo = [(x, s * (y - 0.05), z) for x, y, z in ring]
        hi = [(x, s * (y + lift), z) for x, y, z in ring]
        m.loft(mat, [lo, hi] if top else [hi, lo], bevel=0.02)

    for top in (True, False):
        for r_in, r_out, n in ((3.3, 6.3, 10), (6.7, 9.2, 16), (9.5, 11.6, 22)):
            for i in range(n):
                if rnd.random() < 0.3:
                    continue
                a0 = 2 * math.pi * i / n + 0.03
                a1 = 2 * math.pi * (i + 1) / n - 0.03
                mid = (a0 + a1) / 2
                if top and r_in > 6 and math.cos(mid) < -0.55 and abs(math.sin(mid)) < 0.75:
                    continue  # the exhaust vents live here
                if rnd.random() < 0.35:  # split a panel in two for variety
                    cut = r_in + (r_out - r_in) * (0.35 + rnd.random() * 0.3)
                    panel(rnd.choice(['xwhite', 'hull']), r_in, cut - 0.06, a0, a1, 0.05 + rnd.random() * 0.05, top)
                    panel(rnd.choice(['xwhite', 'gun', 'stripe']), cut + 0.06, r_out, a0, a1, 0.04 + rnd.random() * 0.06, top)
                else:
                    panel(rnd.choice(['xwhite', 'xwhite', 'xwhite', 'hull', 'hull', 'gun', 'stripe']), r_in, r_out, a0, a1, 0.04 + rnd.random() * 0.07, top)
    # radial spines and small greebles on the upper deck
    for i in range(6):
        a = 2 * math.pi * i / 6 + 0.5
        p0, p1 = polar(3.1, a), polar(11.5, a)
        m.beam('gun', (p0[0], deck_y(3.1) + 0.06, p0[1]), (p1[0], deck_y(11.5) + 0.06, p1[1]), 0.22, 0.14)
    for _ in range(60):
        rr, a = 3.4 + rnd.random() * 8, rnd.random() * 2 * math.pi
        x, z = polar(rr, a)
        m.box(rnd.choice(['hull', 'hull', 'xwhite', 'gun']), [0.2 + rnd.random() * 0.6, 0.08 + rnd.random() * 0.2, 0.2 + rnd.random() * 0.7], [x, deck_y(rr) + 0.02, z], rot_y=a, bevel=0.02)

    # ------------------------------------------------------------ core hub and the two quad turrets
    m.cyl('gun', 2.7, 3.0, 0.4, [0, 2.2, 0], seg=28, bevel=0.04)
    m.cyl('xwhite', 1.5, 1.75, 0.6, [0, 2.55, 0], seg=20, bevel=0.04)
    m.sphere('glass', 0.78, [0, 3.1, 0], seg=16, rings=8, half='top')
    m.cyl('gun', 2.7, 3.0, 0.4, [0, -2.6, 0], seg=28, bevel=0.04)
    m.cyl('gun', 1.7, 1.5, 0.6, [0, -3.15, 0], seg=20, bevel=0.04)
    for sy in (1, -1):
        m.box('dark', [0.9, 0.5, 0.8], [0, sy * 3.2 - 0.25, 0.35], bevel=0.06)
        for dx, dy in ((-0.28, 0.14), (0.28, 0.14), (-0.28, -0.14), (0.28, -0.14)):
            m.beam('gun', (dx, sy * 3.2 + dy, 0.4), (dx, sy * 3.2 + dy, 3.0), 0.12)
            m.beam('dark', (dx, sy * 3.2 + dy, 3.0), (dx, sy * 3.2 + dy, 3.25), 0.17)

    # ------------------------------------------------------------ six heat-exhaust vents on the aft deck
    for i in range(6):
        a = math.pi + (i - 2.5) * 0.29
        rr = 7.3 if i in (0, 5) else 8.1
        x, z = polar(rr, a)
        y = deck_y(rr)
        m.cyl('gun', 1.0, 1.08, 0.3, [x, y - 0.1, z], seg=20, bevel=0.03)
        m.cyl('dark', 0.8, 0.8, 0.26, [x, y, z], seg=18)
        for k in range(3):
            m.box('gun', [1.5, 0.06, 0.1], [x, y + 0.22, z + (k - 1) * 0.42], rot_y=a, bevel=0.01)

    # ------------------------------------------------------------ mandibles and the bay between them
    outline = [(1.05, 8.2), (6.3, 8.6), (5.3, 13.0), (3.5, 20.6), (1.05, 20.6)]
    for sx in (1, -1):
        o = [(sx * x, z) for x, z in outline]
        if sx < 0:
            o.reverse()
        m.prism('xwhite', o, -0.75, 1.5, bevel=0.1)
        inset = [(sx * x, z) for x, z in [(1.4, 11.0), (4.6, 11.4), (3.3, 19.4), (1.4, 19.4)]]
        if sx < 0:
            inset.reverse()
        m.prism('gun', inset, 0.74, 0.08, bevel=0.02)
        m.prism('gun', inset, -0.82, 0.08, bevel=0.02)
        strip = [(sx * x, z) for x, z in [(1.55, 12.2), (3.2, 12.4), (2.9, 14.6), (1.55, 14.6)]]
        if sx < 0:
            strip.reverse()
        m.prism('stripe', strip, 0.8, 0.06)
        for k in range(9):                                               # machinery along the inner faces and on top
            m.box(rnd.choice(['dark', 'gun']), [0.3 + rnd.random() * 0.25, 0.4 + rnd.random() * 0.5, 0.5 + rnd.random() * 0.4], [sx * 1.0, -0.45, 13.6 + k * 0.76], bevel=0.03)
            m.box(rnd.choice(['dark', 'gun', 'hull']), [0.3 + rnd.random() * 0.6, 0.1 + rnd.random() * 0.12, 0.3 + rnd.random() * 0.7], [sx * (1.7 + rnd.random() * 1.4), 0.8, 15 + rnd.random() * 4], bevel=0.02)
        m.beam('gun', (sx * 2.3, 0, 20.4), (sx * 2.3, 0, 21.6), 0.34)           # tip emitters
        m.beam('dark', (sx * 2.3, 0, 21.6), (sx * 2.3, 0, 21.9), 0.2)
    m.box('gun', [2.1, 1.0, 5.4], [0, -0.5, 10.6], bevel=0.08)
    for i in range(5):
        m.box('dark', [1.7, 1.1, 0.45], [0, -0.55, 8.8 + i * 0.95], bevel=0.04)
        m.box('gun', [0.5, 0.3, 0.3], [(-1) ** i * 0.5, 0.5, 9.2 + i * 0.95], bevel=0.03)

    # ------------------------------------------------------------ cockpit (starboard = -x): arm, tube, glazed cone
    m.box('xwhite', [6.6, 1.9, 3.3], [-8.7, -0.7, 5.3], rot_y=0.55, bevel=0.25)
    m.box('gun', [3.0, 0.12, 1.6], [-8.4, 1.2, 5.5], rot_y=0.55, bevel=0.03)
    m.lathe_z('xwhite', -11.3, 0.3, [(3.2, 1.3), (11.6, 1.3)], seg=22)
    for z in (4.4, 8.0, 11.4):
        m.lathe_z('gun', -11.3, 0.3, [(z - 0.22, 1.37), (z + 0.22, 1.37)], seg=22, bevel=0.02)
    m.lathe_z('glass', -11.3, 0.3, [(11.6, 1.28), (13.9, 0.62)], seg=16)
    m.lathe_z('dark', -11.3, 0.3, [(13.9, 0.64), (14.0, 0.6)], seg=16)
    for i in range(8):                                                   # canopy frame
        a = 2 * math.pi * i / 8
        c, s = math.cos(a), math.sin(a)
        m.beam('gun', (-11.3 + c * 1.3, 0.3 + s * 1.3, 11.6), (-11.3 + c * 0.65, 0.3 + s * 0.65, 13.9), 0.09)
    m.lathe_z('gun', -11.3, 0.3, [(12.6, 0.99), (12.72, 0.96)], seg=16)

    # ------------------------------------------------------------ sensor dish (port, forward)
    dx, dz = 5.2, 5.6
    dy = deck_y(math.hypot(dx, dz))
    m.cyl('gun', 0.55, 0.78, 0.5, [dx, dy - 0.05, dz], seg=12, bevel=0.03)
    m.cyl('gun', 0.2, 0.24, 1.5, [dx, dy + 0.4, dz], seg=8)
    m.dish('xwhite', 2.3, 0.75, [dx, dy + 2.2, dz + 0.3], tilt_x=1.05, seg=24)
    m.beam('gun', (dx, dy + 2.2, dz + 0.3), (dx, dy + 2.85, dz + 1.45), 0.14)

    # ------------------------------------------------------------ docking rings, port and starboard
    for sx in (1, -1):
        m.box('xwhite', [2.6, 2.0, 4.2], [sx * 11.6, -1.0, -0.6], bevel=0.22)
        tube_x(m, 'gun', 1.5, sx * 12.7, sx * 13.45, 0, -0.6, bevel=0.04)
        tube_x(m, 'dark', 1.05, sx * 13.3, sx * 13.52, 0, -0.6)
        for k in range(6):
            a = 2 * math.pi * k / 6
            m.box('gun', [0.2, 0.3, 0.3], [sx * 13.3, math.cos(a) * 1.25 - 0.15, -0.6 + math.sin(a) * 1.25], bevel=0.02)
    # engine housing lips above and below the glow band (the glow itself is added in three.js)
    for sy in (1, -1):
        for i in range(30):
            a = math.pi - 0.92 + 1.84 * (i + 0.5) / 30
            x, z = polar(R + 0.1, a)
            m.box('gun', [0.82, 0.16, 0.34], [x, sy * 0.36 - 0.08, z], rot_y=a, bevel=0.02)
    return m


def main():
    a = bkit.args()
    out = os.path.abspath(a.get('out', 'frontend/public/models'))
    prev = a.get('preview')
    os.makedirs(out, exist_ok=True)
    bkit.reset()
    bkit.TILE = 5.0
    m = build()
    ob = m.to_object()
    print(f'[freighter] {m.tris} triangles, materials {m.mats}')
    bkit.lightmap_unwrap(ob, margin=0.002)
    img = bkit.bake_ao(ob, os.path.join(out, 'freighter_ao.jpg'), size=int(a.get('size', '2048')), samples=int(a.get('samples', '48')),
                       distance=2.5, ground=False)
    bkit.export_glb(ob, os.path.join(out, 'freighter.glb'))
    if prev:
        os.makedirs(prev, exist_ok=True)
        bkit.PREVIEW_COLORS.update({'xwhite': (0.78, 0.76, 0.7), 'gun': (0.3, 0.31, 0.33), 'stripe': (0.5, 0.2, 0.13)})
        bkit.preview(ob, img, os.path.join(os.path.abspath(prev), 'freighter.png'), (17, 14, 30), (-1, 0, 4), ground=False, lens=40)
    print('[freighter] done')


main()
