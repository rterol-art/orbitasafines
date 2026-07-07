// ============================================================
// espacio — Fase 2: comportamientos
// Composición: base (trayectoria) × tiempo (playback) × capas
// (cuerpo: jitter, respiración) × malla (desgarro, costura).
// Todo declarativo desde el JSON de cada objeto.
// ============================================================

import * as THREE from 'three';

// ---------- Ruido determinista barato ----------
// Suficiente para movimiento; no necesitamos simplex de verdad.
function hash(n) {
  const s = Math.sin(n) * 43758.5453123;
  return s - Math.floor(s);
}
function noise1(t, seed = 0) {
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash(i + seed) * (1 - u) + hash(i + 1 + seed) * u; // 0..1
}
function snoise(t, seed = 0) { return noise1(t, seed) * 2 - 1; } // -1..1

function rand(rng, min, max) { return min + rng() * (max - min); }
function pick(v, rng) { return Array.isArray(v) ? rand(rng, v[0], v[1]) : v; }

// Generador con semilla por objeto: mismo json → mismo carácter.
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ============================================================
// TIEMPO — playback degradado
// Deforma el tiempo local del objeto: congela y, al soltar,
// salta de golpe a donde "debería" estar. Error de reproducción.
// ============================================================
class Playback {
  constructor(cfg, rng) {
    this.rng = rng;
    this.freezePerMin = cfg.freezesPerMinute ?? 4;   // frecuencia media
    this.freezeMs = cfg.freezeMs ?? [200, 800];       // duración de la congelación
    this.rewindChance = cfg.rewindChance ?? 0.25;     // a veces, en vez de saltar, retrocede
    this.frozen = 0;      // ms restantes de congelación
    this.debt = 0;        // tiempo acumulado durante el freeze
    this.jump = 0;        // salto a aplicar este frame
  }
  // Devuelve el dt efectivo para el tiempo local del objeto.
  warp(dt) {
    this.jump = 0;
    if (this.frozen > 0) {
      this.frozen -= dt * 1000;
      this.debt += dt;
      if (this.frozen <= 0) {
        // Al descongelar: salto (catch-up) o rebobinado parcial.
        this.jump = this.rng() < this.rewindChance ? -this.debt * 0.6 : this.debt;
        this.debt = 0;
      }
      return 0; // congelado: el tiempo local no avanza
    }
    if (this.rng() < (this.freezePerMin / 60) * dt) {
      this.frozen = rand(this.rng, this.freezeMs[0], this.freezeMs[1]);
    }
    return dt;
  }
}

// ============================================================
// BASE — bucle imperfecto
// Trayectoria cerrada por armónicos (Lissajous 3D). Cada vuelta,
// las fases y amplitudes mutan ligeramente: el bucle nunca se
// repite exactamente. El recuerdo que se reproduce distinto.
// ============================================================
class BucleImperfecto {
  constructor(cfg, rng, anchor) {
    this.anchor = anchor.clone();
    this.rng = rng;
    this.period = pick(cfg.period ?? [30, 60], rng);   // segundos por vuelta
    this.radius = pick(cfg.radius ?? [0.8, 2.0], rng); // tamaño del bucle
    this.mutation = cfg.mutation ?? 0.08;               // cuánto muta por vuelta (0 = bucle perfecto)
    this.w = (Math.PI * 2) / this.period;
    // Dos armónicos por eje, ratios enteros → curva cerrada
    this.h = [];
    for (let axis = 0; axis < 3; axis++) {
      this.h.push({
        a1: rand(rng, 0.5, 1.0), m1: 1 + Math.floor(rng() * 2),   // 1x ó 2x
        a2: rand(rng, 0.1, 0.4), m2: 2 + Math.floor(rng() * 2),   // 2x ó 3x
        p1: rng() * Math.PI * 2, p2: rng() * Math.PI * 2,
      });
    }
    this.h[1].a1 *= 0.5; // menos recorrido vertical: campo, no enjambre
    this.lap = 0;
  }
  pose(t, outPos) {
    const lap = Math.floor((t * this.w) / (Math.PI * 2));
    if (lap !== this.lap) {
      this.lap = lap;
      for (const h of this.h) { // mutación por vuelta: ruido acumulativo
        h.p1 += (this.rng() - 0.5) * this.mutation * Math.PI;
        h.p2 += (this.rng() - 0.5) * this.mutation * Math.PI;
        h.a1 = THREE.MathUtils.clamp(h.a1 + (this.rng() - 0.5) * this.mutation, 0.3, 1.2);
      }
    }
    const wt = t * this.w;
    outPos.set(
      this.h[0].a1 * Math.sin(wt * this.h[0].m1 + this.h[0].p1) + this.h[0].a2 * Math.sin(wt * this.h[0].m2 + this.h[0].p2),
      this.h[1].a1 * Math.sin(wt * this.h[1].m1 + this.h[1].p1) + this.h[1].a2 * Math.sin(wt * this.h[1].m2 + this.h[1].p2),
      this.h[2].a1 * Math.sin(wt * this.h[2].m1 + this.h[2].p1) + this.h[2].a2 * Math.sin(wt * this.h[2].m2 + this.h[2].p2)
    ).multiplyScalar(this.radius).add(this.anchor);
  }
}

