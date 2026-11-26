import React, { useState } from 'react';
import { AlertCircle, BarChart3, Info, Play, ShieldAlert, Terminal } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { BenchmarkResult, LlmBaselineResult } from '../types';

interface AutopsyBenchViewProps {
  benchmark: BenchmarkResult;
  onRunBenchmark: () => Promise<void>;
}

export const AutopsyBenchView: React.FC<AutopsyBenchViewProps> = ({
  benchmark,
  onRunBenchmark,
}) => {
  const { t, hasKey, fmtNumber, fmtCurrency } = useI18n();
  const [running, setRunning] = useState(false);
  const [llmRunning, setLlmRunning] = useState(false);
  const [llmResult, setLlmResult] = useState<LlmBaselineResult | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);

  const handleRun = async () => {
    setRunning(true);
    try {
      await onRunBenchmark();
    } finally {
      setRunning(false);
    }
  };

  const handleRunLlmBaseline = async () => {
    setLlmRunning(true);
    setLlmError(null);
    try {
      const res = await fetch('/api/bench/run-llm-baseline', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setLlmError(data.error || 'Live LLM baseline failed.');
      } else {
        setLlmResult(data);
      }
    } catch {
      setLlmError('Network error running optional LLM baseline.');
    } finally {
      setLlmRunning(false);
    }
  };

  const trust = benchmark.trustReport;

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="bg-white border border-[#D4D4D4] rounded-lg p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-[#525252] font-mono tabular-nums">
            <span>{benchmark.runId}</span>
            <span>·</span>
            <span>{t('bench.scenariosEval', { count: fmtNumber(benchmark.scenarioCount) })}</span>
          </div>
          <h2 className="text-lg font-semibold text-[#121212] mt-1">{t('bench.title')}</h2>
          <p className="text-sm text-[#525252] mt-1">{t('bench.desc')}</p>
        </div>

        <button
          type="button"
          disabled={running}
          onClick={handleRun}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#121212] bg-[#FF4B00] rounded-md hover:bg-[#FF6321] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Play className="w-3.5 h-3.5" />
          {running ? t('bench.running') : t('bench.rerunBtn')}
        </button>
      </section>

      {/* Synthetic Data & Detection F1 By-Construction Notice */}
      <section className="bg-[#FFF4EE] border border-[#FF4B00]/40 rounded-lg p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-[#CC3B00] shrink-0 mt-0.5" />
        <div>
          <h3 className="text-xs font-semibold text-[#121212]">{t('bench.syntheticTitle')}</h3>
          <p className="text-xs text-[#262626] mt-1 leading-relaxed">{t('bench.syntheticBody')}</p>
        </div>
      </section>

      {/* Coverage-Accuracy at Thresholds Split by Easy / Medium / Hard */}
      {trust && (
        <section className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-[#D4D4D4]">
            <h3 className="text-base font-semibold text-[#121212]">{t('bench.thresholdsTitle')}</h3>
            <p className="text-xs text-[#525252] mt-0.5">{t('bench.thresholdsSub')}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#D4D4D4] bg-[#F5F5F5] text-[#525252] font-medium">
                  <th className="py-2.5 px-5 text-start">{t('bench.col.threshold')}</th>
                  <th className="py-2.5 px-4 text-end">{t('bench.col.overallCov')}</th>
                  <th className="py-2.5 px-4 text-end">{t('bench.col.overallAcc')}</th>
                  <th className="py-2.5 px-4 text-end">{t('bench.col.easy')}</th>
                  <th className="py-2.5 px-4 text-end">{t('bench.col.medium')}</th>
                  <th className="py-2.5 px-5 text-end">{t('bench.col.hard')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D4D4D4] font-mono tabular-nums">
                {trust.thresholds.map((row) => (
                  <tr
                    key={row.threshold}
                    className={row.threshold === '0.778' ? 'bg-[#FF4B00]/10 font-semibold' : 'hover:bg-[#F7F7F7]'}
                  >
                    <td className="py-3 px-5 text-[#121212]">{row.threshold}</td>
                    <td className="py-3 px-4 text-end text-[#262626]">{row.overallCoverage}</td>
                    <td className="py-3 px-4 text-end text-[#CC3B00]">{row.overallAccuracy}</td>
                    <td className="py-3 px-4 text-end text-[#525252]">{row.easy}</td>
                    <td className="py-3 px-4 text-end text-[#525252]">{row.medium}</td>
                    <td className="py-3 px-5 text-end text-[#525252]">{row.hard}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Missed Gate & Known Limits pulled from RESULTS.md */}
      {trust && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white border border-[#D4D4D4] rounded-lg p-5">
            <div className="flex items-center gap-2 pb-3 border-b border-[#D4D4D4]">
              <ShieldAlert className="w-4 h-4 text-[#CC3B00] shrink-0" />
              <h3 className="text-sm font-semibold text-[#121212]">{t('bench.missedGateTitle')}</h3>
            </div>
            <ul className="mt-3 space-y-2.5 text-xs text-[#262626] leading-relaxed">
              {trust.missedGate.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-[#CC3B00] font-mono shrink-0">•</span>
                  <span>{hasKey(`trust.missedGate.${idx}`) ? t(`trust.missedGate.${idx}`) : item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="bg-white border border-[#D4D4D4] rounded-lg p-5">
            <div className="flex items-center gap-2 pb-3 border-b border-[#D4D4D4]">
              <AlertCircle className="w-4 h-4 text-[#525252] shrink-0" />
              <h3 className="text-sm font-semibold text-[#121212]">{t('bench.knownLimitsTitle')}</h3>
            </div>
            <ul className="mt-3 space-y-2 text-xs text-[#262626] leading-relaxed">
              {trust.knownLimits.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-[#525252] font-mono shrink-0">{fmtNumber(idx + 1)}.</span>
                  <span>{hasKey(`trust.knownLimits.${idx}`) ? t(`trust.knownLimits.${idx}`) : item}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {/* Optional Live Raw-CSV LLM Baseline (Off by default) */}
      <section className="bg-white border border-[#D4D4D4] rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[#121212]">{t('bench.llmBaselineTitle')}</h3>
            <p className="text-xs text-[#525252] mt-1">{t('bench.llmBaselineDesc')}</p>
            <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-mono text-[#525252]">
              <Terminal className="w-3.5 h-3.5" />
              <span>{t('bench.llmCliHint')}</span>
            </div>
          </div>
          <button
            type="button"
            disabled={llmRunning}
            onClick={handleRunLlmBaseline}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#121212] rounded-md hover:bg-[#2A2A2A] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
            {llmRunning ? t('bench.llmRunning') : t('bench.llmRunBtn')}
          </button>
        </div>

        {llmError && (
          <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800">
            {llmError}
          </div>
        )}

        {llmResult && (
          <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-[#D4D4D4] bg-[#F5F5F5] border border-[#D4D4D4] rounded-md text-xs">
            <div className="p-3">
              <div className="text-[#525252]">{t('bench.metric.rootCause')}</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-[#121212] mt-0.5">
                {fmtNumber(llmResult.rootCauseAccuracy)}%
              </div>
            </div>
            <div className="p-3">
              <div className="text-[#525252]">{t('bench.metric.numerical')}</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-[#121212] mt-0.5">
                {fmtNumber(llmResult.numericalAccuracy)}%
              </div>
            </div>
            <div className="p-3">
              <div className="text-[#525252]">{t('bench.llm.entityGrounding')}</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-[#121212] mt-0.5">
                {fmtNumber(llmResult.entityValidationPassRate)}%
              </div>
            </div>
            <div className="p-3">
              <div className="text-[#525252]">{t('bench.llm.abstentionRate')}</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-[#121212] mt-0.5">
                {fmtNumber(llmResult.abstentionRate)}%
              </div>
            </div>
            <div className="p-3">
              <div className="text-[#525252]">{t('bench.llm.csvRowsSent')}</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-[#121212] mt-0.5">
                {fmtNumber(llmResult.sampleRowsSent)}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Main Comparison Matrix (AutopsyBench: Swarm Edition) */}
      <section className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-[#D4D4D4] flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#FF4B00]" />
          <h3 className="text-base font-semibold text-[#121212]">{t('bench.matrixTitle')}</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#D4D4D4] bg-[#F5F5F5] text-xs font-medium text-[#525252]">
                <th className="py-3 px-5 text-start">{t('bench.col.metric')}</th>
                {benchmark.approaches.map((a) => (
                  <th
                    key={a.id}
                    className={`py-3 px-4 text-end ${
                      a.id === 'autopsy' ? 'text-[#121212] font-semibold bg-[#FF4B00]/10' : ''
                    }`}
                  >
                    {t(`bench.approach.${a.id}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D4D4D4] text-xs">
              <tr>
                <td className="py-3 px-5 font-medium text-[#121212]">{t('bench.metric.rootCause')}</td>
                {benchmark.approaches.map((a) => (
                  <td
                    key={a.id}
                    className={`py-3 px-4 text-end font-mono tabular-nums ${
                      a.id === 'autopsy' ? 'font-semibold text-[#CC3B00] bg-[#FF4B00]/5' : 'text-[#262626]'
                    }`}
                  >
                    {fmtNumber(a.rootCauseAccuracy)}%
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 px-5 font-medium text-[#121212]">{t('bench.metric.numerical')}</td>
                {benchmark.approaches.map((a) => (
                  <td
                    key={a.id}
                    className={`py-3 px-4 text-end font-mono tabular-nums ${
                      a.id === 'autopsy' ? 'font-semibold text-[#CC3B00] bg-[#FF4B00]/5' : 'text-[#262626]'
                    }`}
                  >
                    {fmtNumber(a.numericalAccuracy)}%
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 px-5 font-medium text-[#121212]">{t('bench.metric.reliability')}</td>
                {benchmark.approaches.map((a) => (
                  <td
                    key={a.id}
                    className={`py-3 px-4 text-end font-mono tabular-nums ${
                      a.id === 'autopsy' ? 'font-semibold text-[#CC3B00] bg-[#FF4B00]/5' : 'text-[#262626]'
                    }`}
                  >
                    {fmtNumber(a.evidenceReliability)}%
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 px-5 font-medium text-[#121212]">{t('bench.metric.interventions')}</td>
                {benchmark.approaches.map((a) => (
                  <td
                    key={a.id}
                    className={`py-3 px-4 text-end font-mono tabular-nums ${
                      a.id === 'autopsy' ? 'font-semibold text-[#CC3B00] bg-[#FF4B00]/5' : 'text-[#262626]'
                    }`}
                  >
                    {fmtNumber(a.humanInterventions)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 px-5 font-medium text-[#121212]">{t('bench.metric.duplicates')}</td>
                {benchmark.approaches.map((a) => (
                  <td
                    key={a.id}
                    className={`py-3 px-4 text-end font-mono tabular-nums ${
                      a.id === 'autopsy' ? 'font-semibold text-[#CC3B00] bg-[#FF4B00]/5' : 'text-[#262626]'
                    }`}
                  >
                    {fmtNumber(a.duplicateRequests)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 px-5 font-medium text-[#121212]">{t('bench.metric.time')}</td>
                {benchmark.approaches.map((a) => (
                  <td
                    key={a.id}
                    className={`py-3 px-4 text-end font-mono tabular-nums ${
                      a.id === 'autopsy' ? 'font-semibold text-[#CC3B00] bg-[#FF4B00]/5' : 'text-[#262626]'
                    }`}
                  >
                    {t('bench.timeValue', { min: fmtNumber(a.avgTimeToResolutionMin) })}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 px-5 font-medium text-[#121212]">{t('bench.metric.cost')}</td>
                {benchmark.approaches.map((a) => (
                  <td
                    key={a.id}
                    className={`py-3 px-4 text-end font-mono tabular-nums ${
                      a.id === 'autopsy' ? 'font-semibold text-[#CC3B00] bg-[#FF4B00]/5' : 'text-[#262626]'
                    }`}
                  >
                    {fmtCurrency(a.costPerResolvedCase)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 px-5 font-medium text-[#121212]">{t('bench.metric.incorrect')}</td>
                {benchmark.approaches.map((a) => (
                  <td
                    key={a.id}
                    className={`py-3 px-4 text-end font-mono tabular-nums ${
                      a.id === 'autopsy' ? 'font-semibold text-[#CC3B00] bg-[#FF4B00]/5' : 'text-[#262626]'
                    }`}
                  >
                    {fmtNumber(a.incorrectCaseClosures)}%
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 px-5 font-medium text-[#121212]">{t('bench.metric.parallel')}</td>
                {benchmark.approaches.map((a) => (
                  <td
                    key={a.id}
                    className={`py-3 px-4 text-end font-mono tabular-nums ${
                      a.id === 'autopsy' ? 'font-semibold text-[#121212] bg-[#FF4B00]/10' : 'text-[#525252]'
                    }`}
                  >
                    {t(`bench.parallel.${a.id}`)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-Scenario Trace */}
      <section className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-[#D4D4D4]">
          <h3 className="text-base font-semibold text-[#121212]">{t('bench.traceTitle')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#D4D4D4] bg-[#F5F5F5] text-[#525252] font-medium">
                <th className="py-2.5 px-5 text-start">{t('bench.trace.scenario')}</th>
                <th className="py-2.5 px-3 text-start">{t('bench.trace.class')}</th>
                <th className="py-2.5 px-3 text-end">{t('bench.trace.manual')}</th>
                <th className="py-2.5 px-3 text-end">{t('bench.trace.autopsy')}</th>
                <th className="py-2.5 px-3 text-end">{t('bench.trace.reduction')}</th>
                <th className="py-2.5 px-5 text-end">{t('bench.trace.verdict')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D4D4D4] font-mono tabular-nums">
              {benchmark.scenarioBreakdown.map((s) => (
                <tr key={s.scenarioId} className="hover:bg-[#F7F7F7]">
                  <td className="py-2.5 px-5 font-sans font-medium text-[#121212]">{s.title}</td>
                  <td className="py-2.5 px-3 font-sans text-[#525252]">{t(`cause.${s.category}`)}</td>
                  <td className="py-2.5 px-3 text-end text-[#525252]">
                    {fmtNumber(s.manualInterventions)}
                  </td>
                  <td className="py-2.5 px-3 text-end text-[#CC3B00] font-semibold">
                    {fmtNumber(s.autopsyInterventions)}
                  </td>
                  <td className="py-2.5 px-3 text-end text-emerald-700">
                    {fmtNumber(s.effortSavedPct)}%
                  </td>
                  <td className="py-2.5 px-5 text-end font-sans">
                    <span
                      className={
                        s.autopsyAccurate
                          ? 'text-emerald-700 font-medium'
                          : 'text-[#CC3B00] font-medium'
                      }
                    >
                      {s.autopsyAccurate ? t('bench.verdict.accurate') : t('bench.verdict.escalated')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
