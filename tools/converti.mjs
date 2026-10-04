// Converte l'export di Revit (FBX, oppure glTF/GLB) in assets/casa.glb ottimizzato per il telefono.
// Uso: npm run converti -- "C:\percorso\casa.fbx"
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, join, flatten, center, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'casa.glb');
const TARGET_SIZE = 0.5; // dimensione massima in metri (scala "plastico" per la vista nella stanza)

const input = process.argv[2];
if (!input || !existsSync(input)) {
  console.error('Uso: npm run converti -- "C:\\percorso\\file.fbx"');
  process.exit(1);
}

let glbIn = input;
if (/\.fbx$/i.test(input)) {
  const tmp = path.join(ROOT, 'revit', 'tmp');
  mkdirSync(tmp, { recursive: true });
  const exe = path.join(ROOT, 'node_modules', 'fbx2gltf', 'bin', 'Windows_NT', 'FBX2glTF.exe');
  console.log('FBX → glTF…');
  execFileSync(exe, ['--binary', '--input', input, '--output', path.join(tmp, 'raw')], { stdio: 'inherit' });
  glbIn = path.join(tmp, 'raw.glb');
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(glbIn);
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];

const count = () => doc.getRoot().listMeshes().length;
console.log(`mesh in ingresso: ${count()}`);

await doc.transform(dedup(), prune(), flatten(), weld(), join(), center({ pivot: 'below' }), prune());
console.log(`mesh dopo l'unione: ${count()}`);

// Scala tutto a TARGET_SIZE: Revit esporta in piedi/cm, qui non importa.
const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'); const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const w = [0, 1, 2].map((k) => m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]);
      for (let k = 0; k < 3; k++) { box.min[k] = Math.min(box.min[k], w[k]); box.max[k] = Math.max(box.max[k], w[k]); }
    }
  }
}
const size = box.max.map((x, k) => x - box.min[k]);
const k = TARGET_SIZE / Math.max(...size);
const wrapper = doc.createNode('casa').setScale([k, k, k]);
for (const child of scene.listChildren()) { scene.removeChild(child); wrapper.addChild(child); }
scene.addChild(wrapper);
console.log(`dimensioni originali (unità file): ${size.map((x) => x.toFixed(2)).join(' × ')}  → max ${TARGET_SIZE} m`);

await io.write(OUT, doc);
let mb = statSync(OUT).size / 1e6;
if (mb > 8) {
  console.log(`${mb.toFixed(1)} MB: comprimo la geometria (meshopt)…`);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(OUT, doc);
  mb = statSync(OUT).size / 1e6;
}
console.log(`OK → assets/casa.glb (${mb.toFixed(1)} MB)`);
