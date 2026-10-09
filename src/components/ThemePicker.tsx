"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cx } from "./ui";

type Theme = "system" | "light" | "dark";
const KEY = "our-spending-theme";
const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

function snapshot(): Theme {
  const value = document.documentElement.dataset.theme;
  return value === "light" || value === "dark" ? value : "system";
}
function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function ThemePicker() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "system" as Theme);
  function select(value: Theme) {
    document.documentElement.setAttribute("data-theme", value);
    try { localStorage.setItem(KEY, value); } catch { /* Still works for this page if storage is unavailable. */ }
  }
  return (
    <section className="rounded-[20px] bg-surface p-4" aria-labelledby="appearance-title">
      <h2 id="appearance-title" className="text-[15px] font-semibold">Appearance</h2>
      <p className="mt-1 mb-3 text-[12px] text-muted">Make yourself at home. Saved on this device.</p>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Colour theme">
        {OPTIONS.map(({ value, label, Icon }) => (
          <button key={value} type="button" aria-pressed={theme === value} onClick={() => select(value)}
            className={cx("flex min-h-[72px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border text-[13px] font-medium", theme === value ? "border-accent bg-accent text-white" : "border-line bg-bg text-muted")}>
            <Icon size={20} aria-hidden />{label}
          </button>
        ))}
      </div>
    </section>
  );
}
