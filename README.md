# REVA Health — Premium Online Medical & Personalised Nutrition Practice

This repository contains the production codebase for **REVA Health** ("Medical care meets personalised nutrition.").

---

## Architecture Overview

```text
/
├── index.html                 # Main website homepage & Consultation Booking Modal
├── blog.html                  # Blog index page
├── 404.html                   # 404 error recovery page with shared booking modal
├── blog/                      # Individual blog articles
├── vercel.json                # Vercel deployment & routing configuration
├── DESIGN.md                  # Design system tokens and specifications
├── README.md                  # Comprehensive project & integration documentation
├── .env.example               # Serverless environment variable template
├── .gitignore                 # Excludes .env, secrets, and scratch scripts from git
├── server.js                  # Local development & API server
├── api/
│   ├── create-order.js        # Slot reservation & Razorpay order creation
│   ├── verify-payment.js      # HMAC-SHA256 signature verification & booking confirmation
│   ├── webhook-razorpay.js    # Async Razorpay webhook fallback listener
│   ├── enquiry.js             # General consultation enquiry endpoint -> Telegram
│   └── support.js             # Customer Care Widget -> Telegram Support Bot
├── lib/
│   ├── calendar.js            # Google Calendar integration & slot generation engine (IST)
│   ├── confirm-booking.js     # Shared booking confirmation, idempotency & slot conflict engine
│   ├── cors.js                # Dynamic CORS header middleware
│   ├── ratelimit.js           # Serverless sliding-window rate limiting engine
│   ├── razorpay.js            # Razorpay REST API & HMAC-SHA256 signature helper
│   ├── sheets.js              # Google Sheets client & persistence helper
│   └── whatsapp.js            # WhatsApp notification integration hook
├── js/
│   └── main.js                # Frontend interactions, slot selector, & Razorpay Checkout SDK
└── css/
    └── style.css              # Editorial design system stylesheet
```

---

## Backend Services & Endpoints

### 1. **Booking & Payment Pipeline**
* **POST `/api/create-order`**: 
  - Validates requested appointment slot (Asia/Kolkata timezone, working hours, lead time).
  - Checks write-verification guard against active holds in Google Sheets.
  - Generates Razorpay Order ID.
  - Holds the slot (`SLOT_HOLD`) for configurable duration (`HOLD_EXPIRY_MINUTES`).
* **POST `/api/verify-payment`**:
  - Verifies Razorpay HMAC-SHA256 signature.
  - Checks order-binding (prevents payment tampering across bookings).
  - Appends raw transaction row to `Payments` tab in Google Sheets.
  - Delegates to `lib/confirm-booking.js` for slot conflict verification and Google Calendar event creation.
  - Sends Telegram admin alert and triggers WhatsApp notification.
* **POST `/api/webhook-razorpay`**:
  - Authoritative async fallback listener for `payment.captured` and `payment.failed` events.
  - Guarantees payment logging and booking confirmation even if the patient closes their browser window.
  - Utilizes shared `confirmBooking()` logic with terminal-state protection and per-booking concurrency mutexes.

### 2. **Inquiry & Support Services**
* **POST `/api/enquiry`**: General consultation inquiry -> Telegram Admin Bot.
* **POST `/api/support`**: Customer Care Widget -> Telegram Support Bot.

---

## Environment Variables & Configuration

Copy `.env.example` to `.env.local` for local development:

```bash
# ── Telegram Bots ────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=your_enquiry_bot_token_here
TELEGRAM_ADMIN_CHAT_ID=your_enquiry_chat_id_here
TELEGRAM_SUPPORT_BOT_TOKEN=your_support_bot_token_here
TELEGRAM_SUPPORT_CHAT_ID=your_support_chat_id_here

# ── Google APIs (Service Account) ─────────────────────────────────────────────
GOOGLE_CLIENT_EMAIL=your_service_account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GOOGLE_SHEET_ID=your_google_spreadsheet_id_here
GOOGLE_CALENDAR_ID=your_google_calendar_id_here
GOOGLE_MEET_ENABLED=true

# ── Razorpay Integration ──────────────────────────────────────────────────────
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_razorpay_key_secret_here
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here

# ── Working Hours & Slot Engine Configuration (IST) ───────────────────────────
WORK_START_TIME=08:00          # First slot start time (24hr HH:MM)
WORK_END_TIME=22:30            # Last slot must END by this time
SLOT_DURATION_MIN=30           # Duration of each slot in minutes
MIN_BOOKING_LEAD_MINUTES=60    # Minimum lead time for same-day bookings
HOLD_EXPIRY_MINUTES=15         # Duration of temporary slot reservation
```

---

## Working Hours & Timezone Handling

- **Timezone**: All slot calculations, time formatting, and Google Calendar event start/end timestamps strictly use `Asia/Kolkata` (IST, UTC+5:30).
- **Configurability**: Working hours and slot parameters are fully driven by environment variables (`WORK_START_TIME`, `WORK_END_TIME`, etc.).
- **Fail-Safe Fallbacks**: Invalid environment settings automatically trigger console warnings and fall back to standard working hours (08:00 – 22:30 IST, 30-min slots).

---

## Local Development & Testing

### Running Locally
```bash
node server.js
```
Open `http://localhost:3000` in your web browser.

### Verification & Test Scripts
Integration and unit tests are located in `scratch/`:
- **`scratch/test_s1_s10.js`**: Full 10-scenario integration test suite verifying webhook handling, slot conflicts, idempotency, order binding, time anchoring, and HTML escaping.

Run the test suite:
```bash
node scratch/test_s1_s10.js
```
