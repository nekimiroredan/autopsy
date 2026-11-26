import React, { useState } from 'react';
import { Check, Copy, Plus, Zap } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { AutonomyRulesView } from './AutonomyRulesView';
import type { AutonomyConfig, WorkspaceState } from '../types';

interface AutomationsViewProps {
  workspace: WorkspaceState;
  onToggleAutomation: (id: string) => Promise<void>;
  onCreateCustomAutomation: (payload: {
    name: string;
    trigger: string;
    thresholdUsd: number;
    channel: 'email' | 'telegram' | 'dashboard';
    requiresApproval: boolean;
  }) => Promise<void>;
  onSaveAutonomy: (config: Partial<AutonomyConfig>) => Promise<void>;
  busyActionId: string | null;
}

const TRIGGER_OPTIONS = [
  { value: 'New inventory file', labelKey: 'autoPage.trigger.newFile' },
  { value: 'Cycle-count discrepancy detected', labelKey: 'autoPage.trigger.cycleCount' },
  { value: 'Duplicate outbound scan flagged', labelKey: 'autoPage.trigger.dupScan' },
  { value: 'Verification deadline exceeded (24h)', labelKey: 'autoPage.trigger.deadline' },
] as const;

export const AutomationsView: React.FC<AutomationsViewProps> = ({
  workspace,
  onToggleAutomation,
  onCreateCustomAutomation,
  onSaveAutonomy,
  busyActionId,
}) => {
  const { t, hasKey, fmtNumber } = useI18n();
  const [triggerKey, setTriggerKey] = useState<string>('autoPage.trigger.newFile');
  const [thresholdUsd, setThresholdUsd] = useState(500);
  const [channel, setChannel] = useState<'email' | 'telegram' | 'dashboard'>('email');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [copied, setCopied] = useState(false);
  const [savingRule, setSavingRule] = useState(false);

  const selectedTriggerObj =
    TRIGGER_OPTIONS.find((opt) => opt.labelKey === triggerKey) ?? TRIGGER_OPTIONS[0];
  const localizedTrigger = t(selectedTriggerObj.labelKey);
  const localizedChannel = t(`autoPage.channel.${channel}`);

  const previewText = t('autoPage.previewBody', {
    trigger: localizedTrigger,
    agents: t('autoPage.thenAgents'),
    threshold: fmtNumber(thresholdUsd),
    channel: localizedChannel,
    approvalClause: requiresApproval
      ? t('autoPage.approvalReqText')
      : t('autoPage.approvalAutoText'),
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          trigger: selectedTriggerObj.value,
          activateAgents: ['Detective', 'Forensic Analyst', 'Evidence Hunter', 'Auditor'],
          ifExposureExceedsUsd: thresholdUsd,
          notifyChannel: channel,
          requireApprovalBeforeOutreach: requiresApproval,
          erpWritePolicy: 'human_approval_required',
        },
        null,
        2
      )
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveCustom = async () => {
    setSavingRule(true);
    try {
      await onCreateCustomAutomation({
        name: `${localizedTrigger} > $${thresholdUsd}`,
        trigger: localizedTrigger,
        thresholdUsd,
        channel,
        requiresApproval,
      });
    } finally {
      setSavingRule(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Visual Automation Builder */}
      <section className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-[#D4D4D4] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-[#121212]">{t('autoPage.builderTitle')}</h2>
            <p className="text-xs text-[#525252] mt-0.5">{t('autoPage.builderSub')}</p>
          </div>
          <span className="text-xs font-mono text-[#CC3B00] shrink-0">
            {t('autoPage.builderBadge')}
          </span>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-[#121212] mb-1.5">
                  {t('autoPage.when')}
                </label>
                <select
                  value={triggerKey}
                  onChange={(e) => setTriggerKey(e.target.value)}
                  className="w-full px-3 py-2 bg-[#EBEBEB] border border-[#D4D4D4] rounded-md text-[#121212] focus:outline-none focus:border-[#FF4B00]"
                >
                  {TRIGGER_OPTIONS.map((opt) => (
                    <option key={opt.labelKey} value={opt.labelKey}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#121212] mb-1.5">
                  {t('autoPage.ifExposure')}
                </label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={thresholdUsd}
                  onChange={(e) => setThresholdUsd(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#EBEBEB] border border-[#D4D4D4] rounded-md font-mono tabular-nums text-[#121212] focus:outline-none focus:border-[#FF4B00]"
                />
              </div>
            </div>

            <div>
              <div className="font-semibold text-[#121212] mb-1.5">{t('autoPage.thenCell')}</div>
              <div className="px-3.5 py-2.5 bg-[#121212] text-[#EBEBEB] rounded-md font-mono text-xs">
                {t('autoPage.thenAgents')}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
              <div>
                <div className="font-semibold text-[#121212] mb-1.5">{t('autoPage.notifyVia')}</div>
                <div className="inline-flex items-center gap-1 bg-[#EBEBEB] p-1 rounded-md">
                  {(['email', 'telegram', 'dashboard'] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setChannel(ch)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                        channel === ch
                          ? 'bg-[#121212] text-white'
                          : 'text-[#525252] hover:text-[#121212]'
                      }`}
                    >
                      {t(`autoPage.channel.${ch}`)}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-[#121212] pt-4 sm:pt-0">
                <input
                  type="checkbox"
                  checked={requiresApproval}
                  onChange={(e) => setRequiresApproval(e.target.checked)}
                  className="h-4 w-4 rounded border-[#D4D4D4] text-[#FF4B00] focus:ring-[#FF4B00]"
                />
                <span>{t('autoPage.requireApproval')}</span>
              </label>
            </div>
          </div>

          {/* Live Preview Panel */}
          <div className="lg:col-span-5 bg-[#F5F5F5] rounded-md p-4 space-y-3">
            <div className="text-xs font-semibold text-[#121212]">{t('autoPage.previewTitle')}</div>
            <p className="text-xs text-[#262626] leading-relaxed">{previewText}</p>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button
                type="button"
                disabled={savingRule}
                onClick={handleSaveCustom}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#121212] bg-[#FF4B00] rounded-md hover:bg-[#FF6321] disabled:opacity-50 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {savingRule ? t('autoPage.savingBtn') : t('autoPage.addBtn')}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#121212] bg-white border border-[#D4D4D4] rounded-md hover:bg-[#F7F7F7] transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? t('autoPage.copiedBtn') : t('autoPage.copyBtn')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 10 Ready-Made Automations Library */}
      <section className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-[#D4D4D4] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#FF4B00]" />
            <h3 className="text-base font-semibold text-[#121212]">
              {t('autoPage.libraryTitle', { count: fmtNumber(workspace.swarm.automations.length) })}
            </h3>
          </div>
          <span className="text-xs font-mono text-[#525252]">
            {t('autoPage.enabledCount', {
              count: fmtNumber(workspace.swarm.automations.filter((a) => a.enabled).length),
            })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#D4D4D4] bg-[#F5F5F5] text-[#525252] font-medium">
                <th className="py-2.5 px-5 text-start">{t('autoPage.col.name')}</th>
                <th className="py-2.5 px-4 text-start">{t('autoPage.col.trigger')}</th>
                <th className="py-2.5 px-4 text-start">{t('autoPage.col.action')}</th>
                <th className="py-2.5 px-4 text-end">{t('autoPage.col.runs')}</th>
                <th className="py-2.5 px-5 text-end">{t('autoPage.col.state')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D4D4D4]">
              {workspace.swarm.automations.map((rule) => {
                const nameKey = `auto.${rule.id}.name`;
                const trigKey = `auto.${rule.id}.trigger`;
                const actKey = `auto.${rule.id}.action`;
                return (
                  <tr key={rule.id} className="hover:bg-[#F7F7F7]">
                    <td className="py-3 px-5 font-semibold text-[#121212]">
                      {hasKey(nameKey) ? t(nameKey) : rule.name}
                    </td>
                    <td className="py-3 px-4 text-[#525252]">
                      {hasKey(trigKey) ? t(trigKey) : rule.trigger}
                    </td>
                    <td className="py-3 px-4 text-[#262626]">
                      {hasKey(actKey) ? t(actKey) : rule.autonomousAction}
                    </td>
                    <td className="py-3 px-4 text-end font-mono tabular-nums text-[#525252]">
                      {fmtNumber(rule.runsCount)}
                    </td>
                    <td className="py-3 px-5 text-end">
                      <button
                        type="button"
                        disabled={busyActionId === rule.id}
                        onClick={() => onToggleAutomation(rule.id)}
                        className={`px-3 py-1 rounded text-xs font-semibold transition-colors whitespace-nowrap ${
                          rule.enabled
                            ? 'bg-[#121212] text-white hover:bg-[#2A2A2A]'
                            : 'bg-[#EBEBEB] text-[#525252] hover:text-[#121212]'
                        }`}
                      >
                        {rule.enabled ? t('autoPage.stateActive') : t('autoPage.stateDisabled')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Autonomy & Guardrails Matrix */}
      <AutonomyRulesView autonomy={workspace.autonomy} onSaveAutonomy={onSaveAutonomy} />
    </div>
  );
};
