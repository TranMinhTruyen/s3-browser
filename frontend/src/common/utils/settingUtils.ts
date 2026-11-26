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
  UI_SIZE_FONT_PX,
  UI_SIZES,
  type UiSizeKey,
} from '@/common/cnst/settingConst';
import i18n, { loadLanguage } from '@/locales/i18n';

/** Trả về `value` nếu nó nằm trong `list`, nếu không thì trả về `fallback`. */
const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;

/** Thay các giá trị không xác định (file lỗi, phiên bản cũ) bằng mặc định để UI không nhận key không hợp lệ. */
export function normalizeSettings(raw?: Partial<Record<keyof AppSettingValues, unknown>> | null): AppSettingValues {
  return {
    theme: pick<ThemeKey>(THEMES, raw?.theme, DEFAULT_SETTINGS.theme),
    font: pick<FontKey>(FONTS, raw?.font, DEFAULT_SETTINGS.font),
    size: pick<UiSizeKey>(UI_SIZES, raw?.size, DEFAULT_SETTINGS.size),
    language: pick<LanguageKey>(LANGUAGES, raw?.language, DEFAULT_SETTINGS.language),
    launchOnStartup: raw?.launchOnStartup === true,
    autoUpdate: raw?.autoUpdate !== false,
    betaUpdate: raw?.betaUpdate === true,
  };
}

/** Trả về true nếu có thiết lập nào khác nhau giữa hai giá trị. */
export const isSettingDirty = (draft: AppSettingValues, applied: AppSettingValues): boolean =>
  (Object.keys(DEFAULT_SETTINGS) as (keyof AppSettingValues)[]).some(key => draft[key] !== applied[key]);

/** Trả về true nếu các tùy chọn cập nhật (tự động cập nhật, kênh beta) khác nhau giữa hai giá trị. */
export const isUpdateOptionsChanged = (a: AppSettingValues, b: AppSettingValues): boolean =>
  a.autoUpdate !== b.autoUpdate || a.betaUpdate !== b.betaUpdate;

let onSchemeChange: ((scheme: MantineColorScheme) => void) | null = null;
let currentScheme: MantineColorScheme = DEFAULT_SETTINGS.theme;

/** Bộ quản lý giao diện trong bộ nhớ: settings.json là nguồn dữ liệu duy nhất, không lưu gì vào localStorage. */
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

/** Giải quyết giá trị `auto` theo tùy chọn của hệ điều hành và ghi scheme lên <html> bằng thuộc tính Mantine sử dụng. */
function setSchemeAttribute(theme: ThemeKey): void {
  const dark = theme === 'auto' ? window.matchMedia('(prefers-color-scheme: dark)').matches : theme === 'dark';
  document.documentElement.setAttribute('data-mantine-color-scheme', dark ? 'dark' : 'light');
}

let languageRequest = 0;

/**
 * Áp dụng giao diện, phông chữ và ngôn ngữ cho ứng dụng đang chạy (dùng khi tải, xem trước và hoàn tác).
 * Thuộc tính scheme cũng được đặt trực tiếp ngay trước khi React mount (tránh lóe nền sáng trên hệ điều hành dùng giao diện tối).
 * Giao diện và phông chữ được áp dụng ngay; ngôn ngữ đổi sau khi tải xong bundle (trong lúc đó vẫn giữ ngôn ngữ cũ).
 * Hoàn tất khi đã ổn định ngôn ngữ; lời gọi mới sẽ thay thế lời gọi cũ vẫn đang tải.
 */
export async function applySettings(settings: AppSettingValues): Promise<void> {
  currentScheme = settings.theme;
  setSchemeAttribute(settings.theme);
  onSchemeChange?.(settings.theme);

  const family = getFontFamily(settings.font, settings.language);
  const style = document.documentElement.style;
  // Đổi phông chữ sẽ định kiểu lại toàn trang: chỉ ghi khi họ phông (kể cả phông dự phòng CJK) thực sự thay đổi.
  if (style.getPropertyValue('--mantine-font-family') !== family) {
    style.setProperty('--mantine-font-family', family);
    style.setProperty('--mantine-font-family-headings', family);
  }
  // Cỡ chữ gốc làm co giãn mọi giá trị rem; áp dụng quy tắc như với phông chữ: chỉ ghi khi có thay đổi.
  const fontSize = `${UI_SIZE_FONT_PX[settings.size]}px`;
  if (style.fontSize !== fontSize) {
    style.fontSize = fontSize;
    document.documentElement.dataset.uiSize = settings.size; // lets CSS target one size (small nudges xs labels)
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
