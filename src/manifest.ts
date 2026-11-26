/**
 * Manifesto de release.
 *
 * Estrutura validada pelo JSON Schema versionado em `schemas/release.schema.json`;
 * as regras cruzadas (estado, base, aprovação, identidade de artefato e tempo)
 * ficam aqui, sem rede, Docker, Registry ou host.
 */

import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { parse as parseYaml } from 'yaml';

import { parseVersion, VersionError } from './version.js';

export const RELEASE_AUDIENCES = ['customer', 'partner', 'sejahome', 'platform-only'] as const;
export type ReleaseAudience = (typeof RELEASE_AUDIENCES)[number];

export const MANIFEST_STATES = ['draft', 'rc', 'candidate', 'stable'] as const;
export type ManifestState = (typeof MANIFEST_STATES)[number];

export const ROLLBACK_MODES = ['image-compatible', 'restore-required'] as const;
export type RollbackMode = (typeof ROLLBACK_MODES)[number];

export type ManifestArtifact = {
  readonly name: string;
  readonly image: string;
  readonly digest: string;
  /** Nome relativo no bundle local, usado só por `artifact verify`. */
  readonly file?: string;
};

export type ReleaseManifest = {
  readonly schema: 1;
  readonly product: string;
  readonly version: string;
  readonly state: ManifestState;
  readonly basedOn: string;
  readonly publishedAt: string;
  readonly builtAt: string;
  readonly commit: string;
  readonly artifacts: readonly ManifestArtifact[];
  readonly compatibility: Readonly<Record<string, unknown>>;
  readonly migrations: { readonly required: boolean; readonly summary: string };
  readonly rollback: { readonly mode: RollbackMode; readonly summary: string };
  readonly knownIssues: readonly string[];
  readonly audiences: readonly ReleaseAudience[];
  readonly actionRequired: boolean;
  readonly publicLinks: readonly { readonly label: string; readonly url: string }[];
  readonly approval: {
    readonly status: 'pending' | 'approved';
    readonly approvedBy: string;
    readonly approvedAt: string;
  };
};

export type ManifestValidationOptions = {
  /** Manifesto da RC aprovada; obrigatório para validar `candidate`. */
  readonly approvedRc?: unknown;
  /** Rótulo usado nas mensagens de erro (nome do arquivo, por exemplo). */
  readonly label?: string;
};

export class ManifestValidationError extends Error {
  override readonly name = 'ManifestValidationError';
  readonly issues: readonly string[];

  constructor(label: string, issues: readonly string[]) {
    super(`${label}: manifesto inválido\n- ${issues.join('\n- ')}`);
    this.issues = issues;
  }
}

export class ArtifactVerificationError extends Error {
  override readonly name = 'ArtifactVerificationError';
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

const schemaRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../schemas');
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateReleaseSchema: ValidateFunction = ajv.compile(
  loadSchema('release.schema.json'),
);

function loadSchema(name: string): object {
  const path = resolve(schemaRoot, name);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Schema não encontrado: ${path}`);
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Schema inválido: ${path}`);
  }
  return parsed;
}

