'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

const API_BASE = 'http://localhost:5000';

interface VideoInfo {
  id: string;
  title: string;
  uploader: string;
  duration: number;
  duration_string: string;
  thumbnail: string;
  is_live: boolean;
  availability: string;
  heights: number[];
}

interface ProgressData {
  status: string;
  progress: number;
  speed: number | null;
  eta: number | null;
  title: string | null;
  filename: string | null;
  filepath: string | null;
  filesize: number | null;
  error: string | null;
  log: string;
  log_lines: string[];
  warning: string | null;
}

function fmtBytes(n: number | null) {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
}

function fmtEta(s: number | null) {
  if (s == null) return '';
  s = Math.round(s);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')} restante`;
}

function fmtDuration(s: number | null) {
  if (s == null) return '—';
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'Na fila…',
  starting: 'Iniciando…',
  extracting: 'Lendo informações do vídeo…',
  downloading: 'Baixando…',
  processing: 'Processando (convertendo/cortando)…',
  done: 'Concluído!',
  error: 'Erro',
};

function generateInstallerBat(): string {
  const serverUrl = typeof window !== 'undefined' ? `${window.location.origin}/yt-server.ps1` : '';
  return `@echo off
chcp 65001 >nul 2>&1
title YT Downloader - Instalacao Automatica
color 0A
echo.
echo  ============================================================
echo    YT Downloader Backend - Zero Dependencias
echo    Nao precisa ter NADA instalado! Tudo e automatico.
echo  ============================================================
echo.

set "WORKDIR=%USERPROFILE%\\.yt-downloader-backend"
set "YTDLP=%WORKDIR%\\yt-dlp.exe"
set "SERVER=%WORKDIR%\\yt-server.ps1"
set "FFDIR=%WORKDIR%\\ffmpeg"

if not exist "%WORKDIR%" mkdir "%WORKDIR%"

REM ================================================================
REM  PASSO 1: yt-dlp.exe (executavel standalone, sem Python)
REM ================================================================
if exist "%YTDLP%" (
    echo  [OK] yt-dlp.exe ja presente.
    goto :FFMPEG
)

echo  [1/3] Baixando yt-dlp.exe (~12MB, so na 1a vez)...
curl -sL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -o "%YTDLP%" 2>nul
if not exist "%YTDLP%" (
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile '%YTDLP%'" 2>nul
)
if not exist "%YTDLP%" (
    echo  [ERRO] Falha ao baixar yt-dlp. Verifique sua conexao.
    pause
    exit /b 1
)
echo  [OK] yt-dlp.exe baixado.

:FFMPEG
REM ================================================================
REM  PASSO 2: ffmpeg (necessario para merge/mp3/corte)
REM ================================================================
where ffmpeg >nul 2>&1
if not errorlevel 1 (
    echo  [OK] ffmpeg ja instalado no sistema.
    goto :SERVER
)
if exist "%FFDIR%\\ffmpeg.exe" (
    echo  [OK] ffmpeg ja presente.
    goto :SERVER
)

echo  [2/3] Instalando ffmpeg...
REM Tenta via WinGet (mais rapido, sem download grande)
where winget >nul 2>&1
if not errorlevel 1 (
    echo         Tentando via WinGet...
    winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements --silent 2>nul
    where ffmpeg >nul 2>&1
    if not errorlevel 1 (
        echo  [OK] ffmpeg instalado via WinGet.
        goto :SERVER
    )
)

REM Fallback: download direto (~80MB)
echo         Baixando ffmpeg (~80MB, so na 1a vez)...
set "FF_ZIP=%WORKDIR%\\ffmpeg.zip"
curl -sL "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -o "%FF_ZIP%" 2>nul
if not exist "%FF_ZIP%" (
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile '%FF_ZIP%'" 2>nul
)
if exist "%FF_ZIP%" (
    echo         Extraindo ffmpeg...
    if not exist "%FFDIR%" mkdir "%FFDIR%"
    powershell -Command "Expand-Archive '%FF_ZIP%' '%WORKDIR%\\ff-tmp' -Force; $d=(Get-ChildItem '%WORKDIR%\\ff-tmp' -Directory)[0]; Copy-Item (Join-Path $d.FullName 'bin\\*') '%FFDIR%\\' -Force; Remove-Item '%WORKDIR%\\ff-tmp' -Recurse -Force"
    del "%FF_ZIP%" 2>nul
    if exist "%FFDIR%\\ffmpeg.exe" (
        echo  [OK] ffmpeg extraido.
    ) else (
        echo  [AVISO] ffmpeg nao disponivel. MP3 e corte nao funcionarao.
    )
) else (
    echo  [AVISO] Nao baixou ffmpeg. MP3 e corte nao funcionarao.
)

:SERVER
REM ================================================================
REM  PASSO 3: Baixar/atualizar o servidor PowerShell
REM ================================================================
echo.
echo  [3/3] Baixando servidor...
curl -sL "${serverUrl}" -o "%SERVER%" 2>nul
if not exist "%SERVER%" (
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest '${serverUrl}' -OutFile '%SERVER%'" 2>nul
)
if not exist "%SERVER%" (
    echo  [ERRO] Nao foi possivel baixar o servidor.
    pause
    exit /b 1
)

REM ================================================================
REM  INICIAR
REM ================================================================
echo.
echo  ============================================================
echo    Tudo pronto! Iniciando servidor...
echo    Volte ao GestRW - conecta automaticamente.
echo    Para encerrar: feche esta janela ou Ctrl+C.
echo  ============================================================
echo.
color 0B
powershell -ExecutionPolicy Bypass -File "%SERVER%"
pause
`;
}

