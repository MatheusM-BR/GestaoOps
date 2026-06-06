import {
  collection,
  doc,
  getDocs,
  getDoc,
  getDocsFromServer,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  setDoc,
  QueryConstraint,
} from 'firebase/firestore';
import { db } from './firebase';

// Generic helpers

export async function getCollection<T>(
  collectionName: string,
  ...constraints: QueryConstraint[]
): Promise<(T & { id: string })[]> {
  const q = constraints.length > 0
    ? query(collection(db, collectionName), ...constraints)
    : collection(db, collectionName);
  // Usa getDocsFromServer para garantir dados frescos do servidor
  // e evitar que o cache local retorne resultados desatualizados
  // logo após escrita de documentos novos.
  const snapshot = await getDocsFromServer(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as T & { id: string }));
}

export async function getDocument<T>(collectionName: string, docId: string): Promise<(T & { id: string }) | null> {
  const snap = await getDoc(doc(db, collectionName, docId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as T & { id: string };
}

export async function addDocument<T extends Record<string, unknown>>(collectionName: string, data: T): Promise<string> {
  const docRef = await addDoc(collection(db, collectionName), {
    ...data,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function setDocument<T extends Record<string, unknown>>(collectionName: string, docId: string, data: T): Promise<void> {
  await setDoc(doc(db, collectionName, docId), {
    ...data,
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

export async function updateDocument<T extends Record<string, unknown>>(collectionName: string, docId: string, data: Partial<T>): Promise<void> {
  await updateDoc(doc(db, collectionName, docId), {
    ...data,
    updatedAt: Timestamp.now(),
  });
}

export async function deleteDocument(collectionName: string, docId: string): Promise<void> {
  await deleteDoc(doc(db, collectionName, docId));
}

export { collection, query, where, orderBy, Timestamp };
