// UI steps of the RAM benchmark (test-env/mem-bench.ps1), driven over CDP on the bench build of S3Browser
// (built with -tags production,devtools and started with S3B_BENCH_CDP_PORT; main_devtools.go adds
// --remote-debugging-port).
//
// One call = one step: connect over CDP, do the step, disconnect (the app keeps running), print ONE JSON line
// on stdout. Exit code 0 = {"ok":true,...}; anything else = {"ok":false,"error":"..."} and exit code 1.
// Usage (in docs/):  node scripts/mem-ui.mjs <step> --port <cdp port> [--opt value ...]
//
// Steps: connect-s3, scroll-s3, upload, download, sqlite, reconnect-sql, open-tab-sql, tabs-s3, tabs-sql,
//        close-all, minimize, arm-restore, read-restore, heap, close-app
//
// Secrets come from the environment only (never argv): S3B_BENCH_ENDPOINT, S3B_BENCH_ACCESS_KEY,
// S3B_BENCH_SECRET_KEY. Selectors use the English labels of frontend/src/locales/en, so the app must run in English
// (the default of a fresh APPDATA). Time is measured inside the page (performance.now / Date.now) after the CDP
// connection exists, so connecting is never part of a number.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'src', 'locales', 'en');
/** Reads a label from the app's own English locale, so selectors never drift from the UI text. */
const label = (namespace, key) =>
  key
    .split('.')
    .reduce((node, part) => node[part], JSON.parse(readFileSync(join(localesDir, `${namespace}.json`), 'utf8')));

const S3_PROFILE = 'mem-bench-s3';
const SQL_PROFILE = 'mem-bench-sqlite';
// Longer than the longest wait inside a step (upload/download wait up to 20 minutes).
const STEP_TIMEOUT = 25 * 60 * 1000;

const [step, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, '')] = rest[i + 1];
const need = name => {
  if (!opts[name]) throw new Error(`missing --${name}`);
  return opts[name];
};
const envNeed = name => {
  if (!process.env[name]) throw new Error(`missing env ${name}`);
  return process.env[name];
};

const L = {
  createS3Profile: label('pages/s3/connectionProfiles', 'tooltip.createProfile'),
  createSqlProfile: label('pages/sql/sqlNavbar', 'tooltip.createProfile'),
  tabConnect: label('pages/s3/tabLayout', 'tooltip.connect'),
  sqlConnect: label('pages/sql/sqlTab', 'tooltip.connect'),
  run: label('pages/sql/sqlTab', 'tooltip.execute'),
  addTab: label('common', 'tab.add'),
  closeTab: label('common', 'tab.close'),
  minimise: label('common', 'window.minimise'),
  close: label('common', 'window.close'),
  disconnect: label('pages/s3/connectionProfiles', 'contextMenu.disconnect'),
  sqlDisconnect: label('pages/sql/sqlNavbar', 'contextMenu.disconnect'),
  downloadSelected: label('pages/s3/object/page', 'tooltip.downloadSelected'),
  create: label('pages/s3/modals/connectModal', 'form.button.createProfile'),
  sqlCreate: label('pages/sql/modals/dbProfileModal', 'form.button.create'),
  mode: label('common', 'appMode.label'),
};

let browser;
/** The app page, set in the final try block. */
let page;
/**
 * Hides the S3B_BENCH_* secrets (Playwright call logs echo filled text, e.g. fill("<secret>")). The endpoint is kept for
 * diagnosis; values shorter than 4 characters are skipped so they cannot replace unrelated text.
 */
const redact = text =>
  Object.entries(process.env)
    .filter(
      ([name, value]) =>
        name.startsWith('S3B_BENCH_') && /SECRET|ACCESS_KEY|PASSWORD|TOKEN/.test(name) && (value ?? '').length >= 4
    )
    .reduce((out, [, value]) => out.split(value).join('***'), text);
const exit = async (code, payload) => {
  console.log(JSON.stringify(payload));
  // close() on a connectOverCDP browser only drops our connection; the app is left running.
  await browser?.close().catch(() => {});
  process.exit(code);
};
const timer = setTimeout(() => exit(1, { ok: false, error: redact(`step ${step} timed out`) }), STEP_TIMEOUT);

