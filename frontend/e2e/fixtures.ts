import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales');

/** Lấy văn bản giao diện theo khóa ngôn ngữ để kiểm thử dùng đúng nhãn thực tế thay vì ghi cứng. */
export function t(namespace: string, key: string, params: Record<string, string | number> = {}, lang = 'en'): string {
  const json = JSON.parse(readFileSync(join(localesDir, lang, `${namespace}.json`), 'utf8'));
  const text = key.split('.').reduce((node, part) => node?.[part], json);
  if (typeof text !== 'string') throw new Error(`Missing locale key ${lang}/${namespace}:${key}`);
  return Object.entries(params).reduce(
    (out, [name, value]) => out.replaceAll(`{{${name}}}`, String(value)).replaceAll(`{${name}}`, String(value)),
    text
  );
}

/** Gọi handler Go đã bind theo cách các binding được sinh tự động thực hiện (chỉ dùng để thiết lập và dọn dẹp). */
export async function callBackend<T = unknown>(page: Page, handler: string, method: string, ...args: unknown[]) {
  return page.evaluate(
    async ({ methodName, args }) => {
      const res = await fetch('/wails/runtime', {
        method: 'POST',
        headers: { 'x-wails-client-id': 'e2e', 'Content-Type': 'application/json' },
        body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': crypto.randomUUID(), methodName, args } }),
      });
      return res.json();
    },
    { methodName: `S3Browser/internal/handlers.${handler}.${method}`, args }
  ) as Promise<{ result: boolean; body: T }>;
}

/** Cài đặt mặc định của bản cài mới, được ghi trước mỗi kiểm thử để các spec không ảnh hưởng cài đặt của nhau. */
export const DEFAULT_SETTINGS = {
  theme: 'light',
  font: 'nunito',
  language: 'en',
  size: 'medium',
  launchOnStartup: false,
  autoUpdate: false,
  betaUpdate: false,
};

// Chế độ máy chủ Wails in banner này bằng console.warn mỗi lần tải trang; ứng dụng desktop không làm vậy.
const WAILS_BANNER = 'Browser Environment Detected';

export const test = base.extend({
  // Ứng dụng dùng cài đặt mặc định và được kiểm tra console: mọi cảnh báo, lỗi hoặc ngoại lệ không được xử lý trên trang
  // trong lúc kiểm thử đều khiến kiểm thử thất bại (các listener được gắn trước lần tải trang đầu tiên).
  page: async ({ page }, run) => {
    const errors: string[] = [];
    await page.addInitScript(banner => {
      // oxlint-disable-next-line no-console -- bọc console của trang để bỏ riêng banner của Wails
      const warn = console.warn;
      // oxlint-disable-next-line no-console
      console.warn = (...args) => {
        if (args.some(a => typeof a === 'string' && a.includes(banner))) return;
        warn.apply(console, args);
      };
    }, WAILS_BANNER);
    page.on('console', msg => {
      if (msg.type() === 'warning' || msg.type() === 'error') errors.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));

    await page.goto('/');
    await callBackend(page, 'SettingHandler', 'SaveSettings', DEFAULT_SETTINGS);
    await page.reload();
    await run(page);
    expect(errors, 'console must stay clean').toEqual([]);
  },
});

export { expect };

/** Chuyển ứng dụng giữa chế độ S3 và SQL bằng nút chuyển trên thanh tiêu đề. */
export async function switchMode(page: Page, mode: 's3' | 'sql') {
  await page
    .getByText(t('common', `appMode.${mode}`), { exact: true })
    .first()
    .click();
}

/** Ẩn toast để chúng không che nút mà kiểm thử sẽ bấm tiếp theo (sonner vẫn giữ các node này). */
export async function hideToasts(page: Page) {
  await page.addStyleTag({ content: '[data-sonner-toaster]{display:none !important}' });
}
