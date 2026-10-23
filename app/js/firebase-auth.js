import { accountRequestSignal } from './api.js';

let client;
let clientProject;
async function loadFirebase(config) {
  if (!config?.apiKey || !config?.authDomain || !config?.projectId || !config?.appId) {
    throw new Error('Sign-in is not configured yet. Please contact the workspace administrator.');
  }
  if (clientProject && clientProject !== config.projectId) throw new Error('Sign-in settings changed. Reload this page to continue.');
  clientProject = config.projectId;
  client ||= Promise.all([import('firebase/app'), import('firebase/auth')]).then(([app, sdk]) => {
    const instance = app.initializeApp(config, 'morrow-managed-auth');
    const auth = sdk.initializeAuth(instance, {
      persistence: sdk.inMemoryPersistence,
      popupRedirectResolver: sdk.browserPopupRedirectResolver,
    });
    auth.useDeviceLanguage();
    return { auth, sdk };
  }).catch(error => { client = null; clientProject = null; throw error; });
  return client;
}

const messages = {
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/invalid-credential': 'The email or password is incorrect. Please try again.',
  'auth/wrong-password': 'The email or password is incorrect. Please try again.',
  'auth/user-not-found': 'The email or password is incorrect. Please try again.',
  'auth/user-disabled': 'This account is unavailable. Contact your workspace administrator.',
  'auth/weak-password': 'Choose a stronger password with at least 12 characters.',
  'auth/password-does-not-meet-requirements': 'This password does not meet the account requirements. Try a longer, unique password.',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes before trying again.',
  'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection and try again.',
  'auth/popup-blocked': 'Allow pop-ups for this website, then try Continue with Google again.',
  'auth/popup-closed-by-user': 'Google sign-in was closed. You can try again when you’re ready.',
  'auth/cancelled-popup-request': 'Another sign-in window is open. Finish that sign-in or try again.',
  'auth/account-exists-with-different-credential': 'This email uses another sign-in method. Use that method to access your account.',
  'auth/expired-action-code': 'This email link has expired. Request a new one.',
  'auth/invalid-action-code': 'This email link is invalid or has already been used. Request a new one.',
  'auth/unauthorized-domain': 'Sign-in is not enabled for this website yet. Contact the workspace administrator.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled yet. Contact the workspace administrator.',
};
const verificationMessage = 'Check your email for a verification link. Once verified, you can sign in.';
const resetMessage = 'If an eligible account exists, a password-reset link will arrive shortly.';

