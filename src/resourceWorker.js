// Web Worker que genera los recursos naturales de cada baldosa en segundo plano.
import { generateTile } from './resourceGen.js';

self.onmessage = (event) => {
  const { key, i, j, cols } = event.data;
  const t = generateTile(i, j, cols);
  self.postMessage({ key, ...t }, [t.type.buffer, t.pos.buffer, t.basis.buffer, t.tint.buffer, t.rank.buffer]);
};
