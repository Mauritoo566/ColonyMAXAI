// Inicio de sesión y registro contra el servidor del juego. La contraseña sólo viaja al
// servidor (que guarda una huella, nunca la contraseña); el navegador guarda un token de
// sesión para entrar solo la próxima vez, desde este mismo equipo.

const TOKEN_KEY = 'colonymaxai.token';

export function savedToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Sin almacenamiento: habrá que entrar con la contraseña cada vez.
  }
}

// Cerrar sesión: el servidor olvida el token y se vuelve a la pantalla de acceso.
export function logout(net) {
  net.send({ t: 'logout' });
  saveToken(null);
  setTimeout(() => location.reload(), 200);
}

// Pantalla de acceso. Resuelve con { name, playerId, token } cuando el servidor aceptó la
// sesión (con el token guardado o con nombre y contraseña).
export function requireLogin(net) {
  const screen = document.getElementById('auth');
  const $ = (sel) => screen.querySelector(sel);
  const status = $('[data-status]');
  const tabs = $('[data-tabs]');
  const form = $('form');
  const submit = form.querySelector('[type="submit"]');
  const error = $('[data-error]');
  screen.hidden = false;

  const showError = (message) => {
    error.textContent = message;
    error.hidden = !message;
  };
  const showForm = () => {
    status.hidden = true;
    tabs.hidden = false;
    form.hidden = false;
    submit.disabled = false;
    form.elements.name.focus();
  };

  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    for (const t of tabs.querySelectorAll('[data-mode]')) t.setAttribute('aria-selected', String(t.dataset.mode === m));
    $('[data-confirm]').hidden = m !== 'register';
    form.elements.confirm.required = m === 'register';
    form.elements.password.autocomplete = m === 'register' ? 'new-password' : 'current-password';
    submit.textContent = m === 'register' ? 'Crear cuenta y jugar' : 'Entrar';
    showError('');
  };
  for (const t of tabs.querySelectorAll('[data-mode]')) t.addEventListener('click', () => setMode(t.dataset.mode));
  setMode(savedToken() ? 'login' : 'register');

  return new Promise((resolve) => {
    let done = false;
    const tryToken = () => {
      const token = savedToken();
      if (!token) {
        showForm();
        return;
      }
      status.hidden = false;
      status.textContent = 'Entrando…';
      net.send({ t: 'resume', token });
    };

    net.on('auth', (msg) => {
      if (done) return;
      if (msg.ok) {
        done = true;
        saveToken(msg.token);
        screen.classList.add('is-leaving');
        setTimeout(() => screen.remove(), 400);
        resolve({ name: msg.name, playerId: msg.playerId, token: msg.token });
        return;
      }
      if (msg.expired) saveToken(null); // la sesión venció: hay que entrar de nuevo
      showForm();
      showError(msg.error ?? (msg.expired ? 'Tu sesión venció. Entra de nuevo.' : ''));
    });

    // Conexión: mientras no haya, se avisa y se sigue intentando sola.
    const onStatus = (s) => {
      if (done) return;
      if (s === 'open') tryToken();
      else {
        status.hidden = false;
        status.textContent = 'No se pudo conectar con el servidor. Reintentando…';
        submit.disabled = true;
      }
    };
    net.onStatus = onStatus;
    if (net.status === 'open') tryToken();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      showError('');
      const name = form.elements.name.value;
      const password = form.elements.password.value;
      if (mode === 'register' && password !== form.elements.confirm.value) {
        showError('Las contraseñas no coinciden.');
        return;
      }
      if (!net.send({ t: mode, name, password })) {
        showError('No hay conexión con el servidor. Espera un momento y prueba de nuevo.');
        return;
      }
      submit.disabled = true;
      // Si el servidor contesta con un error, el formulario se vuelve a habilitar.
      setTimeout(() => (submit.disabled = false), 4000);
    });
  });
}
