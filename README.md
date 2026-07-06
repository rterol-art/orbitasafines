# espacio

Espacio expositivo autónomo. Vacío negro, objetos flotantes, relaciones por tags.
Sin servidor, sin build, sin Unity: archivos estáticos servidos por GitHub Pages.

## Puesta en marcha (una sola vez)

1. Crea un repositorio nuevo en GitHub (público) y sube todo el contenido de esta carpeta.
2. En el repositorio: **Settings → Pages → Source: Deploy from a branch → Branch: main / (root)** → Save.
3. En **Settings → Actions → General → Workflow permissions**, marca **Read and write permissions** (necesario para que la Action pueda commitear el manifest).
4. Espera 1–2 minutos. Tu espacio está en `https://TUUSUARIO.github.io/NOMBREDELREPO/`

Sin objetos subidos, la escena muestra mallas rotas procedurales de prueba
para verificar que todo funciona.

## Subir una obra (flujo normal)

1. Comprime el modelo (una vez instalado `npm i -g @gltf-transform/cli`):

   ```
   gltf-transform optimize entrada.glb figura-lila.glb --compress meshopt --texture-compress ktx2
   ```

2. Escribe `figura-lila.json` con sus tags (formato en `objects/_ejemplo.json.txt`).
3. Sube ambos archivos a `/objects/` — vale el botón **Add file → Upload files**
   de la web de GitHub, desde cualquier dispositivo.
4. La Action regenera `manifest.json` y en ~1 minuto la obra está en el espacio.

## Estructura

```
index.html                      página única
js/main.js                      motor (Three.js vía CDN)
objects/                        pares .glb + .json — las obras
manifest.json                   índice generado automáticamente. No editar a mano.
scripts/build-manifest.mjs      generador del manifest
.github/workflows/manifest.yml  automatización
```

## Fases

- [x] **Fase 1** — escena negra, IBL, carga desde manifest, cap de rendimiento, fallback procedural
- [x] **Fase 2** — comportamientos declarativos: bucle imperfecto, playback degradado, jitter, respiración arrítmica, desgarro (evento raro, cap global), costura wireframe
- [ ] **Fase 3** — sistema de fuerzas por solapamiento de tags (grafo semántico 3D)
- [ ] **Fase 4** — pipeline de compresión automática + cap adaptativo
- [ ] **Fase 5** — buscador por frase (diccionario)

## Probar en local

Cualquier servidor estático sobre la carpeta:

```
npx serve .
# o
python3 -m http.server 8000
```

(Abrir `index.html` directamente con doble clic no funciona: `fetch` del
manifest necesita protocolo http.)
