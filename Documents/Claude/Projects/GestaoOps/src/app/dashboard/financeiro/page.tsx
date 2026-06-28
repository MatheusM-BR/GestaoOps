'use client';

import { useEffect, useState, Fragment } from 'react';
import { getEvents } from '@/services/events';
import { getOperators } from '@/services/operators';
import { getCompanies } from '@/services/companies';
import { getCostCenters } from '@/services/costCenters';
import { getDocument, getCollection } from '@/lib/firestore';
import { calculateOperatorPayment, toSafeDate } from '@/lib/payment-engine';
import { GestaoEvent, OPERATION_TYPE_LABELS, OPERATION_TYPE_BADGE } from '@/types/event';
import { Operator, PaymentProfile } from '@/types/operator';
import { getPaymentProfiles } from '@/services/paymentProfiles';
import { resolvePaymentRules } from '@/lib/resolve-payment-rules';
import { Company, CostCenter } from '@/types/company';
import { format, parseISO, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DollarSign, TrendingUp, TrendingDown, Calendar, ChevronDown, ChevronUp, Download, Plane } from 'lucide-react';
import * as XLSX from 'xlsx';

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
  const [companies, setCompanies] = useState<(Company & { id: string })[]>([]);
  const [costCenters, setCostCenters] = useState<(CostCenter & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [defaultRulesFunc, setDefaultRulesFunc] = useState<any>(null);
  const [defaultRulesN1, setDefaultRulesN1] = useState<any>(null);
  const [defaultRulesN2, setDefaultRulesN2] = useState<any>(null);
  const [fixedValues, setFixedValues] = useState<Record<string, number>>({});
  const [holidays, setHolidays] = useState<any[]>([]);
  const [paymentProfiles, setPaymentProfiles] = useState<(PaymentProfile & { id: string })[]>([]);

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
        const [evts, ops, funcDoc, n1Doc, n2Doc, svcDoc, hols, comps, ccs, profs] = await Promise.all([
          getEvents(),
          getOperators(),
          getDocument<any>('settings', 'default_rules_funcionario').catch(() => null),
          getDocument<any>('settings', 'default_rules_freelancer_n1').catch(() => null),
          getDocument<any>('settings', 'default_rules_freelancer_n2').catch(() => null),
          getDocument<any>('settings', 'services').catch(() => null),
          getCollection<any>('holidays').catch(() => []),
          getCompanies().catch(() => []),
          getCostCenters().catch(() => []),
          getPaymentProfiles().catch(() => [] as (PaymentProfile & { id: string })[]),
        ]);
        setEvents(evts);
        setOperators(ops);
        setCompanies(comps);
        setCostCenters(ccs);
        if (funcDoc) setDefaultRulesFunc({ ...funcDoc, contractType: 'funcionario' });
        if (n1Doc) setDefaultRulesN1({ ...n1Doc, contractType: 'freelancer_n1' });
        if (n2Doc) setDefaultRulesN2({ ...n2Doc, contractType: 'freelancer_n2' });
        setPaymentProfiles(profs);
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
  const operatorPayments: Record<string, { name: string; total: number; events: { title: string; value: number; rule: string; date: Date }[] }> = {};
  const eventTeamCostMap: Record<string, number> = {};

  filteredEvents.forEach((evt) => {
    // Sem "fechamento": conta pelos horários do evento (date→endDate) no período.
    let eventTeamTotal = 0;

    (evt.assignments || []).forEach((a) => {
      const op = operators.find((o) => o.id === a.operatorId);

      const rules = op ? resolvePaymentRules(op, paymentProfiles, defaultRulesFunc, defaultRulesN1, defaultRulesN2) : null;
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
        operatorPayments[a.operatorId].events.push({ title: evt.title, value, rule, date: toDate(evt.date) });

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

  // ── Projeção de diárias de viagem ──────────────────────────────────────────
  // Eventos com algum assignment que tenha diárias de deslocamento OU operationType=externo.
  // Agrupa por empresa → centro de custo → lista de linhas.
  interface TravelLine {
    eventId: string;
    eventTitle: string;
    eventDate: Date;
    companyId: string;
    companyName: string;
    costCenterId: string;
    costCenterName: string;
    operatorName: string;
    travelDaysBefore: number;
    travelDaysAfter: number;
    travelDayValue: number;  // valor dia leilão externo (0 para eventos estúdio)
    totalTravel: number;
  }

  const travelLines: TravelLine[] = [];

  // Para detectar múltiplos externos no mesmo dia por operador
  const extEventsByOpDay = new Map<string, { eventId: string; date: Date }[]>();
  events.forEach((evt) => {
    if (evt.operationType !== 'externo') return;
    (evt.assignments || []).forEach((a) => {
      const key = a.operatorId;
      if (!extEventsByOpDay.has(key)) extEventsByOpDay.set(key, []);
      extEventsByOpDay.get(key)!.push({ eventId: evt.id!, date: toSafeDate(evt.date) });
    });
  });

  filteredEvents.forEach((evt) => {
    const hasTravelOp = (evt.assignments || []).some(
      (a) => (a.travelDaysBefore || 0) + (a.travelDaysAfter || 0) > 0 || evt.operationType === 'externo',
    );
    if (!hasTravelOp) return;

    const comp = companies.find((c) => c.id === evt.companyId);
    const cc = costCenters.find((c) => c.id === evt.costCenterId);
    const companyName = comp?.name || evt.company || 'Sem empresa';
    const costCenterName = cc?.name || '—';
    const evtDate = toSafeDate(evt.date);

    (evt.assignments || []).forEach((a) => {
      const travelBefore = a.travelDaysBefore || 0;
      const travelAfter = a.travelDaysAfter || 0;
      const dislocDays = travelBefore + travelAfter;

      const op = operators.find((o) => o.id === a.operatorId);
      const rules = op ? resolvePaymentRules(op, paymentProfiles, defaultRulesFunc, defaultRulesN1, defaultRulesN2) : null;
      const dailyRate = (rules?.dailyTravel) ?? 200;
      const dailyRateMultiple = (rules?.dailyTravelMultiple) ?? 300;

      // Valor da diária do dia do leilão (se externo)
      let travelDayValue = 0;
      if (evt.operationType === 'externo') {
        const opExts = extEventsByOpDay.get(a.operatorId) || [];
        const sameDayOthers = opExts.filter((x) => x.eventId !== evt.id && isSameDay(x.date, evtDate));
        if (sameDayOthers.length > 0) {
          travelDayValue = dailyRateMultiple / (sameDayOthers.length + 1);
        } else {
          travelDayValue = dailyRate;
        }
      }

      const totalTravel = dislocDays * dailyRate + travelDayValue;
      if (totalTravel === 0 && dislocDays === 0) return;

      travelLines.push({
        eventId: evt.id!,
        eventTitle: evt.title,
        eventDate: evtDate,
        companyId: evt.companyId || '',
        companyName,
        costCenterId: evt.costCenterId || '',
        costCenterName,
        operatorName: a.operatorName || op?.name || 'Operador',
        travelDaysBefore: travelBefore,
        travelDaysAfter: travelAfter,
        travelDayValue,
        totalTravel,
      });
    });
  });

  const totalTravelProjection = travelLines.reduce((s, l) => s + l.totalTravel, 0);

  // Agrupamento: empresa → lista de linhas
  const travelByCompany = new Map<string, { companyName: string; color?: string; lines: TravelLine[] }>();
  travelLines.forEach((l) => {
    if (!travelByCompany.has(l.companyId)) {
      const comp = companies.find((c) => c.id === l.companyId);
      travelByCompany.set(l.companyId, { companyName: l.companyName, color: comp?.color, lines: [] });
    }
    travelByCompany.get(l.companyId)!.lines.push(l);
  });

  const handleExportTravel = () => {
    const rows: Record<string, string | number>[] = travelLines
      .slice()
      .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime())
      .map((l) => ({
        Data: format(l.eventDate, 'dd/MM/yyyy'),
        Empresa: l.companyName,
        'Centro de Custo': l.costCenterName,
        Evento: l.eventTitle.replace(/^LIVE \| /, ''),
        Operador: l.operatorName,
        'Dias Antes': l.travelDaysBefore,
        'Dias Depois': l.travelDaysAfter,
        'Diária Leilão': Number(l.travelDayValue.toFixed(2)),
        'Total Viagem': Number(l.totalTravel.toFixed(2)),
      }));
    if (rows.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ['Data', 'Empresa', 'Centro de Custo', 'Evento', 'Operador', 'Dias Antes', 'Dias Depois', 'Diária Leilão', 'Total Viagem'],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Diárias de Viagem');
    XLSX.writeFile(wb, `Diarias_Viagem_${periodStart}_${periodEnd}.xlsx`);
  };

  // ── Exporta o extrato por operador (cada leilão + valor) para Excel ─────────
  const handleExportOperators = () => {
    const rows: Record<string, string | number>[] = [];
    Object.values(operatorPayments)
      .sort((a, b) => b.total - a.total)
      .forEach((op) => {
        op.events
          .slice()
          .sort((a, b) => a.date.getTime() - b.date.getTime())
          .forEach((e) => {
            const evt = filteredEvents.find((ev) => ev.title === e.title && isSameDay(toSafeDate(ev.date), e.date));
            const comp = companies.find((c) => c.id === evt?.companyId);
            const cc = costCenters.find((c) => c.id === evt?.costCenterId);
            rows.push({
              Operador: op.name,
              Empresa: comp?.name || evt?.company || '—',
              'Centro de Custo': cc?.name || '—',
              Data: format(e.date, 'dd/MM/yyyy'),
              Leilão: e.title.replace(/^LIVE \| /, ''),
              Regra: e.rule,
              Valor: Number(e.value.toFixed(2)),
            });
          });
        rows.push({ Operador: op.name, Empresa: '', 'Centro de Custo': '', Data: '', Leilão: 'TOTAL', Regra: '', Valor: Number(op.total.toFixed(2)) });
        rows.push({});
      });
    if (rows.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['Operador', 'Empresa', 'Centro de Custo', 'Data', 'Leilão', 'Regra', 'Valor'] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Por Operador');
    XLSX.writeFile(wb, `Receitas_Operadores_${periodStart}_${periodEnd}.xlsx`);
  };

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

      {/* Projeção de Diárias de Viagem */}
      {travelLines.length > 0 && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ fontSize: '16px', margin: 0 }}>
                <Plane size={16} style={{ marginRight: '8px', verticalAlign: 'middle', color: 'var(--primary)' }} />
                Projeção de Diárias de Viagem
              </h3>
              <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Total projetado: <strong style={{ color: 'var(--warning)' }}>R$ {totalTravelProjection.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
              </p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={handleExportTravel} style={{ gap: '6px' }}>
              <Download size={15} /> Exportar
            </button>
          </div>

          {Array.from(travelByCompany.entries()).map(([compId, group]) => (
            <div key={compId} style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: group.color || '#6366f1', flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: '14px' }}>{group.companyName}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  R$ {group.lines.reduce((s, l) => s + l.totalTravel, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="table-container">
                <table className="table" style={{ fontSize: '12.5px' }}>
                  <thead>
                    <tr>
                      <th style={{ whiteSpace: 'nowrap' }}>Data</th>
                      <th>Evento</th>
                      <th>Centro de Custo</th>
                      <th>Operador</th>
                      <th style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>Dias Antes</th>
                      <th style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>Dias Depois</th>
                      <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Diária Leilão</th>
                      <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.lines
                      .slice()
                      .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime())
                      .map((l, i) => (
                        <tr key={i}>
                          <td style={{ whiteSpace: 'nowrap' }}>{format(l.eventDate, 'dd/MM/yy')}</td>
                          <td style={{ fontWeight: 500 }}>{l.eventTitle.replace(/^LIVE \| /, '')}</td>
                          <td>
                            {l.costCenterName !== '—'
                              ? <span className="badge badge-accent" style={{ fontSize: '11px' }}>{l.costCenterName}</span>
                              : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td>{l.operatorName}</td>
                          <td style={{ textAlign: 'center' }}>{l.travelDaysBefore > 0 ? l.travelDaysBefore : '—'}</td>
                          <td style={{ textAlign: 'center' }}>{l.travelDaysAfter > 0 ? l.travelDaysAfter : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{l.travelDayValue > 0 ? `R$ ${l.travelDayValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--warning)' }}>
                            R$ {l.totalTravel.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Receitas por operador (extrato individual) */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: '16px', margin: 0 }}>Receitas por Operador</h3>
          {Object.keys(operatorPayments).length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={handleExportOperators} style={{ gap: '6px' }}>
              <Download size={15} /> Exportar Excel
            </button>
          )}
        </div>
        {Object.keys(operatorPayments).length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhum pagamento no período. Escale equipe nos eventos.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {Object.entries(operatorPayments)
              .sort((a, b) => b[1].total - a[1].total)
              .map(([opId, data]) => (
                <div key={opId} style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--bg-surface-elevated)' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>{data.name}</span>
                    <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--success)' }}>R$ {data.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {data.events
                      .slice()
                      .sort((a, b) => a.date.getTime() - b.date.getTime())
                      .map((e, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '7px 12px', borderTop: '0.5px solid var(--border)', fontSize: '12.5px' }}>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginRight: '6px' }}>{format(e.date, 'dd/MM')}</span>
                            <span title={e.rule}>{e.title.replace(/^LIVE \| /, '')}</span>
                          </span>
                          <span style={{ fontWeight: 600, color: 'var(--success)', whiteSpace: 'nowrap' }}>R$ {e.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
