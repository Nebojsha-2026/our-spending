// What a budget alert says. The database decides when one is due
// (claim_budget_alerts); this only words it.
import { formatCents } from "./money";
import { daysLeftInMonth, monthName } from "./periods";

export interface BudgetAlert {
  category_id: string;
  category: string;
  threshold: 80 | 100;
  spent_cents: number;
  budget_cents: number;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  /** Same tag replaces the earlier notification (100% replaces 80%). */
  tag: string;
}

/** `today` is a Sydney date (YYYY-MM-DD). */
export function budgetAlertMessage(a: BudgetAlert, today: string): PushMessage {
  const spent = Number(a.spent_cents);
  const budget = Number(a.budget_cents);
  const base = { url: "/budgets", tag: `budget-${a.category_id}` };

  if (a.threshold === 100) {
    return spent > budget
      ? {
          ...base,
          title: `${a.category} is over budget`,
          body: `${formatCents(spent)} of ${formatCents(budget)} spent this month, ${formatCents(spent - budget)} over.`,
        }
      : {
          ...base,
          title: `${a.category} has reached its budget`,
          body: `All ${formatCents(budget)} for ${monthName(today)} is spent.`,
        };
  }

  const days = daysLeftInMonth(today);
  const left = budget - spent;
  return {
    ...base,
    title: `${a.category}: ${Math.floor((spent * 100) / budget)}% of budget`,
    body:
      days === 1
        ? `${formatCents(left)} left for today.`
        : `${formatCents(left)} left for ${days} days · ${formatCents(Math.floor(left / days))}/day.`,
  };
}
