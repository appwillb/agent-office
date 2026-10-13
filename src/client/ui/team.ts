import './team.css';
import type { ServerMsg, TeamState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';
import { confirmDialog } from './prompt';

export type Os = 'mac' | 'linux' | 'windows';
export const OS_LABEL: Record<Os, string> = { mac: 'macOS', linux: 'Linux', windows: 'Windows' };

export function guessOs(): Os {
  const p = navigator.userAgent;
  return /Windows/i.test(p) ? 'windows' : /Mac/i.test(p) ? 'mac' : 'linux';
}

/** Opens a URL in the browser, for ssh's LocalCommand. */
export function openCommand(url: string, os: Os): string {
  return os === 'mac' ? `open ${url}` : os === 'windows' ? `start ${url}` : `xdg-open ${url} >/dev/null 2>&1 &`;
}

/** One command that opens the tunnel and, once it's up, the office in their browser. */
export function tunnelCommand(t: TeamState, os: Os): string {
  // LocalCommand runs after the forward is listening, so the page loads on the first try.
  const open = openCommand(`http://localhost:${t.port}`, os);
  return `ssh -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="${open}" -L ${t.port}:localhost:${t.port} ${t.ssh}`;
}

function inviteMessage(t: TeamState, os: Os): string {
  const project = store.project?.name ?? 'nosso';
  return [
    `Você foi convidado para o Agent Office do projeto ${project}. Execute isto no terminal (${OS_LABEL[os]}):`,
    '',
    tunnelCommand(t, os),
    '',
    `Ele abrirá o escritório em http://localhost:${t.port} — entre (com a senha do escritório ou pelo link da sua conta) e mantenha o terminal aberto enquanto estiver aqui.`,
    t.fingerprint ? `Na primeira vez, o ssh perguntará se confia no servidor. Confirme apenas se mostrar ${t.fingerprint}` : '',
  ]
    .filter((l, i, all) => l || all[i - 1])
    .join('\n')
    .trim();
}

/** On an office on a Tailscale network: the link, and how to get onto the network. */
function tailnetMessage(t: TeamState): string {
  const project = store.project?.name ?? 'nosso';
  return [
    `Você foi convidado para o Agent Office do projeto ${project}: https://${t.tailnet}`,
    '',
    "Está na nossa rede Tailscale. Se ainda não estiver conectado: instale o Tailscale (https://tailscale.com/download), faça login e aceite o convite que enviei. Em seguida, acesse o link e faça login com a senha ou com o link da sua conta.",
  ].join('\n');
}

const TAILSCALE_ADMIN = 'https://login.tailscale.com/admin';

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Not a secure context: fall back to a hidden textarea.
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function copyButton(label: string, text: () => string, cls = '') {
  const btn = h('button.btn', { type: 'button', class: cls }, label);
  btn.addEventListener('click', async () => {
    btn.textContent = (await copy(text())) ? '✓ Copiado' : 'Falha ao copiar';
    setTimeout(() => (btn.textContent = label), 1600);
  });
  return btn;
}

let onInvited: ((msg: Extract<ServerMsg, { t: 'team.invited' }>) => void) | null = null;

export function routeTeamMessage(msg: ServerMsg) {
  if (msg.t === 'team.invited') onInvited?.(msg);
}

export function openTeam(net: Net) {
  let os = guessOs();
  let status: HTMLElement | null = null;
  const body = h('div.body.team');
  const close = h('button.btn.close', { 'aria-label': 'Fechar' }, '✕');
  const message = (t: TeamState) => (t.tailnet ? tailnetMessage(t) : inviteMessage(t, os));
  const copyMsg = copyButton('✉️ Copiar mensagem de convite', () => (store.team ? message(store.team) : ''), 'primary');
  const footer = h('footer', {}, h('span.grow', {}, 'Pessoas convidadas precisam fazer login com a senha ou com convite em 🔑 Contas.'), copyMsg);
  const el = h('div.modal', { role: 'dialog', 'aria-label': 'Convidar colegas de equipe', style: 'width:min(680px,100%)' }, h('header', {}, h('h2', {}, '👥 Convidar colegas de equipe'), close), body, footer);

  const input = h('input', { type: 'text', maxlength: 40, placeholder: 'Usuário do GitHub', 'aria-label': 'Usuário do GitHub', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const inviteBtn = h('button.btn.primary', { type: 'submit' }, 'Convidar');
  const form = h('form.invite-row', {}, input, inviteBtn) as HTMLFormElement;
  const setStatus = (text: string, kind: 'busy' | 'ok' | 'error') => {
    status = h('p.team-status', { class: kind }, text);
    render();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const github = input.value.trim();
    if (!github) return input.focus();
    inviteBtn.disabled = true;
    setStatus(`Buscando chaves SSH de ${github} no GitHub…`, 'busy');
    net.send({ t: 'team.invite', github });
  });

  let focused = false;
  const render = () => {
    const t = store.team;
    const typing = document.activeElement === input;
    body.replaceChildren();
    if (!t) return body.append(h('p.empty', {}, 'Carregando…'));
    footer.classList.toggle('hidden', !!t.unavailable);
    if (t.unavailable) return body.append(h('p', { style: 'margin:0;font-weight:700' }, t.unavailable));
    if (t.tailnet) return renderTailnet(t);

    body.append(
      h('label', {}, 'Convidar alguém pelo nome de usuário do GitHub'),
      form,
      h('p.note', {}, 'As chaves SSH públicas de github.com/<usuario>.keys poderão abrir um túnel para este escritório — nada além disso: sem acesso ao terminal do servidor nem outras portas.'),
    );
    if (status) body.append(status);
    if (t.error) body.append(h('p.team-status.error', {}, t.error));

    const tabs = h(
      'div.os-tabs',
      {},
      ...(Object.keys(OS_LABEL) as Os[]).map((o) =>
        h('button.btn', { type: 'button', class: o === os ? 'on' : '', onclick: () => ((os = o), render()) }, OS_LABEL[o]),
      ),
    );
    body.append(
      h('div.team-head', {}, h('h4', {}, 'Envie este comando para a pessoa'), tabs),
      h('div.cmd', {}, h('pre', {}, tunnelCommand(t, os)), copyButton('Copiar', () => tunnelCommand(t, os))),
      h(
        'p.note',
        {},
        `Ele abre o túnel e carrega http://localhost:${t.port} no navegador da pessoa. Mantenha o terminal aberto enquanto estiver usando. `,
        t.fingerprint ? h('span', {}, 'Na primeira conexão, o ssh pergunta se confia no servidor: a impressão digital deve ser ', h('code', {}, t.fingerprint), '.') : null,
      ),
    );
    if (!t.ssh?.startsWith('ssh://')) {
      body.append(h('p.note', {}, 'O SSH só responde aos IPs autorizados no firewall. Se o IP da pessoa não estiver liberado, execute ', h('code', {}, `${t.deploy ?? 'deploy/aws.sh'} allow <ip-dela>`), ' (ou ', h('code', {}, 'allow anywhere'), ') na sua máquina.'));
    }

    body.append(h('h4', {}, `Convidados `, h('span.count', {}, String(t.members.length))), memberList(t));
    if (typing || !focused) setTimeout(() => input.focus(), 30);
    focused = true;
  };

  // Tailscale decides who gets in: the panel says how to let someone onto the network.
  const renderTailnet = (t: TeamState) => {
    const url = `https://${t.tailnet}`;
    const link = (path: string, text: string) => h('a', { href: `${TAILSCALE_ADMIN}/${path}`, target: '_blank', rel: 'noopener' }, text);
    body.append(
      h('label', {}, 'Qualquer pessoa na sua rede Tailscale acessa em'),
      h('div.cmd', {}, h('pre', {}, url), copyButton('Copiar', () => url)),
      h('p.note', {}, 'Sem terminais para manter abertos. Utiliza HTTPS, então voz e compartilhamento de tela funcionam normalmente.'),
      h('h4', {}, "Para quem ainda não está na rede"),
      h(
        'p.note',
        {},
        'Compartilhe esta máquina: na página de ',
        link('machines', 'Máquinas'),
        ' do Tailscale, abra ',
        h('code', {}, t.tailnet!.split('.')[0]),
        ', escolha Compartilhar… e envie o link para ela. Ou adicione a pessoa na rede em ',
        link('users', 'Usuários'),
        '.',
      ),
    );
    if (status) body.append(status);
    if (t.error) body.append(h('p.team-status.error', {}, t.error));
    if (t.members.length) body.append(h('h4', {}, 'Convidados por chave SSH ', h('span.count', {}, String(t.members.length))), memberList(t));
  };

  const memberList = (t: TeamState) => {
    const list = h('ul.team-list');
    for (const m of t.members) {
      const remove = h('button.btn', { type: 'button', title: `Revogar acesso de ${m.name}` }, 'Remover');
      remove.addEventListener('click', () =>
        confirmDialog(
          `Remover ${m.name}?`,
          `As chaves dessa pessoa deixarão de funcionar imediatamente. Conexões ativas cairão. ${m.name} ainda poderá entrar com a senha compartilhada caso a possua.`,
          'Remover',
          () => net.send({ t: 'team.remove', name: m.name }),
        ),
      );
      list.append(h('li', {}, h('span.name', {}, m.name), h('span.keys', {}, `${m.keys} chave${m.keys === 1 ? '' : 's'}`), remove));
    }
    if (!t.members.length) list.append(h('li.empty', {}, 'Ninguém ainda'));
    return list;
  };

  onInvited = (msg) => {
    inviteBtn.disabled = false;
    if (msg.error) return setStatus(msg.error, 'error');
    input.value = '';
    setStatus(`✅ ${msg.name} foi convidado (${msg.keys} chave${msg.keys === 1 ? '' : 's'}). Envie o comando abaixo para ela.`, 'ok');
  };
  const unsub = store.on('team', render);
  const modal = openModal(el, {
    onClose: () => {
      unsub();
      onInvited = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  net.send({ t: 'team.get' });
}