// ============================================================
// CAPA — jitter de tracking
// Microtemblor de alta frecuencia y amplitud mínima.
// La cámara que perdió las referencias, perpetuada.
// ============================================================
class Jitter {
  constructor(cfg, rng) {
    this.baseAmp = pick(cfg.amplitude ?? 0.008, rng);
    this.amp = this.baseAmp;
    this.freq = pick(cfg.frequency ?? 14, rng);
    this.seed = rng() * 100;
    this.gate = cfg.intermittent ?? true;
    this.boost = 0;          // amplitud extra por colisión, decae sola
  }
  // Llamado al chocar: sube la amplitud a `target` y luego decae.
  collide(target = 0.03) { this.boost = Math.max(this.boost, target - this.baseAmp); }
  apply(t, pos, dt = 0.016) {
    // decaer el boost de colisión
    if (this.boost > 0) this.boost = Math.max(0, this.boost - dt * 0.04);
    this.amp = this.baseAmp + this.boost;
    let g = 1;
    if (this.gate && this.boost <= 0.0001) { // durante el choque, jitter continuo
      g = THREE.MathUtils.smoothstep(noise1(t * 0.15, this.seed + 50), 0.45, 0.7);
      if (g <= 0) return;
    }
    pos.x += snoise(t * this.freq, this.seed) * this.amp * g;
    pos.y += snoise(t * this.freq, this.seed + 7) * this.amp * g;
    pos.z += snoise(t * this.freq, this.seed + 13) * this.amp * g;
  }
}

// ============================================================
// CAPA — respiración residual (arrítmica)
// Oscilación de escala mínima cuya fase avanza a velocidad
// irregular, con apneas. Lo que queda de un cuerpo.
// NUNCA un seno puro: la arritmia es lo que la salva del cliché.
// ============================================================
// ============================================================
// CAPA — respiración residual (hinchamiento localizado por shader)
// Rediseñada: en vez de escalar todo el objeto (que se leía como un bulto
// hinchándose sin sentido), unas ZONAS del modelo se hinchan y deshinchan
// lentamente, y donde más se estiran la textura CEDE y asoma la malla —
// como un registro que da de sí y empieza a perderse por tensión.
// El hinchamiento es el momento en que la superficie revela su estructura.
// ============================================================
class Respiracion {
  constructor(cfg, rng, meshes, timeUniform) {
    this.amount = pick(cfg.amount ?? 0.06, rng);    // desplazamiento máx de la zona
    this.baseSpeed = (Math.PI * 2) / pick(cfg.period ?? [6, 14], rng);
    this.seed = rng() * 100;
    this.phase = rng() * Math.PI * 2;               // Kuramoto sincroniza esto
    this.zones = cfg.zones ?? 2.5;                  // "frecuencia espacial" de las zonas
    this.reveal = cfg.reveal ?? true;               // ¿asoma la malla al estirarse?
    this.uniforms = {
      uBreath: { value: 0 },        // -1..1, cuánto hinchado ahora mismo
      uBreathAmt: { value: this.amount },
      uBreathZones: { value: this.zones },
      uBreathSeed: { value: this.seed },
    };
    this.wireMeshes = [];
    for (const m of meshes) {
      injectBreath(m.material, this.uniforms);
      if (this.reveal) this._addWireReveal(m);
    }
  }

