import './floorplan.css';
import { LABEL_IDEAS, MAX_LABEL, SIGN_COLORS, cleanLabel, rowDesks, signColor, signInk } from '../../shared/floorplan';
import { DESK_BY_ID, WING } from '../../shared/layout';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';

const COLOR_KEY = 'agent-office.signColor';
function lastColor(): string {
  try {
    return signColor(localStorage.getItem(COLOR_KEY));
  } catch {
    return SIGN_COLORS[0].color;
  }
}

/** L at a desk: what the sign over it says (and its color), or take it down. */
export function openDeskLabel(net: Net, deskId: string) {
  const desk = DESK_BY_ID.get(deskId);
  if (!desk) return;
  const old = store.floorPlan.labels[deskId];
  let color = old?.color ?? lastColor();
  const input = h('input', { type: 'text', maxlength: MAX_LABEL, placeholder: 'Operações', 'aria-label': 'Placa', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  input.value = old?.text ?? '';
  const preview = h('div.sign-preview', { 'aria-hidden': 'true' });
  const swatches = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Cor' });
  const ideas = h('div.label-ideas');
  const submit = h('button.btn.primary', { type: 'submit' }, old ? 'Salvar' : '🪧 Pendurar') as HTMLButtonElement;
  const remove = old ? (h('button.btn.danger', { type: 'button' }, 'Remover placa') as HTMLButtonElement) : null;
  const cancel = h('button.btn', { type: 'button' }, 'Cancelar');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Fechar' }, '✕');
  const form = h(
    'form.modal.desklabel',
    { role: 'dialog', 'aria-label': `Placa sobre ${desk.label}` },
    h('header', {}, h('h2', {}, `🪧 Placa sobre ${desk.label}`), close),
    h('div.body', {}, preview, h('label', { style: 'margin-top:14px' }, 'Texto da placa'), input, ideas, h('label', { style: 'margin-top:14px' }, 'Cor'), swatches),
    h('footer', {}, h('span.grow', {}, 'Ela fica pendurada no teto sobre a mesa para todos neste andar.'), remove, cancel, submit),
  ) as HTMLFormElement;
  form.noValidate = true;

  const render = () => {
    const text = cleanLabel(input.value);
    preview.style.background = color;
    preview.style.color = signInk(color);
    preview.textContent = text || 'Operações';
    preview.classList.toggle('placeholder', !text);
    submit.disabled = !text && !old;
    submit.textContent = !text && old ? 'Remover placa' : old ? 'Salvar' : '🪧 Pendurar';
    for (const b of swatches.children) (b as HTMLElement).classList.toggle('sel', (b as HTMLElement).dataset.color === color);
  };
  swatches.replaceChildren(
    ...SIGN_COLORS.map((c) =>
      h('button.swatch', {
        type: 'button',
        role: 'radio',
        title: c.name,
        'aria-label': c.name,
        'data-color': c.color,
        style: `background:${c.color}`,
        onclick: () => {
          color = c.color;
          try {
            localStorage.setItem(COLOR_KEY, color);
          } catch {
            // private mode: the color just isn't remembered
          }
          render();
        },
      }),
    ),
  );
  ideas.replaceChildren(
    ...LABEL_IDEAS.map((idea) =>
      h(
        'button.btn',
        {
          type: 'button',
          onclick: () => {
            input.value = idea;
            render();
            input.focus();
          },
        },
        idea,
      ),
    ),
  );
  input.addEventListener('input', render);

  const modal = openModal(form, { doing: `🪧 editando placa de ${desk.label}` });
  const send = (text: string) => {
    net.send({ t: 'desk.label', deskId, text, color });
    modal.close();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = cleanLabel(input.value);
    if (text || old) send(text);
  });
  remove?.addEventListener('click', () => send(''));
  cancel.addEventListener('click', () => modal.close());
  close.addEventListener('click', () => modal.close());
  render();
  input.focus();
  input.select();
}

/** E at the sign in the back office (or on the wall where it goes through): build it out, or wall it up. */
export function openExpand(net: Net) {
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Fechar' }, '✕');
  const status = h('div.expand-status');
  const expand = h('button.btn.primary', { type: 'button' }) as HTMLButtonElement;
  const shrink = h('button.btn', { type: 'button' }, '🧱 Fechar última fileira') as HTMLButtonElement;
  const el = h(
    'div.modal.expand',
    { role: 'dialog', 'aria-label': 'Expansão do escritório' },
    h('header', {}, h('h2', {}, '🔨 Expansão do escritório'), close),
    h('div.body', {}, status),
    h('footer', {}, shrink, expand),
  );
  const names = (row: number) =>
    rowDesks(row)
      .map((d) => d.label)
      .join(' e ');
  const render = () => {
    const level = store.floorPlan.wing;
    const full = level >= WING.rows;
    const next = level + 1;
    const last = level > 0 ? rowDesks(level) : [];
    const busy = last.find((d) => store.workerAtDesk(d.id));
    status.replaceChildren(
      h('p', {}, level === 0 ? 'O escritório tem espaço para expansão através da parede norte, entre o gongo e o canto.' : `A expansão possui ${level} de ${WING.rows} fileiras construídas, com mais ${level * 2} mesas.`),
      h('div.expand-rows', {}, ...Array.from({ length: WING.rows }, (_, i) => h('span', { class: i < level ? 'on' : '', title: names(i + 1) }, i < level ? '🪑🪑' : '· ·'))),
      full ? h('p.setting-note', {}, "Espaço totalmente expandido.") : h('p.setting-note', {}, `Derrubar a parede adiciona ${names(next)}, cada uma com sua própria placa para pendurar (tecla L na mesa).`),
      busy ? h('p.setting-note.bad', {}, `Há alguém em ${busy.label}: dispense o trabalhador antes de fechar esta fileira.`) : '',
      h('p.setting-note', {}, 'Altera o andar para todos presentes e é mantido mesmo após reiniciar.'),
    );
    expand.disabled = full;
    expand.textContent = full ? 'Totalmente construído' : level === 0 ? '🔨 Expandir (+2 mesas)' : '🔨 Próxima fileira (+2 mesas)';
    shrink.disabled = level === 0 || !!busy;
    shrink.style.display = level === 0 ? 'none' : '';
  };
  const off = [store.on('floorPlan', render), store.on('workers', render)];
  const modal = openModal(el, { doing: '🔨 na expansão do escritório', onClose: () => off.forEach((f) => f()) });
  expand.addEventListener('click', () => {
    net.send({ t: 'floor.expand' });
    modal.close();
  });
  shrink.addEventListener('click', () => {
    net.send({ t: 'floor.shrink' });
    modal.close();
  });
  close.addEventListener('click', () => modal.close());
  render();
}
