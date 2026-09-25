"""Shared helpers for the COLOSSUS Blender asset scripts (Blender 5.x, run in background mode).

Conventions
- Every script builds geometry in three.js space: metres, Y up, characters face +Z, their left is +X.
  Meshes and placements are converted to Blender space (Z up, faces -Y) with the rotation R below,
  and the glTF exporter (+Y up) converts back, so three.js receives exactly the coordinates written here.
- Rig joints and the arena layout come from src/data/*.json, shared with the game.
- Outputs: public/assets/*.glb and tex_*.{jpg,png}; previews in test-output/asset-previews/;
  a JSON report per script in test-output/blender-logs/.
"""
import bmesh
import bpy
import json
import math
import os
import random
import sys
import time
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, 'public', 'assets')
DATA = os.path.join(ROOT, 'src', 'data')
OUT = os.path.join(ROOT, 'test-output')
PREVIEWS = os.path.join(OUT, 'asset-previews')
LOGS = os.path.join(OUT, 'blender-logs')
for _d in (ASSETS, PREVIEWS, LOGS):
    os.makedirs(_d, exist_ok=True)

# three.js space -> Blender space: +90 degrees about X (three Y up -> Blender Z up, three +Z -> Blender -Y)
R = Matrix.Rotation(math.radians(90.0), 4, 'X')
R_INV = R.inverted()
GOLDEN = math.pi * (3.0 - math.sqrt(5.0))
_T0 = time.time()


def log(*args):
    print(f'[co {time.time() - _T0:6.1f}s]', *args, flush=True)


def load_json(name):
    with open(os.path.join(DATA, name), encoding='utf-8') as f:
        return json.load(f)


def v3(p):
    return Vector((float(p[0]), float(p[1]), float(p[2])))


def to_blender(p):
    """A point in three.js space as a Blender-space Vector."""
    return R @ v3(p)


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def lerp(a, b, t):
    return a + (b - a) * t


def rot_y(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'Y')


def rot_x(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'X')


def rot_z(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'Z')


def rot_align(axis_from, axis_to):
    """Rotation (3x3) taking direction axis_from onto axis_to."""
    a = v3(axis_from).normalized()
    b = v3(axis_to).normalized()
    return a.rotation_difference(b).to_matrix()


def rand_rot(rng, amount_deg):
    return (rot_x(rng.uniform(-amount_deg, amount_deg)) @ rot_y(rng.uniform(-amount_deg, amount_deg))
            @ rot_z(rng.uniform(-amount_deg, amount_deg)))


# ------------------------------------------------------------------ scene

def reset():
    """Empty scene (keeps the default scene datablock)."""
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.cameras, bpy.data.lights,
                 bpy.data.images, bpy.data.worlds):
        for block in list(coll):
            try:
                coll.remove(block)
            except Exception:
                pass
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    return scene


