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
  Download,
  Bell,
  LayoutGrid,
  PanelLeft,
  Radio,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: SystemRole[]; // undefined = all management roles
  group?: string;       // section label shown above the first item of a group
}

// Full nav for management roles
const managementNav: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Eventos', href: '/dashboard/eventos', icon: Gavel, group: 'Operação' },
  { label: 'Escala', href: '/dashboard/escala-mensal', icon: LayoutGrid },
  { label: 'Calendário', href: '/dashboard/calendario', icon: CalendarDays },
  { label: 'Operação ao Vivo', href: '/dashboard/operacao', icon: Radio, roles: ['admin', 'ceo', 'gestor', 'operador_painel', 'administrativo'] },
  { label: 'Financeiro', href: '/dashboard/financeiro', icon: DollarSign, roles: ['admin', 'ceo', 'financeiro'], group: 'Financeiro' },
  { label: 'Exportação', href: '/dashboard/exportacao', icon: FileSpreadsheet, roles: ['admin', 'ceo', 'gestor', 'financeiro', 'comercial', 'administrativo'] },
  { label: 'Operadores', href: '/dashboard/operadores', icon: Users, roles: ['admin'], group: 'Administração' },
  { label: 'Configurações', href: '/dashboard/configuracoes', icon: Settings, roles: ['admin'] },
  { label: 'Importar Planilhas', href: '/dashboard/importar', icon: FileSpreadsheet, roles: ['admin'] },
  { label: 'Notificações', href: '/dashboard/notificacoes', icon: Bell, roles: ['admin', 'ceo', 'gestor'] },
  { label: 'Downloader', href: '/dashboard/downloader', icon: Download },
];

// Nav padrão para operadores de campo/freelancers.
const operatorNav: NavItem[] = [
  { label: 'Meus Serviços', href: '/dashboard', icon: ClipboardList },
  { label: 'Minha Escala', href: '/dashboard/minha-escala', icon: Calendar, group: 'Agenda' },
  { label: 'Leilões da Empresa', href: '/dashboard/calendario', icon: CalendarDays },
  { label: 'Meus Pagamentos', href: '/dashboard/meus-pagamentos', icon: DollarSign, group: 'Conta' },
  { label: 'Meu Perfil', href: '/dashboard/meu-perfil', icon: UserCircle },
  { label: 'Downloader', href: '/dashboard/downloader', icon: Download },
];

// Nav do Operador de Painel: acessa eventos/escala/calendário, mas não financeiro/operadores/config.
const painelHiddenHrefs = ['/dashboard/operadores', '/dashboard/financeiro', '/dashboard/exportacao', '/dashboard/configuracoes'];

// Papéis de transmissão que recebem acesso a Notificações.
const TRANSMISSAO_ROLES: SystemRole[] = ['operador_transmissao', 'tecnico'];

function getNavForRole(role: SystemRole | undefined, isManagement: boolean, hasAccess: (roles: SystemRole[]) => boolean): NavItem[] {
  if (!role) return operatorNav;
  if (role === 'operador_painel') {
    const base = managementNav.filter((item) => !painelHiddenHrefs.includes(item.href));
    // Painel recebe Notificações mesmo não sendo gestão.
    const hasNotif = base.some((i) => i.href === '/dashboard/notificacoes');
    return hasNotif ? base : [...base, { label: 'Notificações', href: '/dashboard/notificacoes', icon: Bell }];
  }
  if (TRANSMISSAO_ROLES.includes(role)) {
    // Transmissão: nav de operador + Notificações.
    return [...operatorNav, { label: 'Notificações', href: '/dashboard/notificacoes', icon: Bell }];
  }
  if (isOperatorRole(role)) {
    return operatorNav;
  }
  // Roles de gestão: filtrar pelo campo roles de cada item.
  return managementNav.filter((item) => {
    if (!item.roles) return true;
    return hasAccess(item.roles);
  });
}

const ALL_MANAGEMENT: SystemRole[] = ['admin', 'ceo', 'gestor', 'financeiro', 'comercial', 'administrativo', 'planejamento'];
// Acesso a eventos/escala: gestão + operador de painel. Freelancers não acessam.
const EVENT_ACCESS: SystemRole[] = [...ALL_MANAGEMENT, 'operador_painel'];
// Modelo de Escala: gestão toda + operador de painel + operação. View filtrada por papel na página.
const ESCALA_ACCESS: SystemRole[] = [...ALL_MANAGEMENT, 'operador_painel', 'operacao', 'operador_transmissao', 'tecnico'];

