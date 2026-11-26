import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FragmentValidationError,
  NOTE_FILES,
  SanitizationError,
  buildReleaseNotes,
  loadFragments,
  validateFragment,
  type ReleaseFragment,
} from '../src/release-notes.js';

const FRAGMENTS_DIR = fileURLToPath(new URL('../fixtures/fragments', import.meta.url));
const FIXED_TIME = '2026-11-25T00:00:00Z';

function fragment(overrides: Partial<ReleaseFragment> = {}): ReleaseFragment {
  return {
    category: 'improvements',
    audiences: ['customer'],
    title: { 'pt-BR': 'Título limpo', 'en-US': 'Clean title' },
    text: { 'pt-BR': 'Texto limpo.', 'en-US': 'Clean text.' },
    ...overrides,
  };
}

test('gera os cinco arquivos esperados', () => {
  const notes = buildReleaseNotes(loadFragments(FRAGMENTS_DIR), {
    product: 'exemplo',
    version: '2026.11.04~rc1',
    generatedAt: FIXED_TIME,
  });
  for (const file of NOTE_FILES) {
    assert.ok(notes[file].length > 0, file);
  }
});

test('conteúdo internal nunca aparece no público', () => {
  const notes = buildReleaseNotes(loadFragments(FRAGMENTS_DIR), {
    product: 'exemplo',
    version: '2026.11.04~rc1',
    generatedAt: FIXED_TIME,
  });
  const publicContent = `${notes['pt-BR.md']}\n${notes['en-US.md']}\n${notes['index.public.json']}`;
  assert.equal(publicContent.includes('Rotina interna'), false);
  assert.equal(publicContent.includes('Internal release closing routine'), false);

  assert.ok(notes['CHANGELOG.internal.md'].includes('Rotina interna'));
  assert.ok(notes['CHECKLIST.md'].includes('Rotina interna'));
});

test('índice público é JSON sanitizado e sem categoria internal', () => {
  const notes = buildReleaseNotes(loadFragments(FRAGMENTS_DIR), {
    product: 'exemplo',
    version: '2026.11.04~rc1',
    generatedAt: FIXED_TIME,
  });
  const index = JSON.parse(notes['index.public.json']) as {
    schema: number;
    product: string;
    version: string;
    sections: { category: string; items: unknown[] }[];
  };
  assert.equal(index.schema, 1);
  assert.equal(index.product, 'exemplo');
  assert.equal(index.version, '2026.11.04~rc1');
  assert.equal(index.sections.some((section) => section.category === 'internal'), false);
  assert.ok(index.sections.length > 0);
});

test('fragmento platform-only não entra no público', () => {
  const internalOnly = fragment({
    category: 'improvements',
    audiences: ['platform-only'],
    title: { 'pt-BR': 'Somente plataforma', 'en-US': 'Platform only' },
    text: { 'pt-BR': 'Detalhe operacional.', 'en-US': 'Operational detail.' },
  });
  const notes = buildReleaseNotes([internalOnly], {
    product: 'exemplo',
    version: '2026.11.04~rc1',
    generatedAt: FIXED_TIME,
  });
  assert.equal(notes['pt-BR.md'].includes('Somente plataforma'), false);
  assert.ok(notes['CHANGELOG.internal.md'].includes('Somente plataforma'));
});

test('sanitização bloqueia segredo, credencial, path, IP privado e vulnerabilidade', () => {
  const cases: ReleaseFragment[] = [
    fragment({ text: { 'pt-BR': 'Use o token=abc123 para entrar.', 'en-US': 'Use the token.' } }),
    fragment({ text: { 'pt-BR': 'Texto.', 'en-US': 'Header ghp_abcdefghijklmnopqrstuvwxyz0123' } }),
    fragment({ text: { 'pt-BR': 'Arquivo em /etc/passwd.', 'en-US': 'File.' } }),
    fragment({ text: { 'pt-BR': 'Host em 10.20.30.40.', 'en-US': 'Host.' } }),
    fragment({ text: { 'pt-BR': 'Detalhe CVE-2026-1234.', 'en-US': 'Detail.' } }),
  ];
  for (const item of cases) {
    assert.throws(
      () =>
        buildReleaseNotes([item], {
          product: 'exemplo',
          version: '2026.11.04~rc1',
          generatedAt: FIXED_TIME,
        }),
      SanitizationError,
    );
  }
});

test('conteúdo sensível em fragmento internal não vaza e não bloqueia', () => {
  const internal = fragment({
    category: 'internal',
    audiences: ['platform-only'],
    title: { 'pt-BR': 'Detalhe interno', 'en-US': 'Internal detail' },
    text: { 'pt-BR': 'senha interna em /etc/app.', 'en-US': 'internal password at /etc/app.' },
  });
  const notes = buildReleaseNotes([internal], {
    product: 'exemplo',
    version: '2026.11.04~rc1',
    generatedAt: FIXED_TIME,
  });
  assert.equal(notes['pt-BR.md'].includes('Detalhe interno'), false);
  assert.ok(notes['CHANGELOG.internal.md'].includes('Detalhe interno'));
});

test('validação de fragmento exige pt-BR e en-US', () => {
  assert.throws(
    () =>
      validateFragment(
        {
          category: 'improvements',
          audiences: ['customer'],
          title: { 'pt-BR': 'Título' },
          text: { 'pt-BR': 'Texto', 'en-US': 'Text' },
        },
        'fragmento.yaml',
      ),
    FragmentValidationError,
  );
});
