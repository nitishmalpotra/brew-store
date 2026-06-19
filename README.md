# brew·store

**A modern, native macOS app for [Homebrew](https://brew.sh) — search, install, and manage your packages without ever touching the terminal.** Fast, keyboard-friendly, with a hand-drawn black-&-white comic-book look.

[![License: MIT](https://img.shields.io/badge/license-MIT-111.svg)](LICENSE)

> ⚠️ brew·store runs real `brew` commands on your Mac. Installing, updating, and uninstalling actually change your system.

## What is it?

Homebrew is the package manager most Mac developers use — but it's terminal-only. brew·store gives it a proper graphical home: a searchable storefront for all ~16,000 Homebrew formulae and casks, one-click install/uninstall with live progress, a dashboard of what you've got, and update management — all in a polished native window.

## Screenshots

> _Coming in the next commit — build from source below to see it live in the meantime._

## Features

- **📊 Dashboard** — counts of installed formulae & casks, available updates, your Homebrew version & prefix (and whether Homebrew itself is out of date), plus a breakdown of your library by category.
- **🔎 Browse** — instant ranked search across the whole catalog, with a **Trending this month** view powered by Homebrew's real install analytics.
- **⚡ Live install** — every install / update / uninstall streams `brew`'s output into an animated panel.
- **📦 Installed** — split into **Formulae** and **Casks**, with filtering, multi-select, and bulk uninstall.
- **🔄 Updates** — see what's outdated, update one or all, or run a real `brew update` to check upstream.
- **⌘K command palette**, light & dark themes, and full keyboard navigation.

## Install

**Requirements:** a Mac on Apple Silicon with [Homebrew](https://brew.sh) installed (at `/opt/homebrew`).

> Pre-built downloads will be posted on the [Releases](https://github.com/nitishmalpotra/brew-store/releases) page. Until then, build it from source — it's three commands.

### Build from source

1. **Install the toolchain** (one time):

   ```bash
   xcode-select --install            # Xcode Command Line Tools
   brew install node rust            # Node.js + Rust
   ```

2. **Clone, install, run:**

   ```bash
   git clone https://github.com/nitishmalpotra/brew-store.git
   cd brew-store
   npm install
   npm run tauri dev                 # launches the app
   ```

3. **Build a standalone `.app`** (optional):

   ```bash
   npm run tauri build               # output in src-tauri/target/release/bundle/
   ```

## Using it

- Launch the app — it opens on the **Dashboard** with an overview of your setup.
- Go to **Browse**, start typing (or hit **⌘K**), and click a package to see details. Hit **Install** — you'll watch `brew` work in real time.
- **Installed** lists everything you have; use the **Formulae** / **Casks** sub-tabs, filter, tick several, and bulk-uninstall.
- **Updates** shows what's outdated; update individually or **Update all**. **Check for updates** runs `brew update` to pull the latest from upstream.
- Toggle **light / dark** with the button at the bottom-left.

## How it works

Homebrew has no GUI API, so brew·store splits the work:

- **Browsing, search, and trending** hit Homebrew's public JSON API (`formulae.brew.sh`) directly from the UI and cache results locally (daily).
- **Local operations** (`list`, `outdated`, `install`, `uninstall`, `upgrade`, `update`, `--version`, `--prefix`) shell out to your local `brew` binary from a small Rust backend, streaming output back to the UI.

Built with [Tauri 2](https://tauri.app) (Rust) + [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev) + [Tailwind CSS 4](https://tailwindcss.com). Because a sandboxed Mac-App-Store app can't run `brew`, this ships as a direct-download app.

## Security

- The Rust backend only runs an **allowlisted** set of `brew` subcommands; arguments are passed to the process without a shell (no shell-injection vector).
- A **Content-Security-Policy** restricts the webview to the app itself plus the Homebrew/GitHub/Google-Fonts endpoints it actually needs.
- External links are limited to `http(s)` and opened in your default browser. All package data is rendered as text (no HTML injection).

## Contributing

Issues and PRs welcome. For development:

```bash
npm install
npm run tauri dev          # hot-reloading dev build
npm run build              # type-check + build the frontend
```

## License

[MIT](LICENSE) © Nitish Malpotra
