import { parseISO, isSameDay } from 'date-fns';
import { GestaoEvent, EventAssignment } from '@/types/event';
import { PaymentRules, HourRange } from '@/types/operator';
import { Holiday } from '@/types/payment';

/**
 * Verifica se um serviço pelo seu nome é considerado "interno" (de estúdio ou Live).
 */
export function isInternalService(name: string): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase().trim();
  return (
    normalized.includes('estúdio') ||
    normalized.includes('estudio') ||
    normalized === 'live' ||
    normalized === 'operação estúdio' ||
    normalized === 'transmissão estúdio' ||
    normalized === 'transmissão estúdio plus'
  );
}

/**
 * Verifica se o evento é considerado interno (se possui ao menos um serviço interno).
 */
export function isInternalEvent(services: { serviceName: string }[]): boolean {
  if (!services || services.length === 0) return false;
  return services.some((s) => isInternalService(s.serviceName));
}

/**
 * Converte um valor de data desconhecido para um objeto Date seguro.
 */
export function toSafeDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) {
    return (val as { toDate: () => Date }).toDate();
  }
  if (typeof val === 'string') return parseISO(val);
  return new Date();
}

/**
 * Calcula a duração em minutos trabalhada por um operador em um evento com base nos dados de encerramento do leilão,
 * suportando a escala de meio turno (divisão de turnos).
 */
export function calculateAssignmentDuration(
  actualStartTime: Date,
  actualEndTime: Date,
  assignment: { isHalfShift?: boolean; halfShiftType?: 'primeiro' | 'segundo'; shiftTime?: string }
): number {
  const totalDuration = (actualEndTime.getTime() - actualStartTime.getTime()) / (1000 * 60); // em minutos
  
  if (!assignment.isHalfShift || !assignment.shiftTime) {
    return Math.max(0, totalDuration);
  }

  const [hours, minutes] = assignment.shiftTime.split(':').map(Number);
  
  if (assignment.halfShiftType === 'primeiro') {
    // 1º Turno: começa no início do leilão e termina no horário final definido
    const shiftEnd = new Date(actualStartTime);
    shiftEnd.setHours(hours, minutes, 0, 0);
    
    // Se o horário final do turno for menor que o início real e o evento cruza a meia-noite, pode ser no dia seguinte
    if (shiftEnd < actualStartTime) {
      shiftEnd.setDate(shiftEnd.getDate() + 1);
    }
    
    const end = shiftEnd > actualEndTime ? actualEndTime : shiftEnd;
    const duration = (end.getTime() - actualStartTime.getTime()) / (1000 * 60);
    return Math.max(0, duration);
  } else {
    // 2º Turno: começa no horário de troca e termina no fim real do leilão.
    // Se a troca for ANTERIOR ao início do leilão (ex: troca 17h, leilão começa 18h),
    // o operador cobre o evento inteiro a partir do início real — sem duplo faturamento,
    // pois o Turno 1 terminou antes desse leilão começar.
    const shiftStart = new Date(actualStartTime);
    shiftStart.setHours(hours, minutes, 0, 0);

    // Usar o MAIOR entre horário de troca e início real do leilão
    const start = shiftStart <= actualStartTime ? actualStartTime : shiftStart;
    const duration = (actualEndTime.getTime() - start.getTime()) / (1000 * 60);
    return Math.max(0, duration);
  }
}

/**
 * Encontra a faixa de horas correspondente ao tempo trabalhado.
 * A ÚLTIMA faixa definida é ilimitada acima — captura qualquer duração acima do minHours,
 * independente do maxHours configurado. Isso evita que eventos longos (ex: 13h) fiquem
 * sem faixa quando a última tem maxHours: 12.
 */
function findHourRange(hourRanges: HourRange[], hours: number): HourRange | undefined {
  if (!hourRanges?.length) return undefined;
  const sorted = [...hourRanges].sort((a, b) => a.minHours - b.minHours);
  return sorted.find((r, i) => {
    const isLast = i === sorted.length - 1;
    return hours >= r.minHours && (isLast || hours < r.maxHours);
  });
}

/**
 * Determina se uma data corresponde a um fim de semana (Sábado/Domingo) ou feriado.
 */
