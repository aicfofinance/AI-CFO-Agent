# Frontend Guidelines
## AI CFO Agent — V1

**Version:** 0.1  
**Date:** July 2026  
**Applies to:** Next.js 15 application, Tailwind CSS v4, shadcn/ui components

---

## 1. Design Philosophy

This product sits between two things that do not currently exist for its user: the financial clarity they need and the expertise they can afford. The design must earn the trust of a person making real decisions with real money — a misread number or a confusing layout is not an aesthetic failure, it is a product failure. Every visual choice should communicate precision, reliability, and considered judgment. The product should feel like the CFO workstation of a well-run company — clean and dense with meaning, not sparse and decorative. The one deliberate departure from a pure data tool: the conversational AI response area should feel like a written analysis from a knowledgeable advisor, not a message from a chatbot. Generous line height, restrained typography, and editorial spacing in that zone signal that the answer was considered, not retrieved.

---

## 2. Color System

### 2.1 Primary — Steel Blue

A deep, confident blue chosen for institutional authority. Not the saturated cobalt of consumer apps. Passes WCAG AA at the 500 level (6.2:1 against white), AAA at 600 and below.

| Token | Hex | Usage |
|---|---|---|
| `primary-50` | `#EEF4FF` | Hover and active background tints |
| `primary-100` | `#D9E9FF` | Selected state backgrounds, banners |
| `primary-200` | `#B3D3FF` | AI response left-border accent, borders |
| `primary-300` | `#8DBDFF` | Decorative dividers on dark surfaces |
| `primary-400` | `#67A7FF` | Icons on dark backgrounds |
| `primary-500` | `#2557A7` | **Core action color — buttons, links, interactive states** |
| `primary-600` | `#1E4890` | Button hover state, focused outlines |
| `primary-700` | `#183979` | Pressed/active state |
| `primary-800` | `#112A62` | Text on light primary backgrounds |
| `primary-900` | `#0A1B4B` | Headings on very light primary tints |

### 2.2 Semantic Financial Colors

These colors carry meaning specific to financial data. Use them only for their defined semantic purpose — never as decorative accents.

#### Gain (Positive / Growth)

| Token | Hex | Usage |
|---|---|---|
| `gain-50` | `#F0FBF4` | Positive metric background tint |
| `gain-100` | `#DCFCE7` | Badge and chip backgrounds for gains |
| `gain-200` | `#A7F3C7` | Borders on gain indicators |
| `gain-500` | `#16A34A` | **Gain icons and small indicators** (not text, fails AA) |
| `gain-600` | `#15803D` | **Gain text on white** (4.6:1, passes AA) |
| `gain-700` | `#166534` | Gain text on gain-50/100 backgrounds |

> **Accessibility rule:** Never use `gain-500` for text. Use `gain-600` minimum for any text that must be read, `gain-700` for text smaller than 18px.

#### Loss (Negative / Decline)

| Token | Hex | Usage |
|---|---|---|
| `loss-50` | `#FFF1F1` | Negative metric background tint |
| `loss-100` | `#FFE4E4` | Badge and chip backgrounds for losses |
| `loss-200` | `#FFBDBD` | Borders on loss indicators |
| `loss-500` | `#E63946` | **Loss icons and small indicators** (not text alone, 3.9:1) |
| `loss-600` | `#C42030` | **Loss text on white** (5.5:1, passes AA) |
| `loss-700` | `#A21520` | Loss text on loss-50/100 backgrounds |

> **Accessibility rule:** Never use `loss-500` as the only indicator. Pair with an icon or text sign. Use `loss-600` minimum for any text.

#### Warning (Watch / Caution)

| Token | Hex | Usage |
|---|---|---|
| `warning-50` | `#FFFBEB` | Warning banner background |
| `warning-100` | `#FEF3C7` | Warning badge background |
| `warning-200` | `#FDE68A` | Warning borders |
| `warning-500` | `#D97706` | Warning icons |
| `warning-600` | `#B45309` | Warning text on white (5.9:1, passes AA) |
| `warning-700` | `#92400E` | Warning text on light warning backgrounds |

#### Neutral Change (Flat / Unchanged)

| Token | Hex | Usage |
|---|---|---|
| `neutral-change` | `#64748B` | Flat/unchanged percentage indicators |

### 2.3 Semantic UI Colors

Each semantic color is defined in three variants: `bg` (backgrounds, banners), `text` (typography), and `border`.

| Role | bg | text | border |
|---|---|---|---|
| **Success** | `#F0FBF4` | `#166534` | `#A7F3C7` |
| **Error** | `#FFF1F1` | `#A21520` | `#FFBDBD` |
| **Warning** | `#FFFBEB` | `#92400E` | `#FDE68A` |
| **Info** | `#EEF4FF` | `#1E4890` | `#B3D3FF` |

### 2.4 Neutral Scale — Slate

A cool-toned neutral with a faint blue undertone. Correct for financial product UIs where pure warm grays feel casual and pure cool grays feel sterile.

| Token | Hex | Usage |
|---|---|---|
| `gray-50` | `#F8FAFC` | Page background |
| `gray-100` | `#F1F5F9` | Sidebar, secondary surfaces, table headers |
| `gray-200` | `#E2E8F0` | Default borders, dividers, skeleton |
| `gray-300` | `#CBD5E1` | Disabled borders, subtle separators |
| `gray-400` | `#94A3B8` | Placeholder text, muted icons, disabled state |
| `gray-500` | `#64748B` | Secondary body text, form helper text |
| `gray-600` | `#475569` | Body text (sufficient contrast on white: 5.9:1) |
| `gray-700` | `#334155` | Strong secondary text |
| `gray-800` | `#1E293B` | Primary text on white |
| `gray-900` | `#0F172A` | Heading text, maximum contrast body text |
| `gray-950` | `#020617` | Reserved for absolute maximum contrast situations |

### 2.5 Surface and Background Tokens

| Token | Hex | Description |
|---|---|---|
| `surface-page` | `#F8FAFC` | Application page background |
| `surface-card` | `#FFFFFF` | Default card, panel, and section background |
| `surface-elevated` | `#FFFFFF` | Modals, dropdowns, command palette (relies on shadow for elevation) |
| `surface-sidebar` | `#F1F5F9` | Navigation and sidebar background |
| `border-default` | `#E2E8F0` | Borders between components, table dividers |
| `border-subtle` | `#F1F5F9` | Very subtle separators within cards |
| `border-strong` | `#CBD5E1` | Emphasized borders, focused input borders |

### 2.6 Text Hierarchy

| Role | Hex | Context |
|---|---|---|
| `text-primary` | `#0F172A` | Default body text, metric values |
| `text-secondary` | `#475569` | Labels, metadata, secondary information |
| `text-muted` | `#94A3B8` | Timestamps, placeholder text, disabled labels |
| `text-disabled` | `#CBD5E1` | Disabled input text |
| `text-inverse` | `#F8FAFC` | Text on dark/primary-colored backgrounds |
| `text-link` | `#2557A7` | Hyperlinks and interactive text |
| `text-link-hover` | `#1E4890` | Hovered hyperlinks |

### 2.7 CSS Custom Properties

Add to `globals.css`:

