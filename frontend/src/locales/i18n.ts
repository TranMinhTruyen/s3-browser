import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES } from '@/common/cnst/settingConst';
import germanResource from '@/locales/de/resource';
import englishResource from '@/locales/en/resource';
import japaneseResource from '@/locales/ja/resource';
import russianResource from '@/locales/ru/resource';
import vietnameseResource from '@/locales/vi/resource';
import simplifiedChineseResource from '@/locales/zh-CN/resource';
import traditionalChineseResource from '@/locales/zh-TW/resource';

i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: [...LANGUAGES],
  load: 'currentOnly', // keep 'zh-CN' / 'zh-TW' as they are instead of also loading 'zh'
  interpolation: {
    escapeValue: false,
  },
  resources: {
    en: englishResource,
    vi: vietnameseResource,
    ja: japaneseResource,
    'zh-CN': simplifiedChineseResource,
    'zh-TW': traditionalChineseResource,
    ru: russianResource,
    de: germanResource,
  },
});

export { default } from 'i18next';
