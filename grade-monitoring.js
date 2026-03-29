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

  // Apply student mode if not professor
  if (user.email !== PROFESSOR_EMAIL) {
    applyStudentMode(user.email);
  }
}

/* ── OAUTH 2.0 ── */
var CLIENT_ID = '287734163767-mnm5q2opeeq8ktnurifrn9evef3nnrmq.apps.googleusercontent.com';
var SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Handle OAuth token from redirect (implicit flow)
(function handleOAuthRedirect() {
  const hash = window.location.hash;
  if (hash.includes('access_token')) {
    const params = new URLSearchParams(hash.replace('#', ''));
    window._oauthToken = params.get('access_token');
    window.history.replaceState({}, document.title, window.location.pathname);
    showAlert('✓ Google account connected!', 'success');
    addLog('success', 'OAuth connected', 'Ready to write to Google Sheets');
    // Auto-resume save if triggered from CSV import or Save to Sheet
    if (sessionStorage.getItem('gms_pending_save')) {
      sessionStorage.removeItem('gms_pending_save');
      saveToSheet();
    }
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
    t.classList.toggle('active', ['setup', 'gradebook', 'ai', 'log'][i] === name);
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
  } finally { btn.disabled = false; btn.innerHTML = 'Create &amp; Connect Sheet'; }
}

async function loadSheetData() {
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${state.sheetId}/values/Sheet1!A2:M200?key=${state.apiKey}`);
    const data = await res.json();
    if (data.error || !data.values) return;
    state.students = data.values.map((row, i) => ({
      id: i,
      name: row[0] || '',
      studentNo: row[1] || '',
      email: row[2] || '',
      q1: parseFloat(row[3]) || 0,
      q2: parseFloat(row[4]) || 0,
      q3: parseFloat(row[5]) || 0,
      rec: parseFloat(row[6]) || 0,
      midterm: parseFloat(row[7]) || 0,
      project: parseFloat(row[8]) || 0,
      paper: parseFloat(row[9]) || 0,
      finals: parseFloat(row[10]) || 0,
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

/* ── SAVE TO SHEET (with OAuth 2.0) ── */
async function saveToSheet() {
  if (!state.connected) return;

  // If no OAuth token yet, redirect to Google login automatically
  if (!window._oauthToken) {
    sessionStorage.setItem('gms_pending_save', 'true');
    initOAuth();
    return;
  }

  showAlert('<span class="spinner"></span> Saving…', 'info');
  const header = [['Student Name', 'Student No.', 'Email', 'Quiz1 /20', 'Quiz2 /30', 'Quiz3 /50', 'Recitation /20', 'Midterm /100', 'Project /100', 'Term Paper /100', 'Finals /50', 'Average', 'Grade', 'Remarks']];
  const rows = state.students.map(s => {
    const avg = calcAvg(s); const { grade, remarks } = calcGrade(avg);
    return [s.name, s.studentNo, s.email || '', s.q1, s.q2, s.q3, s.rec, s.midterm, s.project, s.paper, s.finals, avg.toFixed(2), grade, remarks];
  });

  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${state.sheetId}/values/Sheet1!A1?valueInputOption=RAW`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window._oauthToken}`
      },
      body: JSON.stringify({ range: 'Sheet1!A1', majorDimension: 'ROWS', values: [...header, ...rows] })
    });
    const data = await res.json();
    if (data.error) {
      if (data.error.code === 401) {
        window._oauthToken = null;
        sessionStorage.setItem('gms_pending_save', 'true');
        showAlert('⚠️ Session expired. Redirecting to re-authenticate…', 'error');
        setTimeout(() => initOAuth(), 1500);
        return;
      }
      throw new Error(data.error.message);
    }
    showAlert('✓ Saved to Google Sheets!', 'success');
    addLog('success', 'Saved to sheet', `${state.students.length} records`);
  } catch (e) {
    showAlert(`Save failed: ${e.message}. <strong><a href="#" onclick="exportCSVManual()">Download CSV instead</a></strong>`, 'error');
    addLog('error', 'Save failed', e.message);
  }
}

function exportCSVManual() {
  const header = [['Student Name', 'Student No.', 'Email', 'Quiz1 /20', 'Quiz2 /30', 'Quiz3 /50', 'Recitation /20', 'Midterm /100', 'Project /100', 'Term Paper /100', 'Finals /50', 'Average', 'Grade', 'Remarks']];
  const rows = state.students.map(s => {
    const avg = calcAvg(s); const { grade, remarks } = calcGrade(avg);
    return [s.name, s.studentNo, s.email || '', s.q1, s.q2, s.q3, s.rec, s.midterm, s.project, s.paper, s.finals, avg.toFixed(2), grade, remarks];
  });
  exportCSV([...header, ...rows]);
}

function exportCSV(values) {
  const csv = values.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `grades_${state.subject || 'export'}.csv`.replace(/\s+/g, '_');
  a.click();
}

function disconnect() {
  localStorage.removeItem('gms_connection');
  window._oauthToken = null;
  Object.assign(state, { connected: false, apiKey: '', sheetId: '', students: [] });
  document.getElementById('connectedInfo').classList.add('hidden');
  document.getElementById('syncBadge').style.display = 'none';
  document.getElementById('notConnectedMsg').classList.remove('hidden');
  document.getElementById('gradebookContent').classList.add('hidden');
  document.getElementById('setupHelp').classList.remove('hidden');
  addLog('info', 'Disconnected', ''); hideAlert();
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

  const idCol     = col('id') !== -1 ? col('id') : col('student_no') !== -1 ? col('student_no') : col('studentno');
  const nameCol   = col('full_name') !== -1 ? col('full_name') : col('name');
  const emailCol  = col('email');
  const q1Col     = col('q1') !== -1 ? col('q1') : col('quiz1') !== -1 ? col('quiz1') : col('quiz 1');
  const q2Col     = col('q2') !== -1 ? col('q2') : col('quiz2') !== -1 ? col('quiz2') : col('quiz 2');
  const q3Col     = col('q3') !== -1 ? col('q3') : col('quiz3') !== -1 ? col('quiz3') : col('quiz 3');
  const recCol    = col('rec') !== -1 ? col('rec') : col('recitation');
  const midCol    = col('mid') !== -1 ? col('mid') : col('midterm');
  const projCol   = col('proj') !== -1 ? col('proj') : col('project');
  const paperCol  = col('paper') !== -1 ? col('paper') : col('term');
  const finalsCol = col('final');

  let imported = 0, skipped = 0;
  const newStudents = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
    const get = idx => idx >= 0 && row[idx] ? row[idx].replace(/"/g, '').trim() : '';

    const name = get(nameCol);
    const studentNo = get(idCol);
    if (!name && !studentNo) { skipped++; continue; }

    newStudents.push({
      id: Date.now() + i,
      name: name || '—',
      studentNo: studentNo || '—',
      email: get(emailCol) || '',
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
  showAlert(`✓ Imported ${imported} students from <strong>${filename}</strong>${skipped ? ` (${skipped} skipped)` : ''}. Saving to Sheet…`, 'success');
  addLog('success', `CSV imported: ${imported} students`, filename);
  saveToSheet(); // ← auto-save to Google Sheets after import
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
    tbody.innerHTML = `<tr><td colspan="15" style="text-align:center;color:var(--muted);padding:32px">No students yet. Click "+ Add Student" or "↑ Import CSV" to begin.</td></tr>`;
    updateStats(); return;
  }
  tbody.innerHTML = state.students.map((s, i) => {
    const avg = calcAvg(s); const { grade, remarks } = calcGrade(avg);
    const rc = remarks === 'Passed' ? 'var(--success)' : remarks === 'Failed' ? 'var(--error)' : 'var(--muted)';
    return `<tr data-email="${s.email || ''}">
      <td style="color:var(--muted)">${i + 1}</td>
      <td style="font-weight:500">${s.name || '—'}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--muted)">${s.studentNo || '—'}</td>
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
  const studentNo = document.getElementById('newId').value.trim();
  const email = document.getElementById('newEmail').value.trim() || '';
  if (!name) return;
  state.students.push({
    id: Date.now(), name, studentNo, email,
    q1:      parseFloat(document.getElementById('newQ1').value)    || 0,
    q2:      parseFloat(document.getElementById('newQ2').value)    || 0,
    q3:      parseFloat(document.getElementById('newQ3').value)    || 0,
    rec:     parseFloat(document.getElementById('newRec').value)   || 0,
    midterm: parseFloat(document.getElementById('newMid').value)   || 0,
    project: parseFloat(document.getElementById('newProj').value)  || 0,
    paper:   parseFloat(document.getElementById('newPaper').value) || 0,
    finals:  parseFloat(document.getElementById('newFinals').value)|| 0,
  });
  ['newName', 'newId', 'newEmail', 'newQ1', 'newQ2', 'newQ3', 'newRec', 'newMid', 'newProj', 'newPaper', 'newFinals']
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

