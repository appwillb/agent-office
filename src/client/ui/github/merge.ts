import type { GhCheck, GhMergeMethod, GhPull, GhPullDetail } from '../../../shared/protocol';
import type { Net } from '../../net';
import { h, openModal } from '../dom';
import { mergeWaiters } from './api';
import { MERGE_KEY, mergePref, savePref } from './prefs';

// ---- Whether a PR can merge ---------------------------------------------------------------------

const CHECK_ICON: Record<GhCheck['state'], string> = { pass: '✅', fail: '❌', pending: '🟡', skip: '⚪' };

interface MergeStatus {
  icon: string;
  text: string;
  cls: 'ok' | 'warn' | 'bad' | 'muted';
  /** False when merging can't work at all (draft, conflicts, already merged). */
  can: boolean;
  /** GitHub could merge it on its own once the requirements pass. */
  auto: boolean;
}

/** An open PR whose branch can't merge until someone resolves conflicts with the base. */
export function conflicted(d: GhPullDetail) {
  return d.state === 'OPEN' && !d.isDraft && (d.mergeable === 'CONFLICTING' || d.mergeStateStatus === 'DIRTY');
}

export function mergeStatus(d: GhPullDetail): MergeStatus {
  const failing = d.checks.filter((c) => c.state === 'fail').length;
  const pending = d.checks.filter((c) => c.state === 'pending').length;
  if (d.state === 'MERGED') return { icon: '🎉', text: 'Mesclado.', cls: 'ok', can: false, auto: false };
  if (d.state === 'CLOSED') return { icon: '🗑️', text: 'Fechado sem mesclar.', cls: 'muted', can: false, auto: false };
  if (d.isDraft) return { icon: '📝', text: 'Isto ainda é um rascunho. Marque como pronto para revisão no GitHub antes de mesclar.', cls: 'muted', can: false, auto: false };
  if (conflicted(d))
    return { icon: '⚠️', text: `Esta ramificação tem conflitos com ${d.baseRefName} que precisam ser resolvidos primeiro.`, cls: 'bad', can: false, auto: false };
  if (d.mergeStateStatus === 'BEHIND') return { icon: '⤵️', text: `A ramificação está desatualizada em relação a ${d.baseRefName}, e este repositório exige atualização antes de mesclar.`, cls: 'warn', can: true, auto: true };
  if (d.mergeStateStatus === 'BLOCKED') {
    const why = d.reviewDecision === 'CHANGES_REQUESTED' ? 'alterações foram solicitadas' : d.reviewDecision === 'REVIEW_REQUIRED' ? 'precisa de uma revisão aprovando' : failing ? `${failing} verificação${failing > 1 ? 'ões estão' : ' está'} falhando` : pending ? 'verificações obrigatórias ainda estão rodando' : 'uma regra de ramificação ainda não foi atendida';
    return { icon: '🚫', text: `A mesclagem está bloqueada: ${why}.`, cls: 'bad', can: true, auto: true };
  }
  if (failing) return { icon: '❌', text: `${failing} verificação${failing > 1 ? 'ões' : ''} falhando. Ainda pode ser mesclado.`, cls: 'warn', can: true, auto: false };
  if (pending || d.mergeStateStatus === 'UNSTABLE') return { icon: '🟡', text: 'Verificações ainda em execução. Pode ser mesclado agora ou assim que passarem.', cls: 'warn', can: true, auto: true };
  if (d.mergeStateStatus === 'UNKNOWN' || d.mergeable === 'UNKNOWN') return { icon: '⏳', text: 'O GitHub ainda está verificando se isto pode ser mesclado. Atualize em instantes.', cls: 'muted', can: true, auto: false };
  return { icon: '✅', text: `Pronto para mesclar: sem conflitos com ${d.baseRefName}${d.checks.length ? ' e todas as verificações passaram' : ''}.`, cls: 'ok', can: true, auto: false };
}

export function checksList(checks: GhCheck[]) {
  const order: GhCheck['state'][] = ['fail', 'pending', 'pass', 'skip'];
  const sorted = [...checks].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return h(
    'ul.gh-checks',
    {},
    ...sorted.map((c) => h('li', {}, h('span', { 'aria-label': c.state }, CHECK_ICON[c.state]), c.url ? h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.name) : h('span', {}, c.name))),
  );
}

