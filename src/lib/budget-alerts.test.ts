import { describe, expect, it } from "vitest";
import { budgetAlertMessage, type BudgetAlert } from "./budget-alerts";

const alert = (threshold: 80 | 100, spent: number, budget = 40000): BudgetAlert => ({
  category_id: "c1",
  category: "Eating out",
  threshold,
  spent_cents: spent,
  budget_cents: budget,
});

describe("budget alert wording", () => {
  it("80%: how much is left and the daily pace", () => {
    // 21 Oct: 11 days left including today.
    expect(budgetAlertMessage(alert(80, 32800), "2026-10-21")).toEqual({
      title: "Eating out: 82% of budget",
      body: "$72.00 left for 11 days · $6.54/day.",
      url: "/budgets",
      tag: "budget-c1",
    });
    expect(budgetAlertMessage(alert(80, 32000), "2026-10-31").body).toBe("$80.00 left for today.");
  });

  it("100%: over by how much, or exactly spent", () => {
    expect(budgetAlertMessage(alert(100, 41250), "2026-10-21")).toMatchObject({
      title: "Eating out is over budget",
      body: "$412.50 of $400.00 spent this month, $12.50 over.",
      tag: "budget-c1",
    });
    expect(budgetAlertMessage(alert(100, 40000), "2026-10-21")).toMatchObject({
      title: "Eating out has reached its budget",
      body: "All $400.00 for October 2026 is spent.",
    });
  });

  it("accepts amounts that arrive from the database as strings", () => {
    const a = { ...alert(80, 0), spent_cents: "32000", budget_cents: "40000" } as unknown as BudgetAlert;
    expect(budgetAlertMessage(a, "2026-10-21").title).toBe("Eating out: 80% of budget");
  });
});
