/**
 * Integration tests for the Expense Reconciliation API
 *
 * These tests run against a real PostgreSQL database and test the full
 * request → response cycle including:
 *   - Event ingestion with duplicate suppression
 *   - Conflict detection and resolution
 *   - Settlement computation
 *   - Audit trail generation
 *   - Event replay
 */

import request from 'supertest';
import app from '../../src/index';
import prisma from '../../src/utils/prisma';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let authToken: string;
let userA: { id: string; email: string };
let userB: { id: string; email: string };
let userC: { id: string; email: string };
let groupId: string;

beforeAll(async () => {
  // Clean the database
  await prisma.settlement.deleteMany();
  await prisma.reconciliationLog.deleteMany();
  await prisma.expenseEvent.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();

  // Register users
  const resA = await request(app)
    .post('/auth/register')
    .send({ email: 'alice@test.com', name: 'Alice', password: 'password123' });
  userA = resA.body.user;
  authToken = resA.body.token;

  const resB = await request(app)
    .post('/auth/register')
    .send({ email: 'bob@test.com', name: 'Bob', password: 'password123' });
  userB = resB.body.user;

  const resC = await request(app)
    .post('/auth/register')
    .send({ email: 'charlie@test.com', name: 'Charlie', password: 'password123' });
  userC = resC.body.user;

  // Create a group
  const groupRes = await request(app)
    .post('/groups')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ name: 'Trip Buddies', memberIds: [userB.id, userC.id] });
  groupId = groupRes.body.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Clean events between test suites
afterEach(async () => {
  await prisma.settlement.deleteMany();
  await prisma.reconciliationLog.deleteMany();
  await prisma.expenseEvent.deleteMany();
});

// ---------------------------------------------------------------------------
// Event Ingestion Tests
// ---------------------------------------------------------------------------

describe('POST /events', () => {
  it('should accept a valid event and return 201', async () => {
    const res = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        eventId: 'test-evt-001',
        expenseId: 'test-exp-001',
        amount: 45.0,
        description: 'Lunch',
        payerId: userA.id,
        timestamp: '2024-03-15T12:00:00.000Z',
        source: 'mobile',
        groupId: groupId,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('processed');
    expect(res.body.event.eventId).toBe('test-evt-001');
  });

  it('should return 200 for duplicate eventId (idempotent)', async () => {
    const eventData = {
      eventId: 'test-evt-dup',
      expenseId: 'test-exp-dup',
      amount: 30.0,
      description: 'Coffee',
      payerId: userA.id,
      timestamp: '2024-03-15T10:00:00.000Z',
      source: 'mobile',
      groupId: groupId,
    };

    // First submission
    const res1 = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send(eventData);
    expect(res1.status).toBe(201);

    // Second submission — same eventId
    const res2 = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send(eventData);
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('duplicate');
  });

  it('should reject invalid event data with 400', async () => {
    const res = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        eventId: '',
        amount: -10,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should require authentication', async () => {
    const res = await request(app)
      .post('/events')
      .send({
        eventId: 'test-no-auth',
        expenseId: 'test-exp',
        amount: 10,
        description: 'Test',
        payerId: userA.id,
        timestamp: '2024-03-15T12:00:00.000Z',
        source: 'mobile',
        groupId: groupId,
      });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Conflict Resolution Tests
// ---------------------------------------------------------------------------

describe('Conflict Resolution via POST /events', () => {
  it('should resolve source conflicts (mobile > web)', async () => {
    // Submit web event first
    await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        eventId: 'conflict-web',
        expenseId: 'conflict-exp-1',
        amount: 55.0,
        description: 'Taxi',
        payerId: userA.id,
        timestamp: '2024-03-15T15:00:00.000Z',
        source: 'web',
        groupId: groupId,
      });

    // Submit mobile event for same expense
    await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        eventId: 'conflict-mobile',
        expenseId: 'conflict-exp-1',
        amount: 52.5,
        description: 'Taxi',
        payerId: userA.id,
        timestamp: '2024-03-15T15:00:00.000Z',
        source: 'mobile',
        groupId: groupId,
      });

    // Check audit log — mobile should win
    const auditRes = await request(app)
      .get(`/audit/${groupId}`)
      .set('Authorization', `Bearer ${authToken}`);

    const accepted = auditRes.body.logs.filter(
      (l: any) => l.decision === 'accepted'
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0].eventId).toBe('conflict-mobile');
    expect(accepted[0].resolvedAmount).toBe(52.5);
  });

  it('should resolve timestamp conflicts (later wins)', async () => {
    await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        eventId: 'ts-early',
        expenseId: 'ts-exp-1',
        amount: 40.0,
        description: 'Gas',
        payerId: userA.id,
        timestamp: '2024-03-15T09:00:00.000Z',
        source: 'mobile',
        groupId: groupId,
      });

    await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        eventId: 'ts-late',
        expenseId: 'ts-exp-1',
        amount: 42.0,
        description: 'Gas',
        payerId: userA.id,
        timestamp: '2024-03-15T09:30:00.000Z',
        source: 'mobile',
        groupId: groupId,
      });

    const auditRes = await request(app)
      .get(`/audit/${groupId}`)
      .set('Authorization', `Bearer ${authToken}`);

    const accepted = auditRes.body.logs.find(
      (l: any) => l.decision === 'accepted'
    );
    expect(accepted.eventId).toBe('ts-late');
  });
});

