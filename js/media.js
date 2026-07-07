// ============================================================
// espacio — Fase 2b: imágenes, textos y efectos de escena
// - Imagen: objeto de dos caras. Anverso = registro; dorso = el mismo
//   registro invertido y translúcido (la copia vista desde el lado imposible).
// - Texto: billboard que duda — mira a cámara pero tiembla y desalinea.
// - Líneas: conexiones finas e intermitentes entre elementos.
// - Estela: rastro suave que deja cada elemento a su paso.
// ============================================================

import * as THREE from 'three';

const texLoader = new THREE.TextureLoader();

// ============================================================
// IMAGEN — plano de dos caras
// ============================================================
// Anverso: la imagen tal cual, con su alfa (PNG con o sin transparencia).
// Dorso: la MISMA textura, espejada horizontalmente y muy translúcida.
// No es una cara trasera decorativa: es la prueba de que el objeto es una
// reproducción — el registro visto desde donde no debería poder verse.
export async function buildImage(url, meta) {
  const tex = await texLoader.loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const img = tex.image;
  const aspect = (img.width && img.height) ? img.width / img.height : 1;
  const h = 1.6;
  const w = h * aspect;

  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(w, h);

  // Anverso
  const front = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.01,
    side: THREE.FrontSide,
    depthWrite: true,
    toneMapped: false,
  }));
  group.add(front);

  // Dorso: textura espejada + translúcida. Clonamos la textura para poder
  // invertir su repetición horizontal sin afectar al anverso.
  const backTex = tex.clone();
  backTex.needsUpdate = true;
  backTex.wrapS = THREE.RepeatWrapping;
  backTex.repeat.x = -1;      // espejo horizontal → "vista desde detrás"
  backTex.offset.x = 1;
  backTex.colorSpace = THREE.SRGBColorSpace;

  const back = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: backTex,
    transparent: true,
    opacity: meta.backOpacity ?? 0.22,   // fantasma
    alphaTest: 0.01,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.NormalBlending,
  }));
  group.add(back);

  group.userData.isImage = true;
  return group;
}

