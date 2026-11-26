import type { CheckId, DiscrepancyCategory, EvidenceObject, SupportedLocale } from '../types';
import {
  formatCurrencyUsd,
  formatNumber,
  formatSignedNumber,
  translate,
} from './i18nCore';

export const CAUSE_TO_CHECK_ID: Record<DiscrepancyCategory, CheckId> = {
  UOM_MISMATCH: 'CHK_UOM_FACTOR',
  DUPLICATE_DISPATCH: 'CHK_DUP_DISPATCH',
  UNPOSTED_RECEIPT: 'CHK_UNPOSTED_RCV',
  UNRECORDED_TRANSFER: 'CHK_UNRECORDED_XFER',
  CUTOFF_TIMING: 'CHK_CUTOFF_WINDOW',
};

/**
 * Deterministic Narrator: renders localized narrative strictly from language-neutral EvidenceObject
 * using causeCode, checkId, and abstentionState templates.
 */
export function renderAutopsyNarrative(
  evidence: EvidenceObject,
  locale: SupportedLocale
): string {
  const checkText = translate(locale, `check.${evidence.checkId}`);

  let templateKey = `narrative.${evidence.causeCode}`;
  if (evidence.abstentionState === 'INSUFFICIENT_EVIDENCE') {
    templateKey = 'narrative.ABSTAIN_INSUFFICIENT';
  } else if (evidence.abstentionState === 'CONFLICTING_SIGNALS') {
    templateKey = 'narrative.ABSTAIN_CONFLICTING';
  }

  return translate(locale, templateKey, {
    caseId: evidence.caseId,
    sku: evidence.sku,
    warehouse: evidence.warehouse,
    docRef: evidence.docRef,
    expectedQty: formatNumber(locale, evidence.expectedQty),
    countedQty: formatNumber(locale, evidence.countedQty),
    varianceUnits: formatSignedNumber(locale, evidence.varianceUnits),
    varianceValue: formatCurrencyUsd(locale, Math.abs(evidence.varianceValue)),
    checkText,
    confidence: formatNumber(locale, evidence.confidence),
  });
}

export interface EntityValidationResult {
  valid: boolean;
  reasons: string[];
  extractedSkus: string[];
  extractedCaseIds: string[];
  extractedNumbers: number[];
}

/**
 * Language-independent Entity Validator (fail-closed):
 * Verifies every SKU, Case ID, Document Ref, and numeric quantity in a narrative exists
 * in the grounded EvidenceObject. Works identically across Latin, Cyrillic, Chinese, and Arabic.
 */
export function validateNarrativeEntities(
  narrative: string,
  evidence: EvidenceObject
): EntityValidationResult {
  const reasons: string[] = [];

  // 1. Check SKUs (e.g. SKU-2048, SKU-STD-1001)
  const skuMatches: string[] = narrative.match(/\bSKU-[A-Z0-9-]+\b/g) ?? [];
  for (const s of skuMatches) {
    if (s !== evidence.sku) {
      reasons.push(`Ungrounded SKU reference: ${s}`);
    }
  }
  if (!skuMatches.includes(evidence.sku)) {
    reasons.push(`Missing required grounded SKU: ${evidence.sku}`);
  }

  // 2. Check Case IDs (e.g. IA-024)
  const caseMatches: string[] = narrative.match(/\bIA-\d+\b/g) ?? [];
  for (const cid of caseMatches) {
    if (cid !== evidence.caseId) {
      reasons.push(`Ungrounded Case ID: ${cid}`);
    }
  }
  if (!caseMatches.includes(evidence.caseId)) {
    reasons.push(`Missing required Case ID: ${evidence.caseId}`);
  }

  // 3. Check Document Refs (GRN-1048, DSP-882, XFER-..., INIT-..., CC-...)
  const docMatches: string[] = narrative.match(/\b(?:GRN|DSP|XFER|INIT|CC|LOG|PO)-[A-Z0-9-]+\b/g) ?? [];
  for (const d of docMatches) {
    if (d !== evidence.docRef) {
      reasons.push(`Ungrounded Document Ref: ${d}`);
    }
  }

  // 4. Language-independent numeric token extraction (handles English comma 1,152,
  // Turkish/Spanish dot 1.152, Russian/Uzbek space 1 152, and Arabic-Indic digits).
  const normalizedDigits = narrative
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06F0));

  // Mask alphanumeric identifiers (SKU-..., IA-..., GRN-..., etc.) before extracting standalone numbers
  const withoutIds = normalizedDigits.replace(/\b[A-Z]+-[A-Z0-9-]+\b/g, ' ');
  const rawNumberTokens: string[] =
    withoutIds.match(/\d{1,3}(?:[.,\s\u00A0\u202F]\d{3})+|\d+(?:[.,]\d+)?/g) ?? [];

  const extractedNumbers = rawNumberTokens
    .map((tok) => {
      if (/^\d{1,3}(?:[.,\s\u00A0\u202F]\d{3})+$/.test(tok)) {
        return Number(tok.replace(/[.,\s\u00A0\u202F]/g, ''));
      }
      return Number(tok.replace(',', '.'));
    })
    .filter((n) => Number.isFinite(n));

  const allowedNumbers = new Set<number>([
    Math.abs(evidence.expectedQty),
    Math.abs(evidence.countedQty),
    Math.abs(evidence.varianceUnits),
    Math.abs(Math.round(evidence.varianceValue)),
    Math.abs(evidence.varianceValue),
    Math.abs(evidence.confidence),
  ]);

  for (const num of extractedNumbers) {
    if (!allowedNumbers.has(num)) {
      reasons.push(`Ungrounded numeric quantity: ${num}`);
    }
  }

  if (
    !extractedNumbers.includes(Math.abs(evidence.expectedQty)) ||
    !extractedNumbers.includes(Math.abs(evidence.countedQty))
  ) {
    reasons.push('Missing grounded expected or physical count quantity');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    extractedSkus: skuMatches,
    extractedCaseIds: caseMatches,
    extractedNumbers,
  };
}
