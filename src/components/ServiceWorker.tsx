"use client";

import { useEffect } from "react";

/**
 * Registra `public/sw.js`. Não desenha nada.
 *
 * Existe só para o Chrome no Android oferecer a instalação na tela inicial —
 * é o critério que faltava, ao lado dos ícones PNG (ver `public/sw.js`).
 * Instalado, o app abre em `standalone` direto no botão de gravar, sem barra
 * de endereço e sem aba, que é o que o ritual de abrir e falar pede.
 *
 * Falha de registro é engolida: navegador que não registra service worker
 * continua servindo o app inteiro pela aba. O que se perde é a instalação, não
 * o diário.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
