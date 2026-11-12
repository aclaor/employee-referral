# Referleey

Employee referral program platform for companies. Each company gets its own workspace: admins post jobs and set rewards, employees refer candidates or share personal links, and every referral is tracked from submission to reward payout.

Runs entirely on Cloudflare: static pages in `public/`, API in `functions/api/` (Pages Functions), data in a D1 database.

## What's included

- Company sign-up, employee sign-up through an invite link, sign-in and sign-out
- Admin workspace: overview, jobs, referral pipeline with history, reward payouts, team, settings, spreadsheet export
- Employee workspace: open roles, refer form, personal referral links, own referrals, leaderboard
- Public careers page per company and a public application page that credits the referrer
- One-click demo workspace with sample data (demo workspaces older than a day are removed automatically)

## Deploy on Cloudflare

1. **Create the database.** Cloudflare dashboard → Storage & Databases → D1 → Create. Name it `referleey`. No tables to create; the app sets them up on first request.
2. **Create the Pages project.** Workers & Pages → Create → Pages → Connect to Git → pick `aclaor/employee-referral`.
   - Framework preset: None
   - Build command: leave empty
   - Build output directory: `public`
3. **Connect the database.** In the Pages project → Settings → Bindings → Add → D1 database. Variable name must be `DB`, database `referleey`.
4. **Redeploy** (Deployments → Retry deployment) so the binding takes effect.

Every push to `main` deploys automatically after that.

## Run locally

```
npm install
npm run dev
```

Opens on http://localhost:8788 with a local D1 database.

## Notes

- Passwords are hashed with PBKDF2-SHA256 (100,000 iterations). Sessions are random tokens stored hashed, in an HttpOnly cookie.
- Every API query is scoped to the signed-in user's company.
- The app sends no email. Admins share the invite link themselves, and there is no password reset yet.
- For production traffic, add a Cloudflare rate-limiting rule on `/api/auth/*` and `/api/public/apply`.
