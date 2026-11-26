import React, { useState } from 'react';
import { Layers, Pause, Play, RefreshCw, Shield } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { MvpSwarmCoreId, SwarmAgentProfile, WorkspaceState } from '../types';

interface AgentSwarmViewProps {
  workspace: WorkspaceState;
  onTogglePause: () => Promise<void>;
  onRunSwarmCycle: () => Promise<void>;
  busyActionId: string | null;
}

const CORE_IDS: Array<MvpSwarmCoreId | 'all'> = [
  'all',
  'investigation',
  'evidence',
  'operations',
  'auditor',
];

const SCENARIO_STEP_NUMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export const AgentSwarmView: React.FC<AgentSwarmViewProps> = ({
  workspace,
  onTogglePause,
  onRunSwarmCycle,
  busyActionId,
}) => {
  const { t, hasKey, fmtNumber } = useI18n();
  const { swarm } = workspace;
  const [coreFilter, setCoreFilter] = useState<MvpSwarmCoreId | 'all'>('all');
  const [selectedAgentId, setSelectedAgentId] = useState<string>(swarm.agents[0]?.id ?? 'sentinel');

  const visibleAgents =
    coreFilter === 'all'
      ? swarm.agents
      : swarm.agents.filter((a) => a.mvpCore === coreFilter);

  const selectedAgent: SwarmAgentProfile =
    swarm.agents.find((a) => a.id === selectedAgentId) ?? swarm.agents[0];

  const getAgentName = (a: SwarmAgentProfile) =>
    hasKey(`agent.${a.id}.name`) ? t(`agent.${a.id}.name`) : a.name;
  const getAgentResp = (a: SwarmAgentProfile) =>
    hasKey(`agent.${a.id}.resp`) ? t(`agent.${a.id}.resp`) : a.responsibilities;
  const getAgentFocus = (a: SwarmAgentProfile) =>
    hasKey(`agent.${a.id}.focus`) ? t(`agent.${a.id}.focus`) : a.currentFocus;

  return (
    <div className="space-y-6">
      {/* Architecture Header & MVP 4-Core Filter */}
      <section className="bg-white border border-[#D4D4D4] rounded-lg p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[#121212]">{t('swarmPage.title')}</h2>
            <p className="text-sm text-[#525252] mt-1">{t('swarmPage.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={busyActionId === 'swarm-pause'}
              onClick={onTogglePause}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-[#121212] text-[#121212] bg-white rounded-md hover:bg-[#EBEBEB] transition-colors whitespace-nowrap shrink-0"
            >
              {swarm.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {swarm.paused ? t('swarmPage.resume') : t('swarmPage.emergencyPause')}
            </button>
            <button
              type="button"
              disabled={swarm.paused || busyActionId === 'swarm-cycle'}
              onClick={onRunSwarmCycle}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#121212] bg-[#FF4B00] rounded-md hover:bg-[#FF6321] disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${busyActionId === 'swarm-cycle' ? 'animate-spin' : ''}`}
              />
              {t('swarmPage.runCycle')}
            </button>
          </div>
        </div>

        {/* Core Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {CORE_IDS.map((coreId) => (
            <button
              key={coreId}
              type="button"
              onClick={() => setCoreFilter(coreId)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                coreFilter === coreId
                  ? 'bg-[#121212] text-white border-[#121212]'
                  : 'bg-[#F5F5F5] text-[#525252] border-[#D4D4D4] hover:text-[#121212]'
              }`}
            >
              {t(`swarmPage.core.${coreId}`)}
            </button>
          ))}
        </div>

        {/* Shared Swarm Intelligence Layer */}
        <div className="bg-[#121212] text-[#EBEBEB] rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Layers className="w-4 h-4 text-[#FF4B00] mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-white">
                {t('swarmPage.sharedLayerTitle')}
              </div>
              <div className="text-xs text-[#B8B8B8] mt-0.5">
                {t('swarmPage.sharedLayerSub')}
              </div>
            </div>
          </div>
          <div className="text-xs font-mono text-[#FF4B00] shrink-0">
            {t('swarmPage.sharedLayerFlow')}
          </div>
        </div>
      </section>

      {/* 12-Agent Workforce Grid + Agent Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleAgents.map((agent) => {
            const selected = selectedAgent.id === agent.id;
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => setSelectedAgentId(agent.id)}
                className={`text-start bg-white border rounded-lg p-4 transition-colors ${
                  selected
                    ? 'border-[#FF4B00] ring-1 ring-[#FF4B00]'
                    : 'border-[#D4D4D4] hover:border-[#121212]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#121212]">{getAgentName(agent)}</span>
                  <span
                    className={`text-[11px] font-mono ${
                      agent.status === 'working'
                        ? 'text-[#CC3B00] font-semibold'
                        : agent.status === 'awaiting_input'
                        ? 'text-amber-700 font-semibold'
                        : 'text-[#525252]'
                    }`}
                  >
                    {t(`swarmPage.agentStatus.${agent.status}`)}
                  </span>
                </div>
                <p className="text-xs text-[#525252] mt-1.5 line-clamp-2">{getAgentResp(agent)}</p>
                <div className="mt-3 pt-2.5 border-t border-[#EBEBEB] flex items-center justify-between text-[11px] font-mono tabular-nums text-[#525252]">
                  <span>{t('swarmPage.activeCount', { count: fmtNumber(agent.activeTasks) })}</span>
                  <span>{t('swarmPage.doneToday', { count: fmtNumber(agent.completedToday) })}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Agent Queue & Permissions Inspector */}
        <aside className="lg:col-span-4 bg-white border border-[#D4D4D4] rounded-lg p-5 space-y-4">
          <div className="pb-3 border-b border-[#D4D4D4]">
            <div className="text-xs font-mono text-[#CC3B00]">
              {t('swarmPage.mvpCoreLabel', { core: t(`swarmPage.core.${selectedAgent.mvpCore}`) })}
            </div>
            <h3 className="text-base font-semibold text-[#121212] mt-1">
              {getAgentName(selectedAgent)}
            </h3>
            <p className="text-xs text-[#525252] mt-1">{getAgentResp(selectedAgent)}</p>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <div className="font-semibold text-[#121212]">{t('swarmPage.currentFocus')}</div>
              <p className="text-[#525252] mt-1">{getAgentFocus(selectedAgent)}</p>
            </div>

            <div>
              <div className="font-semibold text-[#121212]">{t('swarmPage.permittedTools')}</div>
              <div className="mt-1.5 space-y-1 font-mono text-[11px] text-[#121212]">
                {selectedAgent.permittedActions.map((act) => (
                  <div key={act} className="bg-[#EBEBEB] px-2.5 py-1.5 rounded">
                    {act}()
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-[#D4D4D4] space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#121212]">
              <Shield className="w-4 h-4 text-[#CC3B00]" />
              {t('swarmPage.hybridMixTitle')}
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between font-mono tabular-nums">
                <span className="text-[#525252]">{t('swarmPage.mixDeterministic')}</span>
                <span className="font-semibold text-[#121212]">
                  {fmtNumber(swarm.workloadMix.deterministicPct)}%
                </span>
              </div>
              <div className="flex justify-between font-mono tabular-nums">
                <span className="text-[#525252]">{t('swarmPage.mixLightweight')}</span>
                <span className="font-semibold text-[#121212]">
                  {fmtNumber(swarm.workloadMix.lightweightAiPct)}%
                </span>
              </div>
              <div className="flex justify-between font-mono tabular-nums">
                <span className="text-[#525252]">{t('swarmPage.mixAdvanced')}</span>
                <span className="font-semibold text-[#CC3B00]">
                  {fmtNumber(swarm.workloadMix.advancedReasoningPct)}%
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Illustrative Day-in-the-Life Scenario */}
      <section className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-[#D4D4D4] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-[#121212]">{t('swarmPage.scenarioTitle')}</h3>
            <p className="text-xs text-[#525252] mt-0.5">{t('swarmPage.scenarioSub')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 divide-y md:divide-y-0 divide-[#D4D4D4]">
          {SCENARIO_STEP_NUMS.map((num, idx) => {
            const times = ['08:00', '08:01', '08:02', '08:04', '08:05', '09:20', '09:21', '09:22', '09:45', '17:00'];
            return (
              <div
                key={num}
                className={`p-4 ${idx >= 5 ? 'lg:border-t lg:border-[#D4D4D4]' : ''} ${
                  idx % 5 !== 0 ? 'lg:border-s lg:border-[#D4D4D4]' : ''
                } ${idx % 2 !== 0 ? 'md:max-lg:border-s md:max-lg:border-[#D4D4D4]' : ''} ${
                  idx >= 2 ? 'md:max-lg:border-t md:max-lg:border-[#D4D4D4]' : ''
                }`}
              >
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="font-semibold text-[#CC3B00]">{times[idx]}</span>
                  <span className="text-[#525252]">{t('swarmPage.stepLabel', { num: fmtNumber(num) })}</span>
                </div>
                <div className="text-xs font-semibold text-[#121212] mt-1.5">
                  {t(`swarmPage.step.${num}.agent`)}
                </div>
                <p className="text-xs text-[#525252] mt-1 leading-relaxed">
                  {t(`swarmPage.step.${num}.detail`)}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
