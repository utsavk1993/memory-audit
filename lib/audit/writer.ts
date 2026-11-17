// The only module that writes to your memory folder.
// Every write: checks the file hasn't changed since you looked at it, backs up the current version first,
// and can be undone from the backup. Backups live outside ~/.claude so Claude Code never loads them.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { BadRequestError, NotFoundError, child, getProject, memoryDirOf, parseFrontmatter } from "../claude-code/reader";
import type { Backup } from "./types";

export class ConflictError extends Error {}

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function backupsRoot(): string {
  return path.resolve(process.env.MEMORY_AUDIT_BACKUP_DIR ?? path.join(homedir(), ".memory-audit", "backups"));
}

export function writesEnabled() {
  return process.env.MEMORY_AUDIT_READONLY !== "1";
}

function notePath(projectId: string, file: string) {
  if (!file.endsWith(".md")) throw new BadRequestError("Only .md notes can be changed");
  return child(memoryDirOf(projectId), file);
}

async function readOrNull(p: string) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

function backupDir(projectId: string, file: string) {
  // Re-validate both segments against the backup root.
  const projectDir = child(backupsRoot(), projectId);
  return child(projectDir, file);
}

async function backup(projectId: string, file: string, content: string, reason: string): Promise<Backup> {
  const dir = backupDir(projectId, file);
  await mkdir(dir, { recursive: true });
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${sha(content).slice(0, 6)}`;
  const meta: Backup = { id, file, createdAt: new Date().toISOString(), reason, size: Buffer.byteLength(content) };
  await writeFile(path.join(dir, `${id}.md`), content, { flag: "wx" });
  await writeFile(path.join(dir, `${id}.json`), JSON.stringify(meta, null, 2), { flag: "wx" });
  return meta;
}

/** Replace a note (or MEMORY.md). `expectedSha` is the hash of the version the user reviewed. */
export async function writeNote(
  projectId: string,
  file: string,
  newRaw: string,
  expectedSha: string | null,
  reason: string,
): Promise<{ backup: Backup | null; sha: string }> {
  if (!writesEnabled()) throw new BadRequestError("Writes are turned off (MEMORY_AUDIT_READONLY=1)");
  if (newRaw.length > 200_000) throw new BadRequestError("Note is too large");
  const p = notePath(projectId, file);
  const current = await readOrNull(p);
  if (current === null && expectedSha !== null) throw new NotFoundError("Note not found");
  if (current !== null && sha(current) !== expectedSha)
    throw new ConflictError("The note changed on disk since you opened it. Reload and review again.");
  const b = current !== null ? await backup(projectId, file, current, reason) : null;
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, newRaw, "utf8");
  return { backup: b, sha: sha(newRaw) };
}

export async function listBackups(projectId: string, file: string): Promise<Backup[]> {
  notePath(projectId, file);
  const dir = backupDir(projectId, file);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const metas = await Promise.all(
    names
      .filter((n) => n.endsWith(".json"))
      .map(async (n) => JSON.parse(await readFile(path.join(dir, n), "utf8")) as Backup),
  );
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readBackup(projectId: string, file: string, id: string): Promise<string> {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new BadRequestError("Invalid backup id");
  notePath(projectId, file);
  const p = path.join(backupDir(projectId, file), `${id}.md`);
  const s = await stat(p).catch(() => null);
  if (!s?.isFile()) throw new NotFoundError("Backup not found");
  return readFile(p, "utf8");
}

/** Put a backup back. The version being replaced is itself backed up, so restore can be undone too. */
export async function restoreBackup(projectId: string, file: string, id: string) {
  const content = await readBackup(projectId, file, id);
  const current = await readOrNull(notePath(projectId, file));
  return writeNote(projectId, file, content, current === null ? null : sha(current), `Restored backup ${id}`);
}

// ───────────── Index fixes ─────────────

export async function addToIndex(projectId: string, file: string) {
  const memDir = memoryDirOf(projectId);
  const note = await readOrNull(notePath(projectId, file));
  if (note === null) throw new NotFoundError("Note not found");
  const { frontmatter } = parseFrontmatter(note);
  const title = frontmatter.name ?? file.replace(/\.md$/, "");
  const line = `- [${title}](${file})${frontmatter.description ? ` — ${frontmatter.description}` : ""}`;
  const indexPath = child(memDir, "MEMORY.md");
  const current = await readOrNull(indexPath);
  if (current?.includes(`](${file})`)) return { backup: null, sha: sha(current) };
  const next = current === null ? `${line}\n` : `${current.replace(/\n*$/, "\n")}${line}\n`;
  return writeNote(projectId, "MEMORY.md", next, current === null ? null : sha(current), `Added ${file} to the index`);
}

export async function removeBrokenLinks(projectId: string) {
  const project = await getProject(projectId);
  const current = await readOrNull(child(memoryDirOf(projectId), "MEMORY.md"));
  // No index means no links, broken or not.
  if (current === null || !project.brokenIndexLinks.length) return { backup: null, removed: [] as string[] };
  const broken = new Set(project.brokenIndexLinks);
  const removed: string[] = [];
  const kept = current.split("\n").filter((l) => {
    const links = [...l.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => path.basename(m[1]));
    if (links.length && links.every((f) => broken.has(f))) {
      removed.push(l);
      return false;
    }
    return true;
  });
  const r = await writeNote(projectId, "MEMORY.md", kept.join("\n"), sha(current), "Removed links to missing notes");
  return { backup: r.backup, removed };
}
