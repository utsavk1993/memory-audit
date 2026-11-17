// Writes the made-up project the hosted demo reads (demo/projects) and the saved AI answers it replays
// (demo/ai-results.json). Run `node scripts/make-demo-data.mjs` after changing anything here; the output is committed.
//
// The AI answers cite log lines by label, so the line numbers stay right when a conversation below is edited.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "demo");
const PROJECT = "-Users-dev-acme-storefront";
const CWD = "/Users/dev/acme-storefront";
const MEM = `/Users/dev/.claude/projects/${PROJECT}/memory`;

const note = (name, description, type, body, extra = "") =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}metadata:\n  type: ${type}\n---\n\n${body.trim()}\n`;

// ───────────── Notes ─────────────

const notes = {
  "deploy-process.md": note(
    "Deploy process",
    "How to deploy the storefront to Heroku from main",
    "project",
    `
Deploy the storefront with \`npm run deploy:heroku\` from the \`main\` branch.

- Staging is the \`acme-storefront-staging\` Heroku app; production is \`acme-storefront\`.
- Run \`npm run db:migrate\` against production after each deploy.
- Deploys need the Heroku CLI logged in as the shared ops account.
`,
  ),
  "testing-preferences.md": note(
    "Testing preferences",
    "Use vitest, run the suite before every commit, no snapshot tests",
    "feedback",
    `
Run \`npm test\` (vitest) before every commit, and fix failures before moving on.

**Why:** a broken checkout test once reached production because the suite was skipped.
**How to apply:** prefer explicit assertions over snapshot tests; the user finds snapshots hard to review.
`,
  ),
  "code-style.md": note(
    "Code style",
    "Indent with tabs and use double quotes in TypeScript files",
    "feedback",
    `
Indent with tabs and use double quotes in all TypeScript files.
Prettier runs on save, so don't hand-format.
`,
  ),
  "db-conventions.md": note(
    "Database conventions",
    "Postgres through Prisma, snake_case tables, migrations reviewed before merge",
    "project",
    `
Postgres through Prisma. Tables are snake_case, models are PascalCase with \`@@map\`.
Every migration is reviewed by a second person before it merges.
`,
    "originSessionId: 6b1f0c7e-2a44-4d8e-9a51-0f3c2d9e7b10\n",
  ),
  "release-checklist.md": note(
    "Release checklist",
    "Steps before tagging a storefront release",
    "project",
    `
1. Bump the version in \`package.json\` and update CHANGELOG.md.
2. Load the release secrets from \`~/.config/acme/release.env\`.
3. Tag \`vX.Y.Z\` on main and push the tag; CI builds the release.
4. Post the changelog in #storefront.
`,
  ),
};

const index = `- [Deploy process](deploy-process.md) — how to deploy the storefront to Heroku from main
- [Testing preferences](testing-preferences.md) — vitest before every commit, no snapshot tests
- [Database conventions](db-conventions.md) — Postgres through Prisma, snake_case tables
- [Release checklist](release-checklist.md) — steps before tagging a release
- [Stripe keys](stripe-keys.md) — where the test and live keys live
`;

// ───────────── Conversations ─────────────
// Each entry becomes one line of the .jsonl log. `label` lets the AI answers below cite it.

let clock;
const tick = (minutes = 2) => {
  clock = new Date(clock.getTime() + minutes * 60_000);
  return clock.toISOString();
};
const base = (sessionId) => ({ sessionId, cwd: CWD, version: "2.4.0", gitBranch: "main" });
const user = (text) => ({ kind: "user", text });
const say = (text, label) => ({ kind: "assistant", text, label });
const write = (file, text, label) => ({ kind: "write", file, text, label });
const run = (command, description, result) => ({ kind: "bash", command, description, result });

