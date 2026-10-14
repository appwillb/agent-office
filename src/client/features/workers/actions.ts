/**
 * What you do with workers: hire one at a desk (with a task, or a shell), prompt it, wake it, send it
 * home, fix a worktree deleted outside the office, open its pull requests; ask a board agent; stand
 * at a desk; and what the hint bar says at a desk or a board agent's kiosk. Also what the boards'
 * buttons do with a worker.
 */
import { STATION_AGENT, deskSeat, type DeskDef } from '../../../shared/layout';
import { canLabel } from '../../../shared/floorplan';
import { officeFull, pressureNote } from '../../../shared/machine';
import type { AgentEffort, AgentProvider, WorkerInfo } from '../../../shared/protocol';
import { isAsleep, isBusy } from '../../../shared/status';
import type { Ctx, Hint } from '../../core/context';
import type { CoreState } from '../../core/ctx';
import { seatBuilt } from '../../core/floors';
import { aside, key } from '../../core/hint';
import type { Parts } from '../../core/parts';
import { STATION_INFO } from '../../core/stations';
import { askNotifyPermission, notifyPermission } from '../../notify';
import { repoChoices } from '../../shared/hiring';
import { store } from '../../state';
import { openAsk } from '../../ui/ask';
import { STATUS_LABEL, clip, closeAllModals, h, toast } from '../../ui/dom';
import { openDeskLabel } from '../../ui/floorplan';
import type { MeetingPreset } from '../../ui/meeting';
import { confirmDialog, lostWorktreeDialog, openPrompt, routeWorktreeMessage, sendHomeDialog } from '../../ui/prompt';
import { providerLabel, resolvedProvider } from '../../ui/provider';
import { openPull } from '../../ui/pull';
import { openRepoPulls, workerRepos } from '../../ui/repos';
import { openTerminal } from '../../ui/terminal';
import { hiringPaused, usageLabel, usageTitle } from '../../ui/usage';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    desk: true;
    station: true;
  }
}

export type WorkerActionsParts = Pick<Parts, 'worlds' | 'seating' | 'walking' | 'waiting' | 'meeting' | 'cards'>;

