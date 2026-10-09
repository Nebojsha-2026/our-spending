"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { ChevronLeft, ChevronRight, CloseIcon } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/** White card, radius 20 (design: cards). */
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx("flex flex-col rounded-[20px] bg-surface", className)}>{children}</div>;
}

/** 44px round outline button (prev/next, close, back). */
export function CircleButton({
  label,
  onClick,
  href,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    "flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink disabled:opacity-40";
  if (href) {
    return (
      <Link href={href} aria-label={label} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className={cx(cls, "cursor-pointer")}>
      {children}
    </button>
  );
}

/** Header for sub-screens: back/close, centred title, spacer (matches Quick add). */
export function SubHeader({
  title,
  backHref,
  onBack,
  close,
}: {
  title: string;
  backHref?: string;
  onBack?: () => void;
  close?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <CircleButton label={close ? "Close" : "Back"} href={backHref} onClick={onBack}>
        {close ? <CloseIcon /> : <ChevronLeft />}
      </CircleButton>
      <div className="text-[16px] font-semibold">{title}</div>
      <div className="w-11" />
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Fill colour when selected (Quick add person toggle); default white with shadow. */
  color?: string;
}

/** Segmented control: segment-bg track, 4px padding, selected segment raised. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-1 rounded-[12px] bg-segment p-1"
      // One row for up to 4 choices; more (e.g. a household of 5+) wrap into rows of 3.
      style={{ gridTemplateColumns: `repeat(${options.length <= 4 ? options.length : 3}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "h-11 cursor-pointer truncate rounded-[9px] border-none px-2 text-[14px]",
              on ? "font-semibold" : "bg-transparent font-medium text-muted",
              on && !o.color && "bg-accent text-white shadow-[0_1px_2px_var(--color-shadow)]",
              on && o.color && "text-white",
            )}
            style={on && o.color ? { background: o.color } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Rounded chip. `dark` = Activity filters, `accent` = category picker. */
export function Chip({
  selected,
  onClick,
  tone = "accent",
  size = "md",
  children,
}: {
  selected: boolean;
  onClick: () => void;
  tone?: "dark" | "accent";
  size?: "sm" | "md";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "shrink-0 cursor-pointer rounded-full border px-[14px] whitespace-nowrap",
        size === "sm" ? "h-11 text-[13px]" : "h-11 text-[14px]",
        selected
          ? cx("font-semibold", tone === "dark" ? "border-accent bg-accent text-white" : "border-accent bg-accent text-white")
          : "border-line bg-surface font-medium text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({
  children,
  disabled,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="flex h-[54px] w-full shrink-0 cursor-pointer items-center justify-center rounded-[16px] border-none bg-accent text-[16px] font-semibold text-white disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex h-11 w-full shrink-0 cursor-pointer items-center justify-center rounded-[12px] border border-line bg-surface text-[15px] font-semibold disabled:opacity-50",
        danger ? "text-up" : "text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Label above a 44px input, like the Activity search field. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] text-muted">
        {label}
      </label>
      {children(id)}
      {hint && <div className="text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

export const inputClass =
  "h-11 w-full rounded-[12px] border border-line bg-surface px-[14px] text-[15px] text-ink outline-none focus:border-accent box-border";

/**
 * Bottom sheet for edit forms. The panel scrolls; its sections keep their full
 * height (shrink-0) so long content overflows instead of being squashed.
 */
export function Sheet({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter((el) => el.getClientRects().length > 0);
      const first = items[0], last = items.at(-1);
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <button aria-label="Close" className="absolute inset-0 animate-fade cursor-default bg-black/40" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative mt-auto flex max-h-[92dvh] animate-sheet shadow-[0_-8px_30px_var(--color-shadow)] w-full max-w-[480px] flex-col gap-[18px] overflow-y-auto overscroll-contain rounded-t-[20px] [&>*]:shrink-0 bg-bg px-5 pt-5 pb-[max(28px,env(safe-area-inset-bottom))] outline-none"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-[16px] font-semibold">{title}</div>
          <CircleButton label="Close" onClick={onClose}>
            <CloseIcon />
          </CircleButton>
        </div>
        {children}
      </div>
    </div>
  );
}

/** White grouped list (radius 16) with dividers, like Activity day groups. */
export function List({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[16px] bg-surface [&>*+*]:border-t [&>*+*]:border-divider">
      {children}
    </div>
  );
}

export function ListRow({
  title,
  subtitle,
  right,
  leading,
  onClick,
  href,
  disabled,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  leading?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  const inner = (
    <>
      {leading}
      <span className="flex min-w-0 grow flex-col gap-[2px] text-left">
        <span className="truncate text-[15px] font-semibold">{title}</span>
        {subtitle && <span className="truncate text-[12px] text-muted">{subtitle}</span>}
      </span>
      {right}
      {(onClick || href) && !disabled && <ChevronRight className="shrink-0 text-muted" />}
    </>
  );
  const cls = cx(
    "flex min-h-[60px] w-full items-center gap-3 border-none bg-transparent px-[14px] py-3 text-ink",
    disabled ? "opacity-60" : "cursor-pointer",
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  if (onClick && !disabled) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

/** Person initial dot (32px, member colour). */
export function PersonDot({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
      style={{ background: color }}
      aria-hidden
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-1 text-[13px] font-semibold text-muted">{children}</div>;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-[14px] bg-warn-bg px-[14px] py-3 text-[14px] text-warn-ink">
      {children}
    </div>
  );
}
