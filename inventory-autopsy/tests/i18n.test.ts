import assert from 'node:assert/strict';
import {
  LOCALE_BUNDLES,
  SUPPORTED_LOCALES,
  detectLocaleFromAcceptLanguage,
  getLocaleDir,
} from '../src/shared/i18nCore';
import {
  CAUSE_TO_CHECK_ID,
  renderAutopsyNarrative,
  validateNarrativeEntities,
} from '../src/shared/narrator';
import type { AbstentionState, DiscrepancyCategory, EvidenceObject, SupportedLocale } from '../src/types';

function extractPlaceholders(str: string): string[] {
  const matches = str.match(/\{[a-zA-Z0-9_]+\}/g) ?? [];
  return [...matches].sort();
}

function runI18nTests() {
  const enStrings = LOCALE_BUNDLES.en.strings;
  const enKeys = Object.keys(enStrings).sort();

  assert.ok(enKeys.length > 100, 'English master key set should contain all UI and domain keys');
  assert.equal(LOCALE_BUNDLES.en._meta.needsNativeReview, false);

  // 1. Key parity, placeholder parity, non-empty strings, and native-review flags
  for (const locale of SUPPORTED_LOCALES) {
    const bundle = LOCALE_BUNDLES[locale];
    assert.ok(bundle, `Missing locale bundle: ${locale}`);
    const keys = Object.keys(bundle.strings).sort();

    const missing = enKeys.filter((k) => !(k in bundle.strings));
    const extra = keys.filter((k) => !(k in enStrings));
    assert.deepEqual(missing, [], `Locale ${locale} is missing keys: ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `Locale ${locale} has unexpected extra keys: ${extra.join(', ')}`);

    if (locale !== 'en') {
      assert.equal(
        bundle._meta.needsNativeReview,
        true,
        `Locale ${locale} must set _meta.needsNativeReview = true`
      );
      assert.equal(
        bundle.needsNativeReview,
        'needs native review',
        `Locale ${locale} must include needsNativeReview flag`
      );
    }

    for (const key of enKeys) {
      const val = bundle.strings[key];
      assert.equal(typeof val, 'string', `${locale}.${key} must be a string`);
      assert.ok(val.trim().length > 0, `${locale}.${key} must not be empty`);

      const enPh = extractPlaceholders(enStrings[key]);
      const locPh = extractPlaceholders(val);
      assert.deepEqual(
        locPh,
        enPh,
        `Placeholder mismatch in ${locale}.${key}: expected ${JSON.stringify(enPh)}, got ${JSON.stringify(locPh)}`
      );
    }
  }

  // 2. RTL / LTR & Accept-Language detection checks
  assert.equal(getLocaleDir('ar'), 'rtl');
  assert.equal(getLocaleDir('en'), 'ltr');
  assert.equal(getLocaleDir('uz-Cyrl'), 'ltr');
  assert.equal(detectLocaleFromAcceptLanguage('uz-UZ,uz;q=0.9,en;q=0.8'), 'uz');
  assert.equal(detectLocaleFromAcceptLanguage('uz-Cyrl-UZ,ru;q=0.8'), 'uz-Cyrl');
  assert.equal(detectLocaleFromAcceptLanguage('kk-KZ,ru;q=0.7'), 'kk');
  assert.equal(detectLocaleFromAcceptLanguage('fr-FR,de;q=0.8'), 'en');

  // 3. Deterministic Narrator + Fail-Closed Entity Validator across ALL 9 locales & states
  const causes: DiscrepancyCategory[] = [
    'UOM_MISMATCH',
    'DUPLICATE_DISPATCH',
    'UNPOSTED_RECEIPT',
    'UNRECORDED_TRANSFER',
    'CUTOFF_TIMING',
  ];
  const abstentionStates: AbstentionState[] = [
    'NONE',
    'INSUFFICIENT_EVIDENCE',
    'CONFLICTING_SIGNALS',
  ];

  let renderedCount = 0;
  for (const locale of SUPPORTED_LOCALES as SupportedLocale[]) {
    for (const causeCode of causes) {
      for (const abstentionState of abstentionStates) {
        const ev: EvidenceObject = {
          caseId: 'IA-024',
          sku: 'SKU-2048',
          warehouse: 'WH-NORTH',
          causeCode,
          checkId: CAUSE_TO_CHECK_ID[causeCode],
          abstentionState,
          expectedQty: 144,
          countedQty: 192,
          varianceUnits: 48,
          varianceValue: 1152,
          docRef: 'GRN-1048',
          confidence: abstentionState === 'NONE' ? 91 : 64,
        };

        const narrative = renderAutopsyNarrative(ev, locale);
        assert.ok(narrative.length > 20, `Rendered narrative too short for ${locale}`);
        assert.equal(
          /\{[a-zA-Z0-9_]+\}/.test(narrative),
          false,
          `Unresolved placeholder in ${locale} narrative: ${narrative}`
        );

        const validCheck = validateNarrativeEntities(narrative, ev);
        assert.equal(
          validCheck.valid,
          true,
          `Entity validator rejected valid deterministic narrative in ${locale} (${causeCode}/${abstentionState}): ${validCheck.reasons.join('; ')} | Text: ${narrative}`
        );

        // Hallucination corpus must FAIL CLOSED in every single locale
        const hallucinatedSku = `${narrative} SKU-9999`;
        const hallucinatedQty = `${narrative} 777`;
        const hallucinatedCase = `${narrative} IA-999`;
        const hallucinatedDoc = `${narrative} GRN-9999`;

        assert.equal(
          validateNarrativeEntities(hallucinatedSku, ev).valid,
          false,
          `Hallucinated SKU failed to fail-closed in ${locale}`
        );
        assert.equal(
          validateNarrativeEntities(hallucinatedQty, ev).valid,
          false,
          `Hallucinated quantity failed to fail-closed in ${locale}`
        );
        assert.equal(
          validateNarrativeEntities(hallucinatedCase, ev).valid,
          false,
          `Hallucinated Case ID failed to fail-closed in ${locale}`
        );
        assert.equal(
          validateNarrativeEntities(hallucinatedDoc, ev).valid,
          false,
          `Hallucinated Document Ref failed to fail-closed in ${locale}`
        );

        renderedCount++;
      }
    }
  }

  console.log(
    `All i18n, placeholder parity, native-review flag, RTL, and narrator entity-grounding tests passed (${SUPPORTED_LOCALES.length} locales, ${enKeys.length} keys/locale, ${renderedCount} narrative checks + hallucination corpus).`
  );
}

runI18nTests();
