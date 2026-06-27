import { getDocument, setDocument } from '@/lib/firestore';

// Preferência de layout da home por usuário: lista ordenada de IDs de widgets
// que o usuário escolheu exibir. O render sempre filtra pelos widgets que o
// PAPEL do usuário permite (defesa em profundidade — preferência nunca "vaza"
// um widget fora do nível de acesso).
export interface UserDashboardPref {
  widgets: string[];
}

const COLLECTION = 'userDashboards';

export async function getUserDashboard(uid: string): Promise<string[] | null> {
  const doc = await getDocument<UserDashboardPref>(COLLECTION, uid).catch(() => null);
  return doc?.widgets ?? null;
}

export async function setUserDashboard(uid: string, widgets: string[]): Promise<void> {
  return setDocument(COLLECTION, uid, { widgets });
}
