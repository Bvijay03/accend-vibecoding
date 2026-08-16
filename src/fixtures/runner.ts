/**
 * Fixture Runner
 *
 * Loads fixture JSON files, creates test users and groups, runs events
 * through the reconciliation pipeline, and outputs audit logs.
 *
 * Usage: npx tsx src/fixtures/runner.ts
 */

import prisma from '../utils/prisma';
import * as reconciliationService from '../services/reconciliation.service';
import * as settlementService from '../services/settlement.service';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';

const FIXTURE_DIR = path.join(__dirname, '../../tests/fixtures');

interface FixtureEvent {
  eventId: string;
  expenseId: string;
  amount: number;
  description: string;
  payerId: string;
  timestamp: string;
  source: 'mobile' | 'web' | 'sync';
  groupId: string;
}

interface Fixture {
  description: string;
  events: FixtureEvent[];
}

async function main() {
  console.log('🧪 Expense Reconciliation Fixture Runner\n');
  console.log('='.repeat(60));

  // Clean database
  await prisma.settlement.deleteMany();
  await prisma.reconciliationLog.deleteMany();
  await prisma.expenseEvent.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();

  // Create test users
  const hashedPassword = await bcrypt.hash('password123', 10);

  const userA = await prisma.user.create({
    data: { email: 'alice@fixture.com', name: 'Alice', password: hashedPassword },
  });
  const userB = await prisma.user.create({
    data: { email: 'bob@fixture.com', name: 'Bob', password: hashedPassword },
  });
  const userC = await prisma.user.create({
    data: { email: 'charlie@fixture.com', name: 'Charlie', password: hashedPassword },
  });

  // Create group
  const group = await prisma.group.create({
    data: {
      name: 'Fixture Test Group',
      members: {
        create: [
          { userId: userA.id, role: 'admin' },
          { userId: userB.id, role: 'member' },
          { userId: userC.id, role: 'member' },
        ],
      },
    },
  });

  const userMap: Record<string, string> = {
    '{{USER_A}}': userA.id,
    '{{USER_B}}': userB.id,
    '{{USER_C}}': userC.id,
  };
  const groupMap: Record<string, string> = {
    '{{GROUP_1}}': group.id,
  };

  // Process each fixture
  const fixtureFiles = fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  for (const file of fixtureFiles) {
    console.log(`\n📁 Processing: ${file}`);
    console.log('-'.repeat(60));

    // Clean events between fixtures
    await prisma.settlement.deleteMany();
    await prisma.reconciliationLog.deleteMany();
    await prisma.expenseEvent.deleteMany();

    const raw = fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf-8');
    // Replace template variables
    let replaced = raw;
    for (const [key, value] of Object.entries(userMap)) {
      replaced = replaced.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
    for (const [key, value] of Object.entries(groupMap)) {
      replaced = replaced.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    const fixture: Fixture = JSON.parse(replaced);
    console.log(`   Description: ${fixture.description}`);
    console.log(`   Events: ${fixture.events.length}`);

    // Process events one by one
    let duplicateCount = 0;
    let processedCount = 0;

    for (const event of fixture.events) {
      try {
        const result = await reconciliationService.processEvent(event);
        if (result.status === 'duplicate') {
          duplicateCount++;
          console.log(`   ⚠️  Duplicate: ${event.eventId}`);
        } else {
          processedCount++;
          console.log(`   ✅ Processed: ${event.eventId}`);
        }
      } catch (err: any) {
        console.log(`   ❌ Error: ${event.eventId} — ${err.message}`);
      }
    }

    console.log(`\n   Summary: ${processedCount} processed, ${duplicateCount} duplicates`);

    // Get audit log
    const auditLog = await reconciliationService.getAuditLog(group.id);
    console.log(`   Audit entries: ${auditLog.length}`);

    for (const log of auditLog) {
      const icon = log.decision === 'accepted' ? '✅' : '❌';
      console.log(`   ${icon} [${log.decision}] ${log.eventId}: ${log.reason}`);
    }

    // Get settlement
    const settlement = await settlementService.getLatestSettlement(group.id);
    console.log(`\n   Settlement (v${settlement.version}):`);
    if (settlement.transactions.length === 0) {
      console.log('   (no transactions needed)');
    } else {
      for (const t of settlement.transactions) {
        const fromName = Object.entries(userMap).find(([, v]) => v === t.from)?.[0] ?? t.from;
        const toName = Object.entries(userMap).find(([, v]) => v === t.to)?.[0] ?? t.to;
        console.log(`   💸 ${fromName} → ${toName}: $${t.amount.toFixed(2)}`);
      }
    }

    // Save audit output
    const outputDir = path.join(FIXTURE_DIR, 'output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputFile = path.join(
      outputDir,
      file.replace('.json', '-audit.json')
    );
    fs.writeFileSync(
      outputFile,
      JSON.stringify(
        {
          fixture: file,
          description: fixture.description,
          auditLog,
          settlement: settlement.transactions,
        },
        null,
        2
      )
    );
    console.log(`   📝 Audit saved: ${outputFile}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ All fixtures processed successfully!');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
