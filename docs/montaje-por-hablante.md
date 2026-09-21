# Montaje por hablante y arranque por frase

Las cinco correcciones que Piru pidió el 06/09/2026 después de ver el primer master y los cuatro clips
verticales del episodio del 02/09.

## Lo que pidió

1. Los clips cortos, sin título encima; los subtítulos, como estaban.
2. El plano general **solo** cuando hablan los dos a la vez.
3. La cámara de un ponente **solo** mientras ese ponente habla.
4. Con la presentación en pantalla, el recuadro lleva a quien habla y cambia cuando cambia el turno; nunca
   el plano general.
5. El vídeo arranca en la frase de bienvenida, un segundo antes; fuera lo de sentarse y colocar el micro.

## Cómo quedó

### El plano general deja de ser un recurso de ritmo

Hasta ahora el montaje tenía tres generadores de corte —turno, refresco y hueco— y un solver que además
rellenaba planos demasiado largos alternando cámaras. Ese mecanismo es el que metía el plano general cada
pocos segundos y el que sacaba 13 cortes por minuto.

El perfil trae ahora `switching.mode`. Con `"dynamic"` no cambia nada. Con `"speaker"` el montaje sale de
una sola fuente: **quién está hablando**. Un plano dura lo que dura el turno; el general aparece únicamente
en los tramos de solape, y en los silencios se mantiene el plano que hubiera. `solveCuts` en este modo solo
aplica el mínimo de plano —para que un cruce de medio segundo no produzca un parpadeo— y salta el relleno
por plano máximo y el ajuste de densidad.

La consecuencia es un montaje mucho más quieto: en este episodio, 62 planos en vez de 321, y 2,5 cortes por
minuto en vez de 13,3. Es lo que la regla pide: si alguien contesta durante minuto y medio seguido, su
cámara aguanta minuto y medio.

### Los dos a la vez

`detectSpeech` no servía para esto: cuando dos niveles se acercan, la dominancia falla y **devuelve nada**,
que es lo mismo que devuelve en un silencio. Hacía falta un sensor propio.

`detectOverlaps` recorre las mismas envolventes y marca la ventana como solape cuando **dos entradas pasan
del ruido de fondo** por el margen de siempre y **ninguna manda** sobre la otra. Reutiliza la histéresis de
apertura y cierre, así que un cruce corto —el "ya, ya" de quien escucha— no dispara un corte al general.

### El recuadro de la pantalla

El recuadro salía de la ISO del plano general con `-itsoffset`. Ahora `screen.insetSource` acepta
`"speaker"`, y en ese modo el recuadro **es el propio master**: la segunda pasada de FFmpeg parte `[0:v]`
en dos con `split`, una copia hace de fondo y la otra se encoge para la esquina. Como la primera pasada ya
conmuta por hablante, el recuadro sigue el turno solo, sin lógica nueva y sin decodificar un tercer vídeo.

Para que ahí tampoco entre el general, los tramos de pantalla se calculan **antes** de montar y se le pasan
al motor: un solape que cae dentro de un tramo de pantalla no genera corte al general.

### Arrancar en la bienvenida

El principio de la grabación es gente sentándose. Recortarlo por energía no vale: se está hablando.

`intro.phrases` lleva las frases con las que se abre el episodio. Antes de analizar, el CLI saca los
primeros `searchSeconds` del audio de programa a FLAC mono de 16 kHz, los manda a Deepgram y busca la
primera aparición de cualquiera de las frases, comparando palabra a palabra sin acentos, sin mayúsculas y
sin puntuación. Lo que hay hasta `leadSeconds` antes de esa palabra se convierte en un descarte `manual` que
entra en el EDL como uno más, así que todo lo de después —transcripción, clips, subtítulos, alineación del
audio— sigue cuadrando sin tocar nada. `mergeDiscards` funde ese descarte con el silencio de cabecera que
el recorte de silencios ya marcaba.

Sin `DEEPGRAM_API_KEY`, o si ninguna frase aparece, avisa y no recorta nada. `--no-intro` lo desactiva.

### La carpeta de salida

`edit --out <dir>` escribe el EDL, el FCPXML, los ficheros de FFmpeg y los masters donde se le diga, en vez
de dentro de la carpeta del bruto. Los comandos siguientes —`transcribe`, `captions`, `clips`— ya aceptaban
una carpeta cualquiera, así que basta con apuntarlos ahí. Sirve para probar un montaje distinto sin pisar el
anterior.

### Los títulos de los clips

`captions.withTitle` del perfil de clips, a `false`. Los subtítulos animados no se tocan.

## El destello de medio segundo

Encontrado el 06/09 al ver los clips: en el clip 2 hablaba uno y salía el otro, y en el master había tramos
largos con el plano equivocado.

El detector acertaba —en ese tramo el micro de quien hablaba estaba 14 dB por encima del otro—; fallaba el
montaje. Cuando alguien termina su turno queda un **destello de medio segundo** de su micro. Ese destello
abría plano en su cámara, y el corte que venía justo después, el que devolvía el plano a quien de verdad
hablaba, lo tiraba la regla de plano mínimo: los dos cortes son de la misma prioridad, así que gana el
primero. El plano equivocado se quedaba **76 segundos**.

En el modo dinámico el fallo no se veía: los cortes de refresco movían la cámara cada pocos segundos y
tapaban el error. Al pedir el cliente que el plano aguante todo el turno, quedó al descubierto entero.

`turnsOf` consolida los tramos antes de montar: junta los seguidos del mismo micro y descarta los que no
llegan al plano mínimo, y vuelve a juntar lo que quede pegado. Así un "ajá" de medio segundo no roba el
plano y un turno largo no se parte porque la dominancia parpadee un instante en mitad.

Medido sobre el episodio entero: la cámara que se ve coincide con quien habla en el **99,5 % de los 1.266 s
de habla**. Los 6 s restantes caen en los bordes de los cortes.
