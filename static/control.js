const $ = s => document.querySelector(s);
let token = sessionStorage.getItem('100mx_token') || '';
let current = null;
let polling = true;
let toastTimer = null;

function esc(t) {
  return String(t ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function setIfNotFocused(el, value) { if (el && document.activeElement !== el) el.value = value; }
function message(text, isError=false) {
  const el = $('#actionToast');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
function showLogin(msg='') {
  token = '';
  sessionStorage.removeItem('100mx_token');
  $('#appView')?.classList.add('hidden');
  $('#loginView')?.classList.remove('hidden');
  if (msg) {
    $('#loginMsg').textContent = msg;
    $('#loginMsg').classList.remove('hidden');
  }
}

async function login(code) {
  const r = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code})});
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'No se pudo iniciar sesión.');
  token = j.token;
  sessionStorage.setItem('100mx_token', token);
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#loginMsg').classList.add('hidden');
  await refresh();
}

async function apiAction(action, payload={}) {
  const r = await fetch('/api/action', {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
    body:JSON.stringify({action,payload})
  });
  const j = await r.json();
  if (r.status === 401) { showLogin('La sesión expiró. Ingresa nuevamente el código.'); throw new Error('Sesión expirada.'); }
  if (!j.ok) throw new Error(j.error || 'No se pudo completar la acción.');
  current = j.data;
  render(current);
  return current;
}

async function refresh() {
  try {
    const r = await fetch('/api/control/state', {headers:{'Authorization':`Bearer ${token}`}, cache:'no-store'});
    const j = await r.json();
    if (r.status === 401) { showLogin('La sesión expiró. Ingresa nuevamente el código.'); return; }
    if (!j.ok) throw new Error(j.error || 'No se pudo actualizar.');
    current = j.data;
    render(current);
    $('#connectionStatus').textContent = 'Conectado';
  } catch (e) {
    if ($('#connectionStatus')) $('#connectionStatus').textContent = 'Reconectando…';
  }
}

function phaseText(st) {
  if (st.round_phase === 'review' || st.round_awarded) return 'REVISIÓN';
  if (st.round_phase === 'active') return 'EN JUEGO';
  return 'LISTA';
}

function renderQuestions(data) {
  const st = data.state;
  const sel = $('#questionSelect');
  const wanted = String(st.current_question_id ?? '');
  const signature = data.questions.map(q => `${q.id}:${q.used ? 1 : 0}`).join('|');
  if (sel.dataset.signature !== signature) {
    sel.innerHTML = data.questions.map(q => {
      const isCurrent = String(q.id) === wanted;
      const disabled = q.used && !isCurrent;
      const label = `${q.used ? '✓ USADA — ' : ''}${esc(q.question)}`;
      return `<option value="${esc(q.id)}" ${disabled ? 'disabled' : ''}>${label}</option>`;
    }).join('');
    sel.dataset.signature = signature;
  }
  sel.value = wanted;
  sel.disabled = st.round_phase === 'active' || st.round_awarded;

  const usage = data.question_usage || {remaining:data.questions.length, total:data.questions.length, used:0, warning:''};
  $('#usageCounter').textContent = `${usage.remaining} disponibles`;
  const warn = $('#usageWarning');
  if (usage.warning) { warn.textContent = usage.warning; warn.classList.remove('hidden'); }
  else warn.classList.add('hidden');

  document.querySelectorAll('[data-multiplier]').forEach(btn => {
    const n = Number(btn.dataset.multiplier);
    btn.classList.toggle('active', n === Number(st.multiplier));
    btn.disabled = st.round_awarded || st.round_phase === 'active';
  });

  const ready = st.round_phase === 'ready' && !st.round_awarded;
  const active = st.round_phase === 'active' && !st.round_awarded;
  const review = st.round_phase === 'review' || st.round_awarded;
  $('#startRoundBtn').disabled = !ready;
  $('#startRoundBtn').textContent = ready ? '▶ INICIAR RONDA' : (active ? 'RONDA EN CURSO' : 'RONDA TERMINADA');
  $('#reviewNotice').classList.toggle('hidden', !review);
  $('#revealNextMissingBtn').classList.toggle('hidden', !review);
  $('#nextQuestionBtn').classList.toggle('hidden', !review);

  const q = data.questions.find(x => String(x.id) === wanted);
  const revealedSet = new Set(st.revealed || []);
  $('#answerControls').innerHTML = q ? q.answers.map((a, i) => {
    const revealed = revealedSet.has(i);
    const canReveal = !revealed && (active || review);
    return `<button class="mobile-answer ${revealed ? 'revealed' : ''}" data-reveal="${i}" ${canReveal ? '' : 'disabled'}>
      <span class="answer-index">${i+1}</span>
      <span class="answer-copy">${esc(a.text)}</span>
      <span class="answer-score">${esc(a.points)}</span>
      <span class="answer-action">${revealed ? '✓' : (review ? 'MOSTRAR' : 'REVELAR')}</span>
    </button>`;
  }).join('') : '<div class="notice">No hay pregunta seleccionada.</div>';

  $('#awardedPill').classList.toggle('hidden', !st.round_awarded);
  $('#awardTeam1').disabled = !active || st.round_awarded;
  $('#awardTeam2').disabled = !active || st.round_awarded;
  $('#dockAward1').disabled = !active || st.round_awarded;
  $('#dockAward2').disabled = !active || st.round_awarded;
  $('#strikeBtn').disabled = !active || st.errors >= 3;
  $('#dockStrike').disabled = !active || st.errors >= 3;
}

