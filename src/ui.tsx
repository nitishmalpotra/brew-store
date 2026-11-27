import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { search, fmtCount, fmtBytes, type Pkg, type Trend, type BrewInfo, type Storage } from "./api";
import { categorize } from "./categories";
import { fraction, stepLabel, type Progress } from "./progress";

export type PkgState = "installed" | "outdated" | "available";
export type View = "overview" | "discover" | "installed" | "updates" | "adopt";
export type Seg = "all" | "formula" | "cask";
export type Action = "install" | "uninstall" | "upgrade" | "update" | "adopt" | "cleanup";
export type Job = {
  id: number;
  action: Action;
  title: string;
  key: string; // pkg key, or "all" / "cache" / "brew" / "batch"
  pkg?: Pkg;
  args: string[];
  lines: string[];
  status: "queued" | "running" | "success" | "error";
  prog: Progress;
  seen: string[]; // packages `brew upgrade` has started, in order
};
export const pkgKey = (p: Pkg) => (p.cask ? "c:" : "f:") + p.name;
export const REPO_URL = "https://github.com/nitishmalpotra/brew-store";

const VERB: Record<Action, [string, string, string]> = {
  install: ["Installing", "Installed", "install"],
  uninstall: ["Uninstalling", "Uninstalled", "uninstall"],
  upgrade: ["Updating", "Updated", "update"],
  update: ["Checking for updates", "Checked for updates", "check for updates"],
  adopt: ["Adopting", "Adopted", "adopt"],
  cleanup: ["Clearing", "Cleared", "clear"],
};
export const needsPassword = (j: Job) => j.lines.some((l) => l.includes("password is required") || l.includes("a terminal is required"));
export function jobLabel(j: Job): string {
  const [ing, past, base] = VERB[j.action];
  if (j.status === "queued") return "Waiting";
  if (j.status === "success") return past;
  if (j.status === "error") {
    if (needsPassword(j)) return "Needs your admin password";
    const e = [...j.lines].reverse().find((l) => l.startsWith("Error:"));
    return `Couldn’t ${base}${e ? ": " + e.slice(7) : ""}`;
  }
  const verb = j.action === "cleanup" ? "Removing" : j.action === "upgrade" ? "Updating" : "Installing";
  return stepLabel(j.prog, verb) || (j.action === "update" ? "Checking" : ing);
}
export const jobTitle = (j: Job) => `${VERB[j.action][j.status === "success" ? 1 : 0]} ${j.title}`.trim();

// only ever open http(s) links externally
export const openExternal = (url: string) => /^https?:\/\//i.test(url) && openUrl(url).catch(() => {});
const host = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

