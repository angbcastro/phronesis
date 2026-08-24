/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // O prompt do STT é lido em runtime de config/vocabulario.txt; sem isto
  // o arquivo não vai junto na função em produção.
  outputFileTracingIncludes: {
    "/api/sessoes/[id]/chunks/[i]/pronto": ["./config/vocabulario.txt"],
    "/api/sessoes/[id]/finalizar": ["./config/vocabulario.txt"],
  },
};

export default nextConfig;
