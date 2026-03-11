/**
 * admin.js — Admin Dashboard Logic for PetabyteAi
 * Features: User Management (add/edit/delete), Project Management, Rate Config, Activity Log
 */

document.addEventListener('DOMContentLoaded', function () {
  if (!Auth.check('admin')) return;
  var session = Auth.getSession();
  var el = document.getElementById('admin-display-name');
  if (el) el.textContent = session.displayName || session.username;
  admin.init();
});

// ── Helpers ───────────────────────────────────────────────
function formatTHB(n) { return '฿' + parseFloat(n || 0).toFixed(2); }
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}
function flash(msg, type) {
  type = type || '';
  var el = document.getElementById('flash');
  el.textContent = msg;
  el.className = 'flash show' + (type ? ' flash-' + type : '');
  setTimeout(function () { el.classList.remove('show'); }, 2800);
}
function showModal(id) { document.getElementById(id).classList.add('show'); }
function hideModal(id) { document.getElementById(id).classList.remove('show'); }

// ── Admin App ─────────────────────────────────────────────
var admin = {
  currentView: 'overview',
  _selectedProject: null,

  init: function () {
    Auth.initDefaults();
    this.navigate('overview');
    var hbtn = document.getElementById('hamburger-btn');
    if (hbtn) hbtn.addEventListener('click', function () {
      document.getElementById('sidebar').classList.toggle('open');
    });
    this.refreshProjectSelects();
  },

  navigate: function (view) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
    var target = document.getElementById('view-' + view);
    var nav = document.getElementById('nav-' + view);
    if (target) target.classList.remove('hidden');
    if (nav) nav.classList.add('active');
    this.currentView = view;
    window.scrollTo(0, 0);
    var self = this;
    var renders = {
      overview: function () { self.renderOverview(); },
      users: function () { self.renderUsers(); },
      projects: function () { self.renderProjects(); },
      activity: function () { self.renderActivity(); },
      usage: function () { self.renderUsage(); },
    };
    if (renders[view]) renders[view]();
    document.getElementById('sidebar').classList.remove('open');
  },

  _cachedDBUsers: [],  // cache for id lookup in action functions

  fetchUsersFromDB: function () {
    return Promise.all([
      fetch('http://localhost:3001/api/users').then(function (r) { return r.json(); }),
      fetch('http://localhost:3001/api/history').then(function (r) { return r.json(); }),
    ])
      .then(function (results) {
        var usersData = results[0].ok ? results[0].users : [];
        var historyData = results[1].ok ? results[1].history : [];
        return usersData.map(function (u) {
          // Normalize DB snake_case → camelCase so render functions work correctly
          var userHistory = historyData
            .filter(function (h) { return h.user_id === u.id; })
            .map(function (h) {
              return {
                id: h.id,
                skillId: h.skill_id,
                skillName: h.skill_name || h.skillName || '—',
                skillEmoji: h.skill_emoji || h.skillEmoji || '🤖',
                prompt: h.prompt || '',
                response: h.response || '',
                inputTokens: parseInt(h.input_tokens || h.inputTokens || 0),
                outputTokens: parseInt(h.output_tokens || h.outputTokens || 0),
                cost: parseFloat(h.cost || 0),
                durationMs: parseInt(h.duration_ms || h.durationMs || 0),
                timestamp: h.created_at || h.timestamp || new Date().toISOString(),
              };
            });
          return {
            id: u.id,
            username: u.username,
            displayName: u.display_name,
            role: u.role,
            plan: u.plan,
            balance: parseFloat(u.balance),
            projectId: u.project_id,
            createdAt: u.created_at,
            history: userHistory,
          };
        });
      })
      .catch(function () { return []; });
  },

  // Sync fallback (for action functions that need id before async completes)
  getUsersWithHistory: function () {
    if (this._cachedDBUsers && this._cachedDBUsers.length > 0) return this._cachedDBUsers;
    return Auth.getUsers().map(function (u) {
      var balance = parseFloat(localStorage.getItem('agenthub_balance_' + u.username) || u.balance || 0);
      var history = [];
      try { history = JSON.parse(localStorage.getItem('agenthub_history_' + u.username) || '[]'); } catch (e) { }
      return Object.assign({}, u, { balance: balance, history: history });
    });
  },

  // ── OVERVIEW ──────────────────────────────────────────
  renderOverview: function () {
    var self = this;
    var projects = Auth.getProjects();
    // Fetch live data from DB for accurate stats
    this.fetchUsersFromDB().then(function (dbUsers) {
      self._cachedDBUsers = dbUsers;
      var totalRequests = dbUsers.reduce(function (s, u) { return s + u.history.length; }, 0);
      var totalTokens = dbUsers.reduce(function (s, u) {
        return s + u.history.reduce(function (ss, h) { return ss + (h.inputTokens || 0) + (h.outputTokens || 0); }, 0);
      }, 0);
      var totalTopUpAll = projects.reduce(function (s, p) { return s + (p.totalTopUp || 0); }, 0);
      document.getElementById('overview-mini').innerHTML =
        '<div class="mini-card">'
        + '<div class="mini-card-label">Users</div>'
        + '<div class="mini-card-value">' + dbUsers.length + '</div>'
        + '<div class="mini-card-sub">' + projects.length + ' projects</div>'
        + '</div>'
        + '<div class="mini-card">'
        + '<div class="mini-card-label">Total Requests</div>'
        + '<div class="mini-card-value">' + totalRequests.toLocaleString() + '</div>'
        + '<div class="mini-card-sub">all time</div>'
        + '</div>'
        + '<div class="mini-card">'
        + '<div class="mini-card-label">Total Tokens</div>'
        + '<div class="mini-card-value">' + totalTokens.toLocaleString() + '</div>'
        + '<div class="mini-card-sub">input + output</div>'
        + '</div>'
        + '<div class="mini-card">'
        + '<div class="mini-card-label">Budget Topped Up</div>'
        + '<div class="mini-card-value">' + formatTHB(totalTopUpAll) + '</div>'
        + '<div class="mini-card-sub">all projects</div>'
        + '</div>';

      var saved = self._selectedProject || (projects[0] && projects[0].id) || null;
      var selectHtml = '';
      if (projects.length === 0) {
        selectHtml = '<div style="color:#444;font-size:0.85rem;padding:12px 0">ยังไม่มี Project</div>';
      } else {
        var opts = '';
        projects.forEach(function (p) {
          opts += '<option value="' + p.id + '" style="background:#fff;color:#111"' + (p.id === saved ? ' selected' : '') + '>📂 ' + p.name + '</option>';
        });
        selectHtml = '<select id="project-selector" onchange="admin.selectProject(this.value)"'
          + ' style="background:#2a2a2a;border:1px solid rgba(255,255,255,0.25);'
          + 'border-radius:8px;color:#e8e8e8;font-family:Inter,sans-serif;font-size:.875rem;'
          + 'font-weight:600;padding:9px 36px 9px 14px;cursor:pointer;outline:none;'
          + 'min-width:220px">' + opts + '</select>';
      }

      document.getElementById('overview-user-list').innerHTML =
        '<div style="margin-bottom:18px">' + selectHtml + '</div>'
        + '<div id="proj-detail"></div>';

      if (!document.getElementById('proj-tab-style')) {
        var style = document.createElement('style');
        style.id = 'proj-tab-style';
        style.textContent = '.budget-bar{height:6px;border-radius:3px;background:rgba(255,255,255,0.08);margin-top:6px;overflow:hidden;}'
          + '.budget-bar-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#fff,#aaa);transition:width .5s ease;}';
        document.head.appendChild(style);
      }

      if (saved) self.renderProjectDetail(saved);
    });
  },

  selectProject: function (projectId) {
    this._selectedProject = projectId;
    var sel = document.getElementById('project-selector');
    if (sel) sel.value = projectId;
    this.renderProjectDetail(projectId);
  },

  renderProjectDetail: function (projectId) {
    var p = Auth.getProjectById(projectId);
    var budget = Auth.getProjectBudget(projectId);
    var users = this.getUsersWithHistory().filter(function (u) { return u.projectId === projectId; });
    var container = document.getElementById('proj-detail');
    if (!p || !container) return;

    var distPct = budget.totalTopUp > 0 ? Math.min(100, (budget.distributed / budget.totalTopUp) * 100) : 0;
    var usedPct = budget.totalTopUp > 0 ? Math.min(100, (budget.costBilled / budget.totalTopUp) * 100) : 0;

    var statsArr = [
      ['💰 ยอดเติม (Top-up)', formatTHB(budget.totalTopUp), '#e8e8e8'],
      ['📤 แจกจ่ายให้ Users', formatTHB(budget.distributed), '#cccccc'],
      ['🏦 Pool คงเหลือ', formatTHB(budget.remaining), budget.remaining > 0 ? '#a0f0b0' : '#fca5a5'],
      ['💸 ใช้ไปแล้ว (Cost)', formatTHB(budget.costBilled), '#aaaaaa'],
    ];
    var statsHtml = '';
    statsArr.forEach(function (row) {
      statsHtml += '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px">'
        + '<div style="font-size:0.68rem;color:#444;margin-bottom:6px">' + row[0] + '</div>'
        + '<div style="font-size:1.15rem;font-weight:700;color:' + row[2] + ';font-family:JetBrains Mono,monospace">' + row[1] + '</div>'
        + '</div>';
    });

    var membersHtml = '';
    if (users.length === 0) {
      membersHtml = '<div style="text-align:center;padding:20px;color:#333;font-size:0.82rem;border:1px dashed rgba(255,255,255,0.06);border-radius:8px">ยังไม่มี member ใน project นี้</div>';
    } else {
      var rows = '';
      users.forEach(function (u) {
        var cost = u.history.reduce(function (s, h) { return s + (h.cost || 0); }, 0);
        rows += '<tr>'
          + '<td><span class="val">' + u.displayName + '</span><div style="font-size:.7rem;color:#444">@' + u.username + '</div></td>'
          + '<td><div style="display:flex;align-items:center;gap:5px">'
          + '<input class="input-sm" id="ov-bal-' + u.username + '" type="number" step="0.01" min="0" style="width:75px" value="' + parseFloat(u.balance).toFixed(2) + '">'
          + '<button class="btn-action btn-save" style="padding:4px 8px;font-size:.73rem" onclick="admin.applyBalanceById(\'' + u.username + '\',\'ov-bal-' + u.username + '\')">ตั้ง</button>'
          + '</div></td>'
          + '<td class="val" style="color:#999;font-size:.82rem">' + formatTHB(cost) + '</td>'
          + '<td class="val" style="color:#cccccc;font-size:.82rem">' + formatTHB(u.balance) + '</td>'
          + '<td class="val">' + u.history.length + '</td>'
          + '<td><button class="btn-action btn-danger" style="padding:4px 8px;font-size:.73rem" onclick="admin.removeFromProject(\'' + u.username + '\')">ย้ายออก</button></td>'
          + '</tr>';
      });
      membersHtml = '<div style="overflow-x:auto"><table class="user-table">'
        + '<thead><tr><th>User</th><th>Credit ที่แจก</th><th>ใช้ไป (Cost)</th><th>คงเหลือ</th><th>Requests</th><th>Action</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>';
    }

    container.innerHTML =
      '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.09);border-radius:14px;padding:22px;margin-bottom:18px">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:14px;margin-bottom:20px">'
      + '<div>'
      + '<div style="font-size:1rem;font-weight:700;color:#e8e8e8;margin-bottom:4px">📂 ' + p.name + '</div>'
      + '<div style="font-size:0.78rem;color:#555">' + (p.desc || '—') + ' &nbsp;·&nbsp; In ฿' + p.inputRate + '/1K · Out ฿' + p.outputRate + '/1K</div>'
      + '</div>'
      + '<button class="btn-action btn-primary-sm" style="padding:7px 18px" onclick="admin.openTopup(\'' + p.id + '\')">+ เติมเงิน Project</button>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">' + statsHtml + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'
      + '<div><div style="display:flex;justify-content:space-between;font-size:0.72rem;color:#555;margin-bottom:4px"><span>แจกจ่ายแล้ว</span><span>' + distPct.toFixed(1) + '%</span></div>'
      + '<div class="budget-bar"><div class="budget-bar-fill" style="width:' + distPct + '%"></div></div></div>'
      + '<div><div style="display:flex;justify-content:space-between;font-size:0.72rem;color:#555;margin-bottom:4px"><span>ใช้งานแล้ว (Cost)</span><span>' + usedPct.toFixed(1) + '%</span></div>'
      + '<div class="budget-bar"><div class="budget-bar-fill" style="width:' + usedPct + '%;background:linear-gradient(90deg,#888,#ccc)"></div></div></div>'
      + '</div></div>'
      + '<div style="font-size:.72rem;color:#444;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Members (' + users.length + ')</div>'
      + membersHtml;
  },

  openTopup: function (projectId) {
    var p = Auth.getProjectById(projectId);
    if (!p) return;
    document.getElementById('tu-proj-id').value = projectId;
    document.getElementById('tu-proj-name').textContent = p.name;
    document.getElementById('tu-amount').value = '';
    document.getElementById('tu-error').textContent = '';
    showModal('modal-topup');
  },

  submitTopup: function () {
    var projectId = document.getElementById('tu-proj-id').value;
    var amount = parseFloat(document.getElementById('tu-amount').value);
    var errEl = document.getElementById('tu-error');
    if (isNaN(amount) || amount <= 0) { errEl.textContent = '❌ กรุณาใส่จำนวนเงินที่ถูกต้อง'; return; }
    var p = Auth.topupProject(projectId, amount);
    hideModal('modal-topup');
    flash('✅ เติมเงิน ' + formatTHB(amount) + ' เข้า "' + p.name + '" แล้ว (รวม ' + formatTHB(p.totalTopUp) + ')');
    this.renderProjectDetail(projectId);
    this.renderOverview();
  },

  // ── USER MANAGEMENT ───────────────────────────────────
  renderUsers: function () {
    var self = this;
    var tableEl = document.getElementById('user-table');
    if (tableEl) tableEl.innerHTML = '<tbody><tr><td colspan="6" style="text-align:center;color:#555;padding:24px">⏳ กำลังโหลด...</td></tr></tbody>';

    this.fetchUsersFromDB().then(function (users) {
      self._cachedDBUsers = users;
      // ไม่แสดง admin ในหน้า User Management
      users = users.filter(function (u) { return u.role !== 'admin'; });
      var projects = Auth.getProjects();

      if (users.length === 0) {
        if (tableEl) tableEl.innerHTML = '<tbody><tr><td colspan="6" style="text-align:center;color:#555;padding:24px">ยังไม่มี User ในระบบ</td></tr></tbody>';
        return;
      }

      var rows = '';
      users.forEach(function (u) {
        var opts = '<option value="">— เลือก project —</option>';
        projects.forEach(function (p) {
          opts += '<option value="' + p.id + '"' + (String(u.projectId) === String(p.id) ? ' selected' : '') + '>' + p.name + '</option>';
        });
        rows += '<tr>'
          + '<td><span class="val">' + (u.displayName || u.username) + '</span><div style="font-size:0.72rem;color:#444;margin-top:2px">@' + u.username + '</div></td>'
          + '<td><select class="input-sm" style="width:140px;text-align:left" onchange="admin.updateUserProject(\'' + u.username + '\', this.value)">'
          + opts + '</select></td>'
          + '<td><div style="display:flex;align-items:center;gap:6px">'
          + '<input class="input-sm" id="bal-' + u.username + '" type="number" step="0.01" min="0" value="' + parseFloat(u.balance).toFixed(2) + '">'
          + '<button class="btn-action btn-save" onclick="admin.applyBalance(\'' + u.username + '\')">ตั้ง</button>'
          + '</div></td>'
          + '<td class="val">' + u.history.length + '</td>'
          + '<td style="color:#555;font-size:0.78rem">' + formatDate(u.createdAt) + '</td>'
          + '<td><div style="display:flex;gap:6px">'
          + '<button class="btn-action btn-save" onclick="admin.resetPassword(\'' + u.username + '\')">รีเซ็ต PW</button>'
          + '<button class="btn-action btn-danger" onclick="admin.deleteUser(\'' + u.username + '\')">\u0e25\u0e1a</button>'
          + '</div></td>'
          + '</tr>';
      });

      if (tableEl) tableEl.innerHTML =
        '<thead><tr><th>User</th><th>Project</th><th>Credit (฿)</th><th>Requests</th><th>สร้างเมื่อ</th><th>จัดการ</th></tr></thead>'
        + '<tbody>' + rows + '</tbody>';
    });
  },

  applyBalance: function (username) {
    var inp = document.getElementById('bal-' + username);
    if (!inp) return;
    var val = parseFloat(inp.value);
    if (isNaN(val) || val < 0) { flash('❌ ค่าไม่ถูกต้อง', 'error'); return; }
    // Update DB
    var users = this.getUsersWithHistory();
    var u = users.find(function (x) { return x.username === username; });
    if (u && u.id) {
      fetch('http://localhost:3001/api/users/' + u.id + '/balance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: val }),
      }).catch(function (e) { console.warn('[DB] balance update failed:', e.message); });
    }
    Auth.setUserBalance(username, val);
    flash('✅ ตั้ง credit ของ @' + username + ' เป็น ' + formatTHB(val));
  },

  applyBalanceById: function (username, inputId) {
    var inp = document.getElementById(inputId);
    if (!inp) return;
    var val = parseFloat(inp.value);
    if (isNaN(val) || val < 0) { flash('❌ ค่าไม่ถูกต้อง', 'error'); return; }
    var users = this.getUsersWithHistory();
    var u = users.find(function (x) { return x.username === username; });
    if (u && u.id) {
      fetch('http://localhost:3001/api/users/' + u.id + '/balance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: val }),
      }).catch(function (e) { console.warn('[DB] balance update failed:', e.message); });
    }
    Auth.setUserBalance(username, val);
    flash('✅ ตั้ง credit ของ @' + username + ' เป็น ' + formatTHB(val));
  },

  updateUserProject: function (username, projectId) {
    var users = this.getUsersWithHistory();
    var u = users.find(function (x) { return x.username === username; });
    if (u && u.id) {
      fetch('http://localhost:3001/api/users/' + u.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: u.displayName, role: u.role || 'user', plan: u.plan || 'starter', balance: u.balance, projectId: projectId ? parseInt(projectId) : null, password: '' }),
      }).catch(function (e) { console.warn('[DB] update project failed:', e.message); });
    }
    Auth.setUserProject(username, projectId);
    var proj = Auth.getProjectById(projectId);
    flash('✅ ย้าย @' + username + ' ไปยัง project: ' + (proj ? proj.name : '—'));
    var self = this;
    setTimeout(function () { self.renderUsers(); }, 200);
  },

  resetPassword: function (username) {
    var newPw = prompt('รหัสผ่านใหม่สำหรับ @' + username + ':');
    if (!newPw || newPw.length < 4) { flash('❌ รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร', 'error'); return; }
    // Update DB
    var users = this.getUsersWithHistory();
    var u = users.find(function (x) { return x.username === username; });
    if (u && u.id) {
      fetch('http://localhost:3001/api/users/' + u.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: u.displayName, role: u.role || 'user', plan: u.plan || 'starter', balance: u.balance, projectId: u.projectId, password: newPw }),
      }).catch(function (e) { console.warn('[DB] reset pw failed:', e.message); });
    }
    // Update localStorage
    var allUsers = Auth.getUsers();
    var idx = allUsers.findIndex(function (x) { return x.username === username; });
    if (idx !== -1) { allUsers[idx].password = newPw; Auth.saveUsers(allUsers); }
    flash('✅ รีเซ็ตรหัสผ่านของ @' + username + ' แล้ว');
  },

  deleteUser: function (username) {
    if (!confirm('ต้องการลบ user @' + username + ' หรือไม่? ข้อมูลทั้งหมดจะถูกลบถาวร')) return;
    var self = this;
    // Find user id from current list
    var users = this.getUsersWithHistory();
    var u = users.find(function (x) { return x.username === username; });
    if (u && u.id) {
      fetch('http://localhost:3001/api/users/' + u.id, { method: 'DELETE' })
        .catch(function (e) { console.warn('[DB] delete user failed:', e.message); });
    }
    Auth.deleteUser(username);
    flash('✅ ลบ @' + username + ' แล้ว');
    self.renderUsers();
    self.refreshProjectSelects();
  },

  // ── ADD USER (modal) ──────────────────────────────────
  openAddUser: function () {
    ['au-username', 'au-password', 'au-confirm', 'au-firstname', 'au-lastname'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var bal = document.getElementById('au-balance');
    if (bal) bal.value = '100';
    var hint = document.getElementById('au-pw-hint');
    if (hint) { hint.style.color = '#555'; hint.textContent = 'Must be 8 or more characters and contain at least 1 number (0-9) and 1 upper case letter (A-Z)'; }
    document.getElementById('au-error').textContent = '';
    this.refreshProjectSelects();
    showModal('modal-add-user');
  },

  submitAddUser: function () {
    var username = document.getElementById('au-username').value.trim();
    var password = document.getElementById('au-password').value;
    var confirm = document.getElementById('au-confirm').value;
    var firstname = document.getElementById('au-firstname').value.trim();
    var lastname = document.getElementById('au-lastname').value.trim();
    var projectId = document.getElementById('au-project').value;
    var balance = parseFloat(document.getElementById('au-balance').value) || 100;
    var errEl = document.getElementById('au-error');

    if (!username) { errEl.textContent = '❌ กรุณากรอก Username'; return; }
    if (!firstname || !lastname) { errEl.textContent = '❌ กรุณากรอก Name และ Surname'; return; }
    if (password.length < 8) { errEl.textContent = '❌ Password ต้องมีอย่างน้อย 8 ตัว'; return; }
    if (!/[A-Z]/.test(password)) { errEl.textContent = '❌ Password ต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว'; return; }
    if (!/[0-9]/.test(password)) { errEl.textContent = '❌ Password ต้องมีตัวเลขอย่างน้อย 1 ตัว'; return; }
    if (password !== confirm) { errEl.textContent = '❌ Password ไม่ตรงกัน'; return; }

    var self = this;
    var displayName = firstname + ' ' + lastname;
    var safeUsername = username.toLowerCase().replace(/[^a-z0-9._@+\-]/g, '_');

    // ── Save to PostgreSQL ─────────────────────────────
    fetch('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: safeUsername, password: password, displayName: displayName,
        projectId: projectId ? parseInt(projectId) : null, balance: balance,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { errEl.textContent = '❌ ' + (data.error || 'ไม่สามารถสร้าง user ได้'); return; }
        hideModal('modal-add-user');
        flash('✅ สร้าง user "' + displayName + '" (@' + safeUsername + ') เรียบร้อย');
        self.renderUsers();
        self.refreshProjectSelects();
      })
      .catch(function (e) { errEl.textContent = '❌ Server error: ' + e.message; });
  },

  // ── Password Helpers ──────────────────────────────────
  generatePassword: function () {
    var upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    var lower = 'abcdefghjkmnpqrstuvwxyz';
    var digits = '23456789';
    var special = '@#$!';
    var all = upper + lower + digits + special;
    var pw = '';
    pw += upper[Math.floor(Math.random() * upper.length)];
    pw += digits[Math.floor(Math.random() * digits.length)];
    pw += special[Math.floor(Math.random() * special.length)];
    for (var i = 3; i < 12; i++) pw += all[Math.floor(Math.random() * all.length)];
    pw = pw.split('').sort(function () { return Math.random() - 0.5; }).join('');
    var pwEl = document.getElementById('au-password');
    var cfEl = document.getElementById('au-confirm');
    if (pwEl) { pwEl.value = pw; pwEl.type = 'text'; }
    if (cfEl) { cfEl.value = pw; cfEl.type = 'text'; }
    this.checkPwStrength();
    flash('🔑 Generated: ' + pw);
  },

  togglePw: function (inputId, eyeId) {
    var inp = document.getElementById(inputId);
    var eye = document.getElementById(eyeId);
    if (!inp) return;
    if (inp.type === 'password') {
      inp.type = 'text';
      if (eye) eye.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
      inp.type = 'password';
      if (eye) eye.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
  },

  checkPwStrength: function () {
    var pw = (document.getElementById('au-password') || {}).value || '';
    var hint = document.getElementById('au-pw-hint');
    if (!hint) return;
    if (pw.length === 0) {
      hint.style.color = '#555';
      hint.textContent = 'Must be 8 or more characters and contain at least 1 number (0-9) and 1 upper case letter (A-Z)';
    } else if (pw.length < 8 || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
      hint.style.color = '#e05555';
      hint.textContent = '❌ ' + (pw.length < 8 ? 'ต้องมีอย่างน้อย 8 ตัว' : !/[A-Z]/.test(pw) ? 'ต้องมีตัวพิมพ์ใหญ่' : 'ต้องมีตัวเลข');
    } else {
      hint.style.color = '#4ade80';
      hint.textContent = '✅ Password strength: Good';
    }
  },

  copyToClipboard: function (inputId) {
    var inp = document.getElementById(inputId);
    if (!inp || !inp.value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inp.value)
        .then(function () { flash('📋 Copied to clipboard'); })
        .catch(function () { flash('❌ ไม่สามารถ copy ได้'); });
    } else {
      inp.type = 'text';
      inp.select();
      try { document.execCommand('copy'); flash('📋 Copied to clipboard'); } catch (e) { flash('❌ Copy ไม่สำเร็จ'); }
    }
  },

  pastePassword: function () {
    var pw = (document.getElementById('au-password') || {}).value;
    var conf = document.getElementById('au-confirm');
    if (conf && pw) { conf.value = pw; }
  },

  // ── PROJECTS ──────────────────────────────────────────
  renderProjects: function () {
    var self = this;
    var projects = Auth.getProjects();
    var users = this.getUsersWithHistory();
    var container = document.getElementById('project-list');

    if (projects.length === 0) {
      container.innerHTML = '<div class="glass-card" style="text-align:center;padding:48px 24px">'
        + '<div style="font-size:2.5rem;margin-bottom:12px">📂</div>'
        + '<div style="color:#555;font-size:0.9rem">ยังไม่มี Project<br>กดปุ่ม <strong style="color:#888">+ Add Project</strong> เพื่อสร้างใหม่</div>'
        + '</div>';
      return;
    }

    container.innerHTML = projects.map(function (p) {
      var members = users.filter(function (u) { return u.projectId === p.id; });
      var totalReq = members.reduce(function (s, u) { return s + u.history.length; }, 0);
      var totalTok = members.reduce(function (s, u) { return s + u.history.reduce(function (ss, h) { return ss + (h.inputTokens || 0) + (h.outputTokens || 0); }, 0); }, 0);
      var totalCost = members.reduce(function (s, u) { return s + u.history.reduce(function (ss, h) { return ss + (h.cost || 0); }, 0); }, 0);
      var totalBal = members.reduce(function (s, u) { return s + u.balance; }, 0);

      var memberRows = '';
      members.forEach(function (u) {
        var uCost = u.history.reduce(function (s, h) { return s + (h.cost || 0); }, 0);
        memberRows += '<tr>'
          + '<td><span class="val">' + u.displayName + '</span><div style="font-size:.7rem;color:#444">@' + u.username + '</div></td>'
          + '<td><div style="display:flex;align-items:center;gap:4px">'
          + '<input class="input-sm" id="pb-' + u.username + '" type="number" step="0.01" min="0" style="width:70px" value="' + parseFloat(u.balance).toFixed(2) + '">'
          + '<button class="btn-action btn-save" style="padding:3px 7px;font-size:.7rem" onclick="admin.applyBalanceById(\'' + u.username + '\',\'pb-' + u.username + '\')">ตั้ง</button>'
          + '</div></td>'
          + '<td class="val" style="font-size:.78rem">' + u.history.length + '</td>'
          + '<td class="val" style="font-size:.78rem">' + formatTHB(uCost) + '</td>'
          + '<td><button class="btn-action btn-danger" style="padding:3px 8px;font-size:.7rem" onclick="admin.removeFromProject(\'' + u.username + '\')">ย้ายออก</button></td>'
          + '</tr>';
      });

      return '<div class="glass-card" style="margin-bottom:18px">'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.07)">'
        + '<div style="flex:1;min-width:220px">'
        + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
        + '<div style="font-size:1rem;font-weight:700;color:#e8e8e8">📂 ' + p.name + '</div>'
        + '<span style="font-size:.68rem;color:#444;padding:2px 8px;border-radius:20px;border:1px solid rgba(255,255,255,0.08)">' + members.length + ' members</span>'
        + '</div>'
        + '<div style="font-size:0.78rem;color:#555;margin-bottom:8px">' + (p.desc || '—') + '</div>'
        + '<div style="font-size:.7rem;color:#444">In ฿' + p.inputRate + ' · Out ฿' + p.outputRate + '/1K · Budget ฿' + (p.totalTopUp || 0).toFixed(2) + (p.creditLimit ? ' · Limit/user ฿' + p.creditLimit : '') + '</div>'
        + '</div>'
        + '<div style="display:flex;gap:8px">'
        + '<button class="btn-action btn-save" onclick="admin.openEditProject(\'' + p.id + '\')">✏️ แก้ไข</button>'
        + '<button class="btn-action btn-danger" onclick="admin.deleteProject(\'' + p.id + '\')">ลบ</button>'
        + '</div>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">'
        + '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;text-align:center">'
        + '<div style="font-size:.65rem;color:#444;margin-bottom:4px">Requests</div>'
        + '<div style="font-size:1.1rem;font-weight:700;color:#e8e8e8">' + totalReq + '</div>'
        + '</div>'
        + '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;text-align:center">'
        + '<div style="font-size:.65rem;color:#444;margin-bottom:4px">Tokens</div>'
        + '<div style="font-size:1.1rem;font-weight:700;color:#e8e8e8">' + totalTok.toLocaleString() + '</div>'
        + '</div>'
        + '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;text-align:center">'
        + '<div style="font-size:.65rem;color:#444;margin-bottom:4px">Cost Billed</div>'
        + '<div style="font-size:1.1rem;font-weight:700;color:#e8e8e8">' + formatTHB(totalCost) + '</div>'
        + '</div>'
        + '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;text-align:center">'
        + '<div style="font-size:.65rem;color:#444;margin-bottom:4px">Credit Outstanding</div>'
        + '<div style="font-size:1.1rem;font-weight:700;color:#cccccc">' + formatTHB(totalBal) + '</div>'
        + '</div>'
        + '</div>'
        + (members.length > 0
          ? '<div style="font-size:.68rem;color:#444;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Members</div>'
          + '<div style="overflow-x:auto"><table class="user-table">'
          + '<thead><tr><th>User</th><th>Credit (฿)</th><th>Requests</th><th>Cost</th><th>Action</th></tr></thead>'
          + '<tbody>' + memberRows + '</tbody></table></div>'
          : '<div style="text-align:center;padding:16px;color:#333;font-size:0.82rem">ยังไม่มี member</div>')
        + '</div>';
    }).join('');
  },

  openEditProject: function (projectId) {
    var p = Auth.getProjectById(projectId);
    if (!p) return;
    document.getElementById('ep-proj-id').value = projectId;
    document.getElementById('ep-name').value = p.name || '';
    document.getElementById('ep-desc').value = p.desc || '';
    document.getElementById('ep-input-rate').value = p.inputRate || 0.5;
    document.getElementById('ep-output-rate').value = p.outputRate || 1.5;
    document.getElementById('ep-credit-limit').value = p.creditLimit || 0;
    document.getElementById('ep-error').textContent = '';
    showModal('modal-edit-project');
  },

  submitEditProject: function () {
    var projectId = document.getElementById('ep-proj-id').value;
    var name = document.getElementById('ep-name').value.trim();
    var desc = document.getElementById('ep-desc').value.trim();
    var inputRate = parseFloat(document.getElementById('ep-input-rate').value);
    var outputRate = parseFloat(document.getElementById('ep-output-rate').value);
    var creditLit = parseFloat(document.getElementById('ep-credit-limit').value) || 0;
    var errEl = document.getElementById('ep-error');

    if (!name) { errEl.textContent = '❌ กรุณาใส่ชื่อ Project'; return; }
    if (isNaN(inputRate) || isNaN(outputRate)) { errEl.textContent = '❌ ค่า Rate ไม่ถูกต้อง'; return; }

    var projects = Auth.getProjects();
    var idx = projects.findIndex(function (pr) { return pr.id === projectId; });
    if (idx !== -1) {
      projects[idx].name = name;
      projects[idx].desc = desc;
      projects[idx].inputRate = inputRate;
      projects[idx].outputRate = outputRate;
      projects[idx].creditLimit = creditLit;
      Auth.saveProjects(projects);
    }
    hideModal('modal-edit-project');
    flash('✅ อัปเดต Project "' + name + '" เรียบร้อย');
    this.renderProjects();
    this.refreshProjectSelects();
  },

  removeFromProject: function (username) {
    if (!confirm('ต้องการย้าย @' + username + ' ออกจาก project หรือไม่?')) return;
    Auth.setUserProject(username, null);
    flash('✅ ย้าย @' + username + ' ออกจาก project แล้ว');
    this.renderProjects();
  },

  deleteProject: function (projectId) {
    var p = Auth.getProjectById(projectId);
    if (!p) return;
    var members = Auth.getUsers().filter(function (u) { return u.projectId === projectId; });
    var msg = members.length > 0
      ? 'Project "' + p.name + '" มี ' + members.length + ' members ต้องการลบและย้าย members ออกหรือไม่?'
      : 'ต้องการลบ Project "' + p.name + '" หรือไม่?';
    if (!confirm(msg)) return;
    members.forEach(function (u) { Auth.setUserProject(u.username, null); });
    Auth.deleteProject(projectId);
    flash('✅ ลบ Project "' + p.name + '" แล้ว');
    this.renderProjects();
    this.refreshProjectSelects();
  },

  // ── ADD PROJECT (modal) ────────────────────────────────
  openAddProject: function () {
    ['ap-name', 'ap-desc'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var ir = document.getElementById('ap-input-rate'); if (ir) ir.value = '0.50';
    var or = document.getElementById('ap-output-rate'); if (or) or.value = '1.50';
    document.getElementById('ap-error').textContent = '';
    showModal('modal-add-project');
  },

  submitAddProject: function () {
    var name = document.getElementById('ap-name').value.trim();
    var desc = document.getElementById('ap-desc').value.trim();
    var inputRate = parseFloat(document.getElementById('ap-input-rate').value);
    var outputRate = parseFloat(document.getElementById('ap-output-rate').value);
    var errEl = document.getElementById('ap-error');

    if (!name) { errEl.textContent = '❌ กรุณาใส่ชื่อ Project'; return; }
    if (isNaN(inputRate) || isNaN(outputRate)) { errEl.textContent = '❌ ค่า Rate ไม่ถูกต้อง'; return; }

    Auth.createProject({ name: name, desc: desc, inputRate: inputRate, outputRate: outputRate });
    hideModal('modal-add-project');
    flash('✅ สร้าง Project "' + name + '" เรียบร้อย');
    this.renderProjects();
    this.refreshProjectSelects();
  },

  refreshProjectSelects: function () {
    var projects = Auth.getProjects();
    var options = '<option value="">— เลือก Project —</option>';
    projects.forEach(function (p) {
      options += '<option value="' + p.id + '">' + p.name + '</option>';
    });
    var sel = document.getElementById('au-project');
    if (sel) sel.innerHTML = options;
  },

  // ── ACTIVITY LOG ──────────────────────────────────────
  renderActivity: function () {
    var container = document.getElementById('activity-log');
    container.innerHTML = '<div style="text-align:center;padding:28px;color:#555;font-size:.85rem">⏳ กำลังโหลดข้อมูลจาก DB...</div>';
    this.fetchUsersFromDB().then(function (users) {
      var allLogs = [];
      users.forEach(function (u) {
        u.history.forEach(function (h) {
          allLogs.push(Object.assign({}, h, { username: u.username, displayName: u.displayName }));
        });
      });
      allLogs.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });

      if (allLogs.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>ยังไม่มี activity ใดๆ</p></div>';
        return;
      }
      container.innerHTML = allLogs.map(function (h) {
        return '<div class="log-entry">'
          + '<div>'
          + '<div class="log-user">' + (h.skillEmoji || '🤖') + ' ' + (h.displayName || h.username) + ' <span style="color:#555;font-weight:400">(@' + h.username + ')</span></div>'
          + '<div class="log-skill">' + (h.skillName || '—') + ' · ' + (h.inputTokens || 0).toLocaleString() + ' in / ' + (h.outputTokens || 0).toLocaleString() + ' out tokens</div>'
          + '<div class="log-time">' + formatDate(h.timestamp) + '</div>'
          + '</div>'
          + '<div class="log-cost">' + formatTHB(h.cost) + '</div>'
          + '</div>';
      }).join('');
    }).catch(function () {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>ไม่สามารถโหลดข้อมูลได้ — ตรวจสอบว่า server กำลังรันอยู่</p></div>';
    });
  },

  clearAllHistory: function () {
    if (!confirm('ต้องการล้าง Activity Log ทั้งหมดของทุก user หรือไม่?')) return;
    var self = this;
    fetch('http://localhost:3001/api/history', { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) {
          flash('✅ ล้าง Activity Log ทั้งหมดแล้ว');
          self.renderActivity();
        } else {
          flash('❌ เกิดข้อผิดพลาด: ' + (d.error || 'unknown'));
        }
      })
      .catch(function () {
        flash('❌ ไม่สามารถเชื่อมต่อ server ได้');
      });
  },

  // ── USAGE ANALYTICS ───────────────────────────────────
  renderUsage: function () {
    var grid = document.getElementById('usage-summary-grid');
    var list = document.getElementById('usage-user-list');
    if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;color:#555;font-size:.85rem">⏳ กำลังโหลด...</div>';
    if (list) list.innerHTML = '';
    this.fetchUsersFromDB().then(function (users) {
      // ไม่แสดง admin ใน Usage Analytics
      users = users.filter(function (u) { return u.role !== 'admin'; });
      var projects = Auth.getProjects();

      // Aggregate totals
      var totalTokens = 0, totalCost = 0, totalRequests = 0;
      users.forEach(function (u) {
        totalTokens += u.history.reduce(function (s, h) { return s + (h.inputTokens || 0) + (h.outputTokens || 0); }, 0);
        totalCost += u.history.reduce(function (s, h) { return s + (h.cost || 0); }, 0);
        totalRequests += u.history.length;
      });

      // Summary cards
      if (grid) {
        grid.innerHTML =
          '<div class="mini-card"><div class="mini-card-label">📡 Total Requests</div>' +
          '<div class="mini-card-value">' + totalRequests.toLocaleString() + '</div>' +
          '<div class="mini-card-sub">ทุก users รวมกัน</div></div>' +

          '<div class="mini-card"><div class="mini-card-label">🔢 Total Tokens</div>' +
          '<div class="mini-card-value">' + (totalTokens >= 1000 ? (totalTokens / 1000).toFixed(1) + 'K' : totalTokens) + '</div>' +
          '<div class="mini-card-sub">input + output tokens</div></div>' +

          '<div class="mini-card"><div class="mini-card-label">💸 Total Spent</div>' +
          '<div class="mini-card-value" style="color:#a78bfa">' + formatTHB(totalCost) + '</div>' +
          '<div class="mini-card-sub">เงินที่ถูกหักไปแล้ว</div></div>' +

          '<div class="mini-card"><div class="mini-card-label">👥 Active Users</div>' +
          '<div class="mini-card-value">' + users.filter(function (u) { return u.history.length > 0; }).length + ' / ' + users.length + '</div>' +
          '<div class="mini-card-sub">มีประวัติการใช้งาน</div></div>';
      }

      if (!list) return;
      if (users.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:32px;color:#555">ยังไม่มี User ในระบบ</div>';
        return;
      }

      // Sort by most tokens used
      users.sort(function (a, b) {
        var aT = a.history.reduce(function (s, h) { return s + (h.inputTokens || 0) + (h.outputTokens || 0); }, 0);
        var bT = b.history.reduce(function (s, h) { return s + (h.inputTokens || 0) + (h.outputTokens || 0); }, 0);
        return bT - aT;
      });

      var maxTokens = users.reduce(function (m, u) {
        var t = u.history.reduce(function (s, h) { return s + (h.inputTokens || 0) + (h.outputTokens || 0); }, 0);
        return Math.max(m, t);
      }, 1);

      var html = '';
      users.forEach(function (u, idx) {
        var proj = projects.find(function (p) { return p.id === u.projectId; });
        var tokens = u.history.reduce(function (s, h) { return s + (h.inputTokens || 0) + (h.outputTokens || 0); }, 0);
        var spent = u.history.reduce(function (s, h) { return s + (h.cost || 0); }, 0);
        var requests = u.history.length;
        var pct = maxTokens > 0 ? Math.max(1, Math.round((tokens / maxTokens) * 100)) : 0;

        var last20 = u.history.slice(0, 20);
        var histRows = last20.length === 0
          ? '<tr><td colspan="5" style="text-align:center;color:#444;padding:16px">ยังไม่มีประวัติการใช้งาน</td></tr>'
          : last20.map(function (h) {
            return '<tr>' +
              '<td>' + (h.skillEmoji || '🤖') + ' ' + (h.skillName || '—') + '</td>' +
              '<td class="val">' + (h.inputTokens || 0) + ' / ' + (h.outputTokens || 0) + '</td>' +
              '<td class="val">' + formatTHB(h.cost || 0) + '</td>' +
              '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#555">' + (h.prompt || '—') + '</td>' +
              '<td style="color:#444;white-space:nowrap">' + formatDate(h.timestamp) + '</td>' +
              '</tr>';
          }).join('');

        html +=
          '<div class="usage-user-card" id="ucard-' + idx + '">' +
          '<div class="usage-user-header" onclick="admin.toggleUsageDetail(' + idx + ')">' +
          '<div>' +
          '<div class="usage-user-name">👤 ' + (u.displayName || u.username) + '</div>' +
          '<div class="usage-user-meta">' + u.username + (proj ? ' · 📂 ' + proj.name : '') + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px">' +
          '<span style="font-family:\'JetBrains Mono\',monospace;font-size:.8rem;color:#888">' + formatTHB(spent) + '</span>' +
          '<span style="color:#555;font-size:1.1rem" id="ucard-arrow-' + idx + '">▸</span>' +
          '</div>' +
          '</div>' +

          '<div class="usage-user-stats">' +
          '<div class="usage-stat-box"><div class="usage-stat-label">Requests</div><div class="usage-stat-val">' + requests + '</div></div>' +
          '<div class="usage-stat-box"><div class="usage-stat-label">Total Tokens</div><div class="usage-stat-val">' + (tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'K' : tokens) + '</div></div>' +
          '<div class="usage-stat-box"><div class="usage-stat-label">Total Spent</div><div class="usage-stat-val" style="color:#a78bfa">' + formatTHB(spent) + '</div></div>' +
          '<div class="usage-stat-box"><div class="usage-stat-label">Balance Left</div><div class="usage-stat-val" style="color:#34d399">' + formatTHB(u.balance) + '</div></div>' +
          '</div>' +

          '<div class="usage-bar-wrap">' +
          '<div class="usage-bar-label"><span>Token usage relative</span><span>' + pct + '%</span></div>' +
          '<div class="usage-bar-track"><div class="usage-bar-fill" style="width:' + pct + '%"></div></div>' +
          '</div>' +

          '<div class="usage-detail-section" id="udetail-' + idx + '">' +
          '<table class="usage-history-table">' +
          '<thead><tr><th>Skill</th><th>Tokens (In/Out)</th><th>ค่าใช้จ่าย</th><th>Prompt</th><th>เวลา</th></tr></thead>' +
          '<tbody>' + histRows + '</tbody>' +
          '</table>' +
          (u.history.length > 20 ? '<div style="text-align:center;color:#555;font-size:.75rem;padding:8px">แสดง 20 รายการล่าสุด (ทั้งหมด ' + u.history.length + ' รายการ)</div>' : '') +
          '</div>' +
          '</div>';
      });
      list.innerHTML = html;
    }).catch(function () {
      if (list) list.innerHTML = '<div style="text-align:center;padding:32px;color:#555">⚠️ ไม่สามารถโหลดข้อมูลได้ — ตรวจสอบว่า server กำลังรันอยู่</div>';
    });
  },

  toggleUsageDetail: function (idx) {
    var detail = document.getElementById('udetail-' + idx);
    var card = document.getElementById('ucard-' + idx);
    var arrow = document.getElementById('ucard-arrow-' + idx);
    if (!detail) return;
    var isOpen = detail.classList.contains('open');
    detail.classList.toggle('open', !isOpen);
    if (card) card.classList.toggle('expanded', !isOpen);
    if (arrow) arrow.textContent = isOpen ? '▸' : '▾';
  },

};
