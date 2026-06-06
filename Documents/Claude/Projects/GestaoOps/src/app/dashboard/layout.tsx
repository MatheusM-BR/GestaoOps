'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth, SystemRole, ROLE_LABELS, isOperatorRole } from '@/lib/auth-context';
import Link from 'next/link';
import {
  LayoutDashboard,
  Calendar,
  Users,
  DollarSign,
  FileSpreadsheet,
  Settings,
  LogOut,
  Menu,
  X,
  Gavel,
  UserCircle,
  ClipboardList,
  Shield,
  TrendingUp,
  Clipboard,
  CalendarDays,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: SystemRole[]; // undefined = all management roles
}

// Full nav for admin/CEO
const managementNav: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Eventos', href: '/dashboard/eventos', icon: Gavel },
  { label: 'Operadores', href: '/dashboard/operadores', icon: Users, roles: ['admin', 'ceo', 'administrativo', 'planejamento'] },
  { label: 'Escala', href: '/dashboard/escala', icon: Calendar },
  { label: 'Calendário', href: '/dashboard/calendario', icon: CalendarDays },
  { label: 'Financeiro', href: '/dashboard/financeiro', icon: DollarSign, roles: ['admin', 'ceo', 'financeiro', 'administrativo'] },
  { label: 'Exportação', href: '/dashboard/exportacao', icon: FileSpreadsheet, roles: ['admin', 'ceo', 'financeiro'] },
  { label: 'Configurações', href: '/dashboard/configuracoes', icon: Settings, roles: ['admin', 'ceo'] },
];

const operatorNav: NavItem[] = [
  { label: 'Meus Serviços', href: '/dashboard', icon: ClipboardList },
  { label: 'Minha Escala', href: '/dashboard/minha-escala', icon: Calendar },
  { label: 'Leilões da Empresa', href: '/dashboard/calendario', icon: CalendarDays },
  { label: 'Meus Pagamentos', href: '/dashboard/meus-pagamentos', icon: DollarSign },
  { label: 'Meu Perfil', href: '/dashboard/meu-perfil', icon: UserCircle },
];

// Nav do Operador de Painel: configura eventos (sem financeiro/planejamento/operadores/config).
const painelHiddenHrefs = ['/dashboard/operadores', '/dashboard/financeiro', '/dashboard/exportacao', '/dashboard/configuracoes'];

function getNavForRole(role: SystemRole | undefined, isManagement: boolean, hasAccess: (roles: SystemRole[]) => boolean): NavItem[] {
  if (!role) return operatorNav;
  if (role === 'operador_painel') {
    // Painel acessa eventos/escala/calendário (config), mas não financeiro/operadores/config.
    return managementNav.filter((item) => !painelHiddenHrefs.includes(item.href));
  }
  if (isOperatorRole(role)) {
    return operatorNav;
  }
  // Management roles - filter nav items by allowed roles
  return managementNav.filter((item) => {
    if (!item.roles) return true; // no restriction
    return hasAccess(item.roles);
  });
}

// Todos os papéis de gestão (usado nas guardas de rota de páginas "abertas a gestão")
const ALL_MANAGEMENT: SystemRole[] = ['admin', 'ceo', 'gestor', 'financeiro', 'comercial', 'administrativo', 'planejamento'];
// Acesso de configuração de eventos/escala (gestão + operador de painel).
const EVENT_ACCESS: SystemRole[] = [...ALL_MANAGEMENT, 'operador_painel'];

// Páginas de gestão e quais papéis podem acessá-las (por prefixo de rota).
// Rotas não listadas (/dashboard, /minha-escala, /meus-pagamentos, /meu-perfil, /calendario) são liberadas a todos.
const ROUTE_GUARDS: { prefix: string; roles: SystemRole[] }[] = [
  { prefix: '/dashboard/configuracoes', roles: ['admin', 'ceo'] },
  { prefix: '/dashboard/exportacao', roles: ['admin', 'ceo', 'financeiro'] },
  { prefix: '/dashboard/financeiro', roles: ['admin', 'ceo', 'financeiro', 'administrativo'] },
  { prefix: '/dashboard/operadores', roles: ['admin', 'ceo', 'administrativo', 'planejamento'] },
  { prefix: '/dashboard/eventos', roles: EVENT_ACCESS },
  { prefix: '/dashboard/leiloes', roles: EVENT_ACCESS },
  { prefix: '/dashboard/escala', roles: EVENT_ACCESS },
  // /dashboard/calendario: aberto a todos (todos veem os leilões da empresa).
];

