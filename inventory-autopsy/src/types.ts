export type SupportedLocale =
  | 'en'
  | 'uz'
  | 'uz-Cyrl'
  | 'ru'
  | 'tr'
  | 'kk'
  | 'zh'
  | 'es'
  | 'ar';

export type DiscrepancyCategory =
  | 'UNPOSTED_RECEIPT'
  | 'DUPLICATE_DISPATCH'
  | 'UOM_MISMATCH'
  | 'CUTOFF_TIMING'
  | 'UNRECORDED_TRANSFER';

export type CheckId =
  | 'CHK_UOM_FACTOR'
  | 'CHK_DUP_DISPATCH'
  | 'CHK_UNPOSTED_RCV'
  | 'CHK_UNRECORDED_XFER'
  | 'CHK_CUTOFF_WINDOW';

export type AbstentionState =
  | 'NONE'
  | 'INSUFFICIENT_EVIDENCE'
  | 'CONFLICTING_SIGNALS';

export interface EvidenceObject {
  caseId: string;
  sku: string;
  warehouse: string;
  causeCode: DiscrepancyCategory;
  checkId: CheckId;
  abstentionState: AbstentionState;
  expectedQty: number;
  countedQty: number;
  varianceUnits: number;
  varianceValue: number;
  docRef: string;
  confidence: number;
}

export type PipelineStage =
  | 'analyzing'
  | 'waiting_for_evidence'
  | 'ready_for_approval'
  | 'verified';

export type AutonomyMode = 'assist' | 'agent';

export interface Hypothesis {
  id: string;
  category: DiscrepancyCategory;
  summary: string;
  explanation: string;
  confidence: number;
  status: 'supported' | 'rejected' | 'pending_evidence';
  mathProof: string;
  requiredDocId: string;
}

export interface ContactPerson {
  id: string;
  name: string;
  role: string;
  department: string;
  channel: 'email' | 'telegram';
  handle: string;
}

export interface EvidenceDocument {
  id: string;
  name: string;
  department: string;
  effortMinutes: number;
  contactId: string;
  coveredCaseIds: string[];
  description: string;
}

export interface VerificationRequest {
  id: string;
  token: string;
  docId: string;
  docName: string;
  contactId: string;
  contactName: string;
  contactRole: string;
  channel: 'email' | 'telegram';
  caseIds: string[];
  sku: string;
  referenceDoc: string;
  question: string;
  options: string[];
  status: 'draft_awaiting_approval' | 'sent_awaiting_reply' | 'responded' | 'verified';
  selectedAnswer?: string;
  employeeNote?: string;
  createdAt: string;
  sentAt?: string;
  respondedAt?: string;
  expiresAt: string;
}

export interface LedgerEntry {
  date: string;
  docRef: string;
  type: string;
  qtyDelta: number;
  runningBalance: number;
}

export interface InvestigationCase {
  id: string;
  groupId: string;
  groupTitle: string;
  sku: string;
  productName: string;
  warehouse: string;
  binLocation: string;
  expectedQty: number;
  countedQty: number;
  varianceUnits: number;
  unitCost: number;
  varianceValue: number;
  category: DiscrepancyCategory;
  stage: PipelineStage;
  hypotheses: Hypothesis[];
  requiredDocIds: string[];
  assignedContactId: string;
  verificationRequestId?: string;
  auditorVerdict: 'pending' | 'challenged' | 'corroborated';
  auditorNote: string;
  preventiveAction: string;
  correctiveAction?: string;
  ledgerTrace: LedgerEntry[];
  evidenceObject?: EvidenceObject;
  updatedAt: string;
}

export interface AgentActivityEvent {
  id: string;
  timestamp: string;
  toolName: string;
  title: string;
  detail: string;
  titleKey?: string;
  detailKey?: string;
  params?: Record<string, string | number>;
  phase: 'completed' | 'active' | 'attention';
}

export interface IntakeSummary {
  datasetName: string;
  uploadedAt: string;
  transactionsAnalyzed: number;
  discrepanciesFound: number;
  hypothesesEvaluated: number;
  groupedInvestigations: number;
  evidenceRequestsNeeded: number;
  columnMapping: Record<string, string>;
  warnings: string[];
}

export interface AutonomyPolicy {
  capability: string;
  assistMode: string;
  agentMode: string;
  locked?: boolean;
}

export interface AutonomyConfig {
  mode: AutonomyMode;
  maxRetriesPerCase: number;
  maxRemindersPerEmployee: number;
  autoSendUnderValue: number;
  escalationHours: number;
  dailyOutreachCap: number;
  policies: AutonomyPolicy[];
}

