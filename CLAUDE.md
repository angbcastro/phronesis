# CLAUDE.md

Diário falado pessoal, single-user. Eu gravo áudio, o sistema transcreve, extrai afirmações atômicas, conecta com pessoas/projetos/objetivos e só grava no banco depois da minha confirmação.

Leitura obrigatória no começo de qualquer tarefa:

| Arquivo | O que é |
|---|---|
| este arquivo | regras do projeto — **vence em qualquer conflito** |
| `ARCHITECTURE.md` | o sistema como ele é hoje — e que você atualiza junto com o código |
| `Specs/slice-x.md` | escopo e critérios de aceite da fatia atual "x" |
| `db/migrations/` | definição canônica do schema — nunca inferir label ou propriedade do código |

## Stack (decidida — não propor alternativas)

- Next.js (App Router) + TypeScript, PWA, deploy na Vercel
- Neo4j AuraDB Free, acessado pela **HTTP Query API** — nunca o driver Bolt (serverless não sustenta pool de conexões)
- Cloudflare R2 para áudio e transcrições
- **Vercel AI Gateway: porta única de modelo.** Todo tráfego de LLM sai por ele — STT, extração, resolução de identidade, perfil, deduplicação, o que vier. Uma chave (`AI_GATEWAY_API_KEY`), um lugar para ver custo e latência, e trocar de provedor é mudar uma variável de ambiente
- STT: modelo endereçado por `STT_MODEL` (padrão `xai/grok-stt`), com timestamps por palavra. **Timestamp não é opcional:** sem ele não há procedência, e modelo de STT que não devolve tempo não serve a este sistema por melhor que transcreva — medido em `ARCHITECTURE.md` §4.2.1
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
:Pessoa, :Projeto, :Objetivo,   — todos carregam também :Entidade
:Organizacao                    — status ∈ ativa|fundida
                                — perfil: contexto, pode_ajudar_com, fizemos_juntos
                                — resumo (≤500), aliases (lista), canonico (bool)
:Atomo                          — tipo ∈ FATO|OPINIAO|SENTIMENTO|APRENDIZADO|
                                         CONQUISTA|DECISAO|HISTORIA|ROTINA
                                — HISTORIA entrou na 007: pede o episódio com
                                  detalhe, não a afirmação destilada
:Sessao
:Conversa                       — metadado de aplicação, sem elo com o grafo
                                — titulo, criado_em, atualizada_em,
                                  arquivada_em (null = ativa), mensagens_key

(:Sessao)-[:GEROU]->(:Atomo)
(:Atomo)-[:SOBRE]->(:Entidade)          // 1, sujeito principal
(:Atomo)-[:MENCIONA]->(:Entidade)       // 0..n
(:Atomo)-[:PERFILA { campo }]->(:Entidade)  // campo ∈ contexto|pode_ajudar_com|fizemos_juntos
(:Atomo)-[:ATUALIZA|:CONTRADIZ|:CONFIRMA|:COMPLEMENTA]->(:Atomo)
(:Entidade)-[:FUNDIDA_EM]->(:Entidade)  // fusão de duas entidades REAIS
                                        // grafia de STT é item de `aliases`
