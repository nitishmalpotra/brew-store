import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api";
import type { Pkg } from "./api";
import { categoryCounts } from "./categories";
import {
  Sidebar,
  PkgRow,
  Btn,
  Dashboard,
  DetailDrawer,
  InstallOverlay,
  CommandPalette,
  TrendingGrid,
  SelectionBar,
  SectionTitle,
  Syncing,
  Empty,
  I,
  type Action,
  type Job,
  type PkgState,
  type View,
  type InstTab,
} from "./ui";

const key = (p: Pkg) => (p.cask ? "c:" : "f:") + p.name;
// Set this once the GitHub repo exists; the sidebar button stays a placeholder until then.
const REPO_URL = "https://github.com/nitishmalpotra/brew-store";

export default function App() {
  const [catalog, setCatalog] = useState<Pkg[]>([]);
  const [syncing, setSyncing] = useState(true);
  const [trend, setTrend] = useState<{ formulae: api.Trend[]; casks: api.Trend[] } | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [query, setQuery] = useState("");
  const [inst, setInst] = useState<{ formulae: Set<string>; casks: Set<string> }>({ formulae: new Set(), casks: new Set() });
  const [outdated, setOutdated] = useState<api.Outdated[]>([]);
  const [brew, setBrew] = useState<api.BrewInfo>({ version: "", prefix: "", latest: "", updateAvailable: false });
  const [brewLoading, setBrewLoading] = useState(true);
  const [selected, setSelected] = useState<Pkg | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [palette, setPalette] = useState(false);
  const [instFilter, setInstFilter] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [instTab, setInstTab] = useState<InstTab>("all");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const s = localStorage.getItem("theme");
    if (s === "light" || s === "dark") return s;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const refreshLocal = useCallback(async () => {
    const [i, o, b] = await Promise.all([api.installed(), api.outdated(), api.brewInfo()]);
    setInst(i);
    setOutdated(o);
    setBrew(b);
    setBrewLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const cat = await api.loadCatalog();
      setCatalog(cat);
      setSyncing(false);
      api.trending(cat).then(setTrend).catch(() => {});
    })();
    refreshLocal();
  }, [refreshLocal]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (e.key === "Escape") {
        setPalette(false);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (view !== "installed") setSel(new Set());
  }, [view]);

  const outdatedNames = useMemo(() => new Set(outdated.map((o) => o.name)), [outdated]);
  const stateOf = useCallback(
    (p: Pkg): PkgState => {
      if (outdatedNames.has(p.name)) return "outdated";
      if ((p.cask ? inst.casks : inst.formulae).has(p.name)) return "installed";
      return "available";
    },
    [inst, outdatedNames],
  );

  const byName = useMemo(() => {
    const m = new Map<string, Pkg>();
    for (const p of catalog) m.set(key(p), p);
    return m;
  }, [catalog]);
  const results = useMemo(() => api.search(catalog, query), [catalog, query]);
  const installedPkgs = useMemo(() => {
    const out: Pkg[] = [];
    for (const n of inst.formulae) out.push(byName.get("f:" + n) ?? { name: n, desc: "", version: "", cask: false });
    for (const n of inst.casks) out.push(byName.get("c:" + n) ?? { name: n, desc: "", version: "", cask: true });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [inst, byName]);
  const shownInstalled = useMemo(() => {
    const q = instFilter.trim().toLowerCase();
    return q ? installedPkgs.filter((p) => p.name.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q)) : installedPkgs;
  }, [installedPkgs, instFilter]);
  const visibleInstalled = useMemo(
    () => shownInstalled.filter((p) => (instTab === "all" ? true : instTab === "cask" ? p.cask : !p.cask)),
    [shownInstalled, instTab],
  );
  const cats = useMemo(() => categoryCounts(installedPkgs).slice(0, 10), [installedPkgs]);
  const updatePkgs = useMemo(
    () => outdated.map((o) => byName.get((o.cask ? "c:" : "f:") + o.name) ?? { name: o.name, desc: "", version: o.current, cask: o.cask }),
    [outdated, byName],
  );
  const outdatedByName = useMemo(() => {
    const m = new Map<string, api.Outdated>();
    for (const o of outdated) m.set(o.name, o);
    return m;
  }, [outdated]);

  const startJob = useCallback(
    async (action: Action, title: string, args: string[]) => {
      setSelected(null);
      setPalette(false);
      setJob({ action, title, lines: [], status: "running" });
      await api.runStream(
        args,
        (l) => setJob((j) => (j ? { ...j, lines: [...j.lines.slice(-300), l.text] } : j)),
        async (d) => {
          setJob((j) => (j ? { ...j, status: d.success ? "success" : "error" } : j));
          await refreshLocal();
        },
      );
    },
    [refreshLocal],
  );

  const argv = (action: Action, p: Pkg) => [action, ...(p.cask ? ["--cask"] : []), p.name];
  const install = (p: Pkg) => startJob("install", p.name, argv("install", p));
  const uninstall = (p: Pkg) => startJob("uninstall", p.name, argv("uninstall", p));
  const upgrade = (p: Pkg) => startJob("upgrade", p.name, argv("upgrade", p));
  const onPrimary = (p: Pkg, a: Action) => (a === "install" ? install(p) : a === "uninstall" ? uninstall(p) : upgrade(p));

  const toggleSel = (p: Pkg) =>
    setSel((s) => {
      const k = key(p);
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  const allShownSelected = visibleInstalled.length > 0 && visibleInstalled.every((p) => sel.has(key(p)));
  const toggleAll = () => setSel(allShownSelected ? new Set() : new Set(visibleInstalled.map(key)));
  const uninstallSelected = () => {
    const names = installedPkgs.filter((p) => sel.has(key(p))).map((p) => p.name);
    if (!names.length) return;
    setSel(new Set());
    // brew uninstall auto-detects formula vs cask, so one command handles a mixed batch
    startJob("uninstall", `${names.length} package${names.length > 1 ? "s" : ""}`, ["uninstall", ...names]);
  };

  const checkUpdates = () => startJob("check", "for updates", ["update"]);

  const openPkg = useCallback((p: Pkg) => {
    setView("browse");
    setSelected(p);
  }, []);

  const instRow = (p: Pkg) => (
    <PkgRow key={key(p)} pkg={p} state={stateOf(p)} onClick={() => setSelected(p)} select={{ on: sel.has(key(p)), toggle: () => toggleSel(p) }}>
      <Btn tone="danger" onClick={() => uninstall(p)}>Uninstall</Btn>
    </PkgRow>
  );

  if (syncing) {
    return (
      <div className="flex h-full">
        <Sidebar view={view} setView={setView} installedCount={0} updateCount={0} instTab={instTab} onInstTab={setInstTab} formulaCount={0} caskCount={0} theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} repoUrl={REPO_URL || undefined} />
        <main className="flex-1">
          <Syncing />
        </main>
      </div>
    );
  }

  const instFormulae = visibleInstalled.filter((p) => !p.cask);
  const instCasks = visibleInstalled.filter((p) => p.cask);

  return (
    <div className="flex h-full text-ink">
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 h-9 z-20" />
      <Sidebar
        view={view}
        setView={setView}
        installedCount={inst.formulae.size + inst.casks.size}
        updateCount={outdated.length}
        instTab={instTab}
        onInstTab={setInstTab}
        formulaCount={inst.formulae.size}
        caskCount={inst.casks.size}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        repoUrl={REPO_URL || undefined}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="pt-9 px-7 pb-4">
          <div className="max-w-5xl mx-auto">
          {view === "dashboard" && <h1 className="font-display text-3xl tracking-wide">Dashboard</h1>}
          {view === "browse" && (
            <div className="flex items-center gap-2.5 rounded-lg bg-surface border-2 border-ink shadow-ink-sm focus-within:shadow-ink px-4 max-w-2xl transition">
              <span>{I.search("w-4 h-4")}</span>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search formulae and casks…  (or press ⌘K)"
                className="flex-1 py-3 bg-transparent outline-none text-[15px] font-bold placeholder:text-faint placeholder:font-normal"
              />
              {query && <button onClick={() => setQuery("")}>{I.x("w-4 h-4")}</button>}
            </div>
          )}
          {view === "installed" && (
            <div className="flex items-center gap-4 flex-wrap">
              <h1 className="font-display text-3xl tracking-wide">Installed</h1>
              <div className="flex items-center gap-2.5 rounded-lg bg-surface border-2 border-ink shadow-ink-sm focus-within:shadow-ink px-3.5 flex-1 min-w-50 max-w-md transition">
                <span>{I.search("w-4 h-4")}</span>
                <input
                  value={instFilter}
                  onChange={(e) => setInstFilter(e.target.value)}
                  placeholder="Filter installed…"
                  className="flex-1 py-2 bg-transparent outline-none text-sm font-bold placeholder:text-faint placeholder:font-normal"
                />
              </div>
            </div>
          )}
          {view === "updates" && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h1 className="font-display text-3xl tracking-wide">Updates</h1>
              <div className="flex gap-2">
                <Btn tone="ghost" onClick={checkUpdates}>Check for updates</Btn>
                {updatePkgs.length > 0 && <Btn tone="primary" onClick={() => startJob("upgrade", "everything", ["upgrade"])}>Update all</Btn>}
              </div>
            </div>
          )}
          </div>
        </header>

        <section className="flex-1 overflow-auto px-7 pb-24">
          <div className="flex flex-col gap-2 max-w-5xl mx-auto">
            {view === "dashboard" && (
              <Dashboard
                formulae={inst.formulae.size}
                casks={inst.casks.size}
                updates={outdated.length}
                brew={brew}
                brewLoading={brewLoading}
                categories={cats}
                go={setView}
                onUpdateBrew={() => startJob("upgrade", "Homebrew", ["update"])}
              />
            )}

            {view === "browse" &&
              (query === "" ? (
                <TrendingGrid data={trend} stateOf={stateOf} onOpen={setSelected} onInstall={install} />
              ) : results.length === 0 ? (
                <Empty icon={I.search} title="No matches" sub={`Nothing found for “${query}”.`} />
              ) : (
                results.map((p) => {
                  const st = stateOf(p);
                  return (
                    <PkgRow key={key(p)} pkg={p} state={st} onClick={() => setSelected(p)}>
                      {st === "available" && <Btn tone="primary" onClick={() => install(p)}>Install</Btn>}
                      {st === "outdated" && <Btn tone="primary" onClick={() => upgrade(p)}>Update</Btn>}
                    </PkgRow>
                  );
                })
              ))}

            {view === "installed" &&
              (installedPkgs.length === 0 ? (
                <Empty icon={I.box} title="Nothing installed yet" sub="Packages you install will show up here." />
              ) : visibleInstalled.length === 0 ? (
                <Empty
                  icon={I.search}
                  title="No matches"
                  sub={instFilter ? `No installed package matches “${instFilter}”.` : `No ${instTab === "cask" ? "casks" : "formulae"} installed.`}
                />
              ) : (
                <>
                  <button onClick={toggleAll} className="self-start text-xs font-bold uppercase tracking-wide text-muted hover:text-ink mb-1">
                    {allShownSelected ? "Clear selection" : "Select all"}
                  </button>
                  {instFormulae.length > 0 && (
                    <>
                      <SectionTitle>Formulae ({instFormulae.length})</SectionTitle>
                      {instFormulae.map(instRow)}
                    </>
                  )}
                  {instCasks.length > 0 && (
                    <>
                      <SectionTitle>Casks ({instCasks.length})</SectionTitle>
                      {instCasks.map(instRow)}
                    </>
                  )}
                </>
              ))}

            {view === "updates" &&
              (updatePkgs.length === 0 ? (
                <Empty icon={I.check} title="You're all up to date" sub="Every installed package is on its latest version. ✨">
                  <Btn tone="ghost" onClick={checkUpdates}>Check again</Btn>
                </Empty>
              ) : (
                updatePkgs.map((p) => {
                  const o = outdatedByName.get(p.name);
                  return (
                    <PkgRow key={key(p)} pkg={p} state="outdated" onClick={() => setSelected(p)}>
                      {o && <span className="text-xs text-muted font-bold tabular-nums mr-1">{o.installed} → {o.current}</span>}
                      <Btn tone="primary" onClick={() => upgrade(p)}>Update</Btn>
                    </PkgRow>
                  );
                })
              ))}
          </div>
        </section>
      </main>

      <SelectionBar count={sel.size} onUninstall={uninstallSelected} onClear={() => setSel(new Set())} />
      <DetailDrawer
        pkg={selected}
        state={selected ? stateOf(selected) : "available"}
        onClose={() => setSelected(null)}
        onPrimary={(a) => selected && onPrimary(selected, a)}
      />
      <InstallOverlay job={job} onClose={() => setJob(null)} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} catalog={catalog} onPick={openPkg} onView={setView} />
    </div>
  );
}
