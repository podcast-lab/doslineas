# Fase 5 — puesta en marcha

La fase 5 no escribe una sola línea de vídeo. Las cinco piezas que montan, marcan, transcriben, cortan y
explican ya existían y se ejecutaban a mano. Esto es lo que las encadena: un vigilante de carpeta, una cola
con trabajos arrendados, dos procesos que las ejecutan, una entrega y un borrado del bruto que sólo ocurre
cuando alguien lo confirma.

## Las piezas

```
packages/pipeline/     el orden de los pasos, la cola, la entrega y el borrado. Sin framework.
apps/worker/           NestJS: vigila la carpeta y ejecuta los pasos.
apps/api/              NestJS: el panel de estado y lo que se puede tocar desde él.
```

`packages/pipeline` no sabe que Nest existe, igual que `packages/core`. Las dos cáscaras se limitan a
construir los adaptadores y a arrancar los bucles.

## El orden de los pasos

| Paso | Comando que ejecuta | Deja |
|---|---|---|
| `edit` | `cli edit <dir> --render` | `edl.json`, `edit.fcpxml`, `master.mp4` |
| `brand` | `cli brand <dir> --render` | `brand-plan.json`, `master-branded.mp4` |
| `transcribe` | `cli transcribe <dir>` | `transcript.json` |
| `captions` | `cli captions <dir>` | `transcript.vtt`, `.srt` y `.txt` del máster |
| `clips` | `cli clips <dir> --render` | `shorts-plan.json`, los verticales y sus subtítulos |
| `explainer` | `cli explainer <dir> --render` | `explainer-plan.json`, `explainer.mp4` |
| `deliver` | nada externo | `delivery-receipt.json` y los ficheros en el destino |

El paso `captions` no estaba en la lista de cinco piezas que se ejecutaban a mano, y se añadió al ver que
sin él **la entrega salía sin los subtítulos del máster**: `transcribe` deja el `transcript.json` pero los
ficheros que el cliente abre los escribe `cli captions`, que hasta ahora había que teclear aparte.

**Los pasos se ejecutan como procesos aparte, llamando a la misma CLI que se usa a mano.** No es pereza: un
render de Remotion levanta varios Chromium, y un worker que vive semanas no debe cargar con esa memoria ni
morirse cuando FFmpeg se cae. Un paso que revienta es un proceso que revienta; el worker sigue en pie y el
trabajo vuelve a la cola. Además, lo que se depura a mano y lo que corre desatendido son literalmente el
mismo comando.

**El explicativo se salta solo.** Si el `edl.json` dice que la entrada 4 lleva un tercer invitado en vez de
una pantalla, el paso se marca como `skipped` con ese motivo y la sesión sigue. Es el apartado 7.6 del plan:
o hay invitado o hay pantalla.

## La cola

SQLite con trabajos arrendados, detrás del puerto `JobQueue`. Sin Redis, que para cuatro trabajos a la
semana es coste sin beneficio.

- **Dentro de una sesión los pasos van en orden**, y sólo hay uno en vuelo a la vez. **Entre sesiones hay
  paralelismo**: dos sesiones distintas pueden estar en dos workers.
- **El arriendo se renueva con un latido** mientras el paso corre. Si el worker muere a mitad de un render,
  el arriendo caduca y el trabajo vuelve a la cola con un aviso; el intento ya se ha contado, así que un
  proceso que se estrella en bucle acaba parando en vez de repetirse para siempre.
- **Un paso que falla vuelve a `pending`** hasta agotar los intentos, y entonces queda en `failed` y levanta
  un aviso. Los pasos de detrás no arrancan: no tiene sentido cortar clips de un máster que no existe.
- `retry` devuelve a la cola lo que falló, y con `--step` re-ejecuta uno concreto aunque ya estuviera hecho.

Se usa `node:sqlite`, el SQLite que trae Node, y no `better-sqlite3`: en el NAS no hace falta compilar nada.
Como todavía es experimental y los empaquetadores no lo conocen, se carga desde `packages/pipeline/src/sqlite.ts`
con `createRequire`, que es lo que hace que Vitest pueda con él.

## Idempotencia

