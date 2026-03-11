/**
 * auth.js — Shared Authentication & Data Module for AgentHub SAP
 * Supports projects (replaces plans), user creation, and session management
 */

const Auth = {
    // ── Keys ─────────────────────────────────────────────────
    SESSION_KEY: 'agenthub_session',
    USERS_KEY: 'agenthub_admin_users',
    PROJECTS_KEY: 'agenthub_projects',

    // ── Built-in admin credentials (not stored in users list) ──
    ADMIN_CREDS: [
        { username: 'admin', password: 'admin123', role: 'admin', displayName: 'System Admin' },
    ],

    // ── Default projects ──────────────────────────────────────
    DEFAULT_PROJECTS: [
        {
            id: 'proj_sap_dev',
            name: 'SAP Development',
            desc: 'ทีม ABAP Developer ภายใน',
            inputRate: 0.50, outputRate: 1.50, color: '#e8e8e8',
            totalTopUp: 500.00,
            createdAt: new Date().toISOString(),
        },
        {
            id: 'proj_sap_cons',
            name: 'SAP Consulting',
            desc: 'ทีม Consultant โครงการลูกค้า',
            inputRate: 0.35, outputRate: 1.10, color: '#bbbbbb',
            totalTopUp: 750.00,
            createdAt: new Date().toISOString(),
        },
        {
            id: 'proj_sap_qa',
            name: 'SAP QA & Testing',
            desc: 'ทีม QA และ Unit Testing',
            inputRate: 0.25, outputRate: 0.80, color: '#999999',
            totalTopUp: 1000.00,
            createdAt: new Date().toISOString(),
        },
    ],

    // ── Default users ─────────────────────────────────────────
    DEFAULT_USERS: [
        { username: 'user', password: 'user123', displayName: 'สมชาย ABAP Developer', projectId: 'proj_sap_dev', balance: 100.00 },
        { username: 'user2', password: 'user456', displayName: 'วิชัย SAP Consultant', projectId: 'proj_sap_cons', balance: 250.00 },
        { username: 'user3', password: 'user789', displayName: 'นิภา QA Engineer', projectId: 'proj_sap_qa', balance: 500.00 },
    ],

    // ── Init default data ─────────────────────────────────────
    initDefaults() {
        if (!localStorage.getItem(this.PROJECTS_KEY)) {
            localStorage.setItem(this.PROJECTS_KEY, JSON.stringify(this.DEFAULT_PROJECTS));
        }
        if (!localStorage.getItem(this.USERS_KEY)) {
            const users = this.DEFAULT_USERS.map(u => ({
                username: u.username,
                password: u.password,
                displayName: u.displayName,
                role: 'user',
                projectId: u.projectId,
                balance: parseFloat(localStorage.getItem(`agenthub_balance_${u.username}`) || u.balance),
                history: [],
                createdAt: new Date().toISOString(),
            }));
            localStorage.setItem(this.USERS_KEY, JSON.stringify(users));
        }
        // Migrate projects that don't have totalTopUp yet
        const projects = this.getProjects();
        let dirty = false;
        projects.forEach(p => { if (p.totalTopUp === undefined) { p.totalTopUp = 0; dirty = true; } });
        if (dirty) this.saveProjects(projects);
        // Init per-user balance keys
        const users = this.getUsers();
        users.forEach(u => {
            if (!localStorage.getItem(`agenthub_balance_${u.username}`)) {
                const def = this.DEFAULT_USERS.find(d => d.username === u.username);
                localStorage.setItem(`agenthub_balance_${u.username}`, (def ? def.balance : 100).toString());
            }
            if (!localStorage.getItem(`agenthub_history_${u.username}`)) {
                localStorage.setItem(`agenthub_history_${u.username}`, '[]');
            }
        });
    },

    // ── Login (DB-backed) ─────────────────────────────────────
    login(username, password) {
        // Async login via PostgreSQL API
        return fetch('http://localhost:3001/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            signal: AbortSignal.timeout(5000)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.ok) return { ok: false, error: data.error || 'Invalid credentials' };
                var u = data.user;
                var session = {
                    userId: u.id,
                    username: u.username,
                    displayName: u.displayName,
                    role: u.role,
                    projectId: u.projectId,
                    loginTime: new Date().toISOString(),
                };
                localStorage.setItem(Auth.SESSION_KEY, JSON.stringify(session));
                // Mirror for app.js compatibility
                localStorage.setItem('agenthub_balance', u.balance.toString());
                localStorage.setItem('agenthub_history', JSON.stringify([]));
                if (u.projectId) localStorage.setItem('agenthub_project', u.projectId);
                return { ok: true, session };
            })
            .catch(function (e) {
                // Fallback: offline/server-not-running — use localStorage
                console.warn('[Auth] API unavailable, fallback to localStorage:', e.message);
                return Auth._loginLocal(username, password);
            });
    },

    // localStorage fallback (used when server is offline)
    _loginLocal(username, password) {
        this.initDefaults();
        const adminMatch = this.ADMIN_CREDS.find(a => a.username === username && a.password === password);
        if (adminMatch) {
            const session = { username: adminMatch.username, displayName: adminMatch.displayName, role: 'admin', loginTime: new Date().toISOString() };
            localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
            return { ok: true, session };
        }
        const users = JSON.parse(localStorage.getItem(this.USERS_KEY) || '[]');
        const match = users.find(u => u.username === username && u.password === password);
        if (!match) return { ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
        const session = { username: match.username, displayName: match.displayName, role: 'user', projectId: match.projectId, loginTime: new Date().toISOString() };
        localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
        const bal = localStorage.getItem(`agenthub_balance_${match.username}`) || match.balance.toString();
        localStorage.setItem('agenthub_balance', bal);
        localStorage.setItem('agenthub_history', localStorage.getItem(`agenthub_history_${match.username}`) || '[]');
        if (match.projectId) localStorage.setItem('agenthub_project', match.projectId);
        return { ok: true, session };
    },

    // ── Session ───────────────────────────────────────────────
    getSession() {
        try { return JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null'); } catch { return null; }
    },

    check(requiredRole) {
        const session = this.getSession();
        if (!session) { window.location.href = 'login.html'; return false; }
        if (session.role !== requiredRole) {
            window.location.href = session.role === 'admin' ? 'admin.html' : 'index.html';
            return false;
        }
        return true;
    },

    logout() {
        const session = this.getSession();
        if (session && session.role === 'user') {
            localStorage.setItem(`agenthub_balance_${session.username}`, localStorage.getItem('agenthub_balance') || '0');
            localStorage.setItem(`agenthub_history_${session.username}`, localStorage.getItem('agenthub_history') || '[]');
            const users = this.getUsers();
            const idx = users.findIndex(u => u.username === session.username);
            if (idx !== -1) {
                users[idx].balance = parseFloat(localStorage.getItem('agenthub_balance') || '0');
                users[idx].history = JSON.parse(localStorage.getItem('agenthub_history') || '[]');
                this.saveUsers(users);
            }
        }
        localStorage.removeItem(this.SESSION_KEY);
        window.location.href = 'login.html';
    },

    // ── Users — async (DB) ────────────────────────────────────
    fetchUsers() {
        return fetch('http://localhost:3001/api/users')
            .then(r => r.json())
            .then(d => d.ok ? d.users.map(u => ({
                id: u.id, username: u.username, password: '', displayName: u.display_name,
                role: u.role, plan: u.plan, balance: parseFloat(u.balance),
                projectId: u.project_id, history: [], createdAt: u.created_at
            })) : [])
            .catch(() => this.getUsers());
    },

    // ── Users — sync localStorage (fallback) ─────────────────
    getUsers() {
        try { return JSON.parse(localStorage.getItem(this.USERS_KEY) || '[]'); } catch { return []; }
    },
    saveUsers(users) { localStorage.setItem(this.USERS_KEY, JSON.stringify(users)); },

    createUser({ username, password, displayName, projectId, balance }) {
        const users = this.getUsers();
        if (users.find(u => u.username === username)) return { ok: false, error: `Username "${username}" มีอยู่แล้ว` };
        const newUser = {
            username, password, displayName,
            role: 'user', projectId,
            balance: parseFloat(balance) || 100,
            history: [], createdAt: new Date().toISOString(),
        };
        users.push(newUser);
        this.saveUsers(users);
        localStorage.setItem(`agenthub_balance_${username}`, newUser.balance.toString());
        localStorage.setItem(`agenthub_history_${username}`, '[]');
        return { ok: true, user: newUser };
    },

    deleteUser(username) {
        let users = this.getUsers();
        users = users.filter(u => u.username !== username);
        this.saveUsers(users);
    },

    setUserBalance(username, newBalance) {
        const users = this.getUsers();
        const idx = users.findIndex(u => u.username === username);
        if (idx !== -1) {
            users[idx].balance = newBalance;
            this.saveUsers(users);
            localStorage.setItem(`agenthub_balance_${username}`, newBalance.toString());
            const session = this.getSession();
            if (session && session.username === username) localStorage.setItem('agenthub_balance', newBalance.toString());
        }
    },

    setUserProject(username, projectId) {
        const users = this.getUsers();
        const idx = users.findIndex(u => u.username === username);
        if (idx !== -1) {
            users[idx].projectId = projectId;
            this.saveUsers(users);
            const session = this.getSession();
            if (session && session.username === username) {
                session.projectId = projectId;
                localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
                localStorage.setItem('agenthub_project', projectId);
            }
        }
    },

    // ── Projects — async (DB) ─────────────────────────────────
    fetchProjects() {
        return fetch('http://localhost:3001/api/projects')
            .then(r => r.json())
            .then(d => d.ok ? d.projects.map(p => ({
                id: p.id, name: p.name, desc: p.description,
                inputRate: parseFloat(p.input_rate), outputRate: parseFloat(p.output_rate),
                totalTopUp: 0, createdAt: p.created_at
            })) : [])
            .catch(() => this.getProjects());
    },

    // ── Projects — sync localStorage (fallback) ───────────────
    getProjects() {
        try { return JSON.parse(localStorage.getItem(this.PROJECTS_KEY) || '[]'); } catch { return []; }
    },
    saveProjects(projects) { localStorage.setItem(this.PROJECTS_KEY, JSON.stringify(projects)); },

    createProject({ name, desc, inputRate, outputRate }) {
        const projects = this.getProjects();
        const id = 'proj_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
        const proj = {
            id, name, desc: desc || '',
            inputRate: parseFloat(inputRate) || 0.5,
            outputRate: parseFloat(outputRate) || 1.5,
            totalTopUp: 0,
            createdAt: new Date().toISOString(),
        };
        projects.push(proj);
        this.saveProjects(projects);
        return proj;
    },

    topupProject(projectId, amount) {
        const projects = this.getProjects();
        const idx = projects.findIndex(p => p.id === projectId);
        if (idx !== -1) {
            projects[idx].totalTopUp = (projects[idx].totalTopUp || 0) + parseFloat(amount);
            this.saveProjects(projects);
            return projects[idx];
        }
        return null;
    },

    // Returns { totalTopUp, distributed, remaining } for a project
    getProjectBudget(projectId) {
        const proj = this.getProjectById(projectId);
        if (!proj) return { totalTopUp: 0, distributed: 0, remaining: 0, costBilled: 0 };
        const users = this.getUsers();
        const members = users.filter(u => u.projectId === projectId);
        const distributed = members.reduce((s, u) => {
            return s + parseFloat(localStorage.getItem(`agenthub_balance_${u.username}`) || u.balance || 0);
        }, 0);
        const costBilled = members.reduce((s, u) => {
            try {
                const hist = JSON.parse(localStorage.getItem(`agenthub_history_${u.username}`) || '[]');
                return s + hist.reduce((ss, h) => ss + (h.cost || 0), 0);
            } catch { return s; }
        }, 0);
        const totalTopUp = proj.totalTopUp || 0;
        const remaining = Math.max(0, totalTopUp - distributed);
        return { totalTopUp, distributed, remaining, costBilled };
    },

    deleteProject(projectId) {
        let projects = this.getProjects();
        projects = projects.filter(p => p.id !== projectId);
        this.saveProjects(projects);
    },

    getProjectById(id) {
        return this.getProjects().find(p => p.id === id) || null;
    },
};
