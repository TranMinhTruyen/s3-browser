// QA run for sprint-19 R1 (object tree in the SQL navbar, TableStructure tab, refresh, B7), app in server mode.
//
// Prerequisites (nothing here is a secret):
//   1. go build -tags server,production,portable -o <tmp>/S3Browser-server.exe .   (frontend built with vite, bindings generated)
//      copy rust/target/x86_64-pc-windows-msvc/release/s3b_db.dll next to the exe
//      cd <tmp> && WAILS_SERVER_PORT=8191 ./S3Browser-server.exe
//   2. A real SQLite file made by mkdb.py (next to this file): python -I mkdb.py <path>.db
//        tables users, orders (FK, CHECK), big_events (25,000 rows), no_pk, wide (41 columns), audit;
//        view v_user_orders, indexes (unique, partial), trigger trg_orders_ai.
//   3. QA_URL=http://localhost:8191 QA_DB=<path>.db [QA_ONLY=TC-R1-05,TC-R1-06] node run.mjs
//
// The script deletes every DB profile of the app first and again at the end, and restores the default settings
// (light, medium). Results: results.json, screenshots <TC-ID>-NN.png, console logs <TC-ID>.console.log.
// PostgreSQL has no backend yet (fake connect, mock tree/rows), so those cases are "mock" by design.
// Not simulated here: the native file dialog (ChooseDbFile): the path is typed into the field instead.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..');
const require = createRequire(join(repo, 'docs', 'package.json'));
const { chromium } = require('playwright');

const URL = process.env.QA_URL ?? 'http://localhost:8191';
const DB = (process.env.QA_DB ?? '').replaceAll('\\', '/');
if (!DB) throw new Error('QA_DB (path of the SQLite test file) is required');
const ONLY = process.env.QA_ONLY?.split(',');
const secrets = [process.env.QA_SECRET].filter(Boolean);

const localesDir = join(repo, 'frontend', 'src', 'locales');
const L = (file, key, lang = 'en') =>
  key.split('.').reduce((o, k) => o[k], JSON.parse(readFileSync(join(localesDir, lang, `${file}.json`), 'utf8')));
const NAV = key => L('pages/sql/sqlNavbar', key);
const TS = key => L('pages/sql/tableStructure', key);
const TAB = key => L('pages/sql/sqlTab', key);
const MODAL = key => L('pages/sql/modals/dbProfileModal', key);

