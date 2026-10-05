// Efectos de la caza (sólo en el navegador): el daño que sube flotando sobre el animal, la chispa del impacto, la barra de vida que baja con una estela, el
// globito de susto, el polvo al caer y el desplome del animal. Todo son sprites en el mismo grupo que los animales; nada de esto cambia la simulación.
import * as THREE from 'three';

// Cuánto daño hizo una bajada de vida (en % de la vida máxima del animal).
export const damageFromDrop = (prevPct, pct, maxHp) => Math.max(0, Math.round(((prevPct - pct) / 100) * maxHp));
// Color de la barra según la vida que queda: verde, ámbar, rojo.
export function hpColor(pct) {
  const t = Math.max(0, Math.min(1, pct / 100));
  const c = new THREE.Color().setHSL(0.02 + t * 0.3, 0.78, 0.5);
  return c;
}
const ease = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

// ---- Texturas (se crean una vez y se reutilizan) -----------------------------------------------------------------------------------

const cache = new Map();
function canvasTexture(key, draw, w = 256, h = 128) {
  let tex = cache.get(key);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

function numberTexture(text, fill, stroke) {
  return canvasTexture(`n|${text}|${fill}|${stroke}`, (g, w, h) => {
    g.font = '900 86px system-ui, "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 16;
    g.strokeStyle = stroke;
    g.strokeText(text, w / 2, h / 2 + 4);
    g.fillStyle = fill;
    g.fillText(text, w / 2, h / 2 + 4);
    // Un brillo suave arriba de las letras.
    g.globalCompositeOperation = 'source-atop';
    const shine = g.createLinearGradient(0, h * 0.2, 0, h * 0.8);
    shine.addColorStop(0, 'rgba(255,255,255,0.55)');
    shine.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = shine;
    g.fillRect(0, 0, w, h);
  });
}

function sparkTexture() {
  return canvasTexture('spark', (g, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, 60);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.25, 'rgba(255,214,120,0.85)');
    glow.addColorStop(1, 'rgba(255,120,60,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,248,220,0.95)';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const len = i % 2 ? 46 : 62;
      g.beginPath();
      g.moveTo(cx + Math.cos(a - 0.09) * 6, cy + Math.sin(a - 0.09) * 6);
      g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      g.lineTo(cx + Math.cos(a + 0.09) * 6, cy + Math.sin(a + 0.09) * 6);
      g.fill();
    }
  });
}

function puffTexture() {
  return canvasTexture('puff', (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, 56);
    r.addColorStop(0, 'rgba(214,200,176,0.9)');
    r.addColorStop(0.6, 'rgba(190,176,150,0.45)');
    r.addColorStop(1, 'rgba(180,166,140,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
}

// Globito de susto: un círculo claro con "!" y una colita, con borde oscuro.
function fearTexture() {
  return canvasTexture('fear', (g, w, h) => {
    const cx = w / 2;
    g.lineJoin = 'round';
    g.fillStyle = '#fff6d8';
    g.strokeStyle = '#6a3a14';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(cx, 54, 40, 0, Math.PI * 2);
    g.moveTo(cx - 12, 88);
    g.lineTo(cx, 118);
    g.lineTo(cx + 12, 88);
    g.closePath();
    g.stroke();
    g.fill();
    g.fillStyle = '#d6471e';
    g.font = '900 62px system-ui, "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('!', cx, 56);
  });
}

function sprite(map, opts = {}) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, depthTest: false, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, color: opts.color ?? 0xffffff }));
  s.renderOrder = opts.order ?? 20;
  return s;
}

// ---- Efectos ------------------------------------------------------------------------------------------------------------------------

export class CombatFx {
  constructor(group) {
    this.group = group;
    this.items = [];
    this.up = new THREE.Vector3();
    this.right = new THREE.Vector3();
  }

  // Desde dónde sube: encima del animal (height en metros), siguiendo el "arriba" del planeta en ese punto.
  _above(pos, height, out) {
    this.up.copy(pos).normalize();
    return out.copy(pos).addScaledVector(this.up, height);
  }

  _add(item) {
    this.group.add(item.sprite);
    this.items.push(item);
    return item;
  }

  // Un golpe: la chispa del impacto y la cifra del daño que sube y se desvanece (más grande y dorada si abate al animal).
  hit(pos, height, amount, { kill = false, big = false } = {}) {
    const base = new THREE.Vector3().copy(pos);
    const spark = sprite(sparkTexture(), { additive: true, order: 19 });
    this._add({ kind: 'spark', sprite: spark, age: 0, life: 0.3, base, height: height * 0.7, size: kill ? 1.7 : 1.2 });
    const text = amount > 0 ? `-${amount}` : '¡Ay!';
    const fill = kill ? '#ffd45a' : big ? '#ffae3a' : '#fff3d6';
    const stroke = kill ? '#7a2a08' : '#8a1f12';
    const s = sprite(numberTexture(text, fill, stroke));
    this._add({ kind: 'number', sprite: s, age: 0, life: kill ? 1.5 : 1.15, base, height: height + 0.25, size: kill ? 1.25 : big ? 1.05 : 0.8, drift: (Math.random() - 0.5) * 1.1, kill });
  }

