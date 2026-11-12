"""Rebel-style four-wing starfighter: hero model in two parts (original interpretation: long nose, bubble canopy,
astromech dome, four S-foil wings with engine nacelles and wingtip cannons).

Run (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/xwing.py -- --out frontend/public/models --preview <dir>

The S-foils open in code (frontend/src/aircraft/models/XWing.tsx), so the wing is its own GLB:
  xwing_body  fuselage, origin = centre of mass, nose +Z
  xwing_wing  the upper-right wing in the fuselage frame; the other three are mirror images of it
Material names are the aircraft MatKey names: xwhite, gun, dark, glass, hull, stripe.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import Model  # noqa: E402

Z = (0, 0, 1)
FUSELAGE = [(-5.5, 1.45, -0.55, 0.52, 0.25), (-2.6, 1.6, -0.6, 0.62, 0.3), (-0.4, 1.55, -0.58, 0.6, 0.3), (1.6, 1.22, -0.48, 0.5, 0.26),
            (4.2, 0.86, -0.36, 0.26, 0.2), (6.5, 0.4, -0.2, 0.06, 0.1), (7.0, 0.14, -0.12, -0.02, 0.04)]
CANOPY = [(-1.3, 0.8, 0.5, 0.66, 0.15), (-0.7, 0.92, 0.5, 1.02, 0.3), (0.5, 0.88, 0.46, 0.96, 0.3), (1.9, 0.56, 0.32, 0.44, 0.12)]
NACELLE = dict(x=1.32, y=0.44, front=-1.5, rear=-5.9, r=0.42)
TIP_X, PIVOT_Y = 5.72, 0.1


def section_at(z):
    for a, c in zip(FUSELAGE[:-1], FUSELAGE[1:]):
        if a[0] <= z <= c[0]:
            k = (z - a[0]) / (c[0] - a[0])
            return tuple(a[i] + (c[i] - a[i]) * k for i in (1, 2, 3))
    return FUSELAGE[-1][1:4]


def side_yaw(z, sx):
    for a, c in zip(FUSELAGE[:-1], FUSELAGE[1:]):
        if a[0] <= z <= c[0]:
            return math.atan(sx * (c[1] - a[1]) / 2 / (c[0] - a[0]))
    return 0.0


def build_body():
    m = Model('xwing_body')
    rnd = random.Random(1977)
    m.hull_z('xwhite', FUSELAGE, bevel=0.03)
    m.hull_z('gun', [(1.0, 0.7, -0.62, -0.4, 0.12), (4.6, 0.4, -0.42, -0.25, 0.08)], bevel=0.02)        # sensor keel under the nose
    # canopy: glass, hoops, spine and sill
    m.hull_z('glass', CANOPY)
    rings = [m.ring_xy(*s) for s in CANOPY]
    grow = lambda p: (p[0] * 1.04, 0.5 + (p[1] - 0.5) * 1.05, p[2])
    for ring in rings[1:3]:
        for i in range(1, 6):
            m.beam('gun', grow(ring[i]), grow(ring[i + 1]), 0.06)
    for a, c in zip(rings[:-1], rings[1:]):
        for i in (2, 3, 4, 5):
            m.beam('gun', grow(a[i]), grow(c[i]), 0.055)
    # astromech socket and dome with its eye and band
    m.cyl('gun', 0.4, 0.42, 0.3, [0, 0.45, -2.3], seg=20, bevel=0.03)
    m.sphere('hull', 0.37, [0, 0.74, -2.3], seg=20, rings=10, half='top')
    m.ring('stripe', (0, 0.82, -2.3), (0, 1, 0), 0.36, 0.03, 0.02, seg=20)
    m.box('stripe', [0.16, 0.12, 0.06], [0, 0.92, -2.0], bevel=0.02)
    m.lathe('dark', (0.12, 0.98, -2.03), Z, [(0, 0.06), (0.07, 0.06)], seg=8)
    # rear deck: equipment tray, cooling fins, actuator housings
    m.box('gun', [1.0, 0.12, 2.0], [0, 0.54, -4.2], bevel=0.04)
    for i in range(5):
        m.box('dark', [0.8, 0.07, 0.12], [0, 0.65, -3.5 - i * 0.34], bevel=0.01)
    m.box('gun', [0.3, 0.16, 0.5], [0.3, 0.66, -5.0], bevel=0.03)
    m.box('gun', [1.3, 0.95, 0.2], [0, -0.495, -5.55], bevel=0.05)
    m.box('dark', [0.8, 0.5, 0.1], [0, -0.27, -5.68], bevel=0.02)
    for i in range(3):
        m.box('gun', [0.7, 0.04, 0.06], [0, -0.14 + i * 0.14, -5.75])
    for sx in (-1, 1):
        # hull plating that follows the taper, squadron stripes on the nose
        for row in (0.2, 0.52):
            z = -5.2
            while z < 6.0:
                length = 0.45 + rnd.random() * 0.8
                w, yb, yt = section_at(z + length / 2)
                if rnd.random() > 0.15:
                    h = (yt - yb) * 0.27
                    m.box(rnd.choice(['xwhite', 'xwhite', 'xwhite', 'hull', 'gun']), [0.03, h, length - 0.05], [sx * (w / 2 + 0.002), yb + (yt - yb) * row, z + length / 2],
                          rot_y=side_yaw(z + length / 2, sx), bevel=0.008)
                z += length
        for zz, hh, ll in ((2.6, 0.4, 0.45), (3.3, 0.34, 0.25)):
            w, yb, yt = section_at(zz)
            m.box('stripe', [0.04, hh, ll], [sx * (w / 2 + 0.006), -hh / 2, zz], rot_y=side_yaw(zz, sx), bevel=0.01)
        m.box('gun', [0.06, 0.4, 1.6], [sx * 0.79, -0.25, -1.6], bevel=0.02)
        m.box('dark', [0.05, 0.25, 0.9], [sx * 0.81, 0.095, -3.6], bevel=0.02)
        m.lathe('gun', (sx * 0.78, PIVOT_Y, -5.1), Z, [(0, 0.12), (0.06, 0.16), (2.34, 0.16), (2.4, 0.12)], seg=12)   # S-foil actuator
        for k in range(3):
            m.ring('dark', (sx * 0.78, PIVOT_Y, -4.7 + k * 0.8), Z, 0.165, 0.05, 0.012, seg=12)
        # cockpit side rails and torpedo tubes
        m.box('gun', [0.05, 0.08, 2.6], [sx * 0.5, 0.42, 0.3], bevel=0.01)
        m.lathe('dark', (sx * 0.2, -0.36, 2.6), Z, [(0, 0.07), (0.5, 0.07)], seg=8)
    # panel seams right round the fuselage
    for z in (-4.6, -3.2, -1.9, 2.3, 3.3, 4.3, 5.3, 6.1):
        for a, c in zip(FUSELAGE[:-1], FUSELAGE[1:]):
            if a[0] <= z <= c[0]:
                k = (z - a[0]) / (c[0] - a[0])
                w, yb, yt, ch = (a[i] + (c[i] - a[i]) * k for i in (1, 2, 3, 4))
                mid = (yb + yt) / 2
                grow = 1.012
                sec = lambda zz: (zz, w * grow, mid + (yb - mid) * grow, mid + (yt - mid) * grow, ch)
                m.hull_z('gun', [sec(z - 0.02), sec(z + 0.02)])
    # nose cone seam and sensor tip
    m.ring('gun', (0, -0.07, 6.5), Z, 0.21, 0.03, 0.02, seg=12)
    m.lathe('gun', (0, -0.07, 6.95), Z, [(0, 0.07), (0.4, 0.035)], seg=8)
    return m


def build_wing():
    """Upper-right wing (+X), in the fuselage frame."""
    m = Model('xwing_wing')
    plan = [(0.6, -5.35), (TIP_X, -5.15), (TIP_X, -3.75), (0.6, -2.3)]
    m.prism('xwhite', plan, 0.0, 0.12, bevel=0.03)
    le = lambda x: -2.3 + (x - 0.6) / (TIP_X - 0.6) * (-3.75 + 2.3)
    te = lambda x: -5.35 + (x - 0.6) / (TIP_X - 0.6) * (-5.15 + 5.35)
    m.prism('gun', [(1.8, -5.4), (TIP_X - 0.2, -5.22), (TIP_X - 0.2, -5.05), (1.8, -5.2)], -0.015, 0.15, bevel=0.02)   # trailing-edge flap
    for x0, x1 in ((3.05, 3.4), (3.62, 3.97)):                                                                           # squadron stripes
        m.prism('stripe', [(x0, te(x0) + 0.05), (x1, te(x1) + 0.05), (x1, le(x1) - 0.05), (x0, le(x0) - 0.05)], -0.008, 0.136)
    # panel lines, raised plates, leading-edge strip
    for x in (2.2, 2.9, 4.3, 5.0):
        m.box('gun', [0.03, 0.13, te(x) * -1 + le(x) - 0.3], [x, -0.005, (te(x) + le(x)) / 2])
    m.box('gun', [1.0, 0.045, 0.8], [2.3, 0.105, -4.6], bevel=0.015)
    m.box('gun', [0.6, 0.045, 0.5], [4.6, 0.105, -4.6], bevel=0.015)
    m.box('hull', [0.7, 0.04, 0.6], [3.6, 0.105, -3.9], bevel=0.012)
    m.beam('gun', (0.7, 0.06, le(0.7) - 0.02), (TIP_X - 0.1, 0.06, le(TIP_X - 0.1) - 0.02), 0.07, 0.14)
    # ---------------------------------------------------------------- engine nacelle
    N = NACELLE
    c = (N['x'], N['y'], 0.0)
    R = N['r']
    m.lathe('xwhite', c, Z, [(N['rear'], R), (N['front'] - 0.3, R)], seg=20, smooth=True)
    m.lathe('gun', c, Z, [(N['front'] - 0.42, R * 1.01), (N['front'] - 0.36, R * 1.08), (N['front'] + 0.14, R * 1.08), (N['front'] + 0.2, R * 0.98),
                          (N['front'] + 0.2, R * 0.8), (N['front'] + 0.02, R * 0.76)], seg=20)                              # intake lip
    m.lathe('dark', c, Z, [(N['front'] - 0.02, R * 0.78), (N['front'] + 0.03, R * 0.78)], seg=16)
    m.lathe('gun', c, Z, [(N['front'] + 0.02, R * 0.5), (N['front'] + 0.3, R * 0.3), (N['front'] + 0.42, 0.04)], seg=12)   # intake cone
    for k in range(8):
        a = 2 * math.pi * k / 8
        m.beam('gun', (c[0] + math.cos(a) * R * 0.3, c[1] + math.sin(a) * R * 0.3, N['front'] + 0.1), (c[0] + math.cos(a) * R * 0.8, c[1] + math.sin(a) * R * 0.8, N['front'] + 0.1), 0.03, 0.1)
    m.lathe('stripe', c, Z, [(N['front'] - 1.05, R * 1.025), (N['front'] - 0.8, R * 1.025)], seg=20)
    for z in (-2.9, -4.1, -5.2):
        m.ring('gun', (c[0], c[1], z), Z, R * 1.02, 0.06, 0.015, seg=20)
    m.lathe('gun', c, Z, [(N['rear'] + 0.1, R * 0.99), (N['rear'] - 0.1, R * 0.95), (N['rear'] - 0.55, R * 0.82), (N['rear'] - 0.55, R * 0.72), (N['rear'] - 0.4, R * 0.7)], seg=20)   # exhaust nozzle
    m.lathe('dark', c, Z, [(N['rear'] - 0.44, R * 0.71), (N['rear'] - 0.4, R * 0.71)], seg=16)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        m.beam('gun', (c[0] + math.cos(a) * R, c[1] + math.sin(a) * R, N['rear'] + 0.6), (c[0] + math.cos(a) * R, c[1] + math.sin(a) * R, N['front'] - 1.2), 0.05, 0.12)
    m.box('gun', [0.38, N['y'] - 0.06, 3.0], [N['x'], 0.06, (N['front'] + N['rear']) / 2 + 0.2], bevel=0.04)             # pylon to the wing
    # ---------------------------------------------------------------- wingtip cannon: housing, tube, barrel, flash suppressor
    m.box('gun', [0.3, 0.26, 1.7], [TIP_X, -0.07, -4.4], bevel=0.05)
    m.lathe('gun', (TIP_X, 0.06, -3.7), Z, [(0, 0.13), (0.1, 0.11), (2.45, 0.11), (2.5, 0.15), (3.0, 0.15), (3.05, 0.11), (4.2, 0.11), (4.2, 0.055), (6.5, 0.055)], seg=12)
    m.lathe('dark', (TIP_X, 0.06, 2.75), Z, [(0, 0.06), (0.03, 0.09), (0.37, 0.09), (0.4, 0.05)], seg=10)
    for k in range(4):
        m.ring('dark', (TIP_X, 0.06, -3.2 + k * 0.5), Z, 0.115, 0.04, 0.012, seg=10)
    m.box('dark', [0.14, 0.2, 0.5], [TIP_X, 0.12, -3.0], bevel=0.02)
    return m


bkit.run('xwing', [(build_wing, 1024, 0.8), (build_body, 2048, 0.9)], tile=3.0, preview_view=((6, 3.5, 9), (0, 0, 0.5), 45),
         colors={'xwhite': (0.8, 0.78, 0.72), 'gun': (0.3, 0.31, 0.33), 'stripe': (0.55, 0.14, 0.1)})
