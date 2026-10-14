// Signed-out landing page + auth card, and the "set a new password" dialog for recovery links.
const $ = (s, r = document) => r.querySelector(s);

export function showLanding({ backend, onGuest }) {
  const root = $('#landing'); root.hidden = false; document.body.classList.add('signed-out');
  const form = $('#auth-form'), msg = $('#auth-msg'), submit = $('#auth-submit'), pass = $('#auth-pass'), email = $('#auth-email');
  let mode = 'signin';

  const say = (text, kind = 'info') => { msg.textContent = text; msg.dataset.kind = kind; msg.hidden = !text; };
  const setMode = (m) => {
    mode = m; say('');
    for (const t of document.querySelectorAll('.auth-tab')) t.classList.toggle('on', t.dataset.mode === m);
    submit.textContent = m === 'signin' ? 'Sign in' : 'Create account';
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
        if (pass.value.length < 8) throw new Error('Use at least 8 characters for the password.');
        const { needsConfirm } = await backend.signUp(email.value.trim(), pass.value);
        if (needsConfirm) say('Almost there: check your inbox and confirm your email, then sign in.', 'ok');
      }
    });
  };
  $('#auth-magic').onclick = () => busy(async () => { if (!email.value.trim()) throw new Error('Enter your email first.'); await backend.magicLink(email.value.trim()); say('Magic link sent. Open it on this device.', 'ok'); });
  $('#auth-forgot').onclick = () => busy(async () => { if (!email.value.trim()) throw new Error('Enter your email first.'); await backend.resetPassword(email.value.trim()); say('If that address has an account, a reset link is on its way.', 'ok'); });
  $('#auth-guest').onclick = onGuest;

  const oauth = $('#auth-oauth'); oauth.replaceChildren();
  for (const p of backend.oauth || []) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost', textContent: `Continue with ${p[0].toUpperCase() + p.slice(1)}` });
    b.onclick = () => busy(() => backend.oauthSignIn(p)); oauth.append(b);
  }
  oauth.hidden = !oauth.children.length;
}

function friendly(err) {
  const m = (err && err.message) || String(err);
  if (/invalid login/i.test(m)) return 'That email and password do not match.';
  if (/already registered|already been registered/i.test(m)) return 'That email already has an account. Try signing in.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first (check your inbox).';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/provider is not enabled|unsupported provider/i.test(m)) return 'That sign-in method is not switched on yet. Use email for now.';
  if (/failed to fetch|network/i.test(m)) return 'Cannot reach the server. Check your connection.';
  return m;
}

export function showNewPassword(backend) {
  const d = document.createElement('dialog');
  d.innerHTML = '<form method="dialog" class="newpass"><header><h3>Choose a new password</h3></header><div class="body"><input type="password" id="np" minlength="8" autocomplete="new-password" placeholder="New password (8+ characters)" required><p id="np-msg" class="auth-msg" hidden></p></div><footer><button class="btn primary" id="np-go" value="x">Save password</button></footer></form>';
  document.body.append(d); d.showModal();
  d.querySelector('#np-go').onclick = async (ev) => {
    ev.preventDefault(); const pw = d.querySelector('#np').value; const m = d.querySelector('#np-msg');
    if (pw.length < 8) { m.hidden = false; m.dataset.kind = 'error'; m.textContent = 'Use at least 8 characters.'; return; }
    try { await backend.updatePassword(pw); d.close(); d.remove(); history.replaceState(null, '', location.pathname); location.reload(); }
    catch (e) { m.hidden = false; m.dataset.kind = 'error'; m.textContent = friendly(e); }
  };
}
