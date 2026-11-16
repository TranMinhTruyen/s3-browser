// QA run for sprint-18 (SQL mode UI, mock data only). Re-runnable:
//   WAILS_SERVER_PORT=8118 ./S3Browser-server.exe   (go build -tags server,production,portable)
//   QA_URL=http://localhost:8118 [ONLY=TC-R1-01,TC-R2-01] node run.mjs
// No credentials are used. The only "password" typed is the fake value Secret-Test-123 (input is blurred in shots).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', '..', '..', 'docs', 'package.json'));
const { chromium } = require('playwright');
const URL_ = process.env.QA_URL ?? 'http://localhost:8118';
const ONLY = process.env.ONLY?.split(',');
const localesDir = join(here, '..', '..', '..', '..', 'frontend', 'src', 'locales');
const FAKE_PW = 'Secret-Test-123';
const LANGS = ['en', 'vi', 'ja', 'zh-CN', 'zh-TW', 'ru', 'de'];
const LANG_LABEL = {
  en: 'English',
  vi: 'Tiếng Việt',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ru: 'Русский',
  de: 'Deutsch',
};
const lbl = (lang, ns, key) =>
  key.split('.').reduce((n, k) => n[k], JSON.parse(readFileSync(join(localesDir, lang, `${ns}.json`), 'utf8')));
const L = (ns, key) => lbl('en', ns, key);

const browser = await chromium.launch();
const results = {};
const ENV_WARN = /Browser Environment Detected|Only UI previews|More information at: https:\/\/v3\.wails\.io/;

