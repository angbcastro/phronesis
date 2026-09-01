"use client";

/**
 * A marca no canto superior esquerdo — e a porta de volta.
 *
 * Toda tela de dentro (processando, revisão, transcrição, áudios, entidades)
 * fica a um toque do início. Antes disso o caminho de volta era um "voltar"
 * no rodapé, que só existe depois de rolar a tela inteira; numa revisão longa
 * ou numa lista grande de entidades ele some do alcance.
 *
 * Não aparece em duas telas, de propósito:
 *
 * - `/` já **é** o início. Um link para si mesma seria ruído, e a tela de
 *   gravar é "um botão, um timer, um jeito de parar — idealmente nada mais"
 *   (`Specs/visao.md` §6). Nada de crônico entra ali.
 * - `/entrar` é anterior à sessão: não há para onde voltar.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Telas onde a marca não entra. Ver o comentário acima. */
export const SEM_MARCA = ["/", "/entrar"];

export const mostraMarca = (rota: string | null): boolean =>
  rota !== null && !SEM_MARCA.includes(rota);

export function Marca() {
  const rota = usePathname();
  if (!mostraMarca(rota)) return null;

  return (
    <Link className="marca" href="/" aria-label="voltar ao início">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="7" />
      </svg>
    </Link>
  );
}
