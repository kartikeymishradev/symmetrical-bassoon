# DESIGN.md — REVA Health (Medical Editorial System)

## 1. Brand Identity & Positioning
- **Brand Name**: REVA Health
- **Positioning**: "One Condition. Two Experts."
- **Core Tagline**: "Medical care meets personalised nutrition."
- **Focus**: Personalised medical and nutrition support for PCOS/PCOD, diabetes, thyroid and weight management.
- **Strict Medical Integrity**: NO unsupported medical claims ("cures", "guaranteed loss", "guaranteed transformation").
- **Mandatory Motto**: *"One Condition. Two Experts. Medical care meets personalised nutrition."*

## 2. Design System Tokens
```css
:root {
  /* Color Palette */
  --bg: #F7F6F2;           /* Warm clinical off-white */
  --surface: #FFFFFF;      /* Clean surface white */
  --surface-alt: #F0F2EF;  /* Secondary background tint */
  --surface-contrast: #17212B; /* Dark navy obsidian footer */
  --text: #17212B;         /* Deep obsidian Navy-black */
  --text-muted: #667085;   /* Muted gray text */
  --border: #D8DDD8;       /* Fine structural rules */
  --border-light: #E8EBE8; /* Light divider hairline */
  
  /* Single Brand Accent */
  --accent: #0B6B62;       /* REVA Deep Medical Teal */
  --accent-hover: #08524B; /* Hover state */
  --accent-light: #EBF4F3; /* Light background tint */
  --accent-border: #9DC3BF;

  /* Restrained Secondary Accent */
  --gold-accent: #B8860B; /* Deep amber gold for degrees */
  --gold-bg: #FDF8EC;
  --gold-border: #E8D9B5;

  /* Typography */
  --font-serif: "DM Serif Display", Georgia, serif;
  --font-sans: "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Spacing Scale (4px/8px rhythm) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;

  /* Border Radii */
  --radius-none: 0px;
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 6px;

  /* Container Max Width */
  --container-max: 1240px;
}
```

## 3. Page Architecture
1. **Header**: REVA Health logo (`+ REVA Health`), Nav links (Philosophy, Team, Conditions, Packages, Journey), "Book Consultation" CTA.
2. **Hero**: Editorial split. Left: Overline ("REVA HEALTH"), H1 ("One Condition. Two Experts."), Sub-heading ("Medical care meets personalised nutrition."), description, CTAs ("Book Consultation", "Explore Plans"). Right: Doctor preview card with real Dr. Rishabh Jain portrait.
3. **Our Philosophy**: "One Condition. Two Experts." 2-column editorial split comparing MD Physician clinical focus vs Clinical Nutritionist diet & lifestyle focus.
4. **Team**: Dr. Rishabh Jain (MBBS, MD Medicine, AIIMS Experience).
5. **Conditions We Support**: Numbered editorial grid (`01 — PCOS / PCOD`, `02 — Type 2 Diabetes`, `03 — Weight Loss`, `04 — Healthy Weight Gain`, `05 — Thyroid + Weight Management`).
6. **How We Are Different**: "We don't give photocopy diets." 5-part structural grid (`YOUR BODY`, `YOUR REPORTS`, `YOUR FOOD`, `YOUR ROUTINE`, `YOUR PLAN`).
7. **Packages**: REVA Health Plans (01 Trial ₹499, 02 1 Month Reset ₹2,499, 03 3 Month Transformation ₹5,999 Best Seller).
8. **Patient Journey**: 5-step timeline (01 Book Appointment → 02 Send Reports → 03 Consult on Video → 04 Get Diet / Workout Plan within 24 hrs → 05 Weekly Follow-up).
9. **Final CTA & Footer**: "Your health plan should fit your life." Trust points, copyright & contact details.