// Dependencies are injectable so the complete exchange can be tested without
// sending real emails, opening Google, or weakening production token validation.
export function createFirebaseFlows({ loadClient = loadFirebase, fetcher = (...args) => fetch(...args), getScope = accountRequestSignal, origin = () => location.origin } = {}) {
  let active = false;
  async function prepareFirebase(options) {
    if (options?.provider === 'firebase') await loadClient(options.firebase);
  }
  async function runFirebaseAuth(options, action, values = {}, params = new URLSearchParams()) {
    if (active) throw new Error('A sign-in request is still finishing. Please try again in a moment.');
    if (options?.provider !== 'firebase') throw new Error('Managed sign-in is not enabled. Reload this page.');
    active = true;
    const scope = getScope();
    let auth, sdk;
    const checked = async promise => { const value = await promise; scope.throwIfAborted(); return value; };
    const actionSettings = { url: origin() + '/#/login', handleCodeInApp: false };
    try {
      scope.throwIfAborted();
      ({ auth, sdk } = await checked(loadClient(options.firebase)));
      if (['signup', 'reset'].includes(action) && (typeof values.password !== 'string' || values.password.length < 12 || values.password.length > 128)) {
        throw new Error('Use a password between 12 and 128 characters.');
      }
      if (action === 'signup') {
        let credential;
        try { credential = await checked(sdk.createUserWithEmailAndPassword(auth, values.email, values.password)); }
        catch (error) { if (error.code === 'auth/email-already-in-use') return { message: 'If this email is eligible, a verification link will arrive shortly. Already have an account? Sign in or reset your password.' }; throw error; }
        await checked(sdk.updateProfile(credential.user, { displayName: values.name.trim() }));
        await checked(sdk.sendEmailVerification(credential.user, actionSettings));
        return { message: verificationMessage };
      }
      if (action === 'forgot') {
        try { await checked(sdk.sendPasswordResetEmail(auth, values.email, actionSettings)); }
        catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
        return { message: resetMessage };
      }
      if (action === 'resend') {
        const credential = await checked(sdk.signInWithEmailAndPassword(auth, values.email, values.password));
        if (credential.user.emailVerified) return { verified: true, message: 'Your email is already verified. You can sign in.' };
        await checked(sdk.sendEmailVerification(credential.user, actionSettings));
        return { message: verificationMessage };
      }
      if (action === 'verify' || action === 'reset') {
        const code = params.get('oobCode');
        if (!code) throw new Error('This link is missing its security code. Request a new email.');
        if (action === 'verify') {
          await checked(sdk.applyActionCode(auth, code));
          return { message: 'Email verified. You can now sign in.' };
        }
        await checked(sdk.verifyPasswordResetCode(auth, code));
        await checked(sdk.confirmPasswordReset(auth, code, values.password));
        return { message: 'Password updated. Sign in with your new password.' };
      }
      if (!['login', 'google'].includes(action)) throw new Error('Choose a supported sign-in method.');
      let credential;
      if (action === 'google') {
        const provider = new sdk.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        credential = await checked(sdk.signInWithPopup(auth, provider));
      } else {
        credential = await checked(sdk.signInWithEmailAndPassword(auth, values.email, values.password));
      }
      if (!credential.user.emailVerified) throw new Error('Verify your email before signing in. Use the verification link in your inbox, or request a fresh link below.');
      const idToken = await checked(credential.user.getIdToken(true));
      // Refresh the prelogin CSRF challenge after a potentially long Google popup.
      const challenge = await checked(fetcher('/api/v1/auth/options', { credentials: 'same-origin', signal: AbortSignal.any([scope, AbortSignal.timeout(20000)]) }));
      const current = await checked(challenge.json());
      if (!challenge.ok || current.provider !== 'firebase' || current.firebase?.projectId !== options.firebase.projectId || !current.csrf_token) {
        throw new Error('Sign-in settings changed or could not load. Reload this page and try again.');
      }
      const response = await checked(fetcher('/api/v1/auth/firebase/session', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': current.csrf_token },
        body: JSON.stringify({ id_token: idToken }), signal: AbortSignal.any([scope, AbortSignal.timeout(20000)]),
      }));
      const data = await checked(response.json());
      if (!response.ok) throw new Error(response.status === 409
        ? 'This email already owns a workspace. Ask the administrator to connect it before signing in with this method.'
        : typeof data.detail === 'string' ? data.detail : 'Sign-in could not finish. Please try again.');
      return { authenticated: true };
    } catch (error) {
      scope.throwIfAborted();
      if (error.name === 'AbortError') throw error;
      if (error.name === 'TimeoutError') throw new Error('Sign-in took too long. Please try again.');
      if (messages[error.code]) throw new Error(messages[error.code]);
      if (error.code?.startsWith('auth/')) throw new Error('The sign-in service could not complete this request. Please try again.');
      throw error;
    } finally {
      // The dashboard uses its own HttpOnly session. Keep no Firebase refresh
      // token in localStorage, sessionStorage, or a second persistent session.
      try { if (auth && sdk) await sdk.signOut(auth); } finally { active = false; }
    }
  }
  return { prepareFirebase, runFirebaseAuth };
}

export const { prepareFirebase, runFirebaseAuth } = createFirebaseFlows();

export function normalizeFirebaseActionLink() {
  const params = new URLSearchParams(location.search);
  const route = { verifyEmail: 'verify', resetPassword: 'reset' }[params.get('mode')];
  const code = params.get('oobCode');
  if (route && code) history.replaceState(null, '', location.pathname + '#/' + route + '?' + new URLSearchParams({ oobCode: code }));
}
