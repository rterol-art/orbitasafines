// ============================================================
// espacio — Fases 1 + 2 + media (imágenes, textos, líneas, estelas)
// Escena negra + IBL + carga desde manifest + comportamientos
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MovementController, TearScheduler, makeRng } from './behaviors.js';
import { buildImage, buildText, updateBillboard, ConnectionLines, Trails } from './media.js';
import { RelationField } from './relations.js';
import { search } from './search.js';

// ---------- Configuración ----------
const CONFIG = {
  maxObjects: 30,
  spawnRadius: 6,
  targetSize: 1.6,
  envIntensity: 1.0,
  connections: true,   // líneas finas intermitentes entre elementos
  trails: true,        // estela suave de imágenes y textos
  relations: true,     // Fase 3: fuerzas y sincronización por tags
  search: true,        // buscador por frase
  searchFallback: 'random', // sin resultados: 'random' | 'none'
};

// ---------- Escena base ----------
const canvas = document.getElementById('scene');
const hud = document.getElementById('hud');

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
  50, window.innerWidth / window.innerHeight, 0.1, 200
);
camera.position.set(0, 0.4, 10);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.5;
controls.maxDistance = 40;

// ---------- Selección y seguimiento ----------
// Al hacer click en un objeto, la cámara lo centra y lo SIGUE en su órbita
// desplazándose con él (no rotando alrededor): mantiene el ángulo de visión
// y traslada cámara+target según el movimiento del objeto cada frame.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let followed = null;                 // { root } que la cámara sigue
const _followPrev = new THREE.Vector3();
const _followDelta = new THREE.Vector3();
let _pointerDownPos = null;

function objectRootFromHit(obj) {
  // sube hasta el root registrado en `objects`
  let o = obj;
  while (o) {
    if (o.userData?.meta) return o;
    o = o.parent;
  }
  return null;
}

function onPointerDown(e) {
  _pointerDownPos = { x: e.clientX, y: e.clientY };
}

function onPointerUp(e) {
  if (!_pointerDownPos) return;
  const moved = Math.hypot(e.clientX - _pointerDownPos.x, e.clientY - _pointerDownPos.y);
  _pointerDownPos = null;
  if (moved > 6) return; // fue un arrastre (orbit), no un click

  const rect = renderer.domElement.getBoundingClientRect();
  // solo cuenta si el click cae dentro del canvas
  if (e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top || e.clientY > rect.bottom) return;
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  // raycast SOLO contra los roots de objetos (no sprites/puntos/estelas)
  const roots = objects.map(o => o.root);
  const hits = raycaster.intersectObjects(roots, true);
  if (hits.length) {
    const root = objectRootFromHit(hits[0].object);
    if (root) selectObject(root);
  } else {
    releaseFollow();
  }
}

function selectObject(root) {
  followed = { root };
  root.getWorldPosition(_followPrev);
  // llevar el target de la cámara al objeto suavemente (en el bucle)
  _retargetTo.copy(_followPrev);
  _retargeting = true;
  const meta = root.userData.meta;
  setHud(meta?.tags?.length ? meta.tags.slice(0, 5).join(' · ') : 'objeto', true);
}

function releaseFollow() {
  followed = null;
  _retargeting = false;
  setHud(`${objects.length} objetos`, true);
}

const _retargetTo = new THREE.Vector3();
let _retargeting = false;

renderer.domElement.addEventListener('pointerdown', onPointerDown);
// pointerup en WINDOW, no en el canvas: OrbitControls captura el puntero
// durante el arrastre y el pointerup no siempre llega al canvas (por eso
// fallaba con ratón). En window siempre lo recibimos.
window.addEventListener('pointerup', onPointerUp);
// doble click o Escape suelta el seguimiento
window.addEventListener('keydown', e => { if (e.key === 'Escape') releaseFollow(); });

// ---------- Iluminación ----------
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = CONFIG.envIntensity;
pmrem.dispose();

const key = new THREE.DirectionalLight(0xffffff, 0.6);
key.position.set(3, 5, 4);
scene.add(key);

const fill = new THREE.DirectionalLight(0x8899bb, 0.15);
fill.position.set(-2, -3, -2);
scene.add(fill);

// ---------- Loaders ----------
const ktx2 = new KTX2Loader()
  .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/')
  .detectSupport(renderer);

const gltfLoader = new GLTFLoader()
  .setKTX2Loader(ktx2)
  .setMeshoptDecoder(MeshoptDecoder);

