# Clips verticales para redes (fase 3)

Lo que hace la fase 3: pasar el episodio a texto, elegir qué momentos merecen un clip, y sacar cada uno en
vertical con subtítulos animados. Este documento cuenta las decisiones que no se leen en el código.

## La transcripción va contra el máster, no contra el bruto

Deepgram recibe el audio de `master.mp4`, no el WAV del ATEM. Es la decisión más importante de la fase y la
razón es simple: **el máster ya tiene los silencios fuera**, así que sus tiempos son los tiempos de la pieza
que se entrega. Si transcribiéramos el bruto habría que traducir cada marca de palabra a la línea de salida
cada vez que se toca algo, y esa traducción es exactamente el tipo de cuenta que se rompe en silencio.

Con esta elección, un instante del transcript, un instante del EDL y un instante del máster **son el mismo
número**. Los recortes, los subtítulos y el seguimiento de cámara caen solos.

El audio se manda en FLAC mono a 16 kHz: es lo que pide un reconocedor y baja un episodio de 90 minutos a
unas decenas de megas. **El vídeo nunca sale del NAS.** El fichero intermedio se borra al terminar salvo que
se pase `--keep-audio`.

## Quién habla: el EDL le pone nombre a la diarización

Deepgram devuelve `speaker 0`, `speaker 1`… y no sabe cómo se llaman. Nosotros sí: el EDL dice qué cámara
estaba en pantalla en cada instante y `episode.json` dice quién es cada cámara.

`nameSpeakers` cruza las dos cosas **por mayoría, no palabra a palabra**: cuenta, para cada etiqueta de
Deepgram, a qué persona apuntaba el montaje mientras hablaba, y se queda con la más votada. Por mayoría
porque un corte que entra medio segundo tarde no puede cambiar el nombre de un turno entero. Si la etiqueta
sale sobre todo en el plano general, se deja como está en vez de adivinar, y **dos etiquetas nunca reciben
el mismo nombre**.

## Elegir momentos: el modelo propone, las reglas responden

La selección tiene dos motores y el segundo no es un plan de emergencia, es la red que hace fiable al primero.

**Las reglas** puntúan cada ventana posible de la conversación con siete señales medibles: densidad de
palabras, ajuste a la duración objetivo, si abre y cierra en una pausa, si hay más de una voz, si aparecen
palabras gancho y si hay una pregunta. Los pesos y las palabras gancho están en `config/clip-profile.json`:
**ningún criterio editorial vive en el código**.

**El modelo** recibe la transcripción numerada por intervenciones y devuelve índices de intervención, nunca
segundos. Es deliberado: un modelo puede inventarse un tiempo, pero un índice o existe o no existe, y si no
existe se descarta sin discusión. Lo que devuelve pasa además por `fromPicks`, que recorta lo que se pasa de
largo, alarga lo que se queda corto, tira lo que se solapa y avisa de cada cosa que ha tocado.

Si el modelo da menos momentos usables de los pedidos, **las reglas completan la lista** sin quitar los que
sí valían. Sin `ANTHROPIC_API_KEY`, o con `--rules`, se trabaja solo con reglas. En los tres casos sale el
mismo tipo de plan.

## El recorte vertical es el único sitio donde se toca el encuadre

El cliente descartó el reencuadre por software y eso sigue en pie para el máster horizontal. En el clip
vertical hay que recortar por fuerza —de 16:9 a 9:16 no se llega de otra manera—, así que el recorte se hace
del modo más aburrido posible: **una ventana fija por cámara**, configurada en `anchors`, que salta cuando
salta el plano.

No hay seguimiento facial ni encuadre que persiga a nadie. La `x` del recorte es una expresión de FFmpeg que
vale lo mismo durante todo un plano y cambia en el corte, construida como suma de términos `gte(t,a)*lt(t,b)*x`
en vez de `if` anidados: es plana, se lee, y **exactamente un término está activo en cada instante**. Si un
clip llegara a tener más planos de los que aguanta una expresión razonable, se usa el ancla dominante en vez
de generar un filtro ilegible.

Existe además el modo `blur`, que mete la imagen entera dentro del vertical sobre una copia desenfocada.
Nadie se queda fuera de cuadro nunca. Es la opción segura si el encuadre de las cámaras no da para recortar.

## Los subtítulos se pegan como los rótulos

Cada clip lleva un WebM transparente renderizado con Remotion y superpuesto con FFmpeg, igual que los
rótulos de la fase 2. La palabra que suena se colorea con el acento del kit.

**Cuidado con el alfa.** El decodificador de vp9 que FFmpeg elige por defecto descarta el canal alfa de un
WebM sin avisar de nada: el render sale bien, con el código de salida cero, y el overlay tapa la imagen con
un negro opaco. Hay que forzar `-c:v libvpx-vp9` **en la entrada** del overlay. Esto afectaba también a los
rótulos de la fase 2, donde pasó desapercibido porque el material de prueba era opaco; ahora hay una prueba
con transparencia real que falla si alguien quita el decodificador.

## Probarlo sin Deepgram y sin cliente

`pnpm cli mock-transcript` se inventa una transcripción coherente con un `edl.json` que ya exista: palabras
repartidas por los planos, atribuidas a quien tocaba y con algunas palabras gancho dentro. No sustituye a
una transcripción real, pero permite ejercitar selección, plan, subtítulos y render de punta a punta sin
gastar un euro ni esperar al material del cliente.

```sh
pnpm cli edit .work/ep01 --render
pnpm cli mock-transcript .work/ep01
pnpm cli clips .work/ep01 --rules --render
```

## Lo que falta por medir

Todo lo de arriba está probado contra sesiones sintéticas. Con material real quedan por comprobar tres cosas:
si Deepgram acierta con el español del estudio, si las anclas por defecto (centro de cada cámara) encuadran
bien a las personas de verdad, y cuánto tarda el render vertical fuera de este PC. Las tres necesitan la
grabación de prueba.
