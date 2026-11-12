"""Desert sail barge: hero model (original interpretation of a crime lord's pleasure craft).

Run (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/sailbarge.py -- --out frontend/public/models --preview <dir>

Modelled around the keel line amidships, bow towards +Z, up +Y, metres (three.js coordinates), to match
frontend/src/aircraft/models/SailBarge.tsx. Material names: hull (planking), gun (dark timber and iron), dark,
stripe (sailcloth), lamp (lit lanterns and cabin windows).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import Model  # noqa: E402

HULL = [(-16, 6.2, 1.0, 5.4, 1.1), (-10, 8.6, 0.0, 5.8, 1.5), (4, 9.0, -0.3, 5.5, 1.5), (11, 6.2, 0.5, 4.9, 1.2), (16.5, 1.7, 1.9, 4.0, 0.5)]
Z = (0, 0, 1)
DECK = 5.9


def section_at(z):
    """Hull section (width, y_bottom, y_top) at station z."""
    z = max(HULL[0][0], min(HULL[-1][0], z))
    for a, c in zip(HULL[:-1], HULL[1:]):
        if a[0] <= z <= c[0]:
            k = (z - a[0]) / (c[0] - a[0])
            return tuple(a[i] + (c[i] - a[i]) * k for i in (1, 2, 3))
    return HULL[-1][1:4]


def side_yaw(z, sx):
    for a, c in zip(HULL[:-1], HULL[1:]):
        if a[0] <= z <= c[0]:
            return math.atan(sx * (c[1] - a[1]) / 2 / (c[0] - a[0]))
    return 0.0


def build():
    m = Model('sailbarge')
    rnd = random.Random(1983)

    # ------------------------------------------------------------ hull, prow, keel
    m.hull_z('hull', HULL, bevel=0.1)
    m.hull_z('gun', [(13.5, 4.4, 1.0, 2.0, 0.4), (17.2, 0.9, 2.2, 2.8, 0.2)], bevel=0.05)
    m.box('gun', [1.6, 0.7, 26], [0, -0.45, -1.5], bevel=0.2)
    m.tube('gun', (0, 2.6, 17.0), (0, 3.4, 19.4), 0.16, 0.05, seg=8)                    # bowsprit
    for sx in (1, -1):
        # strakes that follow the sheer of the hull, from stern to bow
        for f, w in ((0.24, 0.16), (0.36, 0.1), (0.76, 0.24), (0.9, 0.12)):
            pts = [(sx * (s[1] / 2 + 0.03), s[2] + f * (s[3] - s[2]), s[0]) for s in HULL]
            for p0, p1 in zip(pts[:-1], pts[1:]):
                m.beam('gun', p0, p1, w, 0.16)
        # hull ribs between the strakes
        for z in range(-14, 15, 2):
            w, yb, yt = section_at(z + 0.9)
            m.box('gun', [0.12, (yt - yb) * 0.2, 0.14], [sx * (w / 2 + 0.02), yb + (yt - yb) * 0.14, z + 0.9], rot_y=side_yaw(z + 0.9, sx), bevel=0.02)
        # shuttered windows: frame, dark opening, slats; every third one is lit
        for i in range(9):
            z = -10 + i * 2.5
            w, yb, yt = section_at(z)
            x, yaw = sx * (w / 2 + 0.02), side_yaw(z, sx)
            m.box('gun', [0.2, 1.25, 1.8], [x, 2.68, z], rot_y=yaw, bevel=0.04)
            m.box('lamp' if i % 3 == 1 else 'dark', [0.24, 0.95, 1.5], [x, 2.83, z], rot_y=yaw)
            for k in range(4):
                m.box('gun', [0.34, 0.07, 1.5], [x, 2.92 + k * 0.23, z], rot_y=yaw)
        # deck rail: turned balusters, top and lower rails, lantern posts
        rail = [(sx * 3.9, -11.0), (sx * 3.95, -2.0), (sx * 3.95, 5.0), (sx * 3.0, 11.6)]
        for (x0, z0), (x1, z1) in zip(rail[:-1], rail[1:]):
            m.tube('gun', (x0, DECK + 1.15, z0), (x1, DECK + 1.15, z1), 0.09, seg=8)
            m.tube('gun', (x0, DECK + 0.55, z0), (x1, DECK + 0.55, z1), 0.05, seg=6)
            n = max(2, int(abs(z1 - z0) / 0.9))
            for k in range(n):
                t = k / n
                x, z = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
                m.lathe('gun', (x, DECK, z), (0, 1, 0), [(0, 0.07), (0.3, 0.1), (0.6, 0.05), (0.9, 0.09), (1.15, 0.06)], seg=6)
        for z in (-6.5, 1.5, 8.5):
            x = sx * (3.95 if z < 5 else 3.5)
            m.tube('gun', (x, DECK + 1.1, z), (x, DECK + 2.1, z), 0.05, seg=6)
            m.box('lamp', [0.26, 0.3, 0.26], [x, DECK + 2.1, z], bevel=0.04)
            m.box('gun', [0.34, 0.06, 0.34], [x, DECK + 2.4, z])
        # steering vanes at the stern, with ribs
        vane = [(-19.5, 2.4), (-15.5, 2.0), (-15.5, 5.2), (-18.6, 6.4)]
        m.loft('gun', [[(sx * 2.6 - 0.15, y, z) for z, y in vane], [(sx * 2.6 + 0.15, y, z) for z, y in vane]], bevel=0.05)
        for k in range(3):
            m.beam('dark', (sx * 2.6, 2.6 + k * 1.1, -19.0 + k * 0.2), (sx * 2.6, 2.4 + k * 1.1, -15.6), 0.42, 0.12)
        # repulsor pods under the hull: housing, end collars, cooling fins
        for z in (-9, 5):
            m.lathe('dark', (sx * 2.6, 0.0, z - 2.25), Z, [(0, 0.5), (0.3, 0.9), (4.2, 0.9), (4.5, 0.5)], seg=14)
            for dz in (-1.6, 1.6):
                m.lathe('gun', (sx * 2.6, 0.0, z + dz - 0.15), Z, [(0, 0.96), (0.3, 0.96)], seg=14, bevel=0.03)
            for k in range(5):
                m.box('gun', [0.1, 0.5, 0.5], [sx * 2.6, -1.2, z - 1.0 + k * 0.5], bevel=0.02)

    # ------------------------------------------------------------ upper deck: planks, hatch, cargo
    m.box('gun', [7.8, 0.3, 25], [0, 5.6, -1.5], bevel=0.08)
    for i in range(13):                                                      # deck planks
        x = -3.6 + i * 0.6
        m.box('hull', [0.52, 0.05, 23.6], [x, DECK - 0.01, -1.6])
    m.box('gun', [2.4, 0.22, 2.8], [0, DECK, 2.0], bevel=0.05)               # cargo hatch
    for k in range(5):
        m.box('dark', [2.0, 0.08, 0.3], [0, DECK + 0.22, 1.0 + k * 0.5])
    for _ in range(9):                                                       # crates and casks
        x, z = (rnd.random() * 2 - 1) * 2.9, -5.5 + rnd.random() * 4.5
        if abs(x) < 0.9:
            continue
        if rnd.random() < 0.5:
            s = 0.6 + rnd.random() * 0.5
            m.box(rnd.choice(['hull', 'gun']), [s, s * 0.8, s], [x, DECK + 0.04, z], rot_y=rnd.random(), bevel=0.04)
        else:
            m.lathe('hull', (x, DECK + 0.04, z), (0, 1, 0), [(0, 0.26), (0.4, 0.34), (0.8, 0.26)], seg=10)
    # ------------------------------------------------------------ stern cabin: panelled walls, lit windows, door, roof terrace
    m.box('hull', [6.6, 2.7, 7.4], [0, 5.85, -11], bevel=0.3)
    m.box('gun', [7.0, 0.35, 7.9], [0, 8.52, -11], bevel=0.1)
    for sx in (1, -1):
        for i in range(3):
            z = -13 + i * 2.1
            m.box('gun', [0.16, 1.2, 1.6], [sx * 3.3, 6.7, z], bevel=0.04)
            m.box('lamp', [0.2, 0.9, 1.3], [sx * 3.33, 6.85, z])
            m.box('gun', [0.26, 0.9, 0.08], [sx * 3.33, 6.85, z])
            m.box('gun', [0.26, 0.08, 1.3], [sx * 3.33, 7.26, z])
        for z in (-14.4, -7.6):
            m.box('gun', [0.3, 2.7, 0.3], [sx * 3.2, 5.85, z], bevel=0.05)
        m.tube('gun', (sx * 3.3, 9.6, -14.6), (sx * 3.3, 9.6, -7.3), 0.07, seg=6)
        for k in range(7):
            m.tube('gun', (sx * 3.3, 8.87, -14.6 + k * 1.2), (sx * 3.3, 9.6, -14.6 + k * 1.2), 0.05, seg=5)
    m.box('gun', [1.5, 2.2, 0.16], [0, 5.9, -7.28], bevel=0.04)              # door and its lit fanlight
    m.box('dark', [1.2, 1.9, 0.2], [0, 5.95, -7.27])
    for sx in (1, -1):
        m.box('lamp', [1.1, 0.8, 0.14], [sx * 2.0, 6.9, -7.28])
        m.box('gun', [1.3, 1.0, 0.1], [sx * 2.0, 6.8, -7.3], bevel=0.03)
    m.tube('gun', (-3.3, 9.6, -14.6), (3.3, 9.6, -14.6), 0.07, seg=6)
    m.box('lamp', [0.4, 0.5, 0.4], [0, 9.0, -14.9], bevel=0.06)              # stern lantern
    m.box('gun', [0.5, 0.08, 0.5], [0, 9.5, -14.9])
    # ------------------------------------------------------------ deck gun on the foredeck
    m.cyl('gun', 0.5, 0.7, 0.8, [0, DECK, 9], seg=12, bevel=0.04)
    m.box('gun', [0.7, 0.6, 1.0], [0, 6.6, 8.8], bevel=0.1)
    m.lathe('dark', (0, 6.9, 9.2), Z, [(0, 0.2), (0.3, 0.2), (0.3, 0.14), (2.6, 0.14), (2.6, 0.2), (3.0, 0.2), (3.0, 0.08)], seg=10)
    m.box('gun', [0.9, 0.7, 0.1], [0, 6.5, 9.5], bevel=0.03)                 # gun shield
    # ------------------------------------------------------------ masts, yards, sails draped over them, rigging
    for z0, h in ((-3, 9.2), (5.5, 7.8)):
        top = DECK + h
        m.lathe('dark', (0, DECK, z0), (0, 1, 0), [(0, 0.3), (0.4, 0.24), (h, 0.15), (h + 0.5, 0.06)], seg=10)
        m.lathe('gun', (0, DECK, z0), (0, 1, 0), [(0, 0.42), (0.3, 0.42), (0.36, 0.3)], seg=10)
        m.tube('dark', (-6.5, top, z0), (6.5, top - 0.0, z0), 0.11, seg=8)
        for sx in (1, -1):
            grid = []
            for i in range(8):
                u = i / 7
                row = []
                for j in range(13):
                    v = j / 12
                    x = sx * (0.25 + 6.1 * u)
                    zz = z0 + (v - 0.5) * 7.8 * (1 - 0.14 * u)
                    drape = abs(2 * v - 1) ** 1.6
                    y = top + 0.13 - 0.75 * u * u - (1.15 + 0.5 * u) * drape + 0.1 * math.sin(3 * math.pi * u) * math.sin(math.pi * v)
                    row.append((x, y, zz))
                grid.append(row)
            m.sheet('stripe', grid, 0.07)
            for row_i in (0, 3, 7):                                          # battens sewn into the cloth
                for p0, p1 in zip(grid[row_i][:-1], grid[row_i][1:]):
                    m.beam('dark', (p0[0], p0[1] + 0.05, p0[2]), (p1[0], p1[1] + 0.05, p1[2]), 0.07)
            for j in (0, 12):                                                # sheets from the sail corners down to the rail
                c = grid[7][j]
                m.tube('dark', c, (sx * 3.95, DECK + 1.15, c[2] + (0.9 if j else -0.9)), 0.03, seg=5)
                m.tube('dark', grid[0][j], (0, top + 0.4, z0), 0.03, seg=5)
            m.tube('dark', (sx * 6.5, top, z0), (0, top + 0.5, z0), 0.03, seg=5)
        # pennant at the masthead
        m.sheet('stripe', [[(0, top + 0.5, z0), (0, top + 0.5, z0 - 0.01)], [(0, top + 0.42, z0 - 1.6), (0, top + 0.2, z0 - 1.6)]], 0.03)
    m.tube('dark', (0, DECK + 9.6, -3), (0, DECK + 8.2, 5.5), 0.03, seg=5)   # stays
    m.tube('dark', (0, DECK + 8.2, 5.5), (0, 3.4, 19.3), 0.03, seg=5)
    m.tube('dark', (0, DECK + 9.6, -3), (0, 9.6, -14.6), 0.03, seg=5)
    return m


def main():
    a = bkit.args()
    out = os.path.abspath(a.get('out', 'frontend/public/models'))
    prev = a.get('preview')
    os.makedirs(out, exist_ok=True)
    bkit.reset()
    bkit.TILE = 6.0
    m = build()
    ob = m.to_object()
    print(f'[sailbarge] {m.tris} triangles, materials {m.mats}')
    bkit.lightmap_unwrap(ob, margin=0.002)
    img = bkit.bake_ao(ob, os.path.join(out, 'sailbarge_ao.jpg'), size=int(a.get('size', '2048')), samples=int(a.get('samples', '48')),
                       distance=3.0, ground=False)
    bkit.export_glb(ob, os.path.join(out, 'sailbarge.glb'))
    if prev:
        os.makedirs(prev, exist_ok=True)
        bkit.PREVIEW_COLORS.update({'hull': (0.45, 0.28, 0.15), 'gun': (0.25, 0.17, 0.1), 'dark': (0.05, 0.04, 0.03), 'stripe': (0.72, 0.36, 0.1)})
        bkit.EMISSIVE['lamp'] = ((1.0, 0.7, 0.35), 8.0)
        bkit.preview(ob, img, os.path.join(os.path.abspath(prev), 'sailbarge.png'), (24, 17, 30), (0, 6, 0), ground=False, lens=38)
    print('[sailbarge] done')


main()
