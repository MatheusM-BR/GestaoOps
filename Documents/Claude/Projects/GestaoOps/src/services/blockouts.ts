import { addDocument, getCollection, updateDocument, deleteDocument } from '@/lib/firestore';
import { ContractType } from '@/types/operator';

export type BlockoutStatus = 'aprovado' | 'pendente' | 'recusado';
export type BlockoutReason = 'ferias' | 'pessoal' | 'medico' | 'compromisso' | 'outro';

export const BLOCKOUT_REASON_LABELS: Record<BlockoutReason, string> = {
  ferias: 'Férias',
  pessoal: 'Pessoal',
  medico: 'Consulta/Médico',
  compromisso: 'Compromisso externo',
  outro: 'Outro',
};

export interface OperatorBlockout {
  id?: string;
  operatorId: string;      // Firestore doc ID do operador
  userId: string;          // Firebase Auth UID (para regras de segurança)
  operatorName: string;
  contractType: ContractType;
  dateFrom: string;        // yyyy-MM-dd
  dateTo: string;          // yyyy-MM-dd (pode ser igual a dateFrom para 1 dia)
  reason: BlockoutReason;
  note: string;
  status: BlockoutStatus;
  createdAt: string;       // ISO 8601
  reviewedBy?: string;
  reviewedAt?: string;
}

const COLLECTION = 'operatorBlockouts';

export async function createBlockout(data: Omit<OperatorBlockout, 'id'>): Promise<string> {
  return addDocument(COLLECTION, data);
}

export async function getAllBlockouts(): Promise<OperatorBlockout[]> {
  return getCollection<OperatorBlockout>(COLLECTION);
}

export async function getBlockoutsByOperator(operatorId: string): Promise<OperatorBlockout[]> {
  const all = await getCollection<OperatorBlockout>(COLLECTION);
  return all.filter((b) => b.operatorId === operatorId)
            .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
}

export async function getPendingBlockouts(): Promise<OperatorBlockout[]> {
  const all = await getCollection<OperatorBlockout>(COLLECTION);
  return all.filter((b) => b.status === 'pendente')
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function reviewBlockout(id: string, status: 'aprovado' | 'recusado', reviewerName: string): Promise<void> {
  await updateDocument(COLLECTION, id, { status, reviewedBy: reviewerName, reviewedAt: new Date().toISOString() } as Record<string, unknown>);
}

export async function deleteBlockout(id: string): Promise<void> {
  return deleteDocument(COLLECTION, id);
}
