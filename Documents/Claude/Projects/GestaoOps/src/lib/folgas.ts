import { Holiday } from '@/types/payment';
import { toSafeDate, isWeekendOrHoliday } from '@/lib/payment-engine';

// Janela de viagem de um assignment externo
interface TravelWindow { start: Date; end: Date; eventId: string }

export interface TravelTrip { start: Date; end: Date; eventIds: string[] }

// Operador mínimo necessário para o cálculo
interface OpLike {
  id: string;
  contractType?: string;
  weeklyRestDay?: number | null;
  restDays?: string[];
}

// Evento mínimo necessário
interface EvLike {
  id: string;
  date: unknown;
  endDate?: unknown;
  operationType: string | null;
  assignments?: {
    operatorId: string;
    departureDate?: unknown;
    returnDate?: unknown;
    travelDaysBefore?: number;
    travelDaysAfter?: number;
  }[];
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// Encadeia janelas de viagem que se sobrepõem ou se encostam (gap de 0 dia).
export function computeTrips(windows: TravelWindow[]): TravelTrip[] {
  const sorted = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const trips: TravelTrip[] = [];
  for (const w of sorted) {
    const last = trips[trips.length - 1];
    // "encosta" = a próxima começa até 1 dia após o fim da anterior
    if (last && w.start.getTime() <= addDays(last.end, 1).getTime()) {
      if (w.end > last.end) last.end = w.end;
      last.eventIds.push(w.eventId);
    } else {
      trips.push({ start: w.start, end: w.end, eventIds: [w.eventId] });
    }
  }
  return trips;
}

// Calcula o saldo de folgas extras do operador:
// - feriado trabalhado (CLT) → +1
// - folga semanal que cai dentro de uma viagem → +1 por ocorrência
export function computeFolgaBalance(
  op: OpLike,
  events: EvLike[],
  holidays: Holiday[],
): { holidayFolgas: number; travelFolgas: number; total: number; trips: TravelTrip[] } {
  let holidayFolgas = 0;
  const windows: TravelWindow[] = [];

  for (const ev of events) {
    const mine = (ev.assignments || []).find((a) => a.operatorId === op.id);
    if (!mine) continue;

    // (a) feriado trabalhado (CLT)
    if (op.contractType === 'funcionario') {
      const { isHoliday } = isWeekendOrHoliday(toSafeDate(ev.date), holidays);
      if (isHoliday) holidayFolgas++;
    }

    // Janela de viagem (ida/volta definidas ou calculadas dinamicamente com base nos dias de deslocamento)
    const travelDaysBefore = Number(mine.travelDaysBefore || 0);
    const travelDaysAfter = Number(mine.travelDaysAfter || 0);
    
    let depDate: Date | null = null;
    let retDate: Date | null = null;

    if (mine.departureDate) {
      depDate = toSafeDate(mine.departureDate);
    } else if (travelDaysBefore > 0) {
      const evStart = toSafeDate(ev.date);
      const dep = new Date(evStart);
      dep.setDate(dep.getDate() - travelDaysBefore);
      depDate = dep;
    }

    if (mine.returnDate) {
      retDate = toSafeDate(mine.returnDate);
    } else if (travelDaysAfter > 0) {
      const evEnd = ev.endDate ? toSafeDate(ev.endDate) : toSafeDate(ev.date);
      const ret = new Date(evEnd);
      ret.setDate(ret.getDate() + travelDaysAfter);
      retDate = ret;
    }

    if (depDate && retDate) {
      windows.push({
        start: startOfDay(depDate),
        end: startOfDay(retDate),
        eventId: ev.id,
      });
    }
  }

  const trips = computeTrips(windows);

  // (b) folga semanal que caiu dentro de alguma viagem
  let travelFolgas = 0;
  if (op.weeklyRestDay != null) {
    for (const trip of trips) {
      for (let d = new Date(trip.start); d <= trip.end; d = addDays(d, 1)) {
        if (d.getDay() === op.weeklyRestDay) travelFolgas++;
      }
    }
  }

  return { holidayFolgas, travelFolgas, total: holidayFolgas + travelFolgas, trips };
}

// Retorna o roteiro completo de deslocamento da viagem consolidada
export function getTripRoute(
  trip: TravelTrip,
  events: { id: string; date: unknown; city?: string }[],
  homeCity?: string,
): string {
  const baseCity = homeCity?.trim() || 'Cidade Base';
  
  const tripEvents = events
    .filter((e) => trip.eventIds.includes(e.id))
    .sort((a, b) => {
      const ta = a.date ? new Date(a.date as string).getTime() : 0;
      const tb = b.date ? new Date(b.date as string).getTime() : 0;
      return ta - tb;
    });
    
  if (tripEvents.length === 0) {
    return baseCity;
  }
  
  const cities = tripEvents.map((e) => e.city?.trim() || 'Cidade Leilão');
  
  // Remove cidades duplicadas sequencialmente
  const uniqueCities: string[] = [];
  for (const c of cities) {
    if (uniqueCities[uniqueCities.length - 1] !== c) {
      uniqueCities.push(c);
    }
  }
  
  return [baseCity, ...uniqueCities, baseCity].join(' ➔ ');
}
