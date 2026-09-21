# Encoders por hardware y medición del resultado

Dos puntos de deuda técnica cerrados el 25/08/2026 sin esperar a la grabación del cliente.

## Los encoders por hardware

El adaptador tenía los cuatro encoders desde la fase 0, pero **sólo se había ejecutado `libx264`**. Al
probarlos, dos de los cuatro estaban rotos:

```
h264_nvenc  Error setting option preset to value veryfast
h264_amf    Error setting option quality to value veryfast
```

La causa: **`preset` no es un vocabulario común**. Cada encoder tiene el suyo y no se parecen.

| Encoder | Qué acepta | Con qué manda la calidad |
|---|---|---|
| `libx264` | `ultrafast … veryslow` | `-crf` |
| `h264_qsv` | `veryfast … veryslow` | `-global_quality` |
| `h264_nvenc` | `p1 … p7` | `-cq` |
| `h264_amf` | `speed`, `balanced`, `quality` | `-qp_i` / `-qp_p` |
| `h264_videotoolbox` | `-realtime 0` / `1` | `-b:v`, un bitrate |

QSV funcionaba de casualidad, porque comparte las palabras de x264.

**La solución no es documentar la tabla, es no obligar a nadie a conocerla.** `--preset` acepta ahora una
**intención de velocidad** —`fastest`, `balanced`, `best`— que cada encoder traduce a lo suyo. Quien sepa lo
que hace puede seguir pasando el preset nativo (`--preset p7`, `--preset veryslow`) y pasa tal cual.

El valor por defecto es `fastest`, que en x264 resuelve a `veryfast`: **el máster se codifica exactamente
igual que antes de este cambio**. Un test lo congela para que nadie lo mueva sin darse cuenta.

Además, `--encoder` ya no se castea a ciegas: un nombre que no existe dice cuáles hay en vez de reventar
dentro de FFmpeg.

### Lo medido en el PC de desarrollo

40 s de sesión sintética a 1280x720, i9-12900H con Iris Xe y RTX 3060:

| Encoder | Tiempo | Tamaño | Perfil |
|---|---|---|---|
| `h264_nvenc` | 3,7 s | 28,3 MB | Main |
| `libx264` | 4,6 s | 15,6 MB | High |
| `h264_qsv` | 5,5 s | 17,6 MB | High |
| `h264_amf` | — | — | no hay GPU AMD en esta máquina |

**Cuidado con comparar los tamaños:** `-crf 20`, `-cq 20`, `-global_quality 20` y `-qp 20` **no son la misma
escala**. Cambiar de encoder con el mismo `--quality` cambia el bitrate. Normalizar eso entre fabricantes es
un agujero sin fondo; lo que hay que hacer es **elegir el número una vez, sobre material real, para el
encoder que se vaya a usar en el NAS**.

`h264_amf` queda **probado en argumentos pero no en ejecución**. Falla aquí porque no hay GPU AMD, y el error
que da es el de FFmpeg al no encontrar el dispositivo, que es lo correcto.

## La medición del resultado

Hasta ahora `pnpm cli measure` medía **el EDL**: la intención. El plan pide medir **la salida** con el método
del anexo A (`select=gt(scene,0.25)` y `silencedetect`), que es lo que se usó sobre los vídeos de referencia
del cliente. Sin eso no se estaba comprobando el resultado, sólo la aritmética.

`measure` acepta ahora tres cosas:

```sh
pnpm cli measure <sesion>/      # la intención, el resultado y la diferencia
pnpm cli measure master.mp4     # sólo lo que se ve en un vídeo
pnpm cli measure edl.json       # sólo la intención, como antes
```

Y compara contra el perfil: si los cortes/min caen fuera del rango del anexo A, lo dice.

### El hallazgo que importa

**Sobre las sesiones sintéticas el método del anexo A no ve ni un corte.** Las puntuaciones de escena entre
las cuatro cámaras sintéticas son de ~0,03, muy por debajo del 0,25 del anexo:

| Umbral | Cortes detectados |
|---|---|
| 0,25 | 0 |
| 0,10 | 0 |
| 0,03 | 1 |
| 0,001 | 221 |

No es un fallo del medidor: es que **las cuatro cámaras sintéticas se parecen demasiado entre sí**. Son
variaciones del mismo `lavfi` con un número encima; un corte entre ellas no cambia la imagen lo suficiente
como para que `scene` lo note. Con cámaras reales apuntando a personas distintas, un corte es un cambio de
plano completo.

Por eso el comando **avisa explícitamente** cuando no ve ningún corte habiendo cortes planeados, en vez de
dejar creer que el montaje salió mal. El medidor está verificado contra un vídeo construido con cortes y
silencios conocidos, donde encuentra los tres cortes y el silencio exactos.

### Lo que sí valida hoy

Dos cosas, y no son menores:

- **La duración de la salida coincide con la del EDL** con 0,02 s de diferencia. El render hace lo que el EDL
  dice.
- **`silencedetect` no encuentra ni un silencio de más de 1 s en el máster**, habiendo recortado tres. El
  recorte de silencios **está comprobado sobre el resultado**, no sobre la intención.

## Lo que sigue esperando a la grabación real

- **Los cortes/min y la duración de plano medidos sobre la salida**, que es la comprobación que cierra el
  círculo del anexo A. Hoy sólo se puede medir el silencio.
- **Elegir el encoder y su número de calidad** en el NAS, midiendo tiempo y tamaño sobre un episodio de
  verdad.
- **Ejecutar `h264_amf`** en una máquina con GPU AMD, si el NAS acaba llevando una.
- **Ejecutar `h264_videotoolbox`** en el Mac del estudio. Es el único encoder de la lista que no tiene
  presets ni escala de calidad: `--preset` se traduce a `-realtime`, y la calidad va por **bitrate**
  (`--quality 24M`), con 16M por defecto. En un Mac Intel la calidad constante (`-q:v`) no está disponible,
  y por eso no se usa. Antes de fiarse, en esa máquina:
  `ffmpeg -h encoder=h264_videotoolbox` y un encode de diez segundos.
