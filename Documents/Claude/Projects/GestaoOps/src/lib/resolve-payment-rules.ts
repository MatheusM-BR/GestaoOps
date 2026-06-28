import { PaymentProfile, PaymentRules } from '@/types/operator';

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
 * Resolves payment rules for an operator with the following priority:
 * 1. Assigned payment profile (by paymentProfileId)
 * 2. Operator-specific rules (if they have hourRanges)
 * 3. Contract type defaults (funcionario / freelancer_n1 / freelancer_n2)
 * 4. Merge of operator overrides onto contract defaults (no hourRanges override)
 */
export function resolvePaymentRules(
  operator: OperatorLike,
  profiles: (PaymentProfile & { id: string })[],
  defaultRulesFunc: PaymentRules | null,
  defaultRulesN1: PaymentRules | null,
  defaultRulesN2: PaymentRules | null,
): PaymentRules | null {
  if (operator.paymentProfileId) {
    const profile = profiles.find(
      (p) => p.id === operator.paymentProfileId && p.isActive !== false,
    );
    if (profile) return profileToRules(profile, operator.id);
  }

  if ((operator.paymentRules?.hourRanges?.length ?? 0) > 0) {
    return operator.paymentRules!;
  }

  let defaultRules: PaymentRules | null = null;
  if (operator.contractType === 'funcionario') defaultRules = defaultRulesFunc;
  else if (operator.contractType === 'freelancer_n2') defaultRules = defaultRulesN2;
  else defaultRules = defaultRulesN1;

  if (!defaultRules) return null;

  if (operator.paymentRules && !(operator.paymentRules.hourRanges?.length)) {
    return { ...defaultRules, ...operator.paymentRules, hourRanges: defaultRules.hourRanges };
  }

  return defaultRules;
}
