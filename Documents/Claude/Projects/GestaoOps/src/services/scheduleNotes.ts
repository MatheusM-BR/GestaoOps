import { getCollection, setDocument, deleteDocument } from '@/lib/firestore';

// Rótulo manual de atividade numa célula (operador × dia) que NÃO é um evento:
// Viagem, Montagem, Folga, etc. Espelha as anotações livres da planilha.
export interface ScheduleNote {
  operatorId: string;
  date: string;   // chave do dia: yyyy-MM-dd
  label: string;
}

const COLLECTION = 'scheduleNotes';

function noteId(operatorId: string, date: string) {
  return `${operatorId}_${date}`;
}

export async function getScheduleNotes(): Promise<(ScheduleNote & { id: string })[]> {
  return getCollection<ScheduleNote>(COLLECTION);
}

export async function setScheduleNote(operatorId: string, date: string, label: string): Promise<void> {
  return setDocument(COLLECTION, noteId(operatorId, date), { operatorId, date, label });
}

export async function deleteScheduleNote(operatorId: string, date: string): Promise<void> {
  return deleteDocument(COLLECTION, noteId(operatorId, date));
}
