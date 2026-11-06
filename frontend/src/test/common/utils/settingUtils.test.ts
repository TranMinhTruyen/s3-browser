import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, getFontFamily } from '@/common/cnst/settingConst';
import { applySettings, normalizeSettings, settingColorSchemeManager } from '@/common/utils/settingUtils';
import i18n, { loadLanguage } from '@/locales/i18n';

vi.mock('@/locales/i18n', async importOriginal => ({
  ...(await importOriginal<typeof import('@/locales/i18n')>()),
  loadLanguage: vi.fn(),
}));

const loadLanguageMock = vi.mocked(loadLanguage);

beforeEach(() => {
  loadLanguageMock.mockReset();
  loadLanguageMock.mockResolvedValue(true);
});

describe('normalizeSettings', () => {
  it.each([[undefined], [null], [{}]])('returns the defaults for %j', raw => {
    expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    const raw = { theme: 'dark', font: 'jetbrains-mono', language: 'ja', launchOnStartup: true, autoUpdate: false };
    expect(normalizeSettings(raw)).toEqual(raw);
  });

  it.each(['zh-CN', 'zh-TW', 'ru', 'de'])('accepts the language %s', language => {
    expect(normalizeSettings({ language }).language).toBe(language);
  });

  it.each([
    [undefined, true],
    [true, true],
    [false, false],
    ['no', true],
    [0, true],
  ])('reads autoUpdate %j as %s (on unless explicitly false)', (autoUpdate, expected) => {
    expect(normalizeSettings({ autoUpdate }).autoUpdate).toBe(expected);
  });

  it('replaces unknown values with the defaults', () => {
    expect(normalizeSettings({ theme: 'neon', font: 'comic', language: 'fr', launchOnStartup: 'yes' })).toEqual(
      DEFAULT_SETTINGS
    );
  });
});

