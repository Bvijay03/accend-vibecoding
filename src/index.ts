import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import groupRoutes from './routes/group.routes';
import eventRoutes from './routes/event.routes';
import settlementRoutes from './routes/settlement.routes';
import auditRoutes from './routes/audit.routes';

const app = express();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/auth', authRoutes);
app.use('/groups', groupRoutes);
app.use('/events', eventRoutes);
app.use('/settlement', settlementRoutes);
app.use('/audit', auditRoutes);

// ---------------------------------------------------------------------------
// Error handler (must be last)
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start server (only when not imported for testing)
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`🚀 Expense Reconciliation Engine running on port ${config.port}`);
    console.log(`   Environment: ${config.nodeEnv}`);
  });
}

export default app;
