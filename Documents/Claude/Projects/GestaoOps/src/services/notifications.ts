import { getCollection, addDocument, deleteDocument } from '@/lib/firestore';
import { NotificationRecord } from '@/types/notification';

const COLLECTION = 'notifications';

export async function getNotifications(): Promise<(NotificationRecord & { id: string })[]> {
  const all = await getCollection<NotificationRecord>(COLLECTION);
  return all.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt)); // mais recente primeiro
}

function toMs(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'object' && val !== null && 'toDate' in val) {
    return (val as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof val === 'string') return new Date(val).getTime();
  if (typeof val === 'number') return val;
  return 0;
}

// Persiste a notificação como registro/rascunho no Firestore.
// O envio real (POST /api/notification) é fase futura.
export async function createNotification(
  data: Omit<NotificationRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  return addDocument(COLLECTION, data as unknown as Record<string, unknown>);
}

export async function deleteNotification(id: string): Promise<void> {
  return deleteDocument(COLLECTION, id);
}
