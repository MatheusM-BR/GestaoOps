import { getCollection, setDocument, deleteDocument } from '@/lib/firestore';

// Turno de um operador de PAINEL num dia. O operador cobre TODOS os eventos do
// dia (estúdio/externo/retransmissão), exceto o Bora Leilão, a partir da hora de
// entrada. Dois operadores no mesmo dia = manhã/tarde (a entrada do 2º é a troca
// de turno). Custo é por turno (duração da janela × faixa de horas).
export interface PanelShift {
  date: string;        // chave do dia: yyyy-MM-dd
  operatorId: string;
  operatorName: string;
  entryTime: string;   // HH:mm — hora inicial
  exitTime?: string;   // HH:mm — hora final (se vazio, usa fim do último evento)
  shiftType?: 'full' | '1T' | '2T' | 'manual'; // undefined = legado/automático
}

// Horário padrão do plantão de painel: 17:00 → 01:00 (madrugada).
export const PANEL_DEFAULT = { entry: '17:00', exit: '01:00' } as const;

const COLLECTION = 'panelShifts';

function shiftId(date: string, operatorId: string) {
  return `${date}_${operatorId}`;
}

export async function getPanelShifts(): Promise<(PanelShift & { id: string })[]> {
  return getCollection<PanelShift>(COLLECTION);
}

export async function setPanelShift(
  date: string,
  operatorId: string,
  operatorName: string,
  entryTime: string,
  exitTime: string,
  shiftType?: 'full' | '1T' | '2T' | 'manual',
): Promise<void> {
  return setDocument(COLLECTION, shiftId(date, operatorId), {
    date, operatorId, operatorName, entryTime, exitTime, shiftType,
  });
}

export async function deletePanelShift(date: string, operatorId: string): Promise<void> {
  return deleteDocument(COLLECTION, shiftId(date, operatorId));
}