const sessions = [
  {
    id: "1d3c9a52-7f0e-4b6a-9c11-5e2f8a4d0b37",
    title: "Set up the deploy pipeline",
    start: "2026-06-10T15:04:00Z",
    turns: [
      { ...user("Let's get deploys sorted. We're on Heroku: staging is acme-storefront-staging and prod is acme-storefront. I want one npm script that deploys main."), label: "heroku-setup" },
      say("I'll add a `deploy:heroku` script that pushes `main` to the Heroku remote, then runs migrations."),
      run("npm pkg set scripts.deploy:heroku=\"git push heroku main\"", "Add the deploy script", ""),
      { ...user("Good. And remember to run db:migrate against prod after every deploy, we forgot last time."), label: "migrate" },
      say("Got it. I'll save the deploy steps so future sessions follow them."),
      write("deploy-process.md", notes["deploy-process.md"], "write-deploy"),
      { ...user("Also save the release steps: bump version + changelog, load secrets from ~/.config/acme/release.env, tag on main, post in #storefront."), label: "release-steps" },
      write("release-checklist.md", notes["release-checklist.md"], "write-release"),
      say("Saved both notes and added them to MEMORY.md."),
    ],
  },
  {
    id: "8a7e2f10-3c5b-4d9e-b6a4-1f0c7d2e9b58",
    title: "Add checkout tests",
    start: "2026-07-15T18:20:00Z",
    turns: [
      user("The checkout flow needs tests. Use vitest like the rest of the repo."),
      run("npx vitest run test/checkout.test.ts", "Run the new checkout tests", "✓ test/checkout.test.ts (6 tests) 412ms"),
      { ...say("All 6 checkout tests pass. I used explicit assertions on the cart totals rather than snapshots."), label: "tests-pass" },
      { ...user("Perfect. Please always run the whole suite before you commit, a broken checkout test got to prod in May because someone skipped it. And no snapshot tests, I can never review those diffs."), label: "test-rule" },
      write("testing-preferences.md", notes["testing-preferences.md"], "write-tests"),
      { ...user("Also: tabs and double quotes in TS files please."), label: "tabs" },
      write("code-style.md", notes["code-style.md"], "write-style"),
      say("Saved. Prettier is set to format on save, so I won't hand-format."),
    ],
  },
  {
    id: "c4b8d1e6-9f2a-4e7c-8d35-6a1b0e9f2c74",
    title: "Move hosting to Fly.io",
    start: "2026-10-28T16:45:00Z",
    turns: [
      { ...user("Heroku is no longer how we deploy the storefront; we switched to Fly.io last week. Deploys are `fly deploy` from main now, and staging is the acme-storefront-staging Fly app."), label: "fly-switch" },
      say("Understood. I'll update the deploy scripts for Fly.io."),
      run("npm pkg delete scripts.deploy:heroku && npm pkg set scripts.deploy=\"fly deploy\"", "Replace the Heroku deploy script", ""),
      { ...say("Replaced `deploy:heroku` with `npm run deploy`, which runs `fly deploy`. Migrations now run automatically as Fly's release command, so there's no manual db:migrate step."), label: "fly-migrate" },
      user("Great. Run the tests before you commit like always."),
      run("npm test", "Run the full test suite", "Test Files  14 passed (14)\n     Tests  128 passed (128)"),
      { ...say("All 128 tests pass. Committing."), label: "suite-pass" },
      write("testing-preferences.md", notes["testing-preferences.md"]),
      { ...user("One more thing, code style reminder: we use 2 spaces, not tabs, tabs are wrong for this repo. Prettier enforces it. Double quotes are right though."), label: "spaces" },
      say("Thanks, I'll indent with 2 spaces from now on."),
    ],
  },
];

