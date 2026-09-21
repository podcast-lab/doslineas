# Spike R1 — el render de la conmutación

**Fecha:** 19/08/2026 · **Estado: resuelto, gana la vía A (una sola pasada).**

R1 era el mayor riesgo de implementación del plan: conmutar ~900 cortes en un episodio de 90 minutos sin
que el filtrograma de FFmpeg reviente ni obligue a decodificar los 4 ISO varias veces.

## Resultado

La vía preferida del plan funciona: **`streamselect` gobernado por `sendcmd`, con los 4 ISO decodificados
una sola vez**, y los silencios recortados con `select`/`setpts` en esa misma pasada. Es además la más
rápida: la vía B (dos pasadas) tarda **1,6 veces más** y escribe un intermedio enorme.

### Medidas — 1920x1080 a 25 fps, 120 s de fuente, 19 cortes y 9 silencios

Windows 11, ffmpeg 8.1, libx264 `veryfast` CRF 20, sin GPU, contenido sintético.

| Vía | Tiempo | x tiempo real | Duración de salida | Extrapolado a 90 min |
|---|---|---|---|---|
| **A · una pasada** | 12,2 s | **9,8x** | exacta | **~9 min** |
| B · dos pasadas | 20,1 s | 6,0x | exacta | ~15 min (+ intermedio de ~14,5 GB) |
| Control: recodificar 1 ISO sin conmutar | 9,5 s | 12,6x | — | ~7 min |

Contra el control se lee lo que de verdad cuesta el sistema: **conmutar entre 4 ISO y recortar silencios
añade un 28 % sobre recodificar un solo vídeo**. El grueso del tiempo es la codificación, no la lógica.

### Prueba de esfuerzo — densidad real de un episodio de 90 min

857 cortes y 428 silencios sobre 300 s de fuente (más denso que un episodio real): la vía A los aguanta,
tarda 10,3 s y **la salida dura exactamente lo que dice el EDL**.

La conmutación se verifica automáticamente por color: cada ISO sintético lleva un tono distinto, se
muestrea un fotograma en mitad de cada plano y se comprueba de qué entrada viene. **8 de 8 aciertos.**

## Los tres hallazgos que cambian el código

**1 · `select` no acepta órdenes en caliente.** `streamselect.map` está marcado como comandable (`T`) en
`ffmpeg -h filter=streamselect`, pero `select.expr` **no**. El plan daba por hecho que `sendcmd` podría
gobernar las dos cosas. No puede: `sendcmd` sirve solo para conmutar de cámara, y **los silencios tienen
que ir como expresión**.

**2 · El parser de expresiones de FFmpeg revienta a partir de ~90 términos.** Una expresión
`not(between(t,a,b)+between(...)+…)` con 100 sumandos falla con `Cannot allocate memory` al inicializar
los filtros; con 90 pasa. Un episodio de 90 minutos tiene entre 300 y 600 silencios, así que la vía obvia
—una sola expresión— **no llega ni de lejos**.

La solución es encadenar varios `select`, cada uno con un trozo de las ventanas: como `select` no toca los
tiempos, encadenarlos equivale a sumar las condiciones. El código trocea de **40 en 40**, con margen de
sobra sobre el techo medido, y hay un test de regresión que falla si alguna expresión se acerca a él.

**3 · Las rutas dentro del filtrograma hay que entrecomillarlas.** En Windows, `sendcmd=f=C\:/ruta` no
vale: FFmpeg parte por los dos puntos igualmente. Lo único que funciona es **entrecomillar y además
escapar**: `sendcmd=f='C\:/ruta/comandos.txt'`.

## Qué falta por medir, y con qué

Los tiempos de arriba se han medido sobre **material sintético**, que se decodifica más barato que H.264
real de cámara, y en un PC con Windows que no es la máquina de destino. Sirven para comparar las dos vías
entre sí —que es para lo que existe el spike—, **no como promesa de plazo**.

El número bueno sale de repetir esto sobre la **grabación de prueba** del cliente y en el NAS que monte
Enrique. El spike ya está preparado para eso: `pnpm spike` acepta resolución, fps, densidad de cortes y
encoder por variables de entorno, así que medir en la máquina real es ejecutar un comando.

## Cómo reproducirlo

```sh
pnpm spike                                    # 1080p25, 120 s
SPIKE_DURATION=300 SPIKE_SHOT=0.35 pnpm spike   # prueba de esfuerzo
SPIKE_ENCODER=h264_nvenc SPIKE_PRESET=p4 pnpm spike   # con GPU NVIDIA
```

El código que construye los comandos y el filtrograma **no es del spike**: vive en
`packages/media/src/switching-render.ts` y es el que usará la fase 1.