export function validateManifest(
  raw: unknown,
  options: ManifestValidationOptions = {},
): ReleaseManifest {
  const label = options.label ?? 'manifesto';
  if (!validateReleaseSchema(raw)) {
    throw new ManifestValidationError(label, formatAjvErrors(validateReleaseSchema.errors ?? []));
  }
  const manifest = raw as ReleaseManifest;
  const issues: string[] = [];

  let parsedVersion: ReturnType<typeof parseVersion> | null = null;
  try {
    parsedVersion = parseVersion(manifest.version);
  } catch (error) {
    issues.push(error instanceof VersionError ? error.message : String(error));
  }

  if (parsedVersion !== null) {
    if (manifest.state === 'rc' && parsedVersion.rc === null) {
      issues.push('state=rc exige versão com sufixo de RC');
    }
    if ((manifest.state === 'candidate' || manifest.state === 'stable') && parsedVersion.rc !== null) {
      issues.push(`state=${manifest.state} exige versão final, sem RC`);
    }
  }

  if (!COMMIT_PATTERN.test(manifest.commit)) {
    issues.push('commit deve ser SHA completo de 40 hex minúsculos');
  }

  const artifactNames = new Set<string>();
  for (const [index, artifact] of manifest.artifacts.entries()) {
    if (artifactNames.has(artifact.name)) {
      issues.push(`artifacts[${index}].name duplicado: ${artifact.name}`);
    }
    artifactNames.add(artifact.name);
    if (!DIGEST_PATTERN.test(artifact.digest)) {
      issues.push(`artifacts[${index}].digest inválido; use sha256: com 64 hex`);
    }
    if (artifact.file !== undefined) {
      const file = normalize(artifact.file);
      if (isAbsolute(artifact.file) || file === '..' || file.startsWith(`..${sep}`)) {
        issues.push(`artifacts[${index}].file deve ser caminho relativo dentro do bundle`);
      }
    }
  }

  for (const field of ['publishedAt', 'builtAt'] as const) {
    if (!isUtcTimestamp(manifest[field])) {
      issues.push(`${field} deve ser timestamp UTC no formato YYYY-MM-DDTHH:MM:SSZ`);
    }
  }

  if (manifest.state !== 'draft') {
    if (!manifest.basedOn) {
      issues.push(`state=${manifest.state} exige basedOn`);
    }
    if (
      manifest.approval.status !== 'approved' ||
      !manifest.approval.approvedBy.trim()
    ) {
      issues.push(`state=${manifest.state} exige aprovação humana registrada`);
    }
    if (!isUtcTimestamp(manifest.approval.approvedAt)) {
      issues.push('approval.approvedAt deve ser timestamp UTC quando aprovado');
    }
  } else if (manifest.approval.status === 'approved' && !isUtcTimestamp(manifest.approval.approvedAt)) {
    issues.push('approval.approvedAt deve ser timestamp UTC quando aprovado');
  }

  if (manifest.basedOn) {
    try {
      parseVersion(manifest.basedOn);
    } catch (error) {
      issues.push(
        `basedOn inválido: ${error instanceof VersionError ? error.message : String(error)}`,
      );
    }
  }

  if (manifest.state === 'candidate') {
    validateCandidate(manifest, parsedVersion, options.approvedRc, issues);
  }

  if (issues.length > 0) {
    throw new ManifestValidationError(label, issues);
  }
  return manifest;
}

function validateCandidate(
  manifest: ReleaseManifest,
  parsedVersion: ReturnType<typeof parseVersion> | null,
  approvedRaw: unknown,
  issues: string[],
): void {
  if (approvedRaw === undefined) {
    issues.push('candidate exige o manifesto da RC aprovada (--based-on)');
    return;
  }
  let approved: ReleaseManifest;
  try {
    approved = validateManifest(approvedRaw, { label: 'RC aprovada' });
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    return;
  }
  if (approved.state !== 'rc') {
    issues.push(`candidate exige RC aprovada; basedOn aponta para state=${approved.state}`);
  }
  if (parsedVersion !== null) {
    let based: ReturnType<typeof parseVersion>;
    try {
      based = parseVersion(manifest.basedOn);
    } catch {
      return;
    }
    if (
      based.rc === null ||
      based.year !== parsedVersion.year ||
      based.month !== parsedVersion.month ||
      based.sequence !== parsedVersion.sequence
    ) {
      issues.push('candidate exige basedOn de uma RC da mesma linha de versão');
    }
    const approvedVersion = parseVersion(approved.version);
    if (
      based.year !== approvedVersion.year ||
      based.month !== approvedVersion.month ||
      based.sequence !== approvedVersion.sequence ||
      based.rc !== approvedVersion.rc
    ) {
      issues.push('candidate exige basedOn igual à versão da RC aprovada');
    }
  }
  const candidateArtifacts = new Map(manifest.artifacts.map((artifact) => [artifact.name, artifact]));
  const approvedArtifacts = new Map(approved.artifacts.map((artifact) => [artifact.name, artifact]));
  if (candidateArtifacts.size !== approvedArtifacts.size) {
    issues.push('candidate deve manter exatamente os artefatos da RC aprovada');
  }
  for (const [name, approvedArtifact] of approvedArtifacts) {
    const candidateArtifact = candidateArtifacts.get(name);
    if (candidateArtifact === undefined) {
      issues.push(`candidate removeu o artefato ${name} da RC aprovada`);
      continue;
    }
    if (candidateArtifact.digest !== approvedArtifact.digest) {
      issues.push(
        `candidate divergiu o digest de ${name}: ${candidateArtifact.digest} != ${approvedArtifact.digest}`,
      );
    }
  }
}

