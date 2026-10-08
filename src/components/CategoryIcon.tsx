import {
  ArrowLeftRight,
  Baby,
  Beer,
  Briefcase,
  Bus,
  Car,
  Circle,
  CircleEllipsis,
  Clapperboard,
  Coffee,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  HeartPulse,
  House,
  Landmark,
  type LucideIcon,
  Music,
  PawPrint,
  PiggyBank,
  Pill,
  Plane,
  Receipt,
  Repeat,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Users,
  Utensils,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react";

// Category icons, by the lucide name stored in categories.icon. A curated set
// keeps the bundle small; unknown names fall back to a plain circle.
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "shopping-cart": ShoppingCart,
  utensils: Utensils,
  coffee: Coffee,
  beer: Beer,
  fuel: Fuel,
  car: Car,
  bus: Bus,
  plane: Plane,
  house: House,
  receipt: Receipt,
  zap: Zap,
  wifi: Wifi,
  smartphone: Smartphone,
  repeat: Repeat,
  "shopping-bag": ShoppingBag,
  shirt: Shirt,
  gift: Gift,
  "heart-pulse": HeartPulse,
  pill: Pill,
  dumbbell: Dumbbell,
  scissors: Scissors,
  sparkles: Sparkles,
  clapperboard: Clapperboard,
  music: Music,
  "gamepad-2": Gamepad2,
  baby: Baby,
  "paw-print": PawPrint,
  "graduation-cap": GraduationCap,
  briefcase: Briefcase,
  wrench: Wrench,
  users: Users,
  heart: Heart,
  "piggy-bank": PiggyBank,
  landmark: Landmark,
  "arrow-left-right": ArrowLeftRight,
  "circle-ellipsis": CircleEllipsis,
  circle: Circle,
};

/** Just the glyph, e.g. inside a chip. */
export function CategoryGlyph({ icon, size = 16 }: { icon: string | null | undefined; size?: number }) {
  const Icon = (icon && CATEGORY_ICONS[icon]) || Circle;
  return <Icon size={size} strokeWidth={2} aria-hidden className="shrink-0" />;
}

/** A category's icon in a soft tinted circle (size = circle diameter). */
export function CategoryIcon({ icon, size = 32, muted }: { icon: string | null | undefined; size?: number; muted?: boolean }) {
  const Icon = (icon && CATEGORY_ICONS[icon]) || Circle;
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full ${muted ? "bg-segment text-muted" : "bg-accent-soft/60 text-accent-link"}`}
      style={{ width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  );
}
