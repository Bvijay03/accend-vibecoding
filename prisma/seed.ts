/**
 * Prisma Seed Script
 *
 * Creates initial test data for development.
 * Run with: npx prisma db seed
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  const hashedPassword = await bcrypt.hash('password123', 10);

  // Create users
  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: {
      email: 'alice@example.com',
      name: 'Alice',
      password: hashedPassword,
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: {
      email: 'bob@example.com',
      name: 'Bob',
      password: hashedPassword,
    },
  });

  const charlie = await prisma.user.upsert({
    where: { email: 'charlie@example.com' },
    update: {},
    create: {
      email: 'charlie@example.com',
      name: 'Charlie',
      password: hashedPassword,
    },
  });

  console.log(`  Created users: ${alice.name}, ${bob.name}, ${charlie.name}`);

  // Create a group
  const group = await prisma.group.create({
    data: {
      name: 'Weekend Trip',
      members: {
        create: [
          { userId: alice.id, role: 'admin' },
          { userId: bob.id, role: 'member' },
          { userId: charlie.id, role: 'member' },
        ],
      },
    },
  });

  console.log(`  Created group: ${group.name} (${group.id})`);
  console.log('\n✅ Seed complete!');
  console.log('\nTest credentials:');
  console.log('  Email: alice@example.com / bob@example.com / charlie@example.com');
  console.log('  Password: password123');
  console.log(`  Group ID: ${group.id}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
