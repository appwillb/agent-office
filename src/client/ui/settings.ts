import './settings.css';
import type { Net } from '../net';
import type { OfficeSound } from '../sound';
import { store, type NeedsYouSound, type Settings, type ViewMode } from '../state';
import { askNotifyPermission, notifyPermission, type DesktopNotifier } from '../notify';
import type { ThemePick, WebhookKind } from '../../shared/protocol';
import { THEME_PICKS } from '../../shared/theme';
import { mapChoices } from '../../shared/maps';
import { dogSetting } from './settings-dog';
import { h, openModal, timeAgo } from './dom';
import { agentFields, choiceLabel, officeChoice } from './provider';
import { openPromptEditor, rewrittenPrompts } from './prompts';
import { outsideSetting } from './settings-sky';
import { choiceRow } from './settings-rows';

const VIEWS: [ViewMode, string, string][] = [
  ['first', '👀 Primeira pessoa', 'Veja através dos próprios olhos. Clique no escritório para olhar ao redor e interagir. Esc libera o mouse.'],
  ['third', '🎥 Terceira pessoa', 'Siga seu personagem por trás. Arraste para orbitar, use o scroll para zoom e clique para interagir.'],
];

const THEME_LABEL: Record<ThemePick, string> = { auto: '📅 Automático pelo calendário', halloween: '🎃 Halloween', christmas: '🎄 Natal', off: 'Desligado' };

const WEBHOOK_NAME: Record<WebhookKind, string> = { slack: 'Slack', discord: 'Discord', other: 'um webhook' };

/** The categories down the side of ⚙️ Settings. */
export type SettingsPane = 'you' | 'sound' | 'notify' | 'building' | 'workers';

const PANES: { id: SettingsPane; icon: string; label: string; blurb: string }[] = [
  { id: 'you', icon: '🧍', label: 'Você', blurb: 'Sua aparência, modo de visualização da câmera e login.' },
  { id: 'sound', icon: '🔊', label: 'Áudio & voz', blurb: 'Volume do escritório e configurações de chat por voz.' },
  { id: 'notify', icon: '🔔', label: 'Notificações', blurb: 'Avisos quando um trabalhador precisar de você ou concluir uma tarefa.' },
  { id: 'building', icon: '🏢', label: 'Edifício', blurb: 'Mapa, decorações, céu, cachorro e pasta onde novos andares são clonados.' },
  { id: 'workers', icon: '🤖', label: 'Trabalhadores', blurb: 'Configuração padrão dos agentes, limite de execuções simultâneas e regras.' },
];

/** Who a setting is for, shown by its name: some are yours alone, some the whole office's. */
type Scope = 'you' | 'floor' | 'office';
const SCOPE: Record<Scope, [label: string, title: string]> = {
  you: ['Apenas você', 'Somente para você, salvo neste navegador'],
  floor: ['Este andar', 'O mesmo para todos neste andar'],
  office: ['Todos', 'O mesmo para todos no edifício'],
};

/** One setting: its name and who it's for, then whatever sets it. */
const setting = (title: string, scope: Scope | null, ...body: Node[]) =>
  h('div.setting', {}, h('div.setting-head', {}, h('h4', {}, title), scope && h('span.scope', { class: scope, title: SCOPE[scope][1] }, SCOPE[scope][0])), ...body);

/** Where ⚙️ Settings was last, so it opens there again. */
let lastPane: SettingsPane = 'you';

