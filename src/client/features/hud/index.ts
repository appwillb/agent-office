/**
 * The HUD: a few buttons on the top bar, everything else in the ☰ menu (Tab), with H for the controls
 * and F to hang a picture; the project in the corner (click it for the floors); Settings, and your
 * character.
 */
import { ROOF } from '../../../shared/rooftop';
import type { Ctx } from '../../core/context';
import type { CoreState } from '../../core/ctx';
import { builtFloors } from '../../core/floors';
import type { Parts } from '../../core/parts';
import { waitingInOrder, waitingLabel } from '../../nextup';
import { saveSettings, store } from '../../state';
import { openAccounts } from '../../ui/accounts';
import { openBoard } from '../../ui/boards';
import { openCharacter } from '../../ui/character';
import { $ } from '../../ui/dom';
import { toggleFloorMenu } from '../../ui/floormenu';
import { openHelp } from '../../ui/hud';
import { mountHud } from '../../ui/menu';
import { openServices } from '../../ui/services';
import { openSettings, type SettingsPane } from '../../ui/settings';
import { needsSigningIn, openSignIns } from '../../ui/signins';
import { openTeam } from '../../ui/team';
import { openUpgrade } from '../../ui/upgrade';
import { openWhiteboard } from '../whiteboard/ui';
import { describeSky } from '../../world/sky';

export type HudParts = Pick<Parts, 'worlds' | 'place' | 'travel' | 'you' | 'actions' | 'waiting' | 'meeting' | 'bookshelf' | 'hanging' | 'talk' | 'notifier'>;