  // Añade un wireframe que solo aparece donde la zona se hincha.
  _addWireReveal(mesh) {
    const mat = new THREE.MeshBasicMaterial({
      wireframe: true, transparent: true, color: 0xcfc7dd,
      opacity: 0, depthWrite: false,
    });
    injectBreathWire(mat, this.uniforms);
    const wire = new THREE.Mesh(mesh.geometry, mat);
    wire.renderOrder = 1;
    mesh.add(wire);
    this.wireMeshes.push(wire);
  }

  // Llamado cada frame; devuelve 1 (ya no escala el grupo, el shader hace todo)
  scale(t, dt) {
    const mod = noise1(t * 0.1, this.seed);
    const speed = mod < 0.22 ? 0 : this.baseSpeed * (0.5 + mod); // apneas
    this.phase += speed * dt;
    this.uniforms.uBreath.value = Math.sin(this.phase);
    return 1; // el grupo ya no cambia de escala
  }
}

// Shader: desplaza vértices por zonas según uBreath. Las zonas salen de una
// función de ruido sobre la posición local → mismas zonas siempre, se hinchan
// juntas. Along normal, para que el volumen crezca hacia afuera.
function injectBreath(material, uniforms) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uBreath; uniform float uBreathAmt;
        uniform float uBreathZones; uniform float uBreathSeed;
        float breathZone(vec3 p) {
          return 0.5 + 0.5 * sin(p.x * uBreathZones + uBreathSeed)
                     * sin(p.y * uBreathZones * 0.9 + uBreathSeed * 1.3)
                     * sin(p.z * uBreathZones * 1.1 + uBreathSeed * 0.7);
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float bz = breathZone(position);
          float swell = bz * uBreath * uBreathAmt;
          transformed += normalize(objectNormal) * swell;
        }`);
  };
  material.needsUpdate = true;
}

// Wireframe que aparece proporcional a cuánto se estira la zona: donde el
// hinchamiento es mayor, la textura "cede" y se ve la malla.
function injectBreathWire(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uBreath; uniform float uBreathAmt;
        uniform float uBreathZones; uniform float uBreathSeed;
        varying float vStretch;
        float breathZoneW(vec3 p) {
          return 0.5 + 0.5 * sin(p.x * uBreathZones + uBreathSeed)
                     * sin(p.y * uBreathZones * 0.9 + uBreathSeed * 1.3)
                     * sin(p.z * uBreathZones * 1.1 + uBreathSeed * 0.7);
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float bz = breathZoneW(position);
          float swell = bz * uBreath * uBreathAmt;
          transformed += normalize(objectNormal) * swell;
          vStretch = clamp(bz * max(uBreath, 0.0), 0.0, 1.0);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vStretch;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        gl_FragColor.a *= smoothstep(0.35, 0.7, vStretch) * 0.6;`);
  };
  material.needsUpdate = true;
}

// ============================================================
// MALLA — desgarro intermitente (shader, evento raro)
// Desplaza brevemente los vértices de una zona a lo largo de su
// dirección radial. Escaso por diseño: un espasmo aislado es un
// acontecimiento; cinco a la vez son un efecto.
// ============================================================
export class TearScheduler {
  // Límite global: UN objeto desgarrándose a la vez en toda la escena.
  constructor() { this.active = null; }
  request(fx) {
    if (this.active) return false;
    this.active = fx;
    return true;
  }
  release(fx) { if (this.active === fx) this.active = null; }
}

