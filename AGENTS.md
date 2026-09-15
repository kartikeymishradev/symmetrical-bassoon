# AGENTS.md — Premium Health & Wellness Consultation Website

## Mission
Build a complete static V1 premium online health & wellness consultation website end-to-end. It must feel like a real premium medical practice: trustworthy, editorial, calm, human, refined and professionally designed — not like an AI-generated SaaS, hospital, or template landing page.

## Primary Reference Poster — MUST USE
Expected reference path: `reference/health-consultation-poster.png`

Before designing or coding:
1. Inspect the poster carefully, including zoom/crops where useful.
2. Treat it as the primary visual and content reference.
3. Use it to understand brand personality, typography hierarchy, doctor/nutritionist presentation, services, pricing, imagery and positioning.
4. Do not guess unclear text.
5. Transform the poster into a superior responsive website; do NOT simply recreate the poster as a webpage.
6. Use real supplied photographs/assets whenever technically possible.
7. Never replace supplied real people with fake AI/stock doctors.
8. Never alter a person's identity/appearance.
9. If an asset cannot be cleanly extracted, use the original reference appropriately or a clearly marked placeholder.

## Technology
Use only:
- HTML5
- CSS3
- Vanilla JavaScript

Do NOT use Tailwind, Bootstrap, React, Next.js, Vue, Angular, or unnecessary UI/component frameworks.

Preferred structure:
```text
/
├── index.html
├── AGENTS.md
├── DESIGN.md
├── css/style.css
├── js/main.js
├── assets/images/
├── assets/icons/
└── reference/health-consultation-poster.png
```
Inspect the existing repository first and adapt its structure if needed.

## Design Direction
**Premium Medical Editorial × Swiss-Inspired Information Design × Modern Wellness**

Feel: premium, medically credible, calm, human, editorial, precise, spacious, contemporary and trustworthy.

## Anti-Cliché Rules
Absolutely NO:
- gradients of any kind
- purple/blue gradients
- neon accents
- ambient glows
- glassmorphism
- floating blobs or abstract decorative blobs
- fake 3D
- excessive drop shadows
- giant glowing buttons
- excessive rounded cards
- huge corner radii
- excessive pills
- generic Lucide/Iconify/FontAwesome icon grids
- centered SaaS hero
- “badge + centered heading + 3 cards” layout
- repetitive identical cards
- generic AI medical imagery
- unnecessary illustrations
- fake testimonials/reviews/statistics/certifications/awards
- fake medical claims
- invented contact details
- excessive animations, parallax or scroll-jacking

Use exactly ONE distinct brand accent. Do not introduce additional accent colors.

## Design Tokens
Start with:
```css
--bg: #F7F6F2;
--surface: #FFFFFF;
--text: #17212B;
--text-muted: #667085;
--border: #D8DDD8;
--accent: #0B6B62;
```
Use the deep teal accent sparingly for primary CTAs, active states and key highlights. No gradients.

## Typography
Use strong contrast:
- Display/headings: DM Serif Display, Cormorant Garamond, or Libre Baskerville
- Body/UI: Manrope, Source Sans 3, or IBM Plex Sans

Use no more than two main families. Avoid Inter/Geist-everywhere aesthetics. Let typography establish hierarchy.

## Spacing / Grid
Use a strict 4px/8px rhythm:
`4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 120`

Desktop: 12-column editorial grid with generous margins, strong alignment, structural vertical rules and intentional whitespace. Do not center everything.

## Shape / Borders
Preferred radius: 0–6px; absolute maximum 8px. Prefer crisp rectangles.
Use 1px structural borders and subtle separators. Shadows should be absent or extremely subtle.

## Page Architecture
```text
Header
→ Hero
→ Doctor Consultation
→ Nutrition & Wellness
→ Lifestyle / Habit / Follow-up
→ Packages
→ How It Works
→ Final CTA
→ Footer
```

## Content Integrity
The supplied reference is the source of truth. Never invent doctors, qualifications, specialties, prices, testimonials, statistics, certifications, awards, reviews, patient counts, success rates, medical claims or contact information.
