import { Response } from 'express';
import { logger } from '../../config/logger';

// Mapa de clientes conectados via SSE
const clients = new Map<string, Response>();

export function addSseClient(clientId: string, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // desativa buffer do nginx para eventos fluírem imediatamente
  });

  // Mensagem inicial + heartbeat periódico para manter conexão viva
  res.write('data: {"type":"connected"}\n\n');
  clients.set(clientId, res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
      clients.delete(clientId);
    }
  }, 25000);

  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(clientId);
  });
}

export function broadcastEvent(event: string, data: Record<string, unknown>): void {
  if (clients.size === 0) return;

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead: string[] = [];

  clients.forEach((res, id) => {
    try {
      res.write(message);
    } catch {
      dead.push(id);
    }
  });

  dead.forEach((id) => clients.delete(id));

  logger.info(`SSE broadcast: ${event} → ${clients.size} cliente(s)`);
}

export function getSseClientCount(): number {
  return clients.size;
}
