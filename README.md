# Referleey

Employee referral program platform for companies. Each company gets its own workspace: admins post jobs and set rewards, employees refer candidates or share personal links, and every referral is tracked from submission to reward payout.

Runs entirely on Cloudflare: static pages in `public/`, API in `src/` (a Worker), data in a D1 database.

## What's included

- Company sign-up, employee sign-up through an invite link, sign-in and sign-out
- Admin workspace: overview, jobs, referral pipeline with history, reward payouts, team, settings, spreadsheet export
- Employee workspace: open roles, refer form, personal referral links, own referrals, leaderboard
- Public careers page per company and a public application page that credits the referrer
- One-click demo workspace with sample data (demo workspaces older than a day are removed automatically)

## Deploy on Cloudflare

The repo is a Cloudflare Worker with static assets. Connect it under Workers & Pages → Create → Import a repository, keep the default deploy command (`npx wrangler deploy`), and deploy. `wrangler.jsonc` sets everything else, including a D1 database named `referleey` that Cloudflare creates and links on the first deploy. The app creates its own tables on first request.

Every push to `main` deploys automatically.

## Run locally

```
npm install
npm run dev
```

Opens on http://localhost:8787 with a local D1 database.

## Notes

- Passwords are hashed with PBKDF2-SHA256 (100,000 iterations). Sessions are random tokens stored hashed, in an HttpOnly cookie.
- Every API query is scoped to the signed-in user's company.
- The app sends no email. Admins share the invite link themselves, and there is no password reset yet.
- For production traffic, add a Cloudflare rate-limiting rule on `/api/auth/*` and `/api/public/apply`.