// --- icons (SF Symbols-like strokes), no dependency ---
const P = {
  side: <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9.5 4.5v15" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  over: <><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></>,
  disc: <path d="M12 3.5l2.3 5.2 5.7.5-4.3 3.8 1.3 5.5L12 15.6 7 18.5l1.3-5.5L4 9.2l5.7-.5z" />,
  box: <><path d="M20 7.5 12 3.5 4 7.5v9l8 4 8-4z" /><path d="m4 7.5 8 4 8-4M12 11.5v9" /></>,
  upd: <><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" /><path d="M12 8v8M8.5 11.5 12 8l3.5 3.5" /></>,
  adopt: <><path d="M12 3.5v10M8 9.5l4 4 4-4" /><path d="M5 14.5v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></>,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14" />,
  ext: <path d="M9 6h9v9M18 6 6.5 17.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5.5 12.5 4 4 9-9" />,
  checkc: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.5 2.5 4.5-5" /></>,
  warn: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5.5M12 16.2v.3" /></>,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" />,
  mug: <><path d="M5 8h10v8a3.5 3.5 0 0 1-3.5 3.5h-3A3.5 3.5 0 0 1 5 16z" /><path d="M15 10h1.5a2.5 2.5 0 0 1 0 5H15M7.5 4.5v1.5M10.5 4v2M13 4.5v1.5" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z" /></>,
  brackets: <path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5" />,
  braces: <path d="M9 4.5c-2 0-2.5 1-2.5 2.5v2.5c0 1.2-.8 2.5-2.5 2.5 1.7 0 2.5 1.3 2.5 2.5V17c0 1.5.5 2.5 2.5 2.5M15 4.5c2 0 2.5 1 2.5 2.5v2.5c0 1.2.8 2.5 2.5 2.5-1.7 0-2.5 1.3-2.5 2.5V17c0 1.5-.5 2.5-2.5 2.5" />,
  prompt: <path d="m5 7.5 5 4.5-5 4.5M12.5 17h6.5" />,
  branch: <><circle cx="7" cy="5.5" r="2" /><circle cx="7" cy="18.5" r="2" /><circle cx="17" cy="8" r="2" /><path d="M7 7.5v9M17 10c0 4-5 3.5-9 7" /></>,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  wave: <path d="M4 12h2.5l2-5 3 10 3-12 2.5 7H20" />,
  db: <><ellipse cx="12" cy="6.5" rx="7" ry="2.8" /><path d="M5 6.5v11c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-11M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8" /></>,
  cloud: <path d="M7.5 18.5h9a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7.5 18.5z" />,
  bolt: <path d="M13 3.5 5.5 13.5h6l-1 7 7.5-10h-6z" />,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  doc: <><path d="M6.5 3.5h7l4 4v13h-11z" /><path d="M13.5 3.5v4h4M9 12.5h6M9 16h6" /></>,
  layers: <path d="m12 4 8.5 4.5L12 13 3.5 8.5zM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5" />,
};
type Glyph = keyof typeof P;
export const Icon = ({ k, sw = 1.7, className }: { k: Glyph; sw?: number; className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {P[k]}
  </svg>
);

const CAT: Record<string, [Glyph, string]> = {
  Browsers: ["globe", "#2f80ed"], "Editors & IDEs": ["brackets", "#5e5ce6"], "Languages & Runtimes": ["braces", "#ff8a00"],
  "Terminal & Shell": ["prompt", "#8e8e93"], "Version Control": ["branch", "#ff5a3c"], "Media & Graphics": ["play", "#ff2d70"],
  Networking: ["wave", "#00a5b8"], Databases: ["db", "#7d5cf0"], "DevOps & Cloud": ["cloud", "#32ade6"], Productivity: ["bolt", "#f5b400"],
  Security: ["lock", "#2fbf71"], "Text & Data": ["doc", "#4fb3a9"], Libraries: ["layers", "#a2845e"], Other: ["box", "#8e8e93"],
};
/** Casks get a coloured app tile, formulae a graphite tool tile; the glyph is the category. */
export function Tile({ pkg, cat, size = "s", glyph }: { pkg?: Pkg; cat?: string; size?: "xs" | "s" | "m" | "l"; glyph?: Glyph }) {
  const [g, c] = CAT[cat ?? (pkg ? categorize(pkg) : "Other")] ?? CAT.Other;
  return (
    <span className={`ico ${size} ${pkg && !pkg.cask ? "f" : ""}`} style={{ ["--c" as string]: c }} aria-hidden>
      <Icon k={glyph ?? g} sw={pkg?.cask ? 1.9 : 2} />
    </span>
  );
}

export function Ring({ job, small }: { job: Job; small?: boolean }) {
  const p = fraction(job.prog);
  const cls = job.status === "queued" ? "q" : p ? "" : "ind";
  return <span className={`ring ${cls} ${small ? "s" : ""}`} style={{ ["--p" as string]: p }} />;
}

/** The row's trailing control: store pill, push button, progress ring or result icon. */
export function PkgButton({ pkg, state, job, ctx, onAct, onPop }: {
  pkg: Pkg;
  state: PkgState;
  job?: Job;
  ctx: "store" | "installed" | "updates" | "adopt";
  onAct: (a: Action, p: Pkg) => void;
  onPop: () => void;
}) {
  if (job?.status === "success") return <span className="ringw okic"><Icon k="checkc" sw={1.8} /></span>;
  if (job?.status === "error") return <button className="ringw erric" onClick={onPop} aria-label={jobLabel(job)}><Icon k="warn" sw={1.8} /></button>;
  if (job) return <button className="ringw" onClick={onPop} aria-label={jobLabel(job)}><Ring job={job} /></button>;
  if (ctx === "adopt") return <button className="pb" onClick={() => onAct("adopt", pkg)}>Adopt</button>;
  if (ctx === "installed") return <button className="pb reveal" onClick={() => onAct("uninstall", pkg)}>Uninstall</button>;
  if (state === "outdated") return <button className="get" onClick={() => onAct("upgrade", pkg)}>Update</button>;
  if (state === "installed") return <span className="ringw label">Installed</span>;
  return <button className="get" onClick={() => onAct("install", pkg)}>Get</button>;
}

const Sub = ({ job, text }: { job?: Job; text: ReactNode }) =>
  job ? <div className={`dsc ${job.status === "success" ? "ok" : job.status === "error" ? "err" : "run"}`}>{jobLabel(job)}</div> : <div className="dsc">{text}</div>;

type RowCtx = { stateOf: (p: Pkg) => PkgState; jobOf: (p: Pkg) => Job | undefined; onAct: (a: Action, p: Pkg) => void; onOpen: (p: Pkg) => void; onPop: () => void };

export function ChartItem({ t, rank, c }: { t: Trend; rank: number; c: RowCtx }) {
  const job = c.jobOf(t.pkg);
  return (
    <div className="ci" onClick={() => c.onOpen(t.pkg)}>
      <span className="rk">{rank}</span>
      <Tile pkg={t.pkg} size="m" />
      <div className="tx">
        <div className="nm">{t.pkg.name}</div>
        <Sub job={job} text={categorize(t.pkg)} />
      </div>
      <span onClick={(e) => e.stopPropagation()}>
        <PkgButton pkg={t.pkg} state={c.stateOf(t.pkg)} job={job} ctx="store" onAct={c.onAct} onPop={c.onPop} />
      </span>
    </div>
  );
}

export function Row({ pkg, ctx, c, text, meta, select }: {
  pkg: Pkg;
  ctx: "store" | "installed" | "updates" | "adopt";
  c: RowCtx;
  text?: ReactNode;
  meta?: ReactNode;
  select?: { on: boolean; toggle: () => void };
}) {
  const job = c.jobOf(pkg);
  return (
    <div className={`row click ${select?.on ? "on" : ""}`} onClick={() => (select ? select.toggle() : c.onOpen(pkg))}>
      {select && <span className={`cb ${select.on ? "on" : ""}`} role="checkbox" aria-checked={select.on} aria-label={`Select ${pkg.name}`}><Icon k="check" sw={3} /></span>}
      <Tile pkg={pkg} />
      <div className="tx">
        <div className="nm">{pkg.name}</div>
        <Sub job={job} text={text ?? (pkg.desc || (pkg.cask ? "App" : "Command-line tool"))} />
      </div>
      {meta && <span className="meta hide-n">{meta}</span>}
      <span onClick={(e) => e.stopPropagation()}>
        <PkgButton pkg={pkg} state={c.stateOf(pkg)} job={job} ctx={ctx} onAct={c.onAct} onPop={c.onPop} />
      </span>
    </div>
  );
}

export const Group = ({ children }: { children: ReactNode }) => <div className="group">{children}</div>;

export function Empty({ icon, title, sub }: { icon: Glyph; title: string; sub: string }) {
  return (
    <div className="empty">
      <Icon k={icon} sw={1.4} />
      <b>{title}</b>
      <span>{sub}</span>
    </div>
  );
}

export function Sidebar({ view, go, query, setQuery, counts, onPalette }: {
  view: View;
  go: (v: View) => void;
  query: string;
  setQuery: (q: string) => void;
  counts: { installed: number; updates: number; adopt: number };
  onPalette: () => void;
}) {
  const nav = (v: View, label: string, k: Glyph, n?: number, badge?: boolean) => (
    <button className="nav" onClick={() => go(v)} aria-current={view === v && !query ? "page" : undefined}>
      <Icon k={k} />
      <span>{label}</span>
      {n ? <em className={badge ? "b" : ""}>{n}</em> : null}
    </button>
  );
  return (
    <aside className="sb">
      <div className="sbdrag" data-tauri-drag-region />
      <label className="sfield">
        <Icon k="search" />
        <input id="q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search packages" spellCheck={false} />
      </label>
      {nav("overview", "Overview", "over")}
      {nav("discover", "Discover", "disc")}
      <div className="grp">Library</div>
      {nav("installed", "Installed", "box", counts.installed)}
      {nav("updates", "Updates", "upd", counts.updates, true)}
      {nav("adopt", "Adopt", "adopt", counts.adopt)}
      <div className="sfoot">
        <button className="nav" onClick={() => openExternal(REPO_URL)}>
          <Icon k="code" />
          <span>Source on GitHub</span>
          <Icon k="ext" sw={1.8} />
        </button>
        <button className="nav" onClick={onPalette}>
          <Icon k="search" />
          <span>Quick Open</span>
          <em>⌘K</em>
        </button>
      </div>
    </aside>
  );
}

/** Xcode-style status capsule: what brew is doing right now, or Homebrew's state when idle. */
export function Activity({ jobs, syncing, brew, brewLoading, onClick }: { jobs: Job[]; syncing: boolean; brew: BrewInfo; brewLoading: boolean; onClick: () => void }) {
  const run = jobs.find((j) => j.status === "running");
  const queued = jobs.filter((j) => j.status === "queued").length;
  const last = jobs.find((j) => j.status === "error") ?? jobs.find((j) => j.status === "success");
  let body: ReactNode;
  if (run) {
    const step = jobLabel(run);
    body = (
      <>
        <Ring job={run} small />
        <span className="t"><b>{jobTitle(run)}</b> <span>{step}</span></span>
        {queued > 0 && <span className="n">+{queued} queued</span>}
        <span className="line"><i style={{ width: `${fraction(run.prog) * 100}%` }} /></span>
      </>
    );
  } else if (last) {
    body = (
      <>
        <span className={last.status === "error" ? "erric" : "okic"}><Icon k={last.status === "error" ? "warn" : "checkc"} sw={1.8} /></span>
        <span className="t"><b>{last.status === "error" ? `Couldn’t ${VERB[last.action][2]} ${last.title}`.trim() : jobTitle(last)}</b></span>
      </>
    );
  } else if (syncing) {
    body = (
      <>
        <span className="ring s ind" />
        <span className="t"><span className="long">Syncing the catalog</span><span className="short">Syncing</span></span>
      </>
    );
  } else {
    const up = !brew.updateAvailable;
    body = (
      <>
        <span className={`okdot ${up ? "" : "warn"}`} />
        <span className="t">
          <span className="long">{brewLoading ? "Checking Homebrew…" : !brew.version ? "Homebrew" : up ? `Homebrew ${brew.version} is up to date` : `Homebrew ${brew.latest} is available`}</span>
          <span className="short">{up ? "Up to date" : "Update available"}</span>
        </span>
      </>
    );
  }
  return (
    <button className={`av glass ${run || last ? "" : "idle"}`} onClick={onClick} aria-label="Activity">
      {body}
    </button>
  );
}

export function Steps({ job }: { job: Job }) {
  const p = job.prog;
  if (!p.total) return <div className={`lbar ${job.status === "running" ? "ind" : ""}`}><i /></div>;
  const segs: [string, number][] =
    p.phases === 1
      ? [[job.action === "cleanup" ? "Removing" : "Working", p.put / p.total]]
      : [["Downloading", p.got / p.total], [job.action === "upgrade" ? "Updating" : job.pkg?.cask ? "Moving to Applications" : "Installing", p.put / p.total]];
  const cur = segs.findIndex(([, f]) => f < 1);
  return (
    <div className="steps">
      {segs.map(([n, f], i) => (
        <div key={n} className={i === cur && job.status === "running" ? "cur" : ""}>
          <i><b style={{ width: `${Math.min(1, job.status === "success" ? 1 : f) * 100}%` }} /></i>
          <span>{n}</span>
        </div>
      ))}
    </div>
  );
}

export function Log({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines.length]);
  return <pre className="log" ref={ref}>{lines.join("\n") || "Starting…"}</pre>;
}

