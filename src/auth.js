// Inicio de sesión y registro. El juego no tiene servidor: las cuentas se guardan en
// este navegador (localStorage) y cada una tiene su propia partida (storage.js). La
// contraseña nunca se guarda: sólo una huella PBKDF2 con sal, así que no se puede leer.

const ACCOUNTS_KEY = 'colonymaxai.accounts';
const SESSION_KEY = 'colonymaxai.session';
const LEGACY_KEYS = ['camp', 'colony', 'buildTab']; // partidas de antes de las cuentas
const ITERATIONS = 150_000;

function readAccounts() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || {};
  } catch {
    return {};
  }
}

function writeAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: ITERATIONS }, key, 256);
  return toHex(bits);
}

function validName(name) {
  return /^[\p{L}\p{N}_ .-]{3,20}$/u.test(name);
}

export async function register(name, password) {
  name = name.trim();
  if (!validName(name)) throw new Error('El nombre debe tener de 3 a 20 letras, números, espacios, puntos o guiones.');
  if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
  const accounts = readAccounts();
  const id = name.toLowerCase();
  if (accounts[id]) throw new Error('Ya existe una cuenta con ese nombre en este navegador.');
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  accounts[id] = { name, salt, hash: await hashPassword(password, salt), created: Date.now() };
  writeAccounts(accounts);
  adoptLegacySave(id);
  return accounts[id].name;
}

export async function login(name, password) {
  const account = readAccounts()[name.trim().toLowerCase()];
  // El mismo mensaje en los dos casos, para no revelar qué cuentas existen.
  const wrong = new Error('Nombre o contraseña incorrectos.');
  if (!account) throw wrong;
  if ((await hashPassword(password, account.salt)) !== account.hash) throw wrong;
  return account.name;
}

// La partida jugada antes de que existieran las cuentas pasa a la primera cuenta.
export function adoptLegacySave(id) {
  id = id.toLowerCase();
  for (const key of LEGACY_KEYS) {
    const value = localStorage.getItem(`colonymaxai.${key}`);
    if (value === null) continue;
    const target = `colonymaxai.u.${id}.${key}`;
    if (localStorage.getItem(target) === null) localStorage.setItem(target, value);
    localStorage.removeItem(`colonymaxai.${key}`);
  }
}

export function currentSession() {
  const name = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
  return name && readAccounts()[name.toLowerCase()] ? readAccounts()[name.toLowerCase()].name : null;
}

function startSession(name, remember) {
  sessionStorage.setItem(SESSION_KEY, name);
  if (remember) localStorage.setItem(SESSION_KEY, name);
  else localStorage.removeItem(SESSION_KEY);
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  location.reload();
}

// Pantalla de acceso. "worldPromise" resuelve el mundo compartido (world.js) o null.
// Resuelve con { name, storageId, world, me }:
//  - con mundo compartido: el jugador es la cuenta de Claude con la que se abrió la
//    página; registrarse es elegir el nombre de jugador (sin contraseña);
//  - sin él: cuentas locales de este navegador con nombre y contraseña.
export async function requireLogin(worldPromise) {
  const screen = document.getElementById('auth');
  const $ = (sel) => screen.querySelector(sel);
  const status = $('[data-status]');
  screen.hidden = false;

  const world = await worldPromise;
  if (world) return onlineLogin(screen, world);

  let saved = null;
  try {
    saved = currentSession();
  } catch {
    // Sin almacenamiento (ventana privada estricta): se juega sin cuenta.
    screen.remove();
    return { name: 'Jugador', storageId: 'local', world: null, me: null };
  }
  if (saved) {
    screen.remove();
    return { name: saved, storageId: saved.toLowerCase(), world: null, me: null };
  }
  status.hidden = true;
  return localLogin(screen);
}

function leave(screen) {
  screen.classList.add('is-leaving');
  setTimeout(() => screen.remove(), 400);
}

function showError(screen, message) {
  const error = screen.querySelector('[data-error]');
  error.textContent = message;
  error.hidden = !message;
}

async function onlineLogin(screen, world) {
  const $ = (sel) => screen.querySelector(sel);
  const form = $('form');
  const submit = form.querySelector('[type="submit"]');
  for (const el of screen.querySelectorAll('[data-local]')) el.hidden = true;
  form.elements.password.required = false;
  $('[data-note]').textContent =
    'Este planeta es un mundo compartido: los campamentos de todos los jugadores se ven en tiempo real. Tu cuenta de Claude identifica a tu jugador.';
  $('[data-status]').hidden = true;
  let me = null;
  try {
    me = await world.me();
  } catch {
    me = null;
  }
  form.hidden = false;
  const welcome = $('[data-welcome]');
  if (me) {
    // Ya registrado: iniciar sesión es un clic.
    $('[data-name-field]').hidden = true;
    welcome.hidden = false;
    welcome.textContent = '';
    welcome.append('Hola de nuevo, ');
    const strong = document.createElement('strong');
    strong.textContent = me.name;
    welcome.append(strong, me.camp ? '. Tu campamento te espera.' : '. Todavía no fundaste tu campamento.');
    submit.textContent = 'Entrar al mundo';
  } else {
    welcome.hidden = false;
    welcome.textContent = 'Primera vez en este mundo: elige tu nombre de jugador.';
    submit.textContent = 'Crear mi jugador y entrar';
    form.elements.name.focus();
  }
  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError(screen, '');
      submit.disabled = true;
      try {
        let name = me?.name;
        if (!me) {
          name = await world.register(form.elements.name.value);
          adoptLegacySave(`w-${world.uid}`); // la partida de antes pasa a este jugador
          me = await world.me();
        }
        leave(screen);
        resolve({ name, storageId: `w-${world.uid}`, world, me });
      } catch (err) {
        showError(screen, err.message || 'No se pudo entrar.');
        submit.disabled = false;
      }
    });
  });
}

function localLogin(screen) {
  const $ = (sel) => screen.querySelector(sel);
  const form = $('form');
  const submit = form.querySelector('[type="submit"]');
  const tabs = screen.querySelectorAll('[data-mode]');
  form.hidden = false;
  $('[data-note]').textContent = 'Sin conexión al mundo compartido: las cuentas y partidas se guardan en este navegador y cada cuenta tiene su propio campamento.';
  let mode = Object.keys(readAccounts()).length ? 'login' : 'register';
  const setMode = (m) => {
    mode = m;
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === m));
    $('[data-confirm]').hidden = m !== 'register';
    form.elements.confirm.required = m === 'register';
    form.elements.password.autocomplete = m === 'register' ? 'new-password' : 'current-password';
    submit.textContent = m === 'register' ? 'Crear cuenta y jugar' : 'Entrar';
    showError(screen, '');
  };
  for (const t of tabs) t.addEventListener('click', () => setMode(t.dataset.mode));
  setMode(mode);
  form.elements.name.focus();

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.elements.name.value;
      const password = form.elements.password.value;
      showError(screen, '');
      if (mode === 'register' && password !== form.elements.confirm.value) {
        showError(screen, 'Las contraseñas no coinciden.');
        return;
      }
      submit.disabled = true;
      try {
        const player = mode === 'register' ? await register(name, password) : await login(name, password);
        startSession(player, form.elements.remember.checked);
        leave(screen);
        resolve({ name: player, storageId: player.toLowerCase(), world: null, me: null });
      } catch (err) {
        showError(screen, err.message || 'No se pudo entrar.');
        submit.disabled = false;
      }
    });
  });
}