class Desgarro {
  constructor(cfg, rng, meshes, scheduler) {
    this.rng = rng;
    this.scheduler = scheduler;
    this.interval = cfg.interval ?? [30, 120]; // s entre espasmos (media)
    this.duration = pick(cfg.duration ?? 0.7, rng);
    this.strength = pick(cfg.strength ?? 0.22, rng);
    this.next = rand(rng, this.interval[0], this.interval[1]) * rng(); // primer evento adelantado
    this.t = 0; this.playing = -1;
    this.uniforms = {
      uTearAmt: { value: 0 },
      uTearCenter: { value: new THREE.Vector3() },
      uTearRadius: { value: 0.5 },
      uTearSeed: { value: rng() * 100 },
    };
    this.bounds = new THREE.Box3();
    for (const m of meshes) {
      this.bounds.expandByObject(m);
      injectTear(m.material, this.uniforms);
    }
  }
  update(dt) {
    this.t += dt;
    if (this.playing >= 0) {
      this.playing += dt;
      const p = this.playing / this.duration;
      if (p >= 1) {
        this.playing = -1;
        this.uniforms.uTearAmt.value = 0;
        this.scheduler.release(this);
        this.next = this.t + rand(this.rng, this.interval[0], this.interval[1]);
      } else {
        // envolvente: ataque brusco, caída con dos rebotes decrecientes
        const env = Math.pow(1 - p, 1.6) * Math.abs(Math.sin(p * Math.PI * 3));
        this.uniforms.uTearAmt.value = env * this.strength;
      }
      return;
    }
    if (this.t >= this.next && this.scheduler.request(this)) {
      this.playing = 0;
      const c = this.uniforms.uTearCenter.value;
      const b = this.bounds;
      c.set( // zona aleatoria dentro del objeto
        rand(this.rng, b.min.x, b.max.x),
        rand(this.rng, b.min.y, b.max.y),
        rand(this.rng, b.min.z, b.max.z)
      );
      const size = b.getSize(new THREE.Vector3()).length();
      this.uniforms.uTearRadius.value = size * rand(this.rng, 0.12, 0.25);
      this.uniforms.uTearSeed.value = this.rng() * 100;
    }
  }
}

function injectTear(material, uniforms) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTearAmt; uniform vec3 uTearCenter;
        uniform float uTearRadius; uniform float uTearSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float dT = distance(transformed, uTearCenter);
          float wT = 1.0 - smoothstep(0.0, uTearRadius, dT);
          if (wT > 0.0 && uTearAmt > 0.0) {
            vec3 dirT = normalize(transformed - uTearCenter + vec3(1e-4));
            float nT = sin(dot(transformed, vec3(12.9, 78.2, 37.7)) * 4.0 + uTearSeed);
            transformed += dirT * wT * uTearAmt * (0.6 + 0.4 * nT);
          }
        }`);
  };
  material.needsUpdate = true;
}

// ============================================================
// MALLA — deshielo (shader, degradación permanente)
// Reemplaza al desgarro. En vez de un espasmo que actúa de roto, un
// desplazamiento lentísimo y ACUMULATIVO de los vértices a lo largo de su
// normal: el modelo se deshace despacio mientras existe en la escena y
// nunca se recupera. No teatraliza el daño — lo continúa. La copia fallida
// que sigue fallando, el error como proceso en tiempo real.
// ============================================================
class Deshielo {
  constructor(cfg, rng, meshes) {
    this.rate = pick(cfg.rate ?? 0.012, rng);   // avance del deshielo por segundo
    this.max = pick(cfg.max ?? 0.35, rng);      // desplazamiento máximo (se detiene ahí)
    this.turbulence = cfg.turbulence ?? 0.6;    // cuánto varía entre zonas
    this.uniforms = {
      uMelt: { value: 0 },
      uMeltMax: { value: this.max },
      uMeltTurb: { value: this.turbulence },
      uMeltSeed: { value: rng() * 100 },
    };
    for (const m of meshes) injectMelt(m.material, this.uniforms);
  }
  update(dt) {
    // avanza monótono hasta el tope; no baja nunca
    if (this.uniforms.uMelt.value < 1) {
      this.uniforms.uMelt.value = Math.min(1, this.uniforms.uMelt.value + this.rate * dt);
    }
  }
}

function injectMelt(material, uniforms) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uMelt; uniform float uMeltMax;
        uniform float uMeltTurb; uniform float uMeltSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          // desplazamiento por zonas: unas se deshacen más que otras
          float zM = 0.5 + 0.5 * sin(dot(position, vec3(8.3, 5.1, 6.7)) + uMeltSeed);
          float amtM = uMelt * uMeltMax * mix(1.0 - uMeltTurb, 1.0, zM);
          transformed += normalize(objectNormal) * amtM;
        }`);
  };
  material.needsUpdate = true;
}


