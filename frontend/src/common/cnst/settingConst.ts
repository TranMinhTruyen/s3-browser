export const THEMES = ['light', 'dark', 'auto'] as const;
export const LANGUAGES = ['en', 'vi', 'ja', 'zh-CN', 'zh-TW', 'ru', 'de'] as const;

/** Native language names, shown as-is so users can always find their own language. */
export const LANGUAGE_LABELS: Record<(typeof LANGUAGES)[number], string> = {
  en: 'English',
  vi: 'Tiếng Việt',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ru: 'Русский',
  de: 'Deutsch',
};

const JP_FONTS = '"Yu Gothic UI", "Hiragino Sans", "Noto Sans CJK JP", sans-serif';

/** CJK fallback per language so Han characters use the right regional glyphs; other languages keep the Japanese set. */
const CJK_FALLBACKS: Partial<Record<(typeof LANGUAGES)[number], string>> = {
  'zh-CN': '"Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  'zh-TW': '"Microsoft JhengHei UI", "PingFang TC", "Noto Sans CJK TC", sans-serif',
};

/** Selectable fonts: key (stored in settings.json) -> CSS font-family without the CJK fallback. */
const FONT_STACKS = {
  nunito: '"Nunito", -apple-system, BlinkMacSystemFont, "Segoe UI"',
  'system-ui': 'system-ui, -apple-system',
  'segoe-ui': '"Segoe UI"',
  arial: 'Arial',
  roboto: '"Roboto", Arial',
  'be-vietnam-pro': '"Be Vietnam Pro", "Segoe UI"',
  verdana: 'Verdana, Geneva',
  // Windows-only Japanese UI font; Meiryo (older Windows) and the regular CJK fallback cover other systems.
  'meiryo-ui': '"Meiryo UI", Meiryo',
  monospace: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  'jetbrains-mono': '"JetBrains Mono", ui-monospace, Consolas, monospace',
} as const;

export type FontKey = keyof typeof FONT_STACKS;

export const FONTS = Object.keys(FONT_STACKS) as FontKey[];

/** CSS font-family of a font, ending with the CJK fallback of the language. */
export const getFontFamily = (font: FontKey, language: (typeof LANGUAGES)[number]): string =>
  `${FONT_STACKS[font]}, ${CJK_FALLBACKS[language] ?? JP_FONTS}`;

/** Interface sizes in slider order. */
export const UI_SIZES = ['small', 'medium', 'large'] as const;
export type UiSizeKey = (typeof UI_SIZES)[number];

/** Root font-size per interface size; `medium` is the browser default, so the UI looks as before. */
export const UI_SIZE_FONT_PX: Record<UiSizeKey, number> = { small: 14, medium: 16, large: 18 };

export type ThemeKey = (typeof THEMES)[number];
export type LanguageKey = (typeof LANGUAGES)[number];
export interface AppSettingValues {
  theme: ThemeKey;
  font: FontKey;
  size: UiSizeKey;
  language: LanguageKey;
  launchOnStartup: boolean;
  /** Check for and download updates by itself; takes effect on Save only. */
  autoUpdate: boolean;
  /** Also take pre-release (beta) versions; takes effect on Save only. */
  betaUpdate: boolean;
}

export const DEFAULT_SETTINGS: AppSettingValues = {
  theme: 'light',
  font: 'nunito',
  size: 'medium',
  language: 'en',
  launchOnStartup: false,
  autoUpdate: true,
  betaUpdate: false,
};
