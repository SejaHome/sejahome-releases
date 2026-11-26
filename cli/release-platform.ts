#!/usr/bin/env node
/**
 * CLI estreita do contrato de release.
 *
 * Lê arquivos e responde. Não executa deploy, Docker, SSH, host, banco ou rede.
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { parse as parseYaml } from 'yaml';

import {
  loadFragments,
  buildReleaseNotes,
  writeReleaseNotes,
} from '../src/release-notes.js';
import { loadManifestFile, verifyArtifacts } from '../src/manifest.js';
import {
  parseStateRecord,
  validateTransition,
} from '../src/state-machine.js';
import { nextVersion } from '../src/version.js';

const GLOBAL_HELP = `release-platform — contrato de release da SejaHome

Uso:
  release-platform <comando> <subcomando> [opções]

Comandos:
  version next            Calcula a próxima RC.
  manifest validate       Valida um manifesto de release.
  notes build             Gera notas, changelog, checklist e índice público.
  state validate-transition  Valida transição entre registros de estado.
  artifact verify         Confere o manifesto e digests de um bundle local.

Cada subcomando aceita --help. A CLI não executa efeito externo.
`;

const VERSION_HELP = `Uso: release-platform version next [opções]

Calcula a próxima RC no formato legado usado hoje.

Opções:
  --latest <versão>   Última versão conhecida (legado, novo ou final).
  --date <YYYY-MM-DD> Data de referência. Obrigatória.
  --help              Mostra esta ajuda.

Exemplo:
  release-platform version next --latest 2026.11.03 --date 2026-11-25
`;

const MANIFEST_HELP = `Uso: release-platform manifest validate <arquivo> [opções]

Valida estrutura, estado, timestamps UTC, commit, digests e aprovação.

Opções:
  --based-on <arquivo> Manifesto da RC aprovada; obrigatório para state=candidate.
  --help               Mostra esta ajuda.

Exemplo:
  release-platform manifest validate fixtures/release.example.yaml
`;

const NOTES_HELP = `Uso: release-platform notes build --fragments <dir> --out <dir> [opções]

Gera pt-BR.md, en-US.md, CHANGELOG.internal.md, CHECKLIST.md e index.public.json.

Opções:
  --fragments <dir>   Diretório com fragmentos .yaml. Obrigatório.
  --out <dir>         Diretório de saída. Obrigatório.
  --product <nome>    Produto nas notas. Padrão: sejahome.
  --version <versão>  Versão nas notas. Padrão: unreleased.
  --date <YYYY-MM-DD> Data de geração em UTC. Padrão: agora.
  --help              Mostra esta ajuda.

Exemplo:
  release-platform notes build --fragments fixtures/fragments --out /tmp/release-notes
`;

const STATE_HELP = `Uso: release-platform state validate-transition --from <arquivo> --to <arquivo>

Valida a transição e rejeita salto, regressão e mudança de identidade
(produto, versão, commit ou digest).

Cada arquivo é um registro versionado:
  state: DRAFT
  product: exemplo
  version: 2026.11.04~rc1
  commit: <sha completo de 40 hex>
  artifacts:
    - name: app
      digest: sha256:<64 hex>

Opções:
  --from <arquivo>  Registro de origem. Obrigatório.
  --to <arquivo>    Registro de destino. Obrigatório.
  --help            Mostra esta ajuda.

Exemplo:
  release-platform state validate-transition --from state-a.yaml --to state-b.yaml
`;

const ARTIFACT_HELP = `Uso: release-platform artifact verify --manifest <arquivo> [opções]

Confere o manifesto e, se receber um bundle local, o sha256 dos arquivos
declarados em artifacts[].file. Nunca consulta Registry, Docker ou rede.

Opções:
  --manifest <arquivo>  Manifesto de release. Obrigatório.
  --bundle <dir>        Diretório local com os arquivos dos artefatos.
  --help                Mostra esta ajuda.

Exemplo:
  release-platform artifact verify --manifest fixtures/release.example.yaml --bundle ./bundle
`;

const OPTIONS = {
  latest: { type: 'string' },
  date: { type: 'string' },
  'based-on': { type: 'string' },
  fragments: { type: 'string' },
  out: { type: 'string' },
  product: { type: 'string' },
  version: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  manifest: { type: 'string' },
  bundle: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

class UsageError extends Error {
  override readonly name = 'UsageError';
}

function main(argv: readonly string[]): number {
  if (argv.length === 0) {
    process.stdout.write(GLOBAL_HELP);
    return 0;
  }
  const first = argv[0];
  if (first === undefined) {
    process.stdout.write(GLOBAL_HELP);
    return 0;
  }
  if (first === '--help' || first === '-h' || first === 'help') {
    process.stdout.write(GLOBAL_HELP);
    return 0;
  }
  const command = first;
  const subcommand = argv[1];
  const rest = argv.slice(2);

  if (command === 'version') {
    if (subcommand !== 'next') return unknownSubcommand(command, subcommand, 'version next');
    if (hasHelp(rest)) {
      process.stdout.write(VERSION_HELP);
      return 0;
    }
    return versionNext(rest);
  }
  if (command === 'manifest') {
    if (subcommand !== 'validate') return unknownSubcommand(command, subcommand, 'manifest validate');
    if (hasHelp(rest)) {
      process.stdout.write(MANIFEST_HELP);
      return 0;
    }
    return manifestValidate(rest);
  }
  if (command === 'notes') {
    if (subcommand !== 'build') return unknownSubcommand(command, subcommand, 'notes build');
    if (hasHelp(rest)) {
      process.stdout.write(NOTES_HELP);
      return 0;
    }
    return notesBuild(rest);
  }
  if (command === 'state') {
    if (subcommand !== 'validate-transition') {
      return unknownSubcommand(command, subcommand, 'state validate-transition');
    }
    if (hasHelp(rest)) {
      process.stdout.write(STATE_HELP);
      return 0;
    }
    return stateValidateTransition(rest);
  }
  if (command === 'artifact') {
    if (subcommand !== 'verify') return unknownSubcommand(command, subcommand, 'artifact verify');
    if (hasHelp(rest)) {
      process.stdout.write(ARTIFACT_HELP);
      return 0;
    }
    return artifactVerify(rest);
  }
  throw new UsageError(`Comando desconhecido: ${command}`);
}

function hasHelp(args: readonly string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

function unknownSubcommand(command: string, subcommand: string | undefined, expected: string): never {
  const received = subcommand === undefined ? '' : ` ${subcommand}`;
  throw new UsageError(`Comando desconhecido: ${command}${received}; use: ${expected}`);
}

function parse(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
}

function versionNext(args: readonly string[]): number {
  const { values } = parse(args);
  const date = values.date;
  if (date === undefined) {
    throw new UsageError('version next exige --date <YYYY-MM-DD>');
  }
  const next = nextVersion({ latest: values.latest, date });
  process.stdout.write(`${next}\n`);
  return 0;
}

function manifestValidate(args: readonly string[]): number {
  const { values, positionals } = parse(args);
  const file = positionals[0];
  if (file === undefined) {
    throw new UsageError('manifest validate exige o caminho do manifesto');
  }
  if (positionals.length > 1) {
    throw new UsageError('manifest validate aceita apenas um manifesto');
  }
  const basedOnPath = values['based-on'];
  const approvedRc =
    basedOnPath === undefined ? undefined : (parseYaml(readFileSync(basedOnPath, 'utf8')) as unknown);
  const manifest = loadManifestFile(file, { approvedRc });
  process.stdout.write(
    `manifesto válido: ${manifest.product} ${manifest.version} (${manifest.state})\n`,
  );
  return 0;
}

function notesBuild(args: readonly string[]): number {
  const { values } = parse(args);
  if (values.fragments === undefined) {
    throw new UsageError('notes build exige --fragments <dir>');
  }
  if (values.out === undefined) {
    throw new UsageError('notes build exige --out <dir>');
  }
  const generatedAt =
    values.date === undefined ? undefined : `${values.date}T00:00:00Z`;
  const notes = buildReleaseNotes(loadFragments(values.fragments), {
    product: values.product,
    version: values.version,
    generatedAt,
  });
  const written = writeReleaseNotes(notes, values.out);
  process.stdout.write(`${written.join('\n')}\n`);
  return 0;
}

function stateValidateTransition(args: readonly string[]): number {
  const { values } = parse(args);
  if (values.from === undefined || values.to === undefined) {
    throw new UsageError('state validate-transition exige --from <arquivo> e --to <arquivo>');
  }
  const from = parseStateRecord(
    parseYaml(readFileSync(values.from, 'utf8')) as unknown,
    values.from,
  );
  const to = parseStateRecord(
    parseYaml(readFileSync(values.to, 'utf8')) as unknown,
    values.to,
  );
  validateTransition({ from, to });
  process.stdout.write(`transição válida: ${from.state} -> ${to.state}\n`);
  return 0;
}

function artifactVerify(args: readonly string[]): number {
  const { values } = parse(args);
  if (values.manifest === undefined) {
    throw new UsageError('artifact verify exige --manifest <arquivo>');
  }
  const manifest = loadManifestFile(values.manifest);
  const result = verifyArtifacts(manifest, values.bundle);
  if (values.bundle === undefined) {
    process.stdout.write(
      `manifesto válido; ${manifest.artifacts.length} artefato(s) com digest declarado; bundle não informado\n`,
    );
    return 0;
  }
  for (const item of result.checked) {
    process.stdout.write(`ok ${item.name}: ${item.file} ${item.digest}\n`);
  }
  for (const name of result.skipped) {
    process.stdout.write(`sem file para conferir: ${name}\n`);
  }
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`erro de uso: ${error.message}\n`);
    process.exitCode = 2;
  } else if (error instanceof Error) {
    process.stderr.write(`erro: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write(`erro: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
