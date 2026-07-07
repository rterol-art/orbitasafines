// ============================================================
// espacio — Fase 3: búsqueda por frase
// La frase del visitante invoca objetos. Match contra tags CURADOS (peso 2)
// y expand SINONÍMICO (peso 1, ampliado de antemano con LLM). Sin resultados
// → criterio de respaldo configurable. La invocación es irrepetible: cada
// frase convoca una constelación distinta.
// ============================================================

function normalize(w) {
  return w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function tokenize(phrase) {
  return normalize(phrase)
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function scoreObject(tokens, meta) {
  const tags = (meta.tags ?? []).map(normalize);
  const expand = (meta.expand ?? []).map(normalize);
  let score = 0;
  const matched = new Set();
  for (const tok of tokens) {
    if (tags.includes(tok)) { score += 2; matched.add(tok); }
    else if (expand.includes(tok)) { score += 1; matched.add(tok); }
  }
  return { score, matched: matched.size };
}

// Devuelve { mode, objects }. mode: 'match' | 'fallback'.
// fallbackMode: 'random' (muestra al azar) | 'connected' (los más
// relacionados entre sí) | 'none' (no mostrar nada).
export function search(phrase, catalog, opts = {}) {
  const max = opts.max ?? 30;
  const fallbackMode = opts.fallback ?? 'random';
  const tokens = tokenize(phrase);

  if (tokens.length) {
    const scored = catalog
      .map(m => ({ m, ...scoreObject(tokens, m) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || b.matched - a.matched);
    if (scored.length) {
      return { mode: 'match', objects: scored.slice(0, max).map(x => x.m), tokens };
    }
  }

  // Sin coincidencias
  if (fallbackMode === 'none') return { mode: 'fallback', objects: [], tokens };
  const shuffled = [...catalog].sort(() => Math.random() - 0.5);
  return { mode: 'fallback', objects: shuffled.slice(0, max), tokens };
}
