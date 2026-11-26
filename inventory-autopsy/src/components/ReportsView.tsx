import React, { useState } from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { AutopsyBenchView } from './AutopsyBenchView';
import type { BenchmarkResult, WorkspaceState } from '../types';

interface ReportsViewProps {
  workspace: WorkspaceState;
  benchmark: BenchmarkResult;
  onRunBenchmark: () => Promise<void>;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  workspace,
  benchmark,
  onRunBenchmark,
}) => {
  const { t, fmtNumber, fmtCurrency } = useI18n();
  const [copied, setCopied] = useState(false);

  const resolvedExposure = workspace.cases
    .filter((c) => c.stage === 'verified')
    .reduce((acc, c) => acc + Math.abs(c.varianceValue), 0);
  const openExposure = workspace.cases
    .filter((c) => c.stage !== 'verified')
    .reduce((acc, c) => acc + Math.abs(c.varianceValue), 0);
  const pendingApprovalReqs = workspace.requests.filter(
    (r) => r.status === 'draft_awaiting_approval'
  );

  const summaryText = t('reports.briefingTemplate', {
    dataset: workspace.intake.datasetName,
    txns: fmtNumber(workspace.intake.transactionsAnalyzed),
    resolved: fmtCurrency(Math.round(resolvedExposure)),
    verified: fmtNumber(workspace.stats.verifiedResolutions),
    open: fmtCurrency(Math.round(openExposure)),
    active: fmtNumber(workspace.stats.activeInvestigations),
    pending: fmtNumber(pendingApprovalReqs.length),
    hours: fmtNumber(workspace.stats.estimatedEffortSavedHours),
  });

  const handleCopyBriefing = async () => {
    await navigator.clipboard.writeText(summaryText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Reporting Agent Management Briefing */}
      <section className="bg-[#121212] text-[#EBEBEB] border border-[#2A2A2A] rounded-lg p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-[#FF4B00] mt-0.5 shrink-0" />
            <div>
              <h2 className="text-lg font-semibold text-white">{t('reports.title')}</h2>
              <p className="text-xs text-[#B8B8B8] mt-1">{t('reports.sub')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCopyBriefing}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#121212] bg-[#FF4B00] rounded-md hover:bg-[#FF6321] transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t('reports.copiedBtn') : t('reports.copyBtn')}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
          <div className="bg-[#1C1C1C] border border-[#2E2E2E] rounded-md p-4">
            <div className="text-[#A3A3A3]">{t('reports.reconciledExp')}</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-white mt-1">
              {fmtCurrency(Math.round(resolvedExposure))}
            </div>
          </div>
          <div className="bg-[#1C1C1C] border border-[#2E2E2E] rounded-md p-4">
            <div className="text-[#A3A3A3]">{t('reports.unresolvedExp')}</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-[#FF4B00] mt-1">
              {fmtCurrency(Math.round(openExposure))}
            </div>
          </div>
          <div className="bg-[#1C1C1C] border border-[#2E2E2E] rounded-md p-4">
            <div className="text-[#A3A3A3]">{t('reports.requiredApprovals')}</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-white mt-1">
              {fmtNumber(pendingApprovalReqs.length)}
            </div>
          </div>
          <div className="bg-[#1C1C1C] border border-[#2E2E2E] rounded-md p-4">
            <div className="text-[#A3A3A3]">{t('reports.effortSaved')}</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-white mt-1">
              {fmtNumber(workspace.stats.estimatedEffortSavedHours)}
              {t('common.hoursShort')}
            </div>
          </div>
        </div>
      </section>

      {/* AutopsyBench: Swarm Edition & Trust Report */}
      <AutopsyBenchView benchmark={benchmark} onRunBenchmark={onRunBenchmark} />
    </div>
  );
};
