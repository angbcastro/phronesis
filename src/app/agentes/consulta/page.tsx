import { Agentes } from "@/components/Agentes";

/**
 * O caminho de sair: da minha pergunta até a resposta.
 *
 * Rota própria, e não aba por estado, para o botão de voltar do navegador
 * funcionar e para eu poder guardar a que uso mais.
 */
export default function PaginaAgentesConsulta() {
  return <Agentes fluxo="consulta" />;
}