// La estructura interna asoma y desaparece por regiones que
// derivan lentamente. El interior como territorio.
// ============================================================
class Costura {
  constructor(cfg, rng, meshes, timeUniform) {
    this.wires = [];
    const coverage = pick(cfg.coverage ?? 0.22, rng); // fracción de malla visible
    const speed = pick(cfg.speed ?? 0.06, rng);       // deriva de las zonas
    const color = new THREE.Color(cfg.color ?? 0xcfc7dd);
    for (const m of meshes) {
      const mat = new THREE.MeshBasicMaterial({
        wireframe: true, transparent: true, color,
        opacity: cfg.opacity ?? 0.5,
        depthWrite: false,
      });
      injectCostura(mat, timeUniform, coverage, speed, rng() * 100);
      const wire = new THREE.Mesh(m.geometry, mat);
      wire.renderOrder = 1;
      m.add(wire); // hereda la transformación del mesh, misma geometría local
      this.wires.push(wire);
    }
  }
}

function injectCostura(material, timeUniform, coverage, speed, seed) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPosC;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPosC = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vPosC; uniform float uTime;
        float nzC(vec3 p) {
          return 0.5 + 0.5 * sin(p.x * 3.1 + ${seed.toFixed(1)})
                     * sin(p.y * 2.7 + uTime * ${speed.toFixed(3)} * 6.0)
                     * sin(p.z * 3.7 - uTime * ${speed.toFixed(3)} * 4.0);
        }`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          float zone = nzC(vPosC * 2.0);
          float th = ${(1 - coverage).toFixed(2)};
          gl_FragColor.a *= smoothstep(th, th + 0.12, zone);
        }`);
  };
  material.needsUpdate = true;
}

// ============================================================
// MALLA — vibración por proximidad (shader, dirigida por relaciones)
// Cuando otro objeto se acerca, la superficie reacciona según la afinidad:
//  - afinidad ALTA → ondulación suave, como olas (reconocimiento).
//  - afinidad NEGATIVA → vibración violenta con pinchos (rechazo).
// El RelationField escribe uProxNear y uProxAffinity cada frame.
// ============================================================
class Proximity {
  constructor(cfg, rng, meshes) {
    this.uniforms = {
      uProxTime: { value: 0 },
      uProxNear: { value: 0 },       // 0..1 cuán cerca está el vecino relevante
      uProxAffinity: { value: 0 },   // -1..1 afinidad con ese vecino
      uProxDir: { value: new THREE.Vector3(0, 0, 1) }, // dir al vecino (espacio local)
      uProxWave: { value: pick(cfg.wave ?? 0.04, rng) },
      uProxSpike: { value: pick(cfg.spike ?? 0.12, rng) },
      uProxSeed: { value: rng() * 100 },
    };
    for (const m of meshes) injectProximity(m.material, this.uniforms);
  }
  update(dt) { this.uniforms.uProxTime.value += dt; }
  set(near, affinity, dirLocal) {
    this.uniforms.uProxNear.value = near;
    this.uniforms.uProxAffinity.value = affinity;
    if (dirLocal) this.uniforms.uProxDir.value.copy(dirLocal);
  }
}

