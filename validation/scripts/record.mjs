/**
 * Launch Playwright codegen and save the recording to a predictable,
 * timestamped file under validation/recordings/ so it can be reviewed and
 * refined into maintainable tests afterward.
 *
 *   npm run record:ssatools   # record against https://ssa.tools
 *   npm run record:app        # record against the local app (starts vite if needed)
 *
 * The recorded spec is written automatically when the recorder window is
 * closed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (target !== 'ssatools' && target !== 'app') {
  console.error('Usage: node validation/scripts/record.mjs <ssatools|app>');
  process.exit(1);
}

const recordingsDir = fileURLToPath(new URL('../recordings/', import.meta.url));
mkdirSync(recordingsDir, { recursive: true });

const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const outFile = `validation/recordings/${target}-${ts}.spec.ts`;

async function isUp(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

let url = 'https://ssa.tools';
let devServer = null;

if (target === 'app') {
  url = 'http://localhost:5173';
  if (!(await isUp(url))) {
    console.log('Starting vite dev server on :5173 …');
    devServer = spawn('npx', ['vite', '--port', '5173', '--strictPort'], {
      stdio: 'ignore',
      detached: false,
    });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      ready = await isUp(url);
    }
    if (!ready) {
      console.error('Dev server did not become ready on :5173');
      devServer.kill();
      process.exit(1);
    }
  }
}

console.log(`Recording ${url} → ${outFile}`);
console.log('Close the recorder window when done; the file saves automatically.\n');

const result = spawnSync(
  'npx',
  ['playwright', 'codegen', url, '--target', 'playwright-test', '--output', outFile],
  { stdio: 'inherit' },
);

if (devServer) devServer.kill();

console.log(`\nRecording saved to ${outFile}`);
process.exit(result.status ?? 0);
