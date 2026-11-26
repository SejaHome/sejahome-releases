/**
 * Notas de release a partir de fragmentos versionados.
 *
 * Gera cinco arquivos: notas públicas pt-BR, notas públicas en-US, changelog
 * interno, checklist humano e índice público sanitizado. Conteúdo `internal`
 * e detalhe sensível nunca entram na saída pública.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { parse as parseYaml } from 'yaml';

import type { ReleaseAudience } from './manifest.js';

export const FRAGMENT_CATEGORIES = [
  'highlights',
  'new',
  'improvements',
  'fixes',
  'security',
  'breaking',
  'known-issues',
  'internal',
] as const;
export type FragmentCategory = (typeof FRAGMENT_CATEGORIES)[number];

export type LocalizedText = {
  readonly 'pt-BR': string;
  readonly 'en-US': string;
};

export type ReleaseFragment = {
  readonly schema?: 1;
  readonly category: FragmentCategory;
  readonly audiences: readonly ReleaseAudience[];
  readonly title: LocalizedText;
  readonly text: LocalizedText;
  readonly test?: string;
};

export const NOTE_FILES = [
  'pt-BR.md',
  'en-US.md',
  'CHANGELOG.internal.md',
  'CHECKLIST.md',
  'index.public.json',
] as const;
export type NoteFile = (typeof NOTE_FILES)[number];
export type ReleaseNotes = Readonly<Record<NoteFile, string>>;

export type BuildNotesOptions = {
  readonly product?: string;
  readonly version?: string;
  readonly generatedAt?: string;
};

export class FragmentValidationError extends Error {
  override readonly name = 'FragmentValidationError';
}

export class SanitizationError extends Error {
  override readonly name = 'SanitizationError';
}

const schemaRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../schemas');
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateFragmentSchema: ValidateFunction = ajv.compile(
  loadSchema('fragment.schema.json'),
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

export function validateFragment(raw: unknown, label: string): ReleaseFragment {
  if (!validateFragmentSchema(raw)) {
    throw new FragmentValidationError(
      `${label}: fragmento inválido\n- ${formatAjvErrors(validateFragmentSchema.errors ?? []).join('\n- ')}`,
    );
  }
  return raw as ReleaseFragment;
}

export function loadFragments(directory: string): ReleaseFragment[] {
  const entries = readdirSync(directory)
    .filter((entry) => /\.ya?ml$/.test(entry))
    .sort();
  if (entries.length === 0) {
    throw new FragmentValidationError(`Nenhum fragmento .yaml encontrado em ${directory}`);
  }
  return entries.map((entry) => {
    const path = join(directory, entry);
    if (!statSync(path).isFile()) {
      throw new FragmentValidationError(`${path}: não é arquivo`);
    }
    const raw: unknown = parseYaml(readFileSync(path, 'utf8'));
    return validateFragment(raw, path);
  });
}

const CATEGORY_LABELS: Record<FragmentCategory, { readonly pt: string; readonly en: string }> = {
  highlights: { pt: 'Destaques', en: 'Highlights' },
  new: { pt: 'Novidades', en: 'New' },
  improvements: { pt: 'Melhorias', en: 'Improvements' },
  fixes: { pt: 'Correções', en: 'Fixes' },
  security: { pt: 'Segurança', en: 'Security' },
  breaking: { pt: 'Mudanças incompatíveis', en: 'Breaking changes' },
  'known-issues': { pt: 'Problemas conhecidos', en: 'Known issues' },
  internal: { pt: 'Interno', en: 'Internal' },
};

const SANITIZERS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  {
    label: 'segredo',
    pattern:
      /\b(secret|segredo|senha|password|passwd|api[_-]?key|private[ _-]?key|chave privada|chave|token)\b/i,
  },
  {
    label: 'credencial',
    pattern:
      /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|shpat_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/,
  },
  {
    label: 'chave privada',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    label: 'path sensível',
    pattern: /(^|[\s`'"(])(\/(etc|root|home|usr)\/|~\/\.ssh|\.env\b|\/secrets\/)/i,
  },
  {
    label: 'IP privado',
    pattern:
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/,
  },
  {
    label: 'detalhe de vulnerabilidade',
    pattern: /\b(CVE-\d{4}-\d+|exploit|proof[- ]of[- ]concept|poc|payload|sql injection|xss|rce)\b/i,
  },
];

/**
 * Bloqueia conteúdo público que contenha segredo, credencial, path sensível,
 * IP privado ou detalhe de vulnerabilidade explorável. Não devolve o trecho
 * ofensor na mensagem.
 */
export function assertPublicSafe(value: string, context: string): void {
  const violations = SANITIZERS.filter(({ pattern }) => pattern.test(value)).map(
    ({ label }) => label,
  );
  if (violations.length > 0) {
    throw new SanitizationError(
      `conteúdo público bloqueado em ${context}: ${[...new Set(violations)].join(', ')}`,
    );
  }
}

function isPublicFragment(fragment: ReleaseFragment): boolean {
  return (
    fragment.category !== 'internal' &&
    fragment.audiences.some((audience) => audience === 'customer' || audience === 'partner')
  );
}

