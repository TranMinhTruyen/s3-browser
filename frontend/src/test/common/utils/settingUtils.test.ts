import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, getFontFamily } from '@/common/cnst/settingConst';
import { applySettings, normalizeSettings, settingColorSchemeManager } from '@/common/utils/settingUtils';
import i18n from '@/locales/i18n';

describe('normalizeSettings', () => {
  it.each([[undefined], [null], [{}]])('returns the defaults for %j', raw => {
    expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    const raw = { theme: 'dark', font: 'jetbrains-mono', language: 'ja', launchOnStartup: true };
    expect(normalizeSettings(raw)).toEqual(raw);
  });

  it.each(['zh-CN', 'zh-TW', 'ru', 'de'])('accepts the language %s', language => {
    expect(normalizeSettings({ language }).language).toBe(language);
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

  it('notifies the subscriber until it unsubscribes', () => {
    vi.spyOn(i18n, 'changeLanguage').mockResolvedValue(i18n.t);
    const onUpdate = vi.fn();
    settingColorSchemeManager.subscribe(onUpdate);

    applySettings({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect(onUpdate).toHaveBeenCalledWith('dark');

    settingColorSchemeManager.unsubscribe();
    applySettings({ ...DEFAULT_SETTINGS, theme: 'auto' });
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

  it('sets the scheme and the font variables', () => {
    applySettings({ ...DEFAULT_SETTINGS, theme: 'dark', font: 'arial' });

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
  ] as const)('language %s uses %s and not %s in the font family', (language, included, excluded) => {
    applySettings({ ...DEFAULT_SETTINGS, language });

    const family = document.documentElement.style.getPropertyValue('--mantine-font-family');
    expect(family).toBe(getFontFamily('nunito', language));
    expect(family).toContain(included);
    expect(family).not.toContain(excluded);
  });

  it.each(['en', 'zh-CN', 'zh-TW', 'ru', 'de'] as const)('sets <html lang> to %s', language => {
    applySettings({ ...DEFAULT_SETTINGS, language });
    expect(document.documentElement.lang).toBe(language);
  });

  it('changes the language only when it differs from the current one', () => {
    applySettings({ ...DEFAULT_SETTINGS, language: i18n.language as 'en' });
    expect(i18n.changeLanguage).not.toHaveBeenCalled();

    applySettings({ ...DEFAULT_SETTINGS, language: i18n.language === 'ja' ? 'vi' : 'ja' });
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
  ] as const)('theme %s with OS dark=%s sets %s on <html>', (theme, osDark, expected) => {
    mockPrefersDark(osDark);
    applySettings({ ...DEFAULT_SETTINGS, theme });
    expect(document.documentElement.getAttribute('data-mantine-color-scheme')).toBe(expected);
  });

  it('queries prefers-color-scheme dark only for auto', () => {
    mockPrefersDark(true);
    applySettings({ ...DEFAULT_SETTINGS, theme: 'light' });
    expect(window.matchMedia).not.toHaveBeenCalled();
    applySettings({ ...DEFAULT_SETTINGS, theme: 'auto' });
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
