import { getCollection, addDocument, updateDocument, deleteDocument } from '@/lib/firestore';
import { PaymentProfile } from '@/types/operator';

const COLLECTION = 'payment_profiles';

export async function getPaymentProfiles(): Promise<(PaymentProfile & { id: string })[]> {
  return getCollection<PaymentProfile>(COLLECTION);
}

export async function addPaymentProfile(
  profile: Omit<PaymentProfile, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  return addDocument(COLLECTION, profile as Record<string, unknown>);
}

export async function updatePaymentProfile(
  id: string,
  profile: Partial<Omit<PaymentProfile, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  return updateDocument(COLLECTION, id, profile as Record<string, unknown>);
}

export async function deletePaymentProfile(id: string): Promise<void> {
  return deleteDocument(COLLECTION, id);
}
