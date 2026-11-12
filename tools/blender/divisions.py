"""The eight division buildings: hero models (original designs), one GLB each, in WORLD coordinates.

Run (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/divisions.py -- --out frontend/public/models --preview <dir>
Add `--only security` to build a single one.

Exports div_intelligence, div_engineering, div_operations, div_research, div_security, div_bunker, div_quarters and
div_transport. Positions and footprints are the FACILITIES entries in frontend/src/world/layout.ts, so each model
drops in where the code-built building stood (frontend/src/world/Structures.tsx keeps those as fallbacks).
Material names are the world MAT keys: hull, dark, light, black, concrete, glass, windows, stripe, rust and the
lights red, amber, holo, whiteLight.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import Model, rect  # noqa: E402

Y = (0, 1, 0)
X = (1, 0, 0)
Z = (0, 0, 1)
# id: (x, z, sx, sz)
F = {'intelligence': (200, -95, 92, 70), 'engineering': (200, 105, 104, 82), 'operations': (10, 215, 96, 62), 'research': (-70, -225, 84, 72),
     'security': (285, -235, 56, 56), 'bunker': (105, -230, 46, 34), 'quarters': (-227, 257, 120, 64), 'transport': (254, 244, 90, 64)}


# ------------------------------------------------------------------ shared building vocabulary
def block(m, mat, cx, cz, w, d, y0, h, top=None, bevel=0.15):
    """Rectangular storey; top=(w, d) tapers it."""
    m.prism(mat, rect(w, d, cx, cz), y0, h, rect(top[0], top[1], cx, cz) if top else None, bevel=bevel)


def ledge(m, cx, cz, w, d, y, t=0.8, out=0.7, mat='dark'):
    m.prism(mat, rect(w + 2 * out, d + 2 * out, cx, cz), y, t, bevel=0.1)


def band(m, cx, cz, w, d, y, h, step=6.0):
    """Lit window band round a storey: dark recess, glazing, and mullions every `step` metres."""
    m.prism('black', rect(w + 0.3, d + 0.3, cx, cz), y - 0.4, h + 0.8)
    m.prism('windows', rect(w + 0.5, d + 0.5, cx, cz), y, h)
    nx, nz = max(2, round(w / step)), max(2, round(d / step))
    for i in range(nx + 1):
        x = cx - w / 2 + w * i / nx
        for s in (-1, 1):
            m.box('dark', [0.9, h + 1.2, 0.8], [x, y - 0.6, cz + s * (d / 2 + 0.3)], bevel=0.06)
    for i in range(1, nz):
        z = cz - d / 2 + d * i / nz
        for s in (-1, 1):
            m.box('dark', [0.8, h + 1.2, 0.9], [cx + s * (w / 2 + 0.3), y - 0.6, z], bevel=0.06)


def strip(m, mat, cx, cz, w, d, y, t=0.35):
    """Thin light strip round a storey."""
    for s in (-1, 1):
        m.box(mat, [w + 0.3, t, 0.3], [cx, y, cz + s * d / 2])
        m.box(mat, [0.3, t, d + 0.3], [cx + s * w / 2, y, cz])


def fins(m, cx, cz, w, d, y0, h, step, depth=1.6, width=1.6, mat='dark', sides='nsew'):
    """Vertical buttress fins along the chosen faces."""
    if 'n' in sides or 's' in sides:
        n = max(1, round(w / step))
        for i in range(n + 1):
            x = cx - w / 2 + w * i / n
            for s, key in ((1, 'n'), (-1, 's')):
                if key in sides:
                    m.box(mat, [width, h, depth], [x, y0, cz + s * (d / 2 + depth / 2 - 0.2)], bevel=0.1)
    if 'e' in sides or 'w' in sides:
        n = max(1, round(d / step))
        for i in range(n + 1):
            z = cz - d / 2 + d * i / n
            for s, key in ((1, 'e'), (-1, 'w')):
                if key in sides:
                    m.box(mat, [depth, h, width], [cx + s * (w / 2 + depth / 2 - 0.2), y0, z], bevel=0.1)


def parapet(m, cx, cz, w, d, y, h=1.2, t=0.8, mat='dark'):
    for s in (-1, 1):
        m.box(mat, [w, h, t], [cx, y, cz + s * (d / 2 - t / 2)], bevel=0.06)
        m.box(mat, [t, h, d], [cx + s * (w / 2 - t / 2), y, cz], bevel=0.06)


def clutter(m, rnd, cx, cz, w, d, y, n, keep=None):
    """Roof plant: air handlers with fans, vent stacks, pipe runs. keep=(x, z, r) leaves a circle clear."""
    for _ in range(n):
        x, z = cx + (rnd.random() - 0.5) * (w - 6), cz + (rnd.random() - 0.5) * (d - 6)
        if keep and math.hypot(x - keep[0], z - keep[1]) < keep[2]:
            continue
        k = rnd.random()
        if k < 0.45:
            m.box('dark', [5.0, 1.8, 3.2], [x, y, z], rot_y=rnd.choice([0, math.pi / 2]), bevel=0.1)
            m.cyl('black', 1.0, 1.0, 0.3, [x - 1.2, y + 1.8, z], seg=10)
            m.cyl('black', 1.0, 1.0, 0.3, [x + 1.2, y + 1.8, z], seg=10)
        elif k < 0.75:
            m.cyl('dark', 1.1, 1.4, 2.6, [x, y, z], seg=10, bevel=0.06)
            m.cyl('black', 0.9, 0.9, 0.3, [x, y + 2.6, z], seg=10)
        else:
            m.tube('dark', (x - 4, y + 0.5, z), (x + 4, y + 0.5, z), 0.3, seg=8)
            m.box('black', [0.8, 0.9, 0.8], [x, y, z], bevel=0.05)


def doorway(m, x, z, face, w, h, accent='amber'):
    """Entrance on a wall face ('w', 'e', 'n', 's' = which way it looks): recessed door, frame, canopy, steps, lights."""
    dx, dz = {'w': (-1, 0), 'e': (1, 0), 'n': (0, 1), 's': (0, -1)}[face]
    along_x = dz != 0
    size = lambda a, hh, t: [a, hh, t] if along_x else [t, hh, a]
    px, pz = x + dx * 1.2, z + dz * 1.2
    m.box('black', size(w, h, 2.6), [px, 0, pz])
    for s in (-1, 1):
        jx, jz = (px + s * (w / 2 + 0.8), pz) if along_x else (px, pz + s * (w / 2 + 0.8))
        m.box('dark', size(1.6, h + 1.6, 3.4), [jx, 0, jz], bevel=0.12)
        m.box('amber', [0.4, 0.4, 0.4], [jx + dx * 1.8, h * 0.6, jz + dz * 1.8])
    m.box('dark', size(w + 3.6, 1.4, 4.4), [px + dx * 0.5, h + 0.2, pz + dz * 0.5], bevel=0.12)       # canopy
    m.box(accent, size(w, 0.3, 0.3), [px + dx * 2.7, h + 0.4, pz + dz * 2.7])
    for i in range(3):                                                                              # steps
        m.box('concrete', size(w + 4 - i * 0.8, 0.35, 2.2), [px + dx * (2.6 + (2 - i) * 1.0), i * 0.35, pz + dz * (2.6 + (2 - i) * 1.0)])


def mast(m, x, y, z, h, arms=2):
    m.tube('black', (x, y, z), (x, y + h, z), 0.28, 0.1, seg=6)
    for i in range(arms):
        yy = y + h * (0.5 + 0.2 * i)
        m.tube('black', (x - 1.4, yy, z), (x + 1.4, yy, z), 0.07, seg=5)
    m.box('red', [0.6, 0.6, 0.6], [x, y + h, z])


# ------------------------------------------------------------------ the buildings
def intelligence():
    x, z, sx, sz = F['intelligence']
    m = Model('div_intelligence')
    rnd = random.Random(11)
    ledge(m, x, z, sx, sz, 0, t=1.4, out=1.0)
    # battered base in three tiers, each a little narrower, with window bands in the recesses between them
    tiers = [(0, 5.0, 1.0, 0.975), (8.2, 5.0, 0.93, 0.905), (16.2, 7.8, 0.86, 0.78)]
    for y0, h, k0, k1 in tiers:
        m.prism('hull', rect(sx * k0, sz * (k0 - 0.02), x, z), y0, h, rect(sx * k1, sz * (k1 - 0.03), x, z), bevel=0.2)
    band(m, x, z, sx * 0.955, sz * 0.925, 5.4, 2.4)
    band(m, x, z, sx * 0.885, sz * 0.85, 13.4, 2.4)
    for sxn in (-1, 1):                                                       # sloped corner buttresses
        for szn in (-1, 1):
            cx, cz = x + sxn * sx * 0.47, z + szn * sz * 0.46
            m.prism('dark', rect(7, 7, cx, cz), 0, 24, rect(4, 4, cx - sxn * 8.5, cz - szn * 6.6), bevel=0.2)
    ledge(m, x, z, sx * 0.78, sz * 0.72, 24, t=0.8, out=0.6)
    parapet(m, x, z, sx * 0.78, sz * 0.72, 24.8)
    # upper block: analysis floors under a lit cornice
    block(m, 'dark', x, z, 50, 38, 24, 10)
    band(m, x, z, 50, 38, 27.6, 2.4)
    ledge(m, x, z, 50, 38, 33.4, t=0.7, out=0.5)
    strip(m, 'holo', x, z, 51.2, 39.2, 33.0)
    parapet(m, x, z, 50, 38, 34.1, h=1.0)
    # sensor tower: ribbed shaft, platform, radome
    tx = x + 12
    m.lathe('dark', (tx, 34, z), Y, [(0, 3.6), (1.0, 3.4), (28, 2.4), (30, 2.4)], seg=14)
    for k in range(6):
        m.ring('black', (tx, 38 + k * 4.4, z), Y, 3.2 - k * 0.15, 0.25, 0.12, seg=14)
    m.lathe('dark', (tx, 62.5, z), Y, [(0, 2.4), (0.6, 4.2), (1.4, 4.2), (1.4, 2.6)], seg=14)
    m.sphere('light', 3.0, [tx, 66.4, z], seg=18, rings=10, smooth=True)
    m.box('red', [0.9, 0.9, 0.9], [tx, 69.4, z])
    # dish array on pedestals, antenna farm, roof plant
    for i in range(3):
        dx, dz = x - 16 + i * 9, z - 10 + i * 4
        m.cyl('black', 0.9, 1.3, 3.0, [dx, 34.1, dz], seg=10, bevel=0.05)
        m.tube('black', (dx, 37, dz), (dx, 40.5, dz), 0.4, seg=8)
        m.dish('light', 5.5, 1.6, (dx, 41.5, dz), tilt_x=math.radians(-55), rot_y=0.6 * i + 0.4, seg=20)
    for i in range(6):
        mast(m, x - 20 + i * 4, 34.1, z + 15, 12 + (i % 3) * 4, arms=1 + i % 2)
    clutter(m, rnd, x, z, sx * 0.74, sz * 0.66, 24.8, 16, keep=(x, z, 33))
    doorway(m, x - sx / 2, z, 'w', 12, 7.5, accent='holo')
    return m


def engineering():
    x, z, sx, sz = F['engineering']
    m = Model('div_engineering')
    rnd = random.Random(22)
    ledge(m, x, z, sx, sz, 0, t=1.6, out=1.0)
    block(m, 'hull', x, z, sx, sz, 0, 22, bevel=0.2)
    band(m, x, z, sx, sz, 5, 2.6, step=9)
    band(m, x, z, sx, sz, 12, 2.6, step=9)
    fins(m, x, z, sx, sz, 0, 20.5, 9, depth=2.4, sides='ns')
    fins(m, x, z, sx, sz, 0, 20.5, 13, depth=2.0, sides='e')
    ledge(m, x, z, sx, sz, 20.4, t=1.0, out=1.4)
    strip(m, 'amber', x, z, sx + 3.0, sz + 3.0, 21.0)
    parapet(m, x, z, sx, sz, 22, h=1.4)
    # pipe runs along the north and south walls
    for s in (-1, 1):
        for yy in (8.6, 9.6, 16.4):
            m.tube('dark', (x - sx / 2 + 2, yy, z + s * (sz / 2 + 1.5)), (x + sx / 2 - 2, yy, z + s * (sz / 2 + 1.5)), 0.32, seg=8)
    # upper deck: control floor
    ux = x + 8
    block(m, 'dark', ux, z, sx * 0.6, sz * 0.55, 22, 8)
    band(m, ux, z, sx * 0.6, sz * 0.55, 24.6, 2.4, step=8)
    ledge(m, ux, z, sx * 0.6, sz * 0.55, 30, t=0.7, out=0.6)
    parapet(m, ux, z, sx * 0.6, sz * 0.55, 30.7, h=1.0)
    # coolant tanks with ribs, ladders and caps
    for i in range(4):
        tx, tz = x - 38 + (i % 2) * 12, z - 20 + (i // 2) * 40
        m.lathe('light', (tx, 22, tz), Y, [(0, 4.2), (0.4, 4.0), (4.6, 4.0), (5.4, 3.2), (5.8, 1.2)], seg=18, smooth=True)
        for yy in (23.4, 25.2):
            m.ring('dark', (tx, yy, tz), Y, 4.05, 0.2, 0.08, seg=18)
        m.cyl('black', 0.9, 1.0, 0.5, [tx, 27.7, tz], seg=10)
        m.tube('black', (tx + 4.2, 22, tz), (tx + 4.2, 27.2, tz), 0.08, seg=5)
    m.tube('dark', (x - 38, 23, z - 20), (x - 38, 23, z + 20), 0.5, seg=8)
    m.tube('dark', (x - 26, 23, z - 20), (x - 26, 23, z + 20), 0.5, seg=8)
    # exhaust stacks with bands and a cap, on a braced frame
    for sx0, sz0, hh in ((40, 30, 18), (44, 26, 15), (36, 27, 12)):
        m.lathe('dark', (x + sx0, 22, z + sz0), Y, [(0, 2.2), (0.8, 2.0), (hh - 1, 1.6), (hh, 1.9), (hh, 1.3), (hh - 1.5, 1.2)], seg=12)
        for k in range(3):
            m.ring('black', (x + sx0, 22 + hh * (0.3 + k * 0.25), z + sz0), Y, 1.9 - k * 0.1, 0.25, 0.1, seg=12)
    m.box('red', [0.8, 0.8, 0.8], [x + 40, 40.2, z + 30])
    for a, b_ in (((40, 30), (44, 26)), ((44, 26), (36, 27)), ((36, 27), (40, 30))):
        m.tube('black', (x + a[0], 30, z + a[1]), (x + b_[0], 30, z + b_[1]), 0.14, seg=5)
    # roof gantry crane over the service hatch
    for s in (-1, 1):
        m.box('dark', [1.2, 7, 1.2], [x - 2 + s * 0, 30.7, z + s * 16], bevel=0.08)
    m.box('stripe', [1.6, 1.2, 36], [x - 2, 37.7, z], bevel=0.08)
    m.box('black', [2.4, 1.4, 2.4], [x - 2, 36.4, z + 5], bevel=0.1)
    clutter(m, rnd, x + 8, z, sx * 0.5, sz * 0.45, 30.7, 8)
    clutter(m, rnd, x - 10, z, 30, sz * 0.8, 22, 10)
    doorway(m, x - sx / 2, z, 'w', 14, 7.5, accent='amber')
    return m


def hex_outline(w, d, cx, cz):
    c = min(w, d) * 0.28
    return [(cx - w / 2 + c, cz - d / 2), (cx + w / 2 - c, cz - d / 2), (cx + w / 2, cz), (cx + w / 2 - c, cz + d / 2), (cx - w / 2 + c, cz + d / 2), (cx - w / 2, cz)]


def operations():
    x, z, sx, sz = F['operations']
    m = Model('div_operations')
    m.prism('dark', hex_outline(sx + 2.4, sz + 2.4, x, z), 0, 1.6, bevel=0.15)
    # hexagonal hall in three storeys with glazed recesses between them
    for y0, h in ((1.6, 4.2), (8.8, 3.0), (14.8, 3.2)):
        m.prism('hull', hex_outline(sx, sz, x, z), y0, h, bevel=0.15)
    for y0 in (5.8, 11.8):
        m.prism('black', hex_outline(sx - 0.8, sz - 0.8, x, z), y0, 3.0)
        m.prism('windows', hex_outline(sx - 0.4, sz - 0.4, x, z), y0 + 0.2, 2.6)
    o = hex_outline(sx + 0.9, sz + 0.9, x, z)
    for i, (ax, az) in enumerate(o):
        bx, bz = o[(i + 1) % 6]
        # corner pylon, mullions along the wall, red cornice light
        m.prism('dark', rect(4.6, 4.6, ax, az), 0, 19.6, rect(3.0, 3.0, ax, az), bevel=0.15)
        m.box('red', [0.7, 0.7, 0.7], [ax, 19.7, az])
        L = math.hypot(bx - ax, bz - az)
        ang = -math.atan2(bz - az, bx - ax)
        n = max(2, round(L / 7))
        for k in range(1, n):
            px, pz = ax + (bx - ax) * k / n, az + (bz - az) * k / n
            m.box('dark', [1.0, 17.6, 1.2], [px, 1.2, pz], rot_y=ang, bevel=0.06)
        m.box('red', [L - 4, 0.35, 0.3], [(ax + bx) / 2, 18.1, (az + bz) / 2], rot_y=ang)
    m.prism('dark', hex_outline(sx + 1.6, sz + 1.6, x, z), 18.0, 0.9, bevel=0.1)
    # mission-control drum: ribbed base, glazed observation ring, cap, holo rings and a mast
    m.lathe('dark', (x, 18.9, z), Y, [(0, 14.5), (1.0, 14.0), (8.6, 12.2), (9.3, 12.8), (10.0, 12.2)], seg=28)
    for k in range(14):
        a = 2 * math.pi * k / 14
        m.beam('black', (x + math.cos(a) * 14.1, 19.6, z + math.sin(a) * 14.1), (x + math.cos(a) * 12.4, 27.4, z + math.sin(a) * 12.4), 0.9, 0.7)
    m.lathe('glass', (x, 28.9, z), Y, [(0, 10.6), (3.0, 10.6)], seg=28)
    for k in range(14):
        a = 2 * math.pi * (k + 0.5) / 14
        m.box('dark', [0.5, 3.0, 0.5], [x + math.cos(a) * 10.7, 28.9, z + math.sin(a) * 10.7], rot_y=-a, bevel=0.04)
    m.lathe('dark', (x, 31.9, z), Y, [(0, 12.0), (0.6, 12.0), (1.6, 8.0), (2.2, 3.0)], seg=28)
    m.ring('holo', (x, 33.4, z), Y, 9.0, 0.3, 0.3, seg=40)
    m.ring('holo', (x, 35.8, z), Y, 6.0, 0.22, 0.22, seg=32)
    mast(m, x, 34.1, z, 9, arms=2)
    doorway(m, x, z - sz / 2, 's', 14, 7.5, accent='red')
    return m


def research():
    x, z, sx, sz = F['research']
    m = Model('div_research')
    rnd = random.Random(44)
    ledge(m, x, z, sx, sz, 0, t=1.2, out=1.0)
    block(m, 'dark', x, z, sx, sz, 0, 6, bevel=0.15)
    band(m, x, z, sx, sz, 2.2, 2.0, step=7)
    ledge(m, x, z, sx, sz, 5.6, t=0.6, out=0.6)
    parapet(m, x, z, sx, sz, 6.2, h=1.0)
    domes = [(-14, 6, 19), (18, -10, 15), (16, 18, 12)]
    for dx, dz, r in domes:
        cx, cz = x + dx, z + dz
        m.lathe('dark', (cx, 6, cz), Y, [(0, r + 1.2), (0.9, r + 1.2), (1.4, r + 0.3)], seg=32)                 # drum
        m.sphere('light', r, [cx, 6.6, cz], seg=32, rings=16, half='top', smooth=True)
        m.ring('holo', (cx, 7.3, cz), Y, r + 0.35, 0.3, 0.3, seg=40)
        for k in range(12):                                                                                    # meridian ribs
            a = 2 * math.pi * k / 12
            pts = [(cx + math.cos(a) * (r + 0.12) * math.sin(t), 6.6 + (r + 0.12) * math.cos(t), cz + math.sin(a) * (r + 0.12) * math.sin(t))
                   for t in (math.pi / 2 - i * (math.pi / 2 - 0.28) / 6 for i in range(7))]
            for p0, p1 in zip(pts[:-1], pts[1:]):
                m.beam('dark', p0, p1, 0.35, 0.22)
        m.ring('dark', (cx, 6.6 + r * math.cos(0.28), cz), Y, r * math.sin(0.28) + 0.2, 0.3, 0.3, seg=20)       # oculus collar
        m.lathe('glass', (cx, 6.6 + r * math.cos(0.28) - 0.2, cz), Y, [(0, r * 0.27), (1.1, r * 0.22), (1.4, 0.1)], seg=16)
    # glazed link corridors between the domes, with hoops
    for (ax, az), (bx, bz) in (((-14, 6), (18, -10)), ((-14, 6), (16, 18)), ((18, -10), (16, 18))):
        p0, p1 = (x + ax, 9.0, z + az), (x + bx, 9.0, z + bz)
        m.tube('hull', p0, p1, 2.1, seg=12)
        for k in range(1, 6):
            t = 0.25 + k * 0.1
            m.ring('dark', tuple(p0[i] + (p1[i] - p0[i]) * t for i in range(3)), tuple(p1[i] - p0[i] for i in range(3)), 2.2, 0.2, 0.12, seg=12)
    # instrument yard: sample towers and coolers
    for i in range(4):
        m.lathe('light', (x - 34 + i * 4.2, 6.2, z - 28), Y, [(0, 1.5), (5 + i, 1.5), (5.6 + i, 0.8)], seg=12, smooth=True)
        m.ring('dark', (x - 34 + i * 4.2, 8.5, z - 28), Y, 1.55, 0.2, 0.08, seg=12)
    clutter(m, rnd, x + 28, z - 26, 22, 14, 6.2, 5)
    clutter(m, rnd, x - 28, z + 28, 22, 12, 6.2, 4)
    doorway(m, x, z + sz / 2, 'n', 12, 5.4, accent='holo')
    return m


def security():
    x, z, sx, sz = F['security']
    m = Model('div_security')
    ledge(m, x, z, sx, sz, 0, t=1.6, out=1.2)
    m.prism('dark', rect(sx, sz, x, z), 0, 16, rect(sx * 0.78, sz * 0.78, x, z), bevel=0.25)                    # battered keep
    for s1 in (-1, 1):
        for s2 in (-1, 1):                                                                                     # corner bastions with watch posts
            cx, cz = x + s1 * sx * 0.46, z + s2 * sz * 0.46
            m.prism('dark', rect(11, 11, cx, cz), 0, 18, rect(8, 8, cx - s1 * 3.0, cz - s2 * 3.0), bevel=0.2)
            m.prism('hull', rect(6.4, 6.4, cx - s1 * 3.0, cz - s2 * 3.0), 18, 3.2, bevel=0.12)
            m.prism('windows', rect(6.7, 6.7, cx - s1 * 3.0, cz - s2 * 3.0), 19.2, 0.9)
            m.prism('dark', rect(7.6, 7.6, cx - s1 * 3.0, cz - s2 * 3.0), 21.2, 0.7, bevel=0.1)
            m.box('red', [0.8, 0.8, 0.8], [cx - s1 * 3.0, 21.9, cz - s2 * 3.0])
    for k in range(5):                                                                                         # firing slits in the battered walls
        off = -16 + k * 8
        for s in (-1, 1):
            m.box('black', [3.4, 1.0, 1.4], [x + off, 8.5, z + s * (sz / 2 - 3.4)], bevel=0.05)
            m.box('black', [1.4, 1.0, 3.4], [x + s * (sx / 2 - 3.4), 8.5, z + off], bevel=0.05)
    strip(m, 'red', x, z, sx * 0.79, sz * 0.79, 15.7)
    ledge(m, x, z, sx * 0.78, sz * 0.78, 16, t=0.7, out=0.5)
    parapet(m, x, z, sx * 0.78, sz * 0.78, 16.7, h=1.4)
    # command block and roof turret
    block(m, 'hull', x, z, 30, 30, 16, 8)
    band(m, x, z, 30, 30, 19, 1.6, step=5)
    ledge(m, x, z, 30, 30, 23.6, t=0.6, out=0.5)
    m.lathe('dark', (x, 24.2, z), Y, [(0, 6.4), (0.8, 6.0), (3.0, 5.0), (3.4, 5.4), (3.8, 5.0)], seg=18)
    m.box('hull', [6.4, 3.2, 7.0], [x, 27.4, z], bevel=0.3)
    for s in (-1, 1):
        m.tube('black', (x + s * 1.5, 29.0, z + 3.0), (x + s * 1.5, 32.4, z + 15.5), 0.5, seg=10)
        m.tube('dark', (x + s * 1.5, 29.6, z + 5.0), (x + s * 1.5, 31.0, z + 10.5), 0.75, seg=10)
        m.tube('black', (x + s * 1.5, 32.4, z + 15.5), (x + s * 1.5, 32.8, z + 16.9), 0.7, seg=10)
    for s1, s2 in ((1, 1), (-1, -1)):                                                                          # searchlights
        m.cyl('black', 0.5, 0.7, 1.6, [x + s1 * 12, 24.2, z + s2 * 12], seg=8)
        m.cyl('whiteLight', 0.9, 0.9, 0.4, [x + s1 * 12, 25.8, z + s2 * 12], seg=10)
    # blast walls with hazard markings, and the entrance
    for dz_ in (-11, 0, 11):
        m.prism('concrete', rect(2.4, 9.4, x - sx / 2 - 10, z + dz_), 0, 4.2, rect(1.4, 9.4, x - sx / 2 - 10, z + dz_), bevel=0.1)
        m.box('stripe', [0.2, 0.8, 8.6], [x - sx / 2 - 11.2, 2.6, z + dz_])
    doorway(m, x - sx / 2, z, 'w', 9, 6.5, accent='red')
    return m


def bunker():
    x, z, sx, sz = F['bunker']
    m = Model('div_bunker')
    ledge(m, x, z, sx, sz, 0, t=1.0, out=1.4, mat='concrete')
    m.prism('dark', rect(sx, sz, x, z), 0, 7, rect(sx * 0.8, sz * 0.7, x, z), bevel=0.25)
    for k in range(7):                                                                                         # armour ribs up the glacis
        xx = x - sx * 0.36 + k * sx * 0.12
        for s in (-1, 1):
            m.beam('black', (xx, 0.4, z + s * (sz / 2 - 0.2)), (xx, 6.9, z + s * (sz * 0.35 - 0.2)), 0.9, 0.5)
    m.prism('black', rect(sx * 0.78, sz * 0.68, x, z), 7, 0.5, bevel=0.1)
    # blast door and ramp cut on the north side
    m.box('black', [14, 7, 4], [x, 0, z + sz / 2 - 1])
    m.box('dark', [16.4, 1.2, 5], [x, 7, z + sz / 2 - 0.6], bevel=0.12)
    m.box('stripe', [14.4, 0.6, 0.6], [x, 6.4, z + sz / 2 + 1.2])
    for k in range(5):
        m.box('dark', [0.5, 6.2, 0.3], [x - 5.6 + k * 2.8, 0.2, z + sz / 2 + 1.1])
    for s in (-1, 1):
        m.prism('concrete', rect(3, 18, x + s * 9, z + sz / 2 + 8), 0, 3.4, rect(2, 18, x + s * 9, z + sz / 2 + 8), bevel=0.1)
        m.box('stripe', [0.2, 0.7, 16], [x + s * 9 - s * 1.5, 2.0, z + sz / 2 + 8])
        m.box('amber', [0.8, 0.8, 0.8], [x + s * sx * 0.4, 7.4, z + sz * 0.33])
    # server heat: ventilation stacks with louvres, and a radiator bank
    for i in range(6):
        vx = x - 17.5 + i * 7
        hh = 5 + (i % 2) * 2
        m.lathe('hull', (vx, 7.4, z - 7.5), Y, [(0, 2.1), (0.5, 1.8), (hh, 1.5), (hh + 0.4, 1.9), (hh + 0.9, 1.9), (hh + 0.9, 1.3)], seg=12)
        for k in range(3):
            m.ring('black', (vx, 8.6 + k * 1.4, z - 7.5), Y, 1.75 - k * 0.07, 0.2, 0.08, seg=12)
    for i in range(12):
        m.box('light', [0.4, 3.8, 10], [x - 13.2 + i * 2.4, 7.5, z + 3.5], bevel=0.05)
    for zz in (-1.2, 8.2):
        m.box('dark', [29, 0.5, 0.6], [x, 7.5, z + zz], bevel=0.05)
        m.box('dark', [29, 0.5, 0.6], [x, 10.9, z + zz], bevel=0.05)
    m.tube('dark', (x - 17.5, 7.9, z - 7.5), (x - 13.2, 7.9, z + 3.5), 0.4, seg=8)
    return m


def quarters():
    x, z, sx, sz = F['quarters']
    m = Model('div_quarters')
    rnd = random.Random(77)
    ledge(m, x, z, sx, sz, 0, t=1.0, out=0.8)
    block(m, 'light', x, z, sx, sz, 0, 14, bevel=0.15)
    for y in (2, 6, 10):                                                                                       # three floors, each with a balcony ledge
        band(m, x, z, sx, sz, y, 1.8, step=6)
        ledge(m, x, z, sx, sz, y - 0.9, t=0.3, out=0.9, mat='hull')
    for s in (-1, 1):                                                                                          # stair towers at the ends
        block(m, 'hull', x + s * (sx / 2 + 2.5), z, 6, 12, 0, 17, bevel=0.15)
        m.box('windows', [0.4, 12, 1.6], [x + s * (sx / 2 + 5.6), 2.5, z])
        m.box('dark', [7, 0.8, 13], [x + s * (sx / 2 + 2.5), 17, z], bevel=0.1)
    ledge(m, x, z, sx, sz, 14, t=0.7, out=0.7)
    parapet(m, x, z, sx, sz, 14.7, h=1.1, mat='hull')
    ux, uz = x - 10, z + 4
    block(m, 'hull', ux, uz, sx * 0.7, sz * 0.6, 14, 10)
    for y in (16, 20):
        band(m, ux, uz, sx * 0.7, sz * 0.6, y, 1.6, step=6)
    ledge(m, ux, uz, sx * 0.7, sz * 0.6, 24, t=0.6, out=0.6)
    parapet(m, ux, uz, sx * 0.7, sz * 0.6, 24.6, h=1.0)
    for i in range(3):                                                                                         # water tanks and roof plant
        m.lathe('light', (ux - 24 + i * 8, 24.6, uz + 8), Y, [(0, 2.6), (3.4, 2.6), (4.2, 1.4)], seg=14, smooth=True)
        m.ring('dark', (ux - 24 + i * 8, 26.4, uz + 8), Y, 2.65, 0.2, 0.08, seg=14)
    clutter(m, rnd, ux + 14, uz - 4, 40, 22, 24.6, 9)
    clutter(m, rnd, x + 44, z + 4, 26, 40, 14.7, 6)
    # medical wing with a lit cross-bar and an ambulance canopy
    mx, mz = x + 50, z - 22
    block(m, 'light', mx, mz, 26, 24, 0, 10, bevel=0.15)
    band(m, mx, mz, 26, 24, 3.0, 2.0, step=5)
    ledge(m, mx, mz, 26, 24, 10, t=0.6, out=0.6)
    m.box('whiteLight', [26.4, 0.35, 0.3], [mx, 9.2, mz - 12.2])
    m.box('whiteLight', [1.2, 4.0, 0.3], [mx, 5.0, mz - 12.3])
    m.box('whiteLight', [4.0, 1.2, 0.3], [mx, 6.4, mz - 12.3])
    m.box('hull', [14, 0.6, 7], [mx, 4.6, mz - 15.5], bevel=0.1)
    for s in (-1, 1):
        m.tube('dark', (mx + s * 6, 0, mz - 18), (mx + s * 6, 4.6, mz - 18), 0.25, seg=8)
    doorway(m, x, z - sz / 2, 's', 11, 5.0, accent='whiteLight')
    return m


def container(m, mat, cx, y, cz, rot=0.0):
    """Cargo container: corrugated sides, end doors, corner castings."""
    m.box(mat, [7, 3.2, 3.2], [cx, y, cz], rot_y=rot, bevel=0.08)
    c, s = math.cos(rot), math.sin(rot)
    for k in range(9):
        dx = -3.2 + k * 0.8
        for side in (-1, 1):
            m.box('dark', [0.16, 2.6, 0.12], [cx + dx * c + side * 1.62 * s, y + 0.3, cz - dx * s + side * 1.62 * c], rot_y=rot)
    for side in (-1, 1):
        m.box('black', [0.1, 2.7, 2.7], [cx + side * 3.52 * c, y + 0.25, cz - side * 3.52 * s], rot_y=rot)


def transport():
    x, z, sx, sz = F['transport']
    m = Model('div_transport')
    rnd = random.Random(88)
    ledge(m, x, z, sx, sz, 0, t=1.0, out=0.8)
    block(m, 'hull', x, z, sx, sz, 0, 14, bevel=0.15)
    fins(m, x, z, sx, sz, 0, 13.2, 10, depth=1.6, sides='new')
    # five vehicle bays on the south face: frames, segmented doors, hazard headers, bay numbers in lights
    for i in range(5):
        bx, bz = x - 36 + i * 18, z - sz / 2
        m.box('black', [13, 10, 1.4], [bx, 0, bz - 0.1])
        for k in range(7):
            m.box('dark', [12.4, 1.1, 0.5], [bx, 0.3 + k * 1.38, bz - 0.7], bevel=0.05)
        for s in (-1, 1):
            m.box('dark', [1.4, 11.4, 2.2], [bx + s * 7.2, 0, bz - 0.9], bevel=0.1)
            m.box('stripe', [0.5, 3.0, 0.5], [bx + s * 7.2, 0, bz - 2.1])
        m.box('stripe', [13.6, 0.7, 1.2], [bx, 10.1, bz - 0.8], bevel=0.05)
        m.box('dark', [15.8, 1.0, 2.6], [bx, 11.0, bz - 1.1], bevel=0.1)
        m.box('amber', [0.5, 0.5, 0.5], [bx, 12.2, bz - 1.9])
    band(m, x, z, sx, sz, 12.2, 1.2, step=10)
    ledge(m, x, z, sx, sz, 13.6, t=0.8, out=0.9)
    strip(m, 'amber', x, z, sx + 2.0, sz + 2.0, 13.3)
    parapet(m, x, z, sx, sz, 14.4, h=1.2)
    # roof: skylights, vents, a dispatch cabin
    for i in range(5):
        m.prism('dark', rect(10, 26, x - 36 + i * 18, z + 4), 14.4, 1.6, rect(7, 23, x - 36 + i * 18, z + 4), bevel=0.1)
        m.prism('glass', rect(5.4, 21, x - 36 + i * 18, z + 4), 16.0, 0.25)
    block(m, 'dark', x + 30, z - 22, 16, 10, 14.4, 5)
    band(m, x + 30, z - 22, 16, 10, 16.4, 1.6, step=4)
    ledge(m, x + 30, z - 22, 16, 10, 19.4, t=0.6, out=0.6)
    mast(m, x + 34, 20, z - 22, 8)
    clutter(m, rnd, x, z + 24, sx - 10, 10, 14.4, 7)
    # gantry crane over the cargo yard: legs with bracing, bridge, trolley and hook
    gz = z - 60
    for s in (-1, 1):
        for dz_ in (-2.4, 2.4):
            m.box('dark', [1.2, 18, 1.2], [x + s * 30, 0, gz + dz_], bevel=0.1)
        m.box('dark', [1.6, 1.2, 7.4], [x + s * 30, 0, gz], bevel=0.1)
        m.box('dark', [1.6, 1.2, 7.4], [x + s * 30, 16.8, gz], bevel=0.1)
        m.beam('black', (x + s * 30, 1.2, gz - 2.4), (x + s * 30, 16.8, gz + 2.4), 0.4)
        m.beam('black', (x + s * 30, 1.2, gz + 2.4), (x + s * 30, 16.8, gz - 2.4), 0.4)
        m.box('amber', [0.5, 0.5, 0.5], [x + s * 30, 19.9, gz])
    for dz_ in (-1.6, 1.6):
        m.box('stripe', [63, 1.8, 0.8], [x, 18, gz + dz_], bevel=0.08)
    for k in range(12):
        m.box('dark', [0.5, 0.5, 3.2], [x - 27.5 + k * 5, 18.4, gz])
    m.box('black', [4.2, 1.6, 4.4], [x - 9, 19.0, gz], bevel=0.12)
    m.tube('black', (x - 9, 19.0, gz), (x - 9, 9.5, gz), 0.12, seg=5)
    m.box('stripe', [1.6, 1.0, 1.0], [x - 9, 8.6, gz], bevel=0.1)
    # cargo containers, some stacked
    for i in range(14):
        cx = x - 28 + (i % 7) * 9
        cz = z - 52 - (i // 7) * 14 + ((i * 7) % 3)
        container(m, ('rust', 'dark', 'light')[i % 3], cx, 0, cz, rot=(rnd.random() - 0.5) * 0.08)
        if i % 4 == 0:
            container(m, ('light', 'rust', 'dark')[i % 3], cx + 0.3, 3.2, cz, rot=(rnd.random() - 0.5) * 0.12)
    return m


BUILDERS = [intelligence, engineering, operations, research, security, bunker, quarters, transport]


def main():
    only = bkit.args().get('only')
    parts = [(b, 1536, 9.0) for b in BUILDERS if not only or b.__name__ == only]
    view = {'intelligence': ((90, 70, -210), (200, 22, -95)), 'engineering': ((80, 70, 240), (200, 14, 105)), 'operations': ((-90, 60, 110), (10, 14, 215)),
            'research': ((30, 55, -120), (-70, 8, -225)), 'security': ((200, 50, -330), (285, 10, -235)), 'bunker': ((60, 30, -170), (105, 4, -230)),
            'quarters': ((-120, 60, 150), (-215, 10, 250)), 'transport': ((160, 60, 130), (254, 6, 215))}[parts[-1][0].__name__]
    bkit.run('divisions', parts, tile=8.0, preview_view=(view[0], view[1], 35), ground=True)


main()
