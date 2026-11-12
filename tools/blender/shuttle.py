"""Imperial transport shuttle: hero model in two parts (original interpretation of a tri-wing landing shuttle:
tall dorsal fin, two folding lower wings).

Run (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/shuttle.py -- --out frontend/public/models --preview <dir>

The wings fold in code (frontend/src/aircraft/models/Shuttle.tsx), so the wing is its own GLB:
  shuttle_body  hull, nose, fin and engine block; origin = ground point under the hull centre, nose +Z
  shuttle_wing  one wing in its hinge frame: hinge line at the origin along Z, span +Y; the other is its mirror image
The landing gear, ramp, engine glow and running lights stay in code (they move or blink).
Material names are the aircraft MatKey names: hull, gun, dark, glass.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import Model  # noqa: E402

Z = (0, 0, 1)
HINGE_X, HINGE_Y, SPAN = 2.78, 5.05, 16.6
BODY = [(-7.3, 4.7, 2.55, 5.65, 0.6), (-6.6, 5.1, 2.25, 6.0, 0.75), (2.6, 5.1, 2.2, 6.0, 0.75), (4.4, 4.7, 2.2, 5.55, 0.65)]
NOSE = [(4.3, 3.9, 2.25, 5.2, 0.55), (7.2, 3.5, 2.3, 4.75, 0.5), (9.2, 2.5, 2.65, 3.85, 0.42), (9.9, 1.5, 3.0, 3.45, 0.25)]


def off_ring(z, w, yb, yt, c, x0):
    """Chamfered section like Model.ring_xy, shifted sideways by x0."""
    h = w / 2
    c = min(c, h * 0.9, (yt - yb) * 0.45)
    pts = [(h - c, yb), (h, yb + c), (h, yt - c), (h - c, yt), (-h + c, yt), (-h, yt - c), (-h, yb + c), (-h + c, yb)]
    return [(x0 + x, y, z) for x, y in pts]


def build_body():
    m = Model('shuttle_body')
    rnd = random.Random(1983)
    m.hull_z('hull', BODY, bevel=0.06)
    m.hull_z('hull', NOSE, bevel=0.05)
    for sx in (-1, 1):                                                       # cheek fairings blending the nose into the body
        m.loft('hull', [list(reversed(off_ring(2.0, 1.1, 2.4, 4.6, 0.3, sx * 2.0))), list(reversed(off_ring(5.6, 0.8, 2.45, 4.1, 0.25, sx * 1.72))),
                        list(reversed(off_ring(7.4, 0.5, 2.6, 3.4, 0.15, sx * 1.55)))], bevel=0.03)
    m.hull_z('hull', [(-7.0, 1.4, 5.8, 6.55, 0.25), (1.0, 1.5, 5.8, 6.6, 0.3), (3.4, 0.9, 5.8, 6.05, 0.15)], bevel=0.03)   # dorsal spine
    # ------------------------------------------------------------ dorsal fin: swept plate, leading strake, tip cap, panels
    m.plate_zy('hull', [(-7.0, 6.2), (1.6, 6.2), (-3.6, 18.6), (-6.3, 18.6), (-7.6, 17.2)], 0.55, bevel=0.1)
    m.plate_zy('gun', [(0.6, 6.4), (1.9, 6.4), (-3.3, 18.7), (-3.9, 18.7)], 0.3, bevel=0.05)
    m.box('gun', [0.7, 0.35, 3.3], [0, 18.575, -5.0], bevel=0.08)
    for y, z0, z1 in ((9, -6.6, -0.6), (12, -6.8, -2.0), (15, -7.0, -3.4)):
        m.plate_zy('gun', [(z0, y), (z1, y), (z1 - 0.3, y + 0.5), (z0, y + 0.5)], 0.68, bevel=0.04)
    for y, z0, z1 in ((7.2, -6.4, 0.5), (10.3, -6.6, -1.6), (13.3, -6.8, -3.0), (16.3, -7.0, -4.2)):   # inset panels between the strakes
        m.plate_zy('hull', [(z0, y), (z1, y), (z1 - 0.55, y + 1.3), (z0 - 0.1, y + 1.3)], 0.62, bevel=0.03)
    for k in range(9):                                                       # trailing-edge ribs up the fin
        y = 7.0 + k * 1.2
        m.box('dark', [0.6, 0.1, 0.5], [0, y, -7.0 - (y - 6.2) * 0.05 + 0.3], bevel=0.02)
    m.tube('gun', (0, 18.9, -3.6), (0, 18.9, -1.2), 0.05, 0.02, seg=6)       # antenna
    # ------------------------------------------------------------ engine block and thrusters
    m.hull_z('gun', [(-9.7, 5.3, 2.7, 5.4, 0.55), (-8.6, 5.6, 2.5, 5.7, 0.6), (-7.2, 5.2, 2.45, 5.75, 0.55)], bevel=0.05)
    for x in (-1.45, 1.45):
        c = (x, 4.0, 0.0)
        m.lathe('gun', c, Z, [(-9.6, 1.1), (-9.9, 1.1), (-10.28, 1.0), (-10.28, 0.92), (-10.0, 0.9)], seg=24, bevel=0.02)
        m.lathe('dark', c, Z, [(-10.04, 0.91), (-10.0, 0.91)], seg=20)
        m.lathe('gun', c, Z, [(-10.2, 0.16), (-10.0, 0.34)], seg=12)
        for k in range(12):
            a = 2 * math.pi * k / 12
            m.beam('dark', (x + math.cos(a) * 1.11, 4.0 + math.sin(a) * 1.11, -9.65), (x + math.cos(a) * 1.02, 4.0 + math.sin(a) * 1.02, -10.25), 0.3, 0.05)
    m.lathe('dark', (0, 3.1, 0), Z, [(-9.65, 0.5), (-10.15, 0.45), (-10.15, 0.34), (-9.9, 0.32)], seg=14)
    m.box('gun', [1.2, 0.5, 0.3], [0, 5.0, -9.75], bevel=0.05)
    for sx in (-1, 1):
        for i in range(6):                                                   # radiator vents on the engine block
            m.box('dark', [0.12, 1.6, 0.18], [sx * 2.75, 3.3, -7.6 - i * 0.32], bevel=0.02)
        # hull plating rows, strips and access panels along the flanks
        for row, (y0, h) in enumerate(((2.55, 0.95), (3.65, 0.85))):
            z = -6.4
            while z < 2.4:
                length = 0.8 + rnd.random() * 1.4
                if rnd.random() > 0.15:
                    m.box(rnd.choice(['hull', 'hull', 'hull', 'gun']), [0.06 + rnd.random() * 0.04, h - 0.08, length - 0.08], [sx * 2.56, y0, z + length / 2], bevel=0.02)
                z += length
        m.box('gun', [0.12, 0.2, 9.0], [sx * 2.58, 3.5, -1.6], bevel=0.04)
        m.box('dark', [0.1, 0.9, 1.4], [sx * 2.6, 3.95, 1.2], bevel=0.03)
        for k in range(4):
            m.box('dark', [0.12, 0.07, 1.0], [sx * 2.62, 2.75 + k * 0.16, -4.6])
        # wing-root hinge housing with end caps and clamps
        m.lathe('gun', (sx * HINGE_X, HINGE_Y, -6.2), Z, [(0, 0.4), (0.06, 0.48), (7.54, 0.48), (7.6, 0.4)], seg=16)
        for zz in (1.5, -2.4, -6.3):
            m.lathe('gun', (sx * HINGE_X, HINGE_Y, zz - 0.25), Z, [(0, 0.55), (0.06, 0.62), (0.44, 0.62), (0.5, 0.55)], seg=16)
        for k in range(6):
            m.box('dark', [0.3, 0.3, 0.16], [sx * (HINGE_X - 0.3), HINGE_Y - 0.6, -5.4 + k * 1.2], bevel=0.03)
        # chin laser cannons and flank blaster pods
        m.box('gun', [0.45, 0.4, 1.0], [sx * 0.7, 2.4, 8.9], bevel=0.06)
        m.lathe('gun', (sx * 0.7, 2.55, 8.9), Z, [(0, 0.16), (0.5, 0.16), (0.55, 0.13), (2.0, 0.13), (2.0, 0.17), (2.2, 0.17), (2.2, 0.07)], seg=10)
        m.lathe('gun', (sx * 2.2, 2.45, 4.3), Z, [(0, 0.16), (0.6, 0.16), (0.65, 0.12), (1.8, 0.12), (1.8, 0.05)], seg=10)
        # side cockpit window with its frame
        m.box('gun', [0.06, 0.6, 1.5], [sx * 1.57, 3.75, 7.7], rot_y=sx * -0.14, bevel=0.02)
        m.box('glass', [0.08, 0.45, 1.3], [sx * 1.6, 3.83, 7.7], rot_y=sx * -0.14)
    # roof plating either side of the spine
    for sx in (-1, 1):
        z = -6.2
        while z < 2.2:
            length = 0.9 + rnd.random() * 1.5
            if rnd.random() > 0.2:
                m.box(rnd.choice(['hull', 'hull', 'gun']), [0.85, 0.06, length - 0.08], [sx * 1.25, 5.99, z + length / 2], bevel=0.02)
            z += length
    # belly: plating, gear bays, ramp doorway
    m.box('gun', [3.4, 0.14, 8.0], [0, 2.1, -3.5], bevel=0.05)
    for x, z in ((0, 7.0), (-2.0, -4.6), (2.0, -4.6)):
        m.box('dark', [1.4, 0.12, 1.5], [x, 2.2 if z > 0 else 2.1, z], bevel=0.03)
    m.box('dark', [2.3, 0.1, 5.1], [0, 2.13, 3.0], bevel=0.02)
    # dorsal sensor dome
    m.sphere('gun', 0.4, [0, 6.55, 2.6], seg=14, rings=8, half='top')
    m.cyl('gun', 0.46, 0.5, 0.1, [0, 6.5, 2.6], seg=14)
    # ------------------------------------------------------------ cockpit glazing on the raked nose: three panes and their frame
    top = lambda z: 4.75 - 0.45 * (z - 7.2)                                  # roof line of the nose between z = 7.2 and 9.2
    half = lambda z: (2.5 - 0.42 * (z - 7.2)) / 2 - 0.12                     # half-width of the flat roof there
    z0, z1 = 7.45, 8.95
    for i in range(3):
        edges = []
        for z in (z0, z1):
            hw = half(z)
            xa = -hw + (2 * hw) * i / 3 + 0.05
            xb = -hw + (2 * hw) * (i + 1) / 3 - 0.05
            edges.append((xa, xb, z))
        lo = [(edges[0][0], top(z0) - 0.02, z0), (edges[0][1], top(z0) - 0.02, z0), (edges[1][1], top(z1) - 0.02, z1), (edges[1][0], top(z1) - 0.02, z1)]
        m.loft('glass', [lo, [(x, y + 0.07, z) for x, y, z in lo]])
    for z in (z0 - 0.06, z1 + 0.06):
        m.beam('gun', (-half(z) - 0.02, top(z) + 0.03, z), (half(z) + 0.02, top(z) + 0.03, z), 0.1, 0.08)
    for i in range(4):
        xa = lambda z: -half(z) + 2 * half(z) * i / 3
        m.beam('gun', (xa(z0), top(z0) + 0.03, z0), (xa(z1), top(z1) + 0.03, z1), 0.08, 0.1)
    m.box('glass', [1.0, 0.25, 0.08], [0, 3.42, 9.58])
    m.box('gun', [1.2, 0.06, 0.12], [0, 3.7, 9.6])
    m.tube('gun', (0, 3.2, 9.85), (0, 3.2, 10.6), 0.05, 0.02, seg=6)         # nose probe
    return m


def build_wing():
    """One wing in its hinge frame: hinge along Z at the origin, span +Y."""
    m = Model('shuttle_wing')
    S = SPAN
    le = lambda y: 2.2 + (y - 0.2) / (S - 0.2) * (-2.6 - 2.2)                 # leading edge z at span y
    te = lambda y: -6.3 + (y - 0.2) / (S - 0.2) * (-7.0 + 6.3)                # trailing edge z at span y
    m.plate_zy('hull', [(-6.3, 0.2), (2.2, 0.2), (-2.6, S), (-7.0, S), (-7.4, S - 1.4)], 0.42, bevel=0.1)
    m.plate_zy('gun', [(-7.0, 1.2), (-6.0, 1.2), (-6.8, S - 1.6), (-7.6, S - 1.6)], 0.3, bevel=0.04)        # trailing-edge flap
    m.plate_zy('gun', [(1.6, 0.4), (2.35, 0.4), (-2.4, S - 0.1), (-3.0, S - 0.1)], 0.26, bevel=0.04)        # leading-edge strip
    for s0, s1, z0, z1 in ((2.0, 5.5, -5.3, 0.4), (6.5, 9.5, -5.8, -1.3), (10.4, 13.6, -6.2, -2.4)):         # raised panels
        m.plate_zy('hull', [(z0, s0), (z1, s0), (z1 - 0.8, s1), (z0, s1)], 0.52, bevel=0.04)
        m.plate_zy('gun', [(z0 + 0.5, s0 + 0.5), (z0 + 2.2, s0 + 0.5), (z0 + 2.0, s0 + 1.5), (z0 + 0.5, s0 + 1.5)], 0.6, bevel=0.03)
        for k in range(4):
            m.plate_zy('dark', [(z0 + 0.7, s1 - 0.5 - k * 0.22), (z0 + 2.0, s1 - 0.5 - k * 0.22), (z0 + 2.0, s1 - 0.42 - k * 0.22), (z0 + 0.7, s1 - 0.42 - k * 0.22)], 0.58)
    for y in (1.2, 5.95, 9.95, 14.1, 15.3):                                                                  # chordwise ribs
        m.plate_zy('gun', [(te(y) + 0.5, y), (le(y) - 0.5, y), (le(y + 0.14) - 0.5, y + 0.14), (te(y + 0.14) + 0.5, y + 0.14)], 0.5, bevel=0.02)
    # root hinge barrel and knuckles
    m.lathe('dark', (0, 0.25, -6.2), Z, [(0, 0.3), (8.2, 0.3)], seg=12)
    for zz in (-5.4, -3.0, -0.6, 1.4):
        m.lathe('gun', (0, 0.25, zz - 0.25), Z, [(0, 0.36), (0.5, 0.36)], seg=12, bevel=0.03)
        m.box('gun', [0.5, 0.7, 0.4], [0, 0.3, zz], bevel=0.05)
    # wingtip laser cannon
    m.lathe('gun', (0, S - 0.15, -4.9), Z, [(0, 0.2), (0.3, 0.2), (0.34, 0.17), (3.2, 0.17), (3.2, 0.08), (4.7, 0.08), (4.7, 0.12), (4.95, 0.12), (4.95, 0.04)], seg=12)
    m.box('gun', [0.5, 0.4, 1.6], [0, S - 0.35, -4.2], bevel=0.06)
    return m


bkit.run('shuttle', [(build_wing, 1024, 1.6), (build_body, 2048, 2.0)], tile=4.0, preview_view=((19, 13, 22), (0, 8, -1), 38),
         colors={'gun': (0.3, 0.31, 0.33)})
