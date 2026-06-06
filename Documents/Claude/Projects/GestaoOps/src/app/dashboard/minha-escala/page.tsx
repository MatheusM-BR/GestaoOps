'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getOperatorByUid } from '@/services/operators';
import { getEventsByOperator } from '@/services/events';
import { getCollection } from '@/lib/firestore';
import { Operator } from '@/types/operator';
import { GestaoEvent } from '@/types/event';
import { Holiday } from '@/types/payment';
import { computeFolgaBalance, getTripRoute } from '@/lib/folgas';
import {
  format, parseISO, startOfMonth, endOfMonth,
  eachDayOfInterval, isSameDay, getDay,
  addMonths, subMonths, isAfter, isBefore, addDays,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Clock, MapPin, Tv, Calendar, Users, Building2, Car } from 'lucide-react';

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) return (val as { toDate: () => Date }).toDate();
  if (typeof val === 'string') return parseISO(val);
  return new Date();
}

export default function MinhaEscalaPage() {
  const { user } = useAuth();
  const [operator, setOperator] = useState<(Operator & { id: string }) | null>(null);
  const [events, setEvents] = useState<(GestaoEvent & { id: string })[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(new Date());

  useEffect(() => {
    async function load() {
      if (!user) return;
      try {
        const op = await getOperatorByUid(user.uid);
        setOperator(op);
        if (op) {
          const [evts, hols] = await Promise.all([
            getEventsByOperator(op.id),
            getCollection<Holiday>('holidays').catch(() => [] as Holiday[]),
          ]);
          setEvents(evts);
          setHolidays(hols as Holiday[]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  const folgaInfo = operator
    ? computeFolgaBalance(operator, events, holidays)
    : { holidayFolgas: 0, travelFolgas: 0, total: 0, trips: [] };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = getDay(monthStart);

  const getEventsAndTripsForDay = (day: Date) => {
    const dayEvents = events.filter((e) => isSameDay(toDate(e.date), day));
    if (dayEvents.length > 0) return dayEvents;

    const trip = folgaInfo.trips.find((t) => {
      const dTime = startOfDay(day).getTime();
      return dTime >= startOfDay(t.start).getTime() && dTime <= startOfDay(t.end).getTime();
    });

    if (trip && trip.eventIds.length > 0) {
      const associatedEvt = events.find((e) => e.id === trip.eventIds[0]);
      return [{
        id: `trip-${trip.eventIds[0]}-${day.getTime()}`,
        title: associatedEvt?.title || 'Leilão Externo',
        date: day,
        isTrip: true,
        operationType: 'externo'
      } as any];
    }
    return [];
  };

  function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  const getEventsForDay = (day: Date) => getEventsAndTripsForDay(day);
  const selectedEvents = selectedDay ? events.filter((e) => isSameDay(toDate(e.date), selectedDay)) : [];

  const selectedDayTrip = selectedDay ? folgaInfo.trips.find((t) => {
    const dTime = startOfDay(selectedDay).getTime();
    return dTime >= startOfDay(t.start).getTime() && dTime <= startOfDay(t.end).getTime();
  }) : null;

  const associatedEvent = selectedDayTrip ? events.find((e) => e.id === selectedDayTrip.eventIds[0]) : null;

  // Upcoming events (today + future, sorted, max 8)
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcomingEvents = events
    .filter((e) => {
      const d = toDate(e.date);
      return isAfter(d, addDays(today, -1));
    })
    .sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())
    .slice(0, 8);

  // Stats
  const monthEvents = events.filter((e) => {
    const d = toDate(e.date);
    return d >= monthStart && d <= monthEnd;
  });

  if (loading) return <div className="skeleton" style={{ height: '500px' }} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Minha Escala</h1>
          <p>{monthEvents.length} serviço(s) em {format(currentMonth, 'MMMM yyyy', { locale: ptBR })} · {upcomingEvents.length} próximo(s)</p>
        </div>
      </div>

      <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px' }}>
        {/* Calendar */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
              <ChevronLeft size={18} />
            </button>
            <h3 style={{ fontSize: '16px', textTransform: 'capitalize' }}>
              {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
            </h3>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Week headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px' }}>
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
              <div key={d} style={{ textAlign: 'center', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', padding: '8px 0' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px' }}>
            {/* Empty offset cells */}
            {Array.from({ length: startDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} style={{ minHeight: '80px' }} />
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
                    fontWeight: isToday ? 700 : 400,
                    color: isToday ? 'var(--primary)' : 'var(--text-primary)',
                    marginBottom: '4px',
                  }}>
                    {format(day, 'd')}
                  </div>

                  {dayEvents.slice(0, 2).map((evt) => {
                    const isTrip = 'isTrip' in evt && evt.isTrip;
                    return (
                      <div
                        key={evt.id}
                        className="calendar-event-badge"
                        style={{
                          background: isTrip ? 'rgba(99,102,241,0.15)' : 'var(--success-bg, rgba(22,163,74,0.15))',
                          color: isTrip ? 'var(--primary)' : 'var(--success)',
                        }}
                      >
                        {isTrip ? '🚗 ' : `${format(toDate(evt.date), 'HH:mm')} `}
                        {evt.title.replace(/^LIVE \| /, '').slice(0, 16)}
                      </div>
                    );
                  })}
                  {dayEvents.length > 2 && (
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>+{dayEvents.length - 2}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar: Day detail + Upcoming */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Selected Day Detail */}
          <div className="card">
            <h3 style={{ fontSize: '15px', marginBottom: '4px', textTransform: 'capitalize' }}>
              {selectedDay ? format(selectedDay, "EEEE", { locale: ptBR }) : 'Selecione um dia'}
            </h3>
            {selectedDay && (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                {format(selectedDay, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </p>
            )}

            {!selectedDay ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Clique em um dia no calendário.</p>
            ) : (selectedEvents.length === 0 && !selectedDayTrip) ? (
              <div style={{ padding: '20px', textAlign: 'center' }}>
                <Calendar size={32} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: '8px' }} />
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Sem serviços neste dia</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {selectedDayTrip && selectedEvents.length === 0 && (
                  <div style={{
                    padding: '14px',
                    background: 'rgba(99,102,241,0.08)',
                    borderRadius: 'var(--radius-md)',
                    borderLeft: '3px solid var(--primary)',
                  }}>
                    <h4 style={{ fontSize: '13px', marginBottom: '8px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Car size={14} style={{ color: 'var(--primary)' }} /> Viagem a Serviço
                    </h4>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Você está em trânsito/deslocamento para o evento:
                    </p>
                    <p style={{ fontSize: '12px', fontWeight: 600, marginTop: '4px', color: 'var(--text-primary)' }}>
                      {associatedEvent?.title || 'Leilão Externo'}
                    </p>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Ida: {format(selectedDayTrip.start, 'dd/MM/yyyy')} · Volta: {format(selectedDayTrip.end, 'dd/MM/yyyy')}
                    </p>
                    <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Roteiro de Deslocamento:</span>
                      <span style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 600 }}>
                        {getTripRoute(selectedDayTrip, events, operator?.homeCity)}
                      </span>
                    </div>
                  </div>
                )}
                {selectedEvents.map((evt) => {
                  const d = toDate(evt.date);
                  const end = evt.endDate ? toDate(evt.endDate) : null;
                  const myAssignment = (evt.assignments || []).find((a) => a.operatorId === operator?.id);
                  const colleagues = (evt.assignments || [])
                    .filter((a) => a.operatorId !== operator?.id)
                    .map((a) => a.operatorName?.split(' ')[0] || 'Colega');

                  return (
                    <div key={evt.id} style={{
                      padding: '14px',
                      background: 'var(--bg-surface-elevated)',
                      borderRadius: 'var(--radius-md)',
                      borderLeft: '3px solid var(--primary)',
                    }}>
                      <h4 style={{ fontSize: '13px', marginBottom: '8px', color: 'var(--text-primary)' }}>
                        {evt.studioName && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{evt.studioName} · </span>}
                        {evt.title}
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={11} /> {format(d, 'HH:mm')}
                          {end && <> — {format(end, 'HH:mm')}</>}
                        </span>
                        {evt.studioName && (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Building2 size={11} /> {evt.studioName}
                          </span>
                        )}
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <MapPin size={11} /> {evt.city || evt.place || 'N/D'}{evt.state ? `, ${evt.state}` : ''}
                        </span>
                        {evt.channelName && (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Tv size={11} /> {evt.channelName}
                          </span>
                        )}
                      </div>

                      {/* My role */}
                      {myAssignment && (() => {
                        let dep = myAssignment.departureDate;
                        let ret = myAssignment.returnDate;
                        if (!dep && myAssignment.travelDaysBefore > 0) {
                          const evStart = toDate(evt.date);
                          const d = new Date(evStart);
                          d.setDate(d.getDate() - myAssignment.travelDaysBefore);
                          dep = d;
                        }
                        if (!ret && myAssignment.travelDaysAfter > 0) {
                          const evEnd = evt.endDate ? toDate(evt.endDate) : toDate(evt.date);
                          const d = new Date(evEnd);
                          d.setDate(d.getDate() + myAssignment.travelDaysAfter);
                          ret = d;
                        }
                        return (
                          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div>
                              <span className="badge badge-primary" style={{ fontSize: '10px' }}>
                                Minha função: {myAssignment.role}
                              </span>
                            </div>
                            {(dep || ret) && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div>
                                  <span className="badge badge-accent" style={{ fontSize: '10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }} title="Período de Viagem">
                                    <Car size={10} style={{ verticalAlign: 'middle' }} />{' '}
                                    Ida: {dep ? format(toDate(dep), 'dd/MM/yyyy') : '?'} · Volta: {ret ? format(toDate(ret), 'dd/MM/yyyy') : '?'}
                                  </span>
                                </div>
                                {(() => {
                                  const eventTrip = folgaInfo.trips.find((t) => t.eventIds.includes(evt.id));
                                  if (eventTrip) {
                                    return (
                                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '2px', alignItems: 'center', marginTop: '2px' }}>
                                        <span style={{ fontWeight: 600 }}>Deslocamento:</span>{' '}
                                        <span style={{ color: 'var(--primary)', fontWeight: 500 }}>
                                          {getTripRoute(eventTrip, events, operator?.homeCity)}
                                        </span>
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Services */}
                      {evt.services && evt.services.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                          {evt.services.map((s, i) => (
                            <span key={i} className="badge badge-info" style={{ fontSize: '9px' }}>{s.serviceName}</span>
                          ))}
                        </div>
                      )}

                      {/* Colleagues */}
                      {colleagues.length > 0 && (
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Users size={11} /> Com: {colleagues.join(', ')}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Upcoming Events */}
          <div className="card">
            <h3 style={{ fontSize: '15px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Calendar size={16} /> Próximos Eventos
            </h3>

            {upcomingEvents.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>
                Sem eventos agendados
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {upcomingEvents.map((evt) => {
                  const d = toDate(evt.date);
                  const isEventToday = isSameDay(d, new Date());
                  const myAssignment = (evt.assignments || []).find((a) => a.operatorId === operator?.id);
                  let dep = myAssignment?.departureDate;
                  let ret = myAssignment?.returnDate;
                  if (myAssignment && !dep && myAssignment.travelDaysBefore > 0) {
                    const evStart = toDate(evt.date);
                    const dateObj = new Date(evStart);
                    dateObj.setDate(dateObj.getDate() - myAssignment.travelDaysBefore);
                    dep = dateObj;
                  }
                  if (myAssignment && !ret && myAssignment.travelDaysAfter > 0) {
                    const evEnd = evt.endDate ? toDate(evt.endDate) : toDate(evt.date);
                    const dateObj = new Date(evEnd);
                    dateObj.setDate(dateObj.getDate() + myAssignment.travelDaysAfter);
                    ret = dateObj;
                  }

                  return (
                    <div
                      key={evt.id}
                      onClick={() => {
                        setSelectedDay(d);
                        setCurrentMonth(startOfMonth(d));
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 12px',
                        background: isEventToday ? 'var(--primary-light)' : 'var(--bg-surface-elevated)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        transition: 'all var(--transition-fast)',
                        borderLeft: isEventToday ? '3px solid var(--primary)' : '3px solid transparent',
                      }}
                    >
                      {/* Date badge */}
                      <div style={{
                        textAlign: 'center', minWidth: '40px', flexShrink: 0,
                      }}>
                        <p style={{ fontSize: '16px', fontWeight: 700, color: isEventToday ? 'var(--primary)' : 'var(--text-primary)', lineHeight: 1 }}>
                          {format(d, 'dd')}
                        </p>
                        <p style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                          {format(d, 'MMM', { locale: ptBR })}
                        </p>
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontSize: '12px', fontWeight: 600,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          color: 'var(--text-primary)',
                        }}>
                          {evt.title.replace(/^LIVE \| /, '').slice(0, 30)}
                        </p>
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {format(d, 'HH:mm')} · {evt.city || 'N/D'}
                        </p>
                        {(dep || ret) && (
                          <p style={{ fontSize: '10px', color: 'var(--accent)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Car size={10} /> Viagem: {dep ? format(toDate(dep), 'dd/MM') : '?'} → {ret ? format(toDate(ret), 'dd/MM') : '?'}
                          </p>
                        )}
                      </div>

                      {isEventToday && (
                        <span className="badge badge-primary" style={{ fontSize: '9px', flexShrink: 0 }}>HOJE</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
