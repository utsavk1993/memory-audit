<img src="public/logo.svg" width="64" alt="">

# Memory Audit

**Find the notes your AI agent shouldn't trust.**

Claude Code keeps long-term memory as small Markdown notes (`~/.claude/projects/<project>/memory/`). Every new session loads them and treats them as true. Some aren't: the agent guessed, misunderstood, or the facts changed later. Nothing checks them.

Memory Audit checks each note against your own session logs, shows the evidence line by line, and helps you fix what's wrong. It runs on your machine.

```bash
npx memory-audit
```

This opens http://127.0.0.1:3210. You need Node 20.9 or newer.

## What it does

1. **Browse.** Every Claude Code project, with its memory notes and the full conversation logs. "Written in" on a note links to the conversation that wrote it.
2. **Quick checks (no AI).** Plain rules that run automatically on your machine in about a second. They don't judge whether a note is true; they spot warning signs that tell you which notes deserve a closer look. Each note gets a badge:
   - **Not loaded.** The note isn't listed in `MEMORY.md`, so new sessions never see it. Also catches broken links in the index, and an index longer than the 200 lines Claude Code loads.
   - **No evidence left.** The conversation that wrote the note has been deleted. Claude Code removes logs after 30 days, but notes stay forever.
   - **Old.** The note hasn't changed in 30+ days, but newer conversations have happened since.
   - **Broken references.** The note mentions files or folders that no longer exist.
   - **Possibly corrected.** After the note was written, you said something like "no longer", "that's wrong" or "switched to" about the same topic.
   - **Hygiene.** Missing name or description, empty notes, near-duplicates.
3. **AI check.** The verdict. An AI model (Claude or NVIDIA Nemotron) reads the note and the related parts of your logs, then rates each claim as supported, out of date, wrong, or unverified. It cites session and line for every claim, and drops any citation that doesn't exist. You see what will be sent before it runs, and the app shows whether it is connected to your Claude account. Results are saved, so you don't pay twice.
4. **Fix.** Apply the AI's suggested fix, mark the note as unverified, or edit it by hand. You always review a diff first. Every save makes a backup in `~/.memory-audit/backups`, and **Undo** restores it.

## Use it from Claude Code (plugin)

The same audit also works without leaving your Claude Code session. Use whichever you prefer: the plugin and the web app share the same checks, saved results and backups. A note checked in chat shows its verdict in the web app, and a fix made in chat can be undone from either one.

| Command | What it does |
|---|---|
| `/memory-audit:audit` | Quick checks for the current project. Lists flagged notes and offers the one-step index fixes. |
| `/memory-audit:check <note>` | AI check in the chat. Claude reads the note plus the related log excerpts, rates each claim with cited log lines, saves the verdict, and shows a fix as a diff. Writes only after you say yes. |
| `/memory-audit:audit ui` | Starts the web app in the background and prints its link. |

You can also just ask ("are my memory notes still right?") and Claude picks the right one.

**Install** by typing this at the Claude Code prompt:

```
/plugin install memory-audit --marketplace utsavk1993/memory-audit
```

Answer `y` to add the marketplace, then pick a scope. From a local checkout, `claude plugin marketplace add ./` in the repo root works too.

To try it without installing, start Claude Code with `claude --plugin-dir ./plugin`.

**What the in-chat check sends.** Nothing goes to a new party. Claude in your current session does the check, so the note and its log excerpts go to Anthropic, which already received them, and they also end up in this session's own log. The check uses your normal Claude Code usage.

**The same commands in a terminal.** The plugin's CLI also works directly: `npx memory-audit check`, `evidence <note>`, `apply <note> <file> --sha <hash>`, `undo <note>`, `add-to-index <note>`, `remove-broken-links`, `ui`. Run `npx memory-audit help` for the full list.

## AI check setup

The AI check is the only feature that sends data off your machine, and it only runs when you click it.