const pause = ms => page.waitForTimeout(ms);

/** Connect button of the visible SQL tab; the navbar has a second "Connect" button, the tab's one comes last. */
const sqlTabConnect = () => page.getByRole('button', { name: L.sqlConnect, exact: true }).last();

/** Tabs of the workspace tab strip only (not the Result/Messages tabs of a SQL panel, not hidden workspaces). */
const stripTabs = () =>
  page
    .getByRole('tablist')
    .filter({ has: page.getByRole('button', { name: L.addTab, exact: true }) })
    .locator('[role="tab"]:not([data-exiting])');

/** Waits until the visible strip has more (dir > 0) or fewer (dir < 0) than n tabs. */
const waitStripCount = (n, dir) =>
  page.waitForFunction(
    ({ add, n, dir }) => {
      const list = [...document.querySelectorAll('[role="tablist"]')].find(
        l => l.offsetParent !== null && l.querySelector(`[aria-label="${add}"]`)
      );
      const count = list ? list.querySelectorAll('[role="tab"]:not([data-exiting])').length : 0;
      return dir > 0 ? count > n : count < n;
    },
    { add: L.addTab, n, dir }
  );
/** Visible elements with this exact text. Hidden tabs stay in the DOM (display none), so a bare getByText hits them too. */
const textOf = value => page.getByText(value, { exact: true }).filter({ visible: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Visible scroll container of the object list (the Paper with data-file-drop-target), page-side helper source. */
const SCROLLER = '[data-tab-id][data-file-drop-target]';

const clickMode = async mode => {
  await page.getByLabel(L.mode, { exact: true }).getByText(mode, { exact: true }).click();
  await pause(500);
};

/** Opens a profile menu entry by right-clicking the profile name in the navbar. */
const profileMenu = async (name, item) => {
  await textOf(name).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: item, exact: true }).click();
};

/** Picks a profile in the visible tab's profile select. */
const pickProfile = async name => {
  await page.locator('[aria-haspopup="listbox"]:visible').first().click();
  await page.getByRole('option', { name, exact: true }).click();
};

/** Scrolls the object list to the bottom until the last key is rendered, so every page is loaded. */
async function loadAllObjects(lastKey) {
  await page.evaluate(
    async ({ scroller, lastKey }) => {
      const el = [...document.querySelectorAll(scroller)].find(e => e.offsetParent !== null);
      const end = Date.now() + 5 * 60 * 1000;
      while (Date.now() < end) {
        el.scrollTop = el.scrollHeight;
        await new Promise(resolve => setTimeout(resolve, 250));
        if ([...el.querySelectorAll('*')].some(n => n.children.length === 0 && n.textContent === lastKey)) return;
      }
      throw new Error(`last object ${lastKey} was not loaded`);
    },
    { scroller: SCROLLER, lastKey }
  );
}

/** Back to the bucket root when the visible tab is inside a folder (breadcrumb link with data-prefix=""). */
async function goBucketRoot() {
  const root = page.locator('a[data-prefix=""]:visible').first();
  if (await root.count()) {
    await root.click();
    await page.locator('a[data-prefix=""]:visible').first().waitFor({ state: 'detached' });
  }
}

/** Creates the MinIO profile when missing, connects the visible tab to it and opens the bucket. */
async function openBucketInTab(bucket) {
  await pickProfile(S3_PROFILE);
  const connect = page.getByRole('button', { name: L.tabConnect, exact: true }).last();
  if (await connect.isEnabled()) await connect.click();
  await textOf(bucket).first().click();
}

