import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BarChart3,
  FolderSearch,
  LayoutDashboard,
  Menu,
  Network,
  Plug,
  ShieldCheck,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import type { AutonomyConfig, BenchmarkResult, SupportedLocale, WorkspaceState } from './types';
import { OverviewView } from './components/OverviewView';
import { AgentSwarmView } from './components/AgentSwarmView';
import { InvestigationsView, type InvestigationsSubTab } from './components/InvestigationsView';
import { AutomationsView } from './components/AutomationsView';
import { IntegrationsView } from './components/IntegrationsView';
import { ReportsView } from './components/ReportsView';
import { LOCALE_BUNDLES, SUPPORTED_LOCALES, useI18n } from './i18n/I18nContext';

type TabId = 'overview' | 'swarm' | 'investigations' | 'automations' | 'integrations' | 'reports';

interface NavGroup {
  groupKey: string;
  items: Array<{ id: TabId; labelKey: string; icon: React.ComponentType<{ className?: string }> }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: 'nav.group.operations',
    items: [
      { id: 'overview', labelKey: 'nav.overview', icon: LayoutDashboard },
      { id: 'investigations', labelKey: 'nav.investigations', icon: FolderSearch },
      { id: 'swarm', labelKey: 'nav.swarm', icon: Network },
    ],
  },
  {
    groupKey: 'nav.group.governance',
    items: [
      { id: 'automations', labelKey: 'nav.automations', icon: Workflow },
      { id: 'integrations', labelKey: 'nav.integrations', icon: Plug },
      { id: 'reports', labelKey: 'nav.reports', icon: BarChart3 },
    ],
  },
];

const TAB_LABEL_KEY: Record<TabId, string> = {
  overview: 'nav.overview',
  swarm: 'nav.swarm',
  investigations: 'nav.investigations',
  automations: 'nav.automations',
  integrations: 'nav.integrations',
  reports: 'nav.reports',
};

