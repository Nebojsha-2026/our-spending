# Design reference — match this exactly

The three screens in this folder are the approved design. Build the real app to look and behave like them.

- `screens/Overview.dc.html` — Overview (home) screen
- `screens/Transactions.dc.html` — Activity / transactions list
- `screens/QuickAdd.dc.html` — Quick add spending

These files are mockups from a design tool, not production code. Read them for layout, spacing, colours, type and behaviour, then rebuild them as real Next.js/React components. Ignore the `<x-dc>`, `<sc-for>`, `<sc-if>`, `{{...}}` template syntax and the `class Component extends DCLogic` script: those are the design tool's runtime. The `renderVals()` functions show the intended interactions (period switch, filters, keypad). All amounts and merchants in them are sample data; real data comes from Supabase.

## Design tokens

| Token | Value | Used for |
| --- | --- | --- |
| background | `#F6F5F1` | App background |
| surface | `#FFFFFF` | Cards, nav bar, inputs |
| text | `#1A1C1E` | Primary text |
| text-muted | `#5B6167` | Labels, secondary text |
| border | `#DCDAD3` | Input and chip borders |
| divider | `#EEEDE8` | Row dividers, bar tracks |
| nav-border | `#E4E2DB` | Top border of bottom nav |
| segment-bg | `#E9E7E0` | Segmented control background |
| accent | `#0F766E` | Primary buttons, category bars, selected chips, current trend bar |
| accent-soft | `#B9DCD6` | Previous-period trend bars |
| accent-link | `#0F5E57` | Active nav item, links |
| person-you | `#1D4ED8` | Everything tagged to you |
| person-partner | `#C2410C` | Everything tagged to Sam |
| warning-bg | `#FFF4DE` | "Needs review" banner |
| warning-row | `#FFF8EB` | Uncategorised transaction rows |
| warning-text | `#8A5E00` / `#6B4A00` | "Needs category" text, banner text |
| spend-up | `#B42318` | Delta text when spending went up |

## Typography

- Body/UI: **DM Sans** (400, 500, 600, 700) from Google Fonts.
- Numbers (totals, amounts, keypad): **Space Grotesk** (500, 600, 700).
- Sizes: screen title 20/700; big total 40/600 with letter-spacing -1px; quick-add amount 52/600; card titles 15/600; row merchant 15/600; labels 13; secondary 12; nav labels 11.

## Shape and spacing

- Screen padding 20px sides; 16px gap between cards.
- Cards: white, radius 20px, padding 18–20px. Transaction groups: radius 16px.
- Buttons/inputs: min height 44px (touch target). Primary button 54px tall, radius 16px.
- Chips: height 36–38px, fully rounded, 1px border; selected = filled.
- Segmented control (Week/Month/Year, You/Sam): `segment-bg` track, 4px padding, selected segment white with a subtle shadow (or person colour on Quick add).
- Bottom nav: 84px tall, 5 slots (Overview, Activity, + button, Budgets, Settings); centre + is a 52px teal circle.
- Bars: 6px category bars with rounded ends on a `divider` track; split bar 10px showing you vs Sam.
- Icons: simple 2px stroke line icons (e.g. lucide-react). No emoji.

## Behaviour to keep

- Overview: Week / Month / Year switch changes every number on the screen; prev/next arrows step through periods; the "Needs review" banner links to Activity filtered to uncategorised.
- Activity: filter chips All / You / Sam / Needs review; rows grouped by day with a day total; uncategorised rows tinted and labelled "Needs category"; each row shows a person initial dot, merchant, "Category · Person · Source", amount.
- Quick add: amount keypad (max 2 decimals), You/Sam toggle defaulting to the logged-in person, category chips, Save.
- Mobile-first at 390px wide; on desktop centre the app in a max-width ~480px column.

## Additions since the approved mockups

- **Dark mode** follows the phone's setting. Every token above has a night value in `src/app/globals.css` (`prefers-color-scheme: dark`); use tokens, never raw colours, so both modes work.
- **Category icons**: lucide line icons in a 32px circle tinted `accent-soft`, from the curated set in `src/components/CategoryIcon.tsx` (the name is stored in `categories.icon`).
- **Motion**: sheets slide up (260ms) over a fading backdrop, and expanding lists rise in. All motion is off when the phone's Reduce Motion is on.
