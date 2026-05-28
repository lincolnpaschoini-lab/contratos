import { addDays, isWeekend, isBefore, startOfDay } from 'date-fns';

/**
 * Adiciona N dias úteis a uma data, ignorando fins de semana.
 * Feriados podem ser passados como array de datas para exclusão futura.
 */
export function addBusinessDays(date: Date, days: number, holidays: Date[] = []): Date {
  if (days <= 0) return date;

  const holidayTimestamps = new Set(holidays.map((h) => startOfDay(h).getTime()));
  let result = new Date(date);
  let added = 0;

  while (added < days) {
    result = addDays(result, 1);
    if (!isWeekend(result) && !holidayTimestamps.has(startOfDay(result).getTime())) {
      added++;
    }
  }

  return result;
}

/**
 * Conta quantos dias úteis se passaram entre duas datas.
 */
export function countBusinessDaysBetween(start: Date, end: Date, holidays: Date[] = []): number {
  if (isBefore(end, start)) return 0;

  const holidayTimestamps = new Set(holidays.map((h) => startOfDay(h).getTime()));
  let count = 0;
  let current = new Date(start);

  while (isBefore(current, end)) {
    current = addDays(current, 1);
    if (!isWeekend(current) && !holidayTimestamps.has(startOfDay(current).getTime())) {
      count++;
    }
  }

  return count;
}

/**
 * Verifica se uma data está vencida (antes de agora).
 */
export function isOverdue(dueAt: Date | null | undefined): boolean {
  if (!dueAt) return false;
  return isBefore(dueAt, new Date());
}
