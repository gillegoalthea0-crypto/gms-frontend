/* ── APP STATE ── */
var state = { connected:false, apiKey:'', sheetId:'', course:'', section:'', subject:'', sheetTitle:'', students:[], logs:[] };

/* ── AUTH CHECK ── */
const authGuard = document.getElementById('authGuard');
const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get('token');
const urlUser = urlParams.get('user');
if (urlToken && urlUser) {
  const user = JSON.parse(decodeURIComponent(urlUser));
  sessionStorage.setItem('gms_auth', JSON.stringify({
    name: user.name, email: user.email, role: user.role,
    initials: user.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase(),
    token: urlToken, loggedIn: true
  }));
  window.history.replaceState({}, document.title, window.location.pathname);
}
const authData = sessionStorage.getItem('gms_auth');

const PROFESSOR_EMAIL = 'jprof801@gmail.com'; // ← change this to your professor email

if (!authData) {
  authGuard.classList.add('show');
  setTimeout(() => { window.location.href = 'login.html'; }, 1800);
} else {
  const user = JSON.parse(authData);
  document.getElementById('userAvatar').textContent = user.initials || user.name.charAt(0);
  document.getElementById('userName').textContent = user.name;
  document.getElementById('userEmail').textContent = user.email;
  document.getElementById('userChip').style.display = 'flex';
  document.getElementById('logoutBtn').style.display = 'block';
  addLog('success', 'Signed in as ' + user.name, user.email);

  if (user.email !== PROFESSOR_EMAIL) {
    applyStudentMode(user.email);
  }
}

/* ── OAUTH 2.0 ── */
var CLIENT_ID = '287734163767-mnm5q2opeeq8ktnurifrn9evef3nnrmq.apps.googleusercontent.com';
var SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

(function handleOAuthRedirect() {
  const hash = window.location.hash;
  if (hash.includes('access_token')) {
    const params = new URLSearchParams(hash.replace('#', ''));
    window._oauthToken = params.get('access_token');
    window.history.replaceState({}, document.title, window.location.pathname);
    showAlert('✓ Google account connected! Click "Save to Sheet" to save.', 'success');
    addLog('success', 'OAuth connected', 'Ready to write to Google Sheets');
    sessionStorage.removeItem('gms_pending_save');
  }
})();

