const CLIENT_VERSION = "12.0.0";
const REQUIRED_BACKEND_ACTIONS = ["start_round","show_question","set_control_team","faceoff_miss","reveal","strike","award","next_question","undo","finish_game","start_game_display"];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let token = sessionStorage.getItem('100mx_token') || '';
let current = null;
let uiStep = Number(sessionStorage.getItem('100mx_host_step') || 1);
let awardReason = 'ronda';
let toastTimer = null;
let teamDraftDirty = false;
let lastTeamDraft = ['', ''];

function esc(t) {
  return String(t ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function setIfNotFocused(el, value) { if (el && document.activeElement !== el) el.value = value; }
function isFormEditing() {
  const el = document.activeElement;
  return !!el && ['INPUT','TEXTAREA','SELECT'].includes(el.tagName);
}
function syncTeamDraftFromState(st) {
  const a = $('#team1NameInput'), b = $('#team2NameInput');
  if (!a || !b) return;
  a.value = st.teams[0].name;
  b.value = st.teams[1].name;
  lastTeamDraft = [a.value, b.value];
  teamDraftDirty = false;
}
function message(text, isError=false) {
  const el = $('#actionToast');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2300);
}

function assertBackendCompatible(data) {
  const serverVersion = String(data?.app_version || '');
  const supported = new Set(data?.supported_actions || []);
  const missing = REQUIRED_BACKEND_ACTIONS.filter(x => !supported.has(x));
  if (serverVersion !== CLIENT_VERSION || missing.length) {
    const detail = !serverVersion
      ? 'El servidor es anterior a V10.'
      : `Interfaz V${CLIENT_VERSION} / servidor V${serverVersion}.`;
    const miss = missing.length ? ` Faltan acciones: ${missing.join(', ')}.` : '';
    throw new Error(`${detail}${miss} Actualiza app.py, game_logic.py y pythonanywhere_wsgi.py, luego pulsa Reload en PythonAnywhere.`);
  }
}
function friendlyActionError(action, error) {
  const text = String(error?.message || error || 'Error desconocido');
  if (/Acción no reconocida/i.test(text) || (action === 'set_control_team' && /no reconocida/i.test(text))) {
    return new Error('El panel V10 está cargado, pero PythonAnywhere sigue ejecutando un backend anterior. Actualiza app.py, game_logic.py y pythonanywhere_wsgi.py y pulsa Reload.');
  }
  return error instanceof Error ? error : new Error(text);
}

function showCompatibilityError(text) {
  const el = $('#compatibilityBanner');
  if (el) { el.textContent = text; el.classList.remove('hidden'); }
  message(text, true);
}

function showLogin(msg='') {
  token = '';
  sessionStorage.removeItem('100mx_token');
  $('#appView')?.classList.add('hidden');
  $('#loginView')?.classList.remove('hidden');
  if (msg) { $('#loginMsg').textContent = msg; $('#loginMsg').classList.remove('hidden'); }
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
  await refresh(true);
}
async function apiAction(action, payload={}) {
  const r = await fetch('/api/action', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
    body:JSON.stringify({action,payload})
  });
  const j = await r.json();
  if (r.status === 401) { showLogin('La sesión expiró. Ingresa nuevamente el código.'); throw new Error('Sesión expirada.'); }
  if (!j.ok) throw friendlyActionError(action, new Error(j.error || 'No se pudo completar la acción.'));
  assertBackendCompatible(j.data);
  current = j.data;
  render(current);
  return current;
}
async function refresh(initial=false) {
  try {
    const r = await fetch('/api/control/state', {headers:{'Authorization':`Bearer ${token}`}, cache:'no-store'});
    const j = await r.json();
    if (r.status === 401) { showLogin('La sesión expiró. Ingresa nuevamente el código.'); return; }
    if (!j.ok) throw new Error(j.error || 'No se pudo actualizar.');
    assertBackendCompatible(j.data);
    current = j.data;
    if (initial) {
      const st = current.state;
      if (st.screen_mode === 'fast_money') showFastMoney(false);
      else if (st.round_awarded || st.round_phase === 'review') uiStep = 5;
      else if (st.round_phase === 'active') uiStep = 4;
      else if (st.round_phase === 'faceoff') uiStep = 3;
      else uiStep = uiStep === 1 ? 1 : 2;
    }
    render(current);
    $('#connectionStatus').textContent = '● Conectado';
  } catch (e) {
    if ($('#connectionStatus')) $('#connectionStatus').textContent = '● Error de versión/conexión';
    if (initial || /servidor|backend|versión|acciones/i.test(String(e.message||''))) showCompatibilityError(e.message || 'No se pudo conectar al servidor.');
  }
}
function setStep(step, persist=true, scroll=true) {
  const previous = uiStep;
  uiStep = Math.min(5, Math.max(1, Number(step)));
  if (persist) sessionStorage.setItem('100mx_host_step', String(uiStep));
  $$('.host-screen').forEach((el,i) => el.classList.toggle('hidden', i+1 !== uiStep));
  $$('.host-step').forEach((el,i) => {
    el.classList.toggle('active', i+1 === uiStep);
    el.classList.toggle('done', i+1 < uiStep);
  });
  $$('.host-stepper > i').forEach((el,i) => el.classList.toggle('done', i+1 < uiStep));
  if (scroll && previous !== uiStep && !isFormEditing()) {
    window.scrollTo({top:0, behavior:'auto'});
  }
}
function questionForState(data) {
  return data.questions.find(q => String(q.id) === String(data.state.current_question_id));
}
function renderTeams(st) {
  const tvBtn = $('#startDisplayBtn');
  const tvStatus = $('#tvIntroStatus');
  const t1=st.teams[0], t2=st.teams[1];
  // Mientras el conductor escribe los nombres, NO reemplazamos el borrador con el refresco del servidor.
  if (!teamDraftDirty) {
    setIfNotFocused($('#team1NameInput'), t1.name);
    setIfNotFocused($('#team2NameInput'), t2.name);
    lastTeamDraft = [t1.name, t2.name];
  }
  setIfNotFocused($('#team1EditName'), t1.name); setIfNotFocused($('#team2EditName'), t2.name);
  setIfNotFocused($('#team1ScoreInput'), t1.score); setIfNotFocused($('#team2ScoreInput'), t2.score);
  $('#team1SetupScore').textContent=t1.score; $('#team2SetupScore').textContent=t2.score;
  $('#prepTeam1Name').textContent=t1.name; $('#prepTeam2Name').textContent=t2.name;
  $('#prepTeam1Score').textContent=t1.score; $('#prepTeam2Score').textContent=t2.score;
  $('#awardName1').textContent=t1.name; $('#awardName2').textContent=t2.name;
  $('#faceoffTeam1Name').textContent=t1.name; $('#faceoffTeam2Name').textContent=t2.name;
  $('#faceoffDecisionName1').textContent=t1.name; $('#faceoffDecisionName2').textContent=t2.name;
  if ($('#controlTeamLive')) $('#controlTeamLive').textContent = st.control_team === 0 ? t1.name : st.control_team === 1 ? t2.name : 'POR DEFINIR';
  $('#bottomTeam1').innerHTML=`${esc(t1.name)} <b>${t1.score}</b>`;
  $('#bottomTeam2').innerHTML=`${esc(t2.name)} <b>${t2.score}</b>`;
  if (tvBtn) {
    tvBtn.disabled = Boolean(st.public_started);
    tvBtn.textContent = st.public_started ? 'TABLERO EN TV ACTIVO ✓' : 'INICIAR JUEGO EN TV';
  }
  if (tvStatus) {
    tvStatus.textContent = st.public_started
      ? 'La TV ya salió de la pantalla de espera y está mostrando el tablero.'
      : 'La TV mostrará la pantalla de espera hasta que tú inicies el juego.';
    tvStatus.classList.toggle('ready', Boolean(st.public_started));
  }
}
function renderQuestionPrep(data) {
  const st=data.state, sel=$('#questionSelect'), wanted=String(st.current_question_id ?? '');
  const signature=data.questions.map(q=>`${q.id}:${q.used?1:0}`).join('|');
  if (sel.dataset.signature !== signature) {
    sel.innerHTML=data.questions.map(q=>{
      const currentQ=String(q.id)===wanted, disabled=q.used&&!currentQ;
      return `<option value="${esc(q.id)}" ${disabled?'disabled':''}>${q.used?'✓ USADA — ':''}${esc(q.question)}</option>`;
    }).join('');
    sel.dataset.signature=signature;
  }
  sel.value=wanted;
  sel.disabled=['faceoff','active','review'].includes(st.round_phase)||st.round_awarded;
  const usage=data.question_usage||{remaining:data.questions.length,total:data.questions.length,warning:''};
  $('#usageCounter').textContent=`${usage.remaining} disponibles`;
  $('#usageModalCounter').textContent=`${usage.remaining} / ${usage.total}`;
  const warn=$('#usageWarning');
  if (usage.warning) { warn.textContent=usage.warning; warn.classList.remove('hidden'); } else warn.classList.add('hidden');
  const rn = Number(st.round_number || 1);
  const mult = Number(st.multiplier || 1);
  const sched = $('#roundScheduleBadge');
  if (sched) {
    sched.classList.toggle('double', mult === 2);
    sched.classList.toggle('triple', mult === 3);
    sched.classList.toggle('normal', mult === 1);
    $('#roundScheduleRound').textContent = `RONDA ${rn}`;
    $('#roundScheduleMultiplier').textContent = `×${mult}`;
    $('#roundScheduleText').textContent = mult === 2 ? 'PUNTOS AL DOBLE' : mult === 3 ? 'PUNTOS AL TRIPLE' : 'PUNTOS NORMALES';
  }
}
function renderFaceoff(data) {
  const st=data.state, q=questionForState(data), revealed=new Set(st.revealed||[]);
  $('#faceoffQuestionText').textContent=q?.question||'Selecciona una pregunta';
  const showBtn = $('#showQuestionBtn');
  if (showBtn) {
    const visible = Boolean(st.question_visible);
    showBtn.classList.toggle('question-is-visible', visible);
    showBtn.disabled = st.round_phase !== 'faceoff' || visible || st.round_awarded;
    $('#showQuestionHint').textContent = visible ? '✓ PREGUNTA MOSTRADA EN LA TV' : 'LÉELA EN VOZ ALTA Y TOCA AQUÍ PARA MOSTRARLA EN LA TV';
  }
  $('#faceoffAnswers').innerHTML=q?q.answers.map((a,i)=>{
    const isRevealed=revealed.has(i), canReveal=!isRevealed&&Boolean(st.question_visible)&&['faceoff','active'].includes(st.round_phase)&&!st.round_awarded;
    return `<button class="host-answer-btn ${isRevealed?'revealed':''}" data-faceoff-reveal="${i}" ${canReveal?'':'disabled'}>
      <span>${i+1}</span><b>${esc(a.text)}</b><strong>${a.points}</strong><em>${isRevealed?'✓':'REVELAR'}</em>
    </button>`;
  }).join(''):'<div class="notice">No hay pregunta seleccionada.</div>';
  $('#faceoffTeam1Btn').classList.toggle('selected-control',st.control_team===0);
  $('#faceoffTeam2Btn').classList.toggle('selected-control',st.control_team===1);
  const canChoose = st.round_phase === 'faceoff' && Boolean(st.question_visible) && !st.round_awarded;
  $('#faceoffTeam1Btn').disabled = !canChoose;
  $('#faceoffTeam2Btn').disabled = !canChoose;
}
function renderLive(data) {
  const st=data.state, q=questionForState(data), revealed=new Set(st.revealed||[]);
  $('#liveMultiplier').textContent=`×${st.multiplier}`;
  $('#roundPointsControl').textContent=st.round_points;
  $('#liveQuestionText').textContent=q?.question||'Selecciona una pregunta';
  $('.control-team-banner')?.classList.toggle('orange-control', st.control_team===1);
  $('#strikeCount').textContent=`${st.errors} / 3`;
  $$('#strikeVisual span').forEach((x,i)=>x.classList.toggle('active',st.errors>i));
  $('#strikeBtn').disabled=st.round_phase!=='active'||st.errors>=3||st.round_awarded;
  $('#clearStrikesBtn').disabled=st.round_phase!=='active';
  $('#answerControls').innerHTML=q?q.answers.map((a,i)=>{
    const isRevealed=revealed.has(i), canReveal=!isRevealed&&(st.round_phase==='active'||st.round_awarded);
    return `<button class="host-answer-btn ${isRevealed?'revealed':''}" data-reveal="${i}" ${canReveal?'':'disabled'}>
      <span>${i+1}</span><b>${esc(a.text)}</b><strong>${a.points}</strong><em>${isRevealed?'✓':'REVELAR'}</em>
    </button>`;
  }).join(''):'<div class="notice">No hay pregunta seleccionada.</div>';
  const rem=st.timer.running&&st.timer.end_epoch?Math.max(0,Math.ceil(st.timer.end_epoch-Date.now()/1000)):st.timer.remaining;
  $('#timerPill').textContent=`${rem} s${st.timer.running?' ▶':''}`;
  setIfNotFocused($('#timerSeconds'),st.timer.duration);
}
function renderClose(data) {
  const st=data.state, q=questionForState(data), revealed=new Set(st.revealed||[]);
  $('#closeRoundPoints').textContent=st.round_points;
  $('#closeMultiplier').textContent=`Incluye multiplicador ×${st.multiplier}`;
  const awarded=Boolean(st.round_awarded);
  $('#awardArea').classList.toggle('hidden',awarded);
  $('#reviewArea').classList.toggle('hidden',!awarded);
  if ($('#finishGameBtn')) {
    $('#finishGameBtn').disabled = !awarded || Boolean(st.game_over);
    $('#finishGameBtn').textContent = st.game_over ? 'JUEGO FINALIZADO ✓' : 'FINALIZAR JUEGO Y MOSTRAR GANADOR';
  }
  if (awarded) {
    const a=st.last_award, team=a?st.teams[a.team]:null;
    $('#closeTitle').textContent='Ronda terminada';
    $('#closeSubtitle').textContent='Muestra las respuestas faltantes antes de pasar a la siguiente.';
    $('#awardSummary').textContent=team?`${team.name} recibió ${a.points} puntos${a.reason==='robo'?' por robo':''}.`:'Puntos entregados.';
    const missing=q?q.answers.map((ans,i)=>({ans,i})).filter(x=>!revealed.has(x.i)):[];
    $('#missingAnswers').innerHTML=missing.length?missing.map(({ans,i})=>`<button class="missing-btn" data-reveal="${i}"><span>${i+1}</span><b>${esc(ans.text)}</b><strong>${ans.points}</strong></button>`).join(''):'<div class="all-revealed">✓ Ya se mostraron todas las respuestas.</div>';
    $('#revealNextMissingBtn').classList.toggle('hidden',missing.length===0);
  } else {
    $('#closeTitle').textContent='Cierra la ronda';
    $('#closeSubtitle').textContent='Indica quién se lleva los puntos de la bolsa.';
  }
}
function renderFast(data) {
  const fm=data.state.fast_money;
  setIfNotFocused($('#fastTargetInput'),fm.target);
  $('#fastTotalPill').textContent=`Total: ${data.fast_money_totals.combined}`;
  $('#fastWarnings').innerHTML=data.fast_money_warnings?.length?`<ul class="warning-list">${data.fast_money_warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:'';
  const editor=$('#fastEditor'); if (editor.contains(document.activeElement)) return;
  editor.innerHTML=fm.questions.map((row,i)=>`<article class="fast-v5-row" data-fast-row="${i}">
    <label>Pregunta ${i+1}<input class="fq" type="text" value="${esc(row.question)}"></label>
    <div class="fast-player"><b>Participante 1</b><input class="p1a" type="text" placeholder="Respuesta" value="${esc(row.p1.answer)}"><input class="p1p" type="number" min="0" value="${esc(row.p1.points)}"><button data-fast-reveal="1:${i}" class="${row.p1.revealed?'done':''}">${row.p1.revealed?'REVELADA':'REVELAR'}</button></div>
    <div class="fast-player"><b>Participante 2</b><input class="p2a" type="text" placeholder="Respuesta" value="${esc(row.p2.answer)}"><input class="p2p" type="number" min="0" value="${esc(row.p2.points)}"><button data-fast-reveal="2:${i}" class="${row.p2.revealed?'done':''}">${row.p2.revealed?'REVELADA':'REVELAR'}</button></div>
  </article>`).join('');
}
function render(data) {
  const st=data.state;
  renderTeams(st); renderQuestionPrep(data); renderFaceoff(data); renderLive(data); renderClose(data); renderFast(data);
  $('#undoBtn').disabled=!data.undo_available;
  setStep(uiStep,false,false);
}
function collectFast() {
  const rows=$$('[data-fast-row]').map(row=>({
    question:row.querySelector('.fq').value,
    p1:{answer:row.querySelector('.p1a').value,points:Number(row.querySelector('.p1p').value||0)},
    p2:{answer:row.querySelector('.p2a').value,points:Number(row.querySelector('.p2p').value||0)}
  }));
  if(rows.length!==5) throw new Error('Deben existir cinco preguntas de Dinero rápido.');
  return {target:Number($('#fastTargetInput').value||200),questions:rows};
}
async function saveFast(silent=false){ const data=await apiAction('fast_update',collectFast()); if(!silent) message(data.fast_money_warnings?.length?'Guardado con avisos de respuestas repetidas.':'Dinero rápido guardado.'); return data; }
async function saveTeamsAndNext(){
  try{
    const n1=$('#team1NameInput').value.trim(), n2=$('#team2NameInput').value.trim();
    if(!n1||!n2) throw new Error('Escribe el nombre de los dos equipos.');
    await apiAction('team_name',{team:0,name:n1});
    await apiAction('team_name',{team:1,name:n2});
    teamDraftDirty = false;
    lastTeamDraft = [n1, n2];
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    setStep(2); message('Equipos guardados. Prepara la primera ronda.');
  }catch(e){message(e.message,true);}
}
async function award(team){ try{await apiAction('award',{team,reason:awardReason}); setStep(5); message(`Puntos entregados a ${current.state.teams[team].name}.`);}catch(e){message(e.message,true);} }
async function addStrike(){ try{await apiAction('strike');message('Strike marcado.');}catch(e){message(e.message,true);} }
function openSheet(){ $('#toolsSheet').classList.remove('hidden'); $('#toolsSheet').setAttribute('aria-hidden','false'); }
function closeSheet(){ $('#toolsSheet').classList.add('hidden'); $('#toolsSheet').setAttribute('aria-hidden','true'); }
function openModal(id){ closeSheet(); $('#'+id).classList.remove('hidden'); }
function closeModal(id){ $('#'+id).classList.add('hidden'); }
async function showFastMoney(changeMode=true){
  try{ if(changeMode) await apiAction('screen_mode',{mode:'fast_money'}); $('#normalWizard').classList.add('hidden'); $('#fastMoneyView').classList.remove('hidden'); closeSheet(); window.scrollTo(0,0); }
  catch(e){message(e.message,true);}
}
async function hideFastMoney(){
  try{await apiAction('screen_mode',{mode:'normal'}); $('#fastMoneyView').classList.add('hidden'); $('#normalWizard').classList.remove('hidden'); setStep(uiStep);}
  catch(e){message(e.message,true);}
}

$('#pinInput').value = '19030792';
$('#loginBtn').onclick=()=>login(String($('#pinInput').value||'').trim()).catch(e=>{ $('#loginMsg').textContent=e.message;$('#loginMsg').classList.remove('hidden'); });
$('#pinInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click();});
const team1Input = $('#team1NameInput');
const team2Input = $('#team2NameInput');
[team1Input, team2Input].forEach((el, idx) => {
  if (!el) return;
  el.addEventListener('input', () => {
    teamDraftDirty = true;
    lastTeamDraft[idx] = el.value;
  });
  el.addEventListener('focus', () => {
    // Evita que el sondeo del servidor mueva el viewport o reescriba el campo con el teclado abierto.
    document.body.classList.add('keyboard-editing');
  });
  el.addEventListener('blur', () => {
    setTimeout(() => {
      if (!isFormEditing()) document.body.classList.remove('keyboard-editing');
    }, 80);
  });
});
if (team1Input) team1Input.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); team2Input?.focus(); }
});
if (team2Input) team2Input.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); team2Input.blur(); saveTeamsAndNext(); }
});

$('#saveTeamsNextBtn').onclick=saveTeamsAndNext;
$('#startDisplayBtn').onclick=async()=>{
  try{
    const n1=$('#team1NameInput').value.trim(), n2=$('#team2NameInput').value.trim();
    if (n1 && n1 !== current?.state?.teams?.[0]?.name) await apiAction('team_name',{team:0,name:n1});
    if (n2 && n2 !== current?.state?.teams?.[1]?.name) await apiAction('team_name',{team:1,name:n2});
    await apiAction('start_game_display');
    setStep(2);
    message('La TV salió de la pantalla de espera.');
  }catch(e){message(e.message,true);}
};
$('#continueGameBtn').onclick=()=>{ const st=current?.state; setStep(st?.round_awarded||st?.round_phase==='review'?5:st?.round_phase==='active'?4:st?.round_phase==='faceoff'?3:2); };
$$('[data-goto-step]').forEach(btn=>btn.onclick=()=>{ const target=Number(btn.dataset.gotoStep); const st=current?.state; if(target===3&&!['faceoff','active'].includes(st?.round_phase)){return message('Primero inicia el duelo.',true);} if(target===4&&st?.round_phase!=='active'){return message('Primero elige quién ganó el duelo.',true);} if(target===5&&!['active','review'].includes(st?.round_phase)){return message('Primero juega la ronda.',true);} if(target===1 && current && !teamDraftDirty) syncTeamDraftFromState(current.state); setStep(target); });
$('#questionSelect').onchange=e=>apiAction('set_question',{question_id:e.target.value}).then(()=>message('Pregunta preparada.')).catch(e=>message(e.message,true));
$('#startRoundBtn').onclick=()=>apiAction('start_round').then(()=>{setStep(3);message('Duelo iniciado. Pasa un participante de cada equipo.');}).catch(e=>message(e.message,true));
$('#showQuestionBtn').onclick=()=>apiAction('show_question').then(()=>message('Pregunta mostrada en la TV.')).catch(e=>message(e.message,true));
$('#faceoffMissBtn').onclick=()=>apiAction('faceoff_miss').then(()=>message('Respuesta no encontrada. No se sumó strike.')).catch(e=>message(e.message,true));
$('#faceoffAnswers').onclick=e=>{const b=e.target.closest('[data-faceoff-reveal]');if(!b)return;apiAction('reveal',{index:Number(b.dataset.faceoffReveal)}).then(()=>message('Respuesta del duelo revelada.')).catch(x=>message(x.message,true));};
async function chooseControlTeam(team){
  const btn = team===0 ? $('#faceoffTeam1Btn') : $('#faceoffTeam2Btn');
  const other = team===0 ? $('#faceoffTeam2Btn') : $('#faceoffTeam1Btn');
  try{
    if(btn) btn.disabled=true; if(other) other.disabled=true;
    await apiAction('set_control_team',{team});
    setStep(4);
    message(`Continúa la familia ${current.state.teams[team].name}.`);
  }catch(e){
    message(e.message,true);
  }finally{
    if(current?.state?.round_phase==='faceoff'){ if(btn) btn.disabled=false; if(other) other.disabled=false; }
  }
}
$('#faceoffTeam1Btn').onclick=()=>chooseControlTeam(0);
$('#faceoffTeam2Btn').onclick=()=>chooseControlTeam(1);
$('#answerControls').onclick=e=>{const b=e.target.closest('[data-reveal]');if(!b)return;apiAction('reveal',{index:Number(b.dataset.reveal)}).then(()=>message('Respuesta revelada.')).catch(x=>message(x.message,true));};
$('#strikeBtn').onclick=addStrike;
$('#clearStrikesBtn').onclick=()=>apiAction('clear_strikes').then(()=>message('Strikes limpiados.')).catch(e=>message(e.message,true));
$('#timerSet').onclick=()=>apiAction('timer_config',{seconds:Number($('#timerSeconds').value||30)}).then(()=>message('Temporizador ajustado.')).catch(e=>message(e.message,true));
$('#timerStart').onclick=()=>apiAction('timer_start').then(()=>message('Temporizador iniciado.')).catch(e=>message(e.message,true));
$('#timerPause').onclick=()=>apiAction('timer_pause').then(()=>message('Temporizador pausado.')).catch(e=>message(e.message,true));
$('#timerReset').onclick=()=>apiAction('timer_reset').then(()=>message('Temporizador reiniciado.')).catch(e=>message(e.message,true));
$('#goAwardBtn').onclick=()=>setStep(5);
$$('[data-reason]').forEach(btn=>btn.onclick=()=>{awardReason=btn.dataset.reason;$$('[data-reason]').forEach(x=>x.classList.toggle('active',x===btn));});
$('#awardTeam1').onclick=()=>award(0); $('#awardTeam2').onclick=()=>award(1);
$('#missingAnswers').onclick=e=>{const b=e.target.closest('[data-reveal]');if(!b)return;apiAction('reveal',{index:Number(b.dataset.reveal)}).then(()=>message('Respuesta faltante descubierta.')).catch(x=>message(x.message,true));};
$('#revealNextMissingBtn').onclick=async()=>{const st=current?.state,q=questionForState(current);const next=q?.answers.findIndex((_,i)=>!st.revealed.includes(i))??-1;if(next<0)return message('Ya se mostraron todas.');try{await apiAction('reveal',{index:next});message('Respuesta faltante descubierta.');}catch(e){message(e.message,true);}};
$('#nextQuestionBtn').onclick=()=>apiAction('next_question').then(()=>{setStep(2);message('Siguiente ronda preparada.');}).catch(e=>message(e.message,true));
$('#finishGameBtn').onclick=async()=>{
  if(!current?.state?.round_awarded) return message('Primero entrega los puntos de la ronda.',true);
  if(!confirm('¿Finalizar el juego y mostrar al ganador en el tablero?')) return;
  try{
    await apiAction('finish_game');
    const st=current.state;
    if(st.winner===0||st.winner===1) message(`Pantalla final mostrada: ${st.teams[st.winner].name}.`);
    else message('Pantalla final mostrada: empate.');
  }catch(e){message(e.message,true);}
};
$('#undoBtn').onclick=()=>apiAction('undo').then(()=>{const st=current.state;setStep(st.round_awarded||st.round_phase==='review'?5:st.round_phase==='active'?4:st.round_phase==='faceoff'?3:2);message('Última acción deshecha.');}).catch(e=>message(e.message,true));
$('#boardBtn').onclick=()=>window.open('/public','_blank');

$('#menuBtn').onclick=openSheet; $('#closeMenuBtn').onclick=closeSheet; $('#closeMenuX').onclick=closeSheet;
$('#menuTeams').onclick=()=>openModal('teamsModal'); $('#menuBank').onclick=()=>openModal('bankModal'); $('#menuMaintenance').onclick=()=>openModal('maintenanceModal'); $('#menuFast').onclick=()=>showFastMoney(true);
$$('[data-close-modal]').forEach(btn=>btn.onclick=()=>closeModal(btn.dataset.closeModal));
$$('.host-modal').forEach(modal=>modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.add('hidden');}));
$('#saveTeam1Edit').onclick=async()=>{try{await apiAction('team_name',{team:0,name:$('#team1EditName').value});await apiAction('score',{team:0,score:Number($('#team1ScoreInput').value||0)});message('Equipo 1 actualizado.');}catch(e){message(e.message,true);}};
$('#saveTeam2Edit').onclick=async()=>{try{await apiAction('team_name',{team:1,name:$('#team2EditName').value});await apiAction('score',{team:1,score:Number($('#team2ScoreInput').value||0)});message('Equipo 2 actualizado.');}catch(e){message(e.message,true);}};
$('#resetRoundBtn').onclick=()=>{if(confirm('¿Reiniciar la ronda actual?'))apiAction('round_reset').then(()=>{setStep(2);closeModal('maintenanceModal');message('Ronda reiniciada.');}).catch(e=>message(e.message,true));};
$('#newGameBtn').onclick=()=>{if(confirm('¿Poner los marcadores en cero? El historial de preguntas usadas se conservará.'))apiAction('new_game').then(()=>{setStep(1);closeModal('maintenanceModal');message('Nueva partida iniciada.');}).catch(e=>message(e.message,true));};
$('#resetUsageBtn').onclick=()=>{if(confirm('¿Permitir nuevamente todas las preguntas usadas?'))apiAction('reset_usage').then(()=>message('Historial reiniciado.')).catch(e=>message(e.message,true));};
$('#restoreDemoBtn').onclick=()=>{if(confirm('¿Restaurar las preguntas de ejemplo?'))apiAction('restore_demo').then(()=>message('Ejemplos restaurados.')).catch(e=>message(e.message,true));};
$('#importBtn').onclick=async()=>{const file=$('#xlsxInput').files?.[0],box=$('#importMsg');if(!file){box.textContent='Selecciona un archivo .xlsx.';box.className='notice error';return;}box.textContent='Importando…';box.className='notice';try{const r=await fetch('/api/import',{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)},body:await file.arrayBuffer()});const j=await r.json();if(!j.ok)throw new Error(j.error||'No se pudo importar.');current=j.data;render(current);box.textContent=`Importación correcta: ${j.data.imported_count} preguntas.`;box.className='notice success';message('Banco actualizado.');}catch(e){box.textContent=e.message;box.className='notice error';}};
$('#exitFastBtn').onclick=hideFastMoney;
$('#saveFastBtn').onclick=()=>saveFast(false).catch(e=>message(e.message,true));
$('#hideFastBtn').onclick=()=>apiAction('fast_hide_all').then(()=>message('Dinero rápido oculto.')).catch(e=>message(e.message,true));
$('#fastEditor').onclick=async e=>{const b=e.target.closest('[data-fast-reveal]');if(!b)return;try{await saveFast(true);const [participant,index]=b.dataset.fastReveal.split(':').map(Number);await apiAction('fast_reveal',{participant,index});message(`Respuesta P${participant} revelada.`);}catch(err){message(err.message,true);}};

const codeFromUrl=new URLSearchParams(location.search).get('code');
if(codeFromUrl)login(codeFromUrl).catch(e=>showLogin(e.message));
else if(token){$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');refresh(true);}else showLogin();
setInterval(()=>{
  if(token&&!$('#appView').classList.contains('hidden')&&!isFormEditing()) refresh(false);
},1200);
