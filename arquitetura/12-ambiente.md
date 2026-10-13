## 12. Ambiente

`next build` precisa de **rede**: `next/font/google` busca Inter e
Nunito na hora da build para servi-las do próprio domínio (§11.3). Em tempo de
execução não há requisição a terceiros.

### 12.1 Produção, e os dois bancos

O sistema roda na Vercel, plano Hobby, em **`https://phronesis-ang.vercel.app`**,
a partir do repositório privado `angbcastro/phronesis`. `phronesis-ashy.vercel.app`
foi o primeiro endereço e hoje **redireciona** para o canônico (307, que preserva
método e corpo) — ele continua na política de CORS porque um link velho aberto no
celular passa por lá antes de chegar aqui. Push em `master` vai a
produção direto: **não há CI**, e a única rede é o `buildCommand` (abaixo)
derrubar o deploy quando a migration falha.

**O que só produção responde está conferido:** a migration roda no build e é
idempotente no deploy seguinte; o middleware **lê os segredos no Edge** — cookie
forjado e `Bearer` errado forçam a leitura de `AUTH_SECRET` e `CRON_SECRET` e
voltam 307 e 401, não 500; o Resend entrega o link; e a batida diária escreve o
dump do grafo no R2.

**Os 300 s de `maxDuration` cabem no Hobby.** Com Fluid Compute — ligado por
padrão em projeto novo — o Hobby tem 300 s de padrão *e* de máximo, que é o teto
das rotas pesadas (§10) e o que cobre os `waitUntil(passadaDeVetores(...))` das
rotas de `/entidades`. Nada aqui pede plano pago. A **região da função**
acompanha a da instância Aura: cada requisição do pipeline faz várias idas à
Query API, e região trocada multiplica isso por round-trip.

```json
// vercel.json
{ "buildCommand": "pnpm migrate && next build",
  "crons": [
    { "path": "/api/cron/diario", "schedule": "0 6 * * *" },
    { "path": "/api/cron/confronto", "schedule": "0 5 * * *" },
    { "path": "/api/cron/enriquecimento", "schedule": "0 7 * * 1" }
  ] }
```

**O Hobby aceita as três entradas de cron** (`vercel crons ls` lista as três).
Se um dia o plano recusar uma quarta, o build falha antes de subir, e o caminho
é dobrar a batida nova dentro do `/cron/diario`, checando o dia da semana.

**A migration roda no build**, contra o banco do ambiente daquele deploy, e a
aprovação é o ato de mandar buildar o commit que a contém (`CLAUDE.md`).
Versionado, e não escondido no painel: o comando que aplica schema em produção tem
de estar à vista. `scripts/migrate.ts` é TypeScript rodado direto pelo node, por
type stripping — daí `engines.node: ">=22.6"` no `package.json`.

Dois bancos e dois buckets, e a precedência do Next decide qual vale sem ninguém
precisar lembrar:

| Arquivo | Aponta para | Quem lê |
|---|---|---|
| `.env.development.local` | Aura **dev** + bucket **dev** | `pnpm dev` (precedência) e `pnpm migrate:dev` |
| `.env.local` | **produção** | `pnpm migrate` e `pnpm smoke` — a saída de emergência |

O Next mescla por chave, então **variável que faltar no arquivo de dev vaza do de
produção**: os três do Neo4j e o `R2_BUCKET` têm de estar todos no de dev, ou
`pnpm dev` escreve no diário de verdade com a senha certa. Na Vercel o mesmo
cuidado é o **escopo** da variável: Neo4j e R2 de produção só em Production, os de
dev em Preview/Development — com migration rodando no build, escopo errado faz um
preview migrar produção.

```
NEO4J_QUERY_URL, NEO4J_USER, NEO4J_PASSWORD
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
AI_GATEWAY_API_KEY
AUTH_SECRET, ALLOWED_EMAIL
RESEND_API_KEY            entrega do magic link (§7) — não é chave de modelo
CRON_SECRET               o header das batidas agendadas, e o da continuação da semanal (§7, §10)
```

