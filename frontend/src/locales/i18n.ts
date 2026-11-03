import i18n, { type ResourceLanguage } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES, type LanguageKey } from '@/common/cnst/settingConst';
import englishResource from '@/locales/en/resource';

i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: [...LANGUAGES],
  load: 'currentOnly', // keep 'zh-CN' / 'zh-TW' as they are instead of also loading 'zh'
  interpolation: {
    escapeValue: false,
  },
  resources: { en: englishResource },
});

/** Dynamic imports, so Vite emits one chunk per language; `en` is already bundled. */
const RESOURCE_LOADERS: Record<Exclude<LanguageKey, 'en'>, () => Promise<{ default: ResourceLanguage }>> = {
  vi: () => import('@/locales/vi/resource'),
  ja: () => import('@/locales/ja/resource'),
  'zh-CN': () => import('@/locales/zh-CN/resource'),
  'zh-TW': () => import('@/locales/zh-TW/resource'),
  ru: () => import('@/locales/ru/resource'),
  de: () => import('@/locales/de/resource'),
};

const loadings = new Map<string, Promise<boolean>>();

/**
 * Registers the resource bundle of `lng` (loaded once, then cached).
 * Resolves false when the language is unsupported or its chunk fails to load, so the caller keeps the old language.
 */
export function loadLanguage(lng: string): Promise<boolean> {
  if (lng === 'en') {
    return Promise.resolve(true);
  }
  if (!Object.hasOwn(RESOURCE_LOADERS, lng)) {
    return Promise.resolve(false);
  }
  const loader = RESOURCE_LOADERS[lng as keyof typeof RESOURCE_LOADERS];
  let loading = loadings.get(lng);
  if (!loading) {
    loading = loader()
      .then(({ default: resource }) => {
        for (const [ns, bundle] of Object.entries(resource)) {
          i18n.addResourceBundle(lng, ns, bundle, true, true);
        }
        return true;
      })
      .catch(() => {
        loadings.delete(lng); // allow a retry
        return false;
      });
    loadings.set(lng, loading);
  }
  return loading;
}

export { default } from 'i18next';
