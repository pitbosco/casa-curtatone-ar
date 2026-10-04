// Converte l'export di Revit (FBX, oppure glTF/GLB) in assets/casa.glb ottimizzato per il telefono.
// Uso: npm run converti -- "C:\percorso\casa.fbx"
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, unweld, normals, join, flatten, center, draco, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// --ios: versione alleggerita per AR Quick Look (il formato USDZ di three.js è testuale e pesa molto).
const IOS = process.argv.includes('--ios');
const OUT = path.join(ROOT, 'assets', IOS ? 'casa-ios.glb' : 'casa.glb');
const TARGET_SIZE = 0.5; // dimensione massima in metri (scala "plastico" per la vista nella stanza)

const input = process.argv.slice(2).find((a) => !a.startsWith('--'));
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
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'draco3d.encoder': await draco3d.createEncoderModule() });
const doc = await io.read(glbIn);
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];

const count = () => doc.getRoot().listMeshes().length;
console.log(`mesh in ingresso: ${count()}`);

// L'FBX di Revit arriva senza materiali: li assegno in base al nome della famiglia.
// Ordine importante: vince la prima regola che corrisponde.
// Colori tarati sulle foto attuali dell'edificio (paramano in mattoni, calcestruzzo a vista).
const PALETTE = [
  [IOS ? /^Livello|Tramezza|Tamponamento Interno|Porta/i : /^Livello/i, null], // elementi da scartare
  [/Asfalto|topografic/i, { color: 0x7d7b77, rough: 1 }],                       // terreno
  [/vetro|Glass/i, { color: 0x9fb4bf, rough: 0.05, metal: 0.1, opacity: 0.4 }],
  [/Finestra|Gealan/i, { color: 0xd3d5d4, rough: 0.4, metal: 0.4 }],            // telai in alluminio chiaro (vetri separati sotto)
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

// Nelle finestre Revit telaio e vetro sono un unico oggetto. Le lastre sono triangoli grandi
// (altezza minima > 12 cm), i profili del telaio sono sottili: li separo in base a questo.
const GLASS = PALETTE.find(([re]) => re.test('vetro'))[1];
const buffer = doc.getRoot().listBuffers()[0];
function splitGlass(mesh, prim, scale) {
  const idx = prim.getIndices().getArray(), pos = prim.getAttribute('POSITION');
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], glass = [], frame = [];
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const len = (v) => Math.hypot(...v) * scale;
  for (let i = 0; i < idx.length; i += 3) {
    pos.getElement(idx[i], a); pos.getElement(idx[i + 1], b); pos.getElement(idx[i + 2], c);
    const u = sub(b, a), v = sub(c, a);
    const area = len([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]) * scale / 2;
    const longest = Math.max(len(u), len(v), len(sub(c, b)));
    (2 * area / longest > 0.12 ? glass : frame).push(idx[i], idx[i + 1], idx[i + 2]);
  }
  if (!glass.length) return;
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(frame)).setBuffer(buffer));
  mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos).setMaterial(material(GLASS))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(glass)).setBuffer(buffer)));
}

await MeshoptSimplifier.ready;
let triBefore = 0, triAfter = 0;
const tris = (p) => (p.getIndices()?.getCount() ?? 0) / 3;
const done = new Set();
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh || done.has(mesh)) continue;
  done.add(mesh);
  const spec = PALETTE.find(([re]) => re.test(mesh.getName()))[1];
  if (!spec) { node.setMesh(null); continue; }
  for (const prim of mesh.listPrimitives()) prim.setMaterial(material(spec));
  if (/Finestra|Gealan/i.test(mesh.getName())) {
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) splitGlass(mesh, prim, Math.hypot(m[0], m[1], m[2]));
  }
  // Infissi e scale hanno profili dettagliatissimi: a scala di plastico non si vedono.
  const fine = /Finestra|Gealan|Porta|Scala/i.test(mesh.getName());
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMaterial() === material(GLASS) && spec !== GLASS) { triBefore += tris(prim); triAfter += tris(prim); continue; }
    triBefore += tris(prim);
    if (IOS && /Gealan|Finestra/i.test(mesh.getName()) && tris(prim) > 200) {
      // Semplificazione "a griglia": fonde anche i pezzi separati dei profili.
      const pos = prim.getAttribute('POSITION').getArray();
      const [idx] = MeshoptSimplifier.simplifySloppy(Uint32Array.from(prim.getIndices().getArray()), Float32Array.from(pos), 3, null, Math.floor(prim.getIndices().getCount() * 0.03 / 3) * 3, 0.04);
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer));
    } else if (tris(prim) > 200) {
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0, error: (fine ? 0.006 : 0.002) * (IOS ? 4 : 1), lockBorder: false });
    }
    triAfter += tris(prim);
    if (process.env.DEBUG) (globalThis.stat ??= {})[mesh.getName().split(' ').slice(0, 3).join(' ')] = ((globalThis.stat ?? {})[mesh.getName().split(' ').slice(0, 3).join(' ')] ?? 0) + tris(prim);
  }
}
console.log(`triangoli: ${Math.round(triBefore)} → ${Math.round(triAfter)}`);
if (process.env.DEBUG) console.log(Object.entries(globalThis.stat).sort((a, b) => b[1] - a[1]).slice(0, 12));

// Normali a facce piatte: servono a iPhone (Quick Look) e Android (Scene Viewer) per aprire il modello.
await doc.transform(prune(), unweld(), normals({ overwrite: true }), join(), center({ pivot: 'below' }), prune());
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

// Nomi validi ovunque: i nomi di Revit (es. "Vista 3D {3D}") rendono il file USDZ illeggibile per iPhone.
const safe = (n, i) => (n || 'n').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, '_') + '_' + i;
const r = doc.getRoot();
[...r.listNodes(), ...r.listMeshes(), ...r.listMaterials(), ...r.listScenes()].forEach((o, i) => o.setName(safe(o.getName(), i)));
await io.write(OUT, doc);
let mb = statSync(OUT).size / 1e6;
if (mb > 8 && !IOS) { // la versione iOS resta non compressa: serve solo a generare il file USDZ
  console.log(`${mb.toFixed(1)} MB: comprimo la geometria (Draco, supportato anche da Scene Viewer)…`);
  await doc.transform(draco());
  await io.write(OUT, doc);
  mb = statSync(OUT).size / 1e6;
}
console.log(`OK → ${path.relative(ROOT, OUT)} (${mb.toFixed(1)} MB)`);
