import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Everything that runs on the server or touches your files. The React UI (components/, app/page.tsx,
      // app/layout.tsx and the useJson hook) and the Node launcher scripts (bin/, scripts/) aren't measured.
      include: ["lib/**/*.ts", "app/api/**/*.ts", "proxy.ts"],
      exclude: ["lib/claude-code/useJson.ts", "**/types.ts"],
      reporter: ["text", "html", "json-summary"],
      // CI fails if any of these drop below 100%.
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
