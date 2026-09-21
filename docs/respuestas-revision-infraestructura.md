# Respuestas al documento de revisión de infraestructura

Respuesta punto por punto al documento **«Infraestructura técnica, entrega y retención del contenido»**
(Dos Líneas, 25 de agosto de 2026). Preparado para la reunión del viernes 28 de agosto.

## Antes de entrar

**El documento parte de la revisión 3 del plan técnico (10/08). El acuerdo firmado el 14/08 ancla el alcance
a la revisión 4**, por su nombre y su fecha: *«El detalle técnico de todo esto está en el documento Plan
técnico, revisión 4 del 14 de agosto de 2026, que acompaña a este acuerdo.»*

La revisión 4 cerró dos cosas que este documento vuelve a preguntar: que **no habrá reencuadre por software**
y que **cada sesión es de tres invitados o de pantalla dividida, nunca las dos cosas**. Además, el documento
es anterior a las decisiones tomadas con el estudio el 18 y el 19 de agosto y describe el software en futuro,
cuando **las cinco fases están construidas y funcionando**.

Eso no le quita valor: la parte de infraestructura, capas de almacenamiento y ciclo de vida está bien
planteada y hace falta. Pero conviene no reabrir lo que ya está decidido.

### Cómo leer las marcas

| Marca | Significado |
|---|---|
| **RESUELTO** | Ya está decidido y construido. Se puede enseñar funcionando. |
| **RESPONDIDO** | Contesto yo con datos; falta que el estudio valide o decida. |
| **NECESITA GRABACIÓN** | Sólo se cierra con la grabación de prueba. Es el bloqueo nº 1. |
| **NO ES MÍO** | Es de Enrique o es decisión comercial de Piru. Aporto lo que tengo. |
| **FUERA DE ALCANCE** | No entra en las cinco fases del acuerdo. Ver el último apartado. |

---

## 1 · Flujo general de la solución

**1.1 ¿Dónde escribe físicamente el ATEM durante la grabación y qué capacidad mínima necesita ese soporte?**
· NECESITA GRABACIÓN / NO ES MÍO

El ATEM Mini Pro ISO **graba sólo a disco USB-C**; su Ethernet únicamente sube a Blackmagic Cloud. No puede
escribir en un NAS por red. A ~45 MB/s sostenidos (4 ISO + programa a 70 Mb/s más los WAV), una sesión de 90
minutos son **unos 220-240 GB**, así que el SSD de captura debería ser de **1 TB** para aguantar varias
sesiones sin vaciarlo cada día.

**Por qué:** es un hecho verificado del hardware, no una opinión, y condiciona todo lo demás. La idea de
conectar el ATEM por USB-C al NAS para que lo vea como disco (*USB gadget mode*) tiene un nudo que no se
arregla configurando: una placa x86 normal sólo tiene USB *host*, no *device*; y lo que sí puede hacer modo
dispositivo —tipo Raspberry Pi— va a USB 2.0, unos 35-40 MB/s, por debajo de los 45 MB/s que escribe el ATEM.
**La máquina capaz de emular el disco es demasiado floja para renderizar, y la capaz de renderizar no puede
emular el disco.** El respaldo, gratis y sin comprar nada, es enchufar el SSD al NAS al pasar por el estudio.

**1.2 ¿En qué momento se considera que una grabación ha terminado y quién lo detecta?** · RESUELTO

Lo detecta el software. El vigilante mira la carpeta cada 30 segundos y **sólo acepta una sesión cuando lleva
120 segundos sin que cambie ningún fichero** y además pasa la verificación de completitud. Los dos valores son
configuración (`DOSLINEAS_SCAN_SECONDS` y `DOSLINEAS_QUIET_SECONDS`), no código.

**Por qué:** el ATEM no avisa de que ha terminado, así que la única señal fiable es que los ficheros dejen de
crecer. El periodo de silencio es lo que evita empezar a montar mientras el ATEM o la copia del SSD siguen
escribiendo, que es el error caro: montarías media grabación y parecería un fallo del programa.

**1.3 ¿Cuál es el recorrido exacto de captura a entrega?** · RESUELTO

```
SSD del ATEM → carpeta vigilada → verificación → cola
  → edit      (edl.json, edit.fcpxml, master.mp4)
  → brand     (brand-plan.json, master-branded.mp4)
  → transcribe(transcript.json)
  → captions  (transcript.vtt / .srt / .txt)
  → clips     (shorts-plan.json, clip-N.mp4 + subtítulos)
  → explainer (explainer-plan.json, explainer.mp4)   sólo si la entrada 4 es pantalla
  → deliver   (copia al destino + delivery-receipt.json)
  → confirmación humana → borrado del bruto
```

**Por qué:** cada paso deja un artefacto en disco, así que el recorrido no es un diagrama: es la lista de
ficheros que puedes mirar en cualquier momento para saber por dónde va una sesión.

**1.4 ¿El pipeline arranca A) al finalizar, B) al detectar ficheros cerrados, o C) tras copiar y validar?**
· RESUELTO — **B**

Arranca al detectar que los ficheros están cerrados y completos, que es lo que hace el vigilante.

**Por qué:** A es imposible, porque el ATEM no emite ninguna señal de fin. C añade una copia de 220 GB antes de
empezar, con el coste de tiempo y de disco que eso supone, para protegerse de algo que la verificación ya
cubre. Si más adelante se quiere control del ATEM por Ethernet —su protocolo está documentado y hay librerías
maduras en Node—, la detección pasaría de heurística a dato y esta pregunta desaparecería.

**1.5 ¿Se procesa A) desde el NAS, B) copiando a NVMe local, o C) híbrido?**
· RESUELTO — **A**, decidido con el estudio el 19/08

El bruto se guarda en el NAS y **el worker corre en ese mismo NAS**, leyendo del directorio local.

**Por qué:** si el bruto vive en el NAS y renderiza otro PC, hay que leer ~220 GB por la red en cada sesión —
media hora a 1 Gbps sólo leyendo, antes de procesar nada. En la misma máquina es disco local y el tránsito de
red es cero. Además sustituye entera la línea de «comprar un PC de montaje» del presupuesto, y un NAS está
encendido siempre por definición, que es justo lo que necesita un vigilante.

---

## 2 · Herramientas y entorno de ejecución

**2.1 ¿Qué se ejecuta en local y qué depende de servicios externos?** · RESUELTO

