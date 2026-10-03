# Sanjeevani — Caregiver Dashboard Spec

**Inputs to give the generator:** this file, `design.md` (Blend tokens) and `sanjeevani-logo.png`.

The dashboard must look like the same product as the landing page. Use the same tokens, the same Sanjeevani blues, the same type and the same card style.

**Who it's for:** the caregiver only. The elderly parent never sees any dashboard. Their only interface is a WhatsApp voice note.

**Its job:** an oversight room, not an operations room. The agent runs everything over WhatsApp. The caregiver opens the dashboard to check, before a trip, or when something feels off. **If she doesn't open it for three weeks, nothing should have slipped.**

---

## 0. Design rules

- **Tokens:** take everything from `design.md`, with these brand overrides:
  - Primary `#1A5DA6`: buttons, active nav, links, and the "Done by Sanjeevani" tag
  - Secondary `#3BB0E6`: sparkline lines, progress fills, highlights
  - Surfaces `#FFFFFF` and `#F5F7FA`; text `#0E121B`, secondary text `#717784`
- **Unlike the landing page, there are no decorative gradients here.** Follow Blend strictly: flat white cards, `1px #E1E4EA` borders, `12px` radius, `sm` shadow.
- **Font:** Inter.
  - Page title: 24px / 600
  - Card title: 16px / 600
  - Body: 14px / 400
  - Meta text: 12px / 400 `#717784`
  - Stat numbers: 32px / 700
- **Status colours always come with an icon and a word, never colour alone.** Green and amber are not distinguishable for colour-blind users (I validated this), so every status reads like `● On track`, `▲ Running low` or `■ Out soon`.

| Status | Fill | Text colour | Icon | Word |
|---|---|---|---|---|
| Good | `#00A63E` | `#008236` | ● circle-check | On track / Stable / Synced |
| Warning | `#EFB100` | `#A65F00` (the darker tone is needed for text contrast) | ▲ triangle | Running low / Rising / Needs a look |
| Critical | `#E7000B` | `#C10007` | ■ alert | Out soon / Failed / Action needed |
| Neutral / stale | `#99A0AE` | `#525866` | ◌ dashed circle | Unconfirmed / Waiting |

- **Two kinds of flag must never look alike.** Stock problems use the status colours above. Health-trend flags use an **orange chip with a chart icon** (`#FFEDD4` background, `#C2410C` text), so "medicine running low" never reads the same as "test result worth mentioning".
- **Tone of copy:** a family diary, not a system log.
  - Use the family's own names: "Maa", "Papa".
  - Write "Reordered Maa's BP medicine", not "Refill initiated for patient #2".
  - Never write diagnostic language. Write "worth mentioning to the doctor", never "abnormal" or "high risk".

---

## 1. Layout shell

```
┌───────────┬──────────────────────────────────────────────────────────────┐
│           │ TOP BAR (sticky, 64px)                                       │
│  SIDEBAR  ├──────────────────────────────────────────────────────────────┤
│  240px    │ TRAVEL BANNER (only when "I'm away" is on)                   │
│           ├──────────────────────────────────────────────────────────────┤
│  logo     │ FAMILY SWITCHER (tabs)                                       │
│           ├──────────────────────────────────────────────────────────────┤
│  nav      │ KPI TILES  ×4                                                │
│           ├────────────────────────────────────────┬─────────────────────┤
│           │ LEFT COLUMN (8/12)                     │ RIGHT RAIL (4/12)   │
│           │  • Member summary card                 │  • Needs your       │
│           │  • Stock tracker                       │    decision         │
│           │  • Trend tracker                       │  • Live delivery    │
│           │  • Activity log                        │  • Coming up        │
│           │                                        │  • ABHA records     │
│           │                                        │  • Care circle      │
│           │                                        │  • Payment mandate  │
│           ├────────────────────────────────────────┴─────────────────────┤
│           │ QUIET FOOTER LINE                                            │
└───────────┴──────────────────────────────────────────────────────────────┘
```

- Content padding is `32px`. The gap between cards is `16px`, and `24px` between rows.
- At 1024px or below, the right rail drops under the left column. Its order is: Needs your decision, then Live delivery, then the rest.
- On mobile, the sidebar becomes a bottom nav with 4 icons: Overview, Records, Activity, Family.

### Sidebar

