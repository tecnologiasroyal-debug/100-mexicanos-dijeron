let lastEventId = 0;
let knownRevealed = new Set();
let currentQuestionId = null;
let audioEnabled = false;
let tvAudioReady = false;
let overlayTimer = null;

const $ = s => document.querySelector(s);
const sounds = {
  round_start: $('#soundRoundStart'),
  reveal: $('#soundCorrect'),
  fast_reveal: $('#soundCorrect'),
  strike: $('#soundError'),
  faceoff_miss: $('#soundError'),
  award: $('#soundVictory'),
  timer_timeout: $('#soundTimeout'),
  game_finished: $('#soundVictory')
};

async function reportTvReady(ready) {
  try {
    await fetch('/api/public/ready', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ready:Boolean(ready)}),
      cache:'no-store'
    });
  } catch (_) {}
}

function updateAudioGate(started) {
  const gate = document.getElementById('audioGate');
  const introBtn = document.getElementById('tvReadyBtn');
  const msg = document.getElementById('tvReadyMsg');
  if (gate) gate.classList.toggle('hidden', !started || tvAudioReady);
  if (introBtn) {
    introBtn.disabled = tvAudioReady;
    introBtn.textContent = tvAudioReady ? 'TV LISTA ✓ · SONIDO ACTIVADO' : 'TV LISTA · ACTIVAR SONIDO';
  }
  if (msg) msg.textContent = tvAudioReady ? 'Sonido activado. Ya puedes controlar todo desde el celular.' : 'Pulsa una vez para habilitar los sonidos del juego en esta TV.';
}

async function unlockTvAudio() {
  const unique = [...new Set(Object.values(sounds).filter(Boolean))];
  for (const a of unique) {
    try {
      const oldVol = a.volume;
      a.volume = 0.001;
      a.currentTime = 0;
      const p = a.play();
      if (p && typeof p.then === 'function') await p;
      a.pause();
      a.currentTime = 0;
      a.volume = oldVol;
    } catch (_) {}
  }
  audioEnabled = true;
  tvAudioReady = true;
  updateAudioGate(Boolean(window.__lastPublicStarted));
  await reportTvReady(true);
}

function play(kind) {
  if (!audioEnabled || !sounds[kind]) return;
  const a = sounds[kind];
  try { a.currentTime = 0; a.play().catch(() => { /* El navegador puede bloquear autoplay con sonido sin gesto local. */ }); } catch (_) {}
}

