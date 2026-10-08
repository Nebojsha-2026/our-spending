"use client";

import { Coffee } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import { ChevronRight } from "@/components/icons";
import { List, ListRow, SectionLabel } from "@/components/ui";
import { PROJECT } from "@/lib/project";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const router = useRouter();
  const { household, members, accounts, categories, email } = useHousehold();
  const [ruleCount, setRuleCount] = useState<number | null>(null);
  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  const [logCount, setLogCount] = useState<number | null>(null);
  const [alertCount, setAlertCount] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => setAlertCount(count ?? 0));
    supabase
      .from("merchant_rules")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => setRuleCount(count ?? 0));
    supabase
      .from("device_tokens")
      .select("id", { count: "exact", head: true })
      .is("revoked_at", null)
      .then(({ count }) => setDeviceCount(count ?? 0));
    supabase
      .from("ingest_failures")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => setLogCount(count ?? 0));
  }, []);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto [&>*]:shrink-0 px-5 pt-[calc(28px+env(safe-area-inset-top))] pb-5">
      <div className="text-[20px] font-bold">Settings</div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Household</SectionLabel>
        <List>
          <ListRow
            href="/settings/household"
            title={household.name}
            subtitle={members.map((m) => m.display_name).join(" & ")}
          />
        </List>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Money</SectionLabel>
        <List>
          <ListRow href="/settings/accounts" title="Accounts & cards" subtitle={plural(accounts.length, "card")} />
          <ListRow
            href="/settings/categories"
            title="Categories & budgets"
            subtitle={`${plural(categories.length, "category", "categories")} · ${plural(
              categories.filter((c) => c.monthly_budget_cents).length,
              "budget",
            )}`}
          />
          <ListRow
            href="/settings/alerts"
            title="Budget alerts"
            subtitle={
              alertCount === null
                ? "Notify at 80% and 100% of a budget"
                : alertCount
                  ? `On for ${plural(alertCount, "phone")}`
                  : "Off · notify at 80% and 100% of a budget"
            }
          />
          <ListRow
            href="/settings/rules"
            title="Merchant rules"
            subtitle={ruleCount === null ? "Clean names and auto-categorise" : plural(ruleCount, "rule")}
          />
        </List>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Phones & import</SectionLabel>
        <List>
          <ListRow
            href="/settings/devices"
            title="Devices"
            subtitle={deviceCount === null ? "Phone capture tokens" : plural(deviceCount, "active phone")}
          />
          <ListRow
            href="/settings/capture-log"
            title="Capture log"
            subtitle={logCount ? plural(logCount, "notification") + " not saved" : "Every notification was read"}
          />
          <ListRow href="/settings/import" title="Import bank CSV" subtitle="ANZ, NAB or any bank's export · confirms phone captures" />
        </List>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Data</SectionLabel>
        <List>
          <a href="/api/export" download className="flex min-h-[60px] items-center gap-3 px-[14px] py-3 text-ink hover:text-ink">
            <span className="flex min-w-0 grow flex-col gap-[2px]">
              <span className="text-[15px] font-semibold">Export everything to CSV</span>
              <span className="text-[12px] text-muted">All transactions, everyone in the household</span>
            </span>
            <ChevronRight className="shrink-0 text-muted" />
          </a>
        </List>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Account</SectionLabel>
        <List>
          <ListRow title="Signed in" subtitle={email} />
          <button
            type="button"
            onClick={signOut}
            className="flex min-h-[60px] w-full cursor-pointer items-center bg-transparent px-[14px] text-left text-[15px] font-semibold text-up"
          >
            Sign out
          </button>
        </List>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>About</SectionLabel>
        <List>
          <ListRow title={PROJECT.name} subtitle={`Version ${PROJECT.version} · open source, your data stays in your own database`} />
          <ListRow href="/?tour=1" title="Take the tour" subtitle="How it all works, in four cards" />
          {PROJECT.repoUrl && <ExternalRow href={PROJECT.repoUrl} title="Source code & help" subtitle="GitHub: setup guide, issues, updates" />}
          {PROJECT.coffeeUrl && (
            <ExternalRow
              href={PROJECT.coffeeUrl}
              leading={<Coffee size={18} className="shrink-0 text-accent-link" />}
              title="Buy me a coffee"
              subtitle="Free forever. If it helps your household, a coffee says thanks"
            />
          )}
        </List>
      </div>
    </div>
  );
}

function ExternalRow({ href, title, subtitle, leading }: { href: string; title: string; subtitle: string; leading?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex min-h-[60px] items-center gap-3 px-[14px] py-3 text-ink hover:text-ink">
      {leading}
      <span className="flex min-w-0 grow flex-col gap-[2px]">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="truncate text-[12px] text-muted">{subtitle}</span>
      </span>
      <ChevronRight className="shrink-0 text-muted" />
    </a>
  );
}
