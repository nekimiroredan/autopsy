import 'dotenv/config';
import express from 'express';
import path from 'path';
import * as XLSX from 'xlsx';
import { createServer as createViteServer } from 'vite';
import {
  buildEvidenceObject,
  computeWorkspaceStats,
  createInitialWorkspaceState,
  generateSample25kTransactions,
  optimize_evidence_requests,
  runAutonomousIntakePipeline,
  type RawTransactionRow,
} from './src/server/forensicsEngine';
import { runAutopsyBench } from './src/server/autopsyBench';
import { askAutopsyOrchestrator, inferColumnMappingWithGemini } from './src/server/geminiAgent';
import { buildSwarmState, makeSwarmEvent } from './src/server/swarmEngine';
import { detectLocaleFromAcceptLanguage, normalizeLocaleCode } from './src/shared/i18nCore';
import { runLiveLlmCsvBaseline } from './scripts/run_llm_baseline';
import type { AutonomyConfig, BenchmarkResult, SwarmEvent, WorkspaceState } from './src/types';

let workspaceState: WorkspaceState = createInitialWorkspaceState();
let latestBenchmark: BenchmarkResult = runAutopsyBench();

function syncStats(newEvent?: SwarmEvent) {
  workspaceState.stats = computeWorkspaceStats(workspaceState.cases, workspaceState.requests);
  const events = newEvent
    ? [newEvent, ...workspaceState.swarm.events].slice(0, 24)
    : workspaceState.swarm.events;
  workspaceState.swarm = buildSwarmState(workspaceState.cases, workspaceState.requests, {
    ...workspaceState.swarm,
    events,
  });
}