function initOAuth() {
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(location.origin + location.pathname)}&response_type=token&scope=${encodeURIComponent(SCOPE)}`;
  window.location.href = authUrl;
}

/* ── STUDENT MODE ── */
function applyStudentMode(email) {
  const hide = [
    '[onclick="toggleAddForm()"]',
    '[onclick="triggerCSVImport()"]',
    '[onclick="syncFromSheet()"]',
    '[onclick="saveToSheet()"]',
    '[onclick="disconnect()"]',
    '.tab[onclick="switchTab(\'setup\')"]',
    '.tab[onclick="switchTab(\'log\')"]',
  ];
  hide.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) el.style.display = 'none';
  });

  const setupPanel = document.getElementById('panel-setup');
  const logPanel = document.getElementById('panel-log');
  if (setupPanel) setupPanel.style.display = 'none';
  if (logPanel) logPanel.style.display = 'none';

  const badge = document.createElement('div');
  badge.innerHTML = '👁 View Only';
  badge.style.cssText = 'font-size:11px;padding:4px 10px;border-radius:20px;background:rgba(247,121,79,0.15);color:#f7794f;border:1px solid rgba(247,121,79,0.3);white-space:nowrap;';
  document.querySelector('.header-right').prepend(badge);

  switchTab('gradebook');
  window._studentEmail = email;

  const saved = localStorage.getItem('gms_connection');
  if (saved) {
    const cfg = JSON.parse(saved);
    document.getElementById('notConnectedMsg').classList.add('hidden');
    document.getElementById('gradebookContent').classList.remove('hidden');
    Object.assign(state, {
      connected: true,
      apiKey: cfg.apiKey,
      sheetId: cfg.sheetId,
      course: cfg.course,
      section: cfg.section,
      subject: cfg.subject,
    });
    document.getElementById('gbTitle').textContent = `${cfg.course} • ${cfg.section} • ${cfg.subject}`;
    document.getElementById('syncBadge').style.display = 'flex';
    loadSheetData().then(() => renderTable());
  } else {
    document.getElementById('notConnectedMsg').innerHTML =
      '⏳ Grades are not available yet. Please check back later.';
  }
}

function filterTableForStudent(email) {
  const tbody = document.getElementById('gradeTable');
  const rows = tbody.querySelectorAll('tr');
  if (!rows.length) return;

  let found = false;
  rows.forEach(row => {
    if (row.getAttribute('data-email') === email) {
      row.style.display = '';
      found = true;
    } else {
      row.style.display = 'none';
    }
  });

  if (!found) {
    tbody.innerHTML = `<tr><td colspan="15" style="text-align:center;padding:40px;color:var(--muted)">
      ⚠️ Your record was not found.<br>
      <span style="font-size:12px">Ask your professor to add your email (<strong style="color:var(--text)">${email}</strong>) to the gradebook.</span>
    </td></tr>`;
  }
}

function logout() {
  if (!confirm('Sign out of Grade Monitoring System?')) return;
  sessionStorage.removeItem('gms_auth');
  window.location.href = 'login.html';
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', ['setup', 'gradebook', 'log'][i] === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
}

function showAlert(msg, type = 'error') {
  const box = document.getElementById('alertBox');
  box.className = 'alert ' + type;
  box.innerHTML = msg;
  box.classList.remove('hidden');
  if (type !== 'error') setTimeout(() => box.classList.add('hidden'), 4000);
}
function hideAlert() { document.getElementById('alertBox').classList.add('hidden'); }

async function testConnection() {
  const key = document.getElementById('apiKey').value.trim();
  const id = document.getElementById('sheetId').value.trim();
  if (!key || !id) return showAlert('Please enter both API key and Spreadsheet ID.');
  showAlert('<span class="spinner"></span> Testing…', 'info');
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?key=${key}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    showAlert(`✓ Connected to: <strong>${data.properties.title}</strong>`, 'success');
    addLog('success', 'Connection test passed', data.properties.title);
  } catch (e) { showAlert(`✗ ${e.message}`); addLog('error', 'Test failed', e.message); }
}

async function connectSheet() {
  const key = document.getElementById('apiKey').value.trim();
  const id = document.getElementById('sheetId').value.trim();
  const course = document.getElementById('course').value;
  const section = document.getElementById('section').value;
  const subject = document.getElementById('subject').value.trim();
  if (!key || !id) return showAlert('Please enter API key and Spreadsheet ID.');
  const btn = document.getElementById('connectBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Connecting…';
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?key=${key}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    Object.assign(state, { connected: true, apiKey: key, sheetId: id, course, section, subject, sheetTitle: data.properties.title, students: [] });
    await loadSheetData();
    document.getElementById('connectedInfo').classList.remove('hidden');
    document.getElementById('connectedLabel').textContent = `${data.properties.title} — ${course} ${section} · ${subject}`;
    document.getElementById('syncBadge').style.display = 'flex';
    document.getElementById('notConnectedMsg').classList.add('hidden');
    document.getElementById('gradebookContent').classList.remove('hidden');
    document.getElementById('setupHelp').classList.add('hidden');
    document.getElementById('gbTitle').textContent = `${course} • ${section} • ${subject}`;
    showAlert(`✓ Connected to <strong>${data.properties.title}</strong>`, 'success');
    addLog('success', 'Sheet connected', `${course} ${section} · ${subject}`);
    localStorage.setItem('gms_connection', JSON.stringify({ apiKey: key, sheetId: id, course, section, subject }));
    renderTable();
  } catch (e) {
    showAlert(`Connection failed: ${e.message}<br><small>Make sure the sheet is shared publicly (Anyone with the link → Viewer/Editor)</small>`);
    addLog('error', 'Connection failed', e.message);
  } finally { btn.disabled = false; btn.innerHTML = 'Connect Sheet'; }
}

async function loadSheetData() {
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${state.sheetId}/values/Sheet1!A2:N200?key=${state.apiKey}`);
    const data = await res.json();
    if (data.error || !data.values) return;
    state.students = data.values.map((row, i) => ({
      id: i,
      name: row[0] || '',
      studentNo: row[1] || '',
      q1: parseFloat(row[2]) || 0,
      q2: parseFloat(row[3]) || 0,
      q3: parseFloat(row[4]) || 0,
      rec: parseFloat(row[5]) || 0,
      midterm: parseFloat(row[6]) || 0,
      project: parseFloat(row[7]) || 0,
      paper: parseFloat(row[8]) || 0,
      finals: parseFloat(row[9]) || 0,
    }));
    addLog('success', 'Data loaded', `${state.students.length} students`);
  } catch (e) { addLog('warn', 'Could not load data', e.message); }
}

