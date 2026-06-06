'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getOperatorById, updateOperator, savePaymentRules } from '@/services/operators';
import { getEventsByOperator } from '@/services/events';
import { getCollection } from '@/lib/firestore';
import { computeFolgaBalance, getTripRoute } from '@/lib/folgas';
import { Holiday } from '@/types/payment';
import { Operator, ContractType, HourRange, OperatorRole, OperatorFunction, OPERATOR_FUNCTION_LABELS, WEEKDAY_LABELS } from '@/types/operator';
import { GestaoEvent, OPERATION_TYPE_LABELS, OPERATION_TYPE_BADGE } from '@/types/event';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowLeft, Save, User, DollarSign, Calendar,
  Plus, Trash2, Clock, MapPin,
} from 'lucide-react';

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) return (val as { toDate: () => Date }).toDate();
  if (typeof val === 'string') return parseISO(val);
  return new Date();
}

const contractLabels: Record<ContractType, string> = {
  funcionario: 'Funcionário',
  freelancer_n1: 'Freelancer N1',
  freelancer_n2: 'Freelancer N2',
};

export default function OperadorDetailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id') as string;

  const [operator, setOperator] = useState<(Operator & { id: string }) | null>(null);
  const [events, setEvents] = useState<(GestaoEvent & { id: string })[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'pagamento' | 'historico'>('info');
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);

  // Editable fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [homeCity, setHomeCity] = useState('');
  const [contractType, setContractType] = useState<ContractType>('funcionario');
  const [role, setRole] = useState<OperatorRole>('operacao');
  const [functions, setFunctions] = useState<OperatorFunction[]>([]);
  const [weeklyRestDay, setWeeklyRestDay] = useState<number | null>(null);
  const [restDays, setRestDays] = useState<string[]>([]);
  const [newRestDay, setNewRestDay] = useState('');
  const [active, setActive] = useState(true);

  // Payment rules
  const [dailyTravel, setDailyTravel] = useState(0);
  const [dailyTravelMultiple, setDailyTravelMultiple] = useState(0);
  const [weekendHolidayBonus, setWeekendHolidayBonus] = useState(0);
  const [restDayExtra, setRestDayExtra] = useState(0);

  // Faixas padrão para CLT: thresholds em 3h45, 7h45, 11h45 (= 3.75, 7.75, 11.75h)
  // Dia útil = 0 (dentro da jornada); FDS/Feriado = 100/150/200
  const CLT_DEFAULT_RANGES: HourRange[] = [
    { minHours: 0,     maxHours: 3.75,  weekdayValue: 0, weekendHolidayValue: 0   },
    { minHours: 3.75,  maxHours: 7.75,  weekdayValue: 0, weekendHolidayValue: 100 },
    { minHours: 7.75,  maxHours: 11.75, weekdayValue: 0, weekendHolidayValue: 150 },
    { minHours: 11.75, maxHours: 24,    weekdayValue: 0, weekendHolidayValue: 200 },
  ];

  const [hourRanges, setHourRanges] = useState<HourRange[]>(CLT_DEFAULT_RANGES);

  useEffect(() => {
    async function load() {
      try {
        const op = await getOperatorById(id);
        if (!op) { router.push('/dashboard/operadores'); return; }
        setOperator(op);
        setName(op.name);
        setEmail(op.email);
        setPhone(op.phone || '');
        setHomeCity(op.homeCity || '');
        setContractType(op.contractType);
        setActive(op.active);

        // Migração de papéis legados: especializações viram FUNÇÕES com acesso "Operação".
        // Operador de Painel permanece como NÍVEL DE ACESSO (configura eventos).
        const LEGACY_FN: Record<string, OperatorFunction> = {
          tecnico: 'tecnico',
          operador_transmissao: 'tecnico',
          freelancer_estudio: 'freelancer_estudio',
          freelancer_externo: 'freelancer_externo',
        };
        const loadedFns = (op.functions && op.functions.length > 0)
          ? op.functions
          : (op.role === 'operador_painel' ? ['operador_painel'] as OperatorFunction[] : (LEGACY_FN[op.role] ? [LEGACY_FN[op.role]] : []));
        setFunctions(loadedFns);
        setRole(LEGACY_FN[op.role] ? 'operacao' : op.role);
        setWeeklyRestDay(op.weeklyRestDay ?? null);
        setRestDays(op.restDays || []);

        if (op.paymentRules) {
          setDailyTravel(op.paymentRules.dailyTravel || 0);
          setDailyTravelMultiple(op.paymentRules.dailyTravelMultiple || 0);
          setWeekendHolidayBonus(op.paymentRules.weekendHolidayBonus || 0);
          setRestDayExtra(op.paymentRules.restDayExtra || 0);
          if (op.paymentRules.hourRanges?.length) setHourRanges(op.paymentRules.hourRanges);
        }

        const [evts, hols] = await Promise.all([
          getEventsByOperator(op.id),
          getCollection<Holiday>('holidays').catch(() => [] as Holiday[]),
        ]);
        setEvents(evts);
        setHolidays(hols as Holiday[]);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, router]);

  const showToast = (message: string, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSaveInfo = async () => {
    setSaving(true);
    try {
      await updateOperator(id, { name, email, phone, homeCity, contractType, role, functions, weeklyRestDay, restDays, active } as Partial<Operator>);
      showToast('Informações salvas com sucesso!');
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePayment = async () => {
    setSaving(true);
    try {
      await savePaymentRules(id, {
        operatorId: id,
        contractType,
        dailyTravel,
        dailyTravelMultiple,
        weekendHolidayBonus,
        restDayExtra,
        hourRanges,
        isDefault: false,
      });
      showToast('Regras de pagamento salvas!');
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar regras.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleFunction = (fn: OperatorFunction) => {
    setFunctions((prev) => prev.includes(fn) ? prev.filter((f) => f !== fn) : [...prev, fn]);
  };

  const addRestDay = () => {
    if (!newRestDay || restDays.includes(newRestDay)) return;
    setRestDays((prev) => [...prev, newRestDay].sort());
    setNewRestDay('');
  };

  const removeRestDay = (d: string) => setRestDays((prev) => prev.filter((x) => x !== d));

  const addHourRange = () => {
    const last = hourRanges[hourRanges.length - 1];
    setHourRanges([...hourRanges, { minHours: last?.maxHours || 0, maxHours: (last?.maxHours || 0) + 2, weekdayValue: 0, weekendHolidayValue: 0 }]);
  };

  const removeHourRange = (idx: number) => {
    setHourRanges(hourRanges.filter((_, i) => i !== idx));
  };

  const updateRange = (idx: number, field: keyof HourRange, value: number) => {
    const updated = [...hourRanges];
    updated[idx] = { ...updated[idx], [field]: value };
    setHourRanges(updated);
  };

  if (loading) {
    return (
      <div>
        <div className="skeleton" style={{ height: '40px', width: '200px', marginBottom: '20px' }} />
        <div className="skeleton" style={{ height: '400px' }} />
      </div>
    );
  }

  if (!operator) return null;

  const folgaInfo = computeFolgaBalance(operator, events, holidays);

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.message}</div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
        <button className="btn btn-ghost btn-icon" onClick={() => router.push('/dashboard/operadores')}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '22px' }}>{operator.name}</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {contractLabels[operator.contractType]} · {operator.active ? 'Ativo' : 'Inativo'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: '24px' }}>
        <button className={`tab ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')}>
          <User size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Informações
        </button>
        <button className={`tab ${activeTab === 'pagamento' ? 'active' : ''}`} onClick={() => setActiveTab('pagamento')}>
          <DollarSign size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Regras de Pagamento
        </button>
        <button className={`tab ${activeTab === 'historico' ? 'active' : ''}`} onClick={() => setActiveTab('historico')}>
          <Calendar size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Histórico ({events.length})
        </button>
      </div>

      {/* Info Tab */}
      {activeTab === 'info' && (
        <div className="card animate-in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '600px' }}>
            <div className="input-group">
              <label>Nome completo</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="input-group">
                <label>E-mail</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Telefone</label>
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="input-group" style={{ maxWidth: '300px' }}>
              <label>Cidade-base (origem das viagens)</label>
              <input className="input" value={homeCity} onChange={(e) => setHomeCity(e.target.value)} placeholder="Ex: Londrina" />
            </div>
            <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <div className="input-group">
                <label>Tipo de Contrato</label>
                <select className="input" value={contractType} onChange={(e) => setContractType(e.target.value as ContractType)}>
                  <option value="funcionario">Funcionário</option>
                  <option value="freelancer_n1">Freelancer N1</option>
                  <option value="freelancer_n2">Freelancer N2</option>
                </select>
              </div>
              <div className="input-group">
                <label>Nível de Acesso</label>
                <select className="input" value={role} onChange={(e) => setRole(e.target.value as OperatorRole)}>
                  <optgroup label="Gestão">
                    <option value="admin">ADM (Administrador)</option>
                    <option value="ceo">CEO</option>
                    <option value="financeiro">Financeiro</option>
                    <option value="comercial">Comercial</option>
                    <option value="administrativo">Administrativo</option>
                    <option value="planejamento">Planejamento</option>
                  </optgroup>
                  <optgroup label="Operação">
                    <option value="operador_painel">Operador de Painel (configura eventos)</option>
                    <option value="operacao">Operação (só vê a própria escala)</option>
                  </optgroup>
                </select>
              </div>
              <div className="input-group">
                <label>Status</label>
                <select className="input" value={active ? 'true' : 'false'} onChange={(e) => setActive(e.target.value === 'true')}>
                  <option value="true">Ativo</option>
                  <option value="false">Inativo</option>
                </select>
              </div>
            </div>

            {/* Funções operacionais (múltiplas) */}
            {role === 'operacao' && (
              <div className="input-group">
                <label>Funções operacionais (pode marcar várias)</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {(Object.keys(OPERATOR_FUNCTION_LABELS) as OperatorFunction[]).map((fn) => {
                    const checked = functions.includes(fn);
                    return (
                      <button
                        key={fn}
                        type="button"
                        onClick={() => toggleFunction(fn)}
                        className={`badge ${checked ? 'badge-primary' : ''}`}
                        style={{
                          cursor: 'pointer', fontSize: '13px', padding: '8px 14px',
                          border: checked ? '1px solid var(--primary)' : '1px solid var(--border)',
                          background: checked ? 'var(--primary-light)' : 'transparent',
                          color: checked ? 'var(--primary)' : 'var(--text-secondary)',
                        }}
                      >
                        {checked ? '✓ ' : ''}{OPERATOR_FUNCTION_LABELS[fn]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Folga semanal fixa (dia da semana) */}
            <div className="input-group">
              <label>Folga semanal padrão</label>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '-4px', marginBottom: '8px' }}>
                Dia da semana em que o operador folga toda semana (ex.: escala 6x1). Para folga aos domingos, selecione “Domingo”.
              </p>
              <select
                className="input"
                style={{ maxWidth: '220px' }}
                value={weeklyRestDay ?? ''}
                onChange={(e) => setWeeklyRestDay(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">Sem folga fixa</option>
                {WEEKDAY_LABELS.map((label, idx) => (
                  <option key={idx} value={idx}>{label}</option>
                ))}
              </select>
            </div>

            {/* Folgas avulsas / trocas (marcação livre por data) */}
            <div className="input-group">
              <label>Folgas avulsas / trocas {contractType === 'funcionario' ? '(CLT)' : ''}</label>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '-4px', marginBottom: '8px' }}>
                Datas específicas de folga (inclui troca esporádica da folga semanal). Escalar nessas datas — ou na folga semanal — gera aviso e valor extra.
              </p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <input type="date" className="input" value={newRestDay} onChange={(e) => setNewRestDay(e.target.value)} style={{ width: 'auto' }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={addRestDay} disabled={!newRestDay}>
                  <Plus size={14} /> Adicionar folga
                </button>
              </div>
              {restDays.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
                  {restDays.map((d) => (
                    <span key={d} style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-full)',
                      background: 'var(--warning-bg)', color: 'var(--warning)', fontWeight: 600,
                    }}>
                      {format(parseISO(d), "dd/MM/yyyy", { locale: ptBR })}
                      <button type="button" onClick={() => removeRestDay(d)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 0 }}>
                        <Trash2 size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: '8px' }}>
              <button className="btn btn-primary" onClick={handleSaveInfo} disabled={saving}>
                {saving ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> : <><Save size={16} /> Salvar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Tab */}
      {activeTab === 'pagamento' && (
        <div className="card animate-in">
          <h3 style={{ fontSize: '16px', marginBottom: '20px' }}>
            Regras de Pagamento — {contractLabels[contractType]}
          </h3>

          {/* Employee rules */}
          {contractType === 'funcionario' && (
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Diárias de Viagem (Evento Externo)</h4>
              <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', maxWidth: '400px' }}>
                <div className="input-group">
                  <label>Diária simples (R$)</label>
                  <input className="input" type="number" value={dailyTravel} onChange={(e) => setDailyTravel(Number(e.target.value))} />
                </div>
                <div className="input-group">
                  <label>Diária 2+ leilões/dia (R$)</label>
                  <input className="input" type="number" value={dailyTravelMultiple} onChange={(e) => setDailyTravelMultiple(Number(e.target.value))} />
                </div>
              </div>

              <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '20px', marginBottom: '4px' }}>Adicional Fim de Semana/Feriado — Fallback Fixo</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                Use <strong>0</strong> quando os valores de FDS estão configurados nas faixas de horas abaixo (tiered).
                Este campo só é usado se nenhuma faixa tiver "Valor FDS/Feriado" &gt; 0.
              </p>
              {weekendHolidayBonus > 0 && hourRanges.some((r) => r.weekendHolidayValue > 0) && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 14px', marginBottom: '10px', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <span style={{ fontSize: '16px', flexShrink: 0 }}>⚠️</span>
                  <span style={{ fontSize: '12px', color: 'var(--error)' }}>
                    <strong>Conflito:</strong> "Valor base adicional" está em R${weekendHolidayBonus} E as faixas de horas também têm valores de FDS. O campo fixo <strong>não será somado</strong> (as faixas têm prioridade), mas para evitar confusão coloque-o em 0.
                  </span>
                </div>
              )}
              <div style={{ maxWidth: '200px' }}>
                <div className="input-group">
                  <label>Valor base adicional fixo (R$)</label>
                  <input className="input" type="number" value={weekendHolidayBonus} onChange={(e) => setWeekendHolidayBonus(Number(e.target.value))} />
                </div>
              </div>
            </div>
          )}

          {/* Extra de folga (aplica a qualquer tipo) */}
          <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Extra por Trabalho em Dia de Folga</h4>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
            {contractType === 'funcionario'
              ? 'CLT em folga usa automaticamente a tabela do Freelancer N2 (configurada em Configurações). Este campo só é fallback se a tabela N2 não tiver faixas.'
              : 'Pago quando o operador é escalado num dia de folga. Se 0, sem extra de folga.'}
          </p>
          <div style={{ maxWidth: '320px', marginBottom: '24px' }}>
            <div className="input-group">
              <label>Valor extra de folga — fallback (R$)</label>
              <input className="input" type="number" value={restDayExtra} onChange={(e) => setRestDayExtra(Number(e.target.value))} />
            </div>
          </div>

          {/* Hour ranges for all types */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              Tabela por Faixa de Horas
            </h4>
            {contractType === 'funcionario' && (
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => setHourRanges(CLT_DEFAULT_RANGES)}
                title="Aplica os thresholds padrão CLT: 0h, 3h45, 7h45, 11h45"
              >
                ↺ Padrão CLT
              </button>
            )}
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
            {contractType === 'funcionario'
              ? 'Dia Útil = 0 (jornada normal). FDS/Feriado = valor pago pelo adicional (ex: 0 / 100 / 150 / 200). A última faixa é ilimitada acima.'
              : 'Valor pago por faixa de duração do leilão. A última faixa é ilimitada acima.'}
          </p>
          <div className="table-container" style={{ marginBottom: '16px' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>De (h)</th>
                  <th>Até (h)</th>
                  <th>Valor Dia Útil (R$)</th>
                  <th>Valor FDS/Feriado (R$)</th>
                  <th style={{ width: '50px' }}></th>
                </tr>
              </thead>
              <tbody>
                {hourRanges.map((range, idx) => (
                  <tr key={idx}>
                    <td>
                      <input className="input" type="number" value={range.minHours} onChange={(e) => updateRange(idx, 'minHours', Number(e.target.value))} style={{ width: '80px' }} />
                    </td>
                    <td>
                      <input className="input" type="number" value={range.maxHours} onChange={(e) => updateRange(idx, 'maxHours', Number(e.target.value))} style={{ width: '80px' }} />
                    </td>
                    <td>
                      <input className="input" type="number" value={range.weekdayValue} onChange={(e) => updateRange(idx, 'weekdayValue', Number(e.target.value))} style={{ width: '120px' }} />
                    </td>
                    <td>
                      <input className="input" type="number" value={range.weekendHolidayValue} onChange={(e) => updateRange(idx, 'weekendHolidayValue', Number(e.target.value))} style={{ width: '120px' }} />
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeHourRange(idx)} style={{ color: 'var(--error)' }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={addHourRange} style={{ marginBottom: '20px' }}>
            <Plus size={14} /> Adicionar faixa
          </button>

          <div>
            <button className="btn btn-primary" onClick={handleSavePayment} disabled={saving}>
              {saving ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> : <><Save size={16} /> Salvar Regras</>}
            </button>
          </div>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'historico' && (
        <div className="animate-in">
          {/* Card de Saldo de Folgas Extras */}
          <div className="card" style={{
            marginBottom: '20px',
            background: 'var(--bg-surface-elevated)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            padding: '20px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Saldo Total de Folgas Extras</span>
              <span style={{ fontSize: '32px', fontWeight: 700, color: 'var(--primary)', marginTop: '4px' }}>
                {folgaInfo.total} {folgaInfo.total === 1 ? 'folga' : 'folgas'}
              </span>
            </div>
            {operator.contractType === 'funcionario' && (
              <div className="mobile-no-border" style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', paddingLeft: '16px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Feriados Trabalhados (CLT)</span>
                <span style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '8px' }}>
                  +{folgaInfo.holidayFolgas}
                </span>
              </div>
            )}
            <div className="mobile-no-border" style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', paddingLeft: '16px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Folgas Coincidentes em Viagem</span>
              <span style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '8px' }}>
                +{folgaInfo.travelFolgas}
              </span>
            </div>
          </div>

          {/* Seção de Viagens Realizadas */}
          {folgaInfo.trips.length > 0 && (
            <div className="card" style={{ marginBottom: '20px', padding: '20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                🚗 Viagens Realizadas ({folgaInfo.trips.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {folgaInfo.trips.map((trip, idx) => {
                  const days = Math.round((trip.end.getTime() - trip.start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                  const route = getTripRoute(trip, events, operator.homeCity);
                  return (
                    <div key={idx} style={{
                      display: 'flex', flexDirection: 'column', gap: '8px',
                      padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border)', fontSize: '13px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 600 }}>Período:</span>{' '}
                          {format(trip.start, 'dd/MM/yyyy')} até {format(trip.end, 'dd/MM/yyyy')}
                        </div>
                        <span className="badge badge-accent" style={{ fontSize: '12px' }}>
                          {days} {days === 1 ? 'dia' : 'dias'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600 }}>Deslocamento:</span> {route}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {events.length === 0 ? (
            <div className="empty-state card">
              <Calendar size={40} style={{ opacity: 0.3, marginBottom: '12px' }} />
              <h3>Sem histórico</h3>
              <p>Este operador ainda não foi escalado em nenhum evento.</p>
            </div>
          ) : (
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>Histórico de Eventos</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {events.map((evt) => {
                  const d = toDate(evt.date);
                  return (
                    <div key={evt.id} className="operator-schedule-card">
                      <div className="schedule-date-badge">
                        <span className="day">{format(d, 'dd')}</span>
                        <span className="month">{format(d, 'MMM', { locale: ptBR })}</span>
                      </div>
                      <div className="schedule-info" style={{ flex: 1 }}>
                        <h4>{evt.title}</h4>
                        <div className="schedule-meta">
                          <span className="schedule-meta-item"><Clock size={12} /> {format(d, 'HH:mm')}</span>
                          <span className="schedule-meta-item"><MapPin size={12} /> {evt.city || 'N/D'}</span>
                          {evt.operationType && (
                            <span className={`badge ${evt.operationType ? OPERATION_TYPE_BADGE[evt.operationType] : 'badge-info'}`}>
                              {evt.operationType ? OPERATION_TYPE_LABELS[evt.operationType] : 'N/D'}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`badge ${evt.status === 'finalizado' ? 'badge-success' : evt.status === 'escalado' ? 'badge-accent' : 'badge-warning'}`}>
                        {evt.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
