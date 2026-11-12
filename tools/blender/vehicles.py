"""Garrison motor pool: the four repulsor ground vehicles (original designs).

Run (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/vehicles.py -- --out frontend/public/models --preview <dir>

Exports veh_hauler, veh_speeder, veh_tender and veh_troop. Metres, nose +Z, y = 0 is the underside of the repulsor
pods (the app adds the hover height), matching frontend/src/vehicles/models.ts. The app merges each model into one
vertex-coloured body and one glow geometry, by these material names:
  body  hull, dark, light, black, glass, stripe, rust
  glow  holo (repulsor emitters), whiteLight (headlights), red (tail lights), amber (beacons)
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import Model, rect  # noqa: E402

X = (1, 0, 0)
Y = (0, 1, 0)
Z = (0, 0, 1)


def pods(m, hw, zs, r=0.6):
    """Repulsor pods: housing, skirt, glowing emitter underneath, a strut up into the chassis."""
    for z in zs:
        for s in (-1, 1):
            m.lathe('black', (s * hw, 0.05, z), Y, [(0, r * 1.15), (0.12, r * 1.2), (0.3, r * 1.05), (0.55, r), (0.62, r * 0.6)], seg=14)
            m.lathe('holo', (s * hw, 0.0, z), Y, [(0, r * 0.8), (0.06, r * 0.8)], seg=12)
            m.ring('dark', (s * hw, 0.32, z), Y, r * 1.08, 0.04, 0.03, seg=14)
            for k in range(4):
                a = k * math.pi / 2 + math.pi / 4
                m.box('dark', [0.14, 0.3, 0.14], [s * hw + math.cos(a) * r * 0.95, 0.2, z + math.sin(a) * r * 0.95], bevel=0.02)


def lights(m, hw, front, back, y):
    for s in (-1, 1):
        m.box('black', [0.6, 0.34, 0.1], [s * hw, y - 0.06, front - 0.04], bevel=0.02)
        m.box('whiteLight', [0.45, 0.22, 0.12], [s * hw, y, front])
        m.box('black', [0.52, 0.3, 0.08], [s * hw, y - 0.05, back + 0.04], bevel=0.02)
        m.box('red', [0.4, 0.2, 0.1], [s * hw, y, back])


def beacon(m, x, y, z):
    m.cyl('black', 0.16, 0.2, 0.1, [x, y, z], seg=10)
    m.cyl('amber', 0.13, 0.15, 0.22, [x, y + 0.1, z], seg=10)
    m.cyl('black', 0.16, 0.16, 0.04, [x, y + 0.32, z], seg=10)


def crate(m, mat, size, pos, straps=2):
    """Cargo module: bevelled box with corner posts, ribs and tie-down straps."""
    w, h, d = size
    x, y, z = pos
    m.box(mat, size, pos, bevel=0.08)
    for sx in (-1, 1):
        for sz in (-1, 1):
            m.box('dark', [0.18, h + 0.06, 0.18], [x + sx * (w / 2 - 0.04), y - 0.02, z + sz * (d / 2 - 0.04)], bevel=0.03)
        for k in range(3):
            m.box('dark', [0.06, h * 0.7, 0.12], [x + sx * (w / 2 + 0.01), y + h * 0.15, z - d / 2 + d * (k + 1) / 4])
    for k in range(straps):
        zz = z - d / 2 + d * (k + 1) / (straps + 1)
        m.box('black', [w + 0.08, 0.05, 0.14], [x, y + h, zz])
        for sx in (-1, 1):
            m.box('black', [0.05, h, 0.14], [x + sx * (w / 2 + 0.03), y, zz])


def hauler():
    """Heavy repulsor cargo hauler: armoured cab, flat bed with two cargo modules. About 14 m."""
    m = Model('veh_hauler')
    pods(m, 1.6, [4.5, -5])
    m.box('dark', [4.2, 0.8, 12], [0, 0.55, -0.8], bevel=0.1)                                 # chassis
    for z in (-6.2, -4.0, -1.8, 0.4, 2.6):                                                    # frame cross-members and side rails
        m.box('black', [4.4, 0.3, 0.3], [0, 0.6, z], bevel=0.04)
    for s in (-1, 1):
        m.box('black', [0.16, 0.5, 11.4], [s * 2.15, 0.75, -0.8], bevel=0.04)
        m.lathe('black', (s * 1.9, 0.95, -6.4), Z, [(0, 0.22), (3.2, 0.22)], seg=10)          # fuel cells under the bed
        m.box('dark', [0.5, 0.5, 1.0], [s * 1.95, 0.6, 1.6], bevel=0.06)                      # steps and tool lockers
        m.box('black', [0.4, 0.06, 0.8], [s * 2.3, 0.75, 4.2])
    # cab: tapered armour, raked windscreen with frame, side windows, roof equipment
    m.taper('hull', [4.0, 3.4], [3.2, 2.0], 2.3, [0, 1.35, 5.4], bevel=0.1)
    m.box('dark', [4.1, 0.5, 3.5], [0, 1.3, 5.4], bevel=0.06)
    m.loft('glass', [[(-1.45, 2.55, 6.9), (1.45, 2.55, 6.9), (1.25, 3.5, 6.42), (-1.25, 3.5, 6.42)],
                     [(-1.45, 2.55, 7.0), (1.45, 2.55, 7.0), (1.25, 3.5, 6.52), (-1.25, 3.5, 6.52)]])
    m.beam('black', (0, 2.55, 7.0), (0, 3.5, 6.52), 0.1)
    m.beam('black', (-1.5, 2.5, 7.0), (1.5, 2.5, 7.0), 0.12)
    for s in (-1, 1):
        m.box('glass', [0.08, 0.6, 1.3], [s * 1.78, 2.65, 5.3], rot_y=0, bevel=0.0)
        m.box('black', [0.1, 0.1, 0.5], [s * 2.1, 2.9, 6.4])                                   # mirrors
        m.box('black', [0.3, 0.4, 0.06], [s * 2.25, 2.7, 6.6], bevel=0.02)
    m.box('black', [4.3, 0.3, 0.4], [0, 1.0, 7.1], bevel=0.05)                                # bumper
    for s in (-0.9, 0, 0.9):
        m.box('dark', [0.7, 0.5, 0.1], [s, 1.5, 7.12])                                        # grille
    m.box('hull', [2.2, 0.25, 1.4], [0, 3.65, 5.0], bevel=0.05)                               # roof fairing
    m.tube('black', (1.2, 3.6, 4.6), (1.2, 5.2, 4.6), 0.05, 0.02, seg=6)
    beacon(m, -1.0, 3.65, 5.9)
    # bed: deck plate, headboard, two cargo modules, tailgate
    m.box('black', [4.0, 0.12, 9.6], [0, 1.3, -2.2])
    m.box('dark', [4.0, 1.6, 0.2], [0, 1.35, 3.0], bevel=0.04)
    crate(m, 'rust', [3.6, 2.3, 4.0], [0, 1.42, -0.2])
    crate(m, 'hull', [3.6, 2.3, 3.6], [0, 1.42, -4.6])
    m.box('stripe', [3.65, 0.2, 3.65], [0, 3.72, -4.6], bevel=0.03)
    m.box('black', [4.4, 0.5, 0.6], [0, 0.7, -6.8], bevel=0.06)
    lights(m, 1.5, 7.3, -7.12, 1.15)
    return m


def speeder():
    """Two-seat patrol speeder: low wedge hull, bubble canopy, twin rear thrusters. About 5.5 m."""
    m = Model('veh_speeder')
    pods(m, 0.9, [1.6, -1.6], 0.42)
    m.taper('dark', [2.3, 4.4], [1.5, 3.4], 0.75, [0, 0.4, -0.3], bevel=0.08)                  # hull
    m.taper('hull', [2.0, 1.6], [1.0, 0.4], 0.55, [0, 0.45, 2.6], bevel=0.06)                  # nose wedge
    m.box('hull', [1.4, 0.1, 2.2], [0, 1.15, -1.0], bevel=0.03)                                # engine deck
    for k in range(5):
        m.box('black', [1.1, 0.05, 0.1], [0, 1.25, -1.9 + k * 0.22])
    m.sphere('glass', 0.75, [0, 1.15, -0.2], seg=20, rings=12, squash=0.8, half='top')         # canopy
    m.ring('black', (0, 1.17, -0.2), Y, 0.76, 0.04, 0.03, seg=20)
    m.beam('black', (0, 1.17, 0.55), (0, 1.76, -0.2), 0.05)
    m.beam('black', (0, 1.76, -0.2), (0, 1.17, -0.95), 0.05)
    for s in (-1, 1):
        # outrigger thrusters with intakes, nozzles and a mounting fin
        m.lathe('black', (s * 1.25, 0.75, -2.7), Z, [(0, 0.3), (0.1, 0.38), (1.5, 0.34), (1.8, 0.3), (1.9, 0.24)], seg=14)
        m.lathe('holo', (s * 1.25, 0.75, -2.8), Z, [(0, 0.26), (0.08, 0.26)], seg=12)
        m.lathe('dark', (s * 1.25, 0.75, -0.9), Z, [(0, 0.2), (0.25, 0.06)], seg=10)
        m.box('dark', [0.5, 0.12, 1.2], [s * 0.95, 0.72, -1.8], bevel=0.03)
        m.box('hull', [0.06, 0.5, 0.9], [s * 1.25, 1.05, -2.2], bevel=0.02)
        m.box('hull', [0.12, 0.3, 2.6], [s * 1.12, 0.6, 0.3], bevel=0.04)                      # side armour
        m.lathe('black', (s * 0.55, 0.6, 2.7), Z, [(0, 0.07), (0.9, 0.07), (0.9, 0.03)], seg=8)  # nose blasters
    m.box('red', [2.32, 0.1, 0.5], [0, 1.15, 0.8])
    m.box('whiteLight', [0.9, 0.12, 0.12], [0, 0.65, 3.0])
    m.box('red', [1.2, 0.1, 0.08], [0, 0.9, -2.5])
    return m


def tender():
    """Fuel tender: cab, cylindrical tank with hazard bands, hose reel. About 11 m."""
    m = Model('veh_tender')
    pods(m, 1.4, [3.6, -3.8])
    m.box('dark', [3.6, 0.7, 10.6], [0, 0.5, 0], bevel=0.1)
    for s in (-1, 1):
        m.box('black', [0.14, 0.45, 10.0], [s * 1.85, 0.7, 0], bevel=0.03)
        m.box('dark', [0.5, 0.6, 1.4], [s * 1.75, 0.55, 0.6], bevel=0.06)                      # valve lockers
        m.tube('black', (s * 1.5, 1.4, 2.4), (s * 1.5, 1.4, -4.6), 0.07, seg=6)                # pipe runs along the tank
        for z in (-3.0, -1.0, 1.0):
            m.box('dark', [0.3, 1.3, 0.3], [s * 1.2, 1.2, z], bevel=0.04)                      # tank cradles
    # cab
    m.box('hull', [3.4, 2.2, 2.6], [0, 1.2, 3.9], bevel=0.12)
    m.box('dark', [3.5, 0.4, 2.7], [0, 1.2, 3.9], bevel=0.05)
    m.box('glass', [2.8, 0.75, 0.1], [0, 2.4, 5.2])
    m.box('black', [3.0, 0.1, 0.14], [0, 2.32, 5.22])
    m.box('black', [3.0, 0.1, 0.14], [0, 3.15, 5.22])
    m.box('black', [0.1, 0.8, 0.14], [0, 2.38, 5.22])
    for s in (-1, 1):
        m.box('glass', [0.08, 0.6, 1.2], [s * 1.7, 2.45, 4.0])
        m.box('black', [0.3, 0.4, 0.06], [s * 1.95, 2.5, 5.0], bevel=0.02)
    m.box('black', [3.7, 0.3, 0.3], [0, 0.9, 5.25], bevel=0.05)
    beacon(m, 0, 3.4, 3.9)
    # tank: barrel with domed ends, hazard bands, filler hatches, catwalk and ladder
    m.lathe('light', (0, 2.65, -4.75), Z, [(0, 0.5), (0.25, 1.1), (0.55, 1.35), (6.55, 1.35), (6.85, 1.1), (7.1, 0.5)], seg=24, smooth=True)
    for z in (1.5, -4.3):
        m.ring('stripe', (0, 2.65, z), Z, 1.39, 0.22, 0.04, seg=24)
    for z in (-1.4, -2.8, 0.0):
        m.ring('dark', (0, 2.65, z), Z, 1.37, 0.05, 0.03, seg=24)
    m.box('black', [0.9, 0.06, 6.0], [0, 4.0, -1.2])                                           # catwalk
    for z in (-3.2, -1.2, 0.8):
        m.cyl('dark', 0.34, 0.38, 0.22, [0, 3.98, z], seg=12, bevel=0.02)
        m.cyl('black', 0.2, 0.2, 0.1, [0, 4.2, z], seg=10)
    for k in range(8):
        m.box('black', [0.5, 0.04, 0.05], [1.0 + 0.0, 1.3 + k * 0.33, -4.55])
    for s in (-1, 1):
        m.tube('black', (1.0 + s * 0.25, 1.2, -4.55), (1.0 + s * 0.25, 3.9, -4.55), 0.03, seg=5)
    # hose reel and nozzle rack at the stern
    m.lathe('black', (1.25, 1.25, -4.4), X, [(0, 0.72), (0.06, 0.72), (0.06, 0.45), (0.44, 0.45), (0.44, 0.72), (0.5, 0.72)], seg=16)
    m.lathe('dark', (1.31, 1.25, -4.4), X, [(0, 0.6), (0.38, 0.6)], seg=16)
    m.tube('black', (-1.2, 1.3, -4.9), (-1.2, 1.3, -5.6), 0.08, 0.05, seg=8)
    m.box('dark', [1.0, 0.8, 0.5], [-1.1, 1.2, -4.9], bevel=0.06)
    lights(m, 1.3, 5.38, -5.37, 1.0)
    return m


def troop():
    """Armoured troop carrier: sloped glacis, vision slits, small roof turret. About 10 m."""
    m = Model('veh_troop')
    pods(m, 1.55, [3.2, -3.4])
    m.taper('dark', [4.0, 8.4], [3.4, 7.6], 2.5, [0, 0.55, -0.6], bevel=0.12)                  # hull
    m.taper('hull', [3.8, 2.2], [3.2, 0.6], 1.9, [0, 0.55, 4.6], bevel=0.1)                    # glacis
    m.box('hull', [3.0, 0.5, 6.0], [0, 3.05, -0.8], bevel=0.1)                                 # roof plate
    for s in (-1, 1):
        # applique armour panels, vision slits with frames, skirts over the pods
        for k in range(4):
            m.box('hull', [0.14, 1.3, 1.6], [s * 1.86, 1.0, -3.5 + k * 1.9], bevel=0.05)
            m.box('black', [0.12, 0.1, 0.1], [s * 1.95, 1.2, -3.5 + k * 1.9 + 0.6])
            m.box('black', [0.12, 0.1, 0.1], [s * 1.95, 2.0, -3.5 + k * 1.9 - 0.6])
        m.box('black', [0.1, 0.5, 4.8], [s * 1.74, 2.42, -0.6], bevel=0.03)
        m.box('glass', [0.12, 0.3, 4.6], [s * 1.76, 2.52, -0.6])
        for k in range(3):
            m.box('black', [0.14, 0.34, 0.16], [s * 1.77, 2.5, -1.7 + k * 1.1])
        m.box('dark', [0.3, 0.7, 2.0], [s * 1.9, 0.5, 3.2], bevel=0.06)
        m.box('dark', [0.3, 0.7, 2.0], [s * 1.9, 0.5, -3.4], bevel=0.06)
        m.tube('black', (s * 1.3, 3.6, -3.4), (s * 1.3, 3.6, 1.8), 0.04, seg=5)                # roof rails
        for z in (-3.4, -0.8, 1.8):
            m.tube('black', (s * 1.3, 3.5, z), (s * 1.3, 3.62, z), 0.04, seg=5)
    m.box('black', [2.6, 0.42, 0.1], [0, 2.26, 3.62], bevel=0.02)                              # driver's slit
    m.box('glass', [2.4, 0.3, 0.1], [0, 2.32, 3.66])
    # roof turret with cannon, hatch and sensor
    m.lathe('black', (0, 3.55, 0.6), Y, [(0, 0.9), (0.1, 0.88), (0.5, 0.75), (0.62, 0.6)], seg=16)
    m.box('black', [0.5, 0.4, 0.7], [0, 3.72, 1.2], bevel=0.05)
    m.lathe('black', (0, 3.95, 1.4), Z, [(0, 0.1), (1.6, 0.1), (1.6, 0.14), (1.9, 0.14), (1.9, 0.06)], seg=10)
    m.cyl('dark', 0.4, 0.44, 0.1, [0, 3.55, -2.4], seg=14, bevel=0.02)
    m.box('black', [0.3, 0.06, 0.08], [0, 3.66, -2.4])
    beacon(m, 1.0, 3.55, -3.2)
    # rear troop door with ramp hinge, tow hooks
    m.box('black', [3.0, 1.6, 0.2], [0, 0.9, -4.95], bevel=0.05)
    m.box('dark', [2.6, 1.3, 0.1], [0, 1.05, -5.06], bevel=0.04)
    m.lathe('black', (-1.4, 0.9, -5.02), X, [(0, 0.1), (2.8, 0.1)], seg=8)
    for s in (-1, 1):
        m.box('black', [0.2, 0.3, 0.4], [s * 1.2, 0.6, 5.7], bevel=0.04)
    m.box('stripe', [4.05, 0.18, 0.6], [0, 2.0, 3.0], bevel=0.03)
    lights(m, 1.6, 5.74, -5.02, 1.2)
    return m


bkit.run('vehicles', [(speeder, 1024, 0.8), (tender, 1024, 1.5), (troop, 1024, 1.5), (hauler, 1024, 1.5)], tile=3.0,
         preview_view=((9, 6, 13), (0, 1.8, 0), 40),
         colors={'hull': (0.58, 0.6, 0.62), 'rust': (0.3, 0.2, 0.13), 'stripe': (0.55, 0.42, 0.1), 'light': (0.7, 0.71, 0.72)})
