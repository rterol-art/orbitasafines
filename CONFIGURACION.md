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

---

## AMPLIACIÓN v8 (ajustes sobre Fase 3)

### Relaciones ponderadas: tags fuertes, expand ligero
Ahora `expand` SÍ influye en relaciones, pero con peso 1/4 respecto a `tags`.
Coincidir en tags principales = relación pesada; coincidir solo en sinónimos
= relación ligera. No colapsa el grafo porque el peso es bajo.

### Modulación automática por relación
- **Escala**: base aleatoria por objeto (0.75–1.35) × hasta +30% según cuánta
  relación tenga con el entorno. Los muy conectados son algo mayores.
- **Period (tempo)**: los objetos muy relacionados van más LENTOS (hasta 2×);
  los poco relacionados, más ligeros. La relación asienta.

### Órbita sobre otro objeto (`orbits`)
Declara `"orbits": "nombre-archivo.glb"` para que un objeto gire alrededor de
OTRO en vez de su propio centro. Restricción: el objetivo no puede a su vez
orbitar a nadie (jerarquía acíclica). Decisión de obra: qué gira alrededor de
qué lo decides tú, no el azar. *(pendiente de tu confirmación para activar)*

### Colisiones
Cuando dos objetos se acercan por debajo de la distancia mínima: ambos suben
el jitter a 0.03 durante el impacto (y decae), y su bucle pierde un 3% de
mutación por choque (cada golpe los asienta un poco). Con histéresis para no
redispararse mientras siguen solapados.

### `avoid` — vibración de pinchos orientada
La vibración por proximidad (olas si afín, pinchos si hostil) ahora aparece
SOLO en las caras orientadas hacia el objeto que la provoca, con algo de
random en el borde de la zona.

### `trailStrength` — intensidad de estela por objeto
Multiplicador sobre la huella de silueta. `1` normal, `2` deja el doble de
rastro. Para destacar un objeto principal:
```json
{ "tags": [...], "trailStrength": 2.0 }
```

### Texto: vibración corregida + opacidad por relación
El texto ya no se cizalla (la inclinación bajó de 0.05 a 0.012 rad): vibra en
torno al texto nítido, permanece legible. Y su opacidad baja cuando tiene poca
relación con el entorno (`minOpacity`, def. 0.35), sube cuando resuena.

---

## AMPLIACIÓN Fase 3c (ajustes)

### Órbita alrededor de otro objeto (automática)

Un objeto muy afín a otro (afinidad > 0.5) deja de orbitar su propio centro y
pasa a girar ALREDEDOR del otro — el satélite del par (el de menor relación
total) orbita al ancla. Mantiene distancia mínima (no colapsa) y el offset
rota lento (órbita viva, no estática). Cada choque durante la órbita reduce la
mutación (memoria del contacto). Emerge solo de los tags; no se configura.

### Escala

Aleatoria por objeto (semilla del nombre, 0.75–1.35) MÁS un extra por afinidad
(hasta +30% con relación máxima). Los objetos muy conectados son algo mayores.

### Period (tempo)

Modulado por relación: mucha relación con el entorno → bucle más LENTO (se
asienta, gravita); poca → más rápido y ligero. Sobre el `period` que definas.

### Choques

Cuando dos objetos se acercan por debajo de la distancia mínima: ambos suben
el jitter a ~0.03 durante el impacto (decae solo) y su bucle pierde un 3% de
mutación (se asientan un poco más con cada golpe). Histéresis para no
redispararse mientras siguen solapados.

### Vibración por proximidad — sólo caras orientadas al vecino

Las olas (afín) o pinchos (hostil) aparecen SÓLO en las caras del modelo
orientadas hacia el objeto que provoca el efecto, con un ligero random. El
resto de la superficie queda quieta. La reacción tiene dirección.

### Texto — ajustes

- Permanece NÍTIDO: inclinación mínima (0.006 rad), jitter capado a 0.004.
  La vibración perceptible es su leve deriva, no la deformación del plano.
- Opacidad por relación: si no resuena con tags cercanos, baja a ~0.45;
  con resonancia, sube a 0.9. Además resalta en negrita las palabras que
  coinciden.

### Estela — ampliada

Vida más larga (1.9s), muestreo más denso, huella de 3D más presente
(printOpacity 0.20) y disco algo mayor. Por objeto: `"trailStrength": 2`
en el JSON multiplica la intensidad de su estela (para el objeto principal).

---

## CORRECCIONES v9

- **Líneas eternas (bug)**: las líneas de conexión ahora mueren si un extremo
  sale de escena, y se limpian por completo al buscar/aleatorizar. Además su
  opacidad máx bajó de 0.5 a 0.22 (más sutiles) y se eliminó el enlace por
  proximidad (unía textos vecinos de forma persistente); ahora solo conectan
  por afinidad de tags.
- **Texto legible**: el texto ya no recibe jitter agresivo ni respiración.
  Su movimiento propio es sólo deriva lenta por bucle amplio + micro-jitter
  de 0.002. Ya no hay que tocar nada por bloque: es global.
- **Botón "azar"**: junto al buscador, restaura una constelación aleatoria.
  El buscador vacío + Enter hace lo mismo.
- **Círculo de carga**: un disco difuminado pulsante aparece en el centro
  mientras cargan los modelos, anticipando su aparición.

---

## CORRECCIONES v10

- **Texto legible (de verdad)**: quitados TODOS los reductores acumulados.
  Sin jitter, sin respiración, sin inclinación de billboard (mira a cámara
  plano y quieto), y SIN el atenuado por relación que lo dejaba invisible.
  Render a alta resolución (supersampling ×2 + mipmaps) para nitidez sobre
  negro. La relación con el entorno se expresa SOLO en las negritas, no
  atenuando el bloque. El texto ya no se pierde.
- **Círculo de carga**: ahora se oculta siempre al terminar (try/finally),
  incluso si una carga falla.
- **Conexiones = puntos viajeros**: en vez de líneas dibujadas, pequeños
  puntos con una cola corta que de vez en cuando viajan en línea recta de un
  objeto a otro relacionado. Una señal que se transmite, no un vínculo fijo.
  Config en ConnectionLines: `speed`, `spawnEvery`, `dotSize`, `trailDots`.

---

## v11 — cámara que sigue + concepto en el trayecto

### Click para centrar y seguir
Click sobre un objeto: la cámara lo centra y lo SIGUE en su órbita
DESPLAZÁNDOSE con él (mantiene ángulo y distancia, no rota alrededor).
Click en el vacío o tecla Escape: suelta el seguimiento. Arrastrar sigue
orbitando libremente (se distingue click de arrastre por el movimiento).

### El concepto aflora en el viaje
Cuando un punto viajero recorre la relación entre dos objetos, a veces
(`showConcept`, def. 0.4) lleva consigo, muy tenue, UNO de los tags que ambos
comparten — la palabra que los une, emergiendo en el trayecto y disolviéndose.
No es un nodo de un diagrama: es niebla conceptual, el concepto visto de paso.
Los tags dejan de ser invisibles sin convertirse en etiquetas fijas.
