import type {
  AutomationRule,
  DynamicInvestigationCell,
  IntegrationConnector,
  InvestigationCase,
  SwarmAgentId,
  SwarmAgentProfile,
  SwarmEvent,
  SwarmState,
  VerificationRequest,
} from '../types';

export const DEFAULT_AUTOMATIONS: AutomationRule[] = [
  {
    id: 'AUTO-01',
    name: 'Daily Inventory Audit',
    trigger: 'New daily report arrives',
    autonomousAction: 'Activate Sentinel + Data Engineer + Detective swarm to isolate discrepancies',
    enabled: true,
    runsCount: 14,
    lastTriggered: '08:00 today',
    channel: 'dashboard',
    requiresApproval: false,
  },
  {
    id: 'AUTO-02',
    name: 'Financial Risk Alert',
    trigger: 'Discrepancy exposure exceeds threshold',
    autonomousAction: 'Financial Analyst elevates case cell and alerts manager immediately',
    enabled: true,
    runsCount: 6,
    lastTriggered: '08:02 today',
    channel: 'email',
    thresholdUsd: 500,
    requiresApproval: false,
  },
  {
    id: 'AUTO-03',
    name: 'Evidence Collection',
    trigger: 'Investigation requires floor documents',
    autonomousAction: 'Evidence Hunter solves minimum-effort set cover and stages request',
    enabled: true,
    runsCount: 9,
    lastTriggered: '08:03 today',
    channel: 'telegram',
    requiresApproval: true,
  },
  {
    id: 'AUTO-04',
    name: 'Duplicate Prevention',
    trigger: 'Identical outbound/inbound movement detected',
    autonomousAction: 'Flag potential double scan and isolate matching DocRef entries',
    enabled: true,
    runsCount: 4,
    lastTriggered: '08:02 today',
    channel: 'dashboard',
    requiresApproval: false,
  },
  {
    id: 'AUTO-05',
    name: 'Employee Follow-up',
    trigger: 'Approved verification remains unanswered',
    autonomousAction: 'Communicator sends bounded reminders within daily outreach cap',
    enabled: true,
    runsCount: 2,
    lastTriggered: 'Yesterday 17:15',
    channel: 'telegram',
    requiresApproval: false,
  },
  {
    id: 'AUTO-06',
    name: 'Case Escalation',
    trigger: 'Investigation deadline exceeded (24h)',
    autonomousAction: 'Notify Warehouse Manager with compiled evidence dossier',
    enabled: true,
    runsCount: 1,
    lastTriggered: '2 days ago',
    channel: 'email',
    requiresApproval: false,
  },
  {
    id: 'AUTO-07',
    name: 'Resolution Verification',
    trigger: 'Corrected inventory export arrives',
    autonomousAction: 'Auditor Agent recalculates balances and closes corroborated cells',
    enabled: true,
    runsCount: 24,
    lastTriggered: '09:21 today',
    channel: 'dashboard',
    requiresApproval: false,
  },
  {
    id: 'AUTO-08',
    name: 'Recurring Error Review',
    trigger: 'Same cause pattern repeats >= 3 times',
    autonomousAction: 'Prevention & Learning create process-hardening proposal cell',
    enabled: true,
    runsCount: 3,
    lastTriggered: 'Today 09:25',
    channel: 'dashboard',
    requiresApproval: false,
  },
  {
    id: 'AUTO-09',
    name: 'Weekly Management Report',
    trigger: 'End of working week (Fri 17:00)',
    autonomousAction: 'Reporting Agent compiles resolved vs. open exposure briefing',
    enabled: false,
    runsCount: 4,
    lastTriggered: 'Last Friday',
    channel: 'email',
    requiresApproval: false,
  },
  {
    id: 'AUTO-10',
    name: 'Data Quality Monitoring',
    trigger: 'Source spreadsheet schema or units shift',
    autonomousAction: 'Data Engineer isolates malformed rows and flags column drift',
    enabled: true,
    runsCount: 11,
    lastTriggered: '08:01 today',
    channel: 'dashboard',
    requiresApproval: false,
  },
];