async function syncFromSheet() {
  if (!state.connected) return;
  showAlert('<span class="spinner"></span> Syncing…', 'info');
  await loadSheetData(); renderTable();
  showAlert('✓ Synced from Google Sheets', 'success');
  addLog('success', 'Sync complete', `${state.students.length} students`);
}

/* ── SAVE TO SHEET ── */
async function saveToSheet() {
  if (!state.connected) return showAlert('Connect a Google Sheet first.', 'error');
  if (!state.students.length) return showAlert('No students to save.', 'error');

  // Build header + rows
  const header = ['Full Name','Student No.','Q1 /20','Q2 /25','Q3 /30','Recitation /20','Midterm /50','Project /100','Term Paper /100','Finals /50','Average','Grade','Remarks'];
  const rows = state.students.map(s => {
    const avg = calcAvg(s);
    const { grade, remarks } = calcGrade(avg);
    return [s.name, s.studentNo, s.q1, s.q2, s.q3, s.rec, s.midterm, s.project, s.paper, s.finals, avg > 0 ? avg.toFixed(1) : '', grade, remarks];
  });
  const values = [header, ...rows];

  // Need OAuth token to write
  if (!window._oauthToken) {
    sessionStorage.setItem('gms_pending_save', '1');
    addLog('info', 'Redirecting to Google auth…', 'OAuth required for write access');
    return initOAuth();
  }

  const btn = document.querySelector('button[onclick="saveToSheet()"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…'; }

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${state.sheetId}/values/Sheet1!A1?valueInputOption=RAW`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${window._oauthToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range: 'Sheet1!A1', majorDimension: 'ROWS', values })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    addLog('success', 'Saved to Google Sheets', `${state.students.length} students`);
    showAlert(`✓ Saved ${state.students.length} students to Google Sheets`, 'success');

    // ✅ Fire the clickable toast
    const count = state.students.length;
    showGradeSavedToast(
      count === 1 ? state.students[0].name : `${count} students`,
      state.subject || ''
    );
  } catch (e) {
    addLog('error', 'Save failed', e.message);
    showAlert(`✗ Save failed: ${e.message}`, 'error');
    // Token may be expired — clear it
    if (e.message.includes('401') || e.message.includes('Invalid')) window._oauthToken = null;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '↑ Save to Sheet'; }
  }
}

/* ── TOAST NOTIFICATION ── */
function showGradeSavedToast(studentName, subject, score) {
  // Remove any existing toast first
  const existing = document.getElementById('gms-grade-toast');
  if (existing) existing.remove();
  clearTimeout(window._gradeToastTimer);

  const sheetUrl = state.sheetId
    ? `https://docs.google.com/spreadsheets/d/${state.sheetId}/edit`
    : null;

  const scoreHtml = (score !== undefined && score !== null)
    ? `<span style="margin-left:6px;background:rgba(74,222,128,0.18);border:1px solid rgba(74,222,128,0.3);border-radius:6px;padding:1px 8px;font-size:12px;font-weight:700;color:#4ade80;">${score}</span>`
    : '';

  const toast = document.createElement('div');
  toast.id = 'gms-grade-toast';
  toast.innerHTML = `
    <style>
      @keyframes gms-slide-in  { from{transform:translateX(110%);opacity:0} to{transform:translateX(0);opacity:1} }
      @keyframes gms-slide-out { from{transform:translateX(0);opacity:1} to{transform:translateX(110%);opacity:0} }
      @keyframes gms-progress  { from{transform:scaleX(1)} to{transform:scaleX(0)} }
    </style>
    <div id="gms-toast-progress-bar" style="position:absolute;top:0;left:0;right:0;height:3px;background:rgba(255,255,255,0.1);border-radius:12px 12px 0 0;overflow:hidden;">
      <div style="height:100%;background:linear-gradient(90deg,#4ade80,#22d3ee);animation:gms-progress 4s linear forwards;transform-origin:left;"></div>
    </div>
    <div style="display:flex;align-items:flex-start;gap:12px;">
      <div style="width:36px;height:36px;border-radius:10px;background:rgba(74,222,128,0.18);border:1px solid rgba(74,222,128,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:17px;">✓</div>
      <div style="flex:1;min-width:0;">
        <p style="margin:0;font-size:12px;font-weight:700;color:#4ade80;letter-spacing:0.06em;text-transform:uppercase;">Grade Saved</p>
        <p style="margin:3px 0 0;font-size:13px;color:rgba(255,255,255,0.9);line-height:1.4;">
          <strong style="color:#fff;">${studentName || 'Student'}</strong>
          ${subject ? ' — ' + subject : ''}${scoreHtml}
        </p>
        <p style="margin:5px 0 0;font-size:11px;color:rgba(74,222,128,0.7);font-weight:500;">🔗 Click to open Google Sheet ↗</p>
      </div>
      <button id="gms-toast-close" style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.35);font-size:18px;line-height:1;padding:2px;flex-shrink:0;" title="Dismiss">×</button>
    </div>
  `;

  Object.assign(toast.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: '99999',
    background: 'linear-gradient(135deg, #0f4c35 0%, #1a6b4a 100%)',
    border: '1px solid rgba(74,222,128,0.2)',
    color: '#fff', borderRadius: '14px',
    padding: '18px 18px 16px',
    minWidth: '300px', maxWidth: '360px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)',
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    animation: 'gms-slide-in 0.4s cubic-bezier(0,0,0.2,1) forwards',
    pointerEvents: 'all',
    cursor: sheetUrl ? 'pointer' : 'default',
    userSelect: 'none'
  });

  document.body.appendChild(toast);

  function dismissToast() {
    toast.style.animation = 'gms-slide-out 0.35s cubic-bezier(0.4,0,1,1) forwards';
    setTimeout(() => toast.remove(), 380);
    clearTimeout(window._gradeToastTimer);
  }

  // Clicking anywhere on the toast opens the sheet
  toast.addEventListener('click', (e) => {
    // ✕ close button still just dismisses
    if (e.target.id === 'gms-toast-close') { dismissToast(); return; }
    if (sheetUrl) {
      window.open(sheetUrl, '_blank', 'noopener,noreferrer');
      dismissToast();
    }
  });

  // Hover highlight so user knows it's clickable
  if (sheetUrl) {
    toast.addEventListener('mouseenter', () => toast.style.background = 'linear-gradient(135deg, #145c3f 0%, #1f7a56 100%)');
    toast.addEventListener('mouseleave', () => toast.style.background = 'linear-gradient(135deg, #0f4c35 0%, #1a6b4a 100%)');
  }

  // Auto-dismiss after 4s
  window._gradeToastTimer = setTimeout(dismissToast, 4200);
}

  
/* ── CSV IMPORT ── */
function triggerCSVImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => importCSV(ev.target.result, file.name);
    reader.readAsText(file);
  };
  input.click();
}

