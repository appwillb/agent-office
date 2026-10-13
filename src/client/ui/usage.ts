import { fmtCost, fmtTokens, tokensOf, type AgentProvider, type Usage } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { providerUsageState, providerUsageTracked, resolvedProvider } from './provider';

export { fmtCost, fmtTokens, tokensOf };

function displayedCost(u: Usage): string {
  return u.costKnown === false ? 'custo indisponível' : fmtCost(u.cost);
}

/** e.g. "$0.42 · 38k tokens"; OpenCode's amount is explicitly an estimate. */
export function usageLabel(u: Usage, provider: AgentProvider = 'claude'): string {
  const money = provider === 'codex' && u.costKnown !== true
    ? 'custo indisponível'
    : u.costKnown === false
      ? 'custo indisponível'
      : `${fmtCost(u.cost)}${provider === 'opencode' ? ' reportado' : ''}`;
  // DeepSeek Harness reports what is in the context window, not a token split.
  if (provider === 'dsh') {
    const window = u.contextSize !== undefined ? ` / ${fmtTokens(u.contextSize)}` : '';
    const spend = u.costKnown === true ? `${fmtCost(u.cost)} · ` : '';
    return `${u.incomplete ? 'Parcial: ' : ''}${spend}${fmtTokens(tokensOf(u))}${window} contexto`;
  }
  return `${u.incomplete ? "Parcial: " : ""}${money} · ${fmtTokens(tokensOf(u))} tokens`;
}

/** The breakdown behind a figure, for a tooltip. */
export function usageTitle(u: Usage, provider: AgentProvider = 'claude'): string {
  const money = provider === 'codex' && u.costKnown !== true ? 'custo indisponível' : u.costKnown === false ? 'custo indisponível' : fmtCost(u.cost);
  const calls = provider === 'codex' || u.callsKnown === false
    ? 'chamadas de API indisponíveis'
    : provider === 'opencode'
      ? `${u.calls} chamada${u.calls === 1 ? '' : 's'} reportada${u.calls === 1 ? '' : 's'}`
      : `${u.calls} chamada${u.calls === 1 ? '' : 's'} de API`;
  const dshContext = u.contextSize !== undefined ? `${fmtTokens(tokensOf(u))} de ${fmtTokens(u.contextSize)} tokens de contexto` : `${fmtTokens(tokensOf(u))} tokens de contexto`;
  return [
    ...(u.incomplete ? ['Métricas parciais: histórico de sessão carregando ou indisponível.'] : []),
    provider === 'codex'
      ? `Métricas de sessão raiz do Codex; subagentes não inclusos; ${money}; ${calls}`
      : provider === 'opencode'
        ? `Estimativa reportada pelo OpenCode ${money}; estimativa do modelo, não fatura; ${calls}`
        : provider === 'dsh'
          ? `Uso de contexto do DeepSeek Harness via ACP: ${dshContext}; custo de sessão ${u.costKnown === true ? money : 'indisponível'}; ${calls}`
          : `${money} em ${calls}`,
    `entrada ${fmtTokens(u.input)} · saída ${fmtTokens(u.output)}`,
    `raciocínio ${fmtTokens(u.reasoning ?? 0)}`,
    `gravação de cache ${fmtTokens(u.cacheWrite)} · leitura de cache ${fmtTokens(u.cacheRead)}`,
  ].join('\n');
}

export function overBudget(): boolean {
  const s = store.usage;
  return s.budget !== undefined && s.today.cost >= s.budget;
}

/** New hires are refused: the daily budget is spent and the office runs with --budget-pause. */
export const hiringPaused = () => store.usage.pauseHiring && overBudget();

