/**
 * Service worker de passagem — existe para o Chrome oferecer a instalação.
 *
 * O Android só monta o WebAPK (ícone na tela inicial, abertura em
 * `standalone`, sem barra de endereço) quando há um service worker registrado
 * **com handler de `fetch`**. Este é o handler mínimo que satisfaz isso.
 *
 * **Não cacheia nada, de propósito.** A promessa deste sistema sobre rede é
 * "não perder o que já gravei", e quem a cumpre é o IndexedDB do navegador
 * (ARCHITECTURE §3.2): o bloco fica lá até o PUT confirmar. Cachear as telas
 * traria problemas que hoje não existem — resposta autenticada guardada em
 * disco, versão velha da revisão sobrevivendo a um deploy, invalidação a
 * inventar — sem entregar nada que o IndexedDB já não entregue.
 *
 * Se um dia houver cache offline, ele começa aqui, e aí `sw.js` deixa de ser
 * este arquivo de nove linhas e vira fatia com spec própria.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
