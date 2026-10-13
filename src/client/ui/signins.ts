import './signins.css';
import type { SignInKind, SignInState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';
import { confirmDialog } from './prompt';
import { copyButton } from './team';

const NAMES: Record<SignInKind, string> = { claude: 'Claude', github: 'GitHub' };

let open: { modal: Modal; say(why?: string): void } | null = null;

/**
 * 🔐 Your sign-ins: the Claude plan your workers run on and the GitHub account the office acts as
 * for you, both your own (see server/signins.ts). The office runs the sign-in itself and hands you
 * the page to open; or paste a token; admins may use the office machine's own instead.
 * `why` says what sent you here (hiring a worker before signing in, say).
 */
export function openSignIns(net: Net, why?: string) {
  if (open) return open.say(why);
  const close = h('button.btn.close', { 'aria-label': 'Fechar' }, '✕');
  const banner = h('p.team-status', { hidden: true });
  const cards = h('div.signins');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Seus logins', style: 'width:min(640px,100%)' },
    h('header', {}, h('h2', {}, '🔐 Seus logins'), close),
    h(
      'div.body.team',
      {},
      h('p.note.lead', {}, 'Seus trabalhadores usam sua própria conta Claude e GitHub: comentários, merges e PRs aparecerão em seu nome.'),
      banner,
      cards,
      h('p.note', {}, 'Ou abra um shell 🐚 em qualquer mesa: digite ', h('code', {}, 'claude auth login'), ' e ', h('code', {}, 'gh auth login'), ' para se autenticar.'),
    ),
  );

  // Kept across renders, so a half-typed code or token survives the next update.
  const inputs = {
    code: h('input', { type: 'text', placeholder: 'Cole o código aqui', 'aria-label': 'Código da página de autenticação', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement,
    claude: h('input', { type: 'password', placeholder: 'sk-ant-oat01-…', 'aria-label': 'Token do Claude', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement,
    github: h('input', { type: 'password', placeholder: 'ghp_… ou github_pat_…', 'aria-label': 'Token do GitHub', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement,
  };

  const say = (text?: string) => {
    banner.hidden = !text;
    banner.textContent = text ?? '';
  };

  const button = (label: string, onClick: () => void, cls = '') => {
    const b = h('button.btn', { type: 'button', class: cls }, label);
    b.addEventListener('click', onClick);
    return b;
  };

  const tokenRow = (which: SignInKind) => {
    const input = inputs[which];
    const save = h('button.btn', { type: 'submit' }, 'Salvar');
    const form = h('form.invite-row', {}, input, save) as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const token = input.value.trim();
      if (!token) return input.focus();
      net.send({ t: 'signins.token', which, token });
      input.value = '';
    });
    return form;
  };

  const card = (which: SignInKind, s: SignInState, office: boolean) => {
    const status =
      s.status === 'ok'
        ? h('span.signin-who.ok', {}, '✅ ', s.how === 'office' ? `Padrão do escritório${s.who ? ` (${s.who})` : ''}` : (s.who ?? 'Conectado'))
        : s.status === 'busy'
          ? h('span.signin-who', {}, '⏳ Entrando…')
          : h('span.signin-who.none', {}, 'Não conectado');
    const head = h('div.team-head', {}, h('h4', {}, which === 'claude' ? '✳️ Claude' : '🐙 GitHub'), status);
    const body = h('div.signin-body');
    const box = h('section.signin', { class: s.status }, head, body);
    if (s.error) body.append(h('p.team-status.error', {}, s.error));

    if (s.pending) {
      const url = s.pending.url && /^https:\/\//.test(s.pending.url) ? s.pending.url : undefined;
      if (!url) {
        body.append(h('p.note', {}, `Iniciando autenticação do ${NAMES[which]}…`));
      } else if (which === 'claude') {
        const send = h('button.btn.primary', { type: 'submit' }, s.pending.sent ? 'Verificando…' : 'Enviar');
        if (s.pending.sent) send.setAttribute('disabled', '');
        const form = h('form.invite-row', {}, inputs.code, send) as HTMLFormElement;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const code = inputs.code.value.trim();
          if (!code) return inputs.code.focus();
          net.send({ t: 'signins.code', code });
          inputs.code.value = '';
        });
        body.append(
          h('ol.signin-steps', {}, h('li', {}, h('a.btn.primary', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir página de login do Claude ↗'), ' e entre com sua própria conta.'), h('li', {}, 'Será exibido um código. Cole aqui:', form)),
        );
      } else {
        const code = s.pending.code ?? '';
        body.append(
          h(
            'ol.signin-steps',
            {},
            h('li', {}, 'Copie o código descartável:', h('div.cmd', {}, h('pre.signin-code', {}, code), copyButton('Copiar', () => code))),
            h('li', {}, h('a.btn.primary', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir github.com/login/device ↗'), ' e insira o código lá.'),
            h('li', {}, 'Esta tela atualiza automaticamente quando o GitHub confirmar.'),
          ),
        );
      }
      body.append(h('div.signin-actions', {}, button('Cancelar', () => net.send({ t: 'signins.cancel', which }))));
      return box;
    }

    if (s.status === 'ok') {
      const change = button(s.how === 'office' ? 'Usar minha própria conta' : 'Sair da conta', () => {
        if (s.how === 'office') return net.send({ t: 'signins.signout', which });
        confirmDialog(`Desconectar do ${NAMES[which]}?`, which === 'claude' ? 'Novos trabalhadores contratados precisarão de um novo login. Os que já estão em execução continuarão.' : 'O escritório deixará de interagir no GitHub em seu nome até você entrar novamente.', 'Desconectar', () => net.send({ t: 'signins.signout', which }));
      });
      body.append(h('div.signin-actions', {}, change));
      return box;
    }

    // Not signed in (or busy looking): the ways in.
    const start = button(`Entrar com ${NAMES[which]}`, () => net.send({ t: 'signins.start', which }), 'primary');
    const actions = h('div.signin-actions', {}, start);
    if (office) actions.append(button('Usar conta padrão do escritório', () => net.send({ t: 'signins.office', which })));
    body.append(
      actions,
      which === 'claude'
        ? h('p.note', {}, 'Ou cole um token: execute ', h('code', {}, 'claude setup-token'), ' em seu próprio computador (ou use uma chave de API Anthropic).')
        : h('p.note', {}, 'Ou cole um token do GitHub (', h('a', { href: 'https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=Agent%20Office', target: '_blank', rel: 'noopener noreferrer' }, 'gerar um'), ' com permissões repo, read:org e workflow).'),
      tokenRow(which),
    );
    return box;
  };

  const render = () => {
    const s = store.signins;
    const typing = document.activeElement;
    cards.replaceChildren();
    if (!s) {
      cards.append(h('p.empty', {}, store.me.account ? 'Carregando…' : 'Com a senha compartilhada do escritório, os trabalhadores usam as contas padrão do servidor.'));
      return;
    }
    cards.append(card('claude', s.claude, s.office), card('github', s.github, s.office));
    if (typing instanceof HTMLInputElement && Object.values(inputs).includes(typing) && typing.isConnected) typing.focus();
    // Once both are sorted, whatever sent you here is too.
    if (s.claude.status === 'ok' && s.github.status === 'ok') say();
  };

  const unsub = store.on('signins', render);
  const modal = openModal(el, {
    onClose: () => {
      unsub();
      open = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  open = { modal, say };
  say(why);
  render();
  net.send({ t: 'signins.get' });
}

/** Whether the panel should greet someone who just came in: their Claude sign-in still to do. */
export function needsSigningIn(): boolean {
  const s = store.signins;
  return !!store.me.account && !!s && s.claude.status === 'none' && s.claude.how === 'login';
}
