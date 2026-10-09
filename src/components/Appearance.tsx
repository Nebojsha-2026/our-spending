"use client";

import { useEffect } from "react";

/** Keep browser chrome in sync, including device changes while System is selected. */
export function Appearance() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const theme = document.documentElement.dataset.theme;
      const dark = theme === "dark" || (theme !== "light" && media.matches);
      document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
        meta.removeAttribute("media");
        meta.setAttribute("content", dark ? "#111315" : "#f7f8f4");
      });
    };
    const storage = (e: StorageEvent) => {
      if (e.key !== "our-spending-theme" && e.key !== null) return;
      document.documentElement.setAttribute("data-theme", e.newValue === "light" || e.newValue === "dark" ? e.newValue : "system");
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    media.addEventListener("change", update);
    window.addEventListener("storage", storage);
    update();
    return () => { observer.disconnect(); media.removeEventListener("change", update); window.removeEventListener("storage", storage); };
  }, []);
  return null;
}
