import React from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import {
  localizeNextActions,
  localizeRequestQuestion,
  localizeRole,
  localizeSwarmEventSummary,
} from '../i18n/domainText';
import type { ContactPerson, DynamicInvestigationCell, WorkspaceState } from '../types';
import { CONTACT_AVATARS, getContactInitials } from './contactAvatars';

interface OverviewViewProps {
  workspace: WorkspaceState;
  onApproveRequest: (requestId: string) => Promise<void>;
  onTogglePause: () => Promise<void>;
  onRunSwarmCycle: () => Promise<void>;
  onInspectCase: (caseId: string) => void;
  onNavigateToEvidence: (reqId?: string) => void;
  onNavigateToSection: (tab: 'swarm' | 'investigations' | 'automations' | 'integrations' | 'reports') => void;
  busyActionId: string | null;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  workspace,
  onApproveRequest,
  onTogglePause,
  onRunSwarmCycle,
  onInspectCase,
  onNavigateToEvidence,
  onNavigateToSection,
  busyActionId,
}) => {
  const { t, hasKey, fmtNumber, fmtCurrency } = useI18n();
  const { swarm, requests } = workspace;
  const pendingApprovals = requests.filter((r) => r.status === 'draft_awaiting_approval');
  const openExposure = workspace.cases
    .filter((c) => c.stage !== 'verified')
    .reduce((acc, c) => acc + Math.abs(c.varianceValue), 0);

  const getContact = (contactId: string): ContactPerson | undefined =>
    workspace.contacts.find((c) => c.id === contactId);

  const handleCellClick = (cell: DynamicInvestigationCell) => {
    if (cell.caseIds.length > 0) {
      onInspectCase(cell.caseIds[0]);
    } else {
      onNavigateToSection('investigations');
    }
  };

  return (
    <div className="space-y-6">
      {/* Deep Graphite Command Objective Banner */}
      <section className="bg-[#121212] text-[#EBEBEB] border border-[#2A2A2A] rounded-lg p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="min-w-0 max-w-3xl">
            <div className="text-xs font-mono text-[#FF4B00] tracking-tight">
              {t('swarm.bannerTitle')} · {workspace.intake.datasetName}
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-white mt-1.5 text-balance">
              {t('hero.headline')}
            </h1>
            <p className="text-sm text-[#B8B8B8] mt-2 leading-relaxed">
              {t('swarm.objective')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              disabled={busyActionId === 'swarm-pause'}
              onClick={onTogglePause}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                swarm.paused
                  ? 'bg-[#FF4B00] text-[#121212] border-[#FF4B00] hover:bg-[#E04200]'
                  : 'bg-[#1E1E1E] text-[#EBEBEB] border-[#383838] hover:border-[#FF4B00]'
              }`}
            >
              {swarm.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {swarm.paused ? t('swarm.resumeBtn') : t('swarm.pauseBtn')}
            </button>

            <button
              type="button"
              disabled={swarm.paused || busyActionId === 'swarm-cycle'}
              onClick={onRunSwarmCycle}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-[#FF4B00] text-[#121212] hover:bg-[#FF6321] disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${busyActionId === 'swarm-cycle' ? 'animate-spin' : ''}`}
              />
              {t('swarm.runCycleBtn')}
            </button>
          </div>
        </div>
      </section>

      {/* Unified Horizontal 4-KPI Strip (single surface with hairline dividers) */}
      <section className="bg-white border border-[#D4D4D4] rounded-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#D4D4D4]">
        <div className="p-5">
          <div className="text-xs font-medium text-[#525252]">{t('swarm.activeAgents')}</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums text-[#121212]">
              {fmtNumber(swarm.activeAgentsCount)} / {fmtNumber(swarm.totalAgentsCount)}
            </span>
            <span className="text-xs font-medium text-[#CC3B00]">
              {swarm.paused ? t('swarm.status.paused') : t('swarm.status.mvpCores')}
            </span>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[#525252]">{t('swarm.runningTasks')}</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums text-[#121212]">
              {fmtNumber(swarm.runningTasks)}
            </span>
            <span className="text-xs text-[#525252] font-mono tabular-nums">
              {t('swarm.cellsCount', { count: fmtNumber(swarm.cells.length) })}
            </span>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[#525252]">{t('swarm.completedToday')}</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums text-[#121212]">
              {fmtNumber(swarm.completedToday)}
            </span>
            <span className="text-xs text-emerald-700 font-medium">
              {t('swarm.closedCount', { count: fmtNumber(workspace.stats.verifiedResolutions) })}
            </span>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[#525252]">{t('swarm.needsApproval')}</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums text-[#CC3B00]">
              {fmtNumber(pendingApprovals.length)}
            </span>
            <span className="text-xs font-mono tabular-nums text-[#525252]">
              {t('swarm.openExposure', { amount: fmtCurrency(Math.round(openExposure)) })}
            </span>
          </div>
        </div>
      </section>

      {/* Main Two-Column Split: Left (Approvals + Investigation Cells) | Right (Event Stream) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-6 min-w-0">
          {/* Needs Approval Queue */}
          <section className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-[#D4D4D4] flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[#121212]">{t('attention.title')}</h2>
                <p className="text-xs text-[#525252] mt-0.5">{t('swarm.attentionSub')}</p>
              </div>
              <span className="text-xs font-mono font-semibold text-[#CC3B00] tabular-nums shrink-0">
                {t('swarm.pendingBadge', { count: fmtNumber(pendingApprovals.length) })}
              </span>
            </div>

            {pendingApprovals.length === 0 ? (
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
                    <div key={req.id} className="p-5 flex flex-col gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        {avatar ? (
                          <img
                            src={avatar}
                            alt={req.contactName}
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 rounded-full object-cover border border-[#D4D4D4] shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-[#EBEBEB] flex items-center justify-center text-xs font-semibold text-[#121212] shrink-0">
                            {getContactInitials(req.contactName)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#525252]">
                            <span className="font-semibold text-[#CC3B00]">
                              {t('attention.approvalRequired')}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{localizedDoc}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{req.caseIds.join(', ')}</span>
                          </div>
                          <h3 className="text-sm font-semibold text-[#121212] mt-1">
                            {t('attention.requestFrom', {
                              doc: localizedDoc,
                              name: req.contactName,
                              role: localizedRole,
                            })}
                          </h3>
                          <p className="text-xs text-[#525252] mt-1 leading-relaxed">
                            {localizedQuestion}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onNavigateToEvidence(req.id)}
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
              </div>
            )}

            <div className="px-5 py-3 bg-[#F5F5F5] border-t border-[#D4D4D4] flex items-center justify-between text-xs text-[#525252]">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#121212]" />
                {t('hero.guardrail')}
              </span>
              <button
                type="button"
                onClick={() => onNavigateToSection('automations')}
                className="font-medium text-[#121212] hover:text-[#CC3B00] whitespace-nowrap shrink-0"
              >
                {t('swarm.policySettings')}
              </button>
            </div>
          </section>

          {/* Dynamic Investigation Cells (2x2 clean hairline grid) */}
          <section className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-[#D4D4D4] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-[#121212]">{t('swarm.cellsTitle')}</h2>
                <p className="text-xs text-[#525252] mt-0.5">{t('swarm.cellsSub')}</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateToSection('swarm')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#CC3B00] hover:text-[#121212] transition-colors whitespace-nowrap shrink-0"
              >
                {t('swarm.inspectTopology')}
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 divide-[#D4D4D4]">
              {swarm.cells.map((cell, idx) => {
                const titleKey = `cell.${cell.id}.title`;
                const focusKey = `cell.${cell.id}.focus`;
                const localizedTitle = hasKey(titleKey)
                  ? t(titleKey)
                  : cell.title.replace(`${cell.code} — `, '');
                const localizedFocus = hasKey(focusKey) ? t(focusKey) : cell.focusArea;

                return (
                  <div
                    key={cell.id}
                    onClick={() => handleCellClick(cell)}
                    className={`p-5 hover:bg-[#F7F7F7] cursor-pointer transition-colors flex flex-col justify-between gap-3 ${
                      idx >= 2 ? 'sm:border-t sm:border-[#D4D4D4]' : ''
                    } ${idx % 2 === 1 ? 'sm:border-s sm:border-[#D4D4D4]' : ''}`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-semibold text-[#CC3B00]">{cell.code}</span>
                        <span className="text-[#525252] font-mono tabular-nums">
                          {t(`swarm.cellStatus.${cell.status}`)}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-[#121212] mt-1">{localizedTitle}</h3>
                      <p className="text-xs text-[#525252] mt-0.5">{localizedFocus}</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                        <span className="text-[#525252]">
                          {t('swarm.agentsAssigned', { count: fmtNumber(cell.agentIds.length) })}
                        </span>
                        <span className="font-semibold text-[#121212]">{fmtNumber(cell.progressPct)}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-[#EBEBEB] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#FF4B00] transition-all"
                          style={{ width: `${cell.progressPct}%` }}
                        />
                      </div>
                      <div className="text-[11px] font-mono text-[#525252] truncate">
                        {cell.caseIds.length > 0 ? cell.caseIds.join(', ') : t('swarm.monitoringBaselines')}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right 5 Cols: Structured Swarm Activity Stream */}
        <section className="lg:col-span-5 bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-[#D4D4D4] flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[#121212]">{t('swarm.streamTitle')}</h2>
              <p className="text-xs text-[#525252] mt-0.5">{t('swarm.streamSub')}</p>
            </div>
            <span className="text-xs font-mono text-[#525252] tabular-nums shrink-0">
              {t('swarm.eventsCount', { count: fmtNumber(swarm.events.length) })}
            </span>
          </div>

          <div className="divide-y divide-[#D4D4D4] max-h-[680px] overflow-y-auto">
            {swarm.events.map((ev) => {
              const agentNameKey = `agent.${ev.agentId}.name`;
              const localizedAgentName = hasKey(agentNameKey) ? t(agentNameKey) : ev.agentName;
              const localizedSummary = localizeSwarmEventSummary(ev, t, hasKey);
              const localizedNext = localizeNextActions(ev.permittedNextActions, t, hasKey);

              return (
                <div key={ev.id} className="px-5 py-3.5 hover:bg-[#F7F7F7] transition-colors">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-[#121212] truncate">{localizedAgentName}</span>
                      <span aria-hidden="true" className="text-[#888888]">·</span>
                      <button
                        type="button"
                        onClick={() => ev.caseId !== 'GLOBAL' && onInspectCase(ev.caseId)}
                        className="font-mono text-[#CC3B00] hover:underline shrink-0"
                      >
                        {ev.caseId}
                      </button>
                      <span aria-hidden="true" className="text-[#888888]">·</span>
                      <span className="font-mono text-[#525252] truncate">{ev.taskId}</span>
                    </div>
                    <span className="font-mono text-[#525252] tabular-nums shrink-0">
                      {ev.timestamp}
                    </span>
                  </div>

                  <p className="text-xs text-[#262626] mt-1 leading-relaxed">{localizedSummary}</p>

                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#525252]">
                    <span>{t('swarm.refsLabel', { refs: ev.evidenceRefs.join(', ') })}</span>
                    <span
                      className={
                        ev.status === 'rejected'
                          ? 'text-red-700 font-semibold'
                          : ev.status === 'awaiting_input'
                          ? 'text-[#CC3B00] font-semibold'
                          : 'text-[#121212]'
                      }
                    >
                      {t('swarm.nextLabel', { actions: localizedNext })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};
