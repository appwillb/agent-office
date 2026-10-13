import './elevator.css';
import type { CloneProgress, FloorInfo, RepoChoice, ServerMsg } from '../../shared/protocol';
import { cloneLabel, cloneStep, floorPalette, normalizeRepo, sameRepo } from '../../shared/floors';
import { ROOF, ROOF_NAME } from '../../shared/rooftop';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, toast, type Modal } from './dom';
import { confirmDialog } from './prompt';

// The elevator's panel: a button for every floor (every project), and "add a project", which clones
// one of the repositories the office's gh login can see and makes it a new floor. The first time
// the office runs there are no floors, and this is where you start. Admins can take a floor off the
// building here too; its checkout stays on disk. Under the floors, it goes down to the garage.

/**
 * The garage under the building, where the elevator goes too. It isn't a floor: it's down under the
 * one you're on (from the roof, the bottom one), level with the street.
 */
export const GARAGE = '@garage';

export interface ElevatorOptions {
  net: Net;
  /** Rides to a floor, the roof (ROOF) or the garage (GARAGE). */
  ride(floorId: string): void;
  /** You're down in the garage (or out on the street), under the floor you're on. */
  downstairs(): boolean;
}

/** How many repositories the list shows at once; typing narrows it down. */
const SHOWN = 60;
/** Ask gh for the repositories again after this long. */
const REPOS_STALE_MS = 5 * 60_000;
/** Longer than the office takes to ask GitHub about a repository before its clone starts. */
const START_MS = 60_000;

/** Panels waiting on a clone; each says whether the answer was for it. */
const addedWaiters = new Set<(msg: Extract<ServerMsg, { t: 'floor.added' }>) => boolean>();

/** Main feeds server messages through here, so a panel waiting on its clone hears back. */
export function routeElevatorMessage(msg: ServerMsg) {
  if (msg.t !== 'floor.added') return;
  let heard = false;
  for (const fn of addedWaiters) heard = fn(msg) || heard;
  // The panel was closed while it cloned: a clone that failed still says why.
  if (!heard && msg.error) toast(`🛗 ${msg.error}`, 'warn');
}

/** How far through its step a floor's clone is, as a bar (none until git gives a percentage). */
function cloneBar(p: CloneProgress | undefined): HTMLElement | null {
  if (p?.percent === undefined) return null;
  return h('span.clone-bar', { role: 'progressbar', 'aria-label': p.step, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p.percent) }, h('span', { style: `width:${p.percent}%` }));
}

let current: Modal | null = null;

export function elevatorPanelOpen(): boolean {
  return !!current;
}

