// Runs automatically after `next build` (npm's postbuild convention) -
// copies Next's own per-build BUILD_ID into public/, so already-open
// browser tabs can detect a new deploy and prompt the user to reload
// instead of silently running stale JS against the newly-deployed API.
const fs = require('fs');
const path = require('path');

const buildIdPath = path.join(__dirname, '..', '.next', 'BUILD_ID');
const outPath = path.join(__dirname, '..', 'public', 'build-version.txt');

const buildId = fs.readFileSync(buildIdPath, 'utf8').trim();
fs.writeFileSync(outPath, buildId);
console.log('Wrote build version:', buildId);
