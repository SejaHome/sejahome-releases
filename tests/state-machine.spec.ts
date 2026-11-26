import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RELEASE_STATES,
  StateTransitionError,
  canTransition,
  nextState,
  parseStateRecord,
  validateTransition,
  type ReleaseState,
  type StateRecord,
} from '../src/state-machine.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const COMMIT = 'b'.repeat(40);

function record(state: ReleaseState, overrides: Partial<StateRecord> = {}): StateRecord {
  return {
    state,
    product: 'exemplo',
    version: '2026.11.04~rc1',
    commit: COMMIT,
    artifacts: [{ name: 'app', digest: DIGEST }],
    ...overrides,
  };
}

test('aceita a cadeia completa de estados', () => {
  for (let index = 0; index < RELEASE_STATES.length - 1; index += 1) {
    const fromState = RELEASE_STATES[index];
    const toState = RELEASE_STATES[index + 1];
    assert.ok(fromState !== undefined && toState !== undefined);
    validateTransition({ from: record(fromState), to: record(toState) });
  }
  assert.equal(nextState('PRODUCTION_APPROVED'), null);
});

test('rejeita salto de estado', () => {
  assert.equal(canTransition('DRAFT', 'BUILT'), false);
  assert.throws(
    () => validateTransition({ from: record('DRAFT'), to: record('BUILT') }),
    StateTransitionError,
  );
});

test('rejeita regressão de estado', () => {
  assert.throws(
    () => validateTransition({ from: record('BUILT'), to: record('DRAFT') }),
    StateTransitionError,
  );
  assert.throws(
    () => validateTransition({ from: record('BUILT'), to: record('BUILT') }),
    StateTransitionError,
  );
});

test('rejeita estado desconhecido', () => {
  const unknown = record('DRAFT');
  assert.throws(
    () =>
      validateTransition({
        from: { ...unknown, state: 'ARCHIVED' as ReleaseState },
        to: record('APPROVED_FOR_BUILD'),
      }),
    StateTransitionError,
  );
});

test('rejeita mudança de produto, versão, commit e digest', () => {
  const from = record('DRAFT');
  const to = record('APPROVED_FOR_BUILD');

  assert.throws(
    () => validateTransition({ from, to: { ...to, product: 'outro' } }),
    StateTransitionError,
  );
  assert.throws(
    () => validateTransition({ from, to: { ...to, version: '2026.11.04~rc2' } }),
    StateTransitionError,
  );
  assert.throws(
    () => validateTransition({ from, to: { ...to, commit: 'c'.repeat(40) } }),
    StateTransitionError,
  );
  assert.throws(
    () =>
      validateTransition({
        from,
        to: { ...to, artifacts: [{ name: 'app', digest: `sha256:${'d'.repeat(64)}` }] },
      }),
    StateTransitionError,
  );
  assert.throws(
    () => validateTransition({ from, to: { ...to, artifacts: [{ name: 'extra', digest: DIGEST }] } }),
    StateTransitionError,
  );
});

test('legado e novo não mudam a identidade da versão', () => {
  validateTransition({
    from: record('DRAFT', { version: '2026.11.04~rc1' }),
    to: record('APPROVED_FOR_BUILD', { version: '2026.11.04-rc.1' }),
  });
});

test('parseStateRecord valida o arquivo versionado', () => {
  const parsed = parseStateRecord(readReleaseFixture(), 'state.yaml');
  assert.equal(parsed.state, 'DRAFT');
  assert.equal(parsed.artifacts.length, 1);
  assert.throws(
    () => parseStateRecord({ ...readReleaseFixture(), commit: 'abc' }, 'state.yaml'),
    StateTransitionError,
  );
  assert.throws(
    () => parseStateRecord({ ...readReleaseFixture(), state: 'READY' }, 'state.yaml'),
    StateTransitionError,
  );
  assert.throws(
    () => parseStateRecord({ ...readReleaseFixture(), artifacts: [] }, 'state.yaml'),
    StateTransitionError,
  );
});

function readReleaseFixture(): Record<string, unknown> {
  return {
    state: 'DRAFT',
    product: 'exemplo',
    version: '2026.11.04~rc1',
    commit: COMMIT,
    artifacts: [{ name: 'app', digest: DIGEST }],
  };
}