export function openElevator(opts: ElevatorOptions): void {
  if (current) return;
  // Nowhere to go yet: the panel greets you. It closes like any other; the elevator (or the floor
  // name in the corner) opens it again.
  const setup = !store.floor;
  const { net } = opts;
  let filter = '';
  let selected: string | null = null;
  let adding: string | null = null;
  /** The office has started cloning `adding` (it's on the floor list). */
  let seen = false;
  let startTimer: number | undefined;
  let error = '';
  let showAdd = setup || !store.floors.length;
  /** The search box and list are in place (rebuilding them would lose the focus mid-typing). */
  let built = false;

  const floorsEl = h('div.floors');
  const addEl = h('div.add');
  const input = h('input', { type: 'text', placeholder: 'Buscar repositórios, ou digite proprietario/projeto', 'aria-label': 'Repositório', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const listEl = h('div.repo-list', { role: 'listbox', 'aria-label': 'Repositórios' });
  const statusEl = h('div');
  const addBtn = h('button.btn.primary', { type: 'button' }, '🛗 Adicionar andar');
  const refreshBtn = h('button.btn', { type: 'button', title: 'Atualizar lista do GitHub' }, '↻');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Fechar', title: 'Fechar (Esc)' }, '✕');

  // Where clones go. Admins can move it right here: the first project is when it matters.
  const dirInput = h('input', { type: 'text', placeholder: '~/Workspace', 'aria-label': 'Pasta de trabalho', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dirSave = h('button.btn.primary', { type: 'button' }, 'Salvar');
  const dirCancel = h('button.btn', { type: 'button' }, 'Cancelar');
  const dirEl = h('div.webhook.dir-pick.hidden', {}, dirInput, dirSave, dirCancel);
  const editDir = (on: boolean) => {
    dirEl.classList.toggle('hidden', !on);
    if (!on) return;
    dirInput.value = store.projectsDir.dir;
    setTimeout(() => dirInput.focus(), 0);
  };
  const saveDir = () => {
    const dir = dirInput.value.trim();
    if (!dir) return dirInput.focus();
    // The server says why it can't, if it can't; the folder moving closes this.
    if (dir === store.projectsDir.dir) editDir(false);
    else net.send({ t: 'floor.projectsDir', dir });
  };
  dirSave.addEventListener('click', saveDir);
  dirCancel.addEventListener('click', () => editDir(false));
  dirInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) saveDir();
  });

  const needRepos = () => {
    const r = store.repos;
    if (r.loading || (r.at && Date.now() - r.at < REPOS_STALE_MS && !r.error)) return;
    store.repos = { ...r, loading: true };
    net.send({ t: 'floor.repos' });
  };

  /** What "Add floor" would add: the row picked, else what's typed if it's owner/name. */
  const choice = (): string | undefined => selected ?? normalizeRepo(filter);

  const floorButton = (f: FloorInfo, i: number) => {
    // Down in the garage, your floor is somewhere to go back up to.
    const mine = f.id === store.floor;
    const here = mine && !opts.downstairs();
    const p = floorPalette(f.palette);
    const stats: (HTMLElement | string)[] = [];
    if (f.cloning) stats.push(h('span', { title: f.clone?.detail ?? 'Sendo clonado' }, cloneLabel(f.clone)));
    else {
      if (f.busy) stats.push(h('span', { title: 'Trabalhando' }, `👷 ${f.busy}`));
      if (f.waiting) stats.push(h('span.waiting', { title: 'Aguardando resposta' }, `🙋 ${f.waiting}`));
      stats.push(h('span', { title: 'Trabalhadores nas mesas' }, `💻 ${f.workers}`));
      if (f.people) stats.push(h('span', { title: 'Pessoas neste andar' }, `🧑 ${f.people}`));
    }
    const btn = h(
      'button.floor-btn',
      { type: 'button', class: here ? 'here' : '', disabled: f.cloning || here, title: here ? "Você está neste andar" : f.cloning ? 'Ainda sendo clonado' : `Subir para ${f.name}` },
      h('span.floor-no', { style: `background:${p.trim}` }, String(i + 1)),
      h(
        'span.floor-text',
        {},
        h('span.floor-name', {}, f.name, here ? h('span.here-tag', {}, 'você está aqui') : mine ? h('span.here-tag', {}, 'seu andar') : null),
        h('span.floor-sub', {}, [f.repo ?? f.dir, f.cloning ? f.clone?.detail : ''].filter(Boolean).join(' · ')),
        f.cloning ? cloneBar(f.clone) : null,
      ),
      h('span.floor-stats', {}, ...stats.flatMap((s, j) => (j ? [' ', s] : [s]))),
    );
    btn.addEventListener('click', () => {
      if (here || f.cloning) return;
      modal.close();
      opts.ride(f.id);
    });
    return btn;
  };

  /** The floor's button, with a 🗑 beside it for admins to take it off the building (⏹ to stop it while it's cloned). */
  const floorRow = (f: FloorInfo, i: number) => {
    const btn = floorButton(f, i);
    if (f.cloning) {
      if (!store.me.admin && !(adding && sameRepo(f.repo, adding))) return btn;
      const stop = h('button.btn.floor-off', { type: 'button', title: `Parar clonagem de ${f.repo ?? f.name}`, 'aria-label': `Parar clonagem de ${f.name}` }, '⏹️');
      stop.addEventListener('click', () => confirmDialog(`Parar clonagem de ${f.repo ?? f.name}?`, "O que foi baixado até agora será descartado. Você pode tentar novamente quando quiser.", '⏹️ Parar clonagem', () => net.send({ t: 'floor.cancel', floor: f.id })));
      return h('div.floor-row', {}, btn, stop);
    }
    if (!store.me.admin) return btn;
    const off = h('button.btn.floor-off', { type: 'button', title: `Remover ${f.name} do edifício`, 'aria-label': `Remover ${f.name}` }, '🗑');
    off.addEventListener('click', () => confirmRemove(f));
    return h('div.floor-row', {}, btn, off);
  };

  const confirmRemove = (f: FloorInfo) => {
    const next = store.floors.find((o) => o.id !== f.id && !o.cloning);
    const workers = f.workers ? `Os ${f.workers} trabalhador${f.workers === 1 ? '' : 'es'} serão interrompidos. ` : '';
    const people = f.people ? `Todos no andar irão de elevador para ${next ? next.name : 'o saguão'}. ` : '';
    // The office was started in it: its accounts, password and chat live in that .agent-office too, and stay.
    const own = f.local ? ' O escritório mantém suas configurações lá também, continuando como antes sem esse andar.' : '';
    confirmDialog(`Remover ${f.name} do edifício?`, `${workers}${people}Nada é deletado do disco: os arquivos continuam em ${f.dir}.${own}`, '🗑 Remover andar', () => net.send({ t: 'floor.remove', floor: f.id }));
  };

  /** The roof, over every floor: the rooftop bar. */
  const roofButton = () => {
    const here = store.floor === ROOF;
    const people = [...store.peers.values()].filter((p) => p.floor === ROOF).length;
    const btn = h(
      'button.floor-btn',
      { type: 'button', class: here ? 'here' : '', disabled: here, title: here ? "Você está no terraço" : `Subir para o ${ROOF_NAME.toLowerCase()}` },
      h('span.floor-no', { style: 'background:#2b2d42' }, '🍸'),
      h('span.floor-text', {}, h('span.floor-name', {}, ROOF_NAME, here ? h('span.here-tag', {}, 'você está aqui') : null), h('span.floor-sub', {}, 'O terraço: DJ tocando drum and bass, bar de drinks e vista da cidade')),
      h('span.floor-stats', {}, people ? h('span', { title: 'Pessoas lá em cima' }, `🧑 ${people}`) : ''),
    );
    btn.addEventListener('click', () => {
      if (here) return;
      modal.close();
      opts.ride(ROOF);
    });
    return btn;
  };

  /** Under floor 1: the garage, level with the street. */
  const garageButton = () => {
    const here = opts.downstairs();
    const bottom = store.floors.find((f) => !f.cloning);
    const under = store.floor === ROOF ? `Abaixo de ${bottom?.name ?? 'do edifício'}, no nível da rua` : 'Abaixo do edifício, no nível da rua: carros e saída';
    const btn = h(
      'button.floor-btn',
      { type: 'button', class: here ? 'here' : '', disabled: here, title: here ? "Você está no nível da rua" : 'Descer para a garagem' },
      h('span.floor-no', { style: 'background:#2b2d42' }, '🏎️'),
      h('span.floor-text', {}, h('span.floor-name', {}, 'Garagem', here ? h('span.here-tag', {}, 'você está aqui') : null), h('span.floor-sub', {}, under)),
      h('span.floor-stats', {}),
    );
    btn.addEventListener('click', () => {
      if (here) return;
      modal.close();
      opts.ride(GARAGE);
    });
    return btn;
  };

  const renderFloors = () => {
    const floors = store.floors;
    const built = floors.some((f) => !f.cloning);
    // Top floor first, the way an elevator's buttons stack, with the roof over them, floor 1 and then the garage at the bottom.
    floorsEl.replaceChildren(
      ...(built ? [roofButton()] : []),
      ...(floors.length ? floors.map(floorRow).reverse() : [h('p.empty', {}, 'Nenhum andar ainda.')]),
      ...(built ? [garageButton()] : []),
    );
  };

  const repoRow = (r: RepoChoice) => {
    const floor = store.floors.find((f) => sameRepo(f.repo, r.name));
    const row = h(
      'div.repo',
      { role: 'option', class: selected && sameRepo(selected, r.name) ? 'sel' : '', 'aria-selected': String(!!selected && sameRepo(selected, r.name)), title: r.description ?? r.name },
      h('span.nm', {}, r.name),
      r.private ? h('span', { title: 'Privado' }, '🔒') : null,
      h('span.desc', {}, r.description ?? ''),
      floor ? h('span.pill', {}, floor.id === store.floor ? 'você está aqui' : `andar ${store.floors.indexOf(floor) + 1}`) : r.pushedAt ? h('span.when', {}, timeAgo(r.pushedAt)) : null,
    );
    row.addEventListener('click', () => {
      if (adding) return;
      if (floor) {
        // Already a floor: the button takes you there.
        if (floor.id !== store.floor && !floor.cloning) {
          modal.close();
          opts.ride(floor.id);
        }
        return;
      }
      selected = r.name;
      renderAdd();
    });
    row.addEventListener('dblclick', () => {
      if (!floor) add(r.name);
    });
    return row;
  };

  const renderAdd = () => {
    if (!showAdd) {
      const open = h('button.btn', { type: 'button' }, '➕ Adicionar projeto');
      open.addEventListener('click', () => {
        showAdd = true;
        needRepos();
        renderAdd();
        setTimeout(() => input.focus(), 0);
      });
      addEl.replaceChildren(open);
      addBtn.classList.add('hidden');
      return;
    }
    addBtn.classList.remove('hidden');
    const r = store.repos;
    const q = filter.trim().toLowerCase();
    const typed = normalizeRepo(filter);
    const matches = r.list.filter((x) => !q || x.name.toLowerCase().includes(q) || (x.description ?? '').toLowerCase().includes(q));
    const rows: HTMLElement[] = [];
    // owner/name that isn't in the list (someone else's public repository): offer it anyway.
    if (typed && !r.list.some((x) => sameRepo(x.name, typed))) rows.push(repoRow({ name: typed, private: false, description: 'Não está na lista — o escritório tentará clonar' }));
    rows.push(...matches.slice(0, SHOWN).map(repoRow));
    if (!rows.length) rows.push(h('p.empty', { style: 'padding:10px' }, r.loading ? 'Buscando seus repositórios no GitHub…' : r.error ? '' : q ? 'Nenhum resultado. Digite proprietario/projeto para clonar.' : 'Nenhum repositório encontrado.'));
    if (matches.length > SHOWN) rows.push(h('p.empty', { style: 'padding:8px 10px' }, `…e mais ${matches.length - SHOWN} — digite para refinar`));
    listEl.replaceChildren(...rows);
    const pick = choice();
    const dest = pick ? `${store.projectsDir.dir}/${pick}` : `${store.projectsDir.dir}/<proprietario>/<repo>`;
    const change = store.me.admin ? h('button.btn.dir-change', { type: 'button', title: 'Clonar novos projetos em outra pasta na máquina do escritório' }, '📁 Mudar pasta') : null;
    change?.addEventListener('click', () => editDir(true));
    // While it clones: how far it's got (the office asks GitHub about it first).
    const on = addingFloor();
    const lines = adding
      ? [
          h('p.note.busy', {}, on ? `⏳ Clonando ${on.repo ?? adding} em ${store.projectsDir.dir}/${on.repo ?? adding}` : `⏳ Consultando GitHub sobre ${adding}…`),
          on ? cloneBar(on.clone) : null,
          on ? h('p.note', {}, [cloneStep(on.clone), on.clone?.detail].filter(Boolean).join(' · ')) : null,
          h('p.note', {}, 'Você pode fechar esta janela e continuar: todos serão avisados quando o novo andar estiver pronto.'),
        ]
      : [h('p.note', {}, `Clonado em ${dest} com o login gh desta máquina. Tudo no novo andar funcionará nesse diretório.`, change)];
    statusEl.replaceChildren(...lines.filter((l): l is HTMLElement => !!l), ...[r.error, error].filter(Boolean).map((e) => h('p.err', {}, e)));
    addBtn.disabled = !!adding || !pick || store.floors.some((f) => sameRepo(f.repo, pick));
    addBtn.textContent = adding ? '⏳ Clonando…' : pick ? `🛗 Adicionar ${pick}` : '🛗 Adicionar andar';
    input.disabled = !!adding;
    if (!built) {
      built = true;
      addEl.replaceChildren(
        h('h3', {}, setup && !store.floors.length ? 'Escolha seu primeiro projeto' : '➕ Adicionar projeto'),
        h('div.repo-search', {}, input, refreshBtn),
        listEl,
        statusEl,
        dirEl,
      );
    }
  };

  /** The floor being added, once the office is cloning it (and after, when it's there). */
  const addingFloor = () => (adding ? store.floors.find((f) => sameRepo(f.repo, adding!)) : undefined);

  const add = (repo: string) => {
    if (adding) return;
    adding = repo;
    seen = false;
    error = '';
    renderAdd();
    net.send({ t: 'floor.add', repo });
    // The office went away before it started (a restart): don't wait forever.
    clearTimeout(startTimer);
    startTimer = window.setTimeout(() => {
      if (adding !== repo || seen) return;
      adding = null;
      error = `O escritório não iniciou a clonagem de ${repo} — tente novamente`;
      renderAdd();
    }, START_MS);
  };

  /** Done waiting on the clone, one way or another. */
  const settle = (floor: string | undefined, why?: string) => {
    adding = null;
    clearTimeout(startTimer);
    if (floor) {
      modal.close();
      opts.ride(floor);
      return;
    }
    error = why ?? 'O andar não pôde ser adicionado';
    renderAdd();
  };

  const onAdded = (msg: Extract<ServerMsg, { t: 'floor.added' }>) => {
    if (!adding || msg.repo !== adding) return false;
    settle(msg.error ? undefined : msg.floor, msg.error);
    return true;
  };

  /**
   * The floor list changed. The office answers the one who asked with floor.added, but if it
   * restarted mid-clone that answer went nowhere: the floor list still shows how it ended.
   */
  const checkAdding = () => {
    if (!adding) return;
    const f = addingFloor();
    if (f?.cloning) seen = true;
    else if (seen) settle(f?.id, `A clonagem de ${adding} foi interrompida antes de terminar — tente adicionar novamente`);
  };
  addedWaiters.add(onAdded);

  input.addEventListener('input', () => {
    filter = input.value;
    // Typing something else drops the row that was picked, unless it's still what's typed.
    if (selected && !sameRepo(selected, normalizeRepo(filter))) selected = null;
    renderAdd();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const q = filter.trim().toLowerCase();
    const matches = store.repos.list.filter((x) => !store.floors.some((f) => sameRepo(f.repo, x.name)) && (x.name.toLowerCase().includes(q) || (x.description ?? '').toLowerCase().includes(q)));
    const pick = choice() ?? (q && matches.length === 1 ? matches[0].name : undefined);
    if (pick) add(pick);
  });
  addBtn.addEventListener('click', () => {
    const pick = choice();
    if (pick) add(pick);
  });
  refreshBtn.addEventListener('click', () => {
    store.repos = { ...store.repos, loading: true, error: undefined };
    renderAdd();
    net.send({ t: 'floor.repos', refresh: true });
  });

  const intro = setup
    ? h(
        'p.intro',
        {},
        store.floors.length
          ? 'Cada projeto é um andar deste edifício. Escolha um andar para subir ou adicione outro projeto.'
          : 'Cada projeto é um andar deste edifício, e ainda não há nenhum configurado. Escolha um dos seus repositórios: o escritório o clonará e ele se tornará o primeiro andar.',
      )
    : null;
  const el = h(
    'div.modal.elevator',
    { role: 'dialog', 'aria-label': 'Elevador' },
    h('header', {}, h('h2', {}, setup ? '🏢 Bem-vindo ao Agent Office' : '🛗 Elevador'), close),
    h('div.body', {}, intro, floorsEl, addEl),
    h('footer', {}, h('span.grow', {}, setup ? 'Seu escritório, um andar por projeto · Esc para explorar antes' : 'Escolha um andar · Esc para permanecer aqui'), addBtn),
  );
  const unsubs = [store.on('floors', () => (checkAdding(), renderFloors(), renderAdd())), store.on('repos', renderAdd), store.on('projectsDir', () => (editDir(false), renderAdd())), store.on('floor', renderFloors), store.on('peers', renderFloors), store.on('me', () => (renderFloors(), renderAdd()))];
  const modal = openModal(el, {
    doing: '🛗 no elevador',
    // A stray click shouldn't lose the first-run panel; ✕ and Esc still close it.
    backdropCloses: !setup,
    onClose: () => {
      current = null;
      clearTimeout(startTimer);
      addedWaiters.delete(onAdded);
      for (const off of unsubs) off();
    },
  });
  current = modal;
  close.addEventListener('click', () => modal.close());
  renderFloors();
  if (showAdd) needRepos();
  renderAdd();
  if (showAdd) setTimeout(() => input.focus(), 30);
}
