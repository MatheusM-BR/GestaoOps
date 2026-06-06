'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { getEvents } from '@/services/events';
import { GestaoEvent } from '@/types/event';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, addMonths, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Users, Clock, Building2, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useAuth, isOperatorRole } from '@/lib/auth-context';

type EventWithId = GestaoEvent & { id: string };

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) return (val as { toDate: () => Date }).toDate();
  if (typeof val === 'string') return parseISO(val);
  return new Date();
}

function studioLabel(e: EventWithId): string {
  if (e.studioName) return e.studioName;
  if (e.operationType === 'estudio') return 'Estúdio';
  if (e.operationType === 'retransmissao') return 'Retransmissão';
  return e.city || 'Externo';
}

export default function CalendarioPage() {
  const { profile } = useAuth();
  // Operadores comuns veem os leilões (tipo/estúdio) mas NÃO as pessoas escaladas.
  const canViewTeam = !!profile && (profile.role === 'operador_painel' || !isOperatorRole(profile.role));
  const [events, setEvents] = useState<EventWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [filterType, setFilterType] = useState<'all' | 'estudio' | 'externo' | 'retransmissao'>('all');
  const [selectedDay, setSelectedDay] = useState<Date | null>(new Date());

  const loadData = useCallback(async () => {
    try {
      const evts = await getEvents().catch(() => []);
      setEvents(evts);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = getDay(monthStart);

  const visibleEvents = useMemo(
    () => events.filter((e) => filterType === 'all' || e.operationType === filterType),
    [events, filterType],
  );

  const getEventsForDay = useCallback(
    (day: Date) =>
      visibleEvents
        .filter((e) => isSameDay(toDate(e.date), day))
        .sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime()),
    [visibleEvents],
  );

  const monthCount = visibleEvents.filter((e) => {
    const d = toDate(e.date);
    return d >= monthStart && d <= monthEnd;
  }).length;

  if (loading) return <div className="skeleton" style={{ height: '600px' }} />;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1>Calendário de Leilões</h1>
          <p>{monthCount} leilão(ões) em {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <select className="input" value={filterType} onChange={(e) => setFilterType(e.target.value as 'all' | 'estudio' | 'externo' | 'retransmissao')} style={{ width: 'auto' }}>
            <option value="all">Todos os tipos</option>
            <option value="estudio">Estúdio</option>
            <option value="externo">Externo</option>
            <option value="retransmissao">Retransmissão</option>
          </select>
        </div>
      </div>

      <div className="card">
        {/* Month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <button className="btn btn-ghost btn-icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
            <ChevronLeft size={20} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h3 style={{ fontSize: '18px', textTransform: 'capitalize' }}>
              {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
            </h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setCurrentMonth(new Date())}>Hoje</button>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--accent)' }} /> Estúdio
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--primary)' }} /> Externo
          </span>
          {canViewTeam && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
              <Users size={13} /> nº de pessoas escaladas
            </span>
          )}
        </div>

        {/* Weekday headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', padding: '6px 0' }}>{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
          {Array.from({ length: startDayOfWeek }).map((_, i) => (
            <div key={`e-${i}`} className="calendar-day-cell" style={{ border: 'none', background: 'transparent' }} />
          ))}
          {days.map((day) => {
            const dayEvents = getEventsForDay(day);
            const isToday = isSameDay(day, new Date());
            const isSelected = selectedDay && isSameDay(day, selectedDay);

            return (
              <div
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                className="calendar-day-cell"
                style={{
                  maxHeight: '260px',
                  overflowY: 'auto',
                  background: isSelected
                    ? 'var(--primary-light)'
                    : isToday
                    ? 'var(--bg-surface-elevated)'
                    : 'transparent',
                  border: isSelected
                    ? '2px solid var(--primary)'
                    : isToday
                    ? '1px solid var(--primary)'
                    : '1px solid var(--border)',
                }}
              >
                <div style={{
                  fontSize: '13px',
                  fontWeight: (isToday || isSelected) ? 700 : 500,
                  color: isSelected ? 'var(--primary)' : isToday ? 'var(--primary)' : 'var(--text-primary)',
                  marginBottom: '6px',
                  textAlign: 'center',
                }}>
                  {format(day, 'd')}
                </div>

                {/* Dots indicator for mobile */}
                {dayEvents.length > 0 && (
                  <div className="mobile-dots-indicator" style={{ justifyContent: 'center', gap: '4px', marginTop: '4px' }}>
                    {dayEvents.slice(0, 3).map((evt) => {
                      const isStudio = evt.operationType === 'estudio';
                      return (
                        <span
                          key={evt.id}
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: isStudio ? 'var(--accent)' : 'var(--primary)',
                            display: 'block',
                          }}
                        />
                      );
                    })}
                  </div>
                )}

                <div className="calendar-event-details" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {dayEvents.map((evt) => {
                    const isStudio = evt.operationType === 'estudio';
                    const start = toDate(evt.date);
                    const end = evt.endDate ? toDate(evt.endDate) : null;
                    const people = (evt.assignments || []).length;

                    return (
                      <Link
                        key={evt.id}
                        href={`/dashboard/leiloes/detalhes?id=${evt.id}`}
                        style={{ textDecoration: 'none' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div style={{
                          padding: '6px 7px',
                          borderRadius: 'var(--radius-sm)',
                          background: isStudio ? 'var(--accent-light)' : 'var(--primary-light)',
                          borderLeft: `3px solid ${isStudio ? 'var(--accent)' : 'var(--primary)'}`,
                        }}>
                          {/* Time */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: isStudio ? 'var(--accent)' : 'var(--primary)' }}>
                            <Clock size={10} />
                            {format(start, 'HH:mm')}{end ? `–${format(end, 'HH:mm')}` : ''}
                          </div>

                          {/* Title */}
                          <div style={{
                            fontSize: '11.5px', fontWeight: 600, color: 'var(--text-primary)',
                            margin: '2px 0', lineHeight: 1.25,
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {evt.title.replace(/^LIVE \| /, '')}
                          </div>

                          {/* Studio + people */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: 'var(--text-secondary)', minWidth: 0 }}>
                              {isStudio ? <Building2 size={10} style={{ flexShrink: 0 }} /> : <MapPin size={10} style={{ flexShrink: 0 }} />}
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{studioLabel(evt)}</span>
                            </span>
                            {canViewTeam && (
                              <span style={{
                                display: 'flex', alignItems: 'center', gap: '2px', fontSize: '10px', fontWeight: 700, flexShrink: 0,
                                color: people > 0 ? 'var(--success)' : 'var(--text-muted)',
                              }}>
                                <Users size={10} /> {people}
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile Event List (Visible only on mobile) */}
      {selectedDay && (
        <div className="mobile-only-block" style={{ marginTop: '20px' }}>
          <div className="card">
            <h3 style={{ fontSize: '15px', marginBottom: '12px', textTransform: 'capitalize' }}>
              Leilões de {format(selectedDay, "EEEE, dd 'de' MMMM", { locale: ptBR })}
            </h3>
            {getEventsForDay(selectedDay).length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                Nenhum leilão cadastrado para este dia.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {getEventsForDay(selectedDay).map((evt) => {
                  const isStudio = evt.operationType === 'estudio';
                  const start = toDate(evt.date);
                  const end = evt.endDate ? toDate(evt.endDate) : null;
                  const people = (evt.assignments || []).length;
                  return (
                    <Link
                      key={evt.id}
                      href={`/dashboard/leiloes/detalhes?id=${evt.id}`}
                      style={{ textDecoration: 'none' }}
                    >
                      <div style={{
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-surface-elevated)',
                        borderLeft: `4px solid ${isStudio ? 'var(--accent)' : 'var(--primary)'}`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: isStudio ? 'var(--accent)' : 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={11} /> {format(start, 'HH:mm')}{end ? `–${format(end, 'HH:mm')}` : ''}
                          </span>
                          {canViewTeam && (
                            <span style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px', color: people > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                              <Users size={11} /> {people} escalado(s)
                            </span>
                          )}
                        </div>
                        <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                          {evt.title}
                        </h4>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {isStudio ? <Building2 size={11} /> : <MapPin size={11} />}
                          <span>{studioLabel(evt)}</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