// ============================================================
// TEXTO — billboard que duda
// ============================================================
// Se rasteriza a textura sobre canvas (control tipográfico total, sin cargar
// fuentes externas). El plano mira a cámara SIEMPRE, pero con temblor de
// posición y una desalineación de rotación que nunca se corrige del todo.
export function buildText(meta) {
  const text = meta.text ?? '';
  const fontSize = meta.fontSize ?? 64;
  const pad = fontSize * 0.6;
  const lineH = fontSize * 1.25;
  const color = meta.color ?? '#d8d2e0';
  const weight = meta.weight ?? 300;
  const family = meta.font ?? 'ui-monospace, monospace';

  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      transparent: true, opacity: meta.opacity ?? 0.9,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    })
  );
  group.add(mesh);

  // Rasteriza el texto a textura. `bold` es el conjunto de palabras (en
  // minúscula, sin acentos) a poner en negrita — las que resuenan con el
  // entorno. Re-render solo cuando ese conjunto cambia.
  const norm = w => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]/g, '');
  function render(boldSet) {
    const lines = text.split('\n');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const measure = document.createElement('canvas').getContext('2d');
    const fontOf = (w) => `${w} ${fontSize}px ${family}`;
    measure.font = fontOf(weight);

    // medir por línea, palabra a palabra (para poder engrosar algunas)
    let textW = 0;
    for (const l of lines) {
      let lw = 0;
      for (const word of l.split(' ')) {
        measure.font = fontOf(boldSet?.has(norm(word)) ? 700 : weight);
        lw += measure.measureText(word + ' ').width;
      }
      textW = Math.max(textW, lw);
    }

    const cw = Math.ceil(textW + pad * 2);
    const ch = Math.ceil(lineH * lines.length + pad * 2);
    const canvas = document.createElement('canvas');
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    lines.forEach((l, i) => {
      let x = pad;
      const y = pad + i * lineH;
      for (const word of l.split(' ')) {
        const isBold = boldSet?.has(norm(word));
        ctx.font = fontOf(isBold ? 700 : weight);
        ctx.fillStyle = isBold ? '#ffffff' : color; // resaltado también aclara
        ctx.fillText(word + ' ', x, y);
        x += ctx.measureText(word + ' ').width;
      }
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearFilter;
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.map = tex;
    mesh.material.needsUpdate = true;

    const worldH = meta.size ?? 0.9;
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(worldH * (cw / ch), worldH);
  }

  render(null); // render inicial sin negritas

  group.userData.isText = true;
  group.userData.billboard = true;
  group.userData.textPlane = mesh;
  // palabras del texto (normalizadas) y API de resaltado para el coordinador
  group.userData.words = new Set(text.split(/\s+/).map(norm).filter(Boolean));
  group.userData._boldKey = '';
  group.userData.highlight = (boldSet) => {
    const key = [...boldSet].sort().join(',');
    if (key === group.userData._boldKey) return; // sin cambios, no re-render
    group.userData._boldKey = key;
    render(boldSet);
  };
  // Opacidad según relación con el entorno: mucho match = presente, nada = tenue.
  group.userData.baseOpacity = meta.opacity ?? 0.9;
  group.userData.minOpacity = meta.minOpacity ?? 0.35;
  group.userData.setRelationOpacity = (ratio) => {
    // ratio 0..1 = fracción de palabras del texto que resuenan con el entorno
    const target = group.userData.minOpacity +
      (group.userData.baseOpacity - group.userData.minOpacity) * Math.min(ratio * 2, 1);
    mesh.material.opacity += (target - mesh.material.opacity) * 0.1; // suavizado
  };
  return group;
}

// Orienta un grupo a la cámara. El texto debe permanecer LEGIBLE de frente:
// la "duda" es una deriva mínima de posición y una inclinación casi
// imperceptible, nunca un giro que cizalle el texto. Vibra en torno al texto
// nítido, no lo rompe.
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
export function updateBillboard(group, camera, t, seed) {
  group.quaternion.copy(camera.quaternion);
  // Inclinación residual muy pequeña (antes 0.05 rad cizallaba el texto).
  const tilt = 0.012;
  const rx = Math.sin(t * 0.5 + seed) * tilt;
  const ry = Math.cos(t * 0.4 + seed * 1.3) * tilt;
  const rz = Math.sin(t * 0.25 + seed * 0.7) * tilt * 0.5;
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  group.quaternion.multiply(_q);
}

// ============================================================
// LÍNEAS DE CONEXIÓN — intermitentes, finas
// ============================================================
// Un pool fijo de segmentos que aparecen y desaparecen entre pares de
// elementos cercanos. No permanentes: parpadean como sinapsis.
export class ConnectionLines {
  constructor(scene, opts = {}) {
    this.max = opts.max ?? 12;
    this.color = new THREE.Color(opts.color ?? 0x9c93b8);
    this.maxDist = opts.maxDist ?? 5.5;      // solo conecta elementos cercanos
    this.spawnChance = opts.spawnChance ?? 0.4; // prob/seg de nueva conexión
    this.life = opts.life ?? [1.5, 4];        // duración de cada línea (s)

    const positions = new Float32Array(this.max * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geo = geo;
    const mat = new THREE.LineBasicMaterial({
      color: this.color, transparent: true, opacity: 0.0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    // Cada línea es su propio objeto para poder darle alfa individual
    this.lines = [];
    for (let i = 0; i < this.max; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const m = new THREE.LineBasicMaterial({
        color: this.color, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(g, m);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.lines.push({ line, a: null, b: null, age: 0, life: 0 });
    }
    this._acc = 0;
  }

  update(dt, objects) {
    // Envejecer y actualizar posiciones de las activas
    for (const slot of this.lines) {
      if (!slot.a) continue;
      slot.age += dt;
      const p = slot.age / slot.life;
      if (p >= 1) { slot.a = slot.b = null; slot.line.visible = false; continue; }
      // Envolvente: entra y sale suave (seno)
      slot.line.material.opacity = Math.sin(p * Math.PI) * 0.5;
      const arr = slot.line.geometry.attributes.position.array;
      slot.a.getWorldPosition(_tmpA);
      slot.b.getWorldPosition(_tmpB);
      arr[0] = _tmpA.x; arr[1] = _tmpA.y; arr[2] = _tmpA.z;
      arr[3] = _tmpB.x; arr[4] = _tmpB.y; arr[5] = _tmpB.z;
      slot.line.geometry.attributes.position.needsUpdate = true;
    }
    // Intentar crear nuevas
    this._acc += dt;
    if (this._acc > 0.25 && objects.length >= 2) {
      this._acc = 0;
      if (Math.random() < this.spawnChance) this._trySpawn(objects);
    }
  }

  _trySpawn(objects) {
    const free = this.lines.find(s => !s.a);
    if (!free) return;

    // Si hay pares por afinidad (Fase 3), elegir de ahí ponderando por peso;
    // si no, caer a proximidad espacial (Fase 2).
    if (this.pairs && this.pairs.length) {
      // ruleta ponderada por afinidad
      let total = 0;
      for (const p of this.pairs) total += p.w;
      let r = Math.random() * total;
      let chosen = this.pairs[0];
      for (const p of this.pairs) { r -= p.w; if (r <= 0) { chosen = p; break; } }
      free.a = chosen.a; free.b = chosen.b;
      free.age = 0;
      free.life = this.life[0] + Math.random() * (this.life[1] - this.life[0]);
      free.line.visible = true;
      return;
    }

    // Fallback proximidad
    const i = Math.floor(Math.random() * objects.length);
    let best = null, bestD = this.maxDist;
    objects[i].root.getWorldPosition(_tmpA);
    for (let k = 0; k < objects.length; k++) {
      if (k === i) continue;
      objects[k].root.getWorldPosition(_tmpB);
      const d = _tmpA.distanceTo(_tmpB);
      if (d < bestD) { bestD = d; best = objects[k]; }
    }
    if (!best) return;
    free.a = objects[i].root;
    free.b = best.root;
    free.age = 0;
    free.life = this.life[0] + Math.random() * (this.life[1] - this.life[0]);
    free.line.visible = true;
  }

  // Fase 3 inyecta aquí los pares relacionados por tags.
  setPairs(pairs) { this.pairs = pairs; }
}
const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();

// ============================================================
// ESTELA — feedback suave de posición
// ============================================================
// Deja copias efímeras y desvanecientes de cada elemento a su paso.
// "Ligerito": pocas muestras, baja opacidad, vida corta.
export class Trails {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.every = opts.every ?? 0.18;      // s entre muestras
    this.life = opts.life ?? 1.4;         // vida de cada eco
    this.maxOpacity = opts.maxOpacity ?? 0.16;
    this.printOpacity = opts.printOpacity ?? 0.14; // huella de 3D (antes 0.07, muy sutil)
    this.samples = [];                    // { mesh, age, base }
    this._acc = 0;
    this._softTex = makeSoftDiscTexture(); // gradiente radial compartido
  }

  // Imágenes y textos dejan eco de su propia textura (silueta real, barata).
  // Los modelos 3D dejan una HUELLA: un disco suave orientado a cámara, con
  // el color medio del modelo y el tamaño de su bounding box. No es un
  // duplicado del cuerpo — es la mancha de que algo pasó por ahí. La
  // imprecisión es deliberada: presencia sin identidad, más fantasmal.
  update(dt, objects, camera) {
    this._acc += dt;
    const emit = this._acc >= this.every;
    if (emit) this._acc = 0;

    if (emit) {
      for (const o of objects) {
        const plane = o.root.userData.textPlane
          || (o.root.userData.isImage ? o.root.children[0] : null);

        if (plane && plane.material.map) {
          // Eco de plano: clona su textura tal cual
          this._emitPlaneEcho(o.root, plane, this.maxOpacity);
        } else if (o.root.userData.isModel) {
          // Huella de silueta: disco suave con el color/tamaño cacheados
          this._emitFootprint(o.root, camera);
        }
      }
    }

    // Envejecer y limpiar
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i];
      s.age += dt;
      const p = s.age / this.life;
      if (p >= 1) {
        this.scene.remove(s.mesh);
        s.mesh.material.dispose();
        this.samples.splice(i, 1);
      } else {
        // desvanecimiento suave (ease-out cuadrático)
        s.mesh.material.opacity = s.base * (1 - p) * (1 - p);
        // la huella de 3D siempre mira a cámara mientras se desvanece
        if (s.billboard && camera) s.mesh.quaternion.copy(camera.quaternion);
      }
    }
  }

  _emitPlaneEcho(root, plane, opacity) {
    const echo = new THREE.Mesh(plane.geometry, new THREE.MeshBasicMaterial({
      map: plane.material.map, transparent: true, opacity,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      blending: THREE.AdditiveBlending,
    }));
    root.getWorldPosition(echo.position);
    echo.quaternion.copy(root.getWorldQuaternion(_qTrail));
    echo.scale.copy(root.scale);
    this.scene.add(echo);
    this.samples.push({ mesh: echo, age: 0, base: opacity, billboard: false });
  }

  _emitFootprint(root, camera) {
    // color y radio se cachean la primera vez (coste amortizado)
    let cache = root.userData.footprint;
    if (!cache) {
      cache = computeFootprint(root);
      root.userData.footprint = cache;
    }
    // intensidad por objeto: un objeto principal puede dejar más rastro
    const op = this.printOpacity * (root.userData.trailStrength ?? 1);
    const echo = new THREE.Mesh(_discGeo, new THREE.MeshBasicMaterial({
      map: this._softTex, color: cache.color, transparent: true,
      opacity: op, depthWrite: false, side: THREE.DoubleSide,
      toneMapped: false, blending: THREE.AdditiveBlending,
    }));
    root.getWorldPosition(echo.position);
    const r = cache.radius * (root.scale.x || 1);
    echo.scale.setScalar(r * 2);
    if (camera) echo.quaternion.copy(camera.quaternion);
    this.scene.add(echo);
    this.samples.push({ mesh: echo, age: 0, base: op, billboard: true });
  }
}
const _qTrail = new THREE.Quaternion();
const _discGeo = new THREE.PlaneGeometry(1, 1);

// Textura de disco suave (gradiente radial blanco→transparente) generada
// una vez. Da a la huella bordes difusos sin recorte duro.
function makeSoftDiscTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Calcula color medio (muestreando vértices/material) y radio proyectado
// de un modelo. Se ejecuta una sola vez por objeto.
function computeFootprint(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y) * 0.5 || 0.8;

  const color = new THREE.Color(0x000000);
  let n = 0;
  root.traverse(o => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        // Ignora el blanco puro por defecto de materiales sin color asignado:
        // una huella blanca deslumbraría sobre el negro.
        if (m.color && !(m.color.r === 1 && m.color.g === 1 && m.color.b === 1)) {
          color.add(m.color); n++;
        }
      }
    }
  });
  if (n > 0) color.multiplyScalar(1 / n);
  else color.setHex(0x9c93b8); // lila de respaldo
  // asegurar que la mancha se lee sobre negro sin quemar
  const hsl = {};
  color.getHSL(hsl);
  color.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + 0.05, 0.15, 0.6));
  return { color, radius };
}
