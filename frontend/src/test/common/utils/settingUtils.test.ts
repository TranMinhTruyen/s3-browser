import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, FONT_FAMILIES } from '@/common/cnst/settingConst';
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
    expect(style.getPropertyValue('--mantine-font-family')).toBe(FONT_FAMILIES.arial);
    expect(style.getPropertyValue('--mantine-font-family-headings')).toBe(FONT_FAMILIES.arial);
  });

  it('changes the language only when it differs from the current one', () => {
    applySettings({ ...DEFAULT_SETTINGS, language: i18n.language as 'en' });
    expect(i18n.changeLanguage).not.toHaveBeenCalled();

    applySettings({ ...DEFAULT_SETTINGS, language: i18n.language === 'ja' ? 'vi' : 'ja' });
    expect(i18n.changeLanguage).toHaveBeenCalledTimes(1);
  });
});
