'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getEvents } from '@/services/events';
import { getOperators } from '@/services/operators';
import { GestaoEvent, OPERATION_TYPE_LABELS, OPERATION_TYPE_BADGE } from '@/types/event';
import { Operator } from '@/types/operator';
import { format, isToday, isTomorrow, isThisWeek, parseISO, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Gavel, Users, DollarSign, TrendingUp,
  Calendar, MapPin, Clock, AlertTriangle,
  ClipboardList, ChevronRight, Target, BarChart2,
  CheckCircle, Clipboard, Package,
} from 'lucide-react';
import Link from 'next/link';
import { getOperatorByUid } from '@/services/operators';
import { getEventsByOperator } from '@/services/events';
import { calculateOperatorPayment } from '@/lib/payment-engine';
import { getDocument, getCollection } from '@/lib/firestore';

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) return (val as { toDate: () => Date }).toDate();
  if (typeof val === 'string') return parseISO(val);
  return new Date();
}

// ==================== SHARED HOOKS ====================
function useAllEvents() {
  const [events, setEvents] = useState<(GestaoEvent & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getEvents().then(setEvents).catch(console.error).finally(() => setLoading(false));
  }, []);
  return { events, loading };
}

function useOperators() {
  const [operators, setOperators] = useState<(Operator & { id: string })[]>([]);
  useEffect(() => {
    getOperators().then(setOperators).catch(console.error);
  }, []);
  return operators;
}

// ==================== EVENT LIST COMPONENT ====================
function EventListItem({ evt }: { evt: GestaoEvent & { id: string } }) {
  const d = toDate(evt.date);
  const label = isToday(d) ? 'Hoje' : isTomorrow(d) ? 'Amanhã' : isThisWeek(d) ? format(d, 'EEEE', { locale: ptBR }) : format(d, 'dd/MM', { locale: ptBR });
  return (
    <Link
      href={`/dashboard/leiloes/detalhes?id=${evt.id}`}
      className="operator-schedule-card"
      style={{ textDecoration: 'none' }}
    >
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
      <span className={`badge ${evt.status === 'escalado' || evt.status === 'finalizado' ? 'badge-success' : evt.status === 'pendente' ? 'badge-warning' : 'badge-info'}`}>
        {evt.status}
      </span>
    </Link>
  );
}

// ==================== STAT CARD ====================
function StatCard({ label, value, sub, icon: Icon, color = 'var(--primary)' }: { label: string; value: string | number; sub?: string; icon: React.ElementType; color?: string }) {
  return (
    <div className="card-stat">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="stat-label">{label}</span>
        <Icon size={20} style={{ color }} />
      </div>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-change positive">{sub}</span>}
    </div>
  );
}

