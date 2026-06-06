/**
 * Aplica máscara de telefone brasileiro: (00) 00000-0000
 */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);

  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/**
 * Formata número como moeda brasileira: 1500.5 → "1.500,50"
 */
export function maskCurrency(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Aplica máscara de moeda a uma string digitada (estilo caixa eletrônico).
 * Cada dígito digitado entra à direita, centavos são os 2 últimos.
 * Ex: "15000" → "150,00" | "1500050" → "15.000,50"
 */
export function maskCurrencyInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '0,00';

  const cents = parseInt(digits, 10);
  const value = cents / 100;

  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Converte string formatada de volta para número.
 * "1.500,50" → 1500.5 | "0,00" → 0
 */
export function parseCurrency(formatted: string): number {
  const cleaned = formatted.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