function toLines(s) {
  clock = new Date(s.start);
  const labels = {};
  const lines = [{ type: "ai-title", aiTitle: s.title, sessionId: s.id }];
  for (const t of s.turns) {
    const at = tick();
    let line;
    if (t.kind === "user") {
      line = { type: "user", ...base(s.id), timestamp: at, message: { role: "user", content: t.text } };
    } else if (t.kind === "assistant") {
      line = { type: "assistant", ...base(s.id), timestamp: at, message: { role: "assistant", content: [{ type: "text", text: t.text }] } };
    } else if (t.kind === "write") {
      line = {
        type: "assistant",
        ...base(s.id),
        timestamp: at,
        message: { role: "assistant", content: [{ type: "tool_use", id: `toolu_${lines.length}`, name: "Write", input: { file_path: `${MEM}/${t.file}`, content: t.text } }] },
      };
    } else {
      lines.push({
        type: "assistant",
        ...base(s.id),
        timestamp: at,
        message: { role: "assistant", content: [{ type: "tool_use", id: `toolu_${lines.length}`, name: "Bash", input: { command: t.command, description: t.description } }] },
      });
      line = {
        type: "user",
        ...base(s.id),
        timestamp: tick(1),
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_${lines.length - 1}`, content: t.result || "(no output)" }] },
      };
    }
    lines.push(line);
    if (t.label) labels[t.label] = lines.length; // 1-based line number in the file
  }
  return { lines, labels };
}

// ───────────── Saved AI answers ─────────────
// Same shape the model returns (lib/audit/evidence.ts `Output`). Session tags follow start time: S1, S2, S3.

const built = sessions.map(toLines);
const cite = (...refs) =>
  refs.map((r) => {
    const [tag, label] = r.split(":");
    const line = built[Number(tag.slice(1)) - 1].labels[label];
    if (!line) throw new Error(`Unknown label ${r}`);
    return { session: tag, line };
  });

const ai = {
  "deploy-process.md": {
    verdict: "outdated",
    confidence: "high",
    summary:
      "This note still describes Heroku, but on Oct 28 you said the storefront moved to Fly.io and deploys are now `fly deploy`. The manual migration step is also gone.",
    claims: [
      { claim: "Deploy with `npm run deploy:heroku` from main", status: "outdated", explanation: "True in June, but the Heroku script was replaced by `npm run deploy` (`fly deploy`) in October.", evidence: cite("S1:heroku-setup", "S3:fly-switch") },
      { claim: "Staging and production are Heroku apps", status: "outdated", explanation: "The app names are the same, but they are Fly.io apps now.", evidence: cite("S1:heroku-setup", "S3:fly-switch") },
      { claim: "Run `npm run db:migrate` against production after each deploy", status: "outdated", explanation: "Migrations now run automatically as Fly's release command.", evidence: cite("S1:migrate", "S3:fly-migrate") },
      { claim: "Deploys need the Heroku CLI logged in as the shared ops account", status: "unverified", explanation: "No conversation mentions a shared ops account.", evidence: [] },
    ],
    proposed_note: note(
      "Deploy process",
      "How to deploy the storefront to Fly.io from main",
      "project",
      `
Deploy the storefront with \`npm run deploy\` (runs \`fly deploy\`) from the \`main\` branch.

- Staging is the \`acme-storefront-staging\` Fly.io app; production is \`acme-storefront\`.
- Migrations run automatically as Fly's release command; there is no manual migrate step.
- Deploys need the Fly CLI logged in (unverified: which account).
`,
    ),
  },
  "code-style.md": {
    verdict: "contradicted",
    confidence: "high",
    summary: "You corrected this on Oct 28: the repo uses 2 spaces, not tabs. Double quotes are still right.",
    claims: [
      { claim: "Indent with tabs in TypeScript files", status: "contradicted", explanation: "You said tabs are wrong for this repo and Prettier enforces 2 spaces.", evidence: cite("S2:tabs", "S3:spaces") },
      { claim: "Use double quotes in TypeScript files", status: "supported", explanation: "Asked for in July and confirmed in October.", evidence: cite("S2:tabs", "S3:spaces") },
      { claim: "Prettier runs on save, so don't hand-format", status: "supported", explanation: "Confirmed when the note was written and again in October.", evidence: cite("S3:spaces") },
    ],
    proposed_note: note(
      "Code style",
      "Indent with 2 spaces and use double quotes in TypeScript files",
      "feedback",
      `
Indent with 2 spaces (not tabs) and use double quotes in all TypeScript files.
Prettier runs on save and enforces this, so don't hand-format.
`,
    ),
  },
  "testing-preferences.md": {
    verdict: "supported",
    confidence: "high",
    summary: "Everything here matches what you asked for, and the October session still followed it.",
    claims: [
      { claim: "Run `npm test` (vitest) before every commit", status: "supported", explanation: "You asked for this in July and again in October, when the full suite ran before committing.", evidence: cite("S2:test-rule", "S3:suite-pass") },
      { claim: "A broken checkout test once reached production because the suite was skipped", status: "supported", explanation: "Your own words in July.", evidence: cite("S2:test-rule") },
      { claim: "Prefer explicit assertions over snapshot tests", status: "supported", explanation: "You said snapshot diffs are hard to review; the checkout tests use explicit assertions.", evidence: cite("S2:tests-pass", "S2:test-rule") },
    ],
    proposed_note: "",
  },
  "release-checklist.md": {
    verdict: "unverified",
    confidence: "medium",
    summary: "The steps match what you dictated in June, but nothing since shows a release being made, so they haven't been confirmed in practice.",
    claims: [
      { claim: "Bump the version and update CHANGELOG.md", status: "supported", explanation: "You listed this step.", evidence: cite("S1:release-steps") },
      { claim: "Load release secrets from `~/.config/acme/release.env`", status: "supported", explanation: "You gave this path in June. (The quick checks report it is missing on this machine.)", evidence: cite("S1:release-steps") },
      { claim: "CI builds the release when the tag is pushed", status: "unverified", explanation: "You said to tag on main; no conversation says CI builds the release.", evidence: [] },
    ],
    proposed_note: "",
  },
  "db-conventions.md": {
    verdict: "unverified",
    confidence: "low",
    summary: "The conversation that wrote this note has been deleted and no other log mentions Prisma or migrations reviews, so none of it can be checked.",
    claims: [
      { claim: "Postgres through Prisma with snake_case tables", status: "unverified", explanation: "No remaining log mentions the database setup.", evidence: [] },
      { claim: "Every migration is reviewed by a second person", status: "unverified", explanation: "Not mentioned in any remaining log.", evidence: [] },
    ],
    proposed_note: "",
  },
};

// ───────────── Write it all ─────────────

rmSync(ROOT, { recursive: true, force: true });
const projectDir = path.join(ROOT, "projects", PROJECT);
mkdirSync(path.join(projectDir, "memory"), { recursive: true });
writeFileSync(path.join(projectDir, "memory", "MEMORY.md"), index);
for (const [file, raw] of Object.entries(notes)) writeFileSync(path.join(projectDir, "memory", file), raw);
sessions.forEach((s, i) => writeFileSync(path.join(projectDir, `${s.id}.jsonl`), built[i].lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));
writeFileSync(path.join(ROOT, "ai-results.json"), JSON.stringify(ai, null, 2) + "\n");
console.log(`Wrote ${Object.keys(notes).length} notes, ${sessions.length} sessions and ${Object.keys(ai).length} AI answers to ${ROOT}`);
