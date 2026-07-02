import cron from 'node-cron';
import { recalculateAllDelays } from '../modules/contracts/contracts.service';
import { logger } from '../config/logger';

// Executa a cada 30 minutos
export function startSlaRecalculationJob() {
  const schedule = '*/30 * * * *';

  cron.schedule(schedule, async () => {
    logger.info('Job SLA: iniciando recálculo de atrasos...');
    try {
      const result = await recalculateAllDelays();
      logger.info(`Job SLA: concluído. Processados: ${result.processed}, atualizados: ${result.updated}, alertas enviados: ${result.notified}`);
    } catch (err: any) {
      logger.error(`Job SLA: erro durante recálculo. ${err.message}`);
    }
  });

  logger.info(`Job de recálculo de SLA agendado: ${schedule}`);
}
