# REVA Health — Premium Online Medical & Personalised Nutrition Practice

This repository contains the static V1 production codebase for **REVA Health** ("One Condition. Two Experts. Medical care meets personalised nutrition.").

## Architecture Overview

```text
/
├── index.html                 # Main website homepage & Customer Care Widget
├── 404.html                   # Custom REVA Health 404 error page
├── DESIGN.md                  # Design system tokens and specifications
├── README.md                  # Project & Telegram integration documentation
├── .env.example               # Serverless environment variable template
├── .gitignore                 # Excludes .env and secrets from git
├── server.js                  # Local development & API server
├── api/
│   ├── enquiry.js             # Serverless API: Main Consultation Enquiry -> Telegram
│   └── support.js             # Serverless API: Customer Care Widget -> Telegram Support Bot
├── css/
│   └── style.css              # Custom properties & editorial design stylesheet
├── js/
│   └── main.js                # Frontend interactions & API fetch handlers
├── assets/
│   ├── images/
│   │   └── dr-rishabh-jain.jpg # Verified doctor portrait asset
│   └── icons/
│       ├── favicon.svg        # Monogram SVG favicon
│       ├── favicon-32x32.png  # 32x32 PNG favicon
│       └── apple-touch-icon.png
└── reference/
    └── health-consultation-poster.png # Reference poster asset
```

---

## Telegram Bot Integration & Serverless API

The application uses two separate, secure serverless endpoints to transmit user submissions to Telegram without ever exposing Telegram Bot API tokens to the client browser.

### Endpoints
1. **POST `/api/enquiry`**: Handles main consultation booking form submissions.
2. **POST `/api/support`**: Handles Customer Care chat widget inquiries.

---

## Environment Variables

Copy `.env.example` to `.env` and populate your Bot tokens and Chat IDs:

```bash
# Main Website Consultation Enquiry Bot
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyZ
TELEGRAM_ADMIN_CHAT_ID=987654321

# Customer Care & Support Widget Bot
TELEGRAM_SUPPORT_BOT_TOKEN=987654321:XYZabcDEFghiJKLmnoPQRstuVW
TELEGRAM_SUPPORT_CHAT_ID=123456789
```

> **Security Note**: Never commit `.env` to Git. The frontend JavaScript strictly invokes relative serverless paths `/api/enquiry` and `/api/support`. All Telegram Bot API requests execute on the serverless backend layer.

---

## Credential Replacement Guide

To switch from temporary/development mode to live Telegram delivery:
1. Open BotFather on Telegram and create your two bots (`@RevaEnquiryBot` and `@RevaSupportBot`).
2. Get your Telegram Admin Chat ID (using `@userinfobot` or `@GetIDBot`).
3. Set the 4 environment variables in your serverless host dashboard (Vercel, Netlify, AWS Lambda, or local `.env`).
4. Restart or re-deploy the project. **No frontend HTML/CSS/JS code edits are required.**

---

## Local Testing

To run locally with static file serving and serverless API proxying:

```bash
node server.js
```

Open `http://localhost:3000` in your web browser.