def use_cycles(samples=16, denoise=False):
    """Cycles on the GPU (OptiX, then CUDA, then HIP) when there is one, CPU otherwise."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = denoise
    try:
        scene.cycles.use_adaptive_sampling = False
    except Exception:
        pass
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for dev_type in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
            try:
                prefs.compute_device_type = dev_type
            except Exception:
                continue
            try:
                prefs.refresh_devices()
            except Exception:
                prefs.get_devices()
            devs = [d for d in prefs.devices if d.type == dev_type]
            if devs:
                for d in prefs.devices:
                    d.use = d.type == dev_type
                scene.cycles.device = 'GPU'
                log('cycles device', dev_type, ', '.join(d.name for d in devs))
                return 'GPU'
    except Exception as e:  # pragma: no cover - depends on the machine
        log('GPU setup failed:', e)
    scene.cycles.device = 'CPU'
    log('cycles device CPU')
    return 'CPU'


# ------------------------------------------------------------------ bmesh builders (three.js space)

def hull_bm(points):
    """Convex hull of points as a closed bmesh with merged coplanar facets."""
    bm = bmesh.new()
    for p in points:
        bm.verts.new(p)
    res = bmesh.ops.convex_hull(bm, input=bm.verts[:], use_existing_faces=False)
    junk = list({g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert) and g.is_valid})
    if junk:
        bmesh.ops.delete(bm, geom=junk, context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(5.0), verts=bm.verts[:], edges=bm.edges[:])
    return bm


def support(points, n):
    return max(p.dot(n) for p in points)


def rock_points(rng, size, n=20, blocky=0.3, cuts=2, jitter=0.25, squash=None):
    """Points for a faceted boulder: an ellipsoid pushed toward a box, with flat fracture planes."""
    sx, sy, sz = size
    pts = []
    for i in range(n):
        k = (i + 0.5) / n
        phi = math.acos(1 - 2 * k)
        th = GOLDEN * i + rng.uniform(0, 0.4)
        d = Vector((math.cos(th) * math.sin(phi), math.cos(phi), math.sin(th) * math.sin(phi)))
        d += Vector((rng.uniform(-jitter, jitter), rng.uniform(-jitter, jitter), rng.uniform(-jitter, jitter)))
        d.normalize()
        if blocky > 0:
            m = max(abs(d.x), abs(d.y), abs(d.z))
            d = d.lerp(d / m, blocky)
        r = rng.uniform(0.84, 1.0)
        pts.append(Vector((d.x * sx * r, d.y * sy * r, d.z * sz * r)))
    for _ in range(cuts):
        nrm = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
        if nrm.length < 1e-3:
            continue
        nrm.normalize()
        h = support(pts, nrm) * rng.uniform(0.62, 0.82)
        pts = [p - nrm * (p.dot(nrm) - h) + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * 0.002
               if p.dot(nrm) > h else p for p in pts]
    if squash:
        pts = [Vector((p.x * squash[0], p.y * squash[1], p.z * squash[2])) for p in pts]
    return pts


def block_points(rng, size, chips=2, chip=(0.1, 0.3), skew=0.0):
    """Points for a dressed block: 8 corners, some of them knocked off (chipped)."""
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    corners = [(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    chipped = set(rng.sample(range(8), min(8, chips)))
    pts = []
    for i, (x, y, z) in enumerate(corners):
        c = Vector((x * sx, y * sy + x * skew * sy, z * sz))
        if i in chipped:
            m = min(sx, sy, sz)
            for axis in range(3):
                q = c.copy()
                q[axis] -= (x, y, z)[axis] * m * rng.uniform(*chip) * 2
                pts.append(q)
        else:
            pts.append(c)
    return pts


def bevel_bm(bm, offset, segments=1, profile=0.5):
    if offset <= 0:
        return
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=offset, offset_type='OFFSET', segments=segments,
                    profile=profile, affect='EDGES', clamp_overlap=True)


def drum_bm(r, h, flutes=16, depth=0.05, rng=None, top_break=0.0, bottom_break=0.0, rings=1, taper=0.0):
    """Fluted column drum along +Y from y=0 to y=h. Optional jagged broken top/bottom."""
    rng = rng or random.Random(1)
    bm = bmesh.new()
    per = 4
    nseg = flutes * per
    prof = []
    for i in range(nseg):
        a = i / nseg * math.tau
        k = i % per
        rr = r if k == 0 else r - depth * (0.72 if k != 2 else 1.0)
        prof.append((a, rr))
    ring_verts = []
    for j in range(rings + 1):
        t = j / rings
        y = h * t
        tp = 1.0 - taper * t
        row = [bm.verts.new((math.sin(a) * rr * tp, y, math.cos(a) * rr * tp)) for a, rr in prof]
        ring_verts.append(row)
    for j in range(rings):
        lo, hi = ring_verts[j], ring_verts[j + 1]
        for i in range(nseg):
            i2 = (i + 1) % nseg
            bm.faces.new((lo[i], lo[i2], hi[i2], hi[i]))

    def cap(row, y0, up, brk):
        if brk <= 0:
            f = bm.faces.new(row if up else list(reversed(row)))
            return f
        # jagged fracture: concentric rings with random heights down to the rim
        phase = rng.uniform(0, math.tau)
        for v in row:
            a = math.atan2(v.co.x, v.co.z)
            v.co.y += (-1 if up else 1) * brk * (0.35 + 0.35 * math.sin(a * 2 + phase) + 0.3 * rng.random())
        prev = row
        steps = 3
        for s in range(1, steps + 1):
            f = 1.0 - s / (steps + 1)
            cur = []
            for v in row:
                a = math.atan2(v.co.x, v.co.z)
                rr = math.hypot(v.co.x, v.co.z) * f
                dy = (-1 if up else 1) * brk * rng.uniform(0.0, 0.9)
                cur.append(bm.verts.new((math.sin(a) * rr, y0 + dy, math.cos(a) * rr)))
            # thin the ring out: merge by taking every other vertex after the first step
            n = len(prev)
            for i in range(n):
                i2 = (i + 1) % n
                quad = (prev[i], prev[i2], cur[i2], cur[i]) if up else (cur[i], cur[i2], prev[i2], prev[i])
                bm.faces.new(quad)
            prev = cur
        center = bm.verts.new((0, y0 + (-1 if up else 1) * brk * rng.uniform(0.1, 0.7), 0))
        n = len(prev)
        for i in range(n):
            i2 = (i + 1) % n
            bm.faces.new((prev[i], prev[i2], center) if up else (center, prev[i2], prev[i]))

    cap(ring_verts[-1], h, True, top_break)
    cap(ring_verts[0], 0.0, False, bottom_break)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def box_bm(size, center=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0] + center[0], v.co.y * size[1] + center[1], v.co.z * size[2] + center[2]))
    return bm


def cylinder_bm(r1, r2, h, segs=16, y0=0.0, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=h)
    # create_cone builds along Z centred on 0: turn it to +Y starting at y0
    bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, 'X'))
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, y0 + h / 2, 0))
    return bm


def sphere_bm(r, subdiv=2, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
    return bm


def transform_bm(bm, matrix3=None, offset=(0, 0, 0)):
    m = Matrix.Translation(v3(offset)) @ (matrix3.to_4x4() if matrix3 is not None else Matrix())
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts[:])
    return bm


def merge_bm(dst, src, material_index=0):
    """Append src into dst (both three.js space), keeping UVs and colours when both have them."""
    me = bpy.data.meshes.new('_tmp_merge')
    src.to_mesh(me)
    for f in me.polygons:
        f.material_index = material_index
    dst.from_mesh(me)
    bpy.data.meshes.remove(me)
    return dst


def box_uv(bm, tile, offset=(0.0, 0.0), rot=0.0):
    """Box projection: UV = position / tile on the plane facing the dominant normal axis."""
    bm.normal_update()
    uv = bm.loops.layers.uv.verify()
    c, s = math.cos(rot), math.sin(rot)
    for f in bm.faces:
        n = f.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in f.loops:
            p = loop.vert.co
            if ay >= ax and ay >= az:
                u, v = p.x, p.z
            elif ax >= az:
                u, v = p.z, p.y
            else:
                u, v = p.x, p.y
            u, v = u * c - v * s, u * s + v * c
            loop[uv].uv = (u / tile + offset[0], v / tile + offset[1])
    return bm


def planar_uv(bm, tile, offset=(0.0, 0.0), world=None):
    """Top-down projection (x, z) / tile, optionally in a shifted frame (for floor pieces)."""
    uv = bm.loops.layers.uv.verify()
    ox, oz = (world or (0.0, 0.0))
    for f in bm.faces:
        for loop in f.loops:
            p = loop.vert.co
            loop[uv].uv = ((p.x + ox) / tile + offset[0], (p.z + oz) / tile + offset[1])
    return bm


def paint_bm(bm, fn):
    """Per-corner colour: fn(position, normal) -> (r, g, b). Stored as the 'Col' attribute (linear)."""
    bm.normal_update()
    col = bm.loops.layers.float_color.get('Col') or bm.loops.layers.float_color.new('Col')
    for f in bm.faces:
        for loop in f.loops:
            r, g, b = fn(loop.vert.co, f.normal)
            loop[col] = (r, g, b, 1.0)
    return bm


def tint_fn(tint, ground_dark=0.0, ground_h=1.5, top_light=0.0):
    """Colour function: a flat tint, darker near the ground (grime, wet), lighter on up-facing faces."""
    def fn(p, n):
        k = 1.0
        if ground_dark > 0:
            k *= lerp(1.0 - ground_dark, 1.0, smoothstep(0.0, ground_h, p.y))
        if top_light > 0 and n.y > 0.5:
            k *= 1.0 + top_light * (n.y - 0.5) * 2
        return (tint[0] * k, tint[1] * k, tint[2] * k)
    return fn


# ------------------------------------------------------------------ objects

def new_object(name, bm, materials, loc=(0, 0, 0), rot=None, smooth=None, coll=None):
    """Create a mesh object from a bmesh built in three.js space.

    loc is a three.js position and rot a 3x3 rotation in three.js space. smooth=None keeps flat shading;
    a number (degrees) shades smooth with sharp edges above that angle.
    """
    if smooth is not None:
        for f in bm.faces:
            f.smooth = True
    bmesh.ops.transform(bm, matrix=R, verts=bm.verts[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in materials if isinstance(materials, (list, tuple)) else [materials]:
        me.materials.append(m)
    if smooth is not None:
        me.set_sharp_from_angle(angle=math.radians(smooth))
    if 'Col' in me.color_attributes:
        me.color_attributes.active_color = me.color_attributes['Col']
        try:
            me.color_attributes.render_color_index = me.color_attributes.find('Col')
        except Exception:
            pass
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    m3 = rot if rot is not None else Matrix.Identity(3)
    ob.matrix_world = R @ (Matrix.Translation(v3(loc)) @ m3.to_4x4()) @ R_INV
    return ob


def empty(name, loc=(0, 0, 0), coll=None):
    ob = bpy.data.objects.new(name, None)
    (coll or bpy.context.scene.collection).objects.link(ob)
    ob.matrix_world = R @ Matrix.Translation(v3(loc)) @ R_INV
    return ob


def make_armature(name, bones):
    """Armature from rig JSON bones (three.js space). Returns the armature object (rest pose = JSON)."""
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for b in bones:
        eb = data.edit_bones.new(b['name'])
        eb.head = to_blender(b['head'])
        eb.tail = to_blender(b['tail'])
        eb.roll = 0.0
        if b.get('parent'):
            eb.parent = data.edit_bones[b['parent']]
        eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.select_set(False)
    return arm


def parent_to_bone(ob, arm, bone_name):
    """Bone-parent ob keeping its current world transform."""
    bpy.context.view_layer.update()
    mw = ob.matrix_world.copy()
    bone = arm.data.bones[bone_name]
    pm = arm.matrix_world @ bone.matrix_local @ Matrix.Translation((0.0, bone.length, 0.0))
    ob.parent = arm
    ob.parent_type = 'BONE'
    ob.parent_bone = bone_name
    ob.matrix_parent_inverse = pm.inverted()
    ob.matrix_basis = mw


def parent_keep(child, parent):
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_basis = mw


def tri_count(objs):
    n = 0
    for ob in objs:
        if ob.type == 'MESH':
            ob.data.calc_loop_triangles()
            n += len(ob.data.loop_triangles)
    return n


# ------------------------------------------------------------------ materials (previews; the game assigns its own by name)

_TEX_CACHE = {}


def tex_image(name, non_color=False):
    for ext in ('.jpg', '.png'):
        path = os.path.join(ASSETS, f'tex_{name}{ext}')
        if os.path.exists(path):
            key = path
            if key not in _TEX_CACHE:
                img = bpy.data.images.load(path, check_existing=True)
                if non_color:
                    img.colorspace_settings.name = 'Non-Color'
                _TEX_CACHE[key] = img
            return _TEX_CACHE[key]
    return None


def sock(sockets, name, kind):
    """The socket called name with type kind ('VALUE', 'RGBA', 'VECTOR'): Mix nodes have one per type."""
    for s_ in sockets:
        if s_.name == name and s_.type == kind:
            return s_
    return sockets[name]


def mix_rgb(nodes, links, a, b, blend='MULTIPLY', fac=1.0):
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = blend
    sock(mix.inputs, 'Factor', 'VALUE').default_value = fac
    for val, slot in ((a, 'A'), (b, 'B')):
        target = sock(mix.inputs, slot, 'RGBA')
        if isinstance(val, bpy.types.NodeSocket):
            links.new(val, target)
        else:
            target.default_value = val
    return sock(mix.outputs, 'Result', 'RGBA')


def _set_input(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def material(name, color=(0.5, 0.5, 0.5), rough=0.8, metal=0.0, emission=None, strength=0.0, tex=None,
             tint=(1, 1, 1), normal_strength=1.0, use_vcol=True):
    """Principled material. tex='rock'|'ashlar'|'metal'|'cloth' wires the baked textures (UV map)."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    m.diffuse_color = (*color, 1.0)
    nt = m.node_tree
    nodes = nt.nodes
    links = nt.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    links.new(bsdf.outputs[0], out.inputs['Surface'])
    base = (*color, 1.0)
    bsdf.inputs['Base Color'].default_value = base
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emission is not None:
        _set_input(bsdf, ('Emission Color', 'Emission'), (*emission, 1.0))
        _set_input(bsdf, ('Emission Strength',), strength)
    col_socket = None
    if tex:
        alb = tex_image(f'{tex}_albedo')
        if alb is not None:
            n = nodes.new('ShaderNodeTexImage')
            n.image = alb
            col_socket = mix_rgb(nodes, links, n.outputs['Color'], (*[c * t for c, t in zip(color, tint)], 1.0))
        rgh = tex_image(f'{tex}_rough', non_color=True)
        if rgh is not None:
            n = nodes.new('ShaderNodeTexImage')
            n.image = rgh
            mr = nodes.new('ShaderNodeMath')
            mr.operation = 'MULTIPLY'
            links.new(n.outputs['Color'], mr.inputs[0])
            mr.inputs[1].default_value = rough / 0.8
            links.new(mr.outputs[0], bsdf.inputs['Roughness'])
        nrm = tex_image(f'{tex}_normal', non_color=True)
        if nrm is not None:
            n = nodes.new('ShaderNodeTexImage')
            n.image = nrm
            nm = nodes.new('ShaderNodeNormalMap')
            nm.inputs['Strength'].default_value = normal_strength
            links.new(n.outputs['Color'], nm.inputs['Color'])
            links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if use_vcol:
        va = nodes.new('ShaderNodeVertexColor')
        va.layer_name = 'Col'
        col_socket = mix_rgb(nodes, links, col_socket if col_socket is not None else base, va.outputs['Color'])
    if col_socket is not None:
        links.new(col_socket, bsdf.inputs['Base Color'])
    return m


