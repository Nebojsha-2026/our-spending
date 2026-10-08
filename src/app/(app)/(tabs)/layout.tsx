import { BottomNav } from "@/components/BottomNav";

// Tab screens: content area above the bottom nav. Each screen owns its scrolling.
export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <BottomNav />
    </div>
  );
}
