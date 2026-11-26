import type {
  AgentActivityEvent,
  Hypothesis,
  InvestigationCase,
  SwarmEvent,
  VerificationRequest,
} from '../types';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;
type HasKeyFn = (key: string) => boolean;
type FormatNumberFn = (val: number) => string;

export function localizeRole(role: string, t: TranslateFn, hasKey: HasKeyFn): string {
  const key = `role.${role}`;
  return hasKey(key) ? t(key) : role;
}

export function localizeDepartment(dept: string, t: TranslateFn, hasKey: HasKeyFn): string {
  const key = `dept.${dept}`;
  return hasKey(key) ? t(key) : dept;
}

export function localizeChannel(
  channel: 'email' | 'telegram' | 'dashboard',
  t: TranslateFn,
  hasKey: HasKeyFn
): string {
  const key = `autoPage.channel.${channel}`;
  return hasKey(key) ? t(key) : channel;
}

export function localizeNextActions(
  actions: string[],
  t: TranslateFn,
  hasKey: HasKeyFn
): string {
  return actions
    .map((act) => {
      const key = `action.${act}`;
      return hasKey(key) ? t(key) : act.replace(/_/g, ' ');
    })
    .join(' | ');
}

export function localizeSwarmEventSummary(
  ev: SwarmEvent,
  t: TranslateFn,
  hasKey: HasKeyFn
): string {
  if (ev.summaryKey && hasKey(ev.summaryKey)) {
    return t(ev.summaryKey, ev.summaryParams);
  }
  const idKey = `event.${ev.id}`;
  if (hasKey(idKey)) {
    return t(idKey);
  }
  return ev.summary;
}

export function localizeRequestQuestion(
  req: VerificationRequest,
  cases: InvestigationCase[],
  t: TranslateFn,
  hasKey: HasKeyFn,
  fmtNumber: FormatNumberFn
): string {
  const idKey = `req.${req.id}.question`;
  if (hasKey(idKey)) {
    return t(idKey);
  }
  const leadCase = cases.find((c) => req.caseIds.includes(c.id));
  if (leadCase) {
    return t('req.dynamic.question', {
      doc: t(`doc.${req.docId}`),
      sku: leadCase.sku,
      refDoc: req.referenceDoc,
      expected: fmtNumber(leadCase.expectedQty),
      counted: fmtNumber(leadCase.countedQty),
    });
  }
  return req.question;
}

export function localizeRequestOption(
  req: VerificationRequest,
  opt: string,
  idx: number,
  t: TranslateFn,
  hasKey: HasKeyFn,
  fmtNumber: FormatNumberFn
): string {
  const idKey = `req.${req.id}.opt.${idx}`;
  if (hasKey(idKey)) {
    return t(idKey);
  }
  if (opt.toLowerCase().includes('unable')) {
    return t('req.dynamic.opt.unable');
  }
  const numMatch = opt.match(/-?\d+/);
  if (numMatch) {
    return t('req.dynamic.opt.confirmed', { count: fmtNumber(Number(numMatch[0])) });
  }
  return opt;
}

export function localizeHypothesisExplanation(
  h: Hypothesis,
  c: InvestigationCase,
  t: TranslateFn,
  hasKey: HasKeyFn,
  fmtNumber: FormatNumberFn
): string {
  const idKey = `hyp.${h.id}.expl`;
  if (hasKey(idKey)) {
    return t(idKey);
  }
  const docRef = c.ledgerTrace[c.ledgerTrace.length - 1]?.docRef ?? h.requiredDocId;
  return t('hyp.dynamic.expl', {
    expected: fmtNumber(c.expectedQty),
    counted: fmtNumber(c.countedQty),
    docRef,
  });
}

export function localizeHypothesisMath(
  h: Hypothesis,
  c: InvestigationCase,
  t: TranslateFn,
  hasKey: HasKeyFn,
  fmtNumber: FormatNumberFn,
  fmtSigned: FormatNumberFn
): string {
  const idKey = `hyp.${h.id}.math`;
  if (hasKey(idKey)) {
    return t(idKey);
  }
  return t('hyp.dynamic.math', {
    counted: fmtNumber(c.countedQty),
    expected: fmtNumber(c.expectedQty),
    variance: fmtSigned(c.varianceUnits),
  });
}

