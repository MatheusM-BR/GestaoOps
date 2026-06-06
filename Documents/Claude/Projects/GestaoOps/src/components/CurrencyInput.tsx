'use client';

import { useState, useEffect } from 'react';
import { maskCurrency, parseCurrency } from '@/lib/masks';

interface CurrencyInputProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}

/**
 * Input monetário com máscara automática de Real brasileiro.
 * Internamente usa string formatada, externaliza number.
 */
export default function CurrencyInput({ value, onChange, className = 'input', style, placeholder }: CurrencyInputProps) {
  const [display, setDisplay] = useState(maskCurrency(value));

  // Sync when external value changes (e.g. after save)
  useEffect(() => {
    setDisplay(maskCurrency(value));
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Keep only digits
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      setDisplay('0,00');
      onChange(0);
      return;
    }

    const cents = parseInt(digits, 10);
    const numValue = cents / 100;

    setDisplay(maskCurrency(numValue));
    onChange(numValue);
  };

  return (
    <input
      className={className}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={handleChange}
      placeholder={placeholder || '0,00'}
      style={style}
    />
  );
}
