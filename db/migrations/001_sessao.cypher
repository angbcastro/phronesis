// 001 — Slice 1. Único label desta slice: :Sessao.
// Sessao é infraestrutura de gravação, não conteúdo do diário.
// Nenhum :Atomo / :Entidade aqui. Isso chega na slice 3.

CREATE CONSTRAINT sessao_id IF NOT EXISTS
FOR (s:Sessao) REQUIRE s.id IS UNIQUE;

CREATE INDEX sessao_status IF NOT EXISTS
FOR (s:Sessao) ON (s.status);

CREATE INDEX sessao_iniciada_em IF NOT EXISTS
FOR (s:Sessao) ON (s.iniciada_em);
