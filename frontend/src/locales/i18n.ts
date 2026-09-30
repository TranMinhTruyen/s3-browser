import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import englishResource from '@/locales/en/resource';
import japaneseResource from '@/locales/ja/resource';
import vietnameseResource from '@/locales/vi/resource';

i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  resources: {
    en: englishResource,
    vi: vietnameseResource,
    ja: japaneseResource,
  },
});

export { default } from 'i18next';
