/**
 * Seed default workflows on bootstrap. Idempotent — keyed by name. Admins
 * can edit the seeded workflows; we only create missing ones, never
 * overwrite Chad's tweaks.
 *
 * Currently seeds:
 *   - "Welcome New Member" — USER_REGISTERED → email immediately, wait 3
 *     days, send tips email, wait 4 more days, send first-session reminder.
 */

import { PrismaClient, WorkflowTrigger, WorkflowStepType } from '@prisma/client';

export async function bootstrapWorkflows(prisma: PrismaClient): Promise<void> {
  try {
    const orgId = 'ppl';
    const existing = await prisma.workflow.findFirst({
      where: { organizationId: orgId, name: 'Welcome New Member' },
    });
    if (existing) {
      console.log('[bootstrapWorkflows] "Welcome New Member" already exists — skipping');
      return;
    }

    // Create the workflow + 5 steps in dependency order. Each step's
    // nextStepId is set in a second pass once all IDs are known.
    const wf = await prisma.workflow.create({
      data: {
        organizationId: orgId,
        name: 'Welcome New Member',
        description:
          'Greets every new signup, then nudges them with tips at day 3 and a first-session prompt at day 7.',
        trigger: WorkflowTrigger.USER_REGISTERED,
        triggerConfig: {} as object,
        isActive: true,
      },
    });

    const stepWelcomeEmail = await prisma.workflowStep.create({
      data: {
        workflowId: wf.id,
        type: WorkflowStepType.SEND_EMAIL,
        displayOrder: 1,
        config: {
          subject: 'Welcome to PPL, {{firstName}}',
          html: `<p>Hey {{firstName}},</p><p>Welcome to Pitching Performance Lab. You're set up at <strong>{{location}}</strong>. Here's what to do next:</p><ol><li>Pick a membership plan from your dashboard</li><li>Sign the liability waiver</li><li>Book your first session</li></ol><p>Reply to this email if anything's confusing.</p>`,
        },
      },
    });

    const stepWait3d = await prisma.workflowStep.create({
      data: {
        workflowId: wf.id,
        type: WorkflowStepType.WAIT,
        displayOrder: 2,
        config: { days: 3 },
      },
    });

    const stepTipsEmail = await prisma.workflowStep.create({
      data: {
        workflowId: wf.id,
        type: WorkflowStepType.SEND_EMAIL,
        displayOrder: 3,
        config: {
          subject: 'Three things every new PPL athlete should know',
          html: `<p>Hey {{firstName}},</p><p>Quick tips for getting the most out of your first month at PPL:</p><ol><li><strong>Show up consistently.</strong> Two sessions a week beats one binge.</li><li><strong>Warm up before you arrive.</strong> Five minutes of light arm circles saves your first 15 minutes.</li><li><strong>Ask the coach for one cue per session.</strong> They've seen everything — use them.</li></ol><p>See you on the mound.</p>`,
        },
      },
    });

    const stepWait4d = await prisma.workflowStep.create({
      data: {
        workflowId: wf.id,
        type: WorkflowStepType.WAIT,
        displayOrder: 4,
        config: { days: 4 },
      },
    });

    const stepFirstBookEmail = await prisma.workflowStep.create({
      data: {
        workflowId: wf.id,
        type: WorkflowStepType.SEND_EMAIL,
        displayOrder: 5,
        config: {
          subject: "{{firstName}}, time to book your first session?",
          html: `<p>Hey {{firstName}},</p><p>You signed up about a week ago — let's get you on the mound. Open your dashboard and pick a time that works.</p><p>If something's holding you up (membership questions, scheduling conflicts, anything), just reply to this and we'll sort it.</p>`,
        },
      },
    });

    // Wire the chain
    await prisma.$transaction([
      prisma.workflowStep.update({ where: { id: stepWelcomeEmail.id }, data: { nextStepId: stepWait3d.id } }),
      prisma.workflowStep.update({ where: { id: stepWait3d.id }, data: { nextStepId: stepTipsEmail.id } }),
      prisma.workflowStep.update({ where: { id: stepTipsEmail.id }, data: { nextStepId: stepWait4d.id } }),
      prisma.workflowStep.update({ where: { id: stepWait4d.id }, data: { nextStepId: stepFirstBookEmail.id } }),
    ]);

    console.log(`[bootstrapWorkflows] seeded "Welcome New Member" workflow (${wf.id})`);
  } catch (err) {
    console.error('[bootstrapWorkflows] failed (non-fatal):', err);
  }
}