En local, **todo el vídeo**: FFmpeg (montaje, máster, marca, clips, explicativo), Remotion (intro, cierre,
rótulos, subtítulos animados), el orquestador entero (vigilante, cola, worker, panel) y todo el análisis
—quién habla, silencios, clasificación de la entrada 4, actividad de pantalla—, que no toca la red.

Salen del estudio **exactamente dos cosas**, las mismas dos que el acuerdo dice que contrata y paga el estudio:

| Servicio | Qué sale | Formato |
|---|---|---|
| Deepgram | el audio del **máster ya montado** | FLAC **mono a 16 kHz**, sin vídeo |
| Modelo de lenguaje | la **transcripción en texto** | intervenciones numeradas con tiempo y hablante |

**El vídeo no sale del estudio en ningún momento. Ni un fotograma.**

**Por qué:** se transcribe el máster y no el bruto porque el máster ya tiene los silencios fuera, así que un
instante del transcript, uno del EDL y uno del máster **son el mismo número**; y de paso lo que se envía baja
de 220 GB a decenas de megas. Mono a 16 kHz es calidad de voz: es lo que necesita un motor de transcripción y
nada más.

**2.2 ¿Qué necesita disco local y qué puede ir sobre almacenamiento de red?** · RESPONDIDO

Funcionalmente todo puede ir sobre red, porque todo son ficheros. En rendimiento, lo que duele es la
**lectura simultánea de los cuatro ISO** durante el montaje: son ~35 MB/s sostenidos sólo de lectura y con
cuatro flujos a la vez. Remotion y los temporales son ligeros en comparación.

**Por qué:** es la razón técnica por la que el worker vive en el NAS. Con esa decisión la pregunta se vuelve
teórica: no hay almacenamiento de red en el camino.

**2.3 ¿Qué dependencias hay que mantener para que el pipeline sea reproducible?** · RESPONDIDO

- **Node 22 o superior** y **pnpm 9**.
- **FFmpeg 7 o superior en el PATH.** Probado con 8.1 y 9.0.1.
- **Remotion**, que descarga su propio Chrome la primera vez. No hay que instalar navegador a mano.
- Opcionalmente los **drivers del encoder por hardware** (NVENC, QSV o AMF) si se quiere acelerar.
- Nada más. No hay base de datos que instalar: la cola es SQLite embebido en Node.

**Por qué:** la lista es corta a propósito. Cuantas menos piezas haya que mantener en una máquina que va a
estar encendida sin que nadie la mire, menos cosas se rompen solas. Por eso también se usa el SQLite que trae
Node en vez de uno que haya que compilar.

**2.4 ¿Todo en A) una máquina, B) repartido, o C) local con procesos en cloud?**
· RESUELTO — **A**, con la matización de 2.1

Una sola máquina: el NAS. Los dos servicios externos son llamadas puntuales, no procesos.

**Por qué:** `apps/api` y `apps/worker` van **separados desde el primer día aunque arranquen en la misma
máquina**. Eso es lo que permite mañana levantar varios workers, o poner el panel en otro sitio, sin
reescribir nada. La cola ya soporta varios workers en paralelo: dentro de una sesión los pasos van en orden,
entre sesiones hay paralelismo.

**2.5 ¿La transcripción A) siempre cloud, B) local, o C) configurable?**
· DECISIÓN PENDIENTE DEL ESTUDIO — **hay que tomarla el viernes**

Hoy es cloud (Deepgram), como fija la revisión 4. Está **detrás de un puerto**, así que un adaptador local
(Whisper) no es un rediseño: es escribir el adaptador.

**Por qué hay que decidirlo antes de comprar el hardware:** el coste de transcribir en local no es de
programación, es de máquina. **Consume la misma CPU que necesita el render.** Si la política de trazabilidad
del estudio exige que nada salga, el equipo que compre Enrique tiene que ser más grande. Decidirlo después de
comprar es el orden equivocado.

---

## 3 · Costes e inversión

· NO ES MÍO — es de Enrique y de Piru. Lo que aporto:

- **Servicios externos por sesión:** transcripción ~0,40 €, modelo de lenguaje ~0,05 €. Están en el acuerdo
  firmado y los contrata y paga el estudio.
- **Licencia de Remotion:** gratuita hasta tres personas en la empresa.
- **Coste si un mes no se graba: cero por mi parte.** No hay suscripción, ni cloud mínimo, ni licencias. Los
  dos servicios se pagan por uso.
- **3.5**, sobre alertas o límites de consumo: Deepgram y Anthropic permiten fijar límites de gasto en el
  panel del proveedor. Recomiendo **C**, alertas y límites, porque un bucle de reintentos mal configurado es
  la forma clásica de descubrir un consumo raro a fin de mes.

**Por qué:** el coste variable del software es de céntimos por sesión. Lo que cuesta dinero es el hardware, la
electricidad y el disco, y eso lo dimensiona Enrique.

---

## 4 · Independencia de proveedores

**4.1 ¿Qué módulos se pueden sustituir y con qué contratos?** · RESUELTO

Cada pieza sustituible ya está detrás de un puerto con su contrato escrito en TypeScript:

| Puerto | Qué aísla | Adaptador de hoy |
|---|---|---|
| `Transcriber` | transcripción | Deepgram |
| `HighlightPicker` | elección de momentos | modelo de lenguaje, con reglas de respaldo |
| `Delivery` | entrega al destino | copia a carpeta |
| `JobQueue` | la cola de trabajos | SQLite con trabajos arrendados |
| `AlertStore` | los avisos | SQLite |
| `StepRunner` | ejecución de un paso | proceso aparte llamando a la CLI |

**Por qué:** `packages/core` no depende de ningún framework y no sabe que existe ninguno de esos proveedores.
Es la regla que hace que cambiar de proveedor sea escribir un fichero, no tocar el motor de montaje.

**4.2 ¿Cómo se abstrae almacenamiento y entrega para cambiar entre NAS, S3 o Blackmagic Cloud?** · RESUELTO

La entrega va detrás del puerto `Delivery`: un adaptador S3 o rclone es una clase con un método. La ingesta
lee de **un directorio**, así que le da igual si es un disco del NAS, un SSD enchufado o un punto de montaje.

**Por qué:** es exactamente lo que evitó que el cambio de Blackmagic Cloud al NAS costara un rediseño. Esa
decisión dio tres vueltas en una tarde y no obligó a tocar el motor.

**4.3 ¿Qué metadatos propios deben conservarse siempre?** · RESPONDIDO

