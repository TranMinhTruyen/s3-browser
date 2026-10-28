export const THEMES = ['light', 'dark', 'auto'] as const;
export const LANGUAGES = ['en', 'vi', 'ja'] as const;

/** Native language names, shown as-is so users can always find their own language. */
export const LANGUAGE_LABELS: Record<(typeof LANGUAGES)[number], string> = {
  en: 'English',
  vi: 'Tiếng Việt',
  ja: '日本語',
};

const CJK_FALLBACK = '"Yu Gothic UI", "Hiragino Sans", "Noto Sans CJK JP", sans-serif';

/** Selectable fonts: key (stored in settings.json) -> CSS font-family. System fonts end with a Japanese fallback. */
export const FONT_FAMILIES = {
  nunito: `"Nunito", -apple-system, BlinkMacSystemFont, "Segoe UI", ${CJK_FALLBACK}`,
  'system-ui': `system-ui, -apple-system, ${CJK_FALLBACK}`,
  'segoe-ui': `"Segoe UI", ${CJK_FALLBACK}`,
  arial: `Arial, ${CJK_FALLBACK}`,
  monospace: `ui-monospace, "Cascadia Mono", Consolas, monospace, ${CJK_FALLBACK}`,
  'jetbrains-mono': `"JetBrains Mono", ui-monospace, Consolas, monospace, ${CJK_FALLBACK}`,
} as const;

export type ThemeKey = (typeof THEMES)[number];
export type LanguageKey = (typeof LANGUAGES)[number];
export type FontKey = keyof typeof FONT_FAMILIES;

export const FONTS = Object.keys(FONT_FAMILIES) as FontKey[];

export interface AppSettingValues {
  theme: ThemeKey;
  font: FontKey;
  language: LanguageKey;
  launchOnStartup: boolean;
}

export const DEFAULT_SETTINGS: AppSettingValues = {
  theme: 'light',
  font: 'nunito',
  language: 'en',
  launchOnStartup: false,
};
