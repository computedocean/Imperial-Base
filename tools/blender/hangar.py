"""Starship Hangar Alpha — outer shell hero model (original design).

Run (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/hangar.py -- --out frontend/public/models

Only the shell is modelled here (walls, great-door portal, roof, spine, buttresses). The floor, gantries,
racks, fuel tanks and the animated great doors stay procedural in src/world/Structures.tsx /
src/aircraft/AircraftLayer.tsx, so the walkable interior and door animation are unchanged.
Envelope = HANGAR in Structures.tsx: x −335 → −205, z −85 → 125, wall height 52, door opening z −40 → 80, h 38.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import Model, rect  # noqa: E402

X0, X1, Z0, Z1, H = -335.0, -205.0, -85.0, 125.0, 52.0
DZ0, DZ1, DH = -40.0, 80.0, 38.0
T = 3.0
CX, CZ = (X0 + X1) / 2, (Z0 + Z1) / 2


def build():
    m = Model('hangar')
    rnd = random.Random(4)
    L = X1 - X0
    D = Z1 - Z0
    # ------------------------------------------------------------ plinth
    m.box('dark', [L + 2.0, 1.6, T + 2.0], [CX, 0, Z0], bevel=0.15)
    m.box('dark', [L + 2.0, 1.6, T + 2.0], [CX, 0, Z1], bevel=0.15)
    m.box('dark', [T + 2.0, 1.6, D + 2.0], [X0, 0, CZ], bevel=0.15)
    # ------------------------------------------------------------ long walls (north / south) with ledges + clerestory
    for zw in (Z0, Z1):
        out = -1 if zw == Z0 else 1
        m.box('hull', [L, 18.0, T], [CX, 0, zw], bevel=0.12)
        m.box('dark', [L + 0.8, 0.8, T + 1.4], [CX, 18.0, zw], bevel=0.1)          # ledge
        m.box('dark', [L, 24.0, T], [CX, 18.8, zw], bevel=0.12)
        m.box('dark', [L + 0.8, 0.8, T + 1.4], [CX, 42.8, zw], bevel=0.1)          # ledge
        # clerestory window band (recessed) between pilasters
        m.box('black', [L, 5.0, T - 1.0], [CX, 43.6, zw])
        m.box('windows', [L - 1.0, 3.2, T - 0.6], [CX, 44.5, zw])
        m.box('hull', [L, H - 48.6, T], [CX, 48.6, zw], bevel=0.12)
        # vertical pilasters every 13 m (between the buttress fins)
        x = X0 + 4.0
        while x <= X1 - 3.0:
            m.box('dark', [2.4, H - 1.0, 1.2], [x, 0.0, zw + out * (T / 2 + 0.6)], bevel=0.12)
            x += 13.0
        # stencilled hazard band at the base
        m.box('stripe', [L - 2.0, 1.0, 0.2], [CX, 2.0, zw + out * (T / 2 + 0.1)])
        # personnel doors
        for xd in (X0 + 30.0, X1 - 30.0):
            m.box('black', [4.0, 5.0, 0.6], [xd, 0.0, zw + out * (T / 2 + 0.1)])
            m.box('dark', [6.0, 0.6, 2.0], [xd, 5.2, zw + out * (T / 2 + 1.0)], bevel=0.08)
            m.box('amber', [0.4, 0.4, 0.4], [xd + 2.6, 5.0, zw + out * (T / 2 + 0.4)])
    # ------------------------------------------------------------ back (west) wall + utility pipes
    m.box('hull', [T, H, D], [X0, 0, CZ], bevel=0.12)
    m.box('dark', [T + 1.4, 0.8, D + 0.8], [X0, 18.0, CZ], bevel=0.1)
    m.box('dark', [T + 1.4, 0.8, D + 0.8], [X0, 42.8, CZ], bevel=0.1)
    for z in range(int(Z0 + 12), int(Z1 - 6), 16):
        m.box('dark', [1.2, H - 1.0, 2.4], [X0 - T / 2 - 0.6, 0.0, z], bevel=0.12)
    for i, z in enumerate((-60.0, -54.0, 96.0, 102.0)):
        m.cyl('dark', 0.7, 0.7, 40.0, [X0 - T / 2 - 1.2, 0.0, z], 10)
        m.box('black', [1.8, 1.0, 1.8], [X0 - T / 2 - 1.2, 40.0, z])
    for z in (-20.0, 20.0, 60.0):
        m.box('dark', [2.0, 6.0, 8.0], [X0 - T / 2 - 1.0, 0.0, z], bevel=0.12)  # utility boxes
        m.box('red', [0.4, 0.4, 0.4], [X0 - T / 2 - 2.1, 5.2, z + 3.0])
    # ------------------------------------------------------------ east wall with the great-door portal
    m.box('hull', [T * 2, H, DZ0 - Z0], [X1, 0, (Z0 + DZ0) / 2], bevel=0.12)
    m.box('hull', [T * 2, H, Z1 - DZ1], [X1, 0, (DZ1 + Z1) / 2], bevel=0.12)
    m.box('dark', [T * 2.5, H - DH, DZ1 - DZ0 + 2], [X1, DH, (DZ0 + DZ1) / 2], bevel=0.12)
    # stepped portal header (three receding frames). NOTHING may protrude past the wall face (x > X1 + T)
    # below the door height: the animated great doors slide along x ≈ −201.5…−200 over z −98…138.
    for i, g in enumerate((6.0, 3.6, 1.6)):
        depth = 1.6 + i * 0.8
        m.box('dark', [depth, 3.0, DZ1 - DZ0 + 2 * g], [X1 + T + depth / 2 - 0.2, DH + g - 1.2, (DZ0 + DZ1) / 2], bevel=0.12)
    m.box('stripe', [0.3, 1.4, DZ1 - DZ0], [X1 + T + 4.0, DH + 0.4, (DZ0 + DZ1) / 2])
    for k in range(13):
        z = DZ0 + k * (DZ1 - DZ0) / 12
        m.box('amber', [0.6, 0.6, 1.2], [X1 + T + 4.3, DH + 2.4, z])
    for zj in (DZ0 - 1.25, DZ1 + 1.25):
        m.box('black', [T * 2.0, DH, 2.5], [X1, 0, zj])
    # hazard chevrons painted flush on the wall beside the opening (doors slide 0.4 m in front of them)
    for zj in (DZ0 - 5.0, DZ1 + 5.0):
        for k in range(6):
            m.box('stripe', [0.12, 1.6, 2.4], [X1 + T + 0.04, 2.0 + k * 5.6, zj])
    # big unit designation panel above the door (dark plate + lit rim)
    m.box('black', [0.6, 8.0, 34.0], [X1 + T + 0.2, DH + 4.4, (DZ0 + DZ1) / 2])
    m.box('windows', [0.3, 0.4, 32.0], [X1 + T + 0.6, DH + 11.6, (DZ0 + DZ1) / 2])
    # ------------------------------------------------------------ roof: parapet, deck, raised spine with skylights
    m.box('dark', [L + 4, 3.0, D + 4], [CX, H, CZ], bevel=0.15)
    m.box('dark', [L + 4, 1.4, 1.2], [CX, H + 3.0, Z0 - 1.4], bevel=0.08)
    m.box('dark', [L + 4, 1.4, 1.2], [CX, H + 3.0, Z1 + 1.4], bevel=0.08)
    m.box('dark', [1.2, 1.4, D + 4], [X0 - 1.4, H + 3.0, CZ], bevel=0.08)
    m.box('dark', [1.2, 1.4, D + 4], [X1 + 1.4, H + 3.0, CZ], bevel=0.08)
    m.prism('hull', rect(40.0, D - 10.0, CX, CZ), H + 3.0, 9.0, rect(22.0, D - 20.0, CX, CZ), bevel=0.15)
    m.prism('glass', rect(9.0, D - 24.0, CX, CZ), H + 12.0, 0.3)
    for z in range(int(Z0 + 14), int(Z1 - 10), 12):
        m.box('dark', [10.0, 0.6, 0.8], [CX, H + 12.0, z])          # skylight mullions
    m.box('whiteLight', [0.5, 0.3, D - 26.0], [CX - 6.6, H + 11.6, CZ])
    m.box('whiteLight', [0.5, 0.3, D - 26.0], [CX + 6.6, H + 11.6, CZ])
    # roof vents, AC units, comms
    for i in range(14):
        side = -1 if i % 2 else 1
        z = Z0 + 14 + (i // 2) * 28 + rnd.uniform(-3, 3)
        x = CX + side * rnd.uniform(28, 52)
        if rnd.random() < 0.6:
            m.box('dark', [7.0, 2.0, 4.5], [x, H + 3.0, z], bevel=0.12)
            m.cyl('black', 1.4, 1.4, 0.4, [x - 1.6, H + 5.0, z], 12)
            m.cyl('black', 1.4, 1.4, 0.4, [x + 1.6, H + 5.0, z], 12)
        else:
            m.cyl('dark', 1.6, 2.0, 3.2, [x, H + 3.0, z], 12)
            m.cyl('black', 1.2, 1.2, 0.3, [x, H + 6.2, z], 12)
    # roof-edge obstruction lights
    for x in range(int(X0), int(X1) + 1, 13):
        for z in (Z0 - 1.4, Z1 + 1.4):
            m.box('red', [0.5, 0.5, 0.5], [x, H + 4.4, z])
    # ------------------------------------------------------------ flight-control booth (north-east roof corner)
    bx, bz = X1 - 14.0, Z1 - 16.0
    m.prism('dark', rect(16, 14, bx, bz), H + 3.0, 2.0, rect(16, 14, bx, bz), bevel=0.12)
    m.prism('hull', rect(14, 12, bx, bz), H + 5.0, 3.0, rect(15, 13, bx, bz), bevel=0.1)
    m.prism('glass', rect(15.2, 13.2, bx, bz), H + 8.0, 2.4, rect(16.4, 14.4, bx, bz))
    m.prism('dark', rect(16.6, 14.6, bx, bz), H + 10.4, 1.0, rect(13.0, 11.0, bx, bz), bevel=0.1)
    m.prism('windows', rect(15.1, 13.1, bx, bz), H + 8.9, 0.3)
    m.cyl('black', 0.2, 0.3, 9.0, [bx + 4.0, H + 11.4, bz + 3.0], 6)
    m.box('red', [0.6, 0.6, 0.6], [bx + 4.0, H + 20.4, bz + 3.0])
    m.dish('dark', 2.2, 0.7, (bx - 3.5, H + 12.6, bz - 2.0), tilt_x=math.radians(-40), rot_y=math.radians(120), seg=14)
    # ------------------------------------------------------------ buttress fins (north & south)
    x = X0 + 10.0
    while x < X1 - 5.0:
        for zw, out in ((Z0, -1), (Z1, 1)):
            base = rect(6.0, 8.0, x, zw + out * 4.0)
            top = rect(3.0, 3.0, x, zw + out * 3.0)
            m.prism('dark', base, 0.0, 2.0, base, bevel=0.15)
            m.prism('dark', base, 2.0, H - 6.0, top, bevel=0.15)
            m.box('black', [3.4, 0.8, 3.4], [x, H - 4.0, zw + out * 3.0])
            m.box('amber', [0.4, 0.4, 0.4], [x, H - 3.2, zw + out * 3.0])
        x += 24.0
    return m


def main():
    a = bkit.args()
    out = os.path.abspath(a.get('out', 'frontend/public/models'))
    prev = a.get('preview')
    os.makedirs(out, exist_ok=True)
    bkit.reset()
    m = build()
    ob = m.to_object()
    print(f'[hangar] hangar: {m.tris} triangles, materials {m.mats}')
    bkit.lightmap_unwrap(ob)
    img = bkit.bake_ao(ob, os.path.join(out, 'hangar_ao.jpg'), size=int(a.get('size', '2048')), samples=int(a.get('samples', '64')), distance=10.0)
    bkit.export_glb(ob, os.path.join(out, 'hangar.glb'))
    if prev:
        os.makedirs(prev, exist_ok=True)
        bkit.preview(ob, img, os.path.join(os.path.abspath(prev), 'hangar.png'), (-120, 90, 230), (-270, 20, 20))
    print('[hangar] done')


main()
