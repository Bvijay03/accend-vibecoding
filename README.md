# Expense Reconciliation Engine

A **deterministic, replayable, and audit-capable reconciliation engine** for group expense tracking with temporal conflict resolution.

Built with **Node.js**, **Express**, **TypeScript**, **Prisma ORM**, **PostgreSQL**, and **JWT authentication**.

---

## 🏗️ Architecture

```
POST /events ──► Idempotency Guard ──► Event Store ──► Conflict Detection
                                                              │
                                                              ▼
GET /audit/:groupId ◄── Reconciliation Log ◄── Conflict Resolution Engine
                                                              │
                                                              ▼
GET /settlement/:groupId ◄── Settlement Engine ◄── Resolved Expenses
```

### Core Components

| Component | Description |
|---|---|
| **Event Ingestion** | Accepts, validates, and deduplicates expense events via `eventId` |
| **Conflict Resolution** | Deterministically resolves conflicting events using source reliability → timestamp → amount → eventId |
| **Settlement Engine** | Computes minimum cash flow settlements using a greedy max-creditor/max-debtor algorithm |
| **Audit Trail** | Records every reconciliation decision with human-readable reason |
| **Replay Engine** | Re-processes historical events from scratch, producing identical results |

---

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# Start PostgreSQL + App
docker-compose up --build

# The API is available at http://localhost:3000
```

### Option 2: Local Development

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your PostgreSQL connection string

# 3. Run database migrations
npx prisma migrate dev

# 4. (Optional) Seed with test data
npx prisma db seed

# 5. Start dev server
npm run dev
```

---

## 📡 API Reference

### Authentication

#### `POST /auth/register`
```json
{
  "email": "alice@example.com",
  "name": "Alice",
  "password": "password123"
}
```
Returns: `{ user, token }`

#### `POST /auth/login`
```json
{
  "email": "alice@example.com",
  "password": "password123"
}
```
Returns: `{ user, token }`

### Groups

#### `POST /groups` (Auth required)
```json
{
  "name": "Trip Buddies",
  "memberIds": ["<user-id-1>", "<user-id-2>"]
}
```

#### `GET /groups/:id` (Auth required)

### Events

#### `POST /events` (Auth required)
```json
{
  "eventId": "evt-001",
  "expenseId": "exp-001",
  "amount": 45.00,
  "description": "Lunch at Cafe Blue",
  "payerId": "<user-uuid>",
  "timestamp": "2024-03-15T12:30:00.000Z",
  "source": "mobile",
  "groupId": "<group-uuid>"
}
```

**Responses:**
- `201 Created` — Event processed, conflicts resolved, settlement updated
- `200 OK` — Duplicate `eventId`, idempotent response
- `400 Bad Request` — Validation error

#### `POST /events/replay` (Auth required)
```json
{
  "events": [
    { "eventId": "evt-001", "expenseId": "exp-001", ... },
    { "eventId": "evt-002", "expenseId": "exp-002", ... }
  ]
}
```
Clears existing data for affected groups and re-processes all events deterministically.

### Settlement

#### `GET /settlement/:groupId` (Auth required)
```json
{
  "version": 3,
  "transactions": [
    { "from": "<user-b-id>", "to": "<user-a-id>", "amount": 30.00 },
    { "from": "<user-c-id>", "to": "<user-a-id>", "amount": 30.00 }
  ],
  "computedAt": "2024-03-15T20:00:00.000Z"
}
```

### Audit Trail

#### `GET /audit/:groupId` (Auth required)
```json
{
  "groupId": "<group-uuid>",
  "logs": [
    {
      "eventId": "evt-001",
      "expenseId": "exp-001",
      "decision": "accepted",
      "resolvedAmount": 45.00,
      "source": "mobile",
      "timestamp": "2024-03-15T12:30:00.000Z",
      "reason": "Only event for this expense — accepted."
    },
    {
      "eventId": "evt-002",
      "expenseId": "exp-001",
      "decision": "rejected_conflict",
      "resolvedAmount": null,
      "source": "web",
      "timestamp": "2024-03-15T12:30:00.000Z",
      "reason": "Rejected — lost to event evt-001: lower source reliability (web=2 < mobile=3)."
    }
  ]
}
```

---

## 🔧 Conflict Resolution Rules

Conflicts are detected when multiple events share the same `expenseId` + `groupId`. Resolution follows a strict deterministic rule chain:

| Priority | Rule | Description |
|---|---|---|
| 1 | **Source Reliability** | `mobile` (3) > `web` (2) > `sync` (1) |
| 2 | **Latest Timestamp** | Later timestamp wins |
| 3 | **Highest Amount** | Higher amount wins |
| 4 | **Lexicographic EventId** | Smallest eventId wins (final tiebreaker) |

### Idempotency

- Duplicate `eventId` submissions are silently accepted (return `200`)
- The same event processed multiple times produces identical results

### Replayability

- `POST /events/replay` clears affected groups and re-processes from scratch
- Same input sequence → identical settlement output, regardless of event order

---

## 💰 Settlement Algorithm

The settlement engine uses a **greedy minimum cash flow algorithm**:

1. Compute net balance per member: `(total paid) − (fair share of all expenses)`
2. Repeatedly match the member with the largest credit with the member with the largest debt
3. Transfer the minimum of their absolute balances
4. Continue until all balances are zero

This produces at most `N-1` transactions for `N` members with non-zero balances.

---

## 🧪 Testing

### Run All Tests
```bash
npm test
```

### Unit Tests Only (Pure Functions)
```bash
npm run test:unit
```

### Integration Tests (API + Database)
```bash
npm run test:integration
```

### Run Fixture Scenarios
```bash
npm run fixtures
```

### Fixture Coverage

| Fixture | Scenario |
|---|---|
| `fixture1-duplicates.json` | Same `eventId` submitted twice |
| `fixture2-late-events.json` | Events with past timestamps arrive late |
| `fixture3-source-conflicts.json` | Same expense from mobile vs web vs sync |
| `fixture4-timestamp-conflicts.json` | Same source, different timestamps + amount tiebreak |
| `fixture5-complex-scenario.json` | Mixed: duplicates + conflicts + late events |

### Audit Log Output

After running fixtures, audit logs are saved to:
```
tests/fixtures/output/
├── fixture1-duplicates-audit.json
├── fixture2-late-events-audit.json
├── fixture3-source-conflicts-audit.json
├── fixture4-timestamp-conflicts-audit.json
└── fixture5-complex-scenario-audit.json
```

---

## 📁 Project Structure

```
expense-recon/
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── seed.ts                # Development seed data
├── src/
│   ├── index.ts               # Express app entrypoint
│   ├── config/                # Environment configuration
│   ├── engine/
│   │   ├── conflictResolver.ts   # Pure conflict resolution function
│   │   └── cashFlowMinimizer.ts  # Pure settlement algorithm
│   ├── middleware/             # Auth, validation, error handling
│   ├── routes/                 # API route handlers
│   ├── schemas/                # Zod validation schemas
│   ├── services/               # Business logic layer
│   ├── types/                  # TypeScript type definitions
│   ├── utils/                  # Prisma client, JWT helpers
│   └── fixtures/
│       └── runner.ts           # Fixture test runner
├── tests/
│   ├── unit/                   # Pure function tests
│   ├── integration/            # API + DB tests
│   └── fixtures/               # Test fixture JSON files
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 🔐 Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | — |
| `JWT_SECRET` | Secret key for JWT signing | — |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment (`development` / `production`) | `development` |

---

## License

MIT
