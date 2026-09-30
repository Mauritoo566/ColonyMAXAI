import { storageKey } from './storage.js';

// Guardado de la partida en este navegador (localStorage). Lo que se guarda lo arma la
// simulación (sim/colony.js: colonos, edificios, almacén...) más el reloj y el clima del
// mundo. Cuando exista el servidor del juego, la partida vivirá allá y esto se irá.

export function saveColony(sim, world) {
  if (!sim.camp) return;
  const data = sim.serialize();
  data.world = world.save();
  try {
    localStorage.setItem(storageKey('colony'), JSON.stringify(data));
  } catch {
    // Sin almacenamiento: la colonia dura sólo esta sesión.
  }
}

export function loadColony() {
  try {
    return JSON.parse(localStorage.getItem(storageKey('colony')));
  } catch {
    return null;
  }
}
