'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getOperatorByUid, updateOperator } from '@/services/operators';
import { getBlockoutsByOperator, createBlockout, deleteBlockout, OperatorBlockout, BlockoutReason, BLOCKOUT_REASON_LABELS } from '@/services/blockouts';
import { Operator, ContractType } from '@/types/operator';
import { Save, UserCircle, CalendarOff, Plus, Trash2, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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

  // Disponibilidade / blockouts
  const [blockouts, setBlockouts] = useState<OperatorBlockout[]>([]);
  const [blockFrom, setBlockFrom] = useState('');
  const [blockTo, setBlockTo] = useState('');
  const [blockReason, setBlockReason] = useState<BlockoutReason>('pessoal');
  const [blockNote, setBlockNote] = useState('');
  const [blockSaving, setBlockSaving] = useState(false);

  const showToast = (message: string, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const isFreelancer = operator?.contractType === 'freelancer_n1' || operator?.contractType === 'freelancer_n2';

  useEffect(() => {
    async function load() {
      if (!user) return;
      try {
        const op = await getOperatorByUid(user.uid);
        setOperator(op);
        if (op) {
          setPhone(op.phone || '');
          const bk = await getBlockoutsByOperator(op.id).catch(() => []);
          setBlockouts(bk);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  const handleAddBlockout = async () => {
    if (!operator || !user || !blockFrom) return;
    setBlockSaving(true);
    try {
      const status = isFreelancer ? 'aprovado' : 'pendente';
      const id = await createBlockout({
        operatorId: operator.id,
        userId: user.uid,
        operatorName: operator.name,
        contractType: operator.contractType,
        dateFrom: blockFrom,
        dateTo: blockTo || blockFrom,
        reason: blockReason,
        note: blockNote,
        status,
        createdAt: new Date().toISOString(),
      });
      const newEntry: OperatorBlockout = {
        id,
        operatorId: operator.id,
        userId: user.uid,
        operatorName: operator.name,
        contractType: operator.contractType,
        dateFrom: blockFrom,
        dateTo: blockTo || blockFrom,
        reason: blockReason,
        note: blockNote,
        status,
        createdAt: new Date().toISOString(),
      };
      setBlockouts((prev) => [...prev, newEntry].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom)));
      setBlockFrom('');
      setBlockTo('');
      setBlockNote('');
      showToast(isFreelancer ? 'Período bloqueado com sucesso!' : 'Solicitação enviada ao gestor!');
    } catch { showToast('Erro ao salvar.', 'error'); }
    finally { setBlockSaving(false); }
  };

  const handleDeleteBlockout = async (id: string) => {
    try {
      await deleteBlockout(id);
      setBlockouts((prev) => prev.filter((b) => b.id !== id));
      showToast('Removido.');
    } catch { showToast('Erro ao remover.', 'error'); }
  };

  const handleSave = async () => {
    if (!operator) return;
    setSaving(true);
    try {
      await updateOperator(operator.id, { phone } as Partial<Operator>);
      showToast('Perfil atualizado!');
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar.', 'error');
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

      {/* Disponibilidade */}
      <div className="card animate-in" style={{ maxWidth: '600px', marginTop: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <CalendarOff size={18} style={{ color: 'var(--primary)' }} />
          <h3 style={{ fontSize: '16px' }}>Disponibilidade</h3>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
          {isFreelancer
            ? 'Marque períodos em que não estará disponível para serviços.'
            : 'Solicite folgas ou ausências ao seu gestor. A aprovação é necessária.'}
        </p>

        {/* Formulário de bloqueio */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
          <div className="input-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12px' }}>De</label>
            <input className="input" type="date" value={blockFrom} onChange={(e) => { setBlockFrom(e.target.value); if (!blockTo) setBlockTo(e.target.value); }} style={{ fontSize: '13px' }} />
          </div>
          <div className="input-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12px' }}>Até</label>
            <input className="input" type="date" value={blockTo} min={blockFrom} onChange={(e) => setBlockTo(e.target.value)} style={{ fontSize: '13px' }} />
          </div>
          <div className="input-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12px' }}>Motivo</label>
            <select className="input" value={blockReason} onChange={(e) => setBlockReason(e.target.value as BlockoutReason)} style={{ fontSize: '13px' }}>
              {(Object.entries(BLOCKOUT_REASON_LABELS) as [BlockoutReason, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          {!isFreelancer && (
            <div className="input-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '12px' }}>Observação (opcional)</label>
              <input className="input" value={blockNote} onChange={(e) => setBlockNote(e.target.value)} placeholder="Ex: consulta médica" style={{ fontSize: '13px' }} />
            </div>
          )}
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleAddBlockout} disabled={blockSaving || !blockFrom} style={{ marginBottom: '20px' }}>
          <Plus size={14} />
          {isFreelancer ? 'Bloquear período' : 'Solicitar ausência'}
        </button>

        {/* Lista de blockouts */}
        {blockouts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {blockouts.map((b) => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', gap: '10px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: '13.5px' }}>
                    {b.dateFrom === b.dateTo
                      ? format(parseISO(b.dateFrom), "dd/MM/yyyy", { locale: ptBR })
                      : `${format(parseISO(b.dateFrom), "dd/MM/yyyy", { locale: ptBR })} → ${format(parseISO(b.dateTo), "dd/MM/yyyy", { locale: ptBR })}`}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {BLOCKOUT_REASON_LABELS[b.reason]}{b.note ? ` · ${b.note}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  {b.status === 'pendente' && (
                    <span className="badge badge-warning" style={{ fontSize: '10.5px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={10} /> Aguardando
                    </span>
                  )}
                  {b.status === 'aprovado' && <span className="badge badge-success" style={{ fontSize: '10.5px' }}>Aprovado</span>}
                  {b.status === 'recusado' && <span className="badge badge-error" style={{ fontSize: '10.5px' }}>Recusado</span>}
                  {(b.status === 'pendente' || b.status === 'aprovado') && (
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => b.id && handleDeleteBlockout(b.id)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
