# Workflows e contrato do adaptador

Esta camada é o motor genérico de release da SejaHome. Ela conhece versão,
manifesto, notas, ordem de fases, variáveis e evidência. Ela **não** conhece
produto: comandos, conexões e peculiaridades de cada produto pertencem ao
adaptador entregue pelo produto em `release/adapter/`.

Exemplo de produto só pode aparecer em `docs/`, `fixtures/` e na evidência. Nunca
em `src/`, `cli/` ou `.github/workflows/` — o job `guard` do `self-test.yml`
verifica isso, sem diferenciar maiúsculas.

## Workflows

### `release-validate.yml`

- Gatilho: somente `workflow_call`.
- `permissions: contents: read` no topo; nenhum job amplia.
- Não publica, não faz deploy e não pede secret.

Entradas:

| Nome | Obrigatório | Padrão | Papel |
| --- | --- | --- | --- |
| `manifest` | sim | — | Caminho do manifesto, relativo ao checkout do chamador. |
| `fragments` | sim | — | Diretório de fragmentos, relativo ao checkout do chamador. |
| `based-on` | não | vazio | Manifesto da RC aprovada, relativo ao checkout do chamador. |
| `platform-ref` | não | `dev` | Ref de `SejaHome/sejahome-releases` usada como plataforma. |
| `node-version` | não | `22` | Versão do Node. |
| `latest-version` | não | vazio | Última versão conhecida; quando informada, calcula a próxima RC. |

Saídas:

| Nome | Conteúdo |
| --- | --- |
| `version` | Versão do manifesto validado. |
| `state` | Estado do manifesto validado. |
| `digests` | JSON `{"<artefato>":"sha256:..."}` com nome e digest. |

Passos: checkout do repositório chamador; checkout de
`SejaHome/sejahome-releases` no `platform-ref` em `.release-platform`; `pnpm
install --frozen-lockfile`; `manifest validate` (com `--based-on` quando
informado); `version next` quando `latest-version` for informado; `notes build`
para diretório temporário; `artifact verify` sem bundle.

Evidência: artefato `release-evidence-<version>` com os cinco arquivos de notas
(`pt-BR.md`, `en-US.md`, `CHANGELOG.internal.md`, `CHECKLIST.md`,
`index.public.json`) e `validation.log`. O `$GITHUB_STEP_SUMMARY` mostra versão,
estado, digests e a lista das notas.

Erro de contrato (versão, manifesto, digest, notas) encerra com falha; não existe
`continue-on-error`. O checkout da plataforma usa as permissões do chamador; esta
tarefa não adiciona secret nem token.

### `release-deploy.yml`

- Gatilho: somente `workflow_call`. `push` e `workflow_dispatch` são proibidos
  neste arquivo.
- `permissions: contents: read`. O job usa
  `environment: ${{ inputs.environment }}` e não declara `contents: write`.
- Não decide versão, não reconstrói imagem e não faz rollback automático.

Entradas:

| Nome | Obrigatório | Padrão | Papel |
| --- | --- | --- | --- |
| `environment` | sim | — | `qa`, `production` ou `test` (só fixture). |
| `manifest` | sim | — | Caminho do manifesto, relativo ao checkout do chamador. |
| `expected-digest` | sim | — | Digest `sha256:` esperado para os artefatos. |
| `adapter-path` | não | `release/adapter` | Diretório do adaptador, relativo ao checkout do chamador. |
| `runs-on` | não | `["ubuntu-latest"]` | Runner do job, em JSON, lido por `fromJSON`. |
| `target-ref` | não | SHA do evento | Ref do chamador a usar no checkout. |

O primeiro passo é a conferência do contrato, antes de qualquer script: ambiente
entre `qa`, `production` e `test`; `expected-digest` no formato `sha256:` com 64
hex; manifesto presente; versão no formato do contrato; e **um único** digest
declarado em `artifacts[].digest`, exatamente igual ao `expected-digest`.
Divergência falha na primeira etapa. Múltiplos digests ainda não são aceitos
nesta versão do contrato.

Ordem fixa, cada fase com `set -euo pipefail`, `timeout-minutes` próprio e falha
propagada:

```text
preflight.sh -> prepare.sh -> deploy.sh -> verify.sh
```

`recovery.sh` **não** roda neste workflow.

Variáveis entregues a cada script:

| Variável | Conteúdo |
| --- | --- |
| `RELEASE_ENV` | Ambiente de destino. |
| `RELEASE_VERSION` | Versão lida do manifesto. |
| `RELEASE_DIGEST` | Digest esperado. |
| `RELEASE_MANIFEST` | Caminho absoluto do manifesto no checkout. |
| `RELEASE_ACTOR` | Ator do GitHub que disparou o run. |
| `RELEASE_TARGET_REF` | Ref efetivamente usado no checkout. |

Evidência: `$GITHUB_STEP_SUMMARY` com ambiente, versão, digest, ref e a duração
de cada fase. Nenhum log bruto de script entra no summary; stdout e stderr do
adaptador ficam no log do job.

`environment` protegido (`qa`, `production`) é declarado por este contrato e
recebe revisores obrigatórios quando o ambiente existir de fato (T06/T07). O
ambiente `test` existe apenas para o deploy seco com fixture. Esta tarefa não cria
environment por API.

### `self-test.yml`

- `on`: `push` em `dev` e `workflow_dispatch`.
- Único workflow do repo que roda em `push`; ele não executa deploy no `push`.
- `permissions: contents: read`.

Jobs:

- `contract` (push e dispatch): `docker run ... rhysd/actionlint:1.7.7` em todos
  os workflows e chamada de `release-validate.yml` com
  `fixtures/release.example.yaml` e `fixtures/fragments`. Falha de download da
  imagem é falha do job, não `continue-on-error`. O digest do manifesto de
  fixture é extraído e repassado ao job `dry-deploy`.
- `dry-deploy` (somente `workflow_dispatch`): chama `release-deploy.yml` com
  `environment: test`, `fixtures/adapter` e o digest do fixture. O adaptador só
  escreve `$TMPDIR/test-<version>.marker`; sem rede, Docker de produto ou host.
- `guard`: falha se `release-deploy.yml` tiver gatilho `push` ou
  `workflow_dispatch`, se `release-validate.yml` declarar `permissions` fora do
  topo ou ampliar `contents: read`, se outro workflow rodar em `push`, ou se
  `src/`, `cli/` ou `.github/workflows/` citarem nome de produto. A lista de
  nomes fica em `fixtures/product-names.txt`. Marcadores de infraestrutura
  (`SejaHome`, `sejahome-releases`, labels de runner) são permitidos.

O job `guard` não escreve no repositório.

## Contrato do adaptador

O produto entrega cinco scripts `bash` executáveis em `release/adapter/`:
`preflight.sh`, `prepare.sh`, `deploy.sh`, `verify.sh` e `recovery.sh`. Todos
começam com `set -euo pipefail` e recebem as variáveis `RELEASE_*` da tabela
acima.

Ordem executada por `release-deploy.yml`:

1. `preflight.sh` — confere pré-condições e contrato local. Deve ser idempotente:
   duas execuções seguidas retornam o mesmo resultado e não alteram o alvo.
2. `prepare.sh` — prepara o alvo para receber a versão.
3. `deploy.sh` — aplica a versão e o digest já decididos. Não decide versão e não
   constrói imagem.
4. `verify.sh` — confirma o estado final. Deve ser idempotente e somente leitura.

`recovery.sh` segue o mesmo contrato de entrada, mas é chamado por operação
manual futura (T03/T04), nunca por estes workflows. Ele não faz rollback
automático.

Contrato de saída:

- stdout: resumo humano da fase; vai para o log do job.
- stderr: erro e diagnóstico; vai para o log do job.
- Nada de log bruto no `$GITHUB_STEP_SUMMARY`; o summary é escrito pela camada.
- Códigos de saída: `0` sucesso; `1` falha da fase; `2` invocação ou configuração
  inválida. Qualquer código diferente de zero encerra o workflow naquela fase e
  impede as seguintes.
- O adaptador não escreve no repositório, não faz `git push` e não recebe secret
  por estes workflows.

A camada garante ordem, variáveis, timeout, falha propagada e evidência. O
adaptador garante comandos, conexões, idempotência de `preflight`/`verify` e as
peculiaridades do produto.

## Prova local e remota

No checkout da camada, em `dev`:

```bash
pnpm lint
pnpm test
pnpm build
grep -riE 'ayha|sentinel|n8n|homeassistant|home-assistant|mosquitto|zigbee' src cli .github/workflows || echo SEM_NOME_DE_PRODUTO
```

A prova de `actionlint` é remota, no job `contract` do runner hospedado, não em
container na máquina DEV. O deploy seco é disparado por
`gh workflow run self-test.yml --ref dev`.