function injectProximity(material, uniforms) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uProxTime; uniform float uProxNear; uniform float uProxAffinity;
        uniform vec3 uProxDir; uniform float uProxWave; uniform float uProxSpike; uniform float uProxSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float near = uProxNear;
          if (near > 0.001) {
            // sólo afecta a las caras orientadas hacia el vecino: producto
            // escalar normal·dirección, con un poco de ruido para que el
            // borde de la zona afectada no sea limpio.
            float facing = dot(normalize(objectNormal), normalize(uProxDir));
            float noise = 0.15 * sin(dot(position, vec3(17.1, 9.3, 13.7)) + uProxSeed);
            float zone = smoothstep(0.1, 0.9, facing + noise);
            if (zone > 0.0) {
              if (uProxAffinity >= 0.0) {
                float w = sin(position.y * 6.0 + uProxTime * 3.0 + uProxSeed)
                        * sin(position.x * 4.0 - uProxTime * 2.0);
                transformed += normalize(objectNormal) * w * uProxWave * near * uProxAffinity * zone;
              } else {
                float s = sin(dot(position, vec3(23.1, 31.7, 19.3)) + uProxTime * 18.0 + uProxSeed);
                s = pow(abs(s), 6.0) * sign(s);
                transformed += normalize(objectNormal) * s * uProxSpike * near * (-uProxAffinity) * zone;
              }
            }
          }
        }`);
  };
  material.needsUpdate = true;
}

// ============================================================
// CONTROLADOR — compone todo por objeto
// ============================================================
export class MovementController {
  constructor(root, movement, opts) {
    const cfg = normalizeConfig(movement);
    const rng = makeRng(opts.seed ?? 1);
    this.root = root;
    this.localT = rand(rng, 0, 100); // desfase inicial: nadie empieza en fase

    this.playback = cfg.time?.type === 'playback' ? new Playback(cfg.time, rng) : null;
    this.base = cfg.base?.type === 'bucle'
      ? new BucleImperfecto(cfg.base, rng, root.position) : null;

    // Recoger meshes antes: la respiración (ahora por shader) los necesita
    const meshes = [];
    root.traverse(o => { if (o.isMesh) meshes.push(o); });

    this.jitter = null; this.resp = null;
    for (const layer of cfg.layers ?? []) {
      if (layer.type === 'jitter') this.jitter = new Jitter(layer, rng);
      if (layer.type === 'respiracion') {
        this.resp = new Respiracion(layer, rng, meshes, opts.timeUniform);
      }
    }

    this.meshFx = [];
    this.proximity = null;
    if (meshes.length) {
      for (const fx of cfg.mesh ?? []) {
        if (fx.type === 'desgarro') this.meshFx.push(new Desgarro(fx, rng, meshes, opts.tearScheduler));
        if (fx.type === 'deshielo') this.meshFx.push(new Deshielo(fx, rng, meshes));
        if (fx.type === 'costura') new Costura(fx, rng, meshes, opts.timeUniform);
      }
      // Vibración por proximidad: activa por defecto en modelos (la dirige
      // el RelationField). Se desactiva con "proximity": false en el JSON.
      const pcfg = cfg.proximity;
      if (pcfg !== false) {
        this.proximity = new Proximity(typeof pcfg === 'object' ? pcfg : {}, rng, meshes);
        this.meshFx.push(this.proximity);
      }
    }

    // rotación de reposo residual, muy lenta
    this.spin = rand(rng, -0.04, 0.04);
    this._pos = new THREE.Vector3();
  }

  update(dt, elapsed) {
    let localDt = dt;
    if (this.playback) {
      localDt = this.playback.warp(dt);
      this.localT += this.playback.jump; // snap de recolocación temporal
    }
    this.localT += localDt;

    if (this.base) {
      this.base.pose(this.localT, this._pos);
      this.root.position.copy(this._pos);
    }
    if (this.jitter) this.jitter.apply(elapsed, this.root.position, dt);
    if (this.resp) this.resp.scale(elapsed, dt); // hincha por shader, no escala el grupo

    this.root.rotation.y += this.spin * localDt;
    for (const fx of this.meshFx) fx.update(dt); // el desgarro ocurre en tiempo real, no local
  }
}

// Compatibilidad con el formato antiguo {type:"drift"} y valores por defecto.
function normalizeConfig(movement) {
  if (!movement || movement.type) {
    return {
      base: { type: 'bucle' },
      time: { type: 'playback' },
      layers: [{ type: 'jitter' }, { type: 'respiracion' }],
      mesh: [],
    };
  }
  return movement;
}