export const DEFAULT_INTEGRATIONS: IntegrationConnector[] = [
  {
    id: 'INT-EXCEL',
    name: 'Excel / CSV Ledgers',
    priority: 'Essential',
    agentCapability: 'Read, normalize schemas, and reconstruct stock history from exports',
    status: 'connected',
    details: 'Active zero-ERP ingestion pipeline (.xlsx, .xls, .csv)',
    lastSync: '2 mins ago',
  },
  {
    id: 'INT-EMAIL',
    name: 'Email (SMTP / Workspace)',
    priority: 'Essential',
    agentCapability: 'Dispatch approval-gated document requests and daily management briefings',
    status: 'connected',
    details: 'Routing manager briefings & Warehouse Manager requests',
    lastSync: 'Active',
  },
  {
    id: 'INT-TELEGRAM',
    name: 'Telegram Floor Bot',
    priority: 'Essential',
    agentCapability: 'Send single-question verification links and ingest delivery slip confirmations',
    status: 'connected',
    details: 'Connected to @dmorales_wh1 & @mreyes_dock4',
    lastSync: 'Active',
  },
  {
    id: 'INT-GDRIVE',
    name: 'Google Drive',
    priority: 'Early',
    agentCapability: 'Discover new authorized nightly inventory export folders automatically',
    status: 'available',
    details: 'Ready for read-only folder watch configuration',
  },
  {
    id: 'INT-GSHEETS',
    name: 'Google Sheets',
    priority: 'Early',
    agentCapability: 'Monitor shared cycle-count sheets and receiving registers continuously',
    status: 'available',
    details: 'Ready to bind cycle-count workbook ID',
  },
  {
    id: 'INT-ODOO',
    name: 'Odoo Inventory',
    priority: 'Later',
    agentCapability: 'Retrieve stock moves, picking transfers, and lot valuation deltas',
    status: 'planned',
    details: 'Planned connector (read-only XML-RPC / JSON-RPC)',
  },
  {
    id: 'INT-1C',
    name: '1C:Enterprise',
    priority: 'Later',
    agentCapability: 'Import regional CIS warehouse and accounting stock exports',
    status: 'planned',
    details: 'Planned connector (OData / CommerceML export)',
  },
  {
    id: 'INT-TEAMS',
    name: 'Microsoft Teams',
    priority: 'Later',
    agentCapability: 'Coordinate evidence collection cards with floor supervisors',
    status: 'planned',
    details: 'Planned Adaptive Cards integration',
  },
  {
    id: 'INT-WEBHOOK',
    name: 'REST API / Webhooks',
    priority: 'Later',
    agentCapability: 'Connect custom WMS or ERP event triggers and signed callbacks',
    status: 'available',
    details: 'Endpoint ready: POST /api/intake/upload',
  },
];

