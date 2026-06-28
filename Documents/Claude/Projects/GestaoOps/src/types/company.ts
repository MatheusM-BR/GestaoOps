export interface Company {
  id: string;
  name: string;
  code: string;       // sigla curta, ex: "RW"
  cnpj?: string;
  color?: string;     // hex para identificação visual
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CostCenterType = 'operacional' | 'administrativo' | 'financeiro' | 'comercial';

export const COST_CENTER_TYPE_LABELS: Record<CostCenterType, string> = {
  operacional: 'Operacional',
  administrativo: 'Administrativo',
  financeiro: 'Financeiro',
  comercial: 'Comercial',
};

export interface CostCenter {
  id: string;
  companyId: string;
  name: string;
  code: string;
  type: CostCenterType;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
