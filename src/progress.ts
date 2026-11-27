// ponytail: brew 7 prints no percentages when piped, so progress = steps seen / steps announced.
// The total comes from a read-only dry run; each finished download (✔︎) and each pour / app move /
// cleanup removal is one step. Unknown output leaves total at 0 → the UI shows an indeterminate ring.
export type Progress = { total: number; phases: 1 | 2; got: number; put: number };

export const blank = (total = 0, phases: 1 | 2 = 2): Progress => ({ total, phases, got: 0, put: 0 });

/** `brew install --dry-run x` → "==> Would install 1 formula:" + "==> Would install 6 dependencies for x:" = 7 */
export const planned = (dryRun: string) =>
  [...dryRun.matchAll(/^==> Would install (\d+) /gm)].reduce((n, m) => n + Number(m[1]), 0);

/** `brew cleanup --prune=all -n` → one "Would remove:" line per file or folder. */
export const removable = (dryRun: string) => (dryRun.match(/^Would remove: /gm) ?? []).length;

export function step(p: Progress, line: string): Progress {
  const m = line.match(/^==> Upgrading (\d+) outdated package/);
  if (m) return { ...p, total: Number(m[1]) };
  if (/^✔/.test(line) && !/Manifest|JSON API/.test(line)) return { ...p, got: p.got + 1 };
  if (/^(==> (Pouring|Moving App)|Removing: )/.test(line)) return { ...p, put: p.put + 1 };
  return p;
}

export const fraction = (p: Progress) =>
  p.total ? Math.min(1, (p.phases === 2 ? p.got + p.put : p.put) / (p.total * p.phases)) : 0;

/** "Downloading 3 of 7", "Installing 2 of 7", "Removing 5 of 37" — or "" when brew gave no total. */
export function stepLabel(p: Progress, verb: string): string {
  if (!p.total) return "";
  if (p.phases === 1) return `${verb} ${Math.min(p.total, p.put + 1)} of ${p.total}`;
  return p.put > 0 || p.got >= p.total
    ? `${verb} ${Math.min(p.total, p.put + 1)} of ${p.total}`
    : `Downloading ${Math.min(p.total, p.got + 1)} of ${p.total}`;
}

/** Size strings brew prints, e.g. "64B", "81.4MB", "1.2GB" → bytes. */
export function bytes(s: string): number {
  const m = s.match(/([\d.]+)\s?(B|KB|MB|GB|TB)/);
  return m ? Number(m[1]) * 1000 ** ["B", "KB", "MB", "GB", "TB"].indexOf(m[2]) : 0;
}
