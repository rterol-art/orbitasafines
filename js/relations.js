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
// dan relación ligera sin colapsar el grafo. Sin negatividad: todos los
// objetos son democráticamente iguales, no hay rechazo declarado.
// La distancia semántica ya modula la lectura (más lejos = más borroso);
// no hace falta un mecanismo aparte de "enemistad".
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
    for (const t of expA) if (allB.has(t)) softShared++;
    for (const t of tagsA) if (expB.includes(t)) softShared++;
  }
  return Math.min(1, (shared + softShared * EXPAND_WEIGHT) / Math.min(tagsA.length, tagsB.length));
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
        anchor,
        home: anchor.clone(),
        vel: new THREE.Vector3(),
        controller: o.controller,
        prox: o.controller?.proximity ?? null,
        totalRel: 0,
        // Relevancia respecto a la invocación actual (0..1). Sin invocación,
        // todos a 1 (democracia total). Con invocación, el central=1 y el resto
        // decae continuamente según su afinidad semántica con lo invocado.
        // Es la lectura visual del objeto: 1=nítido, 0=fantasmal.
        relevance: 1,
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
    this._assignOrbits(opts.orbitThreshold ?? 0.5);

    this._f = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._pt = new THREE.Vector3();
    this._colliding = new Set();

    // Sistema de invocación. Al invocar (search o azar) un objeto se vuelve
    // "central" y todos los demás reciben una relevancia (0..1) según su
    // afinidad semántica con lo invocado. La escena no filtra: todo sigue,
    // pero la relevancia modula posición, estela y demás efectos —lo lejano
    // se lee como fantasmal, lo cercano como nítido.
    this.central = null;            // nodo central invocado
    this.searchedTag = null;        // tag específicamente buscado (pesa más)
    this.invokePull = opts.invokePull ?? 0.6;   // atrae al central a los relevantes
    this.backgroundRadius = opts.backgroundRadius ?? 8; // radio del fondo lejano
    // matriz de co-ocurrencia de tags: cooc[T1][T2] = con qué frecuencia
    // co-aparecen en el mismo objeto del catálogo. Permite que un tag
    // "invoque" a otros semánticamente cercanos aunque no sean idénticos.
    this._buildCooccurrence();
  }

  // Construye la matriz de co-ocurrencia de tags a partir de los propios objetos
  // de la escena. Cuanto más co-aparecen dos tags en distintos objetos, más
  // "cerca" están semánticamente. Es lo que permite que la relevancia se
  // propague continuamente por el grafo conceptual sin escalones discretos.
  _buildCooccurrence() {
    const counts = new Map();      // Map<tag, Map<tag, count>>
    const totals = new Map();      // Map<tag, count>
    for (const n of this.nodes) {
      const T = n.tags;
      for (const t of T) totals.set(t, (totals.get(t) || 0) + 1);
      for (let i = 0; i < T.length; i++) {
        for (let j = 0; j < T.length; j++) {
          if (i === j) continue;
          if (!counts.has(T[i])) counts.set(T[i], new Map());
          counts.get(T[i]).set(T[j], (counts.get(T[i]).get(T[j]) || 0) + 1);
        }
      }
    }
    // Normalizar: cooc(A,B) = count(A,B) / count(A). Da la probabilidad de
    // que B aparezca dado A. Asimétrico a propósito.
    this.cooc = new Map();
    for (const [a, m] of counts) {
      const denom = totals.get(a) || 1;
      const norm = new Map();
      for (const [b, c] of m) norm.set(b, c / denom);
      this.cooc.set(a, norm);
    }
  }

  // Invocar un objeto como central. searchedTag es opcional: si viene, ese
  // tag pesa más que los otros del central en la propagación de relevancia.
  invoke(centralRoot, searchedTag = null) {
    this.central = this.nodes.find(n => n.root === centralRoot) || null;
    this.searchedTag = searchedTag;
    this._recomputeRelevance();
  }

  clearInvocation() {
    this.central = null;
    this.searchedTag = null;
    for (const n of this.nodes) n.relevance = 1; // democracia
  }

  _recomputeRelevance() {
    if (!this.central) {
      for (const n of this.nodes) n.relevance = 1;
      return;
    }
    // Vector de pesos de la invocación: qué tags pesan y cuánto.
    // El tag buscado explícitamente (searchedTag) pesa 1.0.
    // Los demás tags del central pesan 0.6.
    const weights = new Map();
    for (const t of this.central.tags) {
      weights.set(t, t === this.searchedTag ? 1.0 : 0.6);
    }
    if (this.searchedTag && !weights.has(this.searchedTag)) {
      weights.set(this.searchedTag, 1.0);
    }
    let maxW = 0;
    for (const w of weights.values()) maxW += w;
    if (maxW === 0) maxW = 1;

    for (const n of this.nodes) {
      if (n === this.central) { n.relevance = 1; continue; }
      let score = 0;
      for (const [T, w] of weights) {
        // Hit directo: el objeto tiene este tag
        if (n.tags.includes(T)) { score += w; continue; }
        // Hit indirecto vía co-ocurrencia: alguno de los tags del objeto
        // co-aparece con T en el catálogo. Tomamos el máximo.
        let maxCooc = 0;
        const coocT = this.cooc.get(T);
        if (coocT) {
          for (const T2 of n.tags) {
            const c = coocT.get(T2) || 0;
            if (c > maxCooc) maxCooc = c;
          }
        }
        // Decay: la relevancia indirecta pesa menos que la directa
        score += w * maxCooc * 0.7;
      }
      // Suelo mínimo 0.08: los ajenos siguen ahí, muy borrosos y lejanos
      // (fondo), pero nunca desaparecen. Techo 1 por seguridad.
      n.relevance = Math.max(0.08, Math.min(1, score / maxW));
    }
  }

  // Algunos objetos orbitan a OTRO objeto en vez de a un punto fijo: los que
  // declaran orbitAround, o los de afinidad muy alta con un vecino. Su hogar
  // deja de ser fijo y pasa a ser un offset respecto a la posición viva del
  // objetivo. Mantiene una distancia mínima (no colapsan sobre el objetivo).
  _assignOrbits(threshold) {
    const n = this.nodes.length;
    // primero, el vecino de máxima afinidad de cada nodo
    for (let i = 0; i < n; i++) {
      const ni = this.nodes[i];
      let target = -1, best = threshold;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (this.aff[i][j] > best) { best = this.aff[i][j]; target = j; }
      }
      ni._bestNeighbor = target;
    }
    // asignar órbita: un nodo orbita a su mejor vecino SÓLO si es el
    // "satélite" del par — el de menor relación total. Así, de dos objetos
    // mutuamente afines, uno ancla y el otro gira alrededor; nunca ambos.
    for (let i = 0; i < n; i++) {
      const ni = this.nodes[i];
      const t = ni._bestNeighbor;
      if (t < 0) { ni._orbitTarget = -1; continue; }
      const nt = this.nodes[t];
      const mutual = nt._bestNeighbor === i;
      // si es mutuo, orbita sólo el de menor totalRel (desempate por índice)
      const iAmSatellite = !mutual
        || ni.totalRel < nt.totalRel
        || (ni.totalRel === nt.totalRel && i > t);
      if (!iAmSatellite) { ni._orbitTarget = -1; continue; }
      ni._orbitTarget = t;
      ni._orbitOffset = ni.anchor.clone().sub(nt.anchor);
      const minOrbit = this.minOrbit ?? 1.8;
      if (ni._orbitOffset.length() < minOrbit) ni._orbitOffset.setLength(minOrbit);
    }
  }

  // Devuelve las parejas con afinidad > umbral, para las líneas de conexión.
  relatedPairs(threshold = 0.15) {
    const pairs = [];
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        if (this.aff[i][j] > threshold) {
          // tags compartidos (el concepto que los une), para mostrarlo en el viaje
          const setB = new Set(this.nodes[j].tags);
          const shared = this.nodes[i].tags.filter(t => setB.has(t));
          pairs.push({
            a: this.nodes[i].root, b: this.nodes[j].root,
            w: this.aff[i][j], shared,
          });
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

      // Los nodos en órbita: su hogar sigue al objetivo (offset que rota
      // lentamente para que la órbita no sea estática). El resorte homePull
      // los mantiene a distancia orbital del otro objeto.
      if (ni._orbitTarget >= 0) {
        const nt = this.nodes[ni._orbitTarget];
        // rotar el offset lentamente alrededor del eje Y → órbita viva
        const ang = h * 0.25;
        const ox = ni._orbitOffset.x, oz = ni._orbitOffset.z;
        ni._orbitOffset.x = ox * Math.cos(ang) - oz * Math.sin(ang);
        ni._orbitOffset.z = ox * Math.sin(ang) + oz * Math.cos(ang);
        ni.home.copy(nt.anchor).add(ni._orbitOffset);
      }

      // Resorte suave de regreso al hogar. Durante invocación se debilita
      // para que la invocación pueda desplazar el ancla.
      this._d.subVectors(ni.home, ni.anchor);
      const homeMul = this.central ? 0.1 : 1;
      this._f.addScaledVector(this._d, this.homePull * homeMul * (ni._orbitTarget >= 0 ? 2.5 : 1));

      if (this._f.length() > this.maxForce) this._f.setLength(this.maxForce);
      ni.vel.addScaledVector(this._f, h);
      ni.vel.multiplyScalar(this.damping);
    }

    // Integrar sobre el ANCLA. El bucle (que corre en el controller) orbitará
    // alrededor de este centro que ahora deriva por afinidad semántica.
    for (const ni of this.nodes) {
      ni.anchor.addScaledVector(ni.vel, h);
    }

    // Invocación: tras la integración de las fuerzas, el ancla de cada objeto
    // se desliza suavemente hacia su posición "invocada". Es un lerp directo
    // para no luchar con maxForce ni con la cascada de resortes. La distancia
    // deseada al central es función CONTINUA de la relevancia: los más
    // relevantes se pegan al central, los ajenos se van al fondo (backgroundRadius).
    // La velocidad del lerp también depende de la relevancia: lo relevante
    // se posiciona rápido, lo ajeno deriva despacio.
    if (this.central) {
      const cPos = this.central.anchor;
      for (const ni of this.nodes) {
        if (ni === this.central) continue;
        this._d.subVectors(ni.anchor, cPos);
        const dist = this._d.length();
        if (dist < 0.001) continue;
        this._d.divideScalar(dist);
        const desired = 0.8 + (1 - ni.relevance) * (this.backgroundRadius - 0.8);
        this._pt.copy(cPos).addScaledVector(this._d, desired);
        // Velocidad del acercamiento: alta para los relevantes (0.02),
        // muy baja para el fondo (0.003) → los ajenos "flotan" hacia allá.
        const speed = 0.003 + 0.017 * ni.relevance;
        ni.anchor.lerp(this._pt, speed);
      }
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
