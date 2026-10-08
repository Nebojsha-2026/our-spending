/** The app icon (three rising bars on teal), for sign-in and onboarding. */
export function AppMark() {
  return (
    <div className="flex size-16 items-end justify-center gap-[4px] rounded-[18px] bg-accent pb-[17px]" aria-hidden>
      <div className="h-[13px] w-2 rounded-[3px_3px_1px_1px] bg-white/60" />
      <div className="h-5 w-2 rounded-[3px_3px_1px_1px] bg-white/80" />
      <div className="h-7 w-2 rounded-[3px_3px_1px_1px] bg-white" />
    </div>
  );
}