export function ActivityPopover({ jobs, onRemove, onDismiss, onTerminal }: { jobs: Job[]; onRemove: (id: number) => void; onDismiss: (id: number) => void; onTerminal: (j: Job) => void }) {
  return (
    <div className="pop glass-hi" role="dialog" aria-label="Activity" onClick={(e) => e.stopPropagation()}>
      <h3>Activity <span>{jobs.length ? `${jobs.length} job${jobs.length > 1 ? "s" : ""}` : ""}</span></h3>
      {jobs.length === 0 ? (
        <Empty icon="checkc" title="Nothing running" sub="Installs, updates and cleanups show here." />
      ) : (
        jobs.map((j) => (
          <div className="job" key={j.id}>
            <div className="t">
              {j.pkg ? <Tile pkg={j.pkg} size="xs" /> : <Tile cat="Other" glyph={j.action === "cleanup" ? "trash" : "mug"} size="xs" />}
              <div className="tx">
                <div className="nm">{jobTitle(j)}</div>
                <Sub job={j} text="" />
              </div>
              {j.status === "queued" && <button className="pb sm" onClick={() => onRemove(j.id)}>Remove</button>}
              {j.status === "error" && needsPassword(j) && <button className="pb sm" onClick={() => onTerminal(j)}>Open in Terminal</button>}
              {j.status === "error" && <button className="pb sm" onClick={() => onDismiss(j.id)}>Dismiss</button>}
            </div>
            {j.status !== "queued" && (
              <>
                <Steps job={j} />
                <details open={j.status === "error"}>
                  <summary>Show Output</summary>
                  <Log lines={j.lines} />
                </details>
              </>
            )}
          </div>
        ))
      )}
    </div>
  );
}