function isPathAllowed(role: SystemRole | undefined, pathname: string): boolean {
  const guard = ROUTE_GUARDS.find((g) => pathname.startsWith(g.prefix));
  if (!guard) return true; // rota não restrita
  return !!role && guard.roles.includes(role);
}

function getPageTitle(pathname: string, isManagement: boolean): string {
  if (pathname === '/dashboard') return isManagement ? 'Dashboard' : 'Meus Serviços';
  const allNav = [...managementNav, ...operatorNav];
  const match = allNav.find((n) => n.href !== '/dashboard' && pathname.startsWith(n.href));
  return match?.label || 'GestãoOps';
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, signOut, isManagement, hasAccess, mustResetPassword, resetPassword, isAuthenticated, roleLabel } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, loading, router]);

  // Guarda de rota por papel: bloqueia acesso direto (URL) a páginas não permitidas.
  useEffect(() => {
    if (loading || !isAuthenticated || !profile) return;
    if (!isPathAllowed(profile.role, pathname)) {
      router.replace('/dashboard');
    }
  }, [loading, isAuthenticated, profile, pathname, router]);

  const handleResetPassword = async () => {
    if (newPassword.length < 6) {
      setResetError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('As senhas não coincidem.');
      return;
    }
    setResetLoading(true);
    setResetError('');
    try {
      await resetPassword(newPassword);
    } catch (err: unknown) {
      const fbErr = err as { message?: string };
      setResetError(fbErr.message || 'Erro ao redefinir senha.');
    } finally {
      setResetLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</p>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  if (mustResetPassword) {
    return (
      <div className="login-wrapper">
        <div className="login-card" style={{ maxWidth: '440px' }}>
          <div className="login-header">
            <div className="login-logo"><Shield size={32} /></div>
            <h1>Defina sua senha</h1>
            <p>Olá, <strong>{profile?.name}</strong>! Crie uma nova senha para acessar a plataforma.</p>
          </div>

          {resetError && (
            <div className="login-error">{resetError}</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="input-group">
              <label>Nova senha</label>
              <input
                className="input"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Confirmar senha</label>
              <input
                className="input"
                type="password"
                placeholder="Repita a senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleResetPassword()}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={handleResetPassword}
              disabled={resetLoading}
              style={{ width: '100%', justifyContent: 'center', padding: '14px' }}
            >
              {resetLoading ? <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} /> : 'Salvar e Acessar'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Não renderiza conteúdo de páginas não permitidas (o efeito acima redireciona).
  if (!isPathAllowed(profile?.role, pathname)) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Redirecionando...</p>
      </div>
    );
  }

  const nav = getNavForRole(profile?.role, isManagement, hasAccess);
  const pageTitle = getPageTitle(pathname, isManagement);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  const initials = (profile?.name || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="app-layout">
      {/* Sidebar Overlay Mobile */}
      {sidebarOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 99 }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-icon">G</div>
          <span>GestãoOps</span>
          <button
            className="mobile-menu-btn"
            onClick={() => setSidebarOpen(false)}
            style={{ marginLeft: 'auto' }}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            {isManagement ? 'Gestão' : 'Operador'}
          </div>
          {nav.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={20} className="nav-icon" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <div
              className="avatar"
              style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))' }}
            >
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {profile?.name || 'Usuário'}
              </p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {roleLabel}
              </p>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} onClick={handleSignOut}>
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-content">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
              <Menu size={22} />
            </button>
            <h1 className="topbar-title">{pageTitle}</h1>
          </div>
          <div className="topbar-actions">
            <span className={`badge ${isManagement ? 'badge-primary' : 'badge-accent'}`}>
              {roleLabel}
            </span>
          </div>
        </header>

        <main className="page-content animate-in">
          {children}
        </main>
      </div>
    </div>
  );
}
