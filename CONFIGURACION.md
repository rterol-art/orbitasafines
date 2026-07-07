# Referencia de configuración — `objects/*.json`

Cada archivo `.json` describe **un objeto**. Tres tipos: `model` (con `.glb`),
`image` (con `.png`), `text` (solo JSON). El tipo se infiere del archivo
hermano o del campo `text`; se puede forzar con `"type"`.

Todo lo que no pongas, no existe para ese objeto. Omitir `movement` entero
= configuración por defecto (bucle + playback + jitter + respiración).

---

## Comunes a todos los tipos

| Campo | Qué toca | Rango útil | Cuándo moverlo |
|---|---|---|---|
| `tags` | Semántica del objeto. Base de las relaciones (Fase 3). | lista larga | Siempre. Cuantas más, mejor. No es decoración. |
| `scale` | Tamaño sobre el normalizado. | 0.5–2.0 (def. 1.0) | Jerarquía de tamaño entre piezas. |
| `type` | Fuerza el tipo si no se infiere. | model/image/text | Solo si el nombre no coincide con el archivo. |
| `file` | Nombre del archivo si difiere del `.json`. | — | Solo si `retrato.json` apunta a `otro.glb/png`. |

---

## `movement.base` — trayectoria (cómo flota)

Tipo único: `bucle`.

| Campo | Qué toca | Rango | Nota |
|---|---|---|---|
| `period` | Segundos por vuelta. Tempo. | 25–90 (def. [30,60]) | Bajo = nervioso. Alto = contemplativo. |
| `radius` | Tamaño del recorrido. | 0.5–2.5 | Bajo = ancla. Alto = errante. |
| `mutation` | Cuánto muta el bucle por vuelta. | 0–0.2 (def. 0.08) | **Tu tesis en un número.** 0 = se repite igual. |

## `movement.time` — playback degradado (deforma el tiempo)

Omitir el bloque = movimiento temporal limpio.

| Campo | Qué toca | Rango | Nota |
|---|---|---|---|
| `freezesPerMinute` | Frecuencia de congelación. | 1–10 (def. 4) | Bajo = evento raro. |
| `freezeMs` | Duración de cada freeze [min,max] ms. | [200,800]…[800,2000] | Corto = tirón. Largo = pausa. |
| `rewindChance` | Prob. de rebobinar al soltar. | 0–0.4 (def. 0.25) | 0 = se recupera. Alto = no pasa de ahí. |

## `movement.layers` — capas de cuerpo (se suman)

**`jitter`** (microtemblor de posición)

| Campo | Rango | Nota |
|---|---|---|
| `amplitude` | 0.008–0.03 (def. 0.008) | No pasar de 0.03: parece roto, no vibrante. |
| `frequency` | def. 14 | Más alto = eléctrico. |
| `intermittent` | def. true | Dejar true: el continuo desaparece perceptivamente. |

**`respiracion`** (escala arrítmica)

| Campo | Rango | Nota |
|---|---|---|
| `amount` | 0.015–0.03 | Sutil. Exagerado = cliché zen. |
| `period` | [6,14] s aprox. | La arritmia lo desvía. |

## `movement.mesh` — efectos de malla (SOLO modelos 3D)

**`costura`** (wireframe asoma) — coherente con "interior como territorio".

| Campo | Rango | Nota |
|---|---|---|
| `coverage` | 0.22–0.5 | Fracción con wireframe visible. |
| `speed` | def. 0.06 | Deriva de las zonas. |
| `opacity` | def. 0.5 | |
| `color` | hex (def. lila claro) | |

**`desgarro`** (espasmo raro, cap global de 1 a la vez)

| Campo | Rango | Nota |
|---|---|---|
| `interval` | [30,120] s | Bajar para más frecuencia. |
| `duration` | def. 0.7 s | Corto = espasmo, no gesto. |
| `strength` | 0.22–0.3 | 0.3+ violento. |

> Aviso de obra: tus modelos **ya están rotos**. El desgarro teatraliza el
> daño. Prefiere `costura`; usa `desgarro` con parquedad o nada.

---

## Exclusivo de `image` (PNG)

| Campo | Qué toca | Rango | Nota |
|---|---|---|---|
| `backOpacity` | Opacidad del reverso fantasma. | 0–0.4 (def. 0.22) | **El reverso es el argumento.** 0 = imagen plana normal. |

## Exclusivo de `text`

| Campo | Qué toca | Def. |
|---|---|---|
| `text` | Contenido. `\n` = salto de línea. | — |
| `size` | Altura en unidades de escena. | 0.9 |
| `color` | Hex CSS. | #d8d2e0 |
| `weight` | Grosor de fuente. | 300 |
| `opacity` | — | 0.9 |

> Los textos no aceptan `mesh` y siempre miran a cámara con temblor
> (intrínseco, no configurable). Disciplina: fragmento de ficción, no leyenda.

---

## Efectos de escena (globales, NO en el JSON)

Líneas de conexión y estelas/huellas viven en `CONFIG` de `main.js`
(`connections`, `trails`) y en las clases (`printOpacity`, etc.).
Son propiedades del espacio, no de las piezas. Si quieres control por objeto,
hay que exponerlo al JSON — pídelo.

---

## Tres plantillas listas para copiar