| Element | Spec |
|---|---|
| Logo | Sanjeevani mark plus wordmark at the top, 32px tall |
| Nav items | `Overview` (active) · `Medicines` · `Records (ABHA)` · `Appointments` · `Activity` · `Family & access` · `Settings` |
| Active item | `#EFF6FF` background, `#1A5DA6` text, weight 600 |
| Bottom block | A small card reading "WhatsApp connected ✓", followed by the caregiver's number (masked) |

**For the demo, only `Overview` and `Records (ABHA)` need to be real pages.** The other nav items can route to Overview.

---

## 2. Top bar (sticky)

| Position | Element | Spec |
|---|---|---|
| Left | Greeting | "Good evening, Pursharth" (20px / 600), with "Sharma family" on the line below (12px, secondary) |
| Left | Sync line | `● Updated 2 min ago`. This one line answers "is this current?" before she asks. |
| Centre-right | **Global status pill** | One pill for the whole family. States: `● All good` (green tint), `▲ 1 needs a look` (amber tint), `■ Action needed` (red tint). Clicking it scrolls to *Needs your decision*. |
| Right | **"I'm away" toggle** | A switch labelled "I'm away". When it's on, the travel banner appears and the agent routes decisions to the secondary caregiver. |
| Right | Avatar | The caregiver's initials, in a circle |

---

## 3. Travel banner (conditional)

This is a full-width strip, shown only when "I'm away" is on. It uses a `#EFF6FF` background and a `1px #BEDBFF` border.

> ✈ **You're away until Sun, 12 Oct.** Routine refills continue within your limits. Anything new goes to **Rohan (brother)**. You'll get a summary when you land.

There is a `Change` link on the right.

**This is the demo's emotional moment.** When it's on, the KPI tile "Needs you" should read **0**.

---

## 4. Family switcher

- Horizontal tabs, one per person she manages: `Maa` · `Papa` · `Mummy-ji` · `Anya (daughter)`.
- Each tab shows a 24px initials avatar, the name, and a status dot with its icon (from the table in section 0).
- An `All` tab comes first and is the default: KPI tiles and the activity log cover everyone. Choosing a person filters the whole page to them.
- Style: Blend `pills` tabs. Active tab is `#1A5DA6` with white text.

---

## 5. KPI tiles (row of 4)

Stat tiles have no charts. Each holds a label, a big number and one line of context.

| Tile | Big number | Context line | Why it's here |
|---|---|---|---|
| **Missed care actions** | **0** | "this month" + green `● On track` | This is the outcome the agent is accountable for, so it gets the first tile. |
| Medicines covered | **21 days** | "Next auto-reorder: Amlodipine, Mon" | Shows coverage at a glance |
| Actions handled | **6** | "this week · 5 by Sanjeevani, 1 by you" | Makes the delegation visible |
| Records on ABHA | **18** | "3 kept locally · last sync 09:40" | Shows the ABHA unique selling point is live |

Each tile has a `16px` padding and a white card. The label is 12px secondary text above the number.

---

## 6. Left column

### 6.1 Member summary card (shown when one person is selected)

```
[Avatar 48px]  Maa · 68 · Lucknow
               ABHA: 91-••••-••••-4821  ● Linked
───────────────────────────────────────────────────────────────
Current medicines   Last test             Next appointment     Last refill
3 active            HbA1c 7.4 ▲ · 28 Sep  Dr. Mehta · Cardio   Apollo Pharmacy
                                          12 Oct · ● Confirmed Thu 2 Oct
```

- Four key-value columns. The label is 12px secondary text; the value is 14px / 500.
- On the right sits a secondary button: `Doctor summary ↓`. It produces the one-page PDF a doctor can read: medicines, last 3 results per test, allergies field, and recent visits.

### 6.2 Stock tracker

Card title: **"Medicines"**. To the right of the title, in grey: "Sanjeevani reorders 7 days before stock runs out".

One row per medicine:

```
Amlodipine 5mg · once daily        ███░░░░░░░░░░░░░░░░░   3 days   ■ Out soon
For Maa · Apollo Pharmacy          Reorder placed today · arriving Thu
                                   Last confirmed: delivery, 2 Oct  ✓
```

| Part | Spec |
|---|---|
| Name line | Medicine and dose (14px / 500), with "For Maa · pharmacy" underneath (12px secondary) |
| Bar | 8px track (`#F2F4F8`), pill-rounded. Fill width = `days_remaining / 30`. Fill colour is the status colour. |
| Days | A right-aligned number with the status icon and word |
| Next-step line | **Always present, so she knows what happens next.** One of these four: "Reorders automatically in 4 days" / "Reorder placed today · arriving Thu" / "Waiting for your approval" / "Paused by you" |
| Staleness | If delivery hasn't been confirmed within 48h, the bar turns grey with a dashed outline and shows `◌ Unconfirmed — last known 3 Oct`. **Stale data never looks clean.** |

