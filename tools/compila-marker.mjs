// Compila uno o più PNG in un file .mind per MindAR, senza browser.
// Uso: node tools/compila-marker.mjs assets/out.mind assets/a.png [assets/b.png ...]
import fs from 'node:fs';
import { PNG } from 'pngjs';
import * as tf from '@tensorflow/tfjs';
import { CompilerBase } from '../node_modules/mind-ar/src/image-target/compiler-base.js';
import { buildTrackingImageList } from '../node_modules/mind-ar/src/image-target/image-list.js';
import { extractTrackingFeatures } from '../node_modules/mind-ar/src/image-target/tracker/extract-utils.js';
import '../node_modules/mind-ar/src/image-target/detector/kernels/cpu/index.js';

class NodeCompiler extends CompilerBase {
  // Finta canvas: restituisce direttamente i pixel RGBA letti dal PNG.
  createProcessCanvas(img) {
    return { getContext: () => ({ drawImage() {}, getImageData: () => ({ data: img.rgba }) }) };
  }
  async compileTrack({ progressCallback, targetImages, basePercent }) {
    return targetImages.map((t) => extractTrackingFeatures(buildTrackingImageList(t), () => {}));
  }
}

await tf.setBackend('cpu');
const [out, ...inputs] = process.argv.slice(2);
const images = inputs.map((f) => { const p = PNG.sync.read(fs.readFileSync(f)); return { width: p.width, height: p.height, rgba: p.data }; });
const c = new NodeCompiler();
let last = -10;
const data = await c.compileImageTargets(images, (p) => { if (p - last >= 10) { last = p; process.stdout.write(`${Math.round(p)}% `); } });
console.log();
data.forEach((d, i) => console.log(inputs[i], 'punti riconoscimento:', d.matchingData.reduce((a, m) => a + m.maximaPoints.length + m.minimaPoints.length, 0), 'tracking:', d.trackingData.map((t) => t.points.length).join('/')));
fs.writeFileSync(out, Buffer.from(c.exportData()));
console.log('OK →', out);