function downloadBat() {
  const content = generateInstallerBat();
  const blob = new Blob([content], { type: 'application/bat' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'instalar-yt-downloader.bat';
  a.click();
  URL.revokeObjectURL(url);
}

export default function DownloaderPage() {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<'mp4' | 'mp3'>('mp4');
  const [quality, setQuality] = useState('best');
  const [audioQuality, setAudioQuality] = useState('192');
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [destPath, setDestPath] = useState('');

  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const [connected, setConnected] = useState<boolean | null>(null);
  const [backendInfo, setBackendInfo] = useState<string>('');

  const consoleRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shownLinesRef = useRef(0);
  const reconnectRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/`, { signal: AbortSignal.timeout(3000) });
      const d = await res.json();
      setConnected(true);
      setBackendInfo(d.ytdlp ? `yt-dlp ${d.ytdlp} · ffmpeg: ${d.ffmpeg ? 'OK' : 'ausente'}` : '');
      return true;
    } catch {
      setConnected(false);
      return false;
    }
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Auto-reconnect every 3s when not connected
  useEffect(() => {
    if (connected === false) {
      reconnectRef.current = setInterval(() => {
        checkConnection().then((ok) => {
          if (ok && reconnectRef.current) {
            clearInterval(reconnectRef.current);
            reconnectRef.current = null;
          }
        });
      }, 3000);
      return () => {
        if (reconnectRef.current) clearInterval(reconnectRef.current);
      };
    }
  }, [connected, checkConnection]);

  const fetchInfo = useCallback(async () => {
    if (!url.trim()) { setFetchError('Informe a URL do vídeo.'); return; }
    setFetchError('');
    setFetching(true);
    try {
      const res = await fetch(`${API_BASE}/api/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setFetchError(data.error || 'Erro ao buscar vídeo.'); setVideoInfo(null); return; }
      setVideoInfo(data);
    } catch {
      setFetchError('Erro de conexão. Verifique se o backend está rodando.');
    } finally {
      setFetching(false);
    }
  }, [url]);

  const startDownload = useCallback(async () => {
    if (!url.trim()) { setFetchError('Informe a URL do vídeo.'); return; }
    setFetchError('');
    setDownloading(true);
    setProgress(null);
    shownLinesRef.current = 0;
    if (consoleRef.current) consoleRef.current.innerHTML = '';

    const payload: Record<string, unknown> = {
      url: url.trim(), format, quality, audio_quality: audioQuality, dest_path: destPath,
    };
    if (trimEnabled) { payload.start_time = startTime; payload.end_time = endTime; }

    try {
      const res = await fetch(`${API_BASE}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setProgress({ status: 'error', progress: 0, speed: null, eta: null, title: null, filename: null, filepath: null, filesize: null, error: data.error, log: '', log_lines: [], warning: null });
        setDownloading(false);
        return;
      }
      setJobId(data.job_id);
      pollProgress(data.job_id);
    } catch {
      setProgress({ status: 'error', progress: 0, speed: null, eta: null, title: null, filename: null, filepath: null, filesize: null, error: 'Erro de conexão com o servidor local.', log: '', log_lines: [], warning: null });
      setDownloading(false);
    }
  }, [url, format, quality, audioQuality, destPath, trimEnabled, startTime, endTime]);

  const pollProgress = useCallback((jid: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/progress/${jid}`);
        const d: ProgressData = await res.json();
        setProgress(d);
        updateConsole(d.log_lines);
        if (d.status === 'done' || d.status === 'error') {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setDownloading(false);
          if (d.status === 'done') {
            window.open(`${API_BASE}/api/file/${jid}`, '_blank');
          }
        }
      } catch { /* retry */ }
    }, 700);
  }, []);

  const updateConsole = useCallback((lines: string[]) => {
    if (!consoleRef.current || !lines?.length) return;
    const shown = shownLinesRef.current;
    if (lines.length <= shown) return;
    const frag = document.createDocumentFragment();
    lines.slice(shown).forEach((line) => {
      const div = document.createElement('div');
      div.textContent = line;
      if (line.startsWith('✓') || line.startsWith('Salvo')) div.style.color = '#3fb950';
      else if (/\[download\].*\d+\.\d+%/.test(line)) div.style.color = '#56d364';
      else if (line.includes('[aviso]')) div.style.color = '#e3b341';
      else if (line.includes('[ffmpeg]') || line.includes('[Merger]')) div.style.color = '#d2a8ff';
      else if (line.includes('[info]')) div.style.color = '#79c0ff';
      frag.appendChild(div);
    });
    consoleRef.current.appendChild(frag);
    shownLinesRef.current = lines.length;
    const el = consoleRef.current;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) el.scrollTop = el.scrollHeight;
  }, []);

  const openFolder = useCallback(() => {
    if (jobId) fetch(`${API_BASE}/api/open-folder/${jobId}`);
  }, [jobId]);

  const isIndeterminate = progress && ['extracting', 'starting', 'queued'].includes(progress.status) && progress.progress === 0;

  // --- Not connected: show installer ---
  if (connected === false) {
    return (
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <div className="card" style={{ textAlign: 'center', padding: '40px 30px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⬇</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>YT Downloader Backend</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
            Para baixar vídeos, um servidor local roda no seu computador.<br />
            <strong>Não precisa instalar nada</strong> — o instalador faz tudo sozinho.
          </p>

          <button
            className="btn btn-primary"
            style={{ padding: '14px 32px', fontSize: 16, fontWeight: 600, marginBottom: 20 }}
            onClick={downloadBat}
          >
            Baixar Instalador (.bat)
          </button>

          <div style={{ background: 'var(--bg-hover)', borderRadius: 12, padding: 20, textAlign: 'left', marginTop: 8 }}>
            <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 14 }}>2 passos:</p>
            <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 13, lineHeight: 2.2 }}>
              <li>Clique em <strong>"Baixar Instalador"</strong> e execute o arquivo baixado</li>
              <li>Aguarde — ele baixa tudo automaticamente e inicia o servidor</li>
            </ol>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              Na primeira vez demora ~1-2 min (baixa yt-dlp + ffmpeg).<br/>
              Nas próximas, inicia em segundos. Não precisa de Python nem nada.
            </p>
          </div>

          <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: '#ef4444',
              animation: 'pulse 2s ease-in-out infinite',
            }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Aguardando conexão… (esta página conecta automaticamente)
            </span>
          </div>

          <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>
              Tudo é instalado em <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>%USERPROFILE%\.yt-downloader-backend</code> — para desinstalar, basta apagar esta pasta.
            </p>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
              <span>YT Downloader v2.0.0</span>
              <span>GestRW · {new Date().getFullYear()}</span>
            </div>
          </div>
        </div>

        <style jsx>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
        `}</style>
      </div>
    );
  }

  // --- Loading state ---
  if (connected === null) {
    return (
      <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center', padding: 60 }}>
        <div className="spinner" />
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 12 }}>Verificando backend…</p>
      </div>
    );
  }

  // --- Connected: show downloader ---
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Connection status */}
      <div className="card" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', marginBottom: 16, padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80' }} />
          <span style={{ color: '#4ade80', fontSize: 13 }}>Backend conectado</span>
        </div>
        {backendInfo && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{backendInfo}</span>}
      </div>

      {/* URL */}
      <div className="card">
        <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>URL do vídeo</label>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            type="text"
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchInfo()}
          />
          <button className="btn btn-secondary" onClick={fetchInfo} disabled={fetching}>
            {fetching ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
        {fetchError && <p style={{ color: '#f87171', fontSize: 13, marginTop: 8 }}>{fetchError}</p>}
      </div>

      {/* Preview */}
      {videoInfo && (
        <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {videoInfo.thumbnail && (
            <img
              src={videoInfo.thumbnail}
              alt="thumb"
              style={{ width: 168, height: 94, objectFit: 'cover', borderRadius: 10, background: '#000', flexShrink: 0 }}
            />
          )}
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{videoInfo.title}</h3>
            <p style={{ margin: '2px 0', color: 'var(--text-muted)', fontSize: 13 }}>{videoInfo.uploader}</p>
            <p style={{ margin: '2px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Duração: {videoInfo.duration_string || fmtDuration(videoInfo.duration)}
              {' · '}
              <span className="badge" style={{ fontSize: 11 }}>{videoInfo.availability || (videoInfo.is_live ? 'ao vivo' : 'público')}</span>
            </p>
          </div>
        </div>
      )}

      {/* Format */}
      <div className="card">
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10, marginTop: 0 }}>Formato</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className={`btn ${format === 'mp4' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setFormat('mp4')}>
            MP4 (vídeo)
          </button>
          <button className={`btn ${format === 'mp3' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setFormat('mp3')}>
            MP3 (áudio)
          </button>
        </div>
        {format === 'mp4' && (
          <div>
            <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Qualidade</label>
            <select className="input" value={quality} onChange={(e) => setQuality(e.target.value)} style={{ maxWidth: 250 }}>
              <option value="best">Melhor disponível</option>
              {videoInfo?.heights?.map((h) => (
                <option key={h} value={`${h}p`}>{h}p</option>
              )) || (
                <>
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                  <option value="480p">480p</option>
                  <option value="360p">360p</option>
                </>
              )}
            </select>
          </div>
        )}
        {format === 'mp3' && (
          <div>
            <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Qualidade do MP3</label>
            <select className="input" value={audioQuality} onChange={(e) => setAudioQuality(e.target.value)} style={{ maxWidth: 250 }}>
              <option value="320">320 kbps (alta)</option>
              <option value="192">192 kbps (padrão)</option>
              <option value="128">128 kbps (leve)</option>
            </select>
          </div>
        )}
      </div>

      {/* Destination */}
      <div className="card">
        <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Pasta de destino</label>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            type="text"
            placeholder="Padrão: Desktop do usuário"
            value={destPath}
            onChange={(e) => setDestPath(e.target.value)}
          />
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>Onde o arquivo será salvo. Deixe vazio para salvar no Desktop.</p>
      </div>

      {/* Trim */}
      <div className="card">
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
          <input type="checkbox" checked={trimEnabled} onChange={(e) => setTrimEnabled(e.target.checked)} style={{ width: 17, height: 17 }} />
          Baixar apenas um trecho
        </label>
        {trimEnabled && (
          <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Início</label>
              <input className="input" placeholder="00:00:30" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Fim</label>
              <input className="input" placeholder="00:01:45" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {/* Download button */}
      <button
        className="btn btn-primary"
        style={{ width: '100%', padding: 15, fontSize: 16, fontWeight: 600, marginBottom: 16 }}
        onClick={startDownload}
        disabled={downloading}
      >
        {downloading ? 'Baixando…' : 'Baixar'}
      </button>

      {/* Progress */}
      {progress && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
            <span>{STATUS_LABELS[progress.status] || progress.status}</span>
            <span>{isIndeterminate ? '' : `${Math.round(progress.progress)}%`}</span>
          </div>
          <div style={{ height: 12, background: 'var(--bg-hover)', borderRadius: 999, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div style={{
              height: '100%',
              width: isIndeterminate ? '100%' : `${progress.progress}%`,
              background: 'linear-gradient(90deg, var(--primary), var(--accent))',
              transition: isIndeterminate ? 'none' : 'width 0.3s ease',
              ...(isIndeterminate ? {
                backgroundImage: 'repeating-linear-gradient(-45deg, var(--primary) 0 12px, var(--accent) 12px 24px)',
                backgroundSize: '48px 48px',
                animation: 'barStripes 1s linear infinite',
              } : {}),
            }} />
          </div>
          {progress.status === 'downloading' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
              <span>{progress.speed ? `${fmtBytes(progress.speed)}/s` : ''}</span>
              <span>{fmtEta(progress.eta)}</span>
            </div>
          )}
          <div ref={consoleRef} style={{
            background: '#0d1117', border: '1px solid var(--border)', borderRadius: 8,
            padding: '10px 14px', marginTop: 12, height: 200, overflowY: 'auto',
            fontFamily: 'Consolas, "Courier New", monospace', fontSize: 12, lineHeight: 1.6, color: '#8b949e',
          }} />
          {progress.warning && <p style={{ color: '#e3b341', fontSize: 13, marginTop: 8 }}>{progress.warning}</p>}
          {progress.status === 'error' && progress.error && <p style={{ color: '#f87171', fontSize: 13, marginTop: 8 }}>{progress.error}</p>}
          {progress.status === 'done' && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <a href={jobId ? `${API_BASE}/api/file/${jobId}` : '#'} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
                  Salvar via browser
                </a>
                <button className="btn btn-secondary" onClick={openFolder}>Abrir pasta</button>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0' }}>
                {progress.filename}{progress.filesize ? ` · ${fmtBytes(progress.filesize)}` : ''}
              </p>
              {progress.filepath && (
                <p style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'Consolas, monospace', wordBreak: 'break-all', margin: '4px 0' }}>
                  {progress.filepath}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Version & Changelog */}
      <div style={{ marginTop: 32, borderTop: '1px solid var(--border)', paddingTop: 16, color: 'var(--text-muted)', fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span style={{ fontWeight: 600 }}>YT Downloader v2.0.0</span>
          <span>GestRW · {new Date().getFullYear()}</span>
        </div>
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>Changelog</summary>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 2, fontSize: 11, color: 'var(--text-muted)' }}>
            <li><strong>v2.0.0</strong> — Zero dependências: backend reescrito em PowerShell + yt-dlp.exe standalone (sem Python)</li>
            <li><strong>v1.2.0</strong> — Correção de PATH para ffmpeg/Deno em Python portátil</li>
            <li><strong>v1.1.0</strong> — Instalador com Python portátil (embeddable), sem necessidade de instalação manual</li>
            <li><strong>v1.0.0</strong> — Versão inicial integrada ao GestRW com Flask + yt-dlp</li>
          </ul>
        </details>
      </div>

      <style jsx>{`
        @keyframes barStripes {
          from { background-position: 0 0; }
          to { background-position: 48px 0; }
        }
      `}</style>
    </div>
  );
}
