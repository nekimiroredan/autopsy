import React, { useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Play, RotateCcw, Upload } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { localizeActivityEvent } from '../i18n/domainText';
import type { WorkspaceState } from '../types';

interface IntakeUploadViewProps {
  workspace: WorkspaceState;
  onWorkspaceUpdated: (next: WorkspaceState) => void;
  onGoToControlCenter: () => void;
}

const SAMPLE_CSV_CONTENT = `Txn_Date,Item_Code,Description,Movement_Type,Qty_Delta,Doc_Ref,Warehouse,Bin_Loc,Unit_Cost,Physical_Count
2026-11-01,SKU-2048,Industrial Hydraulic Valve 3/4",OPENING,120,INIT-2048,WH-NORTH,B-14,24,
2026-11-20,SKU-2048,Industrial Hydraulic Valve 3/4",DISPATCH,-24,DSP-4102,WH-NORTH,B-14,24,
2026-11-22,SKU-2048,Industrial Hydraulic Valve 3/4",RECEIPT,48,GRN-1048,WH-NORTH,B-14,24,192
2026-11-01,SKU-4419,Heavy-Duty Bearing Assembly #6205,OPENING,120,INIT-4419,WH-CENTRAL,C-02,52,
2026-11-22,SKU-4419,Heavy-Duty Bearing Assembly #6205,DISPATCH,-30,DSP-882,WH-CENTRAL,C-02,52,
2026-11-22,SKU-4419,Heavy-Duty Bearing Assembly #6205,DISPATCH,-30,DSP-882,WH-CENTRAL,C-02,52,90
2026-11-01,SKU-6180,Thermal Overload Relay 18-25A,OPENING,84,INIT-6180,WH-SOUTH,E-04,65,
2026-11-21,SKU-6180,Thermal Overload Relay 18-25A,DISPATCH,-12,DSP-4311,WH-SOUTH,E-04,65,54
2026-11-01,SKU-3104,Stainless Flange Gasket Kit (24pk),OPENING,134,INIT-3104,WH-NORTH,A-08,38,
2026-11-21,SKU-3104,Stainless Flange Gasket Kit (24pk),DISPATCH,-24,DSP-4189,WH-NORTH,A-08,38,146
`;

const CANONICAL_EXPORT_HEADERS = [
  'Case_ID',
  'SKU',
  'Product_Name',
  'Warehouse',
  'Cause_Code',
  'Ledger_Balance',
  'Physical_Count',
  'Variance_Units',
  'Exposure_USD',
  'Stage',
  'Confidence_Pct',
];

const LOCALIZED_HEADER_KEYS = [
  'export.col.caseId',
  'export.col.sku',
  'export.col.productName',
  'export.col.warehouse',
  'export.col.causeCode',
  'export.col.expectedQty',
  'export.col.countedQty',
  'export.col.varianceUnits',
  'export.col.varianceValue',
  'export.col.stage',
  'export.col.confidence',
];

