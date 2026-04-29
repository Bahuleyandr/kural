import { defineConfig } from "vitest/config";

// Vitest 4 ships with rolldown which does not parse JSX without an explicit
// transformer plugin, and the @vitejs/plugin-react family hasn't shipped a
// Vite-8-compatible release yet. We sidestep both by feeding rolldown the
// SWC-equivalent JSX runtime config it ships under `oxc`.
export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic", importSource: "react" },
  } as unknown as never,
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/**/*.spec.ts", "node_modules/**", ".next/**"],
    setupFiles: ["./tests/setup.ts"],
  },
});
