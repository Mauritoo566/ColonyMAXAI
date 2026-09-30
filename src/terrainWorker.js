// Web Worker que genera los trozos de terreno en segundo plano.
import { buildChunkData } from './chunkBuilder.js';
import { setTerrainZones } from './elevation.js';

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'zones') {
    setTerrainZones(msg.zones);
  } else if (msg.type === 'build') {
    const data = buildChunkData(msg.params);
    self.postMessage({ id: msg.id, zonesVersion: msg.zonesVersion, ...data }, [
      data.positions.buffer,
      data.colors.buffer,
      data.normals.buffer,
      data.water.buffer,
    ]);
  }
};
