// About this app: shown in Settings → About and on the sign-in screen.
// A null link is simply not shown.
export const PROJECT = {
  name: "Our spending",
  version: "1.0.0",
  /** e.g. "https://github.com/<you>/<repo>" */
  repoUrl: "https://github.com/Nebojsha-2026/our-spending" as string | null,
  /** e.g. "https://buymeacoffee.com/<you>" */
  coffeeUrl: "https://buymeacoffee.com/npetreski" as string | null,
  /**
   * iCloud link to the ready-made iPhone Shortcut (docs/maintainers.md says how
   * to make it). With it, Settings → Devices offers "Get the Shortcut" instead
   * of building one by hand.
   */
  iphoneShortcutUrl: null as string | null,
};
