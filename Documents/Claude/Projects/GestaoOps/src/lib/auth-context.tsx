'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updatePassword,
} from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

export type SystemRole =
  | 'admin'
  | 'ceo'
  | 'financeiro'
  | 'comercial'
  | 'administrativo'
  | 'planejamento'
  | 'operacao'  // nível de acesso operacional (só vê a própria escala)
  | 'operador_painel'      // legacy (vira função)
  | 'tecnico'              // legacy (vira função)
  | 'freelancer_estudio'  // legacy (vira função)
  | 'freelancer_externo'  // legacy (vira função)
  | 'operador_transmissao' // legacy → Técnico
  | 'gestor'   // legacy
  | 'operador'; // legacy

// Papéis de nível operador (não-gestão): só veem a própria escala e seus ganhos.
export const OPERATOR_ROLES: SystemRole[] = [
  'operacao', 'operador_painel', 'tecnico', 'freelancer_estudio', 'freelancer_externo',
  'operador_transmissao', 'operador',
];
export function isOperatorRole(role: SystemRole | undefined): boolean {
  return !!role && OPERATOR_ROLES.includes(role);
}

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: SystemRole;
  contractType?: string;
  operatorId?: string;
  mustResetPassword?: boolean;
  authProvider?: 'firebase' | 'remateweb';
}

export const ROLE_LABELS: Record<SystemRole, string> = {
  admin: 'Administrador',
  ceo: 'CEO',
  financeiro: 'Financeiro',
  comercial: 'Comercial',
  administrativo: 'Administrativo',
  planejamento: 'Planejamento',
  operacao: 'Operação',
  operador_painel: 'Operador de Painel',
  tecnico: 'Operador de Transmissão',
  freelancer_estudio: 'Freelancer Estúdio',
  freelancer_externo: 'Freelancer Externo',
  operador_transmissao: 'Operador de Transmissão',
  gestor: 'Gestor',
  operador: 'Operador',
};

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  mustResetPassword: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInRemateWeb: (email: string, displayName?: string) => void;
  signOut: () => Promise<void>;
  resetPassword: (newPassword: string) => Promise<void>;
  isAdmin: boolean;
  isGestor: boolean;
  isCEO: boolean;
  isFinanceiro: boolean;
  isComercial: boolean;
  isAdministrativo: boolean;
  isPlanejamento: boolean;
  isOperadorPainel: boolean;
  isOperadorTransmissao: boolean;
  isHighManagement: boolean; // admin or CEO
  isManagement: boolean;     // admin, CEO, gestor or administrativo
  isOperator: boolean;       // operador_painel or operador_transmissao or legacy operador
  hasAccess: (roles: SystemRole[]) => boolean;
  isAuthenticated: boolean;
  roleLabel: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getRemateWebProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const rwAuth = localStorage.getItem('remateweb_auth');
    const rwUser = localStorage.getItem('remateweb_user');
    const rwName = localStorage.getItem('remateweb_name');
    if (rwAuth === 'true' && rwUser) {
      return {
        uid: 'rw_' + rwUser,
        email: rwUser,
        name: rwName || rwUser.split('@')[0] || 'Gestor',
        role: 'admin',
        authProvider: 'remateweb',
      };
    }
  } catch {}
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(() => getRemateWebProfile());
  const [loading, setLoading] = useState(true);
  const [mustResetPassword, setMustResetPassword] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (profileDoc.exists()) {
            const data = profileDoc.data() as UserProfile;
            setProfile({ ...data, authProvider: 'firebase' });
            setMustResetPassword(data.mustResetPassword === true);
          } else {
            setProfile({
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              name: 'Administrador',
              role: 'admin',
              authProvider: 'firebase',
            });
            setMustResetPassword(false);
          }
        } catch {
          setProfile({
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            name: 'Administrador',
            role: 'admin',
            authProvider: 'firebase',
          });
          setMustResetPassword(false);
        }
      } else {
        const rwProfile = getRemateWebProfile();
        if (rwProfile) {
          setProfile(rwProfile);
        } else {
          setProfile(null);
          setMustResetPassword(false);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signInRemateWeb = useCallback(async (email: string, displayName?: string) => {
    const name = displayName || email.split('@')[0] || 'Gestor';
    localStorage.setItem('remateweb_auth', 'true');
    localStorage.setItem('remateweb_user', email);
    localStorage.setItem('remateweb_name', name);
    setProfile({
      uid: 'rw_' + email,
      email,
      name,
      role: 'admin',
      authProvider: 'remateweb',
    });
    try {
      await signInAnonymously(auth);
    } catch (e) {
      console.warn('Anonymous auth fallback failed:', e);
    }
  }, []);

  const signOut = async () => {
    await firebaseSignOut(auth);
    localStorage.removeItem('remateweb_auth');
    localStorage.removeItem('remateweb_user');
    localStorage.removeItem('remateweb_name');
    localStorage.removeItem('remateweb_token');
    localStorage.removeItem('remateweb_token_expiry');
    setProfile(null);
    setMustResetPassword(false);
  };

  const resetPassword = async (newPassword: string) => {
    if (!user) throw new Error('Usuário não autenticado');
    await updatePassword(user, newPassword);
    await updateDoc(doc(db, 'users', user.uid), { mustResetPassword: false });
    setMustResetPassword(false);
    if (profile) {
      setProfile({ ...profile, mustResetPassword: false });
    }
  };

  const role = profile?.role;
  const isAdmin = role === 'admin';
  const isCEO = role === 'ceo';
  const isFinanceiro = role === 'financeiro';
  const isComercial = role === 'comercial';
  const isAdministrativo = role === 'administrativo';
  const isPlanejamento = role === 'planejamento';
  const isOperadorPainel = role === 'operador_painel';
  const isOperadorTransmissao = role === 'operador_transmissao';
  const isGestor = role === 'gestor' || isAdmin || isCEO; // legacy + elevated
  const isHighManagement = isAdmin || isCEO;
  const isManagement = isHighManagement || role === 'gestor' || isAdministrativo || isFinanceiro || isComercial || isPlanejamento;
  const isOperator = isOperatorRole(role);
  const hasAccess = (roles: SystemRole[]) => !!role && roles.includes(role);
  const isAuthenticated = !!user || !!profile;
  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : 'Usuário';

  return (
    <AuthContext.Provider value={{
      user, profile, loading, mustResetPassword,
      signIn, signInRemateWeb, signOut, resetPassword,
      isAdmin, isGestor, isCEO, isFinanceiro, isComercial,
      isAdministrativo, isPlanejamento, isOperadorPainel,
      isOperadorTransmissao, isHighManagement, isManagement,
      isOperator, hasAccess, isAuthenticated, roleLabel,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