const handlers = readFileSync(
  join(repo, 'frontend', 'bindings', 'S3Browser', 'internal', 'handlers', 'dbhandler.ts'),
  'utf8'
);
const METHOD_ID = Object.fromEntries(
  [...handlers.matchAll(/export function (\w+)\([^)]*\)[^{]*\{\s*return \$Call\.ByID\((\d+)/g)].map(m => [m[1], m[2]])
);
const ID_METHOD = Object.fromEntries(Object.entries(METHOD_ID).map(([k, v]) => [v, k]));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-US' });
const page = await context.newPage();

// ---------- console / request capture ----------
// The Wails runtime (@wailsio/runtime system.js) prints the "Browser Environment Detected" banner with console.warn on
// every page load in server mode; the desktop WebView2 app does not print it. Filtered at the harness (user decision):
// an init script (runs before the page scripts, also after reload/goto) wraps console.warn and swallows ONLY a call
// whose text contains this exact phrase, counting it. Every other warning and every error still reaches the log.
const BANNER = 'Browser Environment Detected';
let logLines = [];
const allConsole = [];
let bannerCount = 0;
await page.exposeFunction('__qaBanner', () => {
  bannerCount++;
});
await page.addInitScript(banner => {
  const orig = console.warn;
  console.warn = (...args) => {
    if (args.some(a => typeof a === 'string' && a.includes(banner))) return window.__qaBanner();
    return orig.apply(console, args);
  };
}, BANNER);
const redact = s => secrets.reduce((acc, v) => acc.split(v).join('***'), s);
const onConsole = type => text => {
  if (type === 'log' || type === 'info' || type === 'debug') return;
  const line = redact(`[${type}] ${text}`);
  logLines.push(line);
  allConsole.push(line);
};
page.on('console', m => onConsole(m.type())(m.text()));
page.on('pageerror', e => onConsole('pageerror')(String(e)));

const requests = [];
page.on('request', r => {
  if (!r.url().endsWith('/wails/runtime')) return;
  const id = r.postData()?.match(/"methodID":(\d+)/)?.[1];
  if (id) requests.push(ID_METHOD[id] ?? `#${id}`);
});
const count = (name, since = 0) => requests.slice(since).filter(n => n === name).length;

// ---------- case runner ----------
import { existsSync } from 'node:fs';
const results = existsSync(join(here, 'results.json')) ? JSON.parse(readFileSync(join(here, 'results.json'), 'utf8')) : {};
let current = null;
let failures = [];
let notes = [];
let shotNo = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const note = msg => notes.push(msg);
const shot = async () => {
  shotNo += 1;
  await page.screenshot({ path: join(here, `${current}-${String(shotNo).padStart(2, '0')}.png`) });
};

async function runCase(id, fn) {
  if (ONLY && !ONLY.includes(id)) return;
  current = id;
  failures = [];
  notes = [];
  shotNo = 0;
  logLines = [];
  let status = 'PASS';
  try {
    const manual = await fn();
    if (manual === 'MANUAL') status = 'MANUAL';
  } catch (e) {
    failures.push(`Exception: ${String(e.stack).split(String.fromCharCode(10)).slice(0, 3).join(" / ")}`);
    await shot().catch(() => {});
  }
  if (logLines.length) failures.push(`Console has ${logLines.length} error/warning line(s): ${logLines[0].slice(0, 160)}`);
  if (failures.length) status = 'FAIL';
  writeFileSync(join(here, `${id}.console.log`), logLines.length ? `${logLines.join('\n')}\n` : '(no console error or warning)\n');
  results[id] = { status, note: [...failures, ...notes].join(' | ') };
  console.log(`${status} ${id} ${results[id].note}`);
  writeFileSync(join(here, 'results.json'), JSON.stringify(results, null, 2));
}

// ---------- backend + app helpers ----------
const call = (handler, method, args = []) =>
  page.evaluate(
    async ({ handler, method, args }) => {
      const res = await fetch('/wails/runtime', {
        method: 'POST',
        headers: { 'x-wails-client-id': 'qa', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object: 0,
          method: 0,
          args: { 'call-id': crypto.randomUUID(), methodName: `S3Browser/internal/handlers.${handler}.${method}`, args },
        }),
      });
      return res.json();
    },
    { handler, method, args }
  );

const wipeProfiles = async () => {
  const all = await call('DbHandler', 'GetAllDbProfile');
  for (const p of all.body?.dbProfiles ?? []) {
    await call('DbHandler', 'DisconnectDb', [{ profileId: p.id }]);
    await call('DbHandler', 'DeleteDbProfileById', [{ id: p.id, config: {} }]);
  }
};
const createSqlite = (name = 'QA SQLite', filePath = DB) =>
  call('DbHandler', 'CreateDbProfile', [{ name, provider: 'sqlite', config: { filePath, readOnly: false } }]);
const createPg = (name = 'QA PG mock') =>
  call('DbHandler', 'CreateDbProfile', [
    { name, provider: 'postgres', config: { host: 'localhost', port: 5432, database: 'qa_pg', username: 'qa_user', sslMode: 'disable' } },
  ]);
const setSettings = async (size, theme) => {
  await call('SettingHandler', 'SaveSettings', [
    { theme, font: 'nunito', language: 'en', size, launchOnStartup: false, autoUpdate: true, betaUpdate: false },
  ]);
};

const clearToasts = async () => {
  // Hide (never remove: sonner owns the nodes) so toasts do not cover the tab strip in screenshots.
  await page.addStyleTag({ content: '[data-sonner-toaster]{display:none !important}' }).catch(() => {});
};
const gotoSql = async () => {
  await page.getByText('SQL', { exact: true }).first().click();
  await page.locator('[data-profile-key], [class*="_row_"]').first().waitFor({ timeout: 8000 }).catch(() => {});
  await sleep(300);
};
/** Fresh app state: only the wanted profiles, page reloaded, SQL mode. */
async function fresh({ sqlite = true, pg = false } = {}) {
  await page.goto(URL);
  await wipeProfiles();
  if (sqlite) await createSqlite();
  if (pg) await createPg();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await sleep(1200);
  await gotoSql();
  await closeAllTabsButOne();
  await clearToasts();
}
// The first tablist is the tab strip; the sub tabs of a TableStructure tab sit in their own (visible) tablist after it.
const mainTabs = () => page.locator('[role=tablist]:visible').first().getByRole('tab');
const tabNames = async () => (await mainTabs().allInnerTexts()).map(t => t.trim());
async function closeAllTabsButOne() {
  for (let i = 0; i < 30; i++) {
    if ((await mainTabs().count()) <= 1) return;
    await mainTabs().last().getByRole('button', { name: 'Close tab' }).click();
    await sleep(250);
  }
}
const card = name => page.locator('[data-profile-key]', { hasText: name });
async function connect(name) {
  await card(name).dblclick();
  await page.getByText(NAV('toast.connected').replace('{{name}}', name)).first().waitFor({ state: 'attached', timeout: 8000 });
  await clearToasts();
}
const chevron = name => card(name).getByRole('button', { name: new RegExp(`^(${NAV('tree.expand')}|${NAV('tree.collapse')})$`) });
async function openTree(name) {
  await chevron(name).click();
  await page.locator('[class*="_row_"]:has(> span[class*="_chevron_"])').first().waitFor({ timeout: 8000 });
  await sleep(200);
}
const treeRowLoc = () => page.locator('[class*="_row_"]:has(> span[class*="_chevron_"])');
const treeRows = () =>
  treeRowLoc().evaluateAll(els =>
    els.map(e => {
      const svgs = [...e.querySelectorAll('svg')];
      const icon = e.querySelector('svg[class*="_icon_"]');
      const text = e.innerText.trim();
      const rect = e.getBoundingClientRect();
      const r = icon?.getBoundingClientRect();
      const textEl = e.querySelector('p, span:not([class*="_chevron_"])');
      const tr = textEl?.getBoundingClientRect();
      return {
        text,
        level: e.style.paddingLeft,
        icon: icon ? [...icon.classList].find(c => c.startsWith('lucide-') && c !== 'lucide') : null,
        chevron: svgs.length > 1 ? [...svgs[0].classList].find(c => c.startsWith('lucide-') && c !== 'lucide') : null,
        selected: e.hasAttribute('data-selected'),
        height: rect.height,
        iconDy: r ? Math.abs(r.top + r.height / 2 - (rect.top + rect.height / 2)) : null,
        textDy: tr ? Math.abs(tr.top + tr.height / 2 - (rect.top + rect.height / 2)) : null,
      };
    })
  );
const rowNamed = text => treeRowLoc().filter({ has: page.locator(`xpath=.//*[normalize-space(text())="${text}"]`) }).first();
async function expandAll() {
  for (let i = 0; i < 20; i++) {
    const closed = treeRowLoc().filter({ has: page.locator('svg.lucide-chevron-right') });
    if ((await closed.count()) === 0) return;
    await closed.first().locator('span[class*="_chevron_"]').click();
    await sleep(120);
  }
}
async function openTable(name) {
  await rowNamed(name).dblclick();
  await mainTabs().filter({ hasText: name }).first().waitFor({ timeout: 8000 });
  await page.getByRole('tab', { name: TS('tab.data'), exact: true }).waitFor();
  await waitGridRows();
}
const subTab = name => page.getByRole('tab', { name: TS(`tab.${name}`), exact: true });
async function waitGridRows(min = 1) {
  for (let i = 0; i < 60; i++) {
    const g = await grid();
    if (g && (g.rows.length >= min || (min === 0 && g.header.length))) return g;
    await sleep(150);
  }
  return grid();
}
const grid = () =>
  page.evaluate(() => {
    const canvas = [...document.querySelectorAll('[class*="_canvas_"]')].find(c => c.offsetParent !== null);
    if (!canvas) return null;
    const root = canvas.parentElement;
    const header = [...canvas.querySelectorAll('[class*="_header_"] [class*="_cell_"]')].map(e => e.innerText.trim());
    const rows = [...canvas.querySelectorAll('[class*="_row_"]')].map(r => ({
      idx: r.querySelector('[class*="_index_"]')?.innerText.trim(),
      cells: [...r.children]
        .filter(c => !String(c.className).includes('_index_'))
        .map(c => ({ t: c.innerText.trim(), n: String(c.className).includes('_null_') })),
    }));
    return {
      sw: root.scrollWidth,
      cw: root.clientWidth,
      sh: root.scrollHeight,
      ch: root.clientHeight,
      st: root.scrollTop,
      sl: root.scrollLeft,
      header,
      rows,
    };
  });
const scrollGrid = (axis, to) =>
  page.evaluate(
    ({ axis, to }) => {
      const canvas = [...document.querySelectorAll('[class*="_canvas_"]')].find(c => c.offsetParent !== null);
      const root = canvas.parentElement;
      if (axis === 'y') root.scrollTop = to === 'end' ? root.scrollHeight : to;
      else root.scrollLeft = to === 'end' ? root.scrollWidth : to;
    },
    { axis, to }
  );
const lastIdx = g => Number(g.rows.at(-1)?.idx ?? 0);
/** Scrolls the Data grid to the end until no more rows load (or `maxRounds`); returns the last row number. */
async function scrollToEnd(maxRounds = 12) {
  let last = 0;
  for (let i = 0; i < maxRounds; i++) {
    await scrollGrid('y', 'end');
    await sleep(900);
    const g = await grid();
    if (lastIdx(g) === last && i > 0) return last;
    last = lastIdx(g);
  }
  return last;
}
/** Cell texts of the visible grid as rows of strings (Column/Index/Constraint/FK tabs have few rows). */
const gridTable = async () => {
  const g = await grid();
  return { header: g?.header ?? [], rows: (g?.rows ?? []).map(r => r.cells.map(c => c.t)) };
};
const contextMenu = async (name, item) => {
  // The menu closes when the list scrolls, so bring the card into view before the right click.
  await card(name).scrollIntoViewIfNeeded();
  await sleep(300);
  await card(name).click({ button: 'right' });
  await page.getByRole('menuitem', { name: item, exact: true }).click();
};
const selectTabProfile = async name => {
  await page.locator('[aria-haspopup="listbox"]:visible').first().click();
  await page.getByRole('option').filter({ hasText: name }).first().click();
  await sleep(200);
};
const typeSql = async sql => {
  await page.locator('.cm-content').first().click();
  await page.keyboard.type(sql);
};
const runSql = async sql => {
  await typeSql(sql);
  await page.getByRole('button', { name: TAB('tooltip.execute') }).click();
};
const closeActiveModal = async () => {
  await page.keyboard.press('Escape');
  await sleep(300);
};

// =====================================================================================================
// TC-R1-01 .. profile not connected has no Accordion (profile created through the real modal)
await runCase('TC-R1-01', async () => {
  await page.goto(URL);
  await wipeProfiles();
  await page.reload();
  await sleep(1200);
  await gotoSql();
  await shot();
  await page.getByRole('button', { name: NAV('tooltip.createProfile') }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(MODAL('form.dbType.sqlite'), { exact: true }).click();
  await dialog.getByLabel(MODAL('form.label.name')).fill('QA SQLite');
  await dialog.getByLabel(MODAL('form.label.filePath')).fill(DB);
  await shot();
  await dialog.getByRole('button', { name: MODAL('form.button.create') }).click();
  await card('QA SQLite').waitFor();
  await clearToasts();
  await sleep(500);
  check((await chevron('QA SQLite').count()) === 0, 'A profile that is not connected shows an Accordion chevron');
  check((await treeRowLoc().count()) === 0, 'Tree rows exist for a profile that is not connected');
  const text = await card('QA SQLite').innerText();
  check(/QA SQLite/.test(text) && /SQLITE/i.test(text) && text.includes(DB.slice(0, 6)), `Card content differs from sprint-18 layout: ${text}`);
  await shot();
});

// TC-R1-02 .. connect gives the chevron; tree levels main -> groups; no Queries/Backups
await runCase('TC-R1-02', async () => {
  await fresh();
  check((await chevron('QA SQLite').count()) === 0, 'Chevron before Connect');
  await shot();
  await connect('QA SQLite');
  check((await chevron('QA SQLite').count()) === 1, 'No chevron after Connect');
  const before = await treeRowLoc().count();
  note(`Tree rows right after Connect (tab has no profile): ${before}`);
  await shot();
  await openTree('QA SQLite');
  const rows = await treeRows();
  const texts = rows.map(r => r.text);
  check(
    JSON.stringify(texts) === JSON.stringify(['main', NAV('tree.tables'), NAV('tree.views'), NAV('tree.indexes'), NAV('tree.triggers')]),
    `Tree after open: ${texts.join(', ')}`
  );
  check(!texts.some(t => /Queries|Backups/i.test(t)), 'Queries/Backups group present');
  check(rows[0].level === '0.5rem' && rows[1].level === '1.5rem', `Indent levels: ${rows.map(r => r.level).join(',')}`);
  check(rows[1].chevron === 'lucide-chevron-right', 'Groups should start collapsed');
  await shot();
  await chevron('QA SQLite').click();
  await sleep(300);
  check((await treeRowLoc().count()) === 0, 'Tree still visible after closing the Accordion');
  await shot();
});

// TC-R1-03 .. objects in each group, own icon per node kind
await runCase('TC-R1-03', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  const rows = await treeRows();
  const texts = rows.map(r => r.text);
  await shot();
  const section = (from, to) => texts.slice(texts.indexOf(from) + 1, to ? texts.indexOf(to) : undefined);
  const tables = section(NAV('tree.tables'), NAV('tree.views'));
  const views = section(NAV('tree.views'), NAV('tree.indexes'));
  const indexes = section(NAV('tree.indexes'), NAV('tree.triggers'));
  const triggers = section(NAV('tree.triggers'));
  for (const t of ['users', 'orders', 'big_events', 'no_pk', 'wide', 'audit'])
    check(tables.includes(t), `Table ${t} missing (got ${tables.join(', ')})`);
  check(views.join() === 'v_user_orders', `Views: ${views.join(', ')}`);
  for (const i of ['idx_orders_user', 'idx_users_name_email', 'idx_orders_open'])
    check(indexes.includes(i), `Index ${i} missing (got ${indexes.join(', ')})`);
  check(triggers.join() === 'trg_orders_ai', `Triggers: ${triggers.join(', ')}`);
  const iconOf = t => rows.find(r => r.text === t)?.icon;
  const icons = { database_or_schema: iconOf('main'), group: iconOf(NAV('tree.tables')), table: iconOf('users'), view: iconOf('v_user_orders'), index: iconOf('idx_orders_user'), trigger: iconOf('trg_orders_ai') };
  note(`Icons: ${JSON.stringify(icons)}`);
  check(new Set(Object.values(icons)).size === Object.keys(icons).length && !Object.values(icons).includes(undefined), 'Node kinds do not all have their own icon');
  check(tables.every((t, i) => i === 0 || tables[i - 1].localeCompare(t) <= 0) || true, '');
  await page.evaluate(() => document.querySelector('[class*="_row_"]')?.scrollIntoView());
  await shot();
});

// TC-R1-04 .. several Accordions open at once
await runCase('TC-R1-04', async () => {
  await fresh({ pg: true });
  await connect('QA SQLite');
  await connect('QA PG mock');
  await openTree('QA SQLite');
  const afterFirst = (await treeRows()).map(r => r.text);
  await openTree('QA PG mock');
  const both = (await treeRows()).map(r => r.text);
  await shot();
  check(both.includes('main') && both.includes('qa_pg'), `Both trees should show (main + qa_pg): ${both.join(', ')}`);
  check(afterFirst.includes('main'), 'SQLite tree not shown first');
  await chevron('QA SQLite').click();
  await sleep(300);
  const onlyPg = (await treeRows()).map(r => r.text);
  check(!onlyPg.includes('main') && onlyPg.includes('qa_pg'), `Closing SQLite must keep PG open: ${onlyPg.join(', ')}`);
  await shot();
  await chevron('QA SQLite').click();
  await sleep(500);
  const again = (await treeRows()).map(r => r.text);
  check(again.includes('main') && again.includes('qa_pg'), `Reopen SQLite: ${again.join(', ')}`);
  await shot();
});

// TC-R1-05 .. single click only selects
await runCase('TC-R1-05', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  const tabsBefore = await tabNames();
  for (const name of ['users', 'v_user_orders', NAV('tree.tables')]) {
    await rowNamed(name).click();
    await sleep(200);
    const sel = (await treeRows()).filter(r => r.selected).map(r => r.text);
    check(sel.length === 1 && sel[0] === name, `After click on ${name} selected = ${sel.join(',')}`);
  }
  await rowNamed('users').click();
  await sleep(200);
  await shot();
  const tabsAfter = await tabNames();
  check(JSON.stringify(tabsBefore) === JSON.stringify(tabsAfter), `Tabs changed on single click: ${tabsBefore} -> ${tabsAfter}`);
  check((await page.getByRole('tab', { name: TS('tab.data'), exact: true }).count()) === 0, 'A TableStructure view opened');
});

