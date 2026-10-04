// Converte l'export di Revit (FBX, oppure glTF/GLB) in assets/casa.glb ottimizzato per il telefono.
// Uso: npm run converti -- "C:\percorso\casa.fbx"
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, join, flatten, center, meshopt, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

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
  console.log("FBX → glTF…");
  execFileSync(exe, ['--binary', '--input', input, '--output', path.join(tmp, 'raw')], { stdio: 'inherit' });
  glbIn = path.join(tmp, 'raw.glb');
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(glbIn);
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];

const count = () => doc.getRoot().listMeshes().length;
console.log(`mesh in ingresso: ${count()}`);

// L'FBX di Revit arriva senza materiali: li assegno in base al nome della famiglia.
// Ordine importante: vince la prima regola che corrisponde.
// Colori tarati sulle foto attuali dell'edificio (paramano in mattoni, calcestruzzo a vista).
const PALETTE = [
  [/^Livello|Asfalto|topografic/i, null], // elementi da scartare (il terreno in AR è il foglio)
  [/vetro|Glass/i, { color: 0x9fb4bf, rough: 0.05, metal: 0.1, opacity: 0.4 }],
  [/Finestra|Gealan/i, { color: 0x56616a, rough: 0.25, metal: 0.3 }],           // vetrate scure con telaio chiaro: tono medio
  [/Porta/i, { color: 0x6b5444, rough: 0.7 }],
  [/Ringhiera|Montante|Tipo di corrente/i, { color: 0x3a3c3e, rough: 0.5, metal: 0.5 }],
  [/Tamponamento Esterno/i, { color: 0xa5766a, rough: 0.95 }],                  // paramano
  [/parapetto/i, { color: 0xb08578, rough: 0.95 }],                             // mattoni traforati
  [/Pilastro - Circolare Diametro (610|800)/i, { color: 0xa0705f, rough: 0.95 }], // pilastri rivestiti in mattoni
  [/Pilastro/i, { color: 0xbcbbb5, rough: 0.85 }],                              // pilotis in calcestruzzo
  [/Tetto/i, { color: 0xa5a29b, rough: 0.9 }],
  [/Pavimento|Solaio|Scala/i, { color: 0xc9c6be, rough: 0.9 }],                 // solai e bordi balconi a vista
  [/Muro/i, { color: 0xece8df, rough: 0.9 }],                                   // tramezze e muri interni
  [/./, { color: 0xc9c6be, rough: 0.9 }],
];
const mats = new Map();
const material = (spec) => {
  if (!mats.has(spec)) {
    const c = [(spec.color >> 16) & 255, (spec.color >> 8) & 255, spec.color & 255].map((x) => (x / 255) ** 2.2);
    const m = doc.createMaterial().setBaseColorFactor([...c, spec.opacity ?? 1])
      .setRoughnessFactor(spec.rough ?? 0.9).setMetallicFactor(spec.metal ?? 0);
    if (spec.opacity) m.setAlphaMode('BLEND').setDoubleSided(true);
    mats.set(spec, m);
  }
  return mats.get(spec);
};

// Revit duplica i vertici per ogni faccia: senza normali e UV (non ci sono texture) si possono saldare
// e quindi semplificare. Il viewer userà l'ombreggiatura a facce piatte, adatta a un plastico.
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  for (const sem of prim.listSemantics()) if (sem !== 'POSITION') prim.setAttribute(sem, null);
}
await doc.transform(dedup(), prune(), flatten(), weld());

await MeshoptSimplifier.ready;
let triBefore = 0, triAfter = 0;
const tris = (p) => (p.getIndices()?.getCount() ?? 0) / 3;
const done = new Set();
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh || done.has(mesh)) continue;
  done.add(mesh);
  const spec = PALETTE.find(([re]) => re.test(mesh.getName()))[1];
  if (!spec) { node.setMesh(null); continue; }
  // Infissi e scale hanno profili dettagliatissimi: a scala di plastico non si vedono.
  const fine = /Finestra|Gealan|Porta|Scala/i.test(mesh.getName());
  for (const prim of mesh.listPrimitives()) {
    prim.setMaterial(material(spec));
    triBefore += tris(prim);
    if (tris(prim) > 200) {
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0, error: fine ? 0.006 : 0.002, lockBorder: false });
    }
    triAfter += tris(prim);
  }
}
console.log(`triangoli: ${Math.round(triBefore)} → ${Math.round(triAfter)}`);

await doc.transform(prune(), join(), center({ pivot: 'below' }), prune());
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
