import { appIcon } from "@/lib/app-icon";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return appIcon(64, { rounded: true });
}
