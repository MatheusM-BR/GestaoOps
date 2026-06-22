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
// Tipo de Leilão da plataforma RemateWeb (enum SaleType da API).
export type SaleType = 0 | 1 | 2 | 3;
export const SALE_TYPE_LABELS: Record<SaleType, string> = {
  0: 'Reserva',
  1: 'Normal',
  2: 'Shopping',
  3: 'Pré Lance',
};

// Região do leilão (campo regionId da API).
export const REGION_LABELS: Record<string, string> = {
  br: 'Brasil',
  bo: 'Bolívia',
};

// Bloco com os dados do leilão no formato que a API RemateWeb (POST /api/auction)
// espera. Guardado denormalizado (id + nome) para exibição sem depender do
// catálogo carregado. A escrita de fato na API é fase futura — por ora só
// capturamos os campos. Ver docs/remateweb-api.md.
export interface AuctionRegistration {
  saleType: SaleType | null;
  regionId: string;                    // 'br' | 'bo'
  onlineUntil: Date | null;
  organizationId: number | null;       // Parceiro (organização)
  partnerId: number | null;            // Parceiro realizador (leiloeira)
  partnerName: string;
  channelId: number | null;
  streamingId: number | null;
  streamingName: string;
  breedId: number | null;              // Raça principal
  breedName: string;
  bidIncrementGroupId: number | null;
  bidIncrementGroupName: string;
  increment: number | null;
  captation: number | null;
  paymentConditions: string;
  youtubePlaylist: string;
  youtubeId: string;
  visible: boolean;
  agenda: boolean;
  transmission: boolean;
  live: boolean;
  buyerTax: number | null;
  sellerTax: number | null;
  unitTax: number | null;
}

// Estado inicial do bloco de dados do leilão (padrões iguais aos do painel).
// Condição de pagamento padrão pré-preenchida no cadastro.
export const DEFAULT_PAYMENT_CONDITION = '2+2+2+2+2+20=30';

export function emptyAuctionRegistration(): AuctionRegistration {
  return {
    saleType: 1,        // Normal
    regionId: 'br',
    onlineUntil: null,
    organizationId: null,
    partnerId: null,
    partnerName: '',
    channelId: null,
    streamingId: null,
    streamingName: '',
    breedId: 1,                 // Nelore PO (raça mais comum) pré-selecionada
    breedName: 'Nelore PO',
    bidIncrementGroupId: null,
    bidIncrementGroupName: '',
    increment: 10,              // incremento padrão
    captation: 30,              // captação padrão
    paymentConditions: DEFAULT_PAYMENT_CONDITION,
    youtubePlaylist: '',
    youtubeId: '',
    visible: false,
    agenda: true,
    transmission: false,
    live: false,
    buyerTax: null,
    sellerTax: null,
    unitTax: null,
  };
}

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
  // Dados do leilão no formato RemateWeb (cadastro que substituirá o painel-net9).
  auctionData?: AuctionRegistration | null;
  createdAt: Date;
  updatedAt: Date;
}
