# sejahome-releases

Camada de orquestração de publicação dos produtos SejaHome.

Responsabilidades:

- contrato de versão, manifesto, notas e estados de release;
- CLI estreita para validar e gerar artefatos de release;
- workflows GitHub reutilizáveis, chamados pelos repositórios dos produtos.

Não pertence a esta camada: compose, `.env`, bootstrap, runtime, imagens,
deploy, credenciais ou operação de host. Cada produto entrega seu adaptador,
build e manifesto no próprio repositório.

Sem portal, daemon, API ou banco. Estado inicial é arquivo versionado.

## Versionamento

Três formatos são aceitos e o legado e o novo são equivalentes:

```text
legado: 2026.11.01~rc1
novo:   2026.11.01-rc.1
final:  2026.11.01
```

`YYYY.MM.NN` usa `NN` como sequência do mês, nunca dia. RC começa em 1. O final
ordena depois de todas as RCs da mesma linha. Tag OCI troca somente `~` por `-`
no legado; o novo permanece igual. `candidate` e `stable` são estados, não
sufixos.

```ts
import { nextVersion, ociTag } from '@sejahome/releases';

nextVersion({ latest: '2026.11.03', date: '2026-11-25' }); // 2026.11.04~rc1
nextVersion({ latest: '2026.11.04~rc1', date: '2026-11-25' }); // 2026.11.04~rc2
nextVersion({ latest: '2026.11.04~rc2', date: '2026-12-15' }); // 2026.12.01~rc1
ociTag('2026.11.04~rc2'); // 2026.11.04-rc2
```

## Manifesto

`schemas/release.schema.json` define a estrutura. `validateManifest` acrescenta as
regras cruzadas:

- `commit` é SHA completo de 40 hex minúsculos;
- `publishedAt`, `builtAt` e `approval.approvedAt` são UTC `YYYY-MM-DDTHH:MM:SSZ`;
- `artifacts[].digest` usa `sha256:` com 64 hex;
- estado conhecido (`draft`, `rc`, `candidate`, `stable`);
- estado diferente de `draft` exige aprovação humana registrada;
- `candidate` exige versão final, `basedOn` de uma RC da mesma linha e os
  mesmos nomes e digests da RC aprovada.

O campo opcional `artifacts[].file` nomeia o arquivo relativo no bundle local e
só é usado por `artifact verify`.

## Notas e fragmentos

`schemas/fragment.schema.json` exige categoria, públicos, título e texto em
pt-BR e en-US. `test` é opcional.

`notes build` gera cinco arquivos:

- `pt-BR.md` e `en-US.md`: notas públicas;
- `CHANGELOG.internal.md`: changelog interno, incluindo `internal`;
- `CHECKLIST.md`: checklist humano;
- `index.public.json`: índice público sanitizado.

Categoria `internal` e fragmentos exclusivamente `platform-only` ficam fora do
público. A sanitização bloqueia segredo, credencial, senha, chave, path
sensível, IP privado e detalhe de vulnerabilidade explorável.

## Estados

```text
DRAFT -> APPROVED_FOR_BUILD -> BUILT -> PUBLISHED_RC
      -> QA_PREPARED -> QA_DEPLOYED -> QA_APPROVED -> CANDIDATE
      -> PRODUCTION_PREPARED -> PRODUCTION_DEPLOYED -> PRODUCTION_APPROVED
```

`state validate-transition` rejeita salto, regressão e mudança de identidade
(produto, versão, commit ou digest). Cada lado é um arquivo versionado:

```yaml
state: DRAFT
product: exemplo
version: 2026.11.04~rc1
commit: '0123456789abcdef0123456789abcdef01234567'
artifacts:
  - name: app
    digest: sha256:d39fe4fe9135530231f41089b59b2b592a033bbbe89c7bcabde8ecae63af87ec
```

## CLI

A CLI lê arquivos e responde. Não executa deploy, Docker, SSH, host, banco nem
rede.

```bash
pnpm install
pnpm lint
pnpm test
pnpm build

npx tsx cli/release-platform.ts version next --latest 2026.11.03 --date 2026-11-25
npx tsx cli/release-platform.ts manifest validate fixtures/release.example.yaml
npx tsx cli/release-platform.ts notes build --fragments fixtures/fragments --out /tmp/release-notes
npx tsx cli/release-platform.ts state validate-transition --from a.yaml --to b.yaml
npx tsx cli/release-platform.ts artifact verify --manifest fixtures/release.example.yaml --bundle ./bundle
```

Cada subcomando aceita `--help`. Falha de validação sai com código diferente de
zero.
