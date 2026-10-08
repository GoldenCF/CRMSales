import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEAL_STAGES, ACTIVITY_TYPES } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const str = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const num = (v, field) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${field} must be a non-negative number`);
  return n;
};
const idOrNull = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${field} must be a positive integer id`);
  return n;
};
const dateOrNull = (v, field) => {
  const s = str(v);
  if (s === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new HttpError(400, `${field} must be a date in YYYY-MM-DD format`);
  }
  return s;
};

/**
 * Build the Express app around an open database handle.
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createApp(db) {
  const app = express();
  app.use(express.json());

  // ---------- generic helpers ----------
  const exists = (table, id) => db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) !== undefined;
  const requireRef = (table, id, field) => {
    if (id !== null && !exists(table, id)) throw new HttpError(400, `${field} refers to a missing ${table.slice(0, -1)}`);
  };

  function makeResource({ table, parse, select, orderBy }) {
    const listSql = `${select} ORDER BY ${orderBy}`;
    const oneSql = `${select} WHERE t.id = ?`;
    const getOne = (id) => {
      const row = db.prepare(oneSql).get(id);
      if (!row) throw new HttpError(404, `${table.slice(0, -1)} not found`);
      return row;
    };
    const insert = (data) => {
      const cols = Object.keys(data);
      const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      const info = db.prepare(sql).run(...cols.map((c) => data[c]));
      return getOne(Number(info.lastInsertRowid));
    };
    const update = (id, data) => {
      getOne(id);
      const cols = Object.keys(data);
      const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`;
      db.prepare(sql).run(...cols.map((c) => data[c]), id);
      return getOne(id);
    };
    const remove = (id) => {
      getOne(id);
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    };
    return { listSql, getOne, insert, update, remove, parse };
  }

  const parseId = (raw) => {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'invalid id');
    return id;
  };

  function mountCrud(route, res, { list }) {
    app.get(route, (req, res_) => res_.json(list(req)));
    app.get(`${route}/:id`, (req, res_) => res_.json(res.getOne(parseId(req.params.id))));
    app.post(route, (req, res_) => res_.status(201).json(res.insert(res.parse(req.body ?? {}, null))));
    app.put(`${route}/:id`, (req, res_) => {
      const id = parseId(req.params.id);
      const current = res.getOne(id);
      res_.json(res.update(id, res.parse({ ...current, ...(req.body ?? {}) }, current)));
    });
    app.delete(`${route}/:id`, (req, res_) => {
      res.remove(parseId(req.params.id));
      res_.status(204).end();
    });
  }

  // ---------- companies ----------
  const companies = makeResource({
    table: 'companies',
    select: `SELECT t.*,
               (SELECT COUNT(*) FROM contacts c WHERE c.company_id = t.id) AS contact_count,
               (SELECT COUNT(*) FROM deals d WHERE d.company_id = t.id)    AS deal_count
             FROM companies t`,
    orderBy: 't.name COLLATE NOCASE',
    parse(b) {
      const name = str(b.name);
      if (!name) throw new HttpError(400, 'name is required');
      return { name, industry: str(b.industry), website: str(b.website), phone: str(b.phone), notes: str(b.notes) };
    },
  });
  mountCrud('/api/companies', companies, {
    list: (req) => {
      const q = str(req.query.q);
      if (!q) return db.prepare(companies.listSql).all();
      return db.prepare(companies.listSql.replace('FROM companies t', 'FROM companies t WHERE t.name LIKE ? OR t.industry LIKE ?'))
        .all(`%${q}%`, `%${q}%`);
    },
  });

  // ---------- contacts ----------
  const contacts = makeResource({
    table: 'contacts',
    select: `SELECT t.*, co.name AS company_name,
               (SELECT COUNT(*) FROM deals d WHERE d.contact_id = t.id) AS deal_count
             FROM contacts t LEFT JOIN companies co ON co.id = t.company_id`,
    orderBy: 't.last_name COLLATE NOCASE, t.first_name COLLATE NOCASE',
    parse(b) {
      const first_name = str(b.first_name);
      if (!first_name) throw new HttpError(400, 'first_name is required');
      const email = str(b.email);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'email is not valid');
      const company_id = idOrNull(b.company_id, 'company_id');
      requireRef('companies', company_id, 'company_id');
      return {
        first_name, last_name: str(b.last_name) ?? '', email, phone: str(b.phone), title: str(b.title), company_id, notes: str(b.notes),
      };
    },
  });
  mountCrud('/api/contacts', contacts, {
    list: (req) => {
      const q = str(req.query.q);
      const companyId = idOrNull(req.query.company_id, 'company_id');
      const where = [];
      const params = [];
      if (q) {
        where.push(`(t.first_name || ' ' || t.last_name LIKE ? OR t.email LIKE ? OR co.name LIKE ?)`);
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      if (companyId) { where.push('t.company_id = ?'); params.push(companyId); }
      const sql = where.length
        ? contacts.listSql.replace(' ORDER BY', ` WHERE ${where.join(' AND ')} ORDER BY`)
        : contacts.listSql;
      return db.prepare(sql).all(...params);
    },
  });

  // ---------- deals ----------
  const deals = makeResource({
    table: 'deals',
    select: `SELECT t.*, co.name AS company_name,
               c.first_name || ' ' || c.last_name AS contact_name
             FROM deals t
             LEFT JOIN companies co ON co.id = t.company_id
             LEFT JOIN contacts  c  ON c.id  = t.contact_id`,
    orderBy: 't.updated_at DESC, t.id DESC',
    parse(b) {
      const title = str(b.title);
      if (!title) throw new HttpError(400, 'title is required');
      const stage = str(b.stage) ?? 'lead';
      if (!DEAL_STAGES.includes(stage)) throw new HttpError(400, `stage must be one of: ${DEAL_STAGES.join(', ')}`);
      const contact_id = idOrNull(b.contact_id, 'contact_id');
      const company_id = idOrNull(b.company_id, 'company_id');
      requireRef('contacts', contact_id, 'contact_id');
      requireRef('companies', company_id, 'company_id');
      return {
        title, value: num(b.value, 'value'), stage, contact_id, company_id,
        close_date: dateOrNull(b.close_date, 'close_date'), notes: str(b.notes),
      };
    },
  });
  mountCrud('/api/deals', deals, {
    list: (req) => {
      const stage = str(req.query.stage);
      const contactId = idOrNull(req.query.contact_id, 'contact_id');
      const companyId = idOrNull(req.query.company_id, 'company_id');
      const where = [];
      const params = [];
      if (stage) {
        if (!DEAL_STAGES.includes(stage)) throw new HttpError(400, 'unknown stage');
        where.push('t.stage = ?'); params.push(stage);
      }
      if (contactId) { where.push('t.contact_id = ?'); params.push(contactId); }
      if (companyId) { where.push('t.company_id = ?'); params.push(companyId); }
      const sql = where.length ? deals.listSql.replace(' ORDER BY', ` WHERE ${where.join(' AND ')} ORDER BY`) : deals.listSql;
      return db.prepare(sql).all(...params);
    },
  });
  // Convenience endpoint for moving a deal between pipeline stages.
  app.patch('/api/deals/:id/stage', (req, res) => {
    const id = parseId(req.params.id);
    const current = deals.getOne(id);
    const stage = str(req.body?.stage);
    if (!DEAL_STAGES.includes(stage)) throw new HttpError(400, `stage must be one of: ${DEAL_STAGES.join(', ')}`);
    res.json(deals.update(id, deals.parse({ ...current, stage })));
  });

  // ---------- activities ----------
  const activities = makeResource({
    table: 'activities',
    select: `SELECT t.*, d.title AS deal_title,
               c.first_name || ' ' || c.last_name AS contact_name
             FROM activities t
             LEFT JOIN deals    d ON d.id = t.deal_id
             LEFT JOIN contacts c ON c.id = t.contact_id`,
    orderBy: 't.completed ASC, COALESCE(t.due_date, t.created_at) ASC, t.id DESC',
    parse(b) {
      const subject = str(b.subject);
      if (!subject) throw new HttpError(400, 'subject is required');
      const type = str(b.type) ?? 'note';
      if (!ACTIVITY_TYPES.includes(type)) throw new HttpError(400, `type must be one of: ${ACTIVITY_TYPES.join(', ')}`);
      const contact_id = idOrNull(b.contact_id, 'contact_id');
      const deal_id = idOrNull(b.deal_id, 'deal_id');
      requireRef('contacts', contact_id, 'contact_id');
      requireRef('deals', deal_id, 'deal_id');
      return {
        type, subject, body: str(b.body), due_date: dateOrNull(b.due_date, 'due_date'),
        completed: b.completed === true || b.completed === 1 || b.completed === 'true' ? 1 : 0,
        contact_id, deal_id,
      };
    },
  });
  mountCrud('/api/activities', activities, {
    list: (req) => {
      const contactId = idOrNull(req.query.contact_id, 'contact_id');
      const dealId = idOrNull(req.query.deal_id, 'deal_id');
      const where = [];
      const params = [];
      if (contactId) { where.push('t.contact_id = ?'); params.push(contactId); }
      if (dealId) { where.push('t.deal_id = ?'); params.push(dealId); }
      if (req.query.completed === 'true' || req.query.completed === 'false') {
        where.push('t.completed = ?'); params.push(req.query.completed === 'true' ? 1 : 0);
      }
      const sql = where.length ? activities.listSql.replace(' ORDER BY', ` WHERE ${where.join(' AND ')} ORDER BY`) : activities.listSql;
      return db.prepare(sql).all(...params);
    },
  });

  // ---------- dashboard ----------
  app.get('/api/dashboard', (_req, res) => {
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM contacts)  AS contacts,
        (SELECT COUNT(*) FROM companies) AS companies,
        (SELECT COUNT(*) FROM deals)     AS deals,
        (SELECT COUNT(*) FROM activities WHERE completed = 0 AND type = 'task') AS open_tasks
    `).get();
    const byStage = db.prepare(`SELECT stage, COUNT(*) AS count, COALESCE(SUM(value), 0) AS value FROM deals GROUP BY stage`).all();
    const pipeline = DEAL_STAGES.map((stage) => {
      const row = byStage.find((r) => r.stage === stage);
      return { stage, count: row?.count ?? 0, value: row?.value ?? 0 };
    });
    const open = pipeline.filter((p) => !['won', 'lost'].includes(p.stage));
    const won = pipeline.find((p) => p.stage === 'won');
    const lost = pipeline.find((p) => p.stage === 'lost');
    const closed = won.count + lost.count;
    const upcoming = db.prepare(`
      SELECT t.*, d.title AS deal_title, c.first_name || ' ' || c.last_name AS contact_name
      FROM activities t
      LEFT JOIN deals d ON d.id = t.deal_id
      LEFT JOIN contacts c ON c.id = t.contact_id
      WHERE t.completed = 0 AND t.due_date IS NOT NULL
      ORDER BY t.due_date ASC LIMIT 10
    `).all();
    const recentDeals = db.prepare(deals.listSql + ' LIMIT 5').all();
    res.json({
      counts,
      pipeline,
      open_pipeline_value: open.reduce((s, p) => s + p.value, 0),
      open_deal_count: open.reduce((s, p) => s + p.count, 0),
      won_value: won.value,
      win_rate: closed ? won.count / closed : 0,
      upcoming_activities: upcoming,
      recent_deals: recentDeals,
    });
  });

  app.get('/api/meta', (_req, res) => res.json({ deal_stages: DEAL_STAGES, activity_types: ACTIVITY_TYPES }));

  // ---------- static frontend ----------
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON body' });
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'internal server error' : err.message });
  });

  return app;
}