export function Inspector({ pkg, state, job, installs, outdated, onAct, onClose }: {
  pkg: Pkg;
  state: PkgState;
  job?: Job;
  installs?: number;
  outdated?: { installed: string; current: string };
  onAct: (a: Action, p: Pkg) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [pkg]);
  const cmd = `brew install${pkg.cask ? " --cask" : ""} ${pkg.name}`;
  const info: [string, string, string][] = [
    ["Version", outdated?.current || pkg.version || "—", outdated ? `have ${outdated.installed}` : "latest"],
    ["Type", pkg.cask ? "App" : "Tool", pkg.cask ? "cask" : "formula"],
  ];
  if (!pkg.cask && pkg.deps !== undefined) info.push(["Depends on", String(pkg.deps), pkg.deps === 1 ? "package" : "packages"]);
  if (installs) info.push(["Installs", fmtCount(installs), "30 days"]);
  return (
    <aside className="insp" aria-label={`${pkg.name} details`}>
      <button className="x" onClick={onClose} aria-label="Close"><Icon k="x" sw={2.4} /></button>
      <div className="hd">
        <Tile pkg={pkg} size="l" />
        <div className="tx">
          <div className="nm">{pkg.name}</div>
          <div className="dsc">{pkg.cask ? "App" : "Command-line tool"} in {categorize(pkg)}</div>
          <div className="act">
            {job ? (
              <>
                {job.status === "running" || job.status === "queued" ? <Ring job={job} /> : null}
                <Sub job={job} text="" />
              </>
            ) : state === "available" ? (
              <button className="get solid lg" onClick={() => onAct("install", pkg)}>Get</button>
            ) : (
              <>
                {state === "outdated" && <button className="get solid lg" onClick={() => onAct("upgrade", pkg)}>Update</button>}
                <button className="pb lg" onClick={() => onAct("uninstall", pkg)}>Uninstall</button>
              </>
            )}
          </div>
        </div>
      </div>
      {job && job.status !== "queued" && (
        <>
          <Steps job={job} />
          <Log lines={job.lines} />
        </>
      )}
      <div className="info">
        {info.map(([k, v, s]) => (
          <div key={k}><span>{k}</span><b title={v}>{v}</b><span>{s}</span></div>
        ))}
      </div>
      {pkg.desc && <p className="d">{pkg.desc}</p>}
      <div className="copy">
        <code>{cmd}</code>
        <button onClick={() => navigator.clipboard?.writeText(cmd).then(() => setCopied(true)).catch(() => {})}>{copied ? "Copied" : "Copy"}</button>
      </div>
      {pkg.homepage && (
        <button className="lnk" onClick={() => openExternal(pkg.homepage!)}>{host(pkg.homepage)} <Icon k="ext" sw={1.8} /></button>
      )}
      <button className="lnk" onClick={() => openExternal(`https://formulae.brew.sh/${pkg.cask ? "cask" : "formula"}/${encodeURIComponent(pkg.name)}`)}>
        View on formulae.brew.sh <Icon k="ext" sw={1.8} />
      </button>
    </aside>
  );
}

