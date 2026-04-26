/**
 * Workflow execution engine — Phase 1C foundation.
 *
 * Two entry points:
 *   - emitTrigger(trigger, contextType, contextId, payload?) — called from
 *     route handlers when a trigger event occurs (booking created, lead
 *     stage changed, payment failed, etc.). Finds every active workflow
 *     bound to that trigger whose triggerConfig matches the payload, then
 *     starts a WorkflowRun for each.
 *
 *   - resumeRun(runId) — called by the worker when a WAITING run's
 *     resumeAt has elapsed. (Worker lands in a follow-up commit; for now
 *     WAIT steps suspend the run and admins can advance manually.)
 *
 * Steps execute serially. Each step appends to the run's `log` JSON for
 * audit/replay. A step that throws marks the run FAILED and stops execution.
 *
 * Templating: SEND_EMAIL / SEND_SMS / SEND_NOTIFICATION step configs use
 * {{handlebars-style}} tokens that get expanded against the run's context.
 * Tokens we currently expand:
 *   {{firstName}} {{lastName}} {{email}} {{phone}} {{stage}}
 *   {{ownerName}} {{location}} {{sessionTitle}} {{sessionDate}}
 * Anything missing falls back to empty string — graceful in production.
 */

import { prisma } from '../utils/prisma';
import {
  WorkflowTrigger,
  WorkflowStepType,
  WorkflowRunStatus,
  Prisma,
} from '@prisma/client';
import { sendEmail } from './emailService';
import { notify } from './notificationService';
import { NotificationType, NotificationChannel } from '@prisma/client';
import { dispatchWebhooks } from './webhookDelivery';

type ContextType = 'lead' | 'user' | 'booking' | 'athlete';

type StepLogEntry = {
  stepId: string;
  type: string;
  startedAt: string;
  completedAt: string;
  ok: boolean;
  output?: unknown;
  error?: string;
};

/**
 * Public entry point — call this from route handlers when an event fires.
 * Non-blocking; errors are logged but don't bubble up to the caller, so
 * a workflow misconfiguration can't break the user-facing operation that
 * triggered it.
 */
export function emitTrigger(
  trigger: WorkflowTrigger,
  contextType: ContextType,
  contextId: string,
  payload?: Record<string, unknown>
): void {
  // Fire-and-forget — never block the calling request.
  void emitTriggerAsync(trigger, contextType, contextId, payload).catch((err) => {
    console.error(`[workflowEngine] emitTrigger ${trigger} failed:`, err);
  });
}

async function emitTriggerAsync(
  trigger: WorkflowTrigger,
  contextType: ContextType,
  contextId: string,
  payload?: Record<string, unknown>
): Promise<void> {
  // Outbound webhooks subscribe to triggers independently of workflows —
  // a single event can fan out to both visual workflows AND any number
  // of admin-configured webhook URLs.
  dispatchWebhooks(trigger, contextType, contextId, payload);

  const workflows = await prisma.workflow.findMany({
    where: { trigger, isActive: true, organizationId: 'ppl' },
    include: { steps: { orderBy: { displayOrder: 'asc' } } },
  });

  for (const wf of workflows) {
    if (!triggerConfigMatches(wf.triggerConfig as Record<string, unknown> | null, payload)) {
      continue;
    }
    const run = await prisma.workflowRun.create({
      data: {
        workflowId: wf.id,
        contextType,
        contextId,
        status: WorkflowRunStatus.PENDING,
        currentStepId: wf.steps[0]?.id ?? null,
      },
    });
    // Run synchronously — small workflows finish in milliseconds, and
    // any WAIT step suspends the run for the worker to pick up later.
    await executeRun(run.id).catch((err) => {
      console.error(`[workflowEngine] run ${run.id} crashed:`, err);
    });
  }
}

/**
 * Check whether a workflow's triggerConfig filter matches the trigger
 * payload. Currently does shallow equality on each key — sufficient for
 * `{ sessionType: 'PITCHING_ASSESSMENT' }` style filters. Empty config
 * means "match all".
 */
function triggerConfigMatches(
  config: Record<string, unknown> | null,
  payload?: Record<string, unknown>
): boolean {
  if (!config || Object.keys(config).length === 0) return true;
  if (!payload) return false;
  for (const [k, v] of Object.entries(config)) {
    if (payload[k] !== v) return false;
  }
  return true;
}

/**
 * Run a workflow until completion, suspension, or failure.
 */