Ya se conservan, y son independientes del proveedor: identificador de sesión, estudio, directorio, cada paso
con su estado, intentos, marca de inicio y fin y motivo del fallo; el EDL completo con todas las decisiones de
montaje; y el recibo de entrega con cada fichero, su destino y su tamaño en bytes.

**Por qué:** `estudioId` está en la primera tabla desde el principio, aunque hoy sólo haya un estudio. Añadir
multi-tenant después es una migración dolorosa; ponerlo desde el día uno es una columna.

**4.4 ¿Modularidad A) completa o B) sólo en transcripción, IA, almacenamiento y entrega?** · RESUELTO — **B**

Es lo que hay hecho, y es lo que recomiendo.

**Por qué:** modularizar por si acaso lo que nunca se va a cambiar es coste sin beneficio. FFmpeg y Remotion no
se van a sustituir: son la decisión, no un proveedor.

**4.5 ¿Configuración A) en código, B) externa, o C) desde un panel?** · RESUELTO — **B**

Todo lo de montaje va en ficheros JSON (`config/edit-profile.json`, `brand-kit.json`, `clip-profile.json`,
`explainer-profile.json`) y todo lo de infraestructura en variables de entorno. **Ningún número de montaje
está escrito en el código.**

**Por qué:** el panel (C) tiene sentido cuando hay varios estudios y alguien no técnico tiene que cambiar
valores. Hoy sería construir una interfaz para que una persona edite cuatro ficheros al año.

---

## 5 · Motor de montaje y dependencias de entrada

**5.1 ¿Cuál es el conjunto mínimo para considerar una sesión válida?** · RESUELTO

Los **cuatro ISO** (`iso1.mp4` a `iso4.mp4`), cada uno con vídeo **y con su audio embebido**; el **programa**
(`program.mp4`), de donde sale el audio del máster; y el **`session.drp`**. Además, las cuatro duraciones deben
coincidir **dentro de un fotograma**.

**Por qué:** el audio embebido en cada cámara es lo que permite saber quién habla midiendo, en vez de
adivinando. Si las voces acaban mezcladas en una sola pista, el programa deja de poder saberlo — y eso está en
el punto 4 del acuerdo firmado como responsabilidad del estudio. Lo de las duraciones es porque si los ISO no
están alineados, todos los cortes salen desplazados.

**5.2 ¿Qué hace el pipeline si falta una fuente o está corrupta?** · RESUELTO

Verifica **antes de tocar nada** y, si algo falla, **se planta, dice exactamente qué falta y levanta un aviso**
en el panel. No monta media sesión. Detecta: ISO ausente o vacío, ISO ilegible o corrupto, ISO sin vídeo, ISO
sin audio embebido, programa ausente, `.drp` ausente y ISO desalineados.

**Por qué:** un ISO corrupto es un aviso, nunca una excepción que tumbe el vigilante — si un fichero malo
parara el bucle, se pararían también las sesiones buenas que vengan detrás. Y montar con material incompleto
produce un vídeo que parece un fallo del programa cuando en realidad es un fallo de grabación.

**5.3 ¿Cómo se asocia cada archivo con su cámara, persona, sala, sesión y cliente?** · RESPONDIDO

Hoy: la **cámara** por el número del fichero (`isoN.mp4`) según el reparto de entradas del acuerdo; la
**sesión** por el nombre de la carpeta; la **persona** por un `episode.json` en la carpeta de la sesión, y si
no está, por nombres genéricos de rol. **Sala y cliente no existen todavía como campos.**

**Por qué, y qué hace falta de vosotros:** ésta es una de las tres preguntas abiertas que tengo con el estudio
desde hace días — **de qué campo de la reserva salen los nombres de los invitados**, para que su flujo lo deje
en la carpeta y nadie escriba un fichero a mano cada semana. Si me lo decís el viernes, lo cierro.

**5.4 ¿Reglas A) un perfil fijo, B) por tipo de sesión, o C) versionados por cliente?** · RESUELTO — **A**

Un perfil, `config/edit-profile.json`, con los valores medidos sobre vuestros vídeos de referencia.

**Por qué:** el estudio se alquila, así que la marca y el criterio son los del estudio, no los de cada cliente.
Ya se decidió lo mismo con el kit de marca. La estructura admite más perfiles el día que haga falta, pero
mantener perfiles por cliente sin que nadie los haya pedido es trabajo que se paga en mantenimiento.

**5.5 ¿Ante una fuente ausente A) detener, B) degradar, o C) ambas?** · RESUELTO — **A**, con escape manual

Se detiene y avisa. Existe `--force` para seguir a sabiendas.

**Por qué:** con vídeo, la degradación silenciosa es peor que el fallo. Un máster montado con tres cámaras en
vez de cuatro no se ve roto: se ve mediocre, y nadie lo mira hasta que el cliente se queja. Un aviso se ve el
mismo día.

---

## 6 · Entradas del ATEM y nomenclatura

**6.1 ¿Qué ficheros produce el ATEM, con qué nombres y estructura?** · NECESITA GRABACIÓN

Hoy el software espera `iso1.mp4` … `iso4.mp4`, `program.mp4` y `session.drp`, que es el convenio de las
sesiones de prueba que uso para desarrollar. **El convenio real del ATEM no lo he visto todavía.**

**Por qué importa, y lo que pido:** ajustar la ingesta a los nombres reales es un cambio de media hora, pero no
lo puedo hacer a ciegas. **Y no hace falta la grabación entera: me vale una captura del listado de la carpeta
del SSD.** Es lo más barato que podéis darme y desbloquea la ingesta y el vigilante a la vez.

**6.2 ¿Cómo distingue el software una pantalla de una cámara y dónde queda registrado?** · RESUELTO

Contando **fotogramas duplicados** en la entrada 4 sobre una muestra de 30 segundos: una pantalla de ordenador
está quieta la mayor parte del tiempo, una persona no. La decisión queda escrita en el `edl.json` de la
sesión, en el rol de la fuente.

**Por qué:** es una medición barata y sin red, coherente con el resto del diseño. Y queda registrada en el EDL
porque el EDL es el sitio donde vive cada decisión de montaje: así se puede auditar por qué el sistema hizo lo
que hizo, sin volver a procesar.

**6.3 ¿Puede cambiar el reparto entre salas o tipos de sesión y dónde se declara?** · RESPONDIDO

El reparto está en el perfil (`inputs` e `input4.forcedRole`), así que cambiarlo es editar un JSON. Pero **el
acuerdo firmado fija el reparto** —1 general, 2 y 3 ponentes, 4 pantalla o tercer invitado— como
responsabilidad del estudio.