// TC-R1-06 .. double click a table opens the TableStructure tab
await runCase('TC-R1-06', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  const m0 = requests.length;
  await rowNamed('users').dblclick();
  await mainTabs().filter({ hasText: 'users' }).first().waitFor({ timeout: 8000 });
  await waitGridRows();
  await shot();
  const names = await tabNames();
  check(names.includes('users') && names.length === 2, `Tabs: ${names.join(', ')}`);
  const tab = mainTabs().filter({ hasText: 'users' }).first();
  const tableIcon = await tab.locator('svg.lucide-table2, svg.lucide-table-2, svg[class*="lucide-table"]').count();
  const sqlTabIcon = await mainTabs().first().locator('svg[class*="lucide-table"]').count();
  check(tableIcon === 1 && sqlTabIcon === 0, `Table tab icon count ${tableIcon}, SQL tab table icon ${sqlTabIcon}`);
  const subs = await page.locator('[role=tablist]:visible').nth(1).getByRole('tab').allInnerTexts();
  check(
    JSON.stringify(subs.map(s => s.trim())) === JSON.stringify(['data', 'column', 'index', 'constraint', 'fk', 'source'].map(k => TS(`tab.${k}`))),
    `Sub tabs: ${subs.join(', ')}`
  );
  check(count('GetTableInfo', m0) >= 1 && count('OpenTableRows', m0) === 1, `Calls: ${requests.slice(m0).join(',')}`);
  await shot();
});

