"""COLOSSUS texture family: bakes every tileable texture the game uses.

Each noise layer is a Cycles emission bake of Blender's own 4D noise or Voronoi texture, evaluated on a
4D torus built from the UV square (x = cos u, y = sin u, z = cos v, w = sin v), so every map tiles
seamlessly in both directions. The layers are then combined (colour ramps, masks, cavity shading, normal
from height) with numpy inside Blender.

Outputs (public/assets/):
  tex_rock_albedo.jpg  tex_rock_normal.png  tex_rock_rough.jpg     golem boulders, rubble (3 m tile)
  tex_ashlar_albedo.jpg tex_ashlar_normal.png tex_ashlar_rough.jpg dressed stone: walls, pillars, floor (4 m tile)
  tex_crack.png                                                    glowing vein mask for the golem (5 m tile)
  tex_metal_normal.png tex_metal_rough.jpg                         warrior armour (0.6 m tile)
  tex_cloth_normal.png                                             warrior cape and tabard (0.3 m tile)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import math  # noqa: E402
import numpy as np  # noqa: E402
import co_common as C  # noqa: E402

TAU = math.tau


# ------------------------------------------------------------------ bake plumbing

class Baker:
    def __init__(self, size):
        self.size = size
        C.reset()
        C.use_cycles(samples=1)
        scene = bpy.context.scene
        scene.cycles.bake_type = 'EMIT'
        scene.render.bake.margin = 0
        bpy.ops.mesh.primitive_plane_add(size=2.0)
        self.plane = bpy.context.active_object
        self.mat = bpy.data.materials.new('bake')
        try:
            self.mat.use_nodes = True
        except Exception:
            pass
        self.plane.data.materials.append(self.mat)
        self.nt = self.mat.node_tree
        self.images = {}

    # graph helpers ------------------------------------------------
    def _clear(self):
        n = self.nt.nodes
        for x in list(n):
            n.remove(x)
        self.out = n.new('ShaderNodeOutputMaterial')
        self.emit = n.new('ShaderNodeEmission')
        self.nt.links.new(self.emit.outputs[0], self.out.inputs['Surface'])
        self.target = n.new('ShaderNodeTexImage')

    def _in(self, sock, val):
        if isinstance(val, bpy.types.NodeSocket):
            self.nt.links.new(val, sock)
        else:
            sock.default_value = val

    def m(self, op, a, b=0.0):
        node = self.nt.nodes.new('ShaderNodeMath')
        node.operation = op
        self._in(node.inputs[0], a)
        self._in(node.inputs[1], b)
        return node.outputs[0]

    def torus(self, tile, stretch=(1.0, 1.0), offset=(0.0, 0.0, 0.0, 0.0)):
        n = self.nt.nodes
        tc = n.new('ShaderNodeTexCoord')
        sep = n.new('ShaderNodeSeparateXYZ')
        self.nt.links.new(tc.outputs['UV'], sep.inputs[0])
        u = self.m('MULTIPLY', sep.outputs[0], TAU)
        v = self.m('MULTIPLY', sep.outputs[1], TAU)
        ru = tile * stretch[0] / TAU
        rv = tile * stretch[1] / TAU
        x = self.m('ADD', self.m('MULTIPLY', self.m('COSINE', u), ru), offset[0])
        y = self.m('ADD', self.m('MULTIPLY', self.m('SINE', u), ru), offset[1])
        z = self.m('ADD', self.m('MULTIPLY', self.m('COSINE', v), rv), offset[2])
        w = self.m('ADD', self.m('MULTIPLY', self.m('SINE', v), rv), offset[3])
        comb = n.new('ShaderNodeCombineXYZ')
        self._in(comb.inputs[0], x)
        self._in(comb.inputs[1], y)
        self._in(comb.inputs[2], z)
        return comb.outputs[0], w

    def noise_node(self, vec, w, scale, detail=4.0, rough=0.5, lac=2.0, distortion=0.0, kind='FBM'):
        node = self.nt.nodes.new('ShaderNodeTexNoise')
        node.noise_dimensions = '4D'
        try:
            node.noise_type = kind
        except Exception:
            pass
        try:
            node.normalize = True
        except Exception:
            pass
        self._in(node.inputs['Vector'], vec)
        self._in(node.inputs['W'], w)
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = rough
        if 'Lacunarity' in node.inputs:
            node.inputs['Lacunarity'].default_value = lac
        node.inputs['Distortion'].default_value = distortion
        return node

    def distort(self, vec, w, tile, stretch, amount, scale, seed):
        """Offset torus coordinates by a (tileable) noise: bends straight Voronoi edges into cracks."""
        v2, w2 = self.torus(tile, stretch, (seed * 1.3, seed * 2.1, seed * 0.7, seed * 1.7))
        nz = self.noise_node(v2, w2, scale, detail=3.0, rough=0.5)
        vm = self.nt.nodes.new('ShaderNodeVectorMath')
        vm.operation = 'SUBTRACT'
        self._in(vm.inputs[0], nz.outputs['Color'])
        vm.inputs[1].default_value = (0.5, 0.5, 0.5)
        vs = self.nt.nodes.new('ShaderNodeVectorMath')
        vs.operation = 'SCALE'
        self._in(vs.inputs[0], vm.outputs[0])
        vs.inputs['Scale'].default_value = amount
        va = self.nt.nodes.new('ShaderNodeVectorMath')
        va.operation = 'ADD'
        self._in(va.inputs[0], vec)
        self._in(va.inputs[1], vs.outputs[0])
        wd = self.m('ADD', w, self.m('MULTIPLY', self.m('SUBTRACT', nz.outputs['Fac'], 0.5), amount))
        return va.outputs[0], wd

    # layers ---------------------------------------------------------
    def bake_socket(self, sock, channels=1):
        N = self.size
        key = 'layer'
        img = self.images.get(key)
        if img is None:
            img = bpy.data.images.new('layer', N, N, alpha=False, float_buffer=True)
            img.colorspace_settings.name = 'Non-Color'
            self.images[key] = img
        self.nt.links.new(sock, self.emit.inputs['Color'])
        self.target.image = img
        self.nt.nodes.active = self.target
        bpy.ops.object.select_all(action='DESELECT')
        self.plane.select_set(True)
        bpy.context.view_layer.objects.active = self.plane
        bpy.ops.object.bake(type='EMIT', margin=0, use_clear=True)
        px = np.empty(N * N * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(N, N, 4)
        return px[..., 0].copy() if channels == 1 else px[..., :3].copy()

    def noise(self, tile, scale, detail=4.0, rough=0.5, lac=2.0, seed=0.0, stretch=(1.0, 1.0), kind='FBM',
              color=False, distortion=0.0):
        self._clear()
        vec, w = self.torus(tile, stretch, (seed * 3.1, seed * 1.7, seed * 2.3, seed * 0.9))
        node = self.noise_node(vec, w, scale, detail, rough, lac, distortion, kind)
        return self.bake_socket(node.outputs['Color' if color else 'Fac'], 3 if color else 1)

    def voronoi(self, tile, scale, feature='F1', rand=1.0, seed=0.0, stretch=(1.0, 1.0), output='Distance',
                distort=0.0, distort_scale=2.0, metric='EUCLIDEAN'):
        self._clear()
        vec, w = self.torus(tile, stretch, (seed * 3.1, seed * 1.7, seed * 2.3, seed * 0.9))
        if distort > 0:
            vec, w = self.distort(vec, w, tile, stretch, distort, distort_scale, seed + 7.0)
        node = self.nt.nodes.new('ShaderNodeTexVoronoi')
        node.voronoi_dimensions = '4D'
        node.feature = feature
        node.distance = metric
        self._in(node.inputs['Vector'], vec)
        self._in(node.inputs['W'], w)
        node.inputs['Scale'].default_value = scale
        node.inputs['Randomness'].default_value = rand
        return self.bake_socket(node.outputs[output], 3 if output == 'Color' else 1)


# ------------------------------------------------------------------ numpy helpers

def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def norm01(a):
    lo, hi = np.percentile(a, 1), np.percentile(a, 99)
    return np.clip((a - lo) / max(1e-6, hi - lo), 0.0, 1.0)


def blur(a, r):
    """Wrapping box blur (twice, close to a Gaussian)."""
    out = a
    for _ in range(2):
        acc = np.zeros_like(out)
        for k in range(-r, r + 1):
            acc += np.roll(out, k, axis=0)
        out = acc / (2 * r + 1)
        acc = np.zeros_like(out)
        for k in range(-r, r + 1):
            acc += np.roll(out, k, axis=1)
        out = acc / (2 * r + 1)
    return out


def ramp(x, stops):
    """Piecewise-linear colour ramp: stops = [(pos, (r, g, b)), ...] in linear colour."""
    x = np.clip(x, 0.0, 1.0)
    out = np.zeros(x.shape + (3,), dtype=np.float32)
    pos = [p for p, _ in stops]
    cols = [np.array(c, dtype=np.float32) for _, c in stops]
    for ch in range(3):
        out[..., ch] = np.interp(x, pos, [c[ch] for c in cols])
    return out


def mix(a, b, t):
    t = t[..., None] if t.ndim == a.ndim - 1 else t
    return a + (b - a) * t


def normal_from_height(h_m, tile):
    """Tangent-space (OpenGL, +Y = +v) normal map from a height field in metres."""
    N = h_m.shape[0]
    px = tile / N
    dx = (np.roll(h_m, -1, axis=1) - np.roll(h_m, 1, axis=1)) / (2 * px)
    dy = (np.roll(h_m, -1, axis=0) - np.roll(h_m, 1, axis=0)) / (2 * px)
    n = np.stack([-dx, -dy, np.ones_like(h_m)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def save(name, arr, fmt='JPEG', quality=92):
    """arr: (N, N) or (N, N, 3) final encoded values in 0..1. Row 0 = bottom (Blender convention)."""
    if arr.ndim == 2:
        arr = np.repeat(arr[..., None], 3, axis=2)
    N = arr.shape[0]
    img = bpy.data.images.new(name, N, N, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.concatenate([np.clip(arr, 0, 1), np.ones((N, N, 1), dtype=np.float32)], axis=2).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    ext = '.jpg' if fmt == 'JPEG' else '.png'
    path = os.path.join(C.ASSETS, f'tex_{name}{ext}')
    img.file_format = fmt
    img.filepath_raw = path
    img.save(filepath=path, quality=quality)
    C.log(f'saved tex_{name}{ext} ({os.path.getsize(path) / 1024:.0f} KB)')
    return path


# ------------------------------------------------------------------ texture recipes

def rock(bk):
    """Weathered granite boulder: dark speckled stone, lichen, hairline cracks and pits (3 m tile)."""
    T = 3.0
    big = norm01(bk.noise(T, 0.9, detail=4, rough=0.55, seed=1))
    mid = norm01(bk.noise(T, 3.2, detail=8, rough=0.6, seed=2))
    fine = norm01(bk.noise(T, 16.0, detail=4, rough=0.5, seed=3))
    grain = bk.voronoi(T, 38.0, 'F1', seed=4, output='Color')[..., 0]
    edge = bk.voronoi(T, 1.5, 'DISTANCE_TO_EDGE', seed=5, distort=0.35, distort_scale=2.5)
    crack_mask = ss(0.42, 0.6, norm01(bk.noise(T, 1.1, detail=2, seed=6)))
    pits_d = bk.voronoi(T, 9.0, 'F1', seed=7)
    pit_rand = bk.voronoi(T, 9.0, 'F1', seed=7, output='Color')[..., 1]
    lichen = ss(0.6, 0.74, norm01(bk.noise(T, 2.2, detail=5, rough=0.65, seed=8)))

    crack = (1.0 - ss(0.0, 0.03, edge)) * crack_mask
    pits = (1.0 - ss(0.0, 0.09, pits_d)) * (pit_rand > 0.7)
    height = 0.55 * big + 0.32 * mid + 0.07 * fine + 0.03 * grain - 0.45 * crack - 0.12 * pits
    h_m = height * 0.035
    cavity = np.clip((blur(height, 6) - height) * 3.0, 0, 1)

    base = ramp(0.6 * big + 0.4 * mid, [(0.0, (0.055, 0.052, 0.05)), (0.45, (0.12, 0.114, 0.106)),
                                        (0.8, (0.2, 0.19, 0.175)), (1.0, (0.27, 0.255, 0.235))])
    speck_hi = (grain > 0.86).astype(np.float32)
    speck_lo = (grain < 0.1).astype(np.float32)
    col = base * (1.0 + 0.55 * speck_hi[..., None]) * (1.0 - 0.4 * speck_lo[..., None])
    col = mix(col, np.array([0.13, 0.14, 0.085], dtype=np.float32) * (0.7 + 0.6 * fine[..., None]), lichen * 0.55)
    col *= (1.0 - 0.7 * crack)[..., None]
    col *= (1.0 - 0.45 * cavity)[..., None]
    col *= (0.9 + 0.2 * fine)[..., None]
    rough_map = np.clip(0.82 + 0.12 * (fine - 0.5) - 0.08 * lichen + 0.1 * crack, 0.55, 0.98)

    save('rock_albedo', to_srgb(col))
    save('rock_normal', normal_from_height(h_m, T), fmt='PNG')
    save('rock_rough', rough_map)


def ashlar(bk):
    """Dressed limestone: warm grey, rain streaks of grime, pitting, chips and moss (4 m tile)."""
    T = 4.0
    big = norm01(bk.noise(T, 0.7, detail=4, rough=0.55, seed=11))
    mid = norm01(bk.noise(T, 3.0, detail=6, rough=0.55, seed=12))
    fine = norm01(bk.noise(T, 22.0, detail=3, rough=0.5, seed=13))
    streak = norm01(bk.noise(T, 1.6, detail=4, rough=0.5, seed=14, stretch=(3.0, 0.35)))
    pits_d = bk.voronoi(T, 14.0, 'F1', seed=15)
    pit_rand = bk.voronoi(T, 14.0, 'F1', seed=15, output='Color')[..., 2]
    chips_d = bk.voronoi(T, 2.2, 'F1', seed=16)
    chip_rand = bk.voronoi(T, 2.2, 'F1', seed=16, output='Color')[..., 0]
    edge = bk.voronoi(T, 1.1, 'DISTANCE_TO_EDGE', seed=17, distort=0.3, distort_scale=2.0)
    moss = ss(0.66, 0.8, norm01(bk.noise(T, 1.4, detail=6, rough=0.7, seed=18)))

    pits = (1.0 - ss(0.0, 0.1, pits_d)) * (pit_rand > 0.62)
    chips = (1.0 - ss(0.1, 0.22, chips_d)) * (chip_rand > 0.8)
    crack = (1.0 - ss(0.0, 0.022, edge)) * ss(0.5, 0.65, big)
    height = 0.2 * big + 0.18 * mid + 0.06 * fine - 0.25 * pits - 0.5 * chips - 0.35 * crack
    h_m = height * 0.03
    cavity = np.clip((blur(height, 5) - height) * 3.5, 0, 1)

    base = ramp(0.55 * big + 0.45 * mid, [(0.0, (0.15, 0.14, 0.125)), (0.5, (0.25, 0.232, 0.205)),
                                          (1.0, (0.34, 0.315, 0.28))])
    grime = ss(0.45, 0.85, streak)
    col = mix(base, base * np.array([0.42, 0.42, 0.44], dtype=np.float32), grime * 0.75)
    col = mix(col, np.array([0.07, 0.085, 0.045], dtype=np.float32), moss * 0.6)
    col *= (1.0 - 0.35 * pits)[..., None]
    col = mix(col, col * 1.25, chips * 0.6)  # fresh stone in the chips
    col *= (1.0 - 0.6 * crack)[..., None]
    col *= (1.0 - 0.4 * cavity)[..., None]
    col *= (0.92 + 0.16 * fine)[..., None]
    rough_map = np.clip(0.78 + 0.1 * (fine - 0.5) - 0.12 * grime - 0.15 * moss + 0.05 * chips, 0.5, 0.97)

    save('ashlar_albedo', to_srgb(col))
    save('ashlar_normal', normal_from_height(h_m, T), fmt='PNG')
    save('ashlar_rough', rough_map)


def crack(bk):
    """Vein network for the golem's glowing cracks: thick main cracks, thin partial branches, soft glow."""
    T = 5.0
    main = bk.voronoi(T, 1.8, 'DISTANCE_TO_EDGE', seed=21, distort=0.25, distort_scale=1.6)
    fine = bk.voronoi(T, 4.6, 'DISTANCE_TO_EDGE', seed=22, distort=0.2, distort_scale=3.0)
    mask = ss(0.48, 0.6, norm01(bk.noise(T, 1.3, detail=3, seed=23)))
    line = 1.0 - ss(0.0, 0.028, main)
    glow = (1.0 - ss(0.0, 0.11, main)) * 0.3
    branch = (1.0 - ss(0.0, 0.016, fine)) * mask * 0.75
    val = np.clip(np.maximum(line, branch) + glow, 0.0, 1.0)
    save('crack', val, fmt='PNG')