// ---------------------------------------------------------------------------
// Settlement Tests
// ---------------------------------------------------------------------------

describe('GET /settlement/:groupId', () => {
  it('should return correct settlement for a simple scenario', async () => {
    // A pays $90, split among A, B, C → B owes $30, C owes $30
    await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        eventId: 'settle-evt-1',
        expenseId: 'settle-exp-1',
        amount: 90.0,
        description: 'Dinner',
        payerId: userA.id,
        timestamp: '2024-03-15T20:00:00.000Z',
        source: 'mobile',
        groupId: groupId,
      });

    const res = await request(app)
      .get(`/settlement/${groupId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.version).toBeGreaterThan(0);

    // Total amount flowing to A should be $60 (B=$30 + C=$30)
    const totalToA = res.body.transactions
      .filter((t: any) => t.to === userA.id)
      .reduce((sum: number, t: any) => sum + t.amount, 0);
    expect(totalToA).toBe(60);
  });

  it('should return empty settlement for group with no events', async () => {
    const res = await request(app)
      .get(`/settlement/${groupId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.transactions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Audit Trail Tests
// ---------------------------------------------------------------------------

describe('GET /audit/:groupId', () => {
  it('should return audit logs with decision reasons', async () => {
    await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        eventId: 'audit-evt-1',
        expenseId: 'audit-exp-1',
        amount: 50.0,
        description: 'Lunch',
        payerId: userA.id,
        timestamp: '2024-03-15T12:00:00.000Z',
        source: 'mobile',
        groupId: groupId,
      });

    const res = await request(app)
      .get(`/audit/${groupId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.groupId).toBe(groupId);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].decision).toBe('accepted');
    expect(res.body.logs[0].reason).toBeDefined();
    expect(res.body.logs[0].reason.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Replay Tests
// ---------------------------------------------------------------------------

describe('POST /events/replay', () => {
  it('should replay events and produce identical settlement', async () => {
    const events = [
      {
        eventId: 'replay-1',
        expenseId: 'replay-exp-1',
        amount: 60.0,
        description: 'Groceries',
        payerId: userA.id,
        timestamp: '2024-03-15T10:00:00.000Z',
        source: 'mobile',
        groupId: groupId,
      },
      {
        eventId: 'replay-2',
        expenseId: 'replay-exp-2',
        amount: 30.0,
        description: 'Snacks',
        payerId: userB.id,
        timestamp: '2024-03-15T14:00:00.000Z',
        source: 'web',
        groupId: groupId,
      },
    ];

    // First replay
    const res1 = await request(app)
      .post('/events/replay')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ events });

    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('replayed');

    const settlement1 = res1.body.results[groupId].settlement.transactions;

    // Second replay — should produce identical results
    const res2 = await request(app)
      .post('/events/replay')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ events });

    const settlement2 = res2.body.results[groupId].settlement.transactions;

    expect(settlement1).toEqual(settlement2);
  });

  it('should handle replay with conflicting events', async () => {
    const events = [
      {
        eventId: 'replay-c1',
        expenseId: 'replay-cexp-1',
        amount: 100.0,
        description: 'Hotel',
        payerId: userA.id,
        timestamp: '2024-03-15T10:00:00.000Z',
        source: 'web',
        groupId: groupId,
      },
      {
        eventId: 'replay-c2',
        expenseId: 'replay-cexp-1',
        amount: 95.0,
        description: 'Hotel',
        payerId: userA.id,
        timestamp: '2024-03-15T10:00:00.000Z',
        source: 'mobile',
        groupId: groupId,
      },
    ];

    const res = await request(app)
      .post('/events/replay')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ events });

    expect(res.status).toBe(200);
    expect(res.body.results[groupId].acceptedCount).toBe(1);
    expect(res.body.results[groupId].rejectedCount).toBe(1);
  });
});
