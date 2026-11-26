import React, { useEffect, useState } from 'react';
import { ControlCenterView } from './ControlCenterView';
import { EvidenceLabView } from './EvidenceLabView';
import { IntakeUploadView } from './IntakeUploadView';
import { useI18n } from '../i18n/I18nContext';
import type { WorkspaceState } from '../types';

export type InvestigationsSubTab = 'cases' | 'evidence' | 'intake';

interface InvestigationsViewProps {
  workspace: WorkspaceState;
  initialSubTab?: InvestigationsSubTab;
  focusedRequestId?: string;
  focusedCaseId?: string;
  onApproveRequest: (requestId: string) => Promise<void>;
  onRemindRequest: (requestId: string) => Promise<void>;
  onSubmitVerification: (token: string, selectedAnswer: string, employeeNote: string) => Promise<void>;
  onVerifyCaseResolution: (caseId: string) => Promise<void>;
  onWorkspaceUpdated: (next: WorkspaceState) => void;
  busyActionId: string | null;
}

export const InvestigationsView: React.FC<InvestigationsViewProps> = ({
  workspace,
  initialSubTab = 'cases',
  focusedRequestId,
  focusedCaseId,
  onApproveRequest,
  onRemindRequest,
  onSubmitVerification,
  onVerifyCaseResolution,
  onWorkspaceUpdated,
  busyActionId,
}) => {
  const { t, fmtNumber } = useI18n();
  const [subTab, setSubTab] = useState<InvestigationsSubTab>(initialSubTab);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  return (
    <div className="space-y-6">
      {/* Clean Underline Workspace Sub-Navigation */}
      <div className="border-b border-[#D4D4D4] flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-6">
          <button
            type="button"
            onClick={() => setSubTab('cases')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'cases'
                ? 'border-[#FF4B00] text-[#121212]'
                : 'border-transparent text-[#525252] hover:text-[#121212]'
            }`}
          >
            {t('ledger.title')} ({fmtNumber(workspace.cases.length)})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('evidence')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'evidence'
                ? 'border-[#FF4B00] text-[#121212]'
                : 'border-transparent text-[#525252] hover:text-[#121212]'
            }`}
          >
            {t('nav.evidence')} ({fmtNumber(workspace.requests.length)})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('intake')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'intake'
                ? 'border-[#FF4B00] text-[#121212]'
                : 'border-transparent text-[#525252] hover:text-[#121212]'
            }`}
          >
            {t('nav.intake')}
          </button>
        </div>

        <div className="pb-2.5 text-xs font-mono text-[#525252] tabular-nums">
          {workspace.intake.datasetName} ·{' '}
          {t('kpi.txnsScanned', { count: fmtNumber(workspace.intake.transactionsAnalyzed) })}
        </div>
      </div>

      {subTab === 'cases' && (
        <ControlCenterView
          workspace={workspace}
          initialCaseId={focusedCaseId}
          onApproveRequest={onApproveRequest}
          onVerifyCaseResolution={onVerifyCaseResolution}
          onNavigateToEvidenceLab={() => setSubTab('evidence')}
          busyActionId={busyActionId}
        />
      )}

      {subTab === 'evidence' && (
        <EvidenceLabView
          workspace={workspace}
          initialRequestId={focusedRequestId}
          onApproveRequest={onApproveRequest}
          onRemindRequest={onRemindRequest}
          onSubmitVerification={onSubmitVerification}
          busyActionId={busyActionId}
        />
      )}

      {subTab === 'intake' && (
        <IntakeUploadView
          workspace={workspace}
          onWorkspaceUpdated={onWorkspaceUpdated}
          onGoToControlCenter={() => setSubTab('cases')}
        />
      )}
    </div>
  );
};
