# Poner el software a correr en el iMac del estudio

Máquina: **iMac Retina 5K 27" de 2017** (`iMac-de-Helena.local`), i7-7700K de 4 núcleos, Radeon Pro 580 8 GB,
32 GB de RAM, **macOS Ventura 13.7.8**, Intel `x86_64`. El usuario del escritorio es **`helena`**, y el software
corre como ella, no como root.

## 1. Instalar o actualizar: un solo script

`deploy/macos/install.command` deja la máquina lista desde cero, y si se vuelve a ejecutar, actualiza. Se puede
lanzar de tres formas, y las tres hacen lo mismo:

```sh
curl -fsSL https://raw.githubusercontent.com/podcast-lab/doslineas/main/deploy/macos/install.command | bash
```

- **Desde la Terminal de Helena**: se pega esa línea. Pide su contraseña cuando le toca instalar Node o FFmpeg.
- **Desde la Shell de DWService**, que entra como root: la misma línea. El script detecta quién tiene la
  sesión abierta en la pantalla y lo instala para ese usuario. Para elegirlo a mano,
  `DOSLINEAS_USER=helena` delante de `bash`.
- **Con doble clic** sobre `install.command` en Finder, si se tiene el repo descomprimido. Un `.command`
  descargado suelto con el navegador pierde el permiso de ejecución y Gatekeeper lo frena, así que para
  alguien que no es técnico la línea de la Terminal es más sencilla. Firmarlo no hace falta para nada de esto.

**Para actualizar** después: `deploy/macos/update.command`, que baja la última versión del instalador y la
ejecuta. Se niega si hay un paso a medias (un render o una transcripción), porque cortarlo gasta un intento
del trabajo; `--force` lo corta igualmente. `--keys` vuelve a pedir las claves de API.

### Lo que hace, por orden

1. **Node 22** con el `.pkg` oficial de nodejs.org, comprobando su checksum, si no está ya.
2. **FFmpeg y ffprobe estáticos** de evermeet.cx en `/usr/local/bin`, si no hay una versión 7 o más
   nueva. Desde la 7 existe `-/filter_complex`, y el render lo necesita.
3. Para los dos servicios, salvo que haya un paso corriendo.
4. Baja el código de GitHub como `.tar.gz` a `~/doslineas/app`. Conserva el `.env` anterior, y si
   encuentra el de la instalación a mano del 11/09 (`~/podcast-tool/.env`), también lo recoge.
5. Instala `pnpm` en la versión que fija `packageManager`, y luego las dependencias con
   `--frozen-lockfile`.
6. Completa el `.env` (permisos `600`) con el área de trabajo y `DOSLINEAS_ENCODER=h264_videotoolbox`
   si ese encoder existe, y pide las claves de Deepgram y Anthropic que falten.
7. Instala dos LaunchAgents, `com.doslineas.worker` y `com.doslineas.panel`, con `KeepAlive`: arrancan
   al iniciar sesión y se levantan otra vez si se caen. Los registros quedan en `~/doslineas/logs/`.
8. Crea **`~/Applications/Dos Lineas.app`** y lo añade al Dock. Ese icono arranca los servicios si están
   parados y abre el panel en `http://localhost:4310`. Como el `.app` se genera en la propia máquina, no
   lleva la marca de descarga y Gatekeeper no pregunta nada.
9. Comprueba que VideoToolbox codifica de verdad, que el panel responde y que el worker está corriendo.

Por qué **no se usa Homebrew ni git**: Homebrew se niega a correr como root y arrastra las Command Line
Tools, que abren una ventana gráfica imposible de manejar por control remoto. Y `/usr/bin/git` en una Mac
sin esas herramientas es un señuelo que lanza ese mismo instalador.

## 2. El reparto de discos

| Sitio | Qué vive ahí | Quién escribe |
|---|---|---|
| Compartido `smb://192.168.2.210/sala001` | el bruto, junto con todo el trabajo del estudio | **nadie de los nuestros** |
| `~/doslineas/sessions` | sesiones completas: bruto copiado + intermedios + másteres | el software |
| `~/doslineas/delivered` | lo entregado | el software |
| `~/doslineas/state` | la cola y los avisos | el software |
| `~/doslineas/app` | el código y su `.env` | el instalador |

**El compartido no puede ser `DOSLINEAS_SESSIONS`.** Cada paso escribe en la carpeta de la sesión
(`packages/pipeline/src/steps.ts`) y `cli confirm` borra el bruto de ahí (`packages/pipeline/src/raw.ts`).
Además, ese compartido tiene material de otros clientes.

Hacen falta **~25 GB libres por episodio en vuelo**. El 11/09 había 365 GB libres.

## 3. La ingesta: copiar, y luego mover

Nunca procesar leyendo del compartido, y nunca copiar mientras el ATEM graba.

```sh
pnpm cli ingest "/Volumes/sala001/atem mini pro iso 5"
```

Copia a `_incoming/` dentro de `DOSLINEAS_SESSIONS` y al terminar la mueve a su sitio. El `mv` dentro del
mismo volumen es atómico, así que el vigilante nunca ve una sesión a medias.

## 4. Lo que el instalador no puede hacer solo

- **Que la sesión de `helena` esté iniciada.** Un LaunchAgent vive en la sesión del usuario: si el iMac se
  reinicia y nadie entra, no arranca nada. Hay que activar el inicio de sesión automático en
  Ajustes del Sistema → Usuarios y grupos.
- **Que el compartido se monte solo.** Hoy `mount_smbfs` pide la contraseña por teclado. Se resuelve
  guardándola en el Llavero de `helena` al conectar desde Finder y añadiendo el volumen a los ítems de inicio,
  pero depende de que el `.210` vuelva a responder (pendiente de Enrique).
- **Que no se duerma:** `sudo pmset -a sleep 0 disksleep 0 autorestart 1`. El reposo ya estaba a 0 el 11/09.

## 5. Operación diaria

El icono **Dos Lineas** del Dock abre el panel. Por consola, desde `~/doslineas/app`:

```sh
pnpm cli status                           # la cola y los avisos
pnpm cli retry <sesión> [--step <paso>]   # rescatar un paso
pnpm cli confirm <sesión> --dry-run       # qué bruto se iría; sin la bandera, lo borra
tail -f ~/doslineas/logs/worker.log       # lo que está haciendo el worker
```

## 6. Lo que queda por resolver en la máquina

- **Rotar las credenciales** del FTP, la del compartido y el enlace de DWService, porque viajaron en claro.
  Mejor una VPN que puertos publicados, sobre todo en un Ventura que ya no recibe parches.
- La IP pública es **dinámica** (Vodafone doméstico): DDNS o VPN.
- Cronometrar un episodio real. La estimación de partida sigue siendo **2–4 h por episodio**, y el cuello no
  es el encode sino **decodificar los 4 ISO con 4 núcleos**.
- Probar un corte de luz de punta a punta.