export function isWeekendOrHoliday(date: Date, holidays: Holiday[]): { isWeekend: boolean; isHoliday: boolean } {
  const day = date.getDay();
  const isWeekend = day === 0 || day === 6; // 0 = Domingo, 6 = Sábado
  
  const isHoliday = holidays.some((h) => {
    try {
      const parts = h.date.split('-');
      if (parts.length === 3) {
        const hYear = parseInt(parts[0], 10);
        const hMonth = parseInt(parts[1], 10) - 1;
        const hDay = parseInt(parts[2], 10);
        return date.getFullYear() === hYear && date.getMonth() === hMonth && date.getDate() === hDay;
      }
    } catch {}
    return false;
  });

  return { isWeekend, isHoliday };
}

/**
 * Motor central de cálculo de remuneração para um operador escalado em um evento.
 */
export function calculateOperatorPayment(
  event: GestaoEvent,
  assignment: EventAssignment,
  rules: PaymentRules,
  holidays: Holiday[],
  allOperatorAssignmentsInPeriod: { eventId: string; date: Date; operationType: string | null }[] = [],
  restDayRules?: PaymentRules | null,            // tabela usada para calcular folga (padrão: Freelancer N2)
  fixedValues: Record<string, number> = {}       // valor fixo por serviço (ex.: Bora Leilão = 75)
): {
  baseValue: number;
  travelValue: number;
  bonusValue: number;
  restDayExtra: number;
  serviceExtra: number;
  earnedExtraRestDay: boolean;
  totalValue: number;
  durationMinutes: number;
  isWeekend: boolean;
  isHoliday: boolean;
  ruleApplied: string;
} {
  if (!event.closing) {
    return {
      baseValue: 0,
      travelValue: 0,
      bonusValue: 0,
      restDayExtra: 0,
      serviceExtra: 0,
      earnedExtraRestDay: false,
      totalValue: 0,
      durationMinutes: 0,
      isWeekend: false,
      isHoliday: false,
      ruleApplied: 'Evento não finalizado',
    };
  }

  const safeRules = rules || { hourRanges: [], contractType: 'freelancer_n1' };

  const startTime = toSafeDate(event.closing.actualStartTime);
  const endTime = toSafeDate(event.closing.actualEndTime);
  const eventDate = toSafeDate(event.date);

  // 1. Calcular a duração trabalhada pelo operador
  const durationMinutes = calculateAssignmentDuration(startTime, endTime, assignment);
  const hours = durationMinutes / 60;

  // 2. Verificar se é fim de semana ou feriado
  const { isWeekend, isHoliday } = isWeekendOrHoliday(eventDate, holidays);
  const isSpecialDay = isWeekend || isHoliday;

  // 3. Encontrar a faixa de horas correspondente
  //    Em dias de FOLGA o CLT recebe como freelancer N1 (cálculo abaixo),
  //    então o baseValue normal não se aplica — zerado aqui para evitar soma dupla.
  let baseValue = 0;
  let rangeRule = 'Sem faixa correspondente';
  if (!assignment.onRestDay && safeRules.hourRanges && safeRules.hourRanges.length > 0) {
    const range = findHourRange(safeRules.hourRanges, hours);
    if (range) {
      baseValue = isSpecialDay ? range.weekendHolidayValue : range.weekdayValue;
      rangeRule = `${range.minHours}h+ (${isSpecialDay ? 'FDS/Feriado' : 'Dia Útil'}) = R$ ${baseValue}`;
    }
  }

  // 4. Calcular diárias de viagem / deslocamento
  let travelValue = 0;
  
  // Se for leilão externo ou tiver dias de viagem
  const isExternal = event.operationType === 'externo';
  const travelDays = (assignment.travelDaysBefore || 0) + (assignment.travelDaysAfter || 0);

  // Diária dos dias de deslocamento (quando não é o dia do leilão)
  if (travelDays > 0) {
    const dailyRate = safeRules.dailyTravel || 200; // Padrão de R$ 200 se não definido
    travelValue += dailyRate * travelDays;
  }

  // Diária do próprio dia do leilão se for externo
  if (isExternal) {
    // Verificar se o operador fez outros leilões externos no mesmo dia
    const sameDayExternalEvents = allOperatorAssignmentsInPeriod.filter((a) => 
      a.eventId !== event.id && 
      a.operationType === 'externo' && 
      isSameDay(toSafeDate(a.date), eventDate)
    );

    const hasMultipleExternal = sameDayExternalEvents.length > 0;
    const dailyRate = hasMultipleExternal 
      ? (safeRules.dailyTravelMultiple || 300) 
      : (safeRules.dailyTravel || 200);

    // Se houver múltiplos eventos no mesmo dia, dividimos o bônus de R$ 300 proporcionalmente 
    // ou atribuímos R$ 300 no total de diárias desse dia. Para manter o cálculo consistente 
    // por evento: se for múltiplo, cada evento ganha proporcional (ex: 300 / total eventos),
    // ou se o outro evento já computou, computamos a diferença.
    // De forma simples e justa: se for múltiplo, a diária desse leilão externo é R$ 150 (300 / 2) ou proporcional,
    // garantindo que a soma dê exatamente R$ 300 para o dia.
    if (hasMultipleExternal) {
      const totalEventsOnDay = sameDayExternalEvents.length + 1;
      travelValue += (safeRules.dailyTravelMultiple || 300) / totalEventsOnDay;
    } else {
      travelValue += dailyRate;
    }
  }

  // 5. Bônus CLT para Funcionários (fim de semana/feriado em dia NORMAL de trabalho).
  //    Em dias de folga não se aplica — a tabela N1 já diferencia weekday vs weekend.
  //    weekendHolidayBonus é um FALLBACK fixo: só é usado quando NENHUMA faixa tem
  //    weekendHolidayValue > 0, evitando soma dupla com o tiered configurado em hourRanges.
  let bonusValue = 0;
  if (!assignment.onRestDay && safeRules.contractType === 'funcionario' && isSpecialDay) {
    const hasWeekendTiered = (safeRules.hourRanges || []).some((r) => r.weekendHolidayValue > 0);
    if (!hasWeekendTiered) {
      bonusValue = safeRules.weekendHolidayBonus || 0;
    }
  }

  // 6. Dia de folga trabalhado → paga pela tabela N2 (substitui o baseValue, não soma).
  //    Usa findHourRange para que a última faixa seja ilimitada (ex: 12h+ = 200).
  //    Fallback: restDayExtra fixo configurado no operador.
  let restDayExtra = 0;
  if (assignment.onRestDay) {
    if (restDayRules?.hourRanges?.length) {
      const r = findHourRange(restDayRules.hourRanges, hours);
      if (r) {
        restDayExtra = isSpecialDay ? r.weekendHolidayValue : r.weekdayValue;
      } else if (safeRules.restDayExtra && safeRules.restDayExtra > 0) {
        restDayExtra = safeRules.restDayExtra;
      }
    } else if (safeRules.restDayExtra && safeRules.restDayExtra > 0) {
      restDayExtra = safeRules.restDayExtra;
    }
  }

  // 7. Valores fixos de serviço (ex.: Programa Bora Leilão = R$75, meio período).
  //    Regra: vira "diária" quando o operador faz o serviço de valor fixo (ex.: Bora ao meio-dia)
  //    E também tem outro leilão no mesmo dia (ex.: à noite) → aí recebe o valor fixo.
  //    CLT que só faz o Bora NÃO recebe (fica dentro da jornada, faz horário comercial).
  //    Freelancer recebe o valor fixo de qualquer forma.
  const hasOtherEventSameDay = allOperatorAssignmentsInPeriod.some(
    (a) => a.eventId !== event.id && isSameDay(toSafeDate(a.date), eventDate),
  );
  let serviceExtra = 0;
  (event.services || []).forEach((sv) => {
    const v = fixedValues[sv.serviceName];
    if (v && v > 0 && (hasOtherEventSameDay || safeRules.contractType !== 'funcionario')) {
      serviceExtra += v;
    }
  });

  // 8. Feriado trabalhado (CLT) → gera folga extra (banco de folgas), informativo.
  const earnedExtraRestDay = safeRules.contractType === 'funcionario' && isHoliday;

  const totalValue = baseValue + travelValue + bonusValue + restDayExtra + serviceExtra;

  return {
    baseValue,
    travelValue,
    bonusValue,
    restDayExtra,
    serviceExtra,
    earnedExtraRestDay,
    totalValue,
    durationMinutes,
    isWeekend,
    isHoliday,
    ruleApplied: `${rangeRule}${travelValue > 0 ? ` + Diárias de Viagem` : ''}${bonusValue > 0 ? ` + Bônus FDS/CLT` : ''}${restDayExtra > 0 ? ` + Folga (N2)` : ''}${serviceExtra > 0 ? ` + Serviços fixos` : ''}${earnedExtraRestDay ? ` + Folga extra (feriado)` : ''}`,
  };
}
