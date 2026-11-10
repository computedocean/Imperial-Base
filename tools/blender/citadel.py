"""Imperial Command Citadel — hero model (original design).

Run (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/citadel.py -- --out frontend/public/models

Produces citadel.glb + citadel_ao.jpg (podium, buttresses, tower) and citadel_crown.glb + citadel_crown_ao.jpg
(the T-shaped command bridge, kept separate because it is hidden while the player is inside the
command chamber). Envelope matches the procedural kit in src/world/Structures.tsx:
footprint 96 × 96 m, podium tiers to y = 32, tower to y = 101.5, bridge 102 → 121.5, masts to 163.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import Model, chamfer_rect, rect  # noqa: E402


def lerp(a, b, t):
    return a + (b - a) * t


def tier(m, y0, h, w0, w1, c0, c1, win_lo, win_hi, mat_lo='hull', mat_hi='hull', inset=1.2):
    """Tapered octagonal tier: lower wall, recessed window band with mullions, ledge, upper wall, coping."""
    size = lambda y: lerp(w0, w1, (y - y0) / h)
    cham = lambda y: lerp(c0, c1, (y - y0) / h)
    o = lambda y, grow=0.0: chamfer_rect(size(y) + grow, size(y) + grow, cham(y))
    # plinth / skirt
    m.prism('dark', o(y0, 1.0), y0, 1.0, o(y0 + 1.0, 1.0), bevel=0.15)
    # lower wall
    m.prism(mat_lo, o(y0 + 1.0), y0 + 1.0, win_lo - y0 - 1.0, o(win_lo), bevel=0.12)
    # recessed window band (vertical, inset) + mullions + sill
    wy = (win_lo + win_hi) / 2
    ws = size(wy) - inset * 2
    m.prism('windows', chamfer_rect(ws, ws, cham(wy)), win_lo, win_hi - win_lo)
    m.prism('black', chamfer_rect(ws + 0.6, ws + 0.6, cham(wy)), win_lo - 0.05, 0.35)
    step = 3.2
    for side in range(4):
        n = int((ws - 2 * cham(wy)) / step)
        for i in range(n + 1):
            t = -((ws / 2) - cham(wy)) + i * step
            if abs(t) > ws / 2 - cham(wy):
                continue
            r = ws / 2 + 0.15
            x, z = [(r, t), (t, r), (-r, t), (t, -r)][side]
            m.box('black', [0.45 if side % 2 == 0 else 0.5, win_hi - win_lo, 0.5 if side % 2 == 0 else 0.45], [x, win_lo, z])
    # protruding ledge (gives a crisp shadow line)
    m.prism('dark', o(win_hi, 1.4), win_hi, 0.5, o(win_hi + 0.5, 1.4), bevel=0.1)
    # upper wall
    top = y0 + h
    m.prism(mat_hi, o(win_hi + 0.5), win_hi + 0.5, top - 0.6 - win_hi - 0.5, o(top - 0.6), bevel=0.12)
    # coping
    m.prism('dark', o(top - 0.6, 0.8), top - 0.6, 0.6, o(top, 0.8), bevel=0.1)
    return size, cham


def roof_greebles(m, inner, outer, y, seed):
    """Vents, hatches, pipes and pin lights on a ring-shaped roof deck between two square half-sizes."""
    import random
    rnd = random.Random(seed)
    mid = (inner + outer) / 2
    span = outer - inner
    for side in range(4):
        for k in range(7):
            t = -outer + 8 + k * (2 * outer - 16) / 6
            kind = rnd.random()
            x, z = [(mid, t), (t, mid), (-mid, t), (t, -mid)][side]
            if abs(t) > inner - 2 and abs(t) < outer and kind < 0.5:
                continue
            if kind < 0.35:
                m.box('dark', [3.2, 1.2, 2.2], [x, y, z], side * math.pi / 2, bevel=0.12)
                m.box('black', [2.6, 0.2, 1.6], [x, y + 1.2, z], side * math.pi / 2)
            elif kind < 0.6:
                m.cyl('dark', 1.1, 1.3, 1.6, [x, y, z], 12)
                m.cyl('black', 0.9, 0.9, 0.2, [x, y + 1.6, z], 12)
            elif kind < 0.8:
                m.box('hull', [span * 0.5, 0.6, 1.2], [x, y, z], side * math.pi / 2 + math.pi / 2, bevel=0.1)
            else:
                m.box('dark', [1.6, 2.4, 1.6], [x, y, z], 0, bevel=0.1)
                m.box('amber', [0.4, 0.4, 0.4], [x, y + 2.4, z])
    # pin lights along the outer edge
    for side in range(4):
        for k in range(9):
            t = -outer + 6 + k * (2 * outer - 12) / 8
            x, z = [(outer - 0.6, t), (t, outer - 0.6), (-outer + 0.6, t), (t, -outer + 0.6)][side]
            m.box('amber', [0.35, 0.3, 0.35], [x, y, z])


def build_base():
    m = Model('citadel')
    # ---------------------------------------------------------------- podium tier 1 (0 → 14)
    tier(m, 0.0, 14.0, 96.0, 86.0, 10.0, 9.0, 4.4, 7.2)
    m.prism('amber', chamfer_rect(86.2, 86.2, 9.0), 13.75, 0.18)
    roof_greebles(m, 36.5, 42.5, 14.0, 7)
    # ---------------------------------------------------------------- podium tier 2 (14 → 32)
    tier(m, 14.0, 18.0, 72.0, 62.0, 7.0, 6.0, 20.0, 23.6, mat_hi='dark', inset=1.0)
    m.prism('red', chamfer_rect(62.2, 62.2, 6.0), 31.75, 0.16)
    roof_greebles(m, 18.0, 30.0, 32.0, 11)
    # ---------------------------------------------------------------- corner buttresses (diagonal fins)
    for sx, sz in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        def frame(d, along, across):
            # rectangle centred on the diagonal at distance d, `along` the diagonal, `across` tangential
            ux, uz = sx / math.sqrt(2), sz / math.sqrt(2)
            tx, tz = -uz, ux
            cx, cz = ux * d, uz * d
            return [(cx + ux * a + tx * c, cz + uz * a + tz * c) for a, c in ((along / 2, -across / 2), (along / 2, across / 2), (-along / 2, across / 2), (-along / 2, -across / 2))]
        m.prism('dark', frame(60.5, 12.0, 8.0), 0.0, 3.0, frame(60.0, 11.5, 7.6), bevel=0.15)
        m.prism('dark', frame(60.0, 11.5, 7.6), 3.0, 27.0, frame(45.5, 3.5, 4.0), bevel=0.15)
        m.prism('black', frame(60.6, 2.0, 8.2), 3.0, 1.0)  # band
        m.prism('red', frame(45.5, 1.2, 1.2), 30.0, 0.9)
        # small sensor cluster on top of each fin
        ux, uz = sx / math.sqrt(2), sz / math.sqrt(2)
        m.cyl('black', 0.12, 0.18, 6.0, [ux * 45.5, 30.9, uz * 45.5], 6)
    # ---------------------------------------------------------------- tower shaft (32 → 101.5)
    y0, y1 = 32.0, 101.5
    W0, D0, W1, D1 = 34.0, 30.0, 22.0, 19.0
    tw = lambda y: (lerp(W0, W1, (y - y0) / (y1 - y0)), lerp(D0, D1, (y - y0) / (y1 - y0)))
    to = lambda y, g=0.0, c=3.2: chamfer_rect(tw(y)[0] + g, tw(y)[1] + g, c)
    m.prism('dark', to(y0, 4.0), y0, 4.0, to(y0 + 4.0, 3.0), bevel=0.15)  # collar
    m.prism('hull', to(36.0), 36.0, y1 - 2.0 - 36.0, to(y1 - 2.0), bevel=0.12)
    # horizontal seam rings every 9.5 m
    yy = 45.0
    while yy < y1 - 6:
        m.prism('black', to(yy, 0.5), yy, 0.45, to(yy + 0.45, 0.5))
        yy += 9.5
    # vertical recessed window slots: 3 per long face, 2 per short face, plus corner ribs
    def on_face(y, face, t, out=0.18):
        w, d = tw(y)
        if face == 0:
            return (t, d / 2 + out)
        if face == 1:
            return (t, -d / 2 - out)
        if face == 2:
            return (w / 2 + out, t)
        return (-w / 2 - out, t)
    for face in range(4):
        slots = (-6.0, 0.0, 6.0) if face < 2 else (-4.0, 4.0)
        for s in slots:
            for ya, yb in ((38.5, 59.0), (61.5, 80.0), (82.5, 97.5)):
                sa, sb = s * tw(ya)[0] / W0, s * tw(yb)[0] / W0
                hw = 0.75
                def slot(y, sc, g):
                    if face < 2:
                        cx, cz = on_face(y, face, sc, 0.12)
                        return rect(2 * hw + g, 0.5 + g, cx, cz)
                    cx, cz = on_face(y, face, sc, 0.12)
                    return rect(0.5 + g, 2 * hw + g, cx, cz)
                m.prism('black', slot(ya, sa, 0.7), ya - 0.35, yb - ya + 0.7, slot(yb, sb, 0.7))
                m.prism('windows', slot(ya, sa, 0.0), ya, yb - ya, slot(yb, sb, 0.0))
    # corner pilasters (follow the chamfer)
    for sx, sz in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        def pil(y, g):
            w, d = tw(y)
            cx, cz = sx * (w / 2 - 1.2), sz * (d / 2 - 1.2)
            return rect(2.4 + g, 2.4 + g, cx, cz)
        m.prism('dark', pil(36.0, 0.6), 36.0, y1 - 36.0 - 1.0, pil(y1 - 1.0, 0.6), bevel=0.1)
    # top cap
    m.prism('dark', to(y1 - 2.0, 1.2), y1 - 2.0, 2.0, to(y1, 1.6), bevel=0.15)
    m.prism('amber', to(y1 - 1.0, 1.5), y1 - 1.0, 0.16)
    # ---------------------------------------------------------------- grand entrance (south, +z)
    m.box('black', [20.0, 10.0, 3.0], [0.0, 0.0, 47.5])                      # door recess
    m.box('dark', [22.0, 0.6, 4.0], [0.0, 10.0, 48.5], bevel=0.1)           # lintel
    m.prism('dark', [(-16, 47.0), (16, 47.0), (14, 55.0), (-14, 55.0)], 11.0, 1.4,
            [(-15, 47.0), (15, 47.0), (13, 54.2), (-13, 54.2)], bevel=0.15)  # cantilevered canopy
    m.prism('amber', [(-12, 54.3), (12, 54.3), (12, 54.6), (-12, 54.6)], 11.1, 0.2)
    for sx in (-1, 1):
        m.prism('dark', rect(3.4, 7.0, sx * 13.5, 50.5), 0.0, 14.0, rect(2.4, 5.0, sx * 13.5, 50.0), bevel=0.15)
        m.box('red', [0.6, 0.6, 0.6], [sx * 13.5, 14.0, 50.0])
        m.box('amber', [0.25, 9.0, 0.25], [sx * 12.0, 0.6, 54.0])
    # steps + plaza
    for i, (w, d) in enumerate(((44.0, 16.0), (40.0, 13.5), (36.0, 11.0))):
        m.box('concrete', [w, 0.22, d], [0.0, i * 0.22, 48.0 + d / 2])
    # side entrances (east / west) — smaller blast doors
    for sx in (-1, 1):
        m.box('black', [3.0, 6.0, 9.0], [sx * 47.6, 0.0, 0.0])
        m.box('dark', [4.0, 0.6, 11.0], [sx * 48.0, 6.0, 0.0], bevel=0.1)
        m.box('amber', [0.3, 0.3, 9.0], [sx * 49.9, 5.6, 0.0])
    return m


def build_crown():
    m = Model('citadel_crown')
    # keel connecting the tower top (22 × 19 at y 101.5) to the bridge
    m.prism('dark', chamfer_rect(26, 20, 3), 100.6, 1.6, chamfer_rect(52, 20, 3), bevel=0.15)
    m.prism('dark', rect(70, 20), 102.2, 1.8, rect(70, 20), bevel=0.15)
    # bridge bars: octagonal cross-section, ends pinched
    def prof_x(x, s=1.0):  # profile in (z, y) at given x
        pts = [(-7.0, 104.0), (7.0, 104.0), (9.4, 107.2), (9.4, 111.0), (7.8, 114.0), (-7.8, 114.0), (-9.4, 111.0), (-9.4, 107.2)]
        return [(x, 109.0 + (y - 109.0) * s, z * s) for z, y in pts]
    def prof_z(z, s=1.0):
        pts = [(7.0, 104.0), (-7.0, 104.0), (-8.8, 107.2), (-8.8, 111.0), (-7.4, 114.0), (7.4, 114.0), (8.8, 111.0), (8.8, 107.2)]
        return [(x * s, 109.0 + (y - 109.0) * s, z) for x, y in pts]
    m.loft('hull', [prof_x(-33.5, 0.78), prof_x(-30.5), prof_x(30.5), prof_x(33.5, 0.78)], bevel=0.12)
    m.loft('hull', [prof_z(22.0, 0.8), prof_z(19.0), prof_z(-19.0), prof_z(-22.0, 0.8)], bevel=0.12)
    # glazing: sloped-glass band on the long faces, lit strip above
    for sz in (-1, 1):
        m.loft('glass', [[(-29.5, 107.4, sz * 9.5), (29.5, 107.4, sz * 9.5), (29.5, 110.8, sz * 9.5), (-29.5, 110.8, sz * 9.5)],
                         [(-29.5, 107.4, sz * 9.62), (29.5, 107.4, sz * 9.62), (29.5, 110.8, sz * 9.62), (-29.5, 110.8, sz * 9.62)]])
        m.box('windows', [59.0, 0.7, 0.2], [0.0, 111.15, sz * 9.25])
        for k in range(25):
            x = -28.8 + k * 2.4
            m.box('black', [0.35, 3.6, 0.3], [x, 107.3, sz * 9.6])
    for sx in (-1, 1):
        for segs in ((-19.5, -9.8), (9.8, 19.5)):
            m.loft('glass', [[(sx * 8.9, 107.4, segs[0]), (sx * 8.9, 107.4, segs[1]), (sx * 8.9, 110.8, segs[1]), (sx * 8.9, 110.8, segs[0])],
                             [(sx * 9.02, 107.4, segs[0]), (sx * 9.02, 107.4, segs[1]), (sx * 9.02, 110.8, segs[1]), (sx * 9.02, 110.8, segs[0])]])
            for k in range(4):
                z = segs[0] + 0.6 + k * (segs[1] - segs[0] - 1.2) / 3
                m.box('black', [0.3, 3.6, 0.35], [sx * 9.0, 107.3, z])
    # forward observation blister at both ends of the long bar
    for sx in (-1, 1):
        m.loft('glass', [[(sx * 33.4, 106.0, -4.0), (sx * 33.4, 106.0, 4.0), (sx * 33.4, 111.5, 4.0), (sx * 33.4, 111.5, -4.0)],
                         [(sx * 34.3, 106.8, -3.2), (sx * 34.3, 106.8, 3.2), (sx * 34.3, 110.8, 3.2), (sx * 34.3, 110.8, -3.2)]])
        m.box('red', [0.9, 0.9, 0.9], [sx * 34.0, 112.0, 0.0])
    # roof deck + sensor tower
    m.prism('dark', rect(58, 13.5), 114.0, 1.6, rect(56, 12.0), bevel=0.12)
    m.prism('dark', rect(13, 38), 114.0, 1.6, rect(11.5, 36.5), bevel=0.12)
    m.prism('hull', chamfer_rect(16, 16, 3), 115.6, 6.0, chamfer_rect(8.5, 8.5, 1.5), bevel=0.12)
    m.prism('windows', chamfer_rect(13.1, 13.1, 2.4), 117.6, 0.8)
    m.prism('dark', chamfer_rect(9, 9, 1.6), 121.6, 1.0, chamfer_rect(8, 8, 1.4), bevel=0.1)
    # roof greebles + pin lights
    for x in (-24, -16, 16, 24):
        m.box('black', [3.0, 0.9, 5.0], [x, 115.6, 0.0], bevel=0.08)
        m.cyl('dark', 0.9, 1.0, 1.2, [x, 116.5, 0.0], 10)
    for z in (-15, 15):
        m.box('black', [5.0, 0.9, 3.0], [0.0, 115.6, z], bevel=0.08)
    for x in range(-27, 28, 6):
        for sz in (-1, 1):
            m.box('amber', [0.3, 0.3, 0.3], [x, 115.6, sz * 6.2])
    # primary lattice mast (to y 163)
    mx, mz = 6.0, 0.0
    base_r, top_r = 1.6, 0.45
    legs = 3
    y_lo, y_hi = 122.6, 163.0
    leg = lambda i, y: (mx + lerp(base_r, top_r, (y - y_lo) / (y_hi - y_lo)) * math.cos(2 * math.pi * i / legs + 0.3), y,
                        mz + lerp(base_r, top_r, (y - y_lo) / (y_hi - y_lo)) * math.sin(2 * math.pi * i / legs + 0.3))
    for i in range(legs):
        m.beam('black', leg(i, y_lo), leg(i, y_hi), 0.32)
    yy = y_lo
    while yy < y_hi - 3.5:
        for i in range(legs):
            m.beam('black', leg(i, yy), leg((i + 1) % legs, yy + 3.5), 0.14)
            m.beam('black', leg(i, yy + 3.5), leg((i + 1) % legs, yy + 3.5), 0.14)
        yy += 3.5
    m.box('red', [1.3, 1.3, 1.3], [mx, 162.6, mz])
    m.box('red', [0.7, 0.7, 0.7], [mx, 145.0, mz])
    # cross-arm with emitters
    m.beam('black', (mx - 5.0, 140.0, mz), (mx + 5.0, 140.0, mz), 0.25)
    for s in (-1, 1):
        m.cyl('dark', 0.35, 0.35, 1.4, [mx + s * 5.0, 139.3, mz], 8)
    # secondary mast with sensor dish (to y 153)
    sx2, sz2 = -7.0, 3.0
    m.cyl('black', 0.35, 0.75, 30.5, [sx2, 122.6, sz2], 8)
    m.box('red', [1.1, 1.1, 1.1], [sx2, 152.6, sz2])
    m.dish('dark', 3.2, 1.1, (sx2, 140.0, sz2 + 1.0), tilt_x=math.radians(-60), rot_y=0.0, seg=18)
    m.dish('dark', 2.0, 0.6, (-20.0, 116.6, 0.0), tilt_x=math.radians(-35), rot_y=math.radians(90), seg=14)
    m.dish('dark', 2.0, 0.6, (20.0, 116.6, 0.0), tilt_x=math.radians(-35), rot_y=math.radians(-90), seg=14)
    return m


def main():
    a = bkit.args()
    out = os.path.abspath(a.get('out', 'frontend/public/models'))
    prev = a.get('preview')
    size = int(a.get('size', '2048'))
    samples = int(a.get('samples', '64'))
    os.makedirs(out, exist_ok=True)
    for build, name, cam in ((build_base, 'citadel', ((150, 70, 170), (0, 30, 0))),
                             (build_crown, 'citadel_crown', ((70, 135, 80), (0, 112, 0)))):
        bkit.reset()
        m = build()
        ob = m.to_object()
        print(f'[citadel] {name}: {m.tris} triangles, materials {m.mats}')
        bkit.lightmap_unwrap(ob)
        img = bkit.bake_ao(ob, os.path.join(out, f'{name}_ao.jpg'), size=size if name == 'citadel' else 1024, samples=samples,
                           distance=8.0 if name == 'citadel' else 4.0, ground=name == 'citadel')
        bkit.export_glb(ob, os.path.join(out, f'{name}.glb'))
        if prev:
            os.makedirs(prev, exist_ok=True)
            bkit.preview(ob, img, os.path.join(os.path.abspath(prev), f'{name}.png'), *cam)
    print('[citadel] done')


main()