// ---------- Estado compartido de comportamientos ----------
const objects = [];                                 // { root, meta, controller }
const tearScheduler = new TearScheduler();          // 1 desgarro a la vez en toda la escena
const timeUniform = { value: 0 };                   // reloj global para shaders (costura)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Efectos de escena (se inicializan tras cargar, cuando hay elementos)
let connections = null;
let trails = null;
let relations = null;

// ---------- Utilidades ----------
function setHud(text, fade = false) {
  hud.textContent = text;
  hud.classList.toggle('faded', fade);
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalize(root, targetSize, userScale = 1) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = (targetSize / maxDim) * userScale;
  root.scale.setScalar(s);
  root.position.sub(center.multiplyScalar(s));
}

function spawnPosition(index, total) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / Math.max(total - 1, 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const theta = golden * index;
  return new THREE.Vector3(
    Math.cos(theta) * r,
    y * 0.6,
    Math.sin(theta) * r
  ).multiplyScalar(CONFIG.spawnRadius * (0.5 + Math.random() * 0.5));
}

function attachController(root, meta, seedKey) {
  const seed = hashString(seedKey);
  root.userData.seed = (seed % 1000) / 100; // para el temblor del billboard
  const controller = reducedMotion ? null : new MovementController(root, meta.movement, {
    seed,
    tearScheduler,
    timeUniform,
  });
  objects.push({ root, meta, controller });
}

// ---------- Catálogo de objetos ----------
// Sin manifest, sin Action, sin archivos ocultos: el motor pregunta a la
// API pública de GitHub qué hay en /objects/ cada vez que se abre la página.
// Subir un par .glb + .json por la web de GitHub es todo lo que hace falta.

function detectRepo() {
  const host = location.hostname;
  if (!host.endsWith('.github.io')) return null; // local u otro hosting
  const owner = host.split('.')[0];
  const seg = location.pathname.split('/').filter(Boolean);
  // Página en /repo/... → el repo es el primer segmento;
  // página en la raíz → "user site" (owner.github.io)
  const repo = seg.length && !seg[0].endsWith('.html') ? seg[0] : `${owner}.github.io`;
  return { owner, repo };
}

