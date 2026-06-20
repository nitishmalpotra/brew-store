import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { search, fmtCount, type Pkg, type Trend, type BrewInfo } from "./api";

export type PkgState = "installed" | "outdated" | "available";
export type View = "dashboard" | "browse" | "installed" | "updates";
export type InstTab = "all" | "formula" | "cask";
export type Action = "install" | "uninstall" | "upgrade";
export type Job = { action: Action; title: string; lines: string[]; status: "running" | "success" | "error" };

// only ever open http(s) links externally
function openExternal(url: string) {
  if (/^https?:\/\//i.test(url)) openUrl(url).catch(() => {});
}

// --- inline icons, no dependency ---
const icon = (path: ReactNode) => (cls: string) => (
  <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);
export const I = {
  search: icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></>),
  box: icon(<><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" /></>),
  refresh: icon(<><path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 3v5h-5" /></>),
  check: icon(<path d="m5 12 4.5 4.5L19 7" />),
  x: icon(<><path d="M6 6 18 18" /><path d="M18 6 6 18" /></>),
  ext: icon(<><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M19 13v6H5V5h6" /></>),
  bolt: icon(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />),
  grid: icon(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>),
  sun: icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" /></>),
  moon: icon(<path d="M21 12.8A8 8 0 1 1 11.2 3 6 6 0 0 0 21 12.8Z" />),
  github: (cls: string) => (
    <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 .1.8 1.7 2.6 1.3.1-.7.4-1.2.7-1.5-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.6 18 4.9 18 4.9c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5Z" />
    </svg>
  ),
};

function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

function Spinner() {
  return (
    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const PRESS = "active:translate-x-px active:translate-y-px transition disabled:opacity-40 disabled:pointer-events-none";

export function Btn({ tone = "ghost", onClick, disabled, children }: {
  tone?: "primary" | "ghost" | "danger";
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const cls =
    tone === "primary"
      ? "bg-ink text-paper shadow-ink-sm hover:shadow-ink"
      : tone === "danger"
        ? "bg-surface text-ink hover:bg-ink hover:text-paper shadow-ink-sm"
        : "bg-surface text-ink shadow-ink-sm hover:shadow-ink";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`border-2 border-ink rounded-lg px-3 py-1.5 text-[13px] font-bold uppercase tracking-wide ${PRESS} ${cls}`}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-2xl tracking-wide text-ink mb-3 mt-1">{children}</h2>;
}

export function Sidebar({ view, setView, installedCount, updateCount, instTab, onInstTab, formulaCount, caskCount, theme, onToggleTheme, repoUrl }: {
  view: View;
  setView: (v: View) => void;
  installedCount: number;
  updateCount: number;
  instTab: InstTab;
  onInstTab: (t: InstTab) => void;
  formulaCount: number;
  caskCount: number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  repoUrl?: string;
}) {
  const item = (v: View, label: string, ic: (c: string) => ReactNode, badge?: ReactNode) => {
    const on = view === v;
    return (
      <button
        onClick={() => setView(v)}
        className={`flex items-center gap-2.5 w-full rounded-lg border-2 px-3 py-2 text-sm font-bold uppercase tracking-wide ${PRESS} ${
          on ? "bg-ink text-paper border-ink shadow-ink-sm" : "bg-transparent text-ink border-transparent hover:border-ink hover:bg-surface"
        }`}
      >
        <span>{ic("w-4 h-4")}</span>
        <span className="flex-1 text-left">{label}</span>
        {badge}
      </button>
    );
  };
  const badge = (n: number, on: boolean) => (
    <span className={`text-[11px] font-bold rounded border-2 border-ink px-1.5 leading-tight ${on ? "bg-paper text-ink" : "bg-ink text-paper"}`}>{n}</span>
  );
  return (
    <aside className="w-60 shrink-0 flex flex-col gap-1.5 px-3 pt-11 pb-4 bg-surface border-r-2 border-ink">
      <div className="px-1 pb-4 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg bg-ink border-2 border-ink grid place-items-center text-paper shadow-ink-sm">{I.box("w-5 h-5")}</div>
        <div className="font-display text-2xl tracking-wide leading-none">brew·store</div>
      </div>
      {item("dashboard", "Dashboard", I.grid)}
      {item("browse", "Browse", I.search)}
      <button
        onClick={() => { setView("installed"); onInstTab("all"); }}
        className={`flex items-center gap-2.5 w-full rounded-lg border-2 px-3 py-2 text-sm font-bold uppercase tracking-wide ${PRESS} ${
          view === "installed" ? "bg-ink text-paper border-ink shadow-ink-sm" : "bg-transparent text-ink border-transparent hover:border-ink hover:bg-surface"
        }`}
      >
        <span>{I.box("w-4 h-4")}</span>
        <span className="flex-1 text-left">Installed</span>
        {installedCount ? badge(installedCount, view === "installed") : null}
      </button>
      {view === "installed" && (
        <div className="flex flex-col gap-1 ml-4 pl-2 border-l-2 border-line">
          {([["formula", "Formulae", formulaCount], ["cask", "Casks", caskCount]] as [InstTab, string, number][]).map(([tab, label, n]) => {
            const on = instTab === tab;
            return (
              <button
                key={tab}
                onClick={() => { setView("installed"); onInstTab(tab); }}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-bold ${PRESS} ${
                  on ? "bg-ink text-paper" : "text-muted hover:text-ink hover:bg-surface"
                }`}
              >
                <span className="flex-1 text-left">{label}</span>
                <span className="text-[11px] opacity-80">{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {item("updates", "Updates", I.refresh, updateCount ? badge(updateCount, view === "updates") : null)}

      <div className="mt-auto flex flex-col gap-2.5">
        <div className="px-1 text-[12px] text-muted font-bold">
          <kbd className="border-2 border-ink rounded px-1 bg-surface">⌘K</kbd> search anything
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => repoUrl && openExternal(repoUrl)}
            disabled={!repoUrl}
            title={repoUrl ? "Open the GitHub repo" : "GitHub repo — coming soon"}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg border-2 border-ink px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide bg-surface text-ink shadow-ink-sm hover:shadow-ink ${PRESS}`}
          >
            {I.github("w-4 h-4")} GitHub
          </button>
          <button
            onClick={onToggleTheme}
            title="Toggle light / dark"
            className={`rounded-lg border-2 border-ink px-2.5 py-1.5 bg-surface text-ink shadow-ink-sm hover:shadow-ink ${PRESS}`}
          >
            {theme === "dark" ? I.sun("w-4 h-4") : I.moon("w-4 h-4")}
          </button>
        </div>
      </div>
    </aside>
  );
}

function StatusPill({ state }: { state: PkgState }) {
  if (state === "installed")
    return <span className="text-[10px] font-bold uppercase rounded border-2 border-ink px-1.5 bg-ink text-paper">Installed</span>;
  if (state === "outdated")
    return <span className="text-[10px] font-bold uppercase rounded border-2 border-ink px-1.5 bg-surface text-ink">Update</span>;
  return null;
}

function CheckBox({ on }: { on: boolean }) {
  return (
    <span className={`w-5 h-5 shrink-0 rounded border-2 border-ink grid place-items-center ${on ? "bg-ink text-paper" : "bg-surface text-transparent"}`}>
      {I.check("w-3.5 h-3.5")}
    </span>
  );
}

export function PkgRow({ pkg, state, onClick, select, children }: {
  pkg: Pkg;
  state: PkgState;
  onClick: () => void;
  select?: { on: boolean; toggle: () => void };
  children?: ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className="group fadein flex items-center gap-3 rounded-lg px-3.5 py-3 bg-surface border-2 border-ink shadow-ink-sm hover:shadow-ink cursor-pointer transition"
    >
      {select && (
        <button onClick={(e) => { e.stopPropagation(); select.toggle(); }} className="shrink-0">
          <CheckBox on={select.on} />
        </button>
      )}
      <div className="w-9 h-9 rounded-lg grid place-items-center text-sm font-bold bg-paper border-2 border-ink text-ink shrink-0 uppercase">
        {pkg.name.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-bold truncate">{pkg.name}</span>
          {pkg.cask && <span className="text-[10px] uppercase font-bold border-2 border-ink rounded px-1 leading-tight">cask</span>}
          <StatusPill state={state} />
        </div>
        <div className="text-sm text-muted truncate">{pkg.desc || "—"}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Dashboard({ formulae, casks, updates, brew, brewLoading, categories, go, onUpdateBrew }: {
  formulae: number;
  casks: number;
  updates: number;
  brew: BrewInfo;
  brewLoading: boolean;
  categories: { name: string; count: number }[];
  go: (v: View) => void;
  onUpdateBrew: () => void;
}) {
  const max = categories[0]?.count || 1;
  return (
    <div className="fadein flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Formulae" value={formulae} icon={I.box} onClick={() => go("installed")} />
        <StatCard label="Casks" value={casks} icon={I.box} onClick={() => go("installed")} />
        <StatCard label="Updates" value={updates} icon={I.refresh} onClick={() => go("updates")} highlight={updates > 0} />
      </div>

      <div className="rounded-xl bg-surface border-2 border-ink shadow-ink p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="font-display text-2xl tracking-wide leading-none">Homebrew</div>
            <div className="text-sm text-muted font-bold mt-1">
              {brewLoading ? "checking…" : `v${brew.version || "?"}`}
              <span className="text-faint"> · {brew.prefix || "/opt/homebrew"}</span>
            </div>
          </div>
          {!brewLoading &&
            (brew.updateAvailable ? (
              <span className="text-[11px] font-bold uppercase rounded border-2 border-ink px-2 py-1 bg-ink text-paper">Update → v{brew.latest}</span>
            ) : brew.version ? (
              <span className="text-[11px] font-bold uppercase rounded border-2 border-ink px-2 py-1 bg-surface text-ink">Up to date</span>
            ) : null)}
        </div>
        {brew.updateAvailable && (
          <div className="mt-4">
            <Btn tone="primary" onClick={onUpdateBrew}>Update Homebrew</Btn>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-surface border-2 border-ink shadow-ink p-5">
        <SectionTitle>Installed by category</SectionTitle>
        {categories.length === 0 ? (
          <div className="text-sm text-muted font-bold">Nothing installed yet — your library will break down here.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {categories.map((c) => (
              <div key={c.name} className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-sm font-bold truncate">{c.name}</span>
                <div className="flex-1 h-5 rounded border-2 border-ink bg-paper overflow-hidden">
                  <div className="h-full bg-ink grow" style={{ width: `${Math.max(6, (c.count / max) * 100)}%` }} />
                </div>
                <span className="w-7 text-right font-bold tabular-nums text-sm">{c.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: ic, onClick, highlight }: {
  label: string;
  value: number;
  icon: (c: string) => ReactNode;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border-2 border-ink shadow-ink hover:shadow-ink-lg p-5 flex flex-col gap-1 ${PRESS} ${
        highlight ? "bg-ink text-paper" : "bg-surface text-ink"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-[12px] font-bold uppercase tracking-wide ${highlight ? "text-paper/80" : "text-muted"}`}>{label}</span>
        <span className={highlight ? "text-paper" : "text-faint"}>{ic("w-5 h-5")}</span>
      </div>
      <div className="font-display text-5xl tracking-wide leading-none">{value}</div>
    </button>
  );
}

export function TrendingGrid({ data, stateOf, onOpen, onInstall }: {
  data: { formulae: Trend[]; casks: Trend[] } | null;
  stateOf: (p: Pkg) => PkgState;
  onOpen: (p: Pkg) => void;
  onInstall: (p: Pkg) => void;
}) {
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-muted font-bold py-10 justify-center">
        <Spinner /> Loading what everyone's installing…
      </div>
    );
  }
  const card = (t: Trend, rank: number) => {
    const st = stateOf(t.pkg);
    return (
      <div
        key={(t.pkg.cask ? "c:" : "f:") + t.pkg.name}
        onClick={() => onOpen(t.pkg)}
        className="fadein relative flex flex-col gap-1 rounded-lg bg-surface border-2 border-ink shadow-ink-sm hover:shadow-ink transition cursor-pointer p-3.5 pt-4"
      >
        <span className="absolute -top-3 -left-2 w-8 h-8 burst bg-ink text-paper grid place-items-center font-display text-base leading-none pt-0.5">{rank}</span>
        <div className="flex items-start justify-between gap-2 pl-5">
          <span className="font-bold truncate">{t.pkg.name}</span>
          {st === "installed" ? <StatusPill state="installed" /> : null}
        </div>
        <div className="text-xs text-muted line-clamp-2 min-h-8 pl-0.5">{t.pkg.desc || (t.pkg.cask ? "macOS app" : "command-line tool")}</div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <span className="text-[11px] font-bold text-ink flex items-center gap-1">{I.bolt("w-3.5 h-3.5")}{fmtCount(t.count)}/mo</span>
          {st === "available" && (
            <button
              onClick={(e) => { e.stopPropagation(); onInstall(t.pkg); }}
              className={`border-2 border-ink rounded-md px-2 py-0.5 text-[11px] font-bold uppercase bg-ink text-paper shadow-ink-sm hover:shadow-ink ${PRESS}`}
            >
              Get
            </button>
          )}
          {st === "outdated" && <StatusPill state="outdated" />}
        </div>
      </div>
    );
  };
  return (
    <div className="fadein">
      <SectionTitle>🔥 Trending casks</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">{data.casks.map((t, i) => card(t, i + 1))}</div>
      <div className="h-6" />
      <SectionTitle>📈 Trending formulae</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">{data.formulae.map((t, i) => card(t, i + 1))}</div>
    </div>
  );
}

export function SelectionBar({ count, onUninstall, onClear }: { count: number; onUninstall: () => void; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 slideup flex items-center gap-3 rounded-xl bg-surface border-2 border-ink shadow-ink-lg px-4 py-2.5">
      <span className="font-bold text-sm">{count} selected</span>
      <Btn tone="danger" onClick={onUninstall}>Uninstall</Btn>
      <button onClick={onClear} className="text-muted hover:text-ink font-bold text-sm uppercase tracking-wide">Clear</button>
    </div>
  );
}

export function DetailDrawer({ pkg, state, onClose, onPrimary }: {
  pkg: Pkg | null;
  state: PkgState;
  onClose: () => void;
  onPrimary: (action: Action) => void;
}) {
  if (!pkg) return null;
  return (
    <>
      <div className="fixed inset-0 bg-ink/20 fadein z-30" onClick={onClose} />
      <aside className="fixed top-0 right-0 h-full w-[380px] bg-surface border-l-2 border-ink shadow-ink-lg z-40 p-6 flex flex-col slideup">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg grid place-items-center text-lg font-bold bg-paper border-2 border-ink text-ink uppercase">{pkg.name.slice(0, 2)}</div>
            <div>
              <div className="text-lg font-bold leading-tight">{pkg.name}</div>
              <div className="text-xs text-muted font-bold uppercase">
                {pkg.cask ? "Cask" : "Formula"}
                {pkg.version ? ` · ${pkg.version}` : ""}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-ink hover:text-muted">{I.x("w-5 h-5")}</button>
        </div>
        <p className="mt-4 text-sm text-muted leading-relaxed">{pkg.desc || "No description available."}</p>
        {pkg.homepage && (
          <button onClick={() => openExternal(pkg.homepage!)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-ink hover:underline self-start">
            {I.ext("w-3.5 h-3.5")} {safeHost(pkg.homepage)}
          </button>
        )}
        <div className="mt-auto pt-6 flex flex-col gap-2">
          {state === "available" && <Btn tone="primary" onClick={() => onPrimary("install")}>Install</Btn>}
          {state === "outdated" && (
            <>
              <Btn tone="primary" onClick={() => onPrimary("upgrade")}>Update</Btn>
              <Btn tone="danger" onClick={() => onPrimary("uninstall")}>Uninstall</Btn>
            </>
          )}
          {state === "installed" && <Btn tone="danger" onClick={() => onPrimary("uninstall")}>Uninstall</Btn>}
        </div>
      </aside>
    </>
  );
}

export function InstallOverlay({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [job?.lines.length]);
  if (!job) return null;
  const done = job.status !== "running";
  const verb = job.action === "uninstall" ? "Removing" : job.action === "upgrade" ? "Updating" : "Installing";
  const past = job.action === "uninstall" ? "Removed" : job.action === "upgrade" ? "Updated" : "Installed";
  const headline = job.status === "success" ? `${past} ${job.title}!` : job.status === "error" ? `${verb} failed` : `${verb} ${job.title}…`;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 fadein">
      <div className="w-[540px] max-w-[92vw] rounded-xl bg-surface border-2 border-ink shadow-ink-lg overflow-hidden slideup">
        <div className="p-6">
          <div className="flex items-center gap-3.5">
            {job.status === "success" ? (
              <div className="w-12 h-12 burst bg-ink text-paper grid place-items-center pop">{I.check("w-7 h-7")}</div>
            ) : (
              <div className={`w-11 h-11 rounded-lg border-2 border-ink grid place-items-center pop ${job.status === "error" ? "bg-surface text-ink" : "bg-ink text-paper"}`}>
                {job.status === "error" ? I.x("w-6 h-6") : <Spinner />}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-display text-2xl tracking-wide leading-none">{headline}</div>
              <div className="text-xs text-muted font-bold mt-1">{done ? "Done." : "Hang tight — grab a coffee ☕"}</div>
            </div>
          </div>
          {!done && (
            <div className="mt-4 h-3 rounded border-2 border-ink overflow-hidden bg-surface">
              <div className="h-full w-full stripes" />
            </div>
          )}
        </div>
        <div ref={scroller} className="mx-6 mb-4 max-h-44 overflow-auto rounded-lg bg-paper border-2 border-ink p-3 font-mono text-[11.5px] leading-relaxed text-ink">
          {job.lines.length === 0 ? (
            <div className="text-faint">starting…</div>
          ) : (
            job.lines.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">{l}</div>
            ))
          )}
        </div>
        {done && (
          <div className="px-6 pb-6 flex justify-end">
            <Btn tone="primary" onClick={onClose}>Done</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

function PaletteItem({ active, onHover, onClick, children }: {
  active: boolean;
  onHover: () => void;
  onClick: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div
      ref={ref}
      onMouseMove={onHover}
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-bold cursor-pointer border-2 ${active ? "bg-ink text-paper border-ink" : "text-ink border-transparent"}`}
    >
      {children}
    </div>
  );
}

export function CommandPalette({ open, onClose, catalog, onPick, onView }: {
  open: boolean;
  onClose: () => void;
  catalog: Pkg[];
  onPick: (p: Pkg) => void;
  onView: (v: View) => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  const { cmds, pkgs } = useMemo(() => {
    const base = [
      { label: "Go to Dashboard", view: "dashboard" as View },
      { label: "Go to Browse", view: "browse" as View },
      { label: "Go to Installed", view: "installed" as View },
      { label: "Go to Updates", view: "updates" as View },
    ];
    const ql = q.trim().toLowerCase();
    return {
      cmds: ql ? base.filter((c) => c.label.toLowerCase().includes(ql)) : base,
      pkgs: ql ? search(catalog, q, 7) : [],
    };
  }, [q, catalog]);

  if (!open) return null;

  const flat: (() => void)[] = [
    ...cmds.map((c) => () => { onView(c.view); onClose(); }),
    ...pkgs.map((p) => () => { onPick(p); onClose(); }),
  ];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[active]?.();
    }
  };

  let idx = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-28 bg-ink/30 fadein" onClick={onClose}>
      <div className="w-[560px] max-w-[92vw] rounded-xl bg-surface border-2 border-ink shadow-ink-lg overflow-hidden slideup" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 border-b-2 border-ink">
          <span>{I.search("w-4 h-4")}</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKey}
            placeholder="Search packages or jump to…"
            className="flex-1 py-3.5 bg-transparent outline-none text-[15px] font-bold placeholder:text-faint placeholder:font-normal"
          />
        </div>
        <div className="max-h-80 overflow-auto p-1.5">
          {flat.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted font-bold">No matches</div>}
          {cmds.length > 0 && <div className="px-2.5 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-faint">Actions</div>}
          {cmds.map((c) => {
            idx++;
            const a = idx;
            return (
              <PaletteItem key={c.label} active={active === a} onHover={() => setActive(a)} onClick={() => { onView(c.view); onClose(); }}>
                <span>{I.grid("w-4 h-4")}</span>
                <span className="flex-1">{c.label}</span>
              </PaletteItem>
            );
          })}
          {pkgs.length > 0 && <div className="px-2.5 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-faint">Packages</div>}
          {pkgs.map((p) => {
            idx++;
            const a = idx;
            return (
              <PaletteItem key={(p.cask ? "c:" : "f:") + p.name} active={active === a} onHover={() => setActive(a)} onClick={() => { onPick(p); onClose(); }}>
                <span className="w-5 h-5 rounded border-2 border-current grid place-items-center text-[10px] font-bold uppercase">{p.name.slice(0, 1)}</span>
                <span className="flex-1 truncate">
                  {p.name}
                  <span className="font-normal opacity-70"> · {p.desc || (p.cask ? "cask" : "formula")}</span>
                </span>
              </PaletteItem>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Syncing() {
  return (
    <div className="h-full grid place-items-center">
      <div className="text-center fadein">
        <div className="w-16 h-16 burst bg-ink grid place-items-center text-paper mx-auto"><Spinner /></div>
        <div className="mt-5 font-display text-2xl tracking-wide">Syncing the catalog…</div>
        <div className="text-sm text-muted font-bold">Grabbing 16,000+ formulae &amp; casks. One-time, then cached.</div>
      </div>
    </div>
  );
}

export function Empty({ icon: ic, title, sub, children }: { icon: (c: string) => ReactNode; title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="h-full grid place-items-center">
      <div className="text-center fadein max-w-sm px-6">
        <div className="w-16 h-16 rounded-lg bg-surface border-2 border-ink shadow-ink grid place-items-center mx-auto text-ink">{ic("w-8 h-8")}</div>
        <div className="mt-5 font-display text-2xl tracking-wide">{title}</div>
        <div className="text-sm text-muted font-bold">{sub}</div>
        {children && <div className="mt-4 flex justify-center">{children}</div>}
      </div>
    </div>
  );
}
