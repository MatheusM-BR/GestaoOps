'use client';

import { useEffect, useState } from 'react';
import { getOperators, createOperator, deleteOperator } from '@/services/operators';
import { Operator, ContractType, OperatorRole } from '@/types/operator';
import { maskPhone } from '@/lib/masks';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, UserCircle, Phone, Mail,
  MoreVertical, Trash2, Edit, Filter,
} from 'lucide-react';

const contractLabels: Record<ContractType, string> = {
  funcionario: 'Funcionário',
  freelancer_n1: 'Freelancer N1',
  freelancer_n2: 'Freelancer N2',
};

const avatarColors = [
  'linear-gradient(135deg, #16A34A, #059669)',
  'linear-gradient(135deg, #3B82F6, #2563EB)',
  'linear-gradient(135deg, #8B5CF6, #7C3AED)',
  'linear-gradient(135deg, #F59E0B, #D97706)',
  'linear-gradient(135deg, #EF4444, #DC2626)',
  'linear-gradient(135deg, #06B6D4, #0891B2)',
];

export default function OperadoresPage() {
  const router = useRouter();
  const [operators, setOperators] = useState<(Operator & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterContract, setFilterContract] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // Create form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formContract, setFormContract] = useState<ContractType>('funcionario');
  const [formRole, setFormRole] = useState<OperatorRole>('operacao');
  const [formPassword, setFormPassword] = useState('');
  const [formError, setFormError] = useState('');

  const loadOperators = async () => {
    try {
      const ops = await getOperators();
      setOperators(ops);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOperators(); }, []);

  const filtered = operators.filter((o) => {
    const matchSearch = o.name?.toLowerCase().includes(search.toLowerCase()) ||
      o.email?.toLowerCase().includes(search.toLowerCase());
    const matchContract = filterContract === 'all' || o.contractType === filterContract;
    return matchSearch && matchContract;
  });

  const handleCreate = async () => {
    if (!formName || !formEmail || !formPassword) {
      setFormError('Preencha nome, e-mail e senha.');
      return;
    }
    setCreating(true);
    setFormError('');
    try {
      const operatorId = await createOperator({
        name: formName,
        email: formEmail,
        phone: formPhone,
        contractType: formContract,
        role: formRole,
        active: true,
        password: formPassword,
      });
      setShowCreateModal(false);
      resetForm();
      router.push(`/dashboard/operadores/detalhes?id=${operatorId}`);
    } catch (err: unknown) {
      const fbErr = err as { code?: string; message?: string };
      if (fbErr.code === 'auth/email-already-in-use') {
        setFormError('Este e-mail já está em uso.');
      } else {
        setFormError(fbErr.message || 'Erro ao criar operador.');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este operador?')) return;
    try {
      await deleteOperator(id);
      await loadOperators();
    } catch (err) {
      console.error(err);
    }
  };

  const resetForm = () => {
    setFormName('');
    setFormEmail('');
    setFormPhone('');
    setFormContract('funcionario');
    setFormRole('operador_transmissao');
    setFormPassword('');
    setFormError('');
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Operadores</h1>
          <p>{operators.length} operadores cadastrados</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          <Plus size={18} />
          Novo Operador
        </button>
      </div>

      {/* Filters */}
      <div className="filters-container">
        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '40px' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: 'auto' }} className="filters-select-wrapper">
          <Filter size={16} style={{ color: 'var(--text-muted)' }} />
          <select className="input" value={filterContract} onChange={(e) => setFilterContract(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">Todos os tipos</option>
            <option value="funcionario">Funcionário</option>
            <option value="freelancer_n1">Freelancer N1</option>
            <option value="freelancer_n2">Freelancer N2</option>
          </select>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" style={{ height: '80px' }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state card">
          <UserCircle size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <h3>Nenhum operador encontrado</h3>
          <p>Cadastre um novo operador para começar.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map((op, idx) => (
            <div key={op.id} className="responsive-card-item">
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', width: '100%' }}>
                <div className="avatar avatar-lg" style={{ background: avatarColors[idx % avatarColors.length], flexShrink: 0 }}>
                  {op.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link href={`/dashboard/operadores/detalhes?id=${op.id}`} style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {op.name}
                  </Link>
                  <div className="item-meta" style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Mail size={13} /> {op.email}
                    </span>
                    {op.phone && (
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Phone size={13} /> {op.phone}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="item-actions">
                <span className={`badge ${op.contractType === 'funcionario' ? 'badge-primary' : op.contractType === 'freelancer_n1' ? 'badge-accent' : 'badge-info'}`}>
                  {contractLabels[op.contractType]}
                </span>
                <span className={`badge ${op.active ? 'badge-success' : 'badge-error'}`}>
                  {op.active ? 'Ativo' : 'Inativo'}
                </span>
                <div style={{ position: 'relative' }}>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setMenuOpen(menuOpen === op.id ? null : op.id)}>
                    <MoreVertical size={16} />
                  </button>
                  {menuOpen === op.id && (
                    <div style={{
                      position: 'absolute', right: 0, top: '100%', background: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '4px',
                      minWidth: '160px', zIndex: 10, boxShadow: 'var(--shadow-lg)',
                    }}>
                      <Link
                        href={`/dashboard/operadores/detalhes?id=${op.id}`}
                        className="nav-item"
                        style={{ fontSize: '13px', padding: '8px 12px' }}
                        onClick={() => setMenuOpen(null)}
                      >
                        <Edit size={14} /> Editar
                      </Link>
                      <button
                        className="nav-item"
                        style={{ fontSize: '13px', padding: '8px 12px', color: 'var(--error)' }}
                        onClick={() => { setMenuOpen(null); handleDelete(op.id); }}
                      >
                        <Trash2 size={14} /> Excluir
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => { setShowCreateModal(false); resetForm(); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Novo Operador</h2>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => { setShowCreateModal(false); resetForm(); }}>✕</button>
            </div>

            {formError && (
              <div className="login-error" style={{ marginBottom: '16px' }}>
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group">
                <label>Nome completo *</label>
                <input className="input" placeholder="Nome do operador" value={formName} onChange={(e) => setFormName(e.target.value)} />
              </div>
              <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="input-group">
                  <label>E-mail *</label>
                  <input className="input" type="email" placeholder="email@exemplo.com" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>Telefone</label>
                  <input className="input" placeholder="(00) 00000-0000" value={formPhone} onChange={(e) => setFormPhone(maskPhone(e.target.value))} maxLength={15} />
                </div>
              </div>
              <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="input-group">
                  <label>Tipo de Contrato *</label>
                  <select className="input" value={formContract} onChange={(e) => setFormContract(e.target.value as ContractType)}>
                    <option value="funcionario">Funcionário</option>
                    <option value="freelancer_n1">Freelancer N1</option>
                    <option value="freelancer_n2">Freelancer N2</option>
                  </select>
                </div>
                <div className="input-group">
                  <label>Nível de Acesso</label>
                  <select className="input" value={formRole} onChange={(e) => setFormRole(e.target.value as OperatorRole)}>
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
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Defina as funções (Painel, Técnico, Freelancer…) e folgas depois de criar, na ficha do operador.
                  </p>
                </div>
              </div>
              <div className="input-group">
                <label>Senha de acesso *</label>
                <input className="input" type="password" placeholder="Mínimo 6 caracteres" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setShowCreateModal(false); resetForm(); }}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
                {creating ? <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} /> : <><Plus size={16} /> Criar Operador</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