export const IntakeUploadView: React.FC<IntakeUploadViewProps> = ({
  workspace,
  onWorkspaceUpdated,
  onGoToControlCenter,
}) => {
  const { locale, t, hasKey, fmtNumber } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const processFile = async (file: File) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Content = btoa(binary);

      const res = await fetch('/api/intake/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, base64Content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || t('intake.dropSub'));
      } else {
        onWorkspaceUpdated(data);
      }
    } catch {
      setErrorMsg(t('intake.dropSub'));
    } finally {
      setLoading(false);
    }
  };

  const handleRun25kSample = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/intake/sample-25k', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) setErrorMsg(data.error || t('intake.dropSub'));
      else onWorkspaceUpdated(data);
    } catch {
      setErrorMsg(t('intake.dropSub'));
    } finally {
      setLoading(false);
    }
  };

  const handleResetDemo = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/workspace/reset', { method: 'POST' });
      const data = await res.json();
      onWorkspaceUpdated(data);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadSampleCsv = () => {
    const blob = new Blob([SAMPLE_CSV_CONTENT], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_inventory_ledger.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCasesCsv = (useLocalizedHeaders: boolean) => {
    const headers = useLocalizedHeaders
      ? LOCALIZED_HEADER_KEYS.map((k) => t(k))
      : CANONICAL_EXPORT_HEADERS;

    const escapeCsv = (val: string | number) => {
      const str = String(val);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const rows = workspace.cases.map((c) =>
      [
        c.id,
        c.sku,
        c.productName,
        c.warehouse,
        useLocalizedHeaders ? t(`cause.${c.category}`) : c.category,
        c.expectedQty,
        c.countedQty,
        c.varianceUnits,
        c.varianceValue,
        useLocalizedHeaders ? t(`pipeline.${c.stage}`) : c.stage,
        c.hypotheses[0]?.confidence ?? 0,
      ]
        .map(escapeCsv)
        .join(',')
    );

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = useLocalizedHeaders
      ? `inventory_autopsy_cases_${locale}.csv`
      : 'inventory_autopsy_cases_en.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Hero Upload & Autonomous Loop Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Upload Zone */}
        <section className="lg:col-span-6 bg-white border border-[#D4D4D4] rounded-lg p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#121212]">{t('intake.title')}</h2>
            <p className="text-sm text-[#525252] mt-1">{t('intake.desc')}</p>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const f = e.dataTransfer.files?.[0];
                if (f) processFile(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-5 border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragActive
                  ? 'border-[#FF4B00] bg-[#FF4B00]/10'
                  : 'border-[#B8B8B8] hover:border-[#121212] bg-[#F5F5F5]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) processFile(f);
                }}
              />
              <FileSpreadsheet className="w-8 h-8 text-[#FF4B00] mx-auto" />
              <div className="mt-3 text-sm font-semibold text-[#121212]">
                {loading ? t('intake.dropLoading') : t('intake.dropReady')}
              </div>
              <div className="mt-1 text-xs text-[#525252]">{t('intake.dropSub')}</div>
            </div>

            {errorMsg && (
              <div className="mt-4 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800">
                {errorMsg}
              </div>
            )}
          </div>

          <div className="mt-6 pt-5 border-t border-[#D4D4D4] space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={loading}
                onClick={handleRun25kSample}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#121212] bg-[#FF4B00] rounded-md hover:bg-[#FF6321] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5" />
                {t('intake.run25k')}
              </button>

              <button
                type="button"
                onClick={handleDownloadSampleCsv}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#121212] bg-white border border-[#D4D4D4] rounded-md hover:bg-[#EBEBEB] transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                {t('intake.downloadCsv')}
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={handleResetDemo}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#525252] hover:text-[#121212] transition-colors whitespace-nowrap shrink-0 ms-auto"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('intake.reset')}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-[#EBEBEB]">
              <button
                type="button"
                onClick={() => handleExportCasesCsv(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#121212] bg-[#EBEBEB] rounded-md hover:bg-[#DCDCDC] transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                {t('intake.exportCanonical')}
              </button>
              {locale !== 'en' && (
                <button
                  type="button"
                  onClick={() => handleExportCasesCsv(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#121212] bg-[#EBEBEB] rounded-md hover:bg-[#DCDCDC] transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  {t('intake.exportLocalized')}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Autonomous Resolution Loop Summary (single-elevation hairline strip + divider list) */}
        <section className="lg:col-span-6 bg-white border border-[#D4D4D4] rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-[#121212]">{t('intake.loopTitle')}</h2>
              <span className="text-xs font-semibold text-[#CC3B00] shrink-0">
                {workspace.stats.humanActionsNeeded > 0
                  ? t('intake.loopApproval')
                  : t('intake.loopVerified')}
              </span>
            </div>
            <p className="text-xs text-[#525252] mt-1 font-mono truncate">
              {t('intake.activeDataset', { dataset: workspace.intake.datasetName })}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#D4D4D4] bg-[#F5F5F5] border border-[#D4D4D4] rounded-md mt-5">
              <div className="p-3">
                <div className="text-[11px] text-[#525252]">{t('intake.metric.txns')}</div>
                <div className="text-xl font-semibold font-mono tabular-nums text-[#121212] mt-0.5">
                  {fmtNumber(workspace.intake.transactionsAnalyzed)}
                </div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-[#525252]">{t('intake.metric.disc')}</div>
                <div className="text-xl font-semibold font-mono tabular-nums text-[#121212] mt-0.5">
                  {fmtNumber(workspace.intake.discrepanciesFound)}
                </div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-[#525252]">{t('intake.metric.inv')}</div>
                <div className="text-xl font-semibold font-mono tabular-nums text-[#121212] mt-0.5">
                  {fmtNumber(workspace.intake.groupedInvestigations)}
                </div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-[#525252]">{t('intake.metric.req')}</div>
                <div className="text-xl font-semibold font-mono tabular-nums text-[#CC3B00] mt-0.5">
                  {fmtNumber(workspace.intake.evidenceRequestsNeeded)}
                </div>
              </div>
            </div>

            <div className="mt-5 divide-y divide-[#EBEBEB]">
              {workspace.activity.slice(0, 5).map((item) => {
                const localized = localizeActivityEvent(item, t, hasKey, fmtNumber);
                return (
                  <div key={item.id} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <CheckCircle2
                        className={`w-4 h-4 mt-0.5 shrink-0 ${
                          item.phase === 'attention' ? 'text-[#CC3B00]' : 'text-[#121212]'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#121212]">{localized.title}</div>
                        <div className="text-xs text-[#525252] truncate">{localized.detail}</div>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-[#525252] shrink-0">{item.toolName}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-[#D4D4D4] flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-[#525252]">
              {t('intake.hypothesesEvaluated', {
                count: fmtNumber(workspace.intake.hypothesesEvaluated),
              })}
            </div>
            <button
              type="button"
              onClick={onGoToControlCenter}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#121212] rounded-md hover:bg-[#2A2A2A] transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              {t('intake.reviewControl')}
            </button>
          </div>
        </section>
      </div>

      {/* Schema Normalization Table */}
      <section className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-[#D4D4D4] flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#121212]">{t('intake.schemaTitle')}</h3>
            <p className="text-xs text-[#525252] mt-0.5">{t('intake.schemaSub')}</p>
          </div>
          <span className="text-xs text-[#525252] font-mono tabular-nums shrink-0">
            {t('intake.fieldsMapped', {
              count: fmtNumber(Object.keys(workspace.intake.columnMapping).length),
            })}
          </span>
        </div>

        <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Object.entries(workspace.intake.columnMapping).map(([canonical, source]) => (
            <div key={canonical} className="bg-[#F5F5F5] rounded-md px-3.5 py-2.5">
              <div className="text-[11px] text-[#525252] font-mono">{canonical}</div>
              <div className="text-xs font-semibold text-[#121212] mt-0.5 truncate">{source}</div>
            </div>
          ))}
        </div>

        {workspace.intake.warnings.length > 0 && (
          <div className="px-5 pb-4">
            <div className="p-3 rounded-md bg-[#FFF4EE] border border-[#FF4B00]/40 text-xs text-[#121212] space-y-1">
              {workspace.intake.warnings.map((w, idx) => (
                <div key={idx}>{w}</div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