# ------------------------------------------------------------------ export, previews, reports

def export_glb(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='NONE',
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
    )
    size = os.path.getsize(path)
    log(f'exported {os.path.relpath(path, ROOT)} ({size / 1024:.0f} KB, {len(objects)} objects)')
    return size


def preview_setup(world_color=(0.045, 0.05, 0.06), strength=1.0):
    scene = bpy.context.scene
    world = bpy.data.worlds.new('preview_world')
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get('Background')
    if bg is None:
        bg = world.node_tree.nodes.new('ShaderNodeBackground')
        out = world.node_tree.nodes.get('World Output') or world.node_tree.nodes.new('ShaderNodeOutputWorld')
        world.node_tree.links.new(bg.outputs[0], out.inputs[0])
    bg.inputs[0].default_value = (*world_color, 1.0)
    bg.inputs[1].default_value = strength
    for vt in ('AgX', 'Filmic', 'Standard'):
        try:
            scene.view_settings.view_transform = vt
            break
        except Exception:
            continue
    return world


def sun(direction_three, energy=3.0, color=(1, 1, 1), angle=2.0):
    d = bpy.data.lights.new('sun', 'SUN')
    d.energy = energy
    d.color = color
    d.angle = math.radians(angle)
    ob = bpy.data.objects.new('sun', d)
    bpy.context.scene.collection.objects.link(ob)
    direction = R.to_3x3() @ v3(direction_three)
    ob.rotation_euler = (-direction).to_track_quat('Z', 'Y').to_euler()
    return ob