```
NEO4J_QUERY_URL, NEO4J_USER, NEO4J_PASSWORD
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
AI_GATEWAY_API_KEY        única chave de modelo — STT, extração, resolução, desempate, perfil, enriquecimento, retrato, deduplicação, embedding, calibração, redação, confronto, chat, título
STT_MODEL                 opcional; padrão xai/grok-stt
EXTRACAO_MODEL            opcional; padrão deepseek/deepseek-v4.1-flash
DUPLICATAS_MODEL          opcional; padrão deepseek/deepseek-v4.1-flash
RESOLUCAO_MODEL           opcional; padrão igual ao da extração
DESEMPATE_MODEL           opcional; padrão igual ao da resolução
PERFIL_MODEL              opcional; padrão igual ao da extração
ENRIQUECIMENTO_MODEL      opcional; padrão igual ao da extração
RETRATO_MODEL             opcional; padrão igual ao do enriquecimento — um para os dois agentes do retrato do "eu", porque o cache do provedor é por modelo (§4.20)
CALIBRACAO_MODEL          opcional; padrão igual ao da extração
REDACAO_MODEL             opcional; padrão igual ao da calibração
CONFRONTO_MODEL           opcional; padrão deepseek/deepseek-v4.1-flash, próprio
CHAT_MODEL                opcional; padrão deepseek/deepseek-v4.1-flash, próprio — é quem precisa de tool-calling multi-passo
CHAT_TITULO_MODEL         opcional; padrão igual ao do chat
EMBEDDING_MODEL           opcional; padrão openai/text-embedding-3-small — TEM que ser de 1536 dimensões
AUTH_SECRET, ALLOWED_EMAIL
```

`env.ts` usa getters: a variável só é exigida quando alguém de fato precisa dela,
e a falta vira erro claro em vez de `undefined` silencioso.

**Três variáveis são lidas por acesso estático, e isso não é estilo.** `req()` lê
por chave dinâmica (`process.env[nome]`), o que basta em função Node — mas o
**middleware roda no Edge**, e lá o bundler só garante o que consegue ler
estaticamente. `AUTH_SECRET`, `ALLOWED_EMAIL` (que vem no mesmo getter) e
`CRON_SECRET` são lidas como `process.env.NOME` escrito por extenso, por
`exigir()`. Conferido no bundle: a forma sobrevive como acesso estático e o valor
**não** é inlinado — o segredo não viaja dentro do artefato. Uma leitura dinâmica
ali é a diferença entre o sistema responder e nada responder, sem causa visível
em lugar nenhum.

**`next.config.mjs` decide se o vocabulário chega à produção**, e por isso não é
arquivo de configuração qualquer:

```js
outputFileTracingIncludes: {
  "/api/sessoes/[id]/chunks/[i]/pronto": ["./config/vocabulario.txt"],
  "/api/sessoes/[id]/finalizar": ["./config/vocabulario.txt"],
},
```

`vocabulario.ts` lê o arquivo do bundle em runtime
(`readFile(join(process.cwd(), "config", "vocabulario.txt"))`). Sem a entrada
correspondente, o arquivo **não viaja** na função da Vercel e `doArquivo()` cai
no `catch` que devolve lista vazia: sem erro, sem log, sem nada na tela. É o
segundo caminho para o modo de falha que §4.4 e §14 descrevem como o pior deste
sistema — o vocabulário sumir sem avisar —, e ele não tem nada a ver com trocar
`STT_MODEL`.

A lista está correta hoje porque `transcrever()` só é alcançada por essas duas
rotas (`/chunks/:i/pronto` direto, `/finalizar` via `finalizarSessao`). **Uma
terceira rota que chame o STT perde o arquivo em silêncio**, e não há teste que
cubra isso.

**`/agentes` fica por cima destas variáveis** (§4.13): o modelo
escolhido no painel vence a variável de ambiente, que por sua vez vence o padrão.
A validação é a mesma nos três caminhos — `validarIdDeModelo`, string
`provedor/modelo`, pelo Gateway. `EMBEDDING_MODEL` é a exceção e continua sendo
só variável: a dimensão está declarada na migration 006.

Não há chave de provedor (`OPENAI_API_KEY`, `XAI_API_KEY`, `STT_API_KEY`,
`LLM_API_KEY`…) — seção 4.2. `tests/gateway.test.ts` também confere isso no
`.env.example`, para o arquivo não voltar a oferecer o que a arquitetura proíbe.

