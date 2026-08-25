# CLAUDE.md

Diário falado pessoal, single-user. Eu gravo áudio, o sistema transcreve, extrai afirmações atômicas, conecta com pessoas/projetos/objetivos e só grava no banco depois da minha confirmação.

Leitura obrigatória no começo de qualquer tarefa:

| Arquivo | O que é |
|---|---|
| este arquivo | regras do projeto — **vence em qualquer conflito** |
| `ARCHITECTURE.md` | o sistema como ele é hoje — e que você atualiza junto com o código |
| `Specs/slice-1.md` | escopo e critérios de aceite da fatia atual |
| `db/migrations/` | definição canônica do schema — nunca inferir label ou propriedade do código |

## Stack (decidida — não propor alternativas)

- Next.js (App Router) + TypeScript, PWA, deploy na Vercel
- Neo4j AuraDB Free, acessado pela **HTTP Query API** — nunca o driver Bolt (serverless não sustenta pool de conexões)
- Cloudflare R2 para áudio e transcrições
- **Vercel AI Gateway: porta única de modelo.** Todo tráfego de LLM sai por ele — STT, extração, deduplicação, o que vier. Uma chave (`AI_GATEWAY_API_KEY`), um lugar para ver custo e latência, e trocar de provedor é mudar uma variável de ambiente
- STT: modelo endereçado por `STT_MODEL` (padrão `xai/grok-stt`), com timestamps por palavra quando o provedor os expõe
- Extração: LLM com saída JSON estrita, pelo mesmo Gateway
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
8. **Todo tráfego de modelo sai pelo Vercel AI Gateway.** Nenhum pacote de provedor nas dependências (`@ai-sdk/openai`, `openai`, `groq-sdk`…), nenhum endpoint de provedor escrito à mão, nenhuma chave de provedor além de `AI_GATEWAY_API_KEY`. Modelo se referencia por string `provedor/modelo`, sempre por `src/lib/modelos.ts` — passar objeto de provedor fura a porta e o Gateway não vê a chamada. `tests/gateway.test.ts` falha quando alguém fura; o conserto é usar a porta, não afrouxar o teste.

## ARCHITECTURE.md — sempre atualizado

`ARCHITECTURE.md` (na raiz) descreve o sistema como ele é: topologia, mapa dos
módulos, caminho do áudio, pipeline de transcrição, máquina de estados, travas de
idempotência, fronteira de segurança, layout do R2, rotas, ambiente.

**Leia antes de mexer em qualquer coisa. Atualize no mesmo commit da mudança.**
Documento desatualizado é pior que documento nenhum: ele mente com autoridade.

Atualizar é obrigatório quando a mudança toca:

- fluxo de dado ou ordem dos passos;
- contrato de rota, formato de payload ou chave do R2;
- tipo do domínio em `src/lib/tipos.ts`, ou schema do grafo;
- máquina de estados, trava de idempotência ou concorrência;
- dependência externa, provedor de modelo ou variável de ambiente;
- fronteira de segurança: auth, middleware, presign, CORS;
- módulo novo, removido ou com responsabilidade trocada;
- limite conhecido resolvido ou descoberto.

Refatoração interna, ajuste de texto na tela ou teste novo sobre comportamento já
descrito não pedem atualização. Ao fechar uma slice, revisar o arquivo inteiro —
o cabeçalho declara qual slice está no ar e o que ainda não existe.

A seção "Manutenção deste arquivo", no fim do próprio `ARCHITECTURE.md`, repete
essa regra para quem chegar por lá. Se as duas divergirem, **este arquivo vence**.

Ordem de precedência dos documentos: `CLAUDE.md` → `ARCHITECTURE.md` →
`Specs/slice-N.md`. `ARCHITECTURE.md` descreve o que **existe**; `Specs/` descreve
o que **deve existir**. Quando o código contradiz o `ARCHITECTURE.md`, o errado é
o documento — conserte-o e me avise.

## Como trabalhamos

- Uma slice vertical por vez (DB + API + UI de um caminho só, funcionando ponta a ponta). Não construir adiantado o que a slice atual não usa.
- A spec da slice atual está em `Specs/`. Se ela conflitar com este arquivo, este arquivo vence — e me avise do conflito.
- Toda mudança de código passa por `ARCHITECTURE.md` — ver a seção acima. Trabalho entregue sem o documento acompanhando está incompleto.
- Antes de refatorar algo fora do escopo da slice, perguntar.
- Testes de extração rodam contra as sessões rotuladas à mão em `fixtures/`. Não alterar os rótulos para o teste passar.

## Variáveis de ambiente

```
NEO4J_QUERY_URL, NEO4J_USER, NEO4J_PASSWORD
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
AI_GATEWAY_API_KEY        única chave de modelo — STT, extração, deduplicação
STT_MODEL                 opcional; padrão xai/grok-stt
AUTH_SECRET, ALLOWED_EMAIL
```

Chave de provedor (`OPENAI_API_KEY`, `XAI_API_KEY`, `STT_API_KEY`, `LLM_API_KEY`…)
não existe neste sistema — ver regra inviolável 8.
