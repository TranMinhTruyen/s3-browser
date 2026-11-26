export const THEMES = ['light', 'dark', 'auto'] as const;
export const LANGUAGES = ['en', 'vi', 'ja', 'zh-CN', 'zh-TW', 'ru', 'de'] as const;

/** Tên ngôn ngữ nguyên bản, giữ nguyên để người dùng luôn nhận ra ngôn ngữ của mình. */
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

/** Phông dự phòng CJK theo từng ngôn ngữ để chữ Hán dùng đúng dạng ký tự theo vùng; các ngôn ngữ khác giữ bộ phông tiếng Nhật. */
const CJK_FALLBACKS: Partial<Record<(typeof LANGUAGES)[number], string>> = {
  'zh-CN': '"Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  'zh-TW': '"Microsoft JhengHei UI", "PingFang TC", "Noto Sans CJK TC", sans-serif',
};

/** Các phông có thể chọn: key (lưu trong settings.json) -> CSS font-family chưa kèm phông dự phòng CJK. */
const FONT_STACKS = {
  nunito: '"Nunito", -apple-system, BlinkMacSystemFont, "Segoe UI"',
  'system-ui': 'system-ui, -apple-system',
  'segoe-ui': '"Segoe UI"',
  arial: 'Arial',
  roboto: '"Roboto", Arial',
  'be-vietnam-pro': '"Be Vietnam Pro", "Segoe UI"',
  verdana: 'Verdana, Geneva',
  // Phông giao diện tiếng Nhật chỉ có trên Windows; Meiryo (Windows cũ) và phông CJK thông thường hỗ trợ các hệ thống khác.
  'meiryo-ui': '"Meiryo UI", Meiryo',
  monospace: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  'jetbrains-mono': '"JetBrains Mono", ui-monospace, Consolas, monospace',
} as const;

export type FontKey = keyof typeof FONT_STACKS;

export const FONTS = Object.keys(FONT_STACKS) as FontKey[];

/** CSS font-family của một phông chữ, kết thúc bằng phông CJK dự phòng của ngôn ngữ. */
export const getFontFamily = (font: FontKey, language: (typeof LANGUAGES)[number]): string =>
  `${FONT_STACKS[font]}, ${CJK_FALLBACKS[language] ?? JP_FONTS}`;

/** Các cỡ giao diện theo thứ tự trên thanh trượt. */
export const UI_SIZES = ['small', 'medium', 'large'] as const;
export type UiSizeKey = (typeof UI_SIZES)[number];

/** Cỡ phông gốc ứng với từng cỡ giao diện; `medium` là mặc định của trình duyệt nên giao diện giữ nguyên như trước. */
export const UI_SIZE_FONT_PX: Record<UiSizeKey, number> = { small: 14, medium: 16, large: 18 };

export type ThemeKey = (typeof THEMES)[number];
export type LanguageKey = (typeof LANGUAGES)[number];
export interface AppSettingValues {
  theme: ThemeKey;
  font: FontKey;
  size: UiSizeKey;
  language: LanguageKey;
  launchOnStartup: boolean;
  /** Tự kiểm tra và tải bản cập nhật; chỉ có hiệu lực sau khi lưu. */
  autoUpdate: boolean;
  /** Bao gồm cả bản phát hành thử nghiệm (beta); chỉ có hiệu lực sau khi lưu. */
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
