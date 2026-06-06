'use client';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getEventById, getEvents, updateEvent, addServiceToEvent, removeServiceFromEvent, assignOperator, removeAssignment, addExpense, removeExpense, closeEvent } from '@/services/events';
import { getActiveOperators } from '@/services/operators';
import { getDocument, getCollection } from '@/lib/firestore';
import { GestaoEvent, EventService, OperationType, EventAssignment, EventExpense, EventClosing, ExpenseCategory, EventPlanning, PlanningVehicle, PlanningHotel, PlanningChecklist } from '@/types/event';
import { Operator, isOperatorRestDay } from '@/types/operator';
import { useAuth } from '@/lib/auth-context';
import { isInternalService, isInternalEvent, calculateOperatorPayment } from '@/lib/payment-engine';
import CurrencyInput from '@/components/CurrencyInput';
import { format, parseISO, differenceInMinutes, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowLeft, Save, Settings, Users, DollarSign,
  CheckCircle, Plus, Trash2, Clock, MapPin,
  AlertTriangle, Clipboard, Car, Hotel, CheckSquare, Square,
  Calendar, Moon, Building2, Plane, Bus, Truck, Package,
  FileText, Download, Monitor,
} from 'lucide-react';

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) return (val as { toDate: () => Date }).toDate();
  if (typeof val === 'string') return parseISO(val);
  return new Date();
}

const SERVICE_TYPES = [
  'Retransmissão', 'Transmissão Estúdio', 'Transmissão Estúdio Plus',
  'Transmissão Externa', 'Produção Canal', 'Captação', 'Outro',
];

const CATEGORY_LABELS: Record<string, string> = {
  alimentacao: 'Alimentação',
  veiculo: 'Veículo',
  hospedagem: 'Hospedagem',
  outros: 'Outros',
};

function categoryLabel(cat: string) {
  return CATEGORY_LABELS[cat] || cat;
}

