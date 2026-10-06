# Etsy Signal — database

PostgreSQL is the historical store for observations. The canonical schema lives
in [`schema.sql`](./schema.sql); the backend applies the same DDL automatically
on startup via `npm run db:init -w backend` (or `DATABASE_AUTO_MIGRATE=1`).

Tables:

| table | purpose |
|---|---|
| `listings` | one row per Etsy listing the extension has ever seen (id, title, shop, first/last seen) |
| `observations` | every timestamped snapshot of public metrics (price, rating, review count, rank, badges…) |
| `serp_snapshots` | per-query search-page snapshots (result counts, ad share) |

Data minimization: only public, listing-level metrics that the user's own
browser rendered. No buyer data, no personal data, no credentials.

Quick start (local):

```bash
createdb etsy_signal
psql etsy_signal < database/schema.sql
# or:
DATABASE_URL=postgres://localhost/etsy_signal npm run db:init -w backend
```
