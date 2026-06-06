'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { AlertCircle, Eye, EyeOff, LogIn, Shield, Users } from 'lucide-react';

type LoginMode = 'gestor' | 'freelancer';

export default function LoginPage() {
  const [mode, setMode] = useState<LoginMode>('gestor');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signInRemateWeb } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'gestor') {
        // Gestor: login via RemateWeb panel API
        const { authenticate } = await import('@/services/remateweb-api');
        const result = await authenticate(email, password);
        // Auth succeeded — set profile in context with real name
        signInRemateWeb(email, result.name);
        // Also try Firebase sign in (optional, won't block)
        try { await signIn(email, password); } catch {}
      } else {
        // Freelancer: login via Firebase only
        await signIn(email, password);
      }
      router.push('/dashboard');
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      if (mode === 'gestor') {
        setError('Falha na autenticação do painel. Verifique usuário e senha.');
      } else {
        if (firebaseError.code === 'auth/user-not-found' || firebaseError.code === 'auth/wrong-password' || firebaseError.code === 'auth/invalid-credential') {
          setError('E-mail ou senha inválidos.');
        } else if (firebaseError.code === 'auth/too-many-requests') {
          setError('Muitas tentativas. Aguarde alguns minutos.');
        } else {
          setError('Erro ao fazer login. Tente novamente.');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-badge">G</div>
          <h1>GestãoOps</h1>
          <p>Sistema de Gestão de Operações — RemateWeb</p>
        </div>

        {/* Mode Selector */}
        <div style={{
          display: 'flex',
          gap: '0',
          marginBottom: '24px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-surface)',
          padding: '4px',
          border: '1px solid var(--border)',
        }}>
          <button
            type="button"
            onClick={() => { setMode('gestor'); setError(''); }}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 16px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
              background: mode === 'gestor' ? 'var(--primary)' : 'transparent',
              color: mode === 'gestor' ? 'white' : 'var(--text-muted)',
            }}
          >
            <Shield size={16} />
            Funcionário
          </button>
          <button
            type="button"
            onClick={() => { setMode('freelancer'); setError(''); }}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 16px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
              background: mode === 'freelancer' ? 'var(--primary)' : 'transparent',
              color: mode === 'freelancer' ? 'white' : 'var(--text-muted)',
            }}
          >
            <Users size={16} />
            Freelancer
          </button>
        </div>

        {/* Contextual info */}
        <div style={{
          padding: '10px 14px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-surface-elevated)',
          fontSize: '12px',
          color: 'var(--text-muted)',
          marginBottom: '20px',
          lineHeight: 1.5,
          borderLeft: `3px solid ${mode === 'gestor' ? 'var(--primary)' : 'var(--accent)'}`,
        }}>
          {mode === 'gestor' ? (
            <>Use as mesmas credenciais do <strong>Painel RemateWeb</strong> ({' '}
              <a href="https://painel.remateweb.com/#/login" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
                painel.remateweb.com
              </a>{' '}).</>
          ) : (
            <>Acesso para <strong>operadores freelancer</strong>. Credenciais fornecidas pelo gestor.</>
          )}
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div className="input-group">
            <label htmlFor="email">{mode === 'gestor' ? 'Usuário do painel' : 'E-mail'}</label>
            <input
              id="email"
              type={mode === 'freelancer' ? 'email' : 'text'}
              className="input"
              placeholder={mode === 'gestor' ? 'usuario@empresa.com.br' : 'seu@email.com'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">Senha</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                style={{ paddingRight: '44px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading}
            style={{ marginTop: '8px', width: '100%' }}
          >
            {loading ? (
              <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2px' }} />
            ) : (
              <>
                <LogIn size={18} />
                {mode === 'gestor' ? 'Entrar como Funcionário' : 'Entrar como Freelancer'}
              </>
            )}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '12px', color: 'var(--text-muted)' }}>
          © 2026 RemateWeb — Gestão de Operações
        </p>
      </div>
    </div>
  );
}
