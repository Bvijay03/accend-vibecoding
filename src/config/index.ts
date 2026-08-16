import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'fallback-secret',
  nodeEnv: process.env.NODE_ENV || 'development',

  /** Source reliability ranking — higher = more reliable */
  sourceReliability: {
    mobile: 3,
    web: 2,
    sync: 1,
  } as Record<string, number>,
};