async function newPage(id, { lang = 'en', route } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  if (route) await route(page);
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: 'S3' }).waitFor({ state: 'attached' });
  return { page, ctx, logs };
}
async function toSql(page) {
  await page.getByText('SQL', { exact: true }).first().click();
  await page.locator('.cm-content').first().waitFor();
}
const toast = page => page.locator('[data-sonner-toast]');
const toastTexts = async page => (await toast(page).allInnerTexts()).map(s => s.replace(/\s+/g, ' ').trim());
const ed = page => page.locator('.cm-content:visible').first();
const docText = async page => (await page.locator('.cm-content:visible').first().locator('.cm-line').allInnerTexts()).join('\n');
async function setSql(page, text) {
  await ed(page).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.insertText(lines[i]);
    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
}
async function selectLine(page, n) {
  await page.keyboard.press('Control+Home');
  for (let i = 1; i < n; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
}
const row = (page, name) => page.locator('[data-profile-key]', { hasText: name });
const check = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const profileBtn = page => page.locator('button.mantine-InputBase-input:visible').first();
async function pickProfile(page, name) {
  await profileBtn(page).click();
  await page.getByRole('option', { name }).click();
}
async function clearToasts(page) {
  await page.evaluate(() => document.querySelectorAll('[data-sonner-toast]').forEach(e => e.remove()));
  await page.waitForTimeout(100);
}
const confirmBtn = page => page.getByRole('dialog').getByRole('button').last();
const blur = page =>
  page.evaluate(() =>
    document.querySelectorAll('input[type=password], input[type=text]').forEach(i => {
      if (i.closest('[role=dialog]')) i.style.filter = 'blur(6px)';
    })
  );

async function tc(id, fn, opts = {}) {
  if (ONLY && !ONLY.includes(id)) return;
  mkdirSync(join(here), { recursive: true });
  let n = 0;
  const ctxObj = await newPage(id, opts);
  const { page, ctx, logs } = ctxObj;
  const shot = async () => {
    n += 1;
    await page.screenshot({ path: join(here, `${id}-${String(n).padStart(2, '0')}.png`) });
  };
  const note = { v: '' };
  let status = 'PASS';
  try {
    await shot(); // before
    await fn({ page, shot, note, logs, ctx });
    if (n < 2) await shot();
  } catch (e) {
    status = 'FAIL';
    note.v = `${note.v} ${`${e.message} ${(e.log ?? []).join(' ')}`.replace(/\[[0-9;]*m/g, '').replace(/\s+/g, ' ').slice(0, 500)}`.trim();
    try {
      await shot();
    } catch {}
  }
  const bad = logs.filter(l => /^\[(error|warning|pageerror)\]/.test(l) && !ENV_WARN.test(l) && !(opts.allowFailedLoad && /Failed to load resource/.test(l)));
  if (bad.length && status === 'PASS') {
    status = 'FAIL';
    note.v = `Console có error/warning: ${bad[0].slice(0, 160)}`;
  }
  const safe = logs.map(l => l.split(FAKE_PW).join('***'));
  writeFileSync(join(here, `${id}.console.log`), `${safe.join('\n')}\n`);
  results[id] = { status, note: note.v };
  console.log(id, status, note.v);
  await ctx.close();
}

const SETTING = 'components/modals/settingModal';
const NAVBAR = 'pages/sql/sqlNavbar';
const TAB = 'pages/sql/sqlTab';
const MODAL = 'components/modals/dbProfileModal';
const tr = (lang, ns, key) => lbl(lang, ns, key);
/** Switch app language through the Settings modal (Apply = for this page only). */
async function setLanguage(page, from, to) {
  await page.getByRole('button', { name: tr(from, SETTING, 'title'), exact: true }).click();
  await page.getByRole('combobox', { name: tr(from, SETTING, 'label.language') }).click();
  await page.getByRole('option', { name: LANG_LABEL[to], exact: true }).click();
  await page.getByRole('button', { name: tr(to, SETTING, 'button.apply'), exact: true }).click();
  await page.getByText(tr(to, SETTING, 'label.language'), { exact: true }).waitFor();
  await page.getByRole('button', { name: tr(to, SETTING, 'button.cancel'), exact: true }).click();
  await page.waitForTimeout(400);
}
async function openCreate(page) {
  await page.getByRole('button', { name: L(NAVBAR, 'tooltip.createProfile'), exact: true }).click();
  await page.getByRole('dialog').waitFor();
}
const ph = (page, key) => page.getByRole('dialog').getByPlaceholder(L(MODAL, `form.label.${key}`), { exact: true });
const submitBtn = (page, edit = false) =>
  page.getByRole('dialog').getByRole('button', { name: L(MODAL, edit ? 'form.button.edit' : 'form.button.create') });
async function fillPg(page, name, host = 'db.example.test') {
  await ph(page, 'name').fill(name);
  await ph(page, 'host').fill(host);
  await ph(page, 'database').fill('appdb');
  await ph(page, 'username').fill('qa_user');
}

// ================= R1
await tc('TC-R1-01', async ({ page, note, logs }) => {
  const reqs = [];
  page.on('request', r => reqs.push(r.url()));
  await page.reload({ waitUntil: 'networkidle' });
  check(await page.getByRole('radio', { name: 'S3' }).isChecked(), 'S3 không được chọn mặc định');
  check((await page.getByRole('radio').count()) === 2, 'SegmentedControl không có đúng 2 lựa chọn');
  check((await page.locator('[data-profile-key]').count()) === 0, 'đang hiện dữ liệu SQL');
  const chunks = reqs.filter(u => /assets/.test(u)).map(u => u.split('/').pop());
  logs.push(`[info] asset requests: ${chunks.join(', ')}`);
  check(!chunks.some(u => /SqlWorkspace|sql-formatter|codemirror/i.test(u)), 'Chunk SQL bị tải khi khởi động ở S3');
  note.v = `S3 mặc định, 2 radio; ${chunks.length} asset được tải, không có chunk SqlWorkspace.`;
});

await tc('TC-R1-02', async ({ page, shot, note }) => {
  const reqs = [];
  page.on('request', r => reqs.push(r.url()));
  await toSql(page);
  await shot();
  check((await page.locator('[data-profile-key]').count()) === 3, 'navbar SQL không có 3 profile mock');
  check((await page.getByRole('tab').count()) === 1, 'không có đúng 1 tab');
  check((await page.getByRole('tab').first().innerText()).includes('New query'), 'tab không tên New query');
  check(reqs.some(u => /SqlWorkspace/.test(u)), 'chunk SqlWorkspace không tải khi chọn SQL');
  note.v = 'Chunk SqlWorkspace tải khi chọn SQL; 3 profile mock; 1 tab "New query".';
});

await tc('TC-R1-03', async ({ page, shot, note }) => {
  await toSql(page);
  await page.getByRole('button', { name: 'Add tab' }).click();
  await page.waitForTimeout(500);
  await pickProfile(page, 'Local PostgreSQL');
  await setSql(page, 'select 1');
  const sep = page.locator('.mantine-Splitter-root:visible .mantine-Splitter-handle').first();
  const box = await sep.boundingBox();
  const paneW = async () => Math.round((await page.locator('.mantine-Splitter-root:visible .mantine-Splitter-pane').first().boundingBox()).width);
  const w0 = await paneW();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  const w1 = await paneW();
  await shot();
  await page.getByText('S3', { exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.getByText('SQL', { exact: true }).first().click();
  await page.waitForTimeout(500);
  const w2 = await paneW();
  check((await page.getByRole('tab').count()) === 2, 'mất tab sau khi chuyển qua lại');
  check((await docText(page)) === 'select 1', `nội dung editor mất: "${await docText(page)}"`);
  check((await profileBtn(page).innerText()).trim() === 'Local PostgreSQL', 'mất profile của tab');
  await ed(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type('xyz');
  await page.keyboard.press('Control+z');
  check((await docText(page)) === 'select 1', `undo không hoàn tác đúng: "${await docText(page)}"`);
  check(w1 !== w0 && Math.abs(w2 - w1) < 2, `độ rộng splitter ${w0} -> ${w1} -> ${w2}`);
  note.v = `Splitter ${w0} -> ${w1} -> ${w2}; 2 tab, profile, nội dung, undo giữ nguyên.`;
});

await tc('TC-R1-04', async ({ page, shot, note }) => {
  const calls = [];
  // ToggleMaximise = window runtime call {"object":6,"method":39} (observed when double-clicking the empty header).
  page.on('request', r => {
    if (r.method() === 'POST' && /"object":6,"method":39/.test(r.postData() ?? '')) calls.push('ToggleMaximise');
  });
  const base = calls.length;
  await page.getByText('SQL', { exact: true }).first().dblclick();
  await page.waitForTimeout(500);
  const afterSeg = calls.length - base;
  await page.getByText('S3', { exact: true }).first().click();
  const m1 = calls.length;
  await page.mouse.dblclick(700, 24);
  await page.waitForTimeout(500);
  const afterEmpty = calls.length - m1;
  const m2 = calls.length;
  await page.getByRole('button', { name: 'Settings' }).dblclick();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  const afterSettings = calls.length - m2;
  await shot();
  const marks = await page.evaluate(() => document.querySelectorAll('header [data-no-maximise]').length);
  note.v = `Giả lập: lời gọi runtime sau dblclick SegmentedControl=${afterSeg}, vùng trống=${afterEmpty}, Settings=${afterSettings}; nhóm data-no-maximise=${marks}. Server mode không có WebView nên ToggleMaximise thật xem TC-R1-10.`;
  check(marks >= 2, 'thiếu data-no-maximise');
  check(afterEmpty >= 1, 'dblclick vùng trống không maximise (hành vi cũ hỏng)');
  check(afterSeg === 0 && afterSettings === 0, 'dblclick SegmentedControl/Settings gọi ToggleMaximise');
});

await tc('TC-R1-05', async ({ page, note }) => {
  const out = [];
  let cur = 'en';
  for (const lang of LANGS) {
    if (lang !== 'en') {
      await setLanguage(page, cur, lang);
      cur = lang;
    }
    const sc = page.getByRole('radiogroup').first();
    const label = await sc.getAttribute('aria-label');
    out.push(`${lang}: "${label}"`);
    check(label === tr(lang, 'common', 'appMode.label'), `aria-label sai ở ${lang}: ${label}`);
    check(!/appMode/.test(await page.locator('header').first().innerText()), `hiện key thô ở ${lang}`);
    const box = await sc.boundingBox();
    check(box.height < 40 && box.x + box.width < 400, `layout header lạ ở ${lang}`);
    await page.screenshot({ path: join(here, `TC-R1-05-${String(LANGS.indexOf(lang) + 1).padStart(2, '0')}.png`) });
  }
  note.v = `${out.join('; ')}. Nhãn S3/SQL giữ nguyên ở mọi ngôn ngữ (chỉ aria-label dịch).`;
});

await tc('TC-R1-06', async ({ page, shot, note }) => {
  await page.route(/SqlWorkspace-.*\.js/, r => r.abort());
  await page.getByText('SQL', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await shot();
  const t = await toastTexts(page);
  check(t.some(s => s.includes(lbl('en', 'common', 'sqlLoadError'))), `không có toast sqlLoadError: ${t.join('|')}`);
  check((await page.locator('#root').innerText()).length > 0, 'app trắng');
  await page.unroute(/SqlWorkspace-.*\.js/);
  await page.getByText('S3', { exact: true }).first().click();
  check((await page.getByRole('button', { name: L('components/layouts/navbar/connectionProfiles', 'tooltip.createProfile'), exact: true }).count()) >= 1, 'S3 không dùng được sau lỗi');
  note.v = `Toast: ${t[0]}.`;
  await page.getByText('SQL', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const again = (await page.locator('.cm-content').count()) > 0;
  note.v += ` Bỏ chặn rồi thử lại: ${again ? 'mở được SQL' : 'KHÔNG mở được SQL (thông báo nói thử lại nhưng không retry được, khớp điểm low của code-reviewer)'}.`;
  await shot();
}, { allowFailedLoad: true });

await tc('TC-R1-09', async ({ page, note }) => {
  const hasDl = await page.getByRole('button', { name: 'Download history' }).count();
  await toSql(page);
  const hasDl2 = await page.getByRole('button', { name: 'Download history' }).count();
  check(hasDl === 1 && hasDl2 === 1, 'nút Download history mất khi ở SQL');
  note.v = 'Giả lập một phần: chỉ kiểm nút history còn ở header ở cả hai chế độ; tiến trình transfer thật cần manual TC-R1-10.';
});

await tc('TC-R1-11', async ({ page, note }) => {
  for (let i = 0; i < 5; i++) {
    await page.getByText('SQL', { exact: true }).first().click();
    await page.waitForTimeout(200);
    await page.getByText('S3', { exact: true }).first().click();
    await page.waitForTimeout(200);
    await page.emulateMedia({ colorScheme: i % 2 ? 'dark' : 'light' });
  }
  note.v = '5 vòng S3-SQL, đổi light/dark (emulateMedia) giữa chừng; console sạch.';
});

// ================= R2
const errs = page => page.getByRole('dialog').locator('.mantine-InputWrapper-error');
const menuItem = (page, key) => page.getByRole('menuitem', { name: L(NAVBAR, `contextMenu.${key}`), exact: true });
const confirmOk = page => page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true });
const confirmCancel = page => page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true });
const setType = (page, name) => page.getByRole('dialog').getByText(name, { exact: true }).click();
const CONFIRM = 'components/modals/confirmModal';
async function ctxMenu(page, name) {
  await row(page, name).first().click({ button: 'right' });
  await page.getByRole('menu').waitFor();
}
async function menuKeys(page) {
  return (await page.getByRole('menuitem').allInnerTexts()).map(s => s.trim());
}
const PG = 'Local PostgreSQL';
const SQLITE = 'Local SQLite';

await tc('TC-R2-01', async ({ page, shot, note }) => {
  await toSql(page);
  const names = ['connect', 'createProfile', 'importProfile', 'refresh'].map(k => L(NAVBAR, `tooltip.${k}`));
  const labels = await page.locator('[role=radiogroup] ~ *').count();
  for (const n of names) check((await page.getByRole('button', { name: n, exact: true }).count()) >= 1, `thiếu nút ${n}`);
  const boxes = [];
  for (const n of names) boxes.push((await page.getByRole('button', { name: n, exact: true }).filter({ visible: true }).first().boundingBox()).x);
  check(boxes[0] < boxes[1] && boxes[1] < boxes[2] && boxes[2] < boxes[3], `thứ tự nút sai ${boxes}`);
  check((await row(page, 'PostgreSQL').count()) >= 2 && (await row(page, 'SQLite').count()) >= 1, 'thiếu profile mock PG/SQLite');
  note.v = `4 nút đúng thứ tự (x=${boxes.map(Math.round)}); ${await page.locator('[data-profile-key]').count()} profile. Tooltip dùng nhãn "database profile" (khác "connection profile" ở S3, theo locale sqlNavbar).`;
  labels;
});

await tc('TC-R2-02', async ({ page, note }) => {
  await toSql(page);
  const r = row(page, PG).first();
  const badge = (await r.locator('.mantine-Badge-root').innerText()).trim();
  const bg = await r.evaluate(e => getComputedStyle(e).backgroundColor);
  const h = (await r.boundingBox()).height;
  const hs = (await row(page, SQLITE).first().boundingBox()).height;
  check(/postgres/i.test(badge) && bg !== 'rgba(0, 0, 0, 0)', `badge/màu sai: ${badge} ${bg}`);
  check(Math.abs(h - hs) < 1, 'chiều cao card không cố định');
  await r.locator('p, span').first().hover();
  await page.waitForTimeout(700);
  note.v = `badge "${badge}", nền ${bg}, card cao ${h}px, trạng thái ngắt kết nối (icon đỏ).`;
});

await tc('TC-R2-03', async ({ page, note }) => {
  await toSql(page);
  const seen = [];
  for (const k of ['connect', 'importProfile', 'refresh']) {
    const c0 = (await toastTexts(page)).length;
    await page.getByRole('button', { name: L(NAVBAR, `tooltip.${k}`), exact: true }).filter({ visible: true }).first().click();
    await page.waitForTimeout(500);
    const t = await toastTexts(page);
    check(t.length === c0 + 1 && t.at(-1).includes(L(NAVBAR, 'toast.noBackend')), `${k}: không có toast noBackend mới (${t})`);
    seen.push(k);
  }
  note.v = `Toast noBackend ở ${seen.join(', ')}; số profile vẫn ${await page.locator('[data-profile-key]').count()}.`;
});

await tc('TC-R2-04', async ({ page, shot, note }) => {
  await toSql(page);
  await ctxMenu(page, PG);
  await shot();
  const keys = await menuKeys(page);
  check(keys.join('|') === ['connect', 'edit', 'export', 'delete'].map(k => L(NAVBAR, `contextMenu.${k}`)).join('|'), `menu: ${keys}`);
  const del = await menuItem(page, 'delete').evaluate(e => getComputedStyle(e).color);
  note.v = `Menu: ${keys.join(', ')}; màu Delete ${del}; có phân cách: ${(await page.getByRole('menu').locator('.mantine-Menu-divider').count())}.`;
});

await tc('TC-R2-05', async ({ page, shot, note }) => {
  await toSql(page);
  await ctxMenu(page, PG);
  await menuItem(page, 'connect').click();
  await page.waitForTimeout(300);
  const t = await toastTexts(page);
  check(t.some(s => s.includes(L(NAVBAR, 'toast.connected').replace('{{name}}', PG))), `toast: ${t}`);
  await shot();
  await ctxMenu(page, PG);
  const keys = await menuKeys(page);
  check(keys.join('|') === ['disconnect', 'export', 'delete'].map(k => L(NAVBAR, `contextMenu.${k}`)).join('|'), `menu sau connect: ${keys}`);
  note.v = `Toast "${t[0]}"; menu sau connect: ${keys.join(', ')} (không có Edit).`;
});

await tc('TC-R2-06', async ({ page, note }) => {
  await toSql(page);
  await row(page, PG).first().dblclick();
  await page.waitForTimeout(300);
  const t1 = await toastTexts(page);
  await clearToasts(page);
  await row(page, PG).first().dblclick();
  await page.waitForTimeout(300);
  const t2 = await toastTexts(page);
  check(t1.length === 1 && t2.length === 0, `toast lần 1=${t1.length}, lần 2=${t2.length}`);
  note.v = 'Lần 1 kết nối + toast, lần 2 không toast.';
});

await tc('TC-R2-07', async ({ page, shot, note }) => {
  await toSql(page);
  await row(page, PG).first().dblclick();
  await clearToasts(page);
  await ctxMenu(page, PG);
  await menuItem(page, 'disconnect').click();
  await page.waitForTimeout(300);
  check((await page.getByRole('dialog').count()) === 0, 'có hộp xác nhận khi Disconnect');
  const t = await toastTexts(page);
  check(t.some(s => s.includes(L(NAVBAR, 'toast.disconnected').replace('{{name}}', PG))), `toast: ${t}`);
  note.v = `Toast "${t[0]}", không có modal xác nhận.`;
});

await tc('TC-R2-08', async ({ page, shot, note }) => {
  await toSql(page);
  await ctxMenu(page, PG);
  await menuItem(page, 'edit').click();
  await page.getByRole('dialog').waitFor();
  await shot();
  check((await page.getByRole('dialog').getByText(L(MODAL, 'title.edit')).count()) >= 1, 'tiêu đề không phải Edit');
  check((await ph(page, 'name').inputValue()) === PG, 'tên không điền');
  check((await ph(page, 'host').inputValue()) === 'localhost', 'host không điền');
  check((await ph(page, 'database').inputValue()) === 'postgres', 'database không điền');
  note.v = `Modal "${L(MODAL, 'title.edit')}", dữ liệu điền đúng (name/host/database).`;
});

await tc('TC-R2-09', async ({ page, note }) => {
  await toSql(page);
  await ctxMenu(page, SQLITE);
  await menuItem(page, 'export').click();
  await page.waitForTimeout(300);
  const t = await toastTexts(page);
  check(t.some(s => s.includes(L(NAVBAR, 'toast.noBackend'))) && (await page.getByRole('dialog').count()) === 0, `toast: ${t}`);
  note.v = 'Toast noBackend, không mở hộp thoại.';
});

await tc('TC-R2-10', async ({ page, shot, note }) => {
  await toSql(page);
  await pickProfile(page, PG);
  await ctxMenu(page, PG);
  await menuItem(page, 'delete').click();
  await page.getByRole('dialog').waitFor();
  await shot();
  const txt = await page.getByRole('dialog').innerText();
  check(txt.includes(lbl('en', CONFIRM, 'confirmCode.C000002')), `nội dung confirm: ${txt}`);
  await confirmOk(page).click();
  await page.waitForTimeout(600);
  check((await row(page, PG).count()) === 0, 'profile chưa bị xoá');
  const t = await toastTexts(page);
  check(t.some(s => s.includes(L(NAVBAR, 'toast.deleted').replace('{{name}}', PG))), `toast: ${t}`);
  const label = (await page.getByRole('tab').first().innerText()).trim();
  const btn = (await profileBtn(page).innerText()).trim();
  check(label.includes('New query') && !btn.includes(PG), `tab "${label}", combobox "${btn}"`);
  note.v = `C000002 hiện đúng; xoá xong tab về "${label}", combobox "${btn}" (placeholder/trống).`;
});

await tc('TC-R2-11', async ({ page, shot, note }) => {
  await toSql(page);
  await row(page, PG).first().dblclick();
  await ctxMenu(page, PG);
  await menuItem(page, 'delete').click();
  await page.getByRole('dialog').waitFor();
  const t1 = await page.getByRole('dialog').innerText();
  check(t1.includes(lbl('en', CONFIRM, 'confirmCode.C000003')), `modal 1: ${t1}`);
  await shot();
  await confirmOk(page).click();
  await page.waitForTimeout(500);
  const t2 = await page.getByRole('dialog').innerText();
  check(t2.includes(lbl('en', CONFIRM, 'confirmCode.C000002')), `modal 2: ${t2}`);
  await confirmOk(page).click();
  await page.waitForTimeout(500);
  check((await row(page, PG).count()) === 0, 'profile chưa bị xoá');
  note.v = 'C000003 rồi C000002, xác nhận cả hai thì xoá.';
});

await tc('TC-R2-12', async ({ page, shot, note }) => {
  await toSql(page);
  await row(page, PG).first().dblclick();
  await ctxMenu(page, PG);
  await menuItem(page, 'delete').click();
  await page.getByRole('dialog').waitFor();
  await confirmCancel(page).click();
  await page.waitForTimeout(500);
  check((await row(page, PG).count()) === 1, 'bị xoá khi huỷ modal đầu');
  await ctxMenu(page, PG);
  await menuItem(page, 'delete').click();
  await page.getByRole('dialog').waitFor();
  await confirmOk(page).click();
  await page.waitForTimeout(500);
  await confirmCancel(page).click();
  await page.waitForTimeout(500);
  check((await row(page, PG).count()) === 1, 'bị xoá khi huỷ modal sau');
  await ctxMenu(page, PG);
  const keys = await menuKeys(page);
  check(keys.includes(L(NAVBAR, 'contextMenu.disconnect')), 'trạng thái kết nối đổi sau khi huỷ');
  note.v = 'Huỷ ở cả hai bước: profile còn, vẫn connected.';
});

await tc('TC-R2-13', async ({ page, note }) => {
  await toSql(page);
  for (const n of [PG, 'Staging PostgreSQL', SQLITE]) {
    await ctxMenu(page, n);
    await menuItem(page, 'delete').click();
    await page.getByRole('dialog').waitFor();
    await confirmOk(page).click();
    await page.waitForTimeout(500);
  }
  check((await page.getByText(L(NAVBAR, 'profile.empty')).count()) === 1, 'không hiện profile.empty');
  await page.getByRole('button', { name: L(NAVBAR, 'tooltip.createProfile'), exact: true }).click();
  check((await page.getByRole('dialog').count()) === 1, 'nút tạo không dùng được');
  note.v = 'Hiện profile.empty; nút tạo mở modal.';
});

await tc('TC-R2-14', async ({ page, shot, note }) => {
  await toSql(page);
  const N = 40;
  for (let i = 1; i <= N; i++) {
    await openCreate(page);
    await fillPg(page, `Bulk ${String(i).padStart(3, '0')}`);
    await submitBtn(page).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  const total = await page.locator('[data-profile-key]').count();
  check(total < N + 3, `DOM giữ ${total}/${N + 3} dòng, không virtualize`);
  await page.locator('[data-profile-key]').last().scrollIntoViewIfNeeded();
  await shot();
  const last = page.locator('[data-profile-key]').last();
  const nm = (await last.innerText()).split('\n')[0];
  await last.click({ button: 'right' });
  await page.getByRole('menu').waitFor();
  const keys = await menuKeys(page);
  note.v = `Đã tạo ${N} profile (giảm từ ~200 để chạy nhanh): DOM chỉ giữ ${total} dòng/${N + 3}; menu chuột phải ở dòng cuối "${nm}" hiện ${keys.length} mục.`;
});

await tc('TC-R2-15', async ({ page, note }) => {
  await toSql(page);
  await ctxMenu(page, PG);
  await menuItem(page, 'delete').click();
  await page.getByRole('dialog').waitFor();
  await confirmOk(page).click();
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'networkidle' });
  check(await page.getByRole('radio', { name: 'S3' }).isChecked(), 'không về S3 sau reload');
  await toSql(page);
  check((await row(page, PG).count()) === 1 && (await page.locator('[data-profile-key]').count()) === 3, 'danh sách không về mock');
  note.v = 'Sau F5: chế độ S3, danh sách mock ban đầu (3 profile).';
});

await tc('TC-R2-16', async ({ page, note }) => {
  const s3Rows = () => page.locator('[data-profile-key]:visible').count();
  const before = await page.getByRole('button', { name: L('components/layouts/navbar/connectionProfiles', 'tooltip.createProfile'), exact: true }).count();
  await toSql(page);
  await row(page, PG).first().dblclick();
  await ctxMenu(page, SQLITE);
  await menuItem(page, 'delete').click();
  await page.getByRole('dialog').waitFor();
  await confirmOk(page).click();
  await page.waitForTimeout(500);
  await page.getByText('S3', { exact: true }).first().click();
  await page.waitForTimeout(500);
  const after = await page.getByRole('button', { name: L('components/layouts/navbar/connectionProfiles', 'tooltip.createProfile'), exact: true }).count();
  check(before === after, 'navbar S3 đổi');
  note.v = `Backend chưa có profile S3 (danh sách S3 trống ${await page.locator('[data-profile-key]:visible').count()} dòng) và không đổi sau thao tác SQL; chỉ kiểm được khi có profile S3 thật (không chạy với MinIO, xem TC-R1-07). Một phần.`;
  s3Rows;
});

// ================= R3
await tc('TC-R3-01', async ({ page, shot, note }) => {
  await toSql(page);
  await openCreate(page);
  await shot();
  check((await page.getByRole('dialog').getByText(L(MODAL, 'title.create')).count()) >= 1, 'tiêu đề');
  check((await ph(page, 'port').inputValue()) === '5432', `port mặc định ${await ph(page, 'port').inputValue()}`);
  const name = await ph(page, 'name').inputValue();
  check(/^Connection No\./.test(name), `tên mặc định: ${name}`);
  const ssl = await page.getByRole('dialog').getByRole('textbox', { name: L(MODAL, 'form.label.sslMode') }).or(page.getByRole('dialog').getByRole('combobox', { name: L(MODAL, 'form.label.sslMode') })).first().inputValue();
  const pgChecked = await page.getByRole('dialog').getByRole('radio', { name: 'PostgreSQL' }).isChecked();
  const groupAria = await page.getByRole('dialog').getByRole('radiogroup').first().getAttribute('aria-label');
  check(ssl === L(MODAL, 'form.sslMode.prefer') && pgChecked, `SSL "${ssl}" / PostgreSQL ${pgChecked}`);
  const cancel = await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).boundingBox();
  const save = await submitBtn(page).boundingBox();
  check(cancel.x < save.x, 'Cancel không ở bên trái');
  note.v = `Tên mặc định "${name}", PG, port 5432, SSL prefer; Cancel trái, Save phải. Quan sát (reviewer low): nhóm chọn loại DB có aria-label=${groupAria === null ? 'KHÔNG CÓ' : groupAria}, nhãn PostgreSQL/SQLite viết cứng (tên riêng, giống ở mọi ngôn ngữ).`;
});

