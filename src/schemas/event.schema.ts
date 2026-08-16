import { z } from 'zod';

export const eventSchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
  expenseId: z.string().min(1, 'expenseId is required'),
  amount: z.number().positive('amount must be positive'),
  description: z.string().min(1, 'description is required'),
  payerId: z.string().uuid('payerId must be a valid UUID'),
  timestamp: z.string().datetime({ message: 'timestamp must be ISO 8601' }),
  source: z.enum(['mobile', 'web', 'sync'], {
    errorMap: () => ({ message: 'source must be mobile, web, or sync' }),
  }),
  groupId: z.string().uuid('groupId must be a valid UUID'),
});

export const replaySchema = z.object({
  events: z.array(eventSchema).min(1, 'At least one event is required'),
});

export const registerSchema = z.object({
  email: z.string().email('Invalid email'),
  name: z.string().min(1, 'Name is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
});

export const createGroupSchema = z.object({
  name: z.string().min(1, 'Group name is required'),
  memberIds: z.array(z.string().uuid()).min(1, 'At least one member required'),
});

export type EventInput = z.infer<typeof eventSchema>;
export type ReplayInput = z.infer<typeof replaySchema>;