**Por qué:** el programa se apoya en ese orden para saber qué es cada archivo. Si cambia entre salas sin
avisar, el montaje sale mal y no hay forma de detectarlo automáticamente.

**6.4 ¿La entrada 4 se identifica A) automática, B) por selección previa, o C) ambas?**
· RESUELTO — **C**, ya implementado

Automática por defecto, con `forcedRole` en el perfil para forzarla cuando se sepa de antemano.

**Por qué:** la detección automática acierta y no obliga a nadie a acordarse de nada, que es lo que se pide de
un sistema desatendido. Pero cuando el tipo de sesión se conoce al reservar, forzarlo elimina hasta la
posibilidad del error. Las dos vías cuestan lo mismo, así que están las dos.

**6.5 ¿Configuración A) fija por sala, B) por sesión, o C) heredada de la reserva?** · RESPONDIDO — **C**

Es lo mejor si vuestro sistema de reservas puede dejar un fichero en la carpeta. Es la misma pregunta que 5.3.

**Por qué:** heredarlo de la reserva es lo único que no depende de que una persona se acuerde cada semana.

---

## 7 · Fases de implantación

**7.1 ¿Qué infraestructura mínima necesita la fase 1 para ser funcional de principio a fin?** · RESPONDIDO

Una máquina con Node, FFmpeg y disco, y una carpeta donde caigan las sesiones. Nada más. **No hace falta NAS,
ni red rápida, ni portal.** Los números concretos están en el apartado **«Mínimo y óptimo»**: con 4 núcleos,
8 GB y 500 GB libres el circuito completo funciona.

**Por qué:** todo está detrás de puertos y nada está atado al NAS. Es un requisito que mantuve a propósito:
**si el NAS se retrasa, el sistema tiene que poder correr en una máquina normal**, y lo cumple hoy.

**7.2 ¿En qué fase hacen falta NAS, entrega web, firma, retención y borrado automático?** · RESPONDIDO

- **NAS:** en cuanto haya sesiones reales, por capacidad. No por arquitectura.
- **Borrado del bruto al confirmar:** hecho, en la fase 5.
- **Entrega web, firma y retención facturada:** ver el último apartado. No están en las cinco fases.

**7.3 ¿Qué se puede dejar preparado para no migrar después?** · RESUELTO

Ya está: `estudioId` en la primera tabla, la cola detrás de un puerto para pasar a Redis el día que haga falta,
`api` y `worker` separados desde el día uno, y la entrega detrás de un puerto para cambiar de destino.

**Por qué:** son cuatro decisiones que hoy no cuestan nada y que después cuestan una migración. Es la lista
del apartado 4 del plan técnico, y se tomaron el primer día por eso.

**7.4 y 7.5** · NO ES MÍO — dimensionado e inversión son de Enrique y Piru.

---

## 8 · Criterios de éxito y control de errores

**8.1 ¿Qué condiciones marcan una sesión como procesada correctamente?** · RESUELTO

Que **todos sus pasos estén en `done` o `skipped`**. Un paso está en `done` cuando su comando terminó con
código cero y dejó sus ficheros; `skipped` es para lo que no aplica, como el explicativo en una sesión de tres
invitados. Con eso la sesión pasa a `delivered`.

**Por qué:** el criterio es la existencia de los artefactos, no la opinión del programa sobre sí mismo. Si el
fichero no está, el paso no está hecho, y da igual lo que diga el registro.

**8.2 ¿Qué se reintenta solo y qué requiere intervención?** · RESUELTO, con un hueco que señalo

Se reintenta automáticamente cualquier fallo, hasta 2 intentos, y luego queda en `failed` con un aviso. Si el
worker muere a mitad de un render, **el arriendo caduca y el paso vuelve solo a la cola** sin repetir los
pasos anteriores.

**El hueco, y prefiero decirlo yo:** hoy no se distingue un error de red de un fallo real. Si se cae Internet
durante la transcripción, el paso agota sus intentos y **queda marcado como fallido esperando que alguien
reintente**, en vez de esperar a que vuelva la línea. Es un arreglo pequeño pero **no está hecho**. Ver 14.2.

**Por qué el intento se cuenta también cuando el proceso se estrella:** si no se contara, un fallo que revienta
el proceso se repetiría para siempre. Contándolo, un bucle de caída acaba parando y avisando.

**8.3 ¿Qué eventos se registran para reconstruir una incidencia días después?** · RESUELTO

Por cada paso: estado, número de intentos, qué worker lo tenía, cuándo empezó, cuándo terminó y **el motivo
exacto del fallo con las últimas líneas de salida del proceso**. Más los avisos, con su marca de tiempo y si
alguien los ha visto. Todo en la base de datos de la cola, consultable desde el panel o desde consola.

**Por qué:** las últimas líneas de FFmpeg o de Remotion son lo que permite diagnosticar sin reproducir. Sin
eso, «falló el render» no es información.

**8.4 ¿Una sesión correcta exige A) vídeo, B) vídeo + clips, o C) todos los entregables?** · RESPONDIDO — **C**

Es lo implementado, y creo que es lo correcto.

**Por qué:** si se acepta como buena una sesión sin clips, nadie se entera de que los clips llevan una semana
fallando. Un entregable que falta debe verse el mismo día.

**8.5 ¿Ante error A) avisar, B) reintentar y avisar si persiste, o C) combinar?** · RESUELTO — **B**

Se reintenta en silencio y **sólo se avisa cuando se agotan los intentos**.

**Por qué:** avisar del primer fallo genera avisos que nadie lee, y un aviso que nadie lee es peor que no
tenerlo. La mayoría de fallos transitorios se arreglan al segundo intento.

---

## 9 · Responsabilidades e incidencias

· NO ES MÍO en la parte organizativa. Lo que aporto para 9.1 y 9.2:

**La frontera técnica está donde el vigilante acepta la sesión.** Antes de eso —grabar, que los ficheros
lleguen completos a la carpeta— es del estudio, y el punto 4 del acuerdo firmado lo dice: *disco suficiente y
no borrar el material en bruto antes de que el sistema lo haya procesado*. Después de aceptada, es mía.

**Y esa frontera es observable, no una opinión:** si una sesión llega incompleta, **queda registrado un aviso
con la lista exacta de lo que falta y la hora**. Si existe en el SSD pero nunca llegó al NAS, el sistema nunca
la vio y no hay registro — que es en sí mismo la respuesta a 9.2.