def area_light(pos_three, target_three, energy=500, size=6, color=(1, 1, 1)):
    d = bpy.data.lights.new('area', 'AREA')
    d.energy = energy
    d.size = size
    d.color = color
    ob = bpy.data.objects.new('area', d)
    bpy.context.scene.collection.objects.link(ob)
    p = to_blender(pos_three)
    t = to_blender(target_three)
    ob.location = p
    ob.rotation_euler = (p - t).to_track_quat('Z', 'Y').to_euler()
    return ob


def camera(pos_three, target_three, lens=35.0):
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cd.clip_end = 1000
    ob = bpy.data.objects.new('cam', cd)
    bpy.context.scene.collection.objects.link(ob)
    p = to_blender(pos_three)
    t = to_blender(target_three)
    ob.location = p
    ob.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob
    return ob


def render_preview(name, res=(1280, 720), samples=48):
    scene = bpy.context.scene
    use_cycles(samples, denoise=True)
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    path = os.path.join(PREVIEWS, f'{name}.png')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log('preview', os.path.relpath(path, ROOT))
    return path


def remove_helpers(objs):
    for ob in objs:
        try:
            bpy.data.objects.remove(ob, do_unlink=True)
        except Exception:
            pass


def write_report(name, data):
    path = os.path.join(LOGS, f'{name}.json')
    data = dict(data)
    data['seconds'] = round(time.time() - _T0, 1)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    log('report', os.path.relpath(path, ROOT))


def run(main):
    """Run a family script's main() and exit with a non-zero code on failure (background mode)."""
    try:
        main()
        log('DONE')
    except Exception:
        import traceback
        traceback.print_exc()
        log('FAILED')
        sys.stdout.flush()
        if bpy.app.background:
            sys.exit(3)
        raise
