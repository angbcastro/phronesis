# CLAUDE.md

Diário falado pessoal, single-user. Eu gravo áudio, o sistema transcreve, extrai afirmações atômicas, conecta com pessoas/projetos/objetivos e só grava no banco depois da minha confirmação.

## Stack (decidida — não propor alternativas)

- Next.js (App Router) + TypeScript, PWA, deploy na Vercel
- Neo4j AuraDB Free, acessado pela **HTTP Query API** — nunca o driver Bolt (serverless não sustenta pool de conexões)
- Cloudflare R2 para áudio e transcrições
- STT: Whisper via API, com timestamps por palavra
- Extração: LLM com saída JSON estrita
- Auth: magic link com um único e-mail permitido. Sem signup, sem roles, sem reset de senha.

## Comandos

```bash
pnpm dev            # dev local
pnpm test           # vitest
pnpm migrate        # aplica db/migrations/*.cypher em ordem
pnpm migrate:dev    # mesma coisa, contra o banco de desenvolvimento
```

## Schema

O schema **já existe**. A definição canônica está em `db/migrations/`.
**Leia esses arquivos antes de escrever qualquer Cypher.** Não inferir nome de label
ou propriedade a partir do código — conferir sempre na migration.

Contrato resumido (referência rápida, não substitui a leitura):

```
:Pessoa, :Projeto, :Objetivo   — todos carregam também :Entidade
:Atomo                          — tipo ∈ FATO|OPINIAO|SENTIMENTO|APRENDIZADO|CONQUISTA
:Sessao, :Foco, :Pergunta

(:Sessao)-[:GEROU]->(:Atomo)
(:Atomo)-[:SOBRE]->(:Entidade)          // 1, sujeito principal
(:Atomo)-[:MENCIONA]->(:Entidade)       // 0..n
(:Atomo)-[:ATUALIZA|:CONTRADIZ|:CONFIRMA]->(:Atomo)
(:Projeto)-[:CONTRIBUI_PARA]->(:Objetivo)
(:Pessoa)-[:ENVOLVIDA_EM]->(:Projeto)
(:Foco)-[:APONTA_PARA]->(:Entidade)
```

Propriedades em português (`nome`, `criado_em`, `valido_em`, `texto`), IDs em `id`.

**Mudança de schema = nova migration numerada (`002_...cypher`), proposta e aprovada
por mim antes de rodar.** Nunca alterar schema direto no código ou no console do Aura.

## Regras invioláveis

1. Áudio nunca passa por Vercel Function. Cliente pega presigned URL e faz PUT direto no R2.
2. Texto de transcrição e manifest de chunks ficam no R2. No Neo4j vai só a chave.
3. Nenhuma chave de servidor em componente client. Sem `NEXT_PUBLIC_` para segredo.
4. Todo passo do pipeline é idempotente, chaveado por `sessao_id` (+ `chunk_index` quando aplicável). Retry não pode duplicar átomo.
5. Nada é gravado no grafo antes da minha confirmação na tela de revisão.
6. Deleção é soft: `status = 'rejeitado' | 'arquivado'`. Nunca `DELETE` em átomo.
7. Todo átomo gravado carrega `prompt_version` e `modelo`.

## Como trabalhamos

- Uma slice vertical por vez (DB + API + UI de um caminho só, funcionando ponta a ponta). Não construir adiantado o que a slice atual não usa.
- A spec da slice atual está em `specs/`. Se ela conflitar com este arquivo, este arquivo vence — e me avise do conflito.
- Antes de refatorar algo fora do escopo da slice, perguntar.
- Testes de extração rodam contra as sessões rotuladas à mão em `fixtures/`. Não alterar os rótulos para o teste passar.

## Variáveis de ambiente

```
NEO4J_QUERY_URL, NEO4J_USER, NEO4J_PASSWORD
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
STT_API_KEY
LLM_API_KEY
AUTH_SECRET, ALLOWED_EMAIL
```
