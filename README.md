# Edición automática de vídeo — Dos Líneas

Monta el podcast solo: coge los 4 ISO del ATEM Mini Pro ISO, decide el montaje y renderiza el máster, los
clips verticales y el explicativo con pantalla dividida.

El alcance está en `Plan tecnico - Automatizacion edicion de video podcast (rev 4).pdf` y el plan de
desarrollo en `C:\Users\Otniel.dev\.claude\plans\el-clinete-ya-aprobo-goofy-plum.md`.

## Requisitos

Node 22+, pnpm 9+ y **FFmpeg 7 o superior en el PATH** (probado con 8.1 y 9.0.1). Los gráficos usan Remotion, que
descarga su propio Chrome la primera vez que se renderiza; no hay que instalar nada a mano.

```sh
pnpm install
pnpm test        # 269 pruebas, ~12 s, incluye renders reales de punta a punta
pnpm typecheck
pnpm lint
```

## Estructura

| Sitio | Qué hay |
|---|---|
| `packages/core` | El EDL, los dos generadores de corte, el solver y las métricas. Sin I/O ni framework. |
| `packages/media` | Adaptador de FFmpeg: sondeo, generador de sesiones sintéticas, render de la conmutación. |
| `packages/analysis` | Quién habla y cuándo: envolvente RMS, suelo de ruido, dominancia relativa con histéresis y silencios. Y cuándo trabaja la pantalla. |
| `packages/graphics` | Proyecto Remotion: intro, cierre, rótulos y subtítulos animados. Todo entra como parámetro; nada de marca vive en la plantilla. |
| `packages/providers` | Los enchufes de pago: Deepgram para transcribir y un modelo de lenguaje para elegir momentos. |
| `packages/pipeline` | El orden de los pasos, la cola con trabajos arrendados, el vigilante de carpeta, la entrega y el borrado del bruto. Sin framework. |
| `apps/cli` | Herramienta de desarrollo y de rescate. |
| `apps/worker` | NestJS: vigila la carpeta y ejecuta los pasos de cada sesión. |
| `apps/api` | NestJS: el panel de estado y lo que se puede tocar desde él. |
| `config/edit-profile.json` | Los valores medidos en el anexo A. **Ningún número de montaje va en el código.** |
| `config/brand-kit.json` | El kit del estudio: colores, tipografía, logotipo y duraciones. **El mismo para todos los episodios.** |
| `config/clip-profile.json` | Duración de los clips, pesos de selección, palabras gancho y encuadre vertical. |
| `config/explainer-profile.json` | Umbrales de actividad de la pantalla y geometría de la pantalla dividida. |
| `spikes/` | Bancos de pruebas de riesgos técnicos. |
| `docs/` | Lo que sale de cada spike. |

## El EDL es el centro

El análisis produce una **lista de decisiones de montaje en JSON**; FFmpeg, Remotion y el exportador
FCPXML solo la consumen. Eso permite probar el criterio de montaje sin renderizar nada, y que el cliente
lo revise sin esperar 45 minutos.

`validateEdl` comprueba las invariantes que un render no perdona: la línea de salida sin huecos ni solapes,
ningún segmento leyendo más allá del final de su fuente, y descartes ordenados y sin solapar.

## Sesiones sintéticas

No hace falta material real ni 200 GB para desarrollar. El generador escribe una sesión completa —los 4
ISO con su micro embebido, el programa, el WAV del ATEM y un `truth.json` con lo que se supone que tiene
que detectar el análisis— **en segundos**.

```sh
pnpm cli generate-session .work/demo --duration 30
pnpm cli probe .work/demo/iso2.mp4
pnpm cli profile
```

Cada micro lleva la voz de su persona más la **filtración de las demás a −18 dB** y un suelo de ruido a
−50 dB, que es justo el problema que el detector de «quién habla» tiene que resolver.

## El máster, de punta a punta

```sh
pnpm cli generate-session .work/ep01 --duration 180
pnpm cli edit .work/ep01 --render
```

Ingesta (incluida la clasificación de la entrada 4 contando fotogramas duplicados), análisis, EDL, **FCPXML**
y máster. Una sesión sintética de 3 minutos sale montada y renderizada en **menos de 7 segundos**.

Antes de tocar nada, el comando **comprueba que la sesión está entera**: los cuatro ISO presentes y con audio,
las cuatro duraciones dentro de un fotograma, el programa y el `.drp`. Si algo falta, dice qué y se planta —
`--force` para seguir de todos modos. Es la diferencia entre montar una grabación a medio escribir y saberlo.

## La red de seguridad: FCPXML

`edit.fcpxml` abre el montaje en DaVinci Resolve con los cuatro ISO como clips y el audio del programa
conectado debajo, así que **cualquier decisión del sistema se puede corregir a mano** sin volver a empezar.

Los silencios recortados parten los planos en trozos contiguos, porque una línea de tiempo no admite agujeros;
los tiempos van en fracciones exactas de fotograma (25, 30 y también las NTSC de 29,97 y 23,976), y el formato
de la secuencia sale del propio material en vez de darse por supuesto.