export function buildSwarmAgents(
  cases: InvestigationCase[],
  requests: VerificationRequest[],
  paused: boolean
): SwarmAgentProfile[] {
  const openCases = cases.filter((c) => c.stage !== 'verified');
  const waitingEvidence = cases.filter((c) => c.stage === 'waiting_for_evidence');
  const readyApproval = cases.filter((c) => c.stage === 'ready_for_approval');
  const verifiedCases = cases.filter((c) => c.stage === 'verified');
  const draftReqs = requests.filter((r) => r.status === 'draft_awaiting_approval');
  const awaitingReqs = requests.filter((r) => r.status === 'sent_awaiting_reply');

  const st = (active: number, awaiting = false): SwarmAgentProfile['status'] => {
    if (paused) return 'paused';
    if (awaiting) return 'awaiting_input';
    return active > 0 ? 'working' : 'idle';
  };

  return [
    {
      id: 'sentinel',
      name: 'Sentinel',
      mvpCore: 'investigation',
      status: st(1),
      activeTasks: paused ? 0 : 1,
      completedToday: 6,
      responsibilities: 'Monitors connected data sources, detects changes, and initiates investigations.',
      permittedActions: ['watch_exports', 'emit_intake_trigger'],
      currentFocus: `Monitoring cycle-count window across ${new Set(cases.map((c) => c.warehouse)).size} warehouses`,
    },
    {
      id: 'data_engineer',
      name: 'Data Engineer',
      mvpCore: 'investigation',
      status: st(openCases.length > 0 ? 1 : 0),
      activeTasks: paused ? 0 : 2,
      completedToday: 18,
      responsibilities: 'Collects, cleans, and normalizes inventory ledgers into canonical schema.',
      permittedActions: ['inspect_dataset', 'normalize_uom_columns'],
      currentFocus: 'Ledger schema verified with 0 unmapped SKU rows',
    },
    {
      id: 'detective',
      name: 'Detective',
      mvpCore: 'investigation',
      status: st(openCases.length),
      activeTasks: paused ? 0 : Math.max(1, openCases.length),
      completedToday: 14,
      responsibilities: 'Detects discrepancies, merges related clusters, and proposes competing explanations.',
      permittedActions: ['reconstruct_inventory', 'cluster_discrepancies'],
      currentFocus: `${openCases.length} open anomalies grouped into shared root-cause cells`,
    },
    {
      id: 'forensic_analyst',
      name: 'Forensic Analyst',
      mvpCore: 'investigation',
      status: st(openCases.length),
      activeTasks: paused ? 0 : Math.min(6, openCases.length + 2),
      completedToday: 27,
      responsibilities: 'Replays transaction histories chronologically and tests hypotheses against ledger math.',
      permittedActions: ['generate_hypotheses', 'test_hypothesis'],
      currentFocus: 'Testing pack multipliers and duplicate RF scan windows',
    },
    {
      id: 'financial_analyst',
      name: 'Financial Analyst',
      mvpCore: 'investigation',
      status: st(openCases.length > 0 ? 2 : 0),
      activeTasks: paused ? 0 : 3,
      completedToday: 12,
      responsibilities: 'Calculates financial exposure and prioritizes high-value investigations.',
      permittedActions: ['rank_exposure', 'enforce_materiality_limit'],
      currentFocus: 'Flagging high-exposure SKUs exceeding $500 materiality limit',
    },
    {
      id: 'evidence_hunter',
      name: 'Evidence Hunter',
      mvpCore: 'evidence',
      status: st(draftReqs.length + awaitingReqs.length),
      activeTasks: paused ? 0 : Math.max(1, requests.length),
      completedToday: 11,
      responsibilities: 'Computes minimum-effort evidence cover and reuses existing verification tasks.',
      permittedActions: ['optimize_evidence_requests', 'reuse_shared_evidence'],
      currentFocus: `Consolidating ${cases.length} cases into ${requests.length} document requests`,
    },
    {
      id: 'communicator',
      name: 'Communicator',
      mvpCore: 'operations',
      status: st(draftReqs.length + awaitingReqs.length, draftReqs.length > 0 || awaitingReqs.length > 0),
      activeTasks: paused ? 0 : draftReqs.length + awaitingReqs.length,
      completedToday: 8,
      responsibilities: 'Identifies responsible contacts, stages permission-gated requests, and processes replies.',
      permittedActions: ['prepare_verification_link', 'send_approved_request'],
      currentFocus:
        draftReqs.length > 0
          ? `${draftReqs.length} request(s) staged for manager approval`
          : `${awaitingReqs.length} request(s) awaiting employee reply`,
    },
    {
      id: 'resolution',
      name: 'Resolution',
      mvpCore: 'operations',
      status: st(readyApproval.length, readyApproval.length > 0),
      activeTasks: paused ? 0 : readyApproval.length,
      completedToday: verifiedCases.length + 6,
      responsibilities: 'Prepares corrective ledger adjustments and tracks human sign-off completion.',
      permittedActions: ['draft_adjustment', 'track_closure'],
      currentFocus: `${readyApproval.length} case(s) ready for human reconciliation approval`,
    },
    {
      id: 'auditor',
      name: 'Auditor',
      mvpCore: 'auditor',
      status: st(cases.length > 0 ? 3 : 0),
      activeTasks: paused ? 0 : Math.max(2, readyApproval.length + waitingEvidence.length),
      completedToday: 19,
      responsibilities: 'Independently challenges hypotheses, runs fail-closed entity checks, and blocks unsupported closures.',
      permittedActions: ['validate_new_evidence', 'verify_entity_grounding'],
      currentFocus: 'Enforcing abstention gate on sub-78% confidence signals',
    },
    {
      id: 'prevention',
      name: 'Prevention',
      mvpCore: 'auditor',
      status: st(verifiedCases.length > 0 ? 1 : 0),
      activeTasks: paused ? 0 : 2,
      completedToday: 5,
      responsibilities: 'Identifies recurring warehouse workflow failures and drafts process safeguards.',
      permittedActions: ['detect_recurring_patterns', 'propose_scanner_guardrail'],
      currentFocus: 'Recommending RF duplicate-scan lock on Dock 4 & UOM prompts',
    },
    {
      id: 'reporting',
      name: 'Reporting',
      mvpCore: 'operations',
      status: st(1),
      activeTasks: paused ? 0 : 1,
      completedToday: 4,
      responsibilities: 'Compiles structured executive briefings covering resolved, open, and blocked exposure.',
      permittedActions: ['compile_daily_briefing'],
      currentFocus: 'Daily executive briefing continuously synchronized',
    },
    {
      id: 'learning',
      name: 'Learning',
      mvpCore: 'auditor',
      status: 'idle',
      activeTasks: 0,
      completedToday: 4,
      responsibilities: 'Reviews verified closures to propose rule tuning for human review.',
      permittedActions: ['propose_threshold_tuning'],
      currentFocus: 'Evaluating AutopsyBench confidence thresholds (0.778)',
    },
  ];
}

