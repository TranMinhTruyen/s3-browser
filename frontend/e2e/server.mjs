// Starts the server-mode build of the app for Playwright (webServer in playwright.config.ts).
// The exe and s3b_db.dll are copied into a fresh folder each run: the portable build keeps its data (profiles,
// settings, key) next to the exe, so every run starts from an empty app and never touches the developer's data.
// Build first with `bun run e2e:build`.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const exe = join(repo, 'build', 'bin', 'S3Browser-server.exe');
const dll = join(repo, 'rust', 'target', 'x86_64-pc-windows-msvc', 'release', 's3b_db.dll');
for (const file of [exe, dll]) {
  if (!existsSync(file)) {
    // oxlint-disable-next-line no-console -- CLI script, the message is for the developer
    console.error(`Missing ${file}. Run \`bun run e2e:build\` first.`);
    process.exit(1);
  }
}

const runDir = join(here, '.run', 'app');
rmSync(runDir, { recursive: true, force: true });
mkdirSync(runDir, { recursive: true });
copyFileSync(exe, join(runDir, 'S3Browser-server.exe'));
copyFileSync(dll, join(runDir, 's3b_db.dll'));

const child = spawn(join(runDir, 'S3Browser-server.exe'), {
  cwd: runDir,
  env: { ...process.env, WAILS_SERVER_PORT: process.env.E2E_PORT ?? '8299' },
  stdio: 'inherit',
});
child.on('exit', code => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
