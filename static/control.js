const $ = s => document.querySelector(s);
let token = sessionStorage.getItem('100mx_token') || '';
let current = null;
let polling = true;

function esc(t) { return String(t ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function setIfNotFocused(el, value) { if (document.activeElement !== el) el.value = value; }
function message(text, isError=false) { const el = $('#actionMsg'); el.textContent = text; el.style.color = isError ? '#9d252b' : '#60758b'; }

async function login(code) {
  const r = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code})});
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'No se pudo iniciar sesión.');
  token = j.token;
  sessionStorage.setItem('100mx_token', token);
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  await refresh();
}

function showLogin(error='') {
  token = '';
  sessionStorage.removeItem('100mx_token');
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  if (error) { $('#loginMsg').textContent = error; $('#loginMsg').classList.remove('hidden'); }
}

async function apiAction(action, payload={}) {
  const r = await fetch('/api/action', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
    body:JSON.stringify({action, payload})
  });
  const j = await r.json();
  if (r.status === 401) { showLogin('La sesión terminó. Ingresa nuevamente el código.'); throw new Error('Sesión no válida.'); }
  if (!j.ok) throw new Error(j.error || 'La acción no se pudo realizar.');
  current = j.data;
  render(current);
  return current;
}

async function refresh() {
  if (!token) return;
  try {
    const r = await fetch('/api/control/state', {headers:{'Authorization':`Bearer ${token}`}, cache:'no-store'});
    const j = await r.json();
    if (r.status === 401) { showLogin('La sesión terminó. Ingresa nuevamente el código.'); return; }
    if (j.ok) { current = j.data; render(current); $('#connectionStatus').textContent = 'Conectado'; }
  } catch (_) { $('#connectionStatus').textContent = 'Sin conexión con la computadora'; }
}

function renderQuestions(data) {
  const st = data.state;
  const sel = $('#questionSelect');
  const wanted = String(st.current_question_id ?? '');
  const signature = data.questions.map(q => `${q.id}:${q.question}`).join('|');
  if (sel.dataset.signature !== signature) {
    sel.innerHTML = data.questions.map(q => `<option value="${esc(q.id)}">${esc(q.id)} — ${esc(q.question)}</option>`).join('');
    sel.dataset.signature = signature;
  }
  sel.value = wanted;
  $('#multiplierSelect').value = String(st.multiplier);
  $('#roundPointsControl').textContent = st.round_points;
  $('#awardedPill').classList.toggle('hidden', !st.round_awarded);
  $('#awardTeam1').disabled = st.round_awarded;
  $('#awardTeam2').disabled = st.round_awarded;

  const q = data.questions.find(x => String(x.id) === wanted);
  $('#answerControls').innerHTML = q ? q.answers.map((a, i) => {
    const revealed = st.revealed.includes(i);
    return `<div class="answer-control ${revealed ? 'revealed' : ''}">
      <div class="idx">${i+1}</div><div class="answer">${esc(a.text)}</div><div class="pts">${esc(a.points)}</div>
      <button class="btn ${revealed ? '' : 'btn-blue'}" data-reveal="${i}" ${revealed || st.round_awarded ? 'disabled' : ''}>${revealed ? 'Revelada' : 'Revelar'}</button>
    </div>`;
  }).join('') : '<div class="notice">No hay pregunta seleccionada.</div>';
}

function renderTeams(st) {
  setIfNotFocused($('#team1NameInput'), st.teams[0].name);
  setIfNotFocused($('#team2NameInput'), st.teams[1].name);
  setIfNotFocused($('#team1ScoreInput'), st.teams[0].score);
  setIfNotFocused($('#team2ScoreInput'), st.teams[1].score);
}