(:Entidade)-[:DISTINTA_DE]->(:Entidade) // recusa minha: não propor de novo
```

**Não há aresta semântica entre duas entidades.** As duas acima são escrituração
de identidade, não sentido: uma pessoa se liga a um projeto apenas **através dos
átomos que mencionam os dois**. Quem quiser "quem está envolvido no projeto X"
faz co-ocorrência sobre `:SOBRE`/`:MENCIONA`, não travessia.

Já foram desenhados e **nunca existiram** — nem migration, nem código:
`:Foco`, `:Pergunta`, `(:Projeto)-[:CONTRIBUI_PARA]->(:Objetivo)`,
`(:Pessoa)-[:ENVOLVIDA_EM]->(:Projeto)`, `(:Foco)-[:APONTA_PARA]->(:Entidade)`.
Ficam registrados aqui como intenção, e não como contrato. Enquanto não houver
migration, **não escrever Cypher que os atravesse**: a consulta não erra, volta
vazia — que é pior, porque parece resposta.

Propriedades em português (`nome`, `criado_em`, `valido_em`, `texto`), IDs em `id`.

**Mudança de schema = nova migration numerada (`002_...cypher`), proposta e aprovada
por mim.** Nunca alterar schema direto no código ou no console do Aura.

**Onde a migration roda:** no build da Vercel (`vercel.json`, `pnpm migrate && next
build`), contra o banco do ambiente daquele deploy. A aprovação é o ato de mandar
buildar o commit que contém a migration — não há passo manual separado, e não pode
haver: migration que dependesse da minha memória entre o push e o deploy seria
descoberta em produção, gravando. Migration que falha derruba o build e o deploy não
vai ao ar, que é a única rede que existe aqui (não há CI).

Localmente, `pnpm migrate:dev` continua sendo o caminho para o banco de
desenvolvimento, e `pnpm migrate` a saída de emergência contra produção.

## Regras invioláveis

1. Áudio nunca passa por Vercel Function. Cliente pega presigned URL e faz PUT direto no R2.
2. Texto de transcrição e manifest de chunks ficam no R2. No Neo4j vai só a chave.
3. Nenhuma chave de servidor em componente client. Sem `NEXT_PUBLIC_` para segredo.
4. Todo passo do pipeline é idempotente, chaveado por `sessao_id` (+ `chunk_index` quando aplicável). Retry não pode duplicar átomo.
5. Nada é gravado no grafo antes da minha confirmação na tela de revisão.
6. Deleção é soft: `status = 'rejeitado' | 'arquivado'`. Nunca `DELETE` em átomo.
   **A única exceção é `:Conversa`** (slice 6): ela não é conhecimento, é a
   transcrição de uma pergunta que eu fiz a uma tela, nada do grafo depende dela,
   e o chat tem as duas ações por pedido meu — arquivar congela, apagar apaga o nó
   e o objeto no R2. Nenhum outro label ganha essa exceção sem eu aprovar.
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
- Qualidade de extração eu avalio à mão, na tela de revisão, sessão real por sessão real. Não existe gabarito rotulado, arquivo de fixture nem percentual de recall — não inventar nenhum dos três. Quando a saída está ruim, o que se ajusta é o prompt, e quem diz que está ruim sou eu.

## Variáveis de ambiente

```
NEO4J_QUERY_URL, NEO4J_USER, NEO4J_PASSWORD
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
AI_GATEWAY_API_KEY        única chave de modelo — STT, extração, resolução, desempate, perfil, enriquecimento, deduplicação, calibração, redação, embedding, confronto, chat, título
STT_MODEL                 opcional; padrão xai/grok-stt
EXTRACAO_MODEL            opcional; padrão deepseek/deepseek-v4.1-flash
DUPLICATAS_MODEL          opcional; padrão deepseek/deepseek-v4.1-flash
RESOLUCAO_MODEL           opcional; padrão igual ao da extração
DESEMPATE_MODEL           opcional; padrão igual ao da resolução
PERFIL_MODEL              opcional; padrão igual ao da extração
ENRIQUECIMENTO_MODEL      opcional; padrão igual ao da extração
CALIBRACAO_MODEL          opcional; padrão igual ao da extração
REDACAO_MODEL             opcional; padrão igual ao da calibração
CONFRONTO_MODEL           opcional; padrão igual ao da extração
CHAT_MODEL                opcional; padrão deepseek/deepseek-v4.1-flash, próprio desde a slice 9
CHAT_TITULO_MODEL         opcional; padrão igual ao do chat
EMBEDDING_MODEL           opcional; padrão openai/text-embedding-3-small — TEM que ser de 1536 dimensões
AUTH_SECRET, ALLOWED_EMAIL
RESEND_API_KEY            entrega do magic link
CRON_SECRET               o que a Vercel manda no header da batida diária
```

Chave de provedor (`OPENAI_API_KEY`, `XAI_API_KEY`, `STT_API_KEY`, `LLM_API_KEY`…)
não existe neste sistema — ver regra inviolável 8. `RESEND_API_KEY` não é uma
delas: a regra 8 governa tráfego de **modelo**, e e-mail não é modelo.

Dois ambientes, e a precedência do Next resolve qual vale:
`.env.development.local` (Aura e bucket de desenvolvimento) vence `.env.local`
(produção) quando `pnpm dev` roda. Variável que faltar no arquivo de dev **vaza do
de produção** — os três do Neo4j e o `R2_BUCKET` têm que estar todos lá.
