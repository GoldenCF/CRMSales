/* Sales CRM frontend: a small hash-routed single-page app talking to /api. */
(() => {
  const view = document.getElementById('view');
  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const fmtMoney = (n) => money.format(Number(n) || 0);
  const fmtDate = (s) => (s ? s.slice(0, 10) : '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  let meta = { deal_stages: [], activity_types: [] };

  // ---------- API ----------
  async function api(method, route, body) {
    const res = await fetch(route, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({ error: 'unexpected response' }));
    if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
    return data;
  }
  const get = (r) => api('GET', r);

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
  }

  // ---------- modal form ----------
  const modal = document.getElementById('modal');
  const modalForm = document.getElementById('modal-form');
  document.getElementById('modal-close').onclick = closeModal;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  function closeModal() { modal.classList.add('hidden'); modalForm.innerHTML = ''; }

  function fieldHtml(f, value) {
    const v = value ?? '';
    const label = `<label for="f-${f.name}">${esc(f.label)}${f.required ? ' *' : ''}</label>`;
    let input;
    if (f.type === 'select') {
      input = `<select id="f-${f.name}" name="${f.name}">${(f.allowEmpty ? '<option value="">—</option>' : '')}${f.options.map((o) =>
        `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="f-${f.name}" name="${f.name}">${esc(v)}</textarea>`;
    } else if (f.type === 'checkbox') {
      input = `<input type="checkbox" id="f-${f.name}" name="${f.name}" ${v ? 'checked' : ''} style="width:auto">`;
    } else {
      input = `<input type="${f.type || 'text'}" id="f-${f.name}" name="${f.name}" value="${esc(v)}" ${f.required ? 'required' : ''} ${f.step ? `step="${f.step}"` : ''}>`;
    }
    return `<div class="field">${label}${input}</div>`;
  }

  /**
   * Open a modal form. `fields` may contain arrays to render two fields side by side.
   * Returns a promise resolving with the submitted (and saved) record, or null if cancelled.
   */
  function openForm({ title, fields, values = {}, onSubmit, onDelete }) {
    document.getElementById('modal-title').textContent = title;
    const rows = fields.map((f) => Array.isArray(f)
      ? `<div class="field-row">${f.map((g) => fieldHtml(g, values[g.name])).join('')}</div>`
      : fieldHtml(f, values[f.name])).join('');
    modalForm.innerHTML = `${rows}
      <div class="form-error hidden" id="form-error"></div>
      <div class="form-actions">
        <div>${onDelete ? '<button type="button" class="danger" id="form-delete">Delete</button>' : ''}</div>
        <div class="right">
          <button type="button" id="form-cancel">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </div>`;
    modal.classList.remove('hidden');
    modalForm.querySelector('input, select, textarea')?.focus();
    modalForm.querySelector('#form-cancel').onclick = closeModal;
    const errEl = modalForm.querySelector('#form-error');
    const showErr = (e) => { errEl.textContent = e.message; errEl.classList.remove('hidden'); };
    if (onDelete) {
      modalForm.querySelector('#form-delete').onclick = async () => {
        if (!confirm('Delete this record? This cannot be undone.')) return;
        try { await onDelete(); closeModal(); } catch (e) { showErr(e); }
      };
    }
    modalForm.onsubmit = async (e) => {
      e.preventDefault();
      const data = {};
      for (const el of modalForm.elements) {
        if (!el.name) continue;
        data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      }
      try { await onSubmit(data); closeModal(); } catch (err) { showErr(err); }
    };
  }

  // ---------- record forms ----------
  const companyOptions = async () => (await get('/api/companies')).map((c) => ({ value: c.id, label: c.name }));
  const contactOptions = async () => (await get('/api/contacts')).map((c) => ({ value: c.id, label: `${c.first_name} ${c.last_name}`.trim() }));
  const dealOptions = async () => (await get('/api/deals')).map((d) => ({ value: d.id, label: d.title }));

  async function editCompany(company, done) {
    openForm({
      title: company ? 'Edit company' : 'New company',
      values: company || {},
      fields: [
        { name: 'name', label: 'Name', required: true },
        [{ name: 'industry', label: 'Industry' }, { name: 'phone', label: 'Phone' }],
        { name: 'website', label: 'Website', type: 'url' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onSubmit: async (d) => { await api(company ? 'PUT' : 'POST', company ? `/api/companies/${company.id}` : '/api/companies', d); toast('Company saved'); done(); },
      onDelete: company && (async () => { await api('DELETE', `/api/companies/${company.id}`); toast('Company deleted'); done(true); }),
    });
  }

  async function editContact(contact, done, defaults = {}) {
    const companies = await companyOptions();
    openForm({
      title: contact ? 'Edit contact' : 'New contact',
      values: contact || defaults,
      fields: [
        [{ name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name' }],
        [{ name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' }],
        [{ name: 'title', label: 'Job title' }, { name: 'company_id', label: 'Company', type: 'select', options: companies, allowEmpty: true }],
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onSubmit: async (d) => { await api(contact ? 'PUT' : 'POST', contact ? `/api/contacts/${contact.id}` : '/api/contacts', d); toast('Contact saved'); done(); },
      onDelete: contact && (async () => { await api('DELETE', `/api/contacts/${contact.id}`); toast('Contact deleted'); done(true); }),
    });
  }

  async function editDeal(deal, done, defaults = {}) {
    const [companies, contacts] = await Promise.all([companyOptions(), contactOptions()]);
    openForm({
      title: deal ? 'Edit deal' : 'New deal',
      values: deal || { stage: 'lead', ...defaults },
      fields: [
        { name: 'title', label: 'Title', required: true },
        [{ name: 'value', label: 'Value (USD)', type: 'number', step: '0.01' },
         { name: 'stage', label: 'Stage', type: 'select', options: meta.deal_stages.map((s) => ({ value: s, label: cap(s) })) }],
        [{ name: 'contact_id', label: 'Contact', type: 'select', options: contacts, allowEmpty: true },
         { name: 'company_id', label: 'Company', type: 'select', options: companies, allowEmpty: true }],
        { name: 'close_date', label: 'Expected close date', type: 'date' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onSubmit: async (d) => { await api(deal ? 'PUT' : 'POST', deal ? `/api/deals/${deal.id}` : '/api/deals', d); toast('Deal saved'); done(); },
      onDelete: deal && (async () => { await api('DELETE', `/api/deals/${deal.id}`); toast('Deal deleted'); done(true); }),
    });
  }

  async function editActivity(activity, done, defaults = {}) {
    const [contacts, deals] = await Promise.all([contactOptions(), dealOptions()]);
    openForm({
      title: activity ? 'Edit activity' : 'Log activity',
      values: activity || { type: 'note', ...defaults },
      fields: [
        [{ name: 'type', label: 'Type', type: 'select', options: meta.activity_types.map((t) => ({ value: t, label: cap(t) })) },
         { name: 'due_date', label: 'Due date', type: 'date' }],
        { name: 'subject', label: 'Subject', required: true },
        { name: 'body', label: 'Details', type: 'textarea' },
        [{ name: 'contact_id', label: 'Contact', type: 'select', options: contacts, allowEmpty: true },
         { name: 'deal_id', label: 'Deal', type: 'select', options: deals, allowEmpty: true }],
        { name: 'completed', label: 'Completed', type: 'checkbox' },
      ],
      onSubmit: async (d) => { await api(activity ? 'PUT' : 'POST', activity ? `/api/activities/${activity.id}` : '/api/activities', d); toast('Activity saved'); done(); },
      onDelete: activity && (async () => { await api('DELETE', `/api/activities/${activity.id}`); toast('Activity deleted'); done(true); }),
    });
  }

  // ---------- shared renderers ----------
  function activityList(items, reload) {
    if (!items.length) return '<div class="empty">No activities yet.</div>';
    return items.map((a) => `
      <div class="activity ${a.completed ? 'done' : ''}" data-id="${a.id}">
        <input type="checkbox" data-toggle="${a.id}" ${a.completed ? 'checked' : ''} title="Mark complete">
        <div class="what">
          <span class="badge">${esc(a.type)}</span>
          <span class="subject">${esc(a.subject)}</span>
          <span class="muted"> ${a.due_date ? '· due ' + fmtDate(a.due_date) : ''}
            ${a.contact_name ? `· <a href="#/contacts/${a.contact_id}">${esc(a.contact_name)}</a>` : ''}
            ${a.deal_title ? `· <a href="#/deals/${a.deal_id}">${esc(a.deal_title)}</a>` : ''}</span>
          ${a.body ? `<div class="body">${esc(a.body)}</div>` : ''}
        </div>
        <button class="small" data-edit-activity="${a.id}">Edit</button>
      </div>`).join('');
  }
  function wireActivityList(root, items, reload) {
    root.querySelectorAll('[data-toggle]').forEach((cb) => {
      cb.onchange = async () => {
        await api('PUT', `/api/activities/${cb.dataset.toggle}`, { completed: cb.checked });
        reload();
      };
    });
    root.querySelectorAll('[data-edit-activity]').forEach((b) => {
      b.onclick = () => editActivity(items.find((a) => a.id === Number(b.dataset.editActivity)), reload);
    });
  }
  const stageBadge = (s) => `<span class="badge ${esc(s)}">${esc(s)}</span>`;

  // ---------- pages ----------
  async function dashboard() {
    const d = await get('/api/dashboard');
    view.innerHTML = `
      <div class="page-head"><h1>Dashboard</h1>
        <div class="actions"><button class="primary" id="new-deal">+ New deal</button></div></div>
      <div class="grid stats">
        <div class="card stat"><div class="label">Open pipeline</div><div class="value">${fmtMoney(d.open_pipeline_value)}</div><div class="muted">${d.open_deal_count} open deals</div></div>
        <div class="card stat"><div class="label">Won</div><div class="value">${fmtMoney(d.won_value)}</div><div class="muted">win rate ${Math.round(d.win_rate * 100)}%</div></div>
        <div class="card stat"><div class="label">Contacts</div><div class="value">${d.counts.contacts}</div><div class="muted">${d.counts.companies} companies</div></div>
        <div class="card stat"><div class="label">Open tasks</div><div class="value">${d.counts.open_tasks}</div></div>
      </div>
      <div class="two-col">
        <div class="card"><h2>Pipeline by stage</h2>
          <table><thead><tr><th>Stage</th><th class="num">Deals</th><th class="num">Value</th></tr></thead><tbody>
            ${d.pipeline.map((p) => `<tr><td>${stageBadge(p.stage)}</td><td class="num">${p.count}</td><td class="num">${fmtMoney(p.value)}</td></tr>`).join('')}
          </tbody></table></div>
        <div class="card"><h2>Upcoming activities</h2><div id="upcoming">${activityList(d.upcoming_activities)}</div></div>
      </div>
      <div class="card" style="margin-top:16px"><h2>Recently updated deals</h2>
        ${d.recent_deals.length ? `<table><thead><tr><th>Deal</th><th>Stage</th><th>Contact</th><th class="num">Value</th></tr></thead><tbody>
          ${d.recent_deals.map((x) => `<tr class="clickable" data-href="#/deals/${x.id}"><td>${esc(x.title)}</td><td>${stageBadge(x.stage)}</td><td>${esc(x.contact_name || '')}</td><td class="num">${fmtMoney(x.value)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">No deals yet. Create one to get started.</div>'}
      </div>`;
    document.getElementById('new-deal').onclick = () => editDeal(null, dashboard);
    wireActivityList(document.getElementById('upcoming'), d.upcoming_activities, dashboard);
    wireRows();
  }

  async function dealsPage() {
    const deals = await get('/api/deals');
    const byStage = Object.fromEntries(meta.deal_stages.map((s) => [s, deals.filter((d) => d.stage === s)]));
    view.innerHTML = `
      <div class="page-head"><h1>Deals</h1>
        <div class="actions"><button class="primary" id="new-deal">+ New deal</button></div></div>
      <div class="pipeline">
        ${meta.deal_stages.map((s) => `
          <div class="stage-col" data-stage="${s}">
            <div class="stage-head"><span>${s} (${byStage[s].length})</span><span class="sum">${fmtMoney(byStage[s].reduce((t, d) => t + d.value, 0))}</span></div>
            ${byStage[s].map((d) => `
              <div class="deal-card" draggable="true" data-id="${d.id}">
                <div class="title"><a href="#/deals/${d.id}">${esc(d.title)}</a></div>
                <div class="meta">${esc([d.company_name, d.contact_name].filter(Boolean).join(' · ')) || '&nbsp;'}</div>
                <div class="value">${fmtMoney(d.value)}${d.close_date ? ` <span class="muted">· ${fmtDate(d.close_date)}</span>` : ''}</div>
                <select data-move="${d.id}" aria-label="Move stage">${meta.deal_stages.map((t) => `<option value="${t}" ${t === s ? 'selected' : ''}>${cap(t)}</option>`).join('')}</select>
              </div>`).join('')}
          </div>`).join('')}
      </div>`;
    document.getElementById('new-deal').onclick = () => editDeal(null, dealsPage);
    const move = async (id, stage) => { await api('PATCH', `/api/deals/${id}/stage`, { stage }); toast(`Moved to ${stage}`); dealsPage(); };
    view.querySelectorAll('[data-move]').forEach((sel) => { sel.onchange = () => move(sel.dataset.move, sel.value); });
    // Drag and drop between columns.
    view.querySelectorAll('.deal-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', card.dataset.id));
    });
    view.querySelectorAll('.stage-col').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', (e) => {
        e.preventDefault(); col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const current = deals.find((d) => d.id === Number(id));
        if (current && current.stage !== col.dataset.stage) move(id, col.dataset.stage);
      });
    });
  }

  async function dealDetail(id) {
    const [deal, activities] = await Promise.all([get(`/api/deals/${id}`), get(`/api/activities?deal_id=${id}`)]);
    const reload = (deleted) => (deleted ? go('#/deals') : dealDetail(id));
    view.innerHTML = `
      <div class="page-head">
        <div class="detail-head"><div><a href="#/deals">← Deals</a><h1>${esc(deal.title)}</h1>
          <div class="sub">${stageBadge(deal.stage)} &nbsp; ${fmtMoney(deal.value)}</div></div></div>
        <div class="actions"><button id="log">+ Log activity</button><button class="primary" id="edit">Edit</button></div></div>
      <div class="two-col" style="margin-top:0">
        <div class="card"><h2>Details</h2><dl>
          <dt>Contact</dt><dd>${deal.contact_id ? `<a href="#/contacts/${deal.contact_id}">${esc(deal.contact_name)}</a>` : '—'}</dd>
          <dt>Company</dt><dd>${deal.company_id ? `<a href="#/companies/${deal.company_id}">${esc(deal.company_name)}</a>` : '—'}</dd>
          <dt>Expected close</dt><dd>${fmtDate(deal.close_date) || '—'}</dd>
          <dt>Created</dt><dd>${fmtDate(deal.created_at)}</dd>
          <dt>Notes</dt><dd style="white-space:pre-wrap">${esc(deal.notes) || '—'}</dd></dl></div>
        <div class="card"><h2>Activities</h2><div id="acts">${activityList(activities)}</div></div>
      </div>`;
    document.getElementById('edit').onclick = () => editDeal(deal, reload);
    document.getElementById('log').onclick = () => editActivity(null, reload, { deal_id: deal.id, contact_id: deal.contact_id });
    wireActivityList(document.getElementById('acts'), activities, reload);
  }

  async function contactsPage(q = '') {
    const contacts = await get(`/api/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    view.innerHTML = `
      <div class="page-head"><h1>Contacts</h1>
        <div class="actions"><input type="search" id="q" placeholder="Search name, email, company" value="${esc(q)}"><button class="primary" id="new">+ New contact</button></div></div>
      <div class="card table-wrap">${contacts.length ? `<table><thead><tr><th>Name</th><th>Title</th><th>Company</th><th>Email</th><th>Phone</th><th class="num">Deals</th></tr></thead><tbody>
        ${contacts.map((c) => `<tr class="clickable" data-href="#/contacts/${c.id}"><td>${esc(c.first_name)} ${esc(c.last_name)}</td><td>${esc(c.title || '')}</td><td>${esc(c.company_name || '')}</td><td>${esc(c.email || '')}</td><td>${esc(c.phone || '')}</td><td class="num">${c.deal_count}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No contacts found.</div>'}</div>`;
    document.getElementById('new').onclick = () => editContact(null, () => contactsPage(q));
    const qEl = document.getElementById('q');
    let t; qEl.oninput = () => { clearTimeout(t); t = setTimeout(() => contactsPage(qEl.value), 250); };
    if (q) { qEl.focus(); qEl.setSelectionRange(q.length, q.length); }
    wireRows();
  }

  async function contactDetail(id) {
    const [c, deals, activities] = await Promise.all([get(`/api/contacts/${id}`), get(`/api/deals?contact_id=${id}`), get(`/api/activities?contact_id=${id}`)]);
    const reload = (deleted) => (deleted ? go('#/contacts') : contactDetail(id));
    view.innerHTML = `
      <div class="page-head">
        <div class="detail-head"><div><a href="#/contacts">← Contacts</a><h1>${esc(c.first_name)} ${esc(c.last_name)}</h1>
          <div class="sub">${esc([c.title, c.company_name].filter(Boolean).join(' · '))}</div></div></div>
        <div class="actions"><button id="log">+ Log activity</button><button id="deal">+ New deal</button><button class="primary" id="edit">Edit</button></div></div>
      <div class="two-col" style="margin-top:0">
        <div>
          <div class="card"><h2>Details</h2><dl>
            <dt>Email</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</dd>
            <dt>Phone</dt><dd>${esc(c.phone) || '—'}</dd>
            <dt>Company</dt><dd>${c.company_id ? `<a href="#/companies/${c.company_id}">${esc(c.company_name)}</a>` : '—'}</dd>
            <dt>Notes</dt><dd style="white-space:pre-wrap">${esc(c.notes) || '—'}</dd></dl></div>
          <div class="card" style="margin-top:16px"><h2>Deals</h2>${deals.length ? `<table><tbody>
            ${deals.map((d) => `<tr class="clickable" data-href="#/deals/${d.id}"><td>${esc(d.title)}</td><td>${stageBadge(d.stage)}</td><td class="num">${fmtMoney(d.value)}</td></tr>`).join('')}
          </tbody></table>` : '<div class="empty">No deals.</div>'}</div>
        </div>
        <div class="card"><h2>Activities</h2><div id="acts">${activityList(activities)}</div></div>
      </div>`;
    document.getElementById('edit').onclick = () => editContact(c, reload);
    document.getElementById('log').onclick = () => editActivity(null, reload, { contact_id: c.id });
    document.getElementById('deal').onclick = () => editDeal(null, reload, { contact_id: c.id, company_id: c.company_id });
    wireActivityList(document.getElementById('acts'), activities, reload);
    wireRows();
  }

  async function companiesPage(q = '') {
    const companies = await get(`/api/companies${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    view.innerHTML = `
      <div class="page-head"><h1>Companies</h1>
        <div class="actions"><input type="search" id="q" placeholder="Search name or industry" value="${esc(q)}"><button class="primary" id="new">+ New company</button></div></div>
      <div class="card table-wrap">${companies.length ? `<table><thead><tr><th>Name</th><th>Industry</th><th>Website</th><th>Phone</th><th class="num">Contacts</th><th class="num">Deals</th></tr></thead><tbody>
        ${companies.map((c) => `<tr class="clickable" data-href="#/companies/${c.id}"><td>${esc(c.name)}</td><td>${esc(c.industry || '')}</td><td>${esc(c.website || '')}</td><td>${esc(c.phone || '')}</td><td class="num">${c.contact_count}</td><td class="num">${c.deal_count}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No companies found.</div>'}</div>`;
    document.getElementById('new').onclick = () => editCompany(null, () => companiesPage(q));
    const qEl = document.getElementById('q');
    let t; qEl.oninput = () => { clearTimeout(t); t = setTimeout(() => companiesPage(qEl.value), 250); };
    if (q) { qEl.focus(); qEl.setSelectionRange(q.length, q.length); }
    wireRows();
  }

  async function companyDetail(id) {
    const [c, contacts, deals] = await Promise.all([get(`/api/companies/${id}`), get(`/api/contacts?company_id=${id}`), get(`/api/deals?company_id=${id}`)]);
    const reload = (deleted) => (deleted ? go('#/companies') : companyDetail(id));
    view.innerHTML = `
      <div class="page-head">
        <div class="detail-head"><div><a href="#/companies">← Companies</a><h1>${esc(c.name)}</h1><div class="sub">${esc(c.industry || '')}</div></div></div>
        <div class="actions"><button id="contact">+ New contact</button><button id="deal">+ New deal</button><button class="primary" id="edit">Edit</button></div></div>
      <div class="two-col" style="margin-top:0">
        <div>
          <div class="card"><h2>Details</h2><dl>
            <dt>Website</dt><dd>${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website)}</a>` : '—'}</dd>
            <dt>Phone</dt><dd>${esc(c.phone) || '—'}</dd>
            <dt>Notes</dt><dd style="white-space:pre-wrap">${esc(c.notes) || '—'}</dd></dl></div>
          <div class="card" style="margin-top:16px"><h2>Contacts</h2>${contacts.length ? `<table><tbody>
            ${contacts.map((x) => `<tr class="clickable" data-href="#/contacts/${x.id}"><td>${esc(x.first_name)} ${esc(x.last_name)}</td><td>${esc(x.title || '')}</td><td>${esc(x.email || '')}</td></tr>`).join('')}
          </tbody></table>` : '<div class="empty">No contacts.</div>'}</div>
        </div>
        <div class="card"><h2>Deals</h2>${deals.length ? `<table><tbody>
          ${deals.map((d) => `<tr class="clickable" data-href="#/deals/${d.id}"><td>${esc(d.title)}</td><td>${stageBadge(d.stage)}</td><td class="num">${fmtMoney(d.value)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">No deals.</div>'}</div>
      </div>`;
    document.getElementById('edit').onclick = () => editCompany(c, reload);
    document.getElementById('contact').onclick = () => editContact(null, reload, { company_id: c.id });
    document.getElementById('deal').onclick = () => editDeal(null, reload, { company_id: c.id });
    wireRows();
  }

  async function activitiesPage(filter = 'open') {
    const items = await get(`/api/activities${filter === 'all' ? '' : `?completed=${filter === 'done'}`}`);
    view.innerHTML = `
      <div class="page-head"><h1>Activities</h1>
        <div class="actions">
          <select id="filter"><option value="open" ${filter === 'open' ? 'selected' : ''}>Open</option><option value="done" ${filter === 'done' ? 'selected' : ''}>Completed</option><option value="all" ${filter === 'all' ? 'selected' : ''}>All</option></select>
          <button class="primary" id="new">+ Log activity</button></div></div>
      <div class="card" id="acts">${activityList(items)}</div>`;
    const reload = () => activitiesPage(document.getElementById('filter').value);
    document.getElementById('filter').onchange = reload;
    document.getElementById('new').onclick = () => editActivity(null, reload);
    wireActivityList(document.getElementById('acts'), items, reload);
  }

  function wireRows() {
    view.querySelectorAll('tr[data-href]').forEach((tr) => { tr.onclick = () => go(tr.dataset.href); });
  }

  // ---------- router ----------
  const routes = [
    [/^#\/dashboard$/, () => dashboard()],
    [/^#\/deals$/, () => dealsPage()],
    [/^#\/deals\/(\d+)$/, (m) => dealDetail(m[1])],
    [/^#\/contacts$/, () => contactsPage()],
    [/^#\/contacts\/(\d+)$/, (m) => contactDetail(m[1])],
    [/^#\/companies$/, () => companiesPage()],
    [/^#\/companies\/(\d+)$/, (m) => companyDetail(m[1])],
    [/^#\/activities$/, () => activitiesPage()],
  ];
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  async function route() {
    const hash = location.hash || '#/dashboard';
    const section = hash.split('/')[1];
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === section));
    for (const [re, fn] of routes) {
      const m = hash.match(re);
      if (m) {
        try { await fn(m); } catch (e) { view.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
        return;
      }
    }
    location.hash = '#/dashboard';
  }
  window.addEventListener('hashchange', route);
  get('/api/meta').then((m) => { meta = m; route(); });
})();