/** Registers the worktree answer (worker.worktree), and defines what's done at a desk and at a board agent. */
export function installWorkerActions(ctx: Ctx, core: CoreState, parts: WorkerActionsParts) {
  const { player, net, me, settings } = ctx;
  const { plan, inOffice } = parts.worlds;
  const openWorkerTerminal = (id: string) => parts.waiting.openWorkerTerminal(id);
  const openWorkerChanges = (id: string, repo?: string) => parts.waiting.openWorkerChanges(id, repo);

  function freeDesk(): string | null {
    // Prefer the empty desk nearest to you; when they're all taken, the bean bag that's out.
    let best: string | null = null;
    let bestD = Infinity;
    for (const d of plan().desks) {
      if (!seatBuilt(d.id)) continue;
      if (store.workerAtDesk(d.id)) continue;
      const dist = Math.hypot(d.x - player.pos.x, d.z - player.pos.z);
      if (dist < bestD) {
        bestD = dist;
        best = d.id;
      }
    }
    return best ?? firstFreeSeat() ?? null;
  }

  /** The first seat nobody's at, in the map's order: the desks (as far as the floor's built out), then the overflow seats. */
  function firstFreeSeat(): string | undefined {
    return [...plan().desks, ...plan().overflow].find((d) => seatBuilt(d.id) && !store.workerAtDesk(d.id))?.id;
  }

  let askedToNotify = false;

  /** The office is at its worker limit: says so, and says yes (the office would refuse the hire anyway). */
  function officeIsFull(): boolean {
    const m = store.machine;
    if (!officeFull(m)) return false;
    toast(`🚫 O escritório atingiu o limite de ${m.limit} trabalhador(es) — dispense um antes de contratar outro`, 'warn');
    return true;
  }

  function hire(deskId: string, prompt?: string, worktree = false, provider?: AgentProvider, model?: string, effort?: AgentEffort, issue?: number, repos?: string[], via?: 'herald') {
    net.send({ t: 'worker.spawn', deskId, prompt, worktree, provider, model, effort, issue, repos: repos?.length ? repos : undefined, via });
    // The moment notifications start to matter: ask once (it has to come from a key press or click).
    if (settings.notify && notifyPermission() === 'default' && !askedToNotify) {
      askedToNotify = true;
      void askNotifyPermission();
    }
  }

  function openShell(deskId: string) {
    if (officeIsFull()) return;
    net.send({ t: 'worker.spawn', deskId, kind: 'shell' });
  }

  function promptAtDesk(deskId: string) {
    const w = store.workerAtDesk(deskId);
    const desk = plan().byId.get(deskId)!;
    const deskLabelPt = desk.label.replace('Desk', 'Mesa').replace('Bean bag', 'Puff');
    if (!w) {
      if (officeIsFull()) return;
      openPrompt({
        title: `✨ Nova tarefa na ${deskLabelPt}`,
        subtitle: 'Um novo trabalhador se sentará e começará a trabalhar imediatamente.',
        warning: pressureNote(store.machine),
        submitLabel: 'Contratar e iniciar',
        providerOption: true,
        worktreeOption: !!store.project?.branch,
        repoOptions: repoChoices(),
        onSubmit: (text, o) => hire(deskId, text, o.worktree, o.provider, o.model, o.effort, undefined, o.repos),
      });
    } else if (w.lost) {
      fixLostWorktree(w);
    } else if (isAsleep(w.status)) {
      toast(`${w.name} está dormindo — pressione R para retomar primeiro`, 'warn');
    } else if (w.kind === 'shell') {
      openPrompt({
        title: `🐚 Executar em ${w.name}`,
        placeholder: 'npm run dev',
        submitLabel: 'Executar ▶',
        onSubmit: (text) => net.send({ t: 'worker.prompt', workerId: w.id, prompt: text }),
      });
    } else {
      openPrompt({
        title: `💬 Mensagem para ${w.name}`,
        subtitle: w.status === 'working' ? `${w.name} está ocupado — sua mensagem será enfileirada na caixa de entrada.` : undefined,
        onSubmit: (text) => net.send({ t: 'worker.prompt', workerId: w.id, prompt: text }),
      });
    }
  }

  /** Direct hire from an empty desk, with an optional first prompt and provider choice. */
  function hireAtDesk(deskId: string) {
    const desk = plan().byId.get(deskId)!;
    const deskLabelPt = desk.label.replace('Desk', 'Mesa').replace('Bean bag', 'Puff');
    if (officeIsFull()) return;
    openPrompt({
      title: `✨ Contratar um trabalhador na ${deskLabelPt}`,
      subtitle: 'Você pode começar com um prompt vazio e enviar o trabalho depois.',
      warning: pressureNote(store.machine),
      placeholder: 'Primeira tarefa opcional…',
      submitLabel: 'Contratar e iniciar',
      allowEmpty: true,
      providerOption: true,
      worktreeOption: !!store.project?.branch,
      repoOptions: repoChoices(),
      onSubmit: (text, o) => hire(deskId, text || undefined, o.worktree, o.provider, o.model, o.effort, undefined, o.repos),
    });
  }

  ctx.messages.on('worker.worktree', routeWorktreeMessage);
  function killWorker(id: string) {
    const w = store.workers.get(id);
    if (!w) return;
    const where = plan().byId.get(w.deskId)?.label.replace('Desk', 'Mesa').replace('Bean bag', 'Puff') ?? 'a mesa';
    const session = w.kind === 'shell' ? 'terminal compartilhado' : `sessão de ${providerLabel(w.provider, store.project)}`;
    if (w.meeting) {
      // The meeting's worktree is the whole table's: it's tidied away once they've all gone.
      const m = store.meeting.current;
      const on = m?.id === w.meeting && m.status === 'running';
      confirmDialog(`Dispensar ${w.name}?`, on ? `${w.name} está na reunião sobre “${m.title}”, que será interrompida sem ele.` : `${w.name} sairá da sala de reunião.`, 'Dispensar', () => net.send({ t: 'worker.kill', workerId: id }));
      return;
    }
    if (w.worktree) {
      // A worker with its own worktree: choose what becomes of the worktree and its branch.
      sendHomeDialog({
        workerId: id,
        name: w.name,
        where,
        worktree: w.worktree,
        repos: w.repos?.length ? [w.worktree.path.split('/').pop() ?? 'seu próprio', ...w.repos.map((r) => r.name)] : undefined,
        ask: () => net.send({ t: 'worker.worktree', workerId: id }),
        onConfirm: (cleanup) => net.send({ t: 'worker.kill', workerId: id, cleanup }),
      });
      return;
    }
    const body = plan().byId.get(w.deskId)?.station
      ? `Isso encerra o ${session} para todos, e o que foi solicitado será esquecido. A próxima mensagem na ${where} iniciará uma nova sessão.`
      : `Isso encerra o ${session} na ${where} para todos e libera o lugar.`;
    confirmDialog(`Dispensar ${w.name}?`, body, 'Dispensar', () => net.send({ t: 'worker.kill', workerId: id }));
  }

  /** E at a board agent: type it a request. It's hired with it when nobody is there yet. */
  function askStation(deskId: string) {
    const kind = plan().byId.get(deskId)?.station;
    if (!kind) return;
    const w = store.workerAtDesk(deskId);
    const name = STATION_AGENT[kind].name;
    const info = STATION_INFO[kind];
    // A prompt typed into a question it's asking would answer it.
    if (w?.status === 'needs_input') {
      toast(`O ${name} está aguardando uma resposta — abrindo o terminal`, 'warn');
      return openWorkerTerminal(w.id);
    }
    // Nobody there yet: asking hires the agent.
    if (!w && officeIsFull()) return;
    const subtitle = !w
      ? `${info.does}, em um terminal próprio: pressione O no totem para acompanhar.`
      : isAsleep(w.status)
        ? `O ${name} está dormindo: isso irá acordá-lo e ele continuará de onde parou.`
        : isBusy(w.status)
          ? `O ${name} está ocupado. Sua solicitação aguardará na caixa de entrada até ele terminar.`
          : undefined;
    openPrompt({
      title: `${info.icon} Perguntar ao ${name}`,
      subtitle,
      placeholder: `ex: ${info.example}`,
      submitLabel: 'Enviar ✨',
      warning: w ? undefined : pressureNote(store.machine),
      onSubmit: (text) => net.send({ t: 'station.prompt', deskId, prompt: text }),
    });
  }

  function resumeWorker(w: WorkerInfo) {
    if (w.lost) return fixLostWorktree(w);
    if (!w.sessionId && w.kind !== 'shell') toast(`${w.name} não possui sessão salva — iniciando uma nova`, 'warn');
    net.send({ t: 'worker.resume', workerId: w.id });
  }

  /**
   * Anything done with a worker whose worktree was deleted outside agent-office (see WorkerInfo.lost):
   * it can't work there, so this says so and offers to put the folder back, everyone's at once when
   * more are lost, or to send it home.
   */
  function fixLostWorktree(w: WorkerInfo) {
    if (!w.lost || !w.worktree) return;
    const others = [...store.workers.values()].filter((o) => o.lost && o.id !== w.id);
    lostWorktreeDialog({
      name: w.name,
      worktree: w.worktree,
      lost: w.lost,
      workspace: w.repos?.length ? w.worktree.path.replace(/[\\/][^\\/]*$/, '') : undefined,
      others: others.map((o) => o.name),
      openTerminal: isAsleep(w.status) ? undefined : () => openTerminal(net, w.id, () => openWorkerChanges(w.id)),
      rebuild: (all) => {
        toast(all ? `Reconstruindo ${others.length + 1} worktrees…` : `Reconstruindo worktree de ${w.name}…`);
        net.send({ t: 'worker.rebuild', workerId: w.id, all });
      },
      sendHome: () => killWorker(w.id),
    });
  }

  /** Whether a worker's branch can become a PR: it has its own worktree, still there, and isn't mid-turn. */
  function prReady(w: WorkerInfo) {
    return !!w.worktree && !w.lost && !isBusy(w.status);
  }

  /** O at a desk: see the worker's pull request, or push its branch and open one. */
  function pullRequestFor(w: WorkerInfo) {
    if (w.repos?.length) return pullRequestsFor(w);
    if (w.pr) {
      const it = store.pulls.items.find((p) => p.number === w.pr!.number);
      if (it) openPull(it, net, boardActions());
      else window.open(w.pr.url, '_blank', 'noopener');
      return;
    }
    if (!w.worktree) return toast(`${w.name} trabalha no checkout principal — apenas trabalhadores com sua própria worktree podem abrir um PR`, 'warn');
    if (w.lost) return fixLostWorktree(w);
    if (w.prOpening) return;
    if (!prReady(w)) return toast(`${w.name} ainda está ${STATUS_LABEL[w.status]} — aguarde até concluir`, 'warn');
    toast(`Enviando ${w.worktree.branch} e abrindo o pull request…`);
    net.send({ t: 'worker.pr', workerId: w.id });
  }

  /**
   * O at the desk of a worker across repositories: with no pull request yet, the office opens one in
   * each repository it committed to (and lists them all in each one). Once it has one, O shows each
   * repository's, with a button for the ones still missing.
   */
  function pullRequestsFor(w: WorkerInfo) {
    const open = () => {
      const now = store.workers.get(w.id);
      if (!now || now.prOpening) return;
      if (now.lost) return fixLostWorktree(now);
      if (!prReady(now)) return toast(`${now.name} ainda está ${STATUS_LABEL[now.status]} — aguarde até concluir`, 'warn');
      toast(`Enviando ${now.worktree?.branch ?? 'sua branch'} em cada repositório de ${now.name} e abrindo pull requests…`);
      net.send({ t: 'worker.pr', workerId: now.id });
    };
    if (!workerRepos(w).some((r) => r.pr)) return open();
    openRepoPulls(w.id, {
      openPull: (number, url) => {
        const it = store.pulls.items.find((p) => p.number === number);
        if (it) openPull(it, net, boardActions());
        else window.open(url, '_blank', 'noopener');
      },
      openMissing: open,
      changes: (repo) => openWorkerChanges(w.id, repo),
    });
  }

  /** Puts you in front of a desk, looking at it: the PR board's "Go to desk". */
  function goToDesk(deskId: string) {
    const desk = plan().byId.get(deskId);
    if (!desk) return;
    closeAllModals();
    standAt(desk);
    const w = store.workerAtDesk(deskId);
    const deskLabelPt = desk.label.replace('Desk', 'Mesa').replace('Bean bag', 'Puff');
    toast(w ? `Você está na ${deskLabelPt}, mesa de ${w.name}` : `Você está na ${deskLabelPt}`);
  }

  /** Behind the worker, looking over their shoulder at the laptop (or in front of a board agent's kiosk). */
  function standAt(desk: DeskDef) {
    const { seating } = parts;
    if (player.seat) seating.standUp();
    // The car first (the activities' own order has it last).
    ctx.activities.stop('driver', 'desk');
    ctx.activities.stopAll('desk');
    parts.walking.stopWalkingTo();
    // In line for the throne: in front of it, where it stands.
    const w = store.workerAtDesk(desk.id);
    const court = parts.worlds.court();
    const inLine = w && court ? court.spotOf(w.id) : -1;
    if (inLine >= 0) {
      // At the front: up on the throne, if it's free, where E is for them.
      const throne = inLine === 0 && plan().throne ? seating.freePlace(plan().throne!) : null;
      if (throne) {
        player.pos.set(throne.x, throne.y, throne.z);
        player.sit(throne);
        me.sit(throne.hips);
        net.send({ t: 'sit', seat: throne.key });
        player.camYaw = throne.rotY - Math.PI;
        player.lookPitch = -0.2;
        return;
      }
      // Else beside it in line, turned to it.
      const at = plan().lineup[inLine];
      const x = at.x + Math.cos(at.rotY) * 1.3;
      const z = at.z - Math.sin(at.rotY) * 1.3;
      player.pos.set(x, parts.worlds.groundHere(x, z, 1.5), z);
      player.vy = 0;
      player.facing = Math.atan2(at.x - x, at.z - z);
      player.camYaw = player.facing - Math.PI;
      player.lookPitch = -0.2;
      return;
    }
    let spot = deskSeat(desk, desk.station ? -1.6 : desk.beanbag ? 1.6 : 2.4);
    // On a map of its own, the office's distances can land in a pillar: the nearest open floor to it.
    const world = ctx.world();
    if (!inOffice() && (!player.fits(spot.x, spot.z, 0) || !world.nav.walkable(spot.x, spot.z))) {
      const [x, z] = world.nav.nearestWalkable([spot.x, spot.z]);
      spot = { x, z };
    }
    player.pos.set(spot.x, 0, spot.z);
    player.vy = 0;
    player.facing = Math.atan2(desk.x - spot.x, desk.z - spot.z);
    player.camYaw = player.facing - Math.PI;
    player.lookPitch = -0.2;
  }

  function deskHint(deskId: string): Hint {
    const w = store.workerAtDesk(deskId);
    if (!w && plan().byId.get(deskId)?.room) {
      const roomLabel = plan().byId.get(deskId)!.label.replace('Desk', 'Mesa');
      return { k: 'room', parts: [h('span.title', {}, `🤝 ${roomLabel} · livre`), key('E', 'Convocar reunião')] };
    }
    // The sign over it, if it has one, and L to hang one (or change it).
    const sign = store.floorPlan.labels[deskId]?.text;
    const labelKey = canLabel(deskId) ? key('L', sign ? 'Placa' : 'Identificar') : '';
    const rawLabel = plan().byId.get(deskId)!.label;
    const deskLabelPt = rawLabel.replace('Desk', 'Mesa').replace('Bean bag', 'Puff');
    const deskName = `${sign ? `🪧 ${sign} · ` : ''}${deskLabelPt}`;
    if (!w) {
      const paused = hiringPaused();
      const m = store.machine;
      const full = officeFull(m);
      return {
        k: `${paused}|${full}|${m.workers}|${m.limit}|${!!m.pressure}|${sign}`,
        parts: [
          h('span.title', {}, `${deskName} · vazia`),
          ...(full
            ? [h('span.cost', {}, `🚫 Escritório lotado · ${m.workers} de ${m.limit} trabalhadores`)]
            : [
                m.pressure ? h('span.cost', { title: `Esta máquina está sob alta carga: ${m.pressure}` }, '⚠️ Máquina sobrecarregada') : '',
                ...(paused ? [h('span.cost', {}, '💸 Orçamento esgotado — contratações retornam amanhã')] : [key('E', 'Contratar'), key('P', 'Contratar com tarefa')]),
                key('B', 'Terminal'),
              ]),
          labelKey,
        ],
      };
    }
    if (w.lost && w.worktree) {
      return {
        k: `lost|${w.id}|${w.lost.branch}|${sign}`,
        parts: [
          h('span.title', {}, `${sign ? `🪧 ${sign} · ` : ''}${w.name} · 🌿 worktree excluída`),
          aside('excluída fora do agent-office'),
          key('E', 'Corrigir'),
          key('X', 'Dispensar'),
          labelKey,
        ],
      };
    }
    const doing = w.activity ? clip(w.activity, 48) : '';
    const workerProvider = w.kind === 'agent' ? resolvedProvider(w.provider, store.project) : undefined;
    const spent = w.kind === 'agent' && w.usage ? usageLabel(w.usage, workerProvider) : '';
    const shell = w.kind === 'shell';
    return {
      k: w.status + w.id + (w.pr?.number ?? '') + (w.repos?.map((r) => r.pr?.number ?? '-').join() ?? '') + (w.prOpening ? '!' : '') + doing + spent + (sign ?? ''),
      parts: [
        h('span.title', {}, `${sign ? `🪧 ${sign} · ` : ''}${w.name} · ${STATUS_LABEL[w.status]}`),
        doing ? aside(doing) : '',
        spent ? h('span.cost', { title: usageTitle(w.usage!, workerProvider) }, spent) : '',
        key('E', 'Abrir terminal'),
        key('C', 'Alterações'),
        isAsleep(w.status) ? key('R', shell ? 'Reiniciar' : 'Retomar') : key('P', shell ? 'Executar comando' : 'Instrução'),
        w.repos?.length ? reposKey(w) : w.pr ? key('O', `PR #${w.pr.number}`) : w.prOpening ? aside('⏳ Abrindo PR…') : prReady(w) ? key('O', 'Abrir PR') : '',
        key('X', 'Dispensar'),
        labelKey,
      ],
    };
  }

  /** The O in the desk hint of a worker across repositories: its pull requests so far, or opening them. */
  function reposKey(w: WorkerInfo) {
    const repos = workerRepos(w);
    const prs = repos.filter((r) => r.pr).length;
    if (w.prOpening) return aside('⏳ Abrindo PRs…');
    if (prs) return key('O', `${prs} de ${repos.length} PRs`);
    return prReady(w) ? key('O', `Abrir PRs (${repos.length} repos)`) : '';
  }

  function stationHint(deskId: string): Hint {
    const kind = plan().byId.get(deskId)?.station;
    if (!kind) return { k: '', parts: [] };
    const w = store.workerAtDesk(deskId);
    const info = STATION_INFO[kind];
    if (!w) {
      const m = store.machine;
      const full = officeFull(m);
      return {
        k: `${full}|${m.workers}|${m.limit}`,
        parts: [
          h('span.title', {}, `${info.icon} ${STATION_AGENT[kind].name}`),
          aside(info.offer.replace(/^Ask me /, '')),
          full ? h('span.cost', {}, `🚫 Escritório lotado · ${m.workers} de ${m.limit} trabalhadores`) : key('E', 'Instrução'),
        ],
      };
    }
    const doing = w.activity ? clip(w.activity, 48) : '';
    const provider = resolvedProvider(w.provider, store.project);
    const spent = w.usage ? usageLabel(w.usage, provider) : '';
    return {
      k: w.status + w.id + doing + spent,
      parts: [
        h('span.title', {}, `${info.icon} ${w.name} · ${STATUS_LABEL[w.status]}`),
        doing ? aside(doing) : '',
        spent ? h('span.cost', { title: usageTitle(w.usage!, provider) }, spent) : '',
        key('E', isAsleep(w.status) ? 'Acordar com instrução' : 'Instrução'),
        key('O', 'Terminal'),
        key('X', 'Dispensar'),
      ],
    };
  }

  ctx.interactions.define('desk', {
    reach: 4.5,
    hint: (it) => (it.deskId ? deskHint(it.deskId) : { k: '', parts: [] }),
    use: (it, key) => {
      if (!it.deskId) return;
      if (key === 'L') return openDeskLabel(net, it.deskId);
      const w = store.workerAtDesk(it.deskId);
      // Nobody is hired at the meeting table: a meeting seats its own workers there.
      if (!w && plan().byId.get(it.deskId)?.room) return key === 'E' ? parts.meeting.showMeeting() : undefined;
      if (key === 'B' && !w) return openShell(it.deskId);
      if (key === 'P') return promptAtDesk(it.deskId);
      if (key === 'E') return w ? openWorkerTerminal(w.id) : hireAtDesk(it.deskId);
      if (key === 'C' && w) return openWorkerChanges(w.id);
      if (key === 'R' && w && isAsleep(w.status)) return resumeWorker(w);
      if (key === 'X' && w) return killWorker(w.id);
      if (key === 'O' && w) return pullRequestFor(w);
    },
  });
  ctx.interactions.define('station', {
    reach: 4.5,
    hint: (it) => (it.deskId ? stationHint(it.deskId) : { k: '', parts: [] }),
    use: (it, key) => {
      if (!it.deskId) return;
      const w = store.workerAtDesk(it.deskId);
      if (key === 'E' || key === 'P') return askStation(it.deskId);
      if (key === 'O' && w) return openWorkerTerminal(w.id);
      if (key === 'X' && w) return killWorker(w.id);
    },
  });

  /** A prompt from the boards goes to a new worker at a free desk, or to one already at a desk. With `issue`, that worker takes the issue. */
  function sendToWorker(title: string, text: { context?: string; initial?: string }, issue?: number) {
    const desk = freeDesk();
    const awake = [...store.workers.values()].filter((w) => w.kind === 'agent' && !isAsleep(w.status));
    if (!desk && !awake.length) {
      toast('Todas as mesas e puffs estão ocupados — dispense um trabalhador primeiro', 'warn');
      return;
    }
    openAsk({
      title,
      ...text,
      newDesk: desk ? plan().byId.get(desk)!.label.replace('Desk', 'Mesa').replace('Bean bag', 'Puff') : undefined,
      workers: awake.map((w) => ({ id: w.id, name: w.name, color: w.color, status: w.status })),
      worktreeOption: !!store.project?.branch,
      providerOption: true,
      repoOptions: repoChoices(),
      onSubmit: (prompt, to, worktree, provider, model, effort, repos) => {
        if (to) net.send({ t: 'worker.prompt', workerId: to, prompt, issue });
        else if (desk) hire(desk, prompt, worktree, provider, model, effort, issue, repos);
      },
    });
  }

  /** What the boards' buttons do: hand an issue to a worker, queue it, call a meeting about it, go to a desk, take its card. */
  function boardActions() {
    return {
      queue: (prompt: string, title: string, issue: number, provider?: AgentProvider, model?: string, effort?: AgentEffort) => net.send({ t: 'queue.add', prompt, title, issue, provider, model, effort }),
      assign: (prompt: string, title: string, issue?: number) => sendToWorker(`🤖 ${title}`, { initial: prompt }, issue),
      ask: (context: string, title: string) => sendToWorker(`✍️ ${title}`, { context }),
      meeting: (preset: MeetingPreset) => parts.meeting.showMeeting(preset),
      goToDesk,
      pickUp: parts.cards.pickUp,
    };
  }

  return { officeIsFull, firstFreeSeat, hire, hireAtDesk, resumeWorker, fixLostWorktree, pullRequestFor, standAt, boardActions };
}
