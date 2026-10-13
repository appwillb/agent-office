import './queue.css';
import type { AgentProvider, QueueTask, Usage } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, STATUS_LABEL } from './dom';
import { confirmDialog } from './prompt';
import { providerPicker, providerLabel, providerUsageState, providerWaitingLabel, resolvedProvider, modelBadge } from './provider';
import { officeFull } from '../../shared/machine';
import { dictateField } from './dictate';

export interface QueueActions {
  openTerminal(workerId: string): void;
}

/** The queue task's name, linked to its GitHub issue when it has one. */
function taskTitle(t: QueueTask): HTMLElement {
  if (t.issue === undefined) return h('div.queue-title', { title: t.prompt }, t.title);
  const issue = store.issues.items.find((i) => i.number === t.issue);
  const text = t.title.startsWith(`#${t.issue}`) ? t.title : `#${t.issue} ${t.title}`;
  return h('div.queue-title', { title: t.prompt }, issue ? h('a', { href: issue.url, target: '_blank', rel: 'noopener' }, text) : text);
}

function outcome(t: QueueTask): string {
  switch (t.outcome) {
    case 'done':
      return t.pr ? 'concluído' : 'concluído, nenhum PR encontrado ainda';
    case 'exited':
      return t.error ? `parou: ${t.error}` : 'parou antes de concluir';
    case 'killed':
      return 'dispensado';
    case 'failed':
      return `não pôde iniciar: ${t.error ?? 'erro desconhecido'}`;
    default:
      return '';
  }
}

