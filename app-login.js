// app-login.js — sign-in screen for the dashboard. Classic script, loaded before everything else.
//
// Nothing else is requested until sign-in succeeds: the inline loader at the bottom of index.html
// hands every app script and data file (~25 MB) to MISAuth.ready(), which holds them back.
//
// This is a front-end gate, not access control. The site is static, so anyone who knows a data
// file's URL can still download it; the gate keeps casual visitors out of the dashboard, nothing
// more. Real protection needs the data served from the backend behind a login.
(() => {
  const SESSION_KEY = 'mis_auth';   // sessionStorage: survives reloads, cleared when the tab closes

  // PBKDF2-SHA256 over "<username trimmed + lower-cased>:<password>", so the repo never holds the
  // password itself. To change the login, print a new VERIFIER from the new pair (username lower-case):
  //   python -c "import hashlib;print(hashlib.pbkdf2_hmac('sha256',b'username:password',b'<SALT>',<ITERATIONS>).hex())"
  const SALT = '7b8293cf9186aa6db5a4f4eda596d5a5';
  const ITERATIONS = 200000;
  const VERIFIER = '9bd7fe6265e346afb0b091e63c0803ed4eedfe1973ccd5d55862b601abd68cb9';

  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const waiting = [];               // callbacks queued by ready() until sign-in succeeds
  let signedIn = false;
  try{ signedIn = sessionStorage.getItem(SESSION_KEY) === '1'; }catch(e){}   // storage can be blocked
  if(signedIn) root.classList.add('authed');

  /** Hex PBKDF2 of the entered credentials. Needs WebCrypto, which browsers only offer on https or localhost. */
  async function derive(username, password){
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(`${username.trim().toLowerCase()}:${password}`), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(SALT), iterations: ITERATIONS }, key, 256);
    return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
  }

  const showError = message => { $('login-error').textContent = message; };

  function unlock(){
    signedIn = true;
    try{ sessionStorage.setItem(SESSION_KEY, '1'); }catch(e){}   // still works for this page if storage is blocked
    root.classList.add('authed');
    $('login-pass').value = '';
    waiting.splice(0).forEach(fn => fn());
  }

  async function onSubmit(e){
    e.preventDefault();
    const username = $('login-user').value, password = $('login-pass').value;
    if(!username.trim() || !password){ showError('Enter your username and password.'); return; }
    if(!(window.crypto && crypto.subtle)){
      showError('Sign-in needs a secure connection. Open the dashboard from its https:// address (or localhost) and try again.');
      return;
    }
    const button = $('login-submit');
    button.disabled = true;
    showError('');
    try{
      if(await derive(username, password) === VERIFIER){ unlock(); return; }
      showError('Incorrect username or password.');   // same message for either field, so neither is confirmed
      $('login-pass').value = '';
      $('login-pass').focus();
    }catch(err){
      showError('Could not check the sign-in: ' + err.message);
    }finally{
      button.disabled = false;
    }
  }

  // A reload drops every loaded script and all app state, so it is the cleanest way to sign out.
  function signOut(){
    try{ sessionStorage.removeItem(SESSION_KEY); }catch(e){}
    try{ sessionStorage.removeItem('ld_auth'); }catch(e){}   // the L&D Dashboard tab's own unlock (app-ld.js LD_LOCK)
    location.reload();
  }

  $('login-form').addEventListener('submit', onSubmit);
  const signOutButton = $('signout-btn');
  if(signOutButton) signOutButton.addEventListener('click', signOut);
  if(!signedIn) $('login-user').focus();

  window.MISAuth = Object.freeze({
    /** Run fn now if already signed in, otherwise the moment sign-in succeeds. */
    ready(fn){ signedIn ? fn() : waiting.push(fn); },
    signOut,
  });
})();