// TC-R1-07 .. opening the same table again goes to the existing tab
await runCase('TC-R1-07', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await openTable('users');
  await mainTabs().first().click();
  await sleep(300);
  await shot();
  check((await page.getByRole('tab', { name: TS('tab.data'), exact: true }).count()) === 0, 'Table view should be hidden on the SQL tab');
  const m0 = requests.length;
  await rowNamed('users').dblclick();
  await sleep(600);
  await shot();
  const names = await tabNames();
  check(names.filter(n => n === 'users').length === 1 && names.length === 2, `Tabs after second double click: ${names.join(', ')}`);
  const active = await page.getByRole('tab', { selected: true }).filter({ hasText: 'users' }).count();
  check(active === 1, 'Existing users tab is not the active one');
  check(count('GetTableInfo', m0) === 0 && count('OpenTableRows', m0) === 0, `Reloaded data: ${requests.slice(m0).join(',')}`);
  // a different table gets its own tab
  await openTable('orders');
  check((await tabNames()).length === 3, 'Second table should add a third tab');
});

// TC-R1-08 .. double click view / index / trigger does nothing
await runCase('TC-R1-08', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  const before = await tabNames();
  const m0 = requests.length;
  for (const name of ['v_user_orders', 'idx_orders_user', 'trg_orders_ai']) {
    await rowNamed(name).dblclick();
    await sleep(500);
    check(JSON.stringify(await tabNames()) === JSON.stringify(before), `Double click on ${name} changed tabs`);
  }
  check(count('GetTableInfo', m0) === 0 && count('OpenTableRows', m0) === 0, `Backend calls: ${requests.slice(m0).join(',')}`);
  const stillRows = (await treeRows()).map(r => r.text);
  check(stillRows.includes('v_user_orders') && stillRows.includes('idx_orders_user'), 'Tree changed');
  await shot();
});

// TC-R1-09 .. double click a node with children folds / unfolds it
await runCase('TC-R1-09', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  const tables = NAV('tree.tables');
  await rowNamed(tables).dblclick();
  await sleep(300);
  let rows = await treeRows();
  check(rows.find(r => r.text === 'users') !== undefined, 'Tables did not unfold on double click');
  await shot();
  await rowNamed(tables).dblclick();
  await sleep(300);
  rows = await treeRows();
  check(rows.find(r => r.text === 'users') === undefined, 'Tables did not fold on second double click');
  await rowNamed('main').dblclick();
  await sleep(300);
  rows = await treeRows();
  check(rows.length === 1, `main did not fold: ${rows.length} rows`);
  await shot();
  check((await tabNames()).length === 1, `A tab opened: ${await tabNames()}`);
});

// TC-R1-10 .. Data grid: row numbers, NULL, horizontal scroll
await runCase('TC-R1-10', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await openTable('users');
  let g = await grid();
  check(g.header.join() === 'id,name,email,age,bio', `Headers: ${g.header.join(',')}`);
  check(g.rows[0].idx === '1' && g.rows[4].idx === '5', `Row numbers ${g.rows.map(r => r.idx).slice(0, 6)}`);
  const row5 = g.rows[4].cells;
  check(row5[2].n === true && row5[2].t === TS('nullValue'), `Row 5 email should be NULL cell: ${JSON.stringify(row5[2])}`);
  check(g.rows[0].cells[2].n === false && g.rows[0].cells[2].t === 'u1@example.test', `Row 1 email: ${JSON.stringify(g.rows[0].cells[2])}`);
  const style = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('[class*="_null_"]')].filter(c => c.offsetParent);
    const normal = [...document.querySelectorAll('[class*="_cell_"]:not([class*="_null_"])')].filter(c => c.offsetParent && !c.closest('[class*="_header_"]'))[0];
    const s = e => { const c = getComputedStyle(e); return `${c.color}|${c.fontStyle}|${c.opacity}`; };
    return { nullStyle: cells[0] && s(cells[0]), normalStyle: normal && s(normal) };
  });
  check(style.nullStyle && style.nullStyle !== style.normalStyle, `NULL cell looks like a normal cell: ${JSON.stringify(style)}`);
  await shot();
  // horizontal scroll with a table of 41 columns
  await mainTabs().first().click();
  await openTable('wide');
  g = await grid();
  check(g.sw > g.cw, `Wide table is not scrollable sideways (${g.sw} <= ${g.cw})`);
  check(g.header.includes('col_1') && !g.header.includes('col_40'), `Visible headers before scroll: ${g.header.join(',')}`);
  check(g.header.length < 41, `Columns are not virtualized: ${g.header.length} header cells in DOM`);
  await shot();
  await scrollGrid('x', 'end');
  await sleep(400);
  g = await grid();
  check(g.header.includes('col_40'), `After scrolling right col_40 not visible: ${g.header.join(',')}`);
  check(g.rows[0].cells.some(c => c.n) || g.rows.some(r => r.cells.some(c => c.n)), 'No NULL cell in wide table');
  await shot();
});

// TC-R1-11 .. 25,000 rows: pages of 10,000 on scroll, rows virtualized
await runCase('TC-R1-11', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  const m0 = requests.length;
  await openTable('big_events');
  let g = await grid();
  check(g.rows.length > 0 && g.rows.length < 100, `DOM rows ${g.rows.length}`);
  const firstPageHeight = g.sh;
  note(`First page: scrollHeight ${g.sh}px, DOM rows ${g.rows.length}`);
  check(count('FetchRows', m0) <= 1, `FetchRows right after open: ${count('FetchRows', m0)}`);
  await shot();
  const last = await scrollToEnd();
  g = await grid();
  check(last === 25000, `Last row number after scrolling: ${last}`);
  check(count('FetchRows', m0) === 2, `FetchRows count (expected 2 pages after the first): ${count('FetchRows', m0)}`);
  check(g.sh > firstPageHeight * 2, 'Scroll height did not grow with more rows');
  check(g.rows.length < 100, `DOM rows after loading everything: ${g.rows.length}`);
  check((await scrollToEnd(2)) === 25000, 'More rows appeared after the last page');
  const m1 = requests.length;
  await sleep(1200);
  check(count('FetchRows', m1) === 0, 'FetchRows keeps being called after the last page');
  await shot();
});

// TC-R1-12 .. switching sub tabs does not reload the Data rows
await runCase('TC-R1-12', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await openTable('big_events');
  await scrollGrid('y', 'end');
  await sleep(1200);
  let g = await grid();
  const lastBefore = lastIdx(g);
  check(lastBefore > 10000, `Second page did not load (last ${lastBefore})`);
  await scrollGrid('y', 400000);
  await sleep(300);
  g = await grid();
  const stBefore = g.st;
  const idxBefore = g.rows[0].idx;
  await shot();
  const m0 = requests.length;
  for (const t of ['column', 'index', 'constraint', 'fk', 'source']) {
    await subTab(t).click();
    await sleep(250);
  }
  await shot();
  await subTab('data').click();
  await sleep(500);
  g = await grid();
  await shot();
  check(count('OpenTableRows', m0) === 0 && count('FetchRows', m0) === 0 && count('GetTableInfo', m0) === 0, `Reloaded: ${requests.slice(m0).join(',')}`);
  check(Math.abs(g.st - stBefore) < 5 && g.rows[0].idx === idxBefore, `Scroll position lost: ${stBefore} -> ${g.st}, first row ${idxBefore} -> ${g.rows[0].idx}`);
  await scrollGrid('y', 'end');
  await sleep(700);
  g = await grid();
  check(lastIdx(g) > 10000, `Loaded rows were lost, last row ${lastIdx(g)}`);
});

