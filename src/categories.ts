import type { Pkg } from "./api";

// ponytail: Homebrew has no official taxonomy, so this is a keyword heuristic over
// name + description. First match wins, so order rules specific → broad.
const RULES: [string, string[]][] = [
  ["Browsers", ["browser", "chrome", "firefox", "safari", "brave", " edge", " arc"]],
  ["Editors & IDEs", ["editor", " ide", "vim", "emacs", "vscode", "intellij", "sublime", "textmate", "neovim", "jetbrains"]],
  ["Languages & Runtimes", ["python", "node", "nodejs", "ruby", "golang", " go ", "rust", " java", " php", "perl", "runtime", "compiler", "jdk", "dotnet", ".net", "kotlin", " swift", " lua", "deno", " bun "]],
  ["Databases", ["database", "postgres", "mysql", "mariadb", "sqlite", "redis", "mongo", "cassandra", "duckdb", "datastore"]],
  ["DevOps & Cloud", ["docker", "kubernetes", "kubectl", "terraform", "ansible", " aws", "gcloud", "azure", "cloud", "container", "helm", "vagrant", "pulumi", "serverless"]],
  ["Version Control", ["git ", "github", "gitlab", "subversion", "mercurial", "version control"]],
  ["Networking", ["network", "http", "curl", "wget", " dns", " vpn", "proxy", " ssh", " tcp", "socket", "nmap", " ssl", " tls", "packet"]],
  ["Media & Graphics", ["video", "audio", "image", "photo", "ffmpeg", "media", "graphic", "music", "player", "codec", "font", "imagemagick", "render"]],
  ["Terminal & Shell", ["shell", "terminal", "prompt", " zsh", " bash", " fish", "tmux", " cli", "command-line", "command line"]],
  ["Security", ["password", "encrypt", "security", " gpg", "crypto", "keychain", "secret", "vault", " auth", " 2fa", " hash", "firewall"]],
  ["Text & Data", ["json", "yaml", " xml", "parser", "markdown", " csv", "grep", " sed", " awk", " jq", "regex", "diff"]],
  ["Productivity", ["note", "task", "todo", "calendar", "productivity", "launcher", "clipboard", "screenshot", "office", "document"]],
  ["Libraries", ["library", "framework", " sdk", "bindings", "headers"]],
];

export function categorize(p: Pkg): string {
  const hay = ` ${p.name} ${p.desc} `.toLowerCase();
  for (const [cat, kws] of RULES) {
    if (kws.some((kw) => hay.includes(kw))) return cat;
  }
  return "Other";
}

export function categoryCounts(pkgs: Pkg[]): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const p of pkgs) m.set(categorize(p), (m.get(categorize(p)) ?? 0) + 1);
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