function quickPrompt(t) { document.getElementById('chatInput').value = t; sendChat(); }

async function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim(); if (!msg) return; input.value = '';
  appendMsg('user', msg); const typingEl = appendTyping();
  const ctx = buildContext();
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 1000,
        system: `You are a Grade Assistant. Class data:\n\n${ctx}\n\nGrading: Quizzes 20%, Recitation 10%, Midterm 25%, Project 20%, Term Paper 25%. Passing=75+. Be concise.`,
        messages: [{ role: 'user', content: msg }]
      })
    });
    const data = await res.json(); typingEl.remove();
    appendMsg('ai', data.content?.[0]?.text || 'No response.');
  } catch (e) { typingEl.remove(); appendMsg('ai', 'Error: ' + e.message); }
}

function buildContext() {
  if (!state.connected || !state.students.length) return 'No data loaded yet.';
  return [
    `Course: ${state.course} ${state.section}`,
    `Subject: ${state.subject}`,
    `Students: ${state.students.length}`, '',
    ...state.students.map(s => {
      const avg = calcAvg(s); const { grade, remarks } = calcGrade(avg);
      return `- ${s.name} (${s.studentNo}): Q1=${s.q1}/20 Q2=${s.q2}/30 Q3=${s.q3}/50 Rec=${s.rec}/20 Mid=${s.midterm}/100 Proj=${s.project}/100 Paper=${s.paper}/100 Finals=${s.finals}/50 → Avg=${avg.toFixed(1)} ${grade} ${remarks}`;
    })
  ].join('\n');
}

function appendMsg(role, text) {
  const box = document.getElementById('chatBox');
  const div = document.createElement('div'); div.className = `msg ${role}`;
  div.innerHTML = `<div class="msg-avatar">${role === 'ai' ? '✦' : '👤'}</div><div class="msg-bubble">${text.replace(/\n/g, '<br>')}</div>`;
  box.appendChild(div); box.scrollTop = box.scrollHeight; return div;
}

function appendTyping() {
  const box = document.getElementById('chatBox');
  const div = document.createElement('div'); div.className = 'msg ai';
  div.innerHTML = `<div class="msg-avatar">✦</div><div class="msg-bubble"><div class="typing"><span></span><span></span><span></span></div></div>`;
  box.appendChild(div); box.scrollTop = box.scrollHeight; return div;
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