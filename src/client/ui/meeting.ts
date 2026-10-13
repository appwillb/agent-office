import './meeting.css';
import { MEETING_PATTERNS, MEETING_PATTERN_IDS, fixedRounds, meetingSpend, meetingStage, outputProblem, slugify } from '../../shared/meetings';
import { fmtTokens, type Meeting, type MeetingPattern, type MeetingTurn } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, toast, STATUS_LABEL, type Modal } from './dom';
import { confirmDialog } from './prompt';
import { providerPicker } from './provider';
import { officePrompt } from './prompts';
import { issueVars } from './github/prompts';
import { dictateField } from './dictate';

/** What a meeting called from an issue, a PR or a task starts out with. */
export interface MeetingPreset {
  pattern?: MeetingPattern;
  prompt?: string;
  title?: string;
  pr?: number;
  issue?: number;
}

export interface MeetingActions {
  openTerminal(workerId: string): void;
  /** Push the meeting's branch and open a pull request for it, through the head of the table's worker. */
  openPr(workerId: string): void;
}

/** A meeting about a GitHub issue: the form filled in with it. */
export function issueMeeting(n: number, title: string): MeetingPreset {
  return { issue: n, title: `#${n} ${title}`, prompt: officePrompt('issue.meeting', issueVars({ number: n, title })) };
}

const PART_LABEL: Record<MeetingTurn['state'], string> = { waiting: '⏳ próximo', sent: '📨 repassado', working: '💬 analisando', done: '✅ concluído' };

/**
 * The meeting room's window. With a meeting at the table it shows how it's going (and stops it, or
 * clears the table once it's over); otherwise, or with a preset from an issue or a PR, it's the form
 * that calls one.
 */
export function openMeeting(net: Net, actions: MeetingActions, preset?: MeetingPreset) {
  const close = h('button.btn.close', { 'aria-label': 'Fechar' }, '✕');
  const title = h('h2', {}, '🤝 Sala de reunião');
  const body = h('div.body.meeting');
  const foot = h('footer');
  const el = h('div.modal.meeting-window', { role: 'dialog', 'aria-label': 'Sala de reunião' }, h('header', {}, title, close), body, foot);
  let view: 'status' | 'form' = preset || !store.meeting.current ? 'form' : 'status';
  let form: ReturnType<typeof meetingForm> | null = null;
  const render = () => {
    if (view === 'status' && store.meeting.current) {
      form = null;
      title.textContent = '🤝 Sala de reunião';
      renderStatus(store.meeting.current, body, foot, net, actions, () => {
        view = 'form';
        render();
      });
      return;
    }
    if (!form) {
      form = meetingForm(net, preset, () => modal.close(), () => {
        view = 'status';
        render();
      });
      title.textContent = '🤝 Convocar uma reunião';
      body.replaceChildren(form.body);
      foot.replaceChildren(...form.foot);
    }
    form.refresh();
  };
  const offs = [store.on('meeting', render), store.on('workers', () => view === 'status' && render()), store.on('pulls', () => form?.refresh())];
  const modal: Modal = openModal(el, { doing: '🤝 na sala de reunião', onClose: () => offs.forEach((off) => off()) });
  close.addEventListener('click', () => modal.close());
  render();
}

function renderStatus(m: Meeting, body: HTMLElement, foot: HTMLElement, net: Net, actions: MeetingActions, callAnother: () => void) {
  const p = MEETING_PATTERNS[m.pattern];
  const running = m.status === 'running';
  const pill = h('span.pill', { class: running ? 'working' : m.status === 'done' ? 'done' : 'needs_input' }, running ? 'em reunião' : m.status);
  const seats = h(
    'ul.meeting-seats',
    {},
    ...m.seats.map((s, i) => {
      const w = s.workerId ? store.workers.get(s.workerId) : undefined;
      const t = m.turns.find((x) => x.seat === i);
      const part = running ? (t ? `${PART_LABEL[t.state]}: ${t.doing}` : '👂 ouvindo') : '';
      return h(
        'li',
        {},
        h('span.dot', { style: `background:${w?.color ?? '#adb5bd'}` }),
        h('b', {}, s.role),
        h('span.muted', {}, `${i === 0 ? 'líder da mesa · ' : ''}${s.workerName ?? '…'}`),
        w ? h('span.pill', { class: w.status }, STATUS_LABEL[w.status]) : h('span.pill.exited', {}, 'foi para casa'),
        part ? h('span.meeting-part', { title: t?.file ?? '' }, part) : null,
        s.tokens ? h('span.muted', {}, `${fmtTokens(s.tokens)} tokens`) : null,
        w ? h('button.btn.small', { type: 'button', onclick: () => actions.openTerminal(w.id) }, '🖥️ Terminal') : null,
      );
    }),
  );
  const where = m.worktree ? h('span', {}, '🌿 ', h('code', {}, m.worktree.branch), m.commit ? ` · commit ${m.commit}` : '') : null;
  const review = m.review?.url ? h('a', { href: m.review.url, target: '_blank', rel: 'noopener noreferrer' }, `🔍 A revisão no PR #${m.pr} ↗`) : m.review?.error ? h('span.bad', {}, `Não foi possível publicar a revisão: ${m.review.error}`) : null;
  body.replaceChildren(
    ...present(
    h('div.meeting-head', {}, pill, h('b', {}, `${p.icon} ${p.label}`), h('span.meeting-title', { title: m.prompt }, m.title)),
    h('p.meeting-line', {}, running ? `${meetingStage(m)} · convocada por ${m.calledBy} há ${timeAgo(new Date(m.startedAt).toISOString())}` : m.status === 'done' ? `✅ Escreveu ${m.output} em ${m.round} rodada${m.round === 1 ? '' : 's'}` : `⛔ Parou na rodada ${m.round}: ${m.reason ?? 'interrompida'}`),
    m.tokens ? h('p.meeting-spend', { title: `${m.tokens.toLocaleString()} tokens, leituras de cache incluídas` }, `💸 ${meetingSpend(m)}${running ? ' até agora' : ''}`) : null,
    seats,
    h('div.meeting-out', {}, h('div.meeting-out-head', {}, h('b', {}, '📄 '), h('code', {}, m.output), where, review), h('pre.meeting-preview', {}, m.preview?.trim() ? m.preview : running ? 'Nada escrito ainda.' : 'Nada foi escrito.')),
    store.meeting.past.length
      ? h('details.meeting-past', {}, h('summary', {}, `Reuniões anteriores (${store.meeting.past.length})`), h('ul', {}, ...store.meeting.past.map((r) => h('li', { title: `Convocada por ${r.calledBy}` }, h('b', {}, r.title), h('div.muted', {}, r.summary)))))
      : null,
    ),
  );
  const head = m.seats[0]?.workerId ? store.workers.get(m.seats[0].workerId) : undefined;
  foot.replaceChildren(
    ...present(
    h('span.grow', {}, running ? 'Os trabalhadores permanecem na mesa após o término para você poder ler seus terminais.' : 'Liberar a sala envia os trabalhadores para casa. Um arquivo confirmado permanece em sua ramificação.'),
    running ? h('button.btn', { type: 'button', onclick: () => confirmDialog('Interromper a reunião?', `Os trabalhadores param onde estão e permanecem na mesa. ${m.output} só estará disponível se foi escrito.`, 'Interromper', () => net.send({ t: 'meeting.stop' })) }, '⛔ Interromper reunião') : null,
    !running && m.commit && head?.worktree ? h('button.btn', { type: 'button', title: `Enviar ${m.worktree?.branch} e abrir um pull request`, onclick: () => actions.openPr(head.id) }, head.pr ? `🔀 PR #${head.pr.number}` : '🔀 Abrir PR') : null,
    !running ? h('button.btn', { type: 'button', onclick: () => net.send({ t: 'meeting.clear' }) }, '🧹 Liberar a sala') : null,
    !running ? h('button.btn.primary', { type: 'button', onclick: callAnother }, '🤝 Convocar uma reunião…') : null,
    ),
  );
}

const present = (...xs: (Node | null)[]): Node[] => xs.filter((x): x is Node => x !== null);

