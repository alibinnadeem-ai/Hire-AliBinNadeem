# ABN Consultant (Next.js + Vercel + Neon)

This project is now structured as a single Next.js app for Vercel deployment.

## Architecture

- Frontend page rendering: `app/`
- API backend (serverless): `pages/api/[...path].js`
- Neon/Postgres access: `lib/db.js`
- API static datasets (services/projects/ventures/training): `lib/data.js`

## Local Setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

App runs on `http://localhost:3002`.

## Vercel Deployment

1. Import repository in Vercel as a Next.js project.
2. Add environment variables from `.env.example` (at minimum `DATABASE_URL`, `JWT_SECRET`, `ADMIN_*`, SMTP values if email is needed).
3. Use Neon connection string for `DATABASE_URL`.
4. Deploy.

## Neon Configuration

- Use your Neon pooled connection URL in `DATABASE_URL`.
- SSL is automatically enabled in Vercel and for Neon URLs.
- Run migrations against Neon before production traffic:

```bash
npm run db:migrate
```

## API Surface

- `POST /api/contact`
- `GET /api/contact` (admin header auth)
- `POST /api/enquiry`
- `GET /api/enquiry` (admin header auth)
- `PATCH /api/enquiry/:id` (admin header auth)
- `GET /api/services`
- `GET /api/services/:id`
- `GET /api/booking/calendly-url`
- `POST /api/booking/request`
- `GET /api/training`
- `GET /api/training/:id`
- `POST /api/training/enrol`
- `GET /api/ventures`
- `GET /api/ventures/stats`
- `GET /api/ventures/:id`
- `GET /api/projects`
- `GET /api/projects/stats`
- `GET /api/projects/:id`
- `POST /api/analytics/pageview`
- `POST /api/analytics/event`
- `GET /api/analytics/summary` (admin header auth)
- `POST /api/admin/login`
- `GET /api/admin/dashboard` (admin JWT)
- `PATCH /api/admin/contacts/:id` (admin JWT)
- `DELETE /api/admin/contacts/:id` (admin JWT)
- `GET /api/auth/linkedin`
- `GET /api/auth/linkedin/callback`
- `POST /api/auth/verify`
- `GET /api/health`