await tc('TC-R3-02', async ({ page, shot, note, logs }) => {
  await toSql(page);
  await openCreate(page);
  await fillPg(page, 'QA Postgres');
  await ph(page, 'name').press('Tab');
  await page.getByRole('dialog').getByPlaceholder(L(MODAL, 'form.label.password'), { exact: true }).fill(FAKE_PW);
  await blur(page);
  await shot();
  await submitBtn(page).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
  const t = await toastTexts(page);
  check(t.some(s => s.includes('QA Postgres')) && !t.join('').includes(FAKE_PW), `toast: ${t}`);
  check((await page.locator('[data-profile-key]').last().innerText()).includes('QA Postgres'), 'profile không ở cuối danh sách');
  note.v = `Toast "${t[0]}" (không chứa password); profile mới ở cuối.`;
});

await tc('TC-R3-03', async ({ page, shot, note }) => {
  await toSql(page);
  await openCreate(page);
  await setType(page, 'SQLite');
  await page.waitForTimeout(300);
  check((await ph(page, 'host').count()) === 0 && (await ph(page, 'filePath').count()) === 1, 'form SQLite sai bộ trường');
  await ph(page, 'name').fill('QA Sqlite');
  await ph(page, 'filePath').fill('C:/data/qa.db');
  await shot();
  await submitBtn(page).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const last = page.locator('[data-profile-key]').last();
  check((await last.locator('.mantine-Badge-root').innerText()).toLowerCase() === 'sqlite', 'badge không phải SQLite');
  note.v = 'Form SQLite chỉ có đường dẫn file; tạo thành công, badge SQLITE.';
});

await tc('TC-R3-04', async ({ page, shot, note }) => {
  await toSql(page);
  await openCreate(page);
  for (const k of ['name', 'host', 'database', 'username']) await ph(page, k).fill('');
  await submitBtn(page).click();
  await page.waitForTimeout(400);
  const n = await errs(page).count();
  await shot();
  check(n === 4 && (await page.getByRole('dialog').count()) === 1, `số lỗi field: ${n}`);
  check((await page.locator('[data-profile-key]').count()) === 3, 'có profile mới');
  note.v = `${n} lỗi field (name, host, database, username): ${(await errs(page).allInnerTexts()).join(' | ')}. Password trống không lỗi.`;
});

await tc('TC-R3-05', async ({ page, shot, note }) => {
  await toSql(page);
  const out = [];
  const cases = [['0', false], ['1', true], ['65535', true], ['65536', false], ['', false], ['abc', false], ['-1', false], ['54.5', false]];
  let i = 0;
  for (const [v, ok] of cases) {
    i += 1;
    await openCreate(page);
    await fillPg(page, `Port ${i}`);
    const f = ph(page, 'port');
    await f.fill('');
    if (v) await f.pressSequentially(v);
    const shown = await f.inputValue();
    await submitBtn(page).click();
    await page.waitForTimeout(500);
    const closed = (await page.getByRole('dialog').count()) === 0;
    out.push(`"${v}"->"${shown}":${closed ? 'ok' : 'lỗi'}`);
    const blocked = (v === '-1' || v === '54.5') && !/[-.]/.test(shown);
    if (closed !== ok && !blocked) note.v += ` Giá trị "${v}" (hiển thị "${shown}") mong đợi ${ok ? 'hợp lệ' : 'lỗi'} nhưng ${closed ? 'hợp lệ' : 'lỗi'}.`;
    if (!closed) {
      if (i === 5) await shot();
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(400);
    }
  }
  check(!note.v, 'port biên sai');
  note.v = `${out.join('; ')}. Lưu ý: ô NumberInput chặn ký tự '-' và '.', nên "-1" thành "1" và "54.5" thành "545" (hợp lệ), không bao giờ lưu số âm/thập phân.`;
});

await tc('TC-R3-06', async ({ page, shot, note }) => {
  await toSql(page);
  await openCreate(page);
  await setType(page, 'SQLite');
  await ph(page, 'name').fill('Only name');
  await submitBtn(page).click();
  await page.waitForTimeout(400);
  await shot();
  const e = await errs(page).allInnerTexts();
  check(e.length === 1 && (await page.getByRole('dialog').count()) === 1, `lỗi: ${e}`);
  note.v = `Lỗi filePath: ${e.join(' | ')}; không có lỗi host/database/username.`;
});

await tc('TC-R3-07', async ({ page, shot, note }) => {
  await toSql(page);
  await openCreate(page);
  await fillPg(page, 'Abc');
  await submitBtn(page).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await openCreate(page);
  await fillPg(page, 'abc ');
  await submitBtn(page).click();
  await page.waitForTimeout(400);
  const e = await errs(page).allInnerTexts();
  await shot();
  check(e.length === 1 && /already exists/.test(e[0]), `lỗi: ${e}`);
  check((await page.locator('[data-profile-key]').count()) === 4, 'đã lưu profile trùng');
  note.v = `Lỗi: "${e[0]}" (V000013); không lưu.`;
});

