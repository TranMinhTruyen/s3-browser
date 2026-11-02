import { afterEach, describe, expect, it } from 'vitest';
import { LANGUAGES } from '@/common/cnst/settingConst';
import i18n from '@/locales/i18n';

describe('i18n', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('supports every language of the settings', () => {
    expect(i18n.options.supportedLngs).toEqual(expect.arrayContaining([...LANGUAGES]));
    expect(i18n.options.load).toBe('currentOnly');
  });

  it.each([
    ['zh-CN', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['ru', 'ru'],
    ['de', 'de'],
  ])('keeps %s as the language and translates with its own resource', async (language, expected) => {
    await i18n.changeLanguage(language);

    expect(i18n.language).toBe(expected);
    expect(i18n.t('title', { ns: 'settingModal' })).toBe(i18n.getResource(language, 'settingModal', 'title') as string);
    expect(i18n.t('title', { ns: 'settingModal' })).not.toBe(i18n.getResource('en', 'settingModal', 'title'));
  });

  it('translates zh-TW to the traditional text, not the zh fallback', async () => {
    await i18n.changeLanguage('zh-TW');
    expect(i18n.t('title', { ns: 'settingModal' })).toBe('設定');
  });
});
