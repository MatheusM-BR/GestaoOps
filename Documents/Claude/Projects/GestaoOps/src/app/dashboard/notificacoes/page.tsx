'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCatalogs } from '@/lib/useCatalogs';
import { getEvents } from '@/services/events';
import { getNotifications, createNotification, deleteNotification } from '@/services/notifications';
import { NotificationRecord } from '@/types/notification';
import { GestaoEvent } from '@/types/event';
import { useAuth } from '@/lib/auth-context';
import { Bell, Send, Trash2, Users, Tag, X, Check } from 'lucide-react';

export default function NotificacoesPage() {
  const { profile } = useAuth();
  const { catalogs, loading: catalogsLoading } = useCatalogs();

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sendToOthers, setSendToOthers] = useState(false);
  const [auctionEventId, setAuctionEventId] = useState(''); // id do GestaoEvent
  const [selectedBreeds, setSelectedBreeds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);

  const [events, setEvents] = useState<(GestaoEvent & { id: string })[]>([]);
  const [history, setHistory] = useState<(NotificationRecord & { id: string })[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const showToast = (msg: string, type = 'success') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = async () => {
    setLoadingHistory(true);
    try {
      const [evs, hist] = await Promise.all([getEvents(), getNotifications()]);
      setEvents(evs);
      setHistory(hist);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [evs, hist] = await Promise.all([getEvents(), getNotifications()]);
        if (!active) return;
        setEvents(evs);
        setHistory(hist);
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setLoadingHistory(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // Leilões vinculáveis: eventos já importados da RemateWeb (têm rematewebId).
  const linkableAuctions = useMemo(
    () => events.filter((e) => e.rematewebId != null),
    [events],
  );

  // Raças agrupadas por tipo (Bovinos, Equinos, Máquinas...), igual ao painel.
  const breedGroups = useMemo(() => {
    const byType = new Map<number, { typeName: string; breeds: { id: number; name: string }[] }>();
    for (const bt of catalogs.breedTypes) {
      byType.set(bt.id, { typeName: bt.name, breeds: [] });
    }
    for (const b of catalogs.breeds) {
      if (!b.visible) continue;
      const grp = byType.get(b.breedTypeId);
      if (grp) grp.breeds.push({ id: b.id, name: b.name });
      else byType.set(b.breedTypeId, { typeName: b.breedTypeName || 'Outros', breeds: [{ id: b.id, name: b.name }] });
    }
    return Array.from(byType.values()).filter((g) => g.breeds.length > 0);
  }, [catalogs.breeds, catalogs.breedTypes]);

  const toggleBreed = (id: number) => {
    setSelectedBreeds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleGroup = (breeds: { id: number }[], on: boolean) => {
    setSelectedBreeds((prev) => {
      const next = new Set(prev);
      for (const b of breeds) { if (on) next.add(b.id); else next.delete(b.id); }
      return next;
    });
  };

  const resetForm = () => {
    setTitle('');
    setMessage('');
    setSendToOthers(false);
    setAuctionEventId('');
    setSelectedBreeds(new Set());
  };

  const handleSave = async () => {
    if (!title.trim() || !message.trim()) {
      showToast('Preencha título e mensagem.', 'error');
      return;
    }
    setSaving(true);
    try {
      const breedIds = Array.from(selectedBreeds);
      const breedNames = catalogs.breeds.filter((b) => selectedBreeds.has(b.id)).map((b) => b.name);
      const linkedEvent = linkableAuctions.find((e) => e.id === auctionEventId);

      await createNotification({
        title: title.trim(),
        message: message.trim(),
        breeds: breedIds,
        breedNames,
        sendToOthers,
        auctionId: linkedEvent?.rematewebId ?? null,
        auctionTitle: linkedEvent?.title ?? '',
        eventId: linkedEvent?.id ?? null,
        status: 'rascunho',
        createdBy: profile?.name || profile?.email || 'sistema',
      });

      showToast('Notificação salva como rascunho.');
      resetForm();
      await loadData();
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar notificação.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta notificação?')) return;
    try {
      await deleteNotification(id);
      setHistory((prev) => prev.filter((n) => n.id !== id));
      showToast('Notificação excluída.');
    } catch (err) {
      console.error(err);
      showToast('Erro ao excluir.', 'error');
    }
  };

  const totalSelected = selectedBreeds.size;

  return (
    <div className="animate-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <Bell size={24} style={{ color: 'var(--primary)' }} />
        <div>
          <h1 style={{ margin: 0 }}>Notificações</h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>
            Push segmentado por raça de interesse — formato RemateWeb
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '20px' }}>
        {/* Formulário */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Nova Notificação</h3>

          <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="input-group">
              <label>Título *</label>
              <input className="input" placeholder="Título da notificação" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="input-group">
              <label>Leilão (opcional)</label>
              <select className="input" value={auctionEventId} onChange={(e) => setAuctionEventId(e.target.value)}>
                <option value="">Nenhum (sistema)</option>
                {linkableAuctions.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </div>
          </div>

          <div className="input-group">
            <label>Mensagem *</label>
            <textarea className="input" rows={2} placeholder="Mensagem, seja breve" value={message} onChange={(e) => setMessage(e.target.value)} style={{ resize: 'vertical' }} />
          </div>

          {auctionEventId && (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '-6px' }}>
              Vinculada a um leilão → categoria <strong>AuctionReminder</strong>.
            </p>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}>
            <input type="checkbox" checked={sendToOthers} onChange={(e) => setSendToOthers(e.target.checked)} />
            <Users size={15} /> Enviar para anônimos (todos os usuários)
          </label>

          {/* Raças de Interesse */}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: '16px', paddingTop: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <Tag size={15} style={{ color: 'var(--primary)' }} />
              <strong>Raças de Interesse</strong>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {catalogsLoading ? '· carregando…' : totalSelected > 0 ? `· ${totalSelected} selecionada(s)` : '· vazio = enviar para todas'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
              {breedGroups.map((grp) => {
                const allOn = grp.breeds.every((b) => selectedBreeds.has(b.id));
                return (
                  <div key={grp.typeName} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '13px' }}>{grp.typeName}</strong>
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={() => toggleGroup(grp.breeds, !allOn)}>
                        {allOn ? 'Limpar' : 'Sel. Todas'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }}>
                      {grp.breeds.map((b) => (
                        <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={selectedBreeds.has(b.id)} onChange={() => toggleBreed(b.id)} />
                          {b.name}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> : <><Send size={16} /> Salvar rascunho</>}
            </button>
            <button className="btn btn-ghost" onClick={resetForm} disabled={saving}>Limpar</button>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px' }}>
            O envio real para a API RemateWeb será habilitado numa próxima fase. Por ora a notificação fica salva como rascunho.
          </p>
        </div>

        {/* Histórico */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Histórico</h3>
          {loadingHistory ? (
            <div className="spinner" />
          ) : history.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>Nenhuma notificação criada ainda.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {history.map((n) => (
                <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{n.title}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {n.auctionTitle && <span><Tag size={11} style={{ verticalAlign: 'middle' }} /> {n.auctionTitle}</span>}
                      <span>{n.sendToOthers ? 'Todos os usuários' : n.breeds.length > 0 ? `${n.breeds.length} raça(s)` : 'Sem segmentação'}</span>
                    </div>
                  </div>
                  <span className={`badge ${n.status === 'enviada' ? 'badge-success' : n.status === 'erro' ? 'badge-error' : 'badge-warning'}`}>
                    {n.status === 'enviada' ? <><Check size={11} /> Enviada</> : n.status === 'erro' ? <><X size={11} /> Erro</> : 'Rascunho'}
                  </span>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => n.id && handleDelete(n.id)} title="Excluir">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className={`toast toast-${toast.type}`} style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 1000 }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
