# Servidor del juego

`server/game/` es el servidor de ColonyMAXAI. Hace tres cosas:

- **Entrega la página del juego** (`index.html`, `style.css` y `src/`).
- **Atiende a los jugadores** por WebSocket en `/ws`: cuentas, sesiones y órdenes.
- **Simula todas las colonias todo el tiempo**, aunque sus dueños no estén conectados (en ese caso nadie baja de la salud crítica), y las guarda en SQLite.

Escucha solo en `127.0.0.1:3100`, el puerto al que apunta el túnel de Cloudflare (`server/tunnel/`). Usa Node 22 y dos paquetes de npm (`three` y `ws`). La base de datos es `node:sqlite`, que viene con Node, así que no hay nada que compilar.

## 1. Bajar el juego desde GitHub

El código vive en `/opt/colonymaxai/app`, como un clon del repositorio. Actualizar es `git pull`.

```bash
sudo mkdir -p /opt/colonymaxai /etc/colonymaxai
sudo chown "$USER": /opt/colonymaxai
git clone --branch claude/awesome-dirac-1r7byr https://github.com/Mauritoo566/ColonyMAXAI.git /opt/colonymaxai/app
cd /opt/colonymaxai/app
npm ci --omit=dev --no-audit --no-fund
chmod +x server/game/actualizar.sh
```

## 2. Configuración

```bash
sudo install -m 644 -o root -g root /opt/colonymaxai/app/server/game/game.env.example /etc/colonymaxai/game.env
```

No hace falta cambiar nada: puerto 3100, solo local, y la base en `/var/lib/colonymaxai/game.db`.

## 3. Pasar el túnel al código nuevo

El túnel ya está andando desde `/opt/colonymaxai/server`. Ahora ese código también está dentro del clon, así que se apunta ahí y se borra la copia vieja. `tunnel.env` no se toca.

```bash
sudo cp /opt/colonymaxai/app/server/tunnel/colonymaxai-tunnel.service /etc/systemd/system/
sudo sed -i "s/CAMBIAR_USUARIO/$USER/" /etc/systemd/system/colonymaxai-tunnel.service
sudo rm -rf /opt/colonymaxai/server /opt/colonymaxai/web
```

Si todavía está corriendo el `python3 -m http.server 3100` de la prueba, hay que cortarlo (Ctrl+C en esa terminal). El juego va a usar ese puerto.

## 4. Instalar los servicios

```bash
cd /opt/colonymaxai/app/server/game
sudo cp colonymaxai-game.service colonymaxai-backup.service colonymaxai-backup.timer /etc/systemd/system/
sudo sed -i "s/CAMBIAR_USUARIO/$USER/" /etc/systemd/system/colonymaxai-game.service /etc/systemd/system/colonymaxai-backup.service
sudo systemctl daemon-reload
sudo systemctl enable --now colonymaxai-game colonymaxai-backup.timer
sudo systemctl restart colonymaxai-tunnel
```

## 5. Comprobar

```bash
systemctl status colonymaxai-game --no-pager       # active (running)
curl -s http://127.0.0.1:3100/healthz               # ok
journalctl -u colonymaxai-game -n 20 --no-pager    # "ColonyMAXAI escuchando en http://127.0.0.1:3100"
```

Después, abrir el link que publica el bot de Telegram: tiene que aparecer la pantalla para crear una cuenta. En el registro se ve cada jugador que entra, sale o funda su campamento.

## Actualizar el juego

Cuando haya cambios en GitHub:

```bash
/opt/colonymaxai/app/server/game/actualizar.sh
```

Baja los cambios, instala lo que haga falta y reinicia el juego. Al reiniciar, el servidor guarda todo antes de apagarse. Los jugadores ven «Reconectando…» unos segundos y siguen donde estaban. La dirección del túnel no cambia.

Si cambió algo del túnel (`server/tunnel/`), también hay que correr `sudo systemctl restart colonymaxai-tunnel`. En ese caso la dirección sí cambia, y el bot avisa la nueva.

## Administración

Se corre desde `/opt/colonymaxai/app` (el juego puede seguir encendido):

```bash
export DB_PATH=/var/lib/colonymaxai/game.db
node --disable-warning=ExperimentalWarning server/game/admin.js jugadores
node --disable-warning=ExperimentalWarning server/game/admin.js contraseña <jugador> <contraseña nueva>
```

No hay correo para recuperar contraseñas: si alguien olvida la suya, se le pone una nueva con el segundo comando.

## Copias de seguridad

`colonymaxai-backup.timer` hace una copia por día a las 4:10 en `/var/lib/colonymaxai/backups/`. Guarda 7 diarias, 4 semanales y 3 mensuales. La copia se hace en caliente, sin apagar el juego.

Para volver a una copia:

```bash
sudo systemctl stop colonymaxai-game
cp /var/lib/colonymaxai/backups/daily-AAAA-MM-DD.db /var/lib/colonymaxai/game.db
rm -f /var/lib/colonymaxai/game.db-wal /var/lib/colonymaxai/game.db-shm
sudo systemctl start colonymaxai-game
```

## Comandos útiles

| Para | Comando |
|---|---|
| Ver el registro en vivo | `journalctl -u colonymaxai-game -f` |
| Reiniciar el juego | `sudo systemctl restart colonymaxai-game` |
| Ver las copias | `ls -lh /var/lib/colonymaxai/backups` |
| Probar el servidor (en una PC con el repo) | `npm install && npm test` |
