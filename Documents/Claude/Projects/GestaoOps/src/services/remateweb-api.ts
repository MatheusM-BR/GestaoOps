const API_BASE_URL = 'https://api.remateweb.com';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  name?: string;
  userName?: string;
}

export interface AuthResult {
  token: string;
  name: string;
}

export interface RemateAuction {
  id: number;
  title: string;
  date: string;
  endDate: string;
  imageComplete: string;
  channelName: string;
  channelId: number;
  streamingName: string;
  partnerName: string;
  place: string;
  city: string;
  state: string;
  live: boolean;
  visible: boolean;
  agenda: boolean;
  transmission: boolean;
  organizationName?: string;
  breedName?: string;
  description?: string;
  financialCode?: string;
  commercialInfo?: string;
  leilaoCodigo?: number;
  auctionPartners?: { partnerName: string; partnerRole?: string }[];
  auctionProvidedServices?: { providedServiceName?: string; studioName?: string }[];
}

// Persist token in localStorage so it survives page reloads
function getStoredToken(): { token: string; expiry: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem('remateweb_token');
    const expiry = parseInt(localStorage.getItem('remateweb_token_expiry') || '0', 10);
    const tokenUrl = localStorage.getItem('remateweb_token_url');

    // Invalida token se a URL da API mudou para evitar enviar token do test no prod
    if (tokenUrl && tokenUrl !== API_BASE_URL) {
      clearStoredToken();
      return null;
    }

    if (token && expiry > Date.now()) return { token, expiry };
  } catch {}
  return null;
}

function storeToken(token: string, expiresIn: number): void {
  const expiry = Date.now() + (expiresIn * 1000) - 60000;
  localStorage.setItem('remateweb_token', token);
  localStorage.setItem('remateweb_token_expiry', String(expiry));
  localStorage.setItem('remateweb_token_url', API_BASE_URL);
}

function clearStoredToken(): void {
  localStorage.removeItem('remateweb_token');
  localStorage.removeItem('remateweb_token_expiry');
  localStorage.removeItem('remateweb_token_url');
}

export function getToken(): string | null {
  const stored = getStoredToken();
  return stored ? stored.token : null;
}

export function hasValidToken(): boolean {
  return !!getToken();
}

export function setTokenManually(token: string): void {
  storeToken(token, 3600); // assume 1h
}

