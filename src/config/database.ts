import { PrismaClient } from '@prisma/client';
import { env } from './env';
import { logger } from './logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Evita múltiplas instâncias do PrismaClient em hot-reload (dev)
export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
  });

if (env.NODE_ENV === 'development') {
  globalThis.__prisma = prisma;
  (prisma as any).$on('query', (e: { query: string; duration: number }) => {
    if (env.LOG_LEVEL === 'debug') {
      logger.debug(`Query: ${e.query} (${e.duration}ms)`);
    }
  });
}

export async function connectDatabase() {
  try {
    await prisma.$connect();
    logger.info('Banco de dados conectado com sucesso.');
  } catch (error) {
    logger.error('Falha ao conectar ao banco de dados:', error);
    process.exit(1);
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info('Banco de dados desconectado.');
}