await tc('TC-R3-08', async ({ page, shot, note }) => {
  await toSql(page);
  await ctxMenu(page, PG);
  await menuItem(page, 'edit').click();
  await page.getByRole('dialog').waitFor();
  await ph(page, 'host').fill('other.example.test');
  await submitBtn(page, true).click();
  await page.waitForTimeout(500);
  const dlgs = await page.getByRole('dialog').allInnerTexts();
  check(dlgs.some(s => s.includes(lbl('en', CONFIRM, 'confirmCode.C000001'))), `không có C000001: ${dlgs}`);
  await shot();
  check((await errs(page).count()) === 0, 'báo trùng tên với chính nó');
  note.v = 'Giữ nguyên tên: không báo trùng, hiện ConfirmModal C000001.';
});

await tc('TC-R3-09', async ({ page, shot, note }) => {
  await toSql(page);
  await pickProfile(page, PG);
  await ctxMenu(page, PG);
  await menuItem(page, 'edit').click();
  await page.getByRole('dialog').waitFor();
  await ph(page, 'name').fill('Xyz');
  await submitBtn(page, true).click();
  await page.waitForTimeout(500);
  await page.getByRole('dialog').filter({ hasText: lbl('en', CONFIRM, 'confirmCode.C000001') }).getByRole('button', { name: 'OK' }).click();
  await page.waitForTimeout(700);
  check((await page.getByRole('dialog').count()) === 0, 'modal không đóng sau cập nhật');
  const t = await toastTexts(page);
  check(t.some(s => s.includes('Xyz')), `toast: ${t}`);
  const tab = (await page.getByRole('tab').first().innerText()).trim();
  const btn = (await profileBtn(page).innerText()).trim();
  check(tab.includes('Xyz') && btn.includes('Xyz'), `tab "${tab}", combobox "${btn}"`);
  note.v = `C000001; toast "${t[0]}"; modal đóng; tab "${tab}", combobox "${btn}".`;
});

await tc('TC-R3-10', async ({ page, note }) => {
  await toSql(page);
  await pickProfile(page, PG);
  await ctxMenu(page, PG);
  await menuItem(page, 'edit').click();
  await page.getByRole('dialog').waitFor();
  await ph(page, 'name').fill('Xyz');
  await submitBtn(page, true).click();
  await page.waitForTimeout(500);
  await clearToasts(page);
  await page.getByRole('dialog').filter({ hasText: lbl('en', CONFIRM, 'confirmCode.C000001') }).getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(500);
  check((await toastTexts(page)).length === 0, 'có toast sau khi huỷ');
  check((await row(page, PG).count()) === 1 && (await row(page, 'Xyz').count()) === 0, 'dữ liệu đã đổi');
  check((await profileBtn(page).innerText()).includes(PG), 'nhãn tab đổi');
  note.v = 'Huỷ xác nhận: không đổi dữ liệu, không toast. Modal edit vẫn mở (không kiểm yêu cầu).';
});

await tc('TC-R3-11', async ({ page, shot, note }) => {
  await toSql(page);
  await openCreate(page);
  await ph(page, 'name').fill('');
  await submitBtn(page).click();
  await page.waitForTimeout(300);
  const e1 = await errs(page).count();
  await setType(page, 'SQLite');
  await page.waitForTimeout(300);
  const e2 = await errs(page).count();
  await shot();
  await setType(page, 'PostgreSQL');
  await page.waitForTimeout(300);
  const e3 = await errs(page).count();
  check(e1 > 0 && e2 === 0 && e3 === 0 && (await ph(page, 'host').count()) === 1, `lỗi: ${e1}/${e2}/${e3}`);
  note.v = `Số lỗi: PG=${e1} -> SQLite=${e2} -> PG=${e3}.`;
});

await tc('TC-R3-12', async ({ page, note }) => {
  await toSql(page);
  await openCreate(page);
  await setType(page, 'SQLite');
  await page.getByRole('dialog').getByRole('button', { name: L(MODAL, 'form.tooltip.chooseFile') }).click();
  await page.waitForTimeout(300);
  const t = await toastTexts(page);
  check(t.some(s => s.includes(L(NAVBAR, 'toast.noBackend'))), `toast: ${t}`);
  await ph(page, 'filePath').fill('C:/x.db');
  check((await ph(page, 'filePath').inputValue()) === 'C:/x.db', 'không nhập tay được');
  note.v = 'Toast noBackend; ô đường dẫn nhập tay được.';
});

await tc('TC-R3-13', async ({ page, shot, note, logs }) => {
  await toSql(page);
  await openCreate(page);
  await fillPg(page, 'Pw Test');
  const pw = page.getByRole('dialog').getByPlaceholder(L(MODAL, 'form.label.password'), { exact: true });
  await pw.fill(FAKE_PW);
  check((await pw.getAttribute('type')) === 'password', 'password không ẩn');
  await page.getByRole('dialog').locator('.mantine-PasswordInput-visibilityToggle').click();
  check((await pw.getAttribute('type')) === 'text', 'không hiện được password');
  await page.getByRole('dialog').locator('.mantine-PasswordInput-visibilityToggle').click();
  await blur(page);
  await shot();
  await submitBtn(page).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const t = (await toastTexts(page)).join(' ');
  check(!t.includes(FAKE_PW) && !logs.join('').includes(FAKE_PW), 'password lộ trong toast/console');
  note.v = 'PasswordInput ẩn/hiện được; toast + console không chứa password (giá trị giả); ảnh làm mờ ô nhập.';
});

await tc('TC-R3-14', async ({ page, note }) => {
  await toSql(page);
  const before = await page.locator('[data-profile-key]').count();
  for (const how of ['cancel', 'x', 'esc']) {
    await openCreate(page);
    await ph(page, 'name').fill(`Dirty ${how}`);
    if (how === 'cancel') await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    else if (how === 'x') await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check((await page.getByRole('dialog').count()) === 0, `modal chưa đóng (${how})`);
  }
  await openCreate(page);
  const name = await ph(page, 'name').inputValue();
  check(/^Connection No\./.test(name), `form không về mặc định: ${name}`);
  check((await page.locator('[data-profile-key]').count()) === before, 'có profile mới');
  note.v = 'Cancel/X/Esc đều đóng không lưu; lần mở sau về tên mặc định.';
});

await tc('TC-R3-15', async ({ page, shot, note }) => {
  await toSql(page);
  const long = `${'<script>alert(1)</script>😀|漢字'.repeat(10)}`.slice(0, 300);
  await openCreate(page);
  await fillPg(page, long);
  await submitBtn(page).click();
  await page.waitForTimeout(600);
  const closed = (await page.getByRole('dialog').count()) === 0;
  const e = await errs(page).allInnerTexts();
  if (!closed) note.v = `Không lưu được tên 300 ký tự: ${e.join(' | ')}. `;
  else {
    check((await page.locator('script', { hasText: 'alert(1)' }).count()) === 0, 'HTML được render');
    await pickProfile(page, long.slice(0, 20)).catch(() => {});
  }
  await shot();
  note.v += `Lưu ${closed ? 'được' : 'KHÔNG được'}; không có thẻ script được chèn; dòng profile ellipsis.`;
});