```css
:root {
  /* Primary */
  --primary-50: #EEF4FF;
  --primary-100: #D9E9FF;
  --primary-200: #B3D3FF;
  --primary-300: #8DBDFF;
  --primary-400: #67A7FF;
  --primary-500: #2557A7;
  --primary-600: #1E4890;
  --primary-700: #183979;
  --primary-800: #112A62;
  --primary-900: #0A1B4B;

  /* Gain */
  --gain-50: #F0FBF4;
  --gain-100: #DCFCE7;
  --gain-200: #A7F3C7;
  --gain-500: #16A34A;
  --gain-600: #15803D;
  --gain-700: #166534;

  /* Loss */
  --loss-50: #FFF1F1;
  --loss-100: #FFE4E4;
  --loss-200: #FFBDBD;
  --loss-500: #E63946;
  --loss-600: #C42030;
  --loss-700: #A21520;

  /* Warning */
  --warning-50: #FFFBEB;
  --warning-100: #FEF3C7;
  --warning-200: #FDE68A;
  --warning-500: #D97706;
  --warning-600: #B45309;
  --warning-700: #92400E;

  /* Neutrals */
  --gray-50:  #F8FAFC;
  --gray-100: #F1F5F9;
  --gray-200: #E2E8F0;
  --gray-300: #CBD5E1;
  --gray-400: #94A3B8;
  --gray-500: #64748B;
  --gray-600: #475569;
  --gray-700: #334155;
  --gray-800: #1E293B;
  --gray-900: #0F172A;
  --gray-950: #020617;

  /* Surfaces */
  --surface-page: #F8FAFC;
  --surface-card: #FFFFFF;
  --surface-elevated: #FFFFFF;
  --surface-sidebar: #F1F5F9;

  /* Borders */
  --border-default: #E2E8F0;
  --border-subtle: #F1F5F9;
  --border-strong: #CBD5E1;

  /* Text */
  --text-primary: #0F172A;
  --text-secondary: #475569;
  --text-muted: #94A3B8;
  --text-disabled: #CBD5E1;
  --text-inverse: #F8FAFC;
  --text-link: #2557A7;
}
```

### 2.8 Tailwind v4 Theme Configuration

Add to `app.css` (Tailwind v4 uses CSS-native `@theme`):

```css
@theme {
  --color-primary-50: #EEF4FF;
  --color-primary-500: #2557A7;
  --color-primary-600: #1E4890;
  --color-gain-600: #15803D;
  --color-gain-700: #166534;
  --color-loss-600: #C42030;
  --color-warning-600: #B45309;
  /* ... extend as needed */
}
```

---

## 3. Typography

### 3.1 Typeface Selection

**UI Font: Inter**
The standard for data-dense product interfaces. Inter's optical sizing and tabular number support make it correct for this use case. Numerals in Inter with `font-feature-settings: 'tnum' 1` produce perfectly aligned financial columns.

**Monospace Font: IBM Plex Mono**
For transaction IDs, account numbers, specific date/time values, and developer-facing content. More refined than JetBrains Mono for a financial product — slightly condensed, excellent legibility.

> **Implementation note:** Do NOT use CSS `@import` from Google Fonts CDN. Use Next.js's `next/font/google` in `src/app/layout.tsx` instead. `next/font/google` self-hosts the font files at build time, eliminating the Google CDN request, preventing FOUC (flash of unstyled text), and improving Core Web Vitals. CSS `@import` and `next/font/google` loaded simultaneously would cause fonts to download twice.

```typescript
// src/app/layout.tsx
import { Inter, IBM_Plex_Mono } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${ibmPlexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

**CSS Font Stacks** (consumed via the CSS variables set by `next/font/google`):

```css
:root {
  /* These are set automatically by next/font/google via the variable option above */
  /* --font-sans and --font-mono are injected at runtime */
}

