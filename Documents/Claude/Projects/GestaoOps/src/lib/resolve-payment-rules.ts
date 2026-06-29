import { ContractType, PaymentProfile, PaymentRules } from '@/types/operator';

type OperatorLike = {
  id: string;
  contractType: string;
  paymentProfileId?: string;
  paymentRules?: PaymentRules | null;
};

function profileToRules(profile: PaymentProfile & { id: string }, operatorId: string): PaymentRules {
  return {
    id: profile.id,
    operatorId,
    contractType: profile.contractType,
    hourRanges: profile.hourRanges,
    dailyTravel: profile.dailyTravel,
    dailyTravelMultiple: profile.dailyTravelMultiple,
    weekendHolidayBonus: profile.weekendHolidayBonus,
    restDayExtra: profile.restDayExtra,
    restDayMatchesMainRules: profile.restDayMatchesMainRules,
    isDefault: false,
    updatedAt: profile.updatedAt instanceof Date ? profile.updatedAt : new Date(),
  };
}

/**
 * Regras padrão para um tipo de contrato = o perfil marcado como
 * isDefaultForContract === contractType. Substitui os antigos
 * settings/default_rules_* (Modelos de Ganhos), agora unificados em Perfis.
 */
export function defaultRulesForContract(
  profiles: (PaymentProfile & { id: string })[],
  contractType: ContractType | string,
): PaymentRules | null {
  const p = profiles.find(
    (pp) => pp.isActive !== false && pp.isDefaultForContract === contractType,
  );
  return p ? profileToRules(p, '') : null;
}

/**
 * Resolve as regras de pagamento de um operador, na ordem de prioridade:
 * 1. Perfil atribuído (paymentProfileId)
 * 2. Regras específicas do operador (se tiverem hourRanges)
 * 3. Perfil padrão do tipo de contrato (isDefaultForContract)
 * 4. Merge das sobreposições do operador (sem hourRanges) sobre o padrão
 */
export function resolvePaymentRules(
  operator: OperatorLike,
  profiles: (PaymentProfile & { id: string })[],
): PaymentRules | null {
  // 1. Perfil atribuído
  if (operator.paymentProfileId) {
    const profile = profiles.find(
      (p) => p.id === operator.paymentProfileId && p.isActive !== false,
    );
    if (profile) return profileToRules(profile, operator.id);
  }

  // 2. Regras específicas do operador com hourRanges
  if ((operator.paymentRules?.hourRanges?.length ?? 0) > 0) {
    return operator.paymentRules!;
  }

  // 3. Perfil padrão do tipo de contrato
  const defaultRules = defaultRulesForContract(profiles, operator.contractType);
  if (!defaultRules) return null;

  // 4. Merge das sobreposições do operador (sem hourRanges) sobre o padrão
  if (operator.paymentRules && !(operator.paymentRules.hourRanges?.length)) {
    return { ...defaultRules, ...operator.paymentRules, hourRanges: defaultRules.hourRanges };
  }

  return defaultRules;
}