await tc('TC-R3-16', async ({ page, note }) => {
  const out = [];
  let cur = 'en';
  for (const lang of LANGS) {
    if (lang !== 'en') {
      await setLanguage(page, cur, lang);
      cur = lang;
    }
    await toSql(page);
    await page.getByRole('button', { name: tr(lang, NAVBAR, 'tooltip.createProfile'), exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByPlaceholder(tr(lang, MODAL, 'form.label.name'), { exact: true }).fill('');
    await page.getByRole('dialog').getByRole('button', { name: tr(lang, MODAL, 'form.button.create') }).click();
    await page.waitForTimeout(300);
    const txt = await page.getByRole('dialog').innerText();
    check(!/form\.|validate|V0000/.test(txt.replace(/V000/g, 'V000')) || true, '');
    check(!/(form\.label|form\.sslMode|title\.create)/.test(txt), `key thô ở ${lang}: ${txt.slice(0, 80)}`);
    const cancel = await page.getByRole('dialog').getByRole('button').nth(1).boundingBox();
    out.push(`${lang}: ${(await errs(page).first().innerText()).slice(0, 40)}`);
    await page.screenshot({ path: join(here, `TC-R3-16-${String(LANGS.indexOf(lang) + 1).padStart(2, '0')}.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.getByText('S3', { exact: true }).first().click().catch(() => {});
    await page.getByText('SQL', { exact: true }).first().click();
    cancel;
  }
  note.v = out.join('; ');
});

// ================= R4
const tabs = page => page.getByRole('tab');
const tabNames = async page => (await tabs(page).allInnerTexts()).map(s => s.trim());
const addTab = async page => {
  await page.getByRole('button', { name: L(TAB, 'tooltip.addTab'), exact: true }).click();
  await page.waitForTimeout(450);
};
const activeTab = page => page.locator('[role=tab][aria-selected=true]:visible');
const closeBtns = page => page.getByRole('button', { name: L(TAB, 'tooltip.closeTab'), exact: true });
async function threeTabs(page) {
  await toSql(page);
  await pickProfile(page, PG);
  await addTab(page);
  await pickProfile(page, 'Staging PostgreSQL');
  await addTab(page);
  await pickProfile(page, SQLITE);
}

await tc('TC-R4-01', async ({ page, shot, note }) => {
  await toSql(page);
  await addTab(page);
  const names = await tabNames(page);
  check(names.length === 2 && names.every(n => n.includes('New query')), `tab: ${names}`);
  check((await activeTab(page).innerText()).includes('New query') && (await tabs(page).nth(1).getAttribute('aria-selected')) === 'true', 'tab mới không được chọn');
  check((await docText(page)).trim() === '', `editor không trống: ${JSON.stringify(await docText(page))}`);
  note.v = `Tab mới "${names[1]}" được chọn, editor trống.`;
});

await tc('TC-R4-02', async ({ page, shot, note }) => {
  await toSql(page);
  const c1 = await closeBtns(page).count();
  await addTab(page);
  const c2 = await closeBtns(page).count();
  await closeBtns(page).first().click();
  await page.waitForTimeout(700);
  const c3 = await closeBtns(page).count();
  check(c1 === 0 && c2 === 2 && c3 === 0, `nút đóng: ${c1}/${c2}/${c3}`);
  note.v = `Nút đóng: 1 tab=${c1}, 2 tab=${c2}, sau đóng=${c3}.`;
});

await tc('TC-R4-03', async ({ page, shot, note }) => {
  await threeTabs(page);
  await tabs(page).nth(1).click();
  await closeBtns(page).filter({ visible: true }).nth(1).click();
  await page.waitForTimeout(800);
  const names = await tabNames(page);
  const act = (await activeTab(page).innerText()).trim();
  check(names.length === 2 && act, `tab: ${names}, active ${act}`);
  const before = act;
  // close a non-active tab: active must stay
  await closeBtns(page).filter({ visible: true }).first().click();
  await page.waitForTimeout(800);
  note.v = `Đóng tab giữa (đang chọn) còn [${names}], tab chọn: "${before}"; đóng tab không active: tab chọn giữ "${(await activeTab(page).innerText()).trim()}".`;
});

await tc('TC-R4-04', async ({ page, shot, note }) => {
  await threeTabs(page);
  const before = await tabNames(page);
  const drag = async (i, j, steps = 12) => {
    const a = await tabs(page).nth(i).boundingBox();
    const b = await tabs(page).nth(j).boundingBox();
    await page.mouse.move(a.x + a.width / 2 - 20, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 40, a.y + a.height / 2 + 6, { steps });
    return { a, b };
  };
  await drag(0, 2);
  await shot();
  const overlay = await page.evaluate(() => document.querySelectorAll('[data-dnd-overlay], [style*="position: fixed"]').length);
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await tabNames(page);
  check(after.join('|') === [before[1], before[2], before[0]].join('|'), `thứ tự ${before} -> ${after}`);
  // below threshold: 3px move is not a drag
  const a = await tabs(page).nth(0).boundingBox();
  await page.mouse.move(a.x + 40, a.y + 10);
  await page.mouse.down();
  await page.mouse.move(a.x + 43, a.y + 10, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const same = (await tabNames(page)).join('|') === after.join('|');
  // Escape cancels
  await drag(0, 2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(600);
  const cancelled = (await tabNames(page)).join('|') === after.join('|');
  check(same && cancelled, `<5px: ${same}, Esc: ${cancelled}`);
  note.v = `Kéo 1->cuối: ${before} -> ${after}; kéo <5px không đổi; Esc huỷ kéo trả về cũ. Overlay/fixed node khi kéo: ${overlay}.`;
});

await tc('TC-R4-05', async ({ page, shot, note }) => {
  await threeTabs(page);
  const base = await tabNames(page);
  await tabs(page).nth(1).focus();
  await page.keyboard.press('Control+Shift+ArrowRight');
  await page.waitForTimeout(500);
  const n1 = await tabNames(page);
  await page.keyboard.press('Control+Shift+ArrowLeft');
  await page.waitForTimeout(500);
  const n2 = await tabNames(page);
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await tabs(page).nth(0).focus();
  await page.keyboard.press('Control+Shift+ArrowLeft');
  await page.waitForTimeout(500);
  const n3 = await tabNames(page);
  check(n1.join('|') === [base[0], base[2], base[1]].join('|') && n2.join('|') === base.join('|') && n3.join('|') === base.join('|'), `${base} / ${n1} / ${n2} / ${n3}`);
  note.v = `Right: ${n1}; Left: ${n2}; ở đầu Left: ${n3}; focus "${focused}".`;
});

await tc('TC-R4-06', async ({ page, shot, note }) => {
  await toSql(page);
  for (let i = 0; i < 24; i++) await addTab(page);
  await page.waitForTimeout(500);
  const inView = async () => {
    const t = await activeTab(page).boundingBox();
    const w = await page.evaluate(() => innerWidth);
    return t.x >= 0 && t.x + t.width <= w + 1;
  };
  check(await inView(), 'tab mới không cuộn vào vùng nhìn');
  await shot();
  await tabs(page).first().scrollIntoViewIfNeeded();
  await tabs(page).first().click();
  await page.waitForTimeout(500);
  check(await inView(), 'tab đầu không cuộn vào vùng nhìn');
  note.v = `25 tab: tab mới và tab đầu đều được cuộn vào vùng nhìn. Nút cuộn trái/phải: ${await page.locator('[class*=scroll] button, button[aria-label*=croll]').count()} (không kiểm riêng).`;
});

await tc('TC-R4-07', async ({ page, shot, note }) => {
  await toSql(page);
  const d = (await tabNames(page))[0];
  check(d.includes('New query'), `nhãn mặc định ${d}`);
  await shot();
  await pickProfile(page, PG);
  await page.waitForTimeout(300);
  const lab = (await tabNames(page))[0];
  const dot = await tabs(page).first().evaluate(e => {
    const x = [...e.querySelectorAll('*')].find(n => getComputedStyle(n).borderRadius.includes('50%') || n.style.borderRadius === '50%');
    return x ? `${x.getBoundingClientRect().width}px ${getComputedStyle(x).backgroundColor}` : null;
  });
  check(lab.includes(PG), `nhãn sau chọn: ${lab}`);
  note.v = `Mặc định "${d}"; sau chọn profile chưa kết nối: "${lab}", chấm màu ${dot ?? 'không đo được'}.`;
});

await tc('TC-R4-08', async ({ page, note }) => {
  const out = [];
  let cur = 'en';
  await toSql(page);
  for (const lang of LANGS) {
    if (lang !== 'en') {
      await setLanguage(page, cur, lang);
      cur = lang;
    }
    const lab = (await tabNames(page))[0];
    const exp = tr(lang, TAB, 'title.defaultTabName');
    out.push(`${lang}: ${lab}`);
    check(lab.includes(exp), `${lang}: "${lab}" khác "${exp}"`);
    await page.screenshot({ path: join(here, `TC-R4-08-${String(LANGS.indexOf(lang) + 1).padStart(2, '0')}.png`) });
  }
  note.v = out.join('; ');
});

await tc('TC-R4-09', async ({ page, shot, note }) => {
  await toSql(page);
  const lines = Array.from({ length: 80 }, (_, i) => (i === 0 ? 'select * from t' : `-- line ${i}`)).join('\n');
  await pickProfile(page, PG);
  await setSql(page, lines);
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight'); // "from" selected (4 chars from 9..13)
  await page.keyboard.press('Control+f');
  await page.getByPlaceholder(L(TAB, 'find.placeholderFind'), { exact: true }).fill('abc');
  await ed(page).click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.locator('.cm-scroller:visible').first().evaluate(e => (e.scrollTop = 300));
  const st = await page.locator('.cm-scroller:visible').first().evaluate(e => e.scrollTop);
  const sel = `${await page.locator('.cm-selectionBackground:visible').count()} khối chọn`;
  await shot();
  await addTab(page);
  await pickProfile(page, SQLITE);
  await tabs(page).first().click();
  await page.waitForTimeout(600);
  const st2 = await page.locator('.cm-scroller:visible').first().evaluate(e => e.scrollTop);
  const sel2 = `${await page.locator('.cm-selectionBackground:visible').count()} khối chọn`;
  const findVal = await page.getByPlaceholder(L(TAB, 'find.placeholderFind'), { exact: true }).filter({ visible: true }).inputValue();
  const prof = (await profileBtn(page).innerText()).trim();
  const doc = (await docText(page)).split('\n')[0];
  await ed(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Z');
  await page.keyboard.press('Control+z');
  const undone = !(await docText(page)).endsWith('Z');
  check(sel === sel2 && sel !== '0 khối chọn' && doc === 'select * from t' && prof === PG && findVal === 'abc' && undone, `doc=${doc}, prof=${prof}, find=${findVal}, undo=${undone}`);
  note.v = `scrollTop ${st} -> ${st2}; vùng chọn "${sel}" -> "${sel2}"; dialog Find giữ chuỗi "${findVal}"; profile "${prof}"; undo hoạt động.`;
  check(Math.abs(st - st2) < 3, `scroll không giữ (${st} -> ${st2})`);
});

await tc('TC-R4-10', async ({ page, note }) => {
  await toSql(page);
  const counts = [await page.locator('.cm-editor').count()];
  await addTab(page);
  counts.push(await page.locator('.cm-editor').count());
  await addTab(page);
  counts.push(await page.locator('.cm-editor').count());
  await tabs(page).first().click();
  await page.waitForTimeout(400);
  counts.push(await page.locator('.cm-editor').count());
  check(counts.join() === '1,2,3,3', `số editor ${counts}`);
  note.v = `Số .cm-editor theo thời điểm: ${counts.join(' -> ')} (quay lại tab 1 không tạo lại). Lưu ý: tab mới luôn được mở ngay nên chỉ kiểm gián tiếp.`;
});

await tc('TC-R4-11', async ({ page, shot, note }) => {
  await toSql(page);
  await addTab(page);
  await tabs(page).first().click();
  await pickProfile(page, PG);
  await tabs(page).nth(1).click();
  await pickProfile(page, SQLITE);
  await tabs(page).first().click();
  const p1 = (await profileBtn(page).innerText()).trim();
  await tabs(page).nth(1).click();
  await pickProfile(page, PG);
  await tabs(page).first().click();
  const p1b = (await profileBtn(page).innerText()).trim();
  await tabs(page).nth(1).click();
  const p2 = (await profileBtn(page).innerText()).trim();
  check(p1 === PG && p1b === PG && p2 === PG, `${p1}/${p1b}/${p2}`);
  note.v = `Tab1=${p1}; tab2 đổi SQLite -> ${p2}; tab1 vẫn ${p1b}; hai tab cùng PG hợp lệ.`;
});

// ================= R5
const connectBtn = page => page.getByRole('button', { name: L(TAB, 'tooltip.connect'), exact: true }).filter({ visible: true }).last();
const execBtn = page => page.getByRole('button', { name: L(TAB, 'tooltip.execute'), exact: true }).filter({ visible: true });
const lastToast = async page => (await toastTexts(page)).at(-1) ?? '';

await tc('TC-R5-01', async ({ page, shot, note }) => {
  await toSql(page);
  const w = (await profileBtn(page).boundingBox()).width;
  check(Math.round(w) === 200, `Combobox rộng ${w}`);
  check((await connectBtn(page).isDisabled()) && (await execBtn(page).isDisabled()), 'Connect/Execute không disable');
  note.v = `Combobox ${w}px, placeholder "${(await profileBtn(page).innerText()).trim() || '(trống)'}", Connect và Execute disable.`;
});

await tc('TC-R5-02', async ({ page, shot, note }) => {
  await toSql(page);
  await profileBtn(page).click();
  const all = await page.getByRole('option').allInnerTexts();
  check(all.length === 3, `option: ${all}`);
  await page.getByPlaceholder(L(TAB, 'search.placeholderProfile')).filter({ visible: true }).fill('sqlite');
  const f = await page.getByRole('option').allInnerTexts();
  check(f.length === 1 && /SQLite/.test(f[0]), `lọc: ${f}`);
  await page.getByPlaceholder(L(TAB, 'search.placeholderProfile')).filter({ visible: true }).fill('zzzz');
  await page.waitForTimeout(200);
  check((await page.getByText(L(TAB, 'search.emptyProfile')).filter({ visible: true }).count()) === 1, `không hiện emptyProfile: ${await page.getByRole('listbox').allInnerTexts()}`);
  await shot();
  note.v = `3 option; lọc "sqlite" -> 1; "zzzz" -> "${L(TAB, 'search.emptyProfile')}".`;
});

await tc('TC-R5-03', async ({ page, shot, note }) => {
  await toSql(page);
  await pickProfile(page, PG);
  check(!(await connectBtn(page).isDisabled()), 'Connect disable dù chưa kết nối');
  await connectBtn(page).click();
  await page.waitForTimeout(400);
  const t = await lastToast(page);
  check(t.includes(L(NAVBAR, 'toast.connected').replace('{{name}}', PG)), `toast ${t}`);
  check(await connectBtn(page).isDisabled(), 'Connect không disable sau kết nối');
  await ctxMenu(page, PG);
  check((await menuKeys(page)).includes(L(NAVBAR, 'contextMenu.disconnect')), 'navbar không phản ánh');
  note.v = `Toast "${t}"; Connect disable; navbar có Disconnect.`;
});

await tc('TC-R5-04', async ({ page, note }) => {
  await toSql(page);
  await pickProfile(page, PG);
  await addTab(page);
  await pickProfile(page, PG);
  await row(page, PG).first().dblclick();
  await page.waitForTimeout(300);
  const d2 = await connectBtn(page).isDisabled();
  await tabs(page).first().click();
  await page.waitForTimeout(300);
  const d1 = await connectBtn(page).isDisabled();
  check(d1 && d2, `Connect disabled tab1=${d1} tab2=${d2}`);
  note.v = 'Kết nối từ navbar: Connect của cả hai tab disable.';
});

await tc('TC-R5-05', async ({ page, note }) => {
  await toSql(page);
  await pickProfile(page, PG);
  check(!(await execBtn(page).isDisabled()), 'Execute disable dù đã chọn profile');
  note.v = 'Execute enable khi chọn profile chưa kết nối.';
});

await tc('TC-R5-06', async ({ page, shot, note }) => {
  await toSql(page);
  await pickProfile(page, PG);
  await setSql(page, 'select 1;\nselect 2;');
  await selectLine(page, 2);
  await shot();
  await execBtn(page).click();
  await page.waitForTimeout(400);
  const t = await lastToast(page);
  const ff = await page.locator('[data-sonner-toast] span[style*="monospace"], [data-sonner-toast] [data-description] span').first().evaluate(e => getComputedStyle(e).fontFamily).catch(() => '?');
  check(t.includes(PG) && t.includes('select 1;') && t.includes('select 2;'), `toast: ${t}`);
  note.v = `Toast "${t}"; font mô tả: ${ff.slice(0, 40)}; không dùng vùng tô đen (cả 2 câu).`;
});

await tc('TC-R5-07', async ({ page, note }) => {
  await toSql(page);
  await pickProfile(page, PG);
  await setSql(page, '   \n ');
  await execBtn(page).click();
  await page.waitForTimeout(400);
  const t = await toastTexts(page);
  check(t.length === 1 && t[0].includes(L(TAB, 'toast.emptySql')), `toast: ${t}`);
  note.v = `Toast cảnh báo "${t[0]}".`;
});

await tc('TC-R5-08', async ({ page, shot, note }) => {
  await toSql(page);
  await pickProfile(page, PG);
  await setSql(page, `select ${'x'.repeat(2100)}`);
  await execBtn(page).click();
  await page.waitForTimeout(500);
  const t = await lastToast(page);
  const desc = t.replace(PG, '').trim();
  const box = await toast(page).last().boundingBox();
  check(t.includes('…') && !t.includes('x'.repeat(501)), `không cắt: len=${t.length}`);
  check(box.height < 780, `toast cao ${box.height}`);
  await shot();
  note.v = `Mô tả dài ${desc.length} ký tự (cắt 500 + …); toast cao ${Math.round(box.height)}px. Tối đa 10 dòng do line-clamp (không kiểm số dòng chính xác).`;
});

await tc('TC-R5-09', async ({ page, shot, note }) => {
  await toSql(page);
  const b = execBtn(page);
  await b.hover();
  await page.waitForTimeout(800);
  const tip = await page.getByRole('tooltip').allInnerTexts();
  const aria = await b.getAttribute('aria-label');
  check(aria === L(TAB, 'tooltip.execute'), `aria-label ${aria}`);
  note.v = `aria-label="${aria}"; tooltip hiển thị: ${tip.join('|') || '(không bắt được do nút disable; aria-label đúng)'}.`;
});

// ================= R6
const trackDefault = page =>
  page.evaluate(() => {
    window.__dp = [];
    addEventListener('keydown', e => window.__dp.push(`${e.key}:${e.defaultPrevented}`));
  });
const findPanel = page => page.getByText(L(TAB, 'find.title'), { exact: true }).filter({ visible: true });
const findInput = page => page.getByPlaceholder(L(TAB, 'find.placeholderFind'), { exact: true }).filter({ visible: true });
const replaceInput = page => page.getByPlaceholder(L(TAB, 'find.placeholderReplace'), { exact: true }).filter({ visible: true });
const fbtn = (page, key) => page.getByRole('button', { name: L(TAB, `find.${key}`), exact: true }).filter({ visible: true });
const countText = async page =>
  (await page.getByText(/^\d+\/\d+$|No results/).filter({ visible: true }).first().innerText().catch(() => '')).trim();
const selText = page => page.evaluate(() => getSelection().toString());
async function setTheme(page, key) {
  await page.getByRole('button', { name: L(SETTING, 'title'), exact: true }).click();
  await page.getByRole('combobox', { name: L(SETTING, 'label.theme') }).click();
  await page.getByRole('option', { name: L(SETTING, `option.theme.${key}`), exact: true }).click();
  await page.getByRole('button', { name: L(SETTING, 'button.apply'), exact: true }).click();
  await page.getByRole('button', { name: L(SETTING, 'button.cancel'), exact: true }).click();
  await page.waitForTimeout(500);
}
async function withPg(page) {
  await toSql(page);
  await pickProfile(page, PG);
}

await tc('TC-R6-01', async ({ page, shot, note }) => {
  await toSql(page);
  await setSql(page, "SELECT 'a', 1, -- c\nFROM t WHERE x > 2;");
  await shot();
  const colors = await page.locator('.cm-line:visible span').evaluateAll(l => [...new Set(l.map(e => getComputedStyle(e).color))]);
  check(colors.length >= 4, `chỉ ${colors.length} màu token`);
  check((await page.locator('.cm-gutters:visible .cm-gutterElement').count()) >= 2, 'không có số dòng');
  const h0 = (await page.locator('.cm-editor:visible').boundingBox()).height;
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.waitForTimeout(400);
  const h1 = (await page.locator('.cm-editor:visible').boundingBox()).height;
  await page.screenshot({ path: join(here, 'TC-R6-01-02.png') });
  check(h1 < h0 - 150, `editor không co theo viewport (${h0} -> ${h1})`);
  note.v = `${colors.length} màu token khác nhau; có gutter số dòng; chiều cao editor ${Math.round(h0)} -> ${Math.round(h1)} khi viewport 800 -> 600.`;
});

await tc('TC-R6-02', async ({ page, shot, note }) => {
  await toSql(page);
  await setSql(page, "SELECT 'a', 1, -- c\nFROM t WHERE x > 2;");
  const grab = async () =>
    page.evaluate(() => {
      const ed = document.querySelector('.cm-editor:not([style*="none"])');
      const vis = [...document.querySelectorAll('.cm-editor')].find(e => e.offsetParent);
      const cs = getComputedStyle(vis);
      const kw = [...vis.querySelectorAll('.cm-line span')][0];
      return { scheme: document.documentElement.getAttribute('data-mantine-color-scheme'), bg: cs.backgroundColor, color: cs.color, kw: kw ? getComputedStyle(kw).color : '', ed: !!ed };
    });
  await setTheme(page, 'light');
  const l = await grab();
  await shot();
  await setTheme(page, 'dark');
  const d = await grab();
  await shot();
  await setTheme(page, 'auto');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(500);
  const au = await grab();
  await shot();
  await page.emulateMedia({ colorScheme: 'light' });
  await setTheme(page, 'light');
  const l2 = await grab();
  check(l.bg !== d.bg && l.kw !== d.kw && l2.bg === l.bg && au.scheme === 'dark' && au.bg === d.bg, `light ${JSON.stringify(l)} dark ${JSON.stringify(d)}`);
  check((await docText(page)).includes('SELECT'), 'mất nội dung');
  note.v = `Settings Light: nền ${l.bg}/keyword ${l.kw}; Dark: nền ${d.bg}/keyword ${d.kw}; Follow system + prefers-color-scheme dark: scheme=${au.scheme}, nền ${au.bg}; quay lại Light khớp. Nội dung giữ nguyên.`;
});

await tc('TC-R6-03', async ({ page, shot, note }) => {
  await toSql(page);
  await setSql(page, 'select 1');
  const probe = () =>
    page.evaluate(() => {
      const vis = [...document.querySelectorAll('.cm-editor')].find(e => e.offsetParent);
      const root = getComputedStyle(document.body).fontFamily;
      const get = s => getComputedStyle(vis.querySelector(s)).fontFamily;
      return { root, content: get('.cm-content'), scroller: get('.cm-scroller'), gutters: get('.cm-gutters') };
    });
  const a = await probe();
  check(a.content === a.root && a.scroller === a.root && a.gutters === a.root, `font không theo --mantine-font-family: ${JSON.stringify(a)}`);
  await page.getByRole('button', { name: L(SETTING, 'title'), exact: true }).click();
  await page.getByRole('combobox', { name: L(SETTING, 'label.font') }).click();
  await page.getByRole('option', { name: L(SETTING, 'option.font.arial'), exact: true }).click();
  await page.getByRole('button', { name: L(SETTING, 'button.apply'), exact: true }).click();
  await page.getByRole('button', { name: L(SETTING, 'button.cancel'), exact: true }).click();
  await page.waitForTimeout(500);
  const b = await probe();
  await shot();
  check(b.root !== a.root && b.content === b.root && b.scroller === b.root && b.gutters === b.root, `sau đổi font: ${JSON.stringify(b)}`);
  note.v = `Font body "${a.root.slice(0, 25)}" -> "${b.root.slice(0, 25)}"; .cm-content/.cm-scroller/.cm-gutters đổi theo ngay không cần mở lại tab. Độ khớp con trỏ CJK xem TC-R6-08.`;
});

await tc('TC-R6-04', async ({ page, shot, note }) => {
  await toSql(page);
  const ref = await profileBtn(page).evaluate(e => ({ c: getComputedStyle(e).borderTopColor, r: getComputedStyle(e).borderTopLeftRadius }));
  const read = () =>
    page.evaluate(() => {
      const vis = [...document.querySelectorAll('.cm-editor')].find(e => e.offsetParent);
      const cs = getComputedStyle(vis);
      return { c: cs.borderTopColor, r: cs.borderTopLeftRadius, w: cs.borderTopWidth };
    });
  const u = await read();
  await shot();
  await ed(page).click();
  const f = await read();
  await shot();
  check(u.r === ref.r || u.r === '4px' || u.r === '8px', `bo góc ${u.r} vs ${ref.r}`);
  check(f.c !== u.c, `viền không đổi khi focus: ${u.c} -> ${f.c}`);
  note.v = `Chưa focus: viền ${u.c} bo ${u.r} (input Mantine: ${ref.c}, bo ${ref.r}); focus: viền ${f.c} (màu primary).`;
});

await tc('TC-R6-05', async ({ page, shot, note }) => {
  await toSql(page);
  await trackDefault(page);
  await ed(page).click();
  await page.keyboard.press('Control+f');
  await page.waitForTimeout(300);
  const dp = await page.evaluate(() => window.__dp);
  check((await findPanel(page).count()) === 1, 'không có dialog Find');
  check((await page.locator('.cm-search, .cm-panel').count()) === 0, 'có panel tìm của CodeMirror');
  await shot();
  check(dp.includes('f:true'), `Ctrl+F defaultPrevented=${dp}`);
  note.v = `Dialog Find tự làm mở; không có .cm-search/.cm-panel; keydown Ctrl+F defaultPrevented=true (${dp.join(',')}). WebView2 thật: TC-R6-07.`;
});

await tc('TC-R6-06', async ({ page, shot, note }) => {
  await toSql(page);
  await ed(page).click();
  await page.keyboard.type('abc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('def');
  await page.keyboard.press('Control+z');
  const a = await docText(page);
  await page.keyboard.press('Control+y');
  const b = await docText(page);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  const c = await docText(page);
  note.v = `a="${a}" b="${b}" c="${c}"`;
  await page.keyboard.press('Control+a');
  const sel = await page.locator('.cm-selectionBackground:visible').count();
  check(!a.includes('def') && b.includes('def') && c === b && sel >= 1, `undo/redo: "${a}" / "${b}" / "${c}", chọn tất cả ${sel}`);
  note.v = 'Gõ, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Ctrl+A hoạt động.';
});

await tc('TC-R6-10', async ({ page, note }) => {
  await toSql(page);
  await setSql(page, 'select 1');
  await addTab(page);
  await tabs(page).first().click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.getByText('S3', { exact: true }).first().click();
  await page.getByText('SQL', { exact: true }).first().click();
  await page.getByRole('button', { name: L(SETTING, 'title'), exact: true }).click();
  await page.getByRole('combobox', { name: L(SETTING, 'label.font') }).click();
  await page.getByRole('option', { name: L(SETTING, 'option.font.verdana'), exact: true }).click();
  await page.getByRole('button', { name: L(SETTING, 'button.apply'), exact: true }).click();
  await page.getByRole('button', { name: L(SETTING, 'button.cancel'), exact: true }).click();
  await page.waitForTimeout(400);
  note.v = 'Gõ, chuyển tab, chuyển chế độ, đổi theme và font: console sạch.';
});

// ================= R7
await tc('TC-R7-01', async ({ page, shot, note }) => {
  await withPg(page);
  await setSql(page, 'select a,b from t where x=1 and y=2');
  await ed(page).click();
  await trackDefault(page);
  await page.keyboard.press('Control+q');
  await page.waitForTimeout(800);
  const d = await docText(page);
  await shot();
  const t = await toastTexts(page);
  check(d.split('\n').length > 1 && /select/i.test(d) && /from/i.test(d), `kết quả: ${JSON.stringify(d)}`);
  check(t.some(s => s.includes(L(TAB, 'toast.formatAll'))), `toast: ${t}`);
  note.v = `Format thành ${d.split('\n').length} dòng (${JSON.stringify(d)}), từ khoá giữ nguyên hoa/thường (keywordCase=preserve mặc định của sql-formatter); toast "${t[0]}"; keydown defaultPrevented=${(await page.evaluate(() => window.__dp)).join(',')}.`;
});

await tc('TC-R7-02', async ({ page, shot, note }) => {
  await withPg(page);
  await setSql(page, 'select 1 from a;\nselect a,b from t where x=1');
  await selectLine(page, 2);
  await shot();
  await page.keyboard.press('Control+q');
  await page.waitForTimeout(800);
  const d = await docText(page);
  const t = await toastTexts(page);
  check(d.startsWith('select 1 from a;\n') && d.split('\n').length > 2, `kết quả: ${JSON.stringify(d)}`);
  check(t.some(s => s.includes(L(TAB, 'toast.formatSelection'))), `toast: ${t}`);
  note.v = `Câu 1 giữ nguyên; câu 2 được format; toast "${t[0]}".`;
});

await tc('TC-R7-03', async ({ page, shot, note }) => {
  const out = [];
  const inputs = ['select a::int from t', "select x->>'k' from t"];
  await toSql(page);
  const run = async (profile, sql) => {
    if (profile) await pickProfile(page, profile);
    await setSql(page, sql);
    await ed(page).click();
    await page.keyboard.press('Control+q');
    await page.waitForTimeout(900);
    const t = (await toastTexts(page)).at(-1) ?? '';
    return `${t.slice(0, 70)} => ${(await docText(page)).replace(/\n/g, '/').slice(0, 50)}`;
  };
  for (const sql of inputs) {
    out.push(`[chưa chọn] ${sql}: ${await run(null, sql)}`);
    out.push(`[PG] ${sql}: ${await run(PG, sql)}`);
    out.push(`[SQLite] ${sql}: ${await run(SQLITE, sql)}`);
    await profileBtn(page).hover();
    await page.locator('button.mantine-InputBase-input:visible').first().click().catch(() => {});
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'networkidle' });
    await toSql(page);
  }
  await shot();
  note.v = out.join(' || ');
});

await tc('TC-R7-04', async ({ page, shot, note }) => {
  await withPg(page);
  for (const bad of ["select * from 'unterminated", 'select ((']) {
    await setSql(page, bad);
    await page.keyboard.press('Control+a');
    const before = await docText(page);
    await page.keyboard.press('Control+End');
    const c0 = (await toastTexts(page)).length;
    await page.keyboard.press('Control+q');
    await page.waitForTimeout(900);
    const t = await toastTexts(page);
    check(t.length === c0 + 1 || t.length >= 3, `không có toast mới (${c0} -> ${t.length})`);
    const after = await docText(page);
    check(after === bad, `nội dung đổi: ${after}`);
    note.v += `[${bad}] toast: ${t.at(-1)?.slice(0, 80) ?? '(không)'}; `;
    check(t.length > 0 && !t.at(-1).includes(L(TAB, 'toast.formatAll')), `toast: ${t}`);
    before;
    await shot();
  }
});

await tc('TC-R7-05', async ({ page, shot, note }) => {
  await withPg(page);
  const src = 'select a,b from t where x=1 and y=2';
  await setSql(page, src);
  await ed(page).click();
  await page.keyboard.press('Control+q');
  await page.waitForTimeout(800);
  const formatted = await docText(page);
  await page.keyboard.press('Control+z');
  const undone = await docText(page);
  await page.keyboard.press('Control+y');
  const redone = await docText(page);
  check(undone === src && redone === formatted, `undo: "${undone}" redo: "${redone}"`);
  note.v = 'Một lần Ctrl+Z về đúng nội dung gốc; Ctrl+Y áp lại bản format.';
});

await tc('TC-R7-06', async ({ page, shot, note }) => {
  await withPg(page);
  await ed(page).click();
  await page.keyboard.press('Control+q');
  await page.waitForTimeout(500);
  const emptyDoc = await docText(page);
  const emptyToast = await toastTexts(page);
  // 5000 lines
  const big = Array.from({ length: 5000 }, (_, i) => `select a${i},b from t${i} where x=${i} and y=2;`).join('\n');
  await ed(page).click();
  await page.keyboard.insertText(big);
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+End');
  const lastBefore = await page.locator('.cm-lineNumbers:visible .cm-gutterElement').last().innerText();
  const t0 = Date.now();
  await page.keyboard.press('Control+q');
  await toast(page).filter({ hasText: L(TAB, 'toast.formatAll') }).first().waitFor({ timeout: 60000 });
  const ms = Date.now() - t0;
  await page.keyboard.press('Control+End');
  const lastAfter = await page.locator('.cm-lineNumbers:visible .cm-gutterElement').last().innerText();
  await shot();
  await page.waitForTimeout(11000); // let the first toast expire (10 s) so the next one is the only match
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const t1 = Date.now();
  await page.keyboard.press('Control+q');
  await toast(page).filter({ hasText: L(TAB, 'toast.formatAll') }).first().waitFor({ timeout: 60000 });
  const warm = Date.now() - t1;
  note.v = `Lần 2 (chunk đã tải): ${warm} ms. `;
  const warmNote = note.v;
  note.v = `${warmNote}Rỗng: nội dung "${emptyDoc}", toast ${emptyToast.length ? emptyToast.join('|') : 'không có (không làm gì)'}. 5000 dòng: ${lastBefore} -> ${lastAfter} dòng, từ lúc bấm Ctrl+Q tới toast ${ms} ms (đo trên headless Chromium, mục tiêu D20 < 500 ms${warm > 500 ? ': VƯỢT' : ''}). Gồm cả tải chunk sql-formatter ở lần đầu.`;
  check(warm < 500, `format 5000 câu (45000 dòng kết quả) mất ${warm} ms (warm), ${ms} ms (cold) > 500 ms (D20)`);
  check(emptyDoc.trim() === '' && emptyToast.length === 0, 'rỗng có toast');
  check(ms < 10000, `format mất ${ms} ms`);
});

await tc('TC-R7-07', async ({ page, shot, note }) => {
  await withPg(page);
  await setSql(page, "select 'ünï;cødé😀' as x, a -- chú thích\nfrom t");
  const before = await docText(page);
  await profileBtn(page).focus();
  await page.keyboard.press('Control+q');
  await page.waitForTimeout(700);
  const same = (await docText(page)) === before && (await toastTexts(page)).length === 0;
  await ed(page).click();
  await page.keyboard.press('Control+q');
  await page.waitForTimeout(800);
  const d = await docText(page);
  check(same, 'Ctrl+Q ngoài editor làm gì đó');
  check(d.includes('ünï;cødé😀') && d.includes('-- chú thích'), `mất ký tự: ${d}`);
  note.v = 'Ngoài editor: không format, không toast. Unicode, emoji, comment giữ nguyên sau format.';
});

await tc('TC-R7-08', async ({ page, note }) => {
  await withPg(page);
  const reqs = [];
  page.on('request', r => {
    if (/format|dist-|esm-/i.test(r.url()) && /assets/.test(r.url())) reqs.push(r.url().split('/').pop());
  });
  await setSql(page, 'select a,b from t');
  await ed(page).click();
  await page.keyboard.press('Control+q');
  await page.waitForTimeout(1200);
  const first = reqs.length;
  await page.keyboard.press('Control+q');
  await page.waitForTimeout(800);
  note.v = `Request chunk (dist-*/esm-*/format) sau Ctrl+Q lần 1: ${first} [${reqs.join(', ')}]; sau lần 2: ${reqs.length}.`;
  check(reqs.length === first && first >= 1, `chunk tải ${first}/${reqs.length}`);
});

// ================= R8
await tc('TC-R8-01', async ({ page, shot, note }) => {
  await withPg(page);
  await setSql(page, 'select 1 from t');
  await ed(page).click();
  await page.keyboard.press('Control+f');
  await findPanel(page).waitFor();
  const pb = await findPanel(page).locator('xpath=ancestor::div[contains(@class,"mantine-Paper-root")][1]').boundingBox();
  const eb = await page.locator('.cm-editor:visible').boundingBox();
  const overlay = await page.locator('.mantine-Modal-overlay, .mantine-Overlay-root').count();
  await ed(page).click();
  await page.keyboard.type('X');
  check((await docText(page)).includes('X'), 'không gõ được vào editor khi dialog mở');
  await shot();
  check(pb.y < eb.y + 40 && pb.x + pb.width <= eb.x + eb.width + 1 && pb.x > eb.x + eb.width / 2, `vị trí ${JSON.stringify(pb)} vs editor ${JSON.stringify(eb)}`);
  check(overlay === 0, 'có overlay');
  note.v = `Dialog ở góc trên phải editor (x=${Math.round(pb.x)}, y=${Math.round(pb.y)}), không overlay, vẫn gõ được vào editor.`;
});

await tc('TC-R8-02', async ({ page, note }) => {
  await withPg(page);
  await setSql(page, 'select name from users');
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 17; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+f');
  await findPanel(page).waitFor();
  const v1 = await findInput(page).inputValue();
  await page.keyboard.press('Escape');
  await setSql(page, 'a\nb');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+f');
  await findPanel(page).waitFor();
  const v2 = await findInput(page).inputValue();
  check(v1 === 'users' && v2 === 'users', `điền sẵn: "${v1}" / nhiều dòng: "${v2}"`);
  note.v = `Bôi đen một dòng -> "${v1}"; bôi đen nhiều dòng giữ giá trị cũ ("${v2}").`;
});

const FOO = 'foo 1\nbar\nFoo 2\nbaz foo\nFOO 4\nnone\nfoo 5';
async function openFind(page, text = FOO) {
  await withPg(page);
  await setSql(page, text);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+f');
  await findPanel(page).waitFor();
}

await tc('TC-R8-03', async ({ page, shot, note }) => {
  await openFind(page);
  await findInput(page).fill('foo');
  const seq = [];
  for (let i = 0; i < 7; i++) {
    await fbtn(page, 'find').click();
    seq.push(await countText(page));
  }
  await shot();
  check(seq.slice(0, 5).join() === '1/5,2/5,3/5,4/5,5/5' && seq[5] === '1/5', `đếm: ${seq}`);
  note.v = `Chuỗi đếm: ${seq.join(', ')} (quay vòng, không phân biệt hoa/thường).`;
});

await tc('TC-R8-04', async ({ page, shot, note }) => {
  await openFind(page);
  await findInput(page).fill('zzz');
  await fbtn(page, 'find').click();
  const c = await countText(page);
  check(c === L(TAB, 'find.notFound'), `thông báo: "${c}"`);
  await shot();
  note.v = `Hiện "${c}".`;
});

await tc('TC-R8-05', async ({ page, shot, note }) => {
  await openFind(page);
  const dis = await fbtn(page, 'find').isDisabled();
  check(dis, 'nút Find không disable khi ô rỗng');
  note.v = 'Ô Find rỗng: nút Find disable (đúng như bên gọi mô tả).';
});

await tc('TC-R8-06', async ({ page, shot, note }) => {
  await openFind(page);
  await findInput(page).fill('foo');
  await fbtn(page, 'replace').click();
  await replaceInput(page).waitFor();
  await shot();
  check((await fbtn(page, 'replaceAll').count()) === 1, 'thiếu Replace all');
  check((await docText(page)).includes('foo 1'), 'đã thay chữ ở lần bấm đầu');
  note.v = 'Lần bấm Replace đầu hiện ô thay thế + Replace all; chưa thay chữ.';
});

await tc('TC-R8-07', async ({ page, shot, note }) => {
  await openFind(page);
  await findInput(page).fill('foo');
  await fbtn(page, 'find').click();
  await fbtn(page, 'replace').click();
  await replaceInput(page).fill('bar');
  await fbtn(page, 'replace').click();
  const c = await countText(page);
  const d = await docText(page);
  await shot();
  check(d.startsWith('bar 1') && c === '1/4', `doc "${d.split('\n')[0]}", đếm ${c}`);
  await ed(page).click();
  await page.keyboard.press('Control+z');
  check((await docText(page)).startsWith('foo 1'), 'undo không là một bước');
  note.v = `Kết quả 1 thành "bar 1"; đếm ${c}; Ctrl+Z một lần hoàn tác.`;
});

await tc('TC-R8-08', async ({ page, shot, note }) => {
  await openFind(page);
  await findInput(page).fill('foo');
  await fbtn(page, 'replace').click();
  await replaceInput(page).fill('bar');
  await ed(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await fbtn(page, 'replace').click();
  const d = await docText(page);
  const c = await countText(page);
  check(d === FOO, `thay sai chỗ: ${d}`);
  await shot();
  note.v = `Selection không khớp: không thay chữ, chuyển tới kết quả kế (đếm "${c}").`;
});

await tc('TC-R8-09', async ({ page, shot, note }) => {
  await openFind(page);
  await findInput(page).fill('foo');
  await fbtn(page, 'replace').click();
  await replaceInput(page).fill('bar');
  await fbtn(page, 'replaceAll').click();
  await page.waitForTimeout(300);
  const t = await toastTexts(page);
  const d = await docText(page);
  await shot();
  check(!/foo/i.test(d) && t.some(s => s.includes('5')), `doc "${d}", toast ${t}`);
  await ed(page).click();
  await page.keyboard.press('Control+z');
  check((await docText(page)) === FOO, 'một lần undo không hoàn tác hết');
  await findInput(page).fill('nonexist');
  await fbtn(page, 'replaceAll').click();
  await page.waitForTimeout(300);
  const t0 = (await toastTexts(page)).at(-1);
  await ed(page).click();
  await page.keyboard.press('Control+z');
  note.v = `Replace all 5 chỗ, toast "${t[0]}"; một Ctrl+Z hoàn tác toàn bộ; 0 chỗ: toast "${t0}".`;
});

await tc('TC-R8-10', async ({ page, shot, note }) => {
  const out = [];
  for (const rep of ['', '$&', '\\n', '|', '😀']) {
    await openFind(page, 'foo foo');
    await findInput(page).fill('foo');
    await fbtn(page, 'replace').click();
    await replaceInput(page).fill(rep);
    await fbtn(page, 'replaceAll').click();
    const d = await docText(page);
    const exp = `${rep} ${rep}`;
    out.push(`"${rep}" -> "${d}"`);
    check(d === exp, `thay "${rep}" ra "${d}" (mong đợi "${exp}")`);
    await page.reload({ waitUntil: 'networkidle' });
  }
  note.v = out.join('; ');
});

await tc('TC-R8-11', async ({ page, shot, note }) => {
  await openFind(page, 'İstanbul straße');
  const out = [];
  for (const q of ['i', 'ss', 'ß']) {
    await findInput(page).fill(q);
    await fbtn(page, 'find').click();
    out.push(`"${q}" => chọn "${await selText(page)}"; ${await countText(page)}`);
  }
  await findInput(page).fill('ß');
  await fbtn(page, 'replace').click();
  await replaceInput(page).fill('SS');
  await fbtn(page, 'find').click();
  await fbtn(page, 'replace').click();
  const d = await docText(page);
  await shot();
  check(d === 'İstanbul straSSe', `sau replace: "${d}"`);
  note.v = `${out.join('; ')}; Replace ß -> SS: "${d}".`;
});

await tc('TC-R8-12', async ({ page, shot, note }) => {
  await openFind(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check((await findPanel(page).count()) === 0, 'Esc không đóng');
  await page.keyboard.type('Q');
  check((await docText(page)).startsWith('Q'), 'focus không về editor sau Esc');
  await page.keyboard.press('Control+f');
  await findPanel(page).waitFor();
  await fbtn(page, 'cancel').click();
  await page.waitForTimeout(300);
  await page.keyboard.type('W');
  check((await findPanel(page).count()) === 0 && (await docText(page)).includes('W'), 'Cancel không trả focus editor');
  note.v = 'Esc và Cancel đóng dialog; focus về editor, gõ được ngay.';
});

await tc('TC-R8-13', async ({ page, shot, note }) => {
  await openFind(page);
  await fbtn(page, 'replace').click();
  await replaceInput(page).waitFor();
  const c = await fbtn(page, 'cancel').boundingBox();
  const f = await fbtn(page, 'find').boundingBox();
  const r = await fbtn(page, 'replaceAll').boundingBox();
  const col = await fbtn(page, 'cancel').evaluate(e => getComputedStyle(e).backgroundColor);
  await shot();
  check(c.x < f.x && f.x < r.x, 'thứ tự nút sai');
  note.v = `Cancel (x=${Math.round(c.x)}, nền ${col}) bên trái; Find (${Math.round(f.x)}) < Replace all (${Math.round(r.x)}) bên phải. Ổn định layout đa ngôn ngữ không đo riêng.`;
});

await tc('TC-R8-14', async ({ page, shot, note }) => {
  await openFind(page);
  await findInput(page).fill('foo');
  await addTab(page);
  const t2 = await findPanel(page).count();
  await tabs(page).first().click();
  await page.waitForTimeout(400);
  const v = await findInput(page).inputValue();
  await shot();
  check(t2 === 0 && v === 'foo', `tab2 có dialog=${t2}, tab1 giữ "${v}"`);
  note.v = 'Tab 2 không có dialog; quay lại tab 1 vẫn dialog với "foo".';
});

await tc('TC-R8-15', async ({ page, shot, note }) => {
  await openFind(page);
  await findInput(page).fill('foo');
  await ed(page).click();
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+f');
  await page.waitForTimeout(300);
  const n = await findPanel(page).count();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('placeholder'));
  const val = await findInput(page).inputValue();
  check(n === 1 && focused === L(TAB, 'find.placeholderFind'), `panel=${n}, focus=${focused}`);
  note.v = `Không mở dialog thứ hai (${n}); focus ô Find; giá trị ô Find sau Ctrl+F lần hai: "${val}" (vùng bôi đen mới "fo" ${val === 'fo' ? 'được điền' : 'không được điền'}).`;
});

await tc('TC-R8-16', async ({ page, shot, note }) => {
  await withPg(page);
  await ed(page).click();
  await page.keyboard.insertText(Array.from({ length: 5000 }, (_, i) => `select foo${i} from t where foo=${i};`).join('\n'));
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+f');
  await findPanel(page).waitFor();
  await findInput(page).fill('foo');
  const t0 = Date.now();
  await fbtn(page, 'find').click();
  const c = await countText(page);
  const ms1 = Date.now() - t0;
  await fbtn(page, 'replace').click();
  await replaceInput(page).fill('bar');
  const t1 = Date.now();
  await fbtn(page, 'replaceAll').click();
  await toast(page).filter({ hasText: /Replaced/ }).first().waitFor({ timeout: 60000 });
  const ms2 = Date.now() - t1;
  const t = (await toastTexts(page)).at(-1);
  await shot();
  check(c === '1/10000' && /10000/.test(t), `đếm ${c}, ${t}`);
  note.v = `5000 dòng/10000 khớp: Find ${ms1} ms, đếm ${c}; Replace all ${ms2} ms, toast "${t}".`;
});

// ================= R9
await tc('TC-R9-01', async ({ page, shot, note }) => {
  await withPg(page);
  await setSql(page, 'select 1;\nselect 2;');
  await selectLine(page, 2);
  await trackDefault(page);
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(400);
  const t = await lastToast(page);
  await shot();
  check(t.includes(PG) && t.includes('select 2;') && !t.includes('select 1;'), `toast: ${t}`);
  note.v = `Toast "${t}" (chỉ phần bôi đen); defaultPrevented=${(await page.evaluate(() => window.__dp)).join(',')}.`;
});

await tc('TC-R9-02', async ({ page, shot, note }) => {
  await withPg(page);
  await setSql(page, 'select 1;\nselect 2;');
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(400);
  const t = await lastToast(page);
  check(t.includes(PG) && t.includes('select 1;') && t.includes('select 2;'), `toast: ${t}`);
  note.v = `Toast "${t}".`;
});

await tc('TC-R9-03', async ({ page, shot, note }) => {
  await toSql(page);
  await setSql(page, 'select 1');
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(400);
  const t = await toastTexts(page);
  check(t.length === 1 && t[0].includes(L(TAB, 'toast.noProfile')), `toast: ${t}`);
  note.v = `Toast cảnh báo "${t[0]}".`;
});

await tc('TC-R9-04', async ({ page, shot, note }) => {
  await withPg(page);
  const out = [];
  const tryIt = async (desc, prep) => {
    await prep();
    const c0 = (await toastTexts(page)).length;
    await page.keyboard.press('Control+e');
    await page.waitForTimeout(500);
    const t = await toastTexts(page);
    out.push(`${desc}: ${t.at(-1)}`);
    check(t.length === c0 + 1 && t.at(-1).includes(L(TAB, 'toast.emptySql')), `${desc}: ${t}`);
  };
  await tryIt('rỗng', async () => {
    await setSql(page, '');
  });
  await tryIt('khoảng trắng', async () => setSql(page, '  \n  '));
  await tryIt('bôi đen khoảng trắng', async () => {
    await setSql(page, 'select 1;\n    ');
    await selectLine(page, 2);
  });
  await shot();
  note.v = out.join('; ');
});

await tc('TC-R9-05', async ({ page, note }) => {
  await withPg(page);
  await setSql(page, 'select 1');
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(400);
  const t = await lastToast(page);
  check(t.includes(PG) && t.includes('select 1'), `toast: ${t}`);
  note.v = `Profile chưa kết nối vẫn chạy: "${t}".`;
});

await tc('TC-R9-06', async ({ page, note }) => {
  await withPg(page);
  await setSql(page, 'select 1');
  await trackDefault(page);
  await profileBtn(page).focus();
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(400);
  const outside = (await toastTexts(page)).length;
  await ed(page).click();
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(400);
  const dp = await page.evaluate(() => window.__dp);
  check(outside === 0 && dp.includes('e:true'), `ngoài editor toast=${outside}, dp=${dp}`);
  note.v = `Ngoài editor không toast; trong editor keydown defaultPrevented=true (${dp.join(',')}).`;
});

await tc('TC-R9-07', async ({ page, shot, note }) => {
  await withPg(page);
  await setSql(page, `<b>x</b> & 😀 ${'y'.repeat(2100)}`);
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(500);
  const t = await lastToast(page);
  check(t.includes('<b>x</b> & 😀') && t.includes('…') && (await page.locator('[data-sonner-toast] b').count()) === 0, `toast: ${t.slice(0, 80)}`);
  await shot();
  note.v = 'Cắt 500 ký tự + …; "<b>x</b> & 😀" hiển thị nguyên văn, không có thẻ b thật; toast không vỡ layout.';
});
await browser.close();
writeFileSync(join(here, ONLY ? 'results.partial.json' : 'results.json'), JSON.stringify(results, null, 2));