function renderFast(data) {
  const fm = data.state.fast_money;
  setIfNotFocused($('#fastTargetInput'), fm.target);
  $('#fastTotalPill').textContent = `Total capturado: ${data.fast_money_totals.combined}`;
  const warn = $('#fastWarnings');
  if (data.fast_money_warnings?.length) {
    warn.innerHTML = `<ul class="warning-list">${data.fast_money_warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`;
  } else warn.innerHTML = '';

  const editor = $('#fastEditor');
  if (editor.contains(document.activeElement)) return;
  editor.innerHTML = fm.questions.map((row, i) => `
    <div class="fast-editor-row" data-fast-row="${i}">
      <div class="question-input"><label>Pregunta ${i+1}</label><input type="text" class="fq" value="${esc(row.question)}"></div>
      <div class="p1answer"><label>Respuesta P1</label><input type="text" class="p1a" value="${esc(row.p1.answer)}"></div>
      <div class="p1points"><label>Ptos.</label><input type="number" min="0" class="p1p" value="${esc(row.p1.points)}"></div>
      <button class="btn ${row.p1.revealed ? '' : 'btn-blue'}" data-fast-reveal="1:${i}">${row.p1.revealed ? 'P1 revelada' : 'Revelar P1'}</button>
      <div class="p2answer"><label>Respuesta P2</label><input type="text" class="p2a" value="${esc(row.p2.answer)}"></div>
      <div class="p2points"><label>Ptos.</label><input type="number" min="0" class="p2p" value="${esc(row.p2.points)}"></div>
      <button class="btn ${row.p2.revealed ? '' : 'btn-blue'}" data-fast-reveal="2:${i}">${row.p2.revealed ? 'P2 revelada' : 'Revelar P2'}</button>
    </div>`).join('');
}

function render(data) {
  const st = data.state;
  renderTeams(st);
  renderQuestions(data);
  $('#strikeCount').textContent = `${st.errors} / 3`;
  $('#strikeBtn').disabled = st.errors >= 3;
  setIfNotFocused($('#timerSeconds'), st.timer.duration);
  const rem = st.timer.running && st.timer.end_epoch ? Math.max(0, Math.ceil(st.timer.end_epoch - Date.now()/1000)) : st.timer.remaining;
  $('#timerPill').textContent = `${rem} s${st.timer.running ? ' ▶' : ''}`;
  const fast = st.screen_mode === 'fast_money';
  $('#normalControls').classList.toggle('hidden', fast);
  $('#fastControls').classList.toggle('hidden', !fast);
  $('#modePill').textContent = fast ? 'Dinero rápido' : 'Ronda normal';
  renderFast(data);
  $('#undoBtn').disabled = !data.undo_available;
}

function collectFast() {
  const rows = [...document.querySelectorAll('[data-fast-row]')].map(row => ({
    question: row.querySelector('.fq').value,
    p1: {answer: row.querySelector('.p1a').value, points: Number(row.querySelector('.p1p').value || 0)},
    p2: {answer: row.querySelector('.p2a').value, points: Number(row.querySelector('.p2p').value || 0)}
  }));
  if (rows.length !== 5) throw new Error('Deben existir cinco preguntas de Dinero rápido.');
  return {target:Number($('#fastTargetInput').value || 200), questions:rows};
}

async function saveFast(silent=false) {
  const data = await apiAction('fast_update', collectFast());
  if (!silent) message(data.fast_money_warnings?.length ? 'Guardado con avisos de respuestas repetidas.' : 'Dinero rápido guardado.');
  return data;
}

$('#loginBtn').onclick = () => login(String($('#pinInput').value || '').padStart(6,'0')).catch(e => { $('#loginMsg').textContent=e.message; $('#loginMsg').classList.remove('hidden'); });
$('#pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginBtn').click(); });

$('#normalModeBtn').onclick = () => apiAction('screen_mode', {mode:'normal'}).then(() => message('Tablero en ronda normal.')).catch(e => message(e.message,true));
$('#fastModeBtn').onclick = () => apiAction('screen_mode', {mode:'fast_money'}).then(() => message('Tablero en Dinero rápido.')).catch(e => message(e.message,true));
$('#questionSelect').onchange = e => apiAction('set_question', {question_id:e.target.value}).then(() => message('Pregunta preparada.')).catch(e => message(e.message,true));
$('#multiplierSelect').onchange = e => apiAction('set_multiplier', {multiplier:Number(e.target.value)}).then(() => message(`Multiplicador ×${e.target.value}.`)).catch(e => message(e.message,true));
$('#answerControls').onclick = e => { const b=e.target.closest('[data-reveal]'); if (!b) return; apiAction('reveal',{index:Number(b.dataset.reveal)}).then(()=>message('Respuesta revelada.')).catch(x=>message(x.message,true)); };
$('#strikeBtn').onclick = () => apiAction('strike').then(()=>message('Error marcado.')).catch(e=>message(e.message,true));
$('#clearStrikesBtn').onclick = () => apiAction('clear_strikes').then(()=>message('Errores limpiados.')).catch(e=>message(e.message,true));
$('#resetRoundBtn').onclick = () => apiAction('round_reset').then(()=>message('Ronda reiniciada.')).catch(e=>message(e.message,true));

