import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyByDcuEMqTsIOZOiHMvw0Nd0d2T2du7Dkc",
  authDomain: "gestaoops-7047e.firebaseapp.com",
  projectId: "gestaoops-7047e",
  storageBucket: "gestaoops-7047e.firebasestorage.app",
  messagingSenderId: "1081435436100",
  appId: "1:1081435436100:web:1d99f781c88bd033323811"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);

// experimentalAutoDetectLongPolling: detecta automaticamente se QUIC/WebSocket
// falha e cai para long polling (TCP) — resolve ERR_QUIC_PROTOCOL_ERROR
export const db = getApps().length > 1
  ? getFirestore(app)
  : initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

export default app;
