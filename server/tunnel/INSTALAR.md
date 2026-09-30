# Túnel de Cloudflare + aviso por Telegram

El juego escucha en `127.0.0.1:3100`. Un túnel rápido de Cloudflare lo publica en una dirección `https://…trycloudflare.com`, gratis y sin dominio. Esa dirección cambia cada vez que se reinicia el túnel (reinicio de la PC, corte de luz, caída de `cloudflared`), así que el servicio `colonymaxai-tunnel` la lee y la avisa en Telegram. El juego en sí se puede reiniciar o actualizar sin que cambie la dirección.

No hace falta abrir puertos en el router ni tocar Caddy ni UFW: el túnel sale del servidor hacia Cloudflare.

## 1. Crear el bot de Telegram

1. En Telegram, abrir **@BotFather**, enviar `/newbot` y seguir los pasos. Al final da un **token** (algo como `123456:ABC-…`). Es secreto.
2. Crear un grupo para los jugadores y **agregar al bot como miembro** (Agregar miembros → buscarlo por su nombre). Si solo se lo intenta hacer administrador sin agregarlo antes, no queda en el grupo y no responde.
3. Opcional: hacer al bot **administrador** del grupo con permiso para fijar mensajes, así la dirección queda fijada arriba.

## 2. Instalar cloudflared

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install cloudflared
cloudflared --version
```

Si el repositorio cambió, las instrucciones oficiales están en <https://pkg.cloudflare.com/>.

## 3. Copiar los archivos (desde la PC Windows)

```powershell
ssh usuario@IP-DEL-SERVIDOR rm -rf /tmp/colonymaxai-server
scp -r server usuario@IP-DEL-SERVIDOR:/tmp/colonymaxai-server
```

(El primer comando borra una copia anterior: si `/tmp/colonymaxai-server` ya existe, `scp -r` mete la carpeta adentro y queda `server/server/`.)

En el servidor:

```bash
sudo mkdir -p /opt/colonymaxai /etc/colonymaxai
sudo rm -rf /opt/colonymaxai/server && sudo mv /tmp/colonymaxai-server /opt/colonymaxai/server
# scp copia con los permisos de Windows: dejarlo legible para el usuario del servicio.
sudo chown -R root:root /opt/colonymaxai/server
sudo chmod -R u=rwX,go=rX /opt/colonymaxai/server
sudo install -m 600 -o root -g root /opt/colonymaxai/server/tunnel/tunnel.env.example /etc/colonymaxai/tunnel.env
sudo nano /etc/colonymaxai/tunnel.env   # pegar TELEGRAM_TOKEN; dejar TELEGRAM_CHAT_ID vacío por ahora
```

## 4. Instalar el servicio

```bash
sudo cp /opt/colonymaxai/server/tunnel/colonymaxai-tunnel.service /etc/systemd/system/
sudo sed -i "s/CAMBIAR_USUARIO/$USER/" /etc/systemd/system/colonymaxai-tunnel.service
sudo systemctl daemon-reload
sudo systemctl enable --now colonymaxai-tunnel
```

## 5. Conectar el grupo

1. Escribir cualquier mensaje **en el grupo** (por ejemplo `/link`). El bot contesta **«El id de este chat es -100…»**. El id de un grupo siempre empieza con `-`; si es un número positivo, es un chat privado con el bot, no el grupo.
2. Poner ese número en `TELEGRAM_CHAT_ID` dentro de `/etc/colonymaxai/tunnel.env`. Se pueden poner varios separados por comas.
3. Reiniciar: `sudo systemctl restart colonymaxai-tunnel`

En unos segundos el bot publica la dirección en el grupo. Desde entonces:

- cada vez que cambie la dirección, el bot la avisa (y la fija si es administrador);
- cualquiera del grupo puede escribir `/link` para pedirla;
- el bot ignora los mensajes de otros chats.

## Mientras no existe el servidor del juego

Todavía no hay nada escuchando en el puerto 3100, así que la dirección muestra un error de Cloudflare. Para probar ya con la versión actual del juego (cuentas locales en cada navegador), se pueden servir los archivos estáticos:

```bash
# desde la PC Windows:
#   ssh usuario@IP-DEL-SERVIDOR "rm -rf /tmp/colonymaxai-web && mkdir /tmp/colonymaxai-web"
#   scp -r index.html style.css src usuario@IP-DEL-SERVIDOR:/tmp/colonymaxai-web
sudo rm -rf /opt/colonymaxai/web && sudo mv /tmp/colonymaxai-web /opt/colonymaxai/web
sudo chmod -R u=rwX,go=rX /opt/colonymaxai/web
python3 -m http.server 3100 --bind 127.0.0.1 --directory /opt/colonymaxai/web
```

Se detiene con Ctrl+C. Cuando esté el servidor del juego, ocupará ese mismo puerto.

## Comandos útiles

| Para | Comando |
|---|---|
| Ver la dirección actual | `cat /var/lib/colonymaxai-tunnel/url.txt` |
| Ver el registro | `journalctl -u colonymaxai-tunnel -f` |
| Estado del servicio | `systemctl status colonymaxai-tunnel` |
| Forzar una dirección nueva | `sudo systemctl restart colonymaxai-tunnel` |

## Límites a tener en cuenta

- Cloudflare presenta los túneles rápidos como algo para pruebas: no garantiza que estén siempre disponibles y tienen un tope de conexiones simultáneas. Para un grupo de amigos alcanza.
- Si algún día hay un dominio (por ejemplo uno gratis de eu.org), se cambia a un túnel con nombre y la dirección deja de cambiar. El juego no necesita cambios para eso.
