import type { MantineColorScheme, MantineColorSchemeManager } from '@mantine/core';
import {
  type AppSettingValues,
  DEFAULT_SETTINGS,
  FONTS,
  type FontKey,
  getFontFamily,
  LANGUAGES,
  type LanguageKey,
  THEMES,
  type ThemeKey,
} from '@/common/cnst/settingConst';
import i18n, { loadLanguage } from '@/locales/i18n';

/** Returns `value` when it is one of `list`, otherwise `fallback`. */
const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;

/** Replaces unknown values (bad file, old version) with the defaults so the UI never gets an invalid key. */
export function normalizeSettings(raw?: Partial<Record<keyof AppSettingValues, unknown>> | null): AppSettingValues {
  return {
    theme: pick<ThemeKey>(THEMES, raw?.theme, DEFAULT_SETTINGS.theme),
    font: pick<FontKey>(FONTS, raw?.font, DEFAULT_SETTINGS.font),
    language: pick<LanguageKey>(LANGUAGES, raw?.language, DEFAULT_SETTINGS.language),
    launchOnStartup: raw?.launchOnStartup === true,
    autoUpdate: raw?.autoUpdate !== false,
    betaUpdate: raw?.betaUpdate === true,
  };
}

/** True when any setting differs between the two values. */
export const isSettingDirty = (draft: AppSettingValues, applied: AppSettingValues): boolean =>
  (Object.keys(DEFAULT_SETTINGS) as (keyof AppSettingValues)[]).some(key => draft[key] !== applied[key]);

/** True when the update switches (auto update, beta channel) differ between the two values. */
export const isUpdateOptionsChanged = (a: AppSettingValues, b: AppSettingValues): boolean =>
  a.autoUpdate !== b.autoUpdate || a.betaUpdate !== b.betaUpdate;

let onSchemeChange: ((scheme: MantineColorScheme) => void) | null = null;
let currentScheme: MantineColorScheme = DEFAULT_SETTINGS.theme;

/** In-memory scheme manager: settings.json is the only source of truth, nothing goes to localStorage. */
export const settingColorSchemeManager: MantineColorSchemeManager = {
  get: () => currentScheme,
  set: value => {
    currentScheme = value;
  },
  subscribe: onUpdate => {
    onSchemeChange = onUpdate;
  },
  unsubscribe: () => {
    onSchemeChange = null;
  },
  clear: () => {
    currentScheme = DEFAULT_SETTINGS.theme;
  },
};

/** Resolves `auto` with the OS preference and writes the scheme on <html>, the same attribute Mantine uses. */
function setSchemeAttribute(theme: ThemeKey): void {
  const dark = theme === 'auto' ? window.matchMedia('(prefers-color-scheme: dark)').matches : theme === 'dark';
  document.documentElement.setAttribute('data-mantine-color-scheme', dark ? 'dark' : 'light');
}

let languageRequest = 0;

/**
 * Applies theme, font and language to the running app (used for load, preview and revert).
 * The scheme attribute is also set directly, so it is right before React mounts (no light flash on a dark OS).
 * Theme and font apply at once; the language switches after its bundle is loaded (the old one stays meanwhile).
 * Resolves when the language is settled; a newer call supersedes an older one still loading.
 */
export async function applySettings(settings: AppSettingValues): Promise<void> {
  currentScheme = settings.theme;
  setSchemeAttribute(settings.theme);
  onSchemeChange?.(settings.theme);

  const family = getFontFamily(settings.font, settings.language);
  const style = document.documentElement.style;
  // A font change restyles the whole page: write it only when the family (incl. CJK fallback) really changed.
  if (style.getPropertyValue('--mantine-font-family') !== family) {
    style.setProperty('--mantine-font-family', family);
    style.setProperty('--mantine-font-family-headings', family);
  }
  document.documentElement.lang = settings.language;

  const request = ++languageRequest;
  const loaded = await loadLanguage(settings.language);
  if (request !== languageRequest) {
    return;
  }
  if (!loaded) {
    document.documentElement.lang = i18n.language; // load failed: the old language stays, so does <html lang>
  } else if (i18n.language !== settings.language) {
    await i18n.changeLanguage(settings.language);
  }
}
