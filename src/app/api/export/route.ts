import { jsonError, requireMember } from "@/lib/api";
import { TZ, sydneyDate } from "@/lib/periods";
import { SOURCE_LABEL, TRANSACTION_COLUMNS, type Account, type Category, type Member, type Transaction } from "@/lib/types";

const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

function csvCell(v: string | null | undefined) {
  const s = v ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Free text from banks or people: stop spreadsheets treating it as a formula. */
function text(v: string | null | undefined) {
  return v && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** GET /api/export — every transaction in the household as CSV. */
export async function GET() {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  const { supabase } = auth;

  const [members, categories, accounts] = await Promise.all([
    supabase.from("members").select("*").returns<Member[]>(),
    supabase.from("categories").select("*").returns<Category[]>(),
    supabase.from("accounts").select("*").returns<Account[]>(),
  ]);
  if (members.error || categories.error || accounts.error) return jsonError("Couldn't load household", 500);
  const member = new Map(members.data.map((m) => [m.id, m.display_name]));
  const category = new Map(categories.data.map((c) => [c.id, c.name]));
  const account = new Map(accounts.data.map((a) => [a.id, `${a.bank} ${a.nickname}${a.last4 ? ` ${a.last4}` : ""}`]));

  // PostgREST caps responses (1000 rows by default), so page through.
  const all: Transaction[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select(TRANSACTION_COLUMNS)
      .order("occurred_at")
      .order("id")
      .range(from, from + 999)
      .returns<Transaction[]>();
    if (error) return jsonError(error.message, 500);
    all.push(...data);
    if (data.length < 1000) break;
  }

  const header = ["date", "time", "amount_aud", "merchant", "bank_description", "category", "person", "account", "source", "status", "note", "id"];
  const lines = all.map((t) =>
    [
      sydneyDate(t.occurred_at),
      time.format(new Date(t.occurred_at)),
      (Number(t.amount_cents) / 100).toFixed(2),
      text(t.merchant),
      text(t.merchant_raw),
      text(t.category_id ? category.get(t.category_id) : ""),
      text(member.get(t.member_id)),
      text(t.account_id ? account.get(t.account_id) : ""),
      SOURCE_LABEL[t.source],
      t.status,
      text(t.note),
      t.id,
    ]
      .map(csvCell)
      .join(","),
  );

  return new Response([header.join(","), ...lines].join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="spending-${sydneyDate()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