async function connectS3() {
  const bucket = need('bucket');
  // Read every secret before the modal opens: a missing one must not leave the modal open.
  const endpoint = envNeed('S3B_BENCH_ENDPOINT');
  const accessKey = envNeed('S3B_BENCH_ACCESS_KEY');
  const secretKey = envNeed('S3B_BENCH_SECRET_KEY');
  await clickMode('S3');
  if (!(await textOf(S3_PROFILE).count())) {
    const form = key => label('pages/s3/modals/connectModal', `form.label.${key}`);
    await page.getByRole('button', { name: L.createS3Profile, exact: true }).click();
    await textOf('MinIO').first().click();
    await page.getByRole('textbox', { name: form('name'), exact: true }).fill(S3_PROFILE);
    await page.getByRole('textbox', { name: form('endpoint') }).fill(endpoint);
    const region = page.locator('button', {
      hasText: label('pages/s3/components/inputs', 'regionCombobox.placeholder'),
    });
    if (await region.count()) {
      await region.click();
      await page.getByRole('option', { name: /us-east-1/ }).click();
    }
    await page.getByRole('textbox', { name: form('accessKey') }).fill(accessKey);
    await page.getByLabel(form('secretKey'), { exact: true }).fill(secretKey);
    await page.getByLabel(form('savePassword')).check();
    await page.getByRole('button', { name: L.create, exact: true }).click();
    await textOf(S3_PROFILE).first().waitFor();
  }
  await openBucketInTab(bucket);
  await page.waitForFunction(
    selector => [...document.querySelectorAll(selector)].some(e => e.offsetParent !== null),
    SCROLLER
  );
  await loadAllObjects(need('last'));
  return { bucket };
}

/** Time to render rows far from the top: scroll to the top, then to the middle, until a new row is on screen. */
async function scrollS3() {
  const scrollMs = await page.evaluate(async scroller => {
    const el = [...document.querySelectorAll(scroller)].find(e => e.offsetParent !== null);
    const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
    const visibleRows = () => {
      const box = el.getBoundingClientRect();
      return [...el.querySelectorAll('[style*="translateY"]')]
        .filter(r => {
          const b = r.getBoundingClientRect();
          return b.bottom > box.top && b.top < box.bottom;
        })
        .map(r => r.textContent);
    };
    el.scrollTop = 0;
    await raf();
    await raf();
    const top = new Set(visibleRows());
    const t0 = performance.now();
    el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
    const end = t0 + 15000;
    while (performance.now() < end) {
      await raf();
      const rows = visibleRows();
      if (rows.length > 0 && rows.every(text => !top.has(text))) break;
    }
    await raf();
    await raf();
    return performance.now() - t0;
  }, SCROLLER);
  return { scrollMs: Math.round(scrollMs) };
}

/** Records the Wails events of the page, so a transfer can be waited for by its finish events. */
const watchEvents = () =>
  page.evaluate(() => {
    if (window.__s3bEvents) return;
    window.__s3bEvents = {};
    const original = window._wails.dispatchWailsEvent;
    window._wails.dispatchWailsEvent = event => {
      window.__s3bEvents[event.name] = (window.__s3bEvents[event.name] ?? 0) + 1;
      // upload-finished is also emitted for failed and canceled uploads: count the successful ones apart.
      if (event.name === 'uploader:upload-finished' && event.data?.status === 'success')
        window.__s3bEvents['upload-success'] = (window.__s3bEvents['upload-success'] ?? 0) + 1;
      return original(event);
    };
  });
const eventCount = name => page.evaluate(n => window.__s3bEvents?.[n] ?? 0, name);

