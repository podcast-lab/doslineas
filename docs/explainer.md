# El explicativo con pantalla dividida (fase 4)

El segundo formato del acuerdo: unos diez minutos de una persona explicando algo con la pantalla de su ordenador
entrando por la cuarta entrada del ATEM. El apartado 2.3 del plan rev 4 lo define en dos frases, y las dos
gobiernan el diseño: **la señal la da la pantalla, no el micrófono**, y **la persona no desaparece nunca del
cuadro**.

## Por qué la señal no puede ser el audio

En el podcast el micrófono dice a qué cámara cortar porque hay varias personas turnándose. En el explicativo
habla una sola: el audio no distingue nada. Lo que cambia a lo largo del vídeo es **la pantalla**, y como entra
por su propio canal del ATEM se puede medir igual que se mide una voz.

Así que la fase 4 es la fase 1 con otro sensor: en vez de una envolvente de energía por micrófono, una
**envolvente de cambio por fotograma**.

## Cómo se mide que la pantalla está trabajando

Se sacan fotogramas en gris a 4 por segundo y a 64x36, y se cuenta **qué proporción de píxeles cambió** respecto
al fotograma anterior más de una tolerancia. Reducir tanto la imagen no es un atajo: es el filtro. A 64x36 el
ruido de compresión y el parpadeo del cursor desaparecen, y lo que queda es el cambio que una persona vería.

De ahí sale un número entre 0 y 1 por fotograma, y sobre ese número van dos umbrales, no uno:

- **`changedRatio` (0,02).** Cambio pequeño y sostenido: alguien escribe, dibuja o mueve el ratón sobre un
  documento. Para abrir hace falta que aguante `openMs`.
- **`jumpRatio` (0,12).** Cambio grande e instantáneo: **una diapositiva.** Abre de inmediato, sin esperar.

El segundo umbral no estaba en el primer diseño y hubo que añadirlo: exigir movimiento sostenido hacía que **un
cambio de diapositiva no activara nunca la pantalla**, y el plan nombra las diapositivas explícitamente junto con
escribir y dibujar. Una diapositiva es un solo fotograma distinto seguido de quietud; con un único umbral
sostenido es invisible.

Para cerrar se pide quietud durante `closeMs` (1,5 s), más lento que abrir. El perfil rechaza una configuración
donde cerrar sea más rápido que abrir, porque eso produce parpadeo.

## Cómo se decide la composición

Las ventanas de actividad se asientan antes de convertirse en planos:

1. **Se alargan `tailSeconds` (2 s)** después de que la pantalla se quede quieta. Es el margen de seguridad que
   pide el plan: si el sistema se equivoca, que se equivoque dejando la pantalla un par de segundos de más.
2. **Se estiran hasta `minHoldSeconds` (3 s)** si son más cortas. Una pantalla que aparece y se va en medio
   segundo es peor que no haberla puesto.
3. **Se funden las que quedan a menos de `minHoldSeconds` una de otra.** El hueco entre dos diapositivas seguidas
   no da para un plano de persona que se entienda, así que no se hace.
4. Si el primer bloque de persona o el último quedan por debajo del mínimo, **se los come la pantalla**. Antes eso
   que un plano de dos segundos al principio del vídeo.

El resultado es `explainer-plan.json`: bloques contiguos, sin huecos ni solapes, alternando `person` y `screen`,
en **tiempo de la grabación** (no de la salida). Es revisable sin renderizar, igual que el EDL y el
`brand-plan.json`.

## La composición: dos imágenes y un conmutador

El render no compone «un poco de cada cosa»: prepara **las dos imágenes completas** y conmuta entre ellas, que es
exactamente lo que ya se demostró en el spike R1 para el máster.

- `person`: la cámara frontal a pantalla completa.
- `screen`: la pantalla ajustada al cuadro con barras si hace falta, y **la persona incrustada en una esquina**.

Un `streamselect` gobernado por `sendcmd` elige cuál sale en cada momento. Una sola pasada de FFmpeg, cortes
limpios, y los silencios largos fuera con el mismo mecanismo que el máster.

Que la persona esté en la esquina **no es decoración, es la red de seguridad**: si la detección se equivoca, lo
peor que pasa es que la pantalla salga de más, pero nadie se queda fuera de plano. Hay una prueba que renderiza de
verdad y comprueba que, mientras manda la pantalla, la esquina sigue teniendo a la persona.

## O hay tercer invitado o hay pantalla

El comando se niega a trabajar si la cuarta entrada lleva una cámara en vez de una pantalla, y lo dice con esas
palabras. No es una limitación del software sino de las cuatro conexiones del ATEM (apartado 7.6 del plan), y más
vale que salte al principio que descubrirlo en el render.

## Probarlo

```sh
pnpm cli generate-session .work/exp --duration 120 --input4 screen
pnpm cli explainer .work/exp             # escribe explainer-plan.json y dice qué bloque entra y cuándo
pnpm cli explainer .work/exp --render    # y deja explainer.mp4
```

La pantalla de las sesiones sintéticas **pasa diapositivas en ráfagas** —diez segundos cambiando, veinte quietos—
porque una pantalla que cambia sin parar no distingue entre un detector que funciona y uno que se deja todo
encendido. Sobre 120 s sintéticos salen cuatro bloques de pantalla y cuatro de persona.

`spikes/probe-activity.ts` imprime la envolvente de cambio de cualquier vídeo. Es la herramienta para calibrar
`changedRatio` y `jumpRatio` cuando llegue una grabación real, que es lo único que falta aquí: los dos umbrales
están razonados y probados contra material sintético, **no medidos contra una pantalla de verdad**.
