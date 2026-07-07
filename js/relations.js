// ============================================================
// espacio — Fase 3: relaciones
// El grafo semántico hecho fuerza física. Los objetos se atraen según
// cuánto comparten sus tags CURADOS (no los ampliados), se repelen de base
// para no colapsar, y sincronizan sus fases de respiración/bucle cuando
// están muy relacionados. Las constelaciones emergen; no se colocan.
// ============================================================

import * as THREE from 'three';

// ---------- Afinidad entre dos objetos ----------
// Los TAGS principales pesan fuerte; los EXPAND (sinónimos) pesan poco —
// dan relación ligera sin colapsar el grafo. Con signo: los tags en la
// lista `avoid` del otro restan (afinidad negativa → repulsión y pinchos).
const EXPAND_WEIGHT = 0.25; // un match de sinónimo vale 1/4 de un tag principal

export function affinity(a, b) {
  const tagsA = a.tags ?? [], tagsB = b.tags ?? [];
  if (!tagsA.length || !tagsB.length) return 0;
  const setB = new Set(tagsB);
  let shared = 0;
  for (const t of tagsA) if (setB.has(t)) shared++;

  // matches de expand (sinónimos), peso reducido
  const expA = a.expand ?? [], expB = b.expand ?? [];
  let softShared = 0;
  if (expA.length || expB.length) {
    const allB = new Set([...tagsB, ...expB]);
    const allA = new Set([...tagsA, ...expA]);
    for (const t of expA) if (allB.has(t)) softShared++;
    for (const t of tagsA) if (expB.includes(t)) softShared++;
  }
  const pos = (shared + softShared * EXPAND_WEIGHT) / Math.min(tagsA.length, tagsB.length);

  // exclusión
  const avoidA = a.avoid ?? [], avoidB = b.avoid ?? [];
  let conflict = 0;
  if (avoidA.length) { const s = new Set(avoidA); for (const t of tagsB) if (s.has(t)) conflict++; }
  if (avoidB.length) { const s = new Set(avoidB); for (const t of tagsA) if (s.has(t)) conflict++; }
  const neg = conflict > 0 ? conflict / Math.min(tagsA.length, tagsB.length) : 0;

  return Math.max(-1, Math.min(1, pos - neg));
}

