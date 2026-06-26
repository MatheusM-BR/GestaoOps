'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { getEvents, assignOperator, removeAssignment } from '@/services/events';
import { getActiveOperators } from '@/services/operators';
import { getDocument, getCollection } from '@/lib/firestore';
import { GestaoEvent, EventAssignment } from '@/types/event';
import { Operator, PaymentRules, isOperatorRestDay } from '@/types/operator';
import { calculateOperatorPayment } from '@/lib/payment-engine';
import { Holiday } from '@/types/payment';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, addMonths, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X, Monitor, Users, MapPin } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

type EventWithId = GestaoEvent & { id: string };
type OperatorWithId = Operator & { id: string };

const MT_DEFAULT_VALUE = 450; // Estúdio MT (Cuiabá) — valor fixo por evento (configurável)

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);

  // Célula aberta (operador × dia) e função/hora a aplicar.
  const [openCell, setOpenCell] = useState<{ opId: string; key: string } | null>(null);
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
      const [evts, ops, rolesDoc, funcDoc, n1Doc, n2Doc, svcDoc, mtDoc, hols] = await Promise.all([
        getEvents().catch(() => [] as EventWithId[]),
        getActiveOperators().catch(() => [] as OperatorWithId[]),
        getDocument<{ list: string[] }>('settings', 'roles').catch(() => null),
        getDocument<PaymentRules>('settings', 'default_rules_funcionario').catch(() => null),
        getDocument<PaymentRules>('settings', 'default_rules_freelancer_n1').catch(() => null),
        getDocument<PaymentRules>('settings', 'default_rules_freelancer_n2').catch(() => null),
        getDocument<{ catalog?: unknown }>('settings', 'services').catch(() => null),
        getDocument<{ value: number }>('settings', 'mt_studio').catch(() => null),
        getCollection<{ date: string }>('holidays').catch(() => []),
      ]);
      setEvents(evts);
      setOperators(ops);
      setHolidays(hols);
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

  // Valor de uma escala: real se o evento foi encerrado, senão estimado (pela duração prevista).
  const valueFor = useCallback((evt: EventWithId, a: EventAssignment, op?: OperatorWithId): { value: number; isReal: boolean } => {
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
    const allAssignmentsInPeriod = events
      .filter((e) => (e.assignments || []).some((x) => x.operatorId === a.operatorId))
      .map((e) => ({ eventId: e.id, date: toDate(e.date), operationType: e.operationType }));
    try {
      const pay = calculateOperatorPayment(evtForCalc, a, rules, holidays as unknown as Holiday[], allAssignmentsInPeriod, rulesN2, fixedValues);
      return { value: pay.totalValue, isReal };
    } catch {
      return { value: 0, isReal };
    }
  }, [events, holidays, fixedValues, mtValue, resolveRules, rulesN2]);

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

  // Mapa operador → dia → escalas (eventos onde está escalado naquele dia).
  const grid = useMemo(() => {
    const m = new Map<string, Map<string, { evt: EventWithId; a: EventAssignment }[]>>();
    for (const e of events) {
      const k = dayKey(toDate(e.date));
      for (const a of e.assignments || []) {
        if (!m.has(a.operatorId)) m.set(a.operatorId, new Map());
        const dm = m.get(a.operatorId)!;
        if (!dm.has(k)) dm.set(k, []);
        dm.get(k)!.push({ evt: e, a });
      }
    }
    return m;
  }, [events]);

  const monthTotal = useCallback((opId: string) => {
    const dm = grid.get(opId);
    if (!dm) return 0;
    const op = operators.find((o) => o.id === opId);
    let total = 0;
    for (const [k, list] of dm) {
      const d = new Date(k);
      if (d < monthStart || d > monthEnd) continue;
      for (const { evt, a } of list) total += valueFor(evt, a, op).value;
    }
    return total;
  }, [grid, operators, monthStart, monthEnd, valueFor]);

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
        <table className="table" style={{ fontSize: '11.5px', borderCollapse: 'collapse', minWidth: `${260 + days.length * 64}px` }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: 'var(--bg-surface-elevated)', zIndex: 2, textAlign: 'left', minWidth: '160px' }}>Operador</th>
              {days.map((d) => {
                const dow = getDay(d);
                const red = dow === 0 || dow === 6 || isHoliday(d);
                const today = isSameDay(d, new Date());
                return (
                  <th key={d.toISOString()} style={{ textAlign: 'center', padding: '4px 2px', minWidth: '62px', color: today ? 'var(--primary)' : red ? '#ef4444' : 'var(--text-secondary)', background: isHoliday(d) ? 'rgba(239,68,68,0.06)' : undefined }}>
                    <div style={{ fontSize: '12px', fontWeight: today ? 700 : 500 }}>{format(d, 'd')}</div>
                    <div style={{ fontSize: '9px', opacity: 0.8 }}>{isHoliday(d) ? 'Fer' : WEEKDAY[dow]}</div>
                  </th>
                );
              })}
              <th style={{ textAlign: 'center', minWidth: '70px', background: 'var(--bg-surface-elevated)' }}>Mês</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <FragmentGroup key={g.key}>
                <tr>
                  <td colSpan={days.length + 2} style={{ background: 'var(--bg-surface-elevated)', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', padding: '5px 10px' }}>
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
                      const cell = grid.get(op.id)?.get(k) || [];
                      const rest = isOperatorRestDay(op, d);
                      const isOpen = openCell?.opId === op.id && openCell?.key === k;
                      return (
                        <td
                          key={k}
                          onClick={() => canEdit && setOpenCell(isOpen ? null : { opId: op.id, key: k })}
                          title={rest ? 'Folga' : undefined}
                          style={{
                            position: 'relative', verticalAlign: 'top', padding: '3px 4px', cursor: canEdit ? 'pointer' : 'default',
                            background: cell.length ? 'var(--primary-light)' : red ? 'rgba(239,68,68,0.05)' : rest ? 'rgba(239,68,68,0.08)' : undefined,
                            outline: isOpen ? '2px solid var(--primary)' : undefined,
                          }}
                        >
                          {cell.map(({ evt, a }) => {
                            const { value, isReal } = valueFor(evt, a, op);
                            return (
                              <div key={evt.id} style={{ marginBottom: '2px', lineHeight: 1.15 }}>
                                <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '58px' }} title={evt.title}>
                                  {evt.studioName ? `${evt.studioName} · ` : ''}{evt.title.replace(/^LIVE \| /, '')}
                                </div>
                                {(a.shiftTime || evt.date) && (
                                  <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{a.shiftTime || format(toDate(evt.date), 'HH:mm')}</div>
                                )}
                                <div style={{ fontSize: '10px', fontWeight: 600, color: value === 0 ? 'var(--text-muted)' : isReal ? 'var(--success)' : 'var(--text-secondary)' }}>
                                  {value === 0 ? 'R$ 0' : `${isReal ? '' : '~'}R$ ${Math.round(value)}`}
                                </div>
                              </div>
                            );
                          })}
                          {rest && cell.length === 0 && <span style={{ fontSize: '9px', color: '#ef4444' }}>Folga</span>}

                          {isOpen && (
                            <CellPicker
                              dayEvents={eventsByDay.get(k) || []}
                              operatorId={op.id}
                              onToggle={(evt) => toggleAssign(evt, op)}
                              onClose={() => setOpenCell(null)}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center', fontWeight: 700, color: monthTotal(op.id) > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>
                      {monthTotal(op.id) > 0 ? `R$ ${Math.round(monthTotal(op.id))}` : '—'}
                    </td>
                  </tr>
                ))}
              </FragmentGroup>
            ))}
            {operators.length === 0 && (
              <tr><td colSpan={days.length + 2} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Nenhum operador ativo cadastrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '10px' }}>
        Valor <b>~R$</b> = estimado pela duração prevista · <b style={{ color: 'var(--success)' }}>R$</b> verde = real (evento encerrado) · MT = R$ {mtValue} fixo · colunas em vermelho = fim de semana/feriado.
      </p>
    </div>
  );
}

function FragmentGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/* Dropdown da célula: eventos do dia (externo + estúdio) para escalar/desescalar. */
function CellPicker({
  dayEvents, operatorId, onToggle, onClose,
}: {
  dayEvents: EventWithId[];
  operatorId: string;
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
    </div>
  );
}
