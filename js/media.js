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
    // Renderizamos a ALTA resolución (supersampling) para que el texto quede
    // nítido sobre negro. dpr real x2 de refuerzo → sin difuminado.
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * 2;
    const measure = document.createElement('canvas').getContext('2d');
    const fontOf = (w) => `${w} ${fontSize}px ${family}`;
    measure.font = fontOf(weight);

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
        ctx.fillStyle = isBold ? '#ffffff' : color;
        ctx.fillText(word + ' ', x, y);
        x += ctx.measureText(word + ' ').width;
      }
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.minFilter = THREE.LinearMipmapLinearFilter; // nitidez con mipmaps
    tex.generateMipmaps = true;
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
  // El texto mantiene su opacidad SIEMPRE (antes bajaba por falta de relación
  // y quedaba invisible). La relación con el entorno se expresa solo en las
  // palabras que se ponen en negrita, no atenuando el bloque entero.
  return group;
}

// Orienta un grupo a la cámara. El texto debe permanecer LEGIBLE de frente:
// la "duda" es una deriva mínima de posición y una inclinación casi
// imperceptible, nunca un giro que cizalle el texto. Vibra en torno al texto
// nítido, no lo rompe.
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
export function updateBillboard(group, camera, t, seed) {
  // Mirar a cámara, plano y quieto. Cualquier inclinación añade shimmer que
  // dificulta la lectura; el texto debe estar perfectamente frontal. La
  // "vida" del texto es su lenta deriva de posición (bucle), no rotación.
  group.quaternion.copy(camera.quaternion);
}

// ============================================================
// CONEXIONES — puntos viajeros (sin texto flotante)
// En vez de líneas dibujadas, pequeños puntos que de vez en cuando viajan en
// línea recta de un objeto a otro relacionado. Una señal que se transmite,
// no un vínculo permanente. Discretos, ocasionales.
// ============================================================
export class ConnectionLines {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.max = opts.max ?? 10;                 // puntos simultáneos como máximo
    this.color = new THREE.Color(opts.color ?? 0xb9aee0);
    this.speed = opts.speed ?? 3.2;            // unidades/seg del viaje
    this.spawnEvery = opts.spawnEvery ?? 0.9;  // s entre intentos de emisión
    this.spawnChance = opts.spawnChance ?? 0.5;
    this.dotSize = opts.dotSize ?? 0.06;
    this.trailDots = opts.trailDots ?? 3;      // pequeña cola de puntos detrás

    // pool de puntos viajeros; cada uno es un sprite pequeño
    this.tex = makeDotTexture(this.color);
    this.travelers = [];
    for (let i = 0; i < this.max; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.tex, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      sprite.scale.setScalar(this.dotSize);
      sprite.visible = false;
      scene.add(sprite);
      // cola: puntitos más pequeños y tenues que siguen al principal
      const tail = [];
      for (let k = 0; k < this.trailDots; k++) {
        const ts = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.tex, transparent: true, opacity: 0,
          depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        ts.scale.setScalar(this.dotSize * (0.7 - k * 0.15));
        ts.visible = false;
        scene.add(ts);
        tail.push(ts);
      }
      this.travelers.push({ sprite, tail, a: null, b: null, t: 0, dur: 0, history: [] });
    }
    this._acc = 0;
    this.pairs = null;
  }

  update(dt, objects) {
    for (const tr of this.travelers) {
      if (!tr.a) continue;
      if (!tr.a.parent || !tr.b.parent) { this._retire(tr); continue; }
      tr.t += dt / tr.dur;
      if (tr.t >= 1) { this._retire(tr); continue; }

      tr.a.getWorldPosition(_tmpA);
      tr.b.getWorldPosition(_tmpB);
      _tmpC.lerpVectors(_tmpA, _tmpB, tr.t);
      tr.sprite.position.copy(_tmpC);
      const fade = Math.sin(tr.t * Math.PI);
      tr.sprite.material.opacity = fade * 0.9;

      tr.history.unshift(_tmpC.clone());
      if (tr.history.length > tr.tail.length) tr.history.pop();
      tr.tail.forEach((ts, k) => {
        const h = tr.history[k];
        if (h) { ts.position.copy(h); ts.material.opacity = fade * 0.5 * (1 - k / tr.tail.length); ts.visible = true; }
      });
    }

    this._acc += dt;
    if (this._acc > this.spawnEvery && objects.length >= 2) {
      this._acc = 0;
      if (Math.random() < this.spawnChance) this._emit();
    }
  }

  _emit() {
    if (!this.pairs || !this.pairs.length) return;
    const tr = this.travelers.find(t => !t.a);
    if (!tr) return;
    let total = 0;
    for (const p of this.pairs) total += p.w;
    let r = Math.random() * total;
    let chosen = this.pairs[0];
    for (const p of this.pairs) { r -= p.w; if (r <= 0) { chosen = p; break; } }
    if (!chosen.a.parent || !chosen.b.parent) return;
    if (Math.random() < 0.5) { tr.a = chosen.a; tr.b = chosen.b; }
    else { tr.a = chosen.b; tr.b = chosen.a; }
    tr.a.getWorldPosition(_tmpA);
    tr.b.getWorldPosition(_tmpB);
    tr.dur = Math.max(0.3, _tmpA.distanceTo(_tmpB) / this.speed);
    tr.t = 0;
    tr.history = [];
    tr.sprite.visible = true;
  }

  _retire(tr) {
    tr.a = tr.b = null;
    tr.sprite.visible = false;
    tr.sprite.material.opacity = 0;
    tr.tail.forEach(ts => { ts.visible = false; ts.material.opacity = 0; });
    tr.history = [];
  }

  setPairs(pairs) { this.pairs = pairs; }

  reset() {
    for (const tr of this.travelers) {
      this._retire(tr);
    }
    this.pairs = null;
  }
}
const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();

// Textura de punto suave (disco con halo) para los viajeros.
function makeDotTexture(color) {
  const s = 32;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  const hex = '#' + color.getHexString();
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, hex);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ============================================================
// ESTELA — feedback suave de posición
// ============================================================
// Deja copias efímeras y desvanecientes de cada elemento a su paso.
// "Ligerito": pocas muestras, baja opacidad, vida corta.
export class Trails {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.every = opts.every ?? 0.14;      // s entre muestras (algo más denso)
    this.life = opts.life ?? 1.9;         // vida de cada eco (más larga → estela más visible)
    this.maxOpacity = opts.maxOpacity ?? 0.16;
    this.printOpacity = opts.printOpacity ?? 0.20; // huella de 3D más presente
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
    echo.scale.setScalar(r * 2.4); // algo mayor que la silueta → estela más legible
    if (camera) echo.quaternion.copy(camera.quaternion);
    this.scene.add(echo);
    this.samples.push({ mesh: echo, age: 0, base: op, billboard: true });
  }

  // Eliminar todos los ecos vivos (al reconstruir la escena).
  clear() {
    for (const s of this.samples) {
      this.scene.remove(s.mesh);
      s.mesh.material.dispose();
    }
    this.samples.length = 0;
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
