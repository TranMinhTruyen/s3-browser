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
import i18n from '@/locales/i18n';

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
  };
}

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

/**
 * Applies theme, font and language to the running app (used for load, preview and revert).
 * The scheme attribute is also set directly, so it is right before React mounts (no light flash on a dark OS).
 */
export function applySettings(settings: AppSettingValues): void {
  currentScheme = settings.theme;
  setSchemeAttribute(settings.theme);
  onSchemeChange?.(settings.theme);

  const family = getFontFamily(settings.font, settings.language);
  const style = document.documentElement.style;
  style.setProperty('--mantine-font-family', family);
  style.setProperty('--mantine-font-family-headings', family);
  document.documentElement.lang = settings.language;

  if (i18n.language !== settings.language) {
    i18n.changeLanguage(settings.language);
  }
}