Demo data (Maa):

| Medicine | Days | Status | Next step |
|---|---|---|---|
| Telmisartan 40mg · OD | 24 | ● On track | Reorders automatically in 17 days |
| Metformin 1000mg · BD | 11 | ● On track | Reorders automatically in 4 days |
| Amlodipine 5mg · OD | 3 | ■ Out soon | Reorder placed today · arriving Thu |

### 6.3 Trend tracker

Card title: **"Health trends"**. Subtitle: *"Sanjeevani flags patterns to mention to the doctor. It never diagnoses."*

One row per tracked metric:

```
HbA1c        ╱╱╱ (sparkline, 5 pts)    7.4 %  ▲   28 Sep    [📈 3 readings rising — mention to Dr. Mehta]
BP           ─── (sparkline)           132/84 →   today     ● Stable
Creatinine   ─── (sparkline)           0.9    →   12 Aug    [📈 Test due — last done 7 weeks ago]
```

| Part | Spec |
|---|---|
| Sparkline | 120×32 SVG. 2px line in `#3BB0E6`. No axes or grid. Mark the last point with an 8px dot. Shade the normal range as a band (`#F2F4F8`). |
| Hover | A tooltip showing each point's date and value |
| Value | 16px / 600, followed by an arrow ↑ ↓ → and the date in 12px secondary |
| Flag chip | Orange chart chip, only when a pattern fires: "3 readings rising", "Outside usual range" or "Test due" |

Demo data: HbA1c 6.8 → 6.9 → 7.1 → 7.2 → 7.4 · BP stable around 130/84 · Creatinine 0.9, last done 7 weeks ago.

### 6.4 Activity log (the trust panel)

Card title: **"What Sanjeevani did"**.

There are filter chips above the list: `All` · `Medicines` · `Appointments` · `Records` · `Needed you`.

Each row reads like a diary entry:

```
💊  Reordered Maa's Amlodipine from Apollo Pharmacy           Today 10:12   [Done by Sanjeevani]
    You were told at 09:58 · no STOP received · ₹184 via mandate                         ⌄
```

| Part | Spec |
|---|---|
| Type icon | 💊 medicine · 📅 appointment · 📄 record · 💳 payment · 🚚 delivery · 🔊 voice note to parent · ↗ escalation |
| Text | 14px, using family names |
| Time | Right-aligned, 12px secondary |
| **Decision tag** | One of: `Done by Sanjeevani` (blue tint) · `Approved by you` (green tint) · `Asked you` (grey) · `Handled by Rohan` (purple tint, used when the secondary caregiver decided) · `Failed — retried once` (red tint) |
| Expanded row (click) | Shows **What triggered it** (e.g. "Stock hit 3 days"), **What it did** (steps with the rail used: Gnani call to chemist, Pine Labs debit, Delhivery waybill), **Your window** ("Told you 09:58 · 10-min STOP window · no reply"), **Proof** (order ID, waybill, ABHA transaction ID), and an `Undo` / `Report a problem` link where it applies |

Demo rows, newest first:

1. 🔊 "Maa was told her medicine arrives Thursday" · 2:05pm · `Done by Sanjeevani` · expands to "Voice note, Hindi · ● Acknowledged: 'theek hai'"
2. 🚚 "Amlodipine shipped via local partner (Lucknow)" · 1:40pm · `Done by Sanjeevani`
3. 💳 "₹184 paid to Apollo Pharmacy" · 10:13am · `Done by Sanjeevani`
4. 💊 "Reordered Maa's Amlodipine" · 10:12am · `Done by Sanjeevani`
5. 📄 "Read Dr. Mehta's prescription · 1 name confirmed by you" · yesterday · `Asked you`
6. 📅 "Confirmed cardiology appointment with Dr. Mehta, 12 Oct" · Mon · `Approved by you`
7. 📄 "4 reports added to Maa's ABHA record" · Mon · `Done by Sanjeevani`

Below the list: a `View full log →` link.

---

## 7. Right rail

### 7.1 Needs your decision

**This is the only card that can demand action.** It sits at the top of the rail, with a `1px` amber border when it isn't empty.

