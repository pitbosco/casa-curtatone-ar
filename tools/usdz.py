"""Converte assets/casa-ios.glb in assets/casa.usdz per AR Quick Look (iPhone/iPad).

Usa le librerie ufficiali OpenUSD (pip install usd-core pygltflib numpy) e crea un pacchetto
USDZ binario conforme ad ARKit. Uso: python tools/usdz.py
"""
import os
import numpy as np
from pygltflib import GLTF2
from pxr import Usd, UsdGeom, UsdShade, Sdf, Gf, UsdUtils

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'casa-ios.glb')
TMP = os.path.join(ROOT, 'revit', 'tmp', 'casa.usdc')
OUT = os.path.join(ROOT, 'assets', 'casa.usdz')

g = GLTF2().load(SRC)
blob = g.binary_blob()
DT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def accessor(i):
    a = g.accessors[i]
    n = NC[a.type]
    if a.bufferView is None or a.count == 0:  # accessor vuoto
        return np.zeros((a.count, n), dtype=DT[a.componentType])
    bv = g.bufferViews[a.bufferView]
    dt = np.dtype(DT[a.componentType])
    start = (bv.byteOffset or 0) + (a.byteOffset or 0)
    stride = bv.byteStride or dt.itemsize * n
    raw = np.frombuffer(blob, dtype=np.uint8, count=stride * (a.count - 1) + dt.itemsize * n, offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(a.count, dt.itemsize * n), strides=(stride, 1))
    return np.ascontiguousarray(rows).view(dt).reshape(a.count, n)


def local_matrix(node):
    if node.matrix:
        return np.array(node.matrix, dtype=np.float64).reshape(4, 4).T
    t = np.array(node.translation or [0, 0, 0], dtype=np.float64)
    x, y, z, w = node.rotation or [0, 0, 0, 1]
    s = np.array(node.scale or [1, 1, 1], dtype=np.float64)
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


stage = Usd.Stage.CreateNew(TMP)
UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
UsdGeom.SetStageMetersPerUnit(stage, 1.0)
root = UsdGeom.Xform.Define(stage, '/Casa')
stage.SetDefaultPrim(root.GetPrim())
Usd.ModelAPI(root.GetPrim()).SetKind('component')

materials = {}


def material(i):
    if i in materials:
        return materials[i]
    m = g.materials[i]
    pbr = m.pbrMetallicRoughness
    c = pbr.baseColorFactor or [1, 1, 1, 1]
    mat = UsdShade.Material.Define(stage, f'/Casa/Materiali/M{i}')
    sh = UsdShade.Shader.Define(stage, f'/Casa/Materiali/M{i}/Surface')
    sh.CreateIdAttr('UsdPreviewSurface')
    sh.CreateInput('diffuseColor', Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*c[:3]))
    sh.CreateInput('roughness', Sdf.ValueTypeNames.Float).Set(float(pbr.roughnessFactor if pbr.roughnessFactor is not None else 1))
    sh.CreateInput('metallic', Sdf.ValueTypeNames.Float).Set(float(pbr.metallicFactor if pbr.metallicFactor is not None else 0))
    if m.alphaMode == 'BLEND':
        sh.CreateInput('opacity', Sdf.ValueTypeNames.Float).Set(float(c[3]))
    mat.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), 'surface')
    materials[i] = (mat, m.alphaMode == 'BLEND' or bool(m.doubleSided))
    return materials[i]


count = 0
lo, hi = np.full(3, np.inf), np.full(3, -np.inf)


def visit(ni, parent):
    global count, lo, hi
    node = g.nodes[ni]
    world = parent @ local_matrix(node)
    if node.mesh is not None:
        for prim in g.meshes[node.mesh].primitives:
            pos = accessor(prim.attributes.POSITION).astype(np.float64)
            pos = (np.c_[pos, np.ones(len(pos))] @ world.T)[:, :3]
            idx = accessor(prim.indices).reshape(-1) if prim.indices is not None else np.arange(len(pos))
            if len(idx) == 0 or len(pos) == 0:
                continue
            nrm = None
            if prim.attributes.NORMAL is not None:
                nrm = accessor(prim.attributes.NORMAL).astype(np.float64) @ np.linalg.inv(world[:3, :3])
                nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
            mesh = UsdGeom.Mesh.Define(stage, f'/Casa/Geometria/Mesh{count}')
            count += 1
            mesh.CreatePointsAttr([Gf.Vec3f(*p) for p in pos])
            mesh.CreateFaceVertexCountsAttr([3] * (len(idx) // 3))
            mesh.CreateFaceVertexIndicesAttr(idx.astype(int).tolist())
            mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
            if nrm is not None:
                mesh.CreateNormalsAttr([Gf.Vec3f(*n) for n in nrm])
                mesh.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
            mesh.CreateExtentAttr([Gf.Vec3f(*pos.min(0)), Gf.Vec3f(*pos.max(0))])
            lo, hi = np.minimum(lo, pos.min(0)), np.maximum(hi, pos.max(0))
            if prim.material is not None:
                mat, double = material(prim.material)
                UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(mat)
                mesh.CreateDoubleSidedAttr(double)
    for c in node.children or []:
        visit(c, world)


for ni in g.scenes[g.scene or 0].nodes:
    visit(ni, np.eye(4))

stage.GetRootLayer().Save()
if os.path.exists(OUT):
    os.remove(OUT)
ok = UsdUtils.CreateNewARKitUsdzPackage(Sdf.AssetPath(TMP), OUT)
print(f'mesh: {count}, dimensioni: {np.round(hi - lo, 3)} m, pacchetto ARKit: {ok}, {os.path.getsize(OUT) / 1e6:.1f} MB')
