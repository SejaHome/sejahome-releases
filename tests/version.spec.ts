import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  VersionError,
  compareVersions,
  formatVersion,
  nextVersion,
  ociTag,
  parseVersion,
} from '../src/version.js';

test('aceita versão legada, nova e final', () => {
  assert.deepEqual(parseVersion('2026.11.01~rc1'), {
    year: 2026,
    month: 11,
    sequence: 1,
    rc: 1,
    format: 'legacy',
  });
  assert.deepEqual(parseVersion('2026.11.01-rc.1'), {
    year: 2026,
    month: 11,
    sequence: 1,
    rc: 1,
    format: 'modern',
  });
  assert.deepEqual(parseVersion('2026.11.01'), {
    year: 2026,
    month: 11,
    sequence: 1,
    rc: null,
    format: 'final',
  });
});

test('legado e novo são equivalentes na comparação', () => {
  assert.equal(compareVersions('2026.11.01~rc1', '2026.11.01-rc.1'), 0);
  assert.equal(compareVersions('2026.11.01-rc.2', '2026.11.01~rc2'), 0);
});

test('ordena RC, final e linhas diferentes', () => {
  assert.ok(compareVersions('2026.11.01~rc1', '2026.11.01~rc2') < 0);
  assert.ok(compareVersions('2026.11.01~rc2', '2026.11.01') < 0);
  assert.ok(compareVersions('2026.11.01', '2026.11.02~rc1') < 0);
  assert.ok(compareVersions('2026.11.30~rc9', '2026.12.01~rc1') < 0);
  assert.ok(compareVersions('2026.12.01~rc1', '2027.01.01~rc1') < 0);
});

test('rejeita versão inválida sem aproximação', () => {
  const invalid = [
    '2026.13.01',
    '2026.00.01',
    '2026.11.00',
    '2026.11.01~rc0',
    '2026.11.01~rc01',
    '2026.11.01-rc1',
    '2026.11.01-rc.0',
    '2026.11.01-rc.01',
    '2026.1.01',
    '2026.11.1',
    '2026.11.01~RC1',
    'v2026.11.01',
    '2026.11',
    '',
  ];
  for (const value of invalid) {
    assert.throws(() => parseVersion(value), VersionError, value);
  }
});

test('formata e converte tag OCI', () => {
  const rc = parseVersion('2026.11.01~rc1');
  assert.equal(formatVersion(rc, 'legacy'), '2026.11.01~rc1');
  assert.equal(formatVersion(rc, 'modern'), '2026.11.01-rc.1');
  assert.throws(() => formatVersion(rc, 'final'), VersionError);

  assert.equal(ociTag('2026.11.01~rc1'), '2026.11.01-rc1');
  assert.equal(ociTag('2026.11.01-rc.1'), '2026.11.01-rc.1');
  assert.equal(ociTag('2026.11.01'), '2026.11.01');
  assert.throws(() => ociTag('2026.11.01~rc0'), VersionError);
});

test('próxima RC segue os exemplos do contrato', () => {
  assert.equal(
    nextVersion({ latest: '2026.11.03', date: '2026-11-25' }),
    '2026.11.04~rc1',
  );
  assert.equal(
    nextVersion({ latest: '2026.11.04~rc1', date: '2026-11-25' }),
    '2026.11.04~rc2',
  );
  assert.equal(
    nextVersion({ latest: '2026.11.04~rc2', date: '2026-12-15' }),
    '2026.12.01~rc1',
  );
  assert.equal(
    nextVersion({ latest: '2026.11.04-rc.2', date: '2026-11-30' }),
    '2026.11.04~rc3',
  );
  assert.throws(
    () => nextVersion({ latest: '2026.12.01~rc1', date: '2026-11-30' }),
    VersionError,
  );
});

test('próxima RC começa a linha quando não há última versão', () => {
  assert.equal(nextVersion({ date: '2026-11-25' }), '2026.11.01~rc1');
});

test('próxima RC rejeita data de referência inválida', () => {
  assert.throws(
    () => nextVersion({ latest: '2026.11.03', date: '2026-02-30' }),
    VersionError,
  );
  assert.throws(
    () => nextVersion({ latest: '2026.11.03', date: '25/11/2026' }),
    VersionError,
  );
});