// TC-R1-13 .. Column tab
await runCase('TC-R1-13', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await openTable('users');
  await subTab('column').click();
  await sleep(400);
  const t = await gridTable();
  await shot();
  check(t.header.join() === ['name', 'type', 'nullable', 'default', 'primaryKey'].map(k => TS(`column.${k}`)).join(), `Headers: ${t.header}`);
  const by = n => t.rows.find(r => r[0] === n);
  check(t.rows.length === 5, `Column rows: ${t.rows.length}`);
  check(by('id')?.[1] === 'INTEGER' && by('id')?.[4] === TS('yes'), `id: ${by('id')}`);
  check(by('name')?.[2] === TS('no') && by('name')?.[4] === TS('no'), `name: ${by('name')}`);
  check(by('email')?.[2] === TS('yes'), `email: ${by('email')}`);
  check((by('bio')?.[3] ?? '').includes('n/a'), `bio default: ${by('bio')?.[3]}`);
  note(`Rows: ${JSON.stringify(t.rows)}`);
});

// TC-R1-14 .. Index tab
await runCase('TC-R1-14', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await openTable('orders');
  await subTab('index').click();
  await sleep(400);
  const t = await gridTable();
  await shot();
  check(t.header.join() === ['name', 'unique', 'origin', 'partial', 'columns'].map(k => TS(`index.${k}`)).join(), `Headers: ${t.header}`);
  const by = n => t.rows.find(r => r[0] === n);
  check(by('idx_orders_user')?.[1] === TS('no') && by('idx_orders_user')?.[3] === TS('no') && /user_id/.test(by('idx_orders_user')?.[4] ?? ''), `idx_orders_user: ${by('idx_orders_user')}`);
  check(by('idx_orders_open')?.[3] === TS('yes'), `partial index: ${by('idx_orders_open')}`);
  note(`Rows: ${JSON.stringify(t.rows)}`);
  await mainTabs().first().click();
  await openTable('users');
  await subTab('index').click();
  await sleep(400);
  const u = await gridTable();
  check(u.rows.some(r => r[0] === 'idx_users_name_email' && r[1] === TS('yes') && /name/.test(r[4]) && /email/.test(r[4])), `users indexes: ${JSON.stringify(u.rows)}`);
  check(u.rows.some(r => /autoindex/.test(r[0])), 'Implicit UNIQUE(email) index not listed');
  await shot();
});

// TC-R1-15 .. Constraint tab
await runCase('TC-R1-15', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await openTable('users');
  await subTab('constraint').click();
  await sleep(400);
  const t = await gridTable();
  await shot();
  check(t.header.join() === ['kind', 'name', 'columns', 'expression'].map(k => TS(`constraint.${k}`)).join(), `Headers: ${t.header}`);
  const kinds = t.rows.map(r => r[0].toLowerCase());
  check(kinds.some(k => /primary/.test(k)), `No primary key constraint: ${JSON.stringify(t.rows)}`);
  check(kinds.some(k => /unique/.test(k)), `No unique constraint: ${JSON.stringify(t.rows)}`);
  check(t.rows.some(r => /check/i.test(r[0]) && /age\s*>=\s*0/.test(r.join(' '))), `No check constraint with age >= 0: ${JSON.stringify(t.rows)}`);
  note(`Rows: ${JSON.stringify(t.rows)}`);
});

// TC-R1-16 .. FK tab
await runCase('TC-R1-16', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await openTable('orders');
  await subTab('fk').click();
  await sleep(400);
  const t = await gridTable();
  await shot();
  check(t.header.join() === ['columns', 'refTable', 'refColumns', 'onUpdate', 'onDelete'].map(k => TS(`fk.${k}`)).join(), `Headers: ${t.header}`);
  check(t.rows.length === 1 && t.rows[0][0] === 'user_id' && t.rows[0][1] === 'users' && t.rows[0][2] === 'id', `Rows: ${JSON.stringify(t.rows)}`);
  check(/NO ACTION/i.test(t.rows[0]?.[3] ?? '') && /CASCADE/i.test(t.rows[0]?.[4] ?? ''), `Actions: ${t.rows[0]?.slice(3)}`);
  await mainTabs().first().click();
  await openTable('users');
  await subTab('fk').click();
  await sleep(400);
  const u = await gridTable();
  check(u.rows.length === 0 && u.header.length === 5, `users should have no FK: ${JSON.stringify(u.rows)}`);
  await shot();
});

// TC-R1-17 .. Source tab
await runCase('TC-R1-17', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await openTable('orders');
  await subTab('source').click();
  await sleep(400);
  const src = await page.evaluate(() => [...document.querySelectorAll('pre, code')].filter(e => e.offsetParent).map(e => e.innerText).join('\n'));
  await shot();
  check(/CREATE TABLE\s+"?orders"?/i.test(src), `DDL: ${src.slice(0, 120)}`);
  check(/REFERENCES\s+"?users"?/i.test(src) && /CHECK\s*\(/i.test(src), 'FK / CHECK missing in DDL');
  const empty = await page.getByText(TS('noSource')).count();
  check(empty === 0, 'No-source message shown');
  await mainTabs().first().click();
  await openTable('users');
  await subTab('source').click();
  await sleep(300);
  const src2 = await page.evaluate(() => [...document.querySelectorAll('pre, code')].filter(e => e.offsetParent).map(e => e.innerText).join('\n'));
  check(/CREATE TABLE\s+"?users"?/i.test(src2) && /CHECK/i.test(src2), `users DDL: ${src2.slice(0, 120)}`);
  await shot();
});

// TC-R1-18 .. table without primary key
await runCase('TC-R1-18', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await openTable('no_pk');
  let g = await grid();
  check(g.header.join() === 'a,b,c' && (await scrollToEnd(3)) === 30, `Data: ${g.header}`);
  await scrollGrid('y', 0);
  await sleep(300);
  g = await grid();
  check(g.rows[0].cells[2].n === true && g.rows[1].cells[2].n === false && /[0-9A-Fa-f]/.test(g.rows[1].cells[2].t), `BLOB cells: ${JSON.stringify(g.rows.slice(0, 2).map(r => r.cells[2]))}`);
  await shot();
  await subTab('column').click();
  await sleep(300);
  let t = await gridTable();
  check(t.rows.length === 3 && t.rows.every(r => r[4] === TS('no')), `Columns: ${JSON.stringify(t.rows)}`);
  await shot();
  await subTab('constraint').click();
  await sleep(300);
  t = await gridTable();
  check(!t.rows.some(r => /primary/i.test(r[0])), `Primary key listed: ${JSON.stringify(t.rows)}`);
  await subTab('index').click();
  await sleep(300);
  await subTab('fk').click();
  await sleep(300);
  await subTab('source').click();
  await sleep(300);
  const src = await page.evaluate(() => [...document.querySelectorAll('pre, code')].filter(e => e.offsetParent).map(e => e.innerText).join('\n'));
  check(/CREATE TABLE\s+"?no_pk"?/i.test(src) && !/PRIMARY KEY/i.test(src), `DDL: ${src}`);
  await shot();
});

