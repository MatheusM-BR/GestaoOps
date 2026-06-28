import { getCollection, addDocument, updateDocument, deleteDocument } from '@/lib/firestore';
import { Company } from '@/types/company';

const COL = 'companies';

export async function getCompanies(): Promise<(Company & { id: string })[]> {
  const all = await getCollection<Company>(COL);
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function addCompany(data: Omit<Company, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  return addDocument(COL, data as unknown as Record<string, unknown>);
}

export async function updateCompany(id: string, data: Partial<Omit<Company, 'id' | 'createdAt'>>): Promise<void> {
  return updateDocument(COL, id, data as Record<string, unknown>);
}

export async function deleteCompany(id: string): Promise<void> {
  return deleteDocument(COL, id);
}
