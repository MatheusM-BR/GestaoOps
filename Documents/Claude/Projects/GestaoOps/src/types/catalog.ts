// Catálogos da plataforma RemateWeb (painel-net9) consumidos como selects no
// cadastro de evento. Espelham as respostas reais da API REST `/api/{entidade}`,
// que envelopa a lista no plural da entidade + `quantity`.
//
// Estes IDs são os do banco RemateWeb: ao gravar o leilão de volta na API
// (POST/PUT, fase futura) os selects precisam carregar o `id` original.

export interface BreedTranslation {
  id: number;
  breedId: number;
  breedName: string;
  language: string;        // ex: 'es-ES'
  translatedText: string;
}

export interface BreedTypeTranslation {
  breedTypeId: number;
  breedTypeName: string;
  id: number;
  language: string;
  translatedText: string;
}

// Categoria-pai da taxonomia (Bovinos, Equinos, Máquinas, Equipamentos...).
// Usada tanto na classificação de lotes quanto na segmentação de notificações.
export interface BreedType {
  id: number;
  name: string;
  createDate?: string;
  breedTypeTranslations?: BreedTypeTranslation[];
}

// Raça/item dentro de um BreedType (Nelore PO, Angus, Tratores...).
export interface Breed {
  id: number;
  name: string;
  breedTypeId: number;
  breedTypeName: string | null;
  visible: boolean;
  createDate?: string;
  breedTranslations?: BreedTranslation[];
}

// Leiloeira/organização. `eventMaker = true` → realiza eventos (leiloeira).
export interface Partner {
  id: number;
  name: string;
  url?: string;
  email?: string;
  eventMaker: boolean;
  apiKey?: string;
  image?: string;
  bucket?: string;
  imageComplete?: string;
  createDate?: string;
}

// Emissora de TV / canal de exibição do leilão.
export interface Channel {
  id: number;
  name: string;
}

// Unidade de venda do lote (item, parcela, produto).
export interface Unity {
  id: number;
  name: string;
}

// Canal técnico de transmissão WebRTC (config em #/streaming do painel).
export interface Streaming {
  id: number;
  name: string;
  organization?: string;
  ip?: string;
  port?: number;
  wss?: string;
  application?: string;
  stream?: string;
  status?: string;
}

// Faixa de incremento de lance: dado o valor atual, define o incremento mínimo.
// Espelha o schema BidIncrementRule da API (campo `incrementValue`).
export interface BidIncrementRule {
  id?: number;
  bidIncrementGroupId?: number;
  minValue: number;       // Valor Mínimo
  maxValue: number;       // Valor Máximo
  incrementValue: number; // Valor de Incremento
}

// Grupo nomeado de regras de incremento (selecionável no leilão).
export interface BidIncrementGroup {
  id: number;
  name: string;
  rules?: BidIncrementRule[];
}
