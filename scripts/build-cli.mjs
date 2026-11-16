// Bundle the headless CLI (lib/cli/main.ts) into one file the Claude Code plugin ships with: no Next, no node_modules.
import { build } from "esbuild";

await build({
  entryPoints: ["lib/cli/main.ts"],
  outfile: "plugin/dist/cli.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: true,
  legalComments: "eof",
  banner: { js: "#!/usr/bin/env node\n// Memory Audit CLI, bundled from lib/cli/main.ts by scripts/build-cli.mjs. Don't edit." },
  logLevel: "info",
});
