// Run: node src/progress.check.ts — lines below are real Homebrew 7.0.16 output.
import assert from "node:assert/strict";
import { blank, bytes, fraction, planned, removable, step, stepLabel } from "./progress.ts";

const dry = "==> Would install 1 formula:\nimagemagick 7.1.2-36 (11.2MB)\n==> Would install 6 dependencies for imagemagick:\nfreetype  2.15.0";
assert.equal(planned(dry), 7);

let p = blank(planned(dry));
for (const l of ["==> Fetching downloads for: imagemagick", "✔︎ JSON API packages.arm64.jws.json", "✔︎ Bottle Manifest imagemagick (7.1.2-36)", "✔︎ Bottle freetype (2.15.0)"]) p = step(p, l);
assert.equal(p.got, 1, "manifests and API files are not downloads");
assert.equal(stepLabel(p, "Installing"), "Downloading 2 of 7");
p = step(p, "==> Pouring freetype--2.15.0.arm64.bottle.tar.gz");
assert.equal(stepLabel(p, "Installing"), "Installing 2 of 7");
assert.equal(fraction(p), 2 / 14);

let u = step(blank(), "==> Upgrading 4 outdated packages:");
assert.equal(u.total, 4);

const clean = "Would remove: /Users/x/Library/Logs/Homebrew/node (64B)\nWould remove: /opt/homebrew/Cellar/node/25.0.0 (2,412 files, 81.4MB)";
let c = blank(removable(clean), 1);
c = step(c, "Removing: /Users/x/Library/Logs/Homebrew/node... (64B)");
assert.equal(fraction(c), 0.5);
assert.equal(stepLabel(c, "Removing"), "Removing 2 of 2");

assert.equal(bytes("(2,412 files, 81.4MB)"), 81.4e6);
assert.equal(bytes("(64B)"), 64);
assert.equal(fraction(blank()), 0, "no total → indeterminate");
console.log("progress: ok");
