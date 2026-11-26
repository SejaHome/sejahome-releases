/**
 * Contrato de versão da SejaHome.
 *
 * Formatos aceitos:
 * - legado: `2026.11.01~rc1`
 * - novo:   `2026.11.01-rc.1`
 * - final:  `2026.11.01`
 *
 * `NN` é a sequência dentro do mês, nunca o dia. RC começa em 1. O final
 * ordena depois de todas as RCs da mesma linha. Legado e novo são a mesma
 * versão para comparação.
 */

export type VersionFormat = 'legacy' | 'modern' | 'final';

export type ReleaseVersion = {
  readonly year: number;
  readonly month: number;
  readonly sequence: number;
  readonly rc: number | null;
  readonly format: VersionFormat;
};

const VERSION_PATTERN =
  /^(\d{4})\.(\d{2})\.(\d{2})(?:(?:~rc([1-9]\d*))|(?:-rc\.([1-9]\d*)))?$/;

export class VersionError extends Error {
  override readonly name = 'VersionError';
}

export function parseVersion(value: string): ReleaseVersion {
  const match = VERSION_PATTERN.exec(value);
  if (!match) {
    throw new VersionError(`Versão inválida: ${value}`);
  }
  const [, yearRaw, monthRaw, sequenceRaw, legacyRc, modernRc] = match;
  if (yearRaw === undefined || monthRaw === undefined || sequenceRaw === undefined) {
    throw new VersionError(`Versão inválida: ${value}`);
  }
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const sequence = Number(sequenceRaw);
  if (month < 1 || month > 12) {
    throw new VersionError(`Versão inválida: ${value} (mês fora de 01..12)`);
  }
  if (sequence < 1) {
    throw new VersionError(`Versão inválida: ${value} (sequência começa em 01)`);
  }
  const rcRaw = legacyRc ?? modernRc;
  const rc = rcRaw === undefined ? null : Number(rcRaw);
  const format: VersionFormat = rc === null ? 'final' : legacyRc !== undefined ? 'legacy' : 'modern';
  return { year, month, sequence, rc, format };
}

export function isReleaseVersion(value: string): boolean {
  try {
    parseVersion(value);
    return true;
  } catch {
    return false;
  }
}

export function formatVersion(version: ReleaseVersion, format: VersionFormat = 'legacy'): string {
  const base = `${version.year}.${String(version.month).padStart(2, '0')}.${String(version.sequence).padStart(2, '0')}`;
  if (version.rc === null) {
    return base;
  }
  if (format === 'legacy') {
    return `${base}~rc${version.rc}`;
  }
  if (format === 'modern') {
    return `${base}-rc.${version.rc}`;
  }
  throw new VersionError(`Versão com RC não tem formato final: ${base}~rc${version.rc}`);
}

export function formatLegacy(version: ReleaseVersion): string {
  return formatVersion(version, 'legacy');
}

/**
 * Ordena versões. Retorna negativo se `a` vem antes de `b`.
 * Final da linha vem depois de todas as RCs da mesma linha.
 */
export function compareVersions(a: string | ReleaseVersion, b: string | ReleaseVersion): number {
  const left = typeof a === 'string' ? parseVersion(a) : a;
  const right = typeof b === 'string' ? parseVersion(b) : b;
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  if (left.rc === right.rc) return 0;
  if (left.rc === null) return 1;
  if (right.rc === null) return -1;
  return left.rc - right.rc;
}

/**
 * Tag OCI: o legado troca somente `~` por `-`; novo e final permanecem iguais.
 * Valida a versão antes de converter.
 */
export function ociTag(value: string): string {
  parseVersion(value);
  return value.replace('~', '-');
}

export type NextVersionInput = {
  /** Última versão conhecida. Ausente significa começar a linha do mês. */
  latest?: string;
  /** Data de referência (`YYYY-MM-DD`) ou `Date`; usa ano e mês. */
  date: string | Date;
};

/**
 * Próxima RC no formato legado, que é o usado hoje.
 *
 * - última `2026.11.03` + novembro/2026 -> `2026.11.04~rc1`
 * - última `2026.11.04~rc1` + novembro/2026 -> `2026.11.04~rc2`
 * - última `2026.11.04~rc2` + dezembro/2026 -> `2026.12.01~rc1`
 */
export function nextVersion(input: NextVersionInput): string {
  const reference = parseReferenceDate(input.date);
  const latest = input.latest === undefined ? null : parseVersion(input.latest);
  const referenceLine = reference.year * 12 + reference.month;

  if (latest === null) {
    return `${reference.year}.${String(reference.month).padStart(2, '0')}.01~rc1`;
  }
  const latestLine = latest.year * 12 + latest.month;
  if (referenceLine > latestLine) {
    return `${reference.year}.${String(reference.month).padStart(2, '0')}.01~rc1`;
  }
  if (referenceLine < latestLine) {
    throw new VersionError(
      `Data de referência ${reference.year}-${String(reference.month).padStart(2, '0')} é anterior à última versão ${formatLegacy(latest)}`,
    );
  }
  if (latest.rc !== null) {
    return formatVersion(
      { ...latest, rc: latest.rc + 1, format: 'legacy' },
      'legacy',
    );
  }
  const nextSequence = latest.sequence + 1;
  if (nextSequence > 99) {
    throw new VersionError(`Sequência mensal esgotada para ${reference.year}.${String(reference.month).padStart(2, '0')}`);
  }
  return `${latest.year}.${String(latest.month).padStart(2, '0')}.${String(nextSequence).padStart(2, '0')}~rc1`;
}

function parseReferenceDate(value: string | Date): { year: number; month: number } {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new VersionError('Data de referência inválida');
    return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1 };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new VersionError(`Data de referência inválida: ${value} (use YYYY-MM-DD)`);
  const [, yearRaw, monthRaw, dayRaw] = match;
  if (yearRaw === undefined || monthRaw === undefined || dayRaw === undefined) {
    throw new VersionError(`Data de referência inválida: ${value}`);
  }
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new VersionError(`Data de referência inválida: ${value}`);
  }
  return { year, month };
}
