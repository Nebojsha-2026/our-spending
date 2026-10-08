// Calendar periods in Australia/Sydney. Weeks run Monday–Sunday.
//
// Dates are plain "YYYY-MM-DD" strings for the Sydney calendar day, which is
// exactly what v_spend_by_period.period_start holds. Arithmetic is done on UTC
// Date objects so the machine's own time zone never leaks in.

export const TZ = "Australia/Sydney";
export type PeriodKind = "week" | "month" | "year";

export interface Period {
  kind: PeriodKind;
  /** First day, inclusive. */
  start: string;
  /** Day after the last day (exclusive). */
  end: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Sydney calendar date of an instant, as "YYYY-MM-DD". */
export function sydneyDate(instant: Date | string = new Date()): string {
  return dayFormatter.format(typeof instant === "string" ? new Date(instant) : instant);
}

function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
}

function addMonths(d: string, n: number): string {
  const x = parse(d);
  return iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1)));
}

function startOf(kind: PeriodKind, d: string): string {
  const x = parse(d);
  if (kind === "week") return addDays(d, -((x.getUTCDay() + 6) % 7));
  if (kind === "month") return iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1)));
  return iso(new Date(Date.UTC(x.getUTCFullYear(), 0, 1)));
}

function step(kind: PeriodKind, start: string, n: number): string {
  if (kind === "week") return addDays(start, 7 * n);
  if (kind === "month") return addMonths(start, n);
  return addMonths(start, 12 * n);
}

/** The period containing `today`, shifted by `offset` periods (0 = current, -1 = previous). */
export function periodAt(kind: PeriodKind, today: string, offset = 0): Period {
  const start = step(kind, startOf(kind, today), offset);
  return { kind, start, end: step(kind, start, 1) };
}

export function previous(p: Period): Period {
  const start = step(p.kind, p.start, -1);
  return { kind: p.kind, start, end: p.start };
}

/** "Week of 5 – 11 Oct", "September 2026", "2026 so far". */
export function periodLabel(p: Period, today: string): string {
  const s = parse(p.start);
  const thisYear = parse(today).getUTCFullYear();
  if (p.kind === "year") {
    return p.start <= today && today < p.end ? `${s.getUTCFullYear()} so far` : `${s.getUTCFullYear()}`;
  }
  if (p.kind === "month") return `${MONTHS_LONG[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
  const e = parse(addDays(p.end, -1));
  const left =
    s.getUTCMonth() === e.getUTCMonth()
      ? `${s.getUTCDate()}`
      : `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}`;
  const yearSuffix = e.getUTCFullYear() !== thisYear ? ` ${e.getUTCFullYear()}` : "";
  return `Week of ${left} – ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]}${yearSuffix}`;
}

/** What the delta compares against: "last week", "August", "2025". */
export function previousLabel(p: Period, today: string): string {
  const prev = parse(previous(p).start);
  if (p.kind === "week") return p.start === periodAt("week", today).start ? "last week" : "previous week";
  if (p.kind === "month") return MONTHS_LONG[prev.getUTCMonth()];
  return `${prev.getUTCFullYear()}`;
}

export interface TrendSlot {
  /** period_start to match against v_spend_by_period. */
  start: string;
  label: string;
}

/**
 * Trend bars for a period. Week and month: the last 6 periods ending with this
 * one. Year: the months of that year (up to the current month for this year).
 */
export function trendSlots(p: Period, today: string): { kind: PeriodKind; title: string; slots: TrendSlot[] } {
  if (p.kind === "year") {
    const months: TrendSlot[] = [];
    for (let m = p.start; m < p.end && m <= today; m = addMonths(m, 1)) {
      months.push({ start: m, label: MONTHS[parse(m).getUTCMonth()][0] });
    }
    return { kind: "month", title: "By month", slots: months };
  }
  const slots: TrendSlot[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = step(p.kind, p.start, -i);
    const d = parse(start);
    slots.push({
      start,
      label: p.kind === "week" ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : MONTHS[d.getUTCMonth()],
    });
  }
  return { kind: p.kind, title: p.kind === "week" ? "Last 6 weeks" : "Last 6 months", slots };
}

/** Activity day headers: "Today · Tue 6 Oct", "Mon 5 Oct", "Wed 31 Dec 2025". */
export function dayLabel(day: string, today: string): string {
  const d = parse(day);
  const base = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const withYear = d.getUTCFullYear() === parse(today).getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
  return day === today ? `Today · ${withYear}` : withYear;
}

/** Days left in the month including today, for the budget daily pace. */
export function daysLeftInMonth(today: string): number {
  const end = periodAt("month", today).end;
  return Math.round((parse(end).getTime() - parse(today).getTime()) / 86_400_000);
}

export function monthName(d: string): string {
  const x = parse(d);
  return `${MONTHS_LONG[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}
