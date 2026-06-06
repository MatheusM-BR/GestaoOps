import {
  getCollection,
  getDocument,
  addDocument,
  updateDocument,
  deleteDocument,
  setDocument,
  where,
  orderBy,
} from '@/lib/firestore';
import { Operator, PaymentRules } from '@/types/operator';
import { createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const COLLECTION = 'operators';

export async function getOperators(): Promise<(Operator & { id: string })[]> {
  return getCollection<Operator>(COLLECTION, orderBy('name'));
}

export async function getActiveOperators(): Promise<(Operator & { id: string })[]> {
  return getCollection<Operator>(COLLECTION, where('active', '==', true), orderBy('name'));
}

export async function getOperatorById(id: string): Promise<(Operator & { id: string }) | null> {
  return getDocument<Operator>(COLLECTION, id);
}

export async function getOperatorByUid(uid: string): Promise<(Operator & { id: string }) | null> {
  const results = await getCollection<Operator>(COLLECTION, where('uid', '==', uid));
  return results.length > 0 ? results[0] : null;
}

export async function createOperator(data: Omit<Operator, 'id' | 'createdAt' | 'updatedAt'> & { password?: string }): Promise<string> {
  const { password, ...operatorData } = data;

  // Create Firebase Auth account using a secondary app instance
  // This prevents the admin from being logged out
  let uid: string | undefined;
  if (data.email && password) {
    try {
      // Use a secondary Firebase app to create the user
      // so the current admin session is not affected
      const secondaryApp = initializeApp(
        {
          apiKey: "AIzaSyByDcuEMqTsIOZOiHMvw0Nd0d2T2du7Dkc",
          authDomain: "gestaoops-7047e.firebaseapp.com",
          projectId: "gestaoops-7047e",
        },
        'secondary-' + Date.now()
      );
      const secondaryAuth = getAuth(secondaryApp);
      const userCred = await createUserWithEmailAndPassword(secondaryAuth, data.email, password);
      uid = userCred.user.uid;

      // Create user profile in Firestore
      await setDoc(doc(db, 'users', uid), {
        uid,
        email: data.email,
        name: data.name,
        role: data.role || 'tecnico',
        contractType: data.contractType,
        mustResetPassword: true,
      });

      // Sign out and delete the secondary app
      await secondaryAuth.signOut();
      await deleteApp(secondaryApp);
    } catch (err: unknown) {
      const fbErr = err as { code?: string; message?: string };
      if (fbErr.code === 'auth/email-already-in-use') {
        throw new Error('Este e-mail já está em uso.');
      }
      throw new Error(fbErr.message || 'Erro ao criar conta de acesso.');
    }
  }

  const docData = {
    ...operatorData,
    uid: uid || null,
    active: data.active ?? true,
  } as Record<string, unknown>;

  return addDocument(COLLECTION, docData);
}

export async function updateOperator(id: string, data: Partial<Operator>): Promise<void> {
  await updateDocument(COLLECTION, id, data as Record<string, unknown>);
  // Sincroniza o nível de acesso/nome com o documento de login (users/{uid}),
  // pois as permissões de login são lidas de 'users', não de 'operators'.
  if (data.role !== undefined || data.name !== undefined) {
    try {
      const op = await getDocument<Operator>(COLLECTION, id);
      if (op?.uid) {
        const sync: Record<string, unknown> = {};
        if (data.role !== undefined) sync.role = data.role;
        if (data.name !== undefined) sync.name = data.name;
        await updateDocument('users', op.uid, sync);
      }
    } catch (err) {
      console.error('Falha ao sincronizar users/{uid}:', err);
    }
  }
}

export async function deleteOperator(id: string): Promise<void> {
  return deleteDocument(COLLECTION, id);
}

export async function savePaymentRules(operatorId: string, rules: Omit<PaymentRules, 'id' | 'updatedAt'>): Promise<void> {
  await updateDocument(COLLECTION, operatorId, {
    paymentRules: {
      ...rules,
      operatorId,
      updatedAt: new Date(),
    },
  } as Record<string, unknown>);
}
