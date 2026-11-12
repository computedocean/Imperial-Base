"""Star destroyer — hero model (original interpretation of the dagger-shaped capital ship).

Run (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/destroyer.py -- --out frontend/public/models --preview <dir>

Modelled around its own centre, 1600 m long, bow towards +Z, up +Y (three.js coordinates), so it
drops straight into frontend/src/aircraft/models/StarDestroyer.tsx. Materials by name:
  hull / light / dark  armour plating in three tones      black    recesses, hangar bay
  windows              lit viewport strips (emissive)     engine   engine glow (emissive)
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import Model  # noqa: E402

L = 1600.0
HALF = L / 2
STERN_W = 940.0
TOP0, TOP1 = 64.0, 5.0      # upper hull height at the stern / bow
BOT0, BOT1 = -58.0, -5.0


def half_width(z):
    """Half the hull width at depth z (a straight taper from stern to bow)."""
    t = (z + HALF) / L
    return (STERN_W / 2) * (1 - t) + 5 * t


def top_y(z):
    t = (z + HALF) / L
    return TOP0 + (TOP1 - TOP0) * t


def bot_y(z):
    t = (z + HALF) / L
    return BOT0 + (BOT1 - BOT0) * t


def trapezoid(z0, w0, z1, w1):
    return [(w0 / 2, z0), (w1 / 2, z1), (-w1 / 2, z1), (-w0 / 2, z0)]


def build():
    m = Model('destroyer')
    rnd = random.Random(66)
    tones = ['hull', 'hull', 'hull', 'light', 'dark']

    # ------------------------------------------------------------ the wedge: two hull plates and the trench between
    m.hull_z('hull', [(-HALF, STERN_W, 9, TOP0, 30), (HALF, 10, 1.5, TOP1, 1.5)], bevel=1.5)
    m.hull_z('hull', [(-HALF, STERN_W, BOT0, -9, 26), (HALF, 10, BOT1, -1.5, 1.5)], bevel=1.5)
    m.hull_z('black', [(-HALF + 2, STERN_W - 26, -9, 9, 3), (HALF - 4, 6, -1.5, 1.5, 0.5)])
    # trench machinery: blocks, pipes and gun galleries all along both edges
    z = -HALF + 12
    while z < HALF - 60:
        w = half_width(z)
        ln = 8 + rnd.random() * 26
        for sx in (1, -1):
            d = 6 + rnd.random() * 10
            h = 5 + rnd.random() * 11
            m.box(rnd.choice(['dark', 'hull', 'dark']), [d, h, ln], [sx * (w - 12 - d / 2), -h / 2, z + ln / 2], bevel=0.5)
            if rnd.random() < 0.3:
                m.box('windows', [0.8, 1.2, ln * 0.7], [sx * (w - 11.4), -0.6, z + ln / 2])
        z += ln + 2 + rnd.random() * 6

    # ------------------------------------------------------------ superstructure: three flat terraces
    terraces = [  # (z_stern, width_stern, z_front, width_front, y_bottom, height)
        (-HALF + 2, 610, 270, 60, 20, 78),
        (-HALF + 10, 400, -130, 84, 96, 48),
        (-HALF + 20, 262, -410, 104, 142, 42),
    ]
    for z0, w0, z1, w1, y0, h in terraces:
        m.prism('hull', trapezoid(z0, w0, z1, w1), y0, h, trapezoid(z0, w0 - 14, z1 - 6, w1 - 10), bevel=1.6)
        # a recessed band with a line of lit viewports round each terrace
        m.prism('dark', trapezoid(z0 - 0.5, w0 + 1.6, z1 + 1.2, w1 + 1.6), y0 + h * 0.44, h * 0.16, bevel=0.4)
        m.prism('windows', trapezoid(z0 - 0.9, w0 + 2.6, z1 + 1.8, w1 + 2.6), y0 + h * 0.5, 1.6)
    # ------------------------------------------------------------ greebles: the "city" on every deck
    def deck(count, zr, y_of, clear, sizes, heights):
        """Scatter low blocks over a deck. clear(x, z) -> True where something bigger already stands."""
        for _ in range(count):
            zz = zr[0] + rnd.random() * (zr[1] - zr[0])
            lim = y_of(zz)[1]
            if lim < 12:
                continue
            xx = (rnd.random() * 2 - 1) * lim
            if clear(xx, zz):
                continue
            sx = sizes[0] + rnd.random() * (sizes[1] - sizes[0])
            sz = sizes[0] + rnd.random() * (sizes[1] - sizes[0]) * 1.6
            hh = heights[0] + rnd.random() * (heights[1] - heights[0])
            yy = y_of(zz)[0]
            m.box(rnd.choice(tones), [sx, hh, sz], [xx, yy - 0.6, zz], bevel=0.4)
            if rnd.random() < 0.18:  # a smaller block stacked on top
                m.box(rnd.choice(tones), [sx * 0.5, hh * 0.8, sz * 0.5], [xx + sx * 0.1, yy + hh - 0.8, zz - sz * 0.1], bevel=0.3)

    def on_terrace(i):
        z0, w0, z1, w1, y0, h = terraces[i]
        return lambda x, z: z0 - 4 < z < z1 + 4 and abs(x) < (w0 + (w1 - w0) * (z - z0) / (z1 - z0)) / 2 + 6

    # upper hull, outside the first terrace
    deck(900, (-HALF + 10, HALF - 80), lambda z: (top_y(z), half_width(z) - 34), on_terrace(0), (8, 30), (2, 7))
    # terrace tops
    for i, (z0, w0, z1, w1, y0, h) in enumerate(terraces):
        inner = on_terrace(i + 1) if i + 1 < len(terraces) else (lambda x, z: z < -HALF + 250 and abs(x) < 95)
        wid = lambda z, z0=z0, w0=w0, z1=z1, w1=w1: (w0 + (w1 - w0) * (z - z0) / (z1 - z0)) / 2 - 16
        deck(260 - i * 60, (z0 + 10, z1 - 12), lambda z, y=y0 + h, wid=wid: (y, wid(z)), inner, (6, 22), (2, 8))
    # under-hull, sparser
    for _ in range(420):
        zz = -HALF + 20 + rnd.random() * (L - 120)
        lim = half_width(zz) - 34
        if lim < 14:
            continue
        xx = (rnd.random() * 2 - 1) * lim
        if abs(xx) < 130 and -420 < zz < -40:
            continue  # the hangar bay
        sx, sz, hh = 8 + rnd.random() * 26, 8 + rnd.random() * 34, 2 + rnd.random() * 5
        m.box(rnd.choice(tones), [sx, hh, sz], [xx, bot_y(zz) - hh + 0.6, zz], bevel=0.4)

    # dorsal spine: a raised keel running forward from the terraces, with turrets either side
    for i in range(12):
        zz = 300 + i * 38
        m.box('dark', [18 - i * 0.9, 5, 30], [0, top_y(zz) - 0.5, zz], bevel=0.6)
    for sx in (1, -1):
        for i in range(4):
            zz = -520 + i * 92
            xx = sx * (half_width(zz) - 70)
            m.cyl('dark', 15, 18, 7, [xx, top_y(zz) - 0.5, zz], seg=12, bevel=0.6)
            m.cyl('hull', 10, 12, 6, [xx, top_y(zz) + 6.5, zz], seg=12, bevel=0.5)
            for dx in (-3.5, 3.5):
                m.beam('black', (xx + dx, top_y(zz) + 9.5, zz + 6), (xx + dx, top_y(zz) + 11, zz + 34), 1.6)

    # ------------------------------------------------------------ bridge tower
    m.taper('hull', (150, 104), (112, 84), 96, [0, 184, -640], bevel=2)       # neck
    for i in range(3):
        m.box('dark', [156 - i * 12, 5, 110 - i * 6], [0, 200 + i * 26, -640], bevel=0.8)
    m.prism('hull', trapezoid(-694, 420, -590, 330), 280, 22, trapezoid(-690, 430, -586, 340), bevel=1.4)   # bridge
    m.prism('hull', trapezoid(-690, 430, -586, 340), 302, 44, trapezoid(-686, 410, -592, 320), bevel=1.6)
    m.prism('black', trapezoid(-586.5, 336, -584.6, 328), 318, 9)             # bridge window band
    m.prism('windows', trapezoid(-585.0, 320, -584.2, 314), 320.5, 3.2)
    m.box('dark', [70, 20, 70], [0, 346, -640], bevel=1.2)
    m.box('hull', [30, 14, 34], [0, 366, -640], bevel=0.8)
    m.beam('dark', (0, 380, -640), (0, 430, -640), 2.4)                        # comms mast
    for sx in (1, -1):                                                        # sensor globes on stalks
        m.cyl('dark', 14, 22, 30, [sx * 150, 346, -640], seg=12, bevel=0.8)
        m.sphere('light', 38, [sx * 150, 408, -640], seg=20, rings=12)
        m.cyl('dark', 39, 39, 4, [sx * 150, 404, -640], seg=20)
    # greebles on the bridge roof and down the neck
    for _ in range(70):
        xx, zz = (rnd.random() * 2 - 1) * 185, -690 + rnd.random() * 96
        if abs(xx) < 40 or abs(abs(xx) - 150) < 26:
            continue
        m.box(rnd.choice(tones), [6 + rnd.random() * 14, 2 + rnd.random() * 6, 6 + rnd.random() * 14], [xx, 345.4, zz], bevel=0.3)

    # ------------------------------------------------------------ underside: hangar bay and reactor dome
    m.box('black', [250, 16, 370], [0, bot_y(-230) - 1, -230])
    m.box('dark', [270, 6, 390], [0, bot_y(-230) - 3, -230], bevel=1)
    m.box('black', [236, 9, 356], [0, bot_y(-230) - 5, -230])
    m.box('windows', [200, 1.5, 3], [0, bot_y(-230) - 4.4, -60])
    m.sphere('hull', 110, [0, bot_y(-560) + 30, -560], seg=28, rings=14, squash=0.6, half='bottom')
    m.cyl('dark', 118, 118, 8, [0, bot_y(-560) - 2, -560], seg=28, bevel=0.8)
    for i in range(16):
        a = 2 * math.pi * i / 16
        m.box('dark', [10, 22, 22], [math.cos(a) * 84, bot_y(-560) - 44, -560 + math.sin(a) * 84], rot_y=-a, bevel=0.5)

    # ------------------------------------------------------------ stern: engine housing, three main and four auxiliary engines
    m.box('dark', [930, 118, 16], [0, -56, -HALF - 2], bevel=1.5)
    for x, y, r in [(0, -4, 86), (212, -4, 86), (-212, -4, 86)]:
        m.lathe_z('dark', x, y, [(-HALF + 20, r * 1.08), (-HALF - 46, r * 0.96), (-HALF - 96, r * 0.8)], seg=28, bevel=1.2)
        m.lathe_z('black', x, y, [(-HALF - 60, r * 0.7), (-HALF - 97, r * 0.74)], seg=28)
        m.lathe_z('engine', x, y, [(-HALF - 70, r * 0.66), (-HALF - 86, r * 0.68)], seg=28)
        for k in range(8):                                                   # nozzle vanes
            a = 2 * math.pi * k / 8
            m.beam('black', (x + math.cos(a) * r * 0.96, y + math.sin(a) * r * 0.96, -HALF - 8), (x + math.cos(a) * r * 0.82, y + math.sin(a) * r * 0.82, -HALF - 96), 5)
    for x, y, r in [(106, 50, 34), (-106, 50, 34), (330, -8, 30), (-330, -8, 30)]:
        m.lathe_z('dark', x, y, [(-HALF + 10, r * 1.1), (-HALF - 30, r), (-HALF - 54, r * 0.84)], seg=18, bevel=0.8)
        m.lathe_z('engine', x, y, [(-HALF - 40, r * 0.7), (-HALF - 52, r * 0.72)], seg=18)
    # stern plating between the engines
    for _ in range(90):
        xx, yy = (rnd.random() * 2 - 1) * 440, -52 + rnd.random() * 100
        if any(math.hypot(xx - ex, yy - ey) < er for ex, ey, er in [(0, -4, 100), (212, -4, 100), (-212, -4, 100), (106, 50, 44), (-106, 50, 44), (330, -8, 40), (-330, -8, 40)]):
            continue
        m.box(rnd.choice(tones), [10 + rnd.random() * 26, 6 + rnd.random() * 14, 4 + rnd.random() * 5], [xx, yy, -HALF - 11], bevel=0.4)
    return m


def main():
    a = bkit.args()
    out = os.path.abspath(a.get('out', 'frontend/public/models'))
    prev = a.get('preview')
    os.makedirs(out, exist_ok=True)
    bkit.reset()
    bkit.TILE = 110.0  # plating texture: one tile per 110 m
    m = build()
    ob = m.to_object()
    print(f'[destroyer] {m.tris} triangles, materials {m.mats}')
    bkit.lightmap_unwrap(ob, margin=0.002)
    img = bkit.bake_ao(ob, os.path.join(out, 'destroyer_ao.jpg'), size=int(a.get('size', '2048')), samples=int(a.get('samples', '48')),
                       distance=90.0, ground=False)
    bkit.export_glb(ob, os.path.join(out, 'destroyer.glb'))
    if prev:
        os.makedirs(prev, exist_ok=True)
        bkit.preview(ob, img, os.path.join(os.path.abspath(prev), 'destroyer.png'), (1150, 620, 1500), (0, 60, -100), ground=False, clip_end=20000)
    print('[destroyer] done')


main()