// ============================================================
// Campo de fuerzas relacional
// ============================================================
export class RelationField {
  constructor(objects, opts = {}) {
    // Solo participan objetos con tags. La fuerza relacional mueve el ANCLA
    // sobre la que orbita el bucle de cada objeto (no su posición final, que
    // el controller reescribe cada frame). Así atracción/repulsión y bucle
    // se componen sin pelearse: el objeto sigue su bucle alrededor de un
    // centro que deriva según sus afinidades.
    this.nodes = objects.map(o => {
      const anchor = o.controller?.base?.anchor ?? o.root.position;
      return {
        root: o.root,
        tags: (o.meta.tags ?? []),
        expand: (o.meta.expand ?? []),
        avoid: (o.meta.avoid ?? []),
        anchor,
        home: anchor.clone(),
        vel: new THREE.Vector3(),
        controller: o.controller,
        prox: o.controller?.proximity ?? null,
        totalRel: 0,   // suma de afinidades positivas con el resto (se calcula abajo)
      };
    });

    this.attract = opts.attract ?? 0.6;      // fuerza de atracción por afinidad
    this.repel = opts.repel ?? 0.5;          // repulsión base universal
    this.homePull = opts.homePull ?? 0.15;   // regreso al hogar (evita fuga)
    this.damping = opts.damping ?? 0.9;       // fricción
    this.minDist = opts.minDist ?? 1.2;       // distancia bajo la cual repele fuerte
    this.maxForce = opts.maxForce ?? 0.5;
    this.syncStrength = opts.syncStrength ?? 0.4; // Kuramoto

    // Precomputar matriz de afinidad (estática: los tags no cambian)
    const n = this.nodes.length;
    this.aff = [];
    for (let i = 0; i < n; i++) {
      this.aff[i] = [];
      for (let j = 0; j < n; j++) {
        this.aff[i][j] = i === j ? 0 : affinity(this.nodes[i], this.nodes[j]);
      }
    }

    // Relación total de cada nodo: suma de afinidades positivas. Modula el
    // tempo (más relación → más lento) y la escala (más relación → más grande).
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) if (this.aff[i][j] > 0) sum += this.aff[i][j];
      this.nodes[i].totalRel = sum;
    }
    this._applyRelationModulation();

    this._f = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._pt = new THREE.Vector3();
    this._colliding = new Set();
  }

  // Devuelve las parejas con afinidad > umbral, para las líneas de conexión.
  relatedPairs(threshold = 0.15) {
    const pairs = [];
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        if (this.aff[i][j] > threshold) {
          pairs.push({ a: this.nodes[i].root, b: this.nodes[j].root, w: this.aff[i][j] });
        }
      }
    }
    return pairs;
  }

  update(dt) {
    const n = this.nodes.length;
    const h = Math.min(dt, 1 / 30);

    for (let i = 0; i < n; i++) {
      const ni = this.nodes[i];
      this._f.set(0, 0, 0);

      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const nj = this.nodes[j];
        // Distancia entre ANCLAS (centros de órbita), no posiciones instantáneas
        this._d.subVectors(ni.anchor, nj.anchor);
        let dist = this._d.length();
        if (dist < 1e-3) {
          this._d.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
          dist = this._d.length();
        }
        this._d.divideScalar(dist);

        const rep = this.repel / Math.max(dist * dist, this.minDist * this.minDist);
        this._f.addScaledVector(this._d, rep);

        const a = this.aff[i][j];
        if (a > 0) {
          const att = this.attract * a * Math.min(dist, 4) * 0.15;
          this._f.addScaledVector(this._d, -att);
        }
      }

      // Resorte suave de regreso al hogar (evita fuga del encuadre)
      this._d.subVectors(ni.home, ni.anchor);
      this._f.addScaledVector(this._d, this.homePull);

      if (this._f.length() > this.maxForce) this._f.setLength(this.maxForce);
      ni.vel.addScaledVector(this._f, h);
      ni.vel.multiplyScalar(this.damping);
    }

    // Integrar sobre el ANCLA. El bucle (que corre en el controller) orbitará
    // alrededor de este centro que ahora deriva por afinidad semántica.
    for (const ni of this.nodes) {
      ni.anchor.addScaledVector(ni.vel, h);
    }

    this._updateProximity();
    this._detectCollisions();
    this._syncPhases(h);
  }

  // Choques entre objetos: cuando dos se acercan por debajo de la distancia
  // mínima, ambos suben el jitter (temblor del impacto) y su bucle pierde un
  // poco de mutación (cada choque los "asienta" ligeramente). Cooldown para
  // no disparar cada frame mientras siguen solapados.
  _detectCollisions() {
    const minD = this.collideDist ?? 1.0;
    const n = this.nodes.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = this.nodes[i].root.position.distanceTo(this.nodes[j].root.position);
        const key = i * 1000 + j;
        if (d < minD) {
          if (!this._colliding.has(key)) {
            this._colliding.add(key);
            for (const nd of [this.nodes[i], this.nodes[j]]) {
              nd.controller?.jitter?.collide(0.03);
              // reducir mutación un 3% por choque (mínimo 0)
              if (nd.controller?.base) {
                nd.controller.base.mutation = Math.max(0, nd.controller.base.mutation * 0.97);
              }
            }
          }
        } else if (d > minD * 1.4) {
          this._colliding.delete(key); // histéresis: rearmar al separarse
        }
      }
    }
  }

  // Modula tempo y escala según cuánta relación tiene cada objeto:
  //  - más relación → bucle más LENTO (gravita, se asienta).
  //  - más relación → escala algo mayor (presencia por conexión).
  // Se aplica una vez; la escala base aleatoria ya vive en el objeto.
  _applyRelationModulation() {
    // normalizar totalRel a 0..1 sobre el máximo de la escena
    let maxRel = 0;
    for (const nd of this.nodes) maxRel = Math.max(maxRel, nd.totalRel);
    if (maxRel <= 0) return;
    for (const nd of this.nodes) {
      const r = nd.totalRel / maxRel; // 0..1
      const ctrl = nd.controller;
      if (!ctrl) continue;
      // tempo: hasta 2x más lento con relación máxima
      if (ctrl.base) {
        ctrl.base.w = ctrl.base.w / (1 + r); // w = velocidad angular; menor = más lento
      }
      // escala: hasta +30% sobre la base aleatoria, acotado
      const factor = 1 + r * 0.3;
      nd.root.scale.multiplyScalar(factor);
      nd.baseScale = nd.root.scale.x;
    }
  }
  // |afinidad| dentro de un radio, y le pasa (cercanía 0..1, afinidad -1..1).
  // La superficie ondula (afín) o forma pinchos (rechazo) según se acerquen.
  _updateProximity() {
    const radius = this.proxRadius ?? 3.5;
    const n = this.nodes.length;
    for (let i = 0; i < n; i++) {
      const ni = this.nodes[i];
      if (!ni.prox) continue;
      let bestNear = 0, bestAff = 0, bestJ = -1;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const a = this.aff[i][j];
        if (a === 0) continue;
        const dist = ni.root.position.distanceTo(this.nodes[j].root.position);
        if (dist > radius) continue;
        const near = 1 - dist / radius;
        const weight = near * Math.abs(a);
        if (weight > bestNear * Math.abs(bestAff) || bestNear === 0) {
          bestNear = near; bestAff = a; bestJ = j;
        }
      }
      // dirección al vecino, en el espacio LOCAL del objeto (para el shader)
      if (bestJ >= 0) {
        this._d.subVectors(this.nodes[bestJ].root.position, ni.root.position);
        ni.root.worldToLocal(this._pt.copy(this.nodes[bestJ].root.position));
        ni.prox.set(bestNear, bestAff, this._pt.normalize());
      } else {
        ni.prox.set(0, 0, null);
      }
    }
  }

  // Empuja las fases de respiración de objetos relacionados a acercarse.
  // Modelo Kuramoto simplificado: dφ_i = K * Σ aff_ij * sin(φ_j - φ_i)
  _syncPhases(h) {
    const n = this.nodes.length;
    for (let i = 0; i < n; i++) {
      const ri = this.nodes[i].controller?.resp;
      if (!ri) continue;
      let push = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const rj = this.nodes[j].controller?.resp;
        if (!rj) continue;
        const a = this.aff[i][j];
        if (a > 0) push += a * Math.sin(rj.phase - ri.phase);
      }
      ri.phase += this.syncStrength * push * h;
    }
  }
}
