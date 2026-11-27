import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import * as api from "./api";
import type { Pkg } from "./api";
import { categoryCounts } from "./categories";
import { blank, fraction, step, type Progress } from "./progress";
import {
  Activity, ActivityPopover, ChartItem, ClearAlert, CommandPalette, Empty, Group, Icon, Inspector, Onboarding, Overview, Row, Sidebar,
  jobLabel, openExternal, pkgKey, REPO_URL, type Action, type Job, type PkgState, type Seg, type View,
} from "./ui";

const TITLES: Record<View, string> = { overview: "Overview", discover: "Discover", installed: "Installed", updates: "Updates", adopt: "Adopt" };
const narrow = () => window.innerWidth <= 760;

export default function App() {
  const [catalog, setCatalog] = useState<Pkg[]>([]);
  const [syncing, setSyncing] = useState(true);
  const [trend, setTrend] = useState<{ formulae: api.Trend[]; casks: api.Trend[] } | null>(null);
  const [view, setView] = useState<View>("overview");
  const [query, setQuery] = useState("");
  const [inst, setInst] = useState<{ formulae: Set<string>; casks: Set<string> }>({ formulae: new Set(), casks: new Set() });
  const [outdated, setOutdated] = useState<api.Outdated[]>([]);
  const [apps, setApps] = useState<string[]>([]);
  const [brew, setBrew] = useState<api.BrewInfo>({ version: "", prefix: "", latest: "", updateAvailable: false });
  const [brewLoading, setBrewLoading] = useState(true);
  const [store, setStore] = useState<api.Storage | null>(null);
  const [brewMissing, setBrewMissing] = useState(false);
  const [skipBrew, setSkipBrew] = useState(false);
  const [recheck, setRecheck] = useState(false);
  const [selected, setSelected] = useState<Pkg | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [palette, setPalette] = useState(false);
  const [pop, setPop] = useState(false);
  const [askClear, setAskClear] = useState(false);
  const [toast, setToast] = useState("");
  const [seg, setSeg] = useState<Seg>("all");
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [flip, setFlip] = useState(false); // wide: hide sidebar; narrow: show it as an overlay
  const [scrolled, setScrolled] = useState(false);

  const refreshLocal = useCallback(async () => {
    const [i, o, b] = await Promise.all([api.installed(), api.outdated(), api.brewInfo()]);
    setInst(i);
    setOutdated(o);
    setBrew(b);
    setBrewLoading(false);
  }, []);
  const refreshStore = useCallback(() => api.storage().then(setStore), []);

  useEffect(() => {
    api.loadCatalog().then((cat) => {
      setCatalog(cat);
      setSyncing(false);
      api.trending(cat).then(setTrend).catch(() => {});
    }).catch(() => setSyncing(false));
    api.brewExists().then((ok) => setBrewMissing(!ok));
    api.listApps().then(setApps);
    refreshLocal().then(refreshStore);
  }, [refreshLocal, refreshStore]);

  const recheckBrew = useCallback(async () => {
    setRecheck(true);
    const ok = await api.brewExists();
    setBrewMissing(!ok);
    if (ok) await refreshLocal();
    setRecheck(false);
  }, [refreshLocal]);

  const go = useCallback((v: View) => {
    setView(v);
    setQuery("");
    setSelected(null);
    setSelecting(false);
    setSel(new Set());
    if (narrow()) setFlip(false);
    if (v === "adopt") api.listApps().then(setApps); // rescan on entry so the list stays fresh
  }, []);

  // ---------- job queue: brew holds a global lock, so jobs run one at a time ----------
  const nextId = useRef(1);
  const patch = (id: number, f: (j: Job) => Job) => setJobs((js) => js.map((j) => (j.id === id ? f(j) : j)));
  const enqueue = useCallback((action: Action, key: string, title: string, args: string[], pkg?: Pkg, prog: Progress = blank()) => {
    setJobs((js) =>
      js.some((j) => j.key === key && (j.status === "queued" || j.status === "running"))
        ? js
        : [...js.filter((j) => j.key !== key), { id: nextId.current++, action, key, title, pkg, args, lines: [], status: "queued", prog, seen: [] }],
    );
  }, []);
  const starting = useRef(false);
  useEffect(() => {
    if (starting.current || jobs.some((j) => j.status === "running")) return;
    const j = jobs.find((x) => x.status === "queued");
    if (!j) return;
    starting.current = true;
    patch(j.id, (x) => ({ ...x, status: "running" }));
    (async () => {
      // the dry run gives the step total; if brew can't say, the ring stays indeterminate
      if (j.pkg && (j.action === "install" || j.action === "adopt")) {
        const total = await api.installPlan(j.pkg);
        patch(j.id, (x) => ({ ...x, prog: { ...x.prog, total } }));
      }
      starting.current = false;
      const out: string[] = [];
      const done = async (success: boolean) => {
        patch(j.id, (x) => ({ ...x, status: success ? "success" : "error" }));
        if (success) setTimeout(() => setJobs((js) => js.filter((x) => x.id !== j.id)), 2500);
        if (j.action === "cleanup" && success) {
          const freed = out.map((t) => t.match(/has freed approximately (\S+)/)?.[1]).find(Boolean);
          setToast(freed ? `Freed ${freed}` : "Cache cleared");
        }
        await refreshLocal();
        refreshStore();
      };
      await api.runStream(
        j.args,
        (l) => {
          out.push(l.text);
          patch(j.id, (x) => {
            const up = l.text.match(/^==> Upgrading (\S+)$/);
            return { ...x, lines: [...x.lines.slice(-400), l.text], prog: step(x.prog, l.text), seen: up ? [...x.seen, up[1]] : x.seen };
          });
        },
        (d) => done(d.success),
      ).catch((e) => {
        patch(j.id, (x) => ({ ...x, lines: [...x.lines, `Error: ${e}`] }));
        done(false);
      });
    })();
  }, [jobs, refreshLocal, refreshStore]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Dock: progress bar while a job runs, badge for pending updates
  const running = jobs.find((j) => j.status === "running");
  const dockFrac = running ? fraction(running.prog) : -1;
  useEffect(() => {
    getCurrentWindow()
      .setProgressBar(dockFrac < 0 ? { status: ProgressBarStatus.None } : dockFrac ? { status: ProgressBarStatus.Normal, progress: Math.round(dockFrac * 100) } : { status: ProgressBarStatus.Indeterminate })
      .catch(() => {});
  }, [dockFrac]);
  useEffect(() => {
    getCurrentWindow().setBadgeCount(outdated.length || undefined).catch(() => {});
  }, [outdated.length]);

  // ---------- derived ----------
  const byKey = useMemo(() => new Map(catalog.map((p) => [pkgKey(p), p])), [catalog]);
  const outdatedByName = useMemo(() => new Map(outdated.map((o) => [o.name, o])), [outdated]);
  const stateOf = useCallback(
    (p: Pkg): PkgState => (outdatedByName.has(p.name) ? "outdated" : (p.cask ? inst.casks : inst.formulae).has(p.name) ? "installed" : "available"),
    [inst, outdatedByName],
  );
  const batch = jobs.find((j) => j.key === "batch" && (j.status === "running" || j.status === "queued"));
  const jobOf = useCallback(
    (p: Pkg): Job | undefined => {
      const own = jobs.find((j) => j.key === pkgKey(p));
      if (own || !batch || !outdatedByName.has(p.name)) return own;
      // rows during Update All: brew prints "==> Upgrading <name>" as it reaches each one
      const i = batch.seen.indexOf(p.name), last = batch.seen.length - 1;
      return { ...batch, key: pkgKey(p), pkg: p, prog: blank(), status: i < 0 ? "queued" : i === last && batch.status === "running" ? "running" : "success" };
    },
    [jobs, batch, outdatedByName],
  );
  const installedPkgs = useMemo(() => {
    const out: Pkg[] = [];
    for (const n of inst.formulae) out.push(byKey.get("f:" + n) ?? { name: n, desc: "", version: "", cask: false });
    for (const n of inst.casks) out.push(byKey.get("c:" + n) ?? { name: n, desc: "", version: "", cask: true });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [inst, byKey]);
  const updatePkgs = useMemo(() => outdated.map((o) => byKey.get((o.cask ? "c:" : "f:") + o.name) ?? { name: o.name, desc: "", version: o.current, cask: o.cask }), [outdated, byKey]);
  const adoptables = useMemo(() => api.adoptable(apps, catalog, inst.casks), [apps, catalog, inst.casks]);
  const adoptTokens = useMemo(() => new Set(adoptables.map((x) => x.pkg.name)), [adoptables]);
  const cats = useMemo(() => categoryCounts(installedPkgs), [installedPkgs]);
  const installs = useMemo(() => new Map([...(trend?.casks ?? []), ...(trend?.formulae ?? [])].map((t) => [pkgKey(t.pkg), t.count])), [trend]);
  const results = useMemo(() => api.search(catalog, query), [catalog, query]);
  const counts = { installed: inst.formulae.size + inst.casks.size, updates: outdated.length, adopt: adoptables.length };

  // ---------- actions ----------
  const act = useCallback(
    (action: Action, p: Pkg) => {
      // a cask whose app is already in /Applications must be adopted, or brew errors out;
      // --force reinstalls over that copy (--adopt fails on any version mismatch)
      if ((action === "install" && p.cask && adoptTokens.has(p.name)) || action === "adopt")
        return enqueue("adopt", pkgKey(p), p.name, ["install", "--cask", "--force", p.name], p);
      // cask upgrades get --force: self-updated apps leave a stale Caskroom copy plain upgrade refuses to overwrite
      const flags = p.cask ? (action === "upgrade" ? ["--cask", "--force"] : ["--cask"]) : [];
      enqueue(action, pkgKey(p), p.name, [action, ...flags, p.name], p, blank(action === "upgrade" ? 1 : 0));
    },
    [adoptTokens, enqueue],
  );
  const checkUpdates = useCallback(() => enqueue("update", "brew", "", ["update"]), [enqueue]);
  const updateAll = () => enqueue("upgrade", "batch", "all packages", ["upgrade"]);
  const clearCache = () => {
    setAskClear(false);
    enqueue("cleanup", "cache", "Homebrew cache", ["cleanup", "--prune=all"], undefined, blank(store?.files ?? 0, 1));
  };
  const uninstallSelected = () => {
    const names = installedPkgs.filter((p) => sel.has(pkgKey(p))).map((p) => p.name);
    if (names.length) enqueue("uninstall", "sel:" + names.join(","), `${names.length} package${names.length > 1 ? "s" : ""}`, ["uninstall", ...names]);
    setSel(new Set());
    setSelecting(false);
  };
  const open = useCallback((p: Pkg) => setSelected(p), []);
  const c = { stateOf, jobOf, onAct: act, onOpen: open, onPop: () => setPop(true) };

  const commands = useMemo(
    () => [
      ...(Object.keys(TITLES) as View[]).map((v) => ({ label: `Go to ${TITLES[v]}`, icon: "over" as const, run: () => go(v) })),
      { label: "Check for Updates", icon: "upd" as const, run: checkUpdates },
      { label: "Clear Homebrew Cache…", icon: "trash" as const, run: () => { go("overview"); setAskClear(true); } },
      { label: "Open Source on GitHub", icon: "code" as const, run: () => openExternal(REPO_URL) },
    ],
    [go, checkUpdates],
  );

  // ---------- keyboard ----------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && (k === "k" || k === "f")) {
        e.preventDefault();
        const q = document.getElementById("q");
        if (k === "f" && q && !narrow() && !flip) q.focus();
        else setPalette((v) => !v);
      } else if (e.key === "Escape") {
        setPalette(false);
        setPop(false);
        setAskClear(false);
        setSelected(null);
        if (narrow()) setFlip(false);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [flip]);

  if (brewMissing && !skipBrew) return <Onboarding onInstall={api.installHomebrew} onRecheck={recheckBrew} onSkip={() => setSkipBrew(true)} checking={recheck} />;

  // ---------- views ----------
  const searchView = query.trim() !== "" && view !== "installed";
  let body: React.ReactNode;
  if (searchView) {
    body = (
      <>
        <h1 className="lt">Results for “{query}”</h1>
        {results.length ? <Group>{results.map((p) => <Row key={pkgKey(p)} pkg={p} ctx="store" c={c} meta={p.cask ? "App" : "Tool"} />)}</Group>
          : <Empty icon="search" title="No results" sub="Try a shorter name, or search by what it does, like “json” or “video”." />}
      </>
    );
  } else if (view === "overview") {
    body = <Overview brew={brew} brewLoading={brewLoading} counts={counts} store={store} cleaning={jobs.find((j) => j.key === "cache")} categories={cats} go={go} onCheck={checkUpdates} onClear={() => setAskClear(true)} />;
  } else if (view === "discover") {
    const chart = (title: string, sub: string, list: api.Trend[]) => (
      <section>
        <div className="sh"><h2>{title}</h2><span>{sub}</span></div>
        <div className="chart">{list.map((t, i) => <ChartItem key={pkgKey(t.pkg)} t={t} rank={i + 1} c={c} />)}</div>
      </section>
    );
    body = (
      <>
        <h1 className="lt">Discover</h1>
        {trend ? (
          <>
            {chart("Top apps", "Most installed casks, last 30 days", trend.casks)}
            {chart("Top command-line tools", "Most installed formulae, last 30 days", trend.formulae)}
          </>
        ) : <div className="loading">Loading what people are installing…</div>}
      </>
    );
  } else if (view === "installed") {
    const q = query.trim().toLowerCase();
    const shown = installedPkgs.filter((p) => (!q || p.name.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q)) && (seg === "all" || (seg === "cask" ? p.cask : !p.cask)));
    const list = (title: string, items: Pkg[]) => items.length > 0 && (
      <section>
        <div className="ghdr">{title} <span>{items.length}</span></div>
        <Group>
          {items.map((p) => (
            <Row key={pkgKey(p)} pkg={p} ctx="installed" c={c}
              select={selecting ? { on: sel.has(pkgKey(p)), toggle: () => setSel((s) => { const n = new Set(s); n.has(pkgKey(p)) ? n.delete(pkgKey(p)) : n.add(pkgKey(p)); return n; }) } : undefined} />
          ))}
        </Group>
      </section>
    );
    body = (
      <>
        <div className="hrow">
          <h1 className="lt">Installed</h1>
          <div className="seg glass mseg">{segButtons(seg, setSeg)}</div>
          {installedPkgs.length > 0 && <button className="pb" onClick={() => { setSelecting((v) => !v); setSel(new Set()); }}>{selecting ? "Done" : "Select"}</button>}
        </div>
        {installedPkgs.length === 0 ? <Empty icon="box" title="Nothing installed yet" sub="Packages you install show up here." />
          : shown.length === 0 ? <Empty icon="search" title="No matches" sub={q ? `Nothing installed matches “${query}”.` : "Nothing in this list."} />
          : <>{list("Command-line tools", shown.filter((p) => !p.cask))}{list("Apps", shown.filter((p) => p.cask))}</>}
      </>
    );
  } else if (view === "updates") {
    body = (
      <>
        <div>
          <h1 className="lt">Updates</h1>
          <p className="lede">{updatePkgs.length ? `${updatePkgs.length} available` : "Everything is on its latest version."}</p>
        </div>
        {batch && (
          <div className="group" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <b style={{ fontWeight: 600 }}>{batch.seen.length ? `Updating ${batch.seen[batch.seen.length - 1]}` : batch.status === "queued" ? "Waiting" : "Preparing"}</b>
              <span className="ver">{jobLabel(batch).replace(/^Updating /, "")}</span>
            </div>
            <div className={`lbar ${fraction(batch.prog) ? "" : "ind"}`}><i style={fraction(batch.prog) ? { width: `${fraction(batch.prog) * 100}%` } : undefined} /></div>
          </div>
        )}
        {updatePkgs.length ? (
          <Group>
            {updatePkgs.map((p) => {
              const o = outdatedByName.get(p.name);
              return <Row key={pkgKey(p)} pkg={p} ctx="updates" c={c} text={<span className="ver">{o?.installed} → <b>{o?.current}</b></span>} />;
            })}
          </Group>
        ) : <Empty icon="checkc" title="All up to date" sub="BrewStore checks again each time it opens." />}
      </>
    );
  } else {
    body = (
      <>
        <div>
          <h1 className="lt">Adopt</h1>
          <p className="lede">These apps are on this Mac but weren’t installed with Homebrew. Adopting reinstalls them through brew so you can update them here.</p>
        </div>
        {adoptables.length ? <Group>{adoptables.map(({ app, pkg }) => <Row key={pkg.name} pkg={pkg} ctx="adopt" c={c} text={`${app}.app in Applications`} />)}</Group>
          : <Empty icon="checkc" title="Nothing to adopt" sub="Every app with a Homebrew cask is already managed by brew." />}
      </>
    );
  }

  return (
    <div className="shell" onClick={(e) => {
      const t = e.target as HTMLElement;
      if (pop && !t.closest(".pop, .av")) setPop(false);
      if (flip && narrow() && !t.closest(".sb, [data-flip]")) setFlip(false);
    }}>
      <div className={`app ${flip ? "flip" : ""}`}>
        <Sidebar view={view} go={go} query={query} setQuery={(q) => { setQuery(q); setSelected(null); }} counts={counts} onPalette={() => setPalette(true)} />
        <main className={`main ${scrolled ? "scrolled" : ""}`}>
          <div className="tb" data-tauri-drag-region>
            <div className="tl" data-tauri-drag-region>
              <button className="tbtn glass" data-flip onClick={() => setFlip((v) => !v)} aria-label="Show or hide sidebar"><Icon k="side" /></button>
              <span className="tbtitle" data-tauri-drag-region>{searchView ? "Search" : TITLES[view]}</span>
            </div>
            <Activity jobs={jobs} syncing={syncing} brew={brew} brewLoading={brewLoading} onClick={() => setPop((v) => !v)} />
            <div className="tr" data-tauri-drag-region>
              {view === "installed" && !searchView && <div className="seg glass">{segButtons(seg, setSeg)}</div>}
              {view === "updates" && updatePkgs.length > 0 && !batch && <button className="tbtn glass prim" onClick={updateAll}>Update All</button>}
              <button className="tbtn glass tsearch" onClick={() => setPalette(true)} aria-label="Search"><Icon k="search" /></button>
            </div>
          </div>
          <div className="scroll" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 30)}>
            <div className="inner">{body}</div>
          </div>
          {toast ? <div className="toast glass-hi">{toast}</div>
            : selecting && sel.size > 0 && view === "installed" && (
              <div className="selbar glass-hi">
                {sel.size} selected
                <button className="pb" onClick={() => setSel(new Set())}>Cancel</button>
                <button className="pb danger" onClick={uninstallSelected}>Uninstall {sel.size} Item{sel.size > 1 ? "s" : ""}</button>
              </div>
            )}
        </main>
        {selected && (
          <Inspector pkg={selected} state={stateOf(selected)} job={jobOf(selected)} installs={installs.get(pkgKey(selected))} outdated={outdatedByName.get(selected.name)} onAct={act} onClose={() => setSelected(null)} />
        )}
      </div>
      {pop && (
        <ActivityPopover
          jobs={jobs}
          onRemove={(id) => setJobs((js) => js.filter((j) => j.id !== id || j.status !== "queued"))}
          onDismiss={(id) => setJobs((js) => js.filter((j) => j.id !== id))}
          onTerminal={(j) => api.brewInTerminal(j.args)}
        />
      )}
      {askClear && store && <ClearAlert store={store} onCancel={() => setAskClear(false)} onConfirm={clearCache} />}
      <CommandPalette open={palette} onClose={() => setPalette(false)} catalog={catalog} onPick={open} commands={commands} />
    </div>
  );
}

const segButtons = (seg: Seg, set: (s: Seg) => void) =>
  ([["all", "All"], ["formula", "Tools"], ["cask", "Apps"]] as [Seg, string][]).map(([k, l]) => (
    <button key={k} aria-pressed={seg === k} onClick={() => set(k)}>{l}</button>
  ));