/* Tailwind config reference — these CSS variables are the source of truth */
/* In Tailwind v4 @theme, reference as: --font-family-sans: var(--font-sans) */
```

### 3.2 Numeric Rendering

All currency values, percentages, and data in tables must use tabular figures. Apply to any element containing financial data:

```css
.font-numeric {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1, 'lnum' 1;
  font-family: var(--font-sans);
}
```

Use the `font-mono` stack for account IDs, transaction reference numbers, and API identifiers where a distinct data-entry feel is appropriate. Do not use monospace for currency values in the dashboard UI — use Inter with tabular figures instead.

### 3.3 Type Scale

16px base (1rem = 16px throughout the application). Never set font size in px on body text — use rem so browser accessibility zoom works correctly.

| Label | rem | px equiv | Weight | Line Height | Tailwind | Usage |
|---|---|---|---|---|---|---|
| `metric-xl` | 2.5rem | 40px | 600 | 1.15 | `text-5xl font-semibold` | Hero KPI values on dashboard |
| `metric-lg` | 2rem | 32px | 600 | 1.2 | `text-4xl font-semibold` | Primary metric cards |
| `metric` | 1.5rem | 24px | 600 | 1.25 | `text-2xl font-semibold` | Secondary metrics, report figures |
| `display` | 2.25rem | 36px | 700 | 1.2 | `text-4xl font-bold` | Landing page only |
| `h1` | 1.875rem | 30px | 600 | 1.3 | `text-3xl font-semibold` | Page titles |
| `h2` | 1.5rem | 24px | 600 | 1.35 | `text-2xl font-semibold` | Section headings |
| `h3` | 1.25rem | 20px | 600 | 1.4 | `text-xl font-semibold` | Card headings |
| `h4` | 1.125rem | 18px | 500 | 1.4 | `text-lg font-medium` | Sub-headings |
| `body-lg` | 1rem | 16px | 400 | 1.85 | `text-base leading-relaxed` | **AI response body text** |
| `body` | 0.9375rem | 15px | 400 | 1.6 | `text-[15px]` | General UI text, form inputs |
| `body-sm` | 0.875rem | 14px | 400 | 1.5 | `text-sm` | Secondary text, table cells |
| `caption` | 0.75rem | 12px | 400 | 1.4 | `text-xs` | Timestamps, footnotes, tooltips |
| `label` | 0.75rem | 12px | 500 | 1.4 | `text-xs font-medium` | Form labels, table column headers |
| `mono` | 0.875rem | 14px | 400 | 1.5 | `text-sm font-mono` | Monospaced data, IDs |

> **The metric scale is separate from the heading scale.** Metric values are not headings — they are data. They should be set in `font-semibold` (600) with tabular figures and tight line height. Never use H2 styling to display a revenue figure.

---

## 4. Spacing System

Base unit: **4px**. All spacing decisions are multiples of this unit. This prevents the arbitrary 13px/17px gaps that accumulate in financial UIs over time.

| Token | px | rem | Tailwind class |
|---|---|---|---|
| `space-0` | 0px | 0 | — |
| `space-1` | 4px | 0.25rem | `p-1` / `m-1` |
| `space-2` | 8px | 0.5rem | `p-2` / `m-2` |
| `space-3` | 12px | 0.75rem | `p-3` / `m-3` |
| `space-4` | 16px | 1rem | `p-4` / `m-4` |
| `space-5` | 20px | 1.25rem | `p-5` / `m-5` |
| `space-6` | 24px | 1.5rem | `p-6` / `m-6` |
| `space-8` | 32px | 2rem | `p-8` / `m-8` |
| `space-10` | 40px | 2.5rem | `p-10` / `m-10` |
| `space-12` | 48px | 3rem | `p-12` / `m-12` |
| `space-16` | 64px | 4rem | `p-16` / `m-16` |
| `space-20` | 80px | 5rem | `p-20` / `m-20` |
| `space-24` | 96px | 6rem | `p-24` / `m-24` |

**Contextual spacing rules:**

- Metric card inner padding: `space-6` (24px) — generous enough to breathe, dense enough to feel like a dashboard
- Table cell padding: `12px 16px` (space-3 vertical, space-4 horizontal)
- Section gap on dashboard: `space-6` between card rows
- Chat message gap: `space-4` between a user message and the following AI response; `space-8` before a new question in the thread
- AI response paragraph spacing: `space-4` between paragraphs (do not use margin on `<p>` by default — it will be too tight for the editorial feel needed)
- Form row gap: `space-4`
- Navigation item height: `space-10` (40px)
- Page horizontal padding: `space-8` at xl, `space-6` at md

---

## 5. Border Radius

Financial and data UIs use restrained border radius. Excessive rounding reads as consumer, not professional. The scale is deliberately conservative.

| Token | px | Tailwind | When to use |
|---|---|---|---|
| `radius-none` | 0px | `rounded-none` | Table cells, data grid cells, chart containers, sparklines. Data containers should feel flush and grid-aligned. |
| `radius-sm` | 2px | `rounded-sm` | Status badges, metric change indicators, small number chips |
| `radius-md` | 4px | `rounded` | Buttons (all variants), form inputs, select dropdowns, tooltips |
| `radius-lg` | 6px | `rounded-md` | Metric cards, content panels, sidebar sections |
| `radius-xl` | 8px | `rounded-lg` | Modals and dialogs, command palette, floating popovers |
| `radius-2xl` | 12px | `rounded-xl` | Use sparingly — only for large onboarding cards or empty states |
| `radius-full` | 9999px | `rounded-full` | Pill-shaped badges, avatar initials circles, toggle switches, notification dots |

**Hard rule:** Chart containers and data tables use `radius-none`. Adding border radius to a chart container gives it a "widget" feeling that undermines data credibility. Tables with rounded corners look like marketing cards, not financial records.

**Button radius:** 4px (`rounded`). Not pill-shaped buttons in the primary UI — this is a financial tool, not a consumer app.

---

## 6. Shadow and Elevation System

Financial dashboards should feel grounded. Dramatic shadows make a product feel like it's trying to impress rather than inform. Use the minimum elevation needed to communicate hierarchy.

| Level | CSS value | Tailwind | When to use |
|---|---|---|---|
| `shadow-none` | `none` | `shadow-none` | Data tables, inline elements, chart containers, flat metric tiles. Most surfaces. |
| `shadow-xs` | `0 1px 2px rgba(15, 23, 42, 0.05)` | `shadow-sm` | Metric cards in their resting state — a barely-perceptible lift to distinguish them from the page background |
| `shadow-sm` | `0 2px 8px rgba(15, 23, 42, 0.09)` | `shadow` | Dropdown menus, select options, tooltip containers |
| `shadow-md` | `0 4px 16px rgba(15, 23, 42, 0.12)` | `shadow-md` | Modal dialogs, command palette, side sheets |
| `shadow-inner` | `inset 0 1px 3px rgba(15, 23, 42, 0.07)` | `shadow-inner` | Input fields in focus state, search boxes |

**What not to do:** Do not apply `shadow-md` or stronger to metric cards or dashboard panels. Heavy card shadows read as a design-forward consumer app, not a data instrument. Metric cards on a light `surface-page` background are distinguished by their `surface-card` (#FFFFFF) fill and a 1px `border-default` border, not by shadow depth.

---

## 7. Financial Data Display Conventions

These conventions apply uniformly across the dashboard, AI responses, reports, and exports. Consistency in how numbers appear is a trust signal.

### 7.1 Currency Formatting

**Standard format:** `$1,234.56` — two decimal places, comma thousands separator, dollar sign prefix, no space between sign and number.

**Large numbers in chart labels and tooltips:** Abbreviate above $10,000:
- `$45.3K` for $45,300–$99,999
- `$1.2M` for $1,200,000+
- `$4.5B` for $4,500,000,000+

**Full precision in data tables:** Always show full values — never abbreviate in a table cell where the user may be cross-referencing.

**Alignment:** Right-align all currency columns in tables. All currency columns must use `font-feature-settings: 'tnum' 1` so decimal points and digits align vertically.

**Negative values:** Use `−` (Unicode minus, U+2212) with `loss-600` (#C42030) text color. Never use parentheses `(1,234.56)` — this is old accounting convention that reduces readability and requires training to interpret. Never use a plain hyphen-minus `-` for negative currency.

```tsx
// Correct
<span className="text-loss-600 font-numeric">−$1,234.56</span>

// Wrong
<span>(1,234.56)</span>
<span>-$1,234.56</span>
```

**Zero values:** Display as `$0.00` in `text-muted` color. Never hide zero values or replace them with a dash.

### 7.2 Percentage Changes

**Format:** Always include the sign. Use `+` for positive, `−` (Unicode minus) for negative, nothing for zero.

- Positive: `+12.3%` in `gain-600` (#15803D)
- Negative: `−4.2%` in `loss-600` (#C42030)
- Zero/flat: `0.0%` in `neutral-change` (#64748B)

**Decimal places:** One decimal place for percentage changes in the UI. Two decimal places only in export CSV files.

**Never write:** `12.3% increase` — this is redundant. The sign and color carry the direction.

### 7.3 Trend Indicators

Every financial change value pairs a visual indicator with the color and number. Never rely on color alone.

| Direction | Symbol | Color token | Aria label pattern |
|---|---|---|---|
| Positive | `▲` | `gain-600` | `aria-label="Up 12.3% from prior month"` |
| Negative | `▼` | `loss-600` | `aria-label="Down 4.2% from prior month"` |
| Flat | `→` | `neutral-change` | `aria-label="Unchanged from prior month"` |

The arrow renders at the same size as the percentage text, inline before the number. No separate icon component needed — Unicode arrows are correct here. Do not use SVG arrows in metric cards; they add visual complexity for no benefit.

```tsx
// MetricChange component pattern
<span className="inline-flex items-center gap-0.5 text-sm font-numeric">
  <span aria-hidden="true">▲</span>
  <span>+12.3%</span>
  <span className="sr-only">up 12.3% from prior month</span>
