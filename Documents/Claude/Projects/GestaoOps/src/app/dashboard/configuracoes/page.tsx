'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Settings, Key, Globe, Calendar as CalendarIcon, Save, Plus, Trash2, CheckCircle, Users, Receipt, Briefcase, Radio, ShieldCheck, Search, Tag } from 'lucide-react';
import { getAuditLog, AuditEntry, AuditAction } from '@/services/auditLog';
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { authenticate, setTokenManually } from '@/services/remateweb-api';
import { addDocument, getCollection, deleteDocument, setDocument, getDocument } from '@/lib/firestore';
import { useCatalogs } from '@/lib/useCatalogs';
import { DEFAULT_PAYMENT_CONDITION } from '@/types/event';
import { ContractType, HourRange, PaymentProfile } from '@/types/operator';
import { getPaymentProfiles, addPaymentProfile, updatePaymentProfile, deletePaymentProfile } from '@/services/paymentProfiles';
import {
  ServiceDef, ServiceNature, ServicesSettings, SERVICE_NATURE_LABELS,
  DEFAULT_SERVICE_CATALOG, serviceDefFromName, managedServiceNames,
} from '@/types/service';
import { Company, CostCenter, CostCenterType, COST_CENTER_TYPE_LABELS } from '@/types/company';
import { getCompanies, addCompany, updateCompany, deleteCompany } from '@/services/companies';
import { getCostCenters, addCostCenter, updateCostCenter, deleteCostCenter } from '@/services/costCenters';

interface Holiday {
  id: string;
  date: string;
  name: string;
  national: boolean;
}

