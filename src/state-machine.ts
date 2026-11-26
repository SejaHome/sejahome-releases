/**
 * Máquina de estados de publicação.
 *
 * Persistência é arquivo versionado (`YAML`/`JSON`); este módulo não escreve
 * banco nem executa efeito externo.
 */

import { compareVersions, parseVersion, VersionError } from './version.js';

export const RELEASE_STATES = [
  'DRAFT',
  'APPROVED_FOR_BUILD',
  'BUILT',
  'PUBLISHED_RC',
  'QA_PREPARED',
  'QA_DEPLOYED',
  'QA_APPROVED',
  'CANDIDATE',
  'PRODUCTION_PREPARED',
  'PRODUCTION_DEPLOYED',
  'PRODUCTION_APPROVED',
] as const;

export type ReleaseState = (typeof RELEASE_STATES)[number];

export type StateArtifact = {
  readonly name: string;
  readonly digest: string;
};

/** Identidade que não pode mudar entre transições. */
export type StateRecord = {
  readonly state: ReleaseState;
  readonly product: string;
  readonly version: string;
  readonly commit: string;
  readonly artifacts: readonly StateArtifact[];
};

export type TransitionInput = {
  readonly from: StateRecord;
  readonly to: StateRecord;
};

export class StateTransitionError extends Error {
  override readonly name = 'StateTransitionError';
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function isReleaseState(value: string): value is ReleaseState {
  return (RELEASE_STATES as readonly string[]).includes(value);
}

export function nextStates(state: ReleaseState): readonly ReleaseState[] {
  const index = RELEASE_STATES.indexOf(state);
  const next = RELEASE_STATES[index + 1];
  return next === undefined ? [] : [next];
}

/** Próximo estado único do fluxo, ou `null` no estado terminal. */
export function nextState(state: ReleaseState): ReleaseState | null {
  return nextStates(state)[0] ?? null;
}

export function canTransition(from: ReleaseState, to: ReleaseState): boolean {
  const fromIndex = RELEASE_STATES.indexOf(from);
  const toIndex = RELEASE_STATES.indexOf(to);
  return fromIndex >= 0 && toIndex === fromIndex + 1;
}

/**
 * Valida uma transição. Rejeita salto, regressão, estado desconhecido e
 * mudança de identidade (produto, versão, commit ou digest).
 */
export function validateTransition(input: TransitionInput): void {
  const { from, to } = input;
  if (!isReleaseState(from.state)) {
    throw new StateTransitionError(`Estado de origem desconhecido: ${String(from.state)}`);
  }
  if (!isReleaseState(to.state)) {
    throw new StateTransitionError(`Estado de destino desconhecido: ${String(to.state)}`);
  }
  const fromIndex = RELEASE_STATES.indexOf(from.state);
  const toIndex = RELEASE_STATES.indexOf(to.state);
  if (toIndex > fromIndex + 1) {
    throw new StateTransitionError(`Salto de estado não permitido: ${from.state} -> ${to.state}`);
  }
  if (toIndex <= fromIndex) {
    throw new StateTransitionError(`Regressão de estado não permitida: ${from.state} -> ${to.state}`);
  }
  assertIdentity(from, to);
}

export function assertIdentity(from: StateRecord, to: StateRecord): void {
  if (from.product !== to.product) {
    throw new StateTransitionError(`Produto mudou: ${from.product} -> ${to.product}`);
  }
  let sameVersion: boolean;
  try {
    sameVersion = compareVersions(from.version, to.version) === 0;
  } catch (error) {
    if (error instanceof VersionError) {
      throw new StateTransitionError(error.message);
    }
    throw error;
  }
  if (!sameVersion) {
    throw new StateTransitionError(`Versão mudou: ${from.version} -> ${to.version}`);
  }
  if (from.commit !== to.commit) {
    throw new StateTransitionError(`Commit mudou: ${from.commit} -> ${to.commit}`);
  }
  const fromDigests = digestMap(from);
  const toDigests = digestMap(to);
  const names = new Set([...fromDigests.keys(), ...toDigests.keys()]);
  for (const name of names) {
    if (fromDigests.get(name) !== toDigests.get(name)) {
      throw new StateTransitionError(
        `Digest do artefato ${name} mudou: ${fromDigests.get(name) ?? '<ausente>'} -> ${toDigests.get(name) ?? '<ausente>'}`,
      );
    }
  }
}

function digestMap(record: StateRecord): Map<string, string> {
  const map = new Map<string, string>();
  for (const artifact of record.artifacts) {
    if (map.has(artifact.name)) {
      throw new StateTransitionError(`Artefato duplicado no registro: ${artifact.name}`);
    }
    map.set(artifact.name, artifact.digest);
  }
  return map;
}

/**
 * Valida o formato de um registro de estado lido de arquivo versionado.
 * Não conhece caminho, host ou banco.
 */
export function parseStateRecord(raw: unknown, label: string): StateRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new StateTransitionError(`${label}: registro de estado inválido`);
  }
  const record = raw as Record<string, unknown>;
  const state = requiredString(record.state, `${label}: state`);
  if (!isReleaseState(state)) {
    throw new StateTransitionError(`${label}: estado desconhecido: ${state}`);
  }
  const product = requiredString(record.product, `${label}: product`);
  const version = requiredString(record.version, `${label}: version`);
  try {
    parseVersion(version);
  } catch (error) {
    if (error instanceof VersionError) throw new StateTransitionError(`${label}: ${error.message}`);
    throw error;
  }
  const commit = requiredString(record.commit, `${label}: commit`);
  if (!COMMIT_PATTERN.test(commit)) {
    throw new StateTransitionError(`${label}: commit deve ser SHA completo de 40 hex`);
  }
  if (!Array.isArray(record.artifacts) || record.artifacts.length === 0) {
    throw new StateTransitionError(`${label}: artifacts deve ser lista não vazia`);
  }
  const artifacts: StateArtifact[] = record.artifacts.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new StateTransitionError(`${label}: artifacts[${index}] inválido`);
    }
    const artifact = entry as Record<string, unknown>;
    const name = requiredString(artifact.name, `${label}: artifacts[${index}].name`);
    const digest = requiredString(artifact.digest, `${label}: artifacts[${index}].digest`);
    if (!DIGEST_PATTERN.test(digest)) {
      throw new StateTransitionError(`${label}: artifacts[${index}].digest inválido`);
    }
    return { name, digest };
  });
  return { state, product, version, commit, artifacts };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StateTransitionError(`${field} obrigatório`);
  }
  return value;
}
