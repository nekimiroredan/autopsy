import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  LOCALE_BUNDLES,
  SUPPORTED_LOCALES,
  formatCurrencyUsd,
  formatDateShort,
  formatNumber,
  formatSignedNumber,
  getLocaleDir,
  normalizeLocaleCode,
  translate,
} from '../shared/i18nCore';
import type { SupportedLocale } from '../types';

interface I18nContextValue {
  locale: SupportedLocale;
  dir: 'ltr' | 'rtl';
  setLocale: (next: SupportedLocale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  hasKey: (key: string) => boolean;
  fmtNumber: (n: number) => string;
  fmtSigned: (n: number) => string;
  fmtCurrency: (n: number) => string;
  fmtDate: (iso: string) => string;
  needsNativeReview: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readCookieLocale(): SupportedLocale | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)ia_lang=([^;]+)/);
  return match ? normalizeLocaleCode(decodeURIComponent(match[1])) : null;
}

function writeCookieLocale(locale: SupportedLocale) {
  if (typeof document === 'undefined') return;
  document.cookie = `ia_lang=${encodeURIComponent(locale)}; path=/; max-age=31536000; SameSite=Lax`;
}

function getInitialSyncLocale(): SupportedLocale {
  if (typeof window === 'undefined') return 'en';
  const params = new URLSearchParams(window.location.search);
  const queryLoc = normalizeLocaleCode(params.get('lang'));
  if (queryLoc) return queryLoc;

  const stored = normalizeLocaleCode(window.localStorage.getItem('ia_lang'));
  if (stored) return stored;

  const cookieLoc = readCookieLocale();
  if (cookieLoc) return cookieLoc;

  for (const navLang of navigator.languages || [navigator.language]) {
    const matched = normalizeLocaleCode(navLang);
    if (matched) return matched;
  }
  return 'en';
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<SupportedLocale>(getInitialSyncLocale);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryLoc = normalizeLocaleCode(params.get('lang'));
    const stored = normalizeLocaleCode(window.localStorage.getItem('ia_lang'));
    const cookieLoc = readCookieLocale();

    // If no explicit query/localStorage/cookie choice yet, consult server Accept-Language detection
    if (!queryLoc && !stored && !cookieLoc) {
      fetch('/api/i18n/detect')
        .then((r) => r.json())
        .then((data) => {
          const detected = normalizeLocaleCode(data?.locale);
          if (detected) setLocaleState(detected);
        })
        .catch(() => {
          // Keep navigator-detected or English fallback
        });
    } else if (queryLoc) {
      window.localStorage.setItem('ia_lang', queryLoc);
      writeCookieLocale(queryLoc);
    }
  }, []);

  useEffect(() => {
    const dir = getLocaleDir(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    window.localStorage.setItem('ia_lang', locale);
    writeCookieLocale(locale);
  }, [locale]);

  const setLocale = (next: SupportedLocale) => {
    setLocaleState(next);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState({}, '', url.toString());
  };

  const dir = getLocaleDir(locale);
  const needsNativeReview = Boolean(LOCALE_BUNDLES[locale]?._meta.needsNativeReview);

  return (
    <I18nContext.Provider
      value={{
        locale,
        dir,
        setLocale,
        t: (key, params) => translate(locale, key, params),
        hasKey: (key) => key in (LOCALE_BUNDLES[locale]?.strings ?? LOCALE_BUNDLES.en.strings) || key in LOCALE_BUNDLES.en.strings,
        fmtNumber: (n) => formatNumber(locale, n),
        fmtSigned: (n) => formatSignedNumber(locale, n),
        fmtCurrency: (n) => formatCurrencyUsd(locale, n),
        fmtDate: (iso) => formatDateShort(locale, iso),
        needsNativeReview,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

export { SUPPORTED_LOCALES, LOCALE_BUNDLES };
