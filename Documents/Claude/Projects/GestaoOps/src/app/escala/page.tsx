'use client';

import { useEffect, useState, useCallback } from 'react';
import { signInAnonymously } from 'firebase/auth';
import { collection, query, where, orderBy, getDocs, Timestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

interface Assignment {
  operatorName: string | null;
  role: string | null;
  status: string;
  isHalfShift: boolean;
  halfShiftType: string | null;
  shiftTime: string | null;
}

interface Service {
  serviceName: string;
  serviceOrder: number;
}

interface EscalaEvent {
  id: string;
  title: string;
  date: string;
  endDate: string;
  operationType: string | null;
  studioName: string | null;
  channelName: string;
  city: string;
  state: string;
  place: string;
  organizationName: string;
  status: string;
  services: Service[];
  assignments: Assignment[];
}

function toISO(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'object' && v !== null && 'toDate' in v) {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function formatTime(iso: string): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

const OP_LABELS: Record<string, string> = {
  estudio: 'Estúdio',
  externo: 'Externo',
  retransmissao: 'Retransmissão',
};

const STATUS_COLORS: Record<string, string> = {
  pendente: '#f59e0b',
  escalado: '#22c55e',
  em_andamento: '#3b82f6',
  finalizado: '#6b7280',
};

export default function EscalaPublicPage() {
  const [events, setEvents] = useState<EscalaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [jsonMode, setJsonMode] = useState(false);

  const loadEvents = useCallback(async (dateStr: string) => {
    setLoading(true);
    setError('');
    try {
      // Auth anônimo
      if (!auth.currentUser) {
        await signInAnonymously(auth);
      }

      const start = new Date(dateStr + 'T00:00:00');
      const end = new Date(dateStr + 'T23:59:59.999');

      const q = query(
        collection(db, 'events'),
        where('date', '>=', Timestamp.fromDate(start)),
        where('date', '<=', Timestamp.fromDate(end)),
        orderBy('date', 'asc'),
      );

      const snap = await getDocs(q);
      const list: EscalaEvent[] = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          title: d.title || '',
          date: toISO(d.date),
          endDate: toISO(d.endDate),
          operationType: d.operationType || null,
          studioName: d.studioName || null,
          channelName: d.channelName || '',
          city: d.city || '',
          state: d.state || '',
          place: d.place || '',
          organizationName: d.organizationName || '',
          status: d.status || 'pendente',
          services: (d.services || []).map((s: Record<string, unknown>) => ({
            serviceName: s.serviceName as string,
            serviceOrder: s.serviceOrder as number,
          })),
          assignments: (d.assignments || []).map((a: Record<string, unknown>) => ({
            operatorName: (a.operatorName as string) || null,
            role: (a.role as string) || null,
            status: (a.status as string) || 'pendente',
            isHalfShift: !!a.isHalfShift,
            halfShiftType: (a.halfShiftType as string) || null,
            shiftTime: (a.shiftTime as string) || null,
          })),
        };
      });

      setEvents(list);
    } catch (err) {
      console.error(err);
      setError('Erro ao carregar escala.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check for ?format=json
    const params = new URLSearchParams(window.location.search);
    if (params.get('format') === 'json') {
      setJsonMode(true);
    }
    const dateParam = params.get('date');
    if (dateParam) setSelectedDate(dateParam);

    loadEvents(dateParam || selectedDate);
  }, []);

  useEffect(() => {
    if (!loading) loadEvents(selectedDate);
  }, [selectedDate]);

  // JSON mode: render raw JSON
  if (jsonMode && !loading) {
    const operatorSet = new Set<string>();
    events.forEach((e) => e.assignments.forEach((a) => { if (a.operatorName) operatorSet.add(a.operatorName); }));

    const json = {
      count: events.length,
      date: selectedDate,
      totalOperators: operatorSet.size,
      events: events.map((e) => ({
        ...e,
        // Remove fields not useful in API
      })),
    };

    return (
      <pre style={{ background: '#0d1117', color: '#e6edf3', padding: 20, margin: 0, minHeight: '100vh', fontSize: 13, fontFamily: 'Consolas, monospace', whiteSpace: 'pre-wrap' }}>
        {JSON.stringify(json, null, 2)}
      </pre>
    );
  }

  // Group by role
  const transmissao = events.flatMap((e) =>
    e.assignments
      .filter((a) => a.role && !['Operador de Painel'].includes(a.role))
      .map((a) => ({ ...a, event: e }))
  );
  const painel = events.flatMap((e) =>
    e.assignments
      .filter((a) => a.role === 'Operador de Painel')
      .map((a) => ({ ...a, event: e }))
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f1115', color: '#e7eaf0', fontFamily: '"Segoe UI", system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#181b22', borderBottom: '1px solid #2a2f3a', padding: '16px 24px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src="/logo-remateweb.svg" alt="RemateWeb" style={{ width: 40, height: 40 }} />
            <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
              <span style={{ color: '#2980a4' }}>GestRW</span> — Escala
            </h1>
            <p style={{ margin: '4px 0 0', color: '#9aa3b2', fontSize: 13 }}>
              {formatDate(selectedDate + 'T12:00:00')}
            </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => {
                const d = new Date(selectedDate + 'T12:00:00');
                d.setDate(d.getDate() - 1);
                setSelectedDate(d.toISOString().split('T')[0]);
              }}
              style={{ background: '#1f232c', border: '1px solid #2a2f3a', color: '#e7eaf0', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 16 }}
            >
              ◀
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ background: '#1f232c', border: '1px solid #2a2f3a', color: '#e7eaf0', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}
            />
            <button
              onClick={() => {
                const d = new Date(selectedDate + 'T12:00:00');
                d.setDate(d.getDate() + 1);
                setSelectedDate(d.toISOString().split('T')[0]);
              }}
              style={{ background: '#1f232c', border: '1px solid #2a2f3a', color: '#e7eaf0', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 16 }}
            >
              ▶
            </button>
            <button
              onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
              style={{ background: '#1f232c', border: '1px solid #2a2f3a', color: '#9aa3b2', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}
            >
              Hoje
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 60, color: '#9aa3b2' }}>
            <div style={{ width: 32, height: 32, border: '3px solid #2a2f3a', borderTopColor: '#2980a4', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
            Carregando...
          </div>
        )}

        {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: 16, color: '#fca5a5', textAlign: 'center' }}>{error}</div>}

        {!loading && events.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: '#9aa3b2' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📅</div>
            <p style={{ fontSize: 16 }}>Nenhum evento nesta data.</p>
          </div>
        )}

        {/* Summary cards */}
        {!loading && events.length > 0 && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
              <div style={{ background: '#181b22', border: '1px solid #2a2f3a', borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{events.length}</div>
                <div style={{ color: '#9aa3b2', fontSize: 13 }}>Eventos</div>
              </div>
              <div style={{ background: '#181b22', border: '1px solid #2a2f3a', borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{new Set(events.flatMap((e) => e.assignments.map((a) => a.operatorName)).filter(Boolean)).size}</div>
                <div style={{ color: '#9aa3b2', fontSize: 13 }}>Operadores</div>
              </div>
              <div style={{ background: '#181b22', border: '1px solid #2a2f3a', borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#22c55e' }}>{events.filter((e) => e.status === 'escalado' || e.status === 'em_andamento').length}</div>
                <div style={{ color: '#9aa3b2', fontSize: 13 }}>Escalados</div>
              </div>
              <div style={{ background: '#181b22', border: '1px solid #2a2f3a', borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b' }}>{events.filter((e) => e.status === 'pendente').length}</div>
                <div style={{ color: '#9aa3b2', fontSize: 13 }}>Pendentes</div>
              </div>
            </div>

            {/* Events */}
            {events.map((evt) => (
              <div key={evt.id} style={{ background: '#181b22', border: '1px solid #2a2f3a', borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: '0 8px 30px rgba(0,0,0,0.35)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 17 }}>{evt.title}</h3>
                    <p style={{ margin: '4px 0 0', color: '#9aa3b2', fontSize: 13 }}>
                      {evt.channelName && <span>{evt.channelName} · </span>}
                      {evt.organizationName && <span>{evt.organizationName} · </span>}
                      {evt.city}{evt.state ? `/${evt.state}` : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: `${STATUS_COLORS[evt.status] || '#6b7280'}22`, color: STATUS_COLORS[evt.status] || '#6b7280', border: `1px solid ${STATUS_COLORS[evt.status] || '#6b7280'}55` }}>
                      {evt.status.replace('_', ' ')}
                    </span>
                    {evt.operationType && (
                      <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: '#1f232c', border: '1px solid #2a2f3a', color: '#9aa3b2' }}>
                        {OP_LABELS[evt.operationType] || evt.operationType}
                      </span>
                    )}
                    {evt.studioName && (
                      <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: '#1f232c', border: '1px solid #2a2f3a', color: '#9aa3b2' }}>
                        {evt.studioName}
                      </span>
                    )}
                  </div>
                </div>

                {/* Time */}
                <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: 14 }}>
                  <span><strong style={{ color: '#9aa3b2', fontSize: 12 }}>Início:</strong> {formatTime(evt.date)}</span>
                  <span><strong style={{ color: '#9aa3b2', fontSize: 12 }}>Fim:</strong> {formatTime(evt.endDate)}</span>
                </div>

                {/* Services */}
                {evt.services.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: '#9aa3b2', textTransform: 'uppercase', letterSpacing: 0.5 }}>Serviços:</span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      {evt.services.sort((a, b) => a.serviceOrder - b.serviceOrder).map((s, i) => (
                        <span key={i} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#1f232c', border: '1px solid #2a2f3a', color: '#e7eaf0' }}>
                          {s.serviceName}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Assignments */}
                {evt.assignments.length > 0 && (
                  <div>
                    <span style={{ fontSize: 12, color: '#9aa3b2', textTransform: 'uppercase', letterSpacing: 0.5 }}>Equipe escalada:</span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginTop: 8 }}>
                      {evt.assignments.map((a, i) => (
                        <div key={i} style={{ background: '#1f232c', border: '1px solid #2a2f3a', borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{a.operatorName || '—'}</div>
                            <div style={{ fontSize: 12, color: '#9aa3b2' }}>
                              {a.role || '—'}
                              {a.isHalfShift && <span style={{ color: '#f59e0b' }}> · {a.halfShiftType === 'primeiro' ? '1º turno' : '2º turno'}{a.shiftTime ? ` (${a.shiftTime})` : ''}</span>}
                            </div>
                          </div>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: a.status === 'confirmado' ? '#22c55e' : a.status === 'pendente' ? '#f59e0b' : '#ef4444' }} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {evt.assignments.length === 0 && (
                  <p style={{ color: '#9aa3b2', fontSize: 13, margin: '4px 0 0', fontStyle: 'italic' }}>Nenhum operador escalado.</p>
                )}
              </div>
            ))}
          </>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', color: '#9aa3b2', fontSize: 12, marginTop: 32, paddingBottom: 20 }}>
          <p>GestRW · Escala Pública</p>
          <p style={{ fontSize: 11 }}>
            Para integração: adicione <code style={{ background: '#1f232c', padding: '1px 6px', borderRadius: 4 }}>?format=json</code> na URL para obter dados em JSON.
            <br />
            Filtre por data: <code style={{ background: '#1f232c', padding: '1px 6px', borderRadius: 4 }}>?date=2026-06-20</code>
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