**Para 9.3**, la información mínima de una incidencia es: identificador de sesión, paso, hora y el texto del
error. Todo eso sale del panel **sin abrir un solo fichero de vídeo**, que es lo que pide la pregunta.

---

## 10 · Capacidad de almacenamiento

· NO ES MÍO el dimensionado. Los datos que aporto:

**10.1 Tamaño de una sesión** · NECESITA GRABACIÓN

Estimación: **220-240 GB** para 90 minutos, a partir de los ~45 MB/s que escribe el ATEM. Sin medir sobre
material real.

**10.2 Espacio adicional durante el proceso** · RESPONDIDO

Las salidas son **una fracción pequeña del bruto**: máster, máster con marca, explicativo y clips rondan
juntos los **15-20 GB** por sesión de 90 minutos, frente a los 220 GB del bruto. Los temporales de verdad
—filtros, comandos, gráficos— son megas, y **se borran al confirmar la entrega** junto con el bruto.

**Por qué esto simplifica la conversación:** el dimensionado del NAS lo manda **cuántas sesiones en bruto
conviven a la vez**, no el procesado. El procesado es ruido al lado del bruto. Es una estimación a partir de
material sintético; el número real sale con la grabación de prueba.

**10.3 ¿Cuántas sesiones coexisten?** · NO ES MÍO — depende de la política de retención, que es decisión
comercial de Piru. Técnicamente, con el borrado al confirmar la entrega, **una sesión deja de ocupar 220 GB en
cuanto el cliente acepta**, no a los siete días.

---

## 11 · Capas de almacenamiento y workspace

El modelo de cuatro capas del documento me parece correcto y lo suscribo. Sobre las preguntas:

**11.1 ¿Dónde se guarda mientras se graba?** · Ver 1.1. SSD USB-C del ATEM, sin alternativa.

**11.2 ¿Dónde espera turno una sesión?** · RESUELTO

En la misma carpeta donde cayó. **No se mueve.**

**Por qué:** mover 220 GB para que esperen en otro sitio es media hora de disco a cambio de nada. La cola sabe
en qué directorio está cada sesión.

**11.3 ¿Dónde viven los temporales y quién los elimina?** · RESUELTO

En la propia carpeta de la sesión, y los elimina el paso de confirmación junto con el bruto. La lista es
explícita —nada de comodines— y está escrita en el código: los cuatro ISO, el programa, los WAV, el `.drp`, el
audio extraído y los ficheros de filtros.

**Por qué la lista es explícita:** borrar 220 GB del material del cliente es la operación más peligrosa del
sistema. Un comodín que un día coincida de más es una pérdida irreversible. Sólo se borra lo que está nombrado.

**11.4 ¿FFmpeg A) desde el NAS, B) desde NVMe local, o C) híbrido?** · RESUELTO — **A**. Ver 1.5.

**11.5 ¿Los resultados A) directos al NAS o B) locales y luego copiados?** · RESUELTO — **A**

Se escriben donde está la sesión, que es el NAS. La entrega copia después al destino **y verifica byte a
byte** que lo copiado tiene el tamaño que debía.

**Por qué:** escribir local y copiar después tiene sentido cuando el destino es lento o remoto. Aquí el destino
es el mismo disco. La verificación de tamaño no es paranoia: es la condición sin la cual no se borra el bruto.

---

## 12 · Retención del contenido

· **FUERA DE ALCANCE** en su parte de producto, y **decisión comercial de Piru**. Pero hay una confusión
técnica que conviene deshacer antes de decidir nada:

**El documento habla de «retención» como una sola cosa. Son dos, y no coinciden:**

| | Qué es | Cuánto pesa | Qué hace hoy el sistema |
|---|---|---|---|
| **El bruto** | los cuatro ISO, el programa, los WAV | ~220 GB | se borra **al confirmar la entrega** |
| **Lo entregado** | máster, clips, explicativo, subtítulos | ~15-20 GB | se queda |

**Por qué importa tanto:** lo que tiene sentido retener siete días —y vender extendido— es **lo segundo**. Si
se mezclan, acabáis pagando disco por conservar ISOs en bruto que nadie va a volver a abrir, y que además son
el 92 % del volumen. Y el plan siempre dijo que los siete días eran **el techo, no el ritmo**: el bruto se va
en cuanto el cliente acepta.

**12.3 ¿Qué información no sensible conservar tras borrar?** · RESPONDIDO

Ya se conserva sin el contenido: el recibo de entrega con la lista de ficheros, sus tamaños y su destino; la
fecha y hora de la confirmación; y el histórico completo de pasos de la sesión.

---

## 13 · Entrega, aceptación y prueba

· **FUERA DE ALCANCE.** El acuerdo define la fase 5 como *«entrega automática, avisos de error y pantalla de
estado»*. Un portal con aceptación o firma, registro de IP y texto aceptado es una aplicación web aparte, y el
propio documento se la asigna a «Piru + desarrollo web».

**Lo que sí existe hoy y le sirve de base a quien lo construya:**

El sistema entrega los ficheros al destino y deja un **recibo técnico** (`delivery-receipt.json`) con: estudio,
sesión, destino, fecha y hora, y **cada fichero entregado con su tipo, su ruta de origen, su ruta de destino y
su tamaño exacto en bytes**. Más un campo de confirmación con su fecha.

**Por qué esto es medio bloque 13 ya hecho:** la evidencia técnica que pide la pregunta 13.2 —qué fichero se
ofreció y cuándo— ya se está generando. Lo que falta es la parte humana: la página donde el cliente lo ve y lo
acepta. Si se construye, **debería llamar a la confirmación que ya existe** en lugar de inventar otra, porque
es la que dispara el borrado del bruto con sus comprobaciones.

---

## 14 · Dependencia de Internet y continuidad

**14.1 ¿Qué se completa sin Internet?** · RESUELTO

**Todo menos dos pasos.** Montaje, máster, marca, clips verticales, explicativo, subtítulos y entrega a
carpeta funcionan con la línea caída. Sólo necesitan Internet la **transcripción** y la **elección de
momentos** — y esta última tiene un modo de reglas que funciona sin red.

**Por qué:** es consecuencia directa de que el vídeo no salga nunca del estudio.

**14.2 ¿Cómo queda registrada una tarea pendiente cuando no hay Internet?** · **HUECO REAL, no está hecho**

Hoy: el paso agota sus dos intentos, queda en `failed` y levanta un aviso. **No espera a que vuelva la línea.**

