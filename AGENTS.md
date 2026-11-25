# AGENTS.md — sejahome-releases

## Projeto

Camada genérica de release da SejaHome. Raiz:
`/usr/share/sejahome/repos/engineering/sejahome-releases`.

## Regras

- Trabalhe na `dev`, sem branch nova, clone ou worktree. `qa` e `main` só por PR.
- Commit e push na mesma tarefa. Antes de editar, confira `git branch --show-current`
  e `git status -sb`.
- Não altere repositórios de produto por conta desta camada.
- Nenhum segredo, `.env`, credencial, dado de cliente ou log bruto em arquivo,
  teste, fixture ou evidência.
- TypeScript estrito, sem `any` injustificado.
- Esta camada não executa deploy, Docker, SSH, host ou banco. A CLI lê arquivos e
  responde; workflows cuidam de efeitos.
- Não adicione a responsabilidade de release ao `shctl`.
- Fora de escopo: portal, daemon, API, banco, fila, framework de plugins,
  blue-green, canary, rollback automático, HA.

## Verificação

```bash
pnpm lint
pnpm test
pnpm build
```