function importCSV(text, filename) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return showAlert('CSV file is empty or has no data rows.', 'error');

  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
  const col = name => headers.findIndex(h => h.includes(name));

  const nameCol    = col('full_name') !== -1 ? col('full_name') : col('name');
  const studentNoCol = col('student no') !== -1 ? col('student no') : col('studentno') !== -1 ? col('studentno') : col('student_no');
  const q1Col      = col('q1') !== -1 ? col('q1') : col('quiz1') !== -1 ? col('quiz1') : col('quiz 1');
  const q2Col      = col('q2') !== -1 ? col('q2') : col('quiz2') !== -1 ? col('quiz2') : col('quiz 2');
  const q3Col      = col('q3') !== -1 ? col('q3') : col('quiz3') !== -1 ? col('quiz3') : col('quiz 3');
  const recCol     = col('rec') !== -1 ? col('rec') : col('recitation');
  const midCol     = col('mid') !== -1 ? col('mid') : col('midterm');
  const projCol    = col('proj') !== -1 ? col('proj') : col('project');
  const paperCol   = col('paper') !== -1 ? col('paper') : col('term');
  const finalsCol  = col('final');

  let imported = 0, skipped = 0;
  const newStudents = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
    const get = idx => idx >= 0 && row[idx] ? row[idx].replace(/"/g, '').trim() : '';

    const name = get(nameCol);
    if (!name) { skipped++; continue; }

    newStudents.push({
      id: Date.now() + i,
      name: name || '—',
      studentNo: get(studentNoCol) || '',
      q1:      parseFloat(get(q1Col))     || 0,
      q2:      parseFloat(get(q2Col))     || 0,
      q3:      parseFloat(get(q3Col))     || 0,
      rec:     parseFloat(get(recCol))    || 0,
      midterm: parseFloat(get(midCol))    || 0,
      project: parseFloat(get(projCol))   || 0,
      paper:   parseFloat(get(paperCol))  || 0,
      finals:  parseFloat(get(finalsCol)) || 0,
    });
    imported++;
  }

  if (!imported) return showAlert('No valid student rows found in the CSV.', 'error');

  const action = state.students.length > 0
    ? confirm(`Found ${imported} students in CSV.\n\nClick OK to ADD to existing ${state.students.length} students.\nClick Cancel to REPLACE all existing students.`)
    : false;

  if (action) {
    state.students = [...state.students, ...newStudents];
  } else {
    state.students = newStudents;
  }

  renderTable();
  showAlert(`✓ Imported ${imported} students from <strong>${filename}</strong>${skipped ? ` (${skipped} skipped)` : ''}.`, 'success');
  addLog('success', `CSV imported: ${imported} students`, filename);
}

