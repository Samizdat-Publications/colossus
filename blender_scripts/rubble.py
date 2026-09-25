"""COLOSSUS rubble family: everything loose on the arena floor or flying through the air.

Top-level objects, origin at the centre of the base (unit sizes; the game scales them):
  rock_throw   the boulder the golem hurls (radius 1)
  meteor       rubble raining in phase 3 (radius 1, more broken)
  debris_0..5  small chunks for impact particles (about 1 m across, scaled down by the game)
  rubble_pile_a, rubble_pile_b, rubble_pile_c   heaps of blocks and rocks (footprint radius 1)
  golem_mound  the low heap the golem sleeps in and rises from (radius about 7)
Materials: rubble_rock, rubble_ashlar.
Output: public/assets/rubble.glb, preview test-output/asset-previews/rubble.png.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import math  # noqa: E402
import random  # noqa: E402
import co_common as C  # noqa: E402

ROCK, ASHLAR = range(2)


class Batch:
    def __init__(self):
        self.bm = bmesh.new()

    def add(self, bm, mat, rng, tile):
        C.box_uv(bm, tile, offset=(rng.random(), rng.random()))
        k = rng.uniform(0.7, 1.0)
        C.paint_bm(bm, lambda p, n, k=k: (k, k * 0.99, k * 0.97))
        C.merge_bm(self.bm, bm, mat)
        bm.free()


def boulder(rng, size, n=26, blocky=0.25, cuts=3, bevel=0.06):
    bm = C.hull_bm(C.rock_points(rng, size, n=n, blocky=blocky, cuts=cuts))
    C.bevel_bm(bm, min(size) * bevel, segments=1)
    return bm


def heap(rng, radius, count, height, block_share=0.5, piece=(0.18, 0.5)):
    b = Batch()
    for i in range(count):
        a = rng.uniform(0, math.tau)
        rr = radius * math.sqrt(rng.random())
        top = height * (1 - (rr / radius) ** 1.6)
        s = rng.uniform(*piece) * radius
        y = max(s * 0.35, rng.uniform(0.2, 1.0) * top)
        if rng.random() < block_share:
            bm = C.hull_bm(C.block_points(rng, (s * 2.2, s * 1.1, s * 1.5), chips=3, chip=(0.08, 0.28)))
            C.bevel_bm(bm, s * 0.06, segments=1)
            mat, tile = ASHLAR, 4.0
        else:
            bm = boulder(rng, (s, s * 0.75, s * 0.9), n=16)
            mat, tile = ROCK, 3.0
        C.transform_bm(bm, C.rand_rot(rng, 30) @ C.rot_y(rng.uniform(0, 360)), (math.cos(a) * rr, y, math.sin(a) * rr))
        b.add(bm, mat, rng, tile)
    return b


def single(rng, bm, mat=ROCK, tile=3.0):
    b = Batch()
    b.add(bm, mat, rng, tile)
    return b


def main():
    C.reset()
    mats = [
        C.material('rubble_rock', color=(0.7, 0.7, 0.72), rough=0.9, tex='rock'),
        C.material('rubble_ashlar', color=(0.68, 0.67, 0.66), rough=0.88, tex='ashlar'),
    ]
    rng = random.Random(505)
    objs = []
    objs.append(C.new_object('rock_throw', single(rng, boulder(rng, (1.0, 0.88, 0.95), n=28)).bm, mats, smooth=35))
    objs.append(C.new_object('meteor', single(rng, boulder(rng, (1.0, 0.95, 1.0), n=22, blocky=0.1, cuts=4)).bm, mats, smooth=30))
    for i in range(6):
        if i % 2:
            bm = C.hull_bm(C.block_points(rng, (1.0, 0.55, 0.75), chips=3, chip=(0.1, 0.3)))
            C.bevel_bm(bm, 0.03, segments=1)
            ob = C.new_object(f'debris_{i}', single(rng, bm, ASHLAR, 4.0).bm, mats, smooth=35)
        else:
            ob = C.new_object(f'debris_{i}', single(rng, boulder(rng, (0.5, 0.35, 0.42), n=14, cuts=2)).bm, mats, smooth=35)
        objs.append(ob)
    for name, count, h, share in (('rubble_pile_a', 14, 0.75, 0.6), ('rubble_pile_b', 18, 0.9, 0.4), ('rubble_pile_c', 11, 0.6, 0.7)):
        objs.append(C.new_object(name, heap(rng, 1.0, count, h, share).bm, mats, smooth=35))
    objs.append(C.new_object('golem_mound', heap(rng, 7.0, 46, 1.1, 0.5, piece=(0.03, 0.08)).bm, mats, smooth=35))
    stats = {'objects': len(objs), 'tris': C.tri_count(objs)}
    C.log('rubble', stats)
    stats['glb_bytes'] = C.export_glb(os.path.join(C.ASSETS, 'rubble.glb'), objs)

    # preview line-up
    x = -14.0
    for ob in objs:
        w = 16.0 if ob.name == 'golem_mound' else 3.0
        ob.location.x = x + w / 2
        if ob.name.startswith('debris'):
            ob.scale = (0.8, 0.8, 0.8)
        x += w
    C.preview_setup(world_color=(0.04, 0.045, 0.06), strength=0.8)
    floor = C.new_object('floor', C.box_bm((80, 0.1, 30), (0, -0.05, 0)), [C.material('floor', color=(0.12, 0.12, 0.13), use_vcol=False)])
    C.sun((0.4, -0.7, 0.55), energy=3.0, color=(0.85, 0.9, 1.0))
    C.camera((8, 9, 26), (8, 0.5, 0), lens=30)
    C.render_preview('rubble')
    C.remove_helpers([floor])
    C.write_report('rubble', stats)


C.run(main)