Cada paso mira si su salida ya está antes de correr. Si todos sus artefactos existen y ninguna de sus
entradas es más nueva que ellos, el paso se marca hecho sin ejecutar nada. Con renders de 45 minutos,
reanudar sin repetir no es un lujo.

Se compara por fecha de modificación, no por hash: sobre ficheros de 50 GB un hash cuesta más que el propio
render.

## El vigilante

Escanea la carpeta cada `DOSLINEAS_SCAN_SECONDS` y sólo mira directorios que tengan algún `isoN.mp4`.

- **Una sesión no entra hasta que lleva `DOSLINEAS_QUIET_SECONDS` sin que cambie ningún fichero.** Es lo que
  evita empezar a montar mientras el ATEM o la copia del SSD siguen escribiendo.
- Cuando ya está quieta se inspecciona: si le falta un ISO, el programa o el `.drp`, o si algún fichero no se
  puede leer, **se levanta un aviso de sesión incompleta y no se encola nada**. Un ISO corrupto es un aviso,
  nunca una excepción que tumbe el bucle.
- Lo que ya está en la cola no se vuelve a mirar.

## La entrega y el borrado del bruto

La entrega va detrás del puerto `Delivery`; hoy el adaptador copia a una carpeta. Deja un
`delivery-receipt.json` en la sesión con cada fichero, su destino y su tamaño.

**El borrado del bruto no es automático y no va por fecha.** El plan dice «al confirmar la entrega», no «a
los 7 días», que es el techo y no el ritmo. Confirmar es una acción de una persona, desde el panel o con
`cli confirm`, y antes de borrar nada se comprueba que:

1. hay un recibo legible,
2. el recibo lleva un máster —no se tiran 220 GB porque se haya entregado un `edl.json`—,
3. **cada fichero entregado sigue en su destino y con el mismo tamaño** que dice el recibo.

Si algo de eso falla, no se borra nada y se explica por qué. Sólo entonces desaparecen los `isoN.mp4`, el
programa, los WAV, el `.drp` y los intermedios; el máster, los clips, los subtítulos y el EDL se quedan.
`--dry-run` dice qué se iría sin tocar nada, y el botón del panel lo usa para preguntar antes.

## Configuración

Todo por entorno, sin fichero nuevo:

| Variable | Por defecto | Para qué |
|---|---|---|
| `DOSLINEAS_STUDIO` | `doslineas` | Va en la primera tabla, para no migrar a dolor cuando haya más de un estudio |
| `DOSLINEAS_SESSIONS` | `<repo>/sessions` | Dónde caen las sesiones |
| `DOSLINEAS_DELIVERY` | `<repo>/delivered` | Dónde se entrega |
| `DOSLINEAS_DB` | `<repo>/state/jobs.db` | La cola y los avisos |
| `DOSLINEAS_REPO` | el directorio actual | Desde dónde se llama a la CLI |
| `DOSLINEAS_QUIET_SECONDS` | `120` | Cuánto silencio pide una sesión para entrar |
| `DOSLINEAS_SCAN_SECONDS` | `30` | Cada cuánto se mira la carpeta |
| `DOSLINEAS_LEASE_MINUTES` | `5` | Cuánto dura un arriendo sin latido |
| `DOSLINEAS_MAX_ATTEMPTS` | `2` | Intentos antes de rendirse |
| `DOSLINEAS_TRANSCRIBER` | `deepgram` | `mock` usa `mock-transcript` y no gasta ni una llamada |
| `DOSLINEAS_PORT` | `4310` | El panel |

## Cómo se levanta

```
pnpm --filter @doslineas/worker start     # vigila y ejecuta
pnpm --filter @doslineas/api start        # el panel, en http://localhost:4310
```

Y a mano, cuando algo hay que rescatar:

```
pnpm cli status                    # en qué paso va cada sesión y qué avisos hay
pnpm cli retry <sesion>            # devuelve a la cola lo que falló
pnpm cli confirm <sesion> --dry-run
pnpm cli confirm <sesion>          # comprueba la entrega y borra el bruto
```

## Lo que queda por probar fuera de aquí

Todo esto se ha ejercitado contra sesiones sintéticas. Con material real hay que ver **cuánto silencio pide
de verdad una sesión** para no entrar a medio copiar, y **cuánto tarda cada paso** para dimensionar el
arriendo. Los dos son números de configuración, no código.
