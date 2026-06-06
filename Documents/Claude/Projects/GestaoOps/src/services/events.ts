import {
  getCollection,
  getDocument,
  addDocument,
  updateDocument,
  deleteDocument,
  where,
  orderBy,
  Timestamp,
} from '@/lib/firestore';
import { GestaoEvent, EventService, EventAssignment, EventExpense, EventClosing } from '@/types/event';

const COLLECTION = 'events';

export async function getEvents(): Promise<(GestaoEvent & { id: string })[]> {
  // Sem orderBy para não depender de índice composto no Firestore.
  // Ordenação feita no cliente.
  const all = await getCollection<GestaoEvent>(COLLECTION);
  return all.sort((a, b) => {
    const ta = toSafeMs(a.date);
    const tb = toSafeMs(b.date);
    return tb - ta; // mais recente primeiro
  });
}

function toSafeMs(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'object' && val !== null && 'toDate' in val) {
    return (val as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof val === 'string') return new Date(val).getTime();
  if (typeof val === 'number') return val;
  return 0;
}

export async function getUpcomingEvents(): Promise<(GestaoEvent & { id: string })[]> {
  const now = Timestamp.now();
  return getCollection<GestaoEvent>(COLLECTION, where('date', '>=', now), orderBy('date'));
}

export async function getEventsByDateRange(start: Date, end: Date): Promise<(GestaoEvent & { id: string })[]> {
  return getCollection<GestaoEvent>(
    COLLECTION,
    where('date', '>=', Timestamp.fromDate(start)),
    where('date', '<=', Timestamp.fromDate(end)),
    orderBy('date'),
  );
}

export async function getEventsByOperator(operatorId: string): Promise<(GestaoEvent & { id: string })[]> {
  // Firestore doesn't support array-contains on nested objects easily
  // So we use a subcollection approach or filter client-side
  const all = await getCollection<GestaoEvent>(COLLECTION, orderBy('date', 'desc'));
  return all.filter((e) =>
    e.assignments?.some((a: EventAssignment) => a.operatorId === operatorId)
  );
}

export async function getEventById(id: string): Promise<(GestaoEvent & { id: string }) | null> {
  return getDocument<GestaoEvent>(COLLECTION, id);
}

export async function createEvent(data: Omit<GestaoEvent, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  return addDocument(COLLECTION, data as unknown as Record<string, unknown>);
}

export async function updateEvent(id: string, data: Partial<GestaoEvent>): Promise<void> {
  return updateDocument(COLLECTION, id, data as Record<string, unknown>);
}

export async function deleteEvent(id: string): Promise<void> {
  return deleteDocument(COLLECTION, id);
}

// Services
export async function addServiceToEvent(eventId: string, service: EventService): Promise<void> {
  const event = await getEventById(eventId);
  if (!event) throw new Error('Event not found');
  const services = [...(event.services || []), service];
  // Sem limite de serviços por evento (a exportação ainda mostra só os 4 primeiros).
  await updateDocument(COLLECTION, eventId, { services } as Record<string, unknown>);
}

export async function removeServiceFromEvent(eventId: string, serviceOrder: number): Promise<void> {
  const event = await getEventById(eventId);
  if (!event) throw new Error('Event not found');
  const services = (event.services || []).filter((s: EventService) => s.serviceOrder !== serviceOrder);
  await updateDocument(COLLECTION, eventId, { services } as Record<string, unknown>);
}

// Remove chaves com valor undefined — o Firestore rejeita updateDoc com undefined.
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

// Assignments
export async function assignOperator(eventId: string, assignment: EventAssignment): Promise<void> {
  const event = await getEventById(eventId);
  if (!event) throw new Error('Event not found');
  const clean = stripUndefined(assignment as unknown as Record<string, unknown>) as unknown as EventAssignment;
  const assignments = [...(event.assignments || []), clean];
  await updateDocument(COLLECTION, eventId, { assignments, status: 'escalado' } as Record<string, unknown>);
}

export async function removeAssignment(eventId: string, operatorId: string): Promise<void> {
  const event = await getEventById(eventId);
  if (!event) throw new Error('Event not found');
  const assignments = (event.assignments || []).filter((a: EventAssignment) => a.operatorId !== operatorId);
  const status = assignments.length > 0 ? 'escalado' : 'pendente';
  await updateDocument(COLLECTION, eventId, { assignments, status } as Record<string, unknown>);
}

// Expenses
export async function addExpense(eventId: string, expense: EventExpense): Promise<void> {
  const event = await getEventById(eventId);
  if (!event) throw new Error('Event not found');
  const expenses = [...(event.expenses || []), { ...expense, id: crypto.randomUUID() }];
  await updateDocument(COLLECTION, eventId, { expenses } as Record<string, unknown>);
}

export async function removeExpense(eventId: string, expenseId: string): Promise<void> {
  const event = await getEventById(eventId);
  if (!event) throw new Error('Event not found');
  const expenses = (event.expenses || []).filter((e: EventExpense) => e.id !== expenseId);
  await updateDocument(COLLECTION, eventId, { expenses } as Record<string, unknown>);
}

// Closing
export async function closeEvent(eventId: string, closing: EventClosing): Promise<void> {
  const event = await getEventById(eventId);
  const revenueVal = event?.revenue || 0;
  await updateDocument(COLLECTION, eventId, {
    closing,
    status: 'finalizado',
    actualRevenue: revenueVal,
  } as Record<string, unknown>);
}
