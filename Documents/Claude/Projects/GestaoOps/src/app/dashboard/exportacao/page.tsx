'use client';

import { useEffect, useState } from 'react';
import { getEvents } from '@/services/events';
import { GestaoEvent } from '@/types/event';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { FileSpreadsheet, Download, Eye } from 'lucide-react';
import * as XLSX from 'xlsx';

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) return (val as { toDate: () => Date }).toDate();
  if (typeof val === 'string') return parseISO(val);
  return new Date();
}

export default function ExportacaoPage() {
  const [events, setEvents] = useState<(GestaoEvent & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date(); d.setDate(1);
    return format(d, 'yyyy-MM-dd');
  });
  const [periodEnd, setPeriodEnd] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return format(d, 'yyyy-MM-dd');
  });
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const evts = await getEvents();
        setEvents(evts);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filteredEvents = events.filter((e) => {
    const d = toDate(e.date);
    return d >= new Date(periodStart) && d <= new Date(periodEnd + 'T23:59:59') && e.status === 'finalizado';
  });

  const exportData = filteredEvents.map((evt) => {
    const startDate = evt.closing ? toDate(evt.closing.actualStartTime) : toDate(evt.date);
    const endDate = evt.closing ? toDate(evt.closing.actualEndTime) : toDate(evt.endDate);
    const services = evt.services || []; // exportação mostra só os 4 primeiros serviços (por enquanto)
    const realizador = (evt.assignments || []).find((a) => a.role === 'operador_principal')?.operatorName || '';

    return {
      'Código': evt.rematewebId || '',
      'Código Financeiro': evt.financialCode || '',
      'Nome do Leilão': evt.title,
      'Data Início': format(startDate, 'dd/MM/yyyy'),
      'Horário Início': format(startDate, 'HH:mm'),
      'Data Fim': format(endDate, 'dd/MM/yyyy'),
      'Horário Fim': format(endDate, 'HH:mm'),
      'Realizador': realizador,
      'Canal': evt.channelName || '',
      'Canal Secundário': '',
      'Cidade': evt.city || '',
      'Serviço 1': services[0]?.serviceName || '',
      'Serviço 2': services[1]?.serviceName || '',
      'Serviço 3': services[2]?.serviceName || '',
      'Serviço 4': services[3]?.serviceName || '',
      'Intermediário Comercial': evt.commercialIntermediary || '',
      'Contrato': evt.contractInfo || '',
      'Empresa': evt.company || '',
      'Observação': evt.observation || '',
    };
  });

  const handleExport = () => {
    if (exportData.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Realizados');

    // Auto-width columns
    const colWidths = Object.keys(exportData[0]).map((key) => ({
      wch: Math.max(key.length, ...exportData.map((r) => String(r[key as keyof typeof r]).length)) + 2,
    }));
    ws['!cols'] = colWidths;

    XLSX.writeFile(wb, `Realizados_${periodStart}_${periodEnd}.xlsx`);
  };

  if (loading) return <div className="skeleton" style={{ height: '400px' }} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Exportação</h1>
          <p>Exporte a planilha de Realizados</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Selecione o Período</h3>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="input-group">
            <label>Data Início</label>
            <input className="input" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Data Fim</label>
            <input className="input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '6px' }}>
            <button className="btn btn-ghost" onClick={() => setShowPreview(!showPreview)}>
              <Eye size={16} /> {showPreview ? 'Ocultar Preview' : 'Preview'}
            </button>
            <button className="btn btn-primary" onClick={handleExport} disabled={exportData.length === 0}>
              <Download size={16} /> Exportar XLS ({exportData.length} evento{exportData.length !== 1 ? 's' : ''})
            </button>
          </div>
        </div>

        {exportData.length === 0 && (
          <div className="empty-state" style={{ padding: '30px', marginTop: '16px' }}>
            <FileSpreadsheet size={40} style={{ opacity: 0.3, marginBottom: '8px' }} />
            <h3>Nenhum evento finalizado</h3>
            <p>Somente eventos com fechamento são exportados.</p>
          </div>
        )}
      </div>

      {/* Preview */}
      {showPreview && exportData.length > 0 && (
        <div className="card animate-in">
          <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Preview da Planilha</h3>
          <div className="table-container" style={{ maxHeight: '500px', overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '12px' }}>
              <thead>
                <tr>
                  {Object.keys(exportData[0]).map((key) => (
                    <th key={key} style={{ whiteSpace: 'nowrap' }}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exportData.map((row, i) => (
                  <tr key={i}>
                    {Object.values(row).map((val, j) => (
                      <td key={j} style={{ whiteSpace: 'nowrap' }}>{String(val)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
