'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LeiloesRedirectPage() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/dashboard/eventos');
  }, [router]);

  return (
    <div className="loading-screen">
      <div className="spinner" />
      <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Redirecionando...</p>
    </div>
  );
}
