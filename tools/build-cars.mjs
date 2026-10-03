// Сборка моделей машин в GLB: процедурная геометрия (src/render/carGen.js) → GLTFExporter →
// gltf-transform: dedup, prune, квантование и сжатие meshopt (EXT_meshopt_compression).
// Результат: public/models/cars/<id>.glb (сжатый) и <id>.raw.glb (запасной, без сжатия).
// Запуск: npm run build:cars
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// GLTFExporter читает Blob через FileReader — в Node его нет, нужен минимальный полифилл.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,` + Buffer.from(buf).toString('base64');
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    });
  }
};

const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
const { NodeIO } = await import('@gltf-transform/core');
const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
const { dedup, prune, meshopt } = await import('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = await import('meshoptimizer');
const { CARS } = await import('../src/game/cars.js');
const { buildCarScene, countTriangles } = await import('../src/render/carGen.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'public', 'models', 'cars');
fs.mkdirSync(outDir, { recursive: true });

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

for (const id of Object.keys(CARS)) {
  const scene = buildCarScene(CARS[id]);
  const tris = scene.children.map((g) => `${g.name}: ${countTriangles(g)}`).join(', ');
  const raw = await new GLTFExporter().parseAsync(scene, { binary: true });
  const rawBuf = Buffer.from(raw);
  fs.writeFileSync(path.join(outDir, `${id}.raw.glb`), rawBuf);
  const doc = await io.readBinary(new Uint8Array(rawBuf));
  // UV нужны: ливрея и текстуры назначаются в рантайме, а в GLB-материалах текстур нет
  await doc.transform(dedup(), prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const glb = await io.writeBinary(doc);
  fs.writeFileSync(path.join(outDir, `${id}.glb`), glb);
  console.log(`${id}: ${tris} треугольников; GLB ${(rawBuf.length / 1024).toFixed(0)} КБ → meshopt ${(glb.length / 1024).toFixed(0)} КБ`);
}
