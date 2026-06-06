import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin with project defaults (no service account needed for same-project)
let adminApp: App;
if (getApps().length === 0) {
  adminApp = initializeApp({
    projectId: 'gestaoops-7047e',
  });
} else {
  adminApp = getApps()[0];
}

const adminAuth = getAuth(adminApp);
const adminDb = getFirestore(adminApp);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name, role, contractType } = body;

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: 'Email, senha e nome são obrigatórios' },
        { status: 400 }
      );
    }

    // Create user in Firebase Auth (server-side — doesn't affect client session)
    const userRecord = await adminAuth.createUser({
      email,
      password,
      displayName: name,
    });

    // Save user profile in Firestore
    await adminDb.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      name,
      role: role || 'operador',
      contractType: contractType || 'funcionario',
      mustResetPassword: true,
      createdAt: new Date(),
    });

    return NextResponse.json({
      uid: userRecord.uid,
      message: 'Usuário criado com sucesso',
    });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    console.error('Error creating user:', err);

    if (err.code === 'auth/email-already-exists') {
      return NextResponse.json(
        { error: 'Este e-mail já está em uso.' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: err.message || 'Erro ao criar usuário' },
      { status: 500 }
    );
  }
}