// Páginas de gestão e quais papéis podem acessá-las (prefixo de rota).
// Rotas sem guard (/dashboard, /minha-escala, /meus-pagamentos, /meu-perfil, /calendario, /downloader) são liberadas a todos.
const ROUTE_GUARDS: { prefix: string; roles: SystemRole[] }[] = [
  { prefix: '/dashboard/configuracoes', roles: ['admin'] },
  { prefix: '/dashboard/exportacao', roles: ['admin', 'ceo', 'gestor', 'financeiro', 'comercial', 'administrativo'] },
  { prefix: '/dashboard/financeiro', roles: ['admin', 'ceo', 'financeiro'] },
  { prefix: '/dashboard/operadores', roles: ['admin'] },
  { prefix: '/dashboard/eventos', roles: EVENT_ACCESS },
  { prefix: '/dashboard/leiloes', roles: EVENT_ACCESS },
  { prefix: '/dashboard/escala-mensal', roles: ESCALA_ACCESS },
  // /dashboard/downloader: sem guard (todos, incluindo freelancers).
  { prefix: '/dashboard/notificacoes', roles: ['admin', 'ceo', 'gestor', 'operador_painel', 'operador_transmissao', 'tecnico'] },
  { prefix: '/dashboard/operacao', roles: ['admin', 'ceo', 'gestor', 'operador_painel', 'administrativo', 'operador_transmissao', 'tecnico'] },
  { prefix: '/dashboard/importar', roles: ['admin'] },
  // /dashboard/calendario: aberto a todos.
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
  return match?.label || 'GestRW';
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, signOut, isManagement, hasAccess, mustResetPassword, resetPassword, isAuthenticated, roleLabel } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false); // sidebar recolhida (só ícones) no desktop
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, loading, router]);

  // Recolher/expandir a sidebar — persiste a preferência.
  useEffect(() => {
    setCollapsed(localStorage.getItem('sidebar_collapsed') === '1');
  }, []);
  const toggleCollapsed = () => setCollapsed((c) => {
    const next = !c;
    try { localStorage.setItem('sidebar_collapsed', next ? '1' : '0'); } catch {}
    return next;
  });

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
    <div className={`app-layout ${collapsed ? 'collapsed' : ''}`}>
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
          <img src="/logo-remateweb.svg" alt="RemateWeb" style={{ width: 36, height: 36, borderRadius: 10 }} />
          <span>GestRW</span>
          <button
            className="mobile-menu-btn"
            onClick={() => setSidebarOpen(false)}
            style={{ marginLeft: 'auto' }}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {nav.map((item, idx) => {
            const Icon = item.icon;
            const isActive = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href);
            const showGroup = item.group && (idx === 0 || nav[idx - 1]?.group !== item.group);

            return (
              <div key={item.href}>
                {showGroup && (
                  <div className="sidebar-section nav-label">{item.group}</div>
                )}
                <Link
                  href={item.href}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                  title={item.label}
                >
                  <Icon size={18} className="nav-icon" />
                  <span className="nav-label">{item.label}</span>
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', padding: '8px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
            <div
              className="avatar avatar-sm"
              style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', flexShrink: 0 }}
            >
              {initials}
            </div>
            <div className="nav-label" style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>
                {profile?.name?.split(' ')[0] || 'Usuário'}
              </p>
              <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                {roleLabel}
              </p>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} onClick={handleSignOut} title="Sair">
            <LogOut size={15} />
            <span className="nav-label">Sair</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-content">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
              <Menu size={22} />
            </button>
            <button className="sidebar-collapse-btn" onClick={toggleCollapsed} title={collapsed ? 'Expandir menu' : 'Recolher menu'} aria-label="Recolher menu">
              <PanelLeft size={20} />
            </button>
            <div>
              <h1 className="topbar-title">{pageTitle}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                className="avatar avatar-sm"
                style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', fontSize: '12px', fontWeight: 700 }}
              >
                {initials}
              </div>
              <div className="hide-on-mobile" style={{ lineHeight: 1.2 }}>
                <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{profile?.name?.split(' ')[0]}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{roleLabel}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="page-content animate-in">
          {children}
        </main>
      </div>
    </div>
  );
}
