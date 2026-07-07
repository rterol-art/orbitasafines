// ============================================================
// espacio — Fase 3: relaciones
// El grafo semántico hecho fuerza física. Los objetos se atraen según
// cuánto comparten sus tags CURADOS (no los ampliados), se repelen de base
// para no colapsar, y sincronizan sus fases de respiración/bucle cuando
// están muy relacionados. Las constelaciones emergen; no se colocan.
// ============================================================

import * as THREE from 'three';

// ---------- Afinidad entre dos conjuntos de tags ----------
// Solapamiento ponderado tipo Jaccard asimétrico. Ahora con signo: si A
// tiene tags que B declara en su lista de exclusión (avoid), o viceversa,
// la afinidad puede ser NEGATIVA → repulsión y vibración de pinchos.
export function affinity(tagsA, tagsB, avoidA = [], avoidB = []) {
  if (!tagsA?.length || !tagsB?.length) return 0;
  const setB = new Set(tagsB);
  let shared = 0;
  for (const t of tagsA) if (setB.has(t)) shared++;
  const pos = shared > 0 ? shared / Math.min(tagsA.length, tagsB.length) : 0;

  // exclusión: cuántos tags del otro están en mi lista de avoid
  let conflict = 0;
  if (avoidA.length) { const s = new Set(avoidA); for (const t of tagsB) if (s.has(t)) conflict++; }
  if (avoidB.length) { const s = new Set(avoidB); for (const t of tagsA) if (s.has(t)) conflict++; }
  const neg = conflict > 0 ? conflict / Math.min(tagsA.length, tagsB.length) : 0;

  return pos - neg; // -1..1
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
        avoid: (o.meta.avoid ?? []),
        anchor,                       // referencia viva al anchor del bucle
        home: anchor.clone(),         // posición de reposo original
        vel: new THREE.Vector3(),
        controller: o.controller,
        // uniform de proximidad del shader de vibración (si el objeto lo tiene)
        prox: o.controller?.proximity ?? null,
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
        this.aff[i][j] = i === j ? 0 : affinity(
          this.nodes[i].tags, this.nodes[j].tags,
          this.nodes[i].avoid, this.nodes[j].avoid
        );
      }
    }

    this._f = new THREE.Vector3();
    this._d = new THREE.Vector3();
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
    this._syncPhases(h);
  }

  // Para cada nodo con shader de proximidad, encuentra el vecino con mayor
  // |afinidad| dentro de un radio, y le pasa (cercanía 0..1, afinidad -1..1).
  // La superficie ondula (afín) o forma pinchos (rechazo) según se acerquen.
  _updateProximity() {
    const radius = this.proxRadius ?? 3.5;
    const n = this.nodes.length;
    for (let i = 0; i < n; i++) {
      const ni = this.nodes[i];
      if (!ni.prox) continue;
      let bestNear = 0, bestAff = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const a = this.aff[i][j];
        if (a === 0) continue;
        const dist = ni.root.position.distanceTo(this.nodes[j].root.position);
        if (dist > radius) continue;
        const near = 1 - dist / radius;           // 0 lejos, 1 pegado
        const weight = near * Math.abs(a);
        if (weight > bestNear * Math.abs(bestAff) || bestNear === 0) {
          bestNear = near; bestAff = a;
        }
      }
      ni.prox.set(bestNear, bestAff);
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
