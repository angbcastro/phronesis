# Documentação — o ARCHITECTURE.md volta a ser um mapa

**Objetivo:** que o `ARCHITECTURE.md` descreva **como o sistema funciona hoje**,
completo e sem se contradizer, num tamanho que se lê. A crônica de como ele
chegou aqui não se perde: vai para a spec da fatia que a produziu.

**Pronto quando:**

1. O `ARCHITECTURE.md` tem ≤ 50 KB e é um mapa: estado das fatias, topologia,
   módulos, fronteira de segurança, índice dos capítulos e manutenção.
2. Cada capítulo de `arquitetura/` tem ≤ 120 KB, está no presente e não traz
   data, ID de sessão nem andamento.
3. Toda referência `§x.y` de `src/`, `tests/`, `db/` e `Specs/` continua
   apontando para um cabeçalho que existe.
4. `tests/arquitetura.test.ts` roda no `pnpm test` e está verde.
5. Eu leio o mapa inteiro e um capítulo e reconheço o sistema.

## Por que agora

O arquivo passou de 500 KB (~7.800 linhas, ~130k tokens). Cada fatia acrescentou
descrição, motivo, crônica (datas, IDs de sessão, "antes era assim") e andamento
("não verificada", "falta medir"), e nunca tirou nada. Ele não cabe numa
leitura, então a leitura obrigatória do `CLAUDE.md` não tem como ser cumprida.
E já se contradiz: o chat aparece com "duas" e "quatro" ferramentas no mesmo
cabeçalho. O §14 sozinho tem 64 KB, e o §4 tem 211 KB sob o título
"Transcrição", que não diz mais o que tem dentro.

## As decisões

Tomadas por entrevista em 30/09 e 12/10.

- **A crônica vai para a spec da fatia**, numa seção **"Como ficou"** no fim de
  cada `Specs/slice-N.md`, movida quase literal. *Recusado:* apagar a crônica
  (é o único registro do porquê de várias escolhas) e um `HISTORICO.md` único
  (viraria o mesmo diário em outro lugar).
- **Mapa + capítulos.** O `ARCHITECTURE.md` vira o mapa, e as seções grandes
  viram arquivos em `arquitetura/`, **com a numeração §x.y preservada**.
  *Recusado:* renumerar, porque há centenas de referências `§` no código.
- **O andamento vai para o `PROXIMOS-TESTES.md`**, que já existe para isso. O
  mapa diz só se cada fatia está no ar. *Recusado:* uma tabela de verificação no
  mapa, que poria o mesmo andamento em dois lugares.
- **Um teste de inventário** cobra que nada do sistema fique sem texto, como o
  `tests/gateway.test.ts` cobra a porta única.

## Para onde vai cada tipo de informação

| O que é | Exemplo | Destino |
|---|---|---|
| Descrição do que existe | fluxo, contrato, chave do R2 | fica no capítulo, no presente |
| Motivo vivo | por que é assim, o que foi recusado | fica, curto |
| Crônica | datas, IDs de sessão, "até a 4.x era", "subiu de A para B", prompts antigos | "Como ficou" da spec da fatia |
| Andamento | "construída, não verificada", "falta medir" | `PROXIMOS-TESTES.md`, na seção da fatia, se ainda não estiver lá |
| Limite aberto | o que o sistema não faz ou faz mal hoje | §14, agrupado pelo § que ele limita |
| Limite resolvido | "resolvido na 8.1" | "Como ficou" da fatia que resolveu |
| Contradição | "duas" vs "quatro" ferramentas | resolvida pelo código e listada no commit |

## A forma final

```
ARCHITECTURE.md            o mapa (≤ 50 KB)
  - estado: fatia | no ar, e o link para PROXIMOS-TESTES.md
  - §1 topologia, §2 mapa dos módulos, §7 fronteira de segurança
  - índice: número, arquivo, o que cobre
  - manutenção (curta, apontando para o CLAUDE.md)
arquitetura/
  03-audio.md               §3
  04-pipeline.md            §4.1–4.7
  04.08-identidade.md       §4.8, 4.8.1, 4.10, 4.14
  04.09-ficha-e-retrato.md  §4.9, 4.20
  04.11-calibracao.md       §4.11–4.13
  04.15-confronto.md        §4.15
  04.16-chat.md             §4.16
  04.17-desempenho.md       §4.17–4.19
  05-estados.md  06-idempotencia.md  08-grafo.md  09-r2.md  10-rotas.md
  11-telas.md    12-ambiente.md      13-verificacao.md        14-limites.md
```

