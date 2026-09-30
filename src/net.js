// Conexión con el servidor del juego por WebSocket. Si se corta (el servidor se reinició,
// cambió la dirección del túnel, se fue internet) vuelve a intentar sola, cada vez un poco
// más espaciado, y avisa del estado para que la interfaz muestre «Reconectando…».

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 10_000;
const PING_MS = 25_000; // un mensaje cada tanto para que ningún proxy corte la conexión

export class Connection {
  constructor(url = defaultUrl()) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map(); // tipo de mensaje -> [funciones]
    this.status = 'connecting'; // 'connecting' | 'open' | 'closed'
    this.onStatus = null;
    this.onOpen = null; // al conectar (también al reconectar)
    this.retry = RETRY_MIN_MS;
    this.stopped = false;
    this.connect();
    this.ping = setInterval(() => this.send({ t: 'ping' }), PING_MS);
  }

  connect() {
    if (this.stopped) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retry = RETRY_MIN_MS;
      this.setStatus('open');
      this.onOpen?.();
    });
    ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      for (const fn of this.handlers.get(msg.t) ?? []) fn(msg);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.setStatus('closed');
      if (this.stopped) return;
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(RETRY_MAX_MS, this.retry * 2);
    });
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  // Espera el próximo mensaje de un tipo.
  next(type) {
    return new Promise((resolve) => {
      const fn = (msg) => {
        this.handlers.set(type, this.handlers.get(type).filter((f) => f !== fn));
        resolve(msg);
      };
      this.on(type, fn);
    });
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  close() {
    this.stopped = true;
    clearInterval(this.ping);
    this.ws?.close();
  }
}

// El servidor que entregó la página es el mismo del juego (en /ws).
function defaultUrl() {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws`;
}
