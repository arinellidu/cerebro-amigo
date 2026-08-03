import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    globals: true,
    // node por padrão (motor de escalas/fluxo); testes de componente declaram
    // `// @vitest-environment jsdom` no topo do arquivo.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