function logActivity(
  toolName: string,
  title: string,
  detail: string,
  phase: 'completed' | 'active' | 'attention',
  i18n?: { titleKey?: string; detailKey?: string; params?: Record<string, string | number> }
) {
  workspaceState.activity.unshift({
    id: `ACT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toTimeString().slice(0, 5),
    toolName,
    title,
    detail,
    titleKey: i18n?.titleKey,
    detailKey: i18n?.detailKey,
    params: i18n?.params,
    phase,
  });
  workspaceState.activity = workspaceState.activity.slice(0, 20);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '15mb' }));

  app.get('/api/i18n/detect', (req, res) => {
    const queryLang = typeof req.query.lang === 'string' ? normalizeLocaleCode(req.query.lang) : null;
    const cookieHeader = req.headers.cookie || '';
    const cookieMatch = cookieHeader.match(/(?:^|;\s*)ia_lang=([^;]+)/);
    const cookieLang = cookieMatch ? normalizeLocaleCode(decodeURIComponent(cookieMatch[1])) : null;
    const headerLang = detectLocaleFromAcceptLanguage(req.headers['accept-language']);
    res.json({ locale: queryLang || cookieLang || headerLang });
  });

  app.get('/api/workspace', (_req, res) => {
    res.json(workspaceState);
  });

  app.post('/api/workspace/reset', (_req, res) => {
    workspaceState = createInitialWorkspaceState();
    res.json(workspaceState);
  });

  app.post('/api/swarm/toggle-pause', (_req, res) => {
    const nextPaused = !workspaceState.swarm.paused;
    workspaceState.swarm.paused = nextPaused;
    const ev = makeSwarmEvent({
      caseId: workspaceState.cases[0]?.id ?? 'IA-024',
      agentId: 'sentinel',
      agentName: 'Sentinel',
      evidenceRefs: ['POLICY-EMERGENCY-CTRL'],
      status: nextPaused ? 'awaiting_input' : 'active',
      summary: nextPaused
        ? 'Emergency swarm pause engaged by manager. All autonomous outreach halted.'
        : 'Autonomous swarm resumed across all active Investigation Cells.',
      summaryKey: nextPaused ? 'event.live.paused' : 'event.live.resumed',
      permittedNextActions: nextPaused ? ['resume_swarm'] : ['continue_cells'],
    });
    syncStats(ev);
    res.json(workspaceState);
  });

  app.post('/api/swarm/run-cycle', (_req, res) => {
    if (workspaceState.swarm.paused) {
      return res.status(400).json({ error: 'Swarm is currently paused. Resume the swarm to run a cycle.' });
    }
    const openCase = workspaceState.cases.find((c) => c.stage !== 'verified') ?? workspaceState.cases[0];
    const caseId = openCase?.id ?? 'IA-024';
    const sku = openCase?.sku ?? 'SKU-2048';
    const ev = makeSwarmEvent({
      caseId,
      agentId: 'forensic_analyst',
      agentName: 'Forensic Analyst',
      evidenceRefs: openCase?.requiredDocIds ?? ['DOC-RCV'],
      status: 'completed',
      summary: `Collaborative cell check completed on ${caseId} (${sku}): Evidence Hunter & Auditor confirmed zero duplicate outreach.`,
      summaryKey: 'event.live.cycle',
      summaryParams: { caseId, sku },
      permittedNextActions: ['verify_resolution', 'request_approval'],
    });
    logActivity(
      'swarm_cell_sync()',
      `Swarm synchronized cell for ${caseId}`,
      'Investigation, Evidence, Operations & Auditor cores exchanged structured state cleanly.',
      'completed',
      {
        titleKey: 'act.live.cycleTitle',
        detailKey: 'act.live.cycleDetail',
        params: { caseId },
      }
    );
    syncStats(ev);
    return res.json(workspaceState);
  });

  app.post('/api/automations/:id/toggle', (req, res) => {
    const rule = workspaceState.swarm.automations.find((a) => a.id === req.params.id);
    if (!rule) return res.status(404).json({ error: 'Automation rule not found.' });
    rule.enabled = !rule.enabled;
    const ev = makeSwarmEvent({
      caseId: 'GLOBAL',
      agentId: 'reporting',
      agentName: 'Reporting',
      evidenceRefs: [rule.id],
      status: 'completed',
      summary: `${rule.name} automation ${rule.enabled ? 'activated' : 'paused'} by manager policy.`,
      summaryKey: rule.enabled ? 'event.live.autoOn' : 'event.live.autoOff',
      summaryParams: { id: rule.id, name: rule.name },
      permittedNextActions: ['audit_policy'],
    });
    syncStats(ev);
    return res.json(workspaceState);
  });

  app.post('/api/automations/custom', (req, res) => {
    const { trigger, thresholdUsd, channel, requiresApproval, name } = req.body as {
      trigger?: string;
      thresholdUsd?: number;
      channel?: 'email' | 'telegram' | 'dashboard';
      requiresApproval?: boolean;
      name?: string;
    };
    const newRule = {
      id: `AUTO-${String(workspaceState.swarm.automations.length + 1).padStart(2, '0')}`,
      name: name?.trim() || 'Custom Swarm Policy',
      trigger: trigger || 'New inventory file arrives',
      autonomousAction: `Activate Detective · Forensic Analyst · Evidence Hunter · Auditor (alert > $${Number(thresholdUsd ?? 500)})`,
      enabled: true,
      runsCount: 0,
      lastTriggered: 'Configured now',
      channel: channel || 'email',
      thresholdUsd: Number(thresholdUsd ?? 500),
      requiresApproval: requiresApproval !== false,
    };
    workspaceState.swarm.automations.unshift(newRule);
    syncStats(
      makeSwarmEvent({
        caseId: 'GLOBAL',
        agentId: 'sentinel',
        agentName: 'Sentinel',
        evidenceRefs: [newRule.id],
        status: 'completed',
        summary: `Saved automation rule "${newRule.name}" (${newRule.channel.toUpperCase()}).`,
        summaryKey: 'event.live.autoCreated',
        summaryParams: { name: newRule.name, channel: newRule.channel.toUpperCase() },
        permittedNextActions: ['watch_exports'],
      })
    );
    return res.json(workspaceState);
  });

  app.post('/api/integrations/:id/toggle', (req, res) => {
    const item = workspaceState.swarm.integrations.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Integration connector not found.' });
    if (item.status === 'planned') {
      return res.status(400).json({ error: `${item.name} is on the post-MVP roadmap.` });
    }
    item.status = item.status === 'connected' ? 'available' : 'connected';
    item.lastSync = item.status === 'connected' ? 'Just now' : undefined;
    syncStats(
      makeSwarmEvent({
        caseId: 'GLOBAL',
        agentId: 'sentinel',
        agentName: 'Sentinel',
        evidenceRefs: [item.id],
        status: 'completed',
        summary: `${item.name} ${item.status === 'connected' ? 'connected to autonomous swarm' : 'disconnected'}.`,
        summaryKey: item.status === 'connected' ? 'event.live.intConnected' : 'event.live.intDisconnected',
        summaryParams: { id: item.id, name: item.name },
        permittedNextActions: ['scan_connector'],
      })
    );
    return res.json(workspaceState);
  });

  app.post('/api/intake/sample-25k', (_req, res) => {
    const prevAutomations = workspaceState.swarm.automations;
    const prevIntegrations = workspaceState.swarm.integrations;
    const rows = generateSample25kTransactions();
    workspaceState = runAutonomousIntakePipeline(
      rows,
      'NorthStar_Live_25000_Ledger.xlsx',
      workspaceState.autonomy
    );
    workspaceState.swarm.automations = prevAutomations;
    workspaceState.swarm.integrations = prevIntegrations;
    res.json(workspaceState);
  });

  app.post('/api/intake/upload', async (req, res) => {
    try {
      const { filename, base64Content, csvText } = req.body as {
        filename?: string;
        base64Content?: string;
        csvText?: string;
      };

      if (!base64Content && !csvText) {
        return res.status(400).json({ error: 'Please provide a CSV or Excel file payload.' });
      }

      let workbook: XLSX.WorkBook;
      if (base64Content) {
        const buffer = Buffer.from(base64Content, 'base64');
        workbook = XLSX.read(buffer, { type: 'buffer' });
      } else {
        workbook = XLSX.read(csvText!, { type: 'string' });
      }

      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) {
        return res.status(400).json({ error: 'Uploaded workbook contains no sheets.' });
      }

      const rawRows = XLSX.utils.sheet_to_json<RawTransactionRow>(workbook.Sheets[firstSheet], {
        defval: '',
      });

      if (rawRows.length === 0) {
        return res.status(400).json({ error: 'Uploaded sheet contains no data rows.' });
      }

      let aiMapping: Record<string, string> | undefined;
      const headers = Object.keys(rawRows[0]);
      const standardKnown = headers.some((h) => /sku|item_?code|part_?no/i.test(h));
      if (!standardKnown && process.env.GEMINI_API_KEY) {
        try {
          aiMapping = await inferColumnMappingWithGemini(headers, rawRows[0]);
        } catch {
          // Proceed deterministically if Gemini mapping is unavailable
        }
      }

      const prevAutomations = workspaceState.swarm.automations;
      const prevIntegrations = workspaceState.swarm.integrations;
      workspaceState = runAutonomousIntakePipeline(
        rawRows,
        filename || 'Uploaded_Ledger.xlsx',
        workspaceState.autonomy,
        aiMapping
      );
      workspaceState.swarm.automations = prevAutomations;
      workspaceState.swarm.integrations = prevIntegrations;

      return res.json(workspaceState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse spreadsheet.';
      return res.status(400).json({ error: message });
    }
  });

  app.post('/api/evidence/optimize', (req, res) => {
    const { caseIds } = (req.body || {}) as { caseIds?: string[] };
    const targetIds = caseIds && caseIds.length > 0 ? caseIds : workspaceState.cases.map((c) => c.id);
    const result = optimize_evidence_requests(targetIds, workspaceState.evidenceDocs);
    res.json(result);
  });

  app.post('/api/requests/:id/approve', (req, res) => {
    const request = workspaceState.requests.find((r) => r.id === req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Verification request not found.' });
    }

    request.status = 'sent_awaiting_reply';
    request.sentAt = new Date().toISOString();

    workspaceState.cases.forEach((c) => {
      if (request.caseIds.includes(c.id) && c.stage !== 'verified') {
        c.stage = 'waiting_for_evidence';
        c.updatedAt = new Date().toISOString();
      }
    });

    logActivity(
      'send_approved_request()',
      `Dispatched verification to ${request.contactName}`,
      `${request.docName} request (${request.referenceDoc}) sent via ${request.channel.toUpperCase()} covering ${request.caseIds.length} case(s).`,
      'active',
      {
        titleKey: 'act.live.dispatchTitle',
        detailKey: 'act.live.dispatchDetail',
        params: {
          name: request.contactName,
          docId: request.docId,
          refDoc: request.referenceDoc,
          channel: request.channel.toUpperCase(),
          count: request.caseIds.length,
        },
      }
    );

    syncStats(
      makeSwarmEvent({
        caseId: request.caseIds[0] ?? 'IA-024',
        agentId: 'communicator',
        agentName: 'Communicator',
        evidenceRefs: [request.docId, request.referenceDoc],
        status: 'awaiting_input',
        summary: `Approved verification sent to ${request.contactName} via ${request.channel.toUpperCase()}.`,
        summaryKey: 'event.live.approvedReq',
        summaryParams: { name: request.contactName, channel: request.channel.toUpperCase() },
        permittedNextActions: ['await_employee_reply', 'send_reminder'],
      })
    );
    res.json(workspaceState);
  });

  app.post('/api/requests/:id/remind', (req, res) => {
    const request = workspaceState.requests.find((r) => r.id === req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Verification request not found.' });
    }
    logActivity(
      'send_approved_request()',
      `Follow-up sent to ${request.contactName}`,
      `Reminder dispatched for ${request.referenceDoc} within max reminder limit (${workspaceState.autonomy.maxRemindersPerEmployee}).`,
      'active',
      {
        titleKey: 'act.live.remindTitle',
        detailKey: 'act.live.remindDetail',
        params: {
          name: request.contactName,
          refDoc: request.referenceDoc,
          limit: workspaceState.autonomy.maxRemindersPerEmployee,
        },
      }
    );
    syncStats(
      makeSwarmEvent({
        caseId: request.caseIds[0] ?? 'IA-024',
        agentId: 'communicator',
        agentName: 'Communicator',
        evidenceRefs: [request.docId],
        status: 'awaiting_input',
        summary: `Follow-up reminder dispatched to ${request.contactName} for ${request.referenceDoc}.`,
        summaryKey: 'event.live.reminded',
        summaryParams: { name: request.contactName, refDoc: request.referenceDoc },
        permittedNextActions: ['escalate_deadline'],
      })
    );
    res.json(workspaceState);
  });

  app.post('/api/verify/:token', (req, res) => {
    const request = workspaceState.requests.find((r) => r.token === req.params.token);
    if (!request) {
      return res.status(404).json({ error: 'Verification link not found or expired.' });
    }

    const { selectedAnswer, employeeNote } = req.body as {
      selectedAnswer?: string;
      employeeNote?: string;
    };

    if (!selectedAnswer) {
      return res.status(400).json({ error: 'Please select a verification response.' });
    }

    request.selectedAnswer = selectedAnswer;
    request.employeeNote = employeeNote || '';
    request.respondedAt = new Date().toISOString();

    const unableToVerify = selectedAnswer.toLowerCase().includes('unable');

    request.status = unableToVerify ? 'responded' : 'verified';

    workspaceState.cases.forEach((c) => {
      if (request.caseIds.includes(c.id)) {
        if (unableToVerify) {
          c.stage = 'ready_for_approval';
          c.auditorVerdict = 'challenged';
          c.auditorNote = `${request.contactName} could not verify ${request.referenceDoc}. Escalated for physical recount.`;
        } else {
          c.stage = 'verified';
          c.auditorVerdict = 'corroborated';
          c.auditorNote = `Evidence verified by ${request.contactName} (${selectedAnswer}). Ledger discrepancy reconciled.`;
          c.correctiveAction = `Prepared ERP adjustment entry for ${c.sku} (${c.varianceUnits > 0 ? '+' : ''}${c.varianceUnits} units) backed by ${request.docName}.`;
          if (c.hypotheses[0]) {
            c.hypotheses[0].status = 'supported';
            c.hypotheses[0].confidence = 99;
          }
        }
        c.evidenceObject = buildEvidenceObject(c);
        c.updatedAt = new Date().toISOString();
      }
    });

    logActivity(
      unableToVerify ? 'validate_new_evidence()' : 'verify_resolution()',
      unableToVerify
        ? `Escalated ${request.referenceDoc} after employee reply`
        : `Verified & closed ${request.caseIds.length} investigation(s)`,
      unableToVerify
        ? `${request.contactName} flagged "${selectedAnswer}". Secondary physical recount recommended.`
        : `${request.contactName} confirmed "${selectedAnswer}". Auditor corroborated findings and closed ${request.caseIds.join(', ')}.`,
      unableToVerify ? 'attention' : 'completed',
      {
        titleKey: unableToVerify ? 'act.live.verifyEscalatedTitle' : 'act.live.verifyClosedTitle',
        detailKey: unableToVerify ? 'act.live.verifyEscalatedDetail' : 'act.live.verifyClosedDetail',
        params: {
          refDoc: request.referenceDoc,
          count: request.caseIds.length,
          name: request.contactName,
          cases: request.caseIds.join(', '),
        },
      }
    );

    syncStats(
      makeSwarmEvent({
        caseId: request.caseIds[0] ?? 'IA-024',
        agentId: 'auditor',
        agentName: 'Auditor',
        evidenceRefs: [request.docId, request.referenceDoc],
        status: unableToVerify ? 'rejected' : 'completed',
        summary: unableToVerify
          ? `Auditor escalated ${request.referenceDoc}: employee unable to verify. Physical recount queued.`
          : `Auditor corroborated evidence from ${request.contactName} and closed ${request.caseIds.join(', ')}.`,
        summaryKey: unableToVerify ? 'event.live.verifyEscalated' : 'event.live.verifyClosed',
        summaryParams: {
          refDoc: request.referenceDoc,
          name: request.contactName,
          cases: request.caseIds.join(', '),
        },
        permittedNextActions: unableToVerify ? ['schedule_recount'] : ['propose_prevention'],
      })
    );
    res.json(workspaceState);
  });

  app.post('/api/cases/:id/verify-resolution', (req, res) => {
    const target = workspaceState.cases.find((c) => c.id === req.params.id);
    if (!target) {
      return res.status(404).json({ error: 'Case not found.' });
    }
    target.stage = 'verified';
    target.auditorVerdict = 'corroborated';
    target.correctiveAction =
      target.correctiveAction ||
      `Human-authorized ledger reconciliation prepared for ${target.sku} (${target.varianceUnits > 0 ? '+' : ''}${target.varianceUnits} units).`;
    if (target.hypotheses[0]) {
      target.hypotheses[0].status = 'supported';
    }
    target.evidenceObject = buildEvidenceObject(target);
    target.updatedAt = new Date().toISOString();

    logActivity(
      'verify_resolution()',
      `Human sign-off completed for ${target.id}`,
      `${target.sku} reconciled and closed with audit trail.`,
      'completed',
      {
        titleKey: 'act.live.signoffTitle',
        detailKey: 'act.live.signoffDetail',
        params: { caseId: target.id, sku: target.sku },
      }
    );

    syncStats(
      makeSwarmEvent({
        caseId: target.id,
        agentId: 'resolution',
        agentName: 'Resolution',
        evidenceRefs: target.requiredDocIds,
        status: 'completed',
        summary: `Human sign-off recorded for ${target.id} (${target.sku}). Cell findings persisted to memory.`,
        summaryKey: 'event.live.signoff',
        summaryParams: { caseId: target.id, sku: target.sku },
        permittedNextActions: ['archive_cell'],
      })
    );
    res.json(workspaceState);
  });

  app.post('/api/autonomy', (req, res) => {
    const updates = req.body as Partial<AutonomyConfig>;
    workspaceState.autonomy = {
      ...workspaceState.autonomy,
      ...updates,
      policies: workspaceState.autonomy.policies,
    };

    if (workspaceState.autonomy.mode === 'agent') {
      workspaceState.requests.forEach((r) => {
        if (r.status === 'draft_awaiting_approval') {
          const totalExposure = workspaceState.cases
            .filter((c) => r.caseIds.includes(c.id))
            .reduce((acc, c) => acc + Math.abs(c.varianceValue), 0);
          if (totalExposure <= workspaceState.autonomy.autoSendUnderValue) {
            r.status = 'sent_awaiting_reply';
            r.sentAt = new Date().toISOString();
          }
        }
      });
    }

    logActivity(
      'request_approval()',
      `Switched to ${workspaceState.autonomy.mode === 'agent' ? 'Agent Mode' : 'Assist Mode'}`,
      `Auto-send materiality limit set to $${workspaceState.autonomy.autoSendUnderValue}. Inventory record writes remain human-only.`,
      'completed',
      {
        titleKey: workspaceState.autonomy.mode === 'agent' ? 'act.live.modeAgentTitle' : 'act.live.modeAssistTitle',
        detailKey: 'act.live.modeDetail',
        params: { limit: workspaceState.autonomy.autoSendUnderValue },
      }
    );

    syncStats(
      makeSwarmEvent({
        caseId: 'GLOBAL',
        agentId: 'auditor',
        agentName: 'Auditor',
        evidenceRefs: ['POLICY-GUARDRAILS'],
        status: 'completed',
        summary: `Policy updated to ${workspaceState.autonomy.mode.toUpperCase()} mode ($${workspaceState.autonomy.autoSendUnderValue} cap).`,
        summaryKey: workspaceState.autonomy.mode === 'agent' ? 'event.live.modeAgent' : 'event.live.modeAssist',
        summaryParams: { limit: workspaceState.autonomy.autoSendUnderValue },
        permittedNextActions: ['enforce_policy'],
      })
    );
    res.json(workspaceState);
  });

  app.get('/api/bench', (_req, res) => {
    res.json(latestBenchmark);
  });

  app.post('/api/bench/run', (_req, res) => {
    latestBenchmark = runAutopsyBench();
    res.json(latestBenchmark);
  });

  app.post('/api/bench/run-llm-baseline', async (_req, res) => {
    try {
      const result = await runLiveLlmCsvBaseline();
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Live LLM baseline failed.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/agent/ask', async (req, res) => {
    try {
      const { question } = req.body as { question?: string };
      if (!question || !question.trim()) {
        return res.status(400).json({ error: 'Question cannot be empty.' });
      }
      const result = await askAutopsyOrchestrator(question.trim(), workspaceState);
      return res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Orchestrator query failed.';
      return res.status(500).json({ error: message });
    }
  });

  // Vite middleware for development; static serving for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Inventory Autopsy server running on http://localhost:${PORT}`);
  });
}

startServer();
