# Tennis Court Reservation Prototype

Minimal MVP built with Next.js 14 (App Router, TS), Supabase Auth, Prisma (Postgres), Tailwind, shadcn-style UI, TanStack Query. Deployable to Netlify.

## Screens
- `/login`: Magic link login via Supabase
- `/reserve`: Pick date/court, 60-min slots grid, book dialog
- `/my`: My reservations (future/past tabs)
- `/admin`: List all reservations and force-delete

## Data Model (Prisma)
- `User(id, email, role)`
- `Court(id, name)` – fixed 8 in seed
- `Reservation(id, userId, courtId, date, startMin, endMin, partySize)`
- `AuditLog(id, action, actorEmail?, meta)`

Capacity: Max total `partySize` across overlapping reservations per court/time is 4. Time units are 5-minute increments; UI shows 60-min slots.

## Requirements
- Node 18+, pnpm

## Setup
1. Clone and install
```
pnpm install
```

2. Env
Create `.env.local` from `.env.example` and set:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `DATABASE_URL` (your Supabase Postgres connection string)

3. Prisma
```
pnpm prisma:generate
pnpm prisma:migrate
pnpm seed
```

4. Dev
```
pnpm dev
```

Open http://localhost:3000

## Auth Notes
- Uses Supabase magic link. After first login, a local `User` row is auto-created by email.
- To grant admin, update DB: set `role = 'ADMIN'` for `admin@example.com` or desired email.

## Seed
Creates `Court1..8`, and `User` rows for `admin@example.com` (ADMIN) and `user@example.com` (USER).

## Netlify
- Repo must include `netlify.toml` with Next.js plugin.
- Set environment variables in Netlify dashboard.
- Build command: `pnpm build`
- Publish directory: `.next`

## Tests
- Unit (Vitest): `pnpm test`
- E2E (Playwright): `pnpm test:e2e`

## Scripts
- `pnpm dev` – start dev server
- `pnpm build` – Next build
- `pnpm prisma:migrate` – apply dev migrations
- `pnpm seed` – seed courts and demo users

## Future
- Variable court count
- Rich shadcn/ui components
- Advanced availability and conflict UI