export function buildDynamicCells(
  cases: InvestigationCase[],
  paused: boolean
): DynamicInvestigationCell[] {
  const dupCases = cases.filter(
    (c) => c.category === 'DUPLICATE_DISPATCH' || c.category === 'UOM_MISMATCH'
  );
  const xferCases = cases.filter(
    (c) => c.category === 'UNRECORDED_TRANSFER' || c.category === 'CUTOFF_TIMING'
  );
  const highValueCases = cases.filter((c) => Math.abs(c.varianceValue) >= 700);
  const verifiedCases = cases.filter((c) => c.stage === 'verified');

  const calcPct = (subset: InvestigationCase[], floorPct: number) => {
    if (subset.length === 0) return 100;
    const done = subset.filter((c) => c.stage === 'verified' || c.stage === 'ready_for_approval').length;
    return Math.min(96, Math.max(floorPct, Math.round((done / subset.length) * 100)));
  };

  return [
    {
      id: 'CELL-A',
      code: 'Cell A',
      title: 'Cell A — Receiving & Pack Discrepancies',
      focusArea: 'Transaction & UOM investigation',
      progressPct: calcPct(dupCases, 85),
      agentIds: ['detective', 'forensic_analyst', 'auditor', 'evidence_hunter'],
      caseIds: dupCases.map((c) => c.id),
      sharedEvidenceRefs: ['DOC-RCV', 'DOC-DISPATCH'],
      status: paused ? 'awaiting_input' : dupCases.every((c) => c.stage === 'verified') ? 'dissolved' : 'working',
    },
    {
      id: 'CELL-B',
      code: 'Cell B',
      title: 'Cell B — Missing Transfer & Cutoff Records',
      focusArea: 'Document & transfer investigation',
      progressPct: calcPct(xferCases, 56),
      agentIds: ['evidence_hunter', 'communicator', 'resolution'],
      caseIds: xferCases.map((c) => c.id),
      sharedEvidenceRefs: ['DOC-XFER', 'DOC-RCV'],
      status: 'awaiting_input',
    },
    {
      id: 'CELL-C',
      code: 'Cell C',
      title: 'Cell C — High-Value Financial Exposure',
      focusArea: 'Valuation & materiality audit',
      progressPct: calcPct(highValueCases, 68),
      agentIds: ['financial_analyst', 'forensic_analyst', 'auditor'],
      caseIds: highValueCases.map((c) => c.id),
      sharedEvidenceRefs: ['DOC-RCV', 'DOC-DISPATCH'],
      status: paused ? 'awaiting_input' : 'working',
    },
    {
      id: 'CELL-D',
      code: 'Cell D',
      title: 'Cell D — Recurring Entry Protection',
      focusArea: 'Process & prevention optimization',
      progressPct: verifiedCases.length > 0 ? 74 : 38,
      agentIds: ['learning', 'prevention', 'reporting'],
      caseIds: verifiedCases.map((c) => c.id),
      sharedEvidenceRefs: ['DOC-RCV'],
      status: paused ? 'awaiting_input' : 'working',
    },
  ];
}