## La imagen de marca

```sh
pnpm cli brand .work/ep01            # escribe brand-plan.json y dice qué rótulo entra y cuándo
pnpm cli brand .work/ep01 --render   # renderiza los gráficos y deja master-branded.mp4
pnpm studio                          # Remotion Studio, para retocar las plantillas a ojo
```

`brand-plan.json` es al gráfico lo que el EDL es al montaje: **qué entra, cuándo y con qué texto**, revisable
sin renderizar. Un rótulo **nunca sobrevive al plano que lo sostiene**: se busca el primer plano de esa
persona que aguante el rótulo completo, si no cabe se acorta, y si tampoco cabe **el plan lo dice en vez de
inventárselo**.

Los colores, el logotipo y los textos salen de `config/brand-kit.json` —**el mismo kit para todos los
episodios**, porque el estudio se alquila y la marca que se ve es la del estudio—, y los nombres de
`episode.json` en la carpeta de la sesión. Sin `episode.json` se usan nombres genéricos por rol. La
tipografía es **Montserrat** y viaja dentro del repositorio (licencia SIL OFL), incrustada en el gráfico:
**el render no necesita red**. Los detalles y el por qué de la segunda pasada de FFmpeg están en
`docs/branding.md`.

## Los clips verticales

```sh
pnpm cli transcribe .work/ep01           # el audio del máster a Deepgram, escribe transcript.json
pnpm cli mock-transcript .work/ep01      # o una transcripción inventada, para probar sin Deepgram
pnpm cli clips .work/ep01                # elige momentos y escribe shorts-plan.json
pnpm cli clips .work/ep01 --render        # y saca clip-N.mp4 en 1080x1920 con subtítulos
pnpm cli clips .work/ep01 --rules         # sin modelo de lenguaje, solo con las reglas
```

La transcripción va **contra el máster**, no contra el bruto, así que un instante del transcript, uno del EDL
y uno del máster son el mismo número. Los nombres de los hablantes no salen de Deepgram: los pone el EDL,
cruzando por mayoría qué cámara estaba en pantalla con quién es cada cámara.

La selección tiene dos motores. El modelo de lenguaje devuelve **índices de intervención, nunca segundos**
—un índice que no existe se descarta, un tiempo inventado no se puede comprobar— y todo lo que devuelve pasa
por una validación que recorta, alarga o tira lo que no cabe. Las reglas puntúan cada ventana con siete
señales configurables y **completan la lista** cuando el modelo da menos de lo pedido. Sin clave de API se
trabaja solo con reglas.

El clip vertical es **el único sitio donde se recorta la imagen**, y se recorta con una ventana fija por
cámara que salta en el corte: sin seguimiento facial ni reencuadre que persiga a nadie. El porqué de cada
decisión, y la trampa del canal alfa que tapaba la imagen, en `docs/clips.md`.

## El explicativo con pantalla dividida

```sh
pnpm cli generate-session .work/exp --duration 120 --input4 screen
pnpm cli explainer .work/exp            # escribe explainer-plan.json con los bloques de composición
pnpm cli explainer .work/exp --render   # y deja explainer.mp4
```

El segundo formato del acuerdo. Aquí habla una sola persona, así que **el micrófono ya no dice a qué cortar: la
señal la da la pantalla**. Se sacan fotogramas en gris a 4/s y a 64x36 —reducir tanto es el filtro: a ese tamaño
el ruido de compresión y el cursor desaparecen— y se mide qué proporción de la imagen cambia.

Van **dos umbrales, no uno**: cambio pequeño y sostenido (escribir, dibujar) abre tras medio segundo; cambio
grande e instantáneo (**una diapositiva**) abre de inmediato. Con un solo umbral sostenido, un cambio de
diapositiva no activaba nunca la pantalla, y el plan lo nombra explícitamente.

La composición son **dos imágenes completas y un conmutador**, el mismo mecanismo del spike R1: o la cámara a
pantalla completa, o la pantalla con **la persona incrustada en una esquina**. Que la persona esté siempre en
cuadro no es decoración: es la red de seguridad, porque si la detección se equivoca lo peor que pasa es que la
pantalla salga un par de segundos de más. El porqué, en `docs/explainer.md`.

## Del disco de grabación a la carpeta vigilada

```sh
pnpm cli ingest /Volumes/ATEM/2026-09-10-piru --dry-run   # qué copiaría y cuánto pesa
pnpm cli ingest /Volumes/ATEM/2026-09-10-piru             # y lo copia de verdad
```

El disco donde graba el ATEM **es de sólo lectura para nosotros**, así que no puede ser la carpeta vigilada: cada
paso escribe dentro de la carpeta de la sesión y `confirm` borra de ahí el bruto. `ingest` copia la grabación al
área de trabajo, **comprueba el tamaño de cada fichero** y sólo entonces la hace visible, moviéndola de
`_incoming/` a su sitio de un tirón. Así el vigilante nunca ve una sesión a medio copiar.

