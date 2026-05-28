import { app } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectDatabase, disconnectDatabase } from './config/database';
import { startSlaRecalculationJob } from './jobs/sla-recalculate.job';
import { recalculateAllDelays } from './modules/contracts/contracts.service';

async function bootstrap() {
  await connectDatabase();

  // Reconcilia currentStep e status de todos os contratos ao iniciar
  recalculateAllDelays().then((r) => {
    if (r.processed > 0) logger.info(`Reconciliação inicial: ${r.processed} contrato(s) verificado(s).`);
  }).catch((err) => logger.error('Erro na reconciliação inicial:', err));

  const server = app.listen(env.PORT, () => {
    logger.info(`Servidor iniciado na porta ${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`Acesse: ${env.APP_URL}`);
  });

  startSlaRecalculationJob();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Sinal ${signal} recebido. Encerrando servidor...`);
    server.close(async () => {
      await disconnectDatabase();
      logger.info('Servidor encerrado.');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Encerramento forçado após timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('UnhandledRejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    logger.error('UncaughtException:', err);
    process.exit(1);
  });
}

bootstrap();
