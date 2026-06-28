import { getCollection, addDocument, updateDocument, deleteDocument, where } from '@/lib/firestore';
import { CostCenter } from '@/types/company';

const COL = 'costCenters';

export async function getCostCenters(companyId?: string): Promise<(CostCenter & { id: string })[]> {
  const all = companyId
    ? await getCollection<CostCenter>(COL, where('companyId', '==', companyId))
    : await getCollection<CostCenter>(COL);
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function addCostCenter(data: Omit<CostCenter, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  return addDocument(COL, data as unknown as Record<string, unknown>);
}

export async function updateCostCenter(id: string, data: Partial<Omit<CostCenter, 'id' | 'createdAt'>>): Promise<void> {
  return updateDocument(COL, id, data as Record<string, unknown>);
}

export async function deleteCostCenter(id: string): Promise<void> {
  return deleteDocument(COL, id);
}
