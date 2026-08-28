import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import englishResource from '@/locales/en/resource';

i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  resources: {
    en: englishResource,
  },
});

export { default } from 'i18next';