**Por qué lo digo yo antes de que lo preguntéis:** es el único punto del documento donde la respuesta honesta
es «esto todavía no». El arreglo —distinguir un error de red de un fallo real y esperar con reintentos
espaciados en vez de rendirse— es pequeño, y prefiero que esté en la lista del viernes que descubrirlo en
octubre con una sesión parada un fin de semana.

**14.3 ¿Cuánto puede trabajar una sala sin conectividad?** · RESPONDIDO

Indefinidamente para grabar y montar. Lo que se acumula es la transcripción pendiente, que es lo que bloquea
los clips. **El disco no es el límite: el límite es que los clips no salen hasta que haya línea.**

**14.4 y 14.5** · NO ES MÍO. Sobre 14.5 recomiendo **B**: continuar en local y dejar en cola lo externo — que
es justo lo que hay que arreglar según 14.2.

---

## 15 · Datos enviados a proveedores externos

**15.1 ¿Qué se envía a cada proveedor?** · RESUELTO — ver 2.1

A Deepgram, el audio del máster en FLAC mono a 16 kHz. Al modelo de lenguaje, la transcripción en texto. **El
vídeo no sale nunca.**

**15.2 ¿Qué retención aplica cada proveedor y es configurable?** · RESPONDIDO PARCIALMENTE

Los dos proveedores ofrecen opciones de no retención en sus planes; **hay que confirmarlo en la cuenta
concreta que contrate el estudio**, porque depende del plan. Es una comprobación de diez minutos en el panel
de cada proveedor, y la tiene que hacer quien sea titular de la cuenta.

**Por qué no lo doy por hecho:** la política de retención va asociada a la cuenta y al plan, no al API. Afirmar
que no retienen sin haberlo mirado en la cuenta del estudio sería exactamente el tipo de promesa que este
documento intenta evitar.

**15.3 ¿Qué se puede anonimizar antes de enviar?** · RESPONDIDO

Hoy salen, además del audio: **el nombre de la sesión** y **los nombres de los hablantes** dentro de la
transcripción. Los dos se pueden sustituir por identificadores antes del envío; es un cambio pequeño.

**Por qué lo señalo sin que se pregunte:** es el único dato identificable que sale del estudio, y si vais a
llevar trazabilidad de información sensible de vuestros clientes, es el punto exacto que os van a preguntar.

**15.4 y 15.5** · Ver 2.5. Es la decisión que hay que tomar el viernes porque afecta al hardware.

---

## 16 · Máquina de procesamiento

El documento pide una lista concreta. Aquí está, con lo que puedo y lo que no puedo dar todavía.

**Lo medido, y en qué máquina:** las pruebas están hechas en un portátil con **Intel i9-12900H, con gráficos
Iris Xe y una RTX 3060 Laptop**, sobre **sesiones sintéticas**, no sobre material real.

**16.1 ¿Qué CPU, GPU, RAM y disco hacen falta?** · RESPONDIDO con medición propia

Ver el apartado **«Mínimo y óptimo»** más abajo, que es la respuesta completa a esta pregunta.

**Lo que hay que retener antes de comprar:** medí el pipeline entero y **hace pico en 2,8 GB de RAM**, no en
32 GB. La cifra de 32 GB que circulaba venía de suponer que Remotion levanta muchos Chromium; medido, levanta
**seis procesos** y el pico está en el paso de clips. Con eso, la máquina que hay que comprar es bastante más
barata de lo que parecía.

**Sobre la GPU, un dato medido:** los tres encoders por hardware están probados. Sobre 40 segundos a 720p,
**NVENC 3,7 s, libx264 4,6 s y QSV 5,5 s**. La diferencia existe pero no es abismal, y **como grabáis a 25 y
30 fps y no a 50/60, la carga de decodificación es la mitad de lo que estimé al principio**: por eso la GPU
pasa de recomendada a opcional.

**Un aviso para cuando se elija:** `-crf`, `-cq`, `-global_quality` y `-qp` **no son la misma escala**. El
mismo número de calidad da bitrates muy distintos según el encoder — en mi prueba, 15,6 MB con libx264 frente
a 28,3 MB con NVENC. Hay que elegir el número una vez, sobre material real, para el encoder que acabe
corriendo en el NAS.

**16.2 ¿Cuántas sesiones simultáneas?** · NECESITA GRABACIÓN

La cola ya permite varias sesiones en paralelo. Cuántas caben sin degradar es una medición que no tengo.

**16.3 ¿Qué pasa si la máquina se reinicia durante un render?** · RESUELTO — **reanuda**

El arriendo del paso caduca, el paso vuelve solo a la cola y **los pasos anteriores no se repiten**. Además,
cada paso comprueba si su salida ya existe antes de ejecutarse: si el fichero está y ninguna de sus entradas
es más nueva, se da por hecho sin gastar un segundo.

**Por qué se compara por fecha y no por hash, como sugiere el plan:** sobre ficheros de decenas de GB, calcular
un hash cuesta más que rehacer el render. La fecha de modificación da la misma respuesta a un coste
despreciable.

**16.4 y 16.5** · NO ES MÍO comprar. Sobre 16.5, ver 1.5: **A**, sobre el NAS.

---

## 17 · Arquitectura general y estado de sesión

**17.1 ¿Cuál es el recorrido de «grabando» a «eliminada»?** · RESUELTO

Cada sesión tiene siete pasos, y cada paso uno de cinco estados: `pending`, `leased` (en ejecución), `done`,
`skipped` (no aplica) o `failed`. De ahí sale el estado de la sesión: **`waiting` → `running` → `delivered`**,
o `failed` si algún paso agotó sus intentos. Tras la confirmación humana, el bruto desaparece y queda el
recibo con su fecha de confirmación.

**Por qué hay `skipped` y no sólo `done`:** un explicativo que no se hace porque la sesión era de tres
invitados no es un éxito ni un fallo, y confundirlo con cualquiera de los dos hace que el panel mienta.

**17.2 ¿Qué sistemas contienen copia en cada estado?** · RESPONDIDO

Hoy dos: la carpeta de la sesión y el destino de entrega. El recibo registra **exactamente** dónde quedó cada
fichero entregado.

**17.3 ¿Cuál es la fuente de verdad del estado?** · RESUELTO

**La base de datos de la cola.** Es la única que decide qué está hecho y qué no.

**Por qué:** con dos fuentes de verdad acabas con dos respuestas distintas a la misma pregunta y sin forma de
saber cuál vale. El disco es la evidencia, la cola es la verdad, y la cola se apoya en el disco para
comprobarla.

