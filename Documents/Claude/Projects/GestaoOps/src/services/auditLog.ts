import { addDocument, getCollection } from '@/lib/firestore';

export type AuditAction =
  | 'CREATE_EVENT' | 'UPDATE_EVENT' | 'DELETE_EVENT'
  | 'CREATE_OPERATOR' | 'UPDATE_OPERATOR' | 'DELETE_OPERATOR'
  | 'ASSIGN_OPERATOR' | 'REMOVE_ASSIGNMENT'
  | 'UPDATE_SETTINGS'
  | 'IMPORT_API' | 'SYNC_TIMES';

export interface AuditEntry {
  id?: string;
  userId: string;
  userName: string;
  role: string;
  action: AuditAction;
  resource: string;   // 'event', 'operator', 'settings', etc.
  resourceId?: string;
  detail: string;     // Descrição legível: "Criou evento 'Remate Brahman'"
  timestamp: string;  // ISO 8601
}

const COLLECTION = 'auditLog';

export async function logAudit(
  userId: string,
  userName: string,
  role: string,
  action: AuditAction,
  resource: string,
  detail: string,
  resourceId?: string,
): Promise<void> {
  try {
    await addDocument(COLLECTION, {
      userId, userName, role, action, resource, resourceId: resourceId ?? null, detail,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Falha no log não deve bloquear a operação principal.
  }
}

export interface AuditFilter {
  userId?: string;
  action?: AuditAction | '';
  dateFrom?: string;  // yyyy-MM-dd
  dateTo?: string;
}

export async function getAuditLog(): Promise<AuditEntry[]> {
  const entries = await getCollection<Omit<AuditEntry, 'id'>>(COLLECTION);
  return (entries as AuditEntry[]).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