export function localizeCaseAuditorNote(
  c: InvestigationCase,
  t: TranslateFn,
  hasKey: HasKeyFn,
  fmtNumber: FormatNumberFn
): string {
  const refDoc = c.ledgerTrace[c.ledgerTrace.length - 1]?.docRef ?? c.verificationRequestId ?? c.id;
  if (c.auditorNote.startsWith('Evidence verified by ')) {
    return t('case.runtime.corroboratedNote', { ref: refDoc });
  }
  if (c.auditorNote.includes('could not verify')) {
    return t('case.runtime.challengedNote', { ref: refDoc });
  }
  const idKey = `case.${c.id}.auditorNote`;
  if (hasKey(idKey)) {
    return t(idKey);
  }
  return t('case.dynamic.auditorNote', {
    pct: fmtNumber(c.hypotheses[0]?.confidence ?? 0),
    warehouse: c.warehouse,
    bin: c.binLocation,
  });
}

export function localizeCasePrevention(
  c: InvestigationCase,
  t: TranslateFn,
  hasKey: HasKeyFn
): string {
  const idKey = `case.${c.id}.prevention`;
  if (hasKey(idKey)) {
    return t(idKey);
  }
  return t('case.dynamic.prevention', {
    warehouse: c.warehouse,
    bin: c.binLocation,
  });
}

export function localizeCaseCorrective(
  c: InvestigationCase,
  t: TranslateFn,
  hasKey: HasKeyFn,
  fmtSigned: FormatNumberFn
): string {
  const idKey = `case.${c.id}.corrective`;
  if (hasKey(idKey)) {
    return t(idKey);
  }
  return t('case.runtime.correctiveAction', {
    sku: c.sku,
    units: fmtSigned(c.varianceUnits),
  });
}

export function localizeActivityEvent(
  ev: AgentActivityEvent,
  t: TranslateFn,
  hasKey: HasKeyFn,
  fmtNumber: FormatNumberFn
): { title: string; detail: string } {
  let title = ev.title;
  let detail = ev.detail;

  if (ev.titleKey && hasKey(ev.titleKey)) {
    title = t(ev.titleKey, ev.params);
  } else if (hasKey(`act.${ev.id}.title`)) {
    title = t(`act.${ev.id}.title`);
  }

  if (ev.detailKey && hasKey(ev.detailKey)) {
    detail = t(ev.detailKey, ev.params);
  } else if (hasKey(`act.${ev.id}.detail`)) {
    detail = t(`act.${ev.id}.detail`);
  } else if (ev.toolName === 'inspect_dataset()') {
    title = t('act.ACT-1.title');
    const numMatch = ev.detail.match(/[\d,]+/);
    detail = numMatch
      ? t('kpi.txnsScanned', { count: fmtNumber(Number(numMatch[0].replace(/,/g, ''))) })
      : ev.detail;
  } else if (ev.toolName === 'reconstruct_inventory()') {
    title = t('act.ACT-2.title');
    const numMatch = ev.detail.match(/\d+/);
    detail = numMatch
      ? `${t('intake.metric.disc')}: ${fmtNumber(Number(numMatch[0]))}`
      : ev.detail;
  } else if (ev.toolName === 'test_hypothesis()') {
    title = t('act.ACT-3.title');
    const numMatch = ev.detail.match(/\d+/);
    detail = numMatch
      ? t('intake.hypothesesEvaluated', { count: fmtNumber(Number(numMatch[0])) })
      : ev.detail;
  } else if (ev.toolName === 'optimize_evidence_requests()') {
    title = t('act.ACT-4.title');
    const numMatch = ev.detail.match(/\d+/);
    detail = numMatch
      ? `${t('intake.metric.req')}: ${fmtNumber(Number(numMatch[0]))}`
      : ev.detail;
  }

  return { title, detail };
}
