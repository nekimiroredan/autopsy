import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileCheck2,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type {
  ContactPerson,
  InvestigationCase,
  PipelineStage,
  WorkspaceState,
} from '../types';
import { useI18n } from '../i18n/I18nContext';
import {
  localizeActivityEvent,
  localizeCaseAuditorNote,
  localizeCaseCorrective,
  localizeCasePrevention,
  localizeChannel,
  localizeHypothesisExplanation,
  localizeHypothesisMath,
  localizeRequestQuestion,
  localizeRole,
} from '../i18n/domainText';
import {
  CAUSE_TO_CHECK_ID,
  renderAutopsyNarrative,
  validateNarrativeEntities,
} from '../shared/narrator';
import { CONTACT_AVATARS, getContactInitials } from './contactAvatars';

interface ControlCenterViewProps {
  workspace: WorkspaceState;
  initialCaseId?: string;
  onApproveRequest: (requestId: string) => Promise<void>;
  onVerifyCaseResolution: (caseId: string) => Promise<void>;
  onNavigateToEvidenceLab: (requestId?: string) => void;
  busyActionId: string | null;
}

export const ControlCenterView: React.FC<ControlCenterViewProps> = ({
  workspace,
  initialCaseId,
  onApproveRequest,
  onVerifyCaseResolution,
  onNavigateToEvidenceLab,
  busyActionId,
}) => {
  const { locale, t, hasKey, fmtNumber, fmtSigned, fmtCurrency, fmtDate } = useI18n();
  const [stageFilter, setStageFilter] = useState<'all' | PipelineStage>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState<string>(
    initialCaseId || workspace.cases[0]?.id || ''
  );
  const [rightTab, setRightTab] = useState<'inspector' | 'activity' | 'ask'>('inspector');
  const [question, setQuestion] = useState('');
  const [askHistory, setAskHistory] = useState<
    Array<{ role: 'user' | 'agent'; text?: string; isWelcome?: boolean; citedCaseIds?: string[]; error?: boolean }>
  >([{ role: 'agent', isWelcome: true }]);
  const [asking, setAsking] = useState(false);

  React.useEffect(() => {
    if (initialCaseId) {
      setSelectedCaseId(initialCaseId);
    }
  }, [initialCaseId]);

  const selectedCase: InvestigationCase | undefined =
    workspace.cases.find((c) => c.id === selectedCaseId) ?? workspace.cases[0];

  const pendingApprovals = workspace.requests.filter(
    (r) => r.status === 'draft_awaiting_approval'
  );
  const sentRequests = workspace.requests.filter(
    (r) => r.status === 'sent_awaiting_reply' || r.status === 'responded'
  );

  const filteredCases = workspace.cases.filter((c) => {
    const matchesStage = stageFilter === 'all' || c.stage === stageFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      c.id.toLowerCase().includes(q) ||
      c.sku.toLowerCase().includes(q) ||
      c.productName.toLowerCase().includes(q) ||
      c.warehouse.toLowerCase().includes(q);
    return matchesStage && matchesSearch;
  });

  const stageCounts: Record<PipelineStage, number> = {
    analyzing: workspace.cases.filter((c) => c.stage === 'analyzing').length,
    waiting_for_evidence: workspace.cases.filter((c) => c.stage === 'waiting_for_evidence').length,
    ready_for_approval: workspace.cases.filter((c) => c.stage === 'ready_for_approval').length,
    verified: workspace.cases.filter((c) => c.stage === 'verified').length,
  };

  const getContact = (contactId: string): ContactPerson | undefined =>
    workspace.contacts.find((c) => c.id === contactId);

  const handleAskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || asking) return;

    setAskHistory((prev) => [...prev, { role: 'user', text: trimmed }]);
    setQuestion('');
    setAsking(true);

    try {
      const res = await fetch('/api/agent/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAskHistory((prev) => [
          ...prev,
          { role: 'agent', text: data.error || t('common.dismiss'), error: true },
        ]);
      } else {
        setAskHistory((prev) => [
          ...prev,
          { role: 'agent', text: data.answer, citedCaseIds: data.citedCaseIds },
        ]);
      }
    } catch {
      setAskHistory((prev) => [
        ...prev,
        { role: 'agent', text: t('common.dismiss'), error: true },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const selectedEvidence = selectedCase
    ? selectedCase.evidenceObject ?? {
        caseId: selectedCase.id,
        sku: selectedCase.sku,
        warehouse: selectedCase.warehouse,
        causeCode: selectedCase.category,
        checkId: CAUSE_TO_CHECK_ID[selectedCase.category],
        abstentionState: 'NONE' as const,
        expectedQty: selectedCase.expectedQty,
        countedQty: selectedCase.countedQty,
        varianceUnits: selectedCase.varianceUnits,
        varianceValue: selectedCase.varianceValue,
        docRef: selectedCase.ledgerTrace[selectedCase.ledgerTrace.length - 1]?.docRef ?? 'DOC-001',
        confidence: selectedCase.hypotheses[0]?.confidence ?? 0,
      }
    : null;

  const deterministicNarrative = selectedEvidence
    ? renderAutopsyNarrative(selectedEvidence, locale)
    : '';
  const entityValidation = selectedEvidence
    ? validateNarrativeEntities(deterministicNarrative, selectedEvidence)
    : null;

  return (
    <div className="space-y-6">
      {/* Unified Operational Summary Strip */}
      <section
        aria-label={t('kpi.active')}
        className="bg-white border border-[#D4D4D4] rounded-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#D4D4D4]"
      >
        <div className="p-5">
          <div className="text-xs font-medium text-[#525252]">{t('kpi.active')}</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#121212] font-mono tabular-nums">
              {fmtNumber(workspace.stats.activeInvestigations)}
            </span>
            <span className="text-xs text-[#525252] tabular-nums">
              {t('kpi.clusters', { count: fmtNumber(workspace.intake.groupedInvestigations) })}
            </span>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[#525252]">{t('kpi.humanActions')}</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#CC3B00] font-mono tabular-nums">
              {fmtNumber(workspace.stats.humanActionsNeeded)}
            </span>
            <span className="text-xs text-[#CC3B00] font-medium">
              {workspace.stats.humanActionsNeeded > 0 ? t('kpi.awaitingApproval') : t('kpi.allClear')}
            </span>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[#525252]">{t('kpi.verified')}</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-3xl font-semibold tracking-tight text-emerald-700 font-mono tabular-nums">
              {fmtNumber(workspace.stats.verifiedResolutions)}
            </span>
            <span className="text-xs text-emerald-700 font-medium">{t('kpi.evidenceBacked')}</span>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[#525252]">{t('kpi.effortSaved')}</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#121212] font-mono tabular-nums">
              {fmtNumber(workspace.stats.estimatedEffortSavedHours)}
              {t('common.hoursShort')}
            </span>
            <span className="text-xs text-[#525252] tabular-nums">
              {t('kpi.txnsScanned', { count: fmtNumber(workspace.intake.transactionsAnalyzed) })}
            </span>
          </div>
        </div>
      </section>

      {/* Flat Investigation Filter & Search Bar */}
      <section className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStageFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              stageFilter === 'all'
                ? 'bg-[#121212] text-white border-[#121212]'
                : 'bg-white text-[#525252] border-[#D4D4D4] hover:text-[#121212]'
            }`}
          >
            {t('pipeline.all', { count: fmtNumber(workspace.cases.length) })}
          </button>
          {(['analyzing', 'waiting_for_evidence', 'ready_for_approval', 'verified'] as PipelineStage[]).map(
            (stage) => (
              <button
                key={stage}
                type="button"
                onClick={() => setStageFilter(stage)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  stageFilter === stage
                    ? 'bg-[#121212] text-white border-[#121212]'
                    : 'bg-white text-[#525252] border-[#D4D4D4] hover:text-[#121212]'
                }`}
              >
                {t(`pipeline.${stage}`)}{' '}
                <span className="font-mono tabular-nums opacity-75">
                  ({fmtNumber(stageCounts[stage])})
                </span>
              </button>
            )
          )}
        </div>

        <div className="relative w-full xl:w-72 shrink-0">
          <Search className="w-4 h-4 text-[#525252] absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="w-full ps-9 pe-3 py-2 text-xs bg-white border border-[#D4D4D4] rounded-md text-[#121212] placeholder:text-[#737373] focus:outline-none focus:border-[#FF4B00]"
          />
        </div>
      </section>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-6 min-w-0">
          {/* Needs Your Attention */}
          <section className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-[#D4D4D4] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[#121212]">{t('attention.title')}</h2>
                <p className="text-xs text-[#525252] mt-0.5">
                  {t('attention.subtitle', {
                    mode:
                      workspace.autonomy.mode === 'assist'
                        ? t('autonomy.mode.assist')
                        : t('autonomy.mode.agent'),
                  })}
                </p>
              </div>
              <span className="text-xs font-medium text-[#CC3B00] tabular-nums shrink-0">
                {t('attention.pendingCount', { count: fmtNumber(pendingApprovals.length) })}
              </span>
            </div>

            {pendingApprovals.length === 0 && sentRequests.length === 0 ? (
              <div className="p-6 text-sm text-[#525252] flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                <span>{t('attention.allDone')}</span>
              </div>
            ) : (
              <div className="divide-y divide-[#D4D4D4]">
                {pendingApprovals.map((req) => {
                  const contact = getContact(req.contactId);
                  const avatar = contact ? CONTACT_AVATARS[contact.id] : undefined;
                  const localizedDoc = t(`doc.${req.docId}`);
                  const localizedRole = localizeRole(req.contactRole, t, hasKey);
                  const localizedQuestion = localizeRequestQuestion(
                    req,
                    workspace.cases,
                    t,
                    hasKey,
                    fmtNumber
                  );

                  return (
                    <div key={req.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-3.5 min-w-0">
                        {avatar ? (
                          <img
                            src={avatar}
                            alt={req.contactName}
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 rounded-full object-cover border border-[#D4D4D4] shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-[#EBEBEB] border border-[#D4D4D4] flex items-center justify-center text-xs font-semibold text-[#121212] shrink-0">
                            {getContactInitials(req.contactName)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#525252]">
                            <span className="font-semibold text-[#CC3B00]">
                              {t('attention.approvalRequired')}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{localizedDoc}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {t('attention.discrepancies', { count: fmtNumber(req.caseIds.length) })}
                            </span>
                          </div>
                          <h3 className="text-sm font-semibold text-[#121212] mt-1">
                            {t('attention.requestFrom', {
                              doc: localizedDoc,
                              name: req.contactName,
                              role: localizedRole,
                            })}
                          </h3>
                          <p className="text-xs text-[#525252] mt-1 line-clamp-2">
                            {localizedQuestion}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onNavigateToEvidenceLab(req.id)}
                          className="px-3 py-1.5 text-xs font-medium text-[#121212] bg-[#EBEBEB] rounded-md hover:bg-[#DCDCDC] transition-colors whitespace-nowrap shrink-0"
                        >
                          {t('attention.previewLink')}
                        </button>
                        <button
                          type="button"
                          disabled={busyActionId === req.id}
                          onClick={() => onApproveRequest(req.id)}
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-[#121212] bg-[#FF4B00] rounded-md hover:bg-[#FF6321] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                        >
                          <Send className="w-3.5 h-3.5" />
                          {busyActionId === req.id ? t('attention.sending') : t('attention.approveSend')}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {sentRequests.map((req) => (
                  <div key={req.id} className="px-5 py-3.5 bg-[#F5F5F5] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 text-xs text-[#525252] min-w-0">
                      <Clock className="w-4 h-4 text-[#CC3B00] shrink-0" />
                      <span className="font-medium text-[#121212]">{t(`doc.${req.docId}`)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">
                        {t('attention.sentTo', {
                          name: req.contactName,
                          channel: localizeChannel(req.channel, t, hasKey),
                        })}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{req.caseIds.join(', ')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigateToEvidenceLab(req.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#CC3B00] hover:text-[#121212] whitespace-nowrap shrink-0"
                    >
                      {t('attention.simulateReply')}
                      <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Investigation Table */}
          <section className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-[#D4D4D4] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[#121212]">{t('ledger.title')}</h2>
                <p className="text-xs text-[#525252] mt-0.5">{t('ledger.subtitle')}</p>
              </div>
              <span className="text-xs text-[#525252] font-mono tabular-nums shrink-0">
                {t('ledger.shown', { count: fmtNumber(filteredCases.length) })}
              </span>
            </div>

            {filteredCases.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#525252]">{t('ledger.empty')}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-start border-collapse">
                  <thead>
                    <tr className="border-b border-[#D4D4D4] bg-[#F5F5F5] text-xs font-medium text-[#525252]">
                      <th className="py-2.5 px-4 text-start">{t('ledger.col.caseSku')}</th>
                      <th className="py-2.5 px-3 text-start">{t('ledger.col.cause')}</th>
                      <th className="py-2.5 px-3 text-end">{t('ledger.col.variance')}</th>
                      <th className="py-2.5 px-3 text-end">{t('ledger.col.exposure')}</th>
                      <th className="py-2.5 px-4 text-start">{t('ledger.col.stage')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#D4D4D4] text-sm">
                    {filteredCases.map((c) => {
                      const isSelected = selectedCase?.id === c.id;
                      const checkId = c.evidenceObject?.checkId ?? CAUSE_TO_CHECK_ID[c.category];
                      return (
                        <tr
                          key={c.id}
                          onClick={() => {
                            setSelectedCaseId(c.id);
                            setRightTab('inspector');
                          }}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-[#FF4B00]/10' : 'hover:bg-[#F7F7F7]'
                          }`}
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-[#121212] tabular-nums">
                                {c.id}
                              </span>
                              <span className="text-xs text-[#888888]">·</span>
                              <span className="font-mono text-xs text-[#262626] tabular-nums">{c.sku}</span>
                            </div>
                            <div className="text-xs text-[#525252] truncate max-w-[200px] mt-0.5">
                              {c.productName}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="text-xs font-medium text-[#121212]">
                              {t(`cause.${c.category}`)}
                            </div>
                            <div className="text-[11px] text-[#525252] truncate max-w-[200px]">
                              {t(`check.${checkId}`)}
                            </div>
                            <div className="text-[11px] text-[#525252] font-mono tabular-nums mt-0.5">
                              {t('ledger.confidence', {
                                pct: fmtNumber(c.hypotheses[0]?.confidence ?? 0),
                                warehouse: c.warehouse,
                              })}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-end font-mono text-xs font-medium tabular-nums">
                            <span className={c.varianceUnits > 0 ? 'text-[#CC3B00]' : 'text-red-700'}>
                              {fmtSigned(c.varianceUnits)}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-end font-mono text-xs text-[#121212] tabular-nums">
                            {fmtCurrency(Math.abs(c.varianceValue))}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`text-xs font-medium whitespace-nowrap ${
                                  c.stage === 'verified'
                                    ? 'text-emerald-700'
                                    : c.stage === 'ready_for_approval'
                                    ? 'text-[#CC3B00]'
                                    : 'text-[#525252]'
                                }`}
                              >
                                {t(`pipeline.${c.stage}`)}
                              </span>
                              <ChevronRight className="w-4 h-4 text-[#737373] shrink-0 rtl:rotate-180" />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Right 5 Cols: Flat Single-Elevation Case Inspector / Activity / Ask */}
        <aside className="lg:col-span-5 bg-white border border-[#D4D4D4] rounded-lg overflow-hidden min-w-0">
          <div className="border-b border-[#D4D4D4] flex items-center bg-[#F5F5F5]">
            {(['inspector', 'activity', 'ask'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRightTab(tab)}
                className={`flex-1 px-3 py-3 text-xs font-semibold border-b-2 transition-colors truncate ${
                  rightTab === tab
                    ? 'border-[#FF4B00] bg-white text-[#121212]'
                    : 'border-transparent text-[#525252] hover:text-[#121212]'
                }`}
              >
                {t(`inspector.tab.${tab}`)}
              </button>
            ))}
          </div>

          {rightTab === 'inspector' && selectedCase && (
            <div className="divide-y divide-[#D4D4D4]">
              {/* Case Header */}
              <div className="p-5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs text-[#525252] font-mono tabular-nums">
                    {selectedCase.id} · {selectedCase.sku} · {selectedCase.warehouse} / {selectedCase.binLocation}
                  </div>
                  <h3 className="text-base font-semibold text-[#121212] mt-1">
                    {selectedCase.productName}
                  </h3>
                </div>
                {selectedCase.stage !== 'verified' && (
                  <button
                    type="button"
                    disabled={busyActionId === selectedCase.id}
                    onClick={() => onVerifyCaseResolution(selectedCase.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#121212] rounded-md hover:bg-[#2A2A2A] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    <FileCheck2 className="w-3.5 h-3.5" />
                    {t('inspector.verifyClose')}
                  </button>
                )}
              </div>

              {/* Balance Comparison Strip (hairline divided) */}
              <div className="grid grid-cols-3 divide-x divide-[#D4D4D4] bg-[#F5F5F5] text-center">
                <div className="p-3.5">
                  <div className="text-[11px] text-[#525252]">{t('inspector.ledgerBalance')}</div>
                  <div className="text-base font-semibold font-mono tabular-nums text-[#121212] mt-0.5">
                    {fmtNumber(selectedCase.expectedQty)}
                  </div>
                </div>
                <div className="p-3.5">
                  <div className="text-[11px] text-[#525252]">{t('inspector.physicalCount')}</div>
                  <div className="text-base font-semibold font-mono tabular-nums text-[#121212] mt-0.5">
                    {fmtNumber(selectedCase.countedQty)}
                  </div>
                </div>
                <div className="p-3.5">
                  <div className="text-[11px] text-[#525252]">{t('inspector.netVariance')}</div>
                  <div
                    className={`text-sm sm:text-base font-semibold font-mono tabular-nums mt-0.5 ${
                      selectedCase.varianceUnits > 0 ? 'text-[#CC3B00]' : 'text-red-700'
                    }`}
                  >
                    {fmtSigned(selectedCase.varianceUnits)} ({fmtCurrency(Math.abs(selectedCase.varianceValue))})
                  </div>
                </div>
              </div>

              {/* Deterministic Localized Narrator */}
              {selectedEvidence && (
                <div className="p-5 bg-[#FAFAFA] space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#121212]">
                      {t('inspector.autopsyNarrative')}
                    </span>
                    <span className="text-[11px] font-mono text-[#525252]">
                      {t(`abstain.${selectedEvidence.abstentionState}`)}
                    </span>
                  </div>
                  <p className="text-xs text-[#262626] leading-relaxed">
                    {deterministicNarrative}
                  </p>
                  {entityValidation && (
                    <div
                      className={`flex items-center gap-1.5 text-[11px] font-medium ${
                        entityValidation.valid ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {entityValidation.valid ? (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                          <span>{t('inspector.entityValidated')}</span>
                        </>
                      ) : (
                        <>
                          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                          <span>{t('inspector.entityFailed')}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Competing Hypotheses */}
              <div className="p-5 space-y-2.5">
                <h4 className="text-xs font-semibold text-[#121212]">
                  {t('inspector.hypothesesTitle')}
                </h4>
                <div className="divide-y divide-[#EBEBEB]">
                  {selectedCase.hypotheses.map((h) => (
                    <div key={h.id} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#121212]">
                          {t(`cause.${h.category}`)}
                        </span>
                        <span
                          className={`text-xs font-mono tabular-nums font-medium shrink-0 ${
                            h.status === 'rejected'
                              ? 'text-[#737373]'
                              : h.status === 'supported'
                              ? 'text-emerald-700'
                              : 'text-[#CC3B00]'
                          }`}
                        >
                          {fmtNumber(h.confidence)}% ·{' '}
                          {h.status === 'rejected'
                            ? t('inspector.status.rejected')
                            : h.status === 'supported'
                            ? t('inspector.status.supported')
                            : t('inspector.status.candidate')}
                        </span>
                      </div>
                      <p className="text-xs text-[#525252] mt-1">
                        {localizeHypothesisExplanation(h, selectedCase, t, hasKey, fmtNumber)}
                      </p>
                      <div className="text-xs font-mono text-[#525252] mt-1">
                        {localizeHypothesisMath(h, selectedCase, t, hasKey, fmtNumber, fmtSigned)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Auditor Verification & Prevention */}
              <div className="p-5 space-y-3">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      selectedCase.auditorVerdict === 'challenged'
                        ? 'text-[#CC3B00]'
                        : 'text-[#121212]'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-semibold text-[#121212]">
                      {t('inspector.auditorCheck', {
                        verdict: t(`verdict.${selectedCase.auditorVerdict}`),
                      })}
                    </div>
                    <p className="text-xs text-[#525252] mt-0.5">
                      {localizeCaseAuditorNote(selectedCase, t, hasKey, fmtNumber)}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 mt-0.5 text-[#525252] shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-[#121212]">{t('inspector.prevention')}</div>
                    <p className="text-xs text-[#525252] mt-0.5">
                      {localizeCasePrevention(selectedCase, t, hasKey)}
                    </p>
                  </div>
                </div>

                {selectedCase.correctiveAction && (
                  <div className="flex items-start gap-2.5 bg-emerald-50 border-s-2 border-emerald-700 p-3 rounded-e">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-700 shrink-0" />
                    <div>
                      <div className="text-xs font-semibold text-emerald-900">
                        {t('inspector.verifiedResolution')}
                      </div>
                      <p className="text-xs text-emerald-800 mt-0.5">
                        {localizeCaseCorrective(selectedCase, t, hasKey, fmtSigned)}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Reconstructed Ledger Trace */}
              <div className="p-5">
                <h4 className="text-xs font-semibold text-[#121212] mb-2.5">
                  {t('inspector.reconstruction')}
                </h4>
                <table className="w-full text-start text-xs">
                  <thead className="bg-[#F5F5F5] border-y border-[#D4D4D4] text-[#525252]">
                    <tr>
                      <th className="py-1.5 px-2.5 text-start">{t('inspector.trace.date')}</th>
                      <th className="py-1.5 px-2 text-start">{t('inspector.trace.ref')}</th>
                      <th className="py-1.5 px-2 text-end">{t('inspector.trace.delta')}</th>
                      <th className="py-1.5 px-2.5 text-end">{t('inspector.trace.balance')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EBEBEB] font-mono tabular-nums">
                    {selectedCase.ledgerTrace.map((entry, idx) => (
                      <tr key={`${entry.docRef}-${idx}`}>
                        <td className="py-1.5 px-2.5 text-[#525252]">{fmtDate(entry.date)}</td>
                        <td className="py-1.5 px-2 text-[#121212]">{entry.docRef}</td>
                        <td
                          className={`py-1.5 px-2 text-end ${
                            entry.qtyDelta >= 0 ? 'text-[#CC3B00]' : 'text-red-700'
                          }`}
                        >
                          {fmtSigned(entry.qtyDelta)}
                        </td>
                        <td className="py-1.5 px-2.5 text-end text-[#121212]">
                          {fmtNumber(entry.runningBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {rightTab === 'activity' && (
            <div className="p-5">
              <div className="text-xs text-[#525252] mb-4">{t('activity.subtitle')}</div>
              <div className="divide-y divide-[#D4D4D4]">
                {workspace.activity.map((ev) => {
                  const localized = localizeActivityEvent(ev, t, hasKey, fmtNumber);
                  return (
                    <div key={ev.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#121212]">{localized.title}</span>
                        <span className="font-mono text-[#525252] tabular-nums">{ev.timestamp}</span>
                      </div>
                      <p className="text-xs text-[#525252] mt-1">{localized.detail}</p>
                      <div className="mt-1.5 text-[11px] font-mono text-[#525252]">
                        {ev.toolName} ·{' '}
                        <span
                          className={
                            ev.phase === 'attention'
                              ? 'text-[#CC3B00] font-medium'
                              : ev.phase === 'active'
                              ? 'text-[#121212] font-medium'
                              : 'text-emerald-700 font-medium'
                          }
                        >
                          {ev.phase === 'attention'
                            ? t('activity.awaiting')
                            : ev.phase === 'active'
                            ? t('activity.inProgress')
                            : t('activity.completed')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {rightTab === 'ask' && (
            <div className="p-5 flex flex-col h-[560px]">
              <div className="flex-1 overflow-y-auto space-y-3 pe-1">
                {askHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-md text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#121212] text-white ms-8'
                        : msg.error
                        ? 'bg-red-50 border border-red-200 text-red-800 me-4'
                        : 'bg-[#F5F5F5] text-[#121212] me-4'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">
                      {msg.isWelcome ? t('ask.welcome') : msg.text}
                    </div>
                    {msg.citedCaseIds && msg.citedCaseIds.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[#D4D4D4] flex flex-wrap gap-2">
                        {msg.citedCaseIds.map((cid) => (
                          <button
                            key={cid}
                            type="button"
                            onClick={() => {
                              setSelectedCaseId(cid);
                              setRightTab('inspector');
                            }}
                            className="font-mono text-[11px] font-semibold text-[#CC3B00] hover:underline"
                          >
                            {t('ask.inspectCase', { caseId: cid })}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-3 mt-3 border-t border-[#D4D4D4] space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {[t('ask.sample1'), t('ask.sample2')].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setQuestion(prompt)}
                      className="text-[11px] text-[#121212] bg-[#EBEBEB] hover:bg-[#DCDCDC] px-2.5 py-1 rounded transition-colors"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                <form onSubmit={handleAskSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder={t('ask.placeholder')}
                    className="flex-1 px-3 py-2 text-xs bg-white border border-[#D4D4D4] rounded-md focus:outline-none focus:border-[#FF4B00]"
                  />
                  <button
                    type="submit"
                    disabled={asking || !question.trim()}
                    className="px-4 py-2 text-xs font-semibold text-[#121212] bg-[#FF4B00] rounded-md hover:bg-[#FF6321] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    {asking ? t('ask.thinking') : t('ask.button')}
                  </button>
                </form>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
