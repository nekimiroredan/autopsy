import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Mail,
  MessageSquare,
  Send,
  SlidersHorizontal,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import {
  localizeChannel,
  localizeDepartment,
  localizeRequestOption,
  localizeRequestQuestion,
  localizeRole,
} from '../i18n/domainText';
import type { VerificationRequest, WorkspaceState } from '../types';
import { CONTACT_AVATARS, getContactInitials } from './contactAvatars';

interface EvidenceLabViewProps {
  workspace: WorkspaceState;
  initialRequestId?: string;
  onApproveRequest: (requestId: string) => Promise<void>;
  onRemindRequest: (requestId: string) => Promise<void>;
  onSubmitVerification: (
    token: string,
    selectedAnswer: string,
    employeeNote: string
  ) => Promise<void>;
  busyActionId: string | null;
}

export const EvidenceLabView: React.FC<EvidenceLabViewProps> = ({
  workspace,
  initialRequestId,
  onApproveRequest,
  onRemindRequest,
  onSubmitVerification,
  busyActionId,
}) => {
  const { t, hasKey, fmtNumber } = useI18n();
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([
    'DOC-RCV',
    'DOC-DISPATCH',
  ]);
  const [optimizing, setOptimizing] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string>(
    initialRequestId || workspace.requests[0]?.id || ''
  );
  const [employeeNote, setEmployeeNote] = useState('');
  const [chosenAnswer, setChosenAnswer] = useState<string | null>(null);

  useEffect(() => {
    if (initialRequestId) {
      setActiveRequestId(initialRequestId);
    } else if (!workspace.requests.some((r) => r.id === activeRequestId)) {
      setActiveRequestId(workspace.requests[0]?.id || '');
    }
  }, [initialRequestId, workspace.requests, activeRequestId]);

  useEffect(() => {
    const validIds = new Set(workspace.evidenceDocs.map((d) => d.id));
    setSelectedDocIds((prev) => {
      const filtered = prev.filter((id) => validIds.has(id));
      return filtered.length > 0 ? filtered : workspace.evidenceDocs.slice(0, 2).map((d) => d.id);
    });
  }, [workspace.evidenceDocs]);

  const toggleDoc = (docId: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const handleOptimize = async () => {
    setOptimizing(true);
    try {
      const res = await fetch('/api/evidence/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseIds: workspace.cases.map((c) => c.id) }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.selectedDocIds)) {
        setSelectedDocIds(data.selectedDocIds);
      }
    } finally {
      setOptimizing(false);
    }
  };

  const allCaseIds = workspace.cases.map((c) => c.id);
  const coveredSet = new Set<string>();
  let totalEffortMin = 0;

  workspace.evidenceDocs.forEach((doc) => {
    if (selectedDocIds.includes(doc.id)) {
      totalEffortMin += doc.effortMinutes;
      doc.coveredCaseIds.forEach((cid) => {
        if (allCaseIds.includes(cid)) coveredSet.add(cid);
      });
    }
  });

  const baselineEffortMin = allCaseIds.length * 18;
  const savedPct =
    baselineEffortMin > 0
      ? Math.max(0, Math.round(((baselineEffortMin - totalEffortMin) / baselineEffortMin) * 100))
      : 0;
  const activeRequest: VerificationRequest | undefined =
    workspace.requests.find((r) => r.id === activeRequestId) ?? workspace.requests[0];

  const getSelectedAnswerDisplay = (req: VerificationRequest): string => {
    if (!req.selectedAnswer) return '';
    const idx = req.options.findIndex((o) => o === req.selectedAnswer);
    return idx >= 0
      ? localizeRequestOption(req, req.selectedAnswer, idx, t, hasKey, fmtNumber)
      : req.selectedAnswer;
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Minimum Evidence Agent Lab */}
      <section className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
        <div className="px-6 py-5 border-b border-[#D4D4D4] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[#121212]">{t('evidence.title')}</h2>
            <p className="text-sm text-[#525252] mt-1">{t('evidence.desc')}</p>
          </div>
          <button
            type="button"
            disabled={optimizing}
            onClick={handleOptimize}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#121212] bg-[#FF4B00] rounded-md hover:bg-[#FF6321] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {optimizing ? t('evidence.optimizing') : t('evidence.optimizeBtn')}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#D4D4D4]">
          {/* Candidate Documents */}
          <div className="lg:col-span-5 p-6 space-y-3">
            <div className="text-xs font-semibold text-[#121212]">{t('evidence.candidateDocs')}</div>
            <div className="divide-y divide-[#EBEBEB]">
              {workspace.evidenceDocs.map((doc) => {
                const checked = selectedDocIds.includes(doc.id);
                const relevantCount = doc.coveredCaseIds.filter((id) =>
                  allCaseIds.includes(id)
                ).length;

                return (
                  <label
                    key={doc.id}
                    className={`flex items-start gap-3 p-3.5 rounded-md cursor-pointer transition-colors ${
                      checked ? 'bg-[#FF4B00]/10' : 'hover:bg-[#F7F7F7]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDoc(doc.id)}
                      className="mt-1 h-4 w-4 rounded border-[#D4D4D4] text-[#FF4B00] focus:ring-[#FF4B00]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#121212]">
                          {t(`doc.${doc.id}`)}
                        </span>
                        <span className="text-xs font-mono tabular-nums text-[#525252] shrink-0">
                          {t('evidence.effortMin', { min: fmtNumber(doc.effortMinutes) })}
                        </span>
                      </div>
                      <div className="text-xs text-[#525252] mt-0.5">
                        {t('evidence.relevantDisc', {
                          count: fmtNumber(relevantCount),
                          dept: localizeDepartment(doc.department, t, hasKey),
                        })}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Live Coverage Matrix & Effort Math */}
          <div className="lg:col-span-7 p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#D4D4D4] bg-[#F5F5F5] border border-[#D4D4D4] rounded-md">
              <div className="p-4">
                <div className="text-xs text-[#525252]">{t('evidence.coveredCount')}</div>
                <div className="text-2xl font-semibold font-mono tabular-nums text-[#121212] mt-1">
                  {fmtNumber(coveredSet.size)}/{fmtNumber(allCaseIds.length)}
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs text-[#525252]">{t('evidence.estEffort')}</div>
                <div className="text-2xl font-semibold font-mono tabular-nums text-[#CC3B00] mt-1">
                  {fmtNumber(totalEffortMin)} {t('common.minutesShort')}
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs text-[#525252]">{t('evidence.vsBaseline')}</div>
                <div className="text-2xl font-semibold font-mono tabular-nums text-[#121212] mt-1">
                  {t('evidence.saved', { pct: fmtNumber(savedPct) })}
                </div>
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#525252] mb-3">
                <span className="font-semibold text-[#121212]">{t('evidence.matrixTitle')}</span>
                <span>{t('evidence.matrixNote')}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {workspace.cases.map((c, idx) => {
                  const isCovered = coveredSet.has(c.id);
                  return (
                    <div
                      key={c.id}
                      className={`border rounded-md p-3 transition-colors ${
                        isCovered
                          ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
                          : 'bg-[#FAFAFA] border-[#D4D4D4] text-[#525252]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-xs font-semibold tabular-nums">
                          {idx + 1}. {c.id}
                        </span>
                        {isCovered ? (
                          <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                        ) : (
                          <span className="text-[11px] text-[#737373]">{t('evidence.open')}</span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-[#525252] mt-1 truncate">
                        {c.sku}
                      </div>
                      <div className="text-[11px] font-medium mt-1">
                        {isCovered ? t('evidence.covered') : t('evidence.uncovered')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Agent-to-Human Communication & Secure Verification Link Simulator */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Outgoing Requests */}
        <div className="lg:col-span-6 bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-[#D4D4D4]">
            <h3 className="text-base font-semibold text-[#121212]">{t('evidence.queueTitle')}</h3>
            <p className="text-xs text-[#525252] mt-0.5">{t('evidence.queueSub')}</p>
          </div>

          <div className="divide-y divide-[#D4D4D4]">
            {workspace.requests.map((req) => {
              const isSelected = activeRequest?.id === req.id;
              const avatar = CONTACT_AVATARS[req.contactId];
              const statusKey =
                req.status === 'verified'
                  ? 'evidence.status.verified'
                  : req.status === 'sent_awaiting_reply'
                  ? 'evidence.status.sent'
                  : req.status === 'responded'
                  ? 'evidence.status.responded'
                  : 'evidence.status.draft';

              return (
                <div
                  key={req.id}
                  onClick={() => {
                    setActiveRequestId(req.id);
                    setChosenAnswer(req.selectedAnswer || null);
                    setEmployeeNote(req.employeeNote || '');
                  }}
                  className={`p-4 cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#FF4B00]/10' : 'hover:bg-[#F7F7F7]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      {avatar ? (
                        <img
                          src={avatar}
                          alt={req.contactName}
                          referrerPolicy="no-referrer"
                          className="w-9 h-9 rounded-full object-cover border border-[#D4D4D4] shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-[#EBEBEB] flex items-center justify-center text-xs font-semibold text-[#121212] shrink-0">
                          {getContactInitials(req.contactName)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#525252]">
                          <span className="font-semibold text-[#121212]">{req.contactName}</span>
                          <span>·</span>
                          <span>{localizeRole(req.contactRole, t, hasKey)}</span>
                        </div>
                        <div className="text-xs text-[#262626] mt-1 font-medium">
                          {t(`doc.${req.docId}`)} ({req.referenceDoc})
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#525252] mt-1">
                          {req.channel === 'telegram' ? (
                            <span className="inline-flex items-center gap-1">
                              <MessageSquare className="w-3 h-3" />{' '}
                              {localizeChannel('telegram', t, hasKey)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Mail className="w-3 h-3" />{' '}
                              {localizeChannel('email', t, hasKey)}
                            </span>
                          )}
                          <span>·</span>
                          <span className="font-mono tabular-nums">{req.caseIds.join(', ')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-end shrink-0">
                      <span
                        className={`text-xs font-medium ${
                          req.status === 'verified'
                            ? 'text-emerald-700'
                            : req.status === 'sent_awaiting_reply'
                            ? 'text-[#121212]'
                            : req.status === 'responded'
                            ? 'text-red-700'
                            : 'text-[#CC3B00]'
                        }`}
                      >
                        {t(statusKey)}
                      </span>

                      <div className="mt-2 flex justify-end gap-2">
                        {req.status === 'draft_awaiting_approval' && (
                          <button
                            type="button"
                            disabled={busyActionId === req.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onApproveRequest(req.id);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#121212] bg-[#FF4B00] rounded hover:bg-[#FF6321] transition-colors"
                          >
                            <Send className="w-3 h-3" />
                            {t('evidence.approve')}
                          </button>
                        )}
                        {req.status === 'sent_awaiting_reply' && (
                          <button
                            type="button"
                            disabled={busyActionId === req.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemindRequest(req.id);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#121212] bg-white border border-[#D4D4D4] rounded hover:bg-[#EBEBEB] transition-colors"
                          >
                            <Clock className="w-3 h-3" />
                            {t('evidence.remind')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Interactive Employee Verification Link Portal (flat single-elevation container) */}
        <div className="lg:col-span-6 bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-[#D4D4D4] flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-[#121212]">{t('evidence.portalTitle')}</h3>
              <p className="text-xs text-[#525252] mt-0.5">{t('evidence.portalSub')}</p>
            </div>
            {activeRequest && (
              <span className="inline-flex items-center gap-1 text-xs font-mono text-[#525252] shrink-0">
                <ExternalLink className="w-3.5 h-3.5" />
                /verify/{activeRequest.token}
              </span>
            )}
          </div>

          {activeRequest ? (
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-[#EBEBEB]">
                <div>
                  <div className="text-sm font-semibold text-[#121212]">{t('app.brand')}</div>
                  <div className="text-xs text-[#525252] font-mono tabular-nums">
                    {activeRequest.caseIds.join(', ')}
                  </div>
                </div>
                <span className="text-xs font-mono text-[#525252]">{t('evidence.expires')}</span>
              </div>

              <p className="text-sm text-[#121212]">
                {t('evidence.greeting', { name: activeRequest.contactName.split(' ')[0] })}
              </p>

              <div className="bg-[#F5F5F5] rounded-md p-4 space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-[#525252]">{t('evidence.docLabel')}</span>
                  <span className="font-mono font-semibold text-[#121212]">
                    {activeRequest.referenceDoc}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#525252]">{t('evidence.skuLabel')}</span>
                  <span className="font-mono font-semibold text-[#121212]">
                    {activeRequest.sku}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#525252]">{t('evidence.sourceLabel')}</span>
                  <span className="text-[#121212]">{t(`doc.${activeRequest.docId}`)}</span>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-[#121212]">
                  {t('evidence.questionLabel')}
                </div>
                <p className="text-sm text-[#121212] mt-1 leading-relaxed">
                  {localizeRequestQuestion(activeRequest, workspace.cases, t, hasKey, fmtNumber)}
                </p>
                <p className="text-xs text-[#525252] mt-1">{t('evidence.confirmPrompt')}</p>
              </div>

              <div className="space-y-2">
                {activeRequest.options.map((opt, idx) => {
                  const selected =
                    (chosenAnswer ?? activeRequest.selectedAnswer) === opt;
                  const localizedLabel = localizeRequestOption(
                    activeRequest,
                    opt,
                    idx,
                    t,
                    hasKey,
                    fmtNumber
                  );

                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={activeRequest.status === 'verified'}
                      onClick={() => setChosenAnswer(opt)}
                      className={`w-full text-start px-3.5 py-2.5 text-xs font-medium rounded-md border transition-colors ${
                        selected
                          ? 'border-[#FF4B00] bg-[#FF4B00]/10 text-[#121212] font-semibold'
                          : 'border-[#D4D4D4] bg-white text-[#121212] hover:bg-[#F7F7F7]'
                      }`}
                    >
                      {localizedLabel}
                    </button>
                  );
                })}
              </div>

              <div>
                <label className="block text-xs text-[#525252] mb-1">
                  {t('evidence.noteLabel')}
                </label>
                <input
                  type="text"
                  value={employeeNote}
                  disabled={activeRequest.status === 'verified'}
                  onChange={(e) => setEmployeeNote(e.target.value)}
                  placeholder={t('evidence.notePlaceholder')}
                  className="w-full px-3 py-2 text-xs bg-white border border-[#D4D4D4] rounded-md focus:outline-none focus:border-[#FF4B00]"
                />
              </div>

              {activeRequest.status === 'verified' ? (
                <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>
                    {t('evidence.verifiedBanner', {
                      answer: getSelectedAnswerDisplay(activeRequest),
                    })}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!chosenAnswer || busyActionId === activeRequest.token}
                  onClick={() =>
                    chosenAnswer &&
                    onSubmitVerification(activeRequest.token, chosenAnswer, employeeNote)
                  }
                  className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-[#121212] rounded-md hover:bg-[#2A2A2A] disabled:opacity-50 transition-colors"
                >
                  {busyActionId === activeRequest.token
                    ? t('evidence.submitting')
                    : t('evidence.submitBtn')}
                </button>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-[#525252]">
              {t('evidence.noRequests')}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
