---
name: audit
description: Run Memory Audit's quick checks on this project's Claude Code memory notes (the files in ~/.claude/projects/<project>/memory/) and list the ones with warning signs, or open the Memory Audit web app. Use when the user asks to audit, review or clean up their memory notes, asks whether their memory is stale or wrong, or asks to open the memory audit UI.
argument-hint: "[ui]"
---

# Memory Audit: quick checks

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs"`. It reads the project for the current folder; add `--project <id-or-path>` only if the user names another project.

## If the argument is `ui`

Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" ui` and give the user the URL it prints. It starts the web app in the background (or finds it already running). Don't open a browser or drive one yourself; the user opens the link. If it fails, show the error and the log path it names.

## Otherwise: run the quick checks

1. Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" check`.
2. Report the result briefly, most serious first:
   - **MEMORY.md problems** (missing index, links to missing notes, index too long).
   - **Each flagged note**: its file name and its warning signs in plain words. Quote the evidence line when the CLI shows one ("possibly corrected" findings come with the user's own words).
   - Then one line for how many notes have no warning signs, and any earlier AI check verdicts the output shows.
   Don't paste the raw output; summarise it.
3. Say plainly that quick checks only spot warning signs. Whether a note is actually true needs an AI check.
4. Offer next steps that fit what was found:
   - For a flagged note: check it against the logs in this chat with `/memory-audit:check <note>`.
   - For a finding marked `(fix: add-to-index)`: offer to run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" add-to-index <note>`.
   - For `(fix: remove-broken-links)`: offer to run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" remove-broken-links`.
   - To browse everything with the evidence side by side: `/memory-audit:audit ui`.

Run a fix only after the user says yes. Every fix backs up the file first, and `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" undo <note>` (or Undo in the web app) puts it back. Don't edit memory files with Edit or Write here: the CLI's writes are the ones that make a backup and refuse to overwrite a newer change.
