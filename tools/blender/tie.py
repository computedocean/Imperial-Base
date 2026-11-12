"""Twin-ion-engine style fighter: hero model (original interpretation: ball cockpit, two pylons, two hexagonal solar wings).

Run (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/tie.py -- --out frontend/public/models --preview <dir>

Modelled around the centre of the cockpit pod, nose towards +Z, up +Y, metres (three.js coordinates), to match
frontend/src/aircraft/models/TieFighter.tsx. The engine glow and plume stay in code.
Material names are the aircraft MatKey names: hull, gun, dark, glass, solar.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import Model  # noqa: E402

POD_R, WING_X, HEX_R, VIEW_A = 1.22, 3.4, 3.1, 0.6
X = (1, 0, 0)
Y = (0, 1, 0)
Z = (0, 0, 1)


def hex_pts(r):
    """Hexagon in the ZY plane with vertices at the top and bottom: [(z, y), ...]."""
    return [(math.cos(math.pi / 2 + k * math.pi / 3) * r, math.sin(math.pi / 2 + k * math.pi / 3) * r) for k in range(6)]


def build():
    m = Model('tie')
    # ------------------------------------------------------------ cockpit pod: a ball with the front cut away for the viewport
    steps = 18
    prof = [(POD_R * math.cos(a), POD_R * math.sin(a)) for a in (math.pi - (math.pi - VIEW_A) * i / steps for i in range(steps + 1))]
    prof[0] = (-POD_R, 0.02)
    m.lathe('hull', (0, 0, 0), Z, prof, seg=36, smooth=True)
    vr, vz = POD_R * math.sin(VIEW_A), POD_R * math.cos(VIEW_A)
    m.lathe('glass', (0, 0, vz - 0.06), Z, [(0, vr * 0.98), (0.07, vr * 0.98)], seg=28)
    # viewport frame: outer ring, inner ring, hub and eight spokes
    m.ring('gun', (0, 0, vz + 0.02), Z, vr, 0.07, 0.085, seg=32)
    m.ring('gun', (0, 0, vz + 0.04), Z, vr * 0.52, 0.035, 0.03, seg=24)
    m.lathe('gun', (0, 0, vz - 0.02), Z, [(0, 0.2), (0.1, 0.17), (0.14, 0.1)], seg=12)
    for k in range(8):
        a = k * math.pi / 4 + math.pi / 8
        c, s = math.cos(a), math.sin(a)
        m.beam('gun', (c * 0.14, s * 0.14, vz + 0.045), (c * (vr - 0.03), s * (vr - 0.03), vz + 0.045), 0.06, 0.07)
    # weld seam round the equator, armoured collar behind the viewport
    m.ring('gun', (0, 0.05, 0), Y, POD_R * 0.998, 0.03, 0.035, seg=40)
    m.ring('gun', (0, 0, vz - 0.22), Z, POD_R * math.sin(VIEW_A + 0.2) + 0.01, 0.05, 0.03, seg=36)
    # top hatch with hinge and handle, and a small sensor
    m.cyl('gun', 0.5, 0.56, 0.16, [0, POD_R - 0.12, -0.15], seg=20, bevel=0.02)
    m.cyl('dark', 0.34, 0.34, 0.1, [0, POD_R + 0.02, -0.15], seg=16)
    m.box('gun', [0.5, 0.05, 0.08], [0, POD_R + 0.1, -0.15], bevel=0.01)
    m.box('gun', [0.16, 0.1, 0.3], [0, POD_R - 0.03, -0.72], bevel=0.02)
    # rear: engine plate, cooling slats, two ion-engine housings
    m.box('gun', [1.1, 0.9, 0.3], [0, -0.5, -POD_R + 0.08], bevel=0.06)
    for i in range(5):
        m.box('dark', [0.9, 0.05, 0.05], [0, 0.3 - i * 0.16, -POD_R - 0.09])
    for sx in (-1, 1):
        m.lathe('gun', (sx * 0.27, -0.05, -POD_R - 0.02), (0, 0, -1), [(0, 0.24), (0.1, 0.24), (0.12, 0.2), (0.06, 0.18)], seg=12)
        # chin cannons under the viewport
        m.lathe('gun', (sx * 0.35, -0.9, 0.36), Z, [(0, 0.11), (0.26, 0.11), (0.28, 0.07), (0.72, 0.07), (0.74, 0.09), (0.8, 0.09), (0.8, 0.04)], seg=10)
        m.box('gun', [0.2, 0.16, 0.3], [sx * 0.35, -0.92, 0.2], bevel=0.03)

    for sx in (-1, 1):
        # ---------------------------------------------------------- pylon: tapering box arm with ribs and conduits
        secs = [(0.0, 0.5, -0.62, 0.38, 0.45), (1.0, 0.42, -0.55, 0.3, 0.36), (2.15, 0.3, -0.4, 0.24, 0.28)]
        rings = []
        for L, front, back, hf, hb in secs:
            x = sx * (0.95 + L)
            rings.append([(x, -hf, -front), (x, hf, -front), (x, hb, -back), (x, -hb, -back)])
        m.loft('hull', rings, bevel=0.04)
        m.lathe('gun', (sx * 0.84, 0, 0), (sx, 0, 0), [(0, 0.62), (0.32, 0.62)], seg=20, bevel=0.03)        # pod collar
        m.lathe('dark', (sx * 1.07, 0, 0), (sx, 0, 0), [(0, 0.5), (0.36, 0.5)], seg=16)
        for x in (1.7, 2.3, 2.75):
            m.box('gun', [0.1, 0.72 - (x - 1.7) * 0.14, 0.95 - (x - 1.7) * 0.2], [sx * x, -(0.72 - (x - 1.7) * 0.14) / 2, 0.08], bevel=0.03)
        for dy in (0.2, -0.2):
            m.tube('dark', (sx * 1.3, dy, 0.52), (sx * 3.0, dy * 0.7, 0.36), 0.035, seg=6)
        # wing hub: stepped drum with bolts
        m.lathe('gun', (sx * (WING_X - 0.52), 0, 0), (sx, 0, 0), [(0, 0.48), (0.2, 0.62), (0.36, 0.62), (0.36, 0.5), (0.86, 0.5), (0.86, 0.3), (0.9, 0.3)], seg=20, bevel=0.02)
        m.lathe('dark', (sx * (WING_X + 0.34), 0, 0), (sx, 0, 0), [(0, 0.3), (0.06, 0.3)], seg=14)
        for k in range(8):
            a = 2 * math.pi * k / 8
            m.box('dark', [0.05, 0.07, 0.07], [sx * (WING_X - 0.15), math.sin(a) * 0.56 - 0.035, math.cos(a) * 0.56], bevel=0.01)

        # ---------------------------------------------------------- wing: solar panel, frame, spokes, cross-braces
        x = sx * WING_X
        m.plate_zy('solar', hex_pts(HEX_R - 0.06), 0.07, x=x)
        hexo = hex_pts(HEX_R)
        m.plate_zy('gun', hex_pts(0.95), 0.2, x=x, bevel=0.03)                                              # hub plate
        for k in range(6):
            (z0, y0), (z1, y1) = hexo[k], hexo[(k + 1) % 6]
            m.beam('gun', (x, y0, z0), (x, y1, z1), 0.26, 0.2)                                              # rim
            m.beam('dark', (x, y0 * 0.955, z0 * 0.955), (x, y1 * 0.955, z1 * 0.955), 0.14, 0.06)            # rim inner lip
            m.beam('gun', (x, y0 * 0.2, z0 * 0.2), (x, y0, z0), 0.18, 0.13)                                 # spoke
            for f, w in ((0.48, 0.07), (0.74, 0.05)):                                                       # two rings of cross-braces
                m.beam('gun', (x, y0 * f, z0 * f), (x, y1 * f, z1 * f), 0.12, w)
            # knuckle at each vertex, and a mid-rim clamp
            m.lathe('gun', (x - 0.16, y0, z0), X, [(0, 0.17), (0.32, 0.17)], seg=10, bevel=0.02)
            m.box('gun', [0.3, 0.16, 0.34], [x, (y0 + y1) / 2 - 0.08, (z0 + z1) / 2], bevel=0.03)
    return m


bkit.run('tie', [(build, 1024, 1.2)], tile=2.2, preview_view=((7, 3.5, 8), (0, 0, 0), 45), colors={'solar': (0.05, 0.055, 0.07), 'gun': (0.3, 0.31, 0.33)})