// ==================== ADMIN/CEO DASHBOARD ====================
function AdminDashboard() {
  const { events, loading } = useAllEvents();
  const operators = useOperators();

  if (loading) return <div className="skeleton" style={{ height: '400px' }} />;

  const now = new Date();
  const thisMonth = { start: startOfMonth(now), end: endOfMonth(now) };
  const totalEvents = events.length;
  const finalized = events.filter((e) => e.status === 'finalizado').length;
  const pendingClose = events.filter((e) => e.status !== 'finalizado' && toDate(e.date) < now).length;
  const totalRevenue = events.reduce((s, e) => s + (e.actualRevenue || e.revenue || 0), 0);
  const totalExpenses = events.reduce((s, e) => s + (e.expenses || []).reduce((x, ex) => x + (ex.amount || 0), 0), 0);
  const activeOps = operators.filter((o) => o.active).length;
  const noAssignment = events.filter((e) => e.status === 'pendente' && toDate(e.date) >= now);
  const upcomingEvents = events.filter((e) => toDate(e.date) >= now).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime()).slice(0, 8);
  const monthEvents = events.filter((e) => isWithinInterval(toDate(e.date), thisMonth));

  return (
    <div>
      <div className="grid-stats">
        <StatCard label="Total Eventos" value={totalEvents} sub={`${finalized} finalizados`} icon={Gavel} />
        <StatCard label="Receita Total" value={`R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} sub={`Líquido: R$ ${(totalRevenue - totalExpenses).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} icon={DollarSign} color="var(--success)" />
        <StatCard label="Despesas" value={`R$ ${totalExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} icon={TrendingUp} color="var(--warning)" />
        <StatCard label="Operadores Ativos" value={activeOps} sub={`de ${operators.length} total`} icon={Users} color="var(--accent)" />
      </div>

      <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px' }}>Próximos Eventos</h3>
            <Link href="/dashboard/leiloes" className="btn btn-ghost btn-sm">Ver todos <ChevronRight size={14} /></Link>
          </div>
          {upcomingEvents.length === 0 ? (
            <div className="empty-state" style={{ padding: '30px' }}><Calendar size={32} style={{ opacity: 0.3, marginBottom: '8px' }} /><p style={{ fontSize: '13px' }}>Nenhum evento próximo</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {upcomingEvents.map((evt) => <EventListItem key={evt.id} evt={evt} />)}
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Alertas do Sistema</h3>
          {pendingClose > 0 && (
            <div style={{ display: 'flex', gap: '12px', padding: '14px', background: 'var(--warning-bg)', borderRadius: 'var(--radius-md)', marginBottom: '12px', alignItems: 'center' }}>
              <AlertTriangle size={20} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--warning)' }}>{pendingClose} evento(s) sem fechamento</p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Eventos passados que ainda não foram encerrados.</p>
              </div>
            </div>
          )}
          {noAssignment.length > 0 && (
            <div style={{ display: 'flex', gap: '12px', padding: '14px', background: 'var(--info-bg)', borderRadius: 'var(--radius-md)', marginBottom: '12px', alignItems: 'center' }}>
              <Users size={20} style={{ color: 'var(--info)', flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--info)' }}>{noAssignment.length} evento(s) sem equipe</p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Eventos futuros sem operadores escalados.</p>
              </div>
            </div>
          )}
          {pendingClose === 0 && noAssignment.length === 0 && (
            <div className="empty-state" style={{ padding: '30px' }}><CheckCircle size={32} style={{ opacity: 0.4, marginBottom: '8px', color: 'var(--success)' }} /><p style={{ fontSize: '13px', color: 'var(--success)' }}>Tudo em ordem!</p></div>
          )}
          <div style={{ marginTop: '16px', padding: '14px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>Este mês</p>
            <p style={{ fontSize: '22px', fontWeight: 700 }}>{monthEvents.length} <span style={{ fontSize: '14px', fontWeight: 400, color: 'var(--text-secondary)' }}>eventos</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== FINANCEIRO DASHBOARD ====================
function FinanceiroDashboard() {
  const { events, loading } = useAllEvents();

  if (loading) return <div className="skeleton" style={{ height: '400px' }} />;

  const now = new Date();
  const thisMonth = { start: startOfMonth(now), end: endOfMonth(now) };
  const monthEvents = events.filter((e) => isWithinInterval(toDate(e.date), thisMonth));
  const totalRevenue = monthEvents.reduce((s, e) => s + (e.actualRevenue || e.revenue || 0), 0);
  const totalExpenses = monthEvents.reduce((s, e) => s + (e.expenses || []).reduce((x, ex) => x + (ex.amount || 0), 0), 0);
  const net = totalRevenue - totalExpenses;
  const pending = events.filter((e) => e.status !== 'finalizado' && toDate(e.date) < now);

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '20px', marginBottom: '4px' }}>Resumo Financeiro</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{format(now, "MMMM 'de' yyyy", { locale: ptBR })}</p>
      </div>
      <div className="grid-stats">
        <StatCard label="Receita do Mês" value={`R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} icon={DollarSign} color="var(--success)" />
        <StatCard label="Despesas do Mês" value={`R$ ${totalExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} icon={TrendingUp} color="var(--warning)" />
        <StatCard label="Resultado Líquido" value={`R$ ${net.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} sub={net >= 0 ? 'Positivo ✓' : 'Negativo ⚠'} icon={BarChart2} color={net >= 0 ? 'var(--success)' : 'var(--error)'} />
        <StatCard label="Eventos Pendentes" value={pending.length} sub="sem fechamento" icon={AlertTriangle} color="var(--warning)" />
      </div>

      <div className="card" style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px' }}>Eventos do Mês</h3>
          <Link href="/dashboard/financeiro" className="btn btn-ghost btn-sm">Detalhes <ChevronRight size={14} /></Link>
        </div>
        {monthEvents.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}><Calendar size={28} style={{ opacity: 0.3 }} /><p>Nenhum evento este mês</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {monthEvents.slice(0, 10).map((evt) => {
              const rev = evt.actualRevenue || evt.revenue || 0;
              const exp = (evt.expenses || []).reduce((s, x) => s + (x.amount || 0), 0);
              return (
                <Link key={evt.id} href={`/dashboard/leiloes/detalhes?id=${evt.id}`} style={{ textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontWeight: 500, fontSize: '14px' }}>{evt.title}</p>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{format(toDate(evt.date), 'dd/MM/yyyy HH:mm')}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '13px', color: 'var(--success)', fontWeight: 600 }}>R$ {rev.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                      {exp > 0 && <p style={{ fontSize: '11px', color: 'var(--warning)' }}>- R$ {exp.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>}
                    </div>
                    <span className={`badge ${evt.status === 'finalizado' ? 'badge-success' : 'badge-warning'}`}>{evt.status}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== PLANEJAMENTO DASHBOARD ====================
function PlanejamentoDashboard() {
  const { events, loading } = useAllEvents();
  const now = new Date();

  if (loading) return <div className="skeleton" style={{ height: '400px' }} />;

  const withPlanning = events.filter((e) => e.needsPlanning && e.status !== 'finalizado' && toDate(e.date) >= now);
  const withoutPlan = withPlanning.filter((e) => !e.planning);
  const withPlan = withPlanning.filter((e) => !!e.planning);
  const upcoming = events.filter((e) => toDate(e.date) >= now).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime()).slice(0, 5);

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '20px', marginBottom: '4px' }}>Planejamento</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Visão geral dos eventos que precisam de planejamento</p>
      </div>
      <div className="grid-stats">
        <StatCard label="Precisam Planejamento" value={withPlanning.length} icon={Clipboard} />
        <StatCard label="Sem Planejamento" value={withoutPlan.length} sub="Ação necessária" icon={AlertTriangle} color="var(--error)" />
        <StatCard label="Com Planejamento" value={withPlan.length} icon={CheckCircle} color="var(--success)" />
        <StatCard label="Próximos Eventos" value={upcoming.length} icon={Calendar} color="var(--accent)" />
      </div>

      {withoutPlan.length > 0 && (
        <div className="card" style={{ marginTop: '20px', border: '1px solid rgba(239,68,68,0.25)' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '16px', color: 'var(--error)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={18} /> Sem Planejamento Definido
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {withoutPlan.map((evt) => <EventListItem key={evt.id} evt={evt} />)}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: '20px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Próximos Eventos</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {upcoming.map((evt) => <EventListItem key={evt.id} evt={evt} />)}
        </div>
      </div>
    </div>
  );
}

// ==================== COMERCIAL DASHBOARD ====================
function ComercialDashboard() {
  const { events, loading } = useAllEvents();
  const now = new Date();

  if (loading) return <div className="skeleton" style={{ height: '400px' }} />;

  const upcoming = events.filter((e) => toDate(e.date) >= now).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime()).slice(0, 8);
  const noRevenue = events.filter((e) => !e.revenue && toDate(e.date) >= now);
  const withRevenue = events.filter((e) => !!e.revenue);
  const totalRevenue = withRevenue.reduce((s, e) => s + (e.revenue || 0), 0);

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '20px', marginBottom: '4px' }}>Painel Comercial</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Faturamento e eventos</p>
      </div>
      <div className="grid-stats">
        <StatCard label="Eventos com Receita" value={withRevenue.length} icon={DollarSign} color="var(--success)" />
        <StatCard label="Receita Prevista" value={`R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} icon={TrendingUp} color="var(--accent)" />
        <StatCard label="Sem Faturamento" value={noRevenue.length} sub="Preencher receita" icon={AlertTriangle} color="var(--warning)" />
        <StatCard label="Próximos Eventos" value={upcoming.length} icon={Calendar} />
      </div>

      {noRevenue.length > 0 && (
        <div className="card" style={{ marginTop: '20px', border: '1px solid rgba(245,158,11,0.25)' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '16px', color: 'var(--warning)' }}>⚠ Eventos Sem Receita Cadastrada</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {noRevenue.map((evt) => <EventListItem key={evt.id} evt={evt} />)}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px' }}>Próximos Eventos</h3>
          <Link href="/dashboard/eventos" className="btn btn-ghost btn-sm">Ver todos <ChevronRight size={14} /></Link>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {upcoming.map((evt) => <EventListItem key={evt.id} evt={evt} />)}
        </div>
      </div>
    </div>
  );
}

// ==================== OPERADOR PAINEL DASHBOARD ====================
function OperadorPainelDashboard() {
  const { user } = useAuth();
  const [events, setEvents] = useState<(GestaoEvent & { id: string })[]>([]);
  const [allTodayEvents, setAllTodayEvents] = useState<(GestaoEvent & { id: string })[]>([]);
  const [operatorData, setOperatorData] = useState<(Operator & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'dia' | 'semana' | 'mes'>('semana');

  useEffect(() => {
    async function load() {
      if (!user) return;
      try {
        const [op, allEvts] = await Promise.all([
          getOperatorByUid(user.uid),
          getEvents(),
        ]);
        setOperatorData(op);
        setAllTodayEvents(allEvts.filter((e) => isToday(toDate(e.date))));
        if (op) {
          const evts = await getEventsByOperator(op.id);
          setEvents(evts);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  if (loading) return <div className="skeleton" style={{ height: '400px' }} />;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const filterByView = (evts: (GestaoEvent & { id: string })[]) => evts.filter((e) => {
    const d = toDate(e.date);
    if (viewMode === 'dia') return isToday(d);
    if (viewMode === 'semana') return isThisWeek(d, { locale: ptBR });
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const filteredEvents = filterByView(events);
  const upcomingEvents = events.filter((e) => toDate(e.date) >= today).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '22px', marginBottom: '4px' }}>Olá, {operatorData?.name?.split(' ')[0] || 'Operador'} 👋</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{format(now, "EEEE, dd 'de' MMMM", { locale: ptBR })}</p>
      </div>

      <div className="grid-stats">
        <StatCard label="Meus Serviços" value={events.length} sub={`${events.filter((e) => e.status === 'finalizado').length} finalizados`} icon={ClipboardList} />
        <StatCard label="Próximos" value={upcomingEvents.length} icon={Calendar} color="var(--accent)" />
        <StatCard label="Leilões Hoje" value={allTodayEvents.length} sub="na plataforma" icon={Gavel} color="var(--warning)" />
      </div>

      {/* Today's events */}
      {allTodayEvents.length > 0 && (
        <div className="card" style={{ marginBottom: '20px', border: '1px solid rgba(99,102,241,0.2)' }}>
          <h3 style={{ fontSize: '15px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Gavel size={16} style={{ color: 'var(--primary)' }} /> Todos os Leilões de Hoje
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {allTodayEvents.map((evt) => {
              const d = toDate(evt.date);
              const isAssigned = (evt.assignments || []).some((a) => a.operatorId === operatorData?.id);
              return (
                <div key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: isAssigned ? 'rgba(99,102,241,0.1)' : 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', border: isAssigned ? '1px solid rgba(99,102,241,0.3)' : 'none' }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 500, fontSize: '14px' }}>{evt.title}</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{format(d, 'HH:mm')} • {evt.city || 'N/D'}</p>
                  </div>
                  {isAssigned && <span className="badge badge-primary" style={{ fontSize: '11px' }}>Escalado</span>}
                  <span className={`badge ${evt.status === 'finalizado' ? 'badge-success' : 'badge-warning'}`}>{evt.status}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="tabs" style={{ marginBottom: '16px', display: 'inline-flex' }}>
        {(['dia', 'semana', 'mes'] as const).map((mode) => (
          <button key={mode} className={`tab ${viewMode === mode ? 'active' : ''}`} onClick={() => setViewMode(mode)}>
            {mode === 'dia' ? 'Hoje' : mode === 'semana' ? 'Semana' : 'Mês'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filteredEvents.length === 0 ? (
          <div className="empty-state card"><Calendar size={40} style={{ opacity: 0.3, marginBottom: '12px' }} /><h3>Sem serviços</h3><p>Nenhum serviço encontrado para este período.</p></div>
        ) : (
          filteredEvents.map((evt) => {
            const d = toDate(evt.date);
            const isPast = d < today;
            const myAssignment = (evt.assignments || []).find((a) => a.operatorId === operatorData?.id);
            const colleagues = (evt.assignments || []).filter((a) => a.operatorId !== operatorData?.id).map((a) => a.operatorName || 'Colega');
            return (
              <div key={evt.id} className="operator-schedule-card">
                <div className="schedule-date-badge">
                  <span className="day">{format(d, 'dd')}</span>
                  <span className="month">{format(d, 'MMM', { locale: ptBR })}</span>
                </div>
                <div className="schedule-info" style={{ flex: 1 }}>
                  <h4>{evt.studioName && <span style={{ color: 'var(--accent)' }}>{evt.studioName} · </span>}{evt.title}</h4>
                  <div className="schedule-meta">
                    <span className="schedule-meta-item"><Clock size={12} /> {format(d, 'HH:mm')}</span>
                    <span className="schedule-meta-item"><MapPin size={12} /> {evt.city || 'N/D'}</span>
                    {myAssignment?.isHalfShift && <span className="badge badge-warning" style={{ fontSize: '11px' }}>Meio Turno {myAssignment.halfShiftType === 'primeiro' ? '(1°)' : '(2°)'}</span>}
                  </div>
                  {colleagues.length > 0 && <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Com: {colleagues.join(', ')}</p>}
                </div>
                <span className={`badge ${evt.status === 'finalizado' ? 'badge-success' : evt.status === 'em_andamento' ? 'badge-warning' : isPast ? 'badge-error' : 'badge-accent'}`}>
                  {evt.status === 'finalizado' ? 'Finalizado' : evt.status === 'em_andamento' ? 'Em andamento' : isPast ? 'Pendente' : 'Agendado'}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ==================== OPERATOR TRANSMISSAO / FREELANCER ====================
function OperadorTransmissaoDashboard() {
  const { user } = useAuth();
  const [events, setEvents] = useState<(GestaoEvent & { id: string })[]>([]);
  const [operatorData, setOperatorData] = useState<(Operator & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [defaultRulesFunc, setDefaultRulesFunc] = useState<any>(null);
  const [defaultRulesN1, setDefaultRulesN1] = useState<any>(null);
  const [defaultRulesN2, setDefaultRulesN2] = useState<any>(null);
  const [fixedValues, setFixedValues] = useState<Record<string, number>>({});
  const [holidays, setHolidays] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      if (!user) return;
      try {
        const op = await getOperatorByUid(user.uid);
        setOperatorData(op);
        if (op) {
          const [evts, funcDoc, n1Doc, n2Doc, svcDoc, hols] = await Promise.all([
            getEventsByOperator(op.id),
            getDocument<any>('settings', 'default_rules_funcionario').catch(() => null),
            getDocument<any>('settings', 'default_rules_freelancer_n1').catch(() => null),
            getDocument<any>('settings', 'default_rules_freelancer_n2').catch(() => null),
            getDocument<any>('settings', 'services').catch(() => null),
            getCollection<any>('holidays').catch(() => []),
          ]);
          setEvents(evts);
          if (funcDoc) setDefaultRulesFunc({ ...funcDoc, contractType: 'funcionario' });
          if (n1Doc) setDefaultRulesN1({ ...n1Doc, contractType: 'freelancer_n1' });
          if (n2Doc) setDefaultRulesN2({ ...n2Doc, contractType: 'freelancer_n2' });
          if (svcDoc?.catalog) {
            const { serviceFixedValues } = await import('@/types/service');
            setFixedValues(serviceFixedValues(svcDoc.catalog));
          }
          setHolidays(hols);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  if (loading) return <div className="skeleton" style={{ height: '400px' }} />;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcoming = events.filter((e) => toDate(e.date) >= today).sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
  const thisMonth = { start: startOfMonth(now), end: endOfMonth(now) };
  const monthEvents = events.filter((e) => isWithinInterval(toDate(e.date), thisMonth));

  // Estimate earnings
  let estimatedEarnings = 0;
  if (operatorData) {
    let rules = operatorData.paymentRules;
    if (!rules && operatorData.contractType) {
      if (operatorData.contractType === 'funcionario') rules = defaultRulesFunc;
      else if (operatorData.contractType === 'freelancer_n1') rules = defaultRulesN1;
      else if (operatorData.contractType === 'freelancer_n2') rules = defaultRulesN2;
    }
    if (rules) {
      monthEvents.forEach((evt) => {
        const myAssignment = (evt.assignments || []).find((a) => a.operatorId === operatorData.id);
        if (myAssignment && evt.closing) {
          try {
            const payment = calculateOperatorPayment(evt, myAssignment, rules, holidays, [], defaultRulesN2, fixedValues);
            estimatedEarnings += payment.totalValue;
          } catch {}
        }
      });
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '22px', marginBottom: '4px' }}>Olá, {operatorData?.name?.split(' ')[0] || 'Operador'} 👋</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{format(now, "EEEE, dd 'de' MMMM", { locale: ptBR })}</p>
      </div>
      <div className="grid-stats">
        <StatCard label="Meus Eventos" value={events.length} icon={Gavel} />
        <StatCard label="Próximos" value={upcoming.length} icon={Calendar} color="var(--accent)" />
        <StatCard label="Este Mês" value={monthEvents.length} icon={ClipboardList} color="var(--info)" />
        <StatCard label="Estimativa do Mês" value={`R$ ${estimatedEarnings.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} icon={DollarSign} color="var(--success)" />
      </div>

      <div className="card" style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px' }}>Minha Agenda</h3>
          <Link href="/dashboard/meus-pagamentos" className="btn btn-ghost btn-sm">Meus Ganhos <ChevronRight size={14} /></Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}><Calendar size={28} style={{ opacity: 0.3 }} /><p>Sem eventos agendados</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {upcoming.slice(0, 8).map((evt) => {
              const d = toDate(evt.date);
              const myAssignment = (evt.assignments || []).find((a) => a.operatorId === operatorData?.id);
              const travelDays = (myAssignment?.travelDaysBefore || 0) + (myAssignment?.travelDaysAfter || 0);
              return (
                <div key={evt.id} className="operator-schedule-card">
                  <div className="schedule-date-badge">
                    <span className="day">{format(d, 'dd')}</span>
                    <span className="month">{format(d, 'MMM', { locale: ptBR })}</span>
                  </div>
                  <div className="schedule-info" style={{ flex: 1 }}>
                    <h4>{evt.studioName && <span style={{ color: 'var(--accent)' }}>{evt.studioName} · </span>}{evt.title}</h4>
                    <div className="schedule-meta">
                      <span className="schedule-meta-item"><Clock size={12} /> {format(d, 'HH:mm')}</span>
                      <span className="schedule-meta-item"><MapPin size={12} /> {evt.city || 'N/D'}</span>
                      {travelDays > 0 && <span className="badge badge-info" style={{ fontSize: '11px' }}>{travelDays}d viagem</span>}
                      {myAssignment?.isHalfShift && <span className="badge badge-warning" style={{ fontSize: '11px' }}>Meio Turno</span>}
                    </div>
                  </div>
                  <span className={`badge ${evt.operationType ? OPERATION_TYPE_BADGE[evt.operationType] : 'badge-info'}`}>
                    {evt.operationType ? OPERATION_TYPE_LABELS[evt.operationType] : 'N/D'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== OPERAÇÃO (escolhe painel x campo pela função) ====================
function OperacaoDashboard() {
  const { user } = useAuth();
  const [functions, setFunctions] = useState<string[] | null>(null);

  useEffect(() => {
    if (!user) return;
    getOperatorByUid(user.uid)
      .then((op) => setFunctions(op?.functions || []))
      .catch(() => setFunctions([]));
  }, [user]);

  if (functions === null) return <div className="skeleton" style={{ height: '400px' }} />;
  // Quem tem a função de Painel vê o painel (com todos os leilões do dia); demais veem a agenda simples.
  return functions.includes('operador_painel') ? <OperadorPainelDashboard /> : <OperadorTransmissaoDashboard />;
}

// ==================== MAIN DASHBOARD ====================
export default function DashboardPage() {
  const { profile, isHighManagement, isFinanceiro, isPlanejamento, isComercial, isOperadorPainel, isOperadorTransmissao, isManagement } = useAuth();
  const role = profile?.role;

  if (isHighManagement || role === 'gestor' || role === 'administrativo') return <AdminDashboard />;
  if (isFinanceiro) return <FinanceiroDashboard />;
  if (isPlanejamento) return <PlanejamentoDashboard />;
  if (isComercial) return <ComercialDashboard />;
  if (role === 'operacao') return <OperacaoDashboard />;
  if (isOperadorPainel) return <OperadorPainelDashboard />;
  if (isOperadorTransmissao || role === 'tecnico' || role === 'freelancer_estudio' || role === 'freelancer_externo' || role === 'operador') return <OperadorTransmissaoDashboard />;

  // Fallback
  return isManagement ? <AdminDashboard /> : <OperadorTransmissaoDashboard />;
}
