'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchAllAuctions, fetchAuctionById, RemateAuction, hasValidToken, getToken, parseRobustDate } from '@/services/remateweb-api';
import { getEvents, createEvent, deleteEvent, updateEvent } from '@/services/events';
import { GestaoEvent, OperationType, OPERATION_TYPE_LABELS, OPERATION_TYPE_BADGE } from '@/types/event';
import { getDocument } from '@/lib/firestore';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import CurrencyInput from '@/components/CurrencyInput';
import {
  Plus, Search, Download, Gavel, Clock, MapPin,
  Filter, RefreshCw, AlertCircle, Check, Trash2,
  Tv, ChevronRight, X, Calendar, PlusCircle, RotateCw
} from 'lucide-react';
import { isInternalService } from '@/lib/payment-engine';

function toDate(val: unknown): Date {
  return parseRobustDate(val);
}

export default function EventosPage() {
  const router = useRouter();
  const { profile } = useAuth();
  
  // States
  const [events, setEvents] = useState<(GestaoEvent & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  // Período: vazio por padrão = exibe todos os eventos.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<{ updated: number; skipped: number } | null>(null);

  // API Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [remateAuctions, setRemateAuctions] = useState<RemateAuction[]>([]);
  const [selectedImports, setSelectedImports] = useState<Set<number>>(new Set());
  // Intervalo padrão: 30 dias atrás → fim do ano (cobre eventos passados recentes e futuros)
  const [importStart, setImportStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return format(d, 'yyyy-MM-dd');
  });
  const [importEnd, setImportEnd] = useState(() => format(new Date(new Date().getFullYear(), 11, 31), 'yyyy-MM-dd'));
  const [importError, setImportError] = useState('');
  const [importTotal, setImportTotal] = useState<number | null>(null);
  const [importAlreadyIn, setImportAlreadyIn] = useState(0);
  const [importRawKeys, setImportRawKeys] = useState<string>('');  // debug: chaves da resposta
  const [showAllApiEvents, setShowAllApiEvents] = useState(false); // mostra também já importados
  const [allApiAuctions, setAllApiAuctions] = useState<RemateAuction[]>([]); // todos da API

  // Manual Register Modal
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualEndDate, setManualEndDate] = useState('');
  const [manualOpType, setManualOpType] = useState<OperationType | ''>('');
  const [manualStudio, setManualStudio] = useState('');
  const [manualRevenue, setManualRevenue] = useState(0);
  const [manualChannel, setManualChannel] = useState('');
  const [manualCity, setManualCity] = useState('');
  const [manualState, setManualState] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualService, setManualService] = useState('');
  const [manualLoading, setManualLoading] = useState(false);

  // Db Configs
  const [studios, setStudios] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [evts, studiosDoc, servicesDoc] = await Promise.all([
        getEvents(),
        getDocument<{ list: string[] }>('settings', 'studios').catch(() => null),
        getDocument<{ list: string[] }>('settings', 'services').catch(() => null),
      ]);
      setEvents(evts);
      if (studiosDoc) setStudios(studiosDoc.list || []);
      if (servicesDoc) setServices(servicesDoc.list || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[loadData]', err);
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showToast = (message: string, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Limites do período escolhido (campo vazio = sem limite naquele lado).
  const parseInputDate = (s: string, endOfDay: boolean): Date | null => {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) return null;
    return endOfDay
      ? new Date(y, m - 1, d, 23, 59, 59, 999)
      : new Date(y, m - 1, d, 0, 0, 0, 0);
  };
  const fromLimit = parseInputDate(dateFrom, false);
  const toLimit = parseInputDate(dateTo, true);

  // Filter & Search
  const filtered = events.filter((e) => {
    const start = toDate(e.date);
    // Considera o evento dentro do período enquanto ele estiver em andamento (endDate).
    const effectiveEnd = e.endDate ? toDate(e.endDate) : start;

    const matchPeriod =
      (!fromLimit || effectiveEnd >= fromLimit) &&
      (!toLimit || start <= toLimit);

    const matchSearch =
      !search ||
      e.title?.toLowerCase().includes(search.toLowerCase()) ||
      e.city?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || e.status === filterStatus;
    const matchType = filterType === 'all' || e.operationType === filterType;
    return matchPeriod && matchSearch && matchStatus && matchType;
  });

  // Eventos futuros: os mais próximos de hoje primeiro.
  const sortedEvents = [...filtered].sort(
    (a, b) => toDate(a.date).getTime() - toDate(b.date).getTime()
  );

  const handleFetchFromAPI = async () => {
    setImportLoading(true);
    setImportError('');
    setImportTotal(null);
    setImportAlreadyIn(0);
    setRemateAuctions([]);
    setAllApiAuctions([]);
    setImportRawKeys('');
    try {
      const result = await fetchAllAuctions('date', 1, importStart || undefined, importEnd || undefined);

      // Debug: mostra as chaves da resposta raw
      if (result._raw && typeof result._raw === 'object') {
        setImportRawKeys(Object.keys(result._raw as object).join(', '));
      } else if (Array.isArray(result._raw)) {
        setImportRawKeys('[array direto]');
      }

      const apiAuctions = result.auctions;
      setImportTotal(result.quantity);
      setAllApiAuctions(apiAuctions);

      // IDs já importados no Firestore
      const existingIds = new Set(
        events
          .filter((e) => e.rematewebId != null)
          .map((e) => Number(e.rematewebId))
      );

      // Filtra no cliente pelo período
      const fromTs = importStart ? parseRobustDate(`${importStart}T00:00:00`).getTime() : -Infinity;
      const toTs   = importEnd   ? parseRobustDate(`${importEnd}T23:59:59`).getTime()   : Infinity;

      let alreadyCount = 0;
      const available = apiAuctions.filter((a) => {
        const t = parseRobustDate(a.date).getTime();
        if (!isNaN(t) && (t < fromTs || t > toTs)) return false;
        if (existingIds.has(Number(a.id))) { alreadyCount++; return false; }
        return true;
      });

      setImportAlreadyIn(alreadyCount);
      setRemateAuctions(available);

      if (apiAuctions.length === 0) {
        setImportError('A API retornou 0 leilões. Verifique credenciais ou o período selecionado.');
      } else if (available.length === 0) {
        setImportError(`Todos os ${alreadyCount} leilões do período já foram importados.`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[handleFetchFromAPI]', err);
      setImportError(`Erro ao buscar: ${msg}`);
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportSelected = async () => {
    setImportLoading(true);
    try {
      const selected = remateAuctions.filter((a) => selectedImports.has(a.id));
      for (const auction of selected) {
        await createEvent({
          rematewebId: auction.id,
          title: auction.title,
          date: parseRobustDate(auction.date),
          endDate: parseRobustDate(auction.endDate),
          operationType: null,
          studioId: null,
          studioName: null,
          city: auction.city || '',
          state: auction.state || '',
          place: auction.place || '',
          channelName: auction.channelName || '',
          organizationName: auction.organizationName || '',
          revenue: 0,
          actualRevenue: 0,
          status: 'pendente',
          commercialIntermediary: '',
          contractInfo: '',
          company: '',
          observation: '',
          financialCode: auction.financialCode || '',
          services: [],
          assignments: [],
          expenses: [],
          closing: null,
          needsPlanning: false,
        });
      }
      setShowImportModal(false);
      setSelectedImports(new Set());
      showToast(`${selected.length} leilão(ões) importado(s) com sucesso!`);
      await loadData();
    } catch (err) {
      console.error(err);
      setImportError('Erro ao importar leilões.');
    } finally {
      setImportLoading(false);
    }
  };

  // Manual event creation
  const handleCreateManual = async () => {
    if (!manualTitle || !manualDate || !manualEndDate) {
      showToast('Preencha título, data de início e fim.', 'error');
      return;
    }
    setManualLoading(true);
    try {
      const start = parseRobustDate(manualDate);
      const end = parseRobustDate(manualEndDate);
      
      const isInternal = manualService ? isInternalService(manualService) : (manualOpType === 'estudio');
      const resolvedOpType = isInternal ? 'estudio' : (manualOpType || 'externo');

      const docId = await createEvent({
        rematewebId: null,
        title: manualTitle,
        date: start,
        endDate: end,
        operationType: resolvedOpType as OperationType,
        studioId: isInternal && manualStudio ? manualStudio : null,
        studioName: isInternal && manualStudio ? manualStudio : null,
        city: manualCity || (isInternal ? 'Estúdio' : ''),
        state: manualState || '',
        place: isInternal ? (manualStudio || 'Estúdio Sede') : '',
        channelName: manualChannel || 'RemateWeb',
        organizationName: 'Manual',
        revenue: manualRevenue,
        actualRevenue: 0,
        status: 'pendente',
        commercialIntermediary: '',
        contractInfo: '',
        company: '',
        observation: manualNotes,
        financialCode: '',
        services: manualService ? [{ serviceName: manualService, serviceOrder: 1, eventId: '' }] : [],
        assignments: [],
        expenses: [],
        closing: null,
        needsPlanning: !isInternal, // externos sempre precisam de planejamento
      });

      setShowManualModal(false);
      // Reset form
      setManualTitle('');
      setManualDate('');
      setManualEndDate('');
      setManualOpType('');
      setManualStudio('');
      setManualRevenue(0);
      setManualChannel('');
      setManualCity('');
      setManualState('');
      setManualNotes('');
      setManualService('');
      showToast('Evento criado com sucesso!');
      router.push(`/dashboard/leiloes/detalhes?id=${docId}`);
    } catch (err) {
      console.error(err);
      showToast('Erro ao criar evento.', 'error');
    } finally {
      setManualLoading(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Excluir este evento e todo o seu histórico permanentemente?')) return;
    try {
      await deleteEvent(id);
      showToast('Evento excluído.');
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleImport = (id: number) => {
    const next = new Set(selectedImports);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedImports(next);
  };

  // Determine if role allows modifications
  const canModify = profile?.role === 'admin' || profile?.role === 'ceo' || profile?.role === 'operador_painel';

  // Sincroniza horário de fim de eventos passados com a API RemateWeb
  const handleSyncEndDates = async () => {
    if (!hasValidToken()) {
      showToast('Token da API não encontrado. Configure em Configurações → aba API.', 'error');
      return;
    }
    setSyncLoading(true);
    setSyncResult(null);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Filtra eventos passados que vieram da API (têm rematewebId)
    const pastApiEvents = events.filter((e) => {
      const d = toDate(e.date);
      return e.rematewebId != null && d < today;
    });

    let updated = 0;
    let skipped = 0;

    for (const evt of pastApiEvents) {
      try {
        const apiData = await fetchAuctionById(Number(evt.rematewebId));
        if (!apiData?.endDate) { skipped++; continue; }

        const newEndDate = parseRobustDate(apiData.endDate);
        const currentEnd = evt.endDate ? toDate(evt.endDate) : null;

        // Só atualiza se a data de fim mudou ou estava ausente
        if (currentEnd && Math.abs(newEndDate.getTime() - currentEnd.getTime()) < 60000) {
          skipped++; continue;
        }

        await updateEvent(evt.id, { endDate: newEndDate } as Partial<GestaoEvent>);
        setEvents((prev) => prev.map((e) => e.id === evt.id ? { ...e, endDate: newEndDate } : e));
        updated++;
      } catch {
        skipped++;
      }
    }

    setSyncResult({ updated, skipped });
    setSyncLoading(false);
    if (updated > 0) showToast(`${updated} evento(s) atualizados com horário de fim da API.`);
    else showToast(`Nenhuma alteração necessária (${skipped} já atualizados ou sem dados).`, 'info');
  };

  return (
    <div>
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.message}</div>
        </div>
      )}

      {/* Erro de carregamento do Firestore */}
      {loadError && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '12px',
          padding: '14px 16px', background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)',
          marginBottom: '20px',
        }}>
          <AlertCircle size={18} style={{ color: 'var(--error)', flexShrink: 0, marginTop: '1px' }} />
          <div>
            <p style={{ fontWeight: 600, color: 'var(--error)', fontSize: '14px' }}>Erro ao carregar eventos</p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'monospace' }}>{loadError}</p>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: '8px' }} onClick={loadData}>
              <RefreshCw size={13} /> Tentar novamente
            </button>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1>Eventos e Leilões</h1>
          <p>
            {sortedEvents.length} de {events.length} evento(s)
            {(dateFrom || dateTo) ? ' no período filtrado' : ' no total'}
          </p>
        </div>
        {canModify && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={() => { setShowManualModal(true); }}>
              <PlusCircle size={16} /> Cadastrar Evento
            </button>
            <button
              className="btn btn-ghost"
              onClick={handleSyncEndDates}
              disabled={syncLoading}
              title="Atualiza a data/hora de fim de eventos passados buscando da API RemateWeb"
            >
              {syncLoading
                ? <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />
                : <RotateCw size={16} />
              }
              {syncLoading ? ' Sincronizando...' : ' Sincronizar Encerramento'}
            </button>
            <button className="btn btn-primary" onClick={() => { setShowImportModal(true); handleFetchFromAPI(); }}>
              <Download size={16} /> Importar da API
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="filters-container">
        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Buscar por título, canal ou cidade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '40px' }}
          />
        </div>
        <select className="input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">Todos os Status</option>
          <option value="pendente">Pendente</option>
          <option value="escalado">Escalado</option>
          <option value="em_andamento">Em Andamento</option>
          <option value="finalizado">Finalizado</option>
        </select>
        <select className="input" value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">Todos os Tipos</option>
          <option value="estudio">Estúdio</option>
          <option value="externo">Externo</option>
          <option value="retransmissao">Retransmissão</option>
        </select>
        <div className="date-range-group">
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>De</span>
          <input
            type="date"
            className="input"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ width: 'auto' }}
          />
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>até</span>
          <input
            type="date"
            className="input"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ width: 'auto' }}
          />
          {(dateFrom || dateTo) && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              title="Limpar filtro de data"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" style={{ height: '90px' }} />)}
        </div>
      ) : sortedEvents.length === 0 ? (
        <div className="empty-state card">
          <Gavel size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <h3>Nenhum evento</h3>
          <p>Importe da API RemateWeb ou cadastre manualmente no painel.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sortedEvents.map((evt) => {
            const d = toDate(evt.date);
            return (
              <div
                key={evt.id}
                className="responsive-card-item"
                onClick={() => router.push(`/dashboard/leiloes/detalhes?id=${evt.id}`)}
              >
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', width: '100%' }}>
                  <div className="schedule-date-badge" style={{ flexShrink: 0 }}>
                    <span className="day">{format(d, 'dd')}</span>
                    <span className="month">{format(d, 'MMM', { locale: ptBR })}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {evt.title}
                    </span>
                    <div className="item-meta" style={{ display: 'flex', gap: '14px', marginTop: '4px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={12} /> {format(d, 'HH:mm')}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <MapPin size={12} /> {evt.city || 'N/D'}{evt.state ? `, ${evt.state}` : ''}
                      </span>
                      {evt.channelName && (
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>📺 {evt.channelName}</span>
                      )}
                      {evt.services && evt.services.length > 0 && (
                        <span style={{ fontSize: '12px', color: 'var(--primary)' }}>💼 {evt.services[0].serviceName}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="item-actions">
                  {evt.operationType ? (
                    <span className={`badge ${OPERATION_TYPE_BADGE[evt.operationType]}`}>
                      {OPERATION_TYPE_LABELS[evt.operationType]}
                      {evt.operationType === 'estudio' && evt.studioName ? ` · ${evt.studioName}` : ''}
                    </span>
                  ) : canModify ? (
                    <select
                      className="input"
                      style={{ fontSize: '11px', height: '26px', padding: '2px 6px', width: 'auto', minWidth: '130px' }}
                      defaultValue=""
                      onClick={(e) => e.stopPropagation()}
                      onChange={async (e) => {
                        e.stopPropagation();
                        const type = e.target.value as OperationType;
                        if (!type) return;
                        // Atualiza localmente sem reload da página toda
                        setEvents((prev) =>
                          prev.map((ev) => ev.id === evt.id ? { ...ev, operationType: type } : ev)
                        );
                        await updateEvent(evt.id, { operationType: type } as Partial<GestaoEvent>);
                      }}
                    >
                      <option value="" disabled>⚠ Definir tipo</option>
                      <option value="retransmissao">Retransmissão</option>
                      <option value="estudio">Estúdio</option>
                      <option value="externo">Externo</option>
                    </select>
                  ) : (
                    <span className="badge" style={{ opacity: 0.5, fontSize: '11px' }}>Sem tipo</span>
                  )}
                  <span className={`badge ${
                    evt.status === 'finalizado' ? 'badge-success' :
                    evt.status === 'escalado' ? 'badge-accent' :
                    evt.status === 'em_andamento' ? 'badge-warning' : 'badge-error'
                  }`}>
                    {evt.status}
                  </span>
                  {canModify && (
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={(e) => handleDelete(evt.id, e)}
                      style={{ color: 'var(--error)' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual Creation Modal */}
      {showManualModal && (
        <div className="modal-overlay" onClick={() => setShowManualModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2>Cadastrar Novo Evento</h2>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowManualModal(false)}><X size={16} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group">
                <label>Título do Leilão *</label>
                <input className="input" placeholder="Ex: Leilão de Touros 2026" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} />
              </div>

              <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="input-group">
                  <label>Data & Hora Início *</label>
                  <input className="input" type="datetime-local" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>Data & Hora Fim *</label>
                  <input className="input" type="datetime-local" value={manualEndDate} onChange={(e) => setManualEndDate(e.target.value)} />
                </div>
              </div>

              <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="input-group">
                  <label>Serviço Principal</label>
                  <select className="input" value={manualService} onChange={(e) => {
                    setManualService(e.target.value);
                    const isInt = isInternalService(e.target.value);
                    if (isInt) {
                      setManualOpType('estudio');
                    } else if (e.target.value) {
                      setManualOpType('externo');
                    }
                  }}>
                    <option value="">Selecione...</option>
                    {services.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label>Tipo de Operação</label>
                  <select className="input" value={manualOpType} onChange={(e) => setManualOpType(e.target.value as OperationType)}>
                    <option value="">Selecione...</option>
                    <option value="estudio">Estúdio</option>
                    <option value="externo">Externo</option>
                    <option value="retransmissao">Retransmissão (só painel)</option>
                  </select>
                </div>
              </div>

              {(manualOpType === 'estudio' || isInternalService(manualService)) && (
                <div className="input-group animate-in">
                  <label>Estúdio Designado</label>
                  <select className="input" value={manualStudio} onChange={(e) => setManualStudio(e.target.value)}>
                    <option value="">Selecione o estúdio...</option>
                    {studios.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
              )}

              <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div className="input-group">
                  <label>Receita (R$)</label>
                  <CurrencyInput value={manualRevenue} onChange={setManualRevenue} />
                </div>
                <div className="input-group">
                  <label>Canal de Transmissão</label>
                  <input className="input" placeholder="Ex: Canal do Boi" value={manualChannel} onChange={(e) => setManualChannel(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>Cidade</label>
                  <input className="input" placeholder="Ex: Campo Grande" value={manualCity} onChange={(e) => setManualCity(e.target.value)} />
                </div>
              </div>

              <div className="input-group">
                <label>Observações</label>
                <textarea className="input" rows={3} placeholder="Insira detalhes adicionais aqui..." value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} style={{ resize: 'vertical' }} />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowManualModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreateManual} disabled={manualLoading}>
                {manualLoading ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> : 'Criar e Abrir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Import Modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '740px' }}>
            <div className="modal-header">
              <h2>Importar da API RemateWeb</h2>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowImportModal(false)}><X size={16} /></button>
            </div>

            {/* Status do token */}
            {(() => {
              const tokenOk = hasValidToken();
              const tokenVal = getToken();
              return (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 14px', marginBottom: '14px',
                  borderRadius: 'var(--radius-md)',
                  background: tokenOk ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${tokenOk ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.3)'}`,
                }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: tokenOk ? 'var(--success)' : 'var(--error)', flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', flex: 1 }}>
                    {tokenOk
                      ? <>Token válido · <code style={{ fontSize: '11px', opacity: 0.6 }}>{tokenVal?.slice(0, 20)}…</code></>
                      : <strong style={{ color: 'var(--error)' }}>Token expirado ou ausente — a API retornará dados limitados</strong>
                    }
                  </span>
                  {!tokenOk && (
                    <a href="/dashboard/configuracoes" style={{ fontSize: '12px', color: 'var(--primary)', textDecoration: 'underline', flexShrink: 0 }}>
                      Ir para Configurações → aba API
                    </a>
                  )}
                </div>
              );
            })()}
            {/* Intervalo de busca */}
            <div className="mobile-stack" style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'wrap' }}>
              <div className="input-group" style={{ flex: 1, minWidth: '140px' }}>
                <label>Início</label>
                <input type="date" className="input" value={importStart} max={importEnd || undefined} onChange={(e) => setImportStart(e.target.value)} />
              </div>
              <div className="input-group" style={{ flex: 1, minWidth: '140px' }}>
                <label>Encerramento</label>
                <input type="date" className="input" value={importEnd} min={importStart || undefined} onChange={(e) => setImportEnd(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={handleFetchFromAPI} disabled={importLoading} style={{ flexShrink: 0 }}>
                {importLoading ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> : <><Search size={16} /> Buscar</>}
              </button>
            </div>

            {/* Resumo + debug */}
            {importTotal !== null && !importLoading && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)', flexWrap: 'wrap', marginBottom: '6px' }}>
                  <span>📡 API retornou: <strong>{allApiAuctions.length}</strong> (quantity: {importTotal})</span>
                  {importAlreadyIn > 0 && <span style={{ color: 'var(--warning)' }}>✓ Já importados: <strong>{importAlreadyIn}</strong></span>}
                  {remateAuctions.length > 0 && <span style={{ color: 'var(--success)' }}>🆕 Novos: <strong>{remateAuctions.length}</strong></span>}
                </div>
                {importRawKeys && (
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    Campos da resposta: {importRawKeys}
                  </p>
                )}
              </div>
            )}

            {importError && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                padding: '12px 14px', background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-md)',
                marginBottom: '12px',
              }}>
                <AlertCircle size={16} style={{ color: 'var(--error)', flexShrink: 0, marginTop: '1px' }} />
                <p style={{ fontSize: '13px', color: 'var(--error)' }}>{importError}</p>
              </div>
            )}

            {importLoading && allApiAuctions.length === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                <div className="spinner" />
              </div>
            ) : allApiAuctions.length === 0 && importTotal === null ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                Defina o período e clique em Buscar para consultar a API.
              </p>
            ) : (
              <>
                {/* Toggle mostrar todos / só novos */}
                {allApiAuctions.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className={`btn btn-sm ${!showAllApiEvents ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setShowAllApiEvents(false)}
                      >
                        Novos ({remateAuctions.length})
                      </button>
                      <button
                        className={`btn btn-sm ${showAllApiEvents ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setShowAllApiEvents(true)}
                      >
                        Todos da API ({allApiAuctions.length})
                      </button>
                    </div>
                    {!showAllApiEvents && remateAuctions.length > 0 && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setSelectedImports(new Set(remateAuctions.map((a) => a.id)))}>
                        Selecionar todos
                      </button>
                    )}
                  </div>
                )}

                {/* Lista */}
                <div style={{ maxHeight: '380px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {(showAllApiEvents ? allApiAuctions : remateAuctions).map((auction) => {
                    const alreadyImported = showAllApiEvents && events.some((e) => Number(e.rematewebId) === Number(auction.id));
                    const selected = !alreadyImported && selectedImports.has(auction.id);
                    const dateStr = auction.date ? (() => { try { return format(new Date(auction.date), 'dd/MM/yyyy HH:mm'); } catch { return auction.date; } })() : 'N/D';
                    return (
                      <div
                        key={auction.id}
                        onClick={() => { if (!alreadyImported) toggleImport(auction.id); }}
                        style={{
                          padding: '10px 14px',
                          background: alreadyImported
                            ? 'rgba(100,100,100,0.06)'
                            : selected ? 'var(--primary-light)' : 'var(--bg-surface-elevated)',
                          borderRadius: 'var(--radius-md)',
                          cursor: alreadyImported ? 'default' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          border: selected ? '1px solid var(--primary)' : alreadyImported ? '1px solid rgba(100,100,100,0.15)' : '1px solid transparent',
                          opacity: alreadyImported ? 0.6 : 1,
                          transition: 'all var(--transition-fast)',
                        }}
                      >
                        {!alreadyImported ? (
                          <div style={{
                            width: '18px', height: '18px', borderRadius: '4px', flexShrink: 0,
                            border: selected ? 'none' : '2px solid var(--text-muted)',
                            background: selected ? 'var(--primary)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {selected && <Check size={12} style={{ color: 'white' }} />}
                          </div>
                        ) : (
                          <Check size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{auction.title || '(sem título)'}</p>
                          <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {dateStr} · {auction.city || 'N/D'}{auction.state ? `, ${auction.state}` : ''}
                          </p>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flexShrink: 0 }}>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>ID: {auction.id}</span>
                          {alreadyImported && <span style={{ fontSize: '10px', color: 'var(--success)', fontWeight: 600 }}>✓ importado</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowImportModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleImportSelected} disabled={importLoading || selectedImports.size === 0}>
                {importLoading ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> :
                  <><Download size={16} /> Importar {selectedImports.size} leilão(ões)</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