Each item is a compact card: title, one-line context, and two buttons.

| Demo item | Context | Buttons |
|---|---|---|
| "New prescription from Dr. Rao — add Rosuvastatin 10mg to Papa's refills?" | "Read from photo, 30 Sep · 96% confidence" | `Add to refills` (primary) · `Review` (secondary) |
| "Couldn't read one medicine name clearly" | Thumbnail crop of the handwriting, plus "Amlodipine or Amlokind?" | Two choice buttons, one per option |

**Empty state:** `● Nothing needs you right now.` (green check, 14px). This empty state is the product working.

### 7.2 Live delivery

This card appears while an order is in flight. It uses a vertical stepper (Blend Stepper, vertical):

```
Amlodipine 5mg · for Maa · Lucknow
● Reorder triggered          Today 09:58
● You were told (no STOP)    10:08
● Apollo confirmed stock     10:11
● Paid ₹184 · Pine Labs      10:13
● Shipped · Local partner    13:40   ← chip: "Tier-2 route"
◌ Delivered                  Expected Thu
◌ Maa told by voice note     after delivery
```

- Completed steps show a green check; pending steps show a grey dashed circle.
- The route chip reads either `Delhivery` or `Local partner · Tier-2`.
- **The last step is always "Maa told by voice note", and it only completes after delivery.** That shows the rule: the parent hears only outcomes.

### 7.3 Coming up (next 14 days)

A simple list, not a calendar grid:

```
Mon 6    Metformin auto-reorder (Maa)            💊
Thu 9    Amlodipine arrives (Maa)                🚚
Sat 12   Dr. Mehta · Cardiology (Maa) · 11:00    📅  ● Confirmed
Tue 15   HbA1c test due (Maa)                    🧪  ▲ Not booked
```

### 7.4 ABHA records

Card title: **"Health records · ABHA"**, with a small `ABDM-linked` chip.

| Row | Content |
|---|---|
| Summary | **18 on ABHA** · **3 kept locally** (with a tooltip: "From clinics not on ABDM — still in your record, can't sync yet") |
| Last sync | `● Synced 09:40` |
| Recent documents (3) | A type icon and name, e.g. "Lipid profile · Dr. Lal PathLabs · 28 Sep", plus a status chip: `Synced to ABHA` / `Kept locally` / `Needs confirmation` |
| Footer links | `Open all records →` · `Doctor summary ↓` |

### 7.5 Care circle

```
You (Pursharth)       Primary   ● Away until 12 Oct
Rohan (brother)       Backup    ● Reachable · receives decisions while you're away
Maa                   Parent    🔊 Voice notes only · Hindi
```

At the bottom is a small `Manage access` link. Maa's row makes the design visible: **the parent's only channel is voice notes.**

### 7.6 Payment mandate

```
Pine Labs standing mandate      ● Active
Medicines & tests · up to ₹3,000 / month
Used this month   ████████░░░░░░░  ₹1,184 of ₹3,000
Last debit        ₹184 · Apollo · today
```

- Show a progress bar (sm, 4px, fill `#1A5DA6`).
- Add one line of grey text: "Anything above your limit comes to you first."

---

## 8. Quiet footer line

This centred line sits at the bottom of the content, 14px, `#717784`:

> ● **Nothing else needs you right now.** Next summary on Sunday morning.

When something is pending, it changes to: `1 thing needs you — see Needs your decision ↑`.

---

## 9. Records (ABHA) page — second real page

Breadcrumb: `Overview / Records (ABHA)`.

- **Header strip:** person selector · ABHA ID (masked) · `● Linked` · `Download doctor summary` (primary button).
- **Filter tabs** (Blend underline style): `All` · `Prescriptions` · `Lab reports` · `Discharge` · `Scans`.
- **Table** (Blend DataTable). Columns:
  - Date
  - Type (icon and label)
  - From (clinic or lab)
  - Source (`WhatsApp` / `Email` / `Doctor input`)
  - Extraction (`● 98%` or `▲ Confirmed by you`)
  - ABHA status (`Synced` / `Kept locally` / `Retrying`)
- **Clicking a row opens a right drawer** (400px) with two panes:
  - Left pane: the original image or PDF thumbnail
  - Right pane: the extracted fields, the FHIR resource type (`MedicationRequest`, `DiagnosticReport`) in a mono chip, and a `View FHIR JSON` toggle that shows the bundle
