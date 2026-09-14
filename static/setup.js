let info = null;
async function loadSetup() {
  const code = new URLSearchParams(location.search).get('code') || '';
  const r = await fetch('/api/setup?code=' + encodeURIComponent(code));
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'No se pudo leer la configuración.');
  info = j.data;
  document.querySelector('#publicUrl').textContent = info.public_url;
  document.querySelector('#controlUrl').textContent = info.control_url;
  document.querySelector('#pin').textContent = info.pin;
  document.querySelector('#qr').src = '/api/qr?data=' + encodeURIComponent(info.control_url);
}
function copy(text) { navigator.clipboard?.writeText(text); }
document.querySelector('#openPublic').onclick = () => info && window.open(info.public_url, '_blank');
document.querySelector('#openControl').onclick = () => info && window.open(info.control_url, '_blank');
document.querySelector('#copyPublic').onclick = () => info && copy(info.public_url);
document.querySelector('#copyControl').onclick = () => info && copy(info.control_url);
loadSetup().catch(err => alert(err.message));
