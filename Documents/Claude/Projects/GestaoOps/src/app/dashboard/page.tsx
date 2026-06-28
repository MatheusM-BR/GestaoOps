'use client';

import { useEffect, useState } from 'react';
import { useAuth, SystemRole } from '@/lib/auth-context';
import { getEvents, getEventsByOperator } from '@/services/events';
import { getOperators, getOperatorByUid } from '@/services/operators';
import { getPanelShifts } from '@/services/panelShifts';
import { getUserDashboard, setUserDashboard } from '@/services/userDashboard';
import { getDocument, getCollection } from '@/lib/firestore';
import { calculateOperatorPayment } from '@/lib/payment-engine';
import { GestaoEvent, OPERATION_TYPE_LABELS, OPERATION_TYPE_BADGE, eventStatusBadge, hasEventOccurred } from '@/types/event';
import { Operator, PaymentRules } from '@/types/operator';
import { Holiday } from '@/types/payment';
import { ServicesSettings, serviceFixedValues } from '@/types/service';
import { format, isToday, isTomorrow, isThisWeek, parseISO, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Gavel, Users, DollarSign, TrendingUp, Calendar, MapPin, Clock, AlertTriangle,
  ClipboardList, ChevronRight, BarChart2, CheckCircle, Clipboard, LayoutGrid,
  GripVertical, X, Plus, RotateCcw, Check, Settings2, Target, Radio, Plane,
} from 'lucide-react';
import Link from 'next/link';

type EventWithId = GestaoEvent & { id: string };
type OperatorWithId = Operator & { id: string };

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) return (val as { toDate: () => Date }).toDate();
  if (typeof val === 'string') return parseISO(val);
  return new Date();
}

// Cores por tipo (espelham o Calendário).
const TYPE_COLOR: Record<string, string> = {
  estudio: '#2F6FED',
  externo: '#9B2D3B',
  retransmissao: '#7C7C78',
};

// ==================== CONTEXTO COMPARTILHADO ====================
interface DashCtx {
  now: Date;
  isManagement: boolean;
  allEvents: EventWithId[];                 // todos os eventos da empresa
  events: EventWithId[];                    // escopo: gestão = todos; operador = os seus
  operators: OperatorWithId[];              // só carregado para gestão
  myOperator: OperatorWithId | null;
  paymentsByOperator: Record<string, { name: string; total: number; count: number }>;
  estimatedEarnings: number;                // estimativa do mês do próprio operador
}

function resolveRules(op: OperatorWithId, rFunc: PaymentRules | null, rN1: PaymentRules | null, rN2: PaymentRules | null): PaymentRules | null {
  if (op.paymentRules) return op.paymentRules;
  if (op.contractType === 'funcionario') return rFunc;
  if (op.contractType === 'freelancer_n1') return rN1;
  if (op.contractType === 'freelancer_n2') return rN2;
  return rFunc;
}

