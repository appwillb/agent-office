import './hud.css';
import { h, openModal } from './dom';
import { HELP_ROWS } from './help';

export function openHelp() {
  const close = h('button.btn.close', { 'aria-label': 'Fechar' }, '✕');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Controles' },
    h('header', {}, h('h2', {}, '🎮 Controles'), close),
    h('div.body', {}, h('div.help-grid', {}, ...HELP_ROWS.flatMap(([k, v]) => [h('span.key', {}, k), h('span', {}, v)]))),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
}
