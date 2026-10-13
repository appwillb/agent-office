import type { PlanWindow } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { panelHide } from './menu';

/** Numbers older than this say when they were read. */
const STALE_MS = 10 * 60_000;

/** "in 12m", "in 2h 5m", or "Tue 5:00 AM" once it is more than a day out. */
/** "in 12m", "in 2h 5m", or "Tue 5:00 AM" once it is more than a day out. */
export function fmtReset(at: number, now = Date.now()): string {
  const mins = Math.ceil((at - now) / 60_000);
  if (mins <= 0) return 'agora';
  if (mins < 60) return `em ${mins}m`;
  if (mins < 24 * 60) return `em ${Math.floor(mins / 60)}h ${mins % 60}m`;
  return new Date(at).toLocaleString('pt-BR', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const level = (pct: number) => (pct >= 90 ? 'over' : pct >= 75 ? 'near' : '');

function windowRow(w: PlanWindow, now: number): HTMLElement[] {
  const pct = Math.round(w.pct);
  const when = w.resetsAt ? new Date(w.resetsAt).toLocaleString('pt-BR', { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : '';
  const scope = w.label === 'Week' ? ' (todos os modelos)' : '';
  const title = `${w.label}${scope}: ${pct}% usado${when ? `\nReinicia ${when}` : ''}`;
  return [
    h(
      'div.row',
      { title },
      h('span.what', {}, w.label),
      h('b', { class: level(w.pct) }, `${pct}%`),
      w.resetsAt ? h('span.reset', {}, `reinicia ${fmtReset(w.resetsAt, now)}`) : null,
    ),
    h('div.meter', { class: level(w.pct), title, role: 'progressbar', 'aria-label': w.label, 'aria-valuenow': pct }, h('div.fill', { style: `width:${w.pct}%` })),
  ];
}

/** The Claude plan's 5-hour session and weekly limits, under the workers. Click to read them again. */
export function renderLimits() {
  const s = store.limits;
  const el = $('limits');
  el.classList.toggle('hidden', !s.windows.length);
  if (!s.windows.length) return;
  const now = Date.now();
  const plan = s.plan ? s.plan.charAt(0).toUpperCase() + s.plan.slice(1) : '';
  el.replaceChildren(h('h3', {}, 'Limites Claude', plan ? h('span.plan', {}, plan) : null, panelHide('limits')), ...s.windows.flatMap((w) => windowRow(w, now)));
  if (now - s.at > STALE_MS) el.append(h('div.row.muted', {}, `Em ${new Date(s.at).toLocaleTimeString('pt-BR', { hour: 'numeric', minute: '2-digit' })}`));
}
