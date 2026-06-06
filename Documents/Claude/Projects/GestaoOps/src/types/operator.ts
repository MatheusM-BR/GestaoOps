export type ContractType = 'funcionario' | 'freelancer_n1' | 'freelancer_n2';
// Nível de acesso (permissão). 'operacao' = papel operacional (só vê a própria escala).
export type OperatorRole = 'admin' | 'ceo' | 'financeiro' | 'planejamento' | 'comercial' | 'administrativo' | 'operacao' | 'operador_painel' | 'tecnico' | 'freelancer_estudio' | 'freelancer_externo' | 'operador_transmissao';

// Funções operacionais (o que o operador faz). Um operador pode ter várias —
// ex.: um Operador de Transmissão que também faz o serviço de Planejamento.
export type OperatorFunction = 'operador_painel' | 'tecnico' | 'freelancer_estudio' | 'freelancer_externo' | 'planejamento';

export const OPERATOR_FUNCTION_LABELS: Record<OperatorFunction, string> = {
  operador_painel: 'Operador de Painel',
  tecnico: 'Operador de Transmissão', // faz estúdio e pode viajar (externo)
  freelancer_estudio: 'Freelancer Estúdio',
  freelancer_externo: 'Freelancer Externo',
  planejamento: 'Planejamento',
};

export interface HourRange {
  minHours: number;
  maxHours: number;
  weekdayValue: number;
  weekendHolidayValue: number;
}

export interface PaymentRules {
  id?: string;
  operatorId: string;
  contractType: ContractType;
  dailyTravel: number;
  dailyTravelMultiple: number;
  weekendHolidayBonus: number;
  restDayExtra?: number; // valor extra pago quando o operador trabalha em dia de folga
  hourRanges: HourRange[];
  isDefault: boolean;
  updatedAt: Date;
}

export interface Operator {
  id: string;
  uid?: string; // Firebase Auth UID
  name: string;
  email: string;
  phone: string;
  contractType: ContractType;
  role: OperatorRole;             // nível de acesso (permissão)
  functions?: OperatorFunction[]; // funções operacionais (várias)
  homeCity?: string;              // cidade-base do operador (origem das viagens)
  weeklyRestDay?: number | null;  // dia da semana de folga padrão (0=Dom ... 6=Sáb); null = sem folga fixa
  restDays?: string[];            // folgas avulsas / trocas (datas ISO yyyy-MM-dd)
  active: boolean;
  paymentRules?: PaymentRules;
  createdAt: Date;
  updatedAt: Date;
}

export const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Verifica se uma data é folga do operador (folga semanal fixa OU folga avulsa marcada).
export function isOperatorRestDay(
  op: { weeklyRestDay?: number | null; restDays?: string[] },
  date: Date,
): boolean {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const key = `${y}-${m}-${d}`;
  if (op.restDays?.includes(key)) return true;
  if (op.weeklyRestDay != null && date.getDay() === op.weeklyRestDay) return true;
  return false;
}
