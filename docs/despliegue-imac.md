# Poner el software a correr en el iMac del estudio

Máquina: **iMac Retina 5K 27" de 2017**, i7-7700K (4 núcleos), Radeon Pro 580 8 GB, 32 GB de RAM,
**macOS Ventura 13.7.8**. Es la misma que hace de router del ATEM y de servidor FTPS, y la que ve por SMB el
disco USB-C del ATEM.

## 1. El reparto de discos, antes que nada

| Sitio | Qué vive ahí | Quién escribe |
|---|---|---|
| Disco USB-C del ATEM (montaje SMB) | el bruto tal cual sale, capa de retención | **sólo el ATEM** |
| `~/doslineas/incoming` | copia en curso desde el disco del ATEM | el script de ingesta |
| `~/doslineas/sessions` | sesiones completas: bruto + intermedios + másteres | el software |
| `~/doslineas/delivered` | lo entregado | el software |

En el iMac hay que pasar **`--encoder h264_videotoolbox`** y la calidad por **bitrate** (`--quality 24M`; 16M por
defecto), porque en Intel no hay calidad constante.

**El disco del ATEM no puede ser `DOSLINEAS_SESSIONS`.** Cada paso escribe sus artefactos dentro de la carpeta
de la sesión (`packages/pipeline/src/steps.ts`) y `cli confirm` borra el bruto de esa misma carpeta
(`packages/pipeline/src/raw.ts`). Apuntar ahí sería escribir y borrar en el disco donde graba el ATEM.

Hacen falta **~25 GB libres por episodio en vuelo** (44 GB por hora grabada de bruto, ~1 GB de salidas).

## 2. Lo que hay que instalar

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@22 ffmpeg git
echo 'export PATH="/usr/local/opt/node@22/bin:$PATH"' >> ~/.zprofile
corepack enable
node -v && ffmpeg -version | head -1 && pnpm -v
```

No hay ningún módulo nativo que compilar: la cola usa `node:sqlite`, que viene dentro de Node. Remotion se
descarga su propio Chrome Headless Shell la primera vez que renderiza, así que esa primera vez necesita internet.

## 3. El repositorio y las claves

```sh
mkdir -p ~/doslineas && cd ~/doslineas
git clone <repo> podcast-tool && cd podcast-tool
pnpm install
printf 'DEEPGRAM_API_KEY=...\nANTHROPIC_API_KEY=...\n' > .env
```

`pnpm cli`, el worker y la API cargan ese `.env` con `tsx --env-file-if-exists`.

## 4. La configuración, por entorno

En `~/doslineas/env.sh`:

```sh
export DOSLINEAS_REPO="$HOME/doslineas/podcast-tool"
export DOSLINEAS_SESSIONS="$HOME/doslineas/sessions"
export DOSLINEAS_DELIVERY="$HOME/doslineas/delivered"
export DOSLINEAS_DB="$HOME/doslineas/state/jobs.db"
export DOSLINEAS_QUIET_SECONDS=120
```

## 5. Comprobar que la máquina puede, en este orden

```sh
cd ~/doslineas/podcast-tool
pnpm test && pnpm lint && pnpm typecheck

ffmpeg -h encoder=h264_videotoolbox                       # que exista el encoder
ffmpeg -f lavfi -i testsrc=size=1920x1080:rate=25 -t 10 \
  -c:v h264_videotoolbox -b:v 16M /tmp/vt.mp4             # que codifique de verdad

pnpm cli generate-session /tmp/fake --duration 120        # una sesión sintética
pnpm cli edit /tmp/fake --render --encoder h264_videotoolbox --quality 24M
DOSLINEAS_TRANSCRIBER=mock pnpm cli transcribe /tmp/fake
```

Con eso está probada la cadena entera sin gastar una llamada a Deepgram. Después, un episodio real cronometrado:
es el único número que vale para prometer tiempos. La estimación de partida es **2–4 h por episodio** (máster +
2ª pasada de la pantalla + marca + los 4 clips de Remotion), y el cuello no es el encode —VideoToolbox lo
acelera— sino **decodificar los 4 ISO con 4 núcleos**.

## 6. La ingesta: copiar, y luego mover

Nunca procesar leyendo del disco del ATEM, y nunca copiar mientras el ATEM graba.

```sh
#!/bin/sh
set -e
src="$1"                                   # carpeta de la sesión en el montaje SMB del ATEM
name="$(basename "$src")"
rsync -a --info=progress2 "$src/" "$HOME/doslineas/incoming/$name/"
mv "$HOME/doslineas/incoming/$name" "$HOME/doslineas/sessions/$name"
```

El `mv` dentro del mismo volumen es atómico, así que el vigilante nunca ve una sesión a medias y la heurística
de los 120 s de quietud deja de importar. 18 GB por Gigabit son unos 3 minutos.

El vigilante inspecciona la sesión antes de encolar y levanta un aviso si falta un ISO, el programa o el `.drp`,
o si algún fichero no se puede leer; `pnpm cli status` lo muestra. Para mirar un fichero suelto a mano,
`pnpm cli probe <fichero...>` da duración, fps, resolución y audio.

## 7. Que arranque solo y no se duerma

```sh
sudo pmset -a sleep 0 disksleep 0 displaysleep 10 autorestart 1
```

`~/Library/LaunchAgents/com.doslineas.worker.plist` (y otro igual para `@doslineas/api`, que sirve el panel en
el 4310):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.doslineas.worker</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string><string>-lc</string>
    <string>. $HOME/doslineas/env.sh; cd $HOME/doslineas/podcast-tool; exec pnpm --filter @doslineas/worker start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/USUARIO/doslineas/logs/worker.log</string>
  <key>StandardErrorPath</key><string>/Users/USUARIO/doslineas/logs/worker.err</string>
</dict>
</plist>
```

```sh
mkdir -p ~/doslineas/logs
launchctl load -w ~/Library/LaunchAgents/com.doslineas.worker.plist
```

Un LaunchAgent corre con la sesión del usuario iniciada, que es lo que hace falta para que el montaje SMB del
ATEM esté disponible. Si se quiere sin login, hay que montar el SMB desde el propio script.

## 8. Operación diaria

```sh
pnpm cli status                      # la cola y los avisos
pnpm cli retry <sesión> [--step <paso>]  # rescatar un paso
pnpm cli confirm <sesión> --dry-run  # qué bruto se iría; sin la bandera, lo borra
```

El panel, en `http://localhost:4310`.

## 9. Lo que queda por resolver en la máquina

- **Cuánto disco libre** tiene el iMac para el área de trabajo, y **con qué formato** está el disco del ATEM.
- **Rotar las credenciales** del FTP y regenerar el enlace de control remoto: viajaron en claro. Mejor VPN que
  puertos publicados, sobre todo en un Ventura 13.7.8 que ya no recibe parches.
- La IP pública es **dinámica** (Vodafone doméstico): ya cambió en 24 h. DDNS o VPN.
- Probar un corte de energía de punta a punta: con `autorestart 1` y los LaunchAgents debería volver solo.