**Default: your Claude Code account.** If Claude Code is installed and you're signed in, there's nothing to set up and no API key. The app runs `claude -p` in a locked-down mode: no tools, no file access, no plugins, hooks or MCP servers, an empty working folder, and no session log saved. Claude only sees the note plus the related log excerpts (at most about 40k tokens). Those excerpts go to Anthropic, which already received them when the conversations happened. Usage counts toward your Claude plan.

**Optional: API keys.** To use an API key instead (or if Claude Code isn't installed), set one of these and pick it with `MEMORY_AUDIT_PROVIDER`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # Claude (default model claude-opus-5-5)
# or
export NVIDIA_API_KEY=nvapi-...       # NVIDIA (default model nvidia/nemotron-3-super-120b-a12b)
npx memory-audit
```

When running from source, you can put the key in `.env.local` instead. `MEMORY_AUDIT_PROVIDER` can be `claude-code` (the default when installed), `anthropic` or `nvidia`. NVIDIA is a third party that hasn't seen your logs before, so the app warns you before sending to it.

## Safety

- **Local only.** The server binds to `127.0.0.1` and rejects requests whose Host isn't local, which blocks DNS rebinding.
- **No silent writes.** Endpoints that write files or spend money only accept requests from the app's own page: same origin plus a custom header. A write is refused if the note changed on disk since you opened it.
- **Contained.** It can only read inside the projects folder and only write `.md` files in a project's `memory/` folder.
- **Read-only mode.** `npx memory-audit --readonly` disables all writes.

## Options

| Flag / variable | Default | |
|---|---|---|
| `--port <n>` | `3210` | Port |
| `--no-open` | | Don't open the browser |
| `--readonly` | | Never write to memory |
| `ANTHROPIC_API_KEY` | | AI check with Claude |
| `NVIDIA_API_KEY` | | AI check with NVIDIA |
| `MEMORY_AUDIT_PROVIDER` | `claude-code` if installed | `claude-code`, `anthropic` or `nvidia` |
| `MEMORY_AUDIT_CLAUDE_MODEL` | your Claude Code default | Model for the Claude Code provider, e.g. `opus` |
| `MEMORY_AUDIT_CLAUDE_BIN` | found automatically | Path to the `claude` command |
| `MEMORY_AUDIT_MODEL` | `claude-opus-5-5` | Claude model |
| `MEMORY_AUDIT_NVIDIA_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | NVIDIA model |
| `MEMORY_AUDIT_CLAUDE_DIR` | `~/.claude/projects` | Where to read projects from |
| `MEMORY_AUDIT_BACKUP_DIR` | `~/.memory-audit/backups` | Where backups go |
| `MEMORY_AUDIT_DATA_DIR` | `~/.memory-audit/results` | Where AI results are cached |

## Develop

```bash
npm install
npm run dev        # http://127.0.0.1:3210
npm run typecheck && npm run lint
npm run build && npm start
npm run build:plugin   # rebuild plugin/dist/cli.mjs after changing lib/
```

Code map:

| Path | What it does |
|---|---|
| `lib/claude-code/reader.ts` | Reads projects, notes and session logs. Read-only. |
| `lib/audit/checks.ts` | The quick checks (no AI) |
| `lib/audit/evidence.ts` | Gathers evidence for one note, the audit instructions, citation checking, saved results. Shared by the web app and the plugin. |
| `lib/audit/ai.ts` | The web app's AI check: calls Claude Code, Claude or NVIDIA |
| `lib/cli/main.ts` | Headless CLI. `npm run build:plugin` bundles it into `plugin/dist/cli.mjs`. |
| `plugin/` | The Claude Code plugin: two skills plus the bundled CLI. `.claude-plugin/marketplace.json` lists it. |
| `lib/audit/writer.ts` | The only code that writes: hash check, backup, restore |
| `proxy.ts`, `lib/claude-code/respond.ts` | Localhost and same-origin guards |
| `components/explorer/` | The UI |

## Roadmap

- More providers: other agents that keep file-based memory.
- Scheduled audits ("dreaming"): re-check notes after each session.
- An optional hosted mode that takes uploaded memory files.

## License

MIT