- **Side note card:** "Records from clinics not on ABDM stay in your Sanjeevani record and sync automatically if the clinic joins."

---

## 10. Demo state (single JSON drives everything)

The page reads `state.json`, polling it every 3s or reloading on each step. An orchestration script rewrites the file to move the story forward.

```json
{
  "caregiver": { "name": "Pursharth", "away": false, "away_until": "2026-10-12" },
  "backup": { "name": "Rohan", "relation": "brother", "reachable": true },
  "global_status": "attention",
  "last_sync": "2026-10-03T09:40:00+05:30",
  "members": [
    {
      "id": "maa", "name": "Maa", "age": 68, "city": "Lucknow",
      "abha": "91-xxxx-xxxx-4821", "status": "attention",
      "medicines": [
        { "name": "Telmisartan 40mg", "freq": "OD", "days_left": 24, "pharmacy": "Apollo", "next": "auto_reorder", "next_in_days": 17, "confirmed": true },
        { "name": "Metformin 1000mg", "freq": "BD", "days_left": 11, "pharmacy": "Apollo", "next": "auto_reorder", "next_in_days": 4, "confirmed": true },
        { "name": "Amlodipine 5mg", "freq": "OD", "days_left": 3, "pharmacy": "Apollo", "next": "reorder_placed", "eta": "Thu", "confirmed": true }
      ],
      "trends": [
        { "metric": "HbA1c", "unit": "%", "points": [6.8, 6.9, 7.1, 7.2, 7.4], "last": "2026-09-28", "flag": "rising" },
        { "metric": "BP", "unit": "mmHg", "points": ["128/82", "131/84", "130/83", "133/85", "132/84"], "last": "2026-10-03", "flag": null },
        { "metric": "Creatinine", "unit": "mg/dL", "points": [0.9, 0.9, 0.9], "last": "2026-08-12", "flag": "test_due" }
      ],
      "next_appointment": { "doctor": "Dr. Mehta", "specialty": "Cardiology", "date": "2026-10-12T11:00", "status": "confirmed" }
    }
  ],
  "decisions": [],
  "delivery": { "item": "Amlodipine 5mg", "for": "maa", "route": "local_partner", "step": 4 },
  "activity": [],
  "abha": { "synced": 18, "local": 3, "last_sync": "09:40" },
  "mandate": { "provider": "Pine Labs", "cap": 3000, "used": 1184, "status": "active" },
  "kpis": { "missed_actions": 0, "days_covered": 21, "actions_week": 6, "records_on_abha": 18 }
}
```

### Demo controls

These are hidden; press `Shift + D` to open them. A small floating panel steps through the scenario:

| Step | What changes on screen |
|---|---|
| 1. Normal day | Status pill `● All good`. Amlodipine at 4 days `▲ Running low`. |
| 2. Caregiver boards a flight | Toggle "I'm away". The travel banner appears and Rohan becomes active in the care circle. |
| 3. Stock hits 3 days | Amlodipine turns `■ Out soon`. A new log row: "Told you at 09:58". |
| 4. No STOP, reorder placed | The delivery stepper fills to *Paid*. Log rows arrive with `Done by Sanjeevani`. |
| 5. New prescription arrives | A card appears in *Needs your decision*. Because she's away, it shows "Sent to Rohan". |
| 6. Rohan approves | The card clears. The log row reads `Handled by Rohan`. |
| 7. Delivered | Stepper complete. The voice-note step ticks. Log row: "Maa was told…". The footer reads "Nothing else needs you right now". |
| 8. She lands | Toggle off. A one-time summary toast: "While you were away: 4 actions, 0 missed." |

---

## 11. Don'ts

- No charts beyond the sparklines and the progress and stock bars. A big line chart adds build time without adding meaning.
- No colour-only status. Every status shows its icon and word.
- No diagnostic or dosage advice anywhere. Trends are "worth mentioning", never "abnormal".
- No parent-facing UI, and no "send reminder to Maa" button. The parent only ever receives outcome voice notes.
- No silent states. Every medicine shows its next step, and every agent action has a log row.
- No settings screens for the demo.

---

## 12. Build order (one day)

1. Shell: sidebar, top bar, and the `state.json` loader
2. Stock tracker and Activity log. These two carry the trust story.
3. Needs your decision and Live delivery stepper
4. KPI tiles, Trend tracker (SVG sparklines) and Care circle
5. Travel banner, Demo controls and the quiet footer
6. ABHA records card, then the Records page (if time allows)