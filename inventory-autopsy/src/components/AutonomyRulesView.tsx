import React, { useState } from 'react';
import { Lock, Shield, Sliders } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { AutonomyConfig, AutonomyMode } from '../types';

interface AutonomyRulesViewProps {
  autonomy: AutonomyConfig;
  onSaveAutonomy: (config: Partial<AutonomyConfig>) => Promise<void>;
}

export const AutonomyRulesView: React.FC<AutonomyRulesViewProps> = ({
  autonomy,
  onSaveAutonomy,
}) => {
  const { t, hasKey } = useI18n();
  const [mode, setMode] = useState<AutonomyMode>(autonomy.mode);
  const [maxRetriesPerCase, setMaxRetriesPerCase] = useState(autonomy.maxRetriesPerCase);
  const [maxRemindersPerEmployee, setMaxRemindersPerEmployee] = useState(
    autonomy.maxRemindersPerEmployee
  );
  const [autoSendUnderValue, setAutoSendUnderValue] = useState(autonomy.autoSendUnderValue);
  const [escalationHours, setEscalationHours] = useState(autonomy.escalationHours);
  const [dailyOutreachCap, setDailyOutreachCap] = useState(autonomy.dailyOutreachCap);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = async (nextMode?: AutonomyMode) => {
    setSaving(true);
    setSavedNotice(false);
    try {
      await onSaveAutonomy({
        mode: nextMode ?? mode,
        maxRetriesPerCase,
        maxRemindersPerEmployee,
        autoSendUnderValue,
        escalationHours,
        dailyOutreachCap,
      });
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Mode Selector */}
      <section className="bg-white border border-[#D4D4D4] rounded-lg p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[#121212]">{t('autonomy.title')}</h2>
            <p className="text-sm text-[#525252] mt-1">{t('autonomy.desc')}</p>
          </div>

          <div className="flex items-center gap-1.5 bg-[#EBEBEB] p-1 rounded-lg self-start shrink-0">
            <button
              type="button"
              onClick={() => {
                setMode('assist');
                handleSave('assist');
              }}
              className={`px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'assist'
                  ? 'bg-[#121212] text-white'
                  : 'text-[#525252] hover:text-[#121212]'
              }`}
            >
              {t('autonomy.mode.assist')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('agent');
                handleSave('agent');
              }}
              className={`px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'agent'
                  ? 'bg-[#FF4B00] text-[#121212] font-semibold'
                  : 'text-[#525252] hover:text-[#121212]'
              }`}
            >
              {t('autonomy.mode.agent')}
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Capability Policy Matrix */}
        <section className="lg:col-span-7 bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-[#D4D4D4] flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#FF4B00]" />
            <h3 className="text-base font-semibold text-[#121212]">{t('autonomy.matrixTitle')}</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#D4D4D4] bg-[#F5F5F5] text-xs font-medium text-[#525252]">
                  <th className="py-2.5 px-5 text-start">{t('autonomy.col.capability')}</th>
                  <th className="py-2.5 px-4 text-start">{t('autonomy.mode.assist')}</th>
                  <th className="py-2.5 px-4 text-start">{t('autonomy.mode.agent')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D4D4D4] text-xs">
                {autonomy.policies.map((p, idx) => (
                  <tr key={p.capability} className="hover:bg-[#F7F7F7]">
                    <td className="py-3 px-5 font-medium text-[#121212] flex items-center gap-2">
                      {p.locked && <Lock className="w-3.5 h-3.5 text-[#525252] shrink-0" />}
                      {hasKey(`policy.${idx}.cap`) ? t(`policy.${idx}.cap`) : p.capability}
                    </td>
                    <td
                      className={`py-3 px-4 ${
                        mode === 'assist'
                          ? 'font-semibold text-[#121212] bg-[#EBEBEB]/60'
                          : 'text-[#525252]'
                      }`}
                    >
                      {hasKey(`policy.${idx}.assist`) ? t(`policy.${idx}.assist`) : p.assistMode}
                    </td>
                    <td
                      className={`py-3 px-4 ${
                        mode === 'agent'
                          ? 'font-semibold text-[#121212] bg-[#FF4B00]/10'
                          : 'text-[#525252]'
                      }`}
                    >
                      {hasKey(`policy.${idx}.agent`) ? t(`policy.${idx}.agent`) : p.agentMode}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Execution & Outreach Limits */}
        <section className="lg:col-span-5 bg-white border border-[#D4D4D4] rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-[#D4D4D4]">
            <Sliders className="w-4 h-4 text-[#FF4B00]" />
            <h3 className="text-base font-semibold text-[#121212]">{t('autonomy.limitsTitle')}</h3>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-medium text-[#121212] mb-1">
                {t('autonomy.limit.autoSend')}
              </label>
              <input
                type="number"
                min={0}
                max={10000}
                step={50}
                value={autoSendUnderValue}
                onChange={(e) => setAutoSendUnderValue(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[#EBEBEB] border border-[#D4D4D4] rounded-md font-mono tabular-nums text-[#121212] focus:outline-none focus:border-[#FF4B00]"
              />
              <p className="text-[11px] text-[#525252] mt-1">{t('autonomy.limit.autoSendHelp')}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-[#121212] mb-1">
                  {t('autonomy.limit.maxRetries')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={maxRetriesPerCase}
                  onChange={(e) => setMaxRetriesPerCase(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#EBEBEB] border border-[#D4D4D4] rounded-md font-mono tabular-nums text-[#121212]"
                />
              </div>
              <div>
                <label className="block font-medium text-[#121212] mb-1">
                  {t('autonomy.limit.maxReminders')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={3}
                  value={maxRemindersPerEmployee}
                  onChange={(e) => setMaxRemindersPerEmployee(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#EBEBEB] border border-[#D4D4D4] rounded-md font-mono tabular-nums text-[#121212]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-[#121212] mb-1">
                  {t('autonomy.limit.escalation')}
                </label>
                <input
                  type="number"
                  min={4}
                  max={168}
                  value={escalationHours}
                  onChange={(e) => setEscalationHours(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#EBEBEB] border border-[#D4D4D4] rounded-md font-mono tabular-nums text-[#121212]"
                />
              </div>
              <div>
                <label className="block font-medium text-[#121212] mb-1">
                  {t('autonomy.limit.dailyCap')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={dailyOutreachCap}
                  onChange={(e) => setDailyOutreachCap(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#EBEBEB] border border-[#D4D4D4] rounded-md font-mono tabular-nums text-[#121212]"
                />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-[#D4D4D4] flex items-center justify-between gap-3">
            <span className="text-xs text-emerald-700 font-medium">
              {savedNotice ? t('autonomy.saved') : ''}
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave()}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#121212] rounded-md hover:bg-[#2A2A2A] disabled:opacity-50 transition-colors"
            >
              {saving ? t('autonomy.saving') : t('autonomy.saveBtn')}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
