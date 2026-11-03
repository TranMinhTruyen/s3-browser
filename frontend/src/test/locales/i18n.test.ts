import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGES } from '@/common/cnst/settingConst';
import i18n, { loadLanguage } from '@/locales/i18n';

describe('i18n', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('supports every language of the settings', () => {
    expect(i18n.options.supportedLngs).toEqual(expect.arrayContaining([...LANGUAGES]));
    expect(i18n.options.load).toBe('currentOnly');
  });

  it('bundles only en at init', () => {
    expect(i18n.hasResourceBundle('en', 'settingModal')).toBe(true);
  });

  it.each([
    ['zh-CN', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['ru', 'ru'],
    ['de', 'de'],
  ])('keeps %s as the language and translates with its own resource', async (language, expected) => {
    await loadLanguage(language);
    await i18n.changeLanguage(language);

    expect(i18n.language).toBe(expected);
    expect(i18n.t('title', { ns: 'settingModal' })).toBe(i18n.getResource(language, 'settingModal', 'title') as string);
    expect(i18n.t('title', { ns: 'settingModal' })).not.toBe(i18n.getResource('en', 'settingModal', 'title'));
  });

  it('translates zh-TW to the traditional text, not the zh fallback', async () => {
    await loadLanguage('zh-TW');
    await i18n.changeLanguage('zh-TW');
    expect(i18n.t('title', { ns: 'settingModal' })).toBe('設定');
  });
});

describe('loadLanguage', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/locales/ja/resource');
    vi.doUnmock('@/locales/ru/resource');
    vi.restoreAllMocks();
  });

  it('resolves true for en without loading anything', async () => {
    const mod = await import('@/locales/i18n');
    const add = vi.spyOn(mod.default, 'addResourceBundle');

    await expect(mod.loadLanguage('en')).resolves.toBe(true);
    expect(add).not.toHaveBeenCalled();
  });

  it.each(['fr', '', 'EN', 'constructor'])('resolves false for the unsupported language %j', async language => {
    const mod = await import('@/locales/i18n');
    const add = vi.spyOn(mod.default, 'addResourceBundle');

    await expect(mod.loadLanguage(language)).resolves.toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it('registers every namespace of the language on first load', async () => {
    const mod = await import('@/locales/i18n');
    const { default: resource } = await import('@/locales/vi/resource');
    expect(mod.default.hasResourceBundle('vi', 'settingModal')).toBe(false);

    await expect(mod.loadLanguage('vi')).resolves.toBe(true);

    for (const [ns, bundle] of Object.entries(resource)) {
      expect(mod.default.getResourceBundle('vi', ns)).toEqual(bundle);
    }
  });

  it('loads a language once and serves later calls from the cache', async () => {
    const mod = await import('@/locales/i18n');
    const add = vi.spyOn(mod.default, 'addResourceBundle');

    const first = mod.loadLanguage('vi');
    const second = mod.loadLanguage('vi');
    expect(second).toBe(first);
    await Promise.all([first, second]);
    const calls = add.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    await expect(mod.loadLanguage('vi')).resolves.toBe(true);
    expect(add).toHaveBeenCalledTimes(calls);
  });

  it('resolves false on a load error and retries on the next call', async () => {
    let attempts = 0;
    vi.doMock('@/locales/ja/resource', () => {
      attempts += 1;
      if (attempts === 1) throw new Error('chunk failed');
      return { default: { demo: { hello: 'konnichiwa' } } };
    });
    const mod = await import('@/locales/i18n');

    await expect(mod.loadLanguage('ja')).resolves.toBe(false);
    expect(mod.default.hasResourceBundle('ja', 'demo')).toBe(false);

    await expect(mod.loadLanguage('ja')).resolves.toBe(true);
    expect(mod.default.getResource('ja', 'demo', 'hello')).toBe('konnichiwa');
  });

  it('keeps a failed language from affecting another one', async () => {
    vi.doMock('@/locales/ja/resource', () => {
      throw new Error('chunk failed');
    });
    const mod = await import('@/locales/i18n');

    await expect(mod.loadLanguage('ja')).resolves.toBe(false);
    await expect(mod.loadLanguage('ru')).resolves.toBe(true);
  });
});