export async function executeRun(runId: string): Promise<void> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    include: { workflow: { include: { steps: true } } },
  });
  if (!run) return;
  if (
    run.status === WorkflowRunStatus.COMPLETED ||
    run.status === WorkflowRunStatus.FAILED ||
    run.status === WorkflowRunStatus.CANCELLED
  ) {
    return;
  }

  await prisma.workflowRun.update({
    where: { id: runId },
    data: { status: WorkflowRunStatus.RUNNING },
  });

  const log: StepLogEntry[] = Array.isArray(run.log) ? (run.log as unknown as StepLogEntry[]) : [];
  let currentStepId = run.currentStepId;
  const stepsById = new Map(run.workflow.steps.map((s) => [s.id, s]));

  while (currentStepId) {
    const step = stepsById.get(currentStepId);
    if (!step) break;

    const startedAt = new Date().toISOString();
    try {
      const result = await runStep(step, run.contextType as ContextType, run.contextId);

      // WAIT step — persist resumeAt and bail out
      if (step.type === WorkflowStepType.WAIT && result?.resumeAt) {
        log.push({
          stepId: step.id,
          type: step.type,
          startedAt,
          completedAt: new Date().toISOString(),
          ok: true,
          output: { waitingUntil: result.resumeAt.toISOString() },
        });
        await prisma.workflowRun.update({
          where: { id: runId },
          data: {
            status: WorkflowRunStatus.WAITING,
            currentStepId: step.nextStepId,
            resumeAt: result.resumeAt,
            log: log as unknown as Prisma.InputJsonValue,
          },
        });
        return;
      }

      // BRANCH step — pick the right next step from result
      let nextStepId: string | null = step.nextStepId ?? null;
      if (step.type === WorkflowStepType.BRANCH) {
        nextStepId = result?.nextStepId ?? null;
      }

      log.push({
        stepId: step.id,
        type: step.type,
        startedAt,
        completedAt: new Date().toISOString(),
        ok: true,
        output: result?.output,
      });

      currentStepId = nextStepId;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.push({
        stepId: step.id,
        type: step.type,
        startedAt,
        completedAt: new Date().toISOString(),
        ok: false,
        error: errMsg,
      });
      await prisma.workflowRun.update({
        where: { id: runId },
        data: {
          status: WorkflowRunStatus.FAILED,
          error: errMsg.slice(0, 2000),
          log: log as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      return;
    }
  }

  // Reached end of chain — done.
  await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status: WorkflowRunStatus.COMPLETED,
      currentStepId: null,
      completedAt: new Date(),
      log: log as unknown as Prisma.InputJsonValue,
    },
  });
}

type StepResult = {
  resumeAt?: Date;
  nextStepId?: string | null;
  output?: unknown;
};

/**
 * Execute a single step. Throws on failure; returns control flow info on
 * success (resumeAt for WAIT, nextStepId for BRANCH, output for audit log).
 */
