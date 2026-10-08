// Populate the database with a small set of sample data for trying out the CRM.
import { openDatabase } from './db.js';

const db = openDatabase();
const count = db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n;
if (count > 0 && !process.argv.includes('--force')) {
  console.log(`Database already has ${count} contacts; pass --force to add sample data anyway.`);
  process.exit(0);
}

const insertCompany = db.prepare('INSERT INTO companies (name, industry, website, phone) VALUES (?, ?, ?, ?)');
const insertContact = db.prepare('INSERT INTO contacts (first_name, last_name, email, phone, title, company_id) VALUES (?, ?, ?, ?, ?, ?)');
const insertDeal = db.prepare('INSERT INTO deals (title, value, stage, contact_id, company_id, close_date) VALUES (?, ?, ?, ?, ?, ?)');
const insertActivity = db.prepare('INSERT INTO activities (type, subject, body, due_date, completed, contact_id, deal_id) VALUES (?, ?, ?, ?, ?, ?, ?)');

const today = new Date();
const plusDays = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);

const acme = Number(insertCompany.run('Acme Corp', 'Manufacturing', 'https://acme.example.com', '+1 555 0100').lastInsertRowid);
const globex = Number(insertCompany.run('Globex', 'Software', 'https://globex.example.com', '+1 555 0200').lastInsertRowid);
const initech = Number(insertCompany.run('Initech', 'Finance', 'https://initech.example.com', '+1 555 0300').lastInsertRowid);

const jane = Number(insertContact.run('Jane', 'Doe', 'jane.doe@acme.example.com', '+1 555 0101', 'VP Operations', acme).lastInsertRowid);
const raj = Number(insertContact.run('Raj', 'Patel', 'raj@globex.example.com', '+1 555 0201', 'CTO', globex).lastInsertRowid);
const maria = Number(insertContact.run('Maria', 'Garcia', 'maria.garcia@initech.example.com', '+1 555 0301', 'Procurement Lead', initech).lastInsertRowid);
const tom = Number(insertContact.run('Tom', 'Nguyen', 'tom@globex.example.com', null, 'Engineering Manager', globex).lastInsertRowid);

const d1 = Number(insertDeal.run('Acme annual license', 24000, 'proposal', jane, acme, plusDays(20)).lastInsertRowid);
const d2 = Number(insertDeal.run('Globex platform migration', 85000, 'negotiation', raj, globex, plusDays(35)).lastInsertRowid);
const d3 = Number(insertDeal.run('Initech pilot', 12000, 'qualified', maria, initech, plusDays(45)).lastInsertRowid);
Number(insertDeal.run('Globex support add-on', 9000, 'lead', tom, globex, null).lastInsertRowid);
Number(insertDeal.run('Acme onboarding package', 6500, 'won', jane, acme, plusDays(-10)).lastInsertRowid);
Number(insertDeal.run('Initech legacy renewal', 15000, 'lost', maria, initech, plusDays(-3)).lastInsertRowid);

insertActivity.run('call', 'Discovery call with Jane', 'Walked through requirements; interested in multi-site licensing.', plusDays(-7), 1, jane, d1);
insertActivity.run('task', 'Send revised proposal', 'Include the volume discount discussed on the call.', plusDays(2), 0, jane, d1);
insertActivity.run('meeting', 'Technical review with Raj', 'Architecture deep-dive with their platform team.', plusDays(5), 0, raj, d2);
insertActivity.run('email', 'Follow up on pilot scope', null, plusDays(1), 0, maria, d3);
insertActivity.run('note', 'Tom prefers async updates', 'Avoid scheduling calls before 10am.', null, 1, tom, null);

console.log('Sample data inserted.');
