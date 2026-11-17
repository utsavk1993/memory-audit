# Security policy

Memory Audit reads and can rewrite files in your `~/.claude` folder, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/utsavk1993/memory-audit/security/advisories/new).

Include what you found, how to reproduce it, and what an attacker could do with it. You should get a reply within a week.

## Supported versions

Only the latest release gets security fixes.

## How the app protects your files

Useful context when you're judging whether something is a vulnerability:

- **Local only.** The server binds to `127.0.0.1`. Every `/api` request with a non-local `Host` header is refused, which blocks DNS rebinding.
- **No cross-site writes.** Endpoints that write files or call an AI model need a same-origin `Origin` header and a custom `x-memory-audit` header. A cross-site request with a custom header triggers a CORS preflight, which the server never approves.
- **No framing.** Pages are served with `X-Frame-Options: DENY` and `frame-ancestors 'none'`, so another site can't trick you into clicking through a hidden frame.
- **Contained paths.** Project, note, session and backup names are checked as single path segments, so they can't reach outside `~/.claude/projects` or the backup folder.
- **Safe writes.** A write is refused if the note changed since you opened it, and the old version is always backed up first. `--readonly` turns writes off entirely.
- **Nothing leaves your machine** unless you click the AI check, and then only that one note and the related log excerpts.
