import './services.css';
import type { ServiceInfo, ServicesState } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { copy, copyButton, guessOs, openCommand, OS_LABEL, type Os } from './team';

/** Whether this page came over the office's Tailscale network, where every server has its own link. */
function onTailnet(s: ServicesState): boolean {
  return !!s.tailnet && location.hostname === s.tailnet;
}

export function serviceUrl(port: number, s = store.services): string {
  // Tailscale Serve points <office>.ts.net:<port> at the office, which relays it by the port.
  if (onTailnet(s)) return `https://${s.tailnet}:${port}`;
  // The tunnel lands on the office's own port, so it speaks whatever the office speaks.
  return `${location.protocol}//localhost:${port}`;
}

/**
 * One command that tunnels localhost:<port> to the office, which relays it to the worker's
 * server, and opens it once the tunnel is up. It uses the same SSH access as the office itself.
 */
export function serviceTunnel(s: ServicesState, port: number, os: Os): string {
  const open = openCommand(serviceUrl(port), os);
  return `ssh -N -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="${open}" -L ${port}:localhost:${s.port} ${s.ssh ?? 'you@your-server'}`;
}

/**
 * The command that opens every worker's server on someone's own computer by itself, as each one
 * starts (`agent-office tunnel`, src/server/tunnel/). It reaches the office the way this page did.
 */
export function autoTunnel(origin = location.origin): string {
  return origin === 'http://localhost:4600' ? 'agent-office tunnel' : `agent-office tunnel ${origin}`;
}

/** Whether the office is likely on another machine than this browser, so its workers' ports aren't already here. */
function elsewhere(s: ServicesState): boolean {
  return !!s.ssh || !/^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}

function describe(svc: ServiceInfo): { who: string; color: string; branch?: string } {
  const w = store.workers.get(svc.workerId);
  return { who: w?.name ?? 'Um trabalhador', color: w?.color ?? '#8d99ae', branch: w?.worktree?.branch };
}