**17.4 ¿Arquitectura A) local, B) híbrida, o C) cloud-first?** · RESUELTO — **A**

Local, con dos llamadas externas.

**Por qué se descartó el cloud:** son ~220 GB por sesión. En la nube lo caro no es calcular —serían unos 6 € al
mes— sino **guardar**: entre 45 y 90 € al mes por 1 TB. Y subir el bruto por la línea del estudio no es
viable.

**17.5 ¿El NAS será A) sólo almacenamiento, B) + copia temporal, o C) + servicios y base de datos?**
· RESUELTO — **C**

El NAS es almacenamiento, worker, panel y base de datos.

**Por qué:** es la consecuencia de 1.5. Y la base de datos no añade carga: es un fichero SQLite que gestiona
cuatro trabajos a la semana.

---

## 18 · Red y comunicaciones

· NO ES MÍO. Un dato que puede ahorraros dinero:

**Si el worker corre en el NAS, la red deja de estar en el camino crítico.** Los ~35 MB/s de lectura simultánea
de los cuatro ISO son **disco local, no red**. La red sólo tiene que mover la copia inicial desde el SSD y la
entrega final, que son operaciones puntuales y no simultáneas con el render.

**Por qué lo digo:** la pregunta 18.4 plantea 1, 2,5 o 10 GbE **entre máquina de proceso y NAS**. Con el worker
dentro del NAS, ese enlace no existe. Antes de pagar 10 GbE, conviene confirmar que hay algo que lo necesite.

---

## 19 · Borrado irreversible y evidencia

**19.1 ¿Qué ubicaciones deben incluirse en la eliminación?** · RESPONDIDO PARCIALMENTE

Hoy el sistema borra, dentro de la carpeta de la sesión: los cuatro ISO, el programa, todos los WAV, el
`.drp`, el audio extraído y los ficheros de filtros. **No toca snapshots, backups ni copias de entrega**,
porque hoy no existen.

**Por qué, y qué falta:** en cuanto Enrique añada snapshots o backup, **el borrado deja de estar completo** y
hay que coordinarlo. Es la dependencia real entre su trabajo y el mío, y merece la pena dejarla anotada el
viernes: quien añada una copia, añade también su caducidad.

**19.2 ¿Se puede estructurar el cifrado para borrar una sesión sin afectar al resto?** · NO ES MÍO, pero el
enfoque me parece correcto

Clave por sesión y borrado criptográfico al expirar es la solución limpia, y el documento acierta al decir que
**no debe depender de una única clave global del NAS**. Es diseño de Enrique; desde el software sólo hace falta
que cada sesión tenga un identificador estable, que ya lo tiene.

**19.3 ¿Qué evidencia conservar sin conservar el contenido?** · RESUELTO — ver 12.3

**19.4 ¿Eliminación A) lógica, B) criptográfica, o C) combinación documentada?** · NO ES MÍO — **C** me parece
lo razonable, porque el soporte manda.

**19.5 ¿El cliente recibe A) confirmación, B) PDF, o C) ambos?** · **FUERA DE ALCANCE**

Generar un certificado en PDF con histórico de evidencias no está en las cinco fases.

**Sobre el aviso legal del documento, y esto es importante:** tiene toda la razón. Un certificado emitido por
Dos Líneas es **evidencia técnica propia, no una certificación de un tercero**, y no debe dar a entender que
NIST ni ninguna otra entidad certifica la operación. Puede decir con precisión qué se hizo, cuándo, sobre qué
sesión y con qué método. Nada más.

---

## Mínimo y óptimo

Esto responde a los bloques 2.3, 7.1, 10.2, 16.1 y 16.4 de una vez, que es donde el documento pregunta qué
hace falta para que el software corra.

### Lo que hay que instalar, y no hay más

| Pieza | Versión | Nota |
|---|---|---|
| **Node** | 22 o superior | probado en 22.13 |
| **FFmpeg** | 6 o superior, en el `PATH` | probado con 8.1 |
| **pnpm** | 9 | sólo para instalar |
| Drivers del encoder | opcionales | NVENC, QSV o AMF, si se quiere acelerar |

**No hay que instalar base de datos** —la cola es el SQLite que ya trae Node— **ni navegador**: Remotion
descarga su propio Chrome la primera vez que renderiza. La lista es corta a propósito: en una máquina que va a
estar encendida sin que nadie la mire, cada pieza que hay que mantener es una cosa que se puede romper sola.

### Lo medido, y en qué condiciones

Pipeline completo de las siete fases sobre una **sesión sintética de 60 s a 1280x720 y 25 fps**, en un
**i9-12900H (14 núcleos / 20 hilos, 32 GB)**, midiendo **sólo los procesos del propio worker**, no el resto de
la máquina.

| Paso | Tiempo | Pico de RAM | Procesos de Chrome |
|---|---|---|---|
| `edit` | 7,4 s | 738 MB | 0 |
| `brand` | 36,1 s | 946 MB | 4 |
| `transcribe` | 0,7 s | — | 0 |
| `captions` | 0,7 s | — | 0 |
| **`clips`** | **150,8 s** | **2.774 MB** | **6** |
| `explainer` | 10,5 s | 2.615 MB | 6 |
| `deliver` | 0,1 s | — | 0 |
| **Total** | **3 min 27 s** | **2,8 GB** | **6** |

**Tres cosas que corrigen suposiciones anteriores:**

1. **El pico es 2,8 GB, no 32 GB.** La cifra de 32 GB venía de suponer que Remotion levanta muchas instancias
   de Chromium. Medido, levanta **seis procesos** en total.
2. **El pico está en `clips`**, no en el máster. Es el paso que combina subtítulos animados en Remotion con
   los renders verticales de FFmpeg, y es también el más largo con diferencia.
3. **`--concurrency` no es la palanca que parecía.** Limitarlo a 1 en el paso de marca subió el tiempo de
   36 a 53 segundos y sólo bajó la RAM de 946 a 913 MB — un 3 %. El suelo lo pone Chromium arrancando, no el
   paralelismo. Sirve para ajustar CPU, no para caber en menos memoria.

**El límite de esta medición:** es material sintético a 720p y de un minuto. Con vídeo real a 1080p espero que
la RAM ronde **el doble**, porque los buffers de decodificación de los cuatro ISO escalan con la resolución.
La duración de la sesión no debería mover mucho la RAM —FFmpeg trabaja en flujo y los clips se renderizan uno
detrás de otro—, pero **sí multiplica el tiempo**.

### El disco, que es lo que de verdad manda