function renderTeams(st) {
  $('#quickTeam1Name').textContent = st.teams[0].name;
  $('#quickTeam2Name').textContent = st.teams[1].name;
  $('#quickTeam1Score').textContent = st.teams[0].score;
  $('#quickTeam2Score').textContent = st.teams[1].score;
  $('#awardName1').textContent = st.teams[0].name;
  $('#awardName2').textContent = st.teams[1].name;
  $('#dockTeam1').textContent = st.teams[0].name;
  $('#dockTeam2').textContent = st.teams[1].name;
  setIfNotFocused($('#team1NameInput'), st.teams[0].name);
  setIfNotFocused($('#team2NameInput'), st.teams[1].name);
  setIfNotFocused($('#team1ScoreInput'), st.teams[0].score);
  setIfNotFocused($('#team2ScoreInput'), st.teams[1].score);
}

function renderFast(data) {
  const fm = data.state.fast_money;
  setIfNotFocused($('#fastTargetInput'), fm.target);
  $('#fastTotalPill').textContent = `Total: ${data.fast_money_totals.combined}`;
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
      <button class="btn ${row.p1.revealed ? 'btn-light' : 'btn-blue'}" data-fast-reveal="1:${i}">${row.p1.revealed ? 'P1 revelada' : 'Revelar P1'}</button>
      <div class="p2answer"><label>Respuesta P2</label><input type="text" class="p2a" value="${esc(row.p2.answer)}"></div>
      <div class="p2points"><label>Ptos.</label><input type="number" min="0" class="p2p" value="${esc(row.p2.points)}"></div>
      <button class="btn ${row.p2.revealed ? 'btn-light' : 'btn-blue'}" data-fast-reveal="2:${i}">${row.p2.revealed ? 'P2 revelada' : 'Revelar P2'}</button>
    </div>`).join('');
}

function render(data) {
  const st = data.state;
  renderTeams(st);
  renderQuestions(data);
  $('#roundPointsControl').textContent = st.round_points;
  $('#phasePill').textContent = phaseText(st);
  $('#phasePill').dataset.phase = st.round_phase || 'ready';

  $('#strikeCount').textContent = `${st.errors} / 3`;
  [...$('#strikeVisual').children].forEach((x, i) => x.classList.toggle('active', st.errors > i));

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
    p1: {answer: row.querySelector('.p1a').value, points:Number(row.querySelector('.p1p').value || 0)},
    p2: {answer: row.querySelector('.p2a').value, points:Number(row.querySelector('.p2p').value || 0)}
  }));
  if (rows.length !== 5) throw new Error('Deben existir cinco preguntas de Dinero rápido.');
  return {target:Number($('#fastTargetInput').value || 200), questions:rows};
}
async function saveFast(silent=false) {
  const data = await apiAction('fast_update', collectFast());
  if (!silent) message(data.fast_money_warnings?.length ? 'Guardado con avisos de respuestas repetidas.' : 'Dinero rápido guardado.');
  return data;
}

async function award(team) {
  try {
    await apiAction('award', {team, reason:$('#awardReason').value});
    message(`Puntos entregados a ${current.state.teams[team].name}. Ahora puedes descubrir las faltantes.`);
  } catch (e) { message(e.message, true); }
}
async function addStrike() {
  try { await apiAction('strike'); message('Strike marcado.'); } catch(e) { message(e.message,true); }
}

$('#loginBtn').onclick = () => login(String($('#pinInput').value || '').padStart(6,'0')).catch(e => { $('#loginMsg').textContent=e.message; $('#loginMsg').classList.remove('hidden'); });
$('#pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginBtn').click(); });

$('#normalModeBtn').onclick = () => apiAction('screen_mode', {mode:'normal'}).then(()=>message('Ronda normal.')).catch(e=>message(e.message,true));
$('#fastModeBtn').onclick = () => apiAction('screen_mode', {mode:'fast_money'}).then(()=>message('Dinero rápido.')).catch(e=>message(e.message,true));
$('#questionSelect').onchange = e => apiAction('set_question', {question_id:e.target.value}).then(()=>message('Pregunta preparada.')).catch(e=>message(e.message,true));
document.querySelectorAll('[data-multiplier]').forEach(btn => btn.onclick = () => apiAction('set_multiplier', {multiplier:Number(btn.dataset.multiplier)}).then(()=>message(`Multiplicador ×${btn.dataset.multiplier}.`)).catch(e=>message(e.message,true)));
$('#startRoundBtn').onclick = () => apiAction('start_round').then(()=>message('Ronda iniciada.')).catch(e=>message(e.message,true));
$('#nextQuestionBtn').onclick = () => apiAction('next_question').then(()=>message('Siguiente pregunta preparada.')).catch(e=>message(e.message,true));
$('#revealNextMissingBtn').onclick = async () => {
  const st = current?.state; if (!st) return;
  const q = current.questions.find(x => String(x.id) === String(st.current_question_id));
  const next = q?.answers.findIndex((_, i) => !st.revealed.includes(i)) ?? -1;
  if (next < 0) return message('Ya se descubrieron todas las respuestas.');
  try { await apiAction('reveal', {index:next}); message('Respuesta faltante descubierta.'); } catch(e) { message(e.message,true); }
};
$('#answerControls').onclick = e => {
  const b = e.target.closest('[data-reveal]'); if (!b) return;
  apiAction('reveal',{index:Number(b.dataset.reveal)}).then(()=>message(current.state.round_awarded ? 'Respuesta faltante descubierta.' : 'Respuesta revelada.')).catch(x=>message(x.message,true));
};

$('#strikeBtn').onclick = addStrike;
$('#dockStrike').onclick = addStrike;
$('#clearStrikesBtn').onclick = () => apiAction('clear_strikes').then(()=>message('Strikes limpiados.')).catch(e=>message(e.message,true));
$('#resetRoundBtn').onclick = () => { if (confirm('¿Reiniciar la ronda actual?')) apiAction('round_reset').then(()=>message('Ronda reiniciada.')).catch(e=>message(e.message,true)); };

$('#awardTeam1').onclick = () => award(0);
$('#awardTeam2').onclick = () => award(1);
$('#dockAward1').onclick = () => award(0);
$('#dockAward2').onclick = () => award(1);

document.querySelectorAll('[data-name-team]').forEach(btn => btn.onclick = () => {
  const i=Number(btn.dataset.nameTeam), input=i===0?$('#team1NameInput'):$('#team2NameInput');
  apiAction('team_name',{team:i,name:input.value}).then(()=>message('Nombre actualizado.')).catch(e=>message(e.message,true));
});
document.querySelectorAll('[data-score-team]').forEach(btn => btn.onclick = () => {
  const i=Number(btn.dataset.scoreTeam), input=i===0?$('#team1ScoreInput'):$('#team2ScoreInput');
  apiAction('score',{team:i,score:Number(input.value||0)}).then(()=>message('Marcador corregido.')).catch(e=>message(e.message,true));
});

$('#timerSet').onclick = () => apiAction('timer_config',{seconds:Number($('#timerSeconds').value||30)}).then(()=>message('Temporizador ajustado.')).catch(e=>message(e.message,true));
$('#timerStart').onclick = () => apiAction('timer_start').then(()=>message('Temporizador iniciado.')).catch(e=>message(e.message,true));
$('#timerPause').onclick = () => apiAction('timer_pause').then(()=>message('Temporizador pausado.')).catch(e=>message(e.message,true));
$('#timerReset').onclick = () => apiAction('timer_reset').then(()=>message('Temporizador reiniciado.')).catch(e=>message(e.message,true));

$('#saveFastBtn').onclick = () => saveFast(false).catch(e=>message(e.message,true));
$('#hideFastBtn').onclick = () => apiAction('fast_hide_all').then(()=>message('Dinero rápido oculto.')).catch(e=>message(e.message,true));
$('#fastEditor').onclick = async e => {
  const b=e.target.closest('[data-fast-reveal]'); if (!b) return;
  try { await saveFast(true); const [participant,index]=b.dataset.fastReveal.split(':').map(Number); await apiAction('fast_reveal',{participant,index}); message(`Respuesta P${participant} revelada.`); }
  catch(err) { message(err.message,true); }
};

$('#undoBtn').onclick = () => apiAction('undo').then(()=>message('Última acción deshecha.')).catch(e=>message(e.message,true));
$('#newGameBtn').onclick = () => { if (confirm('¿Poner los marcadores en cero? El historial de preguntas usadas se conservará.')) apiAction('new_game').then(()=>message('Nueva partida iniciada.')).catch(e=>message(e.message,true)); };
$('#resetUsageBtn').onclick = () => { if (confirm('¿Permitir nuevamente todas las preguntas usadas? Esta acción puede deshacerse inmediatamente con Deshacer.')) apiAction('reset_usage').then(()=>message('Historial de preguntas usadas reiniciado.')).catch(e=>message(e.message,true)); };
$('#restoreDemoBtn').onclick = () => { if (confirm('¿Restaurar las preguntas de ejemplo?')) apiAction('restore_demo').then(()=>message('Ejemplos restaurados.')).catch(e=>message(e.message,true)); };

$('#importBtn').onclick = async () => {
  const file=$('#xlsxInput').files?.[0], box=$('#importMsg');
  if (!file) { box.textContent='Selecciona un archivo .xlsx.'; box.className='notice error'; return; }
  box.textContent='Importando…'; box.className='notice';
  try {
    const r=await fetch('/api/import',{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)},body:await file.arrayBuffer()});
    const j=await r.json(); if (!j.ok) throw new Error(j.error||'No se pudo importar.');
    current=j.data; render(current); box.textContent=`Importación correcta: ${j.data.imported_count} preguntas.`; box.className='notice success'; message('Banco de preguntas actualizado.');
  } catch(e) { box.textContent=e.message; box.className='notice error'; }
};

const codeFromUrl = new URLSearchParams(location.search).get('code');
if (codeFromUrl) login(codeFromUrl).catch(e => showLogin(e.message));
else if (token) { $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); refresh(); }
else showLogin();

setInterval(() => { if (polling && token && !$('#appView').classList.contains('hidden')) refresh(); }, 800);
