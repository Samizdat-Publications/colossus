"""COLOSSUS arena family: the drowned ring of the Ruin.

Built from src/data/arena_layout.json (three.js space, metres). Objects the game looks up by name:
  floor_stones  concentric rings of real flagstones (top at y = 0), some missing, some sunk
  floor_water   dark water below the stones (shows in the gaps and the holes)
  seal_stones   the carved seal the golem sleeps on;  seal_runes  its inlaid rune channels (faint glow)
  arcade        the ring wall: piers, voussoir arches and an attic band, several bays collapsed
  wall_rubble   fallen blocks at the foot of the collapsed bays
  tiers         the stepped seating outside the arcade
  cliffs        a ring of jagged rock that closes the horizon
Materials: floor_stone, floor_water, seal_stone, seal_rune, wall_stone, tier_stone, cliff_rock.
Output: public/assets/arena.glb, preview test-output/asset-previews/arena_*.png.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import math  # noqa: E402
import random  # noqa: E402
from mathutils import Vector, noise  # noqa: E402
import co_common as C  # noqa: E402

A = C.load_json('arena_layout.json')
TAU = math.tau


def polar(r, a, y=0.0):
    """Arena angle convention: a = 0 points to +Z (the gate, south), increasing toward +X."""
    return Vector((math.sin(a) * r, y, math.cos(a) * r))


def slab_points(r0, r1, a0, a1, top, bottom, rng, jitter=0.02):
    n = max(2, int((a1 - a0) * r1 / 1.2) + 1)
    pts = []
    for i in range(n):
        a = a0 + (a1 - a0) * i / (n - 1)
        for r in (r0, r1):
            jr = r + rng.uniform(-jitter, jitter)
            pts.append(polar(jr, a, top + rng.uniform(-0.008, 0.008)))
            pts.append(polar(jr, a, bottom))
    return pts


class Batch:
    """Many pieces merged into one mesh object (one draw call)."""

    def __init__(self):
        self.bm = bmesh.new()

    def add(self, bm, mat=0):
        C.merge_bm(self.bm, bm, mat)
        bm.free()


# ------------------------------------------------------------------ floor

def build_floor(rng):
    floor = Batch()
    r = A['sealRadius'] + 0.15
    ring = 0
    stats = {'stones': 0, 'holes': 0}
    while r < A['floorRadius'] - 0.5:
        w = rng.uniform(1.6, 2.3)
        r0, r1 = r + 0.04, r + w - 0.04
        a = rng.uniform(0, TAU)
        a_end = a + TAU
        while a < a_end - 1e-3:
            L = rng.uniform(1.4, 3.0)
            da = min(L / ((r0 + r1) / 2), a_end - a)
            if a_end - (a + da) < 0.9 / r1:
                da = a_end - a
            a0, a1 = a + 0.05 / r0, a + da - 0.05 / r0
            a += da
            outside = r0 > A['wallRadius'] + 3.5
            if rng.random() < (0.06 if not outside else 0.2):
                stats['holes'] += 1
                continue
            sunk = -0.035 if rng.random() < 0.08 else 0.0
            if rng.random() < 0.12 and a1 - a0 > 0.02:
                # a cracked stone: two pieces, one slightly tipped
                mid = (a0 + a1) / 2 + rng.uniform(-0.2, 0.2) * (a1 - a0)
                parts = [(a0, mid - 0.015 / r0, sunk), (mid + 0.015 / r0, a1, sunk - rng.uniform(0.01, 0.03))]
            else:
                parts = [(a0, a1, sunk)]
            for b0, b1, dy in parts:
                bm = C.hull_bm(slab_points(r0, r1, b0, b1, dy, -0.28, rng))
                C.bevel_bm(bm, 0.035, segments=1, top_only=True)
                cen = polar((r0 + r1) / 2, (b0 + b1) / 2)
                C.box_uv(bm, 4.0, offset=(rng.random() + cen.x * 0.0, rng.random()), rot=rng.uniform(0, TAU))
                v = rng.uniform(0.72, 1.05)
                warm = rng.uniform(-0.04, 0.04)
                dirt = C.smoothstep(A['wallRadius'] - 6, A['wallRadius'], (r0 + r1) / 2)
                k = v * (1 - 0.35 * dirt)
                C.paint_bm(bm, lambda p, n, k=k, warm=warm: (k * (1 + warm), k, k * (1 - warm)))
                floor.add(bm)
                stats['stones'] += 1
        r += w
        ring += 1
    stats['rings'] = ring
    return floor, stats


def build_water():
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=A['floorRadius'] + 2, segments=96)
    bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=C.rot_x(-90))
    C.transform_bm(bm, None, (0, -0.07, 0))
    C.planar_uv(bm, 8.0)
    C.paint_bm(bm, lambda p, n: (1, 1, 1))
    return bm


# ------------------------------------------------------------------ seal

def build_seal(rng):
    stones, runes = Batch(), Batch()
    R = A['sealRadius']
    rings = [(0.0, 1.9, 1), (1.95, 4.3, 8), (4.35, R, 16)]
    for r0, r1, n in rings:
        for i in range(n):
            a0 = i / n * TAU + (0.02 if n > 1 else 0)
            a1 = (i + 1) / n * TAU - (0.02 if n > 1 else 0)
            if n == 1:
                bm = C.cylinder_bm(r1, r1, 0.3, 32, y0=-0.3)
            else:
                bm = C.hull_bm(slab_points(r0 + 0.03, r1 - 0.03, a0, a1, 0.0, -0.3, rng, jitter=0.0))
            C.bevel_bm(bm, 0.04, segments=1)
            C.box_uv(bm, 4.0, offset=(rng.random(), rng.random()))
            k = rng.uniform(0.62, 0.8)
            C.paint_bm(bm, lambda p, n, k=k: (k, k * 0.98, k * 0.95))
            stones.add(bm)
    # rune channels: a circle of short strokes and radial spokes, inlaid just below the stone surface
    for i in range(24):
        a = i / 24 * TAU
        L = 0.55 if i % 3 else 0.9
        bm = C.box_bm((0.09, 0.02, L))
        C.transform_bm(bm, C.rot_y(math.degrees(a)), polar(5.35, a, 0.004))
        runes.add(bm)
    for i in range(8):
        a = (i + 0.5) / 8 * TAU
        bm = C.box_bm((0.08, 0.02, 1.9))
        C.transform_bm(bm, C.rot_y(math.degrees(a)), polar(3.1, a, 0.004))
        runes.add(bm)
    ring = bmesh.new()
    bmesh.ops.create_circle(ring, cap_ends=False, radius=1.55, segments=48)
    ring.free()
    for i in range(36):
        a = i / 36 * TAU
        bm = C.box_bm((0.07, 0.02, 0.28))
        C.transform_bm(bm, C.rot_y(math.degrees(a) + 90), polar(1.5, a, 0.004))
        runes.add(bm)
    C.paint_bm(runes.bm, lambda p, n: (1, 1, 1))
    return stones, runes


# ------------------------------------------------------------------ arcade

BAYS = 24


def voussoir(r_in, r_out, cx, cy, radius, t0, t1, depth_in, depth_out, rng):
    """One wedge of an arch in the arch's local frame: the arch plane is local XY, depth along Z."""
    pts = []
    for t in (t0, t1):
        for rr in (radius, radius + 0.85):
            x = cx + math.cos(t) * rr
            y = cy + math.sin(t) * rr
            for z in (depth_in, depth_out):
                pts.append(Vector((x + rng.uniform(-0.01, 0.01), y, z)))
    return pts


