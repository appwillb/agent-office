/** The board agents: what each is for, and the ones waiting by their boards before anyone has asked them anything. */
import { STATION_AGENT, type StationKind } from '../../shared/layout';
import { Worker } from '../world/character';
import type { DeskView } from '../world/types';
import type { World } from '../world/world';
import { noOutline } from './outline';

/** What each board agent is for: its board's icon, what it offers on the card over its head, and an example ask. */
export const STATION_INFO: Record<StationKind, { icon: string; offer: string; does: string; example: string }> = {
  issues: { icon: '📌', offer: 'Pergunte sobre issues', does: 'Eu crio, busco, organizo e fecho issues', example: 'Criar uma issue: o cachorro atravessa a jukebox' },
  pulls: { icon: '🔀', offer: 'Pergunte sobre PRs', does: 'Eu resumo, reviso, comento e mesclo PRs', example: 'Revise o PR mais recente e veja se está pronto para merge' },
  queue: { icon: '📋', offer: 'Peça para enfileirar tarefas', does: 'Eu transformo pedidos em tarefas para novos trabalhadores', example: 'Enfileire todas as issues de bug abertas' },
};

/** A board agent waiting by its board before anyone has asked it anything (see buildKiosk), and where. */
export interface IdleAgent {
  model: Worker;
  view: DeskView;
}

/** The board agents waiting by their boards in `w`. */
export function idleAgentsIn(w: World): IdleAgent[] {
  return w.plan.stations.map((def) => {
    const kind = def.station!;
    const agent = STATION_AGENT[kind];
    const model = new Worker(agent.name, agent.color);
    model.setStatus('idle', false);
    model.setTask({ name: STATION_INFO[kind].offer, summary: STATION_INFO[kind].does });
    model.setOutfit(w.plan.agents.outfit === 'peasant' ? 'peasant' : null);
    const view = w.desks.get(def.id)!;
    view.vacancy.children[0].add(model.root);
    noOutline(model.root);
    return { model, view };
  });
}