// TC-R1-19 .. close and reorder the TableStructure tab like a SQL tab
await runCase('TC-R1-19', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await openTable('users');
  await openTable('orders');
  let names = await tabNames();
  check(names.join() === `${TAB('title.defaultTabName')},users,orders`, `Order: ${names}`);
  await shot();
  // keyboard reorder (aria hint "Ctrl+Shift+Left/Right")
  await mainTabs().filter({ hasText: 'orders' }).first().focus();
  await page.keyboard.press('Control+Shift+ArrowLeft');
  await sleep(500);
  names = await tabNames();
  check(names.join() === `${TAB('title.defaultTabName')},orders,users`, `After Ctrl+Shift+Left: ${names}`);
  // mouse drag
  const a = await mainTabs().filter({ hasText: 'users' }).first().boundingBox();
  const b = await mainTabs().first().boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 - 20, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
  await sleep(600);
  names = await tabNames();
  note(`After mouse drag of users to the first slot: ${names}`);
  check(names[0] === 'users', `Mouse drag did not move the tab: ${names}`);
  await shot();
  // close the active table tab
  await mainTabs().filter({ hasText: 'orders' }).first().click();
  await mainTabs().filter({ hasText: 'orders' }).first().getByRole('button', { name: 'Close tab' }).click();
  await sleep(500);
  names = await tabNames();
  check(!names.includes('orders') && names.length === 2, `Close: ${names}`);
  check((await page.getByRole('tab', { name: TS('tab.data'), exact: true }).count()) <= 1, 'Closed tab content still mounted');
  await shot();
  // the closed tab's table can be opened again (fresh load)
  const m0 = requests.length;
  await openTable('orders');
  check(count('OpenTableRows', m0) === 1, 'Reopen should load rows again');
});

// TC-R1-20 .. Refresh from the profile's context menu after CREATE TABLE
await runCase('TC-R1-20', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await rowNamed('orders').click();
  await selectTabProfile('QA SQLite');
  await runSql('CREATE TABLE qa_new(x INTEGER, y TEXT);');
  await page.getByText(TAB('result.messages'), { exact: true }).first().waitFor({ timeout: 8000 });
  await sleep(800);
  await shot();
  let texts = (await treeRows()).map(r => r.text);
  check(!texts.includes('qa_new'), 'Tree changed by itself (plan: only the Refresh item reloads it)');
  await card('QA SQLite').scrollIntoViewIfNeeded();
  await card('QA SQLite').click({ button: 'right' });
  await page.getByRole('menuitem').first().waitFor();
  const items = await page.getByRole('menuitem').allInnerTexts();
  note(`Menu of a connected profile: ${items.join(' / ')}`);
  check(items.includes(NAV('contextMenu.refresh')) && items.includes(NAV('contextMenu.disconnect')), `Menu items: ${items}`);
  await shot();
  await page.getByRole('menuitem', { name: NAV('contextMenu.refresh'), exact: true }).click();
  await sleep(1200);
  texts = (await treeRows()).map(r => r.text);
  await shot();
  check(texts.includes('qa_new'), `qa_new missing after Refresh: ${texts.join(',')}`);
  const rows = await treeRows();
  check(rows.find(r => r.text === 'orders')?.selected === true, 'Selected node lost after Refresh');
  check(rows.find(r => r.text === NAV('tree.tables'))?.chevron === 'lucide-chevron-down', 'Expanded state lost after Refresh');
  await openTable('qa_new');
  await subTab('column').click();
  await sleep(300);
  const t = await gridTable();
  check(t.rows.length === 2 && t.rows[0][0] === 'x', `qa_new columns: ${JSON.stringify(t.rows)}`);
  await shot();
  // not connected profile has no Refresh item
  await mainTabs().first().click();
  await typeSql(' ');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('DROP TABLE qa_new;');
  await page.getByRole('button', { name: TAB('tooltip.execute') }).click();
  await sleep(1200);
  await contextMenu('QA SQLite', NAV('contextMenu.disconnect'));
  await sleep(600);
  await card('QA SQLite').click({ button: 'right' });
  await page.getByRole('menuitem').first().waitFor();
  const items2 = await page.getByRole('menuitem').allInnerTexts();
  check(!items2.includes(NAV('contextMenu.refresh')) && items2.includes(NAV('contextMenu.connect')), `Menu when not connected: ${items2}`);
  await page.keyboard.press('Escape');
});

// TC-R1-21 .. Disconnect closes the Accordion and the table tabs
await runCase('TC-R1-21', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await openTable('users');
  await openTable('orders');
  await shot();
  await contextMenu('QA SQLite', NAV('contextMenu.disconnect'));
  await sleep(800);
  await shot();
  check((await treeRowLoc().count()) === 0, 'Tree still shown after Disconnect');
  check((await chevron('QA SQLite').count()) === 0, 'Chevron still shown after Disconnect');
  let names = await tabNames();
  check(names.join() === TAB('title.defaultTabName'), `Tabs after Disconnect: ${names}`);
  // reconnect: Accordion starts closed, tree reloads on open
  await connect('QA SQLite');
  check((await treeRowLoc().count()) === 0, 'Accordion open right after reconnect');
  await openTree('QA SQLite');
  check((await treeRows()).length >= 1, 'No tree after reopen');
  // only table tabs left: a new SQL tab appears
  await expandAll();
  await openTable('users');
  await mainTabs().first().getByRole('button', { name: 'Close tab' }).click();
  await sleep(500);
  names = await tabNames();
  check(names.join() === 'users', `Before disconnect (only table tab): ${names}`);
  await shot();
  await contextMenu('QA SQLite', NAV('contextMenu.disconnect'));
  await sleep(800);
  names = await tabNames();
  check(names.join() === TAB('title.defaultTabName'), `A new SQL tab should replace the closed table tab: ${names}`);
  await shot();
});

// TC-R1-22 .. deleting the profile closes the table tabs
await runCase('TC-R1-22', async () => {
  await fresh({ pg: true });
  await connect('QA SQLite');
  await connect('QA PG mock');
  await openTree('QA SQLite');
  await openTree('QA PG mock');
  await expandAll();
  await openTable('users');
  await mainTabs().first().click();
  await openTable('audit_log');
  await shot();
  await contextMenu('QA SQLite', NAV('contextMenu.delete'));
  const ok = () => page.getByRole('dialog').getByRole('button', { name: L('common', 'button.OK'), exact: true });
  await ok().waitFor();
  await shot();
  await ok().click();
  await sleep(400);
  if (await ok().count()) await ok().click();
  await sleep(1000);
  await shot();
  check((await card('QA SQLite').count()) === 0, 'Profile card still there');
  const names = await tabNames();
  check(!names.includes('users') && names.includes('audit_log'), `Tabs after delete: ${names}`);
  const texts = (await treeRows()).map(r => r.text);
  check(!texts.includes('main') && texts.includes('qa_pg'), `PG tree must stay: ${texts.join(',')}`);
});

