'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { getEvents, assignOperator, removeAssignment, updateEvent } from '@/services/events';
import { getActiveOperators } from '@/services/operators';
import { getDocument, getCollection } from '@/lib/firestore';
import { GestaoEvent, EventAssignment } from '@/types/event';
import { Operator, PaymentRules, isOperatorRestDay } from '@/types/operator';
import { calculateOperatorPayment } from '@/lib/payment-engine';
import { Holiday } from '@/types/payment';
import { getScheduleNotes, setScheduleNote, deleteScheduleNote } from '@/services/scheduleNotes';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, addMonths, subMonths, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X, Monitor, Users, MapPin } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

type EventWithId = GestaoEvent & { id: string };
type OperatorWithId = Operator & { id: string };

const MT_DEFAULT_VALUE = 450; // Estúdio MT (Cuiabá) — valor fixo por evento (configurável)
const STUDIO_SLOTS = ['Estúdio 1', 'Estúdio 2', 'Estúdio 3', 'Estúdio 4'];

// Um evento é "de estúdio" (candidato a ocupar um estúdio E1-E4).
function isStudioEvent(e: GestaoEvent): boolean {
  return e.operationType === 'estudio' || !!e.studioName;
}

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) return (val as { toDate: () => Date }).toDate();
  if (typeof val === 'string') return new Date(val);
  return new Date();
}

