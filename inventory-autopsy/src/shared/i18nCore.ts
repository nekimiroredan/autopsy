import en from '../locales/en.json';
import uz from '../locales/uz.json';
import uzCyrl from '../locales/uz-Cyrl.json';
import ru from '../locales/ru.json';
import tr from '../locales/tr.json';
import kk from '../locales/kk.json';
import zh from '../locales/zh.json';
import es from '../locales/es.json';
import ar from '../locales/ar.json';
import type { SupportedLocale } from '../types';

export interface LocaleBundle {
  _meta: {
    locale: string;
    nativeName: string;
    dir: 'ltr' | 'rtl';
    needsNativeReview: boolean;
    reviewNote?: string;
  };
  needsNativeReview?: string;
  strings: Record<string, string>;
}

export const LOCALE_BUNDLES: Record<SupportedLocale, LocaleBundle> = {
  en: en as LocaleBundle,
  uz: uz as LocaleBundle,
  'uz-Cyrl': uzCyrl as LocaleBundle,
  ru: ru as LocaleBundle,
  tr: tr as LocaleBundle,
  kk: kk as LocaleBundle,
  zh: zh as LocaleBundle,
  es: es as LocaleBundle,
  ar: ar as LocaleBundle,
};

export const SUPPORTED_LOCALES: SupportedLocale[] = [
  'en',
  'uz',
  'uz-Cyrl',
  'ru',
  'tr',
  'kk',
  'zh',
  'es',
  'ar',
];

export function normalizeLocaleCode(raw?: string | null): SupportedLocale | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const exact = SUPPORTED_LOCALES.find(
    (loc) => loc.toLowerCase() === cleaned.toLowerCase()
  );
  if (exact) return exact;

  const lower = cleaned.toLowerCase();
  if (lower.startsWith('uz-cyrl') || lower === 'uz_cyrl') return 'uz-Cyrl';
  if (lower.startsWith('uz')) return 'uz';
  if (lower.startsWith('ru')) return 'ru';
  if (lower.startsWith('tr')) return 'tr';
  if (lower.startsWith('kk') || lower.startsWith('kz')) return 'kk';
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('es')) return 'es';
  if (lower.startsWith('ar')) return 'ar';
  if (lower.startsWith('en')) return 'en';
  return null;
}

export function detectLocaleFromAcceptLanguage(
  acceptLanguage?: string | null
): SupportedLocale {
  if (!acceptLanguage) return 'en';
  const candidates = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, qPart] = part.trim().split(';');
      const q = qPart && qPart.startsWith('q=') ? Number(qPart.slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const c of candidates) {
    const matched = normalizeLocaleCode(c.tag);
    if (matched) return matched;
  }
  return 'en';
}

export function getLocaleDir(locale: SupportedLocale): 'ltr' | 'rtl' {
  return LOCALE_BUNDLES[locale]?._meta.dir ?? 'ltr';
}

export function translate(
  locale: SupportedLocale,
  key: string,
  params?: Record<string, string | number>
): string {
  const bundle = LOCALE_BUNDLES[locale] ?? LOCALE_BUNDLES.en;
  let template = bundle.strings[key] ?? LOCALE_BUNDLES.en.strings[key] ?? key;

  if (params) {
    for (const [paramKey, val] of Object.entries(params)) {
      template = template.split(`{${paramKey}}`).join(String(val));
    }
  }
  return template;
}

function toIntlLocale(locale: SupportedLocale): string {
  // Always use Latin-script Western digits (u-nu-latn) for Arabic so numeric tokens stay unambiguous
  // across tabular grids and deterministic entity validators, while keeping localized separators.
  if (locale === 'ar') return 'ar-u-nu-latn';
  if (locale === 'uz-Cyrl') return 'uz-Cyrl-UZ';
  if (locale === 'uz') return 'uz-Latn-UZ';
  return locale;
}

export function formatNumber(locale: SupportedLocale, value: number): string {
  return new Intl.NumberFormat(toIntlLocale(locale)).format(value);
}

export function formatSignedNumber(locale: SupportedLocale, value: number): string {
  const formatted = new Intl.NumberFormat(toIntlLocale(locale)).format(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

export function formatCurrencyUsd(locale: SupportedLocale, value: number): string {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDateShort(locale: SupportedLocale, isoDate: string): string {
  const d = new Date(isoDate.length === 10 ? `${isoDate}T00:00:00Z` : isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(d);
}