function esc(t) {
  return String(t ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function showStrike(count) {
  const n = Math.max(1, Math.min(3, Number(count || 1)));
  $('#overlayXs').innerHTML = Array.from({length:n}, () => '<div class="x">X</div>').join('');
  $('#strikeOverlay').classList.add('show');
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => $('#strikeOverlay').classList.remove('show'), 1350);
}

function showMiss() {
  const el = $('#missOverlay');
  if (!el) return;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

function renderWinner(s) {
  const overlay = $('#winnerOverlay');
  if (!overlay) return;
  const active = Boolean(s.game_over);
  overlay.classList.toggle('show', active);
  if (!active) return;
  const scores = (s.teams || []).map(t => Number(t.score || 0));
  if (s.winner === 0 || s.winner === 1) {
    const w = s.teams[s.winner];
    $('#winnerKicker').textContent = '¡FELICIDADES!';
    $('#winnerName').textContent = w?.name || '';
    $('#winnerScore').textContent = String(w?.score ?? 0);
  } else {
    $('#winnerKicker').textContent = 'EMPATE';
    $('#winnerName').textContent = `${s.teams?.[0]?.name || ''} · ${s.teams?.[1]?.name || ''}`;
    $('#winnerScore').textContent = String(scores[0] ?? 0);
  }
}

function eventText(e, state) {
  if (e.type === 'award') {
    const name = state.teams[e.team]?.name || `Equipo ${e.team + 1}`;
    return `${String(e.reason || 'Ronda').toUpperCase()}: ${name} +${e.points}`;
  }
  if (e.type === 'control_team') { const name = state.teams[e.team]?.name || `Equipo ${e.team + 1}`; return `CONTINÚA: ${name}`; }
  if (e.type === 'undo') return 'ACCIÓN DESHECHA';
  if (e.type === 'timer_timeout') return 'TIEMPO AGOTADO';
  if (e.type === 'faceoff_miss') return 'RESPUESTA NO ENCONTRADA';
  return '';
}

function handleEvents(events, state) {
  const fresh = (events || []).filter(e => e.id > lastEventId).sort((a,b) => a.id - b.id);
  for (const e of fresh) {
    play(e.type);
    if (e.type === 'strike') showStrike(e.count);
    if (e.type === 'faceoff_miss') showMiss();
    const txt = eventText(e, state);
    if (txt) {
      $('#eventBanner').textContent = txt;
      setTimeout(() => { if ($('#eventBanner').textContent === txt) $('#eventBanner').textContent = ''; }, 2600);
    }
    lastEventId = Math.max(lastEventId, e.id);
  }
}

function renderNormal(s) {
  $('#normalBoard').classList.toggle('hidden', s.screen_mode !== 'normal');
  $('#fastBoard').classList.toggle('active', s.screen_mode === 'fast_money');
  if (s.screen_mode !== 'normal') return;

  const qid = s.question?.id || null;
  if (qid !== currentQuestionId) {
    currentQuestionId = qid;
    knownRevealed = new Set();
  }
  const qVisible = Boolean(s.question_visible);
  $('#questionText').textContent = qVisible ? (s.question?.text || '') : '';
  $('#questionText').classList.toggle('question-hidden-tv', !qVisible);
  const grid = $('#answersGrid');
  const newRevealed = [];
  grid.innerHTML = (s.answers || []).map((a, i) => {
    const isNew = a.revealed && !knownRevealed.has(i);
    if (a.revealed) newRevealed.push(i);
    return `<div class="answer-card ${a.revealed ? '' : 'hidden-answer'} ${isNew ? 'reveal-now' : ''}">
      <div class="num">${i+1}</div>
      <div class="answer-text">${a.revealed ? esc(a.text) : ''}</div>
      <div class="answer-points">${a.revealed ? esc(a.points) : ''}</div>
    </div>`;
  }).join('');
  newRevealed.forEach(i => knownRevealed.add(i));
}

function renderFastParticipant(rows, participant, targetEl) {
  targetEl.innerHTML = rows.map((row, i) => {
    const d = row[`p${participant}`];
    return `<div class="fast-row">
      <div class="fast-q">${i+1}. ${esc(row.question)}</div>
      <div class="fast-a ${d.revealed ? '' : 'hidden-fast'}">${d.revealed ? esc(d.answer || '—') : '••••••'}</div>
      <div class="fast-p ${d.revealed ? '' : 'hidden-fast'}">${d.revealed ? esc(d.points) : '—'}</div>
    </div>`;
  }).join('');
}

function renderFast(s) {
  if (s.screen_mode !== 'fast_money') return;
  $('#questionText').textContent = 'DINERO RÁPIDO';
  const fm = s.fast_money;
  renderFastParticipant(fm.questions, 1, $('#fastP1'));
  renderFastParticipant(fm.questions, 2, $('#fastP2'));
  $('#fastP1Total').textContent = fm.totals.p1;
  $('#fastP2Total').textContent = fm.totals.p2;
  $('#fastCombined').textContent = fm.totals.combined;
  $('#fastTarget').textContent = fm.target;
}

function toggleIntro(started) {
  window.__lastPublicStarted = Boolean(started);
  const intro = document.getElementById('introOverlay');
  const board = document.getElementById('boardShell');
  if (intro) intro.classList.toggle('show', !started);
  if (board) board.classList.toggle('hidden', !started);
  updateAudioGate(Boolean(started));
}

function render(s) {
  const started = Boolean(s.public_started);
  toggleIntro(started);
  if (!started) {
    const winner = document.getElementById('winnerOverlay');
    if (winner) winner.classList.remove('show');
    return;
  }
  $('#team1Name').textContent = s.teams[0].name;
  $('#team2Name').textContent = s.teams[1].name;
  $('#team1Score').textContent = s.teams[0].score;
  $('#team2Score').textContent = s.teams[1].score;
  $('#roundTotal').textContent = s.round_points;
  $('#multiplier').textContent = `×${s.multiplier}`;
  const m = Number(s.multiplier || 1);
  $('#multiplier').classList.toggle('double', m === 2);
  $('#multiplier').classList.toggle('triple', m === 3);
  $('#multiplierLabel').textContent = m === 2 ? 'PUNTOS AL DOBLE' : m === 3 ? 'PUNTOS AL TRIPLE' : 'RONDA NORMAL';
  $('#multiplierLabel').classList.toggle('hot', m > 1);
  $('#strikes').innerHTML = [1,2,3].map(i => `<div class="strike-small ${s.errors >= i ? 'active' : ''}">X</div>`).join('');
  const isFast = s.screen_mode === 'fast_money';
  $('#strikes').style.visibility = isFast ? 'hidden' : 'visible';
  document.querySelector('.round-total').style.visibility = isFast ? 'hidden' : 'visible';
  $('#multiplier').style.visibility = isFast ? 'hidden' : 'visible';
  renderNormal(s);
  renderFast(s);
  renderWinner(s);
  handleEvents(s.events, s);
}

async function poll() {
  try {
    const r = await fetch('/api/public/state', {cache:'no-store'});
    const j = await r.json();
    if (j.ok) render(j.data);
  } catch (_) {}
  setTimeout(poll, 250);
}
document.getElementById('tvReadyBtn')?.addEventListener('click', unlockTvAudio);
document.getElementById('audioGateBtn')?.addEventListener('click', unlockTvAudio);
// Cada carga nueva requiere un gesto del usuario para garantizar audio en navegadores modernos.
reportTvReady(false);
poll();
