// A worker's record as the manager keeps it (see Worker in types.ts): what a new one is called, its
// colour, and the record itself, fresh from hiring or from workers.json.
import { randomBytes } from 'node:crypto';
import type { WorkerInfo } from '../../shared/protocol.js';
import { providerAdapter } from '../providers/index.js';
import type { UsageTracker } from '../usage.js';
import type { Worker } from './types.js';

export const NAMES = [
  'Lucas', 'Gabriel', 'Felipe', 'Bruno', 'Carlos', 'Rafael', 'Mateus', 'Thiago', 'Leonardo', 'Diego',
  'André', 'Daniel', 'Eduardo', 'Marcelo', 'Alex', 'Marcos', 'Caio', 'Victor', 'Otávio', 'Rodrigo',
  'Mariana', 'Juliana', 'Camila', 'Larissa', 'Beatriz', 'Fernanda', 'Amanda', 'Letícia', 'Natália', 'Vanessa',
  'Bruna', 'Jéssica', 'Carolina', 'Débora', 'Renata', 'Gustavo', 'Igor', 'Henrique', 'Samuel', 'Arthur',
  'Bernardo', 'Vinícius', 'Renan', 'Murilo', 'Danilo', 'Priscila', 'Sabrina', 'Tatiana', 'Aline', 'Bianca',
  'Clarissa', 'Daniela', 'Evelyn', 'Helena', 'Isabela', 'Joana', 'Luana', 'Melissa', 'Nicole', 'Patrícia',
  'Raquel', 'Sofia', 'Talita', 'Vitória', 'Yasmin', 'Fábio', 'Cristiano', 'Cláudio', 'Sérgio', 'Ricardo',
  'Leandro', 'Fabrício', 'Márcio', 'Rogério', 'Guilherme', 'César', 'Wesley', 'Júlio', 'Wagner', 'Danilo',
];
export const COLORS = ['#ff8a5b', '#5bc0eb', '#9bc53d', '#fde74c', '#c3423f', '#b388eb', '#f7aef8', '#72ddf7', '#ffb400', '#00a6a6'];

export function newWorker(info: WorkerInfo, tracker: UsageTracker, hookToken = randomBytes(16).toString('hex')): Worker {
  return {
    info,
    viewers: new Map(),
    screenDirty: true,
    lastLines: [],
    leftNeedsInputAt: 0,
    keyframeAt: 0,
    hookToken,
    state: providerAdapter(info.provider)?.createState?.(),
    failStreak: 0,
    prompts: [],
    tools: [],
    toolsSinceNamed: 0,
    namedAt: 0,
    taskEpoch: 0,
    tracker,
  };
}