async function runStep(
  step: { id: string; type: WorkflowStepType; config: unknown },
  contextType: ContextType,
  contextId: string
): Promise<StepResult> {
  const config = (step.config ?? {}) as Record<string, unknown>;
  const ctx = await resolveContext(contextType, contextId);

  switch (step.type) {
    case WorkflowStepType.WAIT: {
      const hours =
        typeof config.hours === 'number'
          ? config.hours
          : typeof config.days === 'number'
          ? config.days * 24
          : typeof config.minutes === 'number'
          ? config.minutes / 60
          : 0;
      if (hours <= 0) return { output: { waited: 0 } };
      return { resumeAt: new Date(Date.now() + hours * 60 * 60 * 1000) };
    }

    case WorkflowStepType.SEND_EMAIL: {
      const to = ctx.email ? String(ctx.email) : null;
      if (!to) return { output: { skipped: 'no_email' } };
      const subject = renderTemplate(String(config.subject ?? ''), ctx);
      const html = renderTemplate(String(config.html ?? config.body ?? ''), ctx);
      const text = renderTemplate(String(config.text ?? ''), ctx);
      const ok = await sendEmail({ to, subject, html, text: text || stripHtml(html) });
      return { output: { sent: ok, to } };
    }

    case WorkflowStepType.SEND_SMS: {
      // SMS depends on Twilio integration (Phase 4). For now we log and
      // skip so configured workflows don't crash before that ships.
      console.log(`[workflowEngine] SEND_SMS not implemented yet — would send to ${ctx.phone}`);
      return { output: { skipped: 'sms_not_implemented' } };
    }

    case WorkflowStepType.SEND_NOTIFICATION: {
      if (!ctx.userId) return { output: { skipped: 'no_user' } };
      const title = renderTemplate(String(config.title ?? ''), ctx);
      const body = renderTemplate(String(config.body ?? ''), ctx);
      await notify({
        userId: String(ctx.userId),
        // Reuse SCHEDULE_CHANGED as a generic system-level notification type
        // until we add a dedicated SYSTEM enum value (would require a
        // migration). Workflows can pass type via config later if needed.
        type: NotificationType.SCHEDULE_CHANGED,
        title,
        body,
        channels: [NotificationChannel.PUSH],
      });
      return { output: { sent: true } };
    }

    case WorkflowStepType.ADD_TAG: {
      const tagId = String(config.tagId ?? '');
      if (!tagId) throw new Error('ADD_TAG requires config.tagId');
      const subject =
        contextType === 'lead'
          ? { leadId: contextId }
          : contextType === 'athlete'
          ? { athleteProfileId: contextId }
          : { userId: contextId };
      await prisma.tagAssignment
        .create({ data: { tagId, ...subject } })
        .catch(() => null); // ignore unique violation if already tagged
      return { output: { tagId, subject } };
    }

    case WorkflowStepType.REMOVE_TAG: {
      const tagId = String(config.tagId ?? '');
      if (!tagId) throw new Error('REMOVE_TAG requires config.tagId');
      const where: Record<string, unknown> = { tagId };
      if (contextType === 'lead') where.leadId = contextId;
      else if (contextType === 'athlete') where.athleteProfileId = contextId;
      else where.userId = contextId;
      const removed = await prisma.tagAssignment.deleteMany({ where: where as any });
      return { output: { tagId, removed: removed.count } };
    }

    case WorkflowStepType.UPDATE_LEAD_STAGE: {
      if (contextType !== 'lead') throw new Error('UPDATE_LEAD_STAGE only valid in lead context');
      const stage = String(config.stage ?? '');
      if (!stage) throw new Error('UPDATE_LEAD_STAGE requires config.stage');
      await prisma.lead.update({ where: { id: contextId }, data: { stage: stage as any } });
      return { output: { stage } };
    }

    case WorkflowStepType.UPDATE_LEAD_FIELD: {
      if (contextType !== 'lead') throw new Error('UPDATE_LEAD_FIELD only valid in lead context');
      const data = (config.data ?? {}) as Record<string, unknown>;
      await prisma.lead.update({ where: { id: contextId }, data: data as any });
      return { output: { updated: Object.keys(data) } };
    }

    case WorkflowStepType.ASSIGN_OWNER: {
      if (contextType !== 'lead') throw new Error('ASSIGN_OWNER only valid in lead context');
      const ownerUserId = String(config.ownerUserId ?? '');
      if (!ownerUserId) throw new Error('ASSIGN_OWNER requires config.ownerUserId');
      await prisma.lead.update({ where: { id: contextId }, data: { ownerUserId } });
      return { output: { ownerUserId } };
    }

    case WorkflowStepType.SEND_WEBHOOK: {
      const url = String(config.url ?? '');
      if (!url) throw new Error('SEND_WEBHOOK requires config.url');
      const method = String(config.method ?? 'POST').toUpperCase();
      const headers = (config.headers ?? {}) as Record<string, string>;
      const body = JSON.stringify({ ...ctx, ...((config.payload ?? {}) as object) });
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: method === 'GET' ? undefined : body,
      });
      return { output: { url, status: res.status } };
    }

    case WorkflowStepType.BRANCH: {
      const field = String(config.conditionField ?? '');
      const op = String(config.operator ?? 'eq');
      const value = config.value;
      const actual = (ctx as Record<string, unknown>)[field];
      let matched = false;
      switch (op) {
        case 'eq': matched = actual === value; break;
        case 'neq': matched = actual !== value; break;
        case 'in': matched = Array.isArray(value) && value.includes(actual); break;
        case 'truthy': matched = !!actual; break;
        case 'falsy': matched = !actual; break;
        default: matched = false;
      }
      const nextStepId = matched
        ? (config.trueNextStepId as string | undefined) ?? null
        : (config.falseNextStepId as string | undefined) ?? null;
      return { nextStepId, output: { matched, actual } };
    }

    case WorkflowStepType.END: {
      return { nextStepId: null };
    }
  }
}

/**
 * Pull the relevant fields off the context entity so steps can reference
 * them by name in their config + template tokens.
 */
async function resolveContext(
  type: ContextType,
  id: string
): Promise<Record<string, unknown>> {
  if (type === 'lead') {
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: { owner: true, location: true },
    });
    if (!lead) return {};
    return {
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      stage: lead.stage,
      ownerName: lead.owner?.fullName ?? '',
      location: lead.location?.name ?? '',
    };
  }
  if (type === 'user') {
    const u = await prisma.user.findUnique({
      where: { id },
      include: { homeLocation: true },
    });
    if (!u) return {};
    return {
      userId: u.id,
      firstName: u.fullName.split(' ')[0],
      lastName: u.fullName.split(' ').slice(1).join(' '),
      email: u.email,
      phone: u.phone,
      location: u.homeLocation?.name ?? '',
    };
  }
  if (type === 'booking') {
    const b = await prisma.booking.findUnique({
      where: { id },
      include: { client: true, session: { include: { coach: true, room: true } } },
    });
    if (!b) return {};
    return {
      userId: b.clientId,
      firstName: b.client.fullName.split(' ')[0],
      email: b.client.email,
      phone: b.client.phone,
      sessionTitle: b.session.title,
      sessionDate: b.session.startTime.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    };
  }
  if (type === 'athlete') {
    const a = await prisma.athleteProfile.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!a) return {};
    return {
      userId: a.userId,
      firstName: a.firstName,
      lastName: a.lastName,
      email: a.user.email,
      phone: a.user.phone,
      ageGroup: a.ageGroup,
    };
  }
  return {};
}

function renderTemplate(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = ctx[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