function firstName(name?: string) {
  return (name || '?').split(' ').slice(0, 2).join(' ');
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Operador do estúdio MT (Cuiabá): heurística por cidade-base ou marcação no nome.
function isMtOperator(op: OperatorWithId): boolean {
  const city = (op.homeCity || '').toLowerCase();
  return city.includes('cuiab') || /\(mt\)/i.test(op.name);
}

function isPanelOperator(op: OperatorWithId): boolean {
  return (op.functions || []).includes('operador_painel') || op.role === 'operador_painel';
}

export default function EscalaMensalPage() {
  const { profile } = useAuth();
  const [events, setEvents] = useState<EventWithId[]>([]);
  const [operators, setOperators] = useState<OperatorWithId[]>([]);
  const [holidays, setHolidays] = useState<{ date: string }[]>([]);
  const [roles, setRoles] = useState<string[]>(['Diretor', 'DTV', 'vMix', 'Apoio']);
  const [rulesFunc, setRulesFunc] = useState<PaymentRules | null>(null);
  const [rulesN1, setRulesN1] = useState<PaymentRules | null>(null);
  const [rulesN2, setRulesN2] = useState<PaymentRules | null>(null);
  const [fixedValues, setFixedValues] = useState<Record<string, number>>({});
  const [mtValue, setMtValue] = useState(MT_DEFAULT_VALUE);
  const [notes, setNotes] = useState<Map<string, string>>(new Map()); // `${opId}|${dayKey}` → rótulo manual
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);

  // Célula aberta (operador × dia) e função/hora a aplicar.
  const [openCell, setOpenCell] = useState<{ rowId: string; key: string } | null>(null);
  const [cellRole, setCellRole] = useState('');
  const [cellTime, setCellTime] = useState('');

  const canEdit = useMemo(() => {
    const r = profile?.role;
    return r === 'admin' || r === 'ceo' || r === 'operador_painel' || r === 'administrativo' || r === 'gestor';
  }, [profile]);

  const showToast = (message: string, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2600);
  };

  const loadData = useCallback(async () => {
    try {
      const [evts, ops, rolesDoc, funcDoc, n1Doc, n2Doc, svcDoc, mtDoc, hols, schedNotes] = await Promise.all([
        getEvents().catch(() => [] as EventWithId[]),
        getActiveOperators().catch(() => [] as OperatorWithId[]),
        getDocument<{ list: string[] }>('settings', 'roles').catch(() => null),
        getDocument<PaymentRules>('settings', 'default_rules_funcionario').catch(() => null),
        getDocument<PaymentRules>('settings', 'default_rules_freelancer_n1').catch(() => null),
        getDocument<PaymentRules>('settings', 'default_rules_freelancer_n2').catch(() => null),
        getDocument<{ catalog?: unknown }>('settings', 'services').catch(() => null),
        getDocument<{ value: number }>('settings', 'mt_studio').catch(() => null),
        getCollection<{ date: string }>('holidays').catch(() => []),
        getScheduleNotes().catch(() => []),
      ]);
      setEvents(evts);
      setOperators(ops);
      setHolidays(hols);
      setNotes(new Map(schedNotes.map((n) => [`${n.operatorId}|${n.date}`, n.label])));
      if (rolesDoc?.list?.length) { setRoles(rolesDoc.list); setCellRole((p) => p || rolesDoc.list[0]); }
      else setCellRole((p) => p || 'Diretor');
      if (funcDoc) setRulesFunc({ ...funcDoc, contractType: 'funcionario' });
      if (n1Doc) setRulesN1({ ...n1Doc, contractType: 'freelancer_n1' });
      if (n2Doc) setRulesN2({ ...n2Doc, contractType: 'freelancer_n2' });
      if (mtDoc?.value) setMtValue(mtDoc.value);
      if (svcDoc?.catalog) {
        const { serviceFixedValues } = await import('@/types/service');
        setFixedValues(serviceFixedValues(svcDoc.catalog as never));
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
  const days = useMemo(() => eachDayOfInterval({ start: monthStart, end: monthEnd }), [monthStart, monthEnd]);

  // Semanas (domingo→sábado) que tocam o mês — colunas SEMANA da planilha.
  const weeks = useMemo(() => {
    const idx = new Map<string, number>();
    const labels: string[] = [];
    for (const d of days) {
      const wk = dayKey(startOfWeek(d, { weekStartsOn: 0 }));
      if (!idx.has(wk)) { idx.set(wk, labels.length); labels.push(`S${labels.length + 1}`); }
    }
    return { labels, indexOf: (d: Date) => idx.get(dayKey(startOfWeek(d, { weekStartsOn: 0 }))) ?? 0 };
  }, [days]);

  const isHoliday = useCallback((d: Date) => holidays.some((h) => h.date === dayKey(d)), [holidays]);

  // Resolve a tabela de regras de um operador (custom ou padrão por contrato).
  const resolveRules = useCallback((op?: OperatorWithId): PaymentRules | null => {
    if (!op) return null;
    let rules: PaymentRules | null = (op.paymentRules?.hourRanges?.length ?? 0) > 0 ? op.paymentRules! : null;
    if (!rules) {
      if (op.contractType === 'funcionario') rules = rulesFunc;
      else if (op.contractType === 'freelancer_n1') rules = rulesN1;
      else if (op.contractType === 'freelancer_n2') rules = rulesN2;
    }
    if (op.paymentRules && !(op.paymentRules.hourRanges?.length) && rules) {
      rules = { ...rules, ...op.paymentRules, hourRanges: rules.hourRanges };
    }
    return rules;
  }, [rulesFunc, rulesN1, rulesN2]);

  const operatorsById = useMemo(() => new Map(operators.map((o) => [o.id, o])), [operators]);

  type PeriodAssignment = { eventId: string; date: Date; operationType: string | null };

  // Escalas por operador (para cálculo de diária múltipla) — computado uma vez.
  const assignmentsByOperator = useMemo(() => {
    const m = new Map<string, PeriodAssignment[]>();
    for (const e of events) {
      const d = toDate(e.date);
      for (const a of e.assignments || []) {
        if (!m.has(a.operatorId)) m.set(a.operatorId, []);
        m.get(a.operatorId)!.push({ eventId: e.id, date: d, operationType: e.operationType });
      }
    }
    return m;
  }, [events]);

  // Valor de uma escala: real se o evento foi encerrado, senão estimado (pela duração prevista).
  const computeValue = useCallback((
    evt: EventWithId, a: EventAssignment, op: OperatorWithId | undefined, opAssignments: PeriodAssignment[],
  ): { value: number; isReal: boolean } => {
    const isReal = !!evt.closing;
    if (op && isMtOperator(op)) return { value: mtValue, isReal };
    const rules = resolveRules(op);
    if (!rules) return { value: 0, isReal };
    const evtForCalc: EventWithId = evt.closing ? evt : {
      ...evt,
      closing: {
        eventId: evt.id,
        actualStartTime: toDate(evt.date),
        actualEndTime: toDate(evt.endDate || evt.date),
        durationMinutes: 0, crossedMidnight: false, closedBy: '', closedAt: new Date(),
      },
    };
    try {
      const pay = calculateOperatorPayment(evtForCalc, a, rules, holidays as unknown as Holiday[], opAssignments, rulesN2, fixedValues);
      return { value: pay.totalValue, isReal };
    } catch {
      return { value: 0, isReal };
    }
  }, [holidays, fixedValues, mtValue, resolveRules, rulesN2]);

  // Eventos por dia (chave) — usado no dropdown da célula.
  const eventsByDay = useMemo(() => {
    const m = new Map<string, EventWithId[]>();
    for (const e of events) {
      const k = dayKey(toDate(e.date));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    for (const arr of m.values()) arr.sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
    return m;
  }, [events]);

  // Externas por dia (linha "Externas" no topo).
  const externalByDay = useMemo(() => {
    const m = new Map<string, EventWithId[]>();
    for (const e of events) {
      if (e.operationType !== 'externo') continue;
      const k = dayKey(toDate(e.date));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [events]);

  // Eventos de estúdio por dia (para o dropdown das linhas Estúdio 1-4).
  const studioEventsByDay = useMemo(() => {
    const m = new Map<string, EventWithId[]>();
    for (const e of events) {
      if (!isStudioEvent(e)) continue;
      const k = dayKey(toDate(e.date));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [events]);

  // Slot de estúdio → dia → eventos definidos naquele estúdio (studioName === slot).
  const studioSlotGrid = useMemo(() => {
    const m = new Map<string, Map<string, EventWithId[]>>();
    for (const slot of STUDIO_SLOTS) m.set(slot, new Map());
    for (const e of events) {
      const slot = e.studioName || '';
      if (!m.has(slot)) continue;
      const k = dayKey(toDate(e.date));
      const dm = m.get(slot)!;
      if (!dm.has(k)) dm.set(k, []);
      dm.get(k)!.push(e);
    }
    return m;
  }, [events]);

  // Define/retira um leilão de um estúdio (E1-E4): grava event.studioName.
  const assignStudioSlot = async (evt: EventWithId, slot: string) => {
    const isHere = (evt.studioName || '') === slot;
    const newName = isHere ? '' : slot;
    setEvents((prev) => prev.map((e) => e.id === evt.id ? { ...e, studioName: newName } : e));
    setSaving(true);
    try {
      await updateEvent(evt.id, { studioName: newName });
    } catch (err) {
      console.error(err);
      showToast('Erro ao definir estúdio. Recarregando…', 'error');
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  // Grade enriquecida (operador → dia → escalas com valor) + total do mês por
  // operador. Tudo computado UMA vez por mudança de dados — sem custo por render.
  type Cell = { evt: EventWithId; a: EventAssignment; value: number; isReal: boolean };
  const { enrichedGrid, monthTotals, weekTotals } = useMemo(() => {
    const eg = new Map<string, Map<string, Cell[]>>();
    const totals = new Map<string, number>();
    const wTotals = new Map<string, number[]>(); // opId → valor por índice de semana
    for (const e of events) {
      const d = toDate(e.date);
      const k = dayKey(d);
      for (const a of e.assignments || []) {
        const op = operatorsById.get(a.operatorId);
        const { value, isReal } = computeValue(e, a, op, assignmentsByOperator.get(a.operatorId) || []);
        if (!eg.has(a.operatorId)) eg.set(a.operatorId, new Map());
        const dm = eg.get(a.operatorId)!;
        if (!dm.has(k)) dm.set(k, []);
        dm.get(k)!.push({ evt: e, a, value, isReal });
        if (d >= monthStart && d <= monthEnd) {
          totals.set(a.operatorId, (totals.get(a.operatorId) || 0) + value);
          if (!wTotals.has(a.operatorId)) wTotals.set(a.operatorId, new Array(weeks.labels.length).fill(0));
          wTotals.get(a.operatorId)![weeks.indexOf(d)] += value;
        }
      }
    }
    return { enrichedGrid: eg, monthTotals: totals, weekTotals: wTotals };
  }, [events, operatorsById, assignmentsByOperator, computeValue, monthStart, monthEnd, weeks]);

  // ----- mutations -----
  const toggleAssign = async (evt: EventWithId, op: OperatorWithId) => {
    const already = (evt.assignments || []).some((a) => a.operatorId === op.id);
    setSaving(true);
    try {
      if (already) {
        setEvents((prev) => prev.map((e) => e.id === evt.id
          ? { ...e, assignments: (e.assignments || []).filter((a) => a.operatorId !== op.id) } : e));
        await removeAssignment(evt.id, op.id);
      } else {
        const onRestDay = isOperatorRestDay(op, toDate(evt.date));
        const assignment: EventAssignment = {
          eventId: evt.id, operatorId: op.id, operatorName: op.name,
          role: cellRole || 'Operador', travelDaysBefore: 0, travelDaysAfter: 0,
          departureDate: null, returnDate: null, status: 'confirmado', onRestDay,
          ...(cellTime ? { shiftTime: cellTime } : {}),
        };
        setEvents((prev) => prev.map((e) => e.id === evt.id
          ? { ...e, assignments: [...(e.assignments || []), assignment], status: 'escalado' } : e));
        await assignOperator(evt.id, assignment);
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar. Recarregando…', 'error');
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  // Rótulo manual de atividade (viagem/montagem/folga…) numa célula.
  const saveNote = async (opId: string, key: string, label: string) => {
    const clean = label.trim();
    setNotes((prev) => {
      const next = new Map(prev);
      if (clean) next.set(`${opId}|${key}`, clean); else next.delete(`${opId}|${key}`);
      return next;
    });
    try {
      if (clean) await setScheduleNote(opId, key, clean);
      else await deleteScheduleNote(opId, key);
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar atividade.', 'error');
    }
  };

  // Agrupa operadores em seções (igual à planilha).
  const groups = useMemo(() => {
    const estudio: OperatorWithId[] = [];
    const mt: OperatorWithId[] = [];
    const painel: OperatorWithId[] = [];
    for (const op of operators) {
      if (isPanelOperator(op)) painel.push(op);
      else if (isMtOperator(op)) mt.push(op);
      else estudio.push(op);
    }
    return [
      { key: 'estudio', label: 'Programas de estúdio', icon: Users, ops: estudio },
      { key: 'mt', label: `Estúdio MT — Cuiabá (R$ ${mtValue} fixo)`, icon: MapPin, ops: mt },
      { key: 'painel', label: 'Operação de painel', icon: Monitor, ops: painel },
    ].filter((g) => g.ops.length > 0);
  }, [operators, mtValue]);

  if (loading) return <div className="skeleton" style={{ height: '500px' }} />;

  const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  return (
    <div>
      {toast && <div className="toast-container"><div className={`toast toast-${toast.type}`}>{toast.message}</div></div>}

      <div className="page-header">
        <div>
          <h1>Modelo de Escala</h1>
          <p>Escala mensal — clique numa célula para escolher os eventos do dia</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}><ChevronLeft size={18} /></button>
          <span style={{ fontWeight: 600, textTransform: 'capitalize', minWidth: '140px', textAlign: 'center' }}>{format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</span>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}><ChevronRight size={18} /></button>
          <button className="btn btn-ghost btn-sm" onClick={() => setCurrentMonth(new Date())}>Hoje</button>
        </div>
      </div>

      {canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Função ao escalar:</span>
          <select className="input" style={{ width: 'auto', padding: '6px 10px', fontSize: '13px' }} value={cellRole} onChange={(e) => setCellRole(e.target.value)}>
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginLeft: '8px' }}>Hora:</span>
          <input className="input" type="time" style={{ width: '120px' }} value={cellTime} onChange={(e) => setCellTime(e.target.value)} />
          {saving && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>salvando…</span>}
        </div>
      )}

      <div className="table-container" style={{ overflowX: 'auto', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
        <table className="table" style={{ fontSize: '11.5px', borderCollapse: 'collapse', minWidth: `${260 + days.length * 88}px` }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: 'var(--bg-surface-elevated)', zIndex: 2, textAlign: 'left', minWidth: '160px' }}>Operador</th>
              {days.map((d) => {
                const dow = getDay(d);
                const red = dow === 0 || dow === 6 || isHoliday(d);
                const today = isSameDay(d, new Date());
                return (
                  <th key={d.toISOString()} style={{ textAlign: 'center', padding: '4px 2px', minWidth: '84px', color: today ? 'var(--primary)' : red ? '#ef4444' : 'var(--text-secondary)', background: isHoliday(d) ? 'rgba(239,68,68,0.06)' : undefined }}>
                    <div style={{ fontSize: '12px', fontWeight: today ? 700 : 500 }}>{format(d, 'd')}</div>
                    <div style={{ fontSize: '9px', opacity: 0.8 }}>{isHoliday(d) ? 'Fer' : WEEKDAY[dow]}</div>
                  </th>
                );
              })}
              {weeks.labels.map((w) => (
                <th key={w} style={{ textAlign: 'center', minWidth: '52px', background: '#EAF3DE', color: '#3B6D11' }}>{w}</th>
              ))}
              <th style={{ textAlign: 'center', minWidth: '70px', background: 'var(--bg-surface-elevated)' }}>Mês</th>
            </tr>
          </thead>
          <tbody>
            {/* ===== Técnica / Estúdio: definição dos leilões do dia ===== */}
            <tr>
              <td colSpan={days.length + 2 + weeks.labels.length} style={{ background: 'var(--bg-surface-elevated)', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', padding: '5px 10px' }}>
                <Monitor size={12} style={{ verticalAlign: 'middle', marginRight: '6px' }} />Técnica / Estúdio — leilões do dia
              </td>
            </tr>
            {/* Externas */}
            <tr>
              <td style={{ position: 'sticky', left: 0, background: 'var(--bg-surface)', zIndex: 1, fontWeight: 500, whiteSpace: 'nowrap' }}>RW / Externas</td>
              {days.map((d) => {
                const k = dayKey(d);
                const dow = getDay(d);
                const red = dow === 0 || dow === 6 || isHoliday(d);
                const exts = externalByDay.get(k) || [];
                return (
                  <td key={k} style={{ verticalAlign: 'top', padding: '3px 4px', background: exts.length ? 'rgba(216,90,48,0.10)' : red ? 'rgba(239,68,68,0.05)' : undefined }}>
                    {exts.map((e) => (
                      <div key={e.id} title={`${e.title}${e.city ? ' — ' + e.city : ''}`} style={{ fontSize: '10px', fontWeight: 500, lineHeight: 1.2, marginBottom: '2px' }}>
                        {e.title.replace(/^LIVE \| /, '')}{e.city ? <span style={{ color: 'var(--text-muted)' }}> · {e.city}</span> : null}
                      </div>
                    ))}
                  </td>
                );
              })}
              {weeks.labels.map((w) => <td key={w} style={{ background: '#EAF3DE' }} />)}
              <td />
            </tr>
            {/* Estúdios 1-4 */}
            {STUDIO_SLOTS.map((slot, si) => (
              <tr key={slot}>
                <td style={{ position: 'sticky', left: 0, background: 'var(--bg-surface)', zIndex: 1, fontWeight: 500, whiteSpace: 'nowrap' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>E{si + 1}</span> · Estúdio {si + 1}
                </td>
                {days.map((d) => {
                  const k = dayKey(d);
                  const dow = getDay(d);
                  const red = dow === 0 || dow === 6 || isHoliday(d);
                  const cellEvts = studioSlotGrid.get(slot)?.get(k) || [];
                  const isOpen = openCell?.rowId === `studio:${slot}` && openCell?.key === k;
                  return (
                    <td
                      key={k}
                      onClick={() => canEdit && setOpenCell(isOpen ? null : { rowId: `studio:${slot}`, key: k })}
                      style={{ position: 'relative', verticalAlign: 'top', padding: '3px 4px', cursor: canEdit ? 'pointer' : 'default', background: cellEvts.length ? 'rgba(99,102,241,0.10)' : red ? 'rgba(239,68,68,0.05)' : undefined, outline: isOpen ? '2px solid var(--accent)' : undefined }}
                    >
                      {cellEvts.map((e) => (
                        <div key={e.id} title={e.title} style={{ fontSize: '10px', fontWeight: 500, lineHeight: 1.2, marginBottom: '2px' }}>
                          {e.title.replace(/^LIVE \| /, '')}
                        </div>
                      ))}
                      {isOpen && (
                        <StudioPicker
                          dayStudioEvents={studioEventsByDay.get(k) || []}
                          slot={slot}
                          onToggle={(e) => assignStudioSlot(e, slot)}
                          onClose={() => setOpenCell(null)}
                        />
                      )}
                    </td>
                  );
                })}
                {weeks.labels.map((w) => <td key={w} style={{ background: '#EAF3DE' }} />)}
                <td />
              </tr>
            ))}

            {groups.map((g) => (
              <FragmentGroup key={g.key}>
                <tr>
                  <td colSpan={days.length + 2 + weeks.labels.length} style={{ background: 'var(--bg-surface-elevated)', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', padding: '5px 10px' }}>
                    <g.icon size={12} style={{ verticalAlign: 'middle', marginRight: '6px' }} />{g.label}
                  </td>
                </tr>
                {g.ops.map((op) => (
                  <tr key={op.id}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--bg-surface)', zIndex: 1, fontWeight: 500, whiteSpace: 'nowrap' }}>{firstName(op.name)}</td>
                    {days.map((d) => {
                      const k = dayKey(d);
                      const dow = getDay(d);
                      const red = dow === 0 || dow === 6 || isHoliday(d);
                      // Escala de operadores: só eventos de estúdio (sem externas/retransmissões).
                      const cell = (enrichedGrid.get(op.id)?.get(k) || []).filter((c) => isStudioEvent(c.evt));
                      const note = notes.get(`${op.id}|${k}`);
                      const rest = isOperatorRestDay(op, d);
                      const isOpen = openCell?.rowId === op.id && openCell?.key === k;
                      return (
                        <td
                          key={k}
                          onClick={() => canEdit && setOpenCell(isOpen ? null : { rowId: op.id, key: k })}
                          title={rest ? 'Folga' : undefined}
                          style={{
                            position: 'relative', verticalAlign: 'top', padding: '3px 4px', cursor: canEdit ? 'pointer' : 'default',
                            background: cell.length ? 'var(--primary-light)' : note ? 'var(--bg-surface-elevated)' : red ? 'rgba(239,68,68,0.05)' : rest ? 'rgba(239,68,68,0.08)' : undefined,
                            outline: isOpen ? '2px solid var(--primary)' : undefined,
                          }}
                        >
                          {cell.map(({ evt, a }) => {
                            return (
                              <div key={evt.id} style={{ marginBottom: '3px', lineHeight: 1.2 }}>
                                <div style={{ fontSize: '10px', fontWeight: 500 }} title={evt.title}>
                                  {evt.studioName ? <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{evt.studioName} · </span> : ''}{evt.title.replace(/^LIVE \| /, '')}
                                </div>
                                {(a.shiftTime || evt.date) && (
                                  <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{a.shiftTime || format(toDate(evt.date), 'HH:mm')}</div>
                                )}
                              </div>
                            );
                          })}
                          {note && (
                            <div style={{ fontSize: '9.5px', color: 'var(--text-secondary)', fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '58px' }} title={note}>{note}</div>
                          )}
                          {rest && cell.length === 0 && !note && <span style={{ fontSize: '9px', color: '#ef4444' }}>Folga</span>}

                          {isOpen && (
                            <CellPicker
                              dayEvents={(eventsByDay.get(k) || []).filter(isStudioEvent)}
                              operatorId={op.id}
                              note={note || ''}
                              onSaveNote={(label) => saveNote(op.id, k, label)}
                              onToggle={(evt) => toggleAssign(evt, op)}
                              onClose={() => setOpenCell(null)}
                            />
                          )}
                        </td>
                      );
                    })}
                    {weeks.labels.map((w, i) => {
                      const wt = weekTotals.get(op.id)?.[i] || 0;
                      return (
                        <td key={w} style={{ textAlign: 'center', background: '#EAF3DE', color: wt > 0 ? '#3B6D11' : 'rgba(59,109,17,0.4)', fontWeight: 600 }}>
                          {wt > 0 ? Math.round(wt) : '—'}
                        </td>
                      );
                    })}
                    {(() => { const mt = monthTotals.get(op.id) || 0; return (
                    <td style={{ textAlign: 'center', fontWeight: 700, color: mt > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>
                      {mt > 0 ? `R$ ${Math.round(mt)}` : '—'}
                    </td>
                    ); })()}
                  </tr>
                ))}
              </FragmentGroup>
            ))}
            {operators.length === 0 && (
              <tr><td colSpan={days.length + 2 + weeks.labels.length} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Nenhum operador ativo cadastrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '10px' }}>
        Escala de operadores mostra apenas eventos de estúdio (externas ficam na seção do topo; retransmissões não escalam equipe) · totais Semana/Mês em R$ (estimado/real, MT = R$ {mtValue} fixo) · colunas em vermelho = fim de semana/feriado.
      </p>
    </div>
  );
}

function FragmentGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/* Dropdown da célula: eventos do dia (externo + estúdio) + rótulo manual de atividade. */
const QUICK_ACTIVITIES = ['Viagem', 'Montagem', 'Folga', 'Bora'];
function CellPicker({
  dayEvents, operatorId, note, onToggle, onSaveNote, onClose,
}: {
  dayEvents: EventWithId[];
  operatorId: string;
  note: string;
  onToggle: (evt: EventWithId) => void;
  onSaveNote: (label: string) => void;
  onClose: () => void;
}) {
  const [noteInput, setNoteInput] = useState(note);
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', zIndex: 30, marginTop: '4px', left: 0, minWidth: '230px',
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)', padding: '8px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)' }}>Eventos do dia</span>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} style={{ padding: '2px' }}><X size={13} /></button>
      </div>
      {dayEvents.length === 0 ? (
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '6px 0' }}>Nenhum evento neste dia.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '220px', overflowY: 'auto' }}>
          {dayEvents.map((evt) => {
            const checked = (evt.assignments || []).some((a) => a.operatorId === operatorId);
            const ext = evt.operationType === 'externo';
            return (
              <label key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', cursor: 'pointer', padding: '4px 6px', borderRadius: 'var(--radius-sm)', background: checked ? 'var(--primary-light)' : 'var(--bg-surface-elevated)' }}>
              <input type="checkbox" checked={checked} onChange={() => onToggle(evt)} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                    {evt.title.replace(/^LIVE \| /, '')}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {format(toDate(evt.date), 'HH:mm')} · {ext ? 'externo' : evt.studioName || 'estúdio'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)', marginTop: '8px', paddingTop: '8px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)' }}>Atividade (sem evento)</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '6px 0' }}>
          {QUICK_ACTIVITIES.map((q) => (
            <button key={q} className="btn btn-ghost btn-sm" style={{ fontSize: '10.5px', padding: '2px 8px' }} onClick={() => { setNoteInput(q); onSaveNote(q); }}>{q}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            className="input"
            placeholder="ex: Montar para Kaue"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSaveNote(noteInput); }}
            style={{ flex: 1, fontSize: '11.5px', padding: '4px 8px' }}
          />
          <button className="btn btn-primary btn-sm" style={{ fontSize: '11px' }} onClick={() => onSaveNote(noteInput)}>OK</button>
          {note && <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px', color: 'var(--error)' }} onClick={() => { setNoteInput(''); onSaveNote(''); }}>Limpar</button>}
        </div>
      </div>
    </div>
  );
}

/* Dropdown da célula de estúdio: leilões "de estúdio" do dia para definir no slot E1-E4. */
function StudioPicker({
  dayStudioEvents, slot, onToggle, onClose,
}: {
  dayStudioEvents: EventWithId[];
  slot: string;
  onToggle: (evt: EventWithId) => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', zIndex: 30, marginTop: '4px', left: 0, minWidth: '230px',
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)', padding: '8px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)' }}>Leilões de estúdio · {slot}</span>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} style={{ padding: '2px' }}><X size={13} /></button>
      </div>
      {dayStudioEvents.length === 0 ? (
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '6px 0' }}>Nenhum leilão de estúdio neste dia.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '220px', overflowY: 'auto' }}>
          {dayStudioEvents.map((evt) => {
            const here = (evt.studioName || '') === slot;
            const elsewhere = !!evt.studioName && !here;
            return (
              <label key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', cursor: 'pointer', padding: '4px 6px', borderRadius: 'var(--radius-sm)', background: here ? 'var(--primary-light)' : 'var(--bg-surface-elevated)' }}>
                <input type="checkbox" checked={here} onChange={() => onToggle(evt)} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                    {evt.title.replace(/^LIVE \| /, '')}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {format(toDate(evt.date), 'HH:mm')}{elsewhere ? ` · já em ${evt.studioName}` : ''}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
