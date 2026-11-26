import type { Page } from '@playwright/test';
import { callBackend, DEFAULT_SETTINGS, expect, switchMode, t, test } from './fixtures';

const SETTING = 'components/modals/settingModal';

const openSettings = (page: Page) => page.getByRole('button', { name: t(SETTING, 'title'), exact: true }).click();

/** Chọn một tùy chọn trong select Cài đặt theo nhãn của tùy chọn đó. */
async function pick(page: Page, labelKey: string, optionText: string) {
  await page.getByRole('combobox', { name: t(SETTING, labelKey), exact: true }).click();
  await page.getByRole('option', { name: optionText, exact: true }).click();
}

/**
 * Các phần tử hiển thị nhô ra khỏi mép phải cửa sổ (cửa sổ không thể cuộn ngang), và cả
 * chính cửa sổ nếu nó cuộn ngang. Nội dung nằm trong vùng chứa có cuộn hoặc cắt và kết thúc bên trong cửa sổ
 * (tab strip, grid, editor) được chấp nhận: vùng chứa đó mới là phần được cuộn.
 */
const overflowingElements = (page: Page) =>
  page.evaluate(() => {
    const limit = window.innerWidth + 1;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > limit) out.push('window scrolls sideways');
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= limit) continue;
      let clipped = false;
      for (let p = el.parentElement; p && !clipped; p = p.parentElement) {
        clipped = getComputedStyle(p).overflowX !== 'visible' && p.getBoundingClientRect().right <= limit;
      }
      if (!clipped) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    }
    return out;
  });

/** Hộp thoại đang mở bị cuộn ngang (không được phép ở bất kỳ kích thước giao diện nào). */
const modalScrollsSideways = (page: Page) =>
  page
    .locator('.mantine-Modal-content')
    .evaluate(el =>
      [el, ...el.querySelectorAll<HTMLElement>('*')].some(
        e => e.scrollWidth > e.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX)
      )
    );

test('theme and language apply right away', async ({ page }) => {
  await openSettings(page);
  await pick(page, 'label.theme', t(SETTING, 'option.theme.dark'));
  // Apply giữ nguyên các giá trị trong phiên này; hộp thoại vẫn mở.
  await page.getByRole('button', { name: t(SETTING, 'button.apply'), exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');

  // Hộp thoại đã hiển thị ngôn ngữ đang chọn, nên các nhãn tiếp theo sẽ bằng tiếng Việt.
  await pick(page, 'label.language', 'Tiếng Việt');
  await page.getByRole('button', { name: t(SETTING, 'button.apply', {}, 'vi'), exact: true }).click();
  await page.getByRole('button', { name: t(SETTING, 'button.cancel', {}, 'vi'), exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: t(SETTING, 'title', {}, 'vi'), exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
});

for (const [size, rootPx] of [
  ['small', 14],
  ['medium', 16],
  ['large', 18],
] as const) {
  test(`interface size ${size}: root ${rootPx}px and no horizontal overflow`, async ({ page }) => {
    await callBackend(page, 'SettingHandler', 'SaveSettings', { ...DEFAULT_SETTINGS, size });
    await page.reload();
    await expect(page.locator('html')).toHaveCSS('font-size', `${rootPx}px`);

    for (const mode of ['s3', 'sql'] as const) {
      await switchMode(page, mode);
      await page.waitForTimeout(300);
      expect(await overflowingElements(page), `${mode} mode overflows`).toEqual([]);
    }

    await openSettings(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await overflowingElements(page), 'Settings modal overflows').toEqual([]);
    expect(await modalScrollsSideways(page), 'Settings modal scrolls sideways').toBe(false);
    await page.getByRole('button', { name: t(SETTING, 'button.cancel'), exact: true }).click();
  });
}

test('S3 tabs are restored after a reload', async ({ page }) => {
  await switchMode(page, 's3');
  const tabs = page.getByRole('tablist').first().getByRole('tab');
  await expect(tabs.first()).toBeVisible();
  const before = await tabs.count();
  await page
    .getByRole('button', { name: t('common', 'tab.add'), exact: true })
    .first()
    .click();
  await expect(tabs).toHaveCount(before + 1);

  // Bố cục được lưu sau 500 ms kể từ khi ngừng thay đổi.
  await expect
    .poll(async () => (await callBackend<{ tabs: unknown[] }>(page, 'SettingHandler', 'GetTabState')).body.tabs.length)
    .toBe(before + 1);
  await page.reload();
  await switchMode(page, 's3');
  await expect(tabs).toHaveCount(before + 1);

  // Khôi phục trạng thái ứng dụng để spec tiếp theo sử dụng.
  await tabs
    .last()
    .getByRole('button', { name: t('common', 'tab.close'), exact: true })
    .click();
  await expect(tabs).toHaveCount(before);
});