export function buildInitialSwarmEvents(cases: InvestigationCase[]): SwarmEvent[] {
  const firstCaseId = cases[0]?.id ?? 'IA-024';
  const secCaseId = cases[1]?.id ?? 'IA-025';
  const thirdCaseId = cases[4]?.id ?? 'IA-028';
  const lastCaseId = cases[6]?.id ?? 'IA-032';

  return [
    {
      id: 'EVT-901',
      caseId: firstCaseId,
      agentId: 'sentinel',
      agentName: 'Sentinel',
      taskId: 'TSK-1001',
      evidenceRefs: ['NorthStar_Nov_Ledger.xlsx'],
      timestamp: '08:00:01',
      status: 'completed',
      summary: 'New inventory report detected across 3 warehouses; initiated autonomous swarm.',
      permittedNextActions: ['normalize_dataset'],
    },
    {
      id: 'EVT-902',
      caseId: firstCaseId,
      agentId: 'data_engineer',
      agentName: 'Data Engineer',
      taskId: 'TSK-1002',
      evidenceRefs: ['NorthStar_Nov_Ledger.xlsx'],
      timestamp: '08:01:12',
      status: 'completed',
      summary: 'Dataset normalized and validated. 25,000 transaction rows published to shared memory.',
      permittedNextActions: ['reconstruct_stock_history'],
    },
    {
      id: 'EVT-903',
      caseId: secCaseId,
      agentId: 'detective',
      agentName: 'Detective',
      taskId: 'TSK-1008',
      evidenceRefs: ['DOC-RCV', 'DOC-XFER'],
      timestamp: '08:02:04',
      status: 'completed',
      summary: `${cases.length} discrepancy cases grouped into 4 Dynamic Investigation Cells.`,
      permittedNextActions: ['spawn_investigation_cells', 'test_hypotheses'],
    },
    {
      id: 'EVT-904',
      caseId: firstCaseId,
      agentId: 'forensic_analyst',
      agentName: 'Forensic Analyst',
      taskId: 'TSK-1014',
      evidenceRefs: ['GRN-1048', 'DOC-RCV'],
      timestamp: '08:02:18',
      status: 'completed',
      summary: 'Requesting Receiving Register for GRN-1048 (2.0x case-pack variance isolated).',
      permittedNextActions: ['check_existing_evidence'],
    },
    {
      id: 'EVT-905',
      caseId: secCaseId,
      agentId: 'evidence_hunter',
      agentName: 'Evidence Hunter',
      taskId: 'TSK-1019',
      evidenceRefs: ['DOC-RCV', 'REQ-RCV-1048'],
      timestamp: '08:02:22',
      status: 'completed',
      summary: 'Receiving Register request already exists. Reusing DOC-RCV task across 4 cases.',
      permittedNextActions: ['stage_consolidated_request'],
    },
    {
      id: 'EVT-906',
      caseId: firstCaseId,
      agentId: 'financial_analyst',
      agentName: 'Financial Analyst',
      taskId: 'TSK-1023',
      evidenceRefs: ['GRN-1048'],
      timestamp: '08:02:31',
      status: 'active',
      summary: `${firstCaseId} elevated into Cell C based on financial exposure exceeding $500.`,
      permittedNextActions: ['notify_manager', 'require_human_approval'],
    },
    {
      id: 'EVT-907',
      caseId: lastCaseId,
      agentId: 'auditor',
      agentName: 'Auditor',
      taskId: 'TSK-1029',
      evidenceRefs: ['DSP-882', 'DOC-DISPATCH'],
      timestamp: '08:02:42',
      status: 'rejected',
      summary: `Abstaining on uncorroborated closure for ${lastCaseId}: insufficient timestamp proof.`,
      permittedNextActions: ['request_dispatch_manifest', 'hold_closure'],
    },
    {
      id: 'EVT-908',
      caseId: thirdCaseId,
      agentId: 'communicator',
      agentName: 'Communicator',
      taskId: 'TSK-1035',
      evidenceRefs: ['DOC-RCV', 'DOC-XFER'],
      timestamp: '08:03:01',
      status: 'awaiting_input',
      summary: 'Consolidated verification requests prepared and paused for human approval.',
      permittedNextActions: ['approve_and_send', 'edit_contact'],
    },
  ];
}