/** `outside` describes the sky over the office (see describeSky), once the server has said. `first` opens on that category instead of the last one. */
export function openSettings(net: Net, settings: Settings, onChange: (s: Settings) => void, onCharacter: () => void, sound: Pick<OfficeSound, 'ding' | 'needsYou'>, notifier: DesktopNotifier, onSignOut: () => void, outside?: { now: string; live: boolean }, first?: SettingsPane) {
  const seg = h('div.seg', { role: 'radiogroup', 'aria-label': 'Visualização da câmera' });
  const note = h('p.setting-note');
  const paint = () => {
    seg.replaceChildren(
      ...VIEWS.map(([view, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(settings.view === view),
            class: settings.view === view ? 'on' : '',
            onclick: () => {
              if (settings.view === view) return;
              settings = { ...settings, view };
              onChange(settings);
              paint();
            },
          },
          label,
        ),
      ),
    );
    note.textContent = VIEWS.find(([v]) => v === settings.view)![2];
  };
  paint();

  /** A volume slider with its mute button. Dragging it turns the sound back on; letting go plays `preview`. */
  const volumeRow = (label: string, level: 'volume' | 'music', muted: 'muted' | 'musicMuted', preview?: () => void) => {
    const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': label });
    const pct = h('span.vol-pct');
    const mute = h('button.btn', { type: 'button' });
    const row = h('div.volume', {}, mute, slider, pct);
    const paint = () => {
      const v = Math.round(settings[level] * 100);
      slider.value = String(v);
      slider.style.setProperty('--fill', `${v}%`);
      pct.textContent = settings[muted] ? 'Mudo' : `${v}%`;
      mute.textContent = settings[muted] ? '🔊 Ativar som' : '🔇 Mudo';
      mute.setAttribute('aria-pressed', String(settings[muted]));
      mute.classList.toggle('danger', settings[muted]);
      row.classList.toggle('muted', settings[muted]);
    };
    paint();
    slider.addEventListener('input', () => {
      settings = { ...settings, [level]: Number(slider.value) / 100, [muted]: false };
      onChange(settings);
      paint();
    });
    if (preview) slider.addEventListener('change', preview);
    mute.addEventListener('click', () => {
      settings = { ...settings, [muted]: !settings[muted] };
      onChange(settings);
      paint();
      if (!settings[muted]) preview?.();
    });
    return row;
  };
  const soundRow = volumeRow('Volume dos sons do escritório', 'volume', 'muted', () => sound.ding('done'));

  /** Changes some of your own settings, and has the office take them up. */
  const change = (some: Partial<Settings>) => {
    settings = { ...settings, ...some };
    onChange(settings);
  };
  // Voice chat: an open mic, or muted until you hold V.
  const talkRow = choiceRow('Chat de voz', [[false, '🎙️ Microfone aberto'], [true, '✋ Aperte para falar']], () => settings.pushToTalk, (pushToTalk) => change({ pushToTalk }));
  const musicRow = volumeRow('Volume da jukebox', 'music', 'musicMuted');

  // The swish of the book's pages at the bookshelf, on or off.
  const pagesRow = choiceRow('Virar páginas na estante', [[true, '📖 Ligado'], [false, 'Desligado']], () => settings.pageTurns, (pageTurns) => change({ pageTurns }));
  // The alarm when a worker stops to ask you something; picking one plays it.
  const alarmRow = choiceRow<NeedsYouSound>('Quando um trabalhador precisar de você', [['once', '🔔 Tocar uma vez'], ['remind', '🔁 Lembrar continuamente'], ['off', '🔕 Desligado']], () => settings.needsYouSound, (needsYouSound) => {
    change({ needsYouSound });
    if (needsYouSound !== 'off') sound.needsYou();
  });

  // The building's holiday theme, for everyone.
  const themeRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Tema sazonal' });
  const themeNote = h('p.setting-note');
  const paintTheme = () => {
    const { pick, active, by, at } = store.theme;
    themeRow.replaceChildren(
      ...THEME_PICKS.map((p) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(pick === p),
            class: pick === p ? 'on' : '',
            onclick: () => {
              if (store.theme.pick !== p) net.send({ t: 'theme.set', pick: p });
            },
          },
          THEME_LABEL[p],
        ),
      ),
    );
    const now =
      active === 'halloween'
        ? 'Halloween: os trabalhadores viram zumbis, suas mãos são de feiticeiro, o cachorro está fantasiado, o céu fica sinistro e há abóboras por toda parte.'
        : active === 'christmas'
          ? 'Natal: os trabalhadores viram duendes, suas mãos usam luvas de lã, o cachorro é a rena Rudolph e está nevando lá fora.'
          : 'Nenhuma decoração sazonal ativa no momento.';
    const how = pick === 'auto' ? ' Pelo calendário é Halloween durante outubro e Natal durante dezembro.' : '';
    themeNote.textContent = `${now}${how} É igual para todos no edifício${by ? `, definido por ${by}${at ? ` ${timeAgo(at)}` : ''}` : ''}.`;
  };
  paintTheme();

  // The building's map, for everyone: the office, the castle, the space station, or one of your own. Opening Settings
  // has the office read its folder of maps again, so one you just added or fixed shows up.
  net.send({ t: 'map.set' });
  const mapRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Mapa' });
  const mapNote = h('p.setting-note');
  const mapBad = h('p.setting-note.bad', { style: 'white-space: pre-line' });
  const paintMap = () => {
    const { pick, by, at, custom } = store.map;
    const choices = mapChoices(custom);
    mapRow.replaceChildren(
      ...choices.map((m) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(pick === m.id),
            class: pick === m.id ? 'on' : '',
            disabled: !!m.error,
            title: m.error ? `${m.id} não pôde carregar: ${m.error}` : m.description,
            onclick: () => {
              if (!m.error && store.map.pick !== m.id) net.send({ t: 'map.set', map: m.id });
            },
          },
          `${m.icon} ${m.name}`,
        ),
      ),
    );
    const now = choices.find((m) => m.id === pick) ?? choices[0];
    mapNote.textContent = `${now.description} É igual em todos os andares, para todos no edifício${by ? `, escolhido por ${by}${at ? ` ${timeAgo(at)}` : ''}` : ''}. Mapas personalizados ficam na pasta .agent-office/maps/ em formato JSON (veja docs/maps.md).`;
    const broken = choices.filter((m) => m.error);
    mapBad.textContent = broken.map((m) => `⚠️ ${m.id} não pôde carregar: ${m.error}`).join('\n');
    mapBad.hidden = !broken.length;
  };
  paintMap();

  // Desktop notifications: this browser's permission, then your own on/off.
  const notifyRow = h('div.seg');
  const notifyNote = h('p.setting-note');
  const paintNotify = () => {
    const perm = notifyPermission();
    const on = perm === 'granted' && settings.notify;
    notifyRow.replaceChildren();
    if (perm === 'default') {
      notifyRow.append(
        h(
          'button.btn.primary',
          {
            type: 'button',
            onclick: async () => {
              if ((await askNotifyPermission()) === 'granted') {
                settings = { ...settings, notify: true };
                onChange(settings);
                notifier.sample();
              }
              paintNotify();
            },
          },
          '🔔 Ativar notificações',
        ),
      );
    } else if (perm === 'granted') {
      for (const [value, label] of [
        [true, '🔔 Ligado'],
        [false, '🔕 Desligado'],
      ] as const) {
        notifyRow.append(
          h(
            'button.btn',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(on === value),
              class: on === value ? 'on' : '',
              onclick: () => {
                settings = { ...settings, notify: value };
                onChange(settings);
                paintNotify();
              },
            },
            label,
          ),
        );
      }
      if (on) notifyRow.append(h('button.btn', { type: 'button', onclick: () => notifier.sample() }, 'Testar notificação'));
    }
    notifyNote.textContent =
      perm === 'unsupported'
        ? 'Este navegador não suporta notificações do escritório aqui. É necessário https ou localhost (um túnel SSH também funciona).'
        : perm === 'denied'
          ? 'Seu navegador está bloqueando notificações do escritório. Permita-as nas configurações do site (ícone à esquerda do endereço) e abra aqui novamente.'
          : 'Quando um trabalhador precisar de você ou terminar enquanto você estiver em outra aba ou aplicativo, você receberá uma notificação. Clique nela para ir direto ao trabalhador: você será levado à mesa dele com o terminal aberto.';
  };
  paintNotify();

  // The office's Slack / Discord webhook, shared by everyone.
  const hookStatus = h('p.setting-note');
  const hookInput = h('input', { type: 'text', placeholder: 'https://hooks.slack.com/services/…', 'aria-label': 'URL do webhook do Slack ou Discord', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const hookSave = h('button.btn.primary', { type: 'button' }, 'Salvar');
  const hookTest = h('button.btn', { type: 'button' }, 'Enviar teste');
  const hookRemove = h('button.btn.danger', { type: 'button' }, 'Remover');
  const hookActions = h('div.seg', { style: 'margin-top:8px' }, hookTest, hookRemove);
  const paintHook = () => {
    const { webhook, error, lastSentAt } = store.notify;
    hookActions.classList.toggle('hidden', !webhook);
    hookSave.textContent = webhook ? 'Substituir' : 'Salvar';
    hookStatus.classList.toggle('bad', !!error);
    hookStatus.textContent = !webhook
      ? 'Cole uma URL de webhook do Slack ou Discord, e o escritório enviará avisos para esse canal quando um trabalhador precisar de você ou concluir uma tarefa e ninguém estiver com o terminal aberto.'
      : error
        ? `⚠️ Falha ao enviar para ${WEBHOOK_NAME[webhook.kind]} (${webhook.hint}): ${error}`
        : `📣 Enviando para ${WEBHOOK_NAME[webhook.kind]} (${webhook.hint}), configurado por ${webhook.by} ${timeAgo(webhook.at)}${lastSentAt ? ` · última mensagem ${timeAgo(lastSentAt)}` : ''}.`;
  };
  paintHook();
  const saveHook = () => {
    const url = hookInput.value.trim();
    if (!url) return hookInput.focus();
    net.send({ t: 'notify.webhook', url });
    hookInput.value = '';
  };
  hookSave.addEventListener('click', saveHook);
  hookInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveHook();
  });
  hookTest.addEventListener('click', () => net.send({ t: 'notify.test' }));
  hookRemove.addEventListener('click', () => net.send({ t: 'notify.webhook', url: '' }));

  // The worker everyone starts on, unless whoever starts one picks another. Admins pick it.
  const agent = agentFields(store.project, 'office-agent', officeChoice(store.project));
  let agentTouched = false;
  agent.element.addEventListener('change', () => (agentTouched = true));
  agent.element.addEventListener('input', () => (agentTouched = true));
  const agentSave = h('button.btn.primary', { type: 'button' }, 'Salvar');
  const agentBack = h('button.btn', { type: 'button' });
  const agentActions = h('div.seg', { style: 'margin-top:8px' }, agentSave, agentBack);
  const agentNow = h('p.outside-now');
  const agentNote = h('p.setting-note');
  const paintAgent = () => {
    const admin = store.me.admin;
    const picked = store.prompts.agent;
    const now = officeChoice(store.project);
    agent.element.classList.toggle('hidden', !admin);
    agentActions.classList.toggle('hidden', !admin);
    agentNow.classList.toggle('hidden', admin);
    agentNow.textContent = choiceLabel(now);
    agentBack.classList.toggle('hidden', !picked);
    agentBack.textContent = `Voltar para ${store.project?.agentCmd.split(' ')[0].split(/[\\/]/).pop() ?? 'o --agent'}`;
    if (!agentTouched) agent.set(now);
    agentNote.textContent =
      'Todos os trabalhadores começam com este: contratados na mesa, atribuídos a uma issue ou pull request, pegos da fila, dos quadros ou reuniões. Ao iniciar um, ✏️ Editar permite escolher outro.' +
      (picked ? ` Definido por ${picked.by} ${timeAgo(picked.at)}.` : ' É o agente padrão com o qual o escritório foi iniciado.') +
      (admin ? '' : ' Administradores podem alterar isso.');
  };
  paintAgent();
  agentSave.addEventListener('click', () => {
    if (!agent.valid()) return;
    agentTouched = false;
    net.send({ t: 'prompts.agent', choice: agent.choice() });
  });
  agentBack.addEventListener('click', () => {
    agentTouched = false;
    net.send({ t: 'prompts.agent', choice: null });
  });

  // The prompts the office writes for workers by itself, for the whole office. Admins rewrite them.
  const promptsOpen = h('button.btn', { type: 'button', onclick: () => openPromptEditor(net) });
  const promptsNote = h('p.setting-note');
  const paintPrompts = () => {
    const n = rewrittenPrompts();
    promptsOpen.textContent = store.me.admin ? '📝 Editar prompts…' : '📝 Ver prompts…';
    promptsNote.textContent =
      'O que 🤖 Passar para trabalhador, 🔍 Revisar e outros botões dizem ao trabalhador, a nota adicionada a uma tarefa na fila, instruções dos agentes de quadro e salas de reunião. ' +
      (n ? `${n} deles personalizados.` : 'Todos no padrão do escritório.') +
      (store.me.admin ? '' : ' Administradores podem personalizá-los.');
  };
  paintPrompts();

  // The most workers the office runs at once, across every floor. Admins set it.
  const limitInput = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'Limite de trabalhadores simultâneos', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const limitSave = h('button.btn.primary', { type: 'button' }, 'Definir limite');
  const limitClear = h('button.btn', { type: 'button' });
  const limitRow = h('div.webhook', {}, limitInput, limitSave, limitClear);
  const limitNote = h('p.setting-note');
  const paintLimit = () => {
    const m = store.machine;
    const admin = store.me.admin;
    limitRow.classList.toggle('hidden', !admin);
    limitInput.placeholder = m.ceiling ? `1 até ${m.ceiling}` : 'ex: 6';
    limitClear.textContent = m.ceiling ? `Voltar para ${m.ceiling}` : 'Sem limite';
    limitClear.classList.toggle('hidden', !m.set);
    const now =
      m.limit === undefined
        ? `Sem limite: o escritório contrata um trabalhador para cada cadeira livre. ${m.workers} ${m.workers === 1 ? 'está' : 'estão'} aqui agora, em todos os andares.`
        : `No máximo ${m.limit} trabalhador${m.limit === 1 ? '' : 'es'} simultâneos em todos os andares (${m.workers} agora), incluindo terminais e agentes de quadro. Contratações acima disso serão recusadas.`;
    const from = m.set ? ` Definido por ${m.set.by} ${timeAgo(m.set.at)}.` : '';
    const cap = m.ceiling ? ` O escritório foi iniciado com --max-workers ${m.ceiling}, portanto não pode ultrapassar isso.` : '';
    limitNote.textContent = now + from + cap + (admin ? '' : ' Administradores podem alterar isso.');
  };
  paintLimit();
  const saveLimit = () => {
    const n = Number(limitInput.value.trim());
    if (!limitInput.value.trim() || !Number.isInteger(n) || n < 1) return limitInput.focus();
    net.send({ t: 'machine.limit', limit: n });
    limitInput.value = '';
  };
  limitSave.addEventListener('click', saveLimit);
  limitInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveLimit();
  });
  limitClear.addEventListener('click', () => net.send({ t: 'machine.limit', limit: null }));

  // Whether a worker whose pull request merged goes home by itself, for everyone.
  const leaveRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Trabalhadores cujo pull request foi mergeado' });
  const leaveNote = h('p.setting-note');
  const paintLeave = () => {
    const { on, by, at } = store.leaveOnMerge;
    leaveRow.replaceChildren(
      ...([
        [true, '🏠 Ir embora automaticamente'],
        [false, '🪑 Ficar até ser dispensado'],
      ] as const).map(([value, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(on === value),
            class: on === value ? 'on' : '',
            onclick: () => {
              if (store.leaveOnMerge.on !== value) net.send({ t: 'leaveOnMerge.set', on: value });
            },
          },
          label,
        ),
      ),
    );
    const now = on
      ? 'Assim que o pull request de um trabalhador for mesclado, ele vai embora automaticamente quando não estiver trabalhando ou aguardando resposta e ninguém estiver com o terminal aberto, e seu branch e worktree serão excluídos. Worktrees com alterações não commitadas ou commits não enviados são preservados.'
      : 'Um trabalhador cujo pull request foi mesclado permanece na mesa, contornado em roxo, até alguém dispensá-lo. Ao ativar, os já mesclados também irão embora.';
    leaveNote.textContent = `${now} É igual para todos no edifício${by ? `, definido por ${by}${at ? ` ${timeAgo(at)}` : ''}` : ''}.`;
  };
  paintLeave();

  // Where the elevator clones new projects on the office's machine. Admins move it.
  const dirInput = h('input', { type: 'text', placeholder: '~/Workspace', 'aria-label': 'Pasta dos projetos', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dirSave = h('button.btn.primary', { type: 'button' }, 'Salvar');
  const dirDefault = h('button.btn', { type: 'button' }, 'Usar o padrão');
  const dirRow = h('div.webhook', {}, dirInput, dirSave);
  const dirActions = h('div.seg', { style: 'margin-top:8px' }, dirDefault);
  const dirNote = h('p.setting-note');
  const paintDir = () => {
    const { dir, custom, by, at } = store.projectsDir;
    const admin = store.me.admin;
    dirInput.value = dir;
    dirRow.classList.toggle('hidden', !admin);
    dirActions.classList.toggle('hidden', !admin || !custom);
    dirNote.textContent =
      `Novos projetos adicionados pelo elevador são clonados em ${dir}/<dono>/<repo> na máquina do escritório.` +
      (custom && by && at ? ` Definido por ${by} ${timeAgo(at)}.` : '') +
      (admin ? ' Um checkout do mesmo repositório que já estiver lá será usado diretamente. Andares existentes permanecem onde estão.' : ' Um administrador pode alterar isso.');
  };
  paintDir();
  const saveDir = () => {
    const dir = dirInput.value.trim();
    if (!dir) return dirInput.focus();
    if (dir !== store.projectsDir.dir) net.send({ t: 'floor.projectsDir', dir });
  };
  dirSave.addEventListener('click', saveDir);
  dirInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveDir();
  });
  dirDefault.addEventListener('click', () => net.send({ t: 'floor.projectsDir', dir: '' }));

  // The dog on this floor: its name, breed and coat, for everyone here (see settings-dog.ts).
  const { section: dogSection, paint: paintDog } = dogSetting(net, (body) => setting('Cachorro do escritório', 'floor', ...body));

  // What the sky's doing, and which clock it keeps (see settings-sky.ts).
  const sky = outside && outsideSetting(net, outside, (body) => setting('Clima e céu externo', 'office', ...body));
  const account = store.me.account;
  const signOut = h('button.btn', { type: 'button' }, '🚪 Sair da conta');
  signOut.addEventListener('click', onSignOut);
  const character = h('button.btn', { type: 'button' }, account ? '🧍 Mudar visual' : '🧍 Mudar visual e nome');
  const panes: Record<SettingsPane, Node[]> = {
    you: [
      setting('Seu personagem', null, character),
      setting('Visualização da câmera', 'you', seg, note),
      setting('Sessão conectada', null, h('div.volume', {}, signOut), h('p.setting-note', {}, account ? `Como ${account.name}, com sua própria conta (${account.role}).` : 'Com a senha compartilhada do escritório.')),
    ],
    sound: [
      setting('Sons do escritório', 'you', soundRow, h('p.setting-note', {}, 'Digitação dos trabalhadores, passos, máquina de café, pássaros e chuva lá fora, o cachorro, o sinal de tarefa concluída e o alarme quando alguém precisa de você. O chat por voz não é afetado.')),
      setting('Quando um trabalhador precisar de você', 'you', alarmRow, h('p.setting-note', {}, 'Um toque de alerta no momento em que um trabalhador parar para perguntar algo ou solicitar permissão. "Lembrar continuamente" repete o som suavemente a cada 30 segundos até que alguém abra o terminal dele.')),
      setting('Virar páginas na estante', 'you', pagesRow, h('p.setting-note', {}, 'Um som suave de folhear cada vez que a página do livro for virada ao ler documentações. O ícone 🔈 no topo da estante também desativa isso.')),
      setting('Jukebox', 'you', musicRow, h('p.setting-note', {}, 'A jukebox na sala de descanso. Todos no andar ouvem a mesma música, mais alta quanto mais perto estiverem dela; este controle ajusta o volume para você.')),
      setting('Chat de voz', 'you', talkRow, h('p.setting-note', {}, 'De qualquer forma, V entra na voz, segurar V fala e você é mutado ao soltar, e M ativa ou desativa o mudo. Com "aperte para falar" você entra mutado. Saia da voz pelo menu ☰.')),
    ],
    notify: [
      setting('Notificações no navegador', 'you', notifyRow, notifyNote),
      setting('Notificações da equipe (Slack / Discord)', 'office', h('div.webhook', {}, hookInput, hookSave), hookActions, hookStatus),
    ],
    building: [
      setting('Mapa', 'office', mapRow, mapNote, mapBad),
      setting('Tema sazonal', 'office', themeRow, themeNote),
      ...(sky ? [sky.section] : []),
      dogSection,
      setting('Pasta dos projetos', 'office', dirRow, dirActions, dirNote),
    ],
    workers: [
      setting('Trabalhador padrão', 'office', agentNow, agent.element, agentActions, agentNote),
      setting('Limite de trabalhadores simultâneos', 'office', limitRow, limitNote),
      setting('Trabalhadores cujo pull request foi mesclado', 'office', leaveRow, leaveNote),
      setting('Prompts', 'office', promptsOpen, promptsNote),
    ],
  };

  // The categories down the side, the one picked on the right.
  const nav = h('nav.settings-nav', { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Configurações' });
  const tabs = new Map<SettingsPane, HTMLButtonElement>();
  const bodies = new Map<SettingsPane, HTMLElement>();
  for (const p of PANES) {
    const tab = h('button.settings-tab', { type: 'button', role: 'tab', onclick: () => show(p.id) }, h('span.icon', { 'aria-hidden': 'true' }, p.icon), h('span', {}, p.label)) as HTMLButtonElement;
    tabs.set(p.id, tab);
    nav.append(tab);
    bodies.set(p.id, h('section.settings-pane', { role: 'tabpanel', 'aria-label': p.label }, h('div.settings-head', {}, h('h3', {}, `${p.icon} ${p.label}`), h('p', {}, p.blurb)), ...panes[p.id]));
  }
  const show = (id: SettingsPane) => {
    lastPane = id;
    for (const [t, tab] of tabs) {
      tab.classList.toggle('on', t === id);
      tab.setAttribute('aria-selected', String(t === id));
      tab.tabIndex = t === id ? 0 : -1;
    }
    for (const [t, body] of bodies) body.classList.toggle('hidden', t !== id);
    bodies.get(id)!.scrollTop = 0;
    // On a phone the categories are a row across the top that scrolls sideways.
    tabs.get(id)!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  nav.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = PANES.findIndex((p) => p.id === lastPane);
    const next = PANES[(i + step + PANES.length) % PANES.length].id;
    show(next);
    tabs.get(next)!.focus();
  });

  const close = h('button.btn.close', { 'aria-label': 'Fechar' }, '✕');
  const el = h('div.modal.settings', { role: 'dialog', 'aria-label': 'Configurações' }, h('header', {}, h('h2', {}, '⚙️ Configurações'), close), h('div.settings-body', {}, nav, ...bodies.values()));
  const offNotify = store.on('notify', paintHook);
  const offDog = store.on('dog', paintDog);
  const offTheme = store.on('theme', paintTheme);
  const offMap = store.on('map', paintMap);
  const offLeave = store.on('leaveOnMerge', paintLeave);
  const offLimit = [store.on('machine', paintLimit), store.on('me', paintLimit)];
  const offDir = [store.on('projectsDir', paintDir), store.on('me', paintDir)];
  const offPrompts = [store.on('prompts', paintAgent), store.on('prompts', paintPrompts), store.on('me', paintAgent), store.on('me', paintPrompts)];
  const modal = openModal(el, {
    doing: '⚙️ nas configurações',
    onClose: () => {
      offNotify();
      offDog();
      offTheme();
      sky?.off();
      offMap();
      offLeave();
      offLimit.forEach((off) => off());
      offDir.forEach((off) => off());
      offPrompts.forEach((off) => off());
    },
  });
  show(first ?? lastPane);
  close.addEventListener('click', () => modal.close());
  character.addEventListener('click', () => {
    modal.close();
    onCharacter();
  });
}