async function upload() {
  const dir = need('dir');
  // Files directly in dir form group "", each sub folder one group (the app limits a folder to 50 files).
  const toFile = (folder, name) => {
    const path = join(dir, folder, name);
    return { path, relKey: folder ? `${folder}/${name}` : name, size: statSync(path).size, isLarge: false };
  };
  const groups = [];
  for (const folder of [
    '',
    ...readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name),
  ]) {
    const names = readdirSync(join(dir, folder), { withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => e.name);
    if (names.length === 0) continue;
    if (names.length > 50) throw new Error(`folder ${folder} has more than 50 files (upload limit per folder)`);
    const files = names.map(name => toFile(folder, name));
    groups.push({
      name: folder,
      files,
      totalFiles: files.length,
      largeCount: 0,
      overMaxFiles: false,
      overLargeCount: false,
    });
  }
  const total = groups.reduce((sum, g) => sum + g.totalFiles, 0);
  if (total === 0 || total > 1000) throw new Error(`upload needs 1..1000 files, found ${total}`);

  await watchEvents();
  const before = await eventCount('uploader:upload-finished');
  const beforeSuccess = await eventCount('upload-success');
  const tabId = await page.evaluate(
    scroller =>
      [...document.querySelectorAll(scroller)].find(e => e.offsetParent !== null)?.getAttribute('data-tab-id'),
    SCROLLER
  );
  if (!tabId) throw new Error('no open object list to upload into');
  const t0 = Date.now();
  await page.evaluate(data => window._wails.dispatchWailsEvent({ name: 'uploader:files-dropped', data }), {
    tabId,
    groups,
    skipped: 0,
    totalFiles: total,
    overMaxTotal: false,
    capped: false,
    maxFilesPerFolder: 50,
    largeFileSize: 10 * 1024 ** 3,
    largeFileMaxCount: 4,
    maxTotalFiles: 1000,
  });
  await page.waitForFunction(
    ({ before, total }) => (window.__s3bEvents['uploader:upload-finished'] ?? 0) - before >= total,
    { before, total },
    { timeout: 20 * 60 * 1000, polling: 500 }
  );
  const ms = Date.now() - t0;
  const ok = (await eventCount('upload-success')) - beforeSuccess;
  if (ok !== total) throw new Error(`only ${ok} of ${total} files uploaded`);
  return { files: ok, ms };
}