function calcAvg(s) {
  const qAvg = ((s.q1 / 20 + s.q2 / 30 + s.q3 / 50) / 3) * 100;
  const rec = (s.rec / 20) * 100;
  const finals = (s.finals / 50) * 100;
  return qAvg * 0.20 + rec * 0.10 + s.midterm * 0.25 + s.project * 0.20 + s.paper * 0.25;
}

function calcGrade(avg) {
  if (avg >= 97) return { grade: '1.00', remarks: 'Passed' };
  if (avg >= 94) return { grade: '1.25', remarks: 'Passed' };
  if (avg >= 91) return { grade: '1.50', remarks: 'Passed' };
  if (avg >= 88) return { grade: '1.75', remarks: 'Passed' };
  if (avg >= 85) return { grade: '2.00', remarks: 'Passed' };
  if (avg >= 82) return { grade: '2.25', remarks: 'Passed' };
  if (avg >= 79) return { grade: '2.50', remarks: 'Passed' };
  if (avg >= 76) return { grade: '2.75', remarks: 'Passed' };
  if (avg >= 75) return { grade: '3.00', remarks: 'Passed' };
  if (avg > 0)   return { grade: '5.00', remarks: 'Failed' };
  return { grade: 'INC', remarks: 'Incomplete' };
}