export default function EventoDetailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id') as string;
  const { profile } = useAuth();

  const [event, setEvent] = useState<(GestaoEvent & { id: string }) | null>(null);
  const [operators, setOperators] = useState<(Operator & { id: string })[]>([]);
  const [roles, setRoles] = useState<string[]>(['Diretor', 'DTV', 'vMix', 'Apoio']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'servicos' | 'equipe' | 'planejamento' | 'despesas' | 'fechamento'>('info');
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);

  // Info fields
  const [operationType, setOperationType] = useState<OperationType | ''>('');
  const [studioName, setStudioName] = useState('');
  const [revenue, setRevenue] = useState(0);
  const [observation, setObservation] = useState('');
  const [commercialIntermediary, setCommercialIntermediary] = useState('');
  const [contractInfo, setContractInfo] = useState('');
  const [company, setCompany] = useState('');
  const [financialCode, setFinancialCode] = useState('');
  const [needsPlanning, setNeedsPlanning] = useState(false);

  // Service lists & config states
  const [servicesList, setServicesList] = useState<string[]>([]);
  const [studiosList, setStudiosList] = useState<string[]>([]);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [defaultRulesFunc, setDefaultRulesFunc] = useState<any>(null);
  const [defaultRulesN1, setDefaultRulesN1] = useState<any>(null);
  const [defaultRulesN2, setDefaultRulesN2] = useState<any>(null);
  const [fixedValues, setFixedValues] = useState<Record<string, number>>({});

  // Service form
  const [newService, setNewService] = useState('');

  // Assignment form
  const [selectedOperator, setSelectedOperator] = useState('');
  const [assignmentRole, setAssignmentRole] = useState('');
  const [travelDaysBefore, setTravelDaysBefore] = useState(0);
  const [travelDaysAfter, setTravelDaysAfter] = useState(0);
  
  // Operador de painel — seleção rápida
  const [panelOperatorId, setPanelOperatorId] = useState('');

  // Operadores já escalados em OUTROS leilões no mesmo dia (operatorId -> título do leilão)
  const [dayBusy, setDayBusy] = useState<Map<string, string>>(new Map());

  // Half shift states
  const [isHalfShift, setIsHalfShift] = useState(false);
  const [halfShiftType, setHalfShiftType] = useState<'primeiro' | 'segundo'>('primeiro');
  const [shiftTime, setShiftTime] = useState('18:00');

  // Expense form
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>('alimentacao');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState(0);
  const [expenseOperator, setExpenseOperator] = useState('');

  // Closing / Travel form
  const [closingStart, setClosingStart] = useState('');
  const [closingEnd, setClosingEnd] = useState('');
  const [editingClosing, setEditingClosing] = useState(false);
  const [travelDeparture, setTravelDeparture] = useState('');
  const [travelDepartureTime, setTravelDepartureTime] = useState('');
  const [travelReturn, setTravelReturn] = useState('');
  const [travelReturnTime, setTravelReturnTime] = useState('');
  const [includeNf, setIncludeNf] = useState(true);
  const [fiscalPercent, setFiscalPercent] = useState(0);
  const [fiscalFramework, setFiscalFramework] = useState('');

  // Access control permissions helpers
  const isCEOOrAdmin = profile?.role === 'admin' || profile?.role === 'ceo';
  const canEditInfo = isCEOOrAdmin || profile?.role === 'operador_painel' || profile?.role === 'comercial';
  const isComercialOnly = profile?.role === 'comercial' && !isCEOOrAdmin;
  const canEditBilling = isCEOOrAdmin || profile?.role === 'comercial';
  const canEditServices = isCEOOrAdmin || profile?.role === 'operador_painel';
  const canEditEquipe = isCEOOrAdmin || profile?.role === 'operador_painel' || profile?.role === 'administrativo';
  const canEditPlanning = isCEOOrAdmin || profile?.role === 'planejamento';
  const canEditExpenses = isCEOOrAdmin || profile?.role === 'planejamento' || profile?.role === 'financeiro';
  const canEditClosing = isCEOOrAdmin || profile?.role === 'operador_painel';
  // Quem pode VER valores financeiros (receita/orçamento e total de despesas) do evento.
  // Planejamento NÃO vê orçamento nem total de despesas (só define o planejamento logístico).
  const canViewFinance = isCEOOrAdmin || profile?.role === 'financeiro' || profile?.role === 'comercial' || profile?.role === 'administrativo';

  const loadEvent = async () => {
    try {
      const evt = await getEventById(id);
      if (!evt) { router.push('/dashboard/eventos'); return; }
      setEvent(evt);
      setOperationType((evt.operationType as OperationType) || '');
      setStudioName(evt.studioName || '');
      setRevenue(evt.revenue || 0);
      setObservation(evt.observation || '');
      setCommercialIntermediary(evt.commercialIntermediary || '');
      setContractInfo(evt.contractInfo || '');
      setCompany(evt.company || '');
      setFinancialCode(evt.financialCode || '');
      setNeedsPlanning(evt.needsPlanning === true || evt.operationType === 'externo');
      
      // Pre-fill travel from planning
      if (evt.planning) {
        setTravelDeparture(evt.planning.departureDate || '');
        setTravelDepartureTime(evt.planning.departureTime || '');
        setTravelReturn(evt.planning.returnDate || '');
        setTravelReturnTime(evt.planning.returnTime || '');
      }

      // Operadores já escalados em outros leilões no MESMO dia deste evento
      try {
        const all = await getEvents();
        const busy = new Map<string, string>();
        all.forEach((e) => {
          if (e.id === evt.id) return;
          if (!isSameDay(toDate(e.date), toDate(evt.date))) return;
          (e.assignments || []).forEach((a) => {
            if (!busy.has(a.operatorId)) busy.set(a.operatorId, e.title);
          });
        });
        setDayBusy(busy);
      } catch (err) {
        console.error('Erro ao verificar escalas do dia:', err);
      }
    } catch (err) {
      console.error('Erro ao carregar evento:', err);
    }

    // Load operators
    try {
      const ops = await getActiveOperators();
      setOperators(ops);
    } catch {
      try {
        const { getOperators } = await import('@/services/operators');
        const allOps = await getOperators();
        setOperators(allOps.filter((o) => o.active !== false));
      } catch (err2) {
        console.error('Erro ao carregar operadores:', err2);
      }
    }

    // Load roles from settings
    try {
      const rolesDoc = await getDocument<{ list: string[] }>('settings', 'roles');
      if (rolesDoc && Array.isArray(rolesDoc.list) && rolesDoc.list.length > 0) {
        setRoles(rolesDoc.list);
      }
    } catch (err) {
      console.error('Erro ao carregar funções:', err);
    }

    // Load services from settings
    try {
      const servicesDoc = await getDocument<{ list: string[] }>('settings', 'services');
      if (servicesDoc && Array.isArray(servicesDoc.list) && servicesDoc.list.length > 0) {
        setServicesList(servicesDoc.list);
      }
    } catch (err) {
      console.error('Erro ao carregar serviços:', err);
    }

    // Load studios from settings
    try {
      const studiosDoc = await getDocument<{ list: string[] }>('settings', 'studios');
      if (studiosDoc && Array.isArray(studiosDoc.list) && studiosDoc.list.length > 0) {
        setStudiosList(studiosDoc.list);
      }
    } catch (err) {
      console.error('Erro ao carregar estúdios:', err);
    }

    // Load holidays
    try {
      const holidaysData = await getCollection<any>('holidays');
      setHolidays(holidaysData);
    } catch (err) {
      console.error('Erro ao carregar feriados:', err);
    }

    // Load default payment rules
    try {
      const [funcDoc, n1Doc, n2Doc, svcDoc] = await Promise.all([
        getDocument<any>('settings', 'default_rules_funcionario').catch(() => null),
        getDocument<any>('settings', 'default_rules_freelancer_n1').catch(() => null),
        getDocument<any>('settings', 'default_rules_freelancer_n2').catch(() => null),
        getDocument<any>('settings', 'services').catch(() => null),
      ]);
      if (funcDoc) setDefaultRulesFunc({ ...funcDoc, contractType: 'funcionario' });
      if (n1Doc) setDefaultRulesN1({ ...n1Doc, contractType: 'freelancer_n1' });
      if (n2Doc) setDefaultRulesN2({ ...n2Doc, contractType: 'freelancer_n2' });
      if (svcDoc?.catalog) {
        const { serviceFixedValues } = await import('@/types/service');
        setFixedValues(serviceFixedValues(svcDoc.catalog));
      }
    } catch (err) {
      console.error('Erro ao carregar regras de pagamento padrão:', err);
    }

    // Load fiscal settings
    try {
      const fiscalDoc = await getDocument<{ framework: string; nfPercent: number }>('settings', 'fiscal');
      if (fiscalDoc) {
        setFiscalPercent(fiscalDoc.nfPercent || 0);
        setFiscalFramework(fiscalDoc.framework || '');
      }
    } catch {}

    setLoading(false);
  };

  useEffect(() => { loadEvent(); }, [id]);

  // If planning is disabled and user is on the planning tab, go back to info
  useEffect(() => {
    if (!needsPlanning && activeTab === 'planejamento') {
      setActiveTab('info');
    }
  }, [needsPlanning, activeTab]);

  const showToast = (message: string, type: string = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSaveInfo = async () => {
    setSaving(true);
    try {
      const isInternal = isInternalEvent(event?.services || []);
      const resolvedOpType = isInternal ? 'estudio' : operationType;
      const resolvedNeedsPlanning = resolvedOpType === 'externo' ? true : needsPlanning;

      await updateEvent(id, {
        operationType: resolvedOpType as OperationType || null,
        studioName: resolvedOpType === 'estudio' ? studioName : null,
        revenue,
        observation,
        commercialIntermediary,
        contractInfo,
        company,
        financialCode,
        needsPlanning: resolvedNeedsPlanning,
      } as Partial<GestaoEvent>);
      showToast('Evento atualizado!');
      await loadEvent();
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  };


  const handleAddService = async () => {
    if (!newService) return;
    const currentServices = event?.services || [];
    try {
      await addServiceToEvent(id, { eventId: id, serviceName: newService, serviceOrder: currentServices.length + 1 } as EventService);
      setNewService('');
      showToast('Serviço adicionado!');
      await loadEvent();
    } catch (err) {
      console.error(err);
      showToast('Erro ao adicionar serviço.', 'error');
    }
  };

  const handleRemoveService = async (order: number) => {
    try {
      await removeServiceFromEvent(id, order);
      await loadEvent();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAssign = async () => {
    if (!selectedOperator || !assignmentRole) return;
    // Multi-leilão no mesmo dia é permitido (ex.: Bora 12h + leilão 20h) — apenas informamos.
    const busyTitle = dayBusy.get(selectedOperator);
    const op = operators.find((o) => o.id === selectedOperator);
    // Folga: avisa e marca onRestDay (gera valor extra no pagamento, como freelancer)
    const onRestDay = !!op && !!event && isOperatorRestDay(op, toDate(event.date));
    // Viagem automática: ida = início − dias antes; volta = fim + dias depois.
    let departureDate: Date | null = null;
    let returnDate: Date | null = null;
    if (event && (travelDaysBefore > 0 || travelDaysAfter > 0)) {
      const evStart = toDate(event.date);
      const evEnd = event.endDate ? toDate(event.endDate) : evStart;
      const dep = new Date(evStart); dep.setDate(dep.getDate() - travelDaysBefore);
      const ret = new Date(evEnd); ret.setDate(ret.getDate() + travelDaysAfter);
      departureDate = dep;
      returnDate = ret;
    }
    try {
      // Firestore rejeita campos undefined — só incluímos os campos de meio-turno
      // quando realmente é meio-turno.
      const assignment: EventAssignment = {
        eventId: id,
        operatorId: selectedOperator,
        operatorName: op?.name || '',
        role: assignmentRole,
        travelDaysBefore,
        travelDaysAfter,
        departureDate,
        returnDate,
        status: 'confirmado',
        isHalfShift,
        onRestDay,
      };
      if (isHalfShift) {
        assignment.halfShiftType = halfShiftType;
        assignment.shiftTime = shiftTime;
      }
      await assignOperator(id, assignment);
      setSelectedOperator('');
      setIsHalfShift(false);
      setShiftTime('18:00');
      showToast(
        onRestDay ? 'Escalado em DIA DE FOLGA — gera valor extra.'
          : busyTitle ? `Escalado! (também em "${busyTitle}" hoje — diária)`
          : 'Operador escalado!',
        onRestDay ? 'warning' : busyTitle ? 'info' : 'success',
      );
      await loadEvent();
    } catch (err) {
      console.error(err);
      showToast('Erro ao escalar.', 'error');
    }
  };

  const handleAssignPanel = async () => {
    if (!panelOperatorId) return;
    const op = operators.find((o) => o.id === panelOperatorId);
    const onRestDay = !!op && !!event && isOperatorRestDay(op, toDate(event.date));
    const busyTitle = dayBusy.get(panelOperatorId);
    try {
      await assignOperator(id, {
        eventId: id,
        operatorId: panelOperatorId,
        operatorName: op?.name || '',
        role: 'Operador de Painel',
        travelDaysBefore: 0,
        travelDaysAfter: 0,
        departureDate: null,
        returnDate: null,
        status: 'confirmado',
        isHalfShift: false,
        onRestDay,
      });
      setPanelOperatorId('');
      showToast(
        onRestDay ? 'Operador de Painel escalado em DIA DE FOLGA — gera valor extra.'
          : busyTitle ? `Escalado! (também em "${busyTitle}" hoje)`
          : 'Operador de Painel escalado!',
        onRestDay ? 'warning' : busyTitle ? 'info' : 'success',
      );
      await loadEvent();
    } catch (err) {
      console.error(err);
      showToast('Erro ao escalar operador de painel.', 'error');
    }
  };

  const handleRemoveAssignment = async (operatorId: string) => {
    try {
      await removeAssignment(id, operatorId);
      await loadEvent();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddExpense = async () => {
    if (!expenseDescription || !expenseAmount) return;
    const op = operators.find((o) => o.id === expenseOperator);
    try {
      await addExpense(id, {
        eventId: id,
        operatorId: expenseOperator,
        operatorName: op?.name || 'Geral',
        category: expenseCategory,
        description: expenseDescription,
        amount: expenseAmount,
        date: new Date(),
      } as EventExpense);
      setExpenseDescription('');
      setExpenseAmount(0);
      showToast('Despesa adicionada!');
      await loadEvent();
    } catch (err) {
      console.error(err);
      showToast('Erro ao adicionar despesa.', 'error');
    }
  };

  const handleRemoveExpense = async (expenseId: string) => {
    try {
      await removeExpense(id, expenseId);
      await loadEvent();
    } catch (err) {
      console.error(err);
    }
  };

  const handleClose = async () => {
    if (!closingStart || !closingEnd) { showToast('Preencha os horários.', 'error'); return; }
    const start = new Date(closingStart);
    let end = new Date(closingEnd);
    let crossedMidnight = false;
    if (end <= start) { end = new Date(end.getTime() + 86400000); crossedMidnight = true; }
    const duration = differenceInMinutes(end, start);
    const isEdit = !!event?.closing;

    try {
      await closeEvent(id, {
        eventId: id,
        actualStartTime: start,
        actualEndTime: end,
        durationMinutes: duration,
        crossedMidnight,
        closedBy: 'admin',
        closedAt: new Date(),
      } as EventClosing);
      setEditingClosing(false);
      showToast(
        isEdit
          ? 'Fechamento corrigido. Valores financeiros recalculados.'
          : 'Evento encerrado!',
        'success',
      );
      await loadEvent();
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar fechamento.', 'error');
    }
  };

  const extratoRef = useRef<HTMLDivElement>(null);

  const handleExportPDF = async () => {
    if (!extratoRef.current) return;
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const element = extratoRef.current;
      const opt = {
        margin: [10, 10, 10, 10],
        filename: `extrato_${event!.title.replace(/[^a-zA-Z0-9]/g, '_')}_${format(eventDate, 'dd-MM-yyyy')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#0c1220' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      };
      await html2pdf().set(opt).from(element).save();
      showToast('PDF exportado com sucesso!');
    } catch (err) {
      console.error('Erro ao gerar PDF:', err);
      showToast('Erro ao exportar PDF.', 'error');
    }
  };

  if (loading) return <div className="skeleton" style={{ height: '500px' }} />;
  if (!event) return null;

  const eventDate = toDate(event.date);
  const planningVehicleCost = event.planning?.vehicle?.totalCost || 0;
  const planningHotelCost = event.planning?.hotel?.totalCost || 0;
  const planningCost = planningVehicleCost + planningHotelCost;

  // Obter o cálculo de pagamentos dos operadores escalados
  const teamPayments = (event.assignments || []).map((a) => {
    const op = operators.find((o) => o.id === a.operatorId);
    let rules = (op?.paymentRules?.hourRanges?.length ?? 0) > 0 ? op?.paymentRules : null;
    if (!rules && op?.contractType) {
      if (op.contractType === 'funcionario') rules = defaultRulesFunc;
      else if (op.contractType === 'freelancer_n1') rules = defaultRulesN1;
      else if (op.contractType === 'freelancer_n2') rules = defaultRulesN2;
    }
    if (op?.paymentRules && !(op.paymentRules.hourRanges?.length) && rules) {
      rules = { ...rules, ...op.paymentRules, hourRanges: rules.hourRanges };
    }
    if (rules) {
      try {
        const pay = calculateOperatorPayment(event, a, rules, holidays, [], defaultRulesN2, fixedValues);
        return {
          operatorId: a.operatorId,
          operatorName: a.operatorName || op?.name || 'Operador',
          role: a.role,
          contractType: op?.contractType || 'N/D',
          total: pay.totalValue,
          details: pay
        };
      } catch (err) {
        console.error('Erro ao calcular pagamento:', a.operatorName, err);
      }
    }
    return {
      operatorId: a.operatorId,
      operatorName: a.operatorName || op?.name || 'Operador',
      role: a.role,
      contractType: op?.contractType || 'N/D',
      total: 0,
      details: null
    };
  });
  const totalTeamPayments = teamPayments.reduce((s, p) => s + p.total, 0);

  const totalExpenses = (event.expenses || []).reduce((s, e) => s + (e.amount || 0), 0) + planningCost + totalTeamPayments;

  return (
    <div>
      {toast && <div className="toast-container"><div className={`toast toast-${toast.type}`}>{toast.message}</div></div>}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
        <button className="btn btn-ghost btn-icon" onClick={() => router.push('/dashboard/leiloes')}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '22px' }}>{event.title}</h1>
          <div style={{ display: 'flex', gap: '14px', marginTop: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={14} /> {format(eventDate, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <MapPin size={14} /> {event.city || 'N/D'}, {event.state || ''}
            </span>
          </div>
        </div>
        <span className={`badge ${event.status === 'finalizado' ? 'badge-success' : event.status === 'escalado' ? 'badge-accent' : 'badge-warning'}`}>{event.status}</span>
      </div>

      {/* Quick Stats */}
      <div className="grid-stats" style={{ marginBottom: '24px' }}>
        {canViewFinance && (
          <>
            <div className="card-stat">
              <span className="stat-label">Receita Prevista</span>
              <span className="stat-value" style={{ fontSize: '20px' }}>R$ {(event.revenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="card-stat">
              <span className="stat-label">Despesas</span>
              <span className="stat-value" style={{ fontSize: '20px', color: 'var(--warning)' }}>R$ {totalExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
          </>
        )}
        <div className="card-stat">
          <span className="stat-label">Equipe</span>
          <span className="stat-value" style={{ fontSize: '20px' }}>{(event.assignments || []).length} operador(es)</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: '24px' }}>
        {([
          { key: 'info', label: 'Informações', icon: Settings, show: true },
          { key: 'servicos', label: 'Serviços', icon: Settings, show: true },
          { key: 'equipe', label: 'Equipe', icon: Users, show: true },
          { key: 'planejamento', label: 'Planejamento', icon: Clipboard, show: needsPlanning },
          { key: 'despesas', label: 'Financeiro', icon: DollarSign, show: canViewFinance },
          { key: 'fechamento', label: 'Fechamento', icon: CheckCircle, show: canEditClosing || canViewFinance },
        ] as { key: typeof activeTab; label: string; icon: React.ElementType; show: boolean }[])
          .map(({ key, label, icon: Icon, show }) => (
            show ? (
              <button key={key} className={`tab ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key)}>
                <Icon size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                {label}
              </button>
            ) : null
          ))}
      </div>

      {/* Info Tab */}
      {activeTab === 'info' && (
        <div className="card animate-in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '600px' }}>
            <div className="input-group">
              <label>Tipo de Operação *</label>
              <select className="input" value={operationType} onChange={(e) => {
                const v = e.target.value as OperationType;
                setOperationType(v);
                // Externo já exige planejamento e habilita a aba; retransmissão não precisa.
                if (v === 'externo') setNeedsPlanning(true);
                else if (v === 'retransmissao') setNeedsPlanning(false);
              }} disabled={!canEditInfo}>
                <option value="">Selecione...</option>
                <option value="estudio">Estúdio</option>
                <option value="externo">Externo</option>
                <option value="retransmissao">Retransmissão (só painel)</option>
              </select>
            </div>
            {operationType === 'estudio' && (
              <div className="input-group">
                <label>Estúdio</label>
                {studiosList.length > 0 ? (
                  <select className="input" value={studioName} onChange={(e) => setStudioName(e.target.value)} disabled={!canEditInfo}>
                    <option value="">Selecione o estúdio...</option>
                    {studiosList.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input className="input" value={studioName} onChange={(e) => setStudioName(e.target.value)} placeholder="Ex: Estúdio A" disabled={!canEditInfo} />
                )}
              </div>
            )}
            {/* Needs Planning Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
              <button
                onClick={() => operationType !== 'externo' && setNeedsPlanning(!needsPlanning)}
                style={{ background: 'none', border: 'none', cursor: operationType === 'externo' ? 'default' : 'pointer', color: needsPlanning ? 'var(--primary)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px', padding: 0 }}
              >
                {needsPlanning ? <CheckCircle size={20} /> : <Square size={20} />}
                <span style={{ fontSize: '14px', fontWeight: 500 }}>Requer Planejamento</span>
              </button>
              {operationType === 'externo' && (
                <span style={{ fontSize: '12px', color: 'var(--warning)', marginLeft: 'auto' }}>Obrigatório para eventos externos</span>
              )}
            </div>
            <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="input-group">
                <label>Receita Prevista (R$)</label>
                <CurrencyInput value={revenue} onChange={setRevenue} />
              </div>
              <div className="input-group">
                <label>Código Financeiro</label>
                <input className="input" value={financialCode} onChange={(e) => setFinancialCode(e.target.value)} disabled={!canEditBilling} />
              </div>
            </div>
            <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="input-group">
                <label>Intermediário Comercial</label>
                <input className="input" value={commercialIntermediary} onChange={(e) => setCommercialIntermediary(e.target.value)} disabled={!canEditBilling} />
              </div>
              <div className="input-group">
                <label>Contrato</label>
                <input className="input" value={contractInfo} onChange={(e) => setContractInfo(e.target.value)} disabled={!canEditBilling} />
              </div>
            </div>
            <div className="input-group">
              <label>Empresa</label>
              <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} disabled={!canEditInfo} />
            </div>
            <div className="input-group">
              <label>Observação</label>
              <textarea className="input" rows={3} value={observation} onChange={(e) => setObservation(e.target.value)} style={{ resize: 'vertical' }} disabled={!canEditInfo} />
            </div>
            {canEditInfo && (
              <button className="btn btn-primary" onClick={handleSaveInfo} disabled={saving}>
                {saving ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> : <><Save size={16} /> Salvar</>}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Services Tab */}
      {activeTab === 'servicos' && (
        <div className="card animate-in">
          <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Serviços do Evento (máx. 4)</h3>
          {/* Internal event alert */}
          {isInternalEvent(event.services || []) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'rgba(99,102,241,0.12)', borderRadius: 'var(--radius-md)', marginBottom: '16px', border: '1px solid rgba(99,102,241,0.3)' }}>
              <AlertTriangle size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Evento interno: escale pelo menos <strong>2 operadores</strong> de transmissão/painel.</span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            {(event.services || []).map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                <span className="badge badge-accent" style={{ minWidth: '24px', justifyContent: 'center' }}>{s.serviceOrder}</span>
                <span style={{ flex: 1, fontWeight: 500 }}>{s.serviceName}</span>
                {canEditServices && (
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleRemoveService(s.serviceOrder)} style={{ color: 'var(--error)' }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {canEditServices && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <select className="input" value={newService} onChange={(e) => setNewService(e.target.value)} style={{ flex: 1 }}>
                <option value="">Selecione o serviço...</option>
                {(servicesList.length > 0 ? servicesList : SERVICE_TYPES).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="btn btn-primary" onClick={handleAddService}>
                <Plus size={16} /> Adicionar
              </button>
            </div>
          )}
        </div>
      )}

      {/* Team Tab */}
      {activeTab === 'equipe' && (
        <div className="card animate-in">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px' }}>Equipe Escalada</h3>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{(event.assignments || []).length} operador(es)</span>
          </div>
          {/* Operador de Painel — seção dedicada */}
          {(() => {
            const panelAssignments = (event.assignments || []).filter(
              (a) => a.role === 'Operador de Painel' ||
                operators.find((o) => o.id === a.operatorId)?.functions?.includes('operador_painel')
            );
            const availablePanelOps = operators.filter(
              (o) => o.functions?.includes('operador_painel') &&
                !(event.assignments || []).some((a) => a.operatorId === o.id)
            );
            return (
              <div style={{ padding: '16px', background: 'rgba(99,102,241,0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(99,102,241,0.2)', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <Monitor size={16} style={{ color: 'var(--primary)' }} />
                  <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Operador de Painel</h4>
                  {panelAssignments.length === 0 && (
                    <span className="badge badge-warning" style={{ fontSize: '10px', marginLeft: 'auto' }}>Não escalado</span>
                  )}
                </div>

                {panelAssignments.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: availablePanelOps.length > 0 && canEditEquipe ? '12px' : '0' }}>
                    {panelAssignments.map((a, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)' }}>
                        <div className="avatar" style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', width: '32px', height: '32px', fontSize: '13px', flexShrink: 0 }}>
                          {(a.operatorName || '?').charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontWeight: 500, fontSize: '14px' }}>{a.operatorName}</p>
                          <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                            <span className={`badge ${a.status === 'confirmado' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '10px' }}>{a.status}</span>
                            {a.onRestDay && <span className="badge badge-warning" style={{ fontSize: '10px' }}>Folga (extra)</span>}
                          </div>
                        </div>
                        {canEditEquipe && (
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleRemoveAssignment(a.operatorId)} style={{ color: 'var(--error)' }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {canEditEquipe && availablePanelOps.length > 0 && (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <select className="input" value={panelOperatorId} onChange={(e) => setPanelOperatorId(e.target.value)} style={{ flex: 1 }}>
                      <option value="">Selecione o operador de painel...</option>
                      {availablePanelOps.map((o) => {
                        const busyTitle = dayBusy.get(o.id);
                        return (
                          <option key={o.id} value={o.id}>
                            {o.name}{busyTitle ? ` — também em: ${busyTitle}` : ''}
                          </option>
                        );
                      })}
                    </select>
                    <button className="btn btn-primary" disabled={!panelOperatorId} onClick={handleAssignPanel}>
                      <Plus size={16} /> Escalar
                    </button>
                  </div>
                )}

                {canEditEquipe && availablePanelOps.length === 0 && panelAssignments.length === 0 && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Nenhum operador com função de painel disponível.{' '}
                    <a href="/dashboard/operadores" style={{ color: 'var(--primary)' }}>Configure as funções dos operadores.</a>
                  </p>
                )}
              </div>
            );
          })()}

          {/* Internal event 2-person alert */}
          {isInternalEvent(event.services || []) && (event.assignments || []).length < 2 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'rgba(245,158,11,0.12)', borderRadius: 'var(--radius-md)', marginBottom: '16px', border: '1px solid rgba(245,158,11,0.3)' }}>
              <AlertTriangle size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Evento interno requer pelo menos <strong>2 operadores</strong>. Atualmente: {(event.assignments || []).length}.</span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            {(event.assignments || []).map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                <div className="avatar" style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))' }}>
                  {(a.operatorName || '?').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 500 }}>{a.operatorName || 'Operador'}</p>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                    <span className="badge badge-info" style={{ fontSize: '11px' }}>{a.role}</span>
                    {a.isHalfShift && <span className="badge badge-warning" style={{ fontSize: '11px' }}>{a.halfShiftType === 'primeiro' ? 'Primeiro Turno' : 'Segundo Turno'}{a.shiftTime ? ` - ${a.shiftTime}` : ''}</span>}
                    {a.onRestDay && <span className="badge badge-warning" style={{ fontSize: '11px' }} title="Escalado em dia de folga — valor extra">Folga (extra)</span>}
                    {a.travelDaysBefore > 0 && <span className="badge" style={{ fontSize: '11px', background: 'rgba(99,102,241,0.15)', color: 'var(--primary)' }}><Car size={10} style={{ verticalAlign: 'middle' }} /> {a.travelDaysBefore}d antes</span>}
                    {a.travelDaysAfter > 0 && <span className="badge" style={{ fontSize: '11px', background: 'rgba(99,102,241,0.15)', color: 'var(--primary)' }}>{a.travelDaysAfter}d depois</span>}
                    {(() => {
                      let dep = a.departureDate;
                      let ret = a.returnDate;
                      if (!dep && a.travelDaysBefore > 0 && event) {
                        const evStart = toDate(event.date);
                        const d = new Date(evStart);
                        d.setDate(d.getDate() - a.travelDaysBefore);
                        dep = d;
                      }
                      if (!ret && a.travelDaysAfter > 0 && event) {
                        const evEnd = event.endDate ? toDate(event.endDate) : toDate(event.date);
                        const d = new Date(evEnd);
                        d.setDate(d.getDate() + a.travelDaysAfter);
                        ret = d;
                      }
                      if (dep || ret) {
                        return (
                          <span className="badge" style={{ fontSize: '11px', background: 'rgba(99,102,241,0.15)', color: 'var(--primary)' }} title="Viagem">
                            <Car size={10} style={{ verticalAlign: 'middle' }} /> {dep ? format(toDate(dep), 'dd/MM') : '?'} → {ret ? format(toDate(ret), 'dd/MM') : '?'}
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
                <span className={`badge ${a.status === 'confirmado' ? 'badge-success' : 'badge-warning'}`}>{a.status}</span>
                {canEditEquipe && (
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleRemoveAssignment(a.operatorId)} style={{ color: 'var(--error)' }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            {(event.assignments || []).length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Nenhum operador escalado.</p>
            )}
          </div>

          {canEditEquipe && (
            <>
              <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Escalar Operador</h4>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="input-group" style={{ flex: 1, minWidth: '200px' }}>
                  <label>Operador</label>
                  <select className="input" value={selectedOperator} onChange={(e) => setSelectedOperator(e.target.value)}>
                    <option value="">Selecione...</option>
                    {operators.filter((o) => !(event.assignments || []).some((a) => a.operatorId === o.id)).map((o) => {
                      const busyTitle = dayBusy.get(o.id);
                      return (
                        <option key={o.id} value={o.id}>
                          {o.name}{busyTitle ? ` — também em: ${busyTitle}` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="input-group" style={{ minWidth: '200px' }}>
                  <label>Função</label>
                  <select className="input" value={assignmentRole} onChange={(e) => setAssignmentRole(e.target.value)}>
                    <option value="">Selecione a função...</option>
                    {roles.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                {operationType === 'externo' && (
                  <>
                    <div className="input-group" style={{ width: '100px' }}>
                      <label>Dias antes</label>
                      <input className="input" type="number" value={travelDaysBefore} onChange={(e) => setTravelDaysBefore(Number(e.target.value))} min={0} />
                    </div>
                    <div className="input-group" style={{ width: '100px' }}>
                      <label>Dias depois</label>
                      <input className="input" type="number" value={travelDaysAfter} onChange={(e) => setTravelDaysAfter(Number(e.target.value))} min={0} />
                    </div>
                  </>
                )}
              </div>
              {/* Half Shift */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px', padding: '10px 16px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                <button
                  onClick={() => setIsHalfShift(!isHalfShift)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: isHalfShift ? 'var(--primary)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px', padding: 0 }}
                >
                  {isHalfShift ? <CheckCircle size={18} /> : <Square size={18} />}
                  <span style={{ fontSize: '13px' }}>Meio Turno</span>
                </button>
                {isHalfShift && (
                  <>
                    <select className="input" value={halfShiftType} onChange={(e) => setHalfShiftType(e.target.value as 'primeiro' | 'segundo')} style={{ width: '140px' }}>
                      <option value="primeiro">Primeiro Turno</option>
                      <option value="segundo">Segundo Turno</option>
                    </select>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Clock size={14} style={{ color: 'var(--text-muted)' }} />
                      <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Horário</label>
                      <input className="input" type="time" value={shiftTime} onChange={(e) => setShiftTime(e.target.value)} style={{ width: '110px' }} />
                    </div>
                  </>
                )}
              </div>
              <button className="btn btn-primary" onClick={handleAssign} style={{ marginTop: '12px' }} disabled={!selectedOperator || !assignmentRole}>
                <Plus size={16} /> Escalar
              </button>
            </>
          )}
        </div>
      )}

      {/* Expenses Tab */}
      {activeTab === 'despesas' && (
        <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Revenue + Balance Summary */}
          <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div className="card" style={{ borderLeft: '3px solid var(--success)' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Receita do Evento</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>R$</span>
                <CurrencyInput
                  value={revenue}
                  onChange={setRevenue}
                  style={{ fontSize: '20px', fontWeight: 700, color: 'var(--success)', background: 'transparent', border: '1px solid var(--border)', padding: '6px 10px' }}
                />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    try {
                      await updateEvent(id, { revenue } as Partial<GestaoEvent>);
                      showToast('Receita salva!');
                      await loadEvent();
                    } catch { showToast('Erro ao salvar.', 'error'); }
                  }}
                  style={{ flexShrink: 0 }}
                >
                  <Save size={14} />
                </button>
              </div>
            </div>
            <div className="card" style={{ borderLeft: '3px solid var(--warning)' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Despesas</span>
              <p style={{ fontSize: '20px', fontWeight: 700, color: 'var(--warning)', marginTop: '8px' }}>
                R$ {totalExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Diretas: R$ {(event.expenses || []).reduce((s, e) => s + (e.amount || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                {totalTeamPayments > 0 && ` · Equipe: R$ ${totalTeamPayments.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                {planningCost > 0 && ` · Deslocamento: R$ ${planningCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
              </div>
            </div>
            <div className="card" style={{ borderLeft: `3px solid ${(revenue - totalExpenses) >= 0 ? 'var(--success)' : 'var(--error)'}` }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Resultado</span>
              <p style={{ fontSize: '20px', fontWeight: 700, color: (revenue - totalExpenses) >= 0 ? 'var(--success)' : 'var(--error)', marginTop: '8px' }}>
                R$ {(revenue - totalExpenses).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {/* Expenses List */}
          <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px' }}>Despesas do Evento</h3>
          </div>

          {(event.expenses || []).length > 0 && (
            <div className="table-container" style={{ marginBottom: '20px' }}>
              <table className="table">
                <thead><tr><th>Categoria</th><th>Descrição</th><th>Operador</th><th style={{ textAlign: 'right' }}>Valor</th><th></th></tr></thead>
                <tbody>
                  {(event.expenses || []).map((exp) => (
                    <tr key={exp.id}>
                      <td><span className="badge badge-info">{exp.category}</span></td>
                      <td>{exp.description}</td>
                      <td>{exp.operatorName || 'Geral'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>R$ {exp.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td>
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleRemoveExpense(exp.id!)} style={{ color: 'var(--error)' }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {teamPayments.length > 0 && (
            <div style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '20px', marginBottom: '20px' }}>
              <h4 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-secondary)' }}>Remuneração de Equipe</h4>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Operador</th>
                      <th>Função</th>
                      <th>Contrato</th>
                      <th>Cálculo Aplicado</th>
                      <th style={{ textAlign: 'right' }}>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamPayments.map((p, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{p.operatorName}</td>
                        <td>{p.role}</td>
                        <td>
                          <span className="badge badge-info" style={{ fontSize: '10px' }}>
                            {p.contractType === 'funcionario' ? 'Funcionário (CLT)' : p.contractType === 'freelancer_n1' ? 'Freelancer N1' : p.contractType === 'freelancer_n2' ? 'Freelancer N2' : p.contractType}
                          </span>
                        </td>
                        <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {p.details?.ruleApplied || (event.status === 'finalizado' ? 'Sem cálculo' : 'Aguardando encerramento')}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--warning)' }}>
                          R$ {p.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)' }}>Total Equipe</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '15px', color: 'var(--warning)' }}>
                        R$ {totalTeamPayments.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Nova Despesa</h4>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="input-group" style={{ width: '150px' }}>
              <label>Categoria</label>
              <select className="input" value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value as ExpenseCategory)}>
                <option value="alimentacao">Alimentação</option>
                <option value="hospedagem">Hospedagem</option>
                <option value="veiculo">Veículo</option>
                <option value="outros">Outros</option>
              </select>
            </div>
            <div className="input-group" style={{ flex: 1, minWidth: '200px' }}>
              <label>Descrição</label>
              <input className="input" value={expenseDescription} onChange={(e) => setExpenseDescription(e.target.value)} placeholder="Descrição da despesa" />
            </div>
            <div className="input-group" style={{ width: '130px' }}>
              <label>Valor (R$)</label>
              <CurrencyInput value={expenseAmount} onChange={setExpenseAmount} />
            </div>
            <div className="input-group" style={{ width: '180px' }}>
              <label>Operador</label>
              <select className="input" value={expenseOperator} onChange={(e) => setExpenseOperator(e.target.value)}>
                <option value="">Geral</option>
                {(event.assignments || []).map((a) => <option key={a.operatorId} value={a.operatorId}>{a.operatorName}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" onClick={handleAddExpense} style={{ marginBottom: '6px' }}>
              <Plus size={16} /> Adicionar
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Planning Tab */}
      {activeTab === 'planejamento' && <PlanningTab event={event} eventId={id} onSave={loadEvent} showToast={showToast} />}

      {/* Closing Tab */}
      {activeTab === 'fechamento' && (
        <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Section 1: Travel Closure */}
          <div className="card">
            <h3 style={{ fontSize: '16px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MapPin size={18} /> Fechamento de Viagem
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Dados pré-carregados do planejamento. Ajuste se necessário.
            </p>
            <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
              <div className="input-group">
                <label>Data Saída</label>
                <input className="input" type="date" value={travelDeparture} onChange={(e) => setTravelDeparture(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Hora Saída</label>
                <input className="input" type="time" value={travelDepartureTime} onChange={(e) => setTravelDepartureTime(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Data Retorno</label>
                <input className="input" type="date" value={travelReturn} onChange={(e) => setTravelReturn(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Hora Retorno</label>
                <input className="input" type="time" value={travelReturnTime} onChange={(e) => setTravelReturnTime(e.target.value)} />
              </div>
            </div>
            {travelDeparture && travelReturn && (
              <div style={{ marginTop: '12px', padding: '10px 14px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Calendar size={12} /> Duração: <strong style={{ color: 'var(--text-primary)' }}>
                    {Math.max(1, Math.ceil((new Date(travelReturn).getTime() - new Date(travelDeparture).getTime()) / (1000 * 60 * 60 * 24)))} dia(s)
                  </strong>
                </span>
                {event.planning?.vehicle?.model && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Car size={12} /> {event.planning.vehicle.model} {event.planning.vehicle.plate && `(${event.planning.vehicle.plate})`}
                  </span>
                )}
                {event.planning?.hotel?.name && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Hotel size={12} /> {event.planning.hotel.name}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Section 2: Event Timing */}
          <div className="card">
            <h3 style={{ fontSize: '16px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} /> Encerramento do Evento
            </h3>
            {event.closing && !editingClosing ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', marginTop: '8px' }}>
                  <CheckCircle size={18} style={{ color: 'var(--success)' }} />
                  <span style={{ fontSize: '14px', color: 'var(--success)', fontWeight: 600 }}>Evento Encerrado</span>
                  {canEditClosing && (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginLeft: 'auto', gap: '5px' }}
                      onClick={() => {
                        // Pré-popula o formulário com os valores existentes
                        const fmt = (d: unknown) => format(toDate(d), "yyyy-MM-dd'T'HH:mm");
                        setClosingStart(fmt(event.closing!.actualStartTime));
                        // Para fim: se cruzou meia-noite, subtrai 1 dia para exibir o horário original
                        const endDate = toDate(event.closing!.actualEndTime);
                        if (event.closing!.crossedMidnight) {
                          endDate.setDate(endDate.getDate() - 1);
                        }
                        setClosingEnd(fmt(endDate));
                        setEditingClosing(true);
                      }}
                    >
                      <Save size={13} /> Corrigir Horários
                    </button>
                  )}
                </div>
                <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  <div className="card-stat">
                    <span className="stat-label">Início Real</span>
                    <span className="stat-value" style={{ fontSize: '16px' }}>{format(toDate(event.closing.actualStartTime), 'dd/MM HH:mm')}</span>
                  </div>
                  <div className="card-stat">
                    <span className="stat-label">Fim Real</span>
                    <span className="stat-value" style={{ fontSize: '16px' }}>{format(toDate(event.closing.actualEndTime), 'dd/MM HH:mm')}</span>
                  </div>
                  <div className="card-stat">
                    <span className="stat-label">Duração</span>
                    <span className="stat-value" style={{ fontSize: '16px' }}>
                      {Math.floor(event.closing.durationMinutes / 60)}h{(event.closing.durationMinutes % 60).toString().padStart(2, '0')}m
                      {event.closing.crossedMidnight && <span style={{ fontSize: '12px', color: 'var(--warning)' }}> <Moon size={12} style={{ verticalAlign: 'middle' }} /></span>}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                {editingClosing && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '10px 14px', background: 'rgba(245,158,11,0.10)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(245,158,11,0.3)' }}>
                    <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', color: 'var(--warning)', fontWeight: 500 }}>
                      Editando fechamento — os valores financeiros serão recalculados automaticamente após salvar.
                    </span>
                  </div>
                )}
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px', marginTop: '4px' }}>
                  {editingClosing ? 'Corrija os horários reais de início e fim.' : 'Registre os horários reais de início e fim do evento.'}
                </p>
                <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', maxWidth: '500px' }}>
                  <div className="input-group">
                    <label>Início Real</label>
                    <input className="input" type="datetime-local" value={closingStart} onChange={(e) => setClosingStart(e.target.value)} />
                  </div>
                  <div className="input-group">
                    <label>Fim Real</label>
                    <input className="input" type="datetime-local" value={closingEnd} onChange={(e) => setClosingEnd(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button className="btn btn-primary" onClick={handleClose} disabled={saving}>
                    {saving
                      ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                      : <><CheckCircle size={16} /> {editingClosing ? 'Salvar Correção' : 'Encerrar Evento'}</>
                    }
                  </button>
                  {editingClosing && (
                    <button className="btn btn-ghost" onClick={() => setEditingClosing(false)}>
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Financial Statement (somente quem pode ver financeiro) */}
          {canViewFinance && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <DollarSign size={18} /> Extrato Financeiro do Evento
              </h3>
              <button className="btn btn-ghost btn-sm" onClick={handleExportPDF} style={{ gap: '6px' }}>
                <Download size={14} /> Exportar PDF
              </button>
            </div>

            <div ref={extratoRef} style={{ padding: '2px' }}>

            {/* Revenue */}
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ fontSize: '13px', color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Receitas</h4>
              <div style={{ background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '13px' }}>Receita do Evento</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--success)' }}>
                    R$ {revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--success-bg)' }}>
                  <strong style={{ fontSize: '13px' }}>Total Receitas</strong>
                  <strong style={{ fontSize: '14px', color: 'var(--success)' }}>
                    R$ {revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </strong>
                </div>
              </div>
            </div>

            {/* Direct Expenses */}
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ fontSize: '13px', color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Despesas Operacionais</h4>
              <div style={{ background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                {(event.expenses || []).length === 0 ? (
                  <div style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Sem despesas registradas</div>
                ) : (
                  (event.expenses || []).map((exp, i) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 16px',
                      borderBottom: i < (event.expenses || []).length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                      <div>
                        <span style={{ fontSize: '13px' }}>{exp.description || categoryLabel(exp.category)}</span>
                        {exp.operatorName && (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>({exp.operatorName})</span>
                        )}
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--warning)' }}>
                        - R$ {(exp.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--warning-bg)' }}>
                  <strong style={{ fontSize: '13px' }}>Subtotal Despesas</strong>
                  <strong style={{ fontSize: '14px', color: 'var(--warning)' }}>
                    - R$ {((event.expenses || []).reduce((s, e) => s + (e.amount || 0), 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </strong>
                </div>
              </div>
            </div>

            {/* Team Payments */}
            {totalTeamPayments > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ fontSize: '13px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Remuneração de Equipe</h4>
                <div style={{ background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                  {teamPayments.map((p, i) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 16px',
                      borderBottom: i < teamPayments.length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                      <div>
                        <span style={{ fontSize: '13px' }}>{p.operatorName}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>({p.role})</span>
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent)' }}>
                        - R$ {p.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(99,102,241,0.08)' }}>
                    <strong style={{ fontSize: '13px' }}>Subtotal Equipe</strong>
                    <strong style={{ fontSize: '14px', color: 'var(--primary)' }}>
                      - R$ {totalTeamPayments.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {/* Planning Costs */}
            {planningCost > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ fontSize: '13px', color: 'var(--info)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Custos do Planejamento</h4>
                <div style={{ background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                  {planningVehicleCost > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Car size={14} /> Veículo — {event.planning?.vehicle?.model || 'N/D'}
                        {event.planning?.vehicle?.totalDays && ` (${event.planning.vehicle.totalDays} diária(s))`}
                      </span>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--info)' }}>
                        - R$ {planningVehicleCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  {planningHotelCost > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Hotel size={14} /> Hospedagem — {event.planning?.hotel?.name || 'N/D'}
                        {event.planning?.hotel?.rooms && ` (${event.planning.hotel.rooms} quarto(s))`}
                      </span>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--info)' }}>
                        - R$ {planningHotelCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--info-bg)' }}>
                    <strong style={{ fontSize: '13px' }}>Subtotal Planejamento</strong>
                    <strong style={{ fontSize: '14px', color: 'var(--info)' }}>
                      - R$ {planningCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {/* NF Toggle */}
            {fiscalPercent > 0 && (
              <div style={{ marginBottom: '16px', padding: '16px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ fontSize: '13px', marginBottom: '2px' }}>Nota Fiscal</h4>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {fiscalFramework || 'Enquadramento não definido'} — {fiscalPercent}% sobre a receita
                    </p>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Embutir NF</span>
                    <div
                      onClick={() => setIncludeNf(!includeNf)}
                      style={{
                        width: '44px', height: '24px',
                        borderRadius: '12px',
                        background: includeNf ? 'var(--primary)' : 'var(--bg-surface-hover)',
                        position: 'relative',
                        cursor: 'pointer',
                        transition: 'background var(--transition-fast)',
                      }}
                    >
                      <div style={{
                        width: '20px', height: '20px',
                        borderRadius: '50%',
                        background: 'white',
                        position: 'absolute',
                        top: '2px',
                        left: includeNf ? '22px' : '2px',
                        transition: 'left var(--transition-fast)',
                      }} />
                    </div>
                  </label>
                </div>
                {includeNf && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                    <span style={{ fontSize: '13px' }}>NF ({fiscalPercent}% de R$ {revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--error)' }}>
                      - R$ {(revenue * fiscalPercent / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Final Result */}
            {(() => {
              const nfCost = includeNf ? (revenue * fiscalPercent / 100) : 0;
              const finalResult = revenue - totalExpenses - nfCost;
              return (
                <div style={{
                  background: finalResult >= 0 ? 'var(--success-bg)' : 'var(--error-bg)',
                  borderRadius: 'var(--radius-md)',
                  padding: '20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}>
                  <div>
                    <span style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                      Resultado Final
                    </span>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Receita − Despesas{nfCost > 0 ? ' − NF' : ''}
                    </p>
                  </div>
                  <span style={{
                    fontSize: '24px', fontWeight: 800,
                    fontFamily: "'Outfit', sans-serif",
                    color: finalResult >= 0 ? 'var(--success)' : 'var(--error)',
                  }}>
                    {finalResult >= 0 ? '+' : ''}R$ {finalResult.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              );
            })()}

            {/* Team involved */}
            {(event.assignments || []).length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Equipe do Evento</h4>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {(event.assignments || []).map((a, i) => (
                    <span key={i} className="badge badge-primary" style={{ fontSize: '11px' }}>
                      {a.operatorName} — {a.role}
                    </span>
                  ))}
                </div>
              </div>
            )}
            </div>{/* end extratoRef */}
          </div>
          )}
        </div>
      )}
    </div>
  );
}

// ====== Planning Tab Component ======

const VEHICLE_TYPES: { value: PlanningVehicle['type']; label: string }[] = [
  { value: 'aluguel', label: 'Aluguel' },
  { value: 'proprio', label: 'Próprio' },
  { value: 'van', label: 'Van' },
  { value: 'onibus', label: 'Ônibus' },
  { value: 'aviao', label: 'Avião' },
  { value: 'outro', label: 'Outro' },
];

function PlanningTab({ event, eventId, onSave, showToast }: {
  event: GestaoEvent & { id: string };
  eventId: string;
  onSave: () => Promise<void>;
  showToast: (msg: string, type?: string) => void;
}) {
  const planning = event.planning || {} as Partial<EventPlanning>;

  const [departureDate, setDepartureDate] = useState(planning.departureDate || '');
  const [departureTime, setDepartureTime] = useState(planning.departureTime || '');
  const [returnDate, setReturnDate] = useState(planning.returnDate || '');
  const [returnTime, setReturnTime] = useState(planning.returnTime || '');
  const [originCity, setOriginCity] = useState(planning.originCity || '');
  const [meetingPoint, setMeetingPoint] = useState(planning.meetingPoint || '');
  const [notes, setNotes] = useState(planning.notes || '');

  // Vehicle
  const [vType, setVType] = useState<PlanningVehicle['type']>(planning.vehicle?.type || 'aluguel');
  const [vRental, setVRental] = useState(planning.vehicle?.rental || '');
  const [vModel, setVModel] = useState(planning.vehicle?.model || '');
  const [vPlate, setVPlate] = useState(planning.vehicle?.plate || '');
  const [vDailyRate, setVDailyRate] = useState(planning.vehicle?.dailyRate || 0);
  const [vTotalDays, setVTotalDays] = useState(planning.vehicle?.totalDays || 1);
  const [vNotes, setVNotes] = useState(planning.vehicle?.notes || '');

  // Hotel
  const [hName, setHName] = useState(planning.hotel?.name || '');
  const [hAddress, setHAddress] = useState(planning.hotel?.address || '');
  const [hCheckIn, setHCheckIn] = useState(planning.hotel?.checkIn || '');
  const [hCheckOut, setHCheckOut] = useState(planning.hotel?.checkOut || '');
  const [hDailyRate, setHDailyRate] = useState(planning.hotel?.dailyRate || 0);
  const [hRooms, setHRooms] = useState(planning.hotel?.rooms || 1);
  const [hNotes, setHNotes] = useState(planning.hotel?.notes || '');

  // Checklist
  const [checklist, setChecklist] = useState<PlanningChecklist[]>(planning.checklist || []);
  const [newCheckItem, setNewCheckItem] = useState('');

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const planningData: EventPlanning = {
        departureDate,
        departureTime,
        returnDate,
        returnTime,
        originCity,
        meetingPoint,
        notes,
        vehicle: {
          type: vType,
          rental: vRental,
          model: vModel,
          plate: vPlate,
          dailyRate: vDailyRate,
          totalDays: vTotalDays,
          totalCost: vDailyRate * vTotalDays,
          notes: vNotes,
        },
        hotel: {
          name: hName,
          address: hAddress,
          checkIn: hCheckIn,
          checkOut: hCheckOut,
          dailyRate: hDailyRate,
          rooms: hRooms,
          totalCost: hDailyRate * hRooms * (hCheckIn && hCheckOut ? Math.max(1, Math.ceil((new Date(hCheckOut).getTime() - new Date(hCheckIn).getTime()) / (1000 * 60 * 60 * 24))) : 1),
          notes: hNotes,
        },
        checklist,
        updatedAt: new Date(),
      };
      await updateEvent(eventId, { planning: planningData } as Partial<GestaoEvent>);
      showToast('Planejamento salvo!');
      await onSave();
    } catch {
      showToast('Erro ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleCheck = (id: string) => {
    setChecklist((prev) => prev.map((c) => c.id === id ? { ...c, done: !c.done } : c));
  };

  const addCheckItem = () => {
    if (!newCheckItem.trim()) return;
    setChecklist((prev) => [...prev, { id: Date.now().toString(), text: newCheckItem.trim(), done: false }]);
    setNewCheckItem('');
  };

  const removeCheckItem = (id: string) => {
    setChecklist((prev) => prev.filter((c) => c.id !== id));
  };

  const vTotalCost = vDailyRate * vTotalDays;
  const hotelNights = hCheckIn && hCheckOut ? Math.max(1, Math.ceil((new Date(hCheckOut).getTime() - new Date(hCheckIn).getTime()) / (1000 * 60 * 60 * 24))) : 1;
  const hTotalCost = hDailyRate * hRooms * hotelNights;

  const sectionStyle = {
    padding: '20px',
    background: 'var(--bg-surface-elevated)',
    borderRadius: 'var(--radius-md)',
    marginBottom: '16px',
  };

  const sectionTitle = (icon: React.ReactNode, title: string) => (
    <h4 style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: 'var(--text-primary)' }}>
      {icon} {title}
    </h4>
  );

  return (
    <div className="card animate-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h3 style={{ fontSize: '16px' }}>Planejamento do Evento</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Organize viagem, veículo, hospedagem e checklist</p>
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> : <><Save size={16} /> Salvar</>}
        </button>
      </div>

      {/* Travel Logistics */}
      <div style={sectionStyle}>
        {sectionTitle(<MapPin size={16} />, 'Logística de Viagem')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <div className="input-group">
            <label>Data de Saída</label>
            <input className="input" type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Horário de Saída</label>
            <input className="input" type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Data de Retorno</label>
            <input className="input" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Horário de Retorno</label>
            <input className="input" type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Cidade de Origem</label>
            <input className="input" value={originCity} onChange={(e) => setOriginCity(e.target.value)} placeholder="Ex: Campo Grande, MS" />
          </div>
          <div className="input-group">
            <label>Ponto de Encontro</label>
            <input className="input" value={meetingPoint} onChange={(e) => setMeetingPoint(e.target.value)} placeholder="Ex: Estúdio sede" />
          </div>
        </div>
      </div>

      {/* Vehicle */}
      <div style={sectionStyle}>
        {sectionTitle(<Car size={16} />, 'Veículo')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
          <div className="input-group">
            <label>Tipo</label>
            <select className="input" value={vType} onChange={(e) => setVType(e.target.value as PlanningVehicle['type'])}>
              {VEHICLE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
          {vType === 'aluguel' && (
            <div className="input-group">
              <label>Locadora</label>
              <input className="input" value={vRental} onChange={(e) => setVRental(e.target.value)} placeholder="Ex: Localiza" />
            </div>
          )}
          <div className="input-group">
            <label>Modelo</label>
            <input className="input" value={vModel} onChange={(e) => setVModel(e.target.value)} placeholder="Ex: Fiat Toro" />
          </div>
          <div className="input-group">
            <label>Placa</label>
            <input className="input" value={vPlate} onChange={(e) => setVPlate(e.target.value)} placeholder="ABC-1D23" />
          </div>
          <div className="input-group">
            <label>Diária (R$)</label>
            <CurrencyInput value={vDailyRate} onChange={setVDailyRate} />
          </div>
          <div className="input-group">
            <label>Qtd. Diárias</label>
            <input className="input" type="number" value={vTotalDays} onChange={(e) => setVTotalDays(Number(e.target.value))} min={1} />
          </div>
        </div>
        <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="input-group" style={{ flex: 1 }}>
            <label>Observações do veículo</label>
            <input className="input" value={vNotes} onChange={(e) => setVNotes(e.target.value)} placeholder="Notas sobre o veículo..." />
          </div>
          <div style={{ textAlign: 'right', minWidth: '140px', paddingLeft: '16px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total Veículo</span>
            <p style={{ fontSize: '18px', fontWeight: 700, color: 'var(--warning)' }}>
              R$ {vTotalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>

      {/* Hotel */}
      <div style={sectionStyle}>
        {sectionTitle(<Hotel size={16} />, 'Hospedagem')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
          <div className="input-group" style={{ gridColumn: 'span 2' }}>
            <label>Nome do Hotel / Pousada</label>
            <input className="input" value={hName} onChange={(e) => setHName(e.target.value)} placeholder="Ex: Hotel Fazenda" />
          </div>
          <div className="input-group" style={{ gridColumn: 'span 2' }}>
            <label>Endereço</label>
            <input className="input" value={hAddress} onChange={(e) => setHAddress(e.target.value)} placeholder="Rua, número, bairro..." />
          </div>
          <div className="input-group">
            <label>Check-in</label>
            <input className="input" type="date" value={hCheckIn} onChange={(e) => setHCheckIn(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Check-out</label>
            <input className="input" type="date" value={hCheckOut} onChange={(e) => setHCheckOut(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Diária (R$)</label>
            <CurrencyInput value={hDailyRate} onChange={setHDailyRate} />
          </div>
          <div className="input-group">
            <label>Quartos</label>
            <input className="input" type="number" value={hRooms} onChange={(e) => setHRooms(Number(e.target.value))} min={1} />
          </div>
        </div>
        <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="input-group" style={{ flex: 1 }}>
            <label>Observações da hospedagem</label>
            <input className="input" value={hNotes} onChange={(e) => setHNotes(e.target.value)} placeholder="Notas sobre hospedagem..." />
          </div>
          <div style={{ textAlign: 'right', minWidth: '140px', paddingLeft: '16px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{hotelNights} noite(s) · {hRooms} quarto(s)</span>
            <p style={{ fontSize: '18px', fontWeight: 700, color: 'var(--warning)' }}>
              R$ {hTotalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>

      {/* Checklist */}
      <div style={sectionStyle}>
        {sectionTitle(<CheckSquare size={16} />, 'Checklist de Planejamento')}

        {checklist.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
            {checklist.map((item) => (
              <div key={item.id} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 12px',
                background: item.done ? 'var(--success-bg)' : 'var(--bg-surface)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}>
                <button onClick={() => toggleCheck(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: item.done ? 'var(--success)' : 'var(--text-muted)' }}>
                  {item.done ? <CheckSquare size={18} /> : <Square size={18} />}
                </button>
                <span style={{
                  flex: 1, fontSize: '13px',
                  textDecoration: item.done ? 'line-through' : 'none',
                  color: item.done ? 'var(--text-muted)' : 'var(--text-primary)',
                }}>
                  {item.text}
                </span>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeCheckItem(item.id)} style={{ color: 'var(--error)' }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            className="input"
            placeholder="Ex: Confirmar reserva hotel"
            value={newCheckItem}
            onChange={(e) => setNewCheckItem(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCheckItem()}
            style={{ flex: 1 }}
          />
          <button className="btn btn-ghost" onClick={addCheckItem} disabled={!newCheckItem.trim()}>
            <Plus size={16} /> Adicionar
          </button>
        </div>

        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
          {checklist.filter((c) => c.done).length}/{checklist.length} concluído(s)
        </p>
      </div>

      {/* Notes */}
      <div style={sectionStyle}>
        {sectionTitle(<Clipboard size={16} />, 'Observações Gerais')}
        <textarea
          className="input"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Informações adicionais sobre o planejamento..."
          style={{ resize: 'vertical' }}
        />
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginTop: '8px' }}>
        <div className="card-stat">
          <span className="stat-label">Custo Veículo</span>
          <span className="stat-value" style={{ fontSize: '18px', color: 'var(--warning)' }}>
            R$ {vTotalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div className="card-stat">
          <span className="stat-label">Custo Hospedagem</span>
          <span className="stat-value" style={{ fontSize: '18px', color: 'var(--warning)' }}>
            R$ {hTotalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div className="card-stat">
          <span className="stat-label">Total Planejamento</span>
          <span className="stat-value" style={{ fontSize: '18px', color: 'var(--error)' }}>
            R$ {(vTotalCost + hTotalCost).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  );
}
