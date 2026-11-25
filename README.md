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
