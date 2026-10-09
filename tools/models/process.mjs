// Prepares Tripo GLB exports for the game.
//   node process.mjs <source-dir> <output-dir>
// For each model: optional clean-up, mesh simplification, textures resized and re-encoded as JPEG.
// Output is GLB; to-json.py then splits each into .json + texture files the artifact host can serve.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, textureCompress, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import path from 'node:path';

const [, , SRC, OUT, ONLY] = process.argv;          // optional ONLY: process just this output name

// ratio = fraction of triangles to keep; tex = max texture size.
const MODELS = [
  { src: 'kestrel', tex: 1024 },
  { src: 'corsair', tex: 1024 },
  { src: 'laser-turret', tex: 512, ratio: 0.5 },
  { src: 'railgun', tex: 512, ratio: 0.5 },
  { src: 'autocannon', tex: 512, ratio: 0.5 },
  { src: 'rock-industrial', tex: 1024, ratio: 0.55, dropBelow: 0.1 },
  { src: 'rock-1', tex: 1024, ratio: 0.5 },
  { src: 'rock-2', tex: 1024, ratio: 0.5 },
  { src: 'ice-2', tex: 1024, ratio: 0.55 },
  { src: 'ice-crystal', tex: 1024, ratio: 0.55 },
  // Low-detail copies for the background rocks (lots of them, far away).
  { src: 'rock-1', out: 'rock-1-lod', tex: 256, ratio: 0.1 },
  { src: 'rock-2', out: 'rock-2-lod', tex: 256, ratio: 0.1 },
  { src: 'ice-2', out: 'ice-2-lod', tex: 256, ratio: 0.12 },
  { src: 'ice-crystal', out: 'ice-crystal-lod', tex: 256, ratio: 0.12 },
  // Fortune Station: four landing pads on the outside.
  { src: 'station', tex: 2048, ratio: 0.8 },
];

// Remove triangles whose three corners all sit below `y` (the industrial asteroid's base disc).
function dropTrianglesBelow(doc, y) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION').getArray();
      const idxAcc = prim.getIndices();
      const idx = idxAcc.getArray();
      const keep = [];
      for (let t = 0; t < idx.length; t += 3) {
        const low = [0, 1, 2].every(k => pos[idx[t + k] * 3 + 1] < y);
        if (!low) keep.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      idxAcc.setArray(new Uint32Array(keep));
      console.log(`  dropped ${(idx.length - keep.length) / 3} triangles below y=${y}`);
    }
  }
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

for (const m of MODELS) {
  if (ONLY && (m.out || m.src) !== ONLY) continue;
  const doc = await io.read(path.join(SRC, m.src + '.glb'));
  // Tripo marks an unused volume extension; drop it.
  for (const ext of doc.getRoot().listExtensionsUsed()) ext.dispose();
  if (m.dropBelow !== undefined) dropTrianglesBelow(doc, m.dropBelow);
  const steps = [dedup(), weld()];
  if (m.ratio) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: m.ratio, error: 0.02 }));
  steps.push(prune(), textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [m.tex, m.tex], quality: 86 }));
  await doc.transform(...steps);

  let tris = 0;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    tris += prim.getIndices().getCount() / 3;
    const a = prim.getAttribute('POSITION'), lo = a.getMin([]), hi = a.getMax([]);
    for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], lo[k]); mx[k] = Math.max(mx[k], hi[k]); }
  }
  const name = m.out || m.src;
  await io.write(path.join(OUT, name + '.glb'), doc);
  console.log(`${name}: ${tris} tris, tex ${m.tex}, bounds [${mn.map(v => v.toFixed(3))}] .. [${mx.map(v => v.toFixed(3))}]`);
}