// ---- Merge dialog -------------------------------------------------------------------------------

const METHOD_LABEL: Record<GhMergeMethod, string> = { squash: 'Squash e mesclar', merge: 'Criar commit de mesclagem', rebase: 'Rebase e mesclar' };

export function openMerge(it: GhPull, d: GhPullDetail, net: Net, handToWorker: () => void, onMerged: () => void) {
  const st = mergeStatus(d);
  const methods = d.repo.methods;
  let { method, deleteBranch } = mergePref(methods);
  let busy = false;

  const methodBtns = h('div.seg');
  const go = h('button.btn.primary', { type: 'button' });
  const auto = h('input', { type: 'checkbox', id: 'merge-auto' }) as HTMLInputElement;
  auto.checked = st.auto && st.cls !== 'ok';
  const renderMethods = () => {
    methodBtns.replaceChildren(
      ...methods.map((m) =>
        h('button.btn', { type: 'button', class: m === method ? 'on' : '', onclick: () => ((method = m), savePref(MERGE_KEY, { method, deleteBranch }), renderMethods()) }, METHOD_LABEL[m]),
      ),
    );
    go.textContent = auto.checked ? '⏱ Mesclar quando estiver pronto' : `🔀 ${METHOD_LABEL[method]}`;
  };
  auto.addEventListener('change', renderMethods);
  const del = h('input', { type: 'checkbox', id: 'merge-del' }) as HTMLInputElement;
  del.checked = deleteBranch;
  del.addEventListener('change', () => {
    deleteBranch = del.checked;
    savePref(MERGE_KEY, { method, deleteBranch });
  });
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, 'Cancelar');
  // Conflicts can't be merged from here, so fixing them is the main button.
  const worker = conflicted(d)
    ? h('button.btn.primary', { type: 'button', title: 'Um novo trabalhador mescla a base, resolve os conflitos e mescla conforme escolhido acima' }, '✨ Novo trabalhador: corrigir conflitos e mesclar')
    : h('button.btn', { type: 'button', title: 'Um trabalhador corrige o que estiver pendente e mescla' }, '🤖 Entregar para um trabalhador');

  const el = h(
    'div.modal.gh-merge',
    { role: 'dialog', 'aria-label': `Mesclar PR #${it.number}` },
    h('header', {}, h('h2', {}, `🔀 Mesclar #${it.number}`)),
    h(
      'div.body',
      {},
      h('p.gh-merge-title', {}, it.title, h('small', {}, `${it.headRefName} → ${it.baseRefName}`)),
      h('div.gh-status', { class: st.cls }, h('span', {}, st.icon), st.text),
      d.checks.length ? checksList(d.checks) : null,
      h('label', { style: 'margin-top:14px' }, 'Como'),
      methodBtns,
      h('label.gh-check', { for: 'merge-del' }, del, `Excluir ${it.headRefName} após mesclar`),
      st.auto ? h('label.gh-check', { for: 'merge-auto', title: 'gh pr merge --auto (o repositório deve permitir auto-merge)' }, auto, 'Mesclar automaticamente assim que os requisitos passarem') : null,
      result,
    ),
    h('footer', {}, st.can || conflicted(d) ? null : worker, h('span.grow'), cancel, conflicted(d) ? worker : go),
  );
  renderMethods();
  if (!st.can) go.disabled = true;

  const modal = openModal(el, { onClose: () => mergeWaiters.delete(it.number) });
  cancel.addEventListener('click', () => modal.close());
  worker.addEventListener('click', () => {
    modal.close();
    handToWorker();
  });
  go.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), auto.checked && st.auto ? 'Solicitando ao GitHub para mesclar quando estiver pronto…' : 'Mesclando…');
    mergeWaiters.set(it.number, (msg) => {
      mergeWaiters.delete(it.number);
      busy = false;
      if (msg.error) {
        go.disabled = false;
        result.className = 'gh-merge-result error';
        result.replaceChildren(msg.error);
        return;
      }
      modal.close();
      onMerged();
    });
    net.send({ t: 'gh.merge', number: it.number, method, deleteBranch, auto: auto.checked && st.auto });
  });
  setTimeout(() => (st.can ? go : cancel).focus(), 30);
}
