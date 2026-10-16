import { create } from 'zustand';

import { dict as enDict, type I18nKey } from './messages/en';
import { DEFAULT_LOCALE, detectInitialLocale, type Locale, writeStoredLocale } from './runtime';
import { isApplyingServerSettings, updateDesktopSettings } from '@/lib/persistence';

export type I18nParams = Record<string, string | number | boolean | null | undefined>;
export type I18nDictionary = Record<I18nKey, string>;

type I18nState = {
  locale: Locale;
  dictionary: I18nDictionary;
  loadingLocale: Locale | null;
  setLocale: (locale: Locale) => void;
};

const dictionaries = new Map<Locale, I18nDictionary>([[DEFAULT_LOCALE, enDict]]);

export function resetI18nDictionaryCacheForTests(): void {
  dictionaries.clear();
  dictionaries.set(DEFAULT_LOCALE, enDict);
}

async function loadDictionary(locale: Locale): Promise<I18nDictionary> {
  const cached = dictionaries.get(locale);
  if (cached) {
    return cached;
  }

  const mod = locale === 'zh-CN'
    ? await import('./messages/zh-CN') as { dict: I18nDictionary }
    : locale === 'fr'
      ? await import('./messages/fr') as { dict: I18nDictionary }
      : locale === 'nl'
        ? await import('./messages/nl') as { dict: I18nDictionary }
    : locale === 'zh-TW'
      ? await import('./messages/zh-TW') as { dict: I18nDictionary }
      : locale === 'es'
        ? await import('./messages/es') as { dict: I18nDictionary }
        : locale === 'pt-BR'
          ? await import('./messages/pt-BR') as { dict: I18nDictionary }
          : locale === 'uk'
            ? await import('./messages/uk') as { dict: I18nDictionary }
            : locale === 'ko'
              ? await import('./messages/ko') as { dict: I18nDictionary }
              : locale === 'pl'
                ? await import('./messages/pl') as { dict: I18nDictionary }
                : locale === 'de'
                  ? await import('./messages/de') as { dict: I18nDictionary }
                  : locale === 'ja'
                    ? await import('./messages/ja') as { dict: I18nDictionary }
                    : locale === 'tr'
                      ? await import('./messages/tr') as { dict: I18nDictionary }
                      : locale === 'ar'
                        ? await import('./messages/ar')
                        : locale === 'he'
                          ? await import('./messages/he')
                          : { dict: enDict };
  dictionaries.set(locale, mod.dict);
  return mod.dict;
}

export const useI18nStore = create<I18nState>()(() => ({
  locale: DEFAULT_LOCALE,
  dictionary: enDict,
  loadingLocale: null,
  setLocale: (locale) => applyLocale(locale, true),
}));

/** Apply a locale locally and persist user changes through profile settings. */
function applyLocale(locale: Locale, pushToServer: boolean): void {
  const current = useI18nStore.getState();
  const cached = dictionaries.get(locale);
  if (current.locale === locale && current.loadingLocale !== locale && cached) return;

  writeStoredLocale(locale);
  if (pushToServer && !isApplyingServerSettings()) {
    void updateDesktopSettings({ locale });
  }
  useI18nStore.setState({
    locale,
    dictionary: cached ?? current.dictionary,
    loadingLocale: cached ? null : locale,
  });
  if (cached) return;

  void loadDictionary(locale).then((dictionary) => {
    if (useI18nStore.getState().locale !== locale) return;
    useI18nStore.setState({ dictionary, loadingLocale: null });
  }).catch((error) => {
    console.error(`[i18n] failed to load locale ${locale}`, error);
    if (useI18nStore.getState().locale === locale) {
      useI18nStore.setState({ dictionary: enDict, loadingLocale: null });
    }
  });
}

export function initializeLocale(): void {
  // Initial locale selection is local-only; server settings hydrate later.
  applyLocale(detectInitialLocale(), false);
}

export function formatMessage(dictionary: I18nDictionary, key: I18nKey, params?: I18nParams): string {
  const template = dictionary[key] ?? enDict[key] ?? key;
  if (!params) {
    return template;
  }

  return template.replace(/\{([^{}]+)\}/g, (match, rawKey) => {
    const value = params[rawKey.trim()];
    return value === null || value === undefined ? match : String(value);
  });
}

export type { I18nKey, Locale };
