"""COLOSSUS golem family: OSTRAKON, THE LIVING RUIN.

A bone-parented segmented rig: the armature comes from src/data/golem_rig.json (19 bones) and every
piece of the body is a separate rock or piece of dressed masonry parented to one bone, so the game can
fly each piece in from the rubble during the intro. The golem is built from the arena's own ruin:
dressed blocks for the torso, fluted column drums for the upper arms, a broken capital's stubs as horns,
rough boulders for the fists, shoulders and legs.

Named pieces the game looks up: core_arm_L, core_arm_R, core_back, core_chest (weak points),
eye_L, eye_R (glow), chestplate_0..2 (break off in phase 3). Everything else is g_<bone>_<n>.
Materials: golem_ashlar, golem_rock, golem_core, golem_eye.

Output: public/assets/golem.glb, previews in test-output/asset-previews/golem_*.png.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import math  # noqa: E402
import random  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import co_common as C  # noqa: E402

RIG = C.load_json('golem_rig.json')
BONES = {b['name']: b for b in RIG['bones']}
CORES = {c['name']: c for c in RIG['cores']}
S = Matrix.Diagonal((-1.0, 1.0, 1.0))


def head(bone):
    return C.v3(BONES[bone]['head'])


def tail(bone):
    return C.v3(BONES[bone]['tail'])


def along(bone, t, off=(0.0, 0.0, 0.0)):
    h, tl = head(bone), tail(bone)
    return h + (tl - h) * t + C.v3(off)


def bone_rot(bone, extra=None):
    d = tail(bone) - head(bone)
    r = C.rot_align((0, 1, 0), d)
    return r @ extra if extra is not None else r


def euler(rx=0.0, ry=0.0, rz=0.0):
    return C.rot_y(ry) @ C.rot_x(rx) @ C.rot_z(rz)


# ------------------------------------------------------------------ piece list (left side + centre)

PIECES = []


def add(bone, kind, pos, size, rot=None, mat='ashlar', name=None, mirror=None, **kw):
    PIECES.append(dict(bone=bone, kind=kind, pos=C.v3(pos), size=tuple(size), rot=rot if rot is not None else Matrix.Identity(3),
                       mat=mat, name=name, mirror=bone.endswith('_L') if mirror is None else mirror, kw=kw))


def build_list():
    # ---- hips: pelvis blocks, hip joints, back core socket
    add('hips', 'block', (1.05, 7.25, -0.55), (2.2, 1.7, 3.3), euler(0, 4, -3), chips=3, mirror=True, name='g_hips_side')
    add('hips', 'block', (0.0, 6.55, 0.35), (2.4, 0.8, 1.9), euler(-6, 0, 0), chips=2)
    add('hips', 'rock', (1.75, 6.75, -0.6), (0.95, 0.95, 1.05), mat='rock', mirror=True, name='g_hips_joint')
    for i in range(5):
        a = i / 5 * math.tau + 0.4
        p = Vector((math.cos(a) * 0.95, 7.2 + math.sin(a) * 0.95, -2.35))
        add('hips', 'rock', p, (0.42, 0.42, 0.5), mat='rock', seedx=i, name=f'g_hips_socket{i}', mirror=False)

    # ---- spine: a cairn of stacked stones
    add('spine', 'block', (-0.95, 8.85, -0.4), (2.0, 1.15, 2.8), euler(0, -6, 3), chips=2)
    add('spine', 'block', (1.0, 8.95, -0.3), (2.0, 1.25, 2.7), euler(0, 8, -4), chips=3)
    add('spine', 'block', (0.0, 9.8, 0.0), (3.6, 1.05, 3.1), euler(-4, 3, 0), chips=2)
    add('spine', 'rock', (1.75, 9.2, -0.9), (0.6, 0.7, 0.7), mat='rock', mirror=True, name='g_spine_side')
    add('spine', 'rock', (0.0, 9.0, -1.9), (0.9, 0.8, 0.55), mat='rock')

    # ---- chest: a barrel of dressed blocks around a cavity that holds the molten heart
    add('chest', 'block', (0.0, 11.3, 0.35), (4.9, 2.7, 2.8), euler(-8, 0, 0), chips=4)
    add('chest', 'block', (2.05, 11.05, 1.75), (1.5, 2.5, 3.0), euler(-6, 14, 2), chips=3, mirror=True, name='g_chest_side')
    add('chest', 'block', (0.0, 12.45, 0.9), (4.7, 0.95, 2.6), euler(-12, 0, 0), chips=3)
    add('chest', 'block', (0.0, 10.05, 1.05), (3.8, 0.8, 2.6), euler(6, 0, 0), chips=2)
    add('chest', 'rock', (1.2, 12.1, -1.1), (1.2, 1.0, 0.9), mat='rock', mirror=True, name='g_chest_back')
    # chest plates: the breastplate that bursts off in phase 3
    add('chest', 'plate', (0.0, 11.05, 3.72), (2.15, 2.45, 0.62), euler(-10, 0, 0), name='chestplate_0', mirror=False)
    add('chest', 'plate', (1.3, 10.95, 3.35), (1.25, 2.25, 0.6), euler(-8, 28, 0), name='chestplate_1', mirror=False)
    add('chest', 'plate', (-1.3, 10.95, 3.35), (1.25, 2.25, 0.6), euler(-8, -28, 0), name='chestplate_2', mirror=False)

    # ---- neck and head: a heavy brow over glowing eyes, broken column stubs as horns
    add('neck', 'rock', (0.0, 12.75, 1.65), (0.85, 0.55, 0.85), mat='rock')
    add('head', 'block', (0.0, 13.75, 2.3), (2.1, 1.85, 2.2), euler(-10, 0, 0), chips=3)
    add('head', 'block', (0.0, 14.25, 3.25), (2.55, 0.55, 0.95), euler(14, 0, 0), chips=2, name='g_head_brow')
    add('head', 'rock', (0.0, 13.05, 3.05), (0.85, 0.42, 0.62), mat='rock', name='g_head_jaw')
    add('head', 'rock', (0.98, 13.55, 3.0), (0.32, 0.42, 0.42), mat='rock', mirror=True, name='g_head_cheek')
    add('head', 'drum', (0.75, 14.55, 1.75), (0.34, 1.25), euler(-32, 0, -22), mat='ashlar', flutes=10, top_break=0.35,
        mirror=True, name='g_head_horn')

    # ---- shoulder: a great boulder pauldron and a jutting shard
    add('shoulder_L', 'rock', (3.3, 12.75, 0.55), (1.5, 1.15, 1.55), mat='rock', blocky=0.45, n=24)
    add('shoulder_L', 'rock', (2.2, 11.85, 0.6), (0.85, 0.85, 0.95), mat='rock')
    add('shoulder_L', 'rock', (3.05, 13.95, 0.2), (0.38, 0.75, 0.42), euler(-10, 0, -25), mat='rock', blocky=0.1, n=14)

    # ---- upper arm: two fluted column drums
    add('upperarm_L', 'drum', along('upperarm_L', 0.07), (1.02, 1.95), bone_rot('upperarm_L', C.rot_y(10)), flutes=14,
        bottom_break=0.0, top_break=0.0, stack=True)
    add('upperarm_L', 'drum', along('upperarm_L', 0.52), (0.96, 1.9), bone_rot('upperarm_L', C.rot_y(-7)), flutes=14,
        top_break=0.18, stack=True)

    # ---- forearm: elbow boulder, three blocks swelling toward the wrist, a dressed cuff
    add('forearm_L', 'rock', along('forearm_L', 0.02), (0.78, 0.72, 0.82), mat='rock', n=22)
    for i, (t, s) in enumerate(((0.26, (1.85, 1.3, 1.85)), (0.52, (2.05, 1.35, 2.05)), (0.78, (2.25, 1.35, 2.25)))):
        add('forearm_L', 'block', along('forearm_L', t), s, bone_rot('forearm_L', C.rot_y(i * 17 - 10)), chips=3,
            name=f'g_forearm_L_{i}')
    for i in range(4):
        a = i / 4 * math.tau + math.pi / 4
        off = Vector((math.cos(a) * 1.05, 0.0, math.sin(a) * 1.05))
        add('forearm_L', 'block', along('forearm_L', 0.97) + off, (0.55, 0.7, 1.1),
            bone_rot('forearm_L', C.rot_y(math.degrees(-a) + 90)), chips=1, name=f'g_forearm_L_cuff{i}')

    # ---- hand: a fist of boulders, the arm core set in its outer face
    add('hand_L', 'rock', along('hand_L', 0.5, (0.0, 0.0, 0.1)), (1.12, 1.25, 1.1), mat='rock', blocky=0.45, n=24)
    for i, x in enumerate((-0.62, -0.2, 0.22, 0.64)):
        add('hand_L', 'rock', along('hand_L', 1.0, (x, 0.2, 0.62)), (0.42, 0.4, 0.44), mat='rock', n=16,
            name=f'g_hand_L_knuckle{i}')
    add('hand_L', 'rock', along('hand_L', 0.55, (-0.95, 0.0, 0.55)), (0.38, 0.55, 0.4), euler(0, 0, 15), mat='rock',
        name='g_hand_L_thumb')
    core = C.v3(CORES['core_arm_L']['pos'])
    for i in range(5):
        a = i / 5 * math.tau
        off = Vector((-0.2, math.sin(a) * 0.82, math.cos(a) * 0.82))
        add('hand_L', 'block', core + off, (0.32, 0.46, 0.46), C.rot_x(math.degrees(a)), chips=1, name=f'g_hand_L_socket{i}')

    # ---- legs
    add('thigh_L', 'rock', along('thigh_L', 0.48), (1.25, 1.45, 1.3), bone_rot('thigh_L'), mat='rock', blocky=0.4, n=24)
    add('thigh_L', 'block', along('thigh_L', 0.35, (0.95, 0.0, 0.0)), (0.55, 2.1, 1.7), bone_rot('thigh_L', C.rot_y(8)),
        chips=2, name='g_thigh_L_plate')
    add('shin_L', 'rock', along('shin_L', 0.0, (0.0, 0.1, 0.75)), (0.68, 0.62, 0.55), mat='rock', name='g_shin_L_knee')
    add('shin_L', 'block', along('shin_L', 0.3), (2.05, 1.35, 2.05), bone_rot('shin_L', C.rot_y(12)), chips=3)
    add('shin_L', 'block', along('shin_L', 0.72), (2.2, 1.45, 2.2), bone_rot('shin_L', C.rot_y(-9)), chips=3)
    add('foot_L', 'block', (2.1, 0.45, 0.4), (2.3, 0.9, 3.2), euler(0, 3, 0), chips=3, name='g_foot_L_slab')
    for i, x in enumerate((-0.62, 0.0, 0.62)):
        add('foot_L', 'rock', (2.1 + x, 0.36, 1.95), (0.36, 0.34, 0.4), mat='rock', n=14, name=f'g_foot_L_toe{i}')
    add('foot_L', 'rock', (2.1, 0.5, -1.1), (0.55, 0.5, 0.5), mat='rock', name='g_foot_L_heel')


# ------------------------------------------------------------------ geometry

def piece_bm(p, rng, mirrored):
    kind = p['kind']
    size = p['size']
    kw = p['kw']
    rot = p['rot']
    pos = p['pos']
    if mirrored:
        rot = S @ rot @ S
        pos = Vector((-pos.x, pos.y, pos.z))
    if kind == 'rock':
        pts = C.rock_points(rng, size, n=kw.get('n', 20), blocky=kw.get('blocky', 0.3), cuts=kw.get('cuts', 2))
        bm = C.hull_bm(pts)
        C.bevel_bm(bm, min(size) * 0.07, segments=1)
    elif kind in ('block', 'plate'):
        pts = C.block_points(rng, size, chips=kw.get('chips', 2), chip=(0.08, 0.22) if kind == 'block' else (0.05, 0.14))
        bm = C.hull_bm(pts)
        C.bevel_bm(bm, min(size) * (0.07 if kind == 'block' else 0.09), segments=2)
    elif kind == 'drum':
        r, h = size
        bm = C.drum_bm(r, h, flutes=kw.get('flutes', 16), depth=r * 0.07, rng=rng, top_break=kw.get('top_break', 0.0),
                       bottom_break=kw.get('bottom_break', 0.0))
        if kw.get('stack'):
            pass  # starts at its bone position and runs along the bone
        else:
            C.transform_bm(bm, None, (0, -h / 2, 0))
    else:
        raise ValueError(kind)
    C.transform_bm(bm, rot, pos)
    return bm


def finish(bm, name, mat, tint, arm, bone, rng, tile):
    """World-space bmesh -> object with origin at its centroid, box UVs, colour, parented to the bone."""
    cen = Vector((0, 0, 0))
    for v in bm.verts:
        cen += v.co
    cen /= max(1, len(bm.verts))
    C.transform_bm(bm, None, -cen)
    C.box_uv(bm, tile, offset=(rng.random(), rng.random()))
    k = rng.uniform(0.86, 1.1)
    C.paint_bm(bm, C.tint_fn((tint[0] * k, tint[1] * k, tint[2] * k)))
    ob = C.new_object(name, bm, [mat], loc=cen, smooth=38)
    C.parent_to_bone(ob, arm, bone)
    return ob


def crystal_bm(rng, length, radius, axis, sides=6):
    pts = []
    for i in range(sides):
        a = i / sides * math.tau + rng.uniform(-0.15, 0.15)
        rr = radius * rng.uniform(0.85, 1.1)
        for y in (-0.28, 0.28):
            pts.append(Vector((math.cos(a) * rr, y * length, math.sin(a) * rr)))
    pts.append(Vector((rng.uniform(-0.05, 0.05), 0.5 * length, 0)))
    pts.append(Vector((0, -0.5 * length, rng.uniform(-0.05, 0.05))))
    bm = C.hull_bm(pts)
    C.transform_bm(bm, C.rot_align((0, 1, 0), axis))
    return bm


def core_bm(rng, kind, radius):
    """A crystal cluster (arm and back cores) or a faceted molten heart (chest)."""
    import bmesh
    if kind == 'chest':
        bm = C.sphere_bm(radius, subdiv=1)
        for v in bm.verts:
            v.co *= rng.uniform(0.92, 1.08)
        return bm
    bm = bmesh.new()
    axis_main = Vector((1, 0, 0)) if kind == 'arm' else Vector((0, 0, -1))
    parts = [(axis_main, 1.25, 0.34), ]
    for _ in range(3):
        d = (axis_main + Vector((rng.uniform(-0.7, 0.7), rng.uniform(-0.7, 0.7), rng.uniform(-0.7, 0.7)))).normalized()
        parts.append((d, rng.uniform(0.6, 0.85), rng.uniform(0.16, 0.22)))
    for d, ln, rr in parts:
        sub = crystal_bm(rng, ln * radius, rr * radius, d)
        C.transform_bm(sub, None, d * ln * radius * 0.18)
        C.merge_bm(bm, sub)
        sub.free()
    return bm


# ------------------------------------------------------------------ main

def main():
    C.reset()
    mats = {
        'ashlar': C.material('golem_ashlar', color=(0.78, 0.74, 0.68), rough=0.85, tex='ashlar'),
        'rock': C.material('golem_rock', color=(0.72, 0.71, 0.72), rough=0.88, tex='rock'),
        'core': C.material('golem_core', color=(0.04, 0.16, 0.18), rough=0.25, emission=(0.37, 0.94, 1.0), strength=6,
                           use_vcol=False),
        'heart': C.material('golem_heart', color=(0.2, 0.05, 0.01), rough=0.35, emission=(1.0, 0.35, 0.08), strength=5,
                            use_vcol=False),
        'eye': C.material('golem_eye', color=(0.05, 0.03, 0.01), rough=0.5, emission=(1.0, 0.63, 0.25), strength=8,
                          use_vcol=False),
    }
    arm = C.make_armature('golem_rig', RIG['bones'])
    build_list()
    objs = []
    counts = {}
    for idx, p in enumerate(PIECES):
        for mirrored in ((False, True) if p['mirror'] else (False,)):
            bone = p['bone']
            name = p['name']
            if mirrored:
                bone = bone[:-2] + '_R' if bone.endswith('_L') else bone
                name = (name[:-2] + '_R') if name and name.endswith('_L') else (name.replace('_L_', '_R_') + ('' if '_L_' in name else '_R')) if name else None
            if not name:
                counts[bone] = counts.get(bone, 0) + 1
                name = f'g_{bone}_{counts[bone]}'
            seed = idx * 7919 + (1000 if mirrored else 0) + p['kw'].get('seedx', 0)
            rng = random.Random(seed)
            bm = piece_bm(p, rng, mirrored)
            kind_mat = 'rock' if p['mat'] == 'rock' else 'ashlar'
            tint = (0.8, 0.8, 0.83) if kind_mat == 'rock' else (0.95, 0.9, 0.84)
            if p['kind'] == 'plate':
                tint = (1.02, 0.97, 0.9)
            ob = finish(bm, name, mats[kind_mat], tint, arm, bone, rng, 3.0 if kind_mat == 'rock' else 4.0)
            objs.append(ob)

    # weak points and eyes
    rng = random.Random(99)
    for cname, c in CORES.items():
        kind = c['kind']
        bm = core_bm(rng, 'chest' if kind == 'chest' else kind, c['radius'] * (0.7 if kind == 'chest' else 0.62))
        if cname == 'core_arm_R':
            C.transform_bm(bm, C.Matrix.Diagonal((-1.0, 1.0, 1.0)).to_3x3() if False else S)
            import bmesh
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        ob = C.new_object(cname, bm, [mats['heart'] if kind == 'chest' else mats['core']], loc=c['pos'], smooth=30)
        C.parent_to_bone(ob, arm, c['bone'])
        objs.append(ob)
    for side, p in (('L', RIG['eyes']['left']), ('R', RIG['eyes']['right'])):
        bm = C.box_bm((0.52, 0.17, 0.22))
        C.transform_bm(bm, C.rot_z(-8 if side == 'L' else 8))
        ob = C.new_object(f'eye_{side}', bm, [mats['eye']], loc=p)
        C.parent_to_bone(ob, arm, RIG['eyes']['bone'])
        objs.append(ob)

    bake_ao([o for o in objs if o.name.startswith(('g_', 'chestplate'))])

    stats = {'pieces': len(objs), 'tris': C.tri_count(objs)}
    C.log('golem pieces', stats)
    size = C.export_glb(os.path.join(C.ASSETS, 'golem.glb'), [arm] + objs)
    stats['glb_bytes'] = size

    # previews
    C.preview_setup(world_color=(0.03, 0.035, 0.05), strength=0.6)
    floor = C.new_object('floor', C.box_bm((40, 0.1, 40), (0, -0.05, 0)), [C.material('floor', color=(0.12, 0.12, 0.13), use_vcol=False)])
    C.sun((0.4, -0.7, 0.55), energy=2.2, color=(0.8, 0.86, 1.0))
    C.area_light((-10, 16, -14), (0, 8, 0), energy=9000, size=10, color=(0.6, 0.72, 1.0))
    C.area_light((14, 6, 16), (0, 7, 0), energy=3500, size=8, color=(1.0, 0.85, 0.7))
    C.camera((13, 7.5, 21), (0, 7.2, 0), lens=30)
    C.render_preview('golem_front')
    C.camera((-12, 8, -19), (0, 7.2, 0), lens=30)
    C.render_preview('golem_back')
    C.camera((5.5, 4.5, 8.5), (4.6, 3.0, 1.6), lens=35)
    C.render_preview('golem_hand')
    C.remove_helpers([floor])
    C.write_report('golem', stats)


def bake_ao(objs, samples=48, distance=1.4):
    """Contact shadows where the pieces touch: Cycles AO baked into each piece's vertex colours."""
    try:
        import numpy as np
        scene = bpy.context.scene
        C.use_cycles(samples)
        if scene.world is None:
            scene.world = bpy.data.worlds.new('ao_world')
        scene.world.light_settings.distance = distance
        for ob in objs:
            me = ob.data
            ao = me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
            me.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT')
        for ob in objs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        for ob in objs:
            me = ob.data
            n = len(me.loops)
            a = np.empty(n * 4, dtype=np.float32)
            c = np.empty(n * 4, dtype=np.float32)
            me.color_attributes['AO'].data.foreach_get('color', a)
            me.color_attributes['Col'].data.foreach_get('color', c)
            a = a.reshape(n, 4)[:, 0]
            c = c.reshape(n, 4)
            c[:, :3] *= (0.38 + 0.62 * a)[:, None]
            me.color_attributes['Col'].data.foreach_set('color', c.ravel())
            me.color_attributes.remove(me.color_attributes['AO'])
            me.color_attributes.active_color = me.color_attributes['Col']
        C.log('AO baked into', len(objs), 'pieces')
    except Exception as e:
        C.log('AO bake skipped:', e)


C.run(main)
