import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { bytes, planned, removable } from "./progress";

export type Pkg = {
  name: string;
  desc: string;
  version: string;
  cask: boolean;
  homepage?: string;
  deps?: number;
};
export type Outdated = { name: string; cask: boolean; installed: string; current: string };

const DAY = 24 * 60 * 60 * 1000;
const query = (args: string[]) => invoke<string>("brew_query", { args }).catch(() => "");

/** localStorage-backed daily cache. Over quota or corrupt → just refetch. */
async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? "null");
    if (hit && Date.now() - hit.ts < DAY) return hit.v as T;
  } catch {
    /* refetch */
  }
  const v = await fetcher();
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), v }));
  } catch {
    /* over quota: skip caching */
  }
  return v;
}

const slim = (d: unknown) => {
  const s = typeof d === "string" ? d : "";
  return s.length > 140 ? s.slice(0, 139) + "…" : s;
};
const json = (u: string) => fetch(u).then((r) => r.json());

/** The full Homebrew catalog (formulae + casks), cached for a day. */
export const loadCatalog = () =>
  cached("brew-catalog-v2", async (): Promise<Pkg[]> => {
    const [formulae, casks] = await Promise.all([json("https://formulae.brew.sh/api/formula.json"), json("https://formulae.brew.sh/api/cask.json")]);
    return [
      ...(formulae as any[]).map((x) => ({ name: x.name, desc: slim(x.desc), version: x.versions?.stable ?? "", cask: false, homepage: x.homepage, deps: x.dependencies?.length ?? 0 })),
      ...(casks as any[]).map((x) => ({ name: x.token, desc: slim(x.desc), version: x.version ?? "", cask: true, homepage: x.homepage })),
    ];
  });

/** Tiny ranked substring search. ponytail: real fuzzy only if this measurably lags. */
export function search(catalog: Pkg[], q: string, limit = 60): Pkg[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const scored: { p: Pkg; s: number }[] = [];
  for (const p of catalog) {
    const name = p.name.toLowerCase();
    let s: number;
    if (name === query) s = 1000;
    else if (name.startsWith(query)) s = 600 - name.length;
    else if (name.includes(query)) s = 300 - name.indexOf(query);
    else if (p.desc.toLowerCase().includes(query)) s = 80;
    else continue;
    if (p.cask) s -= 1; // tie-break: formulae before casks
    scored.push({ p, s });
  }
  scored.sort((a, b) => b.s - a.s || a.p.name.length - b.p.name.length);
  return scored.slice(0, limit).map((x) => x.p);
}

export async function installed(): Promise<{ formulae: Set<string>; casks: Set<string> }> {
  const lines = (s: string) => new Set(s.split("\n").map((l) => l.trim()).filter(Boolean));
  const [f, c] = await Promise.all([query(["list", "--formula", "-1"]), query(["list", "--cask", "-1"])]);
  return { formulae: lines(f), casks: lines(c) };
}

export async function outdated(): Promise<Outdated[]> {
  try {
    const j = JSON.parse(await query(["outdated", "--json=v2"]));
    const map = (cask: boolean) => (x: any): Outdated => ({ name: x.name, cask, installed: (x.installed_versions ?? []).join(", "), current: x.current_version ?? "" });
    return [...(j.formulae ?? []).map(map(false)), ...(j.casks ?? []).map(map(true))];
  } catch {
    return [];
  }
}

export type Trend = { pkg: Pkg; count: number };
const toInt = (s: unknown) => (typeof s === "string" ? Number(s.replace(/,/g, "")) || 0 : 0);

/** Most-installed formulae & casks over the last 30 days, joined to the catalog. */
export async function trending(catalog: Pkg[], n = 8): Promise<{ formulae: Trend[]; casks: Trend[] }> {
  const byName = new Map(catalog.map((p) => [(p.cask ? "c:" : "f:") + p.name, p]));
  const raw = await cached("brew-trending-v2", async () => {
    const [f, c] = await Promise.all([json("https://formulae.brew.sh/api/analytics/install/30d.json"), json("https://formulae.brew.sh/api/analytics/cask-install/30d.json")]);
    return { f: (f.items ?? []).slice(0, n) as any[], c: (c.items ?? []).slice(0, n) as any[] };
  });
  const pick = (k: "f:" | "c:", name: string, count: unknown): Trend => ({ pkg: byName.get(k + name) ?? { name, desc: "", version: "", cask: k === "c:" }, count: toInt(count) });
  return { formulae: raw.f.map((x) => pick("f:", x.formula, x.count)), casks: raw.c.map((x) => pick("c:", x.cask, x.count)) };
}