def metal(bk):
    """Worn steel: hammer dents (normal) and fine scratches (roughness) (0.6 m tile)."""
    T = 0.6
    dents = bk.voronoi(T, 9.0, 'SMOOTH_F1', seed=31)
    scratch = bk.voronoi(T, 5.0, 'DISTANCE_TO_EDGE', seed=32, stretch=(0.12, 1.4), distort=0.05)
    blot = norm01(bk.noise(T, 3.0, detail=5, seed=33))
    fine = norm01(bk.noise(T, 40.0, detail=2, seed=34))
    lines = 1.0 - ss(0.0, 0.012, scratch)
    height = 0.6 * norm01(dents) + 0.1 * fine - 0.15 * lines
    save('metal_normal', normal_from_height(height * 0.0012, T), fmt='PNG')
    rough_map = np.clip(0.3 + 0.2 * blot + 0.18 * lines + 0.05 * fine, 0.15, 0.8)
    save('metal_rough', rough_map)


def cloth(bk):
    """Plain weave (normal only), with a little fibre noise (0.3 m tile, 60 threads)."""
    T = 0.3
    N = bk.size
    threads = 60
    fib = norm01(bk.noise(T, 60.0, detail=3, seed=41))
    ii, jj = np.meshgrid(np.arange(N), np.arange(N))
    u = jj / N
    v = ii / N
    a = 0.5 + 0.5 * np.cos(TAU * threads * u)
    b = 0.5 + 0.5 * np.cos(TAU * threads * v)
    over = np.sign(np.sin(math.pi * threads * u) * np.sin(math.pi * threads * v))
    height = np.where(over > 0, a, b) * 0.8 + 0.2 * fib
    save('cloth_normal', normal_from_height(height * 0.0006, T), fmt='PNG')


def main():
    report = {}
    bk = Baker(1024)
    rock(bk)
    ashlar(bk)
    bk = Baker(512)
    crack(bk)
    metal(bk)
    cloth(bk)
    for f in sorted(os.listdir(C.ASSETS)):
        if f.startswith('tex_'):
            report[f] = os.path.getsize(os.path.join(C.ASSETS, f))
    C.write_report('textures', {'files': report})


C.run(main)