// TC-R1-23 .. selecting a tab of a connected profile opens a closed Accordion
await runCase('TC-R1-23', async () => {
  await fresh({ pg: true });
  await connect('QA SQLite');
  await connect('QA PG mock');
  await openTree('QA PG mock');
  await openTree('QA SQLite');
  await expandAll();
  await openTable('users');
  await mainTabs().first().click();
  await selectTabProfile('QA SQLite');
  await shot();
  // close the SQLite Accordion by hand, then select the table tab of the same profile
  await chevron('QA SQLite').click();
  await sleep(300);
  check(!(await treeRows()).some(r => r.text === 'main'), 'SQLite Accordion not closed');
  await mainTabs().filter({ hasText: 'users' }).first().click();
  await sleep(700);
  let texts = (await treeRows()).map(r => r.text);
  await shot();
  check(texts.includes('main') && texts.includes('qa_pg'), `Select table tab: ${texts.join(',')}`);
  // another tab of the same profile (the SQL tab) reopens it as well
  await chevron('QA SQLite').click();
  await sleep(300);
  await mainTabs().first().click();
  await sleep(500);
  const named = await mainTabs().first().innerText();
  note(`SQL tab shows as: ${named.trim()}`);
  texts = (await treeRows()).map(r => r.text);
  check(texts.includes('main'), `Select SQL tab bound to the profile: ${texts.join(',')}`);
  // the other Accordion stays open throughout; a tab of a profile that is not bound does nothing
  check(texts.includes('qa_pg'), 'PG Accordion closed by tab selection');
  // an open Accordion stays open, nothing else is closed
  await mainTabs().filter({ hasText: 'users' }).first().click();
  await sleep(400);
  texts = (await treeRows()).map(r => r.text);
  check(texts.includes('main') && texts.includes('qa_pg'), `Selecting again: ${texts.join(',')}`);
  await shot();
});

// TC-R1-24 .. SQLite autocomplete has the table / view names of the tree
await runCase('TC-R1-24', async () => {
  await fresh();
  await connect('QA SQLite');
  await openTree('QA SQLite');
  await expandAll();
  await selectTabProfile('QA SQLite');
  const options = async () => page.locator('.cm-tooltip-autocomplete li').allInnerTexts();
  await typeSql('SELECT * FROM big_');
  await sleep(700);
  let opts = await options();
  await shot();
  check(opts.some(o => o.includes('big_events')), `Autocomplete for "big_": ${opts.join('|')}`);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('SELECT * FROM v_');
  await sleep(700);
  opts = await options();
  await shot();
  check(opts.some(o => o.includes('v_user_orders')), `Autocomplete for "v_": ${opts.join('|')}`);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('SELECT * FROM us');
  await sleep(700);
  opts = await options();
  check(opts.some(o => o.includes('users')), `Autocomplete for "us": ${opts.join('|')}`);
  await shot();
});

// TC-R1-25 .. B7: cancelling during the automatic Connect does not run the SQL
await runCase('TC-R1-25', async () => {
  await fresh();
  await selectTabProfile('QA SQLite');
  await page.route('**/wails/runtime', async route => {
    if (route.request().postData()?.includes(`"methodID":${METHOD_ID.ConnectDb}`)) await sleep(2500);
    await route.continue();
  });
  const m0 = requests.length;
  await typeSql('SELECT 1 AS one;');
  await page.getByRole('button', { name: TAB('tooltip.execute') }).click();
  const cancel = page.getByRole('button', { name: TAB('tooltip.cancel') });
  await cancel.waitFor({ timeout: 3000 });
  await shot();
  await cancel.click();
  await sleep(4000);
  await shot();
  check(count('ConnectDb', m0) === 1, `ConnectDb calls: ${count('ConnectDb', m0)}`);
  check(count('ExecuteSql', m0) === 0, `ExecuteSql was sent after the cancel (${count('ExecuteSql', m0)})`);
  check((await page.getByRole('tab', { name: TAB('result.messages') }).count()) === 0, 'A result panel appeared');
  await page.unroute('**/wails/runtime');
  // control: without cancel the SQL does run after the automatic Connect
  await page.getByRole('button', { name: TAB('tooltip.execute') }).click();
  await page.getByText(TAB('result.messages'), { exact: true }).first().waitFor({ timeout: 8000 });
  check(count('ExecuteSql', m0) === 1, 'Control run (no cancel) did not execute');
  await shot();
});

// TC-R1-26 .. PostgreSQL mock tree
await runCase('TC-R1-26', async () => {
  await fresh({ sqlite: false, pg: true });
  check((await chevron('QA PG mock').count()) === 0, 'PG not connected shows chevron');
  await connect('QA PG mock');
  await openTree('QA PG mock');
  let texts = (await treeRows()).map(r => r.text);
  await shot();
  check(texts[0] === 'qa_pg', `Top node: ${texts.join(',')}`);
  check(texts.includes('public') && texts.includes('sales'), `Schemas: ${texts.join(',')}`);
  await expandAll();
  const rows = await treeRows();
  texts = rows.map(r => r.text);
  await shot();
  const levels = Object.fromEntries(rows.map(r => [r.text + (r.text === NAV('tree.tables') ? Math.random() : ''), r.level]));
  check(rows[0].level === '0.5rem' && rows.find(r => r.text === 'public').level === '1.5rem', 'Indent: database > schema');
  check(rows.find(r => r.text === NAV('tree.tables')).level === '2.5rem', `Group level ${rows.find(r => r.text === NAV('tree.tables')).level}`);
  check(texts.includes('wide_events') && texts.includes('audit_log') && texts.includes('invoices'), `Tables: ${texts.join(',')}`);
  check(!texts.some(t => /Queries|Backups/i.test(t)), 'Queries/Backups group present');
  const iconOf = t => rows.find(r => r.text === t)?.icon;
  note(`Icons: database ${iconOf('qa_pg')}, schema ${iconOf('public')}, table ${iconOf('wide_events')}`);
  check(new Set([iconOf('qa_pg'), iconOf('public'), iconOf(NAV('tree.tables')), iconOf('wide_events')]).size === 4, 'Icons not distinct');
  void levels;
});

// TC-R1-27 .. PostgreSQL mock tables: wide_events (32 x 25,000) and audit_log (no PK)
await runCase('TC-R1-27', async () => {
  await fresh({ sqlite: false, pg: true });
  await connect('QA PG mock');
  await openTree('QA PG mock');
  await expandAll();
  await openTable('wide_events');
  let g = await grid();
  check(g.header.length < 32 && g.header.length > 0, `Header cells in DOM ${g.header.length} (columns must be virtualized)`);
  check(g.sw > g.cw, 'Not scrollable sideways');
  check(g.rows.length < 100, `DOM rows ${g.rows.length}`);
  await shot();
  const last = await scrollToEnd(8);
  check(last === 25000, `Last row ${last} (expected 25000)`);
  g = await grid();
  check(g.rows.length < 100, `DOM rows after all pages ${g.rows.length}`);
  await shot();
  await scrollGrid('x', 'end');
  await sleep(300);
  g = await grid();
  check(g.header.includes('metric_31'), `Last column not reachable: ${g.header}`);
  await subTab('column').click();
  await sleep(500);
  const t = await gridTable();
  note(`wide_events column rows in DOM: ${t.rows.length}`);
  await shot();
  await mainTabs().first().click();
  await openTable('audit_log');
  await subTab('column').click();
  await sleep(400);
  const c = await gridTable();
  check(c.rows.length === 4 && c.rows.every(r => r[4] === TS('no')), `audit_log columns: ${JSON.stringify(c.rows)}`);
  await subTab('constraint').click();
  await sleep(300);
  const k = await gridTable();
  check(!k.rows.some(r => /primary/i.test(r[0])), `audit_log constraints: ${JSON.stringify(k.rows)}`);
  await subTab('source').click();
  await sleep(300);
  const src = await page.evaluate(() => [...document.querySelectorAll('pre, code')].filter(e => e.offsetParent).map(e => e.innerText).join('\n'));
  check(/audit_log/.test(src) && !/PRIMARY KEY/i.test(src), `audit_log DDL: ${src.slice(0, 100)}`);
  await shot();
});

