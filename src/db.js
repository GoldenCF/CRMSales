import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
export const ACTIVITY_TYPES = ['note', 'call', 'email', 'meeting', 'task'];

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS companies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    industry   TEXT,
    website    TEXT,
    phone      TEXT,
    notes      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name  TEXT NOT NULL DEFAULT '',
    email      TEXT,
    phone      TEXT,
    title      TEXT,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    notes      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    value       REAL NOT NULL DEFAULT 0,
    stage       TEXT NOT NULL DEFAULT 'lead',
    contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    company_id  INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    close_date  TEXT,
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL DEFAULT 'note',
    subject     TEXT NOT NULL,
    body        TEXT,
    due_date    TEXT,
    completed   INTEGER NOT NULL DEFAULT 0,
    contact_id  INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    deal_id     INTEGER REFERENCES deals(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
  CREATE INDEX IF NOT EXISTS idx_deals_stage      ON deals(stage);
  CREATE INDEX IF NOT EXISTS idx_deals_contact    ON deals(contact_id);
  CREATE INDEX IF NOT EXISTS idx_activities_deal  ON activities(deal_id);
  CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id);
`;

/**
 * Open (or create) the CRM database and make sure the schema exists.
 * @param {string} [file] path to the sqlite file, or ':memory:'
 */
export function openDatabase(file) {
  const dbPath = file ?? process.env.CRM_DB_PATH ?? path.join(__dirname, '..', 'data', 'crm.db');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return db;
}
