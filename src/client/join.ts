export {}; // a module, so its names don't clash with the other pages' scripts

// An invite link, /join#<token>: make your own account, then walk in. The token rides in the
// fragment, so it never reaches a server log or a Referer header.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const token = location.hash.slice(1);
const form = $<HTMLFormElement>('form');
const name = $<HTMLInputElement>('name');
const password = $<HTMLInputElement>('password');
const again = $<HTMLInputElement>('again');
const submit = $<HTMLButtonElement>('submit');
const error = $('error');

function fail(msg: string) {
  $('sub').textContent = '';
  form.hidden = true;
  error.textContent = msg;
  $('login').hidden = false;
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; body: any }> {
  const res = await fetch('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

async function peek() {
  if (!token) return fail('Este link não contém o código de convite. Solicite o link completo a quem o enviou.');
  try {
    const r = await post({ peek: true });
    if (!r.ok) return fail(r.body.error ?? 'Este link de convite é inválido.');
    const { name: invited, role, by, project } = r.body as { name?: string; role: string; by: string; project: string };
    $('title').textContent = `Participar do escritório ${project}`;
    const sub = $('sub');
    sub.replaceChildren(`${by} convidou você${role === 'admin' ? ' como ' : '. '}`);
    if (role === 'admin') {
      const pill = document.createElement('span');
      pill.className = 'role';
      pill.textContent = 'admin';
      sub.append(pill, '.');
    }
    sub.append(' Crie sua conta para entrar.');
    if (invited) {
      name.value = invited;
      name.readOnly = true;
      name.title = 'O nome com o qual você foi convidado';
    }
    form.hidden = false;
    (invited ? password : name).focus();
  } catch {
    fail('Servidor inacessível.');
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  if (password.value !== again.value) {
    error.textContent = 'As senhas não coincidem';
    again.select();
    return;
  }
  submit.disabled = true;
  try {
    const r = await post({ name: name.value.trim(), password: password.value });
    if (!r.ok) {
      error.textContent = r.body.error ?? 'Não foi possível criar sua conta';
      return;
    }
    try {
      localStorage.setItem('agent-office.login-name', r.body.name);
    } catch {
      // storage blocked
    }
    location.replace('/');
  } catch {
    error.textContent = 'Servidor inacessível';
  } finally {
    submit.disabled = false;
  }
});

void peek();