export interface WorkspaceStats {
  activeInvestigations: number;
  humanActionsNeeded: number;
  verifiedResolutions: number;
  estimatedEffortSavedHours: number;
}

export type SwarmAgentId =
  | 'sentinel'
  | 'data_engineer'
  | 'detective'
  | 'forensic_analyst'
  | 'financial_analyst'
  | 'evidence_hunter'
  | 'communicator'
  | 'resolution'
  | 'auditor'
  | 'prevention'
  | 'reporting'
  | 'learning';

export type MvpSwarmCoreId = 'investigation' | 'evidence' | 'operations' | 'auditor';

export interface SwarmAgentProfile {
  id: SwarmAgentId;
  name: string;
  mvpCore: MvpSwarmCoreId;
  status: 'working' | 'idle' | 'awaiting_input' | 'paused';
  activeTasks: number;
  completedToday: number;
  responsibilities: string;
  permittedActions: string[];
  currentFocus: string;
}

export interface DynamicInvestigationCell {
  id: string;
  code: 'Cell A' | 'Cell B' | 'Cell C' | 'Cell D';
  title: string;
  focusArea: string;
  progressPct: number;
  agentIds: SwarmAgentId[];
  caseIds: string[];
  sharedEvidenceRefs: string[];
  status: 'working' | 'awaiting_input' | 'dissolved';
}

export interface SwarmEvent {
  id: string;
  caseId: string;
  agentId: SwarmAgentId;
  agentName: string;
  taskId: string;
  evidenceRefs: string[];
  timestamp: string;
  status: 'completed' | 'active' | 'awaiting_input' | 'rejected';
  summary: string;
  summaryKey?: string;
  summaryParams?: Record<string, string | number>;
  permittedNextActions: string[];
}

export interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  autonomousAction: string;
  enabled: boolean;
  runsCount: number;
  lastTriggered: string;
  channel: 'dashboard' | 'email' | 'telegram';
  thresholdUsd?: number;
  requiresApproval: boolean;
}

export interface IntegrationConnector {
  id: string;
  name: string;
  priority: 'Essential' | 'Early' | 'Later';
  agentCapability: string;
  status: 'connected' | 'available' | 'planned';
  details: string;
  lastSync?: string;
}

export interface SwarmState {
  paused: boolean;
  activeAgentsCount: number;
  totalAgentsCount: number;
  runningTasks: number;
  completedToday: number;
  workloadMix: {
    deterministicPct: number;
    lightweightAiPct: number;
    advancedReasoningPct: number;
  };
  agents: SwarmAgentProfile[];
  cells: DynamicInvestigationCell[];
  events: SwarmEvent[];
  automations: AutomationRule[];
  integrations: IntegrationConnector[];
}

export interface WorkspaceState {
  intake: IntakeSummary;
  cases: InvestigationCase[];
  evidenceDocs: EvidenceDocument[];
  contacts: ContactPerson[];
  requests: VerificationRequest[];
  activity: AgentActivityEvent[];
  autonomy: AutonomyConfig;
  stats: WorkspaceStats;
  swarm: SwarmState;
}

export interface ApproachBenchmark {
  id: 'manual' | 'chatbot' | 'rules' | 'autopsy';
  name: string;
  rootCauseAccuracy: number;
  numericalAccuracy: number;
  evidenceReliability: number;
  humanInterventions: number;
  duplicateRequests: number;
  avgTimeToResolutionMin: number;
  costPerResolvedCase: number;
  incorrectCaseClosures: number;
  parallelCapacity: string;
}

export interface ScenarioBenchmark {
  scenarioId: string;
  title: string;
  category: DiscrepancyCategory;
  transactions: number;
  discrepancies: number;
  autopsyInterventions: number;
  manualInterventions: number;
  autopsyAccurate: boolean;
  effortSavedPct: number;
}

export interface BenchmarkResult {
  runId: string;
  ranAt: string;
  scenarioCount: number;
  approaches: ApproachBenchmark[];
  scenarioBreakdown: ScenarioBenchmark[];
  trustReport?: TrustReport;
}

export interface ThresholdMetricRow {
  threshold: string;
  overallCoverage: string;
  overallAccuracy: string;
  easy: string;
  medium: string;
  hard: string;
}

export interface TrustReport {
  syntheticNotice: string;
  thresholds: ThresholdMetricRow[];
  missedGate: string[];
  knownLimits: string[];
}

export interface LlmBaselineResult {
  ranAt: string;
  model: string;
  scenariosScored: number;
  rootCauseAccuracy: number;
  numericalAccuracy: number;
  entityValidationPassRate: number;
  abstentionRate: number;
  sampleRowsSent: number;
}

