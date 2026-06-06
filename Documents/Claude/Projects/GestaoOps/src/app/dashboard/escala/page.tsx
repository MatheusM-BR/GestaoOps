'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { getEvents, assignOperator, removeAssignment } from '@/services/events';
import { getActiveOperators } from '@/services/operators';
import { getDocument, getCollection } from '@/lib/firestore';
import { GestaoEvent, EventAssignment, OPERATION_TYPE_LABELS, OPERATION_TYPE_BADGE } from '@/types/event';
import { Operator, isOperatorRestDay } from '@/types/operator';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, addMonths, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Users, MapPin, Tv, UserCheck, AlertTriangle, CalendarDays, GripVertical, X, Hand, Info, Monitor, Clock } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

type EventWithId = GestaoEvent & { id: string };
type OperatorWithId = Operator & { id: string };
type DragPayload = { operatorId: string; operatorName: string; fromEventId: string | null };

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) return (val as { toDate: () => Date }).toDate();
  if (typeof val === 'string') return parseISO(val);
  return new Date();
}

function firstName(name?: string) {
  return (name || '?').split(' ').slice(0, 2).join(' ');
}

export default function EscalaPage() {
  const { profile } = useAuth();
  const [events, setEvents] = useState<EventWithId[]>([]);
  const [operators, setOperators] = useState<OperatorWithId[]>([]);
  const [holidays, setHolidays] = useState<{ date: string }[]>([]);
  const [roles, setRoles] = useState<string[]>(['Diretor', 'DTV', 'vMix', 'Apoio']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);

  // Interaction state for the board
  const [boardRole, setBoardRole] = useState<string>('');
  const [dragOverEventId, setDragOverEventId] = useState<string | null>(null);
  const [dragOverPool, setDragOverPool] = useState(false);
  // Tap-to-assign fallback (touch friendly)
  const [picked, setPicked] = useState<DragPayload | null>(null);

  const canEdit = useMemo(() => {
    const r = profile?.role;
    return r === 'admin' || r === 'ceo' || r === 'operador_painel' || r === 'administrativo' || r === 'gestor';
  }, [profile]);

  const showToast = (message: string, type: string = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2800);
  };

  const loadData = useCallback(async () => {
    try {
      const [evts, ops, rolesDoc, hols] = await Promise.all([
        getEvents().catch(() => []),
        getActiveOperators().catch(() => []),
        getDocument<{ list: string[] }>('settings', 'roles').catch(() => null),
        getCollection<{ date: string }>('holidays').catch(() => []),
      ]);
      setEvents(evts);
      setOperators(ops);
      setHolidays(hols);
      if (rolesDoc && Array.isArray(rolesDoc.list) && rolesDoc.list.length > 0) {
        setRoles(rolesDoc.list);
        setBoardRole((prev) => prev || rolesDoc.list[0]);
      } else {
        setBoardRole((prev) => prev || 'Diretor');
      }
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

  const eventsWithTeam = events.filter((e) => (e.assignments || []).length > 0);
  const getEventsForDay = (day: Date) => eventsWithTeam.filter((e) => isSameDay(toDate(e.date), day));
  const getAllEventsForDay = (day: Date) => events.filter((e) => isSameDay(toDate(e.date), day));

  const monthEventsWithTeam = eventsWithTeam.filter((e) => {
    const d = toDate(e.date);
    return d >= monthStart && d <= monthEnd;
  });

  // Retransmissão é só painel (sobe sinal) — não precisa escalar equipe, então fica fora do quadro.
  const needsCrew = (e: EventWithId) => e.operationType !== 'retransmissao';

  // ----- Board data (selected day) -----
  const dayEvents = useMemo(
    () => getAllEventsForDay(selectedDay).filter(needsCrew).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime()),
    [events, selectedDay], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Quantos leilões cada operador já tem no dia selecionado (para anotação — multi-leilão é permitido).
  const todayCount = useMemo(() => {
    const m = new Map<string, number>();
    dayEvents.forEach((e) => (e.assignments || []).forEach((a) => m.set(a.operatorId, (m.get(a.operatorId) || 0) + 1)));
    return m;
  }, [dayEvents]);

  // Operadores de transmissão: exclui quem tem função de painel (eles têm aba própria).
  // Um operador pode fazer mais de um leilão no dia — duplicidade no MESMO leilão impedida em assign().
  const availableOperators = operators.filter(
    (o) => !(o.functions || []).includes('operador_painel') && o.role !== 'operador_painel',
  );

  // ----- Mutations -----
  const assign = async (event: EventWithId, op: { id: string; name: string }, role: string) => {
    if ((event.assignments || []).some((a) => a.operatorId === op.id)) return;
    const fullOp = operators.find((o) => o.id === op.id);
    const onRestDay = !!fullOp && isOperatorRestDay(fullOp, toDate(event.date));
    const assignment: EventAssignment = {
      eventId: event.id,
      operatorId: op.id,
      operatorName: op.name,
      role: role || boardRole || 'Operador',
      travelDaysBefore: 0,
      travelDaysAfter: 0,
      departureDate: null,
      returnDate: null,
      status: 'confirmado',
      onRestDay,
    };
    // optimistic
    setEvents((prev) => prev.map((e) => e.id === event.id
      ? { ...e, assignments: [...(e.assignments || []), assignment], status: 'escalado' }
      : e));
    setSaving(true);
    try {
      await assignOperator(event.id, assignment);
      showToast(
        onRestDay ? `${firstName(op.name)} escalado(a) em FOLGA — gera valor extra` : `${firstName(op.name)} escalado(a)`,
        onRestDay ? 'warning' : 'success',
      );
    } catch (err) {
      console.error(err);
      showToast('Erro ao escalar. Recarregando…', 'error');
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const unassign = async (eventId: string, operatorId: string) => {
    setEvents((prev) => prev.map((e) => {
      if (e.id !== eventId) return e;
      const assignments = (e.assignments || []).filter((a) => a.operatorId !== operatorId);
      return { ...e, assignments, status: assignments.length > 0 ? 'escalado' : 'pendente' };
    }));
    setSaving(true);
    try {
      await removeAssignment(eventId, operatorId);
    } catch (err) {
      console.error(err);
      showToast('Erro ao remover. Recarregando…', 'error');
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const assignPanelBatch = async (
    opId: string,
    shift: 'primeiro' | 'segundo',
    targetEvents: EventWithId[],
    withHalfShift: boolean,
    shiftTime: string,
  ) => {
    const op = operators.find((o) => o.id === opId);
    if (!op) return;
    setSaving(true);
    try {
      for (const evt of targetEvents) {
        // Remove qualquer operador de painel já existente no leilão para evitar duplo faturamento.
        const existingPanel = (evt.assignments || []).find(
          (a) => a.role === 'Operador de Painel' ||
            operators.find((o) => o.id === a.operatorId)?.functions?.includes('operador_painel'),
        );
        if (existingPanel) {
          if (existingPanel.operatorId === opId) continue; // mesmo operador, nada a fazer
          // Remove o anterior antes de inserir o novo
          setEvents((prev) => prev.map((e) => e.id === evt.id
            ? { ...e, assignments: (e.assignments || []).filter((a) => a.operatorId !== existingPanel.operatorId) }
            : e,
          ));
          await removeAssignment(evt.id, existingPanel.operatorId);
        }

        const onRestDay = isOperatorRestDay(op, toDate(evt.date));
        const assignment: EventAssignment = {
          eventId: evt.id,
          operatorId: opId,
          operatorName: op.name,
          role: 'Operador de Painel',
          travelDaysBefore: 0,
          travelDaysAfter: 0,
          departureDate: null,
          returnDate: null,
          status: 'confirmado',
          isHalfShift: withHalfShift,
          onRestDay,
        };
        if (withHalfShift) {
          assignment.halfShiftType = shift;
          assignment.shiftTime = shiftTime;
        }
        setEvents((prev) => prev.map((e) => e.id === evt.id
          ? { ...e, assignments: [...(e.assignments || []), assignment], status: 'escalado' }
          : e,
        ));
        await assignOperator(evt.id, assignment);
      }
      showToast(`Operador de Painel escalado em ${targetEvents.length} leilão(ões)!`);
    } catch (err) {
      console.error(err);
      showToast('Erro ao escalar. Recarregando…', 'error');
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const move = async (fromEventId: string, toEvent: EventWithId, op: { id: string; name: string }, role: string) => {
    if (fromEventId === toEvent.id) return;
    await unassign(fromEventId, op.id);
    await assign(toEvent, op, role);
  };

  const changeRole = async (event: EventWithId, operatorId: string, operatorName: string, newRole: string) => {
    const current = (event.assignments || []).find((a) => a.operatorId === operatorId);
    if (!current || current.role === newRole) return;
    setEvents((prev) => prev.map((e) => e.id === event.id
      ? { ...e, assignments: (e.assignments || []).map((a) => a.operatorId === operatorId ? { ...a, role: newRole } : a) }
      : e));
    setSaving(true);
    try {
      await removeAssignment(event.id, operatorId);
      await assignOperator(event.id, { ...current, role: newRole, operatorName } as EventAssignment);
    } catch (err) {
      console.error(err);
      showToast('Erro ao trocar função. Recarregando…', 'error');
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  // Resolve a drop / tap onto a target event
  const applyToEvent = (payload: DragPayload, target: EventWithId) => {
    const op = { id: payload.operatorId, name: payload.operatorName };
    if (payload.fromEventId && payload.fromEventId !== target.id) {
      move(payload.fromEventId, target, op, boardRole);
    } else if (!payload.fromEventId) {
      assign(target, op, boardRole);
    }
  };

  // ----- Drag handlers -----
  const onDragStart = (e: React.DragEvent, payload: DragPayload) => {
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };
  const readPayload = (e: React.DragEvent): DragPayload | null => {
    try { return JSON.parse(e.dataTransfer.getData('application/json')); } catch { return null; }
  };

  if (loading) return <div className="skeleton" style={{ height: '600px' }} />;

  return (
    <div>
      {toast && <div className="toast-container"><div className={`toast toast-${toast.type}`}>{toast.message}</div></div>}

      <div className="page-header">
        <div>
          <h1>Escala</h1>
          <p>{monthEventsWithTeam.length} evento(s) com equipe em {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</p>
        </div>
      </div>

      <BoardView
        selectedDay={selectedDay}
        setSelectedDay={setSelectedDay}
        currentMonth={currentMonth}
        setCurrentMonth={setCurrentMonth}
        days={days}
        startDayOfWeek={startDayOfWeek}
        dayCount={(d) => getAllEventsForDay(d).filter(needsCrew).length}
        dayEvents={dayEvents}
        allDayEvents={getAllEventsForDay(selectedDay).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())}
        getEventsForDay={getEventsForDay}
        operators={operators}
        availableOperators={availableOperators}
        todayCount={todayCount}
        roles={roles}
        boardRole={boardRole}
        setBoardRole={setBoardRole}
        canEdit={canEdit}
        saving={saving}
        picked={picked}
        setPicked={setPicked}
        dragOverEventId={dragOverEventId}
        setDragOverEventId={setDragOverEventId}
        dragOverPool={dragOverPool}
        setDragOverPool={setDragOverPool}
        onDragStart={onDragStart}
        readPayload={readPayload}
        applyToEvent={applyToEvent}
        unassign={unassign}
        changeRole={changeRole}
        assignPanelBatch={assignPanelBatch}
        holidays={holidays}
      />
    </div>
  );
}

/* ============================ BOARD VIEW ============================ */

interface BoardProps {
  selectedDay: Date;
  setSelectedDay: (d: Date) => void;
  currentMonth: Date;
  setCurrentMonth: (d: Date) => void;
  days: Date[];
  startDayOfWeek: number;
  dayCount: (d: Date) => number;
  dayEvents: EventWithId[];
  allDayEvents: EventWithId[];
  getEventsForDay: (d: Date) => EventWithId[];
  operators: OperatorWithId[];
  availableOperators: OperatorWithId[];
  todayCount: Map<string, number>;
  roles: string[];
  boardRole: string;
  setBoardRole: (r: string) => void;
  canEdit: boolean;
  saving: boolean;
  picked: DragPayload | null;
  setPicked: (p: DragPayload | null) => void;
  dragOverEventId: string | null;
  setDragOverEventId: (id: string | null) => void;
  dragOverPool: boolean;
  setDragOverPool: (v: boolean) => void;
  onDragStart: (e: React.DragEvent, p: DragPayload) => void;
  readPayload: (e: React.DragEvent) => DragPayload | null;
  applyToEvent: (p: DragPayload, target: EventWithId) => void;
  unassign: (eventId: string, operatorId: string) => void;
  changeRole: (event: EventWithId, operatorId: string, operatorName: string, role: string) => void;
  assignPanelBatch: (opId: string, shift: 'primeiro' | 'segundo', events: EventWithId[], withHalfShift: boolean, shiftTime: string) => Promise<void>;
  holidays: { date: string }[];
}

function BoardView(props: BoardProps) {
  const {
    selectedDay, setSelectedDay, currentMonth, setCurrentMonth, days, startDayOfWeek, dayCount,
    dayEvents, allDayEvents, getEventsForDay, operators, availableOperators, todayCount, roles, boardRole, setBoardRole,
    canEdit, saving, picked, setPicked, dragOverEventId, setDragOverEventId, dragOverPool, setDragOverPool,
    onDragStart, readPayload, applyToEvent, unassign, changeRole, assignPanelBatch, holidays,
  } = props;

  const isHoliday = (day: Date): boolean => {
    const y = day.getFullYear();
    const m = String(day.getMonth() + 1).padStart(2, '0');
    const d = String(day.getDate()).padStart(2, '0');
    return holidays.some((h) => h.date === `${y}-${m}-${d}`);
  };

  const [boardTab, setBoardTab] = useState<'escala' | 'painel'>('escala');
  const [shiftChangeTime, setShiftChangeTime] = useState('');
  const [panelOp1Id, setPanelOp1Id] = useState('');
  const [panelOp2Id, setPanelOp2Id] = useState('');

  const contractBadge = (c: string) => {
    if (c === 'funcionario') return { label: 'Funcionário', cls: 'badge-primary' };
    if (c === 'freelancer_n1') return { label: 'Freela N1', cls: 'badge-accent' };
    if (c === 'freelancer_n2') return { label: 'Freela N2', cls: 'badge-info' };
    return { label: c || '—', cls: 'badge-info' };
  };

  const handleOperatorActivate = (payload: DragPayload) => {
    if (!canEdit) return;
    // toggle pick
    if (picked && picked.operatorId === payload.operatorId && picked.fromEventId === payload.fromEventId) {
      setPicked(null);
    } else {
      setPicked(payload);
    }
  };

  const handleEventTap = (target: EventWithId) => {
    if (!canEdit || !picked) return;
    applyToEvent(picked, target);
    setPicked(null);
  };

  const handlePoolTap = () => {
    if (!canEdit || !picked || !picked.fromEventId) return;
    unassign(picked.fromEventId, picked.operatorId);
    setPicked(null);
  };

  // Card de um operador no pool (arrastável / tocável)
  const opCard = (op: OperatorWithId) => {
    const cb = contractBadge(op.contractType);
    const isPicked = picked?.operatorId === op.id && !picked?.fromEventId;
    return (
      <div
        key={op.id}
        draggable={canEdit}
        onDragStart={(e) => onDragStart(e, { operatorId: op.id, operatorName: op.name, fromEventId: null })}
        onClick={(e) => { e.stopPropagation(); handleOperatorActivate({ operatorId: op.id, operatorName: op.name, fromEventId: null }); }}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
          background: isPicked ? 'var(--primary-light)' : 'var(--bg-surface-elevated)',
          border: isPicked ? '2px solid var(--primary)' : '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', cursor: canEdit ? 'grab' : 'default',
          transition: 'all var(--transition-fast)',
        }}
      >
        {canEdit && <GripVertical size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {firstName(op.name)}
          </p>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '2px' }}>
            <span className={`badge ${cb.cls}`} style={{ fontSize: '9px', padding: '1px 6px' }}>{cb.label}</span>
            {(todayCount.get(op.id) || 0) > 0 && (
              <span className="badge badge-info" style={{ fontSize: '9px', padding: '1px 6px' }} title="Já escalado em outro(s) leilão(ões) hoje">
                {todayCount.get(op.id)}× hoje
              </span>
            )}
            {isOperatorRestDay(op, selectedDay) && (
              <span className="badge badge-warning" style={{ fontSize: '9px', padding: '1px 6px' }}>Folga</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Agrupa operadores disponíveis por cargo/função (cada um entra no primeiro grupo que casar)
  const FUNCTION_GROUPS: { key: string; label: string; match: (op: OperatorWithId) => boolean }[] = [
    { key: 'painel', label: 'Operadores de Painel', match: (op) => (op.functions || []).includes('operador_painel') || op.role === 'operador_painel' },
    { key: 'transmissao', label: 'Operadores de Transmissão', match: (op) => (op.functions || []).includes('tecnico') || op.role === 'operador_transmissao' },
    { key: 'freela', label: 'Freelancers', match: (op) => (op.functions || []).some((f) => f === 'freelancer_estudio' || f === 'freelancer_externo') || (op.contractType || '').startsWith('freelancer') },
  ];
  const operatorGroups = FUNCTION_GROUPS.map((g) => ({ ...g, ops: [] as OperatorWithId[] }));
  const otherOps: OperatorWithId[] = [];
  availableOperators.forEach((op) => {
    const g = operatorGroups.find((g) => g.match(op));
    (g ? g.ops : otherOps).push(op);
  });

  return (
    <div>
      {/* Calendário + Programação do dia lado a lado */}
      <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '16px', marginBottom: '16px', alignItems: 'start' }}>
      {/* Calendário do mês embutido (selecione a data direto, sem trocar de aba) */}
      <div className="card" style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
            <ChevronLeft size={18} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3 style={{ fontSize: '15px', textTransform: 'capitalize' }}>{format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => { const t = new Date(); setCurrentMonth(t); setSelectedDay(t); }}>Hoje</button>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px', marginBottom: '3px' }}>
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}>
          {Array.from({ length: startDayOfWeek }).map((_, i) => <div key={`e-${i}`} />)}
          {days.map((day) => {
            const isToday = isSameDay(day, new Date());
            const isSelected = isSameDay(day, selectedDay);
            const count = dayCount(day);
            const dow = getDay(day);
            const isWeekendDay = dow === 0 || dow === 6;
            const isHolidayDay = isHoliday(day);
            const isRed = isWeekendDay || isHolidayDay;
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                title={isHolidayDay ? 'Feriado' : undefined}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
                  padding: '6px 0', minHeight: '42px', cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                  background: isSelected ? (isRed ? '#ef4444' : 'var(--primary)') : isRed ? 'rgba(239,68,68,0.08)' : count > 0 ? 'var(--primary-light)' : 'transparent',
                  color: isSelected ? '#fff' : isToday ? 'var(--primary)' : isRed ? '#ef4444' : 'var(--text-primary)',
                  border: isToday && !isSelected ? `1px solid ${isRed ? '#ef4444' : 'var(--primary)'}` : '1px solid transparent',
                  fontWeight: isToday || isSelected ? 700 : 400, fontSize: '13px',
                }}
              >
                {format(day, 'd')}
                {isHolidayDay && !isSelected && (
                  <span style={{ fontSize: '8px', lineHeight: 1, color: '#ef4444', fontWeight: 700 }}>FER</span>
                )}
                {count > 0 && (
                  <span style={{
                    fontSize: '9px', lineHeight: 1, padding: '1px 4px', borderRadius: '8px',
                    background: isSelected ? 'rgba(255,255,255,0.25)' : isRed ? '#ef4444' : 'var(--primary)', color: '#fff', fontWeight: 700,
                  }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: '14px', fontWeight: 700, textTransform: 'capitalize' }}>
            {format(selectedDay, "EEEE, dd 'de' MMMM", { locale: ptBR })}
          </p>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {dayEvents.length} leilão(ões) • {availableOperators.length} disponível(is)
          </span>
        </div>
      </div>

      {/* Programação do dia (à direita do calendário) */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <h3 style={{ fontSize: '14px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CalendarDays size={16} /> Programação do Dia
        </h3>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'capitalize' }}>
          {format(selectedDay, "EEEE, dd 'de' MMMM", { locale: ptBR })}
        </p>
        {allDayEvents.length === 0 ? (
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>Nenhum evento neste dia.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
            {allDayEvents.map((evt) => {
              const isRetransmissao = evt.operationType === 'retransmissao';
              const team = (evt.assignments || []).length;
              const pendente = !isRetransmissao && team === 0; // precisa equipe e não tem
              return (
                <Link
                  key={evt.id}
                  href={`/dashboard/leiloes/detalhes?id=${evt.id}`}
                  style={{ textDecoration: 'none', display: 'block' }}
                >
                  <div style={{
                    padding: '9px 11px', borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface-elevated)',
                    borderLeft: `3px solid ${pendente ? 'var(--warning)' : isRetransmissao ? 'var(--info)' : 'var(--success)'}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary)' }}>
                        {format(toDate(evt.date), 'HH:mm')}{evt.endDate ? `–${format(toDate(evt.endDate), 'HH:mm')}` : ''}
                      </span>
                      <span className={`badge ${evt.operationType ? OPERATION_TYPE_BADGE[evt.operationType] : 'badge-info'}`} style={{ fontSize: '8.5px', padding: '1px 6px' }}>
                        {evt.operationType ? OPERATION_TYPE_LABELS[evt.operationType] : 'N/D'}
                      </span>
                    </div>
                    <p style={{ fontSize: '12.5px', fontWeight: 600, margin: '3px 0', lineHeight: 1.2 }}>
                      {evt.studioName ? <span style={{ color: 'var(--accent)' }}>{evt.studioName} · </span> : null}
                      {evt.title.replace(/^LIVE \| /, '')}
                    </p>
                    {isRetransmissao ? (
                      <span style={{ fontSize: '10.5px', color: 'var(--info)' }}>Só painel — sem equipe</span>
                    ) : pendente ? (
                      <span style={{ fontSize: '10.5px', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                        <AlertTriangle size={11} /> Pendente — sem equipe
                      </span>
                    ) : (
                      <span style={{ fontSize: '10.5px', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <UserCheck size={11} /> {team} operador(es) escalado(s)
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
        {(() => {
          const pend = allDayEvents.filter((e) => e.operationType !== 'retransmissao' && (e.assignments || []).length === 0).length;
          return pend > 0 ? (
            <div style={{ marginTop: '10px', padding: '8px 10px', background: 'var(--warning-bg)', borderRadius: 'var(--radius-sm)', fontSize: '11.5px', color: 'var(--warning)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={13} /> {pend} leilão(ões) com pendência de equipe
            </div>
          ) : null;
        })()}
      </div>
      </div>

      {/* Tab bar: Escala / Painel */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '16px', borderBottom: '1px solid var(--border)' }}>
        <button
          className={`tab ${boardTab === 'escala' ? 'active' : ''}`}
          onClick={() => setBoardTab('escala')}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Users size={14} /> Operadores de Transmissão
        </button>
        <button
          className={`tab ${boardTab === 'painel' ? 'active' : ''}`}
          onClick={() => setBoardTab('painel')}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Monitor size={14} /> Operadores de Painel
        </button>
        {boardTab === 'escala' && canEdit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto', paddingBottom: '4px' }}>
            <label style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Função padrão:</label>
            <select className="input" style={{ width: 'auto', padding: '6px 10px', fontSize: '13px' }} value={boardRole} onChange={(e) => setBoardRole(e.target.value)}>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* ======= ABA PAINEL ======= */}
      {boardTab === 'painel' && (
        <PanelTabContent
          dayEvents={dayEvents}
          operators={operators}
          selectedDay={selectedDay}
          shiftChangeTime={shiftChangeTime}
          setShiftChangeTime={setShiftChangeTime}
          panelOp1Id={panelOp1Id}
          setPanelOp1Id={setPanelOp1Id}
          panelOp2Id={panelOp2Id}
          setPanelOp2Id={setPanelOp2Id}
          canEdit={canEdit}
          unassign={unassign}
          assignPanelBatch={assignPanelBatch}
        />
      )}

      {/* ======= ABA ESCALA ======= */}
      {boardTab === 'escala' && (
      <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '20px', alignItems: 'start' }}>
        {/* ---- Operators pool ---- */}
        <div
          className="card"
          style={{
            position: 'sticky', top: '20px',
            border: dragOverPool ? '2px dashed var(--primary)' : (picked?.fromEventId ? '2px dashed var(--primary)' : '1px solid var(--border)'),
            background: dragOverPool ? 'var(--primary-light)' : undefined,
            transition: 'all var(--transition-fast)',
          }}
          onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOverPool(true); } }}
          onDragLeave={() => setDragOverPool(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverPool(false);
            const p = readPayload(e);
            if (p && p.fromEventId) unassign(p.fromEventId, p.operatorId);
          }}
          onClick={() => { if (picked?.fromEventId) handlePoolTap(); }}
        >
          <h3 style={{ fontSize: '15px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={17} /> Operadores
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
            {availableOperators.length} operador(es) • pode escalar o mesmo em mais de um leilão no dia
            {picked?.fromEventId && <span style={{ color: 'var(--primary)', fontWeight: 600 }}> • solte aqui para liberar</span>}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '60vh', overflowY: 'auto' }}>
            {availableOperators.length === 0 && (
              <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                Nenhum operador ativo cadastrado.
              </p>
            )}
            {operatorGroups.filter((g) => g.ops.length > 0).map((g) => (
              <div key={g.key}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '8px 0 6px' }}>
                  {g.label} ({g.ops.length})
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {g.ops.map(opCard)}
                </div>
              </div>
            ))}
            {otherOps.length > 0 && (
              <div>
                <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '8px 0 6px' }}>
                  Outros ({otherOps.length})
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {otherOps.map(opCard)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---- Event drop zones ---- */}
        <div>
          {dayEvents.length === 0 ? (
            <div className="card empty-state" style={{ padding: '48px 24px', textAlign: 'center' }}>
              <CalendarDays size={36} style={{ color: 'var(--text-muted)', margin: '0 auto 12px' }} />
              <p style={{ fontSize: '14px', fontWeight: 600 }}>Nenhum leilão neste dia</p>
              <p style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Use as setas acima para navegar entre os dias.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
              {dayEvents.map((evt) => {
                const isStudio = evt.operationType === 'estudio';
                const team = evt.assignments || [];
                const isOver = dragOverEventId === evt.id;
                const isDropTarget = !!picked && picked.fromEventId !== evt.id;
                return (
                  <div
                    key={evt.id}
                    onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOverEventId(evt.id); } }}
                    onDragLeave={() => setDragOverEventId(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverEventId(null);
                      const p = readPayload(e);
                      if (p) applyToEvent(p, evt);
                    }}
                    onClick={() => handleEventTap(evt)}
                    className="card"
                    style={{
                      padding: '14px',
                      borderTop: `3px solid ${isStudio ? 'var(--accent)' : 'var(--primary)'}`,
                      border: isOver ? '2px solid var(--primary)' : (isDropTarget ? '2px dashed var(--primary)' : undefined),
                      background: isOver ? 'var(--primary-light)' : undefined,
                      cursor: picked ? 'copy' : 'default',
                      transition: 'all var(--transition-fast)',
                    }}
                  >
                    {/* header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: '13.5px', fontWeight: 700, lineHeight: 1.25 }}>
                          {evt.studioName && (
                            <span style={{ color: 'var(--accent)', fontWeight: 800 }}>{evt.studioName} · </span>
                          )}
                          {evt.title.replace(/^LIVE \| /, '')}
                        </p>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary)' }}>
                            {format(toDate(evt.date), 'HH:mm')}{evt.endDate ? ` – ${format(toDate(evt.endDate), 'HH:mm')}` : ''}
                          </span>
                          {evt.city && (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                              <MapPin size={10} /> {evt.city}
                            </span>
                          )}
                          {evt.channelName && (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                              <Tv size={10} /> {evt.channelName}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`badge ${evt.operationType ? OPERATION_TYPE_BADGE[evt.operationType] : 'badge-info'}`} style={{ fontSize: '9px', padding: '2px 7px', flexShrink: 0 }}>
                        {evt.operationType ? OPERATION_TYPE_LABELS[evt.operationType] : 'N/D'}
                      </span>
                    </div>

                    {/* assigned operators */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minHeight: '54px', marginTop: '8px' }}>
                      {team.length === 0 ? (
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                          padding: '16px 8px', borderRadius: 'var(--radius-md)',
                          border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: '12px',
                        }}>
                          {canEdit ? <><Hand size={14} /> Arraste operadores para cá</> : <><AlertTriangle size={13} style={{ color: 'var(--warning)' }} /> Sem equipe</>}
                        </div>
                      ) : (
                        team.map((a) => (
                          <div
                            key={a.operatorId}
                            draggable={canEdit}
                            onDragStart={(e) => { e.stopPropagation(); onDragStart(e, { operatorId: a.operatorId, operatorName: a.operatorName || '', fromEventId: evt.id }); }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '8px',
                              padding: '7px 9px',
                              background: 'var(--success-bg)',
                              borderRadius: 'var(--radius-md)',
                              cursor: canEdit ? 'grab' : 'default',
                            }}
                          >
                            <UserCheck size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                            {a.isHalfShift && (
                              <span style={{
                                fontSize: '9px', fontWeight: 700, padding: '1px 5px', flexShrink: 0, whiteSpace: 'nowrap',
                                borderRadius: 'var(--radius-full)', background: 'var(--warning-bg)', color: 'var(--warning)',
                              }}>
                                {a.halfShiftType === 'primeiro' ? '1º Turno' : '2º Turno'}{a.shiftTime ? ` - ${a.shiftTime}` : ''}
                              </span>
                            )}
                            {a.onRestDay && (
                              <span style={{
                                fontSize: '9px', fontWeight: 700, padding: '1px 5px', flexShrink: 0, whiteSpace: 'nowrap',
                                borderRadius: 'var(--radius-full)', background: 'var(--warning-bg)', color: 'var(--warning)',
                              }} title="Escalado em dia de folga — valor extra">
                                Folga +
                              </span>
                            )}
                            <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--success)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                              {firstName(a.operatorName)}
                            </span>
                            {canEdit ? (
                              <select
                                value={roles.includes(a.role) ? a.role : ''}
                                onChange={(e) => changeRole(evt, a.operatorId, a.operatorName || '', e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="input"
                                style={{ width: 'auto', padding: '2px 6px', fontSize: '10.5px', flexShrink: 0 }}
                              >
                                {!roles.includes(a.role) && <option value="">{a.role || 'Função'}</option>}
                                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                              </select>
                            ) : (
                              <span className="badge badge-info" style={{ fontSize: '9px', padding: '1px 6px' }}>{a.role}</span>
                            )}
                            {canEdit && (
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={(e) => { e.stopPropagation(); unassign(evt.id, a.operatorId); }}
                                style={{ color: 'var(--error)', padding: '2px', flexShrink: 0 }}
                                title="Remover"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {team.length} operador(es)
                      </span>
                      <Link href={`/dashboard/leiloes/detalhes?id=${evt.id}`} style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
                        Abrir detalhes →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      )} {/* fim aba escala */}

      {saving && <p style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right', marginTop: '8px' }}>Salvando…</p>}

      {/* Grade mensal (operador × dias) */}
      {operators.length > 0 && (() => {
        const WEEKDAY_ABBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        const panelOps = operators.filter(
          (o) => (o.functions || []).includes('operador_painel') || o.role === 'operador_painel',
        );
        const otherOps = operators.filter(
          (o) => !(o.functions || []).includes('operador_painel') && o.role !== 'operador_painel',
        );

        const renderHeader = () => (
          <tr>
            <th style={{ position: 'sticky', left: 0, background: 'var(--bg-surface-elevated)', zIndex: 1 }}>Operador</th>
            {days.map((day) => {
              const dow = getDay(day);
              const isWeekendCol = dow === 0 || dow === 6;
              const isHolidayCol = isHoliday(day);
              const isRed = isWeekendCol || isHolidayCol;
              const isToday = isSameDay(day, new Date());
              return (
                <th
                  key={day.toISOString()}
                  title={isHolidayCol ? 'Feriado' : undefined}
                  style={{
                    textAlign: 'center', padding: '4px 2px', minWidth: '32px',
                    color: isToday ? 'var(--primary)' : isRed ? '#ef4444' : 'var(--text-secondary)',
                    fontWeight: isToday ? 700 : 500,
                    background: isHolidayCol ? 'rgba(239,68,68,0.06)' : undefined,
                  }}
                >
                  <div style={{ fontSize: '12px', lineHeight: 1.1 }}>{format(day, 'd')}</div>
                  <div style={{ fontSize: '9px', lineHeight: 1.1, opacity: 0.8 }}>
                    {isHolidayCol ? 'Fer' : WEEKDAY_ABBR[dow]}
                  </div>
                </th>
              );
            })}
            <th style={{ textAlign: 'center' }}>Total</th>
          </tr>
        );

        const renderRow = (op: OperatorWithId) => {
          let total = 0;
          return (
            <tr key={op.id}>
              <td style={{ position: 'sticky', left: 0, background: 'var(--bg-surface)', zIndex: 1, fontWeight: 500, whiteSpace: 'nowrap' }}>
                {firstName(op.name)}
              </td>
              {days.map((day) => {
                const evts = getEventsForDay(day);
                const isAssigned = evts.some((e) => (e.assignments || []).some((a) => a.operatorId === op.id));
                const isRestDay = isOperatorRestDay(op, day);
                const assignedOnRest = isAssigned && isRestDay;
                if (isAssigned) total++;

                let dotColor = 'var(--primary)';
                let bgColor = 'transparent';

                if (assignedOnRest) {
                  dotColor = '#f59e0b';
                  bgColor = 'rgba(245,158,11,0.10)';
                } else if (isAssigned) {
                  dotColor = 'var(--primary)';
                  bgColor = 'var(--primary-light)';
                } else if (isRestDay) {
                  dotColor = '#ef4444';
                  bgColor = 'rgba(239,68,68,0.08)';
                }

                return (
                  <td
                    key={day.toISOString()}
                    onClick={() => setSelectedDay(day)}
                    title={
                      assignedOnRest ? 'Escalado em dia de folga'
                        : isAssigned ? 'Escalado'
                        : isRestDay ? 'Folga'
                        : undefined
                    }
                    style={{ textAlign: 'center', padding: '4px 2px', background: bgColor, cursor: 'pointer' }}
                  >
                    {(isAssigned || isRestDay) && (
                      <span style={{
                        display: 'inline-block', width: '10px', height: '10px',
                        borderRadius: '50%', background: dotColor,
                      }} />
                    )}
                  </td>
                );
              })}
              <td style={{ textAlign: 'center', fontWeight: 700, color: total > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>{total}</td>
            </tr>
          );
        };

        return (
          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Legenda */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--primary)', flexShrink: 0, display: 'inline-block' }} /> Escalado
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b', flexShrink: 0, display: 'inline-block' }} /> Escalado em folga
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', flexShrink: 0, display: 'inline-block' }} /> Folga (sem escala)
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 700 }}>Dom/Sáb/Fer</span> = fim de semana ou feriado
              </span>
            </div>

            {/* Grade: Operadores de Painel */}
            {panelOps.length > 0 && (
              <div className="card" style={{ padding: '16px' }}>
                <h3 style={{ fontSize: '14px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Monitor size={15} /> Operadores de Painel — {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
                </h3>
                <div className="table-container">
                  <table className="table" style={{ fontSize: '12px' }}>
                    <thead>{renderHeader()}</thead>
                    <tbody>{panelOps.map(renderRow)}</tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Grade: Operadores de Transmissão */}
            {otherOps.length > 0 && (
              <div className="card" style={{ padding: '16px' }}>
                <h3 style={{ fontSize: '14px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Users size={15} /> Operadores de Transmissão — {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
                </h3>
                <div className="table-container">
                  <table className="table" style={{ fontSize: '12px' }}>
                    <thead>{renderHeader()}</thead>
                    <tbody>{otherOps.map(renderRow)}</tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/* ============================ PANEL TAB ============================ */

interface PanelTabProps {
  dayEvents: EventWithId[];
  operators: OperatorWithId[];
  selectedDay: Date;
  shiftChangeTime: string;
  setShiftChangeTime: (t: string) => void;
  panelOp1Id: string;
  setPanelOp1Id: (id: string) => void;
  panelOp2Id: string;
  setPanelOp2Id: (id: string) => void;
  canEdit: boolean;
  unassign: (eventId: string, operatorId: string) => void;
  assignPanelBatch: (opId: string, shift: 'primeiro' | 'segundo', events: EventWithId[], withHalfShift: boolean, shiftTime: string) => Promise<void>;
}

function PanelTabContent({
  dayEvents, operators, selectedDay,
  shiftChangeTime, setShiftChangeTime,
  panelOp1Id, setPanelOp1Id,
  panelOp2Id, setPanelOp2Id,
  canEdit, unassign, assignPanelBatch,
}: PanelTabProps) {
  const panelOperators = operators.filter(
    (o) => (o.functions || []).includes('operador_painel') || o.role === 'operador_painel',
  );

  // Compute default shift change time from day events
  const eventsWithTime = dayEvents.filter((e) => e.date);
  const firstEvtTime = eventsWithTime.length > 0 ? format(toDate(eventsWithTime[0].date), 'HH:mm') : '';
  const lastEvtTime = eventsWithTime.length > 0 ? format(toDate(eventsWithTime[eventsWithTime.length - 1].date), 'HH:mm') : '';

  const effectiveShift = shiftChangeTime || (() => {
    if (eventsWithTime.length < 2) return '';
    const first = toDate(eventsWithTime[0].date);
    const last = toDate(eventsWithTime[eventsWithTime.length - 1].date);
    const mid = new Date((first.getTime() + last.getTime()) / 2);
    return format(mid, 'HH:mm');
  })();

  const turno1Events = effectiveShift
    ? dayEvents.filter((e) => format(toDate(e.date), 'HH:mm') < effectiveShift)
    : dayEvents;
  const turno2Events = effectiveShift
    ? dayEvents.filter((e) => format(toDate(e.date), 'HH:mm') >= effectiveShift)
    : [];
  const hasTwoShifts = turno1Events.length > 0 && turno2Events.length > 0;

  // Get current panel assignment for an event
  const getPanelAssignment = (evt: EventWithId) =>
    (evt.assignments || []).find(
      (a) => a.role === 'Operador de Painel' ||
        operators.find((o) => o.id === a.operatorId)?.functions?.includes('operador_painel'),
    );

  const handleAssignShift = async (opId: string, shift: 'primeiro' | 'segundo', events: EventWithId[]) => {
    if (!opId || events.length === 0) return;
    await assignPanelBatch(opId, shift, events, hasTwoShifts, effectiveShift);
  };

  if (dayEvents.length === 0) {
    return (
      <div className="card empty-state" style={{ padding: '48px 24px', textAlign: 'center' }}>
        <Monitor size={36} style={{ color: 'var(--text-muted)', margin: '0 auto 12px' }} />
        <p style={{ fontSize: '14px', fontWeight: 600 }}>Nenhum leilão neste dia</p>
        <p style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Selecione um dia com leilões no calendário.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header info */}
      <div className="card" style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <Monitor size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <span style={{ fontSize: '14px', fontWeight: 600 }}>
            {format(selectedDay, "EEEE, dd 'de' MMMM", { locale: ptBR })}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {dayEvents.length} leilão(ões) · {panelOperators.length} op. de painel disponível(is)
          </span>
          {firstEvtTime && (
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={13} /> {firstEvtTime}
              {lastEvtTime && lastEvtTime !== firstEvtTime ? ` → ${lastEvtTime}` : ''}
            </span>
          )}
        </div>

        {/* Shift change time config */}
        {dayEvents.length >= 2 && canEdit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Horário de troca de turno:</span>
            <input
              type="time"
              className="input"
              value={shiftChangeTime || effectiveShift}
              onChange={(e) => setShiftChangeTime(e.target.value)}
              style={{ width: '120px' }}
            />
            {hasTwoShifts ? (
              <span className="badge badge-primary" style={{ fontSize: '11px' }}>
                1º Turno: {firstEvtTime} → {effectiveShift} · 2º Turno: {effectiveShift} → {lastEvtTime}
              </span>
            ) : (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Ajuste o horário para dividir em dois turnos
              </span>
            )}
          </div>
        )}
      </div>

      {/* Two-shift assignment columns */}
      <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: hasTwoShifts ? '1fr 1fr' : '1fr', gap: '16px' }}>
        {/* Turno 1 */}
        <div className="card" style={{ padding: '16px', borderTop: '3px solid var(--primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)' }}>
              {hasTwoShifts ? `1º Turno · ${firstEvtTime}${effectiveShift ? ` → ${effectiveShift}` : ''}` : `Turno Único · ${firstEvtTime}${lastEvtTime && lastEvtTime !== firstEvtTime ? ` → ${lastEvtTime}` : ''}`}
            </span>
            <span className="badge badge-primary" style={{ fontSize: '10px' }}>{turno1Events.length} leilão(ões)</span>
          </div>

          {/* Events in this shift */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
            {turno1Events.map((evt) => {
              const panelA = getPanelAssignment(evt);
              return (
                <div key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary)', flexShrink: 0 }}>
                    {format(toDate(evt.date), 'HH:mm')}
                  </span>
                  <span style={{ fontSize: '12px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {evt.title.replace(/^LIVE \| /, '')}
                  </span>
                  {panelA ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      <span className="badge badge-success" style={{ fontSize: '10px' }}>{firstName(panelA.operatorName)}</span>
                      {canEdit && (
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          style={{ color: 'var(--error)', padding: '2px' }}
                          onClick={() => unassign(evt.id, panelA.operatorId)}
                          title="Remover"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="badge badge-warning" style={{ fontSize: '10px', flexShrink: 0 }}>Sem painel</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Assign panel op to shift 1 */}
          {canEdit && panelOperators.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                className="input"
                value={panelOp1Id}
                onChange={(e) => setPanelOp1Id(e.target.value)}
                style={{ flex: 1, fontSize: '12px' }}
              >
                <option value="">Selecione o operador...</option>
                {panelOperators.map((o) => (
                  <option key={o.id} value={o.id}>{firstName(o.name)}</option>
                ))}
              </select>
              <button
                className="btn btn-primary btn-sm"
                disabled={!panelOp1Id}
                onClick={() => handleAssignShift(panelOp1Id, 'primeiro', turno1Events)}
                style={{ flexShrink: 0 }}
              >
                Escalar
              </button>
            </div>
          )}
          {canEdit && panelOperators.length === 0 && (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Nenhum operador com função de painel.{' '}
              <a href="/dashboard/operadores" style={{ color: 'var(--primary)' }}>Configurar</a>
            </p>
          )}
        </div>

        {/* Turno 2 (só aparece se há dois turnos) */}
        {hasTwoShifts && (
          <div className="card" style={{ padding: '16px', borderTop: '3px solid var(--accent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent)' }}>
                2º Turno · {effectiveShift} → {lastEvtTime}
              </span>
              <span className="badge badge-accent" style={{ fontSize: '10px' }}>{turno2Events.length} leilão(ões)</span>
            </div>

            {/* Events in shift 2 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
              {turno2Events.map((evt) => {
                const panelA = getPanelAssignment(evt);
                return (
                  <div key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>
                      {format(toDate(evt.date), 'HH:mm')}
                    </span>
                    <span style={{ fontSize: '12px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {evt.title.replace(/^LIVE \| /, '')}
                    </span>
                    {panelA ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        <span className="badge badge-success" style={{ fontSize: '10px' }}>{firstName(panelA.operatorName)}</span>
                        {canEdit && (
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            style={{ color: 'var(--error)', padding: '2px' }}
                            onClick={() => unassign(evt.id, panelA.operatorId)}
                            title="Remover"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="badge badge-warning" style={{ fontSize: '10px', flexShrink: 0 }}>Sem painel</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Assign panel op to shift 2 */}
            {canEdit && panelOperators.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  className="input"
                  value={panelOp2Id}
                  onChange={(e) => setPanelOp2Id(e.target.value)}
                  style={{ flex: 1, fontSize: '12px' }}
                >
                  <option value="">Selecione o operador...</option>
                  {panelOperators.map((o) => (
                    <option key={o.id} value={o.id}>{firstName(o.name)}</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!panelOp2Id}
                  onClick={() => handleAssignShift(panelOp2Id, 'segundo', turno2Events)}
                  style={{ flexShrink: 0 }}
                >
                  Escalar
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