export function openServices() {
  let os = guessOs();
  let picked: number | null = null;
  let copied: number | null = null;
  const body = h('div.body.team.services');
  const close = h('button.btn.close', { 'aria-label': 'Fechar' }, '✕');
  const tabs = h('div.os-tabs');
  const footer = h('footer', {}, h('span.grow', {}, 'Os túneis passam pelo escritório e continuam protegidos por senha.'));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Serviços', style: 'width:min(760px,100%)' },
    h('header', {}, h('h2', {}, '🌐 Serviços'), tabs, close),
    body,
    footer,
  );

  const pick = async (svc: ServiceInfo) => {
    const s = store.services;
    picked = svc.port;
    copied = (await copy(onTailnet(s) ? serviceUrl(svc.port) : serviceTunnel(s, svc.port, os))) ? svc.port : null;
    render();
  };

  const render = () => {
    const s = store.services;
    const direct = onTailnet(s);
    tabs.replaceChildren(
      ...(direct ? [] : (Object.keys(OS_LABEL) as Os[])).map((o) =>
        h('button.btn', { type: 'button', class: o === os ? 'on' : '', onclick: () => ((os = o), (copied = null), render()) }, OS_LABEL[o]),
      ),
    );
    footer.firstElementChild!.textContent = direct
      ? 'Cada link passa pelo escritório, então o login no escritório continua protegendo todas as páginas.'
      : 'Os túneis passam pelo escritório, então a senha do escritório continua protegendo todas as páginas. Mantenha o terminal aberto enquanto visualiza.';
    body.replaceChildren(
      h(
        'p.note',
        { style: 'margin:0 0 12px' },
        direct
          ? 'Servidores web em execução pelos trabalhadores. Cada um tem seu próprio link na sua rede Tailscale: abra ou clique na linha para copiar para outra pessoa na rede.'
          : 'Servidores web em execução pelos trabalhadores. Clique em um para copiar um comando que o abre no seu computador — execute-o em um terminal e a página abre automaticamente.',
      ),
    );
    if (!direct && elsewhere(s)) {
      body.append(
        h(
          'div.svc-auto',
          {},
          h('p', {}, '⚡ Abrir todos automaticamente'),
          h(
            'p.note',
            {},
            'Execute isto no seu computador e deixe rodando. Todo servidor que um trabalhador iniciar abre na mesma porta lá (',
            h('code', {}, 'localhost:5173'),
            ' é o do trabalhador) e fecha quando o trabalhador parar. Requer o comando ',
            h('code', {}, 'agent-office'),
            ' no seu computador: veja a linha de instalação no README.',
          ),
          h('div.cmd', {}, h('pre', {}, autoTunnel()), copyButton('Copiar', () => autoTunnel())),
        ),
      );
    }
    if (!s.items.length) {
      body.append(
        h(
          'div.svc-empty',
          {},
          h('p', {}, 'Nada rodando ainda.'),
          h('p.note', {}, 'Quando um trabalhador inicia um servidor web — ', h('code', {}, 'npm run dev'), ', um build de prévia, ', h('code', {}, 'python -m http.server'), ' — ele aparece aqui em poucos segundos. Experimente pedir: “inicie o servidor de desenvolvimento em segundo plano para podermos revisar”.'),
        ),
      );
      return;
    }
    const list = h('ul.svc-list');
    for (const svc of s.items) {
      const { who, color, branch } = describe(svc);
      const on = picked === svc.port;
      const title = direct ? `Abrir ${serviceUrl(svc.port)}` : `Abrir ${serviceUrl(svc.port)} (requer o túnel, a menos que o escritório rode neste computador)`;
      const open = h('a.btn', { href: serviceUrl(svc.port), target: '_blank', rel: 'noopener', title }, 'Abrir ↗');
      open.addEventListener('click', (e) => e.stopPropagation());
      const li = h(
        'li',
        { class: on ? 'on' : '', tabindex: 0, role: 'button', title: direct ? 'Copiar o link' : 'Copiar o comando do túnel' },
        h('span.dot', { style: `background:${color}` }),
        h(
          'div.svc-main',
          {},
          h('div.svc-title', {}, svc.title || svc.command),
          h('div.svc-meta', {}, [who, branch ? `🌿 ${branch}` : '', svc.title ? svc.command : '', `iniciado há ${timeAgo(svc.since)}`].filter(Boolean).join(' · ')),
        ),
        h('span.svc-port', {}, `:${svc.port}`),
        open,
      );
      li.addEventListener('click', () => void pick(svc));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void pick(svc);
        }
      });
      list.append(li);
    }
    body.append(list);

    const svc = s.items.find((i) => i.port === picked);
    if (svc && direct) {
      body.append(
        copied === svc.port
          ? h('p.team-status.ok', {}, `✅ Copiado ${serviceUrl(svc.port)}. Qualquer pessoa na rede conectada ao escritório pode abrir.`)
          : h('p.team-status', {}, `O link para :${svc.port}: ${serviceUrl(svc.port)}`),
      );
    } else if (svc) {
      const cmd = serviceTunnel(s, svc.port, os);
      body.append(
        copied === svc.port
          ? h('p.team-status.ok', {}, `✅ Copiado. Cole no terminal: abre ${serviceUrl(svc.port)} assim que o túnel conectar.`)
          : h('p.team-status', {}, `O comando para :${svc.port} — execute no terminal e ele abre ${serviceUrl(svc.port)}.`),
        h('div.cmd', {}, h('pre', {}, cmd), copyButton('Copiar', () => cmd)),
      );
    } else if (picked !== null) {
      body.append(h('p.team-status.error', {}, `O servidor na porta :${picked} parou.`));
    }
    if (direct) return;
    body.append(
      s.ssh
        ? h('p.note', {}, 'Usa o mesmo acesso SSH do escritório. Não foi convidado (você mesmo configurou o escritório)? Execute ', h('code', {}, `${s.deploy ?? 'deploy/aws.sh'} service <porta>`), ' em vez disso.')
        : h('p.note', {}, 'Substitua ', h('code', {}, 'you@your-server'), ' pelo comando SSH para a máquina do escritório. Se o escritório estiver rodando neste computador, basta clicar em Abrir.'),
    );
  };

  const unsubs = [store.on('services', render), store.on('workers', render)];
  // Keeps "up 5m" fresh.
  const tick = setInterval(render, 30_000);
  const modal = openModal(el, {
    doing: '🌐 no painel de serviços',
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
}