  // Globito de susto sobre el animal (sigue al animal mientras dura).
  fear(anchor, height) {
    const s = sprite(fearTexture());
    this._add({ kind: 'fear', sprite: s, age: 0, life: 1.4, anchor, height: height + 0.5, size: 0.85 });
  }

  // Nube de polvo al caer el animal.
  dust(pos, spread = 0.6) {
    for (let i = 0; i < 6; i++) {
      const s = sprite(puffTexture(), { order: 18 });
      const base = new THREE.Vector3().copy(pos);
      this._add({ kind: 'puff', sprite: s, age: -i * 0.04, life: 0.9, base, height: 0.2 + Math.random() * 0.2, size: 0.7 + Math.random() * 0.5, ox: (Math.random() - 0.5) * spread * 2, oz: (Math.random() - 0.5) * spread * 2 });
    }
  }

  // Barra de vida de un animal: fondo, estela clara (lo que acaba de perder) y relleno. Se crea la primera vez que se usa.
  bar(entry, pos, height, pct, dt, camera) {
    let bar = entry.hpBar;
    if (!bar) {
      const mk = (color, order, opacity = 1) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, transparent: true, depthWrite: false, depthTest: false, opacity }));
        s.center.set(0, 0.5);
        s.renderOrder = order;
        this.group.add(s);
        return s;
      };
      bar = entry.hpBar = { back: mk(0x16100a, 21, 0.78), chip: mk(0xf6e8c4, 22), fill: mk(0xffffff, 23), shown: pct, chip_: pct };
    }
    // El relleno baja de golpe (suave) y la estela, más despacio.
    bar.shown += (pct - bar.shown) * Math.min(1, dt * 14);
    bar.chip_ += (bar.shown - bar.chip_) * Math.min(1, dt * 2.2);
    if (bar.chip_ < bar.shown) bar.chip_ = bar.shown;
    const visible = pct < 100;
    for (const s of [bar.back, bar.chip, bar.fill]) s.visible = visible;
    if (!visible) return;
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    const w = entry.hpWidth ?? 1.0;
    const h = 0.11;
    const at = this._above(pos, height, new THREE.Vector3()).addScaledVector(this.right, -w / 2);
    for (const s of [bar.back, bar.chip, bar.fill]) s.position.copy(at);
    bar.back.scale.set(w + 0.05, h + 0.05, 1);
    bar.chip.scale.set(Math.max(0.001, (w * bar.chip_) / 100), h, 1);
    bar.fill.scale.set(Math.max(0.001, (w * bar.shown) / 100), h, 1);
    bar.fill.material.color.copy(hpColor(bar.shown));
  }

  removeBar(entry) {
    const bar = entry.hpBar;
    if (!bar) return;
    for (const s of [bar.back, bar.chip, bar.fill]) {
      this.group.remove(s);
      s.material.dispose();
    }
    entry.hpBar = null;
  }

  update(dt, camera) {
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    const p = new THREE.Vector3();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      if (it.age < 0) {
        it.sprite.visible = false;
        continue;
      }
      it.sprite.visible = true;
      const t = it.age / it.life;
      if (t >= 1) {
        this.group.remove(it.sprite);
        it.sprite.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      const m = it.sprite.material;
      switch (it.kind) {
        case 'number': {
          // Sube con frenada, se desplaza un poco de lado y aparece con un pequeño rebote; se desvanece al final.
          const rise = ease(t) * (it.kill ? 1.7 : 1.3);
          this._above(it.base, it.height + rise, p).addScaledVector(this.right, it.drift * t);
          it.sprite.position.copy(p);
          const pop = t < 0.18 ? 0.55 + (t / 0.18) * 0.75 : t < 0.3 ? 1.3 - ((t - 0.18) / 0.12) * 0.3 : 1;
          const k = it.size * pop;
          it.sprite.scale.set(k * 2, k, 1);
          m.opacity = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
          break;
        }
        case 'spark': {
          this._above(it.base, it.height, p);
          it.sprite.position.copy(p);
          const k = it.size * (0.45 + ease(t) * 0.9);
          it.sprite.scale.set(k, k, 1);
          m.opacity = 1 - t;
          break;
        }
        case 'fear': {
          const base = it.anchor?.position ?? it.base;
          this._above(base, it.height + Math.sin(it.age * 9) * 0.06 + ease(Math.min(1, t * 4)) * 0.2, p);
          it.sprite.position.copy(p);
          const pop = t < 0.15 ? 0.4 + (t / 0.15) * 0.8 : 1.2 - Math.min(0.2, (t - 0.15) * 0.4);
          const k = it.size * pop;
          it.sprite.scale.set(k, k, 1);
          m.opacity = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
          break;
        }
        case 'puff': {
          this._above(it.base, it.height + t * 0.8, p).addScaledVector(this.right, it.ox * (0.4 + t));
          it.sprite.position.copy(p);
          const k = it.size * (0.6 + t * 1.2);
          it.sprite.scale.set(k, k, 1);
          m.opacity = (1 - t) * 0.85;
          break;
        }
        default:
          break;
      }
    }
  }

  dispose() {
    for (const it of this.items) {
      this.group.remove(it.sprite);
      it.sprite.material.dispose();
    }
    this.items.length = 0;
  }
}
