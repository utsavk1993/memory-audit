export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** Line diff (LCS). Notes are small, so O(n·m) is fine. */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ kind: "same", text: x[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ kind: "del", text: x[i++] });
    else out.push({ kind: "add", text: y[j++] });
  }
  while (i < n) out.push({ kind: "del", text: x[i++] });
  while (j < m) out.push({ kind: "add", text: y[j++] });
  return out;
}

/** Insert a visible "unverified" warning right after the frontmatter, and a flag in the frontmatter. */
export function markUnverified(raw: string, reason: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const banner = `> **Unverified** (flagged ${date}): ${reason} Check before relying on this.\n\n`;
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return banner + raw;
  const fm = /^verified:/m.test(m[1]) ? m[1].replace(/^verified:.*$/m, "verified: false") : `${m[1]}\nverified: false`;
  const body = raw.slice(m[0].length).replace(/^> \*\*Unverified\*\*.*\n\n?/, "");
  return `---\n${fm}\n---\n${banner}${body.replace(/^\n+/, "")}`;
}