export function buildReleaseNotes(
  fragments: readonly ReleaseFragment[],
  options: BuildNotesOptions = {},
): ReleaseNotes {
  const product = options.product ?? 'sejahome';
  const version = options.version ?? 'unreleased';
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  assertPublicSafe(product, 'produto');
  assertPublicSafe(version, 'versão');

  const publicFragments = fragments.filter(isPublicFragment);
  for (const [index, fragment] of publicFragments.entries()) {
    for (const locale of ['pt-BR', 'en-US'] as const) {
      assertPublicSafe(fragment.title[locale], `fragmento público ${index + 1} title.${locale}`);
      assertPublicSafe(fragment.text[locale], `fragmento público ${index + 1} text.${locale}`);
    }
  }

  const pt = renderPublic('pt-BR', product, version, generatedAt, publicFragments);
  const en = renderPublic('en-US', product, version, generatedAt, publicFragments);
  const changelog = renderInternal(product, version, generatedAt, fragments);
  const checklist = renderChecklist(product, version, generatedAt, fragments);
  const index = renderPublicIndex(product, version, generatedAt, publicFragments);

  return {
    'pt-BR.md': pt,
    'en-US.md': en,
    'CHANGELOG.internal.md': changelog,
    'CHECKLIST.md': checklist,
    'index.public.json': index,
  };
}

export function writeReleaseNotes(notes: ReleaseNotes, outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const file of NOTE_FILES) {
    const path = join(outDir, file);
    writeFileSync(path, notes[file]);
    written.push(path);
  }
  return written;
}

function renderPublic(
  locale: 'pt-BR' | 'en-US',
  product: string,
  version: string,
  generatedAt: string,
  fragments: readonly ReleaseFragment[],
): string {
  const heading = locale === 'pt-BR' ? 'Notas de versão' : 'Release notes';
  const lines: string[] = [
    `# ${heading} — ${product} ${version}`,
    '',
    locale === 'pt-BR' ? `Gerado em ${generatedAt}.` : `Generated at ${generatedAt}.`,
    '',
  ];
  for (const category of FRAGMENT_CATEGORIES) {
    const items = fragments.filter((fragment) => fragment.category === category);
    if (items.length === 0) continue;
    lines.push(`## ${CATEGORY_LABELS[category][locale === 'pt-BR' ? 'pt' : 'en']}`, '');
    for (const item of items) {
      lines.push(`- **${item.title[locale]}** — ${item.text[locale]}`);
    }
    lines.push('');
  }
  if (fragments.length === 0) {
    lines.push(locale === 'pt-BR' ? 'Sem mudanças públicas.' : 'No public changes.', '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderInternal(
  product: string,
  version: string,
  generatedAt: string,
  fragments: readonly ReleaseFragment[],
): string {
  const lines: string[] = [
    `# Changelog interno — ${product} ${version}`,
    '',
    `Gerado em ${generatedAt}.`,
    '',
  ];
  for (const category of FRAGMENT_CATEGORIES) {
    const items = fragments.filter((fragment) => fragment.category === category);
    if (items.length === 0) continue;
    lines.push(`## ${CATEGORY_LABELS[category].pt} (${category})`, '');
    for (const item of items) {
      lines.push(`- [${item.audiences.join(', ')}] **${item.title['pt-BR']}** — ${item.text['pt-BR']}`);
      if (item.test !== undefined) {
        lines.push(`  - teste: ${item.test}`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderChecklist(
  product: string,
  version: string,
  generatedAt: string,
  fragments: readonly ReleaseFragment[],
): string {
  const lines: string[] = [
    `# Checklist humano — ${product} ${version}`,
    '',
    `Gerado em ${generatedAt}.`,
    '',
    '- [ ] Revisar notas públicas pt-BR',
    '- [ ] Revisar notas públicas en-US',
    '- [ ] Confirmar que fragmentos `internal` ficaram fora do conteúdo público',
    '- [ ] Conferir índice público sanitizado',
    '- [ ] Validar manifesto e digests dos artefatos',
    '- [ ] Registrar aprovação humana antes de publicar',
    '',
    '## Fragmentos para conferência',
    '',
  ];
  for (const fragment of fragments) {
    const test = fragment.test === undefined ? '' : ` — teste: ${fragment.test}`;
    const visibility = isPublicFragment(fragment) ? 'público' : 'interno';
    lines.push(
      `- [ ] (${fragment.category}, ${visibility}) ${fragment.title['pt-BR']}${test}`,
    );
  }
  lines.push('');
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderPublicIndex(
  product: string,
  version: string,
  generatedAt: string,
  fragments: readonly ReleaseFragment[],
): string {
  const sections = FRAGMENT_CATEGORIES.filter((category) => category !== 'internal')
    .map((category) => {
      const items = fragments
        .filter((fragment) => fragment.category === category)
        .map((fragment) => ({
          audiences: [...fragment.audiences],
          title: { ...fragment.title },
          text: { ...fragment.text },
        }));
      return items.length === 0 ? null : { category, items };
    })
    .filter((section): section is NonNullable<typeof section> => section !== null);
  const index = {
    schema: 1,
    product,
    version,
    generatedAt,
    sections,
  };
  return `${JSON.stringify(index, null, 2)}\n`;
}

function formatAjvErrors(errors: readonly ErrorObject[]): string[] {
  if (errors.length === 0) return ['estrutura inválida'];
  return errors.map((error) => `${error.instancePath || '/'} ${error.message ?? 'inválido'}`);
}
