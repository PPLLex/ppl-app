/**
 * Workflow CRUD + manual run trigger.
 *
 * GET    /api/workflows                          list
 * POST   /api/workflows                          create
 * GET    /api/workflows/:id                      detail with steps + recent runs
 * PATCH  /api/workflows/:id                      update name/description/active/trigger/triggerConfig
 * DELETE /api/workflows/:id                      delete (cascades steps + runs)
 *
 * POST   /api/workflows/:id/steps                add a step
 * PATCH  /api/workflows/steps/:stepId            update step config / nextStepId
 * DELETE /api/workflows/steps/:stepId            delete step
 *
 * POST   /api/workflows/:id/run                  manual trigger — body { contextType, contextId, payload? }
 *
 * GET    /api/workflows/runs/:runId              run detail (log + status)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { requireAnyRole } from '../services/roleService';
import { createAuditLog } from '../services/auditService';
import {
  Role,
  WorkflowTrigger,
  WorkflowStepType,
  WorkflowRunStatus,
} from '@prisma/client';
import { emitTrigger, executeRun } from '../services/workflowEngine';

const router = Router();

router.use(
  authenticate,
  requireAnyRole(
    Role.ADMIN,
    Role.CONTENT_MARKETING_ADMIN,
    Role.CONTENT_MARKETING,
    Role.COORDINATOR
  )
);

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const workflows = await prisma.workflow.findMany({
      where: { organizationId: 'ppl' },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { steps: true, runs: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    res.json({ success: true, data: workflows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, trigger, triggerConfig, isActive } = req.body as Record<string, unknown>;
    if (!name || typeof name !== 'string') throw ApiError.badRequest('name required');
    if (!trigger || !(Object.values(WorkflowTrigger) as string[]).includes(String(trigger))) {
      throw ApiError.badRequest('trigger must be a valid WorkflowTrigger');
    }
    const wf = await prisma.workflow.create({
      data: {
        organizationId: 'ppl',
        name: name.trim(),
        description: typeof description === 'string' ? description : null,
        trigger: trigger as WorkflowTrigger,
        triggerConfig: (triggerConfig as any) ?? null,
        isActive: isActive !== false,
        createdById: req.user?.userId ?? null,
      },
    });
    void createAuditLog({
      userId: req.user?.userId,
      action: 'workflow.created',
      resourceType: 'workflow',
      resourceId: wf.id,
      changes: { name: wf.name, trigger: wf.trigger },
    });
    res.status(201).json({ success: true, data: wf });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const wf = await prisma.workflow.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { displayOrder: 'asc' } },
        runs: { orderBy: { startedAt: 'desc' }, take: 25 },
      },
    });
    if (!wf) throw ApiError.notFound('Workflow not found');
    res.json({ success: true, data: wf });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { name, description, isActive, trigger, triggerConfig } = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (typeof name === 'string') data.name = name.trim();
    if (typeof description === 'string') data.description = description;
    if (typeof isActive === 'boolean') data.isActive = isActive;
    if (trigger && (Object.values(WorkflowTrigger) as string[]).includes(String(trigger))) {
      data.trigger = trigger as WorkflowTrigger;
    }
    if (triggerConfig !== undefined) data.triggerConfig = triggerConfig as any;
    const wf = await prisma.workflow.update({ where: { id }, data: data as any });
    void createAuditLog({
      userId: req.user?.userId,
      action: 'workflow.updated',
      resourceType: 'workflow',
      resourceId: wf.id,
      changes: data,
    });
    res.json({ success: true, data: wf });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    await prisma.workflow.delete({ where: { id } });
    void createAuditLog({
      userId: req.user?.userId,
      action: 'workflow.deleted',
      resourceType: 'workflow',
      resourceId: id,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/steps', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workflowId = param(req, 'id');
    const { type, config, displayOrder, nextStepId } = req.body as Record<string, unknown>;
    if (!type || !(Object.values(WorkflowStepType) as string[]).includes(String(type))) {
      throw ApiError.badRequest('type must be a valid WorkflowStepType');
    }
    const step = await prisma.workflowStep.create({
      data: {
        workflowId,
        type: type as WorkflowStepType,
        config: (config as any) ?? {},
        displayOrder: typeof displayOrder === 'number' ? displayOrder : 0,
        nextStepId: typeof nextStepId === 'string' ? nextStepId : null,
      },
    });
    res.status(201).json({ success: true, data: step });
  } catch (err) {
    next(err);
  }
});

router.patch('/steps/:stepId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stepId = param(req, 'stepId');
    const { config, nextStepId, displayOrder, type } = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (config !== undefined) data.config = config as any;
    if (nextStepId !== undefined) data.nextStepId = nextStepId === null ? null : String(nextStepId);
    if (typeof displayOrder === 'number') data.displayOrder = displayOrder;
    if (type && (Object.values(WorkflowStepType) as string[]).includes(String(type))) {
      data.type = type as WorkflowStepType;
    }
    const step = await prisma.workflowStep.update({ where: { id: stepId }, data: data as any });
    res.json({ success: true, data: step });
  } catch (err) {
    next(err);
  }
});

router.delete('/steps/:stepId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.workflowStep.delete({ where: { id: param(req, 'stepId') } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workflows/:id/run
 * Manually trigger a workflow against a specific subject. Used by the
 * "Send to this lead now" admin action.
 */
router.post('/:id/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workflowId = param(req, 'id');
    const { contextType, contextId, payload } = req.body as Record<string, unknown>;
    if (!contextType || !contextId) {
      throw ApiError.badRequest('contextType and contextId required');
    }

    const wf = await prisma.workflow.findUnique({
      where: { id: workflowId },
      include: { steps: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!wf) throw ApiError.notFound('Workflow not found');

    const run = await prisma.workflowRun.create({
      data: {
        workflowId,
        contextType: String(contextType),
        contextId: String(contextId),
        status: WorkflowRunStatus.PENDING,
        currentStepId: wf.steps[0]?.id ?? null,
      },
    });
    void executeRun(run.id).catch((err) =>
      console.error(`[workflows] manual run ${run.id} failed:`, err)
    );
    res.status(202).json({ success: true, data: { runId: run.id } });
    void payload; // payload is recorded by individual triggers, not on manual runs
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workflows/runs?contextType=lead&contextId=xxx
 * List recent workflow runs scoped to a specific entity. Used by the
 * "Recent Automations" panel on lead/member/booking detail pages.
 */
router.get('/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { contextType, contextId } = req.query as Record<string, string | undefined>;
    if (!contextType || !contextId) {
      throw ApiError.badRequest('contextType and contextId required');
    }
    const runs = await prisma.workflowRun.findMany({
      where: { contextType: String(contextType), contextId: String(contextId) },
      orderBy: { startedAt: 'desc' },
      take: 25,
      include: { workflow: { select: { id: true, name: true, trigger: true } } },
    });
    res.json({ success: true, data: runs });
  } catch (err) {
    next(err);
  }
});

router.get('/runs/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const runId = param(req, 'runId');
    const run = await prisma.workflowRun.findUnique({
      where: { id: runId },
      include: { workflow: { select: { id: true, name: true, trigger: true } } },
    });
    if (!run) throw ApiError.notFound('Run not found');
    res.json({ success: true, data: run });
  } catch (err) {
    next(err);
  }
});

export default router;
export { emitTrigger }; // re-export for convenience in route imports
