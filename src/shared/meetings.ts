// The meeting room's patterns: how 2–5 workers at the table work on one question or task together.
// The server runs them (server/meetings.ts); the client offers them when a meeting is called.

import { fmtCost, fmtTokens, type Meeting, type MeetingPattern, type MeetingRecord } from './protocol.js';

export interface PatternDef {
  icon: string;
  label: string;
  /** What happens, in a line. */
  blurb: string;
  /** A role per chair, the head of the table first; a meeting takes the first few. */
  roles: readonly string[];
  /** How many workers sit down: the fewest, the most, and how many by default. */
  seats: { min: number; max: number; default: number };
  /** The round limit: the fewest, the most, and the default. Fixed when min equals max. */
  rounds: { min: number; max: number; default: number };
  /** What a round is, for the dialog, when the limit is a range to pick from. */
  roundsNote?: string;
  /** The rounds by name, in order, when the pattern always runs the same ones. */
  stages?: readonly string[];
  /** Where the output goes when whoever calls the meeting doesn't say (`slug` is the meeting's title as a file name). */
  output(slug: string, pr?: number): string;
  /** Needs a pull request (the review panel) or a list of parts (map-reduce). */
  needs?: 'pr' | 'parts';
}

export const MEETING_PATTERNS: Record<MeetingPattern, PatternDef> = {
  debate: {
    icon: '🗣️',
    label: 'Debate',
    blurb: 'Cada trabalhador propõe e depois critica os demais; na última rodada o líder da mesa escreve a decisão.',
    roles: ['Presidente', 'Pragmático', 'Cético', 'Simplificador', 'Defensor do usuário'],
    seats: { min: 2, max: 5, default: 3 },
    rounds: { min: 2, max: 4, default: 3 },
    roundsNote: 'Propostas, depois uma rodada de críticas por rodada extra, e então a decisão.',
    output: (slug) => `docs/decisions/${slug}.md`,
  },
  lead: {
    icon: '🧭',
    label: 'Líder e equipe',
    blurb: 'O líder divide a tarefa em partes, a equipe realiza cada uma, e o líder mescla o trabalho e documenta.',
    roles: ['Líder', 'Engenheiro', 'Engenheiro', 'Engenheiro', 'Engenheiro'],
    seats: { min: 2, max: 5, default: 3 },
    rounds: { min: 3, max: 3, default: 3 },
    stages: ['Planejamento', 'Execução', 'Mesclagem'],
    output: (slug) => `docs/meetings/${slug}.md`,
  },
  mapreduce: {
    icon: '🗂️',
    label: 'Map-reduce',
    blurb: 'A mesma tarefa em cada parte (arquivos, módulos, issues) em paralelo; o líder combina os resultados.',
    roles: ['Redutor', 'Mapeador', 'Mapeador', 'Mapeador', 'Mapeador'],
    seats: { min: 2, max: 5, default: 3 },
    rounds: { min: 2, max: 2, default: 2 },
    stages: ['Mapeamento', 'Redução'],
    output: (slug) => `docs/meetings/${slug}.md`,
    needs: 'parts',
  },
  redblue: {
    icon: '🛡️',
    label: 'Red / blue',
    blurb: 'Red ataca as alterações (bugs, segurança), Blue corrige o que for apontado, rodada a rodada; Blue documenta tudo.',
    roles: ['Equipe Azul', 'Equipe Vermelha'],
    seats: { min: 2, max: 2, default: 2 },
    rounds: { min: 1, max: 5, default: 3 },
    roundsNote: 'Um ataque e uma correção por rodada; termina antes se a Red não encontrar mais problemas.',
    output: (slug) => `docs/reviews/${slug}.md`,
  },
  review: {
    icon: '🔍',
    label: 'Painel de revisão',
    blurb: 'Revisores avaliam um pull request sob sua própria ótica; o líder mescla tudo em uma única revisão, postada no PR.',
    roles: ['Corretude', 'Segurança', 'Desempenho e simplicidade', 'Testes', 'Design de API'],
    seats: { min: 2, max: 5, default: 3 },
    rounds: { min: 2, max: 2, default: 2 },
    stages: ['Revisões', 'Revisão consolidada'],
    output: (_slug, pr) => `reviews/pr-${pr ?? 'n'}.md`,
    needs: 'pr',
  },
};

export const MEETING_PATTERN_IDS = Object.keys(MEETING_PATTERNS) as MeetingPattern[];

export function isMeetingPattern(v: unknown): v is MeetingPattern {
  // Own keys only: `in` would also take the prototype's (constructor, toString…), and those crash the server.
  return typeof v === 'string' && Object.hasOwn(MEETING_PATTERNS, v);
}