def build_arcade(rng):
    arcade, rubble = Batch(), Batch()
    Rw = A['wallRadius']
    depth = 2.6
    pier_w = 2.5
    impost = 4.8
    gate_bay = 0
    ruined = {3, 7, 8, 13, 17, 21}
    for b in range(BAYS):
        a_pier = (b + 0.5) / BAYS * TAU  # pier after bay b
        # frame: local X = tangent, Y = up, Z = outward
        def to_world(p, a=a_pier):
            t = Vector((math.cos(a), 0, -math.sin(a)))
            o = Vector((math.sin(a), 0, math.cos(a)))
            base = polar(Rw, a)
            return base + t * p.x + Vector((0, p.y, 0)) + o * p.z

        broken_h = None
        if b in ruined and rng.random() < 0.7:
            broken_h = rng.uniform(2.0, impost + 2.5)
        # pier: stacked courses of ashlar blocks
        y = 0.0
        course = 0
        while y < (broken_h if broken_h else impost + 0.9):
            h = rng.uniform(0.55, 0.75)
            if broken_h and y + h > broken_h:
                break
            off = 0.12 if course % 2 else -0.12
            for seg in ((-pier_w / 2, 0.0 + off), (0.0 + off, pier_w / 2)):
                w = seg[1] - seg[0] - 0.03
                cx = (seg[0] + seg[1]) / 2
                pts = [Vector((cx + sx * w / 2, y + 0.015 + sy * 0, 0.0)) for sx in (-1, 1) for sy in (0,)]
                bm = C.hull_bm(C.block_points(rng, (w, h - 0.03, depth), chips=rng.randint(0, 2), chip=(0.03, 0.1)))
                C.bevel_bm(bm, 0.03, segments=1)
                C.transform_bm(bm, None, (cx, y + h / 2, depth / 2))
                for v in bm.verts:
                    v.co = to_world(v.co)
                C.box_uv(bm, 4.0, offset=(rng.random(), rng.random()))
                k = rng.uniform(0.7, 0.95) * (0.75 + 0.25 * C.smoothstep(0, 3, y))
                C.paint_bm(bm, lambda p, n, k=k: (k, k * 0.985, k * 0.96))
                arcade.add(bm)
                del pts
            y += h
            course += 1
        # the arch of the next bay (between this pier and the one after it)
        a_next = (b + 1.5) / BAYS * TAU
        chord = 2 * Rw * math.sin((a_next - a_pier) / 2)
        span = chord - pier_w
        radius = span / 2
        mid_a = (a_pier + a_next) / 2
        bay = (b + 1) % BAYS
        bay_ruined = bay in ruined
        keep = 1.0 if not bay_ruined else rng.uniform(0.0, 0.5)
        n_v = 11
        def arch_world(p, a=mid_a):
            t = Vector((math.cos(a), 0, -math.sin(a)))
            o = Vector((math.sin(a), 0, math.cos(a)))
            base = polar(Rw * math.cos((a_next - a_pier) / 2), a)
            return base + t * p.x + Vector((0, p.y, 0)) + o * p.z
        for i in range(n_v):
            if bay_ruined and (i / n_v > keep and (n_v - 1 - i) / n_v > keep):
                continue
            t0 = math.pi - i / n_v * math.pi - 0.005
            t1 = math.pi - (i + 1) / n_v * math.pi + 0.005
            pts = voussoir(0, 0, 0.0, impost + 0.9, radius, t0, t1, 0.0, depth, rng)
            bm = C.hull_bm(pts)
            C.bevel_bm(bm, 0.03, segments=1)
            for v in bm.verts:
                v.co = arch_world(v.co)
            C.box_uv(bm, 4.0, offset=(rng.random(), rng.random()))
            k = rng.uniform(0.75, 0.95)
            C.paint_bm(bm, lambda p, n, k=k: (k, k * 0.985, k * 0.96))
            arcade.add(bm)
        # spandrel and attic courses above the arch
        if not bay_ruined or keep > 0.35:
            top0 = impost + 0.9 + radius + 0.85
            yy = impost + 0.9
            while yy < top0 + 1.6:
                h = rng.uniform(0.55, 0.7)
                x = -chord / 2 - 0.2
                while x < chord / 2 + 0.2:
                    w = rng.uniform(1.6, 2.6)
                    cx = x + w / 2
                    # skip blocks inside the arch opening
                    inside = abs(cx) < radius + 0.6 and yy + h / 2 < impost + 0.9 + math.sqrt(max(0.0, (radius + 0.6) ** 2 - cx * cx))
                    if not inside and (not bay_ruined or rng.random() < 0.6):
                        bm = C.hull_bm(C.block_points(rng, (w - 0.03, h - 0.03, depth * 0.9), chips=rng.randint(0, 2),
                                                      chip=(0.03, 0.1)))
                        C.transform_bm(bm, None, (cx, yy + h / 2, depth * 0.45))
                        for v in bm.verts:
                            v.co = arch_world(v.co)
                        C.box_uv(bm, 4.0, offset=(rng.random(), rng.random()))
                        k = rng.uniform(0.7, 0.92)
                        C.paint_bm(bm, lambda p, n, k=k: (k, k * 0.985, k * 0.96))
                        arcade.add(bm)
                    x += w
                yy += h
        # fallen blocks at the foot of ruined bays (inside the ring, beyond the warrior's reach)
        if bay_ruined:
            for j in range(rng.randint(5, 9)):
                a = mid_a + rng.uniform(-0.08, 0.08)
                rr = Rw - rng.uniform(0.3, 2.4)
                s = (rng.uniform(0.7, 1.5), rng.uniform(0.5, 0.8), rng.uniform(0.9, 2.0))
                bm = C.hull_bm(C.block_points(rng, s, chips=3, chip=(0.08, 0.25)))
                C.bevel_bm(bm, 0.03, segments=1)
                C.transform_bm(bm, C.rand_rot(rng, 25) @ C.rot_y(rng.uniform(0, 360)), polar(rr, a, s[1] * 0.35))
                C.box_uv(bm, 4.0, offset=(rng.random(), rng.random()))
                k = rng.uniform(0.65, 0.85)
                C.paint_bm(bm, lambda p, n, k=k: (k, k * 0.985, k * 0.96))
                rubble.add(bm)
    return arcade, rubble


def build_tiers(rng):
    tiers = Batch()
    steps = 8
    for s in range(steps):
        r0 = 43.0 + s * 1.9
        r1 = r0 + 1.9
        top = 2.2 + s * 1.45
        n = 48
        for i in range(n):
            a0 = i / n * TAU
            a1 = (i + 1) / n * TAU
            mid = (a0 + a1) / 2
            gap = abs(math.atan2(math.sin(mid), math.cos(mid))) < 0.12  # the gate passage
            collapse = noise.noise(Vector((math.cos(mid) * 2.0, math.sin(mid) * 2.0, s * 0.35))) > 0.25 + 0.05 * (steps - s)
            if gap or collapse:
                continue
            bm = C.hull_bm(slab_points(r0, r1, a0 + 0.004, a1 - 0.004, top, top - 1.5, rng, jitter=0.05))
            C.bevel_bm(bm, 0.05, segments=1, top_only=True)
            C.box_uv(bm, 4.0, offset=(rng.random(), rng.random()))
            k = rng.uniform(0.55, 0.75)
            C.paint_bm(bm, lambda p, n, k=k: (k, k, k * 0.97))
            tiers.add(bm)
    return tiers


def build_cliffs(rng):
    """Two rings of jagged rock close the horizon: a near wall and a taller, broken ridge behind it."""
    bm = bmesh.new()

    def ring(base_r, base_h, var_h, n, rows, seed):
        verts = []
        for j in range(rows):
            t = j / (rows - 1)
            row = []
            for i in range(n):
                a = i / n * TAU
                ca, sa = math.cos(a), math.sin(a)
                base = base_r + 10 * noise.noise(Vector((ca * 1.5, sa * 1.5, seed)))
                h = base_h + var_h * (0.5 + 0.5 * noise.noise(Vector((ca * 2.2, sa * 2.2, seed + 5.1))))
                h += var_h * 0.35 * noise.noise(Vector((ca * 7, sa * 7, seed + 2.0)))
                h += var_h * 0.15 * noise.noise(Vector((ca * 19, sa * 19, seed + 9.0)))
                y = -2 + h * t
                r = base + 7 * t * t + 3.5 * noise.noise(Vector((ca * 9, sa * 9, seed + t * 3)))
                r += 1.5 * noise.noise(Vector((ca * 23, sa * 23, seed + t * 5)))
                row.append(bm.verts.new(polar(r, a, y)))
            verts.append(row)
        for j in range(rows - 1):
            for i in range(n):
                i2 = (i + 1) % n
                bm.faces.new((verts[j][i], verts[j][i2], verts[j + 1][i2], verts[j + 1][i]))

    ring(74, 16, 22, 160, 10, 0.3)
    ring(118, 34, 34, 128, 9, 7.7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # faces point inward (toward the arena)
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot(Vector((-c.x, 0, -c.z))) < 0:
            f.normal_flip()
    C.box_uv(bm, 12.0)
    C.paint_bm(bm, lambda p, n: (0.5 + 0.3 * C.smoothstep(0, 40, p.y),) * 3)
    return bm


def main():
    rng = random.Random(1234)
    C.reset()
    mats = {
        'floor_stone': C.material('floor_stone', color=(0.62, 0.62, 0.64), rough=0.5, tex='ashlar'),
        'floor_water': C.material('floor_water', color=(0.02, 0.025, 0.03), rough=0.06, use_vcol=False),
        'seal_stone': C.material('seal_stone', color=(0.55, 0.55, 0.57), rough=0.55, tex='ashlar'),
        'seal_rune': C.material('seal_rune', color=(0.1, 0.06, 0.03), rough=0.5, emission=(1.0, 0.6, 0.3), strength=1.5,
                                use_vcol=False),
        'wall_stone': C.material('wall_stone', color=(0.66, 0.65, 0.64), rough=0.85, tex='ashlar'),
        'tier_stone': C.material('tier_stone', color=(0.5, 0.5, 0.52), rough=0.9, tex='ashlar'),
        'cliff_rock': C.material('cliff_rock', color=(0.3, 0.3, 0.32), rough=0.95, tex='rock'),
    }
    floor, fstats = build_floor(rng)
    objs = []
    objs.append(C.new_object('floor_stones', floor.bm, [mats['floor_stone']], smooth=30))
    objs.append(C.new_object('floor_water', build_water(), [mats['floor_water']]))
    seal, runes = build_seal(rng)
    objs.append(C.new_object('seal_stones', seal.bm, [mats['seal_stone']], smooth=30))
    objs.append(C.new_object('seal_runes', runes.bm, [mats['seal_rune']]))
    arcade, rubble = build_arcade(rng)
    objs.append(C.new_object('arcade', arcade.bm, [mats['wall_stone']], smooth=30))
    objs.append(C.new_object('wall_rubble', rubble.bm, [mats['wall_stone']], smooth=30))
    objs.append(C.new_object('tiers', build_tiers(rng).bm, [mats['tier_stone']], smooth=30))
    objs.append(C.new_object('cliffs', build_cliffs(rng), [mats['cliff_rock']], smooth=50))
    stats = dict(fstats)
    stats['tris'] = C.tri_count(objs)
    for ob in objs:
        stats[f'tris_{ob.name}'] = C.tri_count([ob])
    C.log('arena', stats)
    stats['glb_bytes'] = C.export_glb(os.path.join(C.ASSETS, 'arena.glb'), objs)

    C.preview_setup(world_color=(0.03, 0.04, 0.06), strength=0.7)
    C.sun((0.35, -0.6, 0.72), energy=2.5, color=(0.8, 0.86, 1.0))
    C.camera((0, 30, 62), (0, 2, 0), lens=24)
    C.render_preview('arena_overview')
    C.camera((6, 2.2, 22), (-4, 4, -30), lens=24)
    C.render_preview('arena_ground')
    C.write_report('arena', stats)


C.run(main)
