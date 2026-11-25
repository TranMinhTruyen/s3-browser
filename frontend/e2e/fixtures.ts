import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales');

/** UI text of a locale key, so tests follow the real labels instead of hard-coding them. */
export function t(namespace: string, key: string, params: Record<string, string | number> = {}, lang = 'en'): string {
  const json = JSON.parse(readFileSync(join(localesDir, lang, `${namespace}.json`), 'utf8'));
  const text = key.split('.').reduce((node, part) => node?.[part], json);
  if (typeof text !== 'string') throw new Error(`Missing locale key ${lang}/${namespace}:${key}`);
  return Object.entries(params).reduce(
    (out, [name, value]) => out.replaceAll(`{{${name}}}`, String(value)).replaceAll(`{${name}}`, String(value)),
    text
  );
}

/** Calls a bound Go handler the way the generated bindings do (used for setup and cleanup only). */
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

/** Default settings of a new install, written before each test so specs do not leak settings into each other. */
export const DEFAULT_SETTINGS = {
  theme: 'light',
  font: 'nunito',
  language: 'en',
  size: 'medium',
  launchOnStartup: false,
  autoUpdate: false,
  betaUpdate: false,
};

// Wails server mode prints this banner with console.warn on every page load; the desktop app does not.
const WAILS_BANNER = 'Browser Environment Detected';

export const test = base.extend({
  // The app with default settings and a console check: any warning, error or uncaught exception of the page
  // during the test fails it (the listeners are attached before the first page load).
  page: async ({ page }, run) => {
    const errors: string[] = [];
    await page.addInitScript(banner => {
      // oxlint-disable-next-line no-console -- wraps the page's console to drop only the Wails banner
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

/** Switches the app between S3 and SQL mode with the switch in the title bar. */
export async function switchMode(page: Page, mode: 's3' | 'sql') {
  await page
    .getByText(t('common', `appMode.${mode}`), { exact: true })
    .first()
    .click();
}

/** Hides toasts so they do not cover buttons the test clicks next (sonner keeps owning the nodes). */
export async function hideToasts(page: Page) {
  await page.addStyleTag({ content: '[data-sonner-toaster]{display:none !important}' });
}
