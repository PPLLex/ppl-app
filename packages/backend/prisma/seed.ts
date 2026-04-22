import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding PPL database...\n');

  const password = await bcrypt.hash('password123', 12);

  // ============================================================
  // 1. LOCATIONS
  // ============================================================
  const location1 = await prisma.location.upsert({
    where: { id: 'loc-1' },
    update: {},
    create: {
      id: 'loc-1',
      name: 'PPL Southlake',
      address: '1234 Training Way, Southlake, TX 76092',
      phone: '(817) 555-0101',
      timezone: 'America/Chicago',
      closedDay: 'sunday',
      operatingHours: {
        monday: { open: '06:00', close: '21:00' },
        tuesday: { open: '06:00', close: '21:00' },
        wednesday: { open: '06:00', close: '21:00' },
        thursday: { open: '06:00', close: '21:00' },
        friday: { open: '06:00', close: '21:00' },
        saturday: { open: '08:00', close: '18:00' },
        sunday: null,
      },
    },
  });

  const location2 = await prisma.location.upsert({
    where: { id: 'loc-2' },
    update: {},
    create: {
      id: 'loc-2',
      name: 'PPL Keller',
      address: '5678 Performance Blvd, Keller, TX 76248',
      phone: '(817) 555-0202',
      timezone: 'America/Chicago',
      closedDay: 'sunday',
      operatingHours: {
        monday: { open: '06:00', close: '21:00' },
        tuesday: { open: '06:00', close: '21:00' },
        wednesday: { open: '06:00', close: '21:00' },
        thursday: { open: '06:00', close: '21:00' },
        friday: { open: '06:00', close: '21:00' },
        saturday: { open: '08:00', close: '18:00' },
        sunday: null,
      },
    },
  });

  console.log('✅ Locations:', location1.name, '|', location2.name);

  // ============================================================
  // 2. ROOMS
  // ============================================================
  const rooms: Record<string, { id: string }> = {};
  for (const loc of [location1, location2]) {
    const r1 = await prisma.room.upsert({
      where: { id: `${loc.id}-room-1` },
      update: {},
      create: { id: `${loc.id}-room-1`, locationId: loc.id, name: 'Pitching Lab', sortOrder: 1 },
    });
    const r2 = await prisma.room.upsert({
      where: { id: `${loc.id}-room-2` },
      update: {},
      create: { id: `${loc.id}-room-2`, locationId: loc.id, name: 'Training Bay', sortOrder: 2 },
    });
    rooms[`${loc.id}-1`] = r1;
    rooms[`${loc.id}-2`] = r2;
  }
  console.log('✅ Rooms (2 per location)');

  // ============================================================
  // 3. MEMBERSHIP PLANS
  // ============================================================
  const planDefs = [
    // ── Weekly tiers (Youth / MS-HS / College) ──────────────────────────────
    { id: 'plan-unlimited-college', name: 'Unlimited College Pitching', slug: 'unlimited-college-pitching', ageGroup: 'college', sessionsPerWeek: null, priceCents: 8500, billingCycle: 'weekly', description: 'Unlimited training sessions for college athletes.' },
    { id: 'plan-unlimited-pitching', name: 'Unlimited Pitching', slug: 'unlimited-pitching', ageGroup: 'ms_hs', sessionsPerWeek: null, priceCents: 8500, billingCycle: 'weekly', description: 'Unlimited training sessions for ages 13+.' },
    { id: 'plan-1x-pitching', name: '1x/Week Pitching', slug: '1x-week-pitching', ageGroup: 'ms_hs', sessionsPerWeek: 1, priceCents: 7000, billingCycle: 'weekly', description: 'One training session per week for ages 13+.' },
    { id: 'plan-youth-1x', name: 'Youth 1x/Week', slug: 'youth-1x-week', ageGroup: 'youth', sessionsPerWeek: 1, priceCents: 5500, billingCycle: 'weekly', description: 'One session per week for ages 12 and under.' },
    { id: 'plan-youth-2x', name: 'Youth 2x/Week', slug: 'youth-2x-week', ageGroup: 'youth', sessionsPerWeek: 2, priceCents: 7000, billingCycle: 'weekly', description: 'Two sessions per week for ages 12 and under.' },

    // ── Pro tier (MONTHLY billing) ──────────────────────────────────────────
    // Pros get perks: facility access, custom programming, or hands-on coaching.
    // Discount incentives (social posts / Google reviews / coaching help) are
    // tracked separately via the ProPerkCredit system — see ARCHITECTURE.md.
    { id: 'plan-pro-facility-access', name: 'Pro — Facility Access', slug: 'pro-facility-access', ageGroup: 'pro', sessionsPerWeek: null, priceCents: 10000, billingCycle: 'monthly', description: 'Monthly self-directed facility access for pro athletes. No coaching sessions included.' },
    { id: 'plan-pro-programming', name: 'Pro — Programming', slug: 'pro-programming', ageGroup: 'pro', sessionsPerWeek: 0, priceCents: 10000, billingCycle: 'monthly', description: 'Custom monthly programming delivered to you. No facility access.' },
    { id: 'plan-pro-programming-access', name: 'Pro — Programming + Access', slug: 'pro-programming-access', ageGroup: 'pro', sessionsPerWeek: null, priceCents: 25000, billingCycle: 'monthly', description: 'Custom monthly programming plus unlimited facility access.' },
    { id: 'plan-pro-programming-training', name: 'Pro — Programming + Training', slug: 'pro-programming-training', ageGroup: 'pro', sessionsPerWeek: null, priceCents: 40000, billingCycle: 'monthly', description: 'Custom programming plus hands-on coaching sessions with PPL staff.' },
  ];

  for (const plan of planDefs) {
    // Use update to keep existing plan prices + descriptions fresh on re-seed.
    // (Previous seed used empty `update: {}` which meant price bumps required
    // a manual SQL update in prod.)
    await prisma.membershipPlan.upsert({
      where: { id: plan.id },
      update: {
        name: plan.name,
        slug: plan.slug,
        ageGroup: plan.ageGroup,
        sessionsPerWeek: plan.sessionsPerWeek,
        priceCents: plan.priceCents,
        billingCycle: plan.billingCycle,
        description: plan.description,
      },
      create: plan,
    });
  }
  console.log(`✅ Membership plans (${planDefs.length})`);

  // ============================================================
  // 4. ADMIN
  // ============================================================
  const admin = await prisma.user.upsert({
    where: { email: 'cmart@pitchingperformancelab.com' },
    update: {},
    create: {
      email: 'cmart@pitchingperformancelab.com',
      passwordHash: password,
      fullName: 'Chad Martin',
      phone: '(817) 555-0001',
      role: Role.ADMIN,
      homeLocationId: location1.id,
    },
  });
  for (const loc of [location1, location2]) {
    await prisma.staffLocation.upsert({
      where: { staffId_locationId: { staffId: admin.id, locationId: loc.id } },
      update: {},
      create: { staffId: admin.id, locationId: loc.id },
    });
  }
  console.log('✅ Admin:', admin.email);

  // ============================================================
  // 5. COACHES
  // ============================================================
  const staffDefs = [
    { email: 'coach.mike@ppl.dev', fullName: 'Mike Reynolds', phone: '(817) 555-1001', locationId: location1.id },
    { email: 'coach.sarah@ppl.dev', fullName: 'Sarah Chen', phone: '(817) 555-1002', locationId: location1.id },
    { email: 'coach.derek@ppl.dev', fullName: 'Derek Jansen', phone: '(817) 555-1003', locationId: location2.id },
  ];

  const coaches: { id: string; locationId: string }[] = [];
  for (const s of staffDefs) {
    const coach = await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: { email: s.email, passwordHash: password, fullName: s.fullName, phone: s.phone, role: Role.STAFF, homeLocationId: s.locationId },
    });
    await prisma.staffLocation.upsert({
      where: { staffId_locationId: { staffId: coach.id, locationId: s.locationId } },
      update: {},
      create: { staffId: coach.id, locationId: s.locationId },
    });
    coaches.push({ id: coach.id, locationId: s.locationId });
  }
  console.log('✅ Coaches (3)');

  // ============================================================
  // 6. CLIENT ATHLETES
  // ============================================================
  const clientDefs = [
    { email: 'jake.wilson@test.dev', fullName: 'Jake Wilson', ageGroup: 'ms_hs', locationId: location1.id, planId: 'plan-unlimited-pitching' },
    { email: 'tyler.brooks@test.dev', fullName: 'Tyler Brooks', ageGroup: 'ms_hs', locationId: location1.id, planId: 'plan-1x-pitching' },
    { email: 'aiden.garcia@test.dev', fullName: 'Aiden Garcia', ageGroup: 'college', locationId: location1.id, planId: 'plan-unlimited-college' },
    { email: 'logan.martinez@test.dev', fullName: 'Logan Martinez', ageGroup: 'ms_hs', locationId: location1.id, planId: 'plan-unlimited-pitching' },
    { email: 'mason.taylor@test.dev', fullName: 'Mason Taylor', ageGroup: 'youth', locationId: location1.id, planId: 'plan-youth-2x' },
    { email: 'ethan.davis@test.dev', fullName: 'Ethan Davis', ageGroup: 'ms_hs', locationId: location2.id, planId: 'plan-unlimited-pitching' },
    { email: 'noah.johnson@test.dev', fullName: 'Noah Johnson', ageGroup: 'ms_hs', locationId: location2.id, planId: 'plan-1x-pitching' },
    { email: 'caleb.smith@test.dev', fullName: 'Caleb Smith', ageGroup: 'college', locationId: location2.id, planId: 'plan-unlimited-college' },
    { email: 'ryan.thomas@test.dev', fullName: 'Ryan Thomas', ageGroup: 'youth', locationId: location2.id, planId: 'plan-youth-1x' },
    { email: 'max.anderson@test.dev', fullName: 'Max Anderson', ageGroup: 'ms_hs', locationId: location1.id, planId: null as string | null },
  ];

  const goals = [
    'Increase fastball velocity to 90+ mph', 'Improve curveball break and command',
    'Develop a consistent changeup', 'Work on pitching mechanics and arm care',
    'Build endurance for full-game pitching', 'Reduce arm stress with better biomechanics',
    'Improve first-pitch strike percentage', 'Develop off-speed pitch arsenal',
  ];

  const clients: { id: string; locationId: string; planId: string | null }[] = [];
  for (const c of clientDefs) {
    const client = await prisma.user.upsert({
      where: { email: c.email },
      update: {},
      create: { email: c.email, passwordHash: password, fullName: c.fullName, role: Role.CLIENT, homeLocationId: c.locationId },
    });
    await prisma.clientProfile.upsert({
      where: { userId: client.id },
      update: {},
      create: { userId: client.id, ageGroup: c.ageGroup, trainingGoals: goals[Math.floor(Math.random() * goals.length)] },
    });
    clients.push({ id: client.id, locationId: c.locationId, planId: c.planId });
  }
  console.log('✅ Athletes (10)');

  // ============================================================
  // 7. MEMBERSHIPS
  // ============================================================
  for (const c of clients) {
    if (!c.planId) continue;
    await prisma.clientMembership.upsert({
      where: { clientId_locationId: { clientId: c.id, locationId: c.locationId } },
      update: {},
      create: {
        clientId: c.id, planId: c.planId, locationId: c.locationId, status: 'ACTIVE',
        billingDay: Math.random() > 0.5 ? 'MONDAY' : 'THURSDAY',
        billingAnchorDate: new Date(),
        startedAt: new Date(Date.now() - (30 + Math.floor(Math.random() * 150)) * 86400000),
      },
    });
  }
  console.log('✅ Memberships (9 active)');

  // ============================================================
  // 8. SESSIONS (2 weeks of schedule)
  // ============================================================
  const sessionNames: Record<string, string[]> = {
    PITCHING: ['Group Pitching', 'Pitching Mechanics', 'Bullpen Session', 'Velo Day'],
    HITTING: ['Hitting Lab', 'Batting Practice', 'Swing Analysis'],
    PRIVATE: ['Private Lesson', '1-on-1 Session'],
  };
  const types = Object.keys(sessionNames);
  const now = new Date();
  const allSessions: { id: string; locationId: string; startTime: Date }[] = [];

  for (let dayOff = -3; dayOff <= 10; dayOff++) {
    const date = new Date(now);
    date.setDate(date.getDate() + dayOff);
    if (date.getDay() === 0) continue;

    for (const loc of [location1, location2]) {
      const locCoaches = coaches.filter((c) => c.locationId === loc.id);
      const slots = date.getDay() === 6
        ? ['09:00', '11:00', '14:00']
        : ['07:00', '09:00', '11:00', '14:00', '16:00', '18:00'];

      for (const time of slots) {
        const type = types[Math.floor(Math.random() * types.length)];
        const names = sessionNames[type];
        const title = names[Math.floor(Math.random() * names.length)];
        const coach = locCoaches.length > 0 ? locCoaches[Math.floor(Math.random() * locCoaches.length)] : undefined;
        const roomKey = `${loc.id}-${Math.random() > 0.5 ? '1' : '2'}`;
        const [hr, mn] = time.split(':').map(Number);

        const start = new Date(date);
        start.setHours(hr, mn, 0, 0);
        const end = new Date(start);
        end.setMinutes(end.getMinutes() + (type === 'PRIVATE' ? 45 : 60));

        const session = await prisma.session.create({
          data: {
            locationId: loc.id,
            roomId: rooms[roomKey]?.id,
            coachId: coach?.id,
            title, sessionType: type, startTime: start, endTime: end,
            maxCapacity: type === 'PRIVATE' ? 1 : (Math.random() > 0.5 ? 8 : 6),
            currentEnrolled: 0,
            registrationCutoffHours: 2, cancellationCutoffHours: 1,
          },
        });
        allSessions.push({ id: session.id, locationId: loc.id, startTime: start });
      }
    }
  }
  console.log(`✅ Sessions (${allSessions.length})`);

  // ============================================================
  // 9. BOOKINGS
  // ============================================================
  let bookingCount = 0;
  const activeClients = clients.filter((c) => c.planId);

  for (const session of allSessions) {
    const locClients = activeClients.filter((c) => c.locationId === session.locationId);
    const num = Math.floor(Math.random() * Math.min(locClients.length, 4)) + 1;
    const picked = [...locClients].sort(() => Math.random() - 0.5).slice(0, num);

    for (const client of picked) {
      const isPast = session.startTime < now;
      const status = isPast ? (Math.random() > 0.15 ? 'COMPLETED' : 'NO_SHOW') : 'CONFIRMED';
      try {
        await prisma.booking.create({
          data: { clientId: client.id, sessionId: session.id, status: status as any, creditsUsed: 1 },
        });
        bookingCount++;
        if (status === 'CONFIRMED' || status === 'COMPLETED') {
          await prisma.session.update({ where: { id: session.id }, data: { currentEnrolled: { increment: 1 } } });
        }
      } catch {
        // skip duplicate bookings
      }
    }
  }
  console.log(`✅ Bookings (${bookingCount})`);

  // ============================================================
  // 10. PAYMENTS
  // ============================================================
  let paymentCount = 0;
  for (const client of activeClients) {
    for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
      const failed = i === 0 && Math.random() > 0.85;
      await prisma.payment.create({
        data: {
          clientId: client.id,
          amountCents: [5500, 7000, 8500][Math.floor(Math.random() * 3)],
          status: failed ? 'FAILED' : 'SUCCEEDED',
          failureReason: failed ? 'Card declined' : null,
          stripePaymentIntentId: `pi_seed_${client.id.slice(0, 8)}_${i}`,
          stripeInvoiceId: `inv_seed_${client.id.slice(0, 8)}_${i}`,
          createdAt: new Date(Date.now() - i * 7 * 86400000),
        },
      });
      paymentCount++;
    }
  }
  console.log(`✅ Payments (${paymentCount})`);

  // ============================================================
  // 11. AUDIT LOG
  // ============================================================
  const auditActions = [
    { action: 'booking.created', resourceType: 'booking' },
    { action: 'booking.cancelled', resourceType: 'booking' },
    { action: 'membership.created', resourceType: 'membership' },
    { action: 'session.created', resourceType: 'session' },
    { action: 'user.login', resourceType: 'user' },
  ];
  const allUsers = [{ id: admin.id }, ...coaches, ...clients];
  for (let i = 0; i < 25; i++) {
    const a = auditActions[Math.floor(Math.random() * auditActions.length)];
    const u = allUsers[Math.floor(Math.random() * allUsers.length)];
    await prisma.auditLog.create({
      data: {
        userId: u.id,
        locationId: [location1.id, location2.id][Math.floor(Math.random() * 2)],
        action: a.action, resourceType: a.resourceType, resourceId: `seed-${i}`,
        changes: { seeded: true },
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 7) * 86400000),
      },
    });
  }
  console.log('✅ Audit log (25 entries)');

  console.log('\n🎉 Seed complete! All accounts use password: password123');
  console.log('   Admin:  cmart@pitchingperformancelab.com');
  console.log('   Coach:  coach.mike@ppl.dev');
  console.log('   Client: jake.wilson@test.dev\n');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