async function loadCatalog() {
  const gh = detectRepo();

  // 1) Producción: listar objects/ vía API de GitHub
  if (gh) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/objects`,
        { headers: { Accept: 'application/vnd.github+json' } }
      );
      if (res.ok) {
        const listing = await res.json();
        const present = new Set(listing.map(f => f.name));
        const jsons = listing.filter(f => f.name.endsWith('.json'));
        const metas = await Promise.all(jsons.map(async f => {
          try {
            const meta = await (await fetch(`./objects/${f.name}`, { cache: 'no-store' })).json();
            return resolveMeta(meta, f.name, present);
          } catch (e) {
            console.warn(`[espacio] ${f.name}: JSON inválido —`, e.message);
            return null;
          }
        }));
        return metas.filter(Boolean);
      }
      console.warn('[espacio] API de GitHub →', res.status);
    } catch (err) {
      console.warn('[espacio] API de GitHub no accesible:', err.message);
    }
  }

  // 2) Desarrollo local: manifest.json opcional como respaldo
  try {
    const res = await fetch('./manifest.json', { cache: 'no-store' });
    if (res.ok) {
      const manifest = await res.json();
      if (Array.isArray(manifest.objects)) {
        return manifest.objects
          .map(m => resolveMeta(m, m.file ?? '', new Set(manifest.objects.flatMap(o => o.file ? [o.file] : []))))
          .filter(Boolean);
      }
    }
  } catch { /* sin respaldo local: fallback procedural */ }

  return [];
}

// Determina el tipo de cada entrada y valida que su archivo exista.
// Tipo explícito ("type") o inferido del archivo hermano / extensión.
function resolveMeta(meta, jsonName, present) {
  const base = jsonName.replace(/\.json$/, '');
  let type = meta.type;
  let file = meta.file;

  if (!type) {
    // Inferir: ¿hay un .glb, .png hermano? ¿o es texto?
    if (file) {
      type = /\.glb$/i.test(file) ? 'model' : /\.png$/i.test(file) ? 'image' : null;
    } else if (present.has(base + '.glb')) { type = 'model'; file = base + '.glb'; }
    else if (present.has(base + '.png')) { type = 'image'; file = base + '.png'; }
    else if (meta.text != null) { type = 'text'; }
  }
  if (!file && (type === 'model' || type === 'image')) {
    file = base + (type === 'model' ? '.glb' : '.png');
  }

  if (type === 'text') return { ...meta, type: 'text' };
  if (type === 'model' || type === 'image') {
    if (present.size && !present.has(file)) {
      console.warn(`[espacio] ${jsonName}: no existe objects/${file}`);
      return null;
    }
    return { ...meta, type, file };
  }
  console.warn(`[espacio] ${jsonName}: tipo no reconocido (falta type/file/text)`);
  return null;
}

async function loadObject(meta, index, total) {
  let root;
  if (meta.type === 'image') {
    root = await buildImage(`./objects/${meta.file}`, meta);
  } else if (meta.type === 'text') {
    root = buildText(meta);
    // El texto necesita un movimiento propio, MUY suave: sólo deriva por bucle
    // amplio y lento, sin jitter perceptible, sin respiración (no tiene volumen)
    // ni efectos de malla. Así permanece legible. Si el JSON define movement,
    // se respeta su base pero se neutralizan las capas agresivas.
    const userBase = meta.movement?.base ?? { type: 'bucle', period: [60, 90], radius: [1.5, 2.5], mutation: 0.04 };
    meta = { ...meta, movement: {
      base: userBase,
      layers: [], // sin jitter ni respiración: el texto solo deriva, nítido y quieto
    }};
  } else { // model
    const gltf = await gltfLoader.loadAsync(`./objects/${meta.file}`);
    root = new THREE.Group();
    root.add(gltf.scene);
    normalize(gltf.scene, CONFIG.targetSize, meta.scale ?? 1);
    root.userData.isModel = true; // deja huella de silueta al moverse
    // escala base aleatoria por objeto (carácter), estable por semilla de nombre
    const rs = 0.75 + (hashString(meta.file) % 100) / 100 * 0.6; // 0.75–1.35
    root.scale.multiplyScalar(rs);
  }
  root.position.copy(spawnPosition(index, total));
  root.userData.meta = meta;
  if (meta.trailStrength != null) root.userData.trailStrength = meta.trailStrength;
  scene.add(root);

  // Los billboards (texto) no reciben rotación de comportamiento: el bucle
  // los orienta a cámara. Reciben solo movimiento traslacional.
  attachController(root, meta, meta.file ?? `text-${index}`);
}

// ---------- Fallback procedural ----------
function makeBrokenMesh(seed) {
  // IcosahedronGeometry viene SIN índice (geometría no indexada). Para poder
  // abrir un hueco borrando triángulos necesitamos indexarla primero;
  // mergeVertices además fusiona vértices coincidentes → la malla se rompe
  // por costuras reales, no por triángulos sueltos.
  const geo = mergeVertices(new THREE.IcosahedronGeometry(0.8, 3));
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 4 + seed) * Math.cos(v.y * 3 + seed) * Math.sin(v.z * 5);
    v.multiplyScalar(1 + n * 0.25);
    if (Math.random() < 0.04) v.multiplyScalar(1.8);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const idx = geo.index.array;
  const holeStart = Math.floor(Math.random() * idx.length * 0.6);
  const holeLen = Math.floor(idx.length * 0.18 / 3) * 3;
  const kept = new Uint32Array(idx.length - holeLen);
  kept.set(idx.slice(0, holeStart));
  kept.set(idx.slice(holeStart + holeLen), holeStart);
  geo.setIndex(new THREE.BufferAttribute(kept, 1));
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb9a8c9, roughness: 0.65, metalness: 0,
    side: THREE.DoubleSide, flatShading: true,
  });
  return new THREE.Mesh(geo, mat);
}

// Cada malla de prueba demuestra una combinación distinta,
// para calibrar los comportamientos a ojo antes de subir obra real.
const FALLBACK_MOVEMENTS = [
  { // completo: la configuración por defecto
    base: { type: 'bucle' }, time: { type: 'playback' },
    layers: [{ type: 'jitter' }, { type: 'respiracion' }], mesh: [],
  },
  { // solo bucle imperfecto, limpio
    base: { type: 'bucle', period: 45, radius: 1.5, mutation: 0.12 },
    layers: [],
  },
  { // playback muy degradado + jitter fuerte
    base: { type: 'bucle', period: 25 },
    time: { type: 'playback', freezesPerMinute: 10, freezeMs: [300, 1200], rewindChance: 0.4 },
    layers: [{ type: 'jitter', amplitude: 0.02, frequency: 18 }],
  },
  { // respiración protagonista + costura
    base: { type: 'bucle', radius: 0.6, period: 70 },
    layers: [{ type: 'respiracion', amount: 0.03, period: [5, 9] }],
    mesh: [{ type: 'costura', coverage: 0.3, speed: 0.08 }],
  },
  { // deshielo (degradación permanente) sobre movimiento mínimo
    base: { type: 'bucle', radius: 0.5, period: 90 },
    layers: [{ type: 'jitter' }],
    mesh: [{ type: 'deshielo', rate: 0.03, max: 0.4 }],
  },
];

function spawnFallback() {
  FALLBACK_MOVEMENTS.forEach((movement, i) => {
    const root = new THREE.Group();
    root.add(makeBrokenMesh(i * 7.3));
    root.position.copy(spawnPosition(i, FALLBACK_MOVEMENTS.length));
    root.userData.isModel = true;
    scene.add(root);
    attachController(root, { file: null, tags: ['fallback'], movement }, `fallback-${i}`);
  });
}

// ---------- Populado de escena (reutilizable: arranque y búsqueda) ----------
let catalog = [];   // catálogo completo cargado una vez

function clearScene() {
  for (const o of objects) {
    scene.remove(o.root);
    o.root.traverse(n => {
      if (n.geometry) n.geometry.dispose?.();
      if (n.material) {
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        mats.forEach(m => m.dispose?.());
      }
    });
  }
  objects.length = 0;
  if (relations) relations = null;
  // Reset duro de líneas: soltar toda línea activa (si no, quedan congeladas
  // apuntando a objetos ya retirados → líneas eternas) y limpiar los pares.
  if (connections) connections.reset();
  if (trails) trails.clear();
}

async function populate(selection) {
  clearScene();
  const loader = document.getElementById('loader');
  if (loader) loader.classList.add('on');
  try {
    if (selection.length === 0) {
      spawnFallback();
      setHud('sin resultados — muestra de prueba', true);
    } else {
      setHud(`cargando 0 / ${selection.length}`);
      let loaded = 0;
      const results = await Promise.allSettled(
        selection.map((meta, i) =>
          loadObject(meta, i, selection.length).then(() => {
            loaded++;
            setHud(`cargando ${loaded} / ${selection.length}`);
          })
        )
      );
      results
        .filter(r => r.status === 'rejected')
        .forEach(r => console.warn('[espacio] objeto no cargado:', r.reason));
      setHud(`${objects.length} objetos`, true);
    }
  } finally {
    if (loader) loader.classList.remove('on'); // se oculta pase lo que pase
  }

  // Efectos de escena
  if (!reducedMotion) {
    if (CONFIG.connections && !connections) connections = new ConnectionLines(scene);
    if (CONFIG.trails && !trails) trails = new Trails(scene);
    if (CONFIG.relations && objects.filter(o => o.meta.tags?.length).length >= 2) {
      relations = new RelationField(objects);
      if (connections) connections.setPairs(relations.relatedPairs());
    }
  }
}

// ---------- Arranque ----------
async function init() {
  catalog = await loadCatalog();
  const selection = [...catalog]
    .sort(() => Math.random() - 0.5)
    .slice(0, CONFIG.maxObjects);
  await populate(selection);
  if (CONFIG.search) setupSearch();
}

// ---------- Buscador y azar ----------
function randomize() {
  // El azar reconstruye la escena y elige UN objeto al azar como central.
  // Sin tag buscado: todos los tags del central pesan igual en la invocación.
  if (relations) relations.clearInvocation();
  return populate([...catalog].sort(() => Math.random() - 0.5).slice(0, CONFIG.maxObjects))
    .then(() => {
      if (relations && objects.length) {
        const centralObj = objects[Math.floor(Math.random() * objects.length)];
        relations.invoke(centralObj.root, null);
        setHud(`invocado al azar — ${centralObj.meta.tags?.slice(0,3).join(' · ') || ''}`, true);
      }
    });
}

// Elige el mejor central para una frase de búsqueda: el objeto del catálogo
// cuyos tags mejor casan con la frase, priorizando match directo en tags,
// luego en expand, luego proximidad textual.
function pickCentralFor(phrase, results) {
  if (!results.length) return null;
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  let best = null, bestScore = -1, bestHit = null;
  for (const m of results) {
    const tags = (m.tags || []).map(t => t.toLowerCase());
    const expand = (m.expand || []).map(t => t.toLowerCase());
    let score = 0, hitTag = null;
    for (const w of words) {
      if (tags.includes(w)) { score += 2; hitTag = hitTag || w; }
      else if (expand.includes(w)) { score += 1; }
      else {
        for (const t of tags) if (t.includes(w) || w.includes(t)) { score += 1; hitTag = hitTag || t; break; }
      }
    }
    if (score > bestScore) { best = m; bestScore = score; bestHit = hitTag; }
  }
  return { central: best, searchedTag: bestHit };
}

function setupSearch() {
  const input = document.getElementById('search');
  const randomBtn = document.getElementById('random');
  if (randomBtn) randomBtn.addEventListener('click', () => { if (input) input.value = ''; randomize(); });
  if (!input) return;
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const phrase = input.value.trim();
    if (!phrase) {
      // Enter vacío: soltar la invocación (todos vuelven a relevancia 1).
      if (relations) relations.clearInvocation();
      setHud(`${objects.length} objetos`, true);
      return;
    }

    const res = search(phrase, catalog, { max: CONFIG.maxObjects, fallback: 'none' });

    if (!res.objects.length) {
      setHud('nada respondió a esa frase', true);
      if (relations) relations.clearInvocation();
      return;
    }

    // Elegir el central: el mejor match. La búsqueda invoca UN objeto, no
    // muchos. Ese objeto reorganiza el mundo a su alrededor por relevancia.
    const pick = pickCentralFor(phrase, res.objects);

    const inScene = new Map(objects.map(o => [o.meta.file ?? o.meta.text, o.root]));
    let centralRoot = inScene.get(pick.central.file ?? pick.central.text);

    if (!centralRoot) {
      // El central no está en escena: recargamos incluyéndolo (y algunos otros
      // afines para que la constelación tenga cuerpo), y luego invocamos.
      const others = catalog.filter(m => m !== pick.central)
        .sort(() => Math.random() - 0.5);
      const selection = [pick.central, ...others].slice(0, CONFIG.maxObjects);
      await populate(selection);
      const inSceneNow = new Map(objects.map(o => [o.meta.file ?? o.meta.text, o.root]));
      centralRoot = inSceneNow.get(pick.central.file ?? pick.central.text);
    }

    if (centralRoot && relations) {
      relations.invoke(centralRoot, pick.searchedTag);
      setHud(`«${phrase}» · centro: ${(pick.central.tags||[]).slice(0,3).join(' · ')}`, true);
    }
  });
}

// ---------- Bucle ----------
const clock = new THREE.Clock();
let textHighlightAcc = 0;
const _wpA = new THREE.Vector3();
const _wpB = new THREE.Vector3();

// Para cada texto, resalta palabras que coincidan con tags de vecinos cercanos.
const HIGHLIGHT_RADIUS = 4;
function updateTextHighlights() {
  for (const o of objects) {
    if (!o.root.userData.words) continue;
    const words = o.root.userData.words;
    const bold = new Set();
    o.root.getWorldPosition(_wpA);
    for (const other of objects) {
      if (other === o) continue;
      const tags = other.meta.tags;
      if (!tags?.length) continue;
      other.root.getWorldPosition(_wpB);
      if (_wpA.distanceTo(_wpB) > HIGHLIGHT_RADIUS) continue;
      for (const tag of tags) {
        const nt = tag.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]/g, '');
        if (words.has(nt)) bold.add(nt);
      }
    }
    o.root.userData.highlight(bold);
    // relación 0..1 = palabras resonantes / total de palabras del texto
    const ratio = words.size ? bold.size / words.size : 0;
    o.root.userData._relRatio = ratio;
  }
}

// Atenúa y hace vibrar el CUERPO de cada objeto según su relevancia respecto
// a lo invocado. Esta es la lectura principal de la lejanía semántica:
// - relevancia alta  → objeto nítido, quieto, opaco
// - relevancia baja  → objeto atenuado (pero VISIBLE, espectral) y vibrando
// Vale para los tres tipos. La vibración es un desplazamiento del root, no
// una deformación, así que es barata y no rompe la malla.
const _relJit = new THREE.Vector3();
function applyRelevanceToBody(t) {
  for (const o of objects) {
    const root = o.root;
    const rel = root.userData.relevance ?? 1;

    // --- Opacidad del cuerpo ---
    // Mapa: rel 1 → 1.0 (opaco), rel 0 → 0.42 (espectral pero claramente visible).
    // Antes el fondo quedaba casi invisible; ahora los lejanos se ven "un poco
    // más", como pediste. Suelo alto a propósito.
    const bodyOpacity = 0.42 + rel * 0.58;

    // guardar/leer los materiales del objeto una sola vez
    let mats = root.userData._relMats;
    if (!mats) {
      mats = [];
      root.traverse(n => {
        if (n.material) {
          const arr = Array.isArray(n.material) ? n.material : [n.material];
          for (const m of arr) {
            if (m._baseOpacity == null) m._baseOpacity = (m.opacity != null ? m.opacity : 1);
            mats.push(m);
          }
        }
      });
      root.userData._relMats = mats;
    }
    for (const m of mats) {
      const target = m._baseOpacity * bodyOpacity;
      if (bodyOpacity < 0.999) { m.transparent = true; }
      m.opacity += (target - m.opacity) * 0.1; // suavizado
    }

    // --- Vibración por baja relevancia ---
    // Cuanto menos relevante, más tiembla. La vibración da esa cualidad
    // inestable, de señal que se pierde, sin necesidad de deformar la malla.
    const vib = (1 - rel);
    if (vib > 0.02) {
      if (!root.userData._relHome) root.userData._relHome = root.position.clone();
      const amp = vib * 0.06;             // amplitud proporcional a la lejanía
      const fx = 11 + (root.userData.seed ?? 0) * 3;
      const fy = 13 + (root.userData.seed ?? 0) * 2;
      _relJit.set(
        Math.sin(t * fx) * amp,
        Math.cos(t * fy) * amp,
        Math.sin(t * (fx + fy) * 0.5) * amp
      );
      // aplicar como offset relativo a la posición actual (que el bucle ya movió)
      root.position.add(_relJit);
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1); // clamp: pestañas en background
  const t = clock.elapsedTime;
  timeUniform.value = t;

  for (const o of objects) {
    if (o.controller) o.controller.update(dt, t);
    // Los textos miran a cámara (plano, quieto) tras el movimiento traslacional
    if (o.root.userData.billboard) {
      updateBillboard(o.root, camera, t, o.root.userData.seed ?? 0);
    }
  }

  // Fase 3: las fuerzas relacionales mueven los anclas de los bucles
  if (relations) {
    relations.update(dt);
    // Publicar la relevancia de cada nodo a su root.userData para que las
    // estelas y demás lectores visuales la usen sin acoplarse al RelationField.
    for (const n of relations.nodes) n.root.userData.relevance = n.relevance;
    // Atenuar y vibrar el CUERPO de cada objeto según su relevancia: es la
    // lectura principal de la lejanía. Vale para modelos, imágenes y textos.
    applyRelevanceToBody(t);
  }

  // Resaltado de textos: cada ~0.3s, cada texto pone en negrita las palabras
  // que coincidan con tags de objetos cercanos. Umbral de distancia para que
  // sea reconocimiento ocasional, no índice permanente.
  textHighlightAcc += dt;
  if (textHighlightAcc > 0.3) {
    textHighlightAcc = 0;
    updateTextHighlights();
  }

  if (trails) trails.update(dt, objects, camera);
  if (connections) connections.update(dt, objects);

  // Seguimiento: la cámara se desplaza con el objeto seguido (no rota).
  if (followed) {
    if (!followed.root.parent) {
      releaseFollow();             // el objeto salió de escena
    } else {
      followed.root.getWorldPosition(_followCur);
      if (_retargeting) {
        // aproximar suavemente el target al objeto la primera vez
        controls.target.lerp(_followCur, 0.08);
        camera.position.lerp(
          _tmpCam.copy(camera.position).add(_followCur).sub(controls.target), 0.08
        );
        if (controls.target.distanceTo(_followCur) < 0.05) _retargeting = false;
      } else {
        // seguir: aplicar el mismo desplazamiento del objeto a cámara y target
        _followDelta.subVectors(_followCur, _followPrev);
        controls.target.add(_followDelta);
        camera.position.add(_followDelta);
      }
      _followPrev.copy(_followCur);
    }
  }

  controls.update();
  renderer.render(scene, camera);
}
const _followCur = new THREE.Vector3();
const _tmpCam = new THREE.Vector3();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
animate();