export const fmtCount = (n: number) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
export const fmtBytes = (b: number) =>
  b <= 0 ? "Zero kB" : Intl.NumberFormat("en", { style: "unit", unit: b >= 1e9 ? "gigabyte" : b >= 1e6 ? "megabyte" : "kilobyte", maximumFractionDigits: 1 }).format(b / (b >= 1e9 ? 1e9 : b >= 1e6 ? 1e6 : 1e3));

export type BrewInfo = { version: string; prefix: string; latest: string; updateAvailable: boolean };
const ver = (s: string) => (s.match(/\d+\.\d+(?:\.\d+)?/) ?? [""])[0];

/** Local Homebrew version + prefix, plus whether a newer Homebrew release exists (GitHub, cached daily). */
export async function brewInfo(): Promise<BrewInfo> {
  const [v, prefix] = await Promise.all([query(["--version"]), query(["--prefix"])]);
  const version = ver(v.split("\n")[0] ?? "");
  const latest = await cached("brew-latest-v2", async () => ver(String((await json("https://api.github.com/repos/Homebrew/brew/releases/latest")).tag_name ?? ""))).catch(() => "");
  return { version, prefix: prefix.trim(), latest, updateAvailable: !!latest && !!version && latest !== version };
}

export type Storage = { downloads: number; old: number; logs: number; files: number };

/** What `brew cleanup --prune=all` would free, from its dry run (no files touched). */
export async function storage(): Promise<Storage> {
  const out = await query(["cleanup", "--prune=all", "-n"]);
  const s: Storage = { downloads: 0, old: 0, logs: 0, files: removable(out) };
  for (const l of out.split("\n")) {
    if (!l.startsWith("Would remove: ")) continue;
    const b = bytes(l.slice(l.lastIndexOf("(")));
    if (l.includes("/Library/Logs/Homebrew")) s.logs += b;
    else if (l.includes("/Library/Caches/Homebrew")) s.downloads += b;
    else s.old += b;
  }
  return s;
}

/** How many packages an install would add (read-only dry run). 0 when brew can't say. */
export const installPlan = async (pkg: Pkg) => planned(await query(["install", ...(pkg.cask ? ["--cask"] : []), "--dry-run", pkg.name]));

/** Is Homebrew installed on this machine? */
export const brewExists = () => invoke<boolean>("brew_exists").catch(() => false);

/** Open Terminal running the official Homebrew installer. */
export const installHomebrew = () => invoke("install_homebrew").catch(() => {});

/** Re-run a brew command in a Terminal window (casks that need an admin password). */
export const brewInTerminal = (args: string[]) => invoke("brew_in_terminal", { args }).catch(() => {});

/** Names of .app bundles in /Applications (no ".app" suffix). */
export const listApps = () => invoke<string[]>("list_apps").catch(() => [] as string[]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Apps on disk that match a cask token but aren't brew-managed yet — candidates for adoption. */
// ponytail: matches normalized app name against normalized cask token ("Visual Studio Code" →
// "visual-studio-code"). Misses renamed bundles (zoom.us → zoom); upgrade path is matching the
// cask API's `name`/artifact fields if people ask for more coverage.
export function adoptable(apps: string[], catalog: Pkg[], installedCasks: Set<string>): { app: string; pkg: Pkg }[] {
  const byNorm = new Map<string, Pkg>();
  for (const p of catalog) if (p.cask && !installedCasks.has(p.name)) byNorm.set(norm(p.name), p);
  const out: { app: string; pkg: Pkg }[] = [];
  for (const app of apps) {
    const p = byNorm.get(norm(app));
    if (p) out.push({ app, pkg: p });
  }
  return out.sort((a, b) => a.app.localeCompare(b.app));
}

export type LineEvt = { id: number; stream: string; text: string };
export type DoneEvt = { id: number; code: number; success: boolean };

/** Start a streaming brew command; calls onLine per output line, onDone at the end. */
export async function runStream(args: string[], onLine: (l: LineEvt) => void, onDone: (d: DoneEvt) => void): Promise<void> {
  // Subscribe before starting and buffer until the id is known: brew_run emits brew-done
  // *before* returning for blocked commands, and a lost done would stall the job queue.
  let id = -1;
  const early: (LineEvt | DoneEvt)[] = [];
  const finish = (d: DoneEvt) => {
    onDone(d);
    offLine();
    offDone();
  };
  const offLine = await listen<LineEvt>("brew-output", (e) => (id === -1 ? early.push(e.payload) : e.payload.id === id && onLine(e.payload)));
  const offDone = await listen<DoneEvt>("brew-done", (e) => (id === -1 ? early.push(e.payload) : e.payload.id === id && finish(e.payload)));
  id = await invoke<number>("brew_run", { args });
  for (const e of early) if (e.id === id) "text" in e ? onLine(e) : finish(e);
}