/** The form that calls a meeting: the pattern, what it's about, who sits down, the output, the round limit. */
function meetingForm(net: Net, preset: MeetingPreset | undefined, done: () => void, back: () => void) {
  let pattern: MeetingPattern = preset?.pattern ?? 'debate';
  let roles: string[] = [];
  let outputTouched = false;
  const patterns = h('div.meeting-patterns', { role: 'radiogroup', 'aria-label': 'Padrão' });
  const about = h('textarea', { rows: 4, placeholder: 'A questão a ser resolvida ou a tarefa a fazer: ex. “O cachorro deve usar A* ou navmesh?”', 'aria-label': 'Sobre o que é a reunião' }) as HTMLTextAreaElement;
  about.value = preset?.prompt ?? '';
  const titleIn = h('input', { type: 'text', placeholder: 'Título (opcional): a primeira linha caso vazio', maxlength: 100, 'aria-label': 'Título' }) as HTMLInputElement;
  titleIn.value = preset?.title ?? '';
  const outputIn = h('input', { type: 'text', 'aria-label': 'Arquivo de saída', spellcheck: 'false' }) as HTMLInputElement;
  const outputNote = h('small.muted');
  const prSel = h('select.provider-select', { 'aria-label': 'Pull request' }) as HTMLSelectElement;
  const prRow = h('div.meeting-field', {}, h('label', {}, 'Pull request'), prSel);
  const partsIn = h('textarea', { rows: 3, placeholder: 'src/server/\nsrc/client/\nsrc/shared/', 'aria-label': 'Partes', spellcheck: 'false' }) as HTMLTextAreaElement;
  const partsRow = h('div.meeting-field', {}, h('label', {}, 'Partes, uma por linha'), partsIn, h('small.muted', {}, 'Distribuídas aos mapeadores por vez: arquivos, pastas, módulos ou issues.'));
  const count = h('b');
  const minus = h('button.btn.small', { type: 'button', 'aria-label': 'Menos trabalhadores' }, '−');
  const plus = h('button.btn.small', { type: 'button', 'aria-label': 'Mais trabalhadores' }, '+');
  const roleList = h('div.meeting-roles');
  const roundsSel = h('select.provider-select.meeting-rounds', { 'aria-label': 'Limite de rodadas' }) as HTMLSelectElement;
  // A pattern that always runs the same rounds says so, where a locked control would look broken.
  const roundsFixed = h('span.meeting-fixed');
  const roundsNote = h('small.muted');
  const provider = providerPicker(store.project, 'meeting-provider', 'Trabalhadores');
  const busy = h('p.meeting-busy');
  const submit = h('button.btn.primary', { type: 'submit' }, '🤝 Iniciar a reunião');
  const cancel = h('button.btn', { type: 'button', onclick: store.meeting.current ? back : done }, store.meeting.current ? '← Voltar' : 'Cancelar');

  const def = () => MEETING_PATTERNS[pattern];
  const slug = () => slugify(titleIn.value.trim() || about.value.trim().split('\n')[0] || 'meeting', 32);
  const pr = () => Number(prSel.value) || undefined;
  const syncOutput = () => {
    if (!outputTouched) outputIn.value = def().output(slug(), pr());
    const problem = outputProblem(outputIn.value.trim());
    outputNote.textContent = problem ? `⚠️ ${problem}` : pattern === 'review' ? 'Termina quando este arquivo for escrito; o escritório então o publica no PR como uma revisão consolidada.' : store.project?.branch ? 'Termina quando este arquivo for escrito; o escritório o confirma na branch própria da reunião.' : 'Termina quando este arquivo for escrito.';
    outputNote.classList.toggle('bad', !!problem);
  };
  const renderRoles = () => {
    const d = def();
    count.textContent = String(roles.length);
    minus.toggleAttribute('disabled', roles.length <= d.seats.min);
    plus.toggleAttribute('disabled', roles.length >= d.seats.max);
    roleList.replaceChildren(
      ...roles.map((r, i) => {
        const input = h('input', { type: 'text', value: r, maxlength: 40, 'aria-label': `Papel ${i + 1}` }) as HTMLInputElement;
        input.addEventListener('input', () => (roles[i] = input.value));
        return h('div.meeting-role', {}, h('span.muted', {}, i === 0 ? '👑' : `${i + 1}`), input);
      }),
    );
  };
  const pickPattern = (p: MeetingPattern) => {
    pattern = p;
    const d = def();
    roles = d.roles.slice(0, d.seats.default);
    for (const b of patterns.children) b.classList.toggle('on', (b as HTMLElement).dataset.pattern === p);
    for (const b of patterns.children) b.setAttribute('aria-checked', String((b as HTMLElement).dataset.pattern === p));
    const fixed = fixedRounds(d);
    const limits = Array.from({ length: d.rounds.max - d.rounds.min + 1 }, (_, i) => d.rounds.min + i);
    roundsSel.replaceChildren(...limits.map((n) => h('option', { value: String(n) }, `${n} rodada${n === 1 ? '' : 's'}`)));
    roundsSel.value = String(d.rounds.default);
    roundsSel.classList.toggle('hidden', !!fixed);
    roundsFixed.classList.toggle('hidden', !fixed);
    roundsFixed.textContent = fixed ? `🔒 ${fixed.line}` : '';
    roundsFixed.title = fixed?.why ?? '';
    roundsNote.textContent = fixed ? fixed.stages : `${d.rounds.min} a ${d.rounds.max}. ${d.roundsNote ?? ''}`.trim();
    prRow.classList.toggle('hidden', d.needs !== 'pr');
    partsRow.classList.toggle('hidden', d.needs !== 'parts');
    renderRoles();
    syncOutput();
  };
  for (const id of MEETING_PATTERN_IDS) {
    const d = MEETING_PATTERNS[id];
    patterns.append(h('button.meeting-pattern', { type: 'button', role: 'radio', 'data-pattern': id, onclick: () => pickPattern(id) }, h('b', {}, `${d.icon} ${d.label}`), h('small', {}, d.blurb)));
  }
  minus.addEventListener('click', () => {
    if (roles.length > def().seats.min) roles.pop();
    renderRoles();
  });
  plus.addEventListener('click', () => {
    if (roles.length < def().seats.max) roles.push(def().roles[roles.length] ?? `Trabalhador ${roles.length + 1}`);
    renderRoles();
  });
  outputIn.addEventListener('input', () => {
    outputTouched = true;
    syncOutput();
  });
  titleIn.addEventListener('input', syncOutput);
  about.addEventListener('input', syncOutput);
  prSel.addEventListener('change', syncOutput);

  const bodyEl = h(
    'form.meeting-form',
    {},
    patterns,
    h('div.meeting-field', {}, h('label', {}, 'Sobre o que é?'), dictateField(about)),
    h('div.meeting-field', {}, titleIn),
    prRow,
    partsRow,
    h('div.meeting-field', {}, h('label', {}, 'Arquivo de saída'), outputIn, outputNote),
    h('div.meeting-field', {}, h('label.meeting-count', {}, 'Trabalhadores na mesa', minus, count, plus), roleList),
    h('div.meeting-field', {}, h('label', {}, 'Limite de rodadas'), roundsSel, roundsFixed, roundsNote),
    provider.element,
    busy,
  ) as HTMLFormElement;
  bodyEl.noValidate = true;

  const send = () => {
    if (store.meeting.current?.status === 'running') return;
    const prompt = about.value.trim();
    if (!prompt) return about.focus();
    if (def().needs === 'pr' && !pr()) return prSel.focus();
    const parts = partsIn.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (def().needs === 'parts' && parts.length < roles.length - 1) {
      toast(`Liste pelo menos ${roles.length - 1} partes, uma por linha, ou reduza o número de trabalhadores`, 'warn');
      return partsIn.focus();
    }
    const output = outputIn.value.trim();
    if (outputProblem(output)) return outputIn.focus();
    if (!provider.valid()) return;
    net.send({
      t: 'meeting.start',
      pattern,
      prompt,
      title: titleIn.value.trim() || undefined,
      output,
      roles: roles.map((r) => r.trim()),
      parts: def().needs === 'parts' ? parts : undefined,
      pr: def().needs === 'pr' ? pr() : undefined,
      issue: preset?.issue,
      rounds: Number(roundsSel.value) || undefined,
      provider: provider.value(),
      model: provider.model(),
      effort: provider.effort(),
    });
    toast(`🤝 Convocando a reunião de ${def().label}: os trabalhadores estão indo para a sala de reunião`);
    done();
  };
  bodyEl.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  submit.addEventListener('click', (e) => {
    e.preventDefault();
    send();
  });

  /** Keeps what depends on the board and the room up to date: the open PRs, and whether the room is free. */
  const refresh = () => {
    const open = store.pulls.items.filter((p) => p.state === 'OPEN');
    const want = prSel.value || (preset?.pr ? String(preset.pr) : '');
    const opts: (readonly [string, string])[] = open.map((p) => [String(p.number), `#${p.number} ${p.title}`] as const);
    if (preset?.pr && !open.some((p) => p.number === preset.pr)) opts.unshift([String(preset.pr), `#${preset.pr}`]);
    const key = JSON.stringify(opts);
    if (prSel.dataset.key !== key) {
      prSel.dataset.key = key;
      prSel.replaceChildren(h('option', { value: '' }, open.length || preset?.pr ? 'Escolha um pull request…' : 'Nenhum pull request aberto'), ...opts.map(([v, label]) => h('option', { value: v }, label.length > 70 ? `${label.slice(0, 69)}…` : label)));
      prSel.value = want;
      syncOutput();
    }
    const m = store.meeting.current;
    const taken = m?.status === 'running';
    busy.textContent = taken ? `A sala está ocupada com “${m.title}” até terminar ou ser interrompida.` : m ? `Iniciar isto mandará os trabalhadores da reunião anterior para casa.` : '';
    submit.toggleAttribute('disabled', taken);
  };
  pickPattern(pattern);
  if (preset?.pr) prSel.value = String(preset.pr);
  refresh();
  setTimeout(() => (preset?.prompt ? titleIn : about).focus(), 0);
  return { body: bodyEl, foot: [h('span.grow', {}, 'Poucas rodadas e um arquivo no final: é isso que mantém as reuniões econômicas.'), cancel, submit], refresh };
}
