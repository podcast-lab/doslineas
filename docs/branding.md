# Fase 2 — Imagen de marca

Intro, cierre y rótulos sobre el máster que sale de la fase 1. Ningún color, tipografía ni texto vive dentro
de las plantillas: todo entra como parámetro. Aun así, **el aspecto es el mismo para todos los episodios**, y
eso es una decisión, no una limitación — ver «Un solo aspecto» más abajo.

## Las tres piezas

| Pieza | Qué es | Dónde vive |
|---|---|---|
| `config/brand-kit.json` | **El kit del estudio**: colores, tipografía, logotipo, duración de las cartelas y estilo del rótulo. | Configuración, editable sin tocar código. |
| `brand-plan.json` | **Qué gráfico entra, cuándo y con qué texto.** Se deriva del EDL, igual que el máster. | Se escribe en la carpeta de la sesión. |
| `packages/graphics` | Proyecto Remotion: `Intro`, `Outro` y `LowerThird`, con esquemas de props en Zod. | Consume el plan, no lo decide. |

El plan es al gráfico lo que el EDL es al montaje: se puede revisar y discutir **sin renderizar nada**.
`pnpm cli brand <dir>` lo escribe en menos de un segundo; `--render` es lo que cuesta minutos.

## Dónde caen los rótulos

Un rótulo nunca puede sobrevivir al plano que lo sostiene: si el corte llega antes, el nombre se queda a
medias sobre la cara de otra persona. La regla, con todos los números en el kit:

1. Se busca el **primer plano de la entrada de esa persona** que aguante `delaySeconds + seconds`.
2. Si no hay ninguno, sirve uno que aguante `delaySeconds + minSeconds`, y el rótulo se acorta a lo que quepa.
3. Si tampoco, **no se inventa el rótulo**: el plan lo dice en `warnings` y sigue.
4. Dos rótulos guardan `gapSeconds` entre ellos, así que nunca se pisan.

El orden es el de aparición en el montaje, no el de la lista de participantes: quien habla primero se
presenta primero.

Los nombres salen de `episode.json` en la carpeta de la sesión (`title`, `subtitle`, `participants` con su
entrada). **Si no existe, se usan nombres genéricos por rol** y se avisa por consola, que es lo que permite
enseñar las plantillas hoy, sin un solo dato real del cliente.

## Cómo se pega al máster

Los gráficos se renderizan aparte —las cartelas en H.264 con pista de audio muda, los rótulos en **VP9 con
canal alfa**— y una sola pasada de FFmpeg deja el `master-branded.mp4`:

- cada rótulo se retrasa con `tpad=start_duration=<cue>:start_mode=add:color=black@0` y se superpone con
  `overlay=eof_action=pass`. El retraso va **en la pista**, no en un `enable=`, porque `overlay` mantiene el
  primer fotograma disponible: con `setpts` el rótulo aparecería desde el segundo cero;
- el rótulo ocupa el fotograma completo y coloca su esquina y sus márgenes desde dentro de la plantilla, así
  que FFmpeg solo hace `overlay=x=0:y=0` y la posición es un parámetro de diseño, no del comando;
- intro, cuerpo y cierre se normalizan (`scale`, `setsar`, `fps`, `format`, `aformat`) y se unen con `concat`.
  Si el kit pone `seconds: 0` en una cartela, esa cartela desaparece del plan **y del `concat`**.

Los tiempos del plan están en el reloj del máster, que ya lleva los silencios recortados, así que el rótulo
cae donde dice el EDL. La intro se añade delante después, y por eso **la transcripción se desplaza** su
duración: `pnpm cli captions transcript.json --offset 5`.

**Esto es una segunda pasada sobre el máster, con su recodificación.** Se eligió así a propósito: el render
de conmutación (R1) ya es un `filter_complex` con `streamselect` y `sendcmd`, y meterle overlays y `concat`
convertiría la pieza más delicada del sistema en la más frágil. Cuando haya material real y medidas de
tiempo, plegar las dos pasadas en una es una optimización con un banco de pruebas claro.

## Dos cosas que hay que saber para tocar esto

**El empaquetador de Remotion no entiende los `import "./x.js"` de TypeScript NodeNext.** Webpack busca
`Root.js.tsx` y se cae. Se arregla con `resolve.extensionAlias` en `packages/graphics/src/webpack-override.ts`,
que usan tanto la API de Node como el estudio. Si algún día el bundle falla con «doesn't exist» sobre un
fichero `.js` que sí existe como `.tsx`, es esto.

**El render de gráficos no está en `pnpm test`.** Empaquetar y levantar Chromium se lleva medio minuto, y el
banco de pruebas entero corre hoy en diez segundos. Lo que sí está probado automáticamente es todo lo demás:
el plan, el filtro de FFmpeg y **el pegado real** con gráficos de mentira hechos con `lavfi` —incluida la
comprobación de que el rótulo aparece cuando toca y no antes. Los gráficos de verdad se comprueban con
`pnpm cli brand <dir> --render`.

## La transcripción como fichero aparte

`packages/core/src/transcript.ts` agrupa palabras en subtítulos (corta al cambiar de hablante, en las pausas
largas, y por longitud) y escribe `.vtt`, `.srt` y `.txt`. Es la mitad del trabajo que se podía hacer sin
tocar la fase 3: **falta la fuente**, o sea Deepgram, que llega con los clips y necesita la autorización del
cliente para que el audio salga del NAS.

## Un solo aspecto para todos los episodios

El estudio **se alquila**, así que cada episodio puede ser de un cliente distinto. Se planteó un kit por
cliente y **se descartó**: la marca que se ve es la del estudio, igual en todos los episodios, decidido el
20/08/2026. Lo que cambia de un episodio a otro son los datos —título y participantes— no el diseño.

- **Tipografía: Montserrat**, la sans geométrica que usa medio YouTube para rótulos de podcast. Va en el
  repositorio vía `@fontsource/montserrat` (licencia SIL OFL, comercial sin problemas) y se **incrusta en el
  gráfico como data URL**: el render **no toca la red**, que es justo lo que necesita un worker en el NAS.
  Titulares en 700, textos en 500; si el kit pide otro peso, se redondea al más cercano de los que hay.
- Un kit con `fonts.heading.family` distinto de `Montserrat` y `file: null` **no incrusta nada** y cae al
  stack del sistema: no se hace pasar una fuente por otra.
- Pedirle a cada cliente ficheros de fuente con su licencia era regalarse un lío legal por tres euros de
  estética. Con una tipografía estándar, el problema desaparece.
- La excepción sigue existiendo sin tocar código: `--kit otro-kit.json` monta un episodio con otros colores
  y otro logotipo. Es para el cliente que lo pida y lo pague, no el camino por defecto.
- Cortinilla musical: hoy las cartelas salen con pista muda. Cuando haya música, entra como una entrada más
  del `concat` y un `-map` de audio.
- **Sin mosca ni logotipo permanente**, como pidió el cliente: el logotipo solo aparece en la intro.

## Comandos

```sh
pnpm cli brand .work/ep01                     # solo el plan
pnpm cli brand .work/ep01 --render            # gráficos + master-branded.mp4
pnpm cli brand .work/ep01 --kit config/brand-kit.json --episode .work/ep01/episode.json
pnpm cli captions .work/ep01/transcript.json --offset 5
pnpm studio                                   # Remotion Studio: retocar las plantillas a ojo
```

En el estudio de Remotion cada composición trae su esquema de Zod, así que los colores se cambian con un
selector y se ve el resultado al instante. Es la vía rápida para enseñárselo al cliente y cerrar el diseño.