$('#awardTeam1').onclick = () => apiAction('award',{team:0,reason:$('#awardReason').value}).then(()=>message('Puntos entregados al Equipo 1.')).catch(e=>message(e.message,true));
$('#awardTeam2').onclick = () => apiAction('award',{team:1,reason:$('#awardReason').value}).then(()=>message('Puntos entregados al Equipo 2.')).catch(e=>message(e.message,true));

document.querySelectorAll('[data-name-team]').forEach(btn => btn.onclick = () => {
  const i=Number(btn.dataset.nameTeam); const input=i===0?$('#team1NameInput'):$('#team2NameInput');
  apiAction('team_name',{team:i,name:input.value}).then(()=>message('Nombre actualizado.')).catch(e=>message(e.message,true));
});
document.querySelectorAll('[data-score-team]').forEach(btn => btn.onclick = () => {
  const i=Number(btn.dataset.scoreTeam); const input=i===0?$('#team1ScoreInput'):$('#team2ScoreInput');
  apiAction('score',{team:i,score:Number(input.value||0)}).then(()=>message('Marcador corregido.')).catch(e=>message(e.message,true));
});

$('#timerSet').onclick = () => apiAction('timer_config',{seconds:Number($('#timerSeconds').value||30)}).then(()=>message('Temporizador configurado.')).catch(e=>message(e.message,true));
$('#timerStart').onclick = () => apiAction('timer_start').then(()=>message('Temporizador iniciado.')).catch(e=>message(e.message,true));
$('#timerPause').onclick = () => apiAction('timer_pause').then(()=>message('Temporizador pausado.')).catch(e=>message(e.message,true));
$('#timerReset').onclick = () => apiAction('timer_reset').then(()=>message('Temporizador reiniciado.')).catch(e=>message(e.message,true));

$('#saveFastBtn').onclick = () => saveFast(false).catch(e=>message(e.message,true));
$('#hideFastBtn').onclick = () => apiAction('fast_hide_all').then(()=>message('Respuestas de Dinero rápido ocultas.')).catch(e=>message(e.message,true));
$('#fastEditor').onclick = async e => {
  const b=e.target.closest('[data-fast-reveal]'); if (!b) return;
  try {
    await saveFast(true);
    const [participant,index]=b.dataset.fastReveal.split(':').map(Number);
    await apiAction('fast_reveal',{participant,index});
    message(`Respuesta P${participant} revelada.`);
  } catch(err) { message(err.message,true); }
};

$('#undoBtn').onclick = () => apiAction('undo').then(()=>message('Última acción deshecha.')).catch(e=>message(e.message,true));
$('#newGameBtn').onclick = () => {
  if (!confirm('¿Iniciar una nueva partida y poner ambos marcadores en 0?')) return;
  apiAction('new_game').then(()=>message('Nueva partida iniciada.')).catch(e=>message(e.message,true));
};
$('#restoreDemoBtn').onclick = () => apiAction('restore_demo').then(()=>message('Preguntas de demostración restauradas.')).catch(e=>message(e.message,true));

$('#importBtn').onclick = async () => {
  const file=$('#xlsxInput').files?.[0]; const box=$('#importMsg');
  if (!file) { box.textContent='Selecciona un archivo .xlsx.'; box.className='notice error'; return; }
  box.textContent='Importando…'; box.className='notice';
  try {
    const r=await fetch('/api/import',{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)},body:await file.arrayBuffer()});
    const j=await r.json();
    if (!j.ok) throw new Error(j.error||'No se pudo importar.');
    current=j.data; render(current); box.textContent=`Importación correcta: ${j.data.imported_count} preguntas.`; box.className='notice success'; message('Banco de preguntas reemplazado.');
  } catch(e) { box.textContent=e.message; box.className='notice error'; }
};

const codeFromUrl = new URLSearchParams(location.search).get('code');
if (codeFromUrl) {
  login(codeFromUrl).catch(e => showLogin(e.message));
} else if (token) {
  $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); refresh();
} else showLogin();

setInterval(() => { if (polling && token && !$('#appView').classList.contains('hidden')) refresh(); }, 800);
