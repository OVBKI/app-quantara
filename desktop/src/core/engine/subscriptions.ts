import { Money, type Currency } from '../money';
import { monthlyEquivalent } from '../frequency';
import { isSubscription, activeRecurringExpenses, type FinancialProfile, type RecurringExpense } from '../model';

/**
 * Vue des abonnements.
 *
 * Un abonnement se souscrit une fois et se paie indéfiniment : c'est ce qui le rend
 * facile à oublier. Le coût **annuel** est donc affiché à côté du mensuel — 15 € par mois
 * ne provoque aucune réaction, 180 € par an si.
 */

export interface SubscriptionLine {
  readonly expense: RecurringExpense;
  readonly monthly: Money;
  readonly annual: Money;
  /** Part du revenu mensuel. `null` sans revenu déclaré. */
  readonly shareOfIncome: number | null;
}

export interface SubscriptionSummary {
  readonly currency: Currency;
  readonly lines: readonly SubscriptionLine[];
  readonly monthlyTotal: Money;
  readonly annualTotal: Money;
  readonly shareOfIncome: number | null;
  /** Intitulés apparaissant plus d'une fois : souvent un doublon oublié. */
  readonly possibleDuplicates: readonly string[];
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function summarizeSubscriptions(
  profile: FinancialProfile,
  monthlyIncome: Money,
  reference: Date = new Date(),
): SubscriptionSummary {
  const currency = profile.currency;
  const subscriptions = activeRecurringExpenses(profile, reference).filter(isSubscription);

  const lines = subscriptions
    .map((expense): SubscriptionLine => {
      const monthly = monthlyEquivalent(expense.amount, expense.frequency);
      return {
        expense,
        monthly,
        annual: monthly.times(12n),
        shareOfIncome: monthly.ratioTo(monthlyIncome),
      };
    })
    .sort((a, b) => Money.compareDescending(a.monthly, b.monthly));

  const monthlyTotal = Money.sum(
    lines.map((line) => line.monthly),
    currency,
  );

  const seen = new Map<string, number>();
  for (const line of lines) {
    const key = normalizeName(line.expense.name);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const possibleDuplicates = lines
    .filter((line) => (seen.get(normalizeName(line.expense.name)) ?? 0) > 1)
    .map((line) => line.expense.name)
    .filter((name, index, all) => all.indexOf(name) === index);

  return {
    currency,
    lines,
    monthlyTotal,
    annualTotal: monthlyTotal.times(12n),
    shareOfIncome: monthlyTotal.ratioTo(monthlyIncome),
    possibleDuplicates,
  };
}
