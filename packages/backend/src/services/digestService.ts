import { PrismaClient } from '@prisma/client';
import { sendEmail, buildPPLEmail } from './emailService';

const prisma = new PrismaClient();

/**
 * Weekly Digest Service
 *
 * Every Friday at 5 PM, compiles all coach notes from the past week
 * for each athlete and sends a summary email to their digest recipients
 * (parents, guardians, etc.).
 */

interface DigestNote {
  sessionDate: string;
  category: string;
  content: string;
  coachName: string;
}

/**
 * Run the weekly digest â called by cronService on Friday evenings.
 */
export async function sendWeeklyDigests() {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  console.log('[Digest] Starting weekly digest run...');

  // 1. Find all athletes who have active digest recipients
  const recipients = await prisma.digestRecipient.findMany({
    where: { isActive: true },
    include: {
      athlete: { select: { id: true, fullName: true } },
    },
  });

  if (recipients.length === 0) {
    console.log('[Digest] No active digest recipients found. Skipping.');
    return { sent: 0, skipped: 'no recipients' };
  }

  // Group recipients by athlete
  const athleteRecipients = new Map<string, typeof recipients>();
  for (const r of recipients) {
    const list = athleteRecipients.get(r.athleteId) || [];
    list.push(r);
    athleteRecipients.set(r.athleteId, list);
  }

  let totalSent = 0;
  let totalAthletes = 0;

  // 2. For each athlete, gather their notes from this week
  for (const [athleteId, recipientList] of athleteRecipients) {
    const notes = await prisma.coachNote.findMany({
      where: {
        athleteId,
        isVisible: true,
        sessionDate: { gte: oneWeekAgo },
      },
      include: {
        coach: { select: { fullName: true } },
      },
      orderBy: { sessionDate: 'asc' },
    });

    if (notes.length === 0) {
      console.log(`[Digest] No notes this week for athlete ${athleteId}. Skipping.`);
      continue;
    }

    totalAthletes++;
    const athleteName = recipientList[0].athlete.fullName;

    // Build the digest content
    const digestNotes: DigestNote[] = notes.map((n) => ({
      sessionDate: n.sessionDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      category: n.trainingCategory,
      content: n.cleanedContent || n.rawContent,
      coachName: n.coach?.fullName ?? 'PPL Staff',
    }));

    const emailHtml = buildDigestEmail(athleteName, digestNotes);

    // 3. Send to each recipient
    for (const recipient of recipientList) {
      const subject = `${athleteName}'s Weekly Training Summary â PPL`;
      const greeting = recipient.name ? `Hi ${recipient.name.split(' ')[0]},` : 'Hi,';

      try {
        await sendEmail({
          to: recipient.email,
          subject,
          text: `${greeting}\n\nHere's ${athleteName}'s training summary for this week at Pitching Performance Lab.\n\n` +
            digestNotes.map((n) => `${n.sessionDate} (${n.category}) â Coach ${n.coachName}:\n${n.content}`).join('\n\n') +
            `\n\nâ Pitching Performance Lab`,
          html: emailHtml.replace('{{GREETING}}', greeting),
        });
        totalSent++;
      } catch (err) {
        console.error(`[Digest] Failed to send to ${recipient.email}:`, err);
      }
    }

    // 4. Record the digest
    await prisma.noteDigest.create({
      data: {
        athleteId,
        weekStart: oneWeekAgo,
        weekEnd: now,
        emailSentAt: now,
        recipients: recipientList.map((r) => r.email),
        noteIds: notes.map((n) => n.id),
      },
    });
  }

  console.log(`[Digest] Done. Sent ${totalSent} emails for ${totalAthletes} athletes.`);
  return { sent: totalSent, athletes: totalAthletes };
}

/**
 * Build the digest HTML email.
 */
function buildDigestEmail(athleteName: string, notes: DigestNote[]): string {
  const categoryColors: Record<string, string> = {
    PITCHING: '#95C83C',
    HITTING: '#3B82F6',
    FIELDING: '#F59E0B',
    STRENGTH: '#EF4444',
    MENTAL: '#8B5CF6',
    GENERAL: '#6B7280',
  };

  const noteRows = notes
    .map((n) => {
      const color = categoryColors[n.category] || '#6B7280';
      return `
      <div style="background:#1A1A1A;border-radius:8px;padding:16px;margin:0 0 12px;border:1px solid #2A2A2A;border-left:4px solid ${color};">
        <div style="display:flex;justify-content:space-between;margin:0 0 8px;">
          <span style="color:#F5F5F5;font-weight:600;font-size:13px;">${n.sessionDate}</span>
          <span style="color:${color};font-size:12px;font-weight:600;text-transform:uppercase;">${n.category}</span>
        </div>
        <p style="margin:0 0 8px;color:#CCC;font-size:14px;line-height:1.5;">${n.content}</p>
        <p style="margin:0;color:#888;font-size:12px;">â Coach ${n.coachName}</p>
      </div>`;
    })
    .join('');

  return buildPPLEmail(`${athleteName}'s Weekly Summary`, `
    <p style="margin:0 0 16px;color:#CCC;">{{GREETING}}</p>
    <p style="margin:0 0 20px;color:#CCC;">Here's what <strong style="color:#F5F5F5;">${athleteName}</strong> worked on this week at PPL:</p>
    <div style="margin:0 0 20px;">
      ${noteRows}
    </div>
    <p style="margin:0 0 8px;color:#CCC;font-size:14px;">
      <strong style="color:#F5F5F5;">${notes.length}</strong> session${notes.length !== 1 ? 's' : ''} logged this week.
    </p>
    <p style="font-size:13px;color:#888;margin:16px 0 0;">
      This is an automated weekly summary from Pitching Performance Lab.
    </p>
  `);
}
