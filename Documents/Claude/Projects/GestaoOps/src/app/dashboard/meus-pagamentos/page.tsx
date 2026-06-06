'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getOperatorByUid } from '@/services/operators';
import { getEventsByOperator } from '@/services/events';
import { getDocument, getCollection } from '@/lib/firestore';
import { Operator, PaymentRules } from '@/types/operator';
import { GestaoEvent, OPERATION_TYPE_LABELS, OPERATION_TYPE_BADGE } from '@/types/event';
import { ServicesSettings, serviceFixedValues } from '@/types/service';
import { Holiday } from '@/types/payment';
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DollarSign, Calendar, Clock, Car, TrendingUp, AlertCircle } from 'lucide-react';
import { calculateOperatorPayment } from '@/lib/payment-engine';
import { computeFolgaBalance } from '@/lib/folgas';

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) return (val as { toDate: () => Date }).toDate();
  if (typeof val === 'string') return parseISO(val);
  return new Date();
}

interface EventPayment {
  evt: GestaoEvent & { id: string };
  gross: number;
  travelBonus: number;
  nfDeduction: number;
  net: number;
  durationMinutes: number;
  isHalfShift: boolean;
  travelDays: number;
}

export default function MeusPagamentosPage() {
  const { user } = useAuth();
  const [operator, setOperator] = useState<(Operator & { id: string }) | null>(null);
  const [events, setEvents] = useState<(GestaoEvent & { id: string })[]>([]);
  const [payments, setPayments] = useState<EventPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [fixedValues, setFixedValues] = useState<Record<string, number>>({});
  const [defaultRulesFunc, setDefaultRulesFunc] = useState<PaymentRules | null>(null);
  const [defaultRulesN1, setDefaultRulesN1] = useState<PaymentRules | null>(null);
  const [defaultRulesN2, setDefaultRulesN2] = useState<PaymentRules | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);

  useEffect(() => {
    async function load() {
      if (!user) return;
      try {
        const op = await getOperatorByUid(user.uid);
        setOperator(op);
        if (op) {
          // Get all events (not just finalized) so operator sees upcoming too
          const evts = await getEventsByOperator(op.id);
          setEvents(evts);
        }
        // Catálogo (valores fixos por serviço), tabelas padrão e feriados
        const [svcDoc, funcDoc, n1Doc, n2Doc, hol] = await Promise.all([
          getDocument<ServicesSettings>('settings', 'services').catch(() => null),
          getDocument<PaymentRules>('settings', 'default_rules_funcionario').catch(() => null),
          getDocument<PaymentRules>('settings', 'default_rules_freelancer_n1').catch(() => null),
          getDocument<PaymentRules>('settings', 'default_rules_freelancer_n2').catch(() => null),
          getCollection<Holiday>('holidays').catch(() => []),
        ]);
        if (svcDoc?.catalog) setFixedValues(serviceFixedValues(svcDoc.catalog));
        if (funcDoc) setDefaultRulesFunc({ ...(funcDoc as PaymentRules), contractType: 'funcionario' });
        if (n1Doc) setDefaultRulesN1({ ...(n1Doc as PaymentRules), contractType: 'freelancer_n1' });
        if (n2Doc) setDefaultRulesN2({ ...(n2Doc as PaymentRules), contractType: 'freelancer_n2' });
        setHolidays(hol as Holiday[]);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  // Compute payments whenever operator, events, or filter changes
  useEffect(() => {
    if (!operator) return;
    const [yr, mo] = filterMonth.split('-').map(Number);
    const monthStart = startOfMonth(new Date(yr, mo - 1));
    const monthEnd = endOfMonth(new Date(yr, mo - 1));
    const interval = { start: monthStart, end: monthEnd };

    const computed: EventPayment[] = [];
    events
      .filter((e) => isWithinInterval(toDate(e.date), interval))
      .forEach((evt) => {
        const myAssignment = (evt.assignments || []).find((a) => a.operatorId === operator.id);
        if (!myAssignment) return;

        const travelDays = (myAssignment.travelDaysBefore || 0) + (myAssignment.travelDaysAfter || 0);

        // Usa custom rules se tiver hourRanges válidos; caso contrário usa padrão do contrato.
        let rules: PaymentRules | undefined = (operator.paymentRules?.hourRanges?.length ?? 0) > 0
          ? operator.paymentRules
          : undefined;
        if (!rules && operator.contractType) {
          if (operator.contractType === 'funcionario') rules = defaultRulesFunc || undefined;
          else if (operator.contractType === 'freelancer_n1') rules = defaultRulesN1 || undefined;
          else if (operator.contractType === 'freelancer_n2') rules = defaultRulesN2 || undefined;
        }
        // Se tem regra customizada mas sem hourRanges, herda hourRanges do padrão
        if (operator.paymentRules && !(operator.paymentRules.hourRanges?.length) && rules) {
          rules = { ...rules, ...operator.paymentRules, hourRanges: rules.hourRanges };
        }

        if (evt.closing && rules) {
          try {
            // Somente eventos onde este operador está escalado (evita split errado de diária múltipla)
            const allMyEvents = events
              .filter((e) => (e.assignments || []).some((a) => a.operatorId === operator.id))
              .map((e) => ({ eventId: e.id, date: toDate(e.date), operationType: e.operationType }));
            const payResult = calculateOperatorPayment(evt, myAssignment, rules, holidays, allMyEvents, defaultRulesN2, fixedValues);
            computed.push({
              evt,
              gross: payResult.baseValue + payResult.bonusValue + payResult.restDayExtra + payResult.serviceExtra,
              travelBonus: payResult.travelValue,
              nfDeduction: 0,
              net: payResult.totalValue,
              durationMinutes: payResult.durationMinutes,
              isHalfShift: !!myAssignment.isHalfShift,
              travelDays,
            });
          } catch {
            computed.push({ evt, gross: 0, travelBonus: 0, nfDeduction: 0, net: 0, durationMinutes: evt.closing.durationMinutes || 0, isHalfShift: !!myAssignment.isHalfShift, travelDays });
          }
        } else {
          computed.push({ evt, gross: 0, travelBonus: 0, nfDeduction: 0, net: 0, durationMinutes: 0, isHalfShift: !!myAssignment.isHalfShift, travelDays });
        }
      });

    setPayments(computed.sort((a, b) => toDate(b.evt.date).getTime() - toDate(a.evt.date).getTime()));
  }, [operator, events, filterMonth, fixedValues, defaultRulesFunc, defaultRulesN1, defaultRulesN2, holidays]);

  if (loading) {
    return (
      <div>
        <div className="grid-stats">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: '100px' }} />)}
        </div>
        <div className="skeleton" style={{ height: '300px' }} />
      </div>
    );
  }

  const finalized = payments.filter((p) => p.evt.status === 'finalizado');
  const pending = payments.filter((p) => p.evt.status !== 'finalizado');
  const totalNet = finalized.reduce((s, p) => s + p.net, 0);
  const totalGross = finalized.reduce((s, p) => s + p.gross, 0);
  const totalTravel = finalized.reduce((s, p) => s + p.travelBonus, 0);
  const totalDeductions = finalized.reduce((s, p) => s + p.nfDeduction, 0);

  const folgaInfo = operator ? computeFolgaBalance(operator, events, holidays) : { holidayFolgas: 0, travelFolgas: 0, total: 0, trips: [] };

  // Build month options (last 12 months)
  const monthOptions: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    monthOptions.push(format(d, 'yyyy-MM'));
  }

  return (
    <div>
      <div className="page-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1>Meus Pagamentos</h1>
          <p>Histórico de ganhos por evento</p>
        </div>
        <select
          className="input"
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          style={{ width: '180px' }}
        >
          {monthOptions.map((m) => {
            const [yr, mo] = m.split('-').map(Number);
            return (
              <option key={m} value={m}>
                {format(new Date(yr, mo - 1), 'MMMM yyyy', { locale: ptBR })}
              </option>
            );
          })}
        </select>
      </div>

      {/* Stats */}
      <div className="grid-stats">
        <div className="card-stat">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat-label">Recebimento Líquido</span>
            <DollarSign size={20} style={{ color: 'var(--success)' }} />
          </div>
          <span className="stat-value">R$ {totalNet.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          <span className="stat-change positive">Bruto: R$ {totalGross.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="card-stat">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat-label">Diárias de Viagem</span>
            <Car size={20} style={{ color: 'var(--accent)' }} />
          </div>
          <span className="stat-value">R$ {totalTravel.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="card-stat">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat-label">Deduções (NF)</span>
            <TrendingUp size={20} style={{ color: 'var(--warning)' }} />
          </div>
          <span className="stat-value">R$ {totalDeductions.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="card-stat">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat-label">Folgas Extras Acumuladas</span>
            <Calendar size={20} style={{ color: 'var(--primary)' }} />
          </div>
          <span className="stat-value">{folgaInfo.total} {folgaInfo.total === 1 ? 'folga' : 'folgas'}</span>
          <span className="stat-change" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Viagem: +{folgaInfo.travelFolgas} {operator?.contractType === 'funcionario' && `· Feriado (CLT): +${folgaInfo.holidayFolgas}`}
          </span>
        </div>
      </div>

      {/* Pending notice */}
      {pending.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'rgba(99,102,241,0.1)', borderRadius: 'var(--radius-md)', marginBottom: '20px', border: '1px solid rgba(99,102,241,0.25)' }}>
          <AlertCircle size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            <strong>{pending.length} evento(s)</strong> neste mês ainda não foram encerrados — valores pendentes de cálculo.
          </span>
        </div>
      )}

      {/* Payments Table */}
      {payments.length === 0 ? (
        <div className="empty-state card">
          <DollarSign size={40} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <h3>Sem eventos</h3>
          <p>Nenhum evento encontrado neste mês.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Evento</th>
                <th className="hide-on-mobile">Tipo</th>
                <th className="hide-on-mobile">Duração</th>
                <th className="hide-on-mobile">Diária Viagem</th>
                <th style={{ textAlign: 'right' }}>Líquido</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const d = toDate(p.evt.date);
                const hours = p.durationMinutes / 60;
                return (
                  <tr key={p.evt.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
                        {format(d, 'dd/MM/yyyy', { locale: ptBR })}
                      </div>
                    </td>
                    <td style={{ fontWeight: 500 }}>
                      {p.evt.title}
                      {p.isHalfShift && (
                        <span className="badge badge-warning" style={{ fontSize: '10px', marginLeft: '6px' }}>Meio Turno</span>
                      )}
                    </td>
                    <td className="hide-on-mobile">
                      <span className={`badge ${p.evt.operationType ? OPERATION_TYPE_BADGE[p.evt.operationType] : 'badge-info'}`}>
                        {p.evt.operationType ? OPERATION_TYPE_LABELS[p.evt.operationType] : 'N/D'}
                      </span>
                    </td>
                    <td className="hide-on-mobile">
                      {p.durationMinutes > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={14} style={{ color: 'var(--text-muted)' }} />
                          {Math.floor(hours)}h{Math.round((hours % 1) * 60).toString().padStart(2, '0')}m
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Pendente</span>
                      )}
                    </td>
                    <td className="hide-on-mobile">
                      {p.travelDays > 0 ? (
                        <span style={{ fontSize: '13px', color: 'var(--accent)' }}>
                          <Car size={12} style={{ verticalAlign: 'middle' }} /> {p.travelDays}d · R$ {p.travelBonus.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: p.net > 0 ? 'var(--success)' : p.evt.status === 'finalizado' ? 'var(--warning)' : 'var(--text-muted)' }}>
                      {p.evt.status === 'finalizado'
                        ? `R$ ${p.net.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                        : '–'}
                    </td>
                    <td>
                      <span className={`badge ${p.evt.status === 'finalizado' ? 'badge-success' : p.evt.status === 'escalado' ? 'badge-accent' : 'badge-warning'}`}>
                        {p.evt.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {finalized.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'right' }}>Total do Mês</td>
                  <td style={{ fontWeight: 700, fontSize: '16px', color: 'var(--success)', textAlign: 'right' }}>
                    R$ {totalNet.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
