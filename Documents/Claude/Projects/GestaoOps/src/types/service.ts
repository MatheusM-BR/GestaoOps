// Catálogo de serviços com metadados (armazenado em settings/services)

export type ServiceNature = 'estudio' | 'externo' | 'retransmissao' | 'outro';

export const SERVICE_NATURE_LABELS: Record<ServiceNature, string> = {
  estudio: 'Estúdio',
  externo: 'Externo (viagem)',
  retransmissao: 'Retransmissão',
  outro: 'Outro (mídia/edição)',
};

export interface ServiceDef {
  name: string;
  nature: ServiceNature;     // onde/como a operação acontece
  requiresCrew: boolean;     // precisa escalar operador de transmissão (estúdio/externo)
  managed: boolean;          // gerenciado agora (entra no fluxo de escala) — false = "não tratar ainda"
  fixedValue?: number;       // valor fixo pago por este serviço (ex.: Bora Leilão = R$75, meio período)
}

// Mapa nome→valor fixo, derivado do catálogo, para o motor de pagamento.
export function serviceFixedValues(catalog: ServiceDef[]): Record<string, number> {
  const map: Record<string, number> = {};
  catalog.forEach((s) => { if (s.fixedValue && s.fixedValue > 0) map[s.name] = s.fixedValue; });
  return map;
}

// Documento settings/services: { list: string[] (nomes gerenciados, retrocompat), catalog: ServiceDef[] }
export interface ServicesSettings {
  list?: string[];
  catalog?: ServiceDef[];
}

// Catálogo padrão pré-carregado com base no domínio da Remate Web.
export const DEFAULT_SERVICE_CATALOG: ServiceDef[] = [
  // Estúdio (interno) — precisa de equipe, gerenciado
  { name: 'Transmissão Estúdio', nature: 'estudio', requiresCrew: true, managed: true },
  { name: 'Transmissão Estúdio Plus', nature: 'estudio', requiresCrew: true, managed: true },
  { name: 'Operação Estúdio', nature: 'estudio', requiresCrew: true, managed: true },
  { name: 'Live', nature: 'estudio', requiresCrew: true, managed: true },
  { name: 'Produção Canal', nature: 'estudio', requiresCrew: true, managed: true },
  { name: 'Programa Bora Leilão', nature: 'estudio', requiresCrew: true, managed: true, fixedValue: 75 },
  { name: 'Programa no Leite', nature: 'estudio', requiresCrew: true, managed: true },
  { name: 'Agro+ Programação', nature: 'estudio', requiresCrew: true, managed: true },
  // Externo (viagem) — precisa de equipe, gerenciado
  { name: 'Transmissão Externa', nature: 'externo', requiresCrew: true, managed: true },
  { name: 'Transmissão Externa Plus', nature: 'externo', requiresCrew: true, managed: true },
  { name: 'Operação Externa', nature: 'externo', requiresCrew: true, managed: true },
  // Retransmissão — só painel, sem equipe de transmissão
  { name: 'Retransmissão', nature: 'retransmissao', requiresCrew: false, managed: true },
  { name: 'Retransmissão Plus', nature: 'retransmissao', requiresCrew: false, managed: true },
  // Mídias sociais / edição / outros — ainda não tratados
  { name: 'Cobertura RW Estúdio', nature: 'estudio', requiresCrew: false, managed: false },
  { name: 'Cobertura RW Externa', nature: 'externo', requiresCrew: false, managed: false },
  { name: 'Reels Relacionamento', nature: 'outro', requiresCrew: false, managed: false },
  { name: 'Stories Mídias Sociais', nature: 'outro', requiresCrew: false, managed: false },
  { name: 'Edição de Vídeos', nature: 'outro', requiresCrew: false, managed: false },
  { name: 'Pré-Leilão', nature: 'outro', requiresCrew: false, managed: false },
  { name: 'Dia de Campo', nature: 'externo', requiresCrew: true, managed: false },
  { name: 'Institucional', nature: 'outro', requiresCrew: false, managed: false },
  { name: 'Remate Web Filmes', nature: 'outro', requiresCrew: false, managed: false },
];

// Constrói um ServiceDef a partir de um nome solto (migração da lista antiga).
export function serviceDefFromName(name: string): ServiceDef {
  const known = DEFAULT_SERVICE_CATALOG.find((s) => s.name === name);
  if (known) return known;
  return { name, nature: 'estudio', requiresCrew: true, managed: true };
}

// Nomes dos serviços gerenciados (para alimentar os selects de serviço nos eventos).
export function managedServiceNames(catalog: ServiceDef[]): string[] {
  return catalog.filter((s) => s.managed).map((s) => s.name);
}
