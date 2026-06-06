'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, Key, Globe, Calendar as CalendarIcon, Save, Plus, Trash2, CheckCircle, Users, Receipt, Briefcase, Play, Radio } from 'lucide-react';
import { authenticate, setTokenManually } from '@/services/remateweb-api';
import { addDocument, getCollection, deleteDocument, setDocument, getDocument } from '@/lib/firestore';
import { ContractType, HourRange } from '@/types/operator';
import {
  ServiceDef, ServiceNature, ServicesSettings, SERVICE_NATURE_LABELS,
  DEFAULT_SERVICE_CATALOG, serviceDefFromName, managedServiceNames,
} from '@/types/service';

interface Holiday {
  id: string;
  date: string;
  name: string;
  national: boolean;
}

export default function ConfiguracoesPage() {
  const [activeTab, setActiveTab] = useState<'funcoes' | 'servicos' | 'estudios' | 'modelos' | 'fiscal' | 'api' | 'feriados'>('funcoes');

  // API config
  const [apiUser, setApiUser] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [apiStatus, setApiStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [apiError, setApiError] = useState('');

  // Roles/Funções
  const [roles, setRoles] = useState<string[]>([]);
  const [newRole, setNewRole] = useState('');
  const [rolesLoaded, setRolesLoaded] = useState(false);

  // Services (catálogo com metadados)
  const [services, setServices] = useState<ServiceDef[]>([]);
  const [newService, setNewService] = useState('');
  const [servicesLoaded, setServicesLoaded] = useState(false);

  // Studios
  const [studios, setStudios] = useState<string[]>([]);
  const [newStudio, setNewStudio] = useState('');
  const [studiosLoaded, setStudiosLoaded] = useState(false);

  // Default payment rules
  const [selectedContractType, setSelectedContractType] = useState<ContractType>('funcionario');
  const [rulesDailyTravel, setRulesDailyTravel] = useState(0);
  const [rulesDailyTravelMultiple, setRulesDailyTravelMultiple] = useState(0);
  const [rulesWeekendHolidayBonus, setRulesWeekendHolidayBonus] = useState(0);
  const [rulesHourRanges, setRulesHourRanges] = useState<HourRange[]>([]);
  const [rulesSaving, setRulesSaving] = useState(false);

  // Holidays
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const [holidayNational, setHolidayNational] = useState(true);
  const [holidaysLoaded, setHolidaysLoaded] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);

  // Fiscal
  const [fiscalFramework, setFiscalFramework] = useState('');
  const [fiscalNfPercent, setFiscalNfPercent] = useState(0);
  const [fiscalLoaded, setFiscalLoaded] = useState(false);
  const [fiscalSaving, setFiscalSaving] = useState(false);

  const showToast = (message: string, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- Roles ---
  const loadRoles = useCallback(async () => {
    try {
      // Funções reais por evento (planilha): Diretor, DTV, vMix, Apoio.
      const defaults = ['Diretor', 'DTV', 'vMix', 'Apoio'];
      const OLD_PLACEHOLDERS = ['Operador de Câmera', 'Operador de Corte', 'Diretor de Imagem', 'Auxiliar Técnico', 'Operador de Áudio', 'Operador de Replay'];
      const doc = await getDocument<{ list: string[] }>('settings', 'roles');
      if (doc && Array.isArray(doc.list) && doc.list.length > 0) {
        // Migra automaticamente se ainda estiver com os placeholders antigos.
        const isOldPlaceholder = doc.list.length === OLD_PLACEHOLDERS.length && doc.list.every((r) => OLD_PLACEHOLDERS.includes(r));
        if (isOldPlaceholder) {
          await setDocument('settings', 'roles', { list: defaults });
          setRoles(defaults);
        } else {
          setRoles(doc.list);
        }
      } else {
        await setDocument('settings', 'roles', { list: defaults });
        setRoles(defaults);
      }
      setRolesLoaded(true);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const saveRoles = async (updated: string[]) => {
    await setDocument('settings', 'roles', { list: updated });
    setRoles(updated);
  };

  const handleAddRole = async () => {
    const trimmed = newRole.trim();
    if (!trimmed) return;
    if (roles.includes(trimmed)) { showToast('Função já existe.', 'error'); return; }
    const updated = [...roles, trimmed];
    await saveRoles(updated);
    setNewRole('');
    showToast('Função adicionada!');
  };

  const handleDeleteRole = async (role: string) => {
    const updated = roles.filter((r) => r !== role);
    await saveRoles(updated);
    showToast('Função removida.');
  };

  // --- Services (catálogo com metadados) ---
  const loadServices = useCallback(async () => {
    try {
      const doc = await getDocument<ServicesSettings>('settings', 'services');
      if (doc?.catalog && doc.catalog.length > 0) {
        setServices(doc.catalog);
      } else if (doc?.list && doc.list.length > 0) {
        // Migração: lista antiga de nomes → catálogo com metadados
        const migrated = doc.list.map(serviceDefFromName);
        setServices(migrated);
        await setDocument('settings', 'services', { list: managedServiceNames(migrated), catalog: migrated });
      } else {
        setServices(DEFAULT_SERVICE_CATALOG);
        await setDocument('settings', 'services', { list: managedServiceNames(DEFAULT_SERVICE_CATALOG), catalog: DEFAULT_SERVICE_CATALOG });
      }
      setServicesLoaded(true);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const saveServices = async (updated: ServiceDef[]) => {
    // Mantém `list` (nomes gerenciados) para retrocompatibilidade dos selects de evento.
    await setDocument('settings', 'services', { list: managedServiceNames(updated), catalog: updated });
    setServices(updated);
  };

  const handleAddService = async () => {
    const trimmed = newService.trim();
    if (!trimmed) return;
    if (services.some((s) => s.name === trimmed)) { showToast('Serviço já existe.', 'error'); return; }
    const updated = [...services, { name: trimmed, nature: 'estudio' as ServiceNature, requiresCrew: true, managed: true }];
    await saveServices(updated);
    setNewService('');
    showToast('Serviço adicionado!');
  };

  const handleDeleteService = async (name: string) => {
    const updated = services.filter((s) => s.name !== name);
    await saveServices(updated);
    showToast('Serviço removido.');
  };

  const updateServiceField = async (index: number, patch: Partial<ServiceDef>) => {
    const updated = services.map((s, i) => i === index ? { ...s, ...patch } : s);
    await saveServices(updated);
  };

  // --- Studios ---
  const loadStudios = useCallback(async () => {
    try {
      const doc = await getDocument<{ list: string[] }>('settings', 'studios');
      if (doc) {
        setStudios(doc.list || []);
      } else {
        const defaults = ['Estúdio 1', 'Estúdio 2', 'Estúdio 3', 'Estúdio 4'];
        await setDocument('settings', 'studios', { list: defaults });
        setStudios(defaults);
      }
      setStudiosLoaded(true);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const saveStudios = async (updated: string[]) => {
    await setDocument('settings', 'studios', { list: updated });
    setStudios(updated);
  };

  const handleAddStudio = async () => {
    const trimmed = newStudio.trim();
    if (!trimmed) return;
    if (studios.includes(trimmed)) { showToast('Estúdio já existe.', 'error'); return; }
    const updated = [...studios, trimmed];
    await saveStudios(updated);
    setNewStudio('');
    showToast('Estúdio adicionado!');
  };

  const handleDeleteStudio = async (studio: string) => {
    const updated = studios.filter((s) => s !== studio);
    await saveStudios(updated);
    showToast('Estúdio removido.');
  };

  // --- Default Payment Rules ---
  const loadDefaultRules = useCallback(async (type: ContractType) => {
    try {
      const doc = await getDocument<any>('settings', 'default_rules_' + type);
      if (doc) {
        setRulesDailyTravel(doc.dailyTravel || 0);
        setRulesDailyTravelMultiple(doc.dailyTravelMultiple || 0);
        setRulesWeekendHolidayBonus(doc.weekendHolidayBonus || 0);
        setRulesHourRanges(doc.hourRanges || []);
      } else {
        // Seed standard defaults
        // CLT: dia útil = 0 (jornada), FDS = 0/100/150/200 nos thresholds 3h45/7h45/11h45
        // N1:  dia útil = 100/150/200, FDS = 130/195/260 nos thresholds 0/8/12h
        // N2:  dia útil = 80/120/160,  FDS = 110/160/210
        const isCLT = type === 'funcionario';
        const isN1  = type === 'freelancer_n1';
        let seedRules = {
          dailyTravel: 200,
          dailyTravelMultiple: 300,
          weekendHolidayBonus: 0, // usar faixas tiered, não bônus fixo
          hourRanges: isCLT ? [
            { minHours: 0,     maxHours: 3.75,  weekdayValue: 0,   weekendHolidayValue: 0   },
            { minHours: 3.75,  maxHours: 7.75,  weekdayValue: 0,   weekendHolidayValue: 100 },
            { minHours: 7.75,  maxHours: 11.75, weekdayValue: 0,   weekendHolidayValue: 150 },
            { minHours: 11.75, maxHours: 24,    weekdayValue: 0,   weekendHolidayValue: 200 },
          ] : isN1 ? [
            { minHours: 0,  maxHours: 8,  weekdayValue: 100, weekendHolidayValue: 130 },
            { minHours: 8,  maxHours: 12, weekdayValue: 150, weekendHolidayValue: 195 },
            { minHours: 12, maxHours: 24, weekdayValue: 200, weekendHolidayValue: 260 },
          ] : [
            { minHours: 0,  maxHours: 8,  weekdayValue: 80,  weekendHolidayValue: 110 },
            { minHours: 8,  maxHours: 12, weekdayValue: 120, weekendHolidayValue: 160 },
            { minHours: 12, maxHours: 24, weekdayValue: 160, weekendHolidayValue: 210 },
          ],
        };
        await setDocument('settings', 'default_rules_' + type, seedRules);
        setRulesDailyTravel(seedRules.dailyTravel);
        setRulesDailyTravelMultiple(seedRules.dailyTravelMultiple);
        setRulesWeekendHolidayBonus(seedRules.weekendHolidayBonus);
        setRulesHourRanges(seedRules.hourRanges);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  const handleSaveDefaultRules = async () => {
    setRulesSaving(true);
    try {
      await setDocument('settings', 'default_rules_' + selectedContractType, {
        dailyTravel: rulesDailyTravel,
        dailyTravelMultiple: rulesDailyTravelMultiple,
        weekendHolidayBonus: rulesWeekendHolidayBonus,
        hourRanges: rulesHourRanges,
      });
      showToast('Modelos de remuneração salvos!');
    } catch {
      showToast('Erro ao salvar modelos.', 'error');
    } finally {
      setRulesSaving(false);
    }
  };

  const addHourRange = () => {
    const last = rulesHourRanges[rulesHourRanges.length - 1];
    setRulesHourRanges([...rulesHourRanges, { minHours: last?.maxHours || 0, maxHours: (last?.maxHours || 0) + 2, weekdayValue: 0, weekendHolidayValue: 0 }]);
  };

  const removeHourRange = (idx: number) => {
    setRulesHourRanges(rulesHourRanges.filter((_, i) => i !== idx));
  };

  const updateRange = (idx: number, field: keyof HourRange, value: number) => {
    const updated = [...rulesHourRanges];
    updated[idx] = { ...updated[idx], [field]: value };
    setRulesHourRanges(updated);
  };

  // --- API ---
  const handleAuthenticate = async () => {
    setApiStatus('loading');
    setApiError('');
    try {
      const result = await authenticate(apiUser, apiPassword);
      setApiToken(result.token);
      setApiStatus('success');
      showToast('Autenticação realizada com sucesso!');
    } catch (err) {
      console.error(err);
      setApiStatus('error');
      setApiError('Falha na autenticação. Verifique usuário e senha.');
    }
  };

  const handleSetToken = () => {
    if (apiToken) {
      setTokenManually(apiToken);
      showToast('Token configurado manualmente!');
    }
  };

  // --- Holidays ---
  const loadHolidays = async () => {
    try {
      const data = await getCollection<Holiday>('holidays');
      setHolidays(data as (Holiday & { id: string })[]);
      setHolidaysLoaded(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddHoliday = async () => {
    if (!holidayDate || !holidayName) return;
    try {
      await addDocument('holidays', { date: holidayDate, name: holidayName, national: holidayNational } as Record<string, unknown>);
      setHolidayDate('');
      setHolidayName('');
      showToast('Feriado adicionado!');
      await loadHolidays();
    } catch (err) {
      console.error(err);
      showToast('Erro ao adicionar.', 'error');
    }
  };

  const handleDeleteHoliday = async (id: string) => {
    try {
      await deleteDocument('holidays', id);
      await loadHolidays();
    } catch (err) {
      console.error(err);
    }
  };

  // Load data when tab switches
  useEffect(() => {
    if (activeTab === 'funcoes' && !rolesLoaded) loadRoles();
    if (activeTab === 'servicos' && !servicesLoaded) loadServices();
    if (activeTab === 'estudios' && !studiosLoaded) loadStudios();
    if (activeTab === 'modelos') loadDefaultRules(selectedContractType);
    if (activeTab === 'feriados' && !holidaysLoaded) loadHolidays();
    if (activeTab === 'fiscal' && !fiscalLoaded) {
      (async () => {
        try {
          const doc = await getDocument<{ framework: string; nfPercent: number }>('settings', 'fiscal');
          if (doc) {
            setFiscalFramework(doc.framework || '');
            setFiscalNfPercent(doc.nfPercent || 0);
          }
          setFiscalLoaded(true);
        } catch { setFiscalLoaded(true); }
      })();
    }
  }, [activeTab, rolesLoaded, servicesLoaded, studiosLoaded, selectedContractType, holidaysLoaded, fiscalLoaded, loadRoles, loadServices, loadStudios, loadDefaultRules]);

  return (
    <div>
      {toast && <div className="toast-container"><div className={`toast toast-${toast.type}`}>{toast.message}</div></div>}

      <div className="page-header">
        <div>
          <h1>Configurações</h1>
          <p>Gerencie funções, serviços, estúdios, regras padrão e feriados</p>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: '24px' }}>
        <button className={`tab ${activeTab === 'funcoes' ? 'active' : ''}`} onClick={() => setActiveTab('funcoes')}>
          <Users size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Funções
        </button>
        <button className={`tab ${activeTab === 'servicos' ? 'active' : ''}`} onClick={() => setActiveTab('servicos')}>
          <Briefcase size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Serviços
        </button>
        <button className={`tab ${activeTab === 'estudios' ? 'active' : ''}`} onClick={() => setActiveTab('estudios')}>
          <Radio size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Estúdios
        </button>
        <button className={`tab ${activeTab === 'modelos' ? 'active' : ''}`} onClick={() => setActiveTab('modelos')}>
          <Briefcase size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Modelos de Ganhos
        </button>
        <button className={`tab ${activeTab === 'fiscal' ? 'active' : ''}`} onClick={() => setActiveTab('fiscal')}>
          <Receipt size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Fiscal
        </button>
        <button className={`tab ${activeTab === 'api' ? 'active' : ''}`} onClick={() => setActiveTab('api')}>
          <Globe size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          API RemateWeb
        </button>
        <button className={`tab ${activeTab === 'feriados' ? 'active' : ''}`} onClick={() => setActiveTab('feriados')}>
          <CalendarIcon size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Feriados
        </button>
      </div>

      {/* Roles Tab */}
      {activeTab === 'funcoes' && (
        <div className="card animate-in" style={{ maxWidth: '600px' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '4px' }}>Funções de Equipe</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
            Defina as funções disponíveis para escalar operadores nos eventos.
          </p>

          {roles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '20px' }}>
              {roles.map((role, i) => (
                <div key={role} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 14px',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: 'var(--radius-md)',
                }}>
                  <span style={{
                    width: '24px', height: '24px', borderRadius: '50%',
                    background: 'var(--primary-light)', color: 'var(--primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', fontWeight: 700, flexShrink: 0,
                  }}>
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: '14px', fontWeight: 500 }}>{role}</span>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => handleDeleteRole(role)}
                    style={{ color: 'var(--error)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              className="input"
              placeholder="Ex: Diretor de Imagem"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddRole()}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleAddRole} disabled={!newRole.trim()}>
              <Plus size={16} /> Adicionar
            </button>
          </div>
        </div>
      )}

      {/* Services Tab */}
      {activeTab === 'servicos' && (
        <div className="card animate-in">
          <h3 style={{ fontSize: '16px', marginBottom: '4px' }}>Catálogo de Serviços</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
            Cada serviço tem uma <strong>natureza</strong> (estúdio / externo-viagem / retransmissão / outro), se <strong>precisa de equipe</strong> de transmissão
            e se está <strong>gerenciado</strong> (ativo no fluxo de escala). Serviços não gerenciados ficam fora dos selects dos eventos.
          </p>

          <div className="table-container" style={{ marginBottom: '20px' }}>
            <table className="table" style={{ fontSize: '13px' }}>
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th style={{ width: '180px' }}>Natureza</th>
                  <th style={{ width: '110px', textAlign: 'center' }}>Precisa equipe</th>
                  <th style={{ width: '110px', textAlign: 'center' }}>Gerenciado</th>
                  <th style={{ width: '120px' }}>Valor fixo (R$)</th>
                  <th style={{ width: '50px' }}></th>
                </tr>
              </thead>
              <tbody>
                {services.map((service, i) => (
                  <tr key={service.name} style={{ opacity: service.managed ? 1 : 0.55 }}>
                    <td style={{ fontWeight: 500 }}>{service.name}</td>
                    <td>
                      <select
                        className="input"
                        value={service.nature}
                        onChange={(e) => updateServiceField(i, { nature: e.target.value as ServiceNature })}
                        style={{ padding: '4px 8px', fontSize: '12px' }}
                      >
                        {(Object.keys(SERVICE_NATURE_LABELS) as ServiceNature[]).map((n) => (
                          <option key={n} value={n}>{SERVICE_NATURE_LABELS[n]}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={service.requiresCrew} onChange={(e) => updateServiceField(i, { requiresCrew: e.target.checked })} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={service.managed} onChange={(e) => updateServiceField(i, { managed: e.target.checked })} />
                    </td>
                    <td>
                      <input
                        type="number" min="0"
                        className="input"
                        value={service.fixedValue ?? 0}
                        onChange={(e) => updateServiceField(i, { fixedValue: Number(e.target.value) })}
                        style={{ padding: '4px 8px', fontSize: '12px', width: '90px' }}
                        title="Valor fixo pago por este serviço (0 = sem valor fixo)"
                      />
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleDeleteService(service.name)} style={{ color: 'var(--error)' }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: '10px', maxWidth: '500px' }}>
            <input
              className="input"
              placeholder="Ex: Transmissão Estúdio Plus"
              value={newService}
              onChange={(e) => setNewService(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddService()}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleAddService} disabled={!newService.trim()}>
              <Plus size={16} /> Adicionar
            </button>
          </div>
        </div>
      )}

      {/* Studios Tab */}
      {activeTab === 'estudios' && (
        <div className="card animate-in" style={{ maxWidth: '600px' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '4px' }}>Estúdios Ativos</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
            Configure os estúdios físicos que realizam as transmissões internas.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '20px' }}>
            {studios.map((studio, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 14px',
                background: 'var(--bg-surface-elevated)',
                borderRadius: 'var(--radius-md)',
              }}>
                <span style={{ flex: 1, fontSize: '14px', fontWeight: 500 }}>{studio}</span>
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => handleDeleteStudio(studio)}
                  style={{ color: 'var(--error)' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              className="input"
              placeholder="Ex: Estúdio 5"
              value={newStudio}
              onChange={(e) => setNewStudio(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddStudio()}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleAddStudio} disabled={!newStudio.trim()}>
              <Plus size={16} /> Adicionar
            </button>
          </div>
        </div>
      )}

      {/* Modelos de Ganhos Tab */}
      {activeTab === 'modelos' && (
        <div className="card animate-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h3 style={{ fontSize: '16px', marginBottom: '4px' }}>Modelos de Remuneração Padrão</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Configure as tabelas de ganhos de referência para cada modelo de contrato</p>
            </div>
            <select className="input" value={selectedContractType} onChange={(e) => setSelectedContractType(e.target.value as ContractType)} style={{ width: 'auto' }}>
              <option value="funcionario">Funcionário (CLT)</option>
              <option value="freelancer_n1">Freelancer N1</option>
              <option value="freelancer_n2">Freelancer N2</option>
            </select>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Diárias de Viagem / Evento Externo</h4>
            <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', maxWidth: '400px' }}>
              <div className="input-group">
                <label>Diária simples (R$)</label>
                <input className="input" type="number" value={rulesDailyTravel} onChange={(e) => setRulesDailyTravel(Number(e.target.value))} />
              </div>
              <div className="input-group">
                <label>Diária múltipla (2+ leilões/dia) (R$)</label>
                <input className="input" type="number" value={rulesDailyTravelMultiple} onChange={(e) => setRulesDailyTravelMultiple(Number(e.target.value))} />
              </div>
            </div>

            {selectedContractType === 'funcionario' && (
              <div style={{ maxWidth: '200px', marginTop: '16px' }}>
                <div className="input-group">
                  <label>Bônus Fim de Semana/Feriado (R$)</label>
                  <input className="input" type="number" value={rulesWeekendHolidayBonus} onChange={(e) => setRulesWeekendHolidayBonus(Number(e.target.value))} />
                </div>
              </div>
            )}
          </div>

          <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            Tabela de Faixa de Horas (Duração da Transmissão)
          </h4>
          <div className="table-container" style={{ marginBottom: '16px' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Mínimo Horas (&gt;=)</th>
                  <th>Máximo Horas (&lt;)</th>
                  <th>Valor Dia Útil (R$)</th>
                  <th>Valor FDS/Feriado (R$)</th>
                  <th style={{ width: '50px' }}></th>
                </tr>
              </thead>
              <tbody>
                {rulesHourRanges.map((range, idx) => (
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
            <button className="btn btn-primary" onClick={handleSaveDefaultRules} disabled={rulesSaving}>
              {rulesSaving ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> : <><Save size={16} /> Salvar Modelo de Ganhos</>}
            </button>
          </div>
        </div>
      )}

      {/* Fiscal Tab */}
      {activeTab === 'fiscal' && (
        <div className="card animate-in">
          <h3 style={{ fontSize: '16px', marginBottom: '4px' }}>Configuração Fiscal</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
            Defina o enquadramento da empresa e a porcentagem da NF para cálculo automático no fechamento de eventos.
          </p>

          <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', maxWidth: '500px' }}>
            <div className="input-group">
              <label>Enquadramento Fiscal</label>
              <select className="input" value={fiscalFramework} onChange={(e) => setFiscalFramework(e.target.value)}>
                <option value="">Selecione...</option>
                <option value="Simples Nacional">Simples Nacional</option>
                <option value="Lucro Presumido">Lucro Presumido</option>
                <option value="Lucro Real">Lucro Real</option>
                <option value="MEI">MEI</option>
              </select>
            </div>
            <div className="input-group">
              <label>Porcentagem da NF (%)</label>
              <input className="input" type="number" step="0.1" min="0" max="100" value={fiscalNfPercent} onChange={(e) => setFiscalNfPercent(Number(e.target.value))} />
            </div>
          </div>

          {fiscalFramework && fiscalNfPercent > 0 && (
            <div style={{ marginTop: '16px', padding: '12px 16px', background: 'var(--info-bg)', borderRadius: 'var(--radius-sm)', fontSize: '13px', color: 'var(--info)' }}>
              Para cada evento, será calculado <strong>{fiscalNfPercent}%</strong> da receita como custo da Nota Fiscal ({fiscalFramework}).
            </div>
          )}

          <button
            className="btn btn-primary"
            style={{ marginTop: '20px' }}
            disabled={fiscalSaving}
            onClick={async () => {
              setFiscalSaving(true);
              try {
                await setDocument('settings', 'fiscal', { framework: fiscalFramework, nfPercent: fiscalNfPercent });
                showToast('Configuração fiscal salva!');
              } catch { showToast('Erro ao salvar.', 'error'); }
              finally { setFiscalSaving(false); }
            }}
          >
            <Save size={16} /> Salvar Configuração Fiscal
          </button>
        </div>
      )}

      {/* API Tab */}
      {activeTab === 'api' && (
        <div className="card animate-in" style={{ maxWidth: '600px' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '4px' }}>Conexão com API RemateWeb</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
            Configure a autenticação para importar leilões do painel.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="input-group">
              <label>Usuário do painel</label>
              <input className="input" value={apiUser} onChange={(e) => setApiUser(e.target.value)} placeholder="usuario@email.com" />
            </div>
            <div className="input-group">
              <label>Senha do painel</label>
              <input className="input" type="password" value={apiPassword} onChange={(e) => setApiPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <button className="btn btn-primary" onClick={handleAuthenticate} disabled={apiStatus === 'loading' || !apiUser || !apiPassword}>
              {apiStatus === 'loading' ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> :
                apiStatus === 'success' ? <><CheckCircle size={16} /> Autenticado</> :
                <><Key size={16} /> Autenticar</>}
            </button>

            {apiError && <div className="login-error">{apiError}</div>}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '4px' }}>
              <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Ou cole um token manualmente</h4>
              <div className="input-group">
                <label>Token JWT</label>
                <input className="input" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="eyJhbGciOi..." style={{ fontFamily: 'monospace', fontSize: '12px' }} />
              </div>
              <button className="btn btn-ghost" onClick={handleSetToken} style={{ marginTop: '8px' }}>
                <Save size={16} /> Usar Token
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Holidays Tab */}
      {activeTab === 'feriados' && (
        <div className="card animate-in">
          <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Feriados Cadastrados</h3>

          {holidays.length > 0 && (
            <div className="table-container" style={{ marginBottom: '20px' }}>
              <table className="table">
                <thead>
                  <tr><th>Data</th><th>Nome</th><th>Tipo</th><th></th></tr>
                </thead>
                <tbody>
                  {holidays.sort((a, b) => a.date.localeCompare(b.date)).map((h) => (
                    <tr key={h.id}>
                      <td>{h.date.split('-').reverse().join('/')}</td>
                      <td style={{ fontWeight: 500 }}>{h.name}</td>
                      <td><span className={`badge ${h.national ? 'badge-primary' : 'badge-info'}`}>{h.national ? 'Nacional' : 'Regional'}</span></td>
                      <td>
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleDeleteHoliday(h.id)} style={{ color: 'var(--error)' }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Novo Feriado</h4>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="input-group">
              <label>Data</label>
              <input className="input" type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
            </div>
            <div className="input-group" style={{ flex: 1, minWidth: '200px' }}>
              <label>Nome do Feriado</label>
              <input className="input" value={holidayName} onChange={(e) => setHolidayName(e.target.value)} placeholder="Ex: Natal" />
            </div>
            <div className="input-group" style={{ width: '140px' }}>
              <label>Tipo</label>
              <select className="input" value={holidayNational ? 'true' : 'false'} onChange={(e) => setHolidayNational(e.target.value === 'true')}>
                <option value="true">Nacional</option>
                <option value="false">Regional</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={handleAddHoliday} style={{ marginBottom: '6px' }}>
              <Plus size={16} /> Adicionar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