export function buildSwarmState(
  cases: InvestigationCase[],
  requests: VerificationRequest[],
  existing?: Partial<SwarmState>
): SwarmState {
  const paused = existing?.paused ?? false;
  const agents = buildSwarmAgents(cases, requests, paused);
  const activeAgentsCount = agents.filter((a) => a.status === 'working' || a.status === 'awaiting_input').length;
  const runningTasks = agents.reduce((acc, a) => acc + a.activeTasks, 0);
  const completedToday = agents.reduce((acc, a) => acc + a.completedToday, 0);

  return {
    paused,
    activeAgentsCount,
    totalAgentsCount: agents.length,
    runningTasks,
    completedToday,
    workloadMix: {
      deterministicPct: 70,
      lightweightAiPct: 20,
      advancedReasoningPct: 10,
    },
    agents,
    cells: buildDynamicCells(cases, paused),
    events: existing?.events && existing.events.length > 0 ? existing.events : buildInitialSwarmEvents(cases),
    automations: existing?.automations ?? DEFAULT_AUTOMATIONS,
    integrations: existing?.integrations ?? DEFAULT_INTEGRATIONS,
  };
}

export function makeSwarmEvent(params: {
  caseId: string;
  agentId: SwarmAgentId;
  agentName: string;
  evidenceRefs: string[];
  status: SwarmEvent['status'];
  summary: string;
  summaryKey?: string;
  summaryParams?: Record<string, string | number>;
  permittedNextActions: string[];
}): SwarmEvent {
  return {
    id: `EVT-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    caseId: params.caseId,
    agentId: params.agentId,
    agentName: params.agentName,
    taskId: `TSK-${Math.floor(1100 + Math.random() * 8800)}`,
    evidenceRefs: params.evidenceRefs,
    timestamp: new Date().toTimeString().slice(0, 8),
    status: params.status,
    summary: params.summary,
    summaryKey: params.summaryKey,
    summaryParams: params.summaryParams,
    permittedNextActions: params.permittedNextActions,
  };
}
