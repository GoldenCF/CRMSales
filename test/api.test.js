import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let base;

before(async () => {
  const db = openDatabase(':memory:');
  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => server?.close());

async function api(method, route, body) {
  const res = await fetch(base + route, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('companies: create, list, update, delete', async () => {
  const created = await api('POST', '/api/companies', { name: 'Acme', industry: 'Manufacturing' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Acme');

  const list = await api('GET', '/api/companies');
  assert.equal(list.body.length, 1);

  const updated = await api('PUT', `/api/companies/${created.body.id}`, { industry: 'Robotics' });
  assert.equal(updated.body.industry, 'Robotics');
  assert.equal(updated.body.name, 'Acme');

  const del = await api('DELETE', `/api/companies/${created.body.id}`);
  assert.equal(del.status, 204);
  assert.equal((await api('GET', `/api/companies/${created.body.id}`)).status, 404);
});

test('companies: name is required', async () => {
  const res = await api('POST', '/api/companies', { industry: 'x' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /name/);
});

test('contacts: validation and company link', async () => {
  const company = (await api('POST', '/api/companies', { name: 'Globex' })).body;

  const bad = await api('POST', '/api/contacts', { first_name: 'Raj', email: 'not-an-email' });
  assert.equal(bad.status, 400);

  const missingCompany = await api('POST', '/api/contacts', { first_name: 'Raj', company_id: 9999 });
  assert.equal(missingCompany.status, 400);

  const ok = await api('POST', '/api/contacts', { first_name: 'Raj', last_name: 'Patel', email: 'raj@globex.test', company_id: company.id });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.company_name, 'Globex');

  const search = await api('GET', '/api/contacts?q=pat');
  assert.equal(search.body.length, 1);
  assert.equal((await api('GET', '/api/contacts?q=zzz')).body.length, 0);

  // Deleting the company leaves the contact but clears the link.
  await api('DELETE', `/api/companies/${company.id}`);
  const after_ = await api('GET', `/api/contacts/${ok.body.id}`);
  assert.equal(after_.body.company_id, null);
});

test('deals: stages, pipeline move, and dashboard totals', async () => {
  const contact = (await api('POST', '/api/contacts', { first_name: 'Jane', last_name: 'Doe' })).body;

  const badStage = await api('POST', '/api/deals', { title: 'X', stage: 'bogus' });
  assert.equal(badStage.status, 400);

  const badDate = await api('POST', '/api/deals', { title: 'X', close_date: 'next week' });
  assert.equal(badDate.status, 400);

  const d1 = (await api('POST', '/api/deals', { title: 'License', value: 1000, contact_id: contact.id })).body;
  assert.equal(d1.stage, 'lead');
  assert.equal(d1.contact_name, 'Jane Doe');

  const d2 = (await api('POST', '/api/deals', { title: 'Services', value: 500, stage: 'won' })).body;
  await api('POST', '/api/deals', { title: 'Lost one', value: 250, stage: 'lost' });

  const moved = await api('PATCH', `/api/deals/${d1.id}/stage`, { stage: 'proposal' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.stage, 'proposal');

  const byStage = await api('GET', '/api/deals?stage=proposal');
  assert.deepEqual(byStage.body.map((d) => d.id), [d1.id]);

  const dash = (await api('GET', '/api/dashboard')).body;
  assert.equal(dash.open_pipeline_value, 1000);
  assert.equal(dash.open_deal_count, 1);
  assert.equal(dash.won_value, 500);
  assert.equal(dash.win_rate, 0.5);
  assert.equal(dash.pipeline.find((p) => p.stage === 'won').count, 1);
  assert.ok(dash.recent_deals.some((d) => d.id === d2.id));
});

test('activities: linked to deals and cascade on delete', async () => {
  const deal = (await api('POST', '/api/deals', { title: 'Cascade me' })).body;
  const act = await api('POST', '/api/activities', { type: 'task', subject: 'Call back', due_date: '2030-01-01', deal_id: deal.id });
  assert.equal(act.status, 201);
  assert.equal(act.body.completed, 0);
  assert.equal(act.body.deal_title, 'Cascade me');

  const badType = await api('POST', '/api/activities', { type: 'fax', subject: 'x' });
  assert.equal(badType.status, 400);

  const done = await api('PUT', `/api/activities/${act.body.id}`, { completed: true });
  assert.equal(done.body.completed, 1);

  const open = await api('GET', '/api/activities?completed=false');
  assert.ok(!open.body.some((a) => a.id === act.body.id));

  await api('DELETE', `/api/deals/${deal.id}`);
  assert.equal((await api('GET', `/api/activities/${act.body.id}`)).status, 404);
});

test('malformed JSON and unknown routes return JSON errors', async () => {
  const res = await fetch(base + '/api/contacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid JSON body');

  const missing = await api('GET', '/api/nope');
  assert.equal(missing.status, 404);
  assert.equal((await api('GET', '/api/contacts/abc')).status, 400);
});
