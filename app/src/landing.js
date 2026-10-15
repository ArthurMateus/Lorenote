// Signed-out landing page + auth card, and the "set a new password" dialog for recovery links.
import { t, applyI18n, bindLangSelect } from './i18n.js';
const $ = (s, r = document) => r.querySelector(s);

export function showLanding({ backend, onGuest }) {
  const root = $('#landing'); root.hidden = false; document.body.classList.add('signed-out');
  const form = $('#auth-form'), msg = $('#auth-msg'), submit = $('#auth-submit'), pass = $('#auth-pass'), email = $('#auth-email');
  let mode = 'signin';

  const say = (text, kind = 'info') => { msg.textContent = text; msg.dataset.kind = kind; msg.hidden = !text; };
  const paintSubmit = () => { submit.textContent = t(mode === 'signin' ? 'auth.signin' : 'auth.signup'); };
  const setMode = (m) => {
    mode = m; say('');
    for (const t of document.querySelectorAll('.auth-tab')) t.classList.toggle('on', t.dataset.mode === m);
    paintSubmit();
    pass.autocomplete = m === 'signin' ? 'current-password' : 'new-password';
    $('#auth-forgot').hidden = m !== 'signin';
  };
  for (const t of document.querySelectorAll('.auth-tab')) t.onclick = () => setMode(t.dataset.mode);
  setMode('signin');

  const busy = async (fn) => {
    submit.disabled = true; say('');
    try { await fn(); } catch (err) { say(friendly(err), 'error'); } finally { submit.disabled = false; }
  };

  form.onsubmit = (ev) => {
    ev.preventDefault();
    busy(async () => {
      if (mode === 'signin') await backend.signIn(email.value.trim(), pass.value);
      else {
        if (pass.value.length < 8) throw new Error(t('auth.pwShort'));
        const { needsConfirm } = await backend.signUp(email.value.trim(), pass.value);
        if (needsConfirm) say(t('auth.checkInbox'), 'ok');
      }
    });
  };
  $('#auth-magic').onclick = () => busy(async () => { if (!email.value.trim()) throw new Error(t('auth.enterEmail')); await backend.magicLink(email.value.trim()); say(t('auth.magicSent'), 'ok'); });
  $('#auth-forgot').onclick = () => busy(async () => { if (!email.value.trim()) throw new Error(t('auth.enterEmail')); await backend.resetPassword(email.value.trim()); say(t('auth.resetSent'), 'ok'); });
  $('#auth-guest').onclick = onGuest;

  const oauth = $('#auth-oauth');
  const paintOauth = () => {
    oauth.replaceChildren();
    for (const p of backend.oauth || []) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost', textContent: t('auth.continueWith', { provider: p[0].toUpperCase() + p.slice(1) }) });
      b.onclick = () => busy(() => backend.oauthSignIn(p)); oauth.append(b);
    }
    oauth.hidden = !oauth.children.length;
  };
  paintOauth();

  // language picker + re-label the parts built in code when the language changes
  bindLangSelect($('#lang-select'));
  window.addEventListener('lang-change', () => { paintSubmit(); paintOauth(); if (!msg.hidden) say(''); });
}

function friendly(err) {
  const m = (err && err.message) || String(err);
  if (/invalid login/i.test(m)) return t('auth.err.invalid');
  if (/already registered|already been registered/i.test(m)) return t('auth.err.exists');
  if (/email not confirmed/i.test(m)) return t('auth.err.unconfirmed');
  if (/rate limit|too many/i.test(m)) return t('auth.err.rate');
  if (/provider is not enabled|unsupported provider/i.test(m)) return t('auth.err.provider');
  if (/failed to fetch|network/i.test(m)) return t('auth.err.network');
  return m;
}

export function showNewPassword(backend) {
  const d = document.createElement('dialog');
  d.innerHTML = '<form method="dialog" class="newpass"><header><h3 data-i18n="auth.newPassTitle"></h3></header><div class="body"><input type="password" id="np" minlength="8" autocomplete="new-password" data-i18n-placeholder="auth.newPassHint" required><p id="np-msg" class="auth-msg" hidden></p></div><footer><button class="btn primary" id="np-go" value="x" data-i18n="auth.newPassSave"></button></footer></form>';
  applyI18n(d); document.body.append(d); d.showModal();
  d.querySelector('#np-go').onclick = async (ev) => {
    ev.preventDefault(); const pw = d.querySelector('#np').value; const m = d.querySelector('#np-msg');
    if (pw.length < 8) { m.hidden = false; m.dataset.kind = 'error'; m.textContent = t('auth.newPassShort'); return; }
    try { await backend.updatePassword(pw); d.close(); d.remove(); history.replaceState(null, '', location.pathname); location.reload(); }
    catch (e) { m.hidden = false; m.dataset.kind = 'error'; m.textContent = friendly(e); }
  };
}