export default function App() {
  const { locale, setLocale, t, fmtNumber } = useI18n();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [investigationsSubTab, setInvestigationsSubTab] = useState<InvestigationsSubTab>('cases');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [focusedRequestId, setFocusedRequestId] = useState<string | undefined>(undefined);
  const [focusedCaseId, setFocusedCaseId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    async function loadInitial() {
      try {
        const [wsRes, benchRes] = await Promise.all([
          fetch('/api/workspace'),
          fetch('/api/bench'),
        ]);
        if (!wsRes.ok || !benchRes.ok) {
          throw new Error('Failed to load Inventory Autopsy workspace.');
        }
        const [wsData, benchData] = await Promise.all([wsRes.json(), benchRes.json()]);
        if (mounted) {
          setWorkspace(wsData);
          setBenchmark(benchData);
        }
      } catch (err) {
        if (mounted) {
          setErrorMsg(err instanceof Error ? err.message : 'Workspace initialization error.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadInitial();
    return () => {
      mounted = false;
    };
  }, []);

  const handleTogglePause = async () => {
    setBusyActionId('swarm-pause');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/swarm/toggle-pause', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to toggle swarm pause state.');
      setWorkspace(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Swarm control error.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleRunSwarmCycle = async () => {
    setBusyActionId('swarm-cycle');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/swarm/run-cycle', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to execute swarm cycle.');
      setWorkspace(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Swarm cycle error.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleToggleAutomation = async (id: string) => {
    setBusyActionId(id);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/automations/${id}/toggle`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to toggle automation.');
      setWorkspace(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Automation update error.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleCreateCustomAutomation = async (payload: {
    name: string;
    trigger: string;
    thresholdUsd: number;
    channel: 'email' | 'telegram' | 'dashboard';
    requiresApproval: boolean;
  }) => {
    setErrorMsg(null);
    try {
      const res = await fetch('/api/automations/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save custom automation.');
      setWorkspace(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create automation.');
    }
  };

  const handleToggleIntegration = async (id: string) => {
    setBusyActionId(id);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/integrations/${id}/toggle`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update integration.');
      setWorkspace(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Integration toggle error.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleApproveRequest = async (requestId: string) => {
    setBusyActionId(requestId);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve request.');
      setWorkspace(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Approval error.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleRemindRequest = async (requestId: string) => {
    setBusyActionId(requestId);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/remind`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send reminder.');
      setWorkspace(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Reminder error.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleSubmitVerification = async (
    token: string,
    selectedAnswer: string,
    employeeNote: string
  ) => {
    setBusyActionId(token);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/verify/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedAnswer, employeeNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification submission failed.');
      setWorkspace(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification error.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleVerifyCaseResolution = async (caseId: string) => {
    setBusyActionId(caseId);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/verify-resolution`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Case verification failed.');
      setWorkspace(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Case closure error.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleSaveAutonomy = async (config: Partial<AutonomyConfig>) => {
    setErrorMsg(null);
    const res = await fetch('/api/autonomy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    if (!res.ok) {
      setErrorMsg(data.error || 'Failed to update autonomy settings.');
      return;
    }
    setWorkspace(data);
  };

  const handleRunBenchmark = async () => {
    setErrorMsg(null);
    const res = await fetch('/api/bench/run', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      setErrorMsg(data.error || 'Benchmark run failed.');
      return;
    }
    setBenchmark(data);
  };

  const selectTab = (tab: TabId) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  const openInvestigationsIntake = () => {
    setInvestigationsSubTab('intake');
    selectTab('investigations');
  };

  const openCaseInInvestigations = (caseId: string) => {
    setFocusedCaseId(caseId);
    setInvestigationsSubTab('cases');
    selectTab('investigations');
  };

  const openEvidenceInInvestigations = (reqId?: string) => {
    if (reqId) setFocusedRequestId(reqId);
    setInvestigationsSubTab('evidence');
    selectTab('investigations');
  };

  const pendingApprovalsCount =
    workspace?.requests.filter((r) => r.status === 'draft_awaiting_approval').length ?? 0;

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-[#121212] text-[#EBEBEB]">
      {/* Brand Lockup */}
      <div className="h-14 px-5 border-b border-[#262626] flex items-center justify-between shrink-0">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            selectTab('overview');
          }}
          className="inline-flex items-center gap-2.5 text-sm font-bold tracking-tight text-white whitespace-nowrap"
        >
          <span className="w-2.5 h-2.5 rounded-xs bg-[#FF4B00] shrink-0" aria-hidden="true" />
          <span>{t('app.brand')}</span>
        </a>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="lg:hidden p-1.5 text-[#A3A3A3] hover:text-white rounded"
          aria-label={t('common.dismiss')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Grouped Navigation */}
      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
        {NAV_GROUPS.map((group) => (
          <div key={group.groupKey} className="space-y-1">
            <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider uppercase text-[#737373]">
              {t(group.groupKey)}
            </div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectTab(item.id)}
                  className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-md text-xs font-medium transition-colors text-start ${
                    active
                      ? 'bg-[#1F1F1F] text-white border-s-2 border-[#FF4B00] font-semibold'
                      : 'text-[#B8B8B8] hover:bg-[#1A1A1A] hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${active ? 'text-[#FF4B00]' : 'text-[#8C8C8C]'}`}
                    />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </span>
                  {item.id === 'investigations' && pendingApprovalsCount > 0 && (
                    <span className="font-mono tabular-nums text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#FF4B00] text-[#121212] shrink-0">
                      {fmtNumber(pendingApprovalsCount)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Quiet Bottom Workspace & Guardrail Anchor */}
      <div className="p-4 border-t border-[#262626] space-y-2.5 text-xs shrink-0">
        {workspace && (
          <div>
            <div className="text-[11px] text-[#737373]">{t('nav.datasetLabel')}</div>
            <div className="font-mono text-[#EBEBEB] truncate mt-0.5">
              {workspace.intake.datasetName}
            </div>
          </div>
        )}
        <div className="flex items-start gap-2 text-[11px] text-[#A3A3A3] pt-2 border-t border-[#222222] leading-snug">
          <ShieldCheck className="w-3.5 h-3.5 text-[#FF4B00] shrink-0 mt-0.5" />
          <span>{t('hero.guardrail')}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#EBEBEB] text-[#121212] flex">
      {/* Persistent Desktop Left Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-e border-[#262626] bg-[#121212] sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile / Tablet Slide-Over Drawer */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-64 max-w-[80vw] h-full border-e border-[#262626] bg-[#121212]">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Workspace Column: Slim Breadcrumb Bar + Content + Footer */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        <header className="h-14 bg-white border-b border-[#D4D4D4] sticky top-0 z-30 shrink-0">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-full flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden p-1.5 -ms-1.5 text-[#121212] hover:bg-[#EBEBEB] rounded-md"
                aria-label={t('nav.menuToggle')}
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2 text-xs min-w-0">
                <span className="font-semibold text-[#525252] hidden sm:inline truncate">
                  {t('app.brand')}
                </span>
                <span className="text-[#A3A3A3] hidden sm:inline">/</span>
                <span className="font-semibold text-[#121212] truncate">
                  {t(TAB_LABEL_KEY[activeTab])}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <label className="sr-only" htmlFor="lang-select">
                {t('lang.label')}
              </label>
              <select
                id="lang-select"
                value={locale}
                onChange={(e) => setLocale(e.target.value as SupportedLocale)}
                className="px-2.5 py-1.5 text-xs font-medium text-[#121212] bg-[#EBEBEB] border border-[#D4D4D4] rounded-md hover:border-[#121212] focus:outline-none focus:ring-2 focus:ring-[#FF4B00]/30 focus:border-[#FF4B00] whitespace-nowrap shrink-0"
              >
                {SUPPORTED_LOCALES.map((code) => (
                  <option key={code} value={code}>
                    {LOCALE_BUNDLES[code]._meta.nativeName}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={openInvestigationsIntake}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#121212] bg-[#FF4B00] rounded-md hover:bg-[#FF6321] transition-colors whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{t('cta.uploadLedger')}</span>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
          {errorMsg && (
            <div className="p-3.5 rounded-md bg-red-50 border border-red-200 text-xs text-red-800 flex items-center justify-between">
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-red-700 font-medium hover:underline ms-4"
              >
                {t('common.dismiss')}
              </button>
            </div>
          )}

          {loading || !workspace ? (
            <div className="space-y-4">
              <div className="h-32 bg-[#121212] border border-[#2A2A2A] rounded-lg animate-pulse" />
              <div className="h-24 bg-white border border-[#D4D4D4] rounded-lg animate-pulse" />
              <div className="h-96 bg-white border border-[#D4D4D4] rounded-lg animate-pulse" />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              >
                {activeTab === 'overview' && (
                  <OverviewView
                    workspace={workspace}
                    onApproveRequest={handleApproveRequest}
                    onTogglePause={handleTogglePause}
                    onRunSwarmCycle={handleRunSwarmCycle}
                    onInspectCase={openCaseInInvestigations}
                    onNavigateToEvidence={openEvidenceInInvestigations}
                    onNavigateToSection={(tab) => selectTab(tab)}
                    busyActionId={busyActionId}
                  />
                )}

                {activeTab === 'swarm' && (
                  <AgentSwarmView
                    workspace={workspace}
                    onTogglePause={handleTogglePause}
                    onRunSwarmCycle={handleRunSwarmCycle}
                    busyActionId={busyActionId}
                  />
                )}

                {activeTab === 'investigations' && (
                  <InvestigationsView
                    workspace={workspace}
                    initialSubTab={investigationsSubTab}
                    focusedRequestId={focusedRequestId}
                    focusedCaseId={focusedCaseId}
                    onApproveRequest={handleApproveRequest}
                    onRemindRequest={handleRemindRequest}
                    onSubmitVerification={handleSubmitVerification}
                    onVerifyCaseResolution={handleVerifyCaseResolution}
                    onWorkspaceUpdated={(next) => setWorkspace(next)}
                    busyActionId={busyActionId}
                  />
                )}

                {activeTab === 'automations' && (
                  <AutomationsView
                    workspace={workspace}
                    onToggleAutomation={handleToggleAutomation}
                    onCreateCustomAutomation={handleCreateCustomAutomation}
                    onSaveAutonomy={handleSaveAutonomy}
                    busyActionId={busyActionId}
                  />
                )}

                {activeTab === 'integrations' && (
                  <IntegrationsView
                    workspace={workspace}
                    onToggleIntegration={handleToggleIntegration}
                    busyActionId={busyActionId}
                  />
                )}

                {activeTab === 'reports' && benchmark && (
                  <ReportsView
                    workspace={workspace}
                    benchmark={benchmark}
                    onRunBenchmark={handleRunBenchmark}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </main>

        <footer className="border-t border-[#D4D4D4] bg-white mt-auto">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#525252]">
            <span>{t('footer.tagline')}</span>
            <span>{t('footer.sub')}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