export async function authenticate(username: string, password: string): Promise<AuthResult> {
  const formData = new URLSearchParams();
  formData.append('grant_type', 'password');
  formData.append('username', username);
  formData.append('password', password);

  const res = await fetch(`${API_BASE_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });

  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data: TokenResponse = await res.json();
  storeToken(data.access_token, data.expires_in);
  return { token: data.access_token, name: data.name || username };
}

export function logout(): void {
  clearStoredToken();
}

async function apiGet<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const headers: Record<string, string> = { 'Accept': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url.toString(), { headers });
  
  if (res.status === 401) {
    clearStoredToken(); // limpa token inválido ou expirado no servidor
  }

  if (!res.ok) throw new Error(`API Error: ${res.status}`);
  return res.json();
}

// Tenta extrair o array de leilões de qualquer formato de resposta da API
function extractAuctions(raw: unknown): RemateAuction[] {
  if (!raw) return [];
  // Array direto
  if (Array.isArray(raw)) return raw as RemateAuction[];
  if (typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  // Tenta campos conhecidos em ordem de probabilidade
  for (const key of ['auctions', 'Auctions', 'Items', 'items', 'data', 'Data', 'result', 'Result', 'results', 'Results', 'records', 'Records', 'content', 'Content', 'leiloes', 'leilões', 'Leiloes', 'value', 'Value']) {
    if (Array.isArray(obj[key])) return obj[key] as RemateAuction[];
  }
  // Se for um objeto que envelopa o leilão direto no campo 'auction' ou 'leilao'
  if (obj.auction && typeof obj.auction === 'object') return [obj.auction as RemateAuction];
  if (obj.leilao && typeof obj.leilao === 'object') return [obj.leilao as RemateAuction];
  return [];
}

function extractTotal(raw: unknown, fallback: number): number {
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;
  for (const key of ['quantity', 'Quantity', 'total', 'Total', 'totalCount', 'TotalCount', 'count', 'Count', 'totalItems', 'totalElements', 'total_elements', 'recordsTotal', 'recordsFiltered']) {
    if (typeof obj[key] === 'number') return obj[key] as number;
    if (typeof obj[key] === 'string') {
      const parsed = parseInt(obj[key] as string, 10);
      if (!isNaN(parsed)) return parsed;
    }
  }
  return fallback;
}

export async function fetchAuctions(
  pageIndex = 1,
  pageSize = 100,
  orderBy = 'date',
  sortDirection = 1,
  startDate?: string,
  endDate?: string,
): Promise<{ auctions: RemateAuction[]; quantity: number; _raw?: unknown }> {
  // Envia parâmetros em múltiplos formatos para garantir compatibilidade com qualquer versão da API
  const params: Record<string, string> = {
    // Formato com prefixo vmFields
    'vmFields.pageIndex': String(pageIndex),
    'vmFields.pageSize': String(pageSize),
    'vmFields.orderBy': orderBy,
    'vmFields.sortDirection': String(sortDirection),
    
    // Formato direto camelCase
    'pageIndex': String(pageIndex),
    'pageSize': String(pageSize),
    'orderBy': orderBy,
    'sortDirection': String(sortDirection),

    // Formato direto PascalCase
    'PageIndex': String(pageIndex),
    'PageSize': String(pageSize),
    'OrderBy': orderBy,
    'SortDirection': String(sortDirection),

    // Formato 0-indexed para casos compatíveis com spring/express
    'page': String(pageIndex - 1),
    'size': String(pageSize),
  };

  if (startDate) {
    params['vmFields.startDate'] = startDate;
    params['startDate'] = startDate;
    params['StartDate'] = startDate;
  }
  if (endDate) {
    params['vmFields.endDate'] = endDate;
    params['endDate'] = endDate;
    params['EndDate'] = endDate;
  }

  const raw = await apiGet<unknown>('/api/auction', params);
  const auctions = extractAuctions(raw);
  const quantity = extractTotal(raw, auctions.length);
  return { auctions, quantity, _raw: raw };
}

// Busca todas as páginas automaticamente
export async function fetchAllAuctions(
  orderBy = 'date',
  sortDirection = 1,
  startDate?: string,
  endDate?: string,
): Promise<{ auctions: RemateAuction[]; quantity: number; _raw?: unknown }> {
  const pageSize = 200;
  const first = await fetchAuctions(1, pageSize, orderBy, sortDirection, startDate, endDate);
  const total = first.quantity;
  if (total <= pageSize || first.auctions.length === 0) return first;
  // Busca páginas restantes em paralelo
  const totalPages = Math.ceil(total / pageSize);
  const pagePromises = Array.from({ length: totalPages - 1 }, (_, i) =>
    fetchAuctions(i + 2, pageSize, orderBy, sortDirection, startDate, endDate)
      .then(r => r.auctions)
      .catch(() => [] as RemateAuction[])
  );
  const rest = await Promise.all(pagePromises);
  return {
    auctions: [...first.auctions, ...rest.flat()],
    quantity: total,
    _raw: first._raw,
  };
}

export async function fetchAuctionById(id: number): Promise<RemateAuction> {
  return apiGet(`/api/auction/${id}`);
}

export async function fetchStudios(): Promise<{ id: number; name: string }[]> {
  return apiGet('/api/studio/all');
}

export async function fetchChannels(): Promise<{ channels: { id: number; name: string }[] }> {
  return apiGet('/api/channel', {
    'vmFields.pageIndex': '1',
    'vmFields.pageSize': '100',
    'pageIndex': '1',
    'pageSize': '100',
    'PageIndex': '1',
    'PageSize': '100',
  });
}

export function parseRobustDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? new Date() : val;
  }
  if (typeof val === 'object' && val !== null) {
    if ('toDate' in val && typeof (val as any).toDate === 'function') {
      const d = (val as any).toDate();
      return isNaN(d.getTime()) ? new Date() : d;
    }
    if ('seconds' in val) {
      const d = new Date((val as any).seconds * 1000);
      return isNaN(d.getTime()) ? new Date() : d;
    }
  }
  if (typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  if (typeof val === 'string') {
    let clean = val.trim();
    if (clean.includes(' ')) {
      clean = clean.replace(' ', 'T');
    }
    const ts = Date.parse(clean);
    if (!isNaN(ts)) {
      return new Date(ts);
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}
