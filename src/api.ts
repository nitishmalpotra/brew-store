import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Pkg = {
  name: string;
  desc: string;
  version: string;
  cask: boolean;
  homepage?: string;
};
export type Outdated = { name: string; cask: boolean; installed: string; current: string };

const CACHE = "brew-catalog-v1";
const CACHE_TS = "brew-catalog-ts";
const MAX_AGE = 24 * 60 * 60 * 1000;

function slim(d: unknown): string {
  const s = typeof d === "string" ? d : "";
  return s.length > 140 ? s.slice(0, 139) + "…" : s;
}

/** Fetch the full Homebrew catalog (formulae + casks), cached in localStorage for a day. */
export async function loadCatalog(force = false): Promise<Pkg[]> {
  const ts = Number(localStorage.getItem(CACHE_TS) || 0);
  const cached = localStorage.getItem(CACHE);
  if (!force && cached && Date.now() - ts < MAX_AGE) {
    try {
      return JSON.parse(cached) as Pkg[];
    } catch {
      /* fall through and refetch */
    }
  }
  const [formulae, casks] = await Promise.all([
    fetch("https://formulae.brew.sh/api/formula.json").then((r) => r.json()),
    fetch("https://formulae.brew.sh/api/cask.json").then((r) => r.json()),
  ]);
  const pkgs: Pkg[] = [];
  for (const x of formulae as any[])
    pkgs.push({ name: x.name, desc: slim(x.desc), version: x.versions?.stable ?? "", cask: false, homepage: x.homepage });
  for (const x of casks as any[])
    pkgs.push({ name: x.token, desc: slim(x.desc), version: x.version ?? "", cask: true, homepage: x.homepage });
  try {
    localStorage.setItem(CACHE, JSON.stringify(pkgs));
    localStorage.setItem(CACHE_TS, String(Date.now()));
  } catch {
    /* over quota: skip caching, refetch next launch */
  }
  return pkgs;
}

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
  const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  const f = await invoke<string>("brew_query", { args: ["list", "--formula", "-1"] }).catch(() => "");
  const c = await invoke<string>("brew_query", { args: ["list", "--cask", "-1"] }).catch(() => "");
  return { formulae: new Set(lines(f)), casks: new Set(lines(c)) };
}

export async function outdated(): Promise<Outdated[]> {
  const raw = await invoke<string>("brew_query", { args: ["outdated", "--json=v2"] }).catch(() => "");
  try {
    const j = JSON.parse(raw);
    const out: Outdated[] = [];
    for (const x of j.formulae ?? [])
      out.push({ name: x.name, cask: false, installed: (x.installed_versions ?? []).join(", "), current: x.current_version ?? "" });
    for (const x of j.casks ?? [])
      out.push({ name: x.name, cask: true, installed: (x.installed_versions ?? []).join(", "), current: x.current_version ?? "" });
    return out;
  } catch {
    return [];
  }
}

export type Trend = { pkg: Pkg; count: number };

const TKEY = "brew-trending-v1";
const TKEY_TS = "brew-trending-ts";

function toInt(s: unknown): number {
  return typeof s === "string" ? Number(s.replace(/,/g, "")) || 0 : 0;
}

/** Most-installed formulae & casks over the last 30 days, joined to the catalog. */
export async function trending(catalog: Pkg[], n = 8): Promise<{ formulae: Trend[]; casks: Trend[] }> {
  const byName = new Map<string, Pkg>();
  for (const p of catalog) byName.set((p.cask ? "c:" : "f:") + p.name, p);
  const pick = (key: "f:" | "c:", name: string, count: number): Trend => ({
    pkg: byName.get(key + name) ?? { name, desc: "", version: "", cask: key === "c:" },
    count,
  });

  let raw: { f: any[]; c: any[] } | null = null;
  const cached = localStorage.getItem(TKEY);
  const ts = Number(localStorage.getItem(TKEY_TS) || 0);
  if (cached && Date.now() - ts < MAX_AGE) {
    try {
      raw = JSON.parse(cached);
    } catch {
      /* refetch */
    }
  }
  if (!raw) {
    const [f, c] = await Promise.all([
      fetch("https://formulae.brew.sh/api/analytics/install/30d.json").then((r) => r.json()),
      fetch("https://formulae.brew.sh/api/analytics/cask-install/30d.json").then((r) => r.json()),
    ]);
    raw = { f: (f.items ?? []).slice(0, 16), c: (c.items ?? []).slice(0, 16) };
    try {
      localStorage.setItem(TKEY, JSON.stringify(raw));
      localStorage.setItem(TKEY_TS, String(Date.now()));
    } catch {
      /* ignore quota */
    }
  }
  return {
    formulae: raw.f.slice(0, n).map((x) => pick("f:", x.formula, toInt(x.count))),
    casks: raw.c.slice(0, n).map((x) => pick("c:", x.cask, toInt(x.count))),
  };
}

export function fmtCount(n: number): string {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** `brew update` — genuinely fetch upstream definitions, then the caller re-reads outdated. */
export async function brewUpdate(): Promise<void> {
  await invoke("brew_query", { args: ["update"] }).catch(() => {});
}

export type BrewInfo = { version: string; prefix: string; latest: string; updateAvailable: boolean };

const ver = (s: string) => (s.match(/\d+\.\d+(?:\.\d+)?/) ?? [""])[0];

/** Local Homebrew version + prefix, plus whether a newer Homebrew release exists (GitHub, cached daily). */
export async function brewInfo(): Promise<BrewInfo> {
  const v = await invoke<string>("brew_query", { args: ["--version"] }).catch(() => "");
  const prefix = (await invoke<string>("brew_query", { args: ["--prefix"] }).catch(() => "")).trim();
  const version = ver((v.split("\n")[0] ?? "").trim());
  let latest = "";
  try {
    const cached = localStorage.getItem("brew-latest");
    const ts = Number(localStorage.getItem("brew-latest-ts") || 0);
    if (cached && Date.now() - ts < MAX_AGE) {
      latest = cached;
    } else {
      const r = await fetch("https://api.github.com/repos/Homebrew/brew/releases/latest").then((x) => x.json());
      latest = ver(String(r.tag_name ?? ""));
      localStorage.setItem("brew-latest", latest);
      localStorage.setItem("brew-latest-ts", String(Date.now()));
    }
  } catch {
    /* offline or rate-limited: leave latest empty */
  }
  return { version, prefix, latest, updateAvailable: !!latest && !!version && latest !== version };
}

export type LineEvt = { id: number; stream: string; text: string };
export type DoneEvt = { id: number; code: number; success: boolean };

/** Start a streaming brew command; calls onLine per output line, onDone at the end. */
export async function runStream(
  args: string[],
  onLine: (l: LineEvt) => void,
  onDone: (d: DoneEvt) => void,
): Promise<void> {
  const id = await invoke<number>("brew_run", { args });
  const offLine = await listen<LineEvt>("brew-output", (e) => {
    if (e.payload.id === id) onLine(e.payload);
  });
  const offDone = await listen<DoneEvt>("brew-done", (e) => {
    if (e.payload.id === id) {
      onDone(e.payload);
      offLine();
      offDone();
    }
  });
}