describe('settingColorSchemeManager', () => {
  afterEach(() => {
    settingColorSchemeManager.clear();
    settingColorSchemeManager.unsubscribe();
  });

  it('keeps the scheme in memory only and clear() restores the default', () => {
    expect(settingColorSchemeManager.get('light')).toBe('light');
    settingColorSchemeManager.set('dark');
    expect(settingColorSchemeManager.get('light')).toBe('dark');
    expect(localStorage.length).toBe(0);
    settingColorSchemeManager.clear();
    expect(settingColorSchemeManager.get('light')).toBe(DEFAULT_SETTINGS.theme);
  });

  it('notifies the subscriber until it unsubscribes', async () => {
    vi.spyOn(i18n, 'changeLanguage').mockResolvedValue(i18n.t);
    const onUpdate = vi.fn();
    settingColorSchemeManager.subscribe(onUpdate);

    await applySettings({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect(onUpdate).toHaveBeenCalledWith('dark');

    settingColorSchemeManager.unsubscribe();
    await applySettings({ ...DEFAULT_SETTINGS, theme: 'auto' });
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('applySettings', () => {
  beforeEach(() => {
    vi.spyOn(i18n, 'changeLanguage').mockResolvedValue(i18n.t);
  });

  afterEach(() => {
    settingColorSchemeManager.clear();
  });

  it('sets the scheme and the font variables', async () => {
    await applySettings({ ...DEFAULT_SETTINGS, theme: 'dark', font: 'arial' });

    expect(settingColorSchemeManager.get('light')).toBe('dark');
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--mantine-font-family')).toBe(getFontFamily('arial', 'en'));
    expect(style.getPropertyValue('--mantine-font-family-headings')).toBe(getFontFamily('arial', 'en'));
  });

  it.each([
    ['zh-CN', 'Microsoft YaHei UI', 'Yu Gothic UI'],
    ['zh-TW', 'Microsoft JhengHei UI', 'Yu Gothic UI'],
    ['ja', 'Yu Gothic UI', 'Microsoft YaHei UI'],
    ['en', 'Yu Gothic UI', 'Microsoft JhengHei UI'],
  ] as const)('language %s uses %s and not %s in the font family', async (language, included, excluded) => {
    await applySettings({ ...DEFAULT_SETTINGS, language });

    const family = document.documentElement.style.getPropertyValue('--mantine-font-family');
    expect(family).toBe(getFontFamily('nunito', language));
    expect(family).toContain(included);
    expect(family).not.toContain(excluded);
  });

  it.each(['en', 'zh-CN', 'zh-TW', 'ru', 'de'] as const)('sets <html lang> to %s', async language => {
    await applySettings({ ...DEFAULT_SETTINGS, language });
    expect(document.documentElement.lang).toBe(language);
  });

  describe('font variables', () => {
    const style = () => document.documentElement.style;
    const family = () => style().getPropertyValue('--mantine-font-family');

    afterEach(() => {
      vi.mocked(style().setProperty).mockRestore();
    });

    it('writes both variables once and not again while the family stays the same', async () => {
      await applySettings({ ...DEFAULT_SETTINGS, font: 'arial', language: 'en' });
      const setProperty = vi.spyOn(style(), 'setProperty');

      await applySettings({ ...DEFAULT_SETTINGS, font: 'arial', language: 'en', theme: 'dark' });
      expect(setProperty).not.toHaveBeenCalled();

      await applySettings({ ...DEFAULT_SETTINGS, font: 'arial', language: 'en', launchOnStartup: true });
      expect(setProperty).not.toHaveBeenCalled();
    });

    it('writes the font and headings variables together when the font changes', async () => {
      await applySettings({ ...DEFAULT_SETTINGS, font: 'arial', language: 'en' });
      const setProperty = vi.spyOn(style(), 'setProperty');

      await applySettings({ ...DEFAULT_SETTINGS, font: 'monospace', language: 'en' });

      expect(setProperty).toHaveBeenCalledTimes(2);
      expect(setProperty).toHaveBeenCalledWith('--mantine-font-family', getFontFamily('monospace', 'en'));
      expect(setProperty).toHaveBeenCalledWith('--mantine-font-family-headings', getFontFamily('monospace', 'en'));
    });

    it('rewrites the family when only the language changes its CJK fallback', async () => {
      await applySettings({ ...DEFAULT_SETTINGS, font: 'arial', language: 'zh-CN' });
      expect(family()).toContain('Microsoft YaHei UI');
      const setProperty = vi.spyOn(style(), 'setProperty');

      await applySettings({ ...DEFAULT_SETTINGS, font: 'arial', language: 'zh-TW' });

      expect(setProperty).toHaveBeenCalledTimes(2);
      expect(family()).toBe(getFontFamily('arial', 'zh-TW'));
      expect(style().getPropertyValue('--mantine-font-family-headings')).toBe(family());
    });

    it('does not rewrite when two languages share the same fallback', async () => {
      await applySettings({ ...DEFAULT_SETTINGS, font: 'arial', language: 'ru' });
      const setProperty = vi.spyOn(style(), 'setProperty');

      await applySettings({ ...DEFAULT_SETTINGS, font: 'arial', language: 'de' });

      expect(getFontFamily('arial', 'ru')).toBe(getFontFamily('arial', 'de'));
      expect(setProperty).not.toHaveBeenCalled();
      expect(document.documentElement.lang).toBe('de');
    });
  });

  describe('language loading', () => {
    const deferred = () => {
      let resolve!: (ok: boolean) => void;
      const promise = new Promise<boolean>(r => {
        resolve = r;
      });
      return { promise, resolve };
    };

    it('loads the bundle first and then changes the language', async () => {
      await applySettings({ ...DEFAULT_SETTINGS, language: 'vi' });

      expect(loadLanguageMock).toHaveBeenCalledWith('vi');
      expect(i18n.changeLanguage).toHaveBeenCalledWith('vi');
      expect(loadLanguageMock.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(i18n.changeLanguage).mock.invocationCallOrder[0]
      );
    });

    it('applies theme, font and <html lang> at once while the bundle is still loading', async () => {
      const gate = deferred();
      loadLanguageMock.mockReturnValueOnce(gate.promise);

      const pending = applySettings({ ...DEFAULT_SETTINGS, theme: 'dark', font: 'arial', language: 'ja' });

      expect(settingColorSchemeManager.get('light')).toBe('dark');
      expect(document.documentElement.lang).toBe('ja');
      expect(document.documentElement.style.getPropertyValue('--mantine-font-family')).toBe(
        getFontFamily('arial', 'ja')
      );
      expect(i18n.changeLanguage).not.toHaveBeenCalled();

      gate.resolve(true);
      await pending;
      expect(i18n.changeLanguage).toHaveBeenCalledWith('ja');
    });

    it('keeps the old language when the bundle cannot be loaded', async () => {
      loadLanguageMock.mockResolvedValueOnce(false);

      await applySettings({ ...DEFAULT_SETTINGS, language: 'vi' });

      expect(i18n.changeLanguage).not.toHaveBeenCalled();
      expect(document.documentElement.lang).toBe(i18n.language);
    });

    it('does not touch <html lang> when an older request fails after a newer one started', async () => {
      const a = deferred();
      const b = deferred();
      loadLanguageMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

      const first = applySettings({ ...DEFAULT_SETTINGS, language: 'vi' });
      const second = applySettings({ ...DEFAULT_SETTINGS, language: 'ja' });
      a.resolve(false);
      await first;

      expect(document.documentElement.lang).toBe('ja');
      expect(i18n.changeLanguage).not.toHaveBeenCalled();

      b.resolve(true);
      await second;
      expect(i18n.changeLanguage).toHaveBeenCalledWith('ja');
    });

    it('drops the older request when a newer language is chosen before it has loaded', async () => {
      const a = deferred();
      const b = deferred();
      loadLanguageMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

      const first = applySettings({ ...DEFAULT_SETTINGS, language: 'vi' });
      const second = applySettings({ ...DEFAULT_SETTINGS, language: 'ja' });
      b.resolve(true);
      await second;
      a.resolve(true);
      await first;

      expect(i18n.changeLanguage).toHaveBeenCalledTimes(1);
      expect(i18n.changeLanguage).toHaveBeenCalledWith('ja');
    });

    it('drops the older request even when it finishes first', async () => {
      const a = deferred();
      const b = deferred();
      loadLanguageMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

      const first = applySettings({ ...DEFAULT_SETTINGS, language: 'vi' });
      const second = applySettings({ ...DEFAULT_SETTINGS, language: 'ja' });
      a.resolve(true);
      await first;
      expect(i18n.changeLanguage).not.toHaveBeenCalled();

      b.resolve(true);
      await second;
      expect(i18n.changeLanguage).toHaveBeenCalledTimes(1);
      expect(i18n.changeLanguage).toHaveBeenCalledWith('ja');
    });

    it('skips changeLanguage when the language is already the requested one', async () => {
      await applySettings({ ...DEFAULT_SETTINGS, language: i18n.language as 'en' });

      expect(loadLanguageMock).toHaveBeenCalledWith(i18n.language);
      expect(i18n.changeLanguage).not.toHaveBeenCalled();
    });
  });

  it('changes the language only when it differs from the current one', async () => {
    await applySettings({ ...DEFAULT_SETTINGS, language: i18n.language as 'en' });
    expect(i18n.changeLanguage).not.toHaveBeenCalled();

    await applySettings({ ...DEFAULT_SETTINGS, language: i18n.language === 'ja' ? 'vi' : 'ja' });
    expect(i18n.changeLanguage).toHaveBeenCalledTimes(1);
  });
});

describe('applySettings color scheme attribute', () => {
  const originalMatchMedia = window.matchMedia;
  const mockPrefersDark = (matches: boolean) => {
    window.matchMedia = vi.fn().mockReturnValue({ matches }) as unknown as typeof window.matchMedia;
  };

  beforeEach(() => {
    vi.spyOn(i18n, 'changeLanguage').mockResolvedValue(i18n.t);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.documentElement.removeAttribute('data-mantine-color-scheme');
    settingColorSchemeManager.clear();
  });

  it.each([
    ['light', false, 'light'],
    ['dark', false, 'dark'],
    ['auto', true, 'dark'],
    ['auto', false, 'light'],
  ] as const)('theme %s with OS dark=%s sets %s on <html>', async (theme, osDark, expected) => {
    mockPrefersDark(osDark);
    await applySettings({ ...DEFAULT_SETTINGS, theme });
    expect(document.documentElement.getAttribute('data-mantine-color-scheme')).toBe(expected);
  });

  it('queries prefers-color-scheme dark only for auto', async () => {
    mockPrefersDark(true);
    await applySettings({ ...DEFAULT_SETTINGS, theme: 'light' });
    expect(window.matchMedia).not.toHaveBeenCalled();
    await applySettings({ ...DEFAULT_SETTINGS, theme: 'auto' });
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
  });
});

describe('getFontFamily', () => {
  it.each([
    ['zh-CN', ['"Microsoft YaHei UI"', '"PingFang SC"', '"Noto Sans CJK SC"']],
    ['zh-TW', ['"Microsoft JhengHei UI"', '"PingFang TC"', '"Noto Sans CJK TC"']],
    ['ja', ['"Yu Gothic UI"', '"Hiragino Sans"', '"Noto Sans CJK JP"']],
    ['en', ['"Yu Gothic UI"', '"Noto Sans CJK JP"']],
    ['vi', ['"Yu Gothic UI"']],
    ['ru', ['"Yu Gothic UI"']],
    ['de', ['"Yu Gothic UI"']],
  ] as const)('language %s ends with its CJK fallback', (language, fonts) => {
    const family = getFontFamily('arial', language);
    expect(family.startsWith('Arial, ')).toBe(true);
    expect(family.endsWith('sans-serif')).toBe(true);
    for (const font of fonts) expect(family).toContain(font);
  });

  it('keeps the font stack of each font before the fallback', () => {
    expect(getFontFamily('monospace', 'en')).toMatch(/^ui-monospace, "Cascadia Mono", Consolas, monospace, /);
    expect(getFontFamily('segoe-ui', 'zh-CN')).toMatch(/^"Segoe UI", "Microsoft YaHei UI"/);
  });
});