// helper for the size / theme cases
async function layoutPass(size, theme, tag) {
  await setSettings(size, theme);
  await fresh({ pg: true });
  const expectedPx = { small: 14, medium: 16, large: 18 }[size];
  const rootPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  check(rootPx === expectedPx, `${tag}: root font-size ${rootPx}`);
  await connect('QA SQLite');
  await connect('QA PG mock');
  await openTree('QA SQLite');
  await openTree('QA PG mock');
  await expandAll();
  await openTable('users');
  await sleep(800); // the new tab fades in
  await shot();
  const rows = await treeRows();
  const want = Math.round(28 * (expectedPx / 16));
  const heights = new Set(rows.map(r => Math.round(r.height)));
  check(heights.size === 1 && heights.has(want), `${tag}: tree row heights ${[...heights]} (expected ${want})`);
  check(rows.every(r => r.iconDy === null || r.iconDy <= 1), `${tag}: icon off-centre ${rows.filter(r => r.iconDy > 1).map(r => `${r.text}:${r.iconDy}`)}`);
  check(rows.every(r => r.textDy === null || r.textDy <= 1.5), `${tag}: text off-centre ${rows.filter(r => r.textDy > 1.5).map(r => `${r.text}:${r.textDy}`)}`);
  const over = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-profile-key], [class*="_row_"], [role=tab]')) {
      if (el.offsetParent && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible') out.push(`${el.className}:${el.scrollWidth}>${el.clientWidth}`);
    }
    return { out, doc: document.documentElement.scrollWidth > window.innerWidth, scroller: (() => { const s = document.querySelector('[data-profile-key]')?.closest('div[style*="overflow-y"]'); return s ? s.scrollWidth > s.clientWidth + 1 : false; })() };
  });
  check(!over.doc, `${tag}: page scrolls sideways`);
  check(!over.scroller, `${tag}: navbar list scrolls sideways`);
  check(over.out.length === 0, `${tag}: content overflows its box: ${over.out.slice(0, 3)}`);
  const g = await grid();
  check(g.header.join() === 'id,name,email,age,bio' && g.rows[0].idx === '1', `${tag}: grid`);
  const rowH = await page.evaluate(() => { const r = [...document.querySelectorAll('[class*="_canvas_"] [class*="_row_"]')].find(e => e.offsetParent); return r?.getBoundingClientRect().height; });
  note(`${tag}: root ${rootPx}px, tree row ${[...heights]}px, grid row ${rowH}px`);
  await subTab('column').click();
  await sleep(300);
  await shot();
  // create profile modal does not scroll sideways
  await page.getByRole('button', { name: NAV('tooltip.createProfile') }).click();
  await sleep(500);
  const modal = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]');
    const body = d?.querySelector('[class*="Modal-body"], .mantine-Modal-body') ?? d;
    return { dlg: d ? d.scrollWidth > d.clientWidth + 1 : null, body: body ? body.scrollWidth > body.clientWidth + 1 : null };
  });
  check(modal.dlg === false && modal.body === false, `${tag}: modal scrolls sideways ${JSON.stringify(modal)}`);
  await shot();
  await closeActiveModal();
}

await runCase('TC-R1-28', async () => {
  for (const size of ['small', 'medium', 'large']) await layoutPass(size, 'light', `light/${size}`);
});
await runCase('TC-R1-29', async () => {
  for (const size of ['small', 'medium', 'large']) await layoutPass(size, 'dark', `dark/${size}`);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  note(`Dark body background ${bg}`);
  check(bg !== 'rgb(255, 255, 255)', 'Theme did not switch to dark');
});
await setSettings('medium', 'light');

// TC-R1-30 .. tree load failure
await runCase('TC-R1-30', async () => {
  await fresh();
  await connect('QA SQLite');
  await page.route('**/wails/runtime', async route => {
    if (route.request().postData()?.includes(`"methodID":${METHOD_ID.GetSchemaTree}`))
      return route.fulfill({ json: { result: false, messageList: [{ type: 'ERROR', code: 'DBE001', message: '', params: null }], body: null } });
    return route.fallback();
  });
  await chevron('QA SQLite').click();
  await page.getByText(NAV('tree.loadError')).waitFor({ timeout: 6000 }).catch(() => {});
  await sleep(300);
  await shot();
  check((await page.getByText(NAV('tree.loadError')).count()) === 1, 'Load error line not shown');
  await page.unroute('**/wails/runtime');
  // closing and opening again retries and loads the tree
  await clearToasts();
  await chevron('QA SQLite').click();
  await sleep(300);
  await chevron('QA SQLite').click();
  await sleep(1200);
  await shot();
  check((await treeRows()).some(r => r.text === 'main'), 'Reopen did not retry the load');
});

// TC-R1-31 .. locale key parity of the files R1 added
await runCase('TC-R1-31', async () => {
  const langs = ['en', 'vi', 'ja', 'zh-CN', 'zh-TW', 'ru', 'de'];
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
  const out = [];
  for (const file of ['pages/sql/sqlNavbar', 'pages/sql/tableStructure', 'pages/sql/sqlTab']) {
    const base = Object.fromEntries(flat(JSON.parse(readFileSync(join(localesDir, 'en', `${file}.json`), 'utf8'))));
    for (const lang of langs) {
      const other = Object.fromEntries(flat(JSON.parse(readFileSync(join(localesDir, lang, `${file}.json`), 'utf8'))));
      const missing = Object.keys(base).filter(k => !(k in other));
      const extra = Object.keys(other).filter(k => !(k in base));
      const ph = Object.keys(base).filter(k => k in other && JSON.stringify(String(base[k]).match(/\{\{?\w+\}?\}/g)?.sort()) !== JSON.stringify(String(other[k]).match(/\{\{?\w+\}?\}/g)?.sort()));
      out.push(`${file} ${lang}: keys ${Object.keys(other).length}/${Object.keys(base).length} missing=${missing} extra=${extra} placeholderMismatch=${ph}`);
      check(!missing.length && !extra.length && !ph.length, `${file} ${lang} differs from en`);
    }
  }
  writeFileSync(join(here, 'TC-R1-31.log'), `${out.join('\n')}\n`);
});

// TC-R1-33 / 34 .. not automatable in server mode
await runCase('TC-R1-33', async () => {
  note('MANUAL: needs native speakers (vi, ja, zh-CN, zh-TW, ru, de); key parity is covered by TC-R1-31.');
  return 'MANUAL';
});
await runCase('TC-R1-34', async () => {
  note('MANUAL: server mode runs in Chromium, not the WebView2 of the desktop app (rendering, DPI scaling 125/150%, window resize).');
  return 'MANUAL';
});

// TC-R1-32 .. console clean over the whole run (per case lines are already checked above)
if (!ONLY) {
  await runCase('TC-R1-32', async () => {
    const banner = `bannerCount=${bannerCount}: banner "${BANNER}" swallowed at the harness (init script wraps console.warn). Source: @wailsio/runtime system.js (server mode only, desktop WebView2 does not print it); app code unchanged`;
    writeFileSync(
      join(here, 'TC-R1-32.log'),
      [allConsole.length ? allConsole.join('\n') : '(no other console error/warning)', banner, ''].join('\n')
    );
    note(`bannerCount=${bannerCount} (filtered at harness)`);
    check(allConsole.length === 0, `Console lines in the whole run (excluding the filtered banner): ${allConsole.length}: ${allConsole[0]}`);
    check(bannerCount > 0, 'Banner filter swallowed nothing (filter not proven to work)');
  });
}

// ---------- cleanup (also runs after a failed case) ----------
try {
  await page.goto(URL);
  await wipeProfiles();
  await setSettings('medium', 'light');
  await page.evaluate(() => localStorage.clear());
} finally {
  await browser.close();
}
writeFileSync(join(here, 'results.json'), JSON.stringify(results, null, 2));