Para una sesión real de 90 minutos, a partir de los ~45 MB/s que escribe el ATEM:

| Concepto | Tamaño | |
|---|---|---|
| Bruto: 4 ISO + programa + WAV | **~243 GB** | lo que ocupa de verdad |
| Salidas: máster, marcado, explicativo, clips | ~19 GB | **el 7,6 % del bruto** |
| Copia en el destino de entrega | ~19 GB | si el destino está en el mismo volumen |
| **Pico por sesión en un solo volumen** | **~280 GB** | |

**Por qué esto simplifica la compra:** el dimensionado del disco lo manda **cuántas sesiones en bruto conviven
a la vez**, no el procesado. Todo lo que genera el software junto es menos de una décima parte del material
que entra. Y como el bruto se borra al confirmar la entrega, una sesión deja de ocupar 243 GB en cuanto el
cliente acepta, no a los siete días.

### Mínimo para que funcione

Con esto el sistema **corre entero, de la carpeta a la entrega**, una sesión cada vez:

| Pieza | Mínimo | Por qué ese número |
|---|---|---|
| CPU | 4 núcleos modernos | decodificar cuatro ISO a la vez es el suelo; con menos, el montaje se alarga pero no falla |
| RAM | **8 GB** | el pico medido es 2,8 GB a 720p; a 1080p espero ~6 GB, y el resto es margen del sistema |
| Disco | **500 GB libres** | ~280 GB de la sesión en curso, más aire para no trabajar al borde |
| GPU | **ninguna** | libx264 va por CPU y cumple; la GPU sólo acorta tiempos |
| SO | Linux o Windows | desarrollado y probado en Windows, pensado para Linux |
| Red | sólo para transcripción y clips | el resto funciona con la línea caída |

### Óptimo

| Pieza | Óptimo | Qué compra ese salto |
|---|---|---|
| CPU | 8 núcleos (Ryzen 5 7600, i5-12400 o mejor) | los cuatro ISO sin que el montaje sea el cuello de botella |
| RAM | **16 GB** | holgura real a 1080p; **32 GB sólo si se quieren dos sesiones a la vez** |
| Disco de trabajo | 1 TB NVMe | varias sesiones conviviendo sin vigilar el espacio |
| Discos de archivo | **en espejo, obligatorio** | si sustituyen a Blackmagic Cloud, un disco muerto se lo lleva todo |
| GPU | NVIDIA de gama baja, **opcional** | NVENC fue el más rápido de los tres encoders medidos |
| SO | Linux (TrueNAS SCALE, Unraid o Ubuntu) | mejor que Windows para un servicio permanente |

**Sobre los 32 GB:** los mantengo en la columna de óptimo **sólo para dos sesiones simultáneas**, no porque
una sola los necesite. Si el estudio graba cuatro sesiones a la semana y el sistema es desatendido, procesarlas
de una en una durante la noche es suficiente, y entonces 16 GB sobran.

**Sobre la GPU:** sigue siendo opcional. Grabáis a 25 y 30 fps, no a 50/60, así que la carga de decodificación
es la mitad de la que estimé al dimensionar por primera vez. Medido sobre 40 s a 720p: **NVENC 3,7 s, libx264
4,6 s, QSV 5,5 s**. La diferencia existe pero no justifica por sí sola comprar una gráfica.

### Lo que falta para cerrar esto del todo

Los tiempos de arriba son de una sesión de **un minuto**. Para un episodio de 90 minutos hay que multiplicar,
y el factor no es lineal en todos los pasos. **Eso sólo se sabe con la grabación de prueba**, y es la
diferencia entre decirle a Enrique «compra esto» y decirle «compra esto, medido».

---

## Lo que queda fuera de las cinco fases

Cuatro bloques del documento no entran en el alcance del acuerdo del 14 de agosto. No es una negativa: las
cuatro son razonables y las cuatro se pueden hacer. Es una petición de decidirlas explícitamente en vez de
darlas por incluidas.

| Bloque | Qué es | Qué hay ya hecho que sirve de base |
|---|---|---|
| **13** · Portal con aceptación o firma | aplicación web con registro de hash, IP y texto aceptado | el recibo técnico con cada fichero, destino y tamaño |
| **12** · Retención facturable | 7 días gratis, extensiones de pago, renovación automática, avisos | el borrado al confirmar y el histórico de la sesión |
| **19.5** · Certificado de borrado en PDF | documento para el cliente con histórico de evidencias | la lista exacta de lo borrado y su fecha |
| **Fase 4** · Logs inmutables | almacenamiento específico protegido | el registro completo por paso, en la cola |

El propio documento asigna el bloque 13 a «Piru + desarrollo web», así que probablemente ya está entendido.
El acuerdo firmado, en su punto 5, **ya define el mecanismo**: pasado el mes de correcciones, *«cualquier
cambio, mejora o adaptación se cobra aparte, y el precio se habla cuando vayan saliendo, según lo que suponga
cada uno»*. No hace falta inventar nada nuevo: sólo usarlo.

---

## Lo que necesito de vosotros

Por orden de lo que más desbloquea:

1. **La grabación de prueba.** 5-10 minutos con los cuatro ISO, el WAV, el programa y el `.drp`. Cierra de
   golpe: nomenclatura real del ATEM, tamaño real de una sesión, tiempos de render, el modelo de Deepgram con
   vuestro español, el encuadre de los clips verticales y los umbrales del explicativo. **Es también la
   decisión número 1 de vuestra propia lista de «antes de comprar hardware».** Lleva pendiente desde el 18 de
   agosto.
2. **Si no puede ser hoy la grabación entera, una captura del listado de la carpeta del SSD.** Cuesta un
   minuto y arregla la nomenclatura, que es el punto 6.1.
3. **La decisión sobre transcripción local o en cloud** (2.5 y 15.4), porque cambia el hardware que hay que
   comprar.
4. **De qué campo de la reserva salen los nombres de los invitados** (5.3 y 6.5).
5. **El material de marca** —logotipo, tipografías, cortinilla, cómo deben ser intro y cierre—, que el acuerdo
   sitúa antes del comienzo de la fase 2. No bloquea nada porque las plantillas salen parametrizadas, pero
   diseñar identidad visual no entra en el desarrollo. La vía rápida para verlo es que os enseñe el editor de
   plantillas en marcha.

---

*Documento de respuesta al «Documento de revisión · Infraestructura y ciclo de vida del contenido» de 25 de
agosto de 2026. Las respuestas marcadas RESUELTO se pueden ver funcionando en cualquier momento.*