/** Listens for clicks on the HUD and the project, registers what the HUD follows (see mountHud), and binds Tab, H and F. */
export function installHud(ctx: Ctx, core: CoreState, parts: HudParts) {
  const { net, voice, settings, player, sound } = ctx;
  const { inOffice } = parts.worlds;
  const { travel, waiting, actions, hanging, talk } = parts;

  // Buttons must not keep focus, or Space (jump) would click them again.
  $('hud').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (btn) setTimeout(() => btn.blur(), 0);
  });
  // The project in the corner is the floor you're on; click it for the list of floors to go to.
  $('project').addEventListener('click', () => {
    if (!store.floor) return travel.showElevator();
    toggleFloorMenu($('project'), { go: travel.switchFloor, indoors: () => (!inOffice() && !core.upTop) || parts.place.indoors(), elevator: travel.showElevator, roof: inOffice() ? () => travel.ride(ROOF) : null });
  });

  // ---- The HUD: a few buttons on the top bar, everything else in the ☰ menu ----------------------------
  const waitingNow = () => waitingInOrder(store.workers.values());
  const noMedia = () => (window.isSecureContext ? undefined : 'Voice and screen sharing need HTTPS or localhost — use a TLS proxy, --self-signed, or an SSH tunnel');
  const hud = mountHud(
    [
      { id: 'issues', icon: '📌', label: 'Issues', section: 'Abrir', count: () => store.issues.items.filter((i) => i.state === 'OPEN').length, run: () => openBoard('issues', net, actions.boardActions()) },
      { id: 'pulls', icon: '🔀', label: 'Pull requests', section: 'Abrir', count: () => store.pulls.items.filter((p) => p.state === 'OPEN').length, run: () => openBoard('pulls', net, actions.boardActions()) },
      { id: 'queue', icon: '📋', label: 'Fila de tarefas', section: 'Abrir', count: () => store.queue.tasks.filter((t) => t.status !== 'done').length, title: () => 'Issues e tarefas aguardando trabalhador', run: waiting.showQueue },
      { id: 'services', icon: '🌐', label: 'Serviços', section: 'Abrir', count: () => store.services.items.length, title: () => 'Servidores web em execução pelos trabalhadores', run: () => openServices() },
      { id: 'whiteboard', icon: '📝', label: 'Quadro branco', section: 'Abrir', title: () => 'Desenhar em tempo real com a equipe', run: () => openWhiteboard(net) },
      // Up on the top bar while a meeting is on: what's being worked through in the meeting room.
      {
        id: 'meeting',
        icon: '🤝',
        label: 'Sala de reunião',
        section: 'Abrir',
        status: () => store.meeting.current?.status === 'running',
        chip: () => 'Em reunião',
        title: () => 'Iniciar reunião: trabalhadores resolvem uma dúvida ou tarefa juntos',
        run: () => parts.meeting.showMeeting(),
      },
      { id: 'search', icon: '🔎', label: 'Buscar', section: 'Abrir', key: '/', title: () => 'Buscar no chat e em todos os terminais', run: waiting.showSearch },
      // The office has its bookshelf for them; a map of its own may not.
      { id: 'docs', icon: '📚', label: 'Documentação', section: 'Abrir', shown: () => !inOffice(), title: () => 'Ler documentação do projeto', run: parts.bookshelf.showBookshelf },
      { id: 'elevator', icon: '🛗', label: () => (inOffice() ? 'Elevador' : 'Andares'), section: 'Abrir', count: () => store.floors.reduce((n, f) => n + (f.id === store.floor ? 0 : f.waiting), 0), title: () => (inOffice() ? 'Ir para outro projeto' : 'Ir para outro projeto ou adicionar novo'), run: travel.showElevator },
      { id: 'roof', icon: '🍸', label: 'Bar no terraço', section: 'Abrir', shown: () => !core.upTop && inOffice() && builtFloors().length > 0, title: () => 'Subir de elevador até o terraço: DJ, drinks e vista da cidade', run: () => travel.ride(ROOF) },
      // In voice, V is push to talk, so leaving is only from here.
      { id: 'voice', icon: '🎙️', label: () => (voice.inVoice ? 'Sair da voz' : 'Entrar na voz'), section: 'Equipe', key: () => (voice.inVoice ? undefined : 'V'), on: () => voice.inVoice, blocked: noMedia, run: () => void talk.toggleVoice() },
      // While you're in voice, the top bar keeps the mute button handy. Muted is the usual with push to talk, so it doesn't stand out then.
      {
        id: 'mute',
        icon: () => (voice.muted ? '🔇' : '🎙️'),
        label: () => (voice.muted ? 'Desmutar' : 'Mutar'),
        section: 'Equipe',
        key: 'M',
        shown: () => voice.inVoice,
        status: () => voice.inVoice,
        on: () => voice.inVoice,
        tone: () => (voice.muted && !settings.pushToTalk ? 'danger' : undefined),
        title: () => (voice.muted ? 'Mutado: segure V para falar, ou M para desmutar' : 'Mutar (M) · segure V para falar'),
        run: () => voice.toggleMute(),
      },
      { id: 'share', icon: '🖥️', label: () => (voice.sharing ? 'Parar tela' : 'Compartilhar tela'), section: 'Equipe', on: () => voice.sharing, status: () => voice.sharing, chip: () => 'Compartilhando', blocked: noMedia, run: () => void talk.toggleShare() },
      { id: 'decor', icon: '🖼️', label: () => (hanging.hanger.active ? 'Parar de pendurar quadro' : 'Pendurar quadro'), section: 'Equipe', key: 'F', shown: () => inOffice(), on: () => hanging.hanger.active, status: () => hanging.hanger.active, run: () => (hanging.hanger.active ? hanging.hanger.cancel() : hanging.startHanging()) },
      { id: 'team', icon: '👥', label: 'Convidar equipe', section: 'Equipe', shown: () => store.invites, run: () => openTeam(net) },
      { id: 'accounts', icon: '🔑', label: 'Contas', section: 'Equipe', shown: () => store.me.admin, title: () => 'Convidar pessoas, ver contas ativas, revogar acessos', run: () => openAccounts(net) },
      { id: 'signins', icon: '🔐', label: 'Seus logins', section: 'Equipe', shown: () => !!store.me.account, tone: () => (needsSigningIn() ? 'danger' : undefined), status: needsSigningIn, chip: () => 'Entrar no Claude', title: () => 'Conta do Claude e GitHub usada pelos trabalhadores', run: () => openSignIns(net) },
      { id: 'settings', icon: '⚙️', label: 'Configurações', section: 'Escritório', run: showSettings },
      { id: 'help', icon: '❓', label: 'Controles', section: 'Escritório', key: 'H', run: openHelp },
      { id: 'lite', icon: '📱', label: 'Modo 2D', section: 'Escritório', title: () => 'Trabalhadores, terminais e quadros sem o 3D: ideal para celular ou computadores mais lentos', run: () => location.assign('/lite') },
      {
        id: 'upgrade',
        icon: '⬆️',
        label: () => (store.upgrade.phase === 'building' ? 'Atualizando…' : store.upgrade.latest ? 'Atualizar escritório' : 'Upgrade do escritório'),
        section: 'Escritório',
        shown: () => store.upgrade.available,
        // A new version, or one being built, gets a place on the top bar until it's in.
        status: () => !!store.upgrade.latest || store.upgrade.phase === 'building',
        chip: () => (store.upgrade.phase === 'building' ? 'Atualizando…' : 'Atualização'),
        tone: () => (store.upgrade.latest && store.upgrade.phase !== 'building' ? 'primary' : undefined),
        title: () => (store.upgrade.latest ? `Nova versão: ${store.upgrade.latest.subject}` : 'Atualizar o escritório'),
        run: () => openUpgrade(net),
      },
      // Up on the top bar while workers wait on someone (N does the same), next to the Workers button.
      {
        id: 'waiting',
        icon: () => (waitingNow().some((w) => w.status === 'needs_input') ? '🙋' : '✅'),
        label: 'Próximo trabalhador que precisa de você',
        section: 'Abrir',
        key: 'N',
        shown: () => waitingNow().length > 0,
        status: () => waitingNow().length > 0,
        chip: () => waitingLabel(waitingNow()).replace(/^(🙋|✅) /, ''),
        on: () => waitingNow().every((w) => w.status === 'done'),
        tone: () => (waitingNow().some((w) => w.status === 'needs_input') ? 'danger' : undefined),
        title: () => 'Ir para o próximo trabalhador aguardando alguém: priorizando os que precisam de você (N)',
        run: waiting.goToNextWaiting,
      },
    ],
    settings,
    () => saveSettings(settings),
  );
  ctx.keys.bind({
    code: 'Tab',
    preventDefault: true,
    run: () => {
      hud.toggleMenu();
    },
  });
  ctx.keys.bind({
    code: 'KeyH',
    run: () => {
      openHelp();
    },
  });
  ctx.keys.bind({
    code: 'KeyF',
    run: () => {
      hanging.startHanging();
    },
  });
  function showSettings(pane?: SettingsPane) {
    openSettings(
      net,
      settings,
      (s) => {
        // Switching to push to talk mutes you now; back to an open mic turns it on.
        const talkChanged = s.pushToTalk !== settings.pushToTalk;
        Object.assign(settings, s);
        saveSettings(settings);
        if (talkChanged) {
          voice.setMuted(settings.pushToTalk);
          hud.refresh();
        }
        player.setView(settings.view);
        sound.setVolume(settings.volume, settings.muted);
        sound.setMusicVolume(settings.music, settings.musicMuted);
      },
      editProfile,
      sound,
      parts.notifier,
      signOut,
      store.sky ? { now: describeSky(store.sky, store.officeNow()), live: !!store.sky.city } : undefined,
      pane,
    );
  }

  async function signOut() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  }

  function editProfile() {
    openCharacter(false, (p) => {
      parts.you.showMyProfile(p);
      net.send({ t: 'profile', name: p.name, color: p.color, look: p.look });
    });
  }

  return { hud, showSettings, editProfile };
}
