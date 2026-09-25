"""COLOSSUS warrior family: the lone knight.

A bone-parented segmented rig on src/data/warrior_rig.json (19 bones). Each bone carries one merged
object w_<bone> (armour plates, mail and leather under them), plus three separate named objects:
  sword  (hand_R, origin at the grip, blade along +Z)   flask (hips)   cape (chest, a grid the game can
  simulate as cloth: top row pinned)
The palette is chosen to read against grey stone at night: polished steel, a deep red cape, tabard and
crest, brass trim.
Materials: warrior_steel, warrior_mail, warrior_leather, warrior_cloth, warrior_brass, warrior_flask.
Output: public/assets/warrior.glb, previews in test-output/asset-previews/warrior_*.png.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import math  # noqa: E402
from mathutils import Vector  # noqa: E402
import co_common as C  # noqa: E402

RIG = C.load_json('warrior_rig.json')
BONES = {b['name']: b for b in RIG['bones']}
SWORD = RIG['sword']
STEEL, MAIL, LEATHER, CLOTH, BRASS, FLASK = range(6)


def head(b):
    return C.v3(BONES[b]['head'])


def tail(b):
    return C.v3(BONES[b]['tail'])


def seg_cyl(bone, r0, r1, t0=0.0, t1=1.0, segs=12, pad=0.0):
    """Tapered cylinder along a bone from t0 to t1 of its length (pad extends both ends)."""
    h, tl = head(bone), tail(bone)
    d = tl - h
    L = d.length * (t1 - t0) + 2 * pad
    bm = C.cylinder_bm(r0, r1, L, segs, y0=-pad)
    C.transform_bm(bm, C.rot_align((0, 1, 0), d), h + d * t0)
    return bm


def at(bm, pos, rot=None):
    return C.transform_bm(bm, rot, pos)


class Part:
    """Collects pieces for one object with material indices."""

    def __init__(self):
        self.bm = bmesh.new()

    def add(self, bm, mat):
        C.merge_bm(self.bm, bm, mat)
        bm.free()


def side_sign(side):
    return 1.0 if side == 'L' else -1.0


def build_parts():
    parts = {b: Part() for b in BONES}

    # ---- hips: belt, buckle, faulds, tabard panels, leather under
    p = parts['hips']
    p.add(C.cylinder_bm(0.15, 0.16, 0.2, 14, y0=0.9), LEATHER)
    p.add(C.cylinder_bm(0.172, 0.172, 0.055, 16, y0=0.985), LEATHER)
    p.add(at(C.box_bm((0.06, 0.05, 0.02)), (0, 1.012, 0.173)), BRASS)
    for i, (y, r0, r1) in enumerate(((0.945, 0.185, 0.178), (0.905, 0.195, 0.188))):
        p.add(C.cylinder_bm(r0, r1, 0.045, 16, y0=y), STEEL)
    for z, sgn in ((0.155, 1), (-0.15, -1)):
        tab = C.box_bm((0.2, 0.36, 0.012))
        for v in tab.verts:  # flare toward the hem
            k = (0.18 - v.co.y) / 0.36  # 0 at the belt, 1 at the hem
            v.co.x *= 1.0 + 0.35 * k
            v.co.z += sgn * 0.03 * k
        p.add(at(tab, (0, 0.8, z)), CLOTH)

    # ---- spine: mail shirt
    parts['spine'].add(C.cylinder_bm(0.15, 0.165, 0.24, 14, y0=1.1), MAIL)

    # ---- chest: cuirass shell, gorget, a brass rim
    p = parts['chest']
    shell = C.cylinder_bm(0.185, 0.16, 0.25, 20, y0=1.26)
    for v in shell.verts:
        v.co.z = v.co.z * 1.12 + 0.02
        v.co.x *= 1.08
        if v.co.z > 0.05:  # a keel down the front
            v.co.z += 0.018 * max(0.0, 1.0 - abs(v.co.x) / 0.08)
    shell_top = C.sphere_bm(0.165, subdiv=2, scale=(1.08, 0.35, 1.1))
    at(shell_top, (0, 1.5, 0.02))
    p.add(shell, STEEL)
    p.add(shell_top, STEEL)
    p.add(C.cylinder_bm(0.19, 0.19, 0.02, 20, y0=1.25), BRASS)
    p.add(C.cylinder_bm(0.085, 0.07, 0.07, 14, y0=1.47), STEEL)

    # ---- neck and head: great helm with brass circlet, eye slit and a red crest
    parts['neck'].add(C.cylinder_bm(0.05, 0.05, 0.1, 10, y0=1.49), LEATHER)
    p = parts['head']
    p.add(C.cylinder_bm(0.118, 0.112, 0.2, 18, y0=1.59), STEEL)
    p.add(at(C.sphere_bm(0.112, subdiv=2, scale=(1.0, 0.62, 1.0)), (0, 1.79, 0)), STEEL)
    p.add(C.cylinder_bm(0.122, 0.122, 0.018, 18, y0=1.635), BRASS)
    p.add(at(C.box_bm((0.19, 0.016, 0.03)), (0, 1.725, 0.108)), LEATHER)
    p.add(at(C.box_bm((0.018, 0.17, 0.025)), (0, 1.69, 0.118)), STEEL)
    crest = C.sphere_bm(1.0, subdiv=2, scale=(0.02, 0.085, 0.16))
    p.add(at(crest, (0, 1.845, -0.02)), CLOTH)

    for side in ('L', 'R'):
        s = side_sign(side)
        # ---- pauldron: a dome and two lames
        p = parts[f'shoulder_{side}']
        p.add(at(C.sphere_bm(0.105, subdiv=2, scale=(1.15, 0.78, 1.08)), (0.2 * s, 1.47, 0.0)), STEEL)
        p.add(at(C.cylinder_bm(0.1, 0.094, 0.032, 14, y0=0), (0.215 * s, 1.405, -0.005)), STEEL)
        p.add(at(C.cylinder_bm(0.094, 0.088, 0.03, 14, y0=0), (0.22 * s, 1.37, -0.008)), STEEL)
        p.add(at(C.sphere_bm(0.02, subdiv=1), (0.26 * s, 1.52, 0.0)), BRASS)
        # ---- arm: sleeve, rerebrace, couter, vambrace, gauntlet
        p = parts[f'upperarm_{side}']
        p.add(seg_cyl(f'upperarm_{side}', 0.058, 0.052, 0.0, 1.0, 10), LEATHER)
        p.add(seg_cyl(f'upperarm_{side}', 0.066, 0.06, 0.2, 0.85, 12), STEEL)
        p = parts[f'forearm_{side}']
        p.add(at(C.sphere_bm(0.06, subdiv=2, scale=(1.0, 0.9, 1.0)), head(f'forearm_{side}')), STEEL)
        fan = C.sphere_bm(0.075, subdiv=1, scale=(0.35, 1.0, 1.0))
        p.add(at(fan, head(f'forearm_{side}') + Vector((0.045 * s, 0.0, -0.01))), STEEL)
        p.add(seg_cyl(f'forearm_{side}', 0.052, 0.045, 0.0, 1.0, 10), LEATHER)
        p.add(seg_cyl(f'forearm_{side}', 0.058, 0.05, 0.25, 0.92, 12), STEEL)
        p = parts[f'hand_{side}']
        p.add(at(C.box_bm((0.07, 0.085, 0.075)), tail(f'hand_{side}') + Vector((0, 0.035, 0.0))), STEEL)
        p.add(at(C.box_bm((0.065, 0.05, 0.08)), tail(f'hand_{side}') + Vector((0, -0.01, 0.01))), LEATHER)
        p.add(seg_cyl(f'hand_{side}', 0.06, 0.055, -0.1, 0.25, 12), STEEL)
        # ---- leg: leather hose, cuisse, poleyn, greave, sabaton
        p = parts[f'thigh_{side}']
        p.add(seg_cyl(f'thigh_{side}', 0.085, 0.07, 0.0, 1.0, 12), LEATHER)
        p.add(seg_cyl(f'thigh_{side}', 0.09, 0.077, 0.12, 0.88, 14), STEEL)
        p = parts[f'shin_{side}']
        p.add(at(C.sphere_bm(0.062, subdiv=2), head(f'shin_{side}') + Vector((0, 0.0, 0.025))), STEEL)
        wing = C.sphere_bm(0.07, subdiv=1, scale=(0.3, 0.9, 0.9))
        p.add(at(wing, head(f'shin_{side}') + Vector((0.05 * s, 0.0, 0.0))), STEEL)
        p.add(seg_cyl(f'shin_{side}', 0.066, 0.052, 0.0, 1.0, 12), LEATHER)
        p.add(seg_cyl(f'shin_{side}', 0.07, 0.058, 0.1, 0.9, 14), STEEL)
        p = parts[f'foot_{side}']
        foot = C.box_bm((0.1, 0.075, 0.25))
        for v in foot.verts:  # taper the toe and slope the top
            if v.co.z > 0:
                v.co.x *= 0.7
                if v.co.y > 0:
                    v.co.y -= 0.03
        p.add(at(foot, (0.11 * s, 0.045, 0.06)), STEEL)
        p.add(at(C.box_bm((0.105, 0.02, 0.26)), (0.11 * s, 0.01, 0.06)), LEATHER)
    return parts


def sword_bm():
    """Longsword in grip space: blade along +Z, flat in X, ridge in Y."""
    bm = bmesh.new()
    stations = [(0.075, 0.026, 0.0065), (0.4, 0.024, 0.006), (0.85, 0.019, 0.0052), (1.05, 0.011, 0.004)]
    rings = []
    for z, w, t in stations:
        rings.append([bm.verts.new(p) for p in ((-w, 0, z), (0, t, z), (w, 0, z), (0, -t, z))])
    for a, b in zip(rings, rings[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]))
    tip = bm.verts.new((0, 0, 1.13))
    for i in range(4):
        bm.faces.new((rings[-1][i], rings[-1][(i + 1) % 4], tip))
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def build_sword(mats):
    part = Part()
    part.add(sword_bm(), STEEL)
    guard = C.box_bm((0.25, 0.028, 0.034))
    for v in guard.verts:  # quillons droop toward the blade
        v.co.z += 0.02 * (abs(v.co.x) / 0.125) ** 2
    part.add(at(guard, (0, 0, 0.06)), BRASS)
    grip = C.cylinder_bm(0.017, 0.019, 0.19, 10, y0=0)
    part.add(C.transform_bm(grip, C.rot_x(90), (0, 0, -0.135)), LEATHER)
    part.add(at(C.sphere_bm(0.028, subdiv=2, scale=(1.0, 0.7, 1.0)), (0, 0, -0.155)), BRASS)
    C.box_uv(part.bm, 0.6)
    return C.new_object('sword', part.bm, mats, loc=SWORD['grip'], smooth=35)


def build_flask(mats):
    part = Part()
    body = C.sphere_bm(0.045, subdiv=2, scale=(1.0, 1.15, 0.75))
    part.add(body, FLASK)
    part.add(C.cylinder_bm(0.016, 0.014, 0.04, 10, y0=0.045), FLASK)
    part.add(C.cylinder_bm(0.018, 0.018, 0.02, 10, y0=0.08), LEATHER)
    ob = C.new_object('flask', part.bm, mats, loc=(-0.2, 0.93, 0.06), smooth=40)
    return ob


def build_cape(mats):
    """A grid (9 x 15 vertices) from shoulder to calf, curved around the back. Top row = pinned row."""
    bm = bmesh.new()
    cols, rows = 9, 15
    grid = []
    for j in range(rows):
        t = j / (rows - 1)
        y = 1.47 - t * 1.02
        half = 0.2 + 0.16 * t
        row = []
        for i in range(cols):
            u = i / (cols - 1) * 2 - 1
            x = u * half
            z = -0.2 - 0.05 * (1 - u * u) - 0.05 * t
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    uv = bm.loops.layers.uv.verify()
    for j in range(rows - 1):
        for i in range(cols - 1):
            f = bm.faces.new((grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]))
            for loop, (a, b) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
                loop[uv].uv = (a / (cols - 1) * 2.0, 1 - b / (rows - 1) * 3.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = C.new_object('cape', bm, [mats[CLOTH]], smooth=80)
    ob['cols'] = cols
    ob['rows'] = rows
    return ob


def main():
    C.reset()
    mats = [
        C.material('warrior_steel', color=(0.72, 0.74, 0.78), rough=0.3, metal=1.0, tex='metal', use_vcol=False),
        C.material('warrior_mail', color=(0.34, 0.35, 0.37), rough=0.55, metal=0.85, use_vcol=False),
        C.material('warrior_leather', color=(0.075, 0.06, 0.05), rough=0.75, use_vcol=False),
        C.material('warrior_cloth', color=(0.42, 0.035, 0.045), rough=0.85, tex='cloth', use_vcol=False),
        C.material('warrior_brass', color=(0.78, 0.56, 0.26), rough=0.35, metal=1.0, use_vcol=False),
        C.material('warrior_flask', color=(0.9, 0.5, 0.15), rough=0.15, emission=(1.0, 0.55, 0.18), strength=2.0,
                   use_vcol=False),
    ]
    arm = C.make_armature('warrior_rig', RIG['bones'])
    objs = []
    for bone, part in build_parts().items():
        if len(part.bm.verts) == 0:
            part.bm.free()
            continue
        C.box_uv(part.bm, 0.6)
        cen = sum((v.co for v in part.bm.verts), Vector()) / len(part.bm.verts)
        C.transform_bm(part.bm, None, -cen)
        ob = C.new_object(f'w_{bone}', part.bm, mats, loc=cen, smooth=40)
        C.parent_to_bone(ob, arm, bone)
        objs.append(ob)
    sword = build_sword(mats)
    C.parent_to_bone(sword, arm, SWORD['bone'])
    flask = build_flask(mats)
    C.parent_to_bone(flask, arm, 'hips')
    cape = build_cape(mats)
    C.parent_to_bone(cape, arm, 'chest')
    objs += [sword, flask, cape]
    stats = {'objects': len(objs), 'tris': C.tri_count(objs)}
    C.log('warrior', stats)
    stats['glb_bytes'] = C.export_glb(os.path.join(C.ASSETS, 'warrior.glb'), [arm] + objs)

    C.preview_setup(world_color=(0.05, 0.055, 0.07), strength=0.8)
    floor = C.new_object('floor', C.box_bm((6, 0.02, 6), (0, -0.01, 0)), [C.material('floor', color=(0.1, 0.1, 0.11), use_vcol=False)])
    C.sun((0.4, -0.7, 0.55), energy=3.0, color=(0.85, 0.9, 1.0))
    C.area_light((-2, 3, -3), (0, 1.2, 0), energy=300, size=2, color=(0.6, 0.72, 1.0))
    C.area_light((2.5, 2.0, 3.0), (0, 1.1, 0), energy=250, size=2, color=(1.0, 0.9, 0.8))
    C.camera((1.6, 1.5, 3.2), (0, 1.0, 0.1), lens=50)
    C.render_preview('warrior_front')
    C.camera((-1.2, 2.2, -3.4), (0, 1.0, 0), lens=50)
    C.render_preview('warrior_back')
    C.remove_helpers([floor])
    C.write_report('warrior', stats)


C.run(main)