export function Overview({ brew, brewLoading, counts, store, cleaning, categories, go, onCheck, onClear }: {
  brew: BrewInfo;
  brewLoading: boolean;
  counts: { installed: number; updates: number; adopt: number };
  store: Storage | null;
  cleaning?: Job;
  categories: { name: string; count: number }[];
  go: (v: View) => void;
  onCheck: () => void;
  onClear: () => void;
}) {
  const total = store ? store.downloads + store.old + store.logs : 0;
  const seg = (v: number, c: string) => <i style={{ flexBasis: `${total ? (v / total) * 100 : 0}%`, background: c }} />;
  return (
    <>
      <h1 className="lt">Overview</h1>
      <Group>
        <div className="row">
          <Tile cat="Other" glyph="mug" />
          <div className="tx">
            <div className="nm">Homebrew {brew.version}</div>
            <div className="dsc">{brewLoading ? "Checking…" : `Installed in ${brew.prefix || "/opt/homebrew"}`}</div>
          </div>
          {!brewLoading && <span className="meta hide-n">{brew.updateAvailable ? `${brew.latest} available` : "Up to date"}</span>}
          <button className="pb" onClick={onCheck}>{brew.updateAvailable ? "Update Homebrew" : "Check for Updates"}</button>
        </div>
      </Group>
      <div className="group strip">
        <button onClick={() => go("installed")}><b>{counts.installed}</b><span>Installed</span></button>
        <button onClick={() => go("updates")}><b style={counts.updates ? { color: "var(--accent)" } : undefined}>{counts.updates}</b><span>Updates</span></button>
        <button onClick={() => go("adopt")}><b>{counts.adopt}</b><span>Ready to adopt</span></button>
      </div>
      <section>
        <div className="ghdr">Storage <span>{!store ? "Measuring…" : total ? `${fmtBytes(total)} can be freed` : "Nothing to clear"}</span></div>
        <Group>
          <div className="stor">
            <div className="stack" role="img" aria-label={store ? `Downloads ${fmtBytes(store.downloads)}, old versions ${fmtBytes(store.old)}, logs ${fmtBytes(store.logs)}` : "Measuring"}>
              {seg(store?.downloads ?? 0, "var(--accent)")}
              {seg(store?.old ?? 0, "var(--orange)")}
              {seg(store?.logs ?? 0, "var(--text3)")}
            </div>
            <div className="legend">
              <span><i style={{ background: "var(--accent)" }} />Downloads {fmtBytes(store?.downloads ?? 0)}</span>
              <span><i style={{ background: "var(--orange)" }} />Old versions {fmtBytes(store?.old ?? 0)}</span>
              <span><i style={{ background: "var(--text3)" }} />Logs {fmtBytes(store?.logs ?? 0)}</span>
            </div>
          </div>
          <div className="row" style={{ borderTop: "0.5px solid var(--sep)" }}>
            <Tile cat="Other" glyph="trash" />
            <div className="tx">
              <div className="nm">Clear Homebrew cache</div>
              <Sub job={cleaning} text="Removes downloaded bottles, installers and old versions. Installed packages stay." />
            </div>
            {cleaning && (cleaning.status === "running" || cleaning.status === "queued") ? (
              <span className="ringw"><Ring job={cleaning} /></span>
            ) : (
              <button className="pb" onClick={onClear} disabled={!total}>Clear Cache…</button>
            )}
          </div>
        </Group>
        <div className="cmd">Runs brew cleanup --prune=all</div>
      </section>
      {categories.length > 0 && (
        <section>
          <div className="ghdr">Your library <span>By category</span></div>
          <Group>
            {categories.map((c) => (
              <div className="row" key={c.name}>
                <Tile cat={c.name} size="xs" />
                <div className="tx"><div className="nm" style={{ fontWeight: 500 }}>{c.name}</div></div>
                <span className="meta">{c.count}</span>
              </div>
            ))}
          </Group>
        </section>
      )}
    </>
  );
}

