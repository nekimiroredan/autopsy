import 'dotenv/config';
import { GoogleGenAI, Type } from '@google/genai';
import {
  generateSample25kTransactions,
  generate_and_test_hypotheses,
  inspect_dataset,
  reconstruct_inventory,
} from '../src/server/forensicsEngine';
import { CAUSE_TO_CHECK_ID, validateNarrativeEntities } from '../src/shared/narrator';
import type { DiscrepancyCategory, EvidenceObject, LlmBaselineResult } from '../src/types';

/**
 * Optional Raw-CSV LLM Baseline Runner
 * Off by default. Requires GEMINI_API_KEY.
 * Sends the same synthetic discrepancy slice as raw CSV rows to Gemini and scores it
 * with the same root-cause accuracy, numerical accuracy, abstention, and entity validator metrics.
 */
export async function runLiveLlmCsvBaseline(): Promise<LlmBaselineResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Export GEMINI_API_KEY before running the optional raw-CSV LLM baseline.'
    );
  }

  const rawRows = generateSample25kTransactions();
  const { normalized } = inspect_dataset(rawRows, 'AutopsyBench_LLM_Baseline.csv');
  const discrepancies = reconstruct_inventory(normalized);

  // Extract raw CSV lines strictly for the discrepancy SKUs so the prompt mirrors sending the raw CSV
  const targetSkus = new Set(discrepancies.map((d) => d.sku));
  const relevantRows = rawRows.filter((r) => targetSkus.has(String(r.Item_Code)));
  const header = Object.keys(relevantRows[0]).join(',');
  const csvBody = relevantRows
    .map((r) => Object.values(r).map((v) => JSON.stringify(v ?? '')).join(','))
    .join('\n');
  const csvPayload = `${header}\n${csvBody}`;

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Analyze this raw inventory CSV export and identify the root-cause category, expected balance, physical count, and variance for each SKU with a cycle-count discrepancy.
Allowed cause_code values: UNPOSTED_RECEIPT, DUPLICATE_DISPATCH, UOM_MISMATCH, CUTOFF_TIMING, UNRECORDED_TRANSFER.
Set abstain=true if uncertain.

Raw CSV:
${csvPayload}`,
    config: {
      systemInstruction:
        'You are a baseline raw-CSV analyzer. Return structured JSON predictions only based on the CSV rows.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            sku: { type: Type.STRING },
            cause_code: { type: Type.STRING },
            expected_qty: { type: Type.NUMBER },
            counted_qty: { type: Type.NUMBER },
            abstain: { type: Type.BOOLEAN },
            summary: { type: Type.STRING },
          },
        },
      },
    },
  });

  const predictions = JSON.parse((response.text ?? '[]').trim()) as Array<{
    sku: string;
    cause_code: string;
    expected_qty: number;
    counted_qty: number;
    abstain?: boolean;
    summary?: string;
  }>;

  let causeCorrect = 0;
  let numericCorrect = 0;
  let entityPass = 0;
  let abstained = 0;

  discrepancies.forEach((d, idx) => {
    const { category, hypotheses } = generate_and_test_hypotheses(d, idx);
    const pred = predictions.find((p) => p.sku === d.sku);
    if (!pred) return;
    if (pred.abstain) abstained++;
    if (pred.cause_code === category) causeCorrect++;
    if (pred.expected_qty === d.expectedQty && pred.counted_qty === d.countedQty) {
      numericCorrect++;
    }

    const ev: EvidenceObject = {
      caseId: `IA-${String(101 + idx).padStart(3, '0')}`,
      sku: d.sku,
      warehouse: d.warehouse,
      causeCode: category as DiscrepancyCategory,
      checkId: CAUSE_TO_CHECK_ID[category as DiscrepancyCategory],
      abstentionState: 'NONE',
      expectedQty: d.expectedQty,
      countedQty: d.countedQty,
      varianceUnits: d.varianceUnits,
      varianceValue: d.varianceValue,
      docRef: d.ledgerTrace[d.ledgerTrace.length - 1]?.docRef ?? 'DOC-1',
      confidence: hypotheses[0]?.confidence ?? 80,
    };

    const validation = validateNarrativeEntities(
      `${ev.caseId} ${pred.sku} ${pred.expected_qty} ${pred.counted_qty} ${pred.summary ?? ''}`,
      ev
    );
    if (validation.valid) entityPass++;
  });

  const total = Math.max(1, discrepancies.length);
  return {
    ranAt: new Date().toISOString(),
    model: 'gemini-4-hydrogen (raw-CSV baseline)',
    scenariosScored: discrepancies.length,
    rootCauseAccuracy: Math.round((causeCorrect / total) * 1000) / 10,
    numericalAccuracy: Math.round((numericCorrect / total) * 1000) / 10,
    entityValidationPassRate: Math.round((entityPass / total) * 1000) / 10,
    abstentionRate: Math.round((abstained / total) * 1000) / 10,
    sampleRowsSent: relevantRows.length,
  };
}

// Allow direct CLI execution: npx tsx scripts/run_llm_baseline.ts
const isCli =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('run_llm_baseline.ts');

if (isCli) {
  runLiveLlmCsvBaseline()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
