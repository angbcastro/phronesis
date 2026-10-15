"use client";

import { useState } from "react";

export default function Entrar() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  async function pedir(e: React.FormEvent) {
    e.preventDefault();
    if (pedindo) return;
    setPedindo(true);
    setFalhou(false);
    // Sem rede o `fetch` rejeita, e a rejeição solta não dizia nada na tela.
    // A resposta do servidor é a mesma nos três caminhos (§7) — só a falta dela
    // é que se diz aqui.
    const r = await fetch("/api/auth/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    setPedindo(false);
    if (!r) {
      setFalhou(true);
      return;
    }
    const d = (await r.json().catch(() => ({}))) as { link?: string };
    setLink(d.link ?? null);
    setEnviado(true);
  }

  return (
    <main className="tela">
      {enviado ? (
        <div className="entrar">
          <p className="aviso">se esse e-mail for o certo, o link está a caminho</p>
          {link && (
            <p className="aviso">
              <a href={link}>entrar agora</a> (dev)
            </p>
          )}
        </div>
      ) : (
        <form className="entrar" onSubmit={pedir}>
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            aria-label="e-mail"
            placeholder="seu e-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={pedindo}>
            {pedindo ? "pedindo…" : "receber link"}
          </button>
          {falhou && (
            <p className="aviso erro" role="alert">
              não consegui falar com o servidor — confira a rede e tente de novo
            </p>
          )}
        </form>
      )}
    </main>
  );
}