export function ClearAlert({ store, onCancel, onConfirm }: { store: Storage; onCancel: () => void; onConfirm: () => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), []);
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="alert glass-hi" role="alertdialog" aria-labelledby="alert-t">
        <span className="appico"><Icon k="mug" sw={1.8} /></span>
        <b id="alert-t">Clear {fmtBytes(store.downloads + store.old + store.logs)} of Homebrew cache?</b>
        <p>Downloaded bottles, installers and old versions will be removed. Installed packages keep working. Brew downloads files again when it needs them.</p>
        <div className="btns">
          <button className="pb" onClick={onCancel}>Cancel</button>
          <button className="pb def" ref={ok} onClick={onConfirm}>Clear Cache</button>
        </div>
      </div>
    </>
  );
}

type Cmd = { label: string; icon: Glyph; run: () => void };
export function CommandPalette({ open, onClose, catalog, onPick, commands }: { open: boolean; onClose: () => void; catalog: Pkg[]; onPick: (p: Pkg) => void; commands: Cmd[] }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    const t = setTimeout(() => input.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);
  const { pkgs, cmds } = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return { pkgs: ql ? search(catalog, q, 6) : [], cmds: commands.filter((c) => !ql || c.label.toLowerCase().includes(ql)) };
  }, [q, catalog, commands]);
  if (!open) return null;
  const flat = [...pkgs.map((p) => () => onPick(p)), ...cmds.map((c) => c.run)];
  const pick = (i: number) => {
    flat[i]?.();
    onClose();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(flat.length - 1, a + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    }
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="pal glass-hi" role="dialog" aria-label="Quick Open">
        <div className="in">
          <Icon k="search" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} placeholder="Search packages or commands" aria-label="Quick Open" spellCheck={false} />
        </div>
        <div className="res">
          {pkgs.length > 0 && <div className="h">Packages</div>}
          {pkgs.map((p, i) => (
            <button key={pkgKey(p)} className={`it ${active === i ? "a" : ""}`} onMouseMove={() => setActive(i)} onClick={() => pick(i)}>
              <Tile pkg={p} size="xs" />
              <span>{p.name}</span>
              <small>{p.desc}</small>
            </button>
          ))}
          {cmds.length > 0 && <div className="h">Commands</div>}
          {cmds.map((c, j) => {
            const i = pkgs.length + j;
            return (
              <button key={c.label} className={`it ${active === i ? "a" : ""}`} onMouseMove={() => setActive(i)} onClick={() => pick(i)}>
                <Icon k={c.icon} className="g" />
                <span>{c.label}</span>
              </button>
            );
          })}
          {flat.length === 0 && <Empty icon="search" title="No matches" sub="Try a package name or a command." />}
        </div>
      </div>
    </>
  );
}

export function Onboarding({ onInstall, onRecheck, onSkip, checking }: { onInstall: () => void; onRecheck: () => void; onSkip: () => void; checking: boolean }) {
  const [opened, setOpened] = useState(false);
  return (
    <div className="onb" data-tauri-drag-region>
      <div>
        <span className="appico"><Icon k="mug" sw={1.8} /></span>
        <h1>Homebrew is needed</h1>
        <p>BrewStore installs and updates packages through Homebrew, which isn’t on this Mac yet. It’s free and takes a few minutes. You can browse the catalog without it.</p>
        {opened && <p>Finish the installer in the Terminal window that opened, then check again.</p>}
        <div className="btns">
          <button className="pb" onClick={onSkip}>Just Browse</button>
          {opened ? (
            <button className="pb def" onClick={onRecheck} disabled={checking}>{checking ? "Checking…" : "Check Again"}</button>
          ) : (
            <button className="pb def" onClick={() => { onInstall(); setOpened(true); }}>Install Homebrew…</button>
          )}
        </div>
        <button className="lnk" onClick={() => openExternal("https://brew.sh")}>What’s Homebrew? <Icon k="ext" sw={1.8} /></button>
      </div>
    </div>
  );
}
