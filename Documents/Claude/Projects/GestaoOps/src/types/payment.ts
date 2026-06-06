export interface PaymentCalculation {
  operatorId: string;
  operatorName: string;
  eventId: string;
  eventTitle: string;
  contractType: string;
  ruleApplied: string;
  baseValue: number;
  bonus: number;
  totalValue: number;
  isWeekend: boolean;
  isHoliday: boolean;
  durationMinutes: number;
  calculatedAt: Date;
}

export interface OperatorPaymentSummary {
  operatorId: string;
  operatorName: string;
  contractType: string;
  totalEvents: number;
  totalValue: number;
  payments: PaymentCalculation[];
}

export interface FinancialSummary {
  periodStart: Date;
  periodEnd: Date;
  totalRevenue: number;
  totalExpenses: number;
  totalPayments: number;
  netResult: number;
  eventCount: number;
  operatorSummaries: OperatorPaymentSummary[];
}

export interface Holiday {
  id?: string;
  date: string; // YYYY-MM-DD
  name: string;
  national: boolean;
}