/** Selects N files of a folder and downloads them; the native folder dialog is filled by the caller. */
async function download() {
  const out = need('out');
  const count = Number(opts.count ?? 5);
  const folder = need('folder');
  await goBucketRoot();
  await page.evaluate(
    scroller => ([...document.querySelectorAll(scroller)].find(e => e.offsetParent !== null).scrollTop = 0),
    SCROLLER
  );
  await textOf(folder).first().click();
  // Only the checkboxes of the visible object list: hidden tabs keep theirs in the DOM.
  const list = page.locator(`${SCROLLER}:visible`);
  await list.getByRole('checkbox').first().waitFor();
  // The list is virtual: tick every unchecked box on screen, scroll, repeat until `count` files are selected.
  let selected = 0;
  for (let guard = 0; selected < count && guard < 200; guard++) {
    const boxes = list.locator('input[type="checkbox"]:not(:checked)');
    for (let n = await boxes.count(); n > 0 && selected < count; n--) {
      await boxes.first().check();
      selected++;
    }
    if (selected >= count) break;
    await page.evaluate(scroller => {
      const el = [...document.querySelectorAll(scroller)].find(e => e.offsetParent !== null);
      el.scrollTop += el.clientHeight * 0.8;
    }, SCROLLER);
    await pause(200);
  }
  if (selected < count) throw new Error(`only ${selected} of ${count} files could be selected`);
  const t0 = Date.now();
  await page.getByRole('button', { name: L.downloadSelected, exact: true }).click();
  // The native folder dialog is outside the page: an HTML modal here means the app refused (for example too many items).
  await sleep(1500);
  const modal = page.getByRole('dialog').first();
  if (await modal.isVisible().catch(() => false)) {
    const text = ((await modal.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    throw new Error(`download refused by the app: ${text}`);
  }
  // The files appear in out; done when count files exist and none grew for 3 seconds.
  let last = '';
  let stableSince = Date.now();
  while (Date.now() - t0 < 20 * 60 * 1000) {
    await sleep(500);
    let names = [];
    try {
      names = readdirSync(out);
    } catch {
      // the folder dialog has not been answered yet
    }
    // The downloader writes <file>.part and renames it when done: count only finished files.
    const done = names.filter(n => !n.endsWith('.part'));
    const sig = `${names.join('|')}#${done.length}`;
    if (sig !== last) {
      last = sig;
      stableSince = Date.now();
    }
    if (done.length >= count && names.length === done.length && Date.now() - stableSince > 3000) {
      await goBucketRoot();
      return { files: done.length, ms: Date.now() - t0 - 3000 };
    }
  }
  throw new Error('download did not finish');
}

async function sqlite() {
  const file = need('file');
  await clickMode('SQL');
  if (!(await textOf(SQL_PROFILE).count())) {
    const form = key => label('pages/sql/modals/dbProfileModal', `form.label.${key}`);
    await page.getByRole('button', { name: L.createSqlProfile, exact: true }).click();
    await textOf(label('pages/sql/modals/dbProfileModal', 'form.dbType.sqlite')).first().click();
    await page.getByRole('textbox', { name: form('name'), exact: true }).fill(SQL_PROFILE);
    await page.getByRole('textbox', { name: form('filePath') }).fill(file);
    await page.getByRole('button', { name: L.sqlCreate, exact: true }).click();
    await textOf(SQL_PROFILE).first().waitFor();
  }
  await pickProfile(SQL_PROFILE);
  const t0 = Date.now();
  await sqlTabConnect().click();
  await textOf(label('pages/sql/sqlNavbar', 'tree.tables')).first().waitFor();
  const connectFirstMs = Date.now() - t0;

  const rows = Number(opts.rows ?? 10000);
  await runSql(
    `CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY, name TEXT, v REAL, s TEXT);
WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<${rows})
INSERT INTO t(id,name,v,s) SELECT x, 'name-'||x, x*1.5, hex(randomblob(40)) FROM c WHERE (SELECT COUNT(*) FROM t)=0;`,
    /row\(s\) affected/
  );
  await runSql('SELECT * FROM t;', null);
  return { connectFirstMs };
}

/** Types SQL into the visible editor, runs it and waits for the result (a Result tab, or `message` text). */
async function runSql(sql, message) {
  const editor = page.locator('.cm-content:visible').first();
  await editor.click();
  await editor.fill(sql);
  await page.getByRole('button', { name: L.run, exact: true }).click();
  if (message) await page.getByText(message).filter({ visible: true }).first().waitFor({ timeout: 120000 });
  else
    await page
      .getByRole('tab', { name: label('pages/sql/sqlTab', 'result.title').replace('{{n}}', '1') })
      .first()
      .waitFor({ timeout: 120000 });
  // Rows are drawn by a virtual grid (components/display/dataGrid/DataGrid.tsx: data rows are div[data-row]; the header
  // uses data-hcol): wait until the visible tab has painted one. Hidden tabs keep theirs, hence :visible.
  if (!message) await page.locator('[data-row]:visible').first().waitFor({ timeout: 60000 });
}

async function reconnectSql() {
  await profileMenu(SQL_PROFILE, L.sqlDisconnect);
  await pause(1000);
  const t0 = Date.now();
  await textOf(SQL_PROFILE).first().dblclick();
  await textOf(label('pages/sql/sqlNavbar', 'tree.tables')).first().waitFor();
  return { connectSecondMs: Date.now() - t0 };
}

/** Opens a new SQL tab, waits for its editor, then closes it again so the measured state is unchanged. */
async function openTabSql() {
  const tabs = stripTabs();
  const before = await tabs.count();
  const t0 = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: L.addTab, exact: true }).click();
  await waitStripCount(before, 1);
  await page.locator('.cm-content:visible').first().waitFor();
  const ms = await page.evaluate(t => performance.now() - t, t0);
  await tabs.last().getByRole('button', { name: L.closeTab, exact: true }).click();
  return { openTabMs: Math.round(ms) };
}

/** Runs `onTab` on the current tab, then adds tabs (running `onTab` on each) until there are `count`. */
async function fillTabs(count, onTab) {
  const tabs = stripTabs();
  await onTab();
  while ((await tabs.count()) < count) {
    const before = await tabs.count();
    await page.getByRole('button', { name: L.addTab, exact: true }).click();
    await waitStripCount(before, 1);
    await onTab();
  }
}