function gradeClass(g) {
  if (['1.00', '1.25', '1.50'].includes(g)) return 'grade-A';
  if (['1.75', '2.00', '2.25'].includes(g)) return 'grade-B';
  if (['2.50', '2.75', '3.00'].includes(g)) return 'grade-C';
  if (g === '5.00') return 'grade-D';
  return 'grade-INC';
}

function renderTable() {
  const tbody = document.getElementById('gradeTable');
  if (!state.students.length) {
    tbody.innerHTML = `<tr><td colspan="15" style="text-align:center;color:var(--muted);padding:32px">No students yet. Click "+ Add Student" to begin.</td></tr>`;
    updateStats(); return;
  }
  tbody.innerHTML = state.students.map((s, i) => {
    const avg = calcAvg(s); const { grade, remarks } = calcGrade(avg);
    const rc = remarks === 'Passed' ? 'var(--success)' : remarks === 'Failed' ? 'var(--error)' : 'var(--muted)';
    return `<tr data-email="${s.email || ''}">
      <td style="color:var(--muted)">${i + 1}</td>
      <td style="font-weight:500">${s.name || '—'}</td>
      <td style="color:var(--muted);font-size:12px">${s.studentNo || '—'}</td>
      <td><input class="gi" type="number" value="${s.q1 || ''}" min="0" max="20" onchange="upd(${i},'q1',this.value)" placeholder="—"></td>
      <td><input class="gi" type="number" value="${s.q2 || ''}" min="0" max="30" onchange="upd(${i},'q2',this.value)" placeholder="—"></td>
      <td><input class="gi" type="number" value="${s.q3 || ''}" min="0" max="50" onchange="upd(${i},'q3',this.value)" placeholder="—"></td>
      <td><input class="gi" type="number" value="${s.rec || ''}" min="0" max="20" onchange="upd(${i},'rec',this.value)" placeholder="—"></td>
      <td><input class="gi" type="number" value="${s.midterm || ''}" min="0" max="100" onchange="upd(${i},'midterm',this.value)" placeholder="—"></td>
      <td><input class="gi" type="number" value="${s.project || ''}" min="0" max="100" onchange="upd(${i},'project',this.value)" placeholder="—"></td>
      <td><input class="gi" type="number" value="${s.paper || ''}" min="0" max="100" onchange="upd(${i},'paper',this.value)" placeholder="—"></td>
      <td><input class="gi" type="number" value="${s.finals || ''}" min="0" max="50" onchange="upd(${i},'finals',this.value)" placeholder="—"></td>
      <td style="font-family:'DM Mono',monospace;font-weight:600">${avg > 0 ? avg.toFixed(1) : '—'}</td>
      <td><span class="grade-chip ${gradeClass(grade)}">${grade}</span></td>
      <td style="color:${rc};font-size:12px">${remarks}</td>
      <td><button class="btn btn-sm btn-danger" onclick="removeStudent(${i})">✕</button></td>
    </tr>`;
  }).join('');
  updateStats();

  if (window._studentEmail) {
    filterTableForStudent(window._studentEmail);
  }
}

function upd(i, field, val) {
  state.students[i][field] = parseFloat(val) || 0;
  renderTable();
  // Show notification: grade was updated (debounced so rapid typing doesn't spam)
  clearTimeout(window._updToastTimer);
  window._updToastTimer = setTimeout(() => {
    const s = state.students[i];
    if (s) showGradeSavedToast(s.name, state.subject || '');
  }, 800);
}

