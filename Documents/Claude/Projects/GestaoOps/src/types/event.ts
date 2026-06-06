export type OperationType = 'estudio' | 'externo' | 'retransmissao';

export const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  estudio: 'Estúdio',
  externo: 'Externo',
  retransmissao: 'Retransmissão',
};

// Classe de badge (CSS) por natureza de operação
export const OPERATION_TYPE_BADGE: Record<OperationType, string> = {
  estudio: 'badge-accent',
  externo: 'badge-primary',
  retransmissao: 'badge-info',
};
export type EventStatus = 'pendente' | 'escalado' | 'em_andamento' | 'finalizado';
export type AssignmentStatus = 'confirmado' | 'pendente' | 'cancelado';
export type ExpenseCategory = 'veiculo' | 'hospedagem' | 'alimentacao' | 'outros';

export interface EventService {
  id?: string;
  eventId: string;
  serviceName: string;
  serviceOrder: number; // 1-4
}

export interface EventAssignment {
  id?: string;
  eventId: string;
  operatorId: string;
  operatorName?: string;
  role: string;
  travelDaysBefore: number;
  travelDaysAfter: number;
  departureDate: Date | null;
  returnDate: Date | null;
  status: AssignmentStatus;
  isHalfShift?: boolean;
  halfShiftType?: 'primeiro' | 'segundo';
  shiftTime?: string;
  onRestDay?: boolean; // escalado em dia de folga → gera valor extra (como freelancer)
}

export interface EventExpense {
  id?: string;
  eventId: string;
  operatorId: string;
  operatorName?: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: Date;
  receipt?: string;
}

export interface EventClosing {
  id?: string;
  eventId: string;
  actualStartTime: Date;
  actualEndTime: Date;
  durationMinutes: number;
  crossedMidnight: boolean;
  closedBy: string;
  closedAt: Date;
}

// Planning types

export interface PlanningVehicle {
  type: 'aluguel' | 'proprio' | 'van' | 'onibus' | 'aviao' | 'outro';
  rental?: string;        // locadora
  model?: string;
  plate?: string;
  dailyRate?: number;
  totalDays?: number;
  totalCost?: number;
  notes?: string;
}

export interface PlanningHotel {
  name: string;
  address?: string;
  checkIn: string;    // date string
  checkOut: string;   // date string
  dailyRate: number;
  rooms: number;
  totalCost?: number;
  notes?: string;
}

export interface PlanningChecklist {
  id: string;
  text: string;
  done: boolean;
}

export interface EventPlanning {
  departureDate: string;     // ISO date
  departureTime?: string;
  returnDate: string;
  returnTime?: string;
  originCity?: string;
  meetingPoint?: string;
  vehicle?: PlanningVehicle;
  hotel?: PlanningHotel;
  checklist: PlanningChecklist[];
  notes?: string;
  updatedAt?: Date;
  updatedBy?: string;
}

export interface GestaoEvent {
  id?: string;
  rematewebId: number | null;
  title: string;
  date: Date;
  endDate: Date;
  operationType: OperationType | null;
  studioId: string | null;
  studioName: string | null;
  city: string;
  state: string;
  place: string;
  channelName: string;
  organizationName: string;
  revenue: number;
  actualRevenue: number;
  status: EventStatus;
  commercialIntermediary: string;
  contractInfo: string;
  company: string;
  observation: string;
  financialCode: string;
  services: EventService[];
  assignments: EventAssignment[];
  expenses: EventExpense[];
  closing: EventClosing | null;
  planning?: EventPlanning | null;
  needsPlanning?: boolean;
  createdAt: Date;
  updatedAt: Date;
}
