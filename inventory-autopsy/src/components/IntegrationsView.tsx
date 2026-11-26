import React from 'react';
import { CheckCircle2, Plug } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { WorkspaceState } from '../types';

interface IntegrationsViewProps {
  workspace: WorkspaceState;
  onToggleIntegration: (id: string) => Promise<void>;
  busyActionId: string | null;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  workspace,
  onToggleIntegration,
  busyActionId,
}) => {
  const { t, hasKey, fmtNumber } = useI18n();
  const { integrations } = workspace.swarm;
  const connectedCount = integrations.filter((i) => i.status === 'connected').length;

  return (
    <div className="space-y-6">
      <section className="bg-white border border-[#D4D4D4] rounded-lg p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#121212]">{t('intPage.title')}</h2>
          <p className="text-sm text-[#525252] mt-1">{t('intPage.sub')}</p>
        </div>
        <div className="text-end shrink-0">
          <div className="text-2xl font-semibold font-mono tabular-nums text-[#121212]">
            {fmtNumber(connectedCount)} / {fmtNumber(integrations.length)}
          </div>
          <div className="text-xs text-[#525252]">{t('intPage.activeChannels')}</div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {integrations.map((item) => {
          const isConnected = item.status === 'connected';
          const isPlanned = item.status === 'planned';
          const nameKey = `int.${item.id}.name`;
          const capKey = `int.${item.id}.cap`;
          const detKey = `int.${item.id}.details`;
          const priorityKey = `intPage.priority.${item.priority}`;

          return (
            <div
              key={item.id}
              className="bg-white border border-[#D4D4D4] rounded-lg p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-semibold text-[#CC3B00]">
                    {hasKey(priorityKey) ? t(priorityKey) : item.priority}
                  </span>
                  <span className="font-mono text-[#525252]">
                    {isConnected
                      ? t('intPage.status.connected', { sync: t('intPage.liveSync') })
                      : isPlanned
                      ? t('intPage.status.planned')
                      : t('intPage.status.available')}
                  </span>
                </div>

                <h3 className="text-base font-semibold text-[#121212] mt-2 flex items-center gap-2">
                  <Plug className="w-4 h-4 text-[#525252] shrink-0" />
                  {hasKey(nameKey) ? t(nameKey) : item.name}
                </h3>
                <p className="text-xs text-[#262626] mt-1.5 leading-relaxed">
                  {hasKey(capKey) ? t(capKey) : item.agentCapability}
                </p>
                <p className="text-xs font-mono text-[#525252] mt-2">
                  {hasKey(detKey) ? t(detKey) : item.details}
                </p>
              </div>

              <div className="pt-3 border-t border-[#EBEBEB] flex items-center justify-between gap-2">
                {isConnected ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t('intPage.authorized')}
                  </span>
                ) : (
                  <span className="text-xs text-[#525252]">
                    {isPlanned ? t('intPage.postMvp') : t('intPage.readyConnect')}
                  </span>
                )}

                {!isPlanned && (
                  <button
                    type="button"
                    disabled={busyActionId === item.id}
                    onClick={() => onToggleIntegration(item.id)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      isConnected
                        ? 'bg-[#EBEBEB] text-[#121212] hover:bg-[#DCDCDC]'
                        : 'bg-[#121212] text-white hover:bg-[#2A2A2A]'
                    }`}
                  >
                    {isConnected ? t('intPage.disconnect') : t('intPage.connect')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
};