function updateStats() {
  const n = state.students.length;
  document.getElementById('statTotal').textContent = n;
  if (!n) {
    document.getElementById('statAvg').textContent = '—';
    document.getElementById('statPassing').textContent = 0;
    document.getElementById('statFailing').textContent = 0;
    return;
  }
  const avgs = state.students.map(calcAvg);
  document.getElementById('statAvg').textContent = (avgs.reduce((a, b) => a + b, 0) / n).toFixed(1);
  const pass = state.students.filter(s => calcGrade(calcAvg(s)).remarks === 'Passed').length;
  document.getElementById('statPassing').textContent = pass;
  document.getElementById('statFailing').textContent = n - pass;
}

function toggleAddForm() { document.getElementById('addForm').classList.toggle('hidden'); }

function addStudent() {
  const name = document.getElementById('newName').value.trim();
  const studentNo = document.getElementById('newStudentNo').value.trim() || '';
  if (!name) return;
  state.students.push({
    id: Date.now(), name, studentNo,
    q1:      parseFloat(document.getElementById('newQ1').value)    || 0,
    q2:      parseFloat(document.getElementById('newQ2').value)    || 0,
    q3:      parseFloat(document.getElementById('newQ3').value)    || 0,
    rec:     parseFloat(document.getElementById('newRec').value)   || 0,
    midterm: parseFloat(document.getElementById('newMid').value)   || 0,
    project: parseFloat(document.getElementById('newProj').value)  || 0,
    paper:   parseFloat(document.getElementById('newPaper').value) || 0,
    finals:  parseFloat(document.getElementById('newFinals').value)|| 0,
  });
  ['newName', 'newStudentNo', 'newQ1', 'newQ2', 'newQ3', 'newRec', 'newMid', 'newProj', 'newPaper', 'newFinals']
    .forEach(id => document.getElementById(id).value = '');
  renderTable();
  addLog('info', 'Student added', name);
}

function removeStudent(i) {
  const name = state.students[i].name;
  if (!confirm('Remove ' + name + '?')) return;
  state.students.splice(i, 1); renderTable();
  addLog('warn', 'Student removed', name);
}

function addLog(type, msg, meta = '') {
  const icons = { success: '✓', error: '✗', warn: '⚠', info: 'ℹ' };
  state.logs.unshift({ type, msg, meta, time: new Date().toLocaleTimeString() });
  renderLog();
}

function renderLog() {
  const el = document.getElementById('logEntries');
  if (!state.logs.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:40px">No sync activity yet.</div>'; return; }
  const colors = { success: 'var(--success)', error: 'var(--error)', warn: 'var(--warn)', info: 'var(--accent)' };
  const icons = { success: '✓', error: '✗', warn: '⚠', info: 'ℹ' };
  el.innerHTML = state.logs.map(l => `<div class="log-entry"><span class="log-time">${l.time}</span><span class="log-icon" style="color:${colors[l.type]}">${icons[l.type]}</span><div><div class="log-msg">${l.msg}</div>${l.meta ? `<div class="log-meta">${l.meta}</div>` : ''}</div></div>`).join('');
}

function clearLog() { state.logs = []; renderLog(); }
renderLog();

const addBtn = document.querySelector('.add-btn');
if (addBtn) addBtn.addEventListener('click', addStudent);

/* ── SAVE INPUTS TO LOCALSTORAGE ── */
function saveInputs() {
  localStorage.setItem('gms_apiKey', document.getElementById('apiKey').value);
  localStorage.setItem('gms_sheetId', document.getElementById('sheetId').value);
}

function restoreInputs() {
  const key = localStorage.getItem('gms_apiKey');
  const id = localStorage.getItem('gms_sheetId');
  if (key) document.getElementById('apiKey').value = key;
  if (id) document.getElementById('sheetId').value = id;
}

restoreInputs();