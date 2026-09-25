"""COLOSSUS pillars family: the colonnade of the ruined arena, plus its braziers.

Top-level objects named as the game looks them up (arena_layout.json 'type'), origin at ground contact:
  pillar_intact (13.5 m, with a fragment of architrave), pillar_broken_tall (9.4 m), pillar_broken_mid
  (5.2 m), pillar_stump (2.2 m), pillar_fallen (drums lying along +X, 9 m, radius 0.95),
  capital_fragment, brazier (stone post, iron bowl, coals; the flame is drawn by the game)
Materials: pillar_stone, brazier_iron, coals.
Output: public/assets/pillars.glb, preview test-output/asset-previews/pillars.png.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import math  # noqa: E402
import random  # noqa: E402
from mathutils import Vector  # noqa: E402
import co_common as C  # noqa: E402

STONE, IRON, COALS = range(3)


class Batch:
    def __init__(self):
        self.bm = bmesh.new()

    def add(self, bm, mat=STONE, uv_tile=4.0, rng=None, tint=None):
        if uv_tile:
            C.box_uv(bm, uv_tile, offset=((rng.random(), rng.random()) if rng else (0, 0)))
        if tint is not None:
            C.paint_bm(bm, tint)
        C.merge_bm(self.bm, bm, mat)
        bm.free()


def stone_tint(rng, base=None):
    k = base if base is not None else rng.uniform(0.72, 0.92)

    def fn(p, n):
        g = C.lerp(0.62, 1.0, C.smoothstep(0.0, 2.5, p.y))  # grime and damp at the foot
        return (k * g, k * g * 0.99, k * g * 0.965)
    return fn


def base_parts(b, rng):
    blk = C.hull_bm(C.block_points(rng, (3.0, 0.55, 3.0), chips=2, chip=(0.04, 0.12)))
    C.bevel_bm(blk, 0.05, segments=2)
    C.transform_bm(blk, C.rot_y(rng.uniform(-3, 3)), (0, 0.275, 0))
    b.add(blk, rng=rng, tint=stone_tint(rng))
    b.add(C.cylinder_bm(1.44, 1.38, 0.28, 32, y0=0.55), rng=rng, tint=stone_tint(rng))
    b.add(C.cylinder_bm(1.36, 1.26, 0.16, 32, y0=0.83), rng=rng, tint=stone_tint(rng))
    return 0.99


def shaft(b, rng, y, drums, r_bot=1.2, r_top=1.03, top_h=12.1, broken=0.0, broken_h=None):
    for i in range(drums):
        last = i == drums - 1
        h = rng.uniform(1.7, 1.9) if not (last and broken_h) else broken_h
        r0 = C.lerp(r_bot, r_top, y / top_h)
        dr = C.drum_bm(r0, h - 0.015, flutes=20, depth=r0 * 0.06, rng=rng, top_break=broken if last else 0.0)
        C.transform_bm(dr, C.rot_y(rng.uniform(0, 18)), (rng.uniform(-0.02, 0.02), y, rng.uniform(-0.02, 0.02)))
        b.add(dr, rng=rng, tint=stone_tint(rng))
        y += h
    return y


def capital(b, rng, y, fragment=False):
    b.add(C.cylinder_bm(1.04, 1.5, 0.5, 32, y0=y), rng=rng, tint=stone_tint(rng))
    ab = C.hull_bm(C.block_points(rng, (3.2, 0.5, 3.2), chips=3 if fragment else 1, chip=(0.05, 0.2)))
    C.bevel_bm(ab, 0.04, segments=2)
    C.transform_bm(ab, None, (0, y + 0.75, 0))
    b.add(ab, rng=rng, tint=stone_tint(rng))
    return y + 1.0


def pillar(kind, rng):
    b = Batch()
    y = base_parts(b, rng)
    if kind == 'pillar_intact':
        y = shaft(b, rng, y, 6)
        y = capital(b, rng, y)
        arch = C.hull_bm(C.block_points(rng, (4.2, 0.95, 1.7), chips=4, chip=(0.1, 0.35)))
        C.bevel_bm(arch, 0.04, segments=1)
        C.transform_bm(arch, C.rot_y(rng.uniform(-8, 8)), (0.7, y + 0.48, 0.0))
        b.add(arch, rng=rng, tint=stone_tint(rng))
    elif kind == 'pillar_broken_tall':
        shaft(b, rng, y, 5, broken=0.55, broken_h=1.55)
    elif kind == 'pillar_broken_mid':
        shaft(b, rng, y, 3, broken=0.5, broken_h=1.1)
    elif kind == 'pillar_stump':
        shaft(b, rng, y, 1, broken=0.45, broken_h=1.2)
    return b


def fallen(rng):
    """Five drums lying in a row along +X (length about 9 m, radius 0.95), a capital at the end."""
    b = Batch()
    x = -4.2
    for i in range(5):
        h = rng.uniform(1.55, 1.7)
        r = 0.95
        dr = C.drum_bm(r, h, flutes=18, depth=r * 0.06, rng=rng, top_break=0.25 if i == 4 else 0.0,
                       bottom_break=0.2 if i == 0 else 0.0)
        C.transform_bm(dr, None, (0, -h / 2, 0))
        rot = C.rot_z(-90 + rng.uniform(-4, 4)) @ C.rot_x(rng.uniform(0, 40))
        C.transform_bm(dr, C.rot_y(rng.uniform(-6, 6)) @ rot, (x + h / 2, r * 0.97, rng.uniform(-0.25, 0.25)))
        b.add(dr, rng=rng, tint=stone_tint(rng))
        x += h + rng.uniform(0.02, 0.18)
    return b


def capital_fragment(rng):
    b = Batch()
    capital(b, rng, 0.0, fragment=True)
    C.transform_bm(b.bm, C.rot_x(-70) @ C.rot_z(12), (0, 1.1, 0))
    return b


def brazier(rng):
    b = Batch()
    foot = C.hull_bm(C.block_points(rng, (1.0, 0.3, 1.0), chips=2, chip=(0.05, 0.12)))
    C.bevel_bm(foot, 0.03, segments=1)
    C.transform_bm(foot, None, (0, 0.15, 0))
    b.add(foot, rng=rng, tint=stone_tint(rng))
    b.add(C.cylinder_bm(0.42, 0.36, 1.35, 8, y0=0.3), rng=rng, tint=stone_tint(rng))
    b.add(C.cylinder_bm(0.5, 0.5, 0.1, 8, y0=1.62), rng=rng, tint=stone_tint(rng))
    b.add(C.cylinder_bm(0.42, 0.82, 0.36, 16, y0=1.7), IRON, uv_tile=1.0, rng=rng, tint=lambda p, n: (0.8, 0.8, 0.8))
    b.add(C.cylinder_bm(0.86, 0.86, 0.06, 16, y0=2.05), IRON, uv_tile=1.0, rng=rng, tint=lambda p, n: (0.8, 0.8, 0.8))
    for i in range(9):
        a = i / 9 * math.tau
        rr = 0.25 + 0.3 * rng.random()
        coal = C.hull_bm(C.rock_points(rng, (0.16, 0.1, 0.14), n=10, blocky=0.2, cuts=1))
        C.transform_bm(coal, None, (math.cos(a) * rr, 2.02 + rng.uniform(0, 0.06), math.sin(a) * rr))
        b.add(coal, COALS, uv_tile=1.0, rng=rng, tint=lambda p, n: (1, 1, 1))
    return b


def main():
    C.reset()
    mats = [
        C.material('pillar_stone', color=(0.66, 0.65, 0.64), rough=0.85, tex='ashlar'),
        C.material('brazier_iron', color=(0.12, 0.11, 0.1), rough=0.6, metal=0.8),
        C.material('coals', color=(0.08, 0.03, 0.02), rough=0.9, emission=(1.0, 0.35, 0.08), strength=3.0),
    ]
    rng = random.Random(77)
    objs = []
    for kind in ('pillar_intact', 'pillar_broken_tall', 'pillar_broken_mid', 'pillar_stump'):
        objs.append(C.new_object(kind, pillar(kind, rng).bm, mats, smooth=35))
    objs.append(C.new_object('pillar_fallen', fallen(rng).bm, mats, smooth=35))
    objs.append(C.new_object('capital_fragment', capital_fragment(rng).bm, mats, smooth=35))
    objs.append(C.new_object('brazier', brazier(rng).bm, mats, smooth=35))
    stats = {'objects': len(objs), 'tris': C.tri_count(objs)}
    for ob in objs:
        stats[f'tris_{ob.name}'] = C.tri_count([ob])
    C.log('pillars', stats)
    stats['glb_bytes'] = C.export_glb(os.path.join(C.ASSETS, 'pillars.glb'), objs)

    # preview: line them up (the exported file keeps each at the origin)
    for i, ob in enumerate(objs):
        ob.location.x = (i - 3) * 5.0
    C.preview_setup(world_color=(0.04, 0.045, 0.06), strength=0.8)
    floor = C.new_object('floor', C.box_bm((60, 0.1, 30), (0, -0.05, 0)), [C.material('floor', color=(0.12, 0.12, 0.13), use_vcol=False)])
    C.sun((0.4, -0.7, 0.55), energy=3.0, color=(0.85, 0.9, 1.0))
    C.camera((0, 7, 30), (0, 5, 0), lens=30)
    C.render_preview('pillars')
    C.remove_helpers([floor])
    C.write_report('pillars', stats)


C.run(main)
