let lastEventId = 0;
let knownRevealed = new Set();
let currentQuestionId = null;
let audioEnabled = false;
let overlayTimer = null;

const $ = s => document.querySelector(s);
const sounds = {
  round_start: $('#soundRoundStart'),
  reveal: $('#soundCorrect'),
  fast_reveal: $('#soundCorrect'),
  strike: $('#soundError'),
  award: $('#soundVictory'),
  timer_timeout: $('#soundTimeout')
};

function play(kind) {
  if (!audioEnabled || !sounds[kind]) return;
  const a = sounds[kind];
  try { a.currentTime = 0; a.play().catch(() => {}); } catch (_) {}
}

$('#activateBtn').onclick = async () => {
  audioEnabled = true;
  for (const a of Object.values(sounds)) {
    try { a.volume = 0.001; await a.play(); a.pause(); a.currentTime = 0; a.volume = 1; } catch (_) {}
  }
  $('#activation').classList.add('hidden');
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch (_) {}
};

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

function eventText(e, state) {
  if (e.type === 'award') {
    const name = state.teams[e.team]?.name || `Equipo ${e.team + 1}`;
    return `${String(e.reason || 'Ronda').toUpperCase()}: ${name} +${e.points}`;
  }
  if (e.type === 'control_team') { const name = state.teams[e.team]?.name || `Equipo ${e.team + 1}`; return `CONTINÚA: ${name}`; }
  if (e.type === 'undo') return 'ACCIÓN DESHECHA';
  if (e.type === 'timer_timeout') return 'TIEMPO AGOTADO';
  return '';
}

function handleEvents(events, state) {
  const fresh = (events || []).filter(e => e.id > lastEventId).sort((a,b) => a.id - b.id);
  for (const e of fresh) {
    play(e.type);
    if (e.type === 'strike') showStrike(e.count);
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
  $('#questionText').textContent = s.question?.text || 'Selecciona una pregunta desde el control';
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

function render(s) {
  $('#team1Name').textContent = s.teams[0].name;
  $('#team2Name').textContent = s.teams[1].name;
  $('#team1Score').textContent = s.teams[0].score;
  $('#team2Score').textContent = s.teams[1].score;
  $('#roundTotal').textContent = s.round_points;
  $('#multiplier').textContent = `×${s.multiplier}`;
  const remaining = Number(s.timer.remaining || 0);
  $('#timer').textContent = remaining;
  $('#timer').classList.toggle('danger', remaining <= 5 && s.timer.running);
  $('#strikes').innerHTML = [1,2,3].map(i => `<div class="strike-small ${s.errors >= i ? 'active' : ''}">X</div>`).join('');
  const isFast = s.screen_mode === 'fast_money';
  $('#strikes').style.visibility = isFast ? 'hidden' : 'visible';
  document.querySelector('.round-total').style.visibility = isFast ? 'hidden' : 'visible';
  $('#multiplier').style.visibility = isFast ? 'hidden' : 'visible';
  renderNormal(s);
  renderFast(s);
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
poll();