export function openQueue(net: Net, actions: QueueActions) {
  const body = h('div.body.queue');
  const close = h('button.btn.close', { 'aria-label': 'Fechar' }, '✕');
  const limitValue = h('b');
  const minus = h('button.btn', { type: 'button', title: 'Menos trabalhadores simultâneos', 'aria-label': 'Menos trabalhadores simultâneos' }, '−');
  const plus = h('button.btn', { type: 'button', title: 'Mais trabalhadores simultâneos', 'aria-label': 'Mais trabalhadores simultâneos' }, '+');
  const limit = h('div.queue-limit', { title: 'Quantos trabalhadores a fila mantém ativos ao mesmo tempo. 0 pausa a fila.' }, 'Agentes simultâneos', minus, limitValue, plus);
  minus.addEventListener('click', () => net.send({ t: 'queue.limit', maxWorkers: store.queue.maxWorkers - 1 }));
  plus.addEventListener('click', () => net.send({ t: 'queue.limit', maxWorkers: store.queue.maxWorkers + 1 }));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Fila de tarefas', style: 'width:min(800px,100%)' },
    h('header', {}, h('h2', {}, '📋 Fila de tarefas'), limit, close),
    body,
    h('footer', {}, h('span.grow', {}, 'A fila continua trabalhando enquanto você estiver ausente. Defina 0 agentes para pausar.')),
  );

  const ta = h('textarea', { rows: 2, placeholder: 'Descreva uma tarefa para o próximo trabalhador livre…', 'aria-label': 'Nova tarefa' }) as HTMLTextAreaElement;
  const provider = providerPicker(store.project, 'queue-provider');
  const addBtn = h('button.btn.primary', { type: 'submit' }, 'Adicionar à fila');
  const form = h('form.queue-add', {}, dictateField(ta), provider.element, addBtn) as HTMLFormElement;
  form.noValidate = true;
  const submit = () => {
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    if (!provider.valid()) return;
    net.send({ t: 'queue.add', prompt: text, provider: provider.value(), model: provider.model(), effort: provider.effort() });
    ta.value = '';
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });

  const section = (title: string, tasks: QueueTask[], extra?: HTMLElement) => {
    if (!tasks.length) return null;
    return h('div', {}, h('h4', {}, title, h('span.count', {}, String(tasks.length)), extra ?? null), h('ul.queue-list', {}, ...tasks.map(row)));
  };

  const row = (t: QueueTask): HTMLElement => {
    const w = t.workerId ? store.workers.get(t.workerId) : undefined;
    const meta: string[] = [];
    const buttons: HTMLElement[] = [];
    const badge = modelBadge(t.provider, t.model, t.effort);
    const model = badge ? ` · inicial: ${badge}` : '';
    const usageSuffix = (provider: AgentProvider | undefined, usage?: Usage) => {
      const state = providerUsageState(provider, store.project, usage);
      if (state === 'untracked') return ' · uso não rastreado';
      if (state !== 'waiting') return '';
      const waiting = providerWaitingLabel(provider, store.project);
      return waiting ? ` · ${waiting}` : '';
    };
    let pos: string | null = null;
    if (t.status === 'running') {
      const selectedProvider = providerLabel(t.provider ?? w?.provider, store.project);
      meta.push(`⚙️ ${selectedProvider}${model}${usageSuffix(t.provider ?? w?.provider, w?.usage)}`);
      meta.push(`${t.workerName ?? 'um trabalhador'} · ${w ? STATUS_LABEL[w.status] ?? w.status : 'ausente'}`);
      if (t.branch) meta.push(`🌿 ${t.branch}`);
      if (t.startedAt) meta.push(`iniciado há ${timeAgo(t.startedAt)}`);
      meta.push(`por ${t.addedBy}`);
      if (w) {
        buttons.push(h('button.btn', { type: 'button', onclick: () => actions.openTerminal(w.id) }, '🖥️ Terminal'));
        buttons.push(
          h('button.btn', {
            type: 'button',
            title: 'Mandar o trabalhador para casa; a tarefa conta como interrompida',
            onclick: () => confirmDialog(`Parar ${w.name}?`, `Isso manda ${w.name} para casa e interrompe a tarefa. Você pode colocá-la na fila novamente depois.`, 'Parar', () => net.send({ t: 'worker.kill', workerId: w.id })),
          }, '⏹ Parar'),
        );
      }
    } else if (t.status === 'queued') {
      const queued = store.queue.tasks.filter((x) => x.status === 'queued');
      const i = queued.indexOf(t);
      pos = String(i + 1);
      meta.push(`⚙️ ${providerLabel(t.provider, store.project)}${model}${usageSuffix(t.provider, w?.usage)}`);
      meta.push(`adicionado por ${t.addedBy} há ${timeAgo(t.addedAt)}`);
      buttons.push(h('button.btn', { type: 'button', title: 'Mover para cima', 'aria-label': 'Mover para cima', disabled: i === 0, onclick: () => net.send({ t: 'queue.move', taskId: t.id, delta: -1 }) }, '↑'));
      buttons.push(h('button.btn', { type: 'button', title: 'Mover para baixo', 'aria-label': 'Mover para baixo', disabled: i === queued.length - 1, onclick: () => net.send({ t: 'queue.move', taskId: t.id, delta: 1 }) }, '↓'));
      buttons.push(h('button.btn', { type: 'button', title: 'Remover da fila', 'aria-label': 'Remover', onclick: () => net.send({ t: 'queue.remove', taskId: t.id }) }, '✕'));
    } else {
      meta.push(`⚙️ ${providerLabel(t.provider, store.project)}${model}${usageSuffix(t.provider, w?.usage)}`);
      meta.push(outcome(t));
      if (t.workerName) meta.push(t.workerName);
      if (t.branch) meta.push(`🌿 ${t.branch}`);
      if (t.finishedAt) meta.push(timeAgo(t.finishedAt));
      if (t.pr) buttons.push(h('a.btn', { href: t.pr.url, target: '_blank', rel: 'noopener', title: t.pr.title }, `🔀 PR #${t.pr.number}${t.pr.state === 'MERGED' ? ' ✓' : t.pr.state === 'DRAFT' ? ' (rascunho)' : ''}`));
      if (w) buttons.push(h('button.btn', { type: 'button', onclick: () => actions.openTerminal(w.id) }, '🖥️ Terminal'));
      buttons.push(h('button.btn', { type: 'button', title: 'Colocar de volta na fila', onclick: () => net.send({ t: 'queue.retry', taskId: t.id }) }, '↻ Repetir'));
      buttons.push(h('button.btn', { type: 'button', title: 'Esquecer', 'aria-label': 'Remover', onclick: () => net.send({ t: 'queue.remove', taskId: t.id }) }, '✕'));
    }
    return h(
      'li',
      { class: t.status },
      pos ? h('span.pos', {}, pos) : null,
      h('div.queue-main', {}, taskTitle(t), h('div.queue-meta', {}, meta.join(' · '))),
      h('div.queue-actions', {}, ...buttons),
    );
  };

  // The form stays put and only the list below it re-renders, so worker updates don't pull focus out of the textarea.
  const list = h('div');
  body.append(form, list);

  const render = () => {
    const q = store.queue;
    limitValue.textContent = q.maxWorkers === 0 ? 'Pausado' : String(q.maxWorkers);
    minus.toggleAttribute('disabled', q.maxWorkers <= 0);
    const running = q.tasks.filter((t) => t.status === 'running');
    const queued = q.tasks.filter((t) => t.status === 'queued');
    const done = q.tasks.filter((t) => t.status === 'done').slice().reverse();
    const m = store.machine;
    const parts: (HTMLElement | null)[] = [
      h(
        'p.note',
        {},
        'Ou abra o quadro 📌 Issues e clique em ',
        h('b', {}, 'Adicionar à fila'),
        ' em uma issue. Sempre que uma mesa estiver livre e menos de ',
        h('b', {}, q.maxWorkers === 0 ? '0' : String(q.maxWorkers)),
        ' de suas tarefas estiverem rodando, a próxima tarefa ganha um novo trabalhador em sua própria worktree git (trabalhadores contratados manualmente não contam). As issues são atribuídas no GitHub quando começam, e o pull request é vinculado quando aparecer.',
      ),
      queued.length && officeFull(m)
        ? h('p.note', {}, `⏸ O escritório está no seu limite de ${m.limit} trabalhador${m.limit === 1 ? '' : 'es'}, então a próxima tarefa aguarda até que um vá embora. Um trabalhador da fila concluído vai embora sozinho para liberar espaço.`)
        : null,
      section('🤖 Trabalhando nisso', running),
      section('⏳ A seguir', queued),
      section('✅ Concluídas', done, h('button.btn', { type: 'button', onclick: () => net.send({ t: 'queue.clear' }) }, 'Limpar')),
      running.length + queued.length + done.length ? null : h('div.queue-empty', {}, 'Nada na fila ainda.'),
    ];
    list.replaceChildren(...parts.filter((n): n is HTMLElement => n !== null));
  };

  // The machine reports every few seconds; only a change to whether the office is full shows here.
  let full = '';
  const machineChanged = () => {
    const k = `${officeFull(store.machine)}|${store.machine.limit}`;
    if (k === full) return;
    full = k;
    render();
  };
  const unsubs = [store.on('queue', render), store.on('workers', render), store.on('issues', render), store.on('machine', machineChanged)];
  const tick = setInterval(render, 30_000);
  const modal = openModal(el, {
    doing: '📥 na fila de tarefas',
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  setTimeout(() => ta.focus(), 30);
}