/**
 * The round notes' folder at the top of a meeting's worktree. It's left out of the meeting's commit and
 * cleared away with the room (a copy stays in the floor's .agent-office/meetings/). Not under
 * .agent-office/: Claude Code asks before writing there in a worktree nested in the project.
 */
export const MEETING_NOTES_DIR = '.meeting';

/** A title as a file or branch name: "Pick a cache!" → "pick-a-cache". */
export function slugify(s: string, max = 40): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'meeting'
  );
}

/**
 * Why an output path can't be used, or undefined when it's fine: a file inside the checkout, not in
 * the office's own folder or git's.
 */
export function outputProblem(p: string): string | undefined {
  if (!p.trim()) return 'Informe qual arquivo a reunião deve escrever';
  if (p.length > 200) return 'O caminho do arquivo de saída é muito longo';
  if (/^[/\\]|^[a-zA-Z]:/.test(p)) return 'O arquivo de saída fica dentro do projeto: informe um caminho relativo a ele';
  const parts = p.split(/[/\\]/);
  if (parts.some((x) => x === '..' || x === '.' || x === '')) return 'O caminho de saída não pode conter partes vazias, . ou ..';
  if (parts[0] === '.git' || parts[0] === '.agent-office' || parts[0] === MEETING_NOTES_DIR) return `A saída não pode ficar em ${parts[0]}/`;
  if (/[\0-\x1f]/.test(p)) return 'O caminho de saída possui caracteres de controle';
  return undefined;
}

/** "3 rounds" / "round 2 of 3". */
const rounds = (n: number) => `${n} rodada${n === 1 ? '' : 's'}`;

/**
 * For a pattern that always runs the same rounds, what the dialog shows in place of a limit to set:
 * the line ("3 rounds · fixed by the Lead & team workflow"), its rounds by name, and why, for the
 * tooltip. Undefined when the limit is a range to pick from.
 */
export function fixedRounds(p: PatternDef): { line: string; stages: string; why: string } | undefined {
  if (p.rounds.min !== p.rounds.max) return undefined;
  const n = rounds(p.rounds.max);
  const stages = (p.stages ?? []).join(' → ');
  return { line: `${n} · fixado pelo fluxo ${p.label}`, stages, why: `${p.label} sempre executa ${n}${stages ? `: ${stages}` : ''}. Cada uma é uma etapa do padrão, então não há como adicionar ou remover.` };
}

/** The spend, e.g. "1.2M tokens · $2.40" (or without the cost when a provider doesn't report it). */
export function meetingSpend(m: Pick<Meeting, 'tokens' | 'cost' | 'costKnown'>): string {
  return `${fmtTokens(m.tokens)} tokens${m.costKnown ? ` · ${fmtCost(m.cost)}` : m.cost > 0 ? ` · ${fmtCost(m.cost)}+` : ''}`;
}

/** What's on the table in a line: "Round 2 of 3 · critiquing". */
export function meetingStage(m: Meeting): string {
  const doing = [...new Set(m.turns.filter((t) => t.state !== 'done').map((t) => t.doing))].join(', ');
  return `Rodada ${m.round} de ${m.rounds}${doing ? ` · ${doing}` : ''}`;
}

/**
 * The line on the room's door once a meeting is over: pattern, rounds, tokens, cost, and the output
 * file it wrote (and where), or why it stopped.
 */
export function meetingSummary(m: Meeting): string {
  const p = MEETING_PATTERNS[m.pattern];
  const ran = m.status === 'done' ? rounds(m.round) : `${m.status === 'stopped' ? 'in ' : ''}round ${m.round} of ${m.rounds}`;
  const head = `${p.icon} ${p.label} · ${ran} · ${meetingSpend(m)}`;
  if (m.status === 'stopped') return `${head} · ⛔ ${m.reason ?? 'stopped'}`;
  if (m.status === 'running') return head;
  const where = m.review?.url ? ' · posted on the PR' : m.review?.error ? ` · couldn't post it: ${m.review.error}` : m.commit ? ` on ${m.worktree?.branch}` : m.worktree ? ` in ${m.worktree.branch}'s worktree` : '';
  return `${head} · ✅ ${m.output}${where}`;
}

export function meetingRecord(m: Meeting): MeetingRecord {
  return { id: m.id, pattern: m.pattern, title: m.title, status: m.status, summary: meetingSummary(m), calledBy: m.calledBy, finishedAt: m.finishedAt ?? Date.now(), branch: m.worktree?.branch, output: m.output };
}
