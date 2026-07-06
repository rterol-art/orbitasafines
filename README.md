# espacio

Espacio expositivo autónomo. Vacío negro, objetos flotantes, relaciones por tags.
Archivos estáticos servidos por GitHub Pages. **Sin build, sin Actions, sin
carpetas ocultas, sin manifest**: el motor lee el contenido de `/objects/`
directamente de la API pública de GitHub al abrir la página.

## Contenido del repositorio (esto es TODO)

```
index.html          la página
js/main.js          el motor
js/behaviors.js     los comportamientos
objects/            las obras: modelos (.glb), imágenes (.png) o textos (.json)
```

Cuatro cosas visibles. Si tu repo tiene estas cuatro cosas, funciona.

## Puesta en marcha (una sola vez)

1. Crea un repositorio público en GitHub.
2. Sube `index.html` y la carpeta `js/` (con sus dos archivos) y la carpeta
   `objects/`. Vale el botón **Add file → Upload files** de la web.
3. **Settings → Pages → Source: Deploy from a branch → main / (root)** → Save.
4. En 1–2 minutos: `https://TUUSUARIO.github.io/` (o `/NOMBREDELREPO/` si el
   repo no se llama `TUUSUARIO.github.io`).

Sin objetos subidos, la escena muestra cinco mallas rotas de prueba, cada una
con una combinación de movimiento distinta, para calibrar a ojo.

## Subir una obra

1. Comprime el modelo (requiere `npm i -g @gltf-transform/cli`, una vez):

   ```
   gltf-transform optimize entrada.glb torito.glb --compress meshopt --texture-size 2048
   ```

   (KTX2 es opcional y requiere instalar el binario `ktx` aparte; no hace
   falta para empezar.)

2. Crea `torito.json` con el mismo nombre base (formato: `objects/_ejemplo.json.txt`).
3. Sube ambos a `/objects/` por la web de GitHub.
4. Recarga la página. Ya está. No hay paso 5.

## Probar en local

```
npx serve .
```

En local no hay API de GitHub que consultar, así que verás las mallas de
prueba (o puedes crear un `manifest.json` a mano con formato
`{"objects":[{"file":"torito.glb","tags":[...]}]}` como respaldo local).

## Fases

- [x] **Fase 1** — escena negra, IBL, catálogo en vivo vía API de GitHub, fallback procedural
- [x] **Fase 2** — comportamientos declarativos: bucle imperfecto, playback degradado, jitter, respiración arrítmica, desgarro (evento raro, cap global), costura wireframe
- [ ] **Fase 3** — fuerzas por solapamiento de tags + sincronización (Kuramoto)
- [ ] **Fase 4** — pipeline de compresión + cap adaptativo de rendimiento
- [ ] **Fase 5** — buscador por frase (diccionario)
