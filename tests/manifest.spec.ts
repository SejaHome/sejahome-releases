import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import {
  ArtifactVerificationError,
  ManifestValidationError,
  loadManifestFile,
  validateManifest,
  verifyArtifacts,
  type ReleaseManifest,
} from '../src/manifest.js';

const RELEASE_FIXTURE = fileURLToPath(
  new URL('../fixtures/release.example.yaml', import.meta.url),
);

type RawManifest = Record<string, unknown>;

function readReleaseFixture(): RawManifest {
  return parseYaml(readFileSync(RELEASE_FIXTURE, 'utf8')) as RawManifest;
}

function cloneManifest(): RawManifest {
  return structuredClone(readReleaseFixture());
}

function rcManifest(): RawManifest {
  const manifest = cloneManifest();
  manifest.state = 'rc';
  manifest.version = '2026.11.04~rc1';
  manifest.basedOn = '2026.11.03';
  manifest.approval = {
    status: 'approved',
    approvedBy: 'revisor-humano',
    approvedAt: '2026-11-25T01:00:00Z',
  };
  return manifest;
}

function candidateFrom(rc: RawManifest): RawManifest {
  const candidate = structuredClone(rc);
  candidate.state = 'candidate';
  candidate.version = '2026.11.04';
  candidate.basedOn = '2026.11.04~rc1';
  return candidate;
}

function firstArtifact(manifest: RawManifest): Record<string, unknown> {
  const artifacts = manifest.artifacts;
  assert.ok(Array.isArray(artifacts));
  const first = artifacts[0];
  assert.ok(first && typeof first === 'object' && !Array.isArray(first));
  return first as Record<string, unknown>;
}

test('manifesto de exemplo valida', () => {
  const manifest = loadManifestFile(RELEASE_FIXTURE);
  assert.equal(manifest.product, 'exemplo');
  assert.equal(manifest.version, '2026.11.04~rc1');
  assert.equal(manifest.state, 'draft');
  assert.equal(manifest.artifacts[0]?.digest.length, 71);
});

test('candidate reutiliza exatamente os digests da RC aprovada', () => {
  const rc = rcManifest();
  const candidate = candidateFrom(rc);
  const manifest = validateManifest(candidate, { approvedRc: rc });
  assert.equal(manifest.state, 'candidate');
  assert.equal(manifest.version, '2026.11.04');
});

test('candidate com digest divergente falha', () => {
  const rc = rcManifest();
  const candidate = candidateFrom(rc);
  firstArtifact(candidate).digest = `sha256:${'a'.repeat(64)}`;
  assert.throws(
    () => validateManifest(candidate, { approvedRc: rc }),
    ManifestValidationError,
  );
});

test('candidate sem RC aprovada falha', () => {
  assert.throws(
    () => validateManifest(candidateFrom(rcManifest())),
    ManifestValidationError,
  );
});

test('candidate com basedOn de outra linha falha', () => {
  const rc = rcManifest();
  const candidate = candidateFrom(rc);
  candidate.basedOn = '2026.11.05~rc1';
  assert.throws(
    () => validateManifest(candidate, { approvedRc: rc }),
    ManifestValidationError,
  );
});

test('rc exige sufixo e final não aceita sufixo', () => {
  const rc = rcManifest();
  const rcWithoutSuffix = structuredClone(rc);
  rcWithoutSuffix.version = '2026.11.04';
  assert.throws(() => validateManifest(rcWithoutSuffix), ManifestValidationError);

  const finalWithRc = structuredClone(rc);
  finalWithRc.state = 'stable';
  finalWithRc.version = '2026.11.04~rc1';
  assert.throws(() => validateManifest(finalWithRc), ManifestValidationError);
});

test('manifesto rejeita campo obrigatório ausente, digest, commit e timestamp inválidos', () => {
  const missingField = cloneManifest();
  delete missingField.commit;
  assert.throws(() => validateManifest(missingField), ManifestValidationError);

  const badDigest = cloneManifest();
  firstArtifact(badDigest).digest = 'sha256:123';
  assert.throws(() => validateManifest(badDigest), ManifestValidationError);

  const shortCommit = cloneManifest();
  shortCommit.commit = '0123456';
  assert.throws(() => validateManifest(shortCommit), ManifestValidationError);

  const offsetTimestamp = cloneManifest();
  offsetTimestamp.publishedAt = '2026-11-25T00:00:00-03:00';
  assert.throws(() => validateManifest(offsetTimestamp), ManifestValidationError);

  const impossibleDate = cloneManifest();
  impossibleDate.builtAt = '2026-02-30T00:00:00Z';
  assert.throws(() => validateManifest(impossibleDate), ManifestValidationError);

  const unknownState = cloneManifest();
  unknownState.state = 'published';
  assert.throws(() => validateManifest(unknownState), ManifestValidationError);

  const missingBasedOn = cloneManifest();
  delete missingBasedOn.basedOn;
  assert.throws(() => validateManifest(missingBasedOn), ManifestValidationError);
});

test('artifact verify sem bundle apenas confere o manifesto', () => {
  const manifest = loadManifestFile(RELEASE_FIXTURE);
  const result = verifyArtifacts(manifest);
  assert.equal(result.checked.length, 0);
  assert.deepEqual(result.skipped, ['app']);
});

test('artifact verify falha quando o bundle não existe', () => {
  const manifest = loadManifestFile(RELEASE_FIXTURE);
  assert.throws(
    () => verifyArtifacts(manifest, '/tmp/bundle-que-nao-existe-t01'),
    ArtifactVerificationError,
  );
});

test('tipo do manifesto é estável', () => {
  const manifest: ReleaseManifest = loadManifestFile(RELEASE_FIXTURE);
  assert.equal(manifest.schema, 1);
});