async function tabsS3() {
  await clickMode('S3');
  await fillTabs(5, async () => {
    // The first tab may be left inside a folder (download step): the last key lives at the bucket root.
    await goBucketRoot();
    // The first tab may already show the bucket (after step connect-s3).
    if (
      !(await page.evaluate(
        selector => [...document.querySelectorAll(selector)].some(e => e.offsetParent !== null),
        SCROLLER
      ))
    )
      await openBucketInTab(need('bucket'));
    await page.waitForFunction(
      selector => [...document.querySelectorAll(selector)].some(e => e.offsetParent !== null),
      SCROLLER
    );
    await loadAllObjects(need('last'));
  });
  return { tabs: await stripTabs().count() };
}

async function tabsSql() {
  await clickMode('SQL');
  await fillTabs(5, async () => {
    const select = page.locator('[aria-haspopup="listbox"]:visible').first();
    if (!(await select.innerText()).includes(SQL_PROFILE)) await pickProfile(SQL_PROFILE);
    const connect = sqlTabConnect();
    if (await connect.isEnabled()) await connect.click();
    await runSql('SELECT * FROM t;', null);
  });
  return { tabs: await stripTabs().count() };
}

/** Closes every tab but the last one, then disconnects the profile of the mode. */
async function closeAll() {
  const mode = need('mode');
  await clickMode(mode === 's3' ? 'S3' : 'SQL');
  const tabs = stripTabs();
  while ((await tabs.count()) > 1) {
    const before = await tabs.count();
    await tabs.last().getByRole('button', { name: L.closeTab, exact: true }).click();
    await waitStripCount(before, -1);
  }
  if (mode === 's3') await profileMenu(S3_PROFILE, L.disconnect);
  else await profileMenu(SQL_PROFILE, L.sqlDisconnect);
  await pause(1000);
  return { tabs: await tabs.count() };
}

async function minimize() {
  await page.getByRole('button', { name: L.minimise, exact: true }).click();
  await pause(1500);
  return { visibility: await page.evaluate(() => document.visibilityState) };
}

/** Leaves a listener in the page: when it becomes visible again, the time of its second painted frame is kept. */
async function armRestore() {
  const visibility = await page.evaluate(() => {
    window.__s3bRestore = null;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      requestAnimationFrame(() => requestAnimationFrame(() => (window.__s3bRestore = Date.now())));
    });
    return document.visibilityState;
  });
  return { visibility };
}

const readRestore = async () => ({ restoreAt: await page.evaluate(() => window.__s3bRestore ?? null) });

async function heap() {
  const cdp = await page.context().newCDPSession(page);
  const usage = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  return { jsHeapUsed: usage.usedSize, jsHeapTotal: usage.totalSize };
}

async function closeApp() {
  await page
    .getByRole('button', { name: L.close, exact: true })
    .click()
    .catch(() => {});
  return {};
}

const steps = {
  'connect-s3': connectS3,
  'scroll-s3': scrollS3,
  upload,
  download,
  sqlite,
  'reconnect-sql': reconnectSql,
  'open-tab-sql': openTabSql,
  'tabs-s3': tabsS3,
  'tabs-sql': tabsSql,
  'close-all': closeAll,
  minimize,
  'arm-restore': armRestore,
  'read-restore': readRestore,
  heap,
  'close-app': closeApp,
};

try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${need('port')}`);
  // The first real page (not devtools:// or about:blank) of the default context.
  page = browser
    .contexts()
    .flatMap(context => context.pages())
    .find(p => /^https?:/.test(p.url()));
  if (!page) throw new Error('app page not found over CDP');
  page.setDefaultTimeout(30000);
  if (!steps[step]) throw new Error(`unknown step "${step}"`);
  // A modal left open by an earlier failed step would block every click of this one.
  const openDialog = page.locator('[role=dialog]:visible').first();
  for (let i = 0; i < 3 && (await openDialog.count()); i++) {
    await page.keyboard.press('Escape');
    await openDialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  }
  const result = await steps[step]();
  clearTimeout(timer);
  await exit(0, { ok: true, step, ...result });
} catch (error) {
  const message = redact(String(error?.message ?? error));
  console.error(message); // full text kept in mem-ui-<step>-<run>.err / .out.err
  await exit(1, { ok: false, step, error: message.split('\n')[0] });
}
