import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, hideToasts, switchMode, t, test } from './fixtures';

const NAV = 'pages/sql/sqlNavbar';
const TAB = 'pages/sql/sqlTab';
const MODAL = 'pages/sql/modals/dbProfileModal';
const PROFILE = 'E2E SQLite';
const USERS = 25_000; // more than one result page (10,000 rows)

// Driver Rust không tự tạo file còn thiếu, nên cơ sở dữ liệu kiểm thử được tạo tại đây.
const dbFile = join(dirname(fileURLToPath(import.meta.url)), '.run', 'data', 'e2e.sqlite');

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  mkdirSync(dirname(dbFile), { recursive: true });
  rmSync(dbFile, { force: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
    CREATE VIEW active_users AS SELECT id, name FROM users WHERE id % 2 = 0;
    CREATE INDEX idx_users_name ON users (name);
    CREATE TABLE audit (user_id INTEGER, at TEXT);
    CREATE TRIGGER trg_users_insert AFTER INSERT ON users BEGIN INSERT INTO audit VALUES (new.id, 'now'); END;
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${USERS})
    INSERT INTO users (id, name, email) SELECT i, 'user-' || i, 'user' || i || '@example.test' FROM n;
  `);
  db.close();
});

const card = (page: Page) => page.locator('[data-profile-key]', { hasText: PROFILE });

/** Chế độ SQL với hồ sơ được chọn trong tab truy vấn đang hoạt động. */
async function openSqlTab(page: Page) {
  await switchMode(page, 'sql');
  await expect(card(page)).toBeVisible();
  await page.locator('[aria-haspopup="listbox"]:visible').first().click();
  await page.getByRole('option').filter({ hasText: PROFILE }).first().click();
}

/** Thay nội dung trình soạn thảo rồi chạy bằng nút Run. */
async function runSql(page: Page, sql: string) {
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(sql);
  await page.getByRole('button', { name: t(TAB, 'tooltip.execute'), exact: true }).click();
}

const rowsReturned = (n: string) =>
  new RegExp(`^${t(TAB, 'message.rowsReturned', { n }).replace(/[()+]/g, '\\$&')} · `);

test('create a SQLite profile and connect', async ({ page }) => {
  await switchMode(page, 'sql');
  await page.getByRole('button', { name: t(NAV, 'tooltip.createProfile'), exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(t(MODAL, 'form.dbType.sqlite'), { exact: true }).click();
  await dialog.getByRole('textbox', { name: t(MODAL, 'form.label.name') }).fill(PROFILE);
  await dialog.getByRole('textbox', { name: t(MODAL, 'form.label.filePath') }).fill(dbFile);
  await dialog.getByRole('button', { name: t(MODAL, 'form.button.create'), exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page)).toBeVisible();

  await card(page).dblclick();
  await expect(page.getByText(t(NAV, 'toast.connected', { name: PROFILE })).first()).toBeVisible();
});

test('object tree lists tables, views, indexes and triggers', async ({ page }) => {
  await switchMode(page, 'sql');
  await card(page).dblclick();
  await card(page)
    .getByRole('button', { name: t(NAV, 'tree.expand'), exact: true })
    .click();
  for (const group of ['tables', 'views', 'indexes', 'triggers']) {
    await expect(page.getByText(t(NAV, `tree.${group}`), { exact: true })).toBeVisible();
  }
  await page.getByText(t(NAV, 'tree.tables'), { exact: true }).dblclick();
  await expect(page.getByText('users', { exact: true })).toBeVisible();
  await expect(page.getByText('audit', { exact: true })).toBeVisible();
  await page.getByText(t(NAV, 'tree.triggers'), { exact: true }).dblclick();
  await expect(page.getByText('trg_users_insert', { exact: true })).toBeVisible();
});

test('run SQL and page through a large result', async ({ page }) => {
  await openSqlTab(page);
  await hideToasts(page);
  await runSql(page, 'SELECT * FROM users ORDER BY id');

  // Trang đầu tiên có 10.000 hàng và dấu "+" khi cursor vẫn còn hàng.
  const summary = page.getByText(rowsReturned('10000+'));
  await expect(summary).toBeVisible({ timeout: 20_000 });

  // Cuộn đến cuối lưới sẽ tải các trang tiếp theo cho đến khi đọc hết các hàng.
  const all = page.getByText(rowsReturned(String(USERS)));
  await expect(async () => {
    await page.evaluate(() => {
      const canvas = [...document.querySelectorAll<HTMLElement>('[class*="_canvas_"]')].find(c => c.offsetParent);
      if (canvas?.parentElement) canvas.parentElement.scrollTop = canvas.parentElement.scrollHeight;
    });
    await expect(all).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
});

test('cancel a running query', async ({ page }) => {
  await openSqlTab(page);
  await hideToasts(page);
  // Tiến trình không tự kết thúc; chỉ thao tác hủy mới dừng được.
  await runSql(page, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c');
  const cancel = page.getByRole('button', { name: t(TAB, 'tooltip.cancel'), exact: true });
  await expect(cancel).toBeVisible();
  await page.waitForTimeout(500);
  await cancel.click();
  await expect(page.getByText(t(TAB, 'message.cancelled')).first()).toBeVisible();
  await expect(page.getByRole('button', { name: t(TAB, 'tooltip.execute'), exact: true })).toBeEnabled();
});

test('open the data of a table from the tree', async ({ page }) => {
  await switchMode(page, 'sql');
  await hideToasts(page);
  await card(page).dblclick();
  const expand = card(page).getByRole('button', { name: t(NAV, 'tree.expand'), exact: true });
  if (await expand.isVisible()) await expand.click();
  const tables = page.getByText(t(NAV, 'tree.tables'), { exact: true });
  await expect(tables).toBeVisible();
  if (!(await page.getByText('users', { exact: true }).isVisible())) await tables.dblclick();
  await page.getByText('users', { exact: true }).dblclick();

  await expect(page.getByRole('tab', { name: t('pages/sql/tableStructure', 'tab.data'), exact: true })).toBeVisible();
  await expect(page.getByText('user1@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('user-1', { exact: true })).toBeVisible();
});

test('disconnect and delete the profile', async ({ page }) => {
  await switchMode(page, 'sql');
  await card(page).click({ button: 'right' });
  const disconnect = page.getByRole('menuitem', { name: t(NAV, 'contextMenu.disconnect'), exact: true });
  if (await disconnect.isVisible()) {
    await disconnect.click();
    await card(page).click({ button: 'right' });
  }
  await page.getByRole('menuitem', { name: t(NAV, 'contextMenu.delete'), exact: true }).click();
  await page.getByRole('button', { name: t('common', 'button.OK'), exact: true }).click();
  await expect(card(page)).toHaveCount(0);
});
