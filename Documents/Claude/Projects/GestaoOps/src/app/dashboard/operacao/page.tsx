'use client';

import { useEffect, useState, useCallback } from 'react';
import { getEvents } from '@/services/events';
import { GestaoEvent, OPERATION_TYPE_LABELS, OPERATION_TYPE_BADGE, eventStatusBadge } from '@/types/event';
import { format, parseISO, isToday, isTomorrow, addDays, startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { RefreshCw, Clock, MapPin, Tv, Users, Building2, Radio, Wifi } from 'lucide-react';

type EventWithId = GestaoEvent & { id: string };

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) return (val as { toDate: () => Date }).toDate();
  if (typeof val === 'string') return parseISO(val);
  return new Date();
}

const TYPE_COLOR: Record<string, string> = {
  estudio: '#2F6FED',
  externo: '#9B2D3B',
  retransmissao: '#7C7C78',
};

const TYPE_ICON: Record<string, React.ElementType> = {
  estudio: Building2,
  externo: MapPin,
  retransmissao: Wifi,
};

function isLive(event: EventWithId, now: Date): boolean {
  const start = toDate(event.date);
  const end = event.endDate ? toDate(event.endDate) : addDays(start, 1);
  return now >= start && now <= end;
}

export default function OperacaoPage() {
  const [events, setEvents] = useState<EventWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowEnd = endOfDay(addDays(now, 1));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getEvents();
      const relevant = all.filter((e) => {
        const d = toDate(e.date);
        return isWithinInterval(d, { start: todayStart, end: tomorrowEnd });
      }).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
      setEvents(relevant);
      setLastRefresh(new Date());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh a cada 2 minutos
  useEffect(() => {
    const timer = setInterval(() => loadData(), 120000);
    return () => clearInterval(timer);
  }, [loadData]);

  const liveEvents = events.filter((e) => isLive(e, now));
  const todayEvents = events.filter((e) => isToday(toDate(e.date)));
  const tomorrowEvents = events.filter((e) => isTomorrow(toDate(e.date)));

  function EventCard({ event, live }: { event: EventWithId; live?: boolean }) {
    const evDate = toDate(event.date);
    const evEnd = event.endDate ? toDate(event.endDate) : null;
    const color = TYPE_COLOR[event.operationType || 'externo'] || 'var(--text-muted)';
    const Icon = TYPE_ICON[event.operationType || 'externo'] || MapPin;
    const status = eventStatusBadge(event);
    const team = (event.assignments || []).filter((a) => a.status !== 'cancelado');

    return (
      <div className="card animate-in" style={{ borderLeft: `4px solid ${color}`, position: 'relative', overflow: 'hidden' }}>
        {live && (
          <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--error)', color: '#fff', borderRadius: '100px', padding: '3px 10px', fontSize: '11px', fontWeight: 700 }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fff', animation: 'pulse 1.4s ease-in-out infinite' }} />
            AO VIVO
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px', paddingRight: live ? '90px' : '0' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-md)', background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon size={18} style={{ color }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '4px' }}>{event.title}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '12.5px', color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={12} />
                {format(evDate, "HH:mm", { locale: ptBR })}
                {evEnd ? ` → ${format(evEnd, "HH:mm", { locale: ptBR })}` : ''}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <MapPin size={12} /> {event.city || 'N/D'}{event.state ? `, ${event.state}` : ''}
              </span>
              {event.channelName && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Tv size={12} /> {event.channelName}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Users size={12} />
            </span>
            {team.length === 0 ? (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Sem equipe escalada</span>
            ) : (
              team.map((a) => (
                <span key={a.operatorId} className="badge" style={{ fontSize: '11.5px' }}>
                  {(a.operatorName || '').split(' ')[0]}
                  {a.status === 'pendente' && ' ⏳'}
                  {a.role ? ` · ${a.role}` : ''}
                </span>
              ))
            )}
          </div>
          <span className={`badge ${status.cls}`} style={{ fontSize: '11px' }}>{status.label}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>

      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            Operação ao Vivo
            {liveEvents.length > 0 && (
              <span style={{ fontSize: '13px', fontWeight: 400, background: 'var(--error)', color: '#fff', borderRadius: '100px', padding: '2px 10px' }}>
                {liveEvents.length} em transmissão
              </span>
            )}
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Atualizado às {format(lastRefresh, "HH:mm:ss", { locale: ptBR })} · Auto-atualiza a cada 2 min
          </p>
        </div>
        <button className="btn btn-ghost" onClick={loadData} disabled={loading}>
          <RefreshCw size={16} style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }} />
          Atualizar
        </button>
      </div>

      {loading && events.length === 0 ? (
        <div className="skeleton" style={{ height: '300px' }} />
      ) : (
        <>
          {/* Ao Vivo */}
          {liveEvents.length > 0 && (
            <div style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--error)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Radio size={14} /> Ao vivo agora
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
                {liveEvents.map((e) => <EventCard key={e.id} event={e} live />)}
              </div>
            </div>
          )}

          {/* Hoje */}
          {todayEvents.length > 0 && (
            <div style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                Hoje — {format(now, "dd/MM/yyyy", { locale: ptBR })}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
                {todayEvents.map((e) => <EventCard key={e.id} event={e} live={isLive(e, now)} />)}
              </div>
            </div>
          )}

          {/* Amanhã */}
          {tomorrowEvents.length > 0 && (
            <div>
              <h2 style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                Amanhã — {format(addDays(now, 1), "dd/MM/yyyy", { locale: ptBR })}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
                {tomorrowEvents.map((e) => <EventCard key={e.id} event={e} />)}
              </div>
            </div>
          )}

          {events.length === 0 && !loading && (
            <div className="empty-state card" style={{ padding: '48px' }}>
              <Radio size={40} style={{ opacity: 0.2, marginBottom: '12px' }} />
              <h3>Nenhum evento nas próximas 24h</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Todos os eventos de hoje e amanhã aparecerão aqui.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