export default function ConfiguracoesPage() {
  const [activeTab, setActiveTab] = useState<'funcoes' | 'servicos' | 'estudios' | 'pagamentos' | 'catalogos' | 'perfis' | 'fiscal' | 'api' | 'feriados' | 'auditoria' | 'empresas'>('funcoes');

  // Condições de pagamento padrão (dropdown no cadastro de leilão)
  const [payConds, setPayConds] = useState<string[]>([]);
  const [newPayCond, setNewPayCond] = useState('');
  const [payCondsLoaded, setPayCondsLoaded] = useState(false);

  // Catálogos RemateWeb (somente leitura)
  const { catalogs, loading: catalogsLoading } = useCatalogs();

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

  // Payment Profiles (unifica os antigos "Modelos de Ganhos")
  const [profiles, setProfiles] = useState<(PaymentProfile & { id: string })[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Partial<PaymentProfile> & { id?: string } | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileHourRanges, setProfileHourRanges] = useState<HourRange[]>([]);

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

  // --- Condições de Pagamento padrão ---
  const loadPayConds = useCallback(async () => {
    try {
      const doc = await getDocument<{ list: string[] }>('settings', 'paymentConditions');
      if (doc) {
        setPayConds(doc.list || []);
      } else {
        const defaults = [DEFAULT_PAYMENT_CONDITION];
        await setDocument('settings', 'paymentConditions', { list: defaults });
        setPayConds(defaults);
      }
      setPayCondsLoaded(true);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const savePayConds = async (updated: string[]) => {
    await setDocument('settings', 'paymentConditions', { list: updated });
    setPayConds(updated);
  };

  const handleAddPayCond = async () => {
    const trimmed = newPayCond.trim();
    if (!trimmed) return;
    if (payConds.includes(trimmed)) { showToast('Condição já cadastrada.', 'error'); return; }
    await savePayConds([...payConds, trimmed]);
    setNewPayCond('');
    showToast('Condição adicionada!');
  };

  const handleDeletePayCond = async (cond: string) => {
    await savePayConds(payConds.filter((c) => c !== cond));
    showToast('Condição removida.');
  };

  // --- Payment Profiles ---
  const loadProfiles = useCallback(async () => {
    try {
      const list = await getPaymentProfiles();
      setProfiles(list);
      setProfilesLoaded(true);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const openNewProfile = () => {
    const defaultRanges: HourRange[] = [
      { minHours: 0,  maxHours: 8,  weekdayValue: 100, weekendHolidayValue: 130 },
      { minHours: 8,  maxHours: 12, weekdayValue: 150, weekendHolidayValue: 195 },
      { minHours: 12, maxHours: 24, weekdayValue: 200, weekendHolidayValue: 260 },
    ];
    setProfileHourRanges(defaultRanges);
    setEditingProfile({ name: '', contractType: 'freelancer_n1', dailyTravel: 200, dailyTravelMultiple: 300, weekendHolidayBonus: 0, restDayExtra: 0, isActive: true });
  };

  const openEditProfile = (p: PaymentProfile & { id: string }) => {
    setProfileHourRanges(p.hourRanges || []);
    setEditingProfile({ ...p });
  };

  const cancelProfileEdit = () => {
    setEditingProfile(null);
    setProfileHourRanges([]);
  };

  const handleSaveProfile = async () => {
    if (!editingProfile?.name?.trim()) { showToast('Informe o nome do perfil.', 'error'); return; }
    setProfileSaving(true);
    try {
      const data = {
        name: editingProfile.name!.trim(),
        description: editingProfile.description || '',
        contractType: (editingProfile.contractType || 'freelancer_n1') as ContractType,
        hourRanges: profileHourRanges,
        dailyTravel: editingProfile.dailyTravel ?? 200,
        dailyTravelMultiple: editingProfile.dailyTravelMultiple ?? 300,
        weekendHolidayBonus: editingProfile.weekendHolidayBonus ?? 0,
        restDayExtra: editingProfile.restDayExtra ?? 0,
        restDayMatchesMainRules: editingProfile.restDayMatchesMainRules === true,
        isDefaultForContract: editingProfile.isDefaultForContract ?? null,
        isActive: editingProfile.isActive !== false,
      };
      if (editingProfile.id) {
        await updatePaymentProfile(editingProfile.id, data);
      } else {
        await addPaymentProfile(data);
      }
      await loadProfiles();
      setEditingProfile(null);
      setProfileHourRanges([]);
      showToast('Perfil salvo!');
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar perfil.', 'error');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    if (!confirm('Excluir este perfil? Operadores vinculados voltarão a usar as regras padrão.')) return;
    try {
      await deletePaymentProfile(id);
      await loadProfiles();
      showToast('Perfil excluído.');
    } catch {
      showToast('Erro ao excluir perfil.', 'error');
    }
  };

  const addProfileRange = () => {
    const last = profileHourRanges[profileHourRanges.length - 1];
    setProfileHourRanges([...profileHourRanges, { minHours: last?.maxHours || 0, maxHours: (last?.maxHours || 0) + 4, weekdayValue: 0, weekendHolidayValue: 0 }]);
  };

  const removeProfileRange = (idx: number) => setProfileHourRanges(profileHourRanges.filter((_, i) => i !== idx));

  const updateProfileRange = (idx: number, field: keyof HourRange, value: number) => {
    const updated = [...profileHourRanges];
    updated[idx] = { ...updated[idx], [field]: value };
    setProfileHourRanges(updated);
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

  // ==================== AUDITORIA ====================
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditUser, setAuditUser] = useState('');
  const [auditAction, setAuditAction] = useState<AuditAction | ''>('');
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');

  // Empresas e centros de custo
  const [companies, setCompanies] = useState<(Company & { id: string })[]>([]);
  const [costCenters, setCostCenters] = useState<(CostCenter & { id: string })[]>([]);
  const [empresasLoaded, setEmpresasLoaded] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyCode, setNewCompanyCode] = useState('');
  const [newCompanyCnpj, setNewCompanyCnpj] = useState('');
  const [newCompanyColor, setNewCompanyColor] = useState('#6366f1');
  const [newCcCompanyId, setNewCcCompanyId] = useState('');
  const [newCcName, setNewCcName] = useState('');
  const [newCcCode, setNewCcCode] = useState('');
  const [newCcType, setNewCcType] = useState<CostCenterType>('operacional');

  const loadEmpresas = useCallback(async () => {
    try {
      const [comps, ccs] = await Promise.all([getCompanies(), getCostCenters()]);
      setCompanies(comps);
      setCostCenters(ccs);
      setEmpresasLoaded(true);
    } catch { setEmpresasLoaded(true); }
  }, []);

  const handleAddCompany = async () => {
    if (!newCompanyName.trim() || !newCompanyCode.trim()) return;
    await addCompany({ name: newCompanyName.trim(), code: newCompanyCode.trim().toUpperCase(), cnpj: newCompanyCnpj.trim() || undefined, color: newCompanyColor, active: true });
    setNewCompanyName(''); setNewCompanyCode(''); setNewCompanyCnpj(''); setNewCompanyColor('#6366f1');
    const comps = await getCompanies(); setCompanies(comps);
    setToast({ message: 'Empresa adicionada!', type: 'success' });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDeleteCompany = async (id: string) => {
    await deleteCompany(id);
    const [comps, ccs] = await Promise.all([getCompanies(), getCostCenters()]);
    setCompanies(comps); setCostCenters(ccs);
    setToast({ message: 'Empresa removida.', type: 'success' });
    setTimeout(() => setToast(null), 3000);
  };

  const handleAddCostCenter = async () => {
    if (!newCcCompanyId || !newCcName.trim() || !newCcCode.trim()) return;
    await addCostCenter({ companyId: newCcCompanyId, name: newCcName.trim(), code: newCcCode.trim().toUpperCase(), type: newCcType, active: true });
    setNewCcName(''); setNewCcCode(''); setNewCcType('operacional');
    const ccs = await getCostCenters(); setCostCenters(ccs);
    setToast({ message: 'Centro de custo adicionado!', type: 'success' });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDeleteCostCenter = async (id: string) => {
    await deleteCostCenter(id);
    const ccs = await getCostCenters(); setCostCenters(ccs);
    setToast({ message: 'Centro de custo removido.', type: 'success' });
    setTimeout(() => setToast(null), 3000);
  };

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const entries = await getAuditLog();
      setAuditEntries(entries);
      setAuditLoaded(true);
    } catch { setAuditLoaded(true); }
    finally { setAuditLoading(false); }
  }, []);

  const filteredAudit = useMemo(() => {
    return auditEntries.filter((e) => {
      if (auditUser && !e.userName.toLowerCase().includes(auditUser.toLowerCase())) return false;
      if (auditAction && e.action !== auditAction) return false;
      if (auditSearch && !e.detail.toLowerCase().includes(auditSearch.toLowerCase())) return false;
      if (auditFrom || auditTo) {
        const t = parseISO(e.timestamp);
        if (auditFrom && t < startOfDay(parseISO(auditFrom))) return false;
        if (auditTo && t > endOfDay(parseISO(auditTo))) return false;
      }
      return true;
    });
  }, [auditEntries, auditUser, auditAction, auditSearch, auditFrom, auditTo]);

  const ACTION_LABELS: Record<string, string> = {
    CREATE_EVENT: 'Criar evento', UPDATE_EVENT: 'Atualizar evento', DELETE_EVENT: 'Excluir evento',
    CREATE_OPERATOR: 'Criar operador', UPDATE_OPERATOR: 'Atualizar operador', DELETE_OPERATOR: 'Excluir operador',
    ASSIGN_OPERATOR: 'Escalar operador', REMOVE_ASSIGNMENT: 'Remover escala',
    UPDATE_SETTINGS: 'Alterar configuração', IMPORT_API: 'Importar da API', SYNC_TIMES: 'Sincronizar horários',
  };

  // Load data when tab switches
  useEffect(() => {
    if (activeTab === 'funcoes' && !rolesLoaded) loadRoles();
    if (activeTab === 'servicos' && !servicesLoaded) loadServices();
    if (activeTab === 'estudios' && !studiosLoaded) loadStudios();
    if (activeTab === 'pagamentos' && !payCondsLoaded) loadPayConds();
    if (activeTab === 'perfis' && !profilesLoaded) loadProfiles();
    if (activeTab === 'feriados' && !holidaysLoaded) loadHolidays();
    if (activeTab === 'auditoria' && !auditLoaded) loadAudit();
    if (activeTab === 'empresas' && !empresasLoaded) loadEmpresas();
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
  }, [activeTab, rolesLoaded, servicesLoaded, studiosLoaded, payCondsLoaded, profilesLoaded, holidaysLoaded, fiscalLoaded, auditLoaded, empresasLoaded, loadRoles, loadServices, loadStudios, loadPayConds, loadProfiles, loadAudit, loadEmpresas]);

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
        <button className={`tab ${activeTab === 'pagamentos' ? 'active' : ''}`} onClick={() => setActiveTab('pagamentos')}>
          <Receipt size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Condições de Pagamento
        </button>
        <button className={`tab ${activeTab === 'catalogos' ? 'active' : ''}`} onClick={() => setActiveTab('catalogos')}>
          <Globe size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Catálogos RemateWeb
        </button>
        <button className={`tab ${activeTab === 'perfis' ? 'active' : ''}`} onClick={() => setActiveTab('perfis')}>
          <Tag size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Perfis de Pagamento
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
        <button className={`tab ${activeTab === 'auditoria' ? 'active' : ''}`} onClick={() => setActiveTab('auditoria')}>
          <ShieldCheck size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Auditoria
        </button>
        <button className={`tab ${activeTab === 'empresas' ? 'active' : ''}`} onClick={() => setActiveTab('empresas')}>
          <Briefcase size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Empresas
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

      {/* Condições de Pagamento Tab */}
      {activeTab === 'pagamentos' && (
        <div className="card animate-in" style={{ maxWidth: '600px' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '4px' }}>Condições de Pagamento Padrão</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
            As condições mais usadas aparecem como dropdown no cadastro de leilão.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '20px' }}>
            {payConds.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhuma condição cadastrada.</p>}
            {payConds.map((cond, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 14px',
                background: 'var(--bg-surface-elevated)',
                borderRadius: 'var(--radius-md)',
              }}>
                <span style={{ flex: 1, fontSize: '14px', fontWeight: 500 }}>{cond}</span>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleDeletePayCond(cond)} style={{ color: 'var(--error)' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              className="input"
              placeholder="Ex: 2+2+2+2+2+20=30"
              value={newPayCond}
              onChange={(e) => setNewPayCond(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddPayCond()}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleAddPayCond} disabled={!newPayCond.trim()}>
              <Plus size={16} /> Adicionar
            </button>
          </div>
        </div>
      )}

      {/* Catálogos RemateWeb Tab (somente leitura) */}
      {activeTab === 'catalogos' && (
        <div className="card animate-in">
          <h3 style={{ fontSize: '16px', marginBottom: '4px' }}>Catálogos RemateWeb</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
            Dados lidos da API RemateWeb (somente leitura). Para criar/editar, use o painel RemateWeb — a edição direta por aqui entra numa fase futura.
            {catalogsLoading && ' · carregando…'}
          </p>

          {(() => {
            const cats: { label: string; items: { id: number; name: string }[] }[] = [
              { label: 'Tipos de Raça', items: catalogs.breedTypes },
              { label: 'Raças', items: catalogs.breeds },
              { label: 'Parceiros', items: catalogs.partners },
              { label: 'Canais', items: catalogs.channels },
              { label: 'Canais de Transmissão (Streaming)', items: catalogs.streamings },
              { label: 'Grupos de Regra de Lance', items: catalogs.bidIncrementGroups },
              { label: 'Unidades', items: catalogs.unities },
            ];
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
                {cats.map((cat) => (
                  <div key={cat.label} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '13px' }}>{cat.label}</strong>
                      <span className="badge badge-info">{cat.items.length}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '200px', overflowY: 'auto', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {cat.items.length === 0 ? (
                        <span style={{ color: 'var(--text-muted)' }}>{catalogsLoading ? '…' : 'vazio (requer token RemateWeb)'}</span>
                      ) : (
                        cat.items.slice(0, 100).map((it) => <span key={it.id}>{it.name}</span>)
                      )}
                      {cat.items.length > 100 && <span style={{ color: 'var(--text-muted)' }}>+{cat.items.length - 100} mais…</span>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Perfis de Pagamento Tab */}
      {activeTab === 'perfis' && (
        <div className="animate-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h3 style={{ fontSize: '16px', marginBottom: '4px' }}>Perfis de Pagamento</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Perfis de remuneração reutilizáveis. Atribua-os a operadores ou marque um como <strong>padrão</strong> de um tipo de contrato (substitui os antigos "Modelos de Ganhos").
              </p>
            </div>
            {!editingProfile && (
              <button className="btn btn-primary" onClick={openNewProfile}>
                <Plus size={16} /> Novo Perfil
              </button>
            )}
          </div>

          {/* Profile list */}
          {profiles.length === 0 && !editingProfile && (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
              Nenhum perfil cadastrado. Clique em <strong>Novo Perfil</strong> para começar.
            </div>
          )}

          {profiles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: editingProfile ? '24px' : '0' }}>
              {profiles.map((p) => (
                <div key={p.id} className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                      <span style={{ fontWeight: 600, fontSize: '15px' }}>{p.name}</span>
                      <span className={`badge ${p.isActive ? 'badge-success' : 'badge-warning'}`}>
                        {p.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                      <span className="badge badge-info">
                        {p.contractType === 'funcionario' ? 'CLT' : p.contractType === 'freelancer_n1' ? 'Freelancer N1' : 'Freelancer N2'}
                      </span>
                      {p.isDefaultForContract && (
                        <span className="badge badge-primary" title="Perfil padrão deste tipo de contrato">
                          ★ Padrão {p.isDefaultForContract === 'funcionario' ? 'CLT' : p.isDefaultForContract === 'freelancer_n1' ? 'N1' : 'N2'}
                        </span>
                      )}
                    </div>
                    {p.description && <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{p.description}</p>}
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                      {p.hourRanges?.length || 0} faixa(s) · Diária R$ {p.dailyTravel} / R$ {p.dailyTravelMultiple}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEditProfile(p)} disabled={!!editingProfile}>
                      Editar
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleDeleteProfile(p.id)} style={{ color: 'var(--error)' }} disabled={!!editingProfile}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Profile form */}
          {editingProfile && (
            <div className="card animate-in" style={{ marginTop: '8px' }}>
              <h4 style={{ fontSize: '15px', marginBottom: '20px' }}>
                {editingProfile.id ? `Editar: ${editingProfile.name}` : 'Novo Perfil'}
              </h4>

              <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Nome do Perfil *</label>
                  <input
                    className="input"
                    placeholder="Ex: Freelancer N2"
                    value={editingProfile.name || ''}
                    onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
                  />
                </div>
                <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Descrição (opcional)</label>
                  <input
                    className="input"
                    placeholder="Ex: Josemar, Adonai, Henrique — rates N2"
                    value={editingProfile.description || ''}
                    onChange={(e) => setEditingProfile({ ...editingProfile, description: e.target.value })}
                  />
                </div>
                <div className="input-group">
                  <label>Tipo de Contrato</label>
                  <select
                    className="input"
                    value={editingProfile.contractType || 'freelancer_n1'}
                    onChange={(e) => setEditingProfile({ ...editingProfile, contractType: e.target.value as ContractType })}
                  >
                    <option value="funcionario">Funcionário (CLT)</option>
                    <option value="freelancer_n1">Freelancer N1</option>
                    <option value="freelancer_n2">Freelancer N2</option>
                  </select>
                </div>
                <div className="input-group">
                  <label>Padrão do contrato</label>
                  <select
                    className="input"
                    value={editingProfile.isDefaultForContract || ''}
                    onChange={(e) => setEditingProfile({ ...editingProfile, isDefaultForContract: (e.target.value || null) as ContractType | null })}
                  >
                    <option value="">Não é padrão</option>
                    <option value="funcionario">Padrão p/ Funcionário (CLT)</option>
                    <option value="freelancer_n1">Padrão p/ Freelancer N1</option>
                    <option value="freelancer_n2">Padrão p/ Freelancer N2</option>
                  </select>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Aplicado a operadores do tipo sem perfil específico.
                  </span>
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '10px', justifyContent: 'flex-end', paddingBottom: '4px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={editingProfile.isActive !== false}
                      onChange={(e) => setEditingProfile({ ...editingProfile, isActive: e.target.checked })}
                      style={{ width: '16px', height: '16px' }}
                    />
                    Perfil Ativo
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={editingProfile.restDayMatchesMainRules === true}
                      onChange={(e) => setEditingProfile({ ...editingProfile, restDayMatchesMainRules: e.target.checked })}
                      style={{ width: '16px', height: '16px' }}
                    />
                    <span style={{ fontSize: '13px' }}>
                      Folga usa mesma tabela de horas
                      <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>
                        (ao invés da tabela N2 padrão)
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <h5 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px' }}>Diárias de Viagem / Evento Externo</h5>
              <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '20px', maxWidth: '500px' }}>
                <div className="input-group">
                  <label>Diária simples (R$)</label>
                  <input className="input" type="number" value={editingProfile.dailyTravel ?? 200} onChange={(e) => setEditingProfile({ ...editingProfile, dailyTravel: Number(e.target.value) })} />
                </div>
                <div className="input-group">
                  <label>Diária múltipla (R$)</label>
                  <input className="input" type="number" value={editingProfile.dailyTravelMultiple ?? 300} onChange={(e) => setEditingProfile({ ...editingProfile, dailyTravelMultiple: Number(e.target.value) })} />
                </div>
                <div className="input-group">
                  <label>Extra dia de folga (R$)</label>
                  <input className="input" type="number" value={editingProfile.restDayExtra ?? 0} onChange={(e) => setEditingProfile({ ...editingProfile, restDayExtra: Number(e.target.value) })} />
                </div>
              </div>

              <h5 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px' }}>Tabela de Faixa de Horas</h5>
              <div className="table-container" style={{ marginBottom: '12px' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Mín. Horas (≥)</th>
                      <th>Máx. Horas (&lt;)</th>
                      <th>Valor Dia Útil (R$)</th>
                      <th>Valor FDS/Feriado (R$)</th>
                      <th style={{ width: '50px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileHourRanges.map((range, idx) => (
                      <tr key={idx}>
                        <td><input className="input" type="number" value={range.minHours} onChange={(e) => updateProfileRange(idx, 'minHours', Number(e.target.value))} style={{ width: '80px' }} /></td>
                        <td><input className="input" type="number" value={range.maxHours} onChange={(e) => updateProfileRange(idx, 'maxHours', Number(e.target.value))} style={{ width: '80px' }} /></td>
                        <td><input className="input" type="number" value={range.weekdayValue} onChange={(e) => updateProfileRange(idx, 'weekdayValue', Number(e.target.value))} style={{ width: '120px' }} /></td>
                        <td><input className="input" type="number" value={range.weekendHolidayValue} onChange={(e) => updateProfileRange(idx, 'weekendHolidayValue', Number(e.target.value))} style={{ width: '120px' }} /></td>
                        <td>
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeProfileRange(idx)} style={{ color: 'var(--error)' }}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {profileHourRanges.length === 0 && (
                      <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>Sem faixas — adicione abaixo</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={addProfileRange} style={{ marginBottom: '24px' }}>
                <Plus size={14} /> Adicionar faixa
              </button>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn btn-ghost" onClick={cancelProfileEdit}>Cancelar</button>
                <button className="btn btn-primary" onClick={handleSaveProfile} disabled={profileSaving}>
                  {profileSaving ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> : <><Save size={16} /> Salvar Perfil</>}
                </button>
              </div>
            </div>
          )}
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
      {/* Aba de Auditoria */}
      {activeTab === 'auditoria' && (
        <div className="card animate-in">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h3 style={{ fontSize: '16px', marginBottom: '2px' }}>Log de Auditoria</h3>
              <p style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Todas as ações dos usuários no sistema. Somente leitura.</p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setAuditLoaded(false); loadAudit(); }}>
              <Settings size={14} /> Atualizar
            </button>
          </div>

          {/* Filtros */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px', marginBottom: '16px', padding: '14px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
            <div className="input-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '11px' }}>Usuário</label>
              <input className="input" placeholder="Nome do usuário" value={auditUser} onChange={(e) => setAuditUser(e.target.value)} style={{ fontSize: '13px', padding: '6px 10px' }} />
            </div>
            <div className="input-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '11px' }}>Ação</label>
              <select className="input" value={auditAction} onChange={(e) => setAuditAction(e.target.value as AuditAction | '')} style={{ fontSize: '13px', padding: '6px 10px' }}>
                <option value="">Todas</option>
                {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="input-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '11px' }}>De</label>
              <input className="input" type="date" value={auditFrom} onChange={(e) => setAuditFrom(e.target.value)} style={{ fontSize: '13px', padding: '6px 10px' }} />
            </div>
            <div className="input-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '11px' }}>Até</label>
              <input className="input" type="date" value={auditTo} onChange={(e) => setAuditTo(e.target.value)} style={{ fontSize: '13px', padding: '6px 10px' }} />
            </div>
            <div className="input-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '11px' }}>Busca livre</label>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input className="input" placeholder="Buscar na descrição..." value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)} style={{ fontSize: '13px', padding: '6px 10px 6px 30px' }} />
              </div>
            </div>
          </div>

          {auditLoading ? (
            <div className="skeleton" style={{ height: '200px' }} />
          ) : filteredAudit.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px' }}><ShieldCheck size={32} style={{ opacity: 0.3 }} /><p style={{ fontSize: '13px' }}>Nenhum registro encontrado</p></div>
          ) : (
            <div className="table-container">
              <table className="table" style={{ fontSize: '12.5px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '140px' }}>Data/hora</th>
                    <th>Usuário</th>
                    <th style={{ width: '160px' }}>Ação</th>
                    <th>Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAudit.slice(0, 200).map((e, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {format(parseISO(e.timestamp), "dd/MM/yy HH:mm", { locale: ptBR })}
                      </td>
                      <td>
                        <span style={{ fontWeight: 500 }}>{e.userName}</span>
                        <span className="badge" style={{ marginLeft: '6px', fontSize: '10px' }}>{e.role}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{ACTION_LABELS[e.action] || e.action}</span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredAudit.length > 200 && (
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px 12px' }}>Mostrando 200 de {filteredAudit.length} registros. Use os filtros para refinar.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Aba de Empresas e Centros de Custo */}
      {activeTab === 'empresas' && (
        <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* Empresas */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '16px', marginBottom: '2px' }}>Empresas do Grupo</h3>
                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Cada evento é vinculado a uma empresa para separação financeira.</p>
              </div>
            </div>

            {companies.length > 0 && (
              <div className="table-container" style={{ marginBottom: '20px' }}>
                <table className="table" style={{ fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '16px' }}></th>
                      <th>Nome</th>
                      <th>Código</th>
                      <th>CNPJ</th>
                      <th style={{ width: '80px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((c) => (
                      <tr key={c.id}>
                        <td><span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', background: c.color || '#6366f1' }} /></td>
                        <td style={{ fontWeight: 500 }}>{c.name}</td>
                        <td><span className="badge">{c.code}</span></td>
                        <td style={{ color: 'var(--text-muted)' }}>{c.cnpj || '—'}</td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteCompany(c.id)} style={{ color: 'var(--error)', padding: '2px 6px' }}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Nova Empresa</h4>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="input-group" style={{ flex: 2, minWidth: '180px' }}>
                <label>Nome</label>
                <input className="input" value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="Ex: RemateWeb" />
              </div>
              <div className="input-group" style={{ width: '100px' }}>
                <label>Sigla</label>
                <input className="input" value={newCompanyCode} onChange={(e) => setNewCompanyCode(e.target.value)} placeholder="RW" maxLength={6} />
              </div>
              <div className="input-group" style={{ flex: 1, minWidth: '160px' }}>
                <label>CNPJ (opcional)</label>
                <input className="input" value={newCompanyCnpj} onChange={(e) => setNewCompanyCnpj(e.target.value)} placeholder="00.000.000/0001-00" />
              </div>
              <div className="input-group" style={{ width: '80px' }}>
                <label>Cor</label>
                <input type="color" className="input" value={newCompanyColor} onChange={(e) => setNewCompanyColor(e.target.value)} style={{ padding: '2px', height: '38px' }} />
              </div>
              <button className="btn btn-primary" onClick={handleAddCompany} style={{ marginBottom: '6px' }}>
                <Plus size={16} /> Adicionar
              </button>
            </div>
          </div>

          {/* Centros de Custo */}
          <div className="card">
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', marginBottom: '2px' }}>Centros de Custo</h3>
              <p style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Classifique os custos (diárias, despesas) por centro de custo dentro de cada empresa.</p>
            </div>

            {costCenters.length > 0 && (
              <div className="table-container" style={{ marginBottom: '20px' }}>
                <table className="table" style={{ fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th>Empresa</th>
                      <th>Nome</th>
                      <th>Código</th>
                      <th>Tipo</th>
                      <th style={{ width: '80px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {costCenters.map((cc) => {
                      const comp = companies.find((c) => c.id === cc.companyId);
                      return (
                        <tr key={cc.id}>
                          <td>
                            {comp && <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: comp.color || '#6366f1', marginRight: '6px' }} />}
                            <span style={{ color: 'var(--text-secondary)' }}>{comp?.name || '—'}</span>
                          </td>
                          <td style={{ fontWeight: 500 }}>{cc.name}</td>
                          <td><span className="badge">{cc.code}</span></td>
                          <td><span className="badge badge-accent" style={{ fontSize: '11px' }}>{COST_CENTER_TYPE_LABELS[cc.type]}</span></td>
                          <td>
                            <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteCostCenter(cc.id)} style={{ color: 'var(--error)', padding: '2px 6px' }}>
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Novo Centro de Custo</h4>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="input-group" style={{ width: '180px' }}>
                <label>Empresa</label>
                <select className="input" value={newCcCompanyId} onChange={(e) => setNewCcCompanyId(e.target.value)}>
                  <option value="">Selecione...</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="input-group" style={{ flex: 2, minWidth: '180px' }}>
                <label>Nome</label>
                <input className="input" value={newCcName} onChange={(e) => setNewCcName(e.target.value)} placeholder="Ex: Leilões Externos" />
              </div>
              <div className="input-group" style={{ width: '100px' }}>
                <label>Código</label>
                <input className="input" value={newCcCode} onChange={(e) => setNewCcCode(e.target.value)} placeholder="EXT" maxLength={8} />
              </div>
              <div className="input-group" style={{ width: '160px' }}>
                <label>Tipo</label>
                <select className="input" value={newCcType} onChange={(e) => setNewCcType(e.target.value as CostCenterType)}>
                  {(Object.keys(COST_CENTER_TYPE_LABELS) as CostCenterType[]).map((t) => (
                    <option key={t} value={t}>{COST_CENTER_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" onClick={handleAddCostCenter} style={{ marginBottom: '6px' }}>
                <Plus size={16} /> Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