**Modelo contemplativo (ancla), con interior visible:**
```json
{
  "tags": ["cuerpo", "escaneo", "pérdida", "lila", "rostro", "malla-rota", "interior", "registro"],
  "movement": {
    "base": { "type": "bucle", "period": [60, 80], "radius": [0.5, 0.9], "mutation": 0.06 },
    "time": { "type": "playback", "freezesPerMinute": 3, "rewindChance": 0.2 },
    "layers": [{ "type": "respiracion", "amount": 0.02 }],
    "mesh": [{ "type": "costura", "coverage": 0.3, "speed": 0.05 }]
  }
}
```

**Imagen con reverso fantasma presente:**
```json
{
  "tags": ["registro", "cara", "reverso", "copia"],
  "backOpacity": 0.28,
  "movement": {
    "base": { "type": "bucle", "period": 50, "radius": 1.4, "mutation": 0.08 },
    "layers": [{ "type": "jitter", "amplitude": 0.006 }]
  }
}
```

**Fragmento de texto a la deriva:**
```json
{
  "tags": ["frase", "aura", "ficción"],
  "text": "lo que el algoritmo no capturó\nes lo que tiene valor",
  "size": 0.7,
  "weight": 300,
  "movement": {
    "base": { "type": "bucle", "period": [55, 80], "radius": [1.8, 2.5], "mutation": 0.05 }
  }
}
```

---

## AMPLIACIÓN Fase 3

### `expand` — sinónimos para el buscador (NO para relaciones)

Campo separado de `tags`. Los `tags` (curados por ti) rigen las relaciones
ENTRE objetos: gravedad, líneas, sincronización. Los `expand` (sinónimos
ampliados de antemano con LLM) solo sirven para que el BUSCADOR encuentre
el objeto aunque el visitante no use tu palabra exacta.

**Por qué separados:** si ampliaras los tags con sinónimos, el solapamiento
entre objetos se inflaría y todo se relacionaría con todo — el grafo
colapsa. Los sinónimos ayudan a buscar, envenenan las relaciones. Por eso
dos campos.

```json
{
  "tags": ["cuerpo", "rostro", "pérdida", "lila"],
  "expand": ["figura", "cara", "semblante", "ausencia", "duelo", "violeta", "purpura", "malva"],
  "movement": { ... }
}
```

En el buscador, un match en `tags` pesa 2; en `expand`, pesa 1. Así tus
palabras curadas mandan y los sinónimos solo desempatan/rescatan.

### `deshielo` — reemplazo del desgarro (en `movement.mesh`)

Degradación PERMANENTE y acumulativa: el modelo se deshace despacio mientras
existe y no se recupera. Continúa el daño en vez de teatralizarlo.

| Campo | Qué toca | Rango | Nota |
|---|---|---|---|
| `rate` | Velocidad del deshielo. | 0.008–0.03 | Bajo = imperceptible salvo si te quedas mirando. |
| `max` | Desplazamiento máximo (se detiene ahí). | 0.2–0.5 | Cuánto llega a deshacerse. |
| `turbulence` | Variación entre zonas. | 0–1 (def. 0.6) | Alto = unas partes se deshacen más que otras. |

`desgarro` sigue disponible pero fuera de los defaults. Coexisten; elige uno.

### Efectos de escena (globales, en CONFIG de main.js)

| Opción | Qué hace |
|---|---|
| `relations` | Fuerzas y sincronización por tags. |
| `search` | Activa el buscador por frase. |
| `searchFallback` | Sin resultados: 'random' (muestra al azar) o 'none' (nada). |

---

## AMPLIACIÓN Fase 3b

### Respiración rediseñada (`movement.layers`)

Ya no escala el objeto entero (se veía como un bulto hinchándose sin sentido).
Ahora unas ZONAS del modelo se hinchan por shader, y donde más se estiran la
textura cede y asoma la malla — el registro que da de sí y se pierde por tensión.

| Campo | Qué toca | Rango | Nota |
|---|---|---|---|
| `amount` | Desplazamiento máx de la zona. | 0.03–0.1 (def. 0.06) | |
| `period` | Segundos por ciclo. | [6,14] | Con apneas. |
| `zones` | "Frecuencia" espacial de las zonas. | 2–4 (def. 2.5) | Alto = más zonas, más pequeñas. |
| `reveal` | ¿Asoma la malla al estirarse? | true/false (def. true) | El sentido del efecto. |

### Vibración por proximidad (automática en modelos)

Cuando otro objeto se acerca, la superficie reacciona según la afinidad:
afinidad ALTA → olas suaves (reconocimiento); afinidad NEGATIVA → pinchos
violentos (rechazo). Se desactiva con `"proximity": false` en el JSON, o se
afina con un objeto: `"proximity": { "wave": 0.04, "spike": 0.12 }`.

| Campo | Qué toca | Rango |
|---|---|---|
| `wave` | Amplitud de las olas (afinidad positiva). | 0.02–0.06 |
| `spike` | Amplitud de los pinchos (afinidad negativa). | 0.08–0.2 |

### `avoid` — tags de exclusión (afinidad negativa)

Junto a `tags`. Si otro objeto tiene un tag que este declara en `avoid`, la
afinidad entre ambos se vuelve NEGATIVA: se repelen y se erizan de pinchos al
acercarse. Sin `avoid`, nunca hay pinchos, solo olas entre afines.

```json
{
  "tags": ["cuerpo", "rostro", "orgánico"],
  "avoid": ["máquina", "dato", "digital"],
  ...
}
```

### Resaltado de textos (automático)

Un texto pone en NEGRITA (y aclara) las palabras de su contenido que coincidan
con tags de objetos cercanos. Reconocimiento ocasional, no índice: solo dentro
de un radio y con re-render únicamente al cambiar. La relación se hace visible
en el propio lenguaje del texto.