Encuentra la grabación **la llamen como la llamen**: `iso1.mp4` de las sesiones sintéticas o
`... CAM 1 ....mp4` del ATEM, esté suelta en la carpeta o dentro de una subcarpeta. Si dentro hay dos
grabaciones, se planta y las nombra en vez de elegir una.

## Desatendido, de la carpeta a la entrega

```sh
pnpm --filter @doslineas/worker start     # vigila la carpeta y ejecuta los pasos
pnpm --filter @doslineas/api start        # el panel, en http://localhost:4310
pnpm cli status                           # o lo mismo por consola
```

Los cinco comandos de arriba dejan de teclearse: el vigilante espera a que una sesión **lleve un rato sin que
cambie ningún fichero** —lo que evita empezar a montar mientras el ATEM todavía escribe—, comprueba que está
entera y la encola. Si le falta un ISO o el programa, **levanta un aviso en vez de montar media grabación**.

La cola es SQLite con **trabajos arrendados**: dentro de una sesión los pasos van en orden, entre sesiones hay
paralelismo, y si el worker muere a mitad de un render el arriendo caduca y el paso vuelve a la cola. Cada paso
**mira si su salida ya está** antes de correr, así que reanudar no repite 45 minutos de render.

**El bruto no se borra solo.** Se entrega, se deja un recibo, y sólo cuando una persona confirma —y se ha
comprobado que cada fichero entregado sigue en su destino y con su tamaño— desaparecen los ISO, el programa y
los WAV. `pnpm cli confirm <sesion> --dry-run` dice qué se iría sin tocar nada. El porqué, en `docs/pipeline.md`.

## El encoder, elegible sin conocer FFmpeg

```sh
pnpm cli edit .work/ep01 --render --encoder h264_nvenc            # NVIDIA
pnpm cli edit .work/ep01 --render --encoder h264_qsv --preset best # Intel, sin prisa
```

`--preset` toma una **intención** —`fastest`, `balanced`, `best`— y cada encoder la traduce a su propio
vocabulario, porque `veryfast` es de x264 y NVENC quiere `p1` y AMF quiere `speed`. Quien sepa lo que hace
puede pasar el preset nativo y va tal cual. Medido en este PC sobre 40 s a 720p: NVENC 3,7 s, x264 4,6 s,
QSV 5,5 s. Los detalles y la trampa de comparar tamaños, en `docs/encoders-y-medicion.md`.

## El montaje, medido contra el anexo A

Los dos generadores del plan: `turnCuts` reacciona al cambio de interlocutor y `refreshCuts` refresca el
plano dentro del mismo turno. El solver aplica mínimo, máximo y densidad, y **descarta primero los cortes
de refresco**, que son los prescindibles.

Sobre una sesión sintética de 3 minutos: **11,9 cortes/min**, plano p10/mediana/p90 de **2,0 / 4,5 / 9,8 s**
y **22 refrescos frente a 12 cortes de turno** — la mayoría de los cortes caen a mitad de intervención, que
es el hallazgo del anexo A que gobierna todo el diseño.

Un *golden test* congela el EDL de una conversación fija: si alguien mueve un valor del perfil, el cambio
aparece en el diff en vez de descubrirse a ojo tres semanas después.

Y `measure` ya no mide sólo la intención: sobre una carpeta de sesión enfrenta **lo que el EDL quería con lo
que el render enseña**, usando el mismo método del anexo A que se aplicó a los vídeos de referencia
(`select=gt(scene,0.25)`, `silencedetect`).

```sh
pnpm cli measure .work/ep01      # intención, resultado y la diferencia
pnpm cli measure master.mp4      # sólo lo que se ve
```

Hoy eso confirma dos cosas sobre material sintético: la salida dura lo que el EDL dice con 0,02 s de
diferencia, y **no queda ni un silencio de más de 1 s** habiendo recortado tres. Lo que **no** se puede
comprobar todavía son los cortes: las cuatro cámaras sintéticas se parecen tanto que el detector de escena no
ve un corte entre ellas, y el comando lo dice en vez de dejar creer que el montaje falló.

## Quién habla, medido y no opinado

La detección se prueba contra la **verdad conocida** de las sesiones sintéticas: acierta **más del 95 %** de
la sesión con filtración a −18 dB, y sigue por encima del 90 % con filtración severa a −8 dB. Cuando la
filtración se come el margen de dominancia (−2 dB), **no se inventa un hablante**: se calla.

## Riesgos con banco de pruebas

| Riesgo | Estado |
|---|---|
| R1 · Render de la conmutación | **Resuelto.** Una sola pasada. Ver `docs/spike-r1-switching-render.md`. |
| R2 · Filtración entre micros | **Mitigado.** Dominancia relativa con histéresis; probado hasta −8 dB de filtración. |
| R3 · El audio del programa sigue al conmutador | **Descartado** por el cliente el 18/08/2026. |
