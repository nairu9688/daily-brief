const root = document.documentElement;
const ENC = { emerald: ['#0E9F6E', '#34D399'], magenta: ['#D6336C', '#FF6FA8'], violet: ['#7C4DFF', '#A78BFA'] };
document.querySelectorAll('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  if (seg.dataset.seg === 'theme') { if (b.dataset.v === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', b.dataset.v); }
  else { const [l, d] = ENC[b.dataset.v]; root.style.setProperty('--en-l', l); root.style.setProperty('--en-d', d); }
})));

const app = document.getElementById('app'), app2 = document.getElementById('app2');
function setEd(ed) {
  document.querySelectorAll('.editions button').forEach((x) => x.setAttribute('aria-selected', x.dataset.ed === ed));
  app.dataset.ed = ed; app2.dataset.ed = ed;
  app.querySelectorAll('.edition').forEach((s) => (s.hidden = s.dataset.for !== ed));
  app2.querySelectorAll('.th').forEach((s) => (s.hidden = s.dataset.for !== ed));
  stopSpeech();
}
document.querySelectorAll('.editions button').forEach((b) => b.addEventListener('click', () => setEd(b.dataset.ed)));
document.querySelectorAll('.thread[data-open]').forEach((a) => a.addEventListener('click', () => { if (a.dataset.open) setEd(a.dataset.open); }));

document.querySelectorAll('.edition').forEach((ed) => {
  const chips = ed.querySelectorAll('.chip');
  chips.forEach((c) => c.addEventListener('click', () => {
    chips.forEach((x) => x.setAttribute('aria-pressed', x === c));
    let shown = 0;
    ed.querySelectorAll('.rub').forEach((r) => { const ok = c.dataset.rub === 'all' || r.dataset.rub === c.dataset.rub || (r.dataset.rub === 'vocab' && c.dataset.rub === 'all'); r.hidden = !ok; if (ok) shown++; });
    ed.querySelector('.empty').hidden = shown > 0;
  }));
});

document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => { const el = document.getElementById(b.dataset.toggle); el.hidden = !el.hidden; }));

document.querySelectorAll('.vocab').forEach((v) => {
  const boxes = [...v.querySelectorAll('.vchk')], btn = v.querySelector('.anki'), all = v.querySelector('.selall');
  const upd = () => { const n = boxes.filter((b) => b.checked).length; btn.disabled = n === 0; btn.textContent = n ? `Ajouter ${n} mot${n > 1 ? 's' : ''} à Anki` : 'Ajouter à Anki'; all.textContent = n === boxes.length ? 'Tout décocher' : 'Tout cocher'; };
  boxes.forEach((b) => b.addEventListener('change', upd));
  all.addEventListener('click', () => { const on = !boxes.every((b) => b.checked); boxes.forEach((b) => (b.checked = on)); upd(); });
  btn.addEventListener('click', () => { const n = boxes.filter((b) => b.checked).length; btn.textContent = `${n} mot${n > 1 ? 's' : ''} en file pour Anki ✓`; btn.disabled = true; });
});

document.querySelectorAll('.wave').forEach((w) => { let h = ''; for (let i = 0; i < 46; i++) { const v = 6 + Math.round(Math.abs(Math.sin(i * 1.7) * 14 + Math.sin(i * 0.6) * 6)); h += `<i style="height:${v}px;animation-delay:${(i % 7) * 0.08}s" class="${i < 11 ? 'on' : ''}"></i>`; } w.innerHTML = h; });
const LANG = { fr: 'fr-FR', en: 'en-US', es: 'es-ES' };
function stopSpeech() { try { speechSynthesis.cancel(); } catch (e) {} document.querySelectorAll('.player').forEach((p) => p.classList.remove('playing')); }
document.querySelectorAll('.player').forEach((p) => p.querySelector('.play').addEventListener('click', () => {
  if (p.classList.contains('playing')) { stopSpeech(); return; }
  stopSpeech();
  const sec = p.closest('.edition');
  const txt = [sec.querySelector('h1').textContent, ...[...sec.querySelectorAll('.points p')].map((x) => x.firstChild.textContent + ' ' + x.childNodes[1].textContent)].join('. ');
  try { const u = new SpeechSynthesisUtterance(txt); u.lang = LANG[p.dataset.lang]; u.rate = 1.02; u.onend = stopSpeech; speechSynthesis.speak(u); p.classList.add('playing'); } catch (e) {}
}));
