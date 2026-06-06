'use client';

import { useEffect, useState, Fragment } from 'react';
import { getEvents } from '@/services/events';
import { getOperators } from '@/services/operators';
import { getDocument, getCollection } from '@/lib/firestore';
import { calculateOperatorPayment } from '@/lib/payment-engine';
import { GestaoEvent, OPERATION_TYPE_LABELS, OPERATION_TYPE_BADGE } from '@/types/event';
import { Operator } from '@/types/operator';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DollarSign, TrendingUp, TrendingDown, Calendar, ChevronDown, ChevronUp } from 'lucide-react';

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) return (val as { toDate: () => Date }).toDate();
  if (typeof val === 'string') return parseISO(val);
  return new Date();
}

export default function FinanceiroPage() {
  const [events, setEvents] = useState<(GestaoEvent & { id: string })[]>([]);
  const [operators, setOperators] = useState<(Operator & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [defaultRulesFunc, setDefaultRulesFunc] = useState<any>(null);
  const [defaultRulesN1, setDefaultRulesN1] = useState<any>(null);
  const [defaultRulesN2, setDefaultRulesN2] = useState<any>(null);
  const [fixedValues, setFixedValues] = useState<Record<string, number>>({});
  const [holidays, setHolidays] = useState<any[]>([]);

  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return format(d, 'yyyy-MM-dd');
  });
  const [periodEnd, setPeriodEnd] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return format(d, 'yyyy-MM-dd');
  });

  useEffect(() => {
    async function load() {
      try {
        const [evts, ops, funcDoc, n1Doc, n2Doc, svcDoc, hols] = await Promise.all([
          getEvents(),
          getOperators(),
          getDocument<any>('settings', 'default_rules_funcionario').catch(() => null),
          getDocument<any>('settings', 'default_rules_freelancer_n1').catch(() => null),
          getDocument<any>('settings', 'default_rules_freelancer_n2').catch(() => null),
          getDocument<any>('settings', 'services').catch(() => null),
          getCollection<any>('holidays').catch(() => []),
        ]);
        setEvents(evts);
        setOperators(ops);
        if (funcDoc) setDefaultRulesFunc({ ...funcDoc, contractType: 'funcionario' });
        if (n1Doc) setDefaultRulesN1({ ...n1Doc, contractType: 'freelancer_n1' });
        if (n2Doc) setDefaultRulesN2({ ...n2Doc, contractType: 'freelancer_n2' });
        if (svcDoc?.catalog) {
          const { serviceFixedValues } = await import('@/types/service');
          setFixedValues(serviceFixedValues(svcDoc.catalog));
        }
        setHolidays(hols);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filteredEvents = events.filter((e) => {
    const d = toDate(e.date);
    return d >= new Date(periodStart) && d <= new Date(periodEnd + 'T23:59:59');
  });

  // Calculate payments per operator and event team cost map
  const operatorPayments: Record<string, { name: string; total: number; events: { title: string; value: number; rule: string }[] }> = {};
  const eventTeamCostMap: Record<string, number> = {};

  filteredEvents.forEach((evt) => {
    if (evt.status !== 'finalizado' || !evt.closing) return;

    let eventTeamTotal = 0;

    (evt.assignments || []).forEach((a) => {
      const op = operators.find((o) => o.id === a.operatorId);

      // Regras do operador — usa custom se tiver hourRanges válidos; caso contrário cai no padrão.
      let rules = (op?.paymentRules?.hourRanges?.length ?? 0) > 0 ? op?.paymentRules : null;
      if (!rules && op?.contractType) {
        if (op.contractType === 'funcionario') rules = defaultRulesFunc;
        else if (op.contractType === 'freelancer_n1') rules = defaultRulesN1;
        else if (op.contractType === 'freelancer_n2') rules = defaultRulesN2;
      }
      // Se tem regra customizada mas sem hourRanges, herda hourRanges do padrão
      if (op?.paymentRules && !(op.paymentRules.hourRanges?.length) && rules) {
        rules = { ...rules, ...op.paymentRules, hourRanges: rules.hourRanges };
      }

      if (!rules) return;

      // Somente eventos onde ESTE operador está escalado (evita split errado de diária múltipla)
      const allAssignmentsInPeriod = events
        .filter((e) => (e.assignments || []).some((assign) => assign.operatorId === a.operatorId))
        .map((e) => ({ eventId: e.id, date: toDate(e.date), operationType: e.operationType }));

      try {
        const pay = calculateOperatorPayment(evt, a, rules, holidays, allAssignmentsInPeriod, defaultRulesN2, fixedValues);
        const value = pay.totalValue;
        const rule = pay.ruleApplied;

        if (!operatorPayments[a.operatorId]) {
          operatorPayments[a.operatorId] = { name: op?.name || a.operatorName || 'Operador', total: 0, events: [] };
        }
        operatorPayments[a.operatorId].total += value;
        operatorPayments[a.operatorId].events.push({ title: evt.title, value, rule });

        eventTeamTotal += value;
      } catch (err) {
        console.error('Erro ao calcular pagamento:', a.operatorName, err);
      }
    });

    if (evt.id) {
      eventTeamCostMap[evt.id] = eventTeamTotal;
    }
  });

  const getEventExpenses = (evt: GestaoEvent) => {
    const directExpenses = (evt.expenses || []).reduce((s, e) => s + (e.amount || 0), 0);
    const planningVehicleCost = evt.planning?.vehicle?.totalCost || 0;
    const planningHotelCost = evt.planning?.hotel?.totalCost || 0;
    const planningCost = planningVehicleCost + planningHotelCost;
    const teamCost = evt.id ? (eventTeamCostMap[evt.id] || 0) : 0;
    return directExpenses + planningCost + teamCost;
  };

  const totalRevenue = filteredEvents.reduce((s, e) => s + (e.actualRevenue || e.revenue || 0), 0);
  const totalExpenses = filteredEvents.reduce((s, e) => s + getEventExpenses(e), 0);
  const totalPayments = Object.values(operatorPayments).reduce((s, p) => s + p.total, 0);
  const netResult = totalRevenue - totalExpenses;

  if (loading) return <div className="skeleton" style={{ height: '500px' }} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Financeiro</h1>
          <p>Resumo financeiro consolidado</p>
        </div>
        <div className="date-range-group">
          <input className="input" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} style={{ width: 'auto' }} />
          <span style={{ color: 'var(--text-muted)' }}>até</span>
          <input className="input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} style={{ width: 'auto' }} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid-stats">
        <div className="card-stat">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-label">Receita Total</span>
            <TrendingUp size={20} style={{ color: 'var(--success)' }} />
          </div>
          <span className="stat-value" style={{ color: 'var(--success)' }}>R$ {totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="card-stat">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-label">Despesas Operacionais</span>
            <TrendingDown size={20} style={{ color: 'var(--warning)' }} />
          </div>
          <span className="stat-value" style={{ color: 'var(--warning)' }}>R$ {(totalExpenses - totalPayments).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="card-stat">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-label">Pagamentos Equipe</span>
            <DollarSign size={20} style={{ color: 'var(--accent)' }} />
          </div>
          <span className="stat-value" style={{ color: 'var(--accent)' }}>R$ {totalPayments.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="card-stat">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-label">Resultado Líquido</span>
            {netResult >= 0 ? <TrendingUp size={20} style={{ color: 'var(--success)' }} /> : <TrendingDown size={20} style={{ color: 'var(--error)' }} />}
          </div>
          <span className="stat-value" style={{ color: netResult >= 0 ? 'var(--success)' : 'var(--error)' }}>
            R$ {netResult.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Events breakdown */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Eventos no Período ({filteredEvents.length})</h3>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '32px' }}></th>
                <th style={{ whiteSpace: 'nowrap', width: '90px' }}>Data</th>
                <th>Evento</th>
                <th style={{ whiteSpace: 'nowrap', width: '120px' }}>Tipo</th>
                <th style={{ textAlign: 'right', whiteSpace: 'nowrap', width: '110px' }}>Receita</th>
                <th style={{ textAlign: 'right', whiteSpace: 'nowrap', width: '110px' }}>Despesas</th>
                <th style={{ textAlign: 'right', whiteSpace: 'nowrap', width: '110px' }}>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((evt) => {
                const d = toDate(evt.date);
                const evtRevenue = evt.actualRevenue || evt.revenue || 0;
                const evtExpenses = (evt.expenses || []).reduce((s, e) => s + (e.amount || 0), 0);
                const isExpanded = expandedEvent === evt.id;

                return (
                  <Fragment key={evt.id}>
                    <tr onClick={() => setExpandedEvent(isExpanded ? null : evt.id)} style={{ cursor: 'pointer' }}>
                      <td>{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{format(d, 'dd/MM/yy')}</td>
                      <td style={{ fontWeight: 500 }}>{evt.title}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className={`badge ${evt.operationType ? OPERATION_TYPE_BADGE[evt.operationType] : 'badge-info'}`}>
                          {evt.operationType ? OPERATION_TYPE_LABELS[evt.operationType] : 'N/D'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--success)', whiteSpace: 'nowrap' }}>R$ {evtRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'right', color: 'var(--warning)', whiteSpace: 'nowrap' }}>R$ {evtExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: (evtRevenue - evtExpenses) >= 0 ? 'var(--success)' : 'var(--error)' }}>
                        R$ {(evtRevenue - evtExpenses).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${evt.id}-detail`}>
                        <td colSpan={7} style={{ padding: '16px', background: 'var(--bg-surface-elevated)' }}>
                          <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <div>
                              <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>Operadores</h4>
                              {(evt.assignments || []).map((a, i) => (
                                <div key={i} style={{ fontSize: '13px', marginBottom: '4px' }}>
                                  {a.operatorName} — <span className="badge badge-info" style={{ fontSize: '10px' }}>{a.role === 'operador_principal' ? 'Principal' : 'Auxiliar'}</span>
                                </div>
                              ))}
                              {(evt.assignments || []).length === 0 && <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Sem equipe</p>}
                            </div>
                             <div>
                              <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>Despesas Detalhadas</h4>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                  <span>Despesas Diretas:</span>
                                  <span style={{ fontWeight: 500 }}>R$ {(evt.expenses || []).reduce((s, e) => s + (e.amount || 0), 0).toLocaleString('pt-BR')}</span>
                                </div>
                                {evt.id && eventTeamCostMap[evt.id] > 0 && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                    <span>Remuneração Equipe:</span>
                                    <span style={{ fontWeight: 500 }}>R$ {eventTeamCostMap[evt.id].toLocaleString('pt-BR')}</span>
                                  </div>
                                )}
                                {(evt.planning?.vehicle?.totalCost || 0) + (evt.planning?.hotel?.totalCost || 0) > 0 && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                    <span>Viagem/Deslocamentos:</span>
                                    <span style={{ fontWeight: 500 }}>R$ {((evt.planning?.vehicle?.totalCost || 0) + (evt.planning?.hotel?.totalCost || 0)).toLocaleString('pt-BR')}</span>
                                  </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '4px', marginTop: '4px', fontWeight: 600 }}>
                                  <span>Total Custos:</span>
                                  <span style={{ color: 'var(--warning)' }}>R$ {evtExpenses.toLocaleString('pt-BR')}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Operator payments summary */}
      <div className="card">
        <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Resumo por Operador</h3>
        {Object.keys(operatorPayments).length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhum pagamento calculado. Finalize eventos com equipe escalada.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Operador</th><th className="hide-on-mobile">Eventos</th><th style={{ textAlign: 'right' }}>Total a Pagar</th></tr></thead>
              <tbody>
                {Object.entries(operatorPayments).map(([opId, data]) => (
                  <tr key={opId}>
                    <td style={{ fontWeight: 500 }}>{data.name}</td>
                    <td className="hide-on-mobile">
                      {data.events.map((e, i) => (
                        <div key={i} style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {e.title} — {e.rule} — <span style={{ color: 'var(--success)' }}>R$ {e.value.toLocaleString('pt-BR')}</span>
                        </div>
                      ))}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '16px', color: 'var(--success)' }}>
                      R$ {data.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
