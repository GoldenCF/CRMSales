# CRMSales

A basic sales CRM. It keeps track of **companies**, **contacts**, a **deals pipeline**, and
**activities** (notes, calls, emails, meetings, tasks), with a dashboard that summarises the
pipeline.

It is intentionally small: a Node.js/Express JSON API backed by SQLite (using Node's built-in
`node:sqlite` module, so there are no native dependencies) and a dependency-free single-page
frontend.

## Requirements

- Node.js 22.13 or newer (for the built-in SQLite module)

## Getting started

```bash
npm install
npm run seed     # optional: load a few sample companies, contacts, deals and activities
npm start        # serves the app at http://localhost:3000
```

`npm run dev` starts the server with auto-reload on file changes.

The database is created automatically at `data/crm.db`. Override the location with
`CRM_DB_PATH`, and the port with `PORT`.

## Features

- **Dashboard** – open pipeline value, won value and win rate, deal counts per stage,
  upcoming activities, recently updated deals.
- **Deals** – kanban board with the stages `lead → qualified → proposal → negotiation → won / lost`.
  Move deals between stages by drag-and-drop or with the stage selector on each card.
- **Contacts** – searchable list, linked to a company, with the contact's deals and activity history.
- **Companies** – searchable list with their contacts and deals.
- **Activities** – log notes, calls, emails, meetings and tasks against a contact and/or a deal,
  with due dates and a completed flag.

## API

All endpoints accept and return JSON.

| Resource   | Endpoints |
|------------|-----------|
| Companies  | `GET/POST /api/companies`, `GET/PUT/DELETE /api/companies/:id` (`?q=` search) |
| Contacts   | `GET/POST /api/contacts`, `GET/PUT/DELETE /api/contacts/:id` (`?q=`, `?company_id=`) |
| Deals      | `GET/POST /api/deals`, `GET/PUT/DELETE /api/deals/:id`, `PATCH /api/deals/:id/stage` (`?stage=`, `?contact_id=`, `?company_id=`) |
| Activities | `GET/POST /api/activities`, `GET/PUT/DELETE /api/activities/:id` (`?contact_id=`, `?deal_id=`, `?completed=true|false`) |
| Dashboard  | `GET /api/dashboard` |
| Meta       | `GET /api/meta` (valid deal stages and activity types) |

`PUT` performs a partial update: only the fields you send are changed. Validation errors
return `400` with `{ "error": "..." }`; unknown ids return `404`.

Example:

```bash
curl -X POST localhost:3000/api/deals \
  -H 'content-type: application/json' \
  -d '{"title":"Annual license","value":24000,"stage":"proposal","close_date":"2026-11-30"}'
```

## Project layout

```
src/db.js       schema and database setup
src/app.js      Express app and API routes
src/server.js   entry point
src/seed.js     sample data loader
public/         frontend (index.html, app.js, styles.css)
test/           API tests (node:test)
```

## Tests

```bash
npm test
```