</span>
```

### 7.4 Date and Time Formatting

| Context | Format | Example |
|---|---|---|
| Month label (chart axis) | `MMM` | `Jun` |
| Month header (report title) | `MMMM YYYY` | `June 2026` |
| Sync timestamp | `MMM D [at] h:mm A` | `Jun 19 at 3:42 PM` |
| Transaction date (table) | `MMM D, YYYY` | `Jun 19, 2026` |
| Relative time (alerts) | `N [minutes/hours/days] ago` | `2 hours ago` |

Always use the organization's configured timezone for display. Show UTC only in developer-facing logs.

### 7.5 Table Conventions for Financial Data

- **Column alignment:** Category/label columns left-aligned. All numeric columns right-aligned. Percentage columns right-aligned.
- **Column header:** `label` typography (12px, 500 weight), `text-secondary` color, `gray-100` background with 1px `border-default` bottom border.
- **Row height:** 44px for data rows. Provides room to read without feeling spacious.
- **Row hover:** `gray-50` background on hover. No transform, no shadow change.
- **Row separator:** 1px `border-subtle` horizontal rule. Never use full row striping — alternating background colors conflict with gain/loss background tints.
- **Font feature:** All number cells apply `.font-numeric` (tabular-nums).
- **Empty cell:** Show `—` (em dash) in `text-muted`. Never blank cells in financial tables — they are ambiguous.
- **Negative numbers:** In table cells, `loss-600` text only (no background tint on individual cells — too noisy).

### 7.6 Chart Color Conventions

All charts use a restrained palette. The data should be the focus, not the charting chrome.

| Element | Hex | Notes |
|---|---|---|
| Primary data series | `#2557A7` (primary-500) | The current period, the main line |
| Comparison series | `#CBD5E1` (gray-300) | Prior period comparison, always behind primary |
| Current month bar (partial) | `#8DBDFF` (primary-300) | Visually distinguishes incomplete current month |
| Positive fill area | `#F0FBF4` (gain-50) with `#16A34A` (gain-500) stroke | For area charts showing profit |
| Negative fill area | `#FFF1F1` (loss-50) with `#E63946` (loss-500) stroke | For area charts showing loss |
| Grid lines | `#F1F5F9` (gray-100) | Barely visible — data over decoration |
| Axis text | `#64748B` (gray-500) at `caption` size | |
| Zero reference line | `#CBD5E1` (gray-300) at 1px | Solid, not dashed |
| Tooltip background | `#0F172A` (gray-900) at 92% opacity | Dark tooltip on light dashboard |

**Chart container:** No border radius (`radius-none`). No drop shadow. A 1px `border-default` border on all four sides if the chart lives inside a card with other content; no border if the chart is the full card content.

---

## 8. Conversational UI Conventions

The `/ask` interface is the product's primary value delivery mechanism. Its visual design must communicate that the AI response is a considered analysis, not a chat reply.

### 8.1 User Messages vs. AI Responses

