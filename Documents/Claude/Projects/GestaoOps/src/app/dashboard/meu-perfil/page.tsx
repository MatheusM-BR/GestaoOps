'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getOperatorByUid, updateOperator } from '@/services/operators';
import { Operator, ContractType } from '@/types/operator';
import { Save, UserCircle } from 'lucide-react';

const contractLabels: Record<ContractType, string> = {
  funcionario: 'Funcionário',
  freelancer_n1: 'Freelancer N1',
  freelancer_n2: 'Freelancer N2',
};

export default function MeuPerfilPage() {
  const { user } = useAuth();
  const [operator, setOperator] = useState<(Operator & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [phone, setPhone] = useState('');
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);

  useEffect(() => {
    async function load() {
      if (!user) return;
      try {
        const op = await getOperatorByUid(user.uid);
        setOperator(op);
        if (op) setPhone(op.phone || '');
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  const handleSave = async () => {
    if (!operator) return;
    setSaving(true);
    try {
      await updateOperator(operator.id, { phone } as Partial<Operator>);
      setToast({ message: 'Perfil atualizado!', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      console.error(err);
      setToast({ message: 'Erro ao salvar.', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="skeleton" style={{ height: '300px' }} />;
  }

  if (!operator) {
    return (
      <div className="empty-state card">
        <UserCircle size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
        <h3>Perfil não encontrado</h3>
        <p>Seu perfil de operador não foi encontrado no sistema.</p>
      </div>
    );
  }

  return (
    <div>
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.message}</div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1>Meu Perfil</h1>
          <p>Visualize e edite suas informações</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: '600px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '28px', paddingBottom: '20px', borderBottom: '1px solid var(--border)' }}>
          <div className="avatar avatar-lg" style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', width: '64px', height: '64px', fontSize: '24px' }}>
            {operator.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h2 style={{ fontSize: '20px' }}>{operator.name}</h2>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <span className="badge badge-primary">{contractLabels[operator.contractType]}</span>
              <span className={`badge ${operator.active ? 'badge-success' : 'badge-error'}`}>
                {operator.active ? 'Ativo' : 'Inativo'}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="input-group">
            <label>Nome</label>
            <input className="input" value={operator.name} disabled style={{ opacity: 0.6 }} />
          </div>
          <div className="input-group">
            <label>E-mail</label>
            <input className="input" value={operator.email} disabled style={{ opacity: 0.6 }} />
          </div>
          <div className="input-group">
            <label>Telefone</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
          </div>
          <div className="input-group">
            <label>Tipo de Contrato</label>
            <input className="input" value={contractLabels[operator.contractType]} disabled style={{ opacity: 0.6 }} />
          </div>

          <div style={{ marginTop: '8px' }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> : <><Save size={16} /> Salvar</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
