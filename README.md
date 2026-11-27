<p align="center"><img src="docs/icon.png" width="120" alt="BrewStore" /></p>

# brew·store

**A modern, native macOS app for [Homebrew](https://brew.sh) — search, install, and manage your packages without ever touching the terminal.** Fast, keyboard-friendly, and designed to feel like part of macOS.

[![License: MIT](https://img.shields.io/badge/license-MIT-111.svg)](LICENSE)

> ⚠️ brew·store runs real `brew` commands on your Mac. Installing, updating, and uninstalling actually change your system.

## What is it?

Homebrew is the package manager most Mac developers use — but it's terminal-only. brew·store gives it a proper graphical home: a searchable storefront for all ~16,000 Homebrew formulae and casks, one-click install/uninstall with real progress, an overview of what you've got, cache cleanup, and update management — all in a polished native window.

## Features

- **Overview** — your Homebrew version and whether it's current, counts of installed packages, updates and apps ready to adopt, a storage bar of what `brew cleanup` can free with a one-click **Clear Cache…**, and your library by category.
- **Discover** — the most installed apps and command-line tools this month, ranked by Homebrew's real install analytics, with instant search across all ~16,000 formulae and casks.
- **Real progress** — installs, updates and cleanups show step progress in the row, in the toolbar's activity viewer and on the Dock icon. Jobs queue, so you can keep browsing.
- **Installed** — command-line tools and apps in separate lists, with filtering and multi-select uninstall.
- **Updates** — what's outdated, with **Update All** or one at a time; the Dock badge shows the count.
- **Adopt** — apps already in `/Applications` that Homebrew has a cask for, so updates can happen here.
- **Native look** — macOS 27 design with Liquid Glass controls and system light/dark, plus **⌘K** Quick Open and **⌘F** search.

## Build & run

brew·store isn't on the Mac App Store (a sandboxed app can't run `brew`) and has no pre-built download yet, so you build it locally. It's a handful of copy-paste commands.

**Tested on:** macOS on Apple Silicon. (Intel Macs may work as long as `brew` is on your `PATH`, but that's untested.)

### 1. Install the toolchain (one time)

You need four things — **Homebrew**, **Xcode Command Line Tools**, **Node.js**, and **Rust**:

```bash
# Homebrew — skip if you already have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Xcode Command Line Tools (C compiler + macOS SDK)
xcode-select --install

# Node.js (v20 or newer)
brew install node

# Rust (official installer — accept the defaults)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

Confirm everything is ready:

```bash
node --version    # v20 or newer
cargo --version   # any recent stable
brew --version    # Homebrew is what the app drives
```

### 2. Clone and run

```bash
git clone https://github.com/nitishmalpotra/brew-store.git
cd brew-store
npm install
npm run tauri dev
```

The **first launch compiles the Rust backend**, so give it a minute or two — later launches are instant. A window opens on the Dashboard.

### 3. Build a standalone app (optional)

```bash
npm run tauri build
```

The finished app lands at:

```
src-tauri/target/release/bundle/macos/BrewStore.app
```

Drag it into `/Applications` and open it like any other app. It's an unsigned local build, so if you copy it to a **different** Mac, that Mac will warn on first launch — right-click the app → **Open** to get past Gatekeeper.

### Troubleshooting

- **`cargo: command not found`** — run `source "$HOME/.cargo/env"`, or just open a new terminal.
- **`xcrun: error: invalid active developer path`** — run `xcode-select --install`.
- **Window opens but no packages load** — make sure `brew` works in your own terminal (`brew --version`); the app shells out to your local Homebrew.

## Using it

- **First launch:** if Homebrew isn't installed, BrewStore walks you through installing it (browsing the catalog still works without it).
- Launch the app — it opens on the **Overview** of your setup.
- Search from the sidebar (**⌘F**) or **⌘K**, or browse **Discover**. Click a package for details and **Get** to install it; progress shows in the row and the toolbar.
- **Installed** lists everything you have; switch between **All / Tools / Apps**, filter, **Select** several, and uninstall them together.
- **Updates** shows what's outdated; update one, or **Update All**. **Check for Updates** on the Overview runs `brew update`.
- **Clear Cache…** on the Overview runs `brew cleanup --prune=all` after you confirm.
- Light and dark follow your system appearance.

## How it works

Homebrew has no GUI API, so brew·store splits the work:

- **Browsing, search, and trending** hit Homebrew's public JSON API (`formulae.brew.sh`) directly from the UI and cache results locally (daily).
- **Local operations** (`list`, `outdated`, `install`, `uninstall`, `upgrade`, `update`, `cleanup`, `--version`, `--prefix`) shell out to your local `brew` binary from a small Rust backend, streaming output back to the UI.

Built with [Tauri 2](https://tauri.app) (Rust) + [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev), with plain CSS for the UI. Because a sandboxed Mac-App-Store app can't run `brew`, this ships as a direct-download app.

## Security

- The Rust backend only runs an **allowlisted** set of `brew` subcommands; arguments are passed to the process without a shell (no shell-injection vector).
- A **Content-Security-Policy** restricts the webview to the app itself plus the Homebrew and GitHub endpoints it actually needs.
- External links are limited to `http(s)` and opened in your default browser. All package data is rendered as text (no HTML injection).

## Contributing

Issues and PRs welcome. Follow **Build & run** above to get a dev environment — `npm run tauri dev` hot-reloads, `npm run build` type-checks and builds the frontend, and `npm run check` runs the progress-parser self-check.

## License

[MIT](LICENSE) © Nitish Malpotra