**User messages:**
- Right-aligned, width constrained to 72% of the conversation container
- Background: `gray-100` (#F1F5F9)
- Border radius: `radius-xl` on three corners (top-left, bottom-left, bottom-right), `radius-sm` on top-right
- Padding: `12px 16px` (space-3 vertical, space-4 horizontal)
- Typography: `body` (15px, 400 weight), `text-primary`
- No avatar — the question context is clear

**AI responses — the critical design decision:**

AI responses are not in bubbles. They are set as editorial content, like a written memo or a research note.

- Full container width, left-aligned
- No background fill
- Left border: `3px solid #B3D3FF` (primary-200) — a structural accent that separates the response from the question without boxing it
- Padding: `space-6` (24px) all sides
- Typography: `body-lg` (16px, 400 weight, line-height 1.85)
- Paragraph spacing: `space-4` (16px) between paragraphs within a single response
- Distance between last AI response and next user input: `space-10` (40px)

The expanded line height (1.85) and paragraph breathing room are deliberate. They signal that the answer was written, not retrieved. This is the single most important typographic decision in the product — when a user reads the AI's analysis of their cash position, it should feel like their CFO wrote them a note, not like they received a Slack message.

### 8.1.1 Currency Formatting Inside AI Streamed Text

AI-generated response text is streamed as plain text and rendered via markdown — it is not processed through `formatCurrency()` or the `<CurrencyAmount>` component. This means the formatting conventions in Section 7 do not apply automatically to AI output. The system prompt in `src/lib/ai/prompts/system.ts` must explicitly instruct the AI to format monetary values consistently.

**Rule:** The system prompt must include the following instruction (or equivalent):

> "When referencing dollar amounts, always format as: `$1,234.56` (US dollar sign, comma-separating thousands, two decimal places). Use the Unicode minus sign (−) not a hyphen (-) for negative values: `−$1,234.56`. Never abbreviate amounts below $100,000 (write `$45,200.00` not `$45.2K`). For amounts $100,000 and above, abbreviation is acceptable: `$1.2M`, `$145K`."

**Why this matters:** The dashboard renders `$45,200.00` via `<CurrencyAmount>`. If the AI response says "your revenue was $45200" (no comma, no decimal), the same number appears in two different formats on the same screen. This is a trust signal — inconsistent number formatting makes the product feel unpolished and untrustworthy for a financial tool.

**Post-processing is not applied:** The `AIResponse` component renders markdown-parsed text directly. There is no pass over the output to normalize number formats. The prompt instruction is the only enforcement mechanism.

### 8.2 Financial Disclaimer

The disclaimer appears below every AI-generated response. It is not a banner or a toast — it is an inline footer to the response itself.

```
Visual spec:
- Top separator: 1px border-subtle line, space-4 above it
- Text: caption (12px, 400 weight)
- Color: text-muted (#94A3B8)
- Italic: yes
- Content: "AI-generated analysis of your accounting data. Not financial advice."
- Links: "Not financial advice" links to Terms of Service in text-muted with underline
```

The disclaimer is never dismissible. It is never hidden on scroll. It renders even if the AI response is an error message.

### 8.3 AI Uncertainty and Low-Confidence Responses

When the AI is working from incomplete data (sync gap, structural limitation, or date range boundary), the response container signals this without alarming the user.

**Visual treatment:**
- Left border changes from `primary-200` (#B3D3FF) to `warning-200` (#FDE68A)
- A small amber indicator dot (6px, `warning-500`) precedes the response
- The response opens with a `⚠ Data note:` prefix in `warning-600` (#B45309), `body-sm` size, followed by the explanation
- The substantive answer follows in normal `body-lg` styling

```
Example rendering:
┌ ● ─────────────────────────────────────────────┐
│ ⚠ Data note: My last successful sync was 4 days │
│ ago. Transactions since June 15 aren't below.   │
│                                                  │
│ Based on data through June 15:                   │
│                                                  │
│ [answer text here in normal body-lg styling]     │
│                                                  │
│ ─────────────────────────────────────────────    │
│ AI-generated analysis. Not financial advice.     │
└──────────────────────────────────────────────────┘
```

### 8.4 Loading State While AI Generates

No spinning indicator. No animated ellipsis "...". Those are chat conventions.

The loading state:
- A brief "Analyzing your financial data…" line in `text-muted`, italic, `body-sm` size — positioned where the response will appear
- Below that, three skeleton lines at different widths (90%, 75%, 55%) with a slow pulse animation (opacity 0.4 → 1 → 0.4, 1.5s duration)
- The left border accent renders immediately in `primary-200` so the user sees the response container form before content arrives
- As tokens stream in, they replace the skeleton lines naturally — no flash

**What not to do:** No typing indicator dots. No "Claude is thinking..." with a brain emoji. No spinner in the chat area. The product is a financial analysis tool — the loading state should feel like a system processing data, not a person composing a message.

### 8.5 Suggested Question Chips

Shown on empty state and available after each response:

- Horizontal pill chips, `radius-full`
- Background: `gray-100`, border: 1px `border-default`, text: `text-secondary` `body-sm`
- Hover: `primary-50` background, `primary-600` text, `primary-200` border
- Padding: `6px 14px`
- Maximum 4 chips visible at once, overflow hidden (not a scrolling horizontal list)

### 8.6 Query Counter

Shown in the bottom-right of the chat input area:
- `[N] queries remaining` in `caption` (12px) `text-muted`
- When ≤ 3 remain: `warning-600` text
- When 0 remain: hidden (the input is replaced with the quota-exhausted message)

---

## 9. Component Conventions

### 9.1 Directory Structure

```
src/
├── components/
│   ├── ui/                  # shadcn/ui primitives — do not modify
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   ├── select.tsx
│   │   └── ...
│   ├── dashboard/           # Dashboard-specific components
│   │   ├── MetricCard.tsx
│   │   ├── RevenueChart.tsx
│   │   ├── ExpenseBreakdown.tsx
│   │   └── TransactionDrawer.tsx
│   ├── chat/                # /ask interface components
│   │   ├── ChatInput.tsx
│   │   ├── UserMessage.tsx
│   │   ├── AIResponse.tsx
│   │   ├── AIResponseSkeleton.tsx
│   │   ├── FinancialDisclaimer.tsx
│   │   └── SuggestedQuestions.tsx
│   ├── reports/             # Report display components
│   │   ├── ReportCard.tsx
│   │   └── ReportNarrative.tsx
│   ├── alerts/              # Alert components
│   │   └── AlertItem.tsx
│   ├── settings/            # Settings page components
│   └── shared/              # Global components
│       ├── AppNav.tsx
│       ├── PageHeader.tsx
│       ├── MetricChange.tsx
│       ├── CurrencyAmount.tsx
│       └── DataTimestamp.tsx
├── styles/
│   └── globals.css
└── lib/
    ├── utils.ts             # cn() and formatting utilities
    └── format.ts            # formatCurrency, formatPercent, formatDate
```

### 9.2 Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Component files | PascalCase | `MetricCard.tsx` |
| Non-component files | camelCase | `formatCurrency.ts` |
| CSS modules | kebab-case | `metric-card.module.css` |
| Test files | Same name + `.test` | `MetricCard.test.tsx` |
| Utility functions | camelCase | `formatCurrency()` |

### 9.3 Component Props Pattern

All components use TypeScript interfaces. Define the interface in the same file for small components; in a co-located `types.ts` for large feature components.

```tsx
// MetricCard.tsx

interface MetricCardProps {
  label: string;
  value: number;
  change?: number;           // percentage change from prior period
  changeLabel?: string;      // "vs last month"
  currency?: boolean;        // if true, format value as currency
  isLoading?: boolean;
  className?: string;
}

export function MetricCard({
  label,
  value,
  change,
  changeLabel = 'vs last month',
  currency = true,
  isLoading = false,
  className,
}: MetricCardProps) {
  // ...
}
```

**Rules:**
- Never use `any` in component props
- Prefer `interface` over `type` for component prop definitions
- Use `className?: string` on all components that render a root element (to allow Tailwind overrides via `cn()`)
- Import `cn` from `@/lib/utils` for all className composition

### 9.4 Financial Format Utilities

Keep formatting in a single `src/lib/format.ts` file, shared across all components. Never format currency inline in JSX.

```typescript
// src/lib/format.ts

/**
 * IMPORTANT: The API returns monetary values as strings (e.g., "145199.99")
 * to preserve PostgreSQL DECIMAL precision. This function accepts both string
 * and number. When a string is received, it is parsed with parseFloat() for
 * DISPLAY PURPOSES ONLY. parseFloat() is safe for display because:
 *   - The database value has already been calculated with exact DECIMAL arithmetic
 *   - We are only rendering a human-readable string, not performing further math
 *   - Any display rounding to 2 decimal places will not compound errors
 * Never pass a DECIMAL string into further JavaScript arithmetic — always let
 * the database perform financial calculations on DECIMAL columns directly.
 */
export function formatCurrency(
  value: string | number,
  options: { abbreviate?: boolean; decimals?: number } = {}
): string {
  const { abbreviate = false, decimals = 2 } = options;
  // Safe for display: string → number conversion for rendering only
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  if (abbreviate && Math.abs(num) >= 1_000_000) {
    return `$${(num / 1_000_000).toFixed(1)}M`;
  }
  if (abbreviate && Math.abs(num) >= 1_000) {
    return `$${(num / 1_000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = Math.abs(value);
  return `${sign}${abs.toFixed(1)}%`;
}
```

---

## 10. Responsive Breakpoints

The product is designed for desktop. The optimal viewport is **1280px** (xl breakpoint). The dashboard is a data-dense grid that degrades gracefully but is not designed for mobile use in V1.

| Name | px | Notes |
|---|---|---|
| `sm` | 640px | Mobile landscape — tables scroll horizontally, nav collapses |
| `md` | 768px | **Minimum supported viewport.** All primary features accessible. Sidebar becomes a drawer. |
| `lg` | 1024px | Small laptop — dashboard single-column metric row |
| `xl` | 1280px | **Primary design target.** Two-column dashboard layout, sidebar visible |
| `2xl` | 1536px | Wide monitor — max content width 1400px, centered |

**Content max-width:** `max-w-[1400px]` at 2xl. Do not let the dashboard stretch to full width on ultrawide monitors — 16 metric cards in a row is not readable.

**Dashboard grid behavior:**
- ≥ 1280px: 3-column metric card grid, sidebar always visible
- 1024–1279px: 2-column metric card grid, sidebar visible
- 768–1023px: 1-column metric card grid, sidebar as drawer
- < 768px: Degrades to single-column, no horizontal scroll, limited feature access (read-only)

**Table behavior below 768px:** Data tables are scrollable horizontally in a container. Do not hide columns or truncate financial data on narrow viewports — the data integrity is more important than a clean mobile layout.

---

## 11. Animation Standards

Financial products should animate as little as possible. Motion draws attention. In a data product, every draw of attention is a claim that something changed or matters — animation that says nothing is a liability.

### 11.1 Duration Tokens

| Token | Duration | Use |
|---|---|---|
| `duration-fast` | 100ms | Button hover/active, focus ring appearance, badge state change |
| `duration-default` | 200ms | Dropdown open, tooltip appear, tab transition, toggle state |
| `duration-slow` | 350ms | Modal enter/exit, side sheet open, alert slide-in from top |

```css
:root {
  --duration-fast: 100ms;
  --duration-default: 200ms;
  --duration-slow: 350ms;
}
```

### 11.2 Easing Functions

```css
:root {
  --ease-out:    cubic-bezier(0.0, 0.0, 0.2, 1);   /* elements appearing */
  --ease-in:     cubic-bezier(0.4, 0.0, 1.0, 1);   /* elements disappearing */
  --ease-in-out: cubic-bezier(0.4, 0.0, 0.2, 1);   /* elements transitioning */
}
```

Use `ease-out` for entering elements (dropdowns opening, modals appearing). Use `ease-in` for exiting elements. This mirrors how attention focuses and releases.

### 11.3 What Must NOT Animate

These are absolute prohibitions:

- **Financial values on load.** No counting animations (`0 → $45,312`). No numbers ticking up. This is a cardinal rule. It looks impressive in demos and disastrous in a real product — it delays the user seeing the actual number and implies the number arrived by calculation rather than by reading actual data.
- **Chart bars on every render.** Charts draw from their final values immediately. Bars do not grow from zero. Lines do not draw themselves. The data should be the focus.
- **Page transitions.** No full-page fade or slide animations when navigating between routes. The dashboard, /ask, and /conversations screens are accessed hundreds of times per session — animation here is friction.
- **Row-level animation in data tables.** Rows do not fade in, slide in, or pulse when data loads.
- **Numbers reacting to hover.** No scale transforms on metric values.

### 11.4 What May Animate

- Button hover/active state (`background-color`, `duration-fast`)
- Dropdown and select menu open/close (`opacity` + `transform`, `duration-default`, `ease-out`)
- Modal enter and exit (`opacity` + `transform: scale`, `duration-slow`)
- Toast notifications sliding in from top (`transform: translateY`, `duration-default`)
- Sidebar collapse/expand (`width`, `duration-slow`)
- Skeleton loading pulse (`opacity 0.4 → 1 → 0.4` via CSS animation, 1.5s, ease-in-out, infinite — only for loading states, removed when data arrives)

---

## 12. Accessibility

### 12.1 Contrast Minimums (WCAG AA)

| Context | Minimum ratio | Standard |
|---|---|---|
| Normal body text (< 18px, non-bold) | 4.5:1 | WCAG AA |
| Large text (≥ 18px, or ≥ 14px bold) | 3:1 | WCAG AA |
| UI components (buttons, inputs) | 3:1 | WCAG AA |
| Metric values and financial data | 4.5:1 | WCAG AA (treat as critical) |

**Verified contrast ratios for key color pairs:**

| Foreground | Background | Ratio | Status |
|---|---|---|---|
| `primary-500` #2557A7 | White #FFFFFF | 6.2:1 | ✓ AAA |
| `gain-600` #15803D | White #FFFFFF | 4.6:1 | ✓ AA |
| `gain-700` #166534 | White #FFFFFF | 6.5:1 | ✓ AAA |
| `loss-600` #C42030 | White #FFFFFF | 5.5:1 | ✓ AA |
| `loss-700` #A21520 | White #FFFFFF | 7.4:1 | ✓ AAA |
| `warning-600` #B45309 | White #FFFFFF | 5.9:1 | ✓ AA |
| `text-primary` #0F172A | White #FFFFFF | 18.3:1 | ✓ AAA |
| `text-secondary` #475569 | White #FFFFFF | 5.9:1 | ✓ AA |
| `text-muted` #94A3B8 | White #FFFFFF | 2.9:1 | ✗ — only for non-informational text |

> `text-muted` does not meet AA for body text. It is only used for timestamps, supplementary footnotes, and the financial disclaimer — text that supplements but does not carry primary information. Never use `text-muted` for a number the user needs to read.

### 12.2 Color-Blind Users: Financial Data

The gain/loss color pair (green/red) is invisible to ~8% of users with protanopia or deuteranopia. Never use color as the sole differentiator for positive and negative values.

**Required pairings for every gain/loss indicator:**

1. **Color** (gain-600 green / loss-600 red)
2. **Direction symbol** (▲ / ▼) — visible regardless of color perception
3. **Explicit sign** (+12.3% / −4.2%) — legible in grayscale

**Screen reader text for trend indicators:**

```tsx
// Always include sr-only context for trend symbols
<span aria-hidden="true">▲</span>
<span className="sr-only">increased by </span>
<span>+12.3%</span>
<span className="sr-only"> compared to prior month</span>
```

**Charts:** All charts must have either:
- A data table alternative accessible via a "View as table" toggle, or
- A full `aria-label` describing the chart's key finding: `aria-label="Revenue bar chart. June 2026 was $145,200, up 12.3% from May 2026 ($129,300)."`

Do not rely solely on Recharts' default accessibility behavior — it is insufficient for financial data.

### 12.3 Focus States

All interactive elements must have a visible focus ring. Default browser outlines are suppressed by Tailwind's preflight and must be re-added explicitly:

```css
/* globals.css */
*:focus-visible {
  outline: 2px solid #2557A7;   /* primary-500 */
  outline-offset: 2px;
  border-radius: 4px;
}
```

Never use `outline: none` without providing an alternative focus indicator.

### 12.4 Keyboard Navigation

- Dashboard metric cards are not focusable (data display, not interactive)
- Metric cards with a "click to expand" behavior use `<button>` and are focusable
- Data tables support arrow-key navigation within cells
- The `/ask` chat input is auto-focused on page load
- The settings navigation uses standard tab order — no custom focus management required

---

### 12.5 Semantic HTML for Financial Data

Use appropriate HTML semantics:

```tsx
// Metric cards: not headings, not plain divs
<figure role="group" aria-label="Current month revenue">
  <figcaption>Revenue</figcaption>
  <data value="145200">$145,200</data>
</figure>

// Financial tables
<table>
  <caption className="sr-only">Monthly expense breakdown by category</caption>
  <thead>...</thead>
  <tbody>...</tbody>
</table>
```

---

## 13. Proactive Intelligence UI Patterns

The intelligence feed is the product's primary surface. It requires distinct component patterns not covered in the original guidelines.

### 13.0 Icon Library

The component patterns in this section reference icons by their semantic name (e.g., `TrendingDown`, `AlertTriangle`). The icon library for this product is **`lucide-react`**, which is installed automatically as a dependency of shadcn/ui. Import icons directly from the package:

```tsx
import { TrendingDown, AlertTriangle, CircleCheck, ShieldCheck, Circle } from 'lucide-react';
```

The spec uses `ti-` prefixed names (Tabler Icons convention) to describe icon intent. The mappings to lucide-react are:

| Spec name | lucide-react import | Semantic meaning |
|---|---|---|
| `ti-trending-down` | `TrendingDown` | Cash flow risk, declining metric |
| `ti-alert-triangle` | `AlertTriangle` | Anomaly, warning-level finding |
| `ti-circle-check` | `CircleCheck` | Healthy state, opportunity, confirmed action |
| `ti-shield-check` | `ShieldCheck` | Data sovereignty / security assurance |
| `ti-copy` | `Copy` | Copy to clipboard action |

All icons used in intelligence components must be paired with `aria-hidden="true"` and a sibling `sr-only` label. Color alone is never the sole indicator of meaning — the icon provides the second signal.

### 13.1 `info-*` Color Tokens

The Data Sovereignty Callout component (Section 13.4) references `info-50` background and `info` border. This product does not have a separate info scale — the primary Steel Blue (`primary-*`) functions as the informational/trust color throughout the design. Map `info-*` to `primary-*` explicitly:

| Token name used in this section | Maps to | Hex |
|---|---|---|
| `info-50` | `primary-50` | `#EEF4FF` |
| `info-100` | `primary-100` | `#D9E9FF` |
| `info-200` | `primary-200` | `#B3D3FF` |
| `info-600` | `primary-500` | `#2557A7` |

Use the existing CSS variables (`--primary-50`, `--primary-100`, `--primary-200`, `--primary-500`) directly in code — do not add separate `--info-*` variables to `globals.css`.

---

### 13.2 Intelligence Finding Card

The atomic unit of the intelligence feed. Every card renders the same five elements in the same structure. The severity left-border is the first visual signal; the icon is the second; text is third. Color is never the sole indicator of severity.

**Anatomy:**

```
┌─────────────────────────────────────────────────────┐
│ ║ [icon] [SEVERITY BADGE]            [•••] [×]       │  ← header row
│ ║ Headline text, body-lg, weight 500, 2-line max     │  ← headline
│ ║ Detail text, body-sm, muted, 3-line max            │  ← detail
│ ║ [timestamp, caption, muted]                        │  ← metadata
│ ║ [Primary action button]  [Tell me more →]          │  ← actions
└─────────────────────────────────────────────────────┘
  ↑ left-border accent (4px, severity color)
```

**Left-border accent colors by severity:**

| Severity | Border color | Icon | Icon color | Badge background |
|---|---|---|---|---|
| `critical` | `loss-600` (#C42030) | `AlertTriangle` | `loss-600` | `loss-100` |
| `high` | `warning-600` (#B45309) | `AlertTriangle` | `warning-600` | `warning-100` |
| `medium` | `primary-500` (#2557A7) | `TrendingDown` | `primary-500` | `primary-100` |
| `low` | `gray-300` (#CBD5E1) | `Circle` | `gray-400` | `gray-100` |
| `opportunity` (finding_type: collections_opportunity) | `gain-600` (#15803D) | `CircleCheck` | `gain-600` | `gain-100` |

> **Rationale for color + icon pairing:** Approximately 8% of users have red-green color blindness (protanopia/deuteranopia). A critical finding with a `loss-600` red border and no other signal is invisible to that cohort. The `AlertTriangle` icon provides the second signal. This mirrors the rule in Section 12.2 for gain/loss values.

**Component specification:**

```tsx
// src/components/dashboard/FindingCard.tsx
import { TrendingDown, AlertTriangle, CircleCheck, Circle } from 'lucide-react';
import { SeverityBadge } from '@/components/shared/SeverityBadge';

type FindingCardProps = {
  finding: {
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    findingType: string;
    headline: string;           // max 120 chars from DB; rendered max 2 lines
    detail: string;
    recommendedAction: string | null;
    createdAt: string;
    hasActionableType: boolean;
  };
  onTakeAction: (findingId: string) => void;
  onDismiss: (findingId: string) => void;
};

const SEVERITY_STYLES = {
  critical: {
    border: 'border-l-4 border-l-[#C42030]',
    icon: AlertTriangle,
    iconColor: 'text-[#C42030]',
  },
  high: {
    border: 'border-l-4 border-l-[#B45309]',
    icon: AlertTriangle,
    iconColor: 'text-[#B45309]',
  },
  medium: {
    border: 'border-l-4 border-l-[#2557A7]',
    icon: TrendingDown,
    iconColor: 'text-[#2557A7]',
  },
  low: {
    border: 'border-l-4 border-l-[#CBD5E1]',
    icon: Circle,
    iconColor: 'text-[#94A3B8]',
  },
} as const;

export function FindingCard({ finding, onTakeAction, onDismiss }: FindingCardProps) {
  const styles = SEVERITY_STYLES[finding.severity];
  const Icon = finding.findingType === 'collections_opportunity' ? CircleCheck : styles.icon;

  return (
    <article
      className={`rounded-md bg-white ${styles.border} px-4 py-3 shadow-card`}
      aria-label={`${finding.severity} severity finding: ${finding.headline}`}
    >
      {/* Header: icon + severity badge + overflow menu */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon
            size={16}
            className={styles.iconColor}
            aria-hidden="true"
          />
          <SeverityBadge severity={finding.severity} />
        </div>
        {/* Overflow: Dismiss action */}
        <button
          onClick={() => onDismiss(finding.id)}
          className="text-text-muted hover:text-text-secondary"
          aria-label="Dismiss finding"
        >
          ×
        </button>
      </div>

      {/* Headline: max 2 lines */}
      <p className="mt-2 line-clamp-2 text-[1rem] font-medium leading-[1.5] text-text-primary">
        {finding.headline}
      </p>

      {/* Detail: max 3 lines */}
      <p className="mt-1 line-clamp-3 text-[0.875rem] leading-[1.6] text-text-secondary">
        {finding.detail}
      </p>

      {/* Metadata */}
      <p className="mt-2 text-[0.75rem] text-text-muted">
        <time dateTime={finding.createdAt}>
          {formatRelativeDate(finding.createdAt)}
        </time>
      </p>

      {/* Actions */}
      {(finding.hasActionableType || finding.recommendedAction) && (
        <div className="mt-3 flex items-center gap-4">
          {finding.hasActionableType && (
            <button
              onClick={() => onTakeAction(finding.id)}
              className="rounded px-3 py-1.5 text-[0.875rem] font-medium
                         bg-primary-500 text-white hover:bg-primary-600
                         focus-visible:outline-2 focus-visible:outline-primary-500"
            >
              Take action
            </button>
          )}
          <a
            href={`/ask?finding_id=${finding.id}`}
            className="text-[0.875rem] text-primary-500 hover:text-primary-700 underline-offset-2 hover:underline"
          >
            Tell me more →
          </a>
        </div>
      )}
    </article>
  );
}
```

**Card states:**

| State | Visual treatment |
|---|---|
| Default | White background, `shadow-card`, left-border at full severity color |
| Hovered | `bg-gray-50` background transition (150ms ease), border color unchanged |
| Actioned | Background `gain-50` (#F0FBF4), headline color `text-muted`, `CircleCheck` icon in `gain-600`, "Nudge sent [date]" in place of action button |
| Dismissed | Immediately removed from the feed with a 150ms fade-out (CSS `opacity: 0`, `height: 0`, `overflow: hidden`). Visible in `/alerts` archive. |

**What not to do:**
- Do not use `background-color` to indicate severity (a red-background card looks like an error state, not a finding). The left border is the severity signal.
- Do not truncate the headline at less than 2 lines — one line is often insufficient for cash flow risk descriptions.
- Do not hide the "Tell me more →" link when there is no recommended action. Users can always ask follow-up questions regardless of whether an agentic action exists.

---

### 13.3 Agentic Execution Modal

The draft review interface. This is where the user approves AI-drafted communications. The design has one overriding requirement: the user must understand that nothing is sent automatically and that they are in complete control.

**Critical label constraint:** The submit CTA is never labelled "Send." It is always **"Copy draft"** or **"Copy to clipboard."** The label "Send" implies the app is sending the email — it is not. The user copies the draft and sends it from their own email client. One wrong label here destroys trust with users who experienced the Bench collapse and are hyperaware of products acting on their behalf.

**Five-state modal flow** (each state is a distinct React component rendered inside the same `Dialog`):

```tsx
// src/components/dashboard/AgenticModal.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Copy } from 'lucide-react';

type ModalState = 'confirm' | 'generating' | 'review' | 'copy' | 'done';
```

**State 1 — Confirm (`state: 'confirm'`):**
- Shows the finding summary (client name, invoice number, amount, days overdue)
- Primary CTA: "Draft it" (`bg-primary-500`)
- Secondary: "Not now" (ghost button — closes modal, finding remains in feed)
- Body copy: "The AI will draft a professional email you can review before copying."
- Background: white. No severity color in the modal itself — the modal is neutral; the finding card behind it carries the urgency.

**State 2 — Generating (`state: 'generating'`):**
- `AnimatedProgress` bar (indeterminate, `primary-500` fill, 3px height)
- Body text: "Drafting your message..." in `body-md`, `text-secondary`
- No cancel button in this state — generation takes 2–4 seconds
- If generation fails: replace with "Draft generation failed. [Try again] [Cancel]"

**State 3 — Review draft (`state: 'review'`):**

```tsx
// State 3 layout
<DialogContent className="max-w-xl">
  <DialogHeader>
    <DialogTitle>Review your draft</DialogTitle>
  </DialogHeader>

  {/* Recipient field — pre-filled from QBO, or warning if absent */}
  <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-[0.875rem]">
    <span className="text-text-muted">To: </span>
    {recipientEmail
      ? <span className="text-text-primary">{recipientEmail}</span>
      : <RecipientMissingWarning clientName={clientName} />
    }
  </div>

  {/* Subject */}
  <div className="border-b border-gray-100 px-3 py-2 text-[0.875rem]">
    <span className="text-text-muted">Subject: </span>
    <span className="text-text-primary">{subjectLine}</span>
  </div>

  {/* Body — editable inline */}
  <textarea
    className="w-full resize-none rounded border-0 p-3 text-[0.875rem]
               leading-[1.7] text-text-primary focus:outline-none focus:ring-1
               focus:ring-primary-300"
    rows={8}
    value={draftContent}
    onChange={(e) => setDraftContent(e.target.value)}
    aria-label="Email draft body — editable"
  />

  <div className="flex items-center justify-between">
    <button onClick={() => setState('confirm')} className="text-sm text-text-muted hover:text-text-secondary">
      ← Start over
    </button>
    <button onClick={handleApprove} className="btn-primary">
      Looks good →
    </button>
  </div>
</DialogContent>
```

**State 4 — Copy (`state: 'copy'`):**

```tsx
// State 4: the most important screen in the agentic execution flow
<div className="space-y-4">
  {/* Read-only final draft */}
  <div className="rounded border border-gray-200 bg-gray-50 p-3
                  text-[0.875rem] leading-[1.7] text-text-primary whitespace-pre-wrap">
    {finalDraft}
  </div>

  {/* Primary CTA — NEVER labelled "Send" */}
  <button
    onClick={handleCopy}
    className="flex w-full items-center justify-center gap-2
               rounded bg-primary-500 py-2.5 text-white font-medium
               hover:bg-primary-600 focus-visible:outline-2 focus-visible:outline-primary-500"
  >
    <Copy size={16} aria-hidden="true" />
    Copy to clipboard
  </button>

  {/* Explicit instruction — never omit this line */}
  <p className="text-center text-[0.875rem] text-text-muted">
    Paste this into your email client and send it.
    <br />
    <span className="text-[0.75rem]">This product never sends on your behalf.</span>
  </p>

  <button onClick={() => setState('review')} className="text-sm text-text-muted hover:text-text-secondary">
    ← Edit
  </button>
</div>
```

**State 5 — Done (`state: 'done'`):**

```tsx
<div className="space-y-4 text-center">
  <CircleCheck size={32} className="mx-auto text-[#15803D]" aria-hidden="true" />
  <p className="text-lg font-medium text-text-primary">✓ Copied to clipboard</p>
  <p className="text-[0.875rem] text-text-secondary">
    Open your email client, paste, and send.
  </p>

  {/* Optional tracking toggle */}
  <label className="flex items-center justify-center gap-2 text-[0.875rem] text-text-secondary">
    <input
      type="checkbox"
      checked={markedAsSent}
      onChange={handleMarkAsSent}
      className="rounded border-gray-300"
    />
    Mark as sent (tracks this in the app)
  </label>

  <button onClick={onClose} className="btn-ghost text-sm">
    Close
  </button>
</div>
```

**Failure state — no email address on file in QBO:**

```tsx
// RecipientMissingWarning — rendered in State 3 when recipientEmail is null
function RecipientMissingWarning({ clientName }: { clientName: string }) {
  return (
    <span className="text-warning-600">
      [Add {clientName}'s email address]
    </span>
  );
}
```

The warning banner shown above the draft in State 3:

```tsx
<div className="flex items-start gap-2 rounded border border-warning-200 bg-warning-50 px-3 py-2">
  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning-600" aria-hidden="true" />
  <p className="text-[0.8125rem] text-warning-700">
    QuickBooks doesn't have an email address for {clientName}. Add their address
    in the "To:" field when you paste into your email client.
  </p>
</div>
```

Copy-to-clipboard content in the no-email case must include `TO: [Add {clientName}'s email address]` as a literal placeholder in the copied text, so the reminder travels with the draft when pasted.

**Accessibility requirements for this modal:**
- `DialogTitle` must describe the action: "Draft a collections reminder" (not "Draft email" or "Action")
- The `textarea` in State 3 must have `aria-label="Email draft body — editable"`
- "Copy to clipboard" button must have `aria-live="polite"` region update on success: "Draft copied. Paste into your email client."
- Focus must be managed: when modal opens → focus "Draft it" button; when state changes → focus the primary CTA of the new state

---

### 13.4 Data Sovereignty Callout

A persistent but unobtrusive element shown during onboarding and in settings. Communicates the read-only, zero-lock-in commitment without being defensive or prominent.

**Intent:** This element should feel like a quiet promise, not a legal disclaimer. Do not make it visually heavy. It should be visible but not compete for attention with the financial data on the screen.

**Component specification:**

```tsx
// src/components/shared/DataSovereigntyCallout.tsx
import { ShieldCheck } from 'lucide-react';

type CalloutVariant = 'inline' | 'banner';

export function DataSovereigntyCallout({ variant = 'inline' }: { variant?: CalloutVariant }) {
  return (
    <div
      className={`flex items-start gap-2 rounded border border-[#B3D3FF] bg-[#EEF4FF]
                  ${variant === 'banner' ? 'px-4 py-3' : 'px-3 py-2'}`}
      role="note"
      aria-label="Data sovereignty notice"
    >
      <ShieldCheck
        size={variant === 'banner' ? 16 : 14}
        className="mt-0.5 shrink-0 text-[#2557A7]"   /* primary-500 */
        aria-hidden="true"
      />
      <p className="text-[0.8125rem] leading-[1.6] text-[#1E3A6E]">   {/* primary-800 */}
        Your QuickBooks data stays in QuickBooks.
        {variant === 'banner' && (
          <> If you leave, your full ledger is untouched.</>
        )}
      </p>
    </div>
  );
}
```

**Variant usage:**

| Variant | When to use | Text shown |
|---|---|---|
| `inline` | Beneath connection cards in Settings > Connections, beneath the QB/Xero connect options in onboarding | "Your QuickBooks data stays in QuickBooks." |
| `banner` | Full-width on the `/onboarding/connect` screen and the `/onboarding/first-brief` screen | "Your QuickBooks data stays in QuickBooks. If you leave, your full ledger is untouched." |

**Sizing and spacing:**
- `body-sm` (0.8125rem) text — smaller than the surrounding body text; this is supplementary information
- `px-3 py-2` for inline, `px-4 py-3` for banner
- Border: `primary-200` (#B3D3FF) — light, not heavy
- Background: `primary-50` (#EEF4FF) — barely-there tint
- Icon: `ShieldCheck` at 14px (inline) or 16px (banner) in `primary-500`
- Text color: `#1E3A6E` (primary-800) — readable but not the loudest thing on the page

**What not to do:**
- Do not add this element to every screen (over-repetition makes it feel defensive rather than trustworthy)
- Do not use a heavier border or a bold font weight — this is a note, not a warning
- Do not use `warning-*` or `loss-*` colors for this callout — those signal risk, not assurance
- Do not place this element above the fold on the Intelligence Feed — it belongs in the onboarding and settings flows, not the primary working surface

**Placement rules:**
- **Show:** `/onboarding/connect`, `/onboarding/first-brief` (below finding cards), `/settings/connections` (below each connection card), `/settings/account` (in the Data & Privacy section)
- **Do not show:** `/dashboard` (intelligence feed), `/cashflow`, `/ask`, `/reports`

---

*End of FRONTEND_GUIDELINES.md v0.2. Section 13 was added to cover proactive intelligence UI patterns introduced in the V2 product pivot. All hex values remain final. The icon library for this product is `lucide-react` (installed via shadcn/ui). `info-*` tokens in Section 13 map to the existing `primary-*` scale — do not add separate CSS variables.*