/** The sidebar's spend lines: what the workers at their desks cost, today's total and the budget. */
export function renderUsage() {
  const s = store.usage;
  let now = 0;
  let currentOpenCodeCost = 0;
  let currentOpenCodeTokens = 0;
  let currentOpenCodeInput = 0;
  let currentOpenCodeOutput = 0;
  let currentOpenCodeReasoning = 0;
  let currentOpenCodeCacheWrite = 0;
  let currentOpenCodeCacheRead = 0;
  let currentOpenCodeReports = 0;
  let currentOpenCodeCostUnknown = false;
  let currentOpenCodeIncomplete = false;
  let openCodeWaiting = false;
  let currentCodexCost = 0;
  let currentCodexTokens = 0;
  let currentCodexInput = 0;
  let currentCodexOutput = 0;
  let currentCodexReasoning = 0;
  let currentCodexCacheWrite = 0;
  let currentCodexCacheRead = 0;
  let currentCodexReports = 0;
  let currentCodexCostUnknown = false;
  let currentCodexIncomplete = false;
  let codexWaiting = false;
  let currentDshTokens = 0;
  let currentDshContext = 0;
  let currentDshReports = 0;
  let currentDshCost = 0;
  let currentDshCostKnown = false;
  let dshWaiting = false;
  let untracked = false;
  for (const w of store.workers.values()) {
    if (w.kind !== 'agent') continue;
    const provider = resolvedProvider(w.provider, store.project);
    const state = providerUsageState(provider, store.project, w.usage);
    if (state === 'untracked') untracked = true;
    if (provider === 'opencode') {
      if (!w.usage) {
        openCodeWaiting = true;
        continue;
      }
      currentOpenCodeReports++;
      if (w.usage.incomplete) currentOpenCodeIncomplete = true;
      currentOpenCodeTokens += tokensOf(w.usage);
      currentOpenCodeInput += w.usage.input;
      currentOpenCodeOutput += w.usage.output;
      currentOpenCodeReasoning += w.usage.reasoning ?? 0;
      currentOpenCodeCacheWrite += w.usage.cacheWrite;
      currentOpenCodeCacheRead += w.usage.cacheRead;
      if (w.usage.costKnown === false) currentOpenCodeCostUnknown = true;
      else currentOpenCodeCost += w.usage.cost;
    }
    if (provider === 'codex') {
      if (!w.usage) {
        codexWaiting = true;
        continue;
      }
      currentCodexReports++;
      if (w.usage.incomplete) currentCodexIncomplete = true;
      currentCodexTokens += tokensOf(w.usage);
      currentCodexInput += w.usage.input;
      currentCodexOutput += w.usage.output;
      currentCodexReasoning += w.usage.reasoning ?? 0;
      currentCodexCacheWrite += w.usage.cacheWrite;
      currentCodexCacheRead += w.usage.cacheRead;
      if (w.usage.costKnown !== true) currentCodexCostUnknown = true;
      else currentCodexCost += w.usage.cost;
    }
    if (provider === 'dsh') {
      if (!w.usage) {
        dshWaiting = true;
        continue;
      }
      currentDshReports++;
      currentDshTokens += tokensOf(w.usage);
      if (w.usage.contextSize !== undefined) currentDshContext = Math.max(currentDshContext, w.usage.contextSize);
      if (w.usage.costKnown === true) {
        currentDshCost += w.usage.cost;
        currentDshCostKnown = true;
      }
    }
    if (providerUsageTracked(provider, store.project, w.usage) && w.usage?.costKnown !== false && !w.usage?.incomplete) now += w.usage?.cost ?? 0;
  }
  const head = $('workers-cost');
  head.textContent = now > 0 ? fmtCost(now) : '';
  head.title = 'Mesas atuais: custos de Claude Code rastreados mais estimativas reportadas de OpenCode e DeepSeek Harness; tokens de sessão raiz do Codex aparecem abaixo; sessões sem custo disponível ou com histórico parcial são excluídas.';

  const el = $('usage');
  const any = s.total.calls > 0 || s.budget !== undefined || untracked || currentOpenCodeReports > 0 || openCodeWaiting || currentCodexReports > 0 || codexWaiting || currentDshReports > 0 || dshWaiting;
  el.classList.toggle('hidden', !any);
  if (!any) return;
  const over = overBudget();
  el.classList.toggle('over', over);
  const rows: HTMLElement[] = [];
  if (s.total.calls > 0 || s.budget !== undefined) {
    rows.push(
      h(
        'div.row',
        {},
        h('span', {}, '💸 Claude Code hoje'),
        h('b', { title: usageTitle(s.today, 'claude') }, displayedCost(s.today)),
        s.budget !== undefined ? h('span.muted', {}, `de ${fmtCost(s.budget)}`) : h('span.muted', {}, `· ${fmtTokens(tokensOf(s.today))} tokens`),
      ),
    );
  }
  if (s.budget !== undefined) {
    const pct = Math.min(100, (s.today.cost / s.budget) * 100);
    const state = over ? (s.pauseHiring ? 'Orçamento esgotado — novas contratações pausadas até amanhã' : 'Orçamento esgotado') : `${Math.round(pct)}% do orçamento de hoje`;
    rows.push(h('div.budget', { class: over ? 'over' : pct >= 80 ? 'near' : '', title: state, role: 'progressbar', 'aria-valuenow': Math.round(pct) }, h('div.fill', { style: `width:${pct}%` })));
  }
  if (s.total.calls > 0 || s.budget !== undefined) rows.push(h('div.row.muted', { title: usageTitle(s.total, 'claude') }, `Claude Code histórico ${displayedCost(s.total)} · ${fmtTokens(tokensOf(s.total))} tokens`));
  if (currentOpenCodeReports > 0) {
    const amount = currentOpenCodeCostUnknown ? 'custo indisponível' : `${fmtCost(currentOpenCodeCost)} reportado`;
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            'Métricas de mesas do OpenCode são estimativas do modelo/provedor, não fatura.',
            `entrada ${fmtTokens(currentOpenCodeInput)} · saída ${fmtTokens(currentOpenCodeOutput)}`,
            `raciocínio ${fmtTokens(currentOpenCodeReasoning)}`,
            `gravação de cache ${fmtTokens(currentOpenCodeCacheWrite)} · leitura de cache ${fmtTokens(currentOpenCodeCacheRead)}`,
          ].join('\n'),
        },
        `OpenCode ${currentOpenCodeIncomplete ? "parcial" : "mesas atuais"} ${amount} · ${fmtTokens(currentOpenCodeTokens)} tokens`,
      ),
    );
  }
  if (openCodeWaiting) rows.push(h('div.row.muted', { title: 'Uso do OpenCode aparece após o primeiro relatório de métricas.' }, 'Métricas do OpenCode aguardando primeiro relatório'));
  if (currentCodexReports > 0) {
    const amount = currentCodexCostUnknown ? 'custo indisponível' : fmtCost(currentCodexCost);
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            'Métricas do Codex cobrem apenas a sessão raiz; subagentes não inclusos; custo indisponível.',
            `entrada ${fmtTokens(currentCodexInput)} · saída ${fmtTokens(currentCodexOutput)}`,
            `raciocínio ${fmtTokens(currentCodexReasoning)}`,
            `gravação de cache ${fmtTokens(currentCodexCacheWrite)} · leitura de cache ${fmtTokens(currentCodexCacheRead)}`,
          ].join('\n'),
        },
        `Codex ${currentCodexIncomplete ? 'parcial' : 'mesas atuais'} ${amount} · ${fmtTokens(currentCodexTokens)} tokens`,
      ),
    );
  }
  if (codexWaiting) rows.push(h('div.row.muted', { title: 'Uso do Codex aparece após o primeiro relatório da sessão raiz.' }, 'Métricas do Codex aguardando primeiro relatório'));
  if (currentDshReports > 0) {
    const context = currentDshContext > 0 ? ` / ${fmtTokens(currentDshContext)}` : '';
    const spend = currentDshCostKnown ? `${fmtCost(currentDshCost)} · ` : '';
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            'DeepSeek Harness reporta o contexto via ACP após uma rodada; custo aparece apenas se o harness fornecer.',
            `${currentDshReports} trabalhador${currentDshReports === 1 ? '' : 'es'} · ${fmtTokens(currentDshTokens)}${context} tokens de contexto`,
          ].join('\n'),
        },
        `DeepSeek Harness mesas atuais ${spend}${fmtTokens(currentDshTokens)}${context} contexto`,
      ),
    );
  }
  if (dshWaiting) rows.push(h('div.row.muted', { title: 'Uso do DeepSeek Harness aparece após a primeira atualização via ACP.' }, 'Métricas do DeepSeek Harness aguardando primeiro relatório'));
  if (untracked) {
    rows.push(h('div.row.muted', { title: 'Uso de provedor customizado não é rastreado pelo escritório.' }, 'Uso customizado não rastreado · orçamento e totais cobrem apenas Claude Code'));
  }
  el.replaceChildren(...rows);
}
