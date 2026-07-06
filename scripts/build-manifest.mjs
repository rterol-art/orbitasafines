// Genera manifest.json a partir de los pares .glb + .json en /objects.
// Sin dependencias: Node >= 18. Se ejecuta en la GitHub Action o en local:
//   node scripts/build-manifest.mjs

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';

const OBJECTS_DIR = 'objects';
const OUT = 'manifest.json';

const files = await readdir(OBJECTS_DIR).catch(() => []);
const jsons = files.filter(f => f.endsWith('.json'));
const glbs = new Set(files.filter(f => f.endsWith('.glb')));

const objects = [];
const warnings = [];

for (const jsonFile of jsons) {
  const path = join(OBJECTS_DIR, jsonFile);
  let meta;
  try {
    meta = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    warnings.push(`✗ ${jsonFile}: JSON inválido (${e.message})`);
    continue;
  }

  // El campo "file" es opcional: por defecto, mismo nombre que el json.
  const glb = meta.file ?? basename(jsonFile, '.json') + '.glb';
  if (!glbs.has(glb)) {
    warnings.push(`✗ ${jsonFile}: no existe objects/${glb}`);
    continue;
  }

  const size = (await stat(join(OBJECTS_DIR, glb))).size;
  if (size > 15 * 1024 * 1024) {
    warnings.push(`⚠ ${glb}: ${(size / 1048576).toFixed(1)} MB — comprimir con gltf-transform`);
  }

  objects.push({
    file: glb,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    movement: meta.movement ?? { type: 'drift' },
    scale: typeof meta.scale === 'number' ? meta.scale : 1,
    bytes: size,
  });
}

objects.sort((a, b) => a.file.localeCompare(b.file));

await writeFile(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  count: objects.length,
  objects,
}, null, 2) + '\n');

console.log(`manifest.json → ${objects.length} objetos`);
warnings.forEach(w => console.log(w));
if (warnings.some(w => w.startsWith('✗'))) process.exitCode = 0; // avisa, no bloquea
