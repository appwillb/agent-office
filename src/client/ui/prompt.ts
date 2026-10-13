import './prompt.css';
import type { AgentEffort, AgentProvider, LostBranch, ServerMsg, WorktreeCleanup, WorktreeState } from '../../shared/protocol';
import { h, openModal } from './dom';
import { store } from '../state';
import { providerPicker, type ProviderPicker } from './provider';
import { dictateField } from './dictate';

export interface PromptOptions {
  title: string;
  subtitle?: string;
  /** A warning over the prompt, e.g. that the machine is under pressure. */
  warning?: string;
  placeholder?: string;
  initial?: string;
  submitLabel?: string;
  /** Allow hiring a worker without an initial prompt (the direct hire flow). */
  allowEmpty?: boolean;
  /** Offer the "own git worktree" option (only when hiring a new worker). */
  worktreeOption?: boolean;
  /** Offer the configured agent provider choice (only when hiring a new worker). */
  providerOption?: boolean;
  /** Other floors' projects a new worker in its own worktree can work in too (see WorkerInfo.repos). */
  repoOptions?: { id: string; name: string }[];
  onSubmit(text: string, opts: { worktree: boolean; provider?: AgentProvider; model?: string; effort?: AgentEffort; repos: string[] }): void;
}

const WT_KEY = 'agent-office.worktree';
/** Whether the last hire asked for its own git worktree (the Ask window shares the choice). */
export function worktreePref(): boolean {
  try {
    return localStorage.getItem(WT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Hiring across repositories: other floors' projects the new worker takes on too, each in a worktree
 * of its own on the same branch. That needs a worktree of its own here, so picking one ticks `wtBox`
 * and unticking that clears them.
 */
export function repoPicker(options: { id: string; name: string }[] | undefined, wtBox: HTMLInputElement): { element: HTMLElement | null; value(): string[] } {
  const picks = (options ?? []).map((r) => {
    const box = h('input', { type: 'checkbox', value: r.id, onchange: () => box.checked && (wtBox.checked = true) }) as HTMLInputElement;
    return { id: r.id, box, el: h('label.repo-pick', { title: `Worktree de ${r.name} também, na mesma branch, com seu próprio PR` }, box, r.name) };
  });
  if (!picks.length) return { element: null, value: () => [] };
  wtBox.addEventListener('change', () => {
    if (!wtBox.checked) for (const p of picks) p.box.checked = false;
  });
  return {
    element: h('div.repo-picks', { role: 'group', 'aria-label': 'Outros projetos para atuar' }, h('span', {}, '🗂️ Atuar também em'), ...picks.map((p) => p.el)),
    value: () => picks.filter((p) => p.box.checked).map((p) => p.id),
  };
}

export function openPrompt(opts: PromptOptions) {
  const ta = h('textarea', { rows: 7, placeholder: opts.placeholder ?? 'No que o trabalhador deve atuar?', 'aria-label': 'Prompt' }) as HTMLTextAreaElement;
  ta.value = opts.initial ?? '';
  const wtBox = h('input', { type: 'checkbox', id: 'wt-toggle' }) as HTMLInputElement;
  wtBox.checked = worktreePref();
  const wtRow = opts.worktreeOption
    ? h(
        'label',
        { for: 'wt-toggle', style: 'display:flex;gap:8px;align-items:center;margin:10px 0 0;font-weight:700;cursor:pointer', title: 'Isola este trabalhador em sua própria branch para não colidir com outros' },
        wtBox,
        '🌿 Trabalhar em sua própria branch & git worktree',
      )
    : null;
  const repos = repoPicker(opts.worktreeOption ? opts.repoOptions : undefined, wtBox);
  const provider: ProviderPicker | null = opts.providerOption ? providerPicker(store.project, 'prompt-provider') : null;
  const submit = h('button.btn.primary', { type: 'submit' }, opts.submitLabel ?? 'Enviar ✨');
  const cancel = h('button.btn', { type: 'button' }, 'Cancelar');
  const form = h(
    'form.modal',
    { role: 'dialog', 'aria-label': opts.title },
    h('header', {}, h('h2', {}, opts.title)),
    h('div.body', {}, opts.warning ? h('p.setting-note.bad', { style: 'margin:0 0 10px', role: 'alert' }, opts.warning) : null, opts.subtitle ? h('p', { style: 'margin:0 0 10px;font-weight:700;color:var(--muted)' }, opts.subtitle) : null, dictateField(ta), provider?.element ?? null, wtRow, repos.element),
    h('footer', {}, h('span.grow', {}, 'Enter para enviar · Shift+Enter para nova linha'), cancel, submit),
  ) as HTMLFormElement;
  form.noValidate = true;

  const modal = openModal(form);
  cancel.addEventListener('click', () => modal.close());
  const send = () => {
    const text = ta.value.trim();
    if (!text && !opts.allowEmpty) {
      ta.focus();
      return;
    }
    if (provider && !provider.valid()) return;
    modal.close();
    if (opts.worktreeOption) {
      try {
        localStorage.setItem(WT_KEY, wtBox.checked ? '1' : '0');
      } catch {
        // storage blocked
      }
    }
    const worktree = !!opts.worktreeOption && wtBox.checked;
    opts.onSubmit(text, { worktree, provider: provider?.value(), model: provider?.model(), effort: provider?.effort(), repos: worktree ? repos.value() : [] });
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  setTimeout(() => {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, 30);
}

export function confirmDialog(title: string, body: string, confirmLabel: string, onConfirm: () => void) {
  const yes = h('button.btn.danger', { type: 'button' }, confirmLabel);
  const no = h('button.btn', { type: 'button' }, 'Cancelar');
  const el = h('div.modal', { role: 'alertdialog', 'aria-label': title }, h('header', {}, h('h2', {}, title)), h('div.body', {}, h('p', { style: 'margin:0;font-weight:700' }, body)), h('footer', {}, no, yes));
  const modal = openModal(el);
  no.addEventListener('click', () => modal.close());
  yes.addEventListener('click', () => {
    modal.close();
    onConfirm();
  });
  setTimeout(() => yes.focus(), 30);
}

export interface SendHomeOptions {
  workerId: string;
  name: string;
  /** The desk's label. */
  where: string;
  worktree: { path: string; branch: string };
  /** A worker across repositories: the folders of its workspace, its own floor's first (see WorkerInfo.repos). */
  repos?: string[];
  /** Asks the office what the worktree holds; the answer comes back through routeWorktreeMessage. */
  ask(): void;
  onConfirm(cleanup: WorktreeCleanup): void;
}

/** Whoever is waiting to hear what a worker's worktree holds, by worker id. */
const worktreeChecks = new Map<string, (state: WorktreeState) => void>();

export function routeWorktreeMessage(msg: ServerMsg) {
  if (msg.t !== 'worker.worktree') return;
  worktreeChecks.get(msg.workerId)?.(msg.state);
  worktreeChecks.delete(msg.workerId);
}

function inspectWorktree(workerId: string, ask: () => void): Promise<WorktreeState> {
  return new Promise((resolve) => {
    worktreeChecks.set(workerId, resolve);
    ask();
    setTimeout(() => {
      if (worktreeChecks.get(workerId) !== resolve) return;
      worktreeChecks.delete(workerId);
      resolve({ exists: true, dirty: 0, ahead: 0, unpushed: 0, error: 'o escritório não respondeu' });
    }, 8000);
  });
}

const CLEANUP_LABEL: Record<WorktreeCleanup, string> = {
  all: 'Dispensar & excluir ambos',
  worktree: 'Dispensar & excluir worktree',
  keep: 'Dispensar',
};

/**
 * Sending home a worker that has its own worktree: pick what becomes of the worktree and its branch.
 * Opens on "keep" while the office checks the worktree, then suggests deleting when nothing would be lost.
 */
export function sendHomeDialog(opts: SendHomeOptions) {
  const { branch, path } = opts.worktree;
  const across = opts.repos && opts.repos.length > 1 ? opts.repos : undefined;
  const choices: [WorktreeCleanup, string, string][] = across
    ? [
        ['all', 'Excluir os worktrees e a branch', `Remove os worktrees de ${across.join(', ')} e a branch ${branch} em cada um.`],
        ['worktree', 'Excluir os worktrees, manter a branch', `${branch} permanece em cada um para um pull request ou checkout posterior.`],
        ['keep', 'Manter todos', 'Mantém tudo como está; pode ser limpo mais tarde.'],
      ]
    : [
        ['all', 'Excluir o worktree e a branch', `Remove ${path} e ${branch}.`],
        ['worktree', 'Excluir o worktree, manter a branch', `${branch} permanece para um pull request ou checkout posterior.`],
        ['keep', 'Manter ambos', 'Mantém tudo como está; pode ser limpo mais tarde.'],
      ];
  const radios = new Map<WorktreeCleanup, HTMLInputElement>();
  let touched = false;
  const yes = h('button.btn.danger', { type: 'submit' }, CLEANUP_LABEL.keep);
  const chosen = (): WorktreeCleanup => [...radios].find(([, r]) => r.checked)?.[0] ?? 'keep';
  const pick = (c: WorktreeCleanup) => {
    radios.get(c)!.checked = true;
    yes.textContent = CLEANUP_LABEL[c];
  };
  const list = h(
    'div.choices',
    {},
    ...choices.map(([value, title, sub]) => {
      const r = h('input', {
        type: 'radio',
        name: 'cleanup',
        value,
        onchange: () => {
          touched = true;
          yes.textContent = CLEANUP_LABEL[chosen()];
        },
      }) as HTMLInputElement;
      radios.set(value, r);
      return h('label.choice', {}, r, h('span', {}, title, h('small', {}, sub)));
    }),
  );
  const status = h('p.wt-status', {}, `Verificando estado de ${branch}…`);
  const no = h('button.btn', { type: 'button' }, 'Cancelar');
  const form = h(
    'form.modal',
    { role: 'dialog', 'aria-label': `Dispensar ${opts.name}?` },
    h('header', {}, h('h2', {}, `Dispensar ${opts.name}?`)),
    h(
      'div.body',
      {},
      h('p', { style: 'margin:0 0 12px;font-weight:700' }, `Isso encerra a sessão em ${opts.where} e libera a mesa. ${opts.name} trabalhou ${across ? `em worktrees de ${across.join(', ')}, cada um` : 'em seu próprio worktree'} na branch 🌿 ${branch}:`),
      list,
      status,
    ),
    h('footer', {}, no, yes),
  ) as HTMLFormElement;
  pick('keep');
  const modal = openModal(form);
  no.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const cleanup = chosen();
    modal.close();
    opts.onConfirm(cleanup);
  });
  void inspectWorktree(opts.workerId, opts.ask).then((s) => {
    if (!form.isConnected) return;
    const each = s.repos?.length ? s.repos.map((r) => describeState(r.state, branch, `${r.name}: `)) : [describeState(s, branch)];
    const lines = each.flatMap((d) => d.lines);
    const risky = each.some((d) => d.risky);
    if (s.repos?.length && s.error && !lines.length) lines.push(`Não foi possível verificar os worktrees: ${s.error}.`);
    status.replaceChildren(...lines.flatMap((l, i) => (i ? [h('br'), l] : [l])));
    status.classList.toggle('warn', risky || (!!s.error && !s.repos?.length));
    if (!touched) pick(risky ? 'keep' : 'all');
  });
  setTimeout(() => yes.focus(), 30);
}

export interface LostWorktreeOptions {
  name: string;
  worktree: { path: string; branch: string };
  lost: { branch: LostBranch };
  workspace?: string;
  others: string[];
  openTerminal?: () => void;
  rebuild(all: boolean): void;
  sendHome(): void;
}

export function lostWorktreeDialog(opts: LostWorktreeOptions) {
  const { name, others } = opts;
  const { branch } = opts.worktree;
  const folder = opts.workspace ?? opts.worktree.path;
  const title = `🌿 O worktree de ${name} foi excluído`;
  const what = {
    here: `A branch 🌿 ${branch} ainda existe localmente. A reconstrução fará o checkout no mesmo local e ${name} continuará sua conversa; apenas alterações não commitadas foram perdidas.`,
    origin: `A branch 🌿 ${branch} foi excluída localmente, mas havia sido enviada (pushed): a reconstrução fará o checkout da cópia remota e ${name} continuará sua conversa.`,
    gone: `A branch 🌿 ${branch} foi excluída e nunca foi enviada, então o trabalho nela foi perdido. A reconstrução criará a branch novamente do início e ${name} continuará sua conversa.`,
  }[opts.lost.branch];
  const one = h('button.btn.primary', { type: 'button' }, 'Reconstruir worktree');
  const all = others.length ? h('button.btn', { type: 'button' }, `Reconstruir todos (${others.length + 1})`) : null;
  const home = h('button.btn.danger', { type: 'button' }, 'Dispensar…');
  const look = opts.openTerminal ? h('button.btn', { type: 'button' }, 'Abrir terminal') : null;
  const el = h(
    'div.modal.lost-worktree',
    { role: 'alertdialog', 'aria-label': title },
    h('header', {}, h('h2', {}, title)),
    h(
      'div.body',
      {},
      h('p', { style: 'margin:0 0 10px;font-weight:700' }, `${folder} foi excluído fora do agent-office, então ${name} ${opts.openTerminal ? 'está rodando em uma pasta inexistente' : "não pode iniciar lá"}.`),
      h('p.wt-status', { style: 'margin:0' }, what),
      others.length ? h('p.wt-status.warn', {}, `${others.length} outro${others.length === 1 ? '' : 's'} trabalhador${others.length === 1 ? '' : 'es'} neste andar também perderam seus worktrees: ${others.join(', ')}.`) : null,
    ),
    h('footer', {}, home, h('span.grow'), look, all, one),
  );
  const modal = openModal(el);
  const then = (fn: () => void) => () => {
    modal.close();
    fn();
  };
  one.addEventListener('click', then(() => opts.rebuild(false)));
  all?.addEventListener('click', then(() => opts.rebuild(true)));
  home.addEventListener('click', then(opts.sendHome));
  if (look) look.addEventListener('click', then(opts.openTerminal!));
  setTimeout(() => one.focus(), 30);
}

/** What deleting one worktree (and its branch) would lose, in a line or two for the send-home dialog. */
function describeState(s: WorktreeState, branch: string, prefix = ''): { lines: string[]; risky: boolean } {
  if (s.error) return { lines: [`${prefix}Não foi possível verificar o worktree: ${s.error}.`], risky: true };
  const lines: string[] = [];
  let risky = false;
  if (!s.exists) lines.push(`${prefix}A pasta do worktree já não existe.`);
  if (s.dirty) {
    lines.push(`⚠️ ${prefix}${s.dirty} alteração${s.dirty === 1 ? '' : 'ões'} não commitada${s.dirty === 1 ? '' : 's'} no worktree — excluir irá perdê-las.`);
    risky = true;
  }
  if (s.unpushed) {
    lines.push(`⚠️ ${prefix}${s.unpushed} commit${s.unpushed === 1 ? '' : 's'} em ${branch} não enviado${s.unpushed === 1 ? '' : 's'} ao remoto — excluir a branch irá perdê-los.`);
    risky = true;
  } else if (s.ahead) lines.push(`${prefix}${s.ahead} commit${s.ahead === 1 ? '' : 's'} em ${branch}, todos enviados ou mesclados.`);
  if (!lines.length) lines.push(`${prefix}Nenhum commit pendente e pasta limpa: seguro para excluir.`);
  return { lines, risky };
}
