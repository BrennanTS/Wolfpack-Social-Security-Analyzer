# Wolfpack Social Security Analyzer

Client-facing Social Security claiming analysis tool for **Wolfpack | Planning Team**.

## Features

- SSA-aligned benefit projections (ages 62–70)
- Optimal claiming age recommendation with break-even analysis
- COLA / inflation assumptions with BLS CPI history
- Life expectancy modeling (SSA period life tables)
- Spousal & survivor benefit projections
- Interactive charts (heatmap, opportunity cost, monthly ramp, and more)
- PDF export for client meetings
- Password-gated demo access

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Demo password: `wolfpack`

## Build

```bash
npm run build
```

Output is in `dist/` — deploy to Vercel, Netlify, or any static host.

## Stack

React 19 · TypeScript · Vite · Recharts · @react-pdf/renderer

## Disclaimer

For educational planning purposes only. Not affiliated with the Social Security Administration.
