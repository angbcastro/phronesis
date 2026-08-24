"use client";

import { useState } from "react";

export default function Entrar() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  async function pedir(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/auth/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const d = (await r.json().catch(() => ({}))) as { link?: string };
    setLink(d.link ?? null);
    setEnviado(true);
  }

  return (
    <main className="tela">
      {enviado ? (
        <div className="entrar">
          <p className="aviso">Se esse e-mail for o certo, o link está a caminho.</p>
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
            placeholder="seu e-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit">receber link</button>
        </form>
      )}
    </main>
  );
}