export function loadManifestFile(
  path: string,
  options: ManifestValidationOptions = {},
): ReleaseManifest {
  const raw: unknown = parseYaml(readFileSync(path, 'utf8'));
  return validateManifest(raw, { ...options, label: options.label ?? path });
}

function isUtcTimestamp(value: string): boolean {
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

function formatAjvErrors(errors: readonly ErrorObject[]): string[] {
  if (errors.length === 0) return ['estrutura inválida'];
  return errors.map((error) => `${error.instancePath || '/'} ${error.message ?? 'inválido'}`);
}

export type ArtifactCheck = {
  readonly name: string;
  readonly file: string;
  readonly digest: string;
};

export type ArtifactVerification = {
  readonly checked: readonly ArtifactCheck[];
  readonly skipped: readonly string[];
};

/**
 * Confere o manifesto e, opcionalmente, o sha256 dos arquivos presentes em um
 * diretório local de bundle. Nunca consulta Registry, Docker ou rede.
 */
export function verifyArtifacts(
  manifest: ReleaseManifest,
  bundleDir?: string,
): ArtifactVerification {
  if (bundleDir === undefined) {
    return {
      checked: [],
      skipped: manifest.artifacts.map((artifact) => artifact.name),
    };
  }
  let isDirectory: boolean;
  try {
    isDirectory = statSync(bundleDir).isDirectory();
  } catch {
    throw new ArtifactVerificationError(`Bundle não encontrado: ${bundleDir}`);
  }
  if (!isDirectory) {
    throw new ArtifactVerificationError(`Bundle não é diretório: ${bundleDir}`);
  }
  const root = resolve(bundleDir);
  const checked: ArtifactCheck[] = [];
  const skipped: string[] = [];
  for (const artifact of manifest.artifacts) {
    if (artifact.file === undefined) {
      skipped.push(artifact.name);
      continue;
    }
    const filePath = resolve(root, artifact.file);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      throw new ArtifactVerificationError(
        `artefato ${artifact.name}: file escapa do bundle: ${artifact.file}`,
      );
    }
    if (!existsSync(filePath)) {
      throw new ArtifactVerificationError(
        `artefato ${artifact.name}: arquivo ausente no bundle: ${artifact.file}`,
      );
    }
    const actual = sha256File(filePath);
    if (actual !== artifact.digest) {
      throw new ArtifactVerificationError(
        `artefato ${artifact.name}: digest divergente (${artifact.file}): ${actual} != ${artifact.digest}`,
      );
    }
    checked.push({ name: artifact.name, file: artifact.file, digest: actual });
  }
  if (checked.length === 0) {
    throw new ArtifactVerificationError(
      'Nenhum artefato declara file para conferir no bundle',
    );
  }
  return { checked, skipped };
}

function sha256File(path: string): string {
  const hash = createHash('sha256');
  const file = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let read = readSync(file, buffer, 0, buffer.length, null);
    while (read > 0) {
      hash.update(buffer.subarray(0, read));
      read = readSync(file, buffer, 0, buffer.length, null);
    }
  } finally {
    closeSync(file);
  }
  return `sha256:${hash.digest('hex')}`;
}
