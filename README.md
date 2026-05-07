# pub-api

A REST API for discovering and managing pub data across the UK. Built with Express, TypeScript, Prisma, and PostgreSQL.

## Features

- Browse and search pubs with filtering by city, features, and more
- API key authentication with tiered rate limiting (Hobby / Developer / Business)
- Stripe-powered subscriptions
- Contributor endpoints for adding and editing pub data
- Email verification and password reset via Resend
- Audit logging for all data changes

## Requirements

- Node.js >= 22.12.0
- PostgreSQL
- Yarn

## Getting started

```bash
yarn install
```

Copy `.env.example` to `.env` and fill in the required values (database URL, JWT secret, Stripe keys, Resend API key).

```bash
# Run database migrations and generate Prisma client
yarn prisma:generate
npx prisma migrate dev

# Start in development mode (with hot reload)
yarn dev

# Or build and start for production
yarn build
yarn start
```

The server runs on `http://localhost:4000` by default.

## Scripts

| Command | Description |
|---|---|
| `yarn dev` | Start development server with hot reload |
| `yarn build` | Compile TypeScript |
| `yarn start` | Run migrations then start compiled server |
| `yarn test` | Run tests with Vitest |
| `yarn test:coverage` | Run tests with coverage report |
| `yarn lint` | Check code with Biome |
| `yarn lint:fix` | Auto-fix lint issues |
| `yarn import:pubs` | Import pub data from CSV |
| `yarn audit:pubs` | Audit pub records |
| `yarn delete:flagged` | Delete flagged pub records |

## API routes

| Prefix | Description |
|---|---|
| `GET /health` | Health check |
| `/auth` or `/api/v1/auth` | Registration, login, email verification, password reset |
| `/pubs` | Authenticated pub management (create, update, delete) |
| `/api/v1` | Public read endpoints for pubs |
| `/api/v1/contributors` | Contributor management |
| `/payments` | Stripe subscription management |

## Tech stack

- **Express 5** — HTTP framework
- **Prisma 7** — ORM and migrations
- **PostgreSQL** — Database
- **Vitest** — Testing
- **Biome** — Linting and formatting
- **Stripe** — Payments
- **Resend** — Transactional email
- **Helmet / cors / express-rate-limit** — Security middleware