Os cabeçalhos `##`, `###` e `####` ficam idênticos dentro dos capítulos. O
`## 4.` ganha um título que diga o que cobre, mas o número continua o mesmo.

## Regras de escrita

Valem para todo capítulo. As cinco primeiras entram no `CLAUDE.md` no passo 5.

1. **Presente do indicativo.** O texto descreve o que existe.
2. **O motivo fica, curto:** por que é assim e o que foi recusado.
3. **A crônica sai** para o "Como ficou" da fatia.
4. **O andamento sai** para o `PROXIMOS-TESTES.md`.
5. **Limite resolvido sai** do §14 para o "Como ficou".
6. **Contradição se resolve pelo código.** Quando o código contradiz o
   documento, o errado é o documento. Cada correção é listada no corpo do commit.
7. **O §8 se organiza por label e aresta.** A migration aparece como a origem de
   cada propriedade.
8. **O §13 encolhe** para o que não se descobre lendo `tests/`.

## Ordem de execução

Cada passo é um commit. Nenhum `push` acontece sem eu pedir.

0. **Terreno.** Árvore limpa e tag `antes-da-documentacao`.
1. **Esta spec.**
2. **O teste de inventário, em `describe.skip`.** `tests/arquitetura.test.ts`,
   no molde das varreduras de `tests/gateway.test.ts`. Ele lê o mapa e os
   capítulos e cobra:
   - todo arquivo de `src/lib`, `src/client` e `src/components` citado no §2;
   - toda `route.ts` de `src/app/api` citada no §10;
   - todo `id` de `AGENTES` citado;
   - toda `process.env.X` citada no §12, exceto `NODE_ENV`;
   - toda migration de `db/migrations/` citada no §8;
   - todo `§x.y` citado no código e nas specs existindo como cabeçalho;
   - os limites de tamanho;
   - nenhuma data nem ID de sessão no mapa e nos capítulos.
3. **A divisão mecânica, sem mudar uma palavra.** Concatenar mapa e capítulos
   reproduz o arquivo antigo, fora as linhas do índice.
4. **A limpeza, um capítulo por commit:** mapa → §14 → §8 → os sete do §4 → §5,
   §6, §9, §10, §11, §12, §13, §3. Em cada capítulo:
   - aplicar as regras de escrita;
   - levar a crônica para o "Como ficou" da fatia no mesmo commit (a fatia vem
     do marcador `(slice N)` ou de `git log -S`);
   - levar o andamento para o `PROXIMOS-TESTES.md`;
   - ler os módulos do capítulo e completar o que o código faz e o texto não
     diz;
   - fechar os itens do inventário daquele capítulo.
5. **A regra muda junto.**
   - `CLAUDE.md`: a leitura obrigatória vira "o mapa + o capítulo que a tarefa
     toca"; entram as regras 1–5, o "Como ficou" ao fechar uma slice e o teste
     como guarda.
   - A manutenção do mapa repete a regra, curta.
   - O teste entra no `pnpm test`, verde.

## Verificação

- **Passo 3:** a concatenação dos capítulos é igual ao arquivo antigo.
- **Passo 4, por capítulo:** toda linha removida aparece como adicionada em
  `Specs/` ou em `PROXIMOS-TESTES.md`, ou está na lista de contradições do
  commit. A conferência é um script sobre `git diff`.
- **Passo 5:** `pnpm test` e `pnpm typecheck` verdes.
- **À mão:** eu leio o mapa e um capítulo.

## Fora de escopo

- Mudar código para casar com o documento. Se o código parecer errado, isso vira
  item listado, não conserto.
- Reescrever as specs antigas além de acrescentar o "Como ficou".
- Gerar documentação a partir do código.