// ==================== COMPONENTES BASE ====================
function StatCard({ label, value, sub, icon: Icon, color = 'var(--primary)' }: { label: string; value: string | number; sub?: string; icon: React.ElementType; color?: string }) {
  const iconBg =
    color === 'var(--success)' ? 'rgba(46,204,113,.12)' :
    color === 'var(--warning)' ? 'rgba(241,196,15,.12)' :
    color === 'var(--error)' ? 'rgba(239,68,68,.10)' :
    color === 'var(--accent)' ? 'var(--accent-light)' :
    color === 'var(--info)' ? 'rgba(121,192,255,.10)' :
    'var(--primary-light)';
  return (
    <div className="card-stat" style={{ flexDirection: 'row', alignItems: 'center', gap: '14px', padding: '16px 20px' }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="stat-label">{label}</span>
        <div className="stat-value" style={{ fontSize: '20px', marginTop: '2px' }}>{value}</div>
        {sub && <span className="stat-change positive">{sub}</span>}
      </div>
    </div>
  );
}

function EventListItem({ evt }: { evt: EventWithId }) {
  const d = toDate(evt.date);
  return (
    <Link href={`/dashboard/leiloes/detalhes?id=${evt.id}`} className="operator-schedule-card" style={{ textDecoration: 'none' }}>
      <div className="schedule-date-badge">
        <span className="day">{format(d, 'dd')}</span>
        <span className="month">{format(d, 'MMM', { locale: ptBR })}</span>
      </div>
      <div className="schedule-info" style={{ flex: 1 }}>
        <h4>{evt.studioName && <span style={{ color: 'var(--accent)' }}>{evt.studioName} · </span>}{evt.title}</h4>
        <div className="schedule-meta">
          <span className="schedule-meta-item"><Clock size={12} /> {format(d, 'HH:mm')}</span>
          <span className="schedule-meta-item"><MapPin size={12} /> {evt.city || 'N/D'}</span>
          {evt.operationType && (
            <span className={`badge ${OPERATION_TYPE_BADGE[evt.operationType]}`} style={{ fontSize: '11px' }}>
              {OPERATION_TYPE_LABELS[evt.operationType]}
            </span>
          )}
        </div>
      </div>
      {(() => { const s = eventStatusBadge(evt); return <span className={`badge ${s.cls}`}>{s.label}</span>; })()}
    </Link>
  );
}

function WidgetCard({ title, icon: Icon, action, children }: { title?: string; icon?: React.ElementType; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card">
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', gap: '8px' }}>
          <h3 style={{ fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            {Icon && <Icon size={16} style={{ color: 'var(--primary)' }} />}{title}
          </h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

const monthRange = (now: Date) => ({ start: startOfMonth(now), end: endOfMonth(now) });
const eventsThisMonth = (c: DashCtx) => c.events.filter((e) => isWithinInterval(toDate(e.date), monthRange(c.now)));

// ==================== CATÁLOGO DE WIDGETS ====================
interface WidgetDef {
  id: string;
  title: string;
  icon: React.ElementType;
  roles: SystemRole[];
  span: 1 | 2;
  render: (c: DashCtx) => React.ReactNode;
}

const MGMT_CORE: SystemRole[] = ['admin', 'ceo', 'gestor', 'administrativo'];
// Financeiro na home: só admin/ceo/financeiro (sem administrativo, planejamento, etc.)
const FIN: SystemRole[] = ['admin', 'ceo', 'financeiro'];
const FIN_EXPORT: SystemRole[] = ['admin', 'ceo', 'financeiro'];
const COM: SystemRole[] = ['admin', 'ceo', 'comercial'];
const PLAN: SystemRole[] = ['admin', 'ceo', 'planejamento'];
const OPERATOR_ALL: SystemRole[] = ['operacao', 'operador_painel', 'tecnico', 'freelancer_estudio', 'freelancer_externo', 'operador_transmissao', 'operador'];

const WIDGETS: WidgetDef[] = [
  // ---------- GESTÃO ----------
  {
    id: 'kpis-gestao', title: 'Indicadores Gerais', icon: BarChart2, span: 2, roles: MGMT_CORE,
    render: (c) => {
      const totalRevenue = c.allEvents.reduce((s, e) => s + (e.actualRevenue || e.revenue || 0), 0);
      const totalExpenses = c.allEvents.reduce((s, e) => s + (e.expenses || []).reduce((x, ex) => x + (ex.amount || 0), 0), 0);
      const finalized = c.allEvents.filter((e) => toDate(e.endDate || e.date) < c.now).length;
      const activeOps = c.operators.filter((o) => o.active).length;
      return (
        <div className="grid-stats" style={{ margin: 0 }}>
          <StatCard label="Total Eventos" value={c.allEvents.length} sub={`${finalized} realizados`} icon={Gavel} />
          <StatCard label="Receita Total" value={`R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} sub={`Líquido: R$ ${(totalRevenue - totalExpenses).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} icon={DollarSign} color="var(--success)" />
          <StatCard label="Despesas" value={`R$ ${totalExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} icon={TrendingUp} color="var(--warning)" />
          <StatCard label="Operadores Ativos" value={activeOps} sub={`de ${c.operators.length} total`} icon={Users} color="var(--accent)" />
        </div>
      );
    },
  },
  {
    id: 'hoje', title: 'Operação de Hoje', icon: Gavel, span: 1,
    roles: [...MGMT_CORE, 'financeiro', 'comercial', 'planejamento', 'operador_painel', 'operacao'],
    render: (c) => {
      const today = c.allEvents.filter((e) => isToday(toDate(e.date))).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
      return (
        <WidgetCard title="Operação de Hoje" icon={Gavel}>
          {today.length === 0 ? (
            <div className="empty-state" style={{ padding: '28px' }}><Calendar size={30} style={{ opacity: 0.3, marginBottom: '6px' }} /><p style={{ fontSize: '13px' }}>Nenhum leilão hoje</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {today.map((evt) => {
                const col = evt.operationType ? TYPE_COLOR[evt.operationType] : 'var(--text-muted)';
                const noCrew = (evt.assignments || []).length === 0 && evt.operationType !== 'retransmissao';
                return (
                  <Link key={evt.id} href={`/dashboard/leiloes/detalhes?id=${evt.id}`} style={{ textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', borderLeft: `3px solid ${col}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 500, fontSize: '13.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{evt.title}</p>
                        <p style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{format(toDate(evt.date), 'HH:mm')} · {evt.city || 'N/D'}</p>
                      </div>
                      {noCrew && <span className="badge badge-warning" style={{ fontSize: '10.5px' }}>sem equipe</span>}
                      {(() => { const s = eventStatusBadge(evt); return <span className={`badge ${s.cls}`} style={{ fontSize: '10.5px' }}>{s.label}</span>; })()}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </WidgetCard>
      );
    },
  },
  {
    id: 'pendencias', title: 'Pendências', icon: AlertTriangle, span: 1, roles: MGMT_CORE,
    render: (c) => {
      const future = c.allEvents.filter((e) => toDate(e.date) >= c.now);
      const semEquipe = future.filter((e) => (e.assignments || []).length === 0 && e.operationType !== 'retransmissao');
      const semTipo = c.allEvents.filter((e) => !e.operationType);
      const semPlanejamento = future.filter((e) => e.needsPlanning && !e.planning);
      const semReceita = c.allEvents.filter((e) => !(e.actualRevenue || e.revenue));
      const items = [
        { label: 'Eventos sem equipe', n: semEquipe.length, color: 'var(--info)', icon: Users, href: '/dashboard/escala' },
        { label: 'Sem tipo definido', n: semTipo.length, color: 'var(--warning)', icon: Target, href: '/dashboard/eventos' },
        { label: 'Externos sem planejamento', n: semPlanejamento.length, color: 'var(--error)', icon: Clipboard, href: '/dashboard/eventos' },
        { label: 'Sem receita cadastrada', n: semReceita.length, color: 'var(--text-muted)', icon: DollarSign, href: '/dashboard/financeiro' },
      ].filter((i) => i.n > 0);
      return (
        <WidgetCard title="Pendências" icon={AlertTriangle}>
          {items.length === 0 ? (
            <div className="empty-state" style={{ padding: '28px' }}><CheckCircle size={30} style={{ opacity: 0.4, marginBottom: '6px', color: 'var(--success)' }} /><p style={{ fontSize: '13px', color: 'var(--success)' }}>Tudo em ordem!</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map((it) => (
                <Link key={it.label} href={it.href} style={{ textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                    <it.icon size={18} style={{ color: it.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: '13.5px' }}>{it.label}</span>
                    <span style={{ fontWeight: 700, fontSize: '16px', color: it.color }}>{it.n}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </WidgetCard>
      );
    },
  },
  {
    id: 'proximos', title: 'Próximos Eventos', icon: Calendar, span: 1,
    roles: [...MGMT_CORE, 'financeiro', 'comercial', 'planejamento', 'operador_painel'],
    render: (c) => {
      const upcoming = c.allEvents.filter((e) => toDate(e.date) >= c.now).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime()).slice(0, 7);
      return (
        <WidgetCard title="Próximos Eventos" icon={Calendar} action={<Link href="/dashboard/leiloes" className="btn btn-ghost btn-sm">Ver todos <ChevronRight size={14} /></Link>}>
          {upcoming.length === 0 ? (
            <div className="empty-state" style={{ padding: '28px' }}><Calendar size={30} style={{ opacity: 0.3 }} /><p style={{ fontSize: '13px' }}>Nenhum evento próximo</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {upcoming.map((evt) => <EventListItem key={evt.id} evt={evt} />)}
            </div>
          )}
        </WidgetCard>
      );
    },
  },
  {
    id: 'mix-tipos', title: 'Mix por Tipo (mês)', icon: BarChart2, span: 1, roles: MGMT_CORE,
    render: (c) => {
      const m = eventsThisMonth(c);
      const counts = { estudio: 0, externo: 0, retransmissao: 0 } as Record<string, number>;
      m.forEach((e) => { if (e.operationType && counts[e.operationType] !== undefined) counts[e.operationType]++; });
      const max = Math.max(1, counts.estudio, counts.externo, counts.retransmissao);
      const rows = [
        { k: 'estudio', label: 'Estúdio' },
        { k: 'externo', label: 'Externo' },
        { k: 'retransmissao', label: 'Retransmissão' },
      ];
      return (
        <WidgetCard title="Mix por Tipo (mês)" icon={BarChart2}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingTop: '4px' }}>
            {rows.map((r) => (
              <div key={r.k}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '5px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
                  <span style={{ fontWeight: 700 }}>{counts[r.k]}</span>
                </div>
                <div style={{ height: '8px', background: 'var(--bg-surface-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: `${(counts[r.k] / max) * 100}%`, height: '100%', background: TYPE_COLOR[r.k], borderRadius: '4px', transition: 'width .3s' }} />
                </div>
              </div>
            ))}
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Total no mês: <strong>{m.length}</strong> eventos</p>
          </div>
        </WidgetCard>
      );
    },
  },
  {
    id: 'carga-operadores', title: 'Carga por Operador (mês)', icon: Users, span: 1, roles: [...MGMT_CORE, 'financeiro'],
    render: (c) => {
      const arr = Object.values(c.paymentsByOperator).sort((a, b) => b.count - a.count).slice(0, 6);
      const max = Math.max(1, ...arr.map((a) => a.count));
      return (
        <WidgetCard title="Carga por Operador (mês)" icon={Users}>
          {arr.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}><Users size={28} style={{ opacity: 0.3 }} /><p style={{ fontSize: '13px' }}>Sem escalas no mês</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', paddingTop: '4px' }}>
              {arr.map((a) => (
                <div key={a.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '4px' }}>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }}>{a.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{a.count} ev · <strong style={{ color: 'var(--success)' }}>R$ {a.total.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}</strong></span>
                  </div>
                  <div style={{ height: '7px', background: 'var(--bg-surface-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${(a.count / max) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: '4px' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>
      );
    },
  },
  // ---------- FINANCEIRO ----------
  {
    id: 'kpis-financeiro', title: 'Resumo Financeiro (mês)', icon: DollarSign, span: 2, roles: FIN,
    render: (c) => {
      const m = eventsThisMonth(c);
      const totalRevenue = m.reduce((s, e) => s + (e.actualRevenue || e.revenue || 0), 0);
      const totalExpenses = m.reduce((s, e) => s + (e.expenses || []).reduce((x, ex) => x + (ex.amount || 0), 0), 0);
      const net = totalRevenue - totalExpenses;
      const pending = c.allEvents.filter((e) => !hasEventOccurred(e) && (e.assignments || []).length === 0 && e.operationType !== 'retransmissao');
      return (
        <div className="grid-stats" style={{ margin: 0 }}>
          <StatCard label="Receita do Mês" value={`R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} icon={DollarSign} color="var(--success)" />
          <StatCard label="Despesas do Mês" value={`R$ ${totalExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} icon={TrendingUp} color="var(--warning)" />
          <StatCard label="Resultado Líquido" value={`R$ ${net.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} sub={net >= 0 ? 'Positivo ✓' : 'Negativo ⚠'} icon={BarChart2} color={net >= 0 ? 'var(--success)' : 'var(--error)'} />
          <StatCard label="A Escalar" value={pending.length} sub="sem equipe" icon={AlertTriangle} color="var(--warning)" />
        </div>
      );
    },
  },
  {
    id: 'eventos-mes', title: 'Eventos do Mês', icon: Calendar, span: 1, roles: FIN,
    render: (c) => {
      const m = eventsThisMonth(c).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
      return (
        <WidgetCard title="Eventos do Mês" icon={Calendar} action={<Link href="/dashboard/financeiro" className="btn btn-ghost btn-sm">Detalhes <ChevronRight size={14} /></Link>}>
          {m.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}><Calendar size={28} style={{ opacity: 0.3 }} /><p>Nenhum evento este mês</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {m.slice(0, 8).map((evt) => {
                const rev = evt.actualRevenue || evt.revenue || 0;
                const exp = (evt.expenses || []).reduce((s, x) => s + (x.amount || 0), 0);
                return (
                  <Link key={evt.id} href={`/dashboard/leiloes/detalhes?id=${evt.id}`} style={{ textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 13px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 500, fontSize: '13.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{evt.title}</p>
                        <p style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{format(toDate(evt.date), 'dd/MM HH:mm')}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: '13px', color: 'var(--success)', fontWeight: 600 }}>R$ {rev.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}</p>
                        {exp > 0 && <p style={{ fontSize: '11px', color: 'var(--warning)' }}>- R$ {exp.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}</p>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </WidgetCard>
      );
    },
  },
  {
    id: 'receita-operador', title: 'A Pagar por Operador (mês)', icon: DollarSign, span: 1, roles: FIN_EXPORT,
    render: (c) => {
      const arr = Object.values(c.paymentsByOperator).sort((a, b) => b.total - a.total).slice(0, 8);
      const total = arr.reduce((s, a) => s + a.total, 0);
      return (
        <WidgetCard title="A Pagar por Operador (mês)" icon={DollarSign} action={<Link href="/dashboard/financeiro" className="btn btn-ghost btn-sm">Extrato <ChevronRight size={14} /></Link>}>
          {arr.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}><DollarSign size={28} style={{ opacity: 0.3 }} /><p style={{ fontSize: '13px' }}>Nada a pagar no mês</p></div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {arr.map((a) => (
                  <div key={a.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 2px', borderBottom: '0.5px solid var(--border)', fontSize: '13px' }}>
                    <span>{a.name} <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({a.count})</span></span>
                    <span style={{ fontWeight: 600, color: 'var(--success)' }}>R$ {a.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '10px', fontWeight: 700 }}>
                <span>Total</span><span style={{ color: 'var(--success)' }}>R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>
            </>
          )}
        </WidgetCard>
      );
    },
  },
  // ---------- COMERCIAL ----------
  {
    id: 'kpis-comercial', title: 'Painel Comercial', icon: Target, span: 2, roles: COM,
    render: (c) => {
      const withRevenue = c.allEvents.filter((e) => (e.actualRevenue || e.revenue || 0) > 0);
      const noRevenue = c.allEvents.filter((e) => !(e.actualRevenue || e.revenue) && toDate(e.date) >= c.now);
      const totalRevenue = withRevenue.reduce((s, e) => s + (e.actualRevenue || e.revenue || 0), 0);
      const upcoming = c.allEvents.filter((e) => toDate(e.date) >= c.now);
      return (
        <div className="grid-stats" style={{ margin: 0 }}>
          <StatCard label="Eventos com Receita" value={withRevenue.length} icon={DollarSign} color="var(--success)" />
          <StatCard label="Receita Prevista" value={`R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} icon={TrendingUp} color="var(--accent)" />
          <StatCard label="Sem Faturamento" value={noRevenue.length} sub="preencher receita" icon={AlertTriangle} color="var(--warning)" />
          <StatCard label="Próximos Eventos" value={upcoming.length} icon={Calendar} />
        </div>
      );
    },
  },
  {
    id: 'sem-faturamento', title: 'Eventos sem Receita', icon: AlertTriangle, span: 1, roles: COM,
    render: (c) => {
      const noRevenue = c.allEvents.filter((e) => !(e.actualRevenue || e.revenue) && toDate(e.date) >= c.now).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
      return (
        <WidgetCard title="Eventos sem Receita Cadastrada" icon={AlertTriangle}>
          {noRevenue.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}><CheckCircle size={28} style={{ opacity: 0.4, color: 'var(--success)' }} /><p style={{ fontSize: '13px', color: 'var(--success)' }}>Todos faturados!</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {noRevenue.slice(0, 8).map((evt) => <EventListItem key={evt.id} evt={evt} />)}
            </div>
          )}
        </WidgetCard>
      );
    },
  },
  // ---------- PLANEJAMENTO ----------
  {
    id: 'kpis-planejamento', title: 'Planejamento', icon: Clipboard, span: 2, roles: PLAN,
    render: (c) => {
      const withPlanning = c.allEvents.filter((e) => e.needsPlanning && toDate(e.date) >= c.now);
      const withoutPlan = withPlanning.filter((e) => !e.planning);
      const withPlan = withPlanning.filter((e) => !!e.planning);
      const upcoming = c.allEvents.filter((e) => toDate(e.date) >= c.now);
      return (
        <div className="grid-stats" style={{ margin: 0 }}>
          <StatCard label="Precisam Planejamento" value={withPlanning.length} icon={Clipboard} />
          <StatCard label="Sem Planejamento" value={withoutPlan.length} sub="ação necessária" icon={AlertTriangle} color="var(--error)" />
          <StatCard label="Com Planejamento" value={withPlan.length} icon={CheckCircle} color="var(--success)" />
          <StatCard label="Próximos Eventos" value={upcoming.length} icon={Calendar} color="var(--accent)" />
        </div>
      );
    },
  },
  {
    id: 'sem-planejamento', title: 'Externos sem Planejamento', icon: AlertTriangle, span: 1, roles: PLAN,
    render: (c) => {
      const list = c.allEvents.filter((e) => e.needsPlanning && !e.planning && toDate(e.date) >= c.now).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
      return (
        <WidgetCard title="Externos sem Planejamento" icon={AlertTriangle}>
          {list.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}><CheckCircle size={28} style={{ opacity: 0.4, color: 'var(--success)' }} /><p style={{ fontSize: '13px', color: 'var(--success)' }}>Tudo planejado!</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {list.slice(0, 8).map((evt) => <EventListItem key={evt.id} evt={evt} />)}
            </div>
          )}
        </WidgetCard>
      );
    },
  },
  // ---------- OPERADORES ----------
  {
    id: 'meus-stats', title: 'Meus Indicadores', icon: ClipboardList, span: 2, roles: OPERATOR_ALL,
    render: (c) => {
      const today = new Date(c.now.getFullYear(), c.now.getMonth(), c.now.getDate());
      const upcoming = c.events.filter((e) => toDate(e.date) >= today);
      const m = eventsThisMonth(c);
      return (
        <div>
          <div style={{ marginBottom: '18px' }}>
            <h2 style={{ fontSize: '22px', marginBottom: '4px' }}>Olá, {c.myOperator?.name?.split(' ')[0] || 'Operador'} 👋</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{format(c.now, "EEEE, dd 'de' MMMM", { locale: ptBR })}</p>
          </div>
          <div className="grid-stats" style={{ margin: 0 }}>
            <StatCard label="Meus Serviços" value={c.events.length} sub={`${c.events.filter(hasEventOccurred).length} realizados`} icon={ClipboardList} />
            <StatCard label="Próximos" value={upcoming.length} icon={Calendar} color="var(--accent)" />
            <StatCard label="Este Mês" value={m.length} icon={Gavel} color="var(--info)" />
            <StatCard label="Estimativa do Mês" value={`R$ ${c.estimatedEarnings.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} icon={DollarSign} color="var(--success)" />
          </div>
        </div>
      );
    },
  },
  {
    id: 'leiloes-hoje', title: 'Leilões de Hoje (plataforma)', icon: Gavel, span: 1, roles: ['operador_painel', 'operacao'],
    render: (c) => {
      const today = c.allEvents.filter((e) => isToday(toDate(e.date))).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
      return (
        <WidgetCard title="Leilões de Hoje (plataforma)" icon={Gavel}>
          {today.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}><Gavel size={28} style={{ opacity: 0.3 }} /><p style={{ fontSize: '13px' }}>Nenhum leilão hoje</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {today.map((evt) => {
                const mine = (evt.assignments || []).some((a) => a.operatorId === c.myOperator?.id);
                return (
                  <div key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: mine ? 'rgba(99,102,241,0.1)' : 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', border: mine ? '1px solid rgba(99,102,241,0.3)' : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 500, fontSize: '13.5px' }}>{evt.title}</p>
                      <p style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{format(toDate(evt.date), 'HH:mm')} · {evt.city || 'N/D'}</p>
                    </div>
                    {mine && <span className="badge badge-primary" style={{ fontSize: '10.5px' }}>Escalado</span>}
                  </div>
                );
              })}
            </div>
          )}
        </WidgetCard>
      );
    },
  },
  {
    id: 'minha-agenda', title: 'Minha Agenda', icon: Calendar, span: 1, roles: OPERATOR_ALL,
    render: (c) => {
      const today = new Date(c.now.getFullYear(), c.now.getMonth(), c.now.getDate());
      const upcoming = c.events.filter((e) => toDate(e.date) >= today).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
      return (
        <WidgetCard title="Minha Agenda" icon={Calendar} action={<Link href="/dashboard/meus-pagamentos" className="btn btn-ghost btn-sm">Meus Ganhos <ChevronRight size={14} /></Link>}>
          {upcoming.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}><Calendar size={28} style={{ opacity: 0.3 }} /><p>Sem eventos agendados</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {upcoming.slice(0, 8).map((evt) => <EventListItem key={evt.id} evt={evt} />)}
            </div>
          )}
        </WidgetCard>
      );
    },
  },
];

const WIDGET_MAP = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

const MGMT_PRESET = ['kpis-gestao', 'hoje', 'pendencias', 'proximos', 'mix-tipos', 'carga-operadores'];
const ROLE_DEFAULTS: Partial<Record<SystemRole, string[]>> = {
  // Alta gestão: visão 360°
  admin:         MGMT_PRESET,
  ceo:           MGMT_PRESET,
  gestor:        MGMT_PRESET,
  administrativo:['hoje', 'pendencias', 'proximos', 'mix-tipos'],
  // Financeiro: dados $ + carga equipe
  financeiro:    ['kpis-financeiro', 'receita-operador', 'carga-operadores', 'eventos-mes'],
  // Comercial: foco em receita e próximos
  comercial:     ['kpis-comercial', 'sem-faturamento', 'proximos', 'hoje'],
  // Planejamento: externos e agenda
  planejamento:  ['kpis-planejamento', 'sem-planejamento', 'proximos', 'hoje'],
  // Operadores
  operador_painel:       ['meus-stats', 'leiloes-hoje', 'minha-agenda'],
  operador_transmissao:  ['meus-stats', 'minha-agenda'],
  tecnico:               ['meus-stats', 'minha-agenda'],
  operacao:              ['meus-stats', 'minha-agenda'],
  freelancer_estudio:    ['meus-stats', 'minha-agenda'],
  freelancer_externo:    ['meus-stats', 'minha-agenda'],
  operador:              ['meus-stats', 'minha-agenda'],
};

function defaultWidgetsFor(role: SystemRole | undefined): string[] {
  if (role && ROLE_DEFAULTS[role]) return ROLE_DEFAULTS[role]!;
  return ['meus-stats', 'minha-agenda'];
}

function moveItem(arr: string[], from: number, to: number): string[] {
  const a = [...arr];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

interface PendItem { label: string; n: number; color: string; icon: React.ElementType }

// ==================== PÁGINA ====================
export default function DashboardPage() {
  const { profile, user, isManagement } = useAuth();
  const role = profile?.role;

  const [ctx, setCtx] = useState<DashCtx | null>(null);
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [savingPref, setSavingPref] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const allowed = WIDGETS.filter((w) => role && w.roles.includes(role));
  const allowedIds = new Set(allowed.map((w) => w.id));

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      try {
        const now = new Date();
        const [allEvents, myOperator, operators, , rFunc, rN1, rN2, svc, hols, pref] = await Promise.all([
          getEvents(),
          getOperatorByUid(user.uid).catch(() => null),
          isManagement ? getOperators() : Promise.resolve([] as OperatorWithId[]),
          getPanelShifts().catch(() => []),
          getDocument<PaymentRules>('settings', 'default_rules_funcionario').catch(() => null),
          getDocument<PaymentRules>('settings', 'default_rules_freelancer_n1').catch(() => null),
          getDocument<PaymentRules>('settings', 'default_rules_freelancer_n2').catch(() => null),
          getDocument<ServicesSettings>('settings', 'services').catch(() => null),
          getCollection<Holiday>('holidays').catch(() => [] as Holiday[]),
          getUserDashboard(user.uid).catch(() => null),
        ]);

        const fixedValues = svc?.catalog ? serviceFixedValues(svc.catalog) : {};
        const monthEvts = allEvents.filter((e) => isWithinInterval(toDate(e.date), monthRange(now)));

        // Escala do usuário (operador): eventos em que está escalado.
        const myEvents = myOperator
          ? allEvents.filter((e) => (e.assignments || []).some((a) => a.operatorId === myOperator.id))
          : [];
        const events = isManagement ? allEvents : myEvents;

        // Pagamentos por operador no mês (somente admin/ceo/financeiro).
        const canSeePay = role === 'admin' || role === 'ceo' || role === 'financeiro';
        const paymentsByOperator: Record<string, { name: string; total: number; count: number }> = {};
        if (isManagement && canSeePay) {
          for (const evt of monthEvts) {
            for (const a of evt.assignments || []) {
              const op = operators.find((o) => o.id === a.operatorId);
              const rules = op ? resolveRules(op, rFunc, rN1, rN2) : null;
              let value = 0;
              if (op && rules) {
                try { value = calculateOperatorPayment(evt, a, rules, hols, [], rN2, fixedValues).totalValue; } catch {}
              }
              const key = a.operatorId;
              if (!paymentsByOperator[key]) paymentsByOperator[key] = { name: op?.name || a.operatorName || 'Operador', total: 0, count: 0 };
              paymentsByOperator[key].total += value;
              paymentsByOperator[key].count += 1;
            }
          }
        }

        // Estimativa do próprio operador no mês.
        let estimatedEarnings = 0;
        if (myOperator) {
          const rules = resolveRules(myOperator, rFunc, rN1, rN2);
          if (rules) {
            for (const evt of myEvents.filter((e) => isWithinInterval(toDate(e.date), monthRange(now)))) {
              const a = (evt.assignments || []).find((x) => x.operatorId === myOperator.id);
              if (a) {
                try { estimatedEarnings += calculateOperatorPayment(evt, a, rules, hols, [], rN2, fixedValues).totalValue; } catch {}
              }
            }
          }
        }

        if (!active) return;
        setCtx({ now, isManagement, allEvents, events, operators, myOperator, paymentsByOperator, estimatedEarnings });

        // Layout efetivo: preferência salva (filtrada pelo papel) ou preset do papel.
        const base = (pref && pref.length ? pref : defaultWidgetsFor(role)).filter((id) => allowedIds.has(id));
        const eff = base.length ? base : defaultWidgetsFor(role).filter((id) => allowedIds.has(id));
        setLayout(eff);
        setSaved(eff);
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isManagement, role]);

  const saveLayout = async () => {
    if (!user) return;
    setSavingPref(true);
    try {
      await setUserDashboard(user.uid, layout);
      setSaved(layout);
      setEditing(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingPref(false);
    }
  };

  const cancelEdit = () => { setLayout(saved); setEditing(false); };
  const restoreDefault = () => setLayout(defaultWidgetsFor(role).filter((id) => allowedIds.has(id)));
  const removeWidget = (id: string) => setLayout((l) => l.filter((x) => x !== id));
  const addWidget = (id: string) => setLayout((l) => (l.includes(id) ? l : [...l, id]));

  if (loading || !ctx) return <div className="skeleton" style={{ height: '500px' }} />;

  const available = allowed.filter((w) => !layout.includes(w.id));

  // Dados do painel direito (management only)
  const futureEvts = ctx.allEvents.filter((e) => toDate(e.date) >= ctx.now);
  const todayEvts = ctx.allEvents.filter((e) => isToday(toDate(e.date))).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
  const pendItems: PendItem[] = [
    { label: 'Sem equipe escalada', n: futureEvts.filter((e) => (e.assignments || []).length === 0 && e.operationType !== 'retransmissao').length, color: 'var(--info)', icon: Users },
    { label: 'Externos sem planejamento', n: futureEvts.filter((e) => e.needsPlanning && !e.planning).length, color: 'var(--error)', icon: Clipboard },
    { label: 'Sem receita cadastrada', n: ctx.allEvents.filter((e) => !(e.actualRevenue || e.revenue)).length, color: 'var(--text-muted)', icon: DollarSign },
    { label: 'Sem tipo definido', n: ctx.allEvents.filter((e) => !e.operationType).length, color: 'var(--warning)', icon: Target },
  ].filter((i) => i.n > 0);
  const travelEvts = futureEvts.filter((e) => e.operationType === 'externo').sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime()).slice(0, 4);

  return (
    <div className="dash-main-grid" style={{ display: 'grid', gridTemplateColumns: isManagement && ctx ? 'minmax(0,1fr) 236px' : '1fr', gap: '16px', alignItems: 'start' }}>
    <div>
      {/* Barra de ações */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        {editing ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={restoreDefault}><RotateCcw size={14} /> Padrão</button>
            <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancelar</button>
            <button className="btn btn-primary btn-sm" onClick={saveLayout} disabled={savingPref}>
              {savingPref ? <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} /> : <Check size={14} />} Salvar
            </button>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><Settings2 size={15} /> Personalizar</button>
        )}
      </div>

      {/* Modo edição: organizar widgets */}
      {editing && (
        <div className="card" style={{ marginBottom: '20px', borderColor: 'var(--primary)' }}>
          <h3 style={{ fontSize: '15px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}><LayoutGrid size={16} style={{ color: 'var(--primary)' }} /> Organizar painel</h3>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '14px' }}>Arraste para reordenar, remova ou adicione blocos. Só aparecem os blocos do seu nível de acesso.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: available.length ? '16px' : 0 }}>
            {layout.map((id, i) => {
              const w = WIDGET_MAP[id];
              if (!w) return null;
              return (
                <div
                  key={id}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragIndex !== null && dragIndex !== i) setLayout((l) => moveItem(l, dragIndex, i)); setDragIndex(null); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: dragIndex === i ? 'var(--bg-surface)' : 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', border: '0.5px solid var(--border)', cursor: 'grab' }}
                >
                  <GripVertical size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <w.icon size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '13.5px' }}>{w.title}</span>
                  <span className="badge" style={{ fontSize: '10px' }}>{w.span === 2 ? 'largo' : 'normal'}</span>
                  <button className="btn-icon" onClick={() => removeWidget(id)} title="Remover" style={{ color: 'var(--error)' }}><X size={15} /></button>
                </div>
              );
            })}
            {layout.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px' }}>Nenhum bloco. Adicione abaixo.</p>}
          </div>

          {available.length > 0 && (
            <>
              <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Adicionar</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {available.map((w) => (
                  <button key={w.id} className="btn btn-ghost btn-sm" onClick={() => addWidget(w.id)} style={{ border: '0.5px dashed var(--border)' }}>
                    <Plus size={14} /> {w.title}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Grade de widgets */}
      <div className="dash-grid">
        {layout.map((id) => {
          const w = WIDGET_MAP[id];
          if (!w || !allowedIds.has(id)) return null;
          return (
            <div key={id} className={w.span === 2 ? 'span-2' : undefined}>
              {w.render(ctx)}
            </div>
          );
        })}
        {layout.length === 0 && (
          <div className="span-2 empty-state card"><LayoutGrid size={40} style={{ opacity: 0.3, marginBottom: '12px' }} /><h3>Painel vazio</h3><p>Clique em "Personalizar" para adicionar blocos.</p></div>
        )}
      </div>
    </div>

    {isManagement && !editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', position: 'sticky', top: '80px' }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '12px' }}>
              <Radio size={13} style={{ color: todayEvts.length ? 'var(--error)' : 'var(--text-muted)' }} />
              <h3 style={{ fontSize: '13px', fontWeight: 600 }}>Operação hoje</h3>
              {todayEvts.length > 0 && <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>{todayEvts.length} leilão{todayEvts.length !== 1 ? 'ões' : ''}</span>}
            </div>
            {todayEvts.length === 0 ? (
              <div className="empty-state" style={{ padding: '16px 0' }}>
                <Calendar size={22} style={{ opacity: 0.3, marginBottom: '6px' }} />
                <p style={{ fontSize: '12px' }}>Nenhum leilão hoje</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {todayEvts.map((evt) => {
                  const col = evt.operationType ? (TYPE_COLOR[evt.operationType] || 'var(--text-muted)') : 'var(--text-muted)';
                  return (
                    <Link key={evt.id} href={`/dashboard/leiloes/detalhes?id=${evt.id}`} style={{ textDecoration: 'none' }}>
                      <div style={{ padding: '8px 10px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', borderLeft: `3px solid ${col}` }}>
                        <p style={{ fontSize: '12.5px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evt.title}</p>
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{format(toDate(evt.date), 'HH:mm')} · {evt.city || 'N/D'}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {pendItems.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '12px' }}>
                <AlertTriangle size={13} style={{ color: 'var(--warning)' }} />
                <h3 style={{ fontSize: '13px', fontWeight: 600 }}>Pendências</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {pendItems.map((it) => (
                  <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                    <it.icon size={15} style={{ color: it.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: '12px' }}>{it.label}</span>
                    <span style={{ fontWeight: 700, fontSize: '15px', color: it.color }}>{it.n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {travelEvts.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '12px' }}>
                <Plane size={13} style={{ color: 'var(--accent)' }} />
                <h3 style={{ fontSize: '13px', fontWeight: 600 }}>Próximas viagens</h3>
              </div>
              <div>
                {travelEvts.map((evt, i) => (
                  <div key={evt.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 2px', borderBottom: i < travelEvts.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', maxWidth: '130px', fontSize: '12px' }}>{evt.title}</p>
                      <p style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{format(toDate(evt.date), 'dd/MM')}</p>
                    </div>
                    <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '12px' }}>R$ 200</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
    )}
  </div>
  );
}
