import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { icon } from '../icons.js';
import { avatar, workspaceAvatar } from '../components/identity.js';
import { loadingState } from '../components/panel.js';
import { accountRequestSignal } from '../api.js';
import { prepareFirebase, runFirebaseAuth } from '../firebase-auth.js';
import { openRazorpayCheckout, stripeDestination, waitForBilling } from '../billing-checkout.js';
import markUrl from '../../assets/morrow-mark.svg';
import googleMarkUrl from '../../assets/google-g.png';

// Account screens belong to the existing dashboard. Shared styling stays in
// tokens/forms/components; this view never mounts another app or navigation.
export const AUTH_PAGES = ['login', 'signup', 'forgot', 'reset', 'verify', 'resend'];
const MODULE_NAMES = {
  profile: 'My profile', applications: 'Applications', files: 'Private files',
  resumes: 'Resume studio', research: 'Research', learning: 'Learning',
  automations: 'Automations', outreach: 'Outreach', analytics: 'Insights',
};
const CORE_MODULES = ['profile', 'applications', 'files'];
const MODULE_ART = { profile: 40, applications: 27, files: 26, resumes: 43, research: 25, learning: 30, automations: 28, outreach: 44, analytics: 45 };
const MODULE_DETAILS = {
  profile: { icon: 'person', route: 'files/profile', description: 'Your experience, skills, and preferences.' },
  applications: { icon: 'file', route: 'records', description: 'Keep every opportunity in view.' },
  files: { icon: 'folder', route: 'data', description: 'Your documents, together and private.' },
  resumes: { icon: 'file', route: 'resume', description: 'Prepare documents for your next role.' },
  research: { icon: 'book', route: 'research', description: 'Explore companies and opportunities.' },
  learning: { icon: 'book', route: 'study', description: 'Build your interview preparation.' },
  automations: { icon: 'bot', route: 'bots', description: 'Organize your application workflows.' },
  outreach: { icon: 'send', route: 'outreach', description: 'Prepare thoughtful recruiter messages.' },
  analytics: { icon: 'chart', route: 'analytics', description: 'Understand your search over time.' },
};
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
const csrf = () => document.cookie.split('; ').find(value => value.startsWith('morrow_csrf='))?.split('=')[1] || '';

async function request(path, { body, method, reason, signal } = {}) {
  const scope = accountRequestSignal();
  scope.throwIfAborted();
  const response = await fetch('/api/v1' + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin', signal: AbortSignal.any([scope, signal, AbortSignal.timeout(20000)].filter(Boolean)),
    headers: {
      'X-CSRF-Token': csrf(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(reason ? { 'X-Admin-Reason': reason } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  scope.throwIfAborted();
  let data = {};
  if (response.status !== 204) {
    try { data = await response.json(); }
    catch { scope.throwIfAborted(); throw new Error('The account service did not respond. Please try again.'); }
  }
  scope.throwIfAborted();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('account-expired'));
    const detail = data.detail;
    const message = typeof detail === 'string' ? detail : Array.isArray(detail)
      ? detail.map(item => item.msg).join('. ') : detail?.message || 'This request could not be completed.';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}
const adminRequest = (path, reason, body, method) => request('/admin' + path, { reason, body, method });

function Icon({ name, className = '' }) {
  const host = useRef(null);
  useLayoutEffect(() => { host.current.replaceChildren(icon(name)); }, [name]);
  return <span ref={host} className={'account-icon ' + className} aria-hidden="true" />;
}
function Avatar({ index, className = '' }) {
  const host = useRef(null);
  useLayoutEffect(() => { host.current.replaceChildren(avatar(index)); }, [index]);
  return <span ref={host} className={className} aria-hidden="true" />;
}
function GoogleMark() {
  // Official Google Identity branding asset, bundled so sign-in does not depend on another request origin.
  return <img className="account-google-mark" src={googleMarkUrl} width="20" height="20" alt="" />;
}
function Button({ busy, secondary = false, children, className = '', ...props }) {
  return <button {...props} disabled={busy || props.disabled} aria-busy={busy || undefined}
    className={`btn ${secondary ? '' : 'btn-primary'} ${className}`}>
    {busy && <Icon name="refresh" className="account-spinner" />}{children}
  </button>;
}
function Notice({ error = false, children }) {
  const content = React.Children.toArray(children).filter(child => typeof child !== 'string' || child.trim());
  return content.length ? <div className={`account-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>
    <Icon name={error ? 'alert-triangle' : 'check'} /><div>{content}</div>
  </div> : null;
}
function Field({ label, id, hint, type = 'text', ...props }) {
  return <div className="field"><label className="field-label" htmlFor={id}>{label}</label>
    <input {...props} className="input" id={id} type={type} aria-describedby={hint ? id + '-hint' : undefined} />
    {hint && <span className="field-hint" id={id + '-hint'}>{hint}</span>}
  </div>;
}
function Password({ label = 'Password', isNew = false, error = '', onValidate }) {
  const [visible, setVisible] = useState(false), [value, setValue] = useState(''), [capsLock, setCapsLock] = useState(false);
  const length = value.length, lengthStep = length >= 16 ? 3 : length >= 12 ? 2 : length ? 1 : 0;
  const describedBy = [isNew && 'account-password-hint', error && 'account-password-error', capsLock && 'account-caps-lock'].filter(Boolean).join(' ') || undefined;
  return <div className="field"><label className="field-label" htmlFor="account-password">{label}</label>
    <div className="account-password"><input className="input" name="password" id="account-password"
      type={visible ? 'text' : 'password'} minLength={isNew ? 12 : 1} maxLength={128}
      autoComplete={isNew ? 'new-password' : 'current-password'} required aria-describedby={describedBy} aria-invalid={Boolean(error)}
      onChange={event => { setValue(event.target.value); if (error) onValidate?.(event.target); }}
      onBlur={event => { setCapsLock(false); onValidate?.(event.target); }}
      onKeyUp={event => setCapsLock(Boolean(event.getModifierState('CapsLock')))} />
      <button className="icon-btn" type="button" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}
        onClick={() => setVisible(value => !value)}><Icon name={visible ? 'eye-off' : 'eye'} /></button>
    </div>{error && <span className="account-inline-error" id="account-password-error">{error}</span>}
    {capsLock && <span className="account-caps-lock" id="account-caps-lock">Caps Lock is on.</span>}
    {isNew && <div className="account-password-guide" id="account-password-hint"><div className="account-password-meter" aria-hidden="true">{[1, 2, 3].map(step => <span key={step} data-filled={lengthStep >= step} data-level={lengthStep} />)}</div><div><span>{length >= 16 ? 'A longer password — good choice.' : length >= 12 ? 'Minimum length met.' : 'Use at least 12 characters.'}</span><span>{length < 12 ? `${length}/12` : `${length} characters`}</span></div><p>A unique passphrase or password manager works well.</p></div>}
  </div>;
}

function AuthField({ label, id, error, onValidate, ...props }) {
  const [valid, setValid] = useState(false);
  return <div className="field"><label className="field-label" htmlFor={id}>{label}</label><div className="account-auth-input">
    <input {...props} id={id} className="input" aria-invalid={Boolean(error)} aria-describedby={error ? id + '-error' : undefined}
      onBlur={event => { onValidate(event.target); setValid(Boolean(event.target.value && event.target.validity.valid)); }}
      onChange={event => { setValid(false); if (error) onValidate(event.target); }} />
    {valid && !error && <Icon name="check" className="account-input-check" />}
  </div>{error && <span className="account-inline-error" id={id + '-error'}>{error}</span>}</div>;
}

function AuthScene() {
  return <section className="account-auth-intro" aria-label="Your Morrow workspace">
    <div className="account-auth-kicker"><span className="account-kicker-mark" />A LITTLE SPACE FOR BIG PLANS</div>
    <h2>Your career.<br /><span>A clearer view.</span></h2>
    <p>Bring your profile, applications, and career tools into one personal workspace.</p>
    <div className="account-welcome-art" aria-hidden="true">
      <span className="account-welcome-orbit" /><span className="account-welcome-orbit is-inner" />
      <Avatar index={12} className="account-scene-hero" />
      <div className="account-art-label is-profile"><Avatar index={43} className="account-art-emblem" /><span>Your story,<br /><strong>ready to share.</strong></span></div>
      <div className="account-art-label is-progress"><span className="account-art-check"><Icon name="check" /></span><span>Your next step,<br /><strong>in one place.</strong></span></div>
      <span className="account-art-satellite" />
    </div>
    <div className="account-welcome-tools">{[['person', 'Your profile', 'The story so far'], ['file', 'Applications', 'Every next step'], ['folder', 'Private files', 'Always together']].map(([glyph, title, detail]) => <div key={title}><Icon name={glyph} /><strong>{title}</strong><span>{detail}</span></div>)}</div>
    <p className="account-auth-promise"><Icon name="check" />Start free. No payment details needed.</p>
  </section>;
}
function PageHead({ title, description, children }) {
  return <header className="page-head"><div><p className="eyebrow">YOUR WORKSPACE</p>
    <h1>{title}</h1><p className="lead">{description}</p></div>{children}</header>;
}
function PanelHead({ title, description, children }) {
  return <div className="panel-head"><div><h2 className="panel-title">{title}</h2>
    {description && <p className="panel-sub">{description}</p>}</div>{children}</div>;
}
function Loading({ label = 'Loading your account…' }) {
  const host = useRef(null);
  useLayoutEffect(() => { host.current.replaceChildren(loadingState(label, { compact: true })); }, [label]);
  return <div className="account-loading" ref={host} />;
}
function Money({ plan }) {
  return <>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: plan.currency, maximumFractionDigits: 0 }).format(plan.monthly_amount / 100)}</>;
}

function Auth({ page, onAuthenticated }) {
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [options, setOptions] = useState(null), [optionsError, setOptionsError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({}), [submittedEmail, setSubmittedEmail] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const successHeading = useRef(null);
  const params = hashParams(), isSignup = page.name === 'signup', forgot = page.name === 'forgot';
  const reset = page.name === 'reset', verify = page.name === 'verify', resend = page.name === 'resend';
  const recovery = forgot || reset || verify || resend;
  const managed = options?.provider === 'firebase';
  const hasSuccess = Boolean(message && (isSignup || recovery));
  const complete = reset || verify || emailVerified;
  const title = isSignup ? 'Create your account.' : forgot ? 'Reset your password.' : reset ? 'Choose a new password.' : verify ? 'Verify your email.' : resend ? 'A fresh verification link.' : 'Welcome back.';
  const description = isSignup ? 'Create your Morrow account and keep your career workspace in one place.'
    : forgot ? 'Enter your account email. We’ll send you a secure reset link.'
      : reset ? 'Choose a strong password to get back to your workspace.'
        : verify ? 'Confirm this email address to finish setting up your account.'
          : resend ? 'Enter your email to request another verification link.'
            : 'Sign in to pick up where you left off.';
  async function loadOptions() {
    setOptions(null); setOptionsError('');
    const scope = accountRequestSignal();
    try {
      const result = await request('/auth/options');
      if (result.provider === 'firebase') await prepareFirebase(result);
      scope.throwIfAborted(); setOptions(result);
    } catch (err) { if (err.name !== 'AbortError') setOptionsError('Sign-in options could not load. Please try again.'); }
  }
  useEffect(() => { loadOptions(); }, []);
  useEffect(() => { if (hasSuccess) successHeading.current?.focus({ preventScroll: true }); }, [hasSuccess]);
  useEffect(() => {
    const providerError = hashParams().get('error');
    setError(providerError === 'use_email' ? 'This email already has an account. Sign in with your password.'
      : providerError ? 'Google sign-in could not finish. Please try again.' : '');
    setMessage(''); setFieldErrors({}); setSubmittedEmail(''); setEmailVerified(false);
  }, [page.name, page.arg]);
  function validationMessage(input) {
    if (input.required && !(input.name === 'password' ? input.value : input.value.trim())) return input.name === 'name' ? 'Enter your name.' : input.name === 'email' ? 'Enter your email address.' : 'Enter your password.';
    if (input.type === 'email' && input.validity.typeMismatch) return 'Enter a valid email, like you@example.com.';
    if (input.name === 'password' && input.value.length < input.minLength) return `Use at least ${input.minLength} characters.`;
    return input.validity.valid ? '' : input.validationMessage;
  }
  function validateField(input) {
    setFieldErrors(previous => ({ ...previous, [input.name]: validationMessage(input) }));
  }
  async function authenticated() { await onAuthenticated?.(); }
  async function google() {
    if (!options) { setError('Sign-in options are not ready. Please retry loading them.'); return; }
    setBusy('google'); setError('');
    if (!managed) { location.assign('/api/v1/auth/google/start'); return; }
    try { const result = await runFirebaseAuth(options, 'google'); if (result.authenticated) await authenticated(); else if (result.message) setMessage(result.message); }
    catch (err) { if (err.name !== 'AbortError') setError(err.message); }
    finally { setBusy(''); }
  }
  async function submit(event) {
    event.preventDefault();
    if (!options) { setError('Sign-in options are not ready. Please retry loading them.'); return; }
    const fields = [...event.currentTarget.elements].filter(input => ['name', 'email', 'password'].includes(input.name));
    const invalid = fields.filter(input => validationMessage(input));
    setFieldErrors(Object.fromEntries(fields.map(input => [input.name, validationMessage(input)])));
    if (invalid.length) { setError('Check the highlighted fields and try again.'); invalid[0].focus(); return; }
    setBusy('email'); setError(''); setMessage(''); setEmailVerified(false);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (values.email) values.email = values.email.trim();
    setSubmittedEmail(values.email || '');
    try {
      if (managed) {
        const result = await runFirebaseAuth(options, page.name, values, params);
        if (result.authenticated) await authenticated(); else { setEmailVerified(Boolean(result.verified)); setMessage(result.message); }
      } else if (isSignup) {
        await request('/auth/register', { body: values });
        setMessage('Check your email for a verification link. Once verified, you can sign in.');
      } else if (forgot || resend) {
        const result = await request(forgot ? '/auth/forgot-password' : '/auth/resend-verification', { body: values });
        setMessage(result.message);
      } else if (reset || verify) {
        const result = await request(reset ? '/auth/reset-password' : '/auth/verify', { body: { ...values, token: params.get('token') || '' } });
        setMessage(result.message);
      } else {
        await request('/auth/login', { body: values });
        await authenticated();
      }
    } catch (err) { if (err.name !== 'AbortError') setError(err.message); }
    finally { setBusy(''); }
  }
  return <div className="account-auth">
    <div className="account-auth-brand"><a href="#/login"><img src={markUrl} width="40" height="40" alt="" /><span>morrow</span></a>
      <span className="account-auth-context">Your career workspace</span>
    </div>
    <div className="account-auth-grid">
      <AuthScene />
      <section className="account-auth-panel" aria-labelledby="account-auth-title">
        {!recovery && <nav className="account-access-tabs" aria-label="Account access"><a href="#/login" aria-current={!isSignup ? 'page' : undefined}>Sign in</a><a href="#/signup" aria-current={isSignup ? 'page' : undefined}>Create account</a></nav>}
        {recovery && !hasSuccess && <a className="account-recovery-back" href="#/login"><Icon name="chevron-left" /> Back to sign in</a>}
        {!hasSuccess && <><div className="account-auth-heading"><div><p className="account-form-eyebrow">{recovery ? 'LET’S GET YOU BACK IN' : isSignup ? 'YOUR WORKSPACE STARTS HERE' : 'YOUR WORKSPACE IS WAITING'}</p><h1 id="account-auth-title">{title}</h1></div><Avatar index={isSignup ? 38 : recovery ? 35 : 32} className="account-form-character" /></div><p className="account-auth-description">{description}</p></>}
        {!recovery && !hasSuccess && <><Button secondary type="button" className="account-wide account-google" busy={busy === 'google'} disabled={!options?.google || Boolean(busy)}
          onClick={google}><GoogleMark />Continue with Google</Button>
          {options && !options.google && <p className="field-hint account-provider-note">Google sign-in is unavailable. Continue with email.</p>}
          <div className="account-divider"><span>or use your email</span></div></>}
        {optionsError && <Notice error>{optionsError} <button type="button" className="account-text-button" onClick={loadOptions}>Retry</button></Notice>}
        <Notice error>{error}</Notice>
        {hasSuccess ? <div className="account-auth-success" role="status"><div className="account-success-art"><Avatar index={complete ? 46 : 38} className="account-success-character" /><span><Icon name="check" /></span></div>
          <p className="account-form-eyebrow">{complete ? 'YOU’RE ALL SET' : 'ONE STEP CLOSER'}</p><h1 id="account-auth-title" ref={successHeading} tabIndex={-1}>{reset ? 'Password updated.' : verify || emailVerified ? 'Email verified.' : 'Check your inbox.'}</h1><p>{message}</p>
          {submittedEmail && <div className="account-email-receipt"><Icon name="send" /><span>{submittedEmail}</span></div>}
          {!complete && <div className="account-email-next"><strong>What happens next?</strong><p>Open the email and follow its secure link. Check your spam folder if you don’t see it.</p></div>}
          <a className="btn btn-primary account-wide" href="#/login">Back to sign in <Icon name="chevron-right" /></a>
          {!complete && <div className="account-success-actions"><a href={forgot ? '#/forgot' : '#/resend'} onClick={() => setMessage('')}>Request another link</a><button type="button" onClick={() => { setMessage(''); setSubmittedEmail(''); }}>Use another email</button></div>}
        </div> : (verify || reset) && !params.get('token') && !params.get('oobCode') ? <Notice error>This link is missing its security token. <a href={verify ? '#/resend' : '#/forgot'}>Request a new link</a>.</Notice>
          : <form onSubmit={submit} key={page.name} noValidate>
            <fieldset disabled={Boolean(busy)} className="account-fieldset">
              {isSignup && <AuthField label="Your name" id="account-name" name="name" autoComplete="name" placeholder="Your full name" maxLength={100} required error={fieldErrors.name} onValidate={validateField} />}
              {!reset && !verify && <AuthField label="Email address" id="account-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required error={fieldErrors.email} onValidate={validateField} />}
              {(!forgot && !resend && !verify || resend && managed) && <Password label={reset ? 'New password' : 'Password'} isNew={isSignup || reset} error={fieldErrors.password} onValidate={validateField} />}
              {resend && managed && <p className="account-auth-small">Enter your password to request a new verification email.</p>}
              {!recovery && !isSignup && <div className="account-forgot"><a href="#/forgot">Forgot password?</a></div>}
              {!options && !optionsError && <p className="account-auth-small" role="status">Preparing secure sign-in…</p>}
              <Button busy={busy === 'email'} disabled={!options || Boolean(busy)} type="submit" className="account-wide">{isSignup ? 'Create account' : forgot ? 'Send reset link' : reset ? 'Update password' : verify ? 'Verify email' : resend ? 'Send verification link' : 'Sign in to Morrow'}<Icon name="chevron-right" /></Button>
            </fieldset>
          </form>}
        {!hasSuccess && !recovery && <div className="account-auth-bottom">{isSignup ? <p>Start with a free workspace.<br />No payment details needed.</p> : <><p>New to Morrow? <a href="#/signup">Create an account</a></p><a className="account-resend-link" href="#/resend">Resend verification email</a></>}</div>}
      </section>
    </div><footer className="account-auth-footer"><span>Morrow · Your next move.</span><span>Your workspace is private. Administrator access is recorded.</span></footer>
  </div>;
}

function Plans({ user, onRefresh }) {
  const [data, setData] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [billing, setBilling] = useState(null), [billingError, setBillingError] = useState('');
  const [billingLoading, setBillingLoading] = useState(true);
  const [message, setMessage] = useState(''), [confirmCancellation, setConfirmCancellation] = useState(false);
  const comparison = useRef(null), lifetime = useRef(null), operation = useRef(null);
  const checkout = hashParams().get('checkout');
  const requestedModule = hashParams().get('module');
  const administrator = user.role === 'admin';
  const managedPlan = !administrator && user.plan_source === 'admin';
  const availableModules = administrator ? Object.keys(MODULE_NAMES) : user.modules || [];
  const subscriptionsAvailable = Boolean(data?.items.some(plan => plan.checkout_available));
  const subscription = billing?.subscription;
  const billingProvider = billing?.provider || data?.billing_provider || 'stripe';
  const periodDate = subscription?.current_period_end ? new Date(typeof subscription.current_period_end === 'number' ? subscription.current_period_end * 1000 : subscription.current_period_end) : null;
  const periodLabel = periodDate && !Number.isNaN(periodDate.getTime()) ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(periodDate) : '';
  const hasPaidPeriod = Boolean(periodDate?.getTime() > Date.now());
  const hasSubscription = Boolean(subscription && (!['none', 'creation_failed', 'cancelled', 'canceled', 'completed', 'expired', 'incomplete_expired'].includes(subscription.status) || periodDate?.getTime() > Date.now()));
  const razorpaySubscription = billingProvider === 'razorpay' && hasSubscription;
  const checkoutUncertain = ['creating', 'creation_unknown'].includes(subscription?.status);
  const subscriptionLabel = billingProvider === 'razorpay' && subscription?.status === 'active' && !hasPaidPeriod ? 'Payment confirmation pending' : ({ none: 'No active subscription', creating: 'Preparing checkout', creation_unknown: 'Checkout confirmation pending', creation_failed: 'Checkout could not start', created: 'Awaiting checkout', authenticated: 'Payment confirmation pending', active: 'Active', trialing: 'Trial', pending: 'Payment pending', halted: 'Payment needs attention', paused: 'Paused', cancelled: 'Cancelled', canceled: 'Cancelled', completed: 'Completed', expired: 'Expired', incomplete: 'Awaiting checkout', incomplete_expired: 'Expired', past_due: 'Payment needs attention', unpaid: 'Payment needs attention' }[subscription?.status] || 'Awaiting confirmation');
  async function load() {
    const signal = AbortSignal.any([lifetime.current.signal, accountRequestSignal()]);
    setError(''); setBillingError(''); setBillingLoading(true);
    await Promise.allSettled([
      request('/plans', { signal }).then(value => { if (!signal.aborted) setData(value); })
        .catch(err => { if (!signal.aborted) setError(err.message); }),
      request('/billing/status', { signal }).then(value => { if (!signal.aborted) setBilling(value); })
        .catch(err => { if (!signal.aborted) setBillingError(err.message); })
        .finally(() => { if (!signal.aborted) setBillingLoading(false); }),
    ]);
  }
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    setData(null); setBilling(null); setBusy(''); setMessage(''); setConfirmCancellation(false);
    load().then(() => { if (!controller.signal.aborted && checkout === 'success' && !administrator) refresh(); });
    return () => { controller.abort(new DOMException('The billing page closed.', 'AbortError')); operation.current = null; };
  }, [user.id]);
  useEffect(() => { if (comparison.current && MODULE_NAMES[requestedModule]) comparison.current.open = true; }, [data, requestedModule]);
  async function run(label, action) {
    if (operation.current || !lifetime.current) return;
    const signal = AbortSignal.any([lifetime.current.signal, accountRequestSignal()]);
    const current = { signal }; operation.current = current;
    setBusy(label); setError(''); setMessage(''); setBillingError('');
    try { await action(signal); }
    catch (err) {
      if (!signal.aborted) {
        if (err.code === 'checkout_cancelled') setMessage(err.message);
        else setError(err.name === 'TimeoutError' ? 'Payment confirmation is taking longer than expected. Refresh billing shortly before trying to pay again.' : err.message);
        try { const latest = await request('/billing/status', { signal }); signal.throwIfAborted(); setBilling(latest); }
        catch (statusError) { if (!signal.aborted) setBillingError(statusError.message); }
      }
    } finally { if (operation.current === current && !signal.aborted) { operation.current = null; setBusy(''); } }
  }
  async function confirmPayment(signal, targetPlan) {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
    setMessage('Checking your payment with the billing service. Your access updates after confirmation.');
    for (let attempt = 0; attempt < 5; attempt++) {
      const latest = await request('/billing/refresh', { body: {}, signal: bounded });
      bounded.throwIfAborted(); setBilling(latest);
      await onRefresh?.(); bounded.throwIfAborted();
      if (latest.subscription?.cancellation_pending) { setMessage('Cancellation is being confirmed. Refresh billing shortly.'); return; }
      const paidThrough = latest.subscription?.current_period_end;
      const paidUntil = paidThrough ? new Date(typeof paidThrough === 'number' ? paidThrough * 1000 : paidThrough).getTime() : 0;
      const paymentConfirmed = latest.provider !== 'razorpay' || paidUntil > Date.now();
      if (paymentConfirmed && ['active', 'trialing'].includes(latest.subscription?.status) && (!targetPlan || latest.subscription.plan_slug === targetPlan)) {
        setMessage('Subscription confirmed. Your account access is up to date.'); return;
      }
      if (!targetPlan && checkout !== 'success') { setMessage('Billing status and account access are up to date.'); return; }
      if (attempt < 4) await waitForBilling(1500, bounded);
    }
    setMessage('Your payment is still being confirmed. You can refresh billing shortly; there is no need to pay again.');
  }
  const refresh = () => run('refresh', signal => confirmPayment(signal));
  async function checkoutOrPortal(slug) {
    if (billingLoading || ((administrator || managedPlan || subscription?.cancellation_pending) && slug !== 'portal')) return;
    return run(slug, async signal => {
      const result = await request(slug === 'portal' ? '/billing/portal' : '/billing/checkout', { body: slug === 'portal' ? {} : { plan: slug }, signal });
      signal.throwIfAborted();
      if (result.provider === 'razorpay') {
        const payment = await openRazorpayCheckout(result, signal); signal.throwIfAborted();
        setMessage('Payment received by checkout. Confirming it securely before updating your access.');
        await request('/billing/razorpay/verify', { body: payment, signal }); signal.throwIfAborted();
        await confirmPayment(signal, slug);
      } else { location.assign(stripeDestination(result.url)); }
    });
  }
  const cancelRenewal = () => {
    if (billingLoading || !subscription?.can_cancel || subscription.cancellation_pending) return;
    return run('cancel', async signal => {
    const latest = await request('/billing/cancel', { body: {}, signal }); signal.throwIfAborted();
    setBilling(latest); setConfirmCancellation(false); await onRefresh?.(); signal.throwIfAborted();
    setMessage(latest.subscription?.cancellation_pending ? 'Cancellation is being confirmed. Refresh billing shortly.' : hasPaidPeriod ? 'Cancellation confirmed. Your paid access continues until the end of the current period.' : 'Pending checkout cancelled. Your current workspace access is unchanged.');
    });
  };
  return <><PageHead title="Plans & billing" description="Your workspace. The tools that fit you."><a className="btn" href="#/account">My account <Icon name="chevron-right" /></a></PageHead>
    <Notice error>{error}{error && !data && <> <button className="account-text-button" onClick={load}>Try again</button></>}</Notice>
    <Notice>{message}</Notice>
    {checkout === 'success' && !message && <Notice>Your payment is being confirmed. Access updates after the billing service confirms your subscription.</Notice>}
    {checkout === 'cancelled' && <Notice>Checkout was cancelled. Your current plan is unchanged.</Notice>}
    {billingError && <Notice error>Billing status could not load. {billingError} <button className="account-text-button" disabled={Boolean(busy) || billingLoading} onClick={load}>Retry billing</button></Notice>}
    <section className="account-access-summary" aria-label="Your current access"><span className="account-summary-check"><Icon name="check" /></span><div><strong>{administrator ? 'Administrator · all modules included' : `You’re on ${user.plan_name || 'Free'}`}</strong><span>{administrator ? 'Your role includes every module. To test a payment, use a regular account after payment setup is complete.' : `${availableModules.length} workspace modules included. Upgrade when you need more.`}</span></div><a href="#/account" className="account-summary-link">View my access <Icon name="chevron-right" /></a></section>
    {managedPlan && <p className="account-checkout-note"><Icon name="info" />Your plan is managed by an administrator. Contact them before purchasing.</p>}
    <div className="account-section-heading"><div><h2>A little support. More possibilities.</h2><p>One account, with room to grow.</p></div><span className="account-billing-period"><span />Billed monthly</span></div>
    {subscriptionsAvailable && <p className="account-payment-methods"><Icon name="lock" /> Secure monthly payments{data?.payment_methods?.length ? ` · ${data.payment_methods.join(' · ')}` : ''}</p>}
    {razorpaySubscription && !subscription.can_resume_checkout && <p className="account-checkout-note"><Icon name="info" />{checkoutUncertain ? 'Your checkout request is being confirmed. Refresh billing before starting another payment.' : hasPaidPeriod ? 'To change plans, cancel renewal below and choose another plan after your current paid period ends.' : 'Your subscription request is awaiting confirmation. Refresh billing, or cancel it below before choosing another plan.'}</p>}
    {data && MODULE_NAMES[requestedModule] && <div className="account-plan-focus"><Icon name={MODULE_DETAILS[requestedModule].icon} /><p>Looking for <strong>{MODULE_NAMES[requestedModule]}</strong>? {data.items.some(plan => plan.modules.includes(requestedModule)) ? 'Plans with this module are marked below.' : 'This module is not currently offered in a paid plan.'}</p></div>}
    {!data && !error && <Loading label="Loading plans…" />}
    <div className="account-plan-grid">{data?.items.map((plan, index) => {
      const current = !administrator && user.effective_plan === plan.slug;
      const previous = data.items[index - 1];
      const includesPrevious = previous && previous.modules.every(module => plan.modules.includes(module));
      const addedModules = includesPrevious ? plan.modules.filter(module => !previous.modules.includes(module)) : plan.modules;
      const matches = Boolean(MODULE_NAMES[requestedModule] && plan.modules.includes(requestedModule));
      const resume = razorpaySubscription && subscription.can_resume_checkout && !subscription.cancellation_pending && subscription.plan_slug === plan.slug;
      const planChangeBlocked = razorpaySubscription && !resume;
      const portal = billingProvider === 'stripe' && hasSubscription;
      return <article className={`panel account-plan ${current ? 'is-current' : ''} ${matches ? 'includes-requested-module' : ''}`} data-tone={['mint', 'lavender', 'peach'][index % 3]} key={plan.slug}>
        <div className="account-plan-top"><div><span className="account-plan-count">{plan.modules.length} WORKSPACE MODULES</span><h2>{plan.name}</h2></div><Avatar index={[33, 32, 39][index % 3]} className="account-plan-avatar" /></div>
        <p className="account-price"><Money plan={plan} /><span>/ month</span></p>
        <p className="account-plan-description">{plan.description}</p>
        <div className="account-plan-inclusions"><p>{includesPrevious && addedModules.length ? `Everything in ${previous.name}, plus` : plan.monthly_amount === 0 ? 'Your workspace essentials' : 'Included modules'}</p><ul className="account-plan-features">{(addedModules.length ? addedModules : plan.modules).map(module => <li key={module}><Icon name="check" />{MODULE_NAMES[module] || module}</li>)}</ul></div>
        {matches && <p className="account-plan-match"><Icon name="check" /> Includes {MODULE_NAMES[requestedModule]}</p>}
        <Button secondary={current || administrator || index !== 1} busy={busy === plan.slug} disabled={Boolean(busy) || billingLoading || administrator || managedPlan || subscription?.cancellation_pending || current || plan.monthly_amount === 0 || !billing || Boolean(billingError) || planChangeBlocked || (portal ? !billing.configured : !plan.checkout_available)}
          onClick={() => checkoutOrPortal(portal ? 'portal' : plan.slug)}>{administrator ? 'Included in your access' : current ? <><Icon name="check" />Your current plan</> : plan.monthly_amount === 0 ? 'Free essentials' : managedPlan ? 'Managed by administrator' : planChangeBlocked ? checkoutUncertain ? 'Confirming checkout' : 'Manage current subscription' : resume ? 'Finish checkout' : portal ? 'Change plan in billing' : !plan.checkout_available ? 'Not available yet' : `Choose ${plan.name}`}{!administrator && !managedPlan && !current && !planChangeBlocked && (portal || plan.checkout_available) && <Icon name="arrow-up-right" />}</Button>
      </article>;
    })}</div>
    {data && !administrator && !subscriptionsAvailable && <p className="account-checkout-note"><Icon name="alert-triangle" />Payments aren’t set up yet. The app owner needs to finish {data.billing_provider === 'razorpay' ? 'Razorpay' : 'Stripe'} setup before you can subscribe. Your current access remains available.</p>}
    {data?.items.length > 0 && <details className="account-comparison" ref={comparison}><summary><span className="account-comparison-symbol"><Icon name="grid" /></span><span><strong>Compare every module</strong><small>See exactly what’s included in each plan.</small></span><span className="account-comparison-toggle"><span>View comparison</span><Icon name="chevron-down" /></span></summary><div className="account-comparison-body"><p className="account-comparison-hint"><Icon name="chevron-right" />Swipe to compare all plans</p><div className="account-table-scroll" role="region" aria-label="Compare plan modules" tabIndex={0}><table className="account-table account-comparison-table"><thead><tr><th scope="col">Workspace module</th>{data.items.map(plan => <th key={plan.slug} scope="col">{plan.name}</th>)}</tr></thead><tbody>{Object.entries(MODULE_NAMES).map(([module, label]) => <tr key={module} className={requestedModule === module ? 'is-highlighted' : ''}><th scope="row">{label}</th>{data.items.map(plan => <td key={plan.slug}>{plan.modules.includes(module) ? <span className="account-comparison-value is-included"><Icon name="check" /><span className="visually-hidden">Included</span></span> : <span className="account-comparison-value"><span aria-hidden="true">—</span><span className="visually-hidden">Not included</span></span>}</td>)}</tr>)}</tbody></table></div></div></details>}
    <div className="account-plan-notes"><section className="account-byop"><Avatar index={35} className="account-byop-avatar" /><div><h2 className="panel-title">Your AI subscription stays yours.</h2><p className="panel-sub">Bring your own Claude or Kiro subscription. Morrow plans cover workspace tools, not AI credits.</p><a className="account-inline-link" href="#/account">Set your AI preference <Icon name="arrow-up-right" /></a></div></section>
      <section className="account-billing-footer account-subscription" aria-label="Subscription and payments"><div><h2 className="panel-title">Your billing</h2>
        {!billing && !billingError ? <p className="panel-sub" role="status">Checking your subscription…</p> : <p className="panel-sub">{subscription ? <><strong>{subscription.plan_name || 'Your subscription'}</strong> · {subscriptionLabel}{periodLabel && <><br />{subscription.cancel_at_period_end ? 'Access until ' : 'Current period ends '}{periodLabel}</>}</> : 'No paid subscription on this account.'}</p>}
        {subscription?.cancel_at_period_end && !subscription.cancellation_pending && <p className="account-billing-detail">Renewal is cancelled. Your paid access continues until this period ends.</p>}
        {subscription?.cancellation_pending && <p className="account-billing-detail" role="status">Cancellation is being confirmed. Refresh billing shortly.</p>}
        {billing && !billing.configured && subscription && <p className="account-billing-detail">Billing is temporarily unavailable. Your current access is unchanged.</p>}
      </div><div className="account-billing-actions">
        {billingProvider === 'stripe' && subscription && <Button secondary busy={busy === 'portal'} disabled={Boolean(busy) || billingLoading || !billing?.configured} onClick={() => checkoutOrPortal('portal')}>Manage billing <Icon name="external" /></Button>}
        {billingProvider === 'razorpay' && subscription?.can_resume_checkout && <Button secondary busy={busy === subscription.plan_slug} disabled={Boolean(busy) || billingLoading || !billing?.configured || administrator || managedPlan || subscription.cancellation_pending} onClick={() => checkoutOrPortal(subscription.plan_slug)}>Finish checkout <Icon name="chevron-right" /></Button>}
        {billingProvider === 'razorpay' && subscription?.can_cancel && (!confirmCancellation || subscription.cancellation_pending) && <Button secondary disabled={Boolean(busy) || billingLoading || !billing?.configured || subscription.cancellation_pending} onClick={() => setConfirmCancellation(true)}>{hasPaidPeriod ? 'Cancel renewal' : 'Cancel checkout'}</Button>}
        <Button secondary busy={busy === 'refresh'} disabled={Boolean(busy) || billingLoading || !billing?.configured} onClick={refresh}>Refresh billing <Icon name="refresh" /></Button>
      </div>
      {confirmCancellation && !subscription?.cancellation_pending && <div className="account-billing-confirm" role="group" aria-label="Confirm subscription cancellation"><strong>{hasPaidPeriod ? 'Cancel automatic renewal?' : 'Cancel this checkout?'}</strong><p>{hasPaidPeriod ? `Your paid access continues until ${periodLabel}. You won’t be charged for the next renewal.` : 'This cancels the pending subscription request. Your current workspace access stays available.'}</p><div className="account-actions"><Button secondary disabled={Boolean(busy)} onClick={() => setConfirmCancellation(false)}>{hasPaidPeriod ? 'Keep subscription' : 'Keep checkout'}</Button><Button busy={busy === 'cancel'} disabled={Boolean(busy)} onClick={cancelRenewal}>Confirm cancellation</Button></div></div>}
      </section></div>
    <p className="account-footnote account-availability-note"><Icon name="info" />Automated workflows need a personal connection. These connections are not available yet for new workspaces.</p>
  </>;
}

function Settings({ user, onRefresh, onLogout }) {
  const [provider, setProvider] = useState(user.ai_provider || 'claude'), [busy, setBusy] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const administrator = user.role === 'admin';
  const availableModules = administrator ? Object.keys(MODULE_NAMES) : user.modules || [];
  async function save(event) {
    event.preventDefault(); setBusy('save'); setError(''); setMessage('');
    try { await request('/account/settings', { body: { ai_provider: provider }, method: 'PUT' }); await onRefresh?.(); setMessage('AI preference saved. Your subscription stays with your provider.'); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  async function logout() {
    setBusy('logout'); setError('');
    try { await onLogout?.(); } catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  return <><PageHead title="Account settings" description="Your details, your tools, your preferences."><a className="btn" href="#/plans">Plans & billing <Icon name="chevron-right" /></a></PageHead>
    <Notice error>{error}</Notice><Notice>{message}</Notice>
    <section className="account-identity-panel" aria-label="Your account"><div className="account-person"><Avatar index={workspaceAvatar()} className="account-person-avatar" /><div><div className="account-person-meta"><span>{administrator ? 'ADMINISTRATOR' : 'YOUR PERSONAL WORKSPACE'}</span><span className="account-verified"><Icon name="check" /> Verified email</span></div><strong>{user.name || 'Your account'}</strong><span>{user.email}</span></div></div><div className="account-identity-access"><div><strong>{availableModules.length}<span> / {Object.keys(MODULE_NAMES).length}</span></strong><span>{administrator ? 'All modules included' : `${user.plan_name || 'Free'} · modules included`}</span></div><div className="account-access-meter" aria-hidden="true">{Object.keys(MODULE_NAMES).map(module => <span key={module} data-included={availableModules.includes(module)} />)}</div></div></section>
    <div className="account-settings-grid"><aside className="account-settings-aside" aria-label="Preferences and security">
      <form className="panel account-ai-panel" onSubmit={save}><PanelHead title="Bring your own AI" description="Pick the subscription you’ll use." />
        <fieldset className="account-fieldset" disabled={Boolean(busy)}><legend className="visually-hidden">AI provider</legend><div className="account-provider-grid">{['claude', 'kiro'].map(value => <label className={`account-provider ${provider === value ? 'is-selected' : ''}`} key={value}>
          <input type="radio" name="provider" value={value} checked={provider === value} onChange={() => setProvider(value)} /><strong>{value === 'claude' ? 'Claude' : 'Kiro'}</strong><span>Your own subscription</span>
        </label>)}</div><p className="account-footnote">Your AI subscription is billed separately. Saving a preference does not connect your provider account.</p><Button busy={busy === 'save'} type="submit">Save preference <Icon name="check" /></Button></fieldset>
      </form>
      <section className="panel account-security"><PanelHead title="Sign-in & security" description="Keep your workspace yours." /><div className="account-security-row"><span className="account-security-symbol"><Icon name="lock" /></span><div><strong>Password</strong><p className="panel-sub">Reset securely by email.</p></div><a className="account-inline-link" href="#/forgot">Reset password <Icon name="chevron-right" /></a></div>
        <div className="account-security-row"><span className="account-security-symbol"><Icon name="person" /></span><div><strong>This browser</strong><p className="panel-sub">Your current session.</p></div><Button secondary busy={busy === 'logout'} disabled={Boolean(busy)} onClick={logout}>Sign out</Button></div>
      </section><p className="account-privacy-note"><Icon name="lock" /><span>Your files and activity stay with your account. Administrator access is recorded.</span></p>
    </aside>
      <section className="panel account-module-access"><PanelHead title="Your workspace access" description={administrator ? 'Every module is included with your administrator role.' : 'A clear view of what’s yours to use.'}><span className="account-tag">{administrator ? 'Full access' : user.plan_name || 'Your plan'}</span></PanelHead><div className="account-module-grid">{Object.entries(MODULE_NAMES).map(([module, label]) => {
        const included = availableModules.includes(module), details = MODULE_DETAILS[module];
        return <a key={module} className={`account-module-card ${included ? 'is-included' : 'requires-plan'}`} href={included ? '#/' + details.route : '#/plans?module=' + module}><Avatar index={MODULE_ART[module]} className="account-module-symbol" /><div><strong>{label}</strong><p>{details.description}</p></div><span className="account-module-state">{included ? <><Icon name="check" /> Included</> : <>View plans <Icon name="chevron-right" /></>}</span></a>;
      })}</div><p className="account-module-note"><Icon name="info" />Included workflows may still need a personal connection.</p></section>
    </div>
  </>;
}

function Inspection({ data, busy, onClose, onMore, onDownload }) {
  const raw = data.profile || {}, profile = raw.personal || raw;
  const summary = ['name', 'email', 'phone', 'location', 'headline', 'summary'].filter(key => profile[key]);
  return <section className="panel account-inspection"><PanelHead title={data.user.name || data.user.email} description="Administrator view · this access is recorded."><Button secondary onClick={onClose}>Close <Icon name="x" /></Button></PanelHead>
    <h3>Profile</h3>{summary.length ? <dl className="account-details">{summary.map(key => <div key={key}><dt>{key}</dt><dd>{typeof profile[key] === 'object' ? JSON.stringify(profile[key]) : String(profile[key])}</dd></div>)}</dl> : <p className="muted">No profile summary has been added.</p>}
    <details className="account-raw-profile"><summary>View full profile</summary><pre>{JSON.stringify(raw, null, 2)}</pre></details>
    <h3>Applications</h3>{data.applications.length ? <div className="account-table-scroll" role="region" aria-label="User applications" tabIndex={0}><table className="account-table"><thead><tr><th>Company</th><th>Role</th><th>Status</th></tr></thead><tbody>{data.applications.map(item => <tr key={item.id}><td>{item.company}</td><td>{item.title}</td><td>{item.status}</td></tr>)}</tbody></table></div> : <p className="muted">No applications recorded.</p>}
    {data.applicationsHasMore && <Button secondary busy={busy} onClick={() => onMore('applications')}>Load more applications</Button>}
    <h3>Private files</h3>{data.files.length ? <div className="account-file-list">{data.files.map(file => <button className="account-file" key={file.id} disabled={busy} onClick={() => onDownload(file)}><Icon name="file" /><span>{file.filename}</span><Icon name="download" /></button>)}</div> : <p className="muted">No private files uploaded.</p>}
    {data.filesHasMore && <Button secondary busy={busy} onClick={() => onMore('files')}>Load more files</Button>}
  </section>;
}

function PlanEditor({ plans, billingProvider, reason, disabled, onError, onSaved }) {
  const [busy, setBusy] = useState('');
  async function save(event, plan) {
    event.preventDefault(); setBusy(plan.slug); onError('');
    const form = new FormData(event.currentTarget);
    try {
      await adminRequest(`/plans/${plan.slug}`, reason, {
        name: form.get('name'), description: form.get('description'), modules: form.getAll('modules'), stripe_price_id: form.get('stripe_price_id') || null, razorpay_plan_id: form.get('razorpay_plan_id') || null,
      }, 'PUT');
      await onSaved('Plan updated. New module permissions apply on the next request.');
    } catch (err) { onError(err.message); } finally { setBusy(''); }
  }
  return <section className="panel"><PanelHead title="Plans & module access" description={`Name each plan, choose its modules, and connect monthly billing. ${billingProvider === 'razorpay' ? 'Razorpay handles new subscriptions.' : 'Stripe handles new subscriptions.'}`} />
    <div className="account-admin-plans">{plans.map(plan => <form key={plan.slug} onSubmit={event => save(event, plan)}><fieldset className="account-fieldset" disabled={Boolean(busy) || disabled}>
      <legend className="account-plan-legend">{plan.name} <span><Money plan={plan} /> / month</span></legend>
      <Field label="Plan name" id={'account-plan-name-' + plan.slug} name="name" defaultValue={plan.name} maxLength={50} required />
      <Field label="Description" id={'account-plan-description-' + plan.slug} name="description" defaultValue={plan.description} maxLength={200} required />
      <fieldset className="account-module-fields"><legend className="field-label">Included modules</legend>{Object.entries(MODULE_NAMES).map(([key, name]) => <label className="account-check" key={key}>
        <input type="checkbox" name="modules" value={key} defaultChecked={plan.modules.includes(key)} disabled={CORE_MODULES.includes(key)} />{name}{CORE_MODULES.includes(key) && <><input type="hidden" name="modules" value={key} /><span>Core</span></>}
      </label>)}</fieldset>
      <Field label="Stripe monthly price ID" id={'account-price-' + plan.slug} name="stripe_price_id" defaultValue={plan.stripe_price_id || ''} placeholder="price_…" hint="The Stripe price must match this plan’s amount and currency." />
      <Field label="Razorpay monthly plan ID" id={'account-razorpay-plan-' + plan.slug} name="razorpay_plan_id" defaultValue={plan.razorpay_plan_id || ''} placeholder="plan_…" hint="Use a monthly INR plan with this exact amount. Keep test and live plan IDs separate." />
      <Button secondary busy={busy === plan.slug} type="submit">Save {plan.name}</Button>
    </fieldset></form>)}</div>
  </section>;
}

function Admin({ onRefresh }) {
  const [items, setItems] = useState(null), [plans, setPlans] = useState([]), [audit, setAudit] = useState([]);
  const [billingProvider, setBillingProvider] = useState('stripe');
  const [reason, setReason] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [selected, setSelected] = useState(null), [inspection, setInspection] = useState(null);
  const [hasMoreUsers, setHasMoreUsers] = useState(false), [hasMoreAudit, setHasMoreAudit] = useState(false);
  const reasonValid = reason.trim().length >= 10;
  const locked = busy || !reasonValid;
  async function load() {
    setBusy(true); setError('');
    try {
      const results = await Promise.all([adminRequest('/users', reason), adminRequest('/plans', reason)]);
      setItems(results[0].items); setHasMoreUsers(results[0].items.length === 50); setPlans(results[1].items); setBillingProvider(results[1].billing_provider || 'stripe');
      const events = await adminRequest('/audit-events', reason); setAudit(events.items); setHasMoreAudit(events.items.length === 50);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function update(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await adminRequest(`/users/${selected.id}/access`, reason, { role: values.role, plan: values.plan, active: values.active === 'true', expires_at: null }, 'PATCH');
      setMessage('Access updated and recorded in the audit log.'); setSelected(null);
      await load(); await onRefresh?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function more(kind) {
    setBusy(true); setError('');
    try {
      const rows = (await adminRequest(kind === 'users' ? `/users?offset=${items.length}` : `/audit-events?offset=${audit.length}`, reason)).items;
      if (kind === 'users') { setItems(previous => [...previous, ...rows]); setHasMoreUsers(rows.length === 50); }
      else { setAudit(previous => [...previous, ...rows.filter(row => !previous.some(item => item.id === row.id))]); setHasMoreAudit(rows.length === 50); }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function inspect(user) {
    setBusy(true); setError(''); setSelected(null);
    try {
      const [profile, applications, files] = await Promise.all([
        adminRequest(`/users/${user.id}/profile`, reason), adminRequest(`/users/${user.id}/applications`, reason), adminRequest(`/users/${user.id}/artifacts`, reason),
      ]);
      setInspection({ user, profile: profile.data, applications: applications.items, files: files.items, applicationsHasMore: applications.items.length === 50, filesHasMore: files.items.length === 50 });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function moreInspection(kind) {
    setBusy(true); setError('');
    try {
      const rows = (await adminRequest(`/users/${inspection.user.id}/${kind === 'files' ? 'artifacts' : 'applications'}?offset=${inspection[kind].length}`, reason)).items;
      setInspection(previous => ({ ...previous, [kind]: [...previous[kind], ...rows], [kind + 'HasMore']: rows.length === 50 }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function download(file) {
    setBusy(true); setError('');
    const scope = accountRequestSignal();
    try {
      const response = await fetch(`/api/v1/admin/users/${inspection.user.id}/artifacts/${file.id}/content`, { credentials: 'same-origin', headers: { 'X-Admin-Reason': reason }, signal: AbortSignal.any([scope, AbortSignal.timeout(30000)]) });
      scope.throwIfAborted();
      if (response.status === 401) window.dispatchEvent(new Event('account-expired'));
      if (!response.ok) throw new Error('This file could not be downloaded. Please try again.');
      const blob = await response.blob(); scope.throwIfAborted();
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = file.filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <><PageHead title="People & access" description="Manage accounts and plan permissions. Administrator access is recorded with a reason." />
    <Notice error>{error}</Notice><Notice>{message}</Notice>
    <form className="panel account-admin-reason" onSubmit={event => { event.preventDefault(); load(); }}>
      <Field label="Reason for access" id="account-admin-reason" value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={500} required placeholder="For example: Review account access for support" hint="Include a clear reason. It will be saved with every administrator action." />
      <Button busy={busy} disabled={!reasonValid} type="submit">{items ? 'Refresh administration' : 'Open administration'}<Icon name="chevron-right" /></Button>
    </form>
    {items && <section className="panel"><PanelHead title="People & access" description={`${items.length} accounts loaded`} /><div className="account-table-scroll" role="region" aria-label="Accounts and access" tabIndex={0}><table className="account-table"><thead><tr><th>Person</th><th>Role</th><th>Plan</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{items.map(item => <tr key={item.id}>
      <td><strong>{item.name || item.email}</strong><span className="account-table-detail">{item.email}</span></td><td>{item.role === 'admin' ? 'Administrator' : 'Member'}</td><td>{plans.find(plan => plan.slug === item.plan_slug)?.name || item.plan_slug}</td>
      <td><span className={`account-tag ${item.active ? '' : 'is-disabled'}`}>{!item.active ? 'Disabled' : item.email_verified ? 'Verified' : 'Unverified'}</span></td><td><div className="account-table-actions"><Button secondary disabled={locked} aria-label={`Manage ${item.email}`} onClick={() => { setSelected(item); setInspection(null); }}>Manage</Button><Button secondary disabled={locked} aria-label={`View data for ${item.email}`} onClick={() => inspect(item)}>View data</Button></div></td>
    </tr>)}</tbody></table></div>{!items.length && <p className="panel-empty">No accounts found.</p>}{hasMoreUsers && <div className="account-pagination"><Button secondary busy={busy} disabled={locked} onClick={() => more('users')}>Load more accounts</Button></div>}</section>}
    {selected && <form key={selected.id} className="panel" onSubmit={update}><PanelHead title={'Manage ' + (selected.name || selected.email)} description={selected.email} /><fieldset className="account-fieldset" disabled={locked}><div className="account-access-fields">
      <label className="field"><span className="field-label">Role</span><select className="input select-control" name="role" defaultValue={selected.role}><option value="user">User</option><option value="admin">Administrator</option></select></label>
      <label className="field"><span className="field-label">Plan</span><select className="input select-control" name="plan" defaultValue={selected.plan_slug}>{plans.map(plan => <option key={plan.slug} value={plan.slug}>{plan.name}</option>)}</select></label>
      <label className="field"><span className="field-label">Account status</span><select className="input select-control" name="active" defaultValue={String(selected.active)}><option value="true">Active</option><option value="false">Disabled</option></select></label>
    </div><p className="account-footnote">Administrator plan assignments override subscription access. Changing access does not cancel a paid subscription.</p><div className="account-actions"><Button busy={busy} type="submit">Save access</Button><Button secondary type="button" onClick={() => setSelected(null)}>Cancel</Button></div></fieldset></form>}
    {inspection && <Inspection data={inspection} busy={locked} onClose={() => setInspection(null)} onMore={moreInspection} onDownload={download} />}
    {items && <PlanEditor plans={plans} billingProvider={billingProvider} reason={reason} disabled={locked} onError={setError} onSaved={async text => {
      const updated = await adminRequest('/plans', reason); setMessage(text); setPlans(updated.items); setBillingProvider(updated.billing_provider || 'stripe'); await onRefresh?.();
    }} />}
    {items && <section className="panel"><PanelHead title="Audit trail" description="Account reads, data access, and permission changes." /><div className="account-table-scroll" role="region" aria-label="Administrator audit log" tabIndex={0}><table className="account-table"><thead><tr><th>Action</th><th>Reason</th><th>Time</th></tr></thead><tbody>{audit.map(item => <tr key={item.id}><td>{item.action}</td><td>{item.reason}</td><td><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></td></tr>)}</tbody></table></div>{!audit.length && <p className="panel-empty">No audit events recorded.</p>}{hasMoreAudit && <div className="account-pagination"><Button secondary busy={busy} disabled={locked} onClick={() => more('audit')}>Load more audit events</Button></div>}</section>}
  </>;
}

export function AccountView({ page, user, onAuthenticated, onRefresh, onLogout }) {
  const authPage = AUTH_PAGES.includes(page.name);
  if (authPage || !user) return <div className="account-view account-view-auth"><Auth page={authPage ? page : { name: 'login' }} onAuthenticated={onAuthenticated} /></div>;
  return <div className="page account-view">{page.name === 'plans' ? <Plans user={user} onRefresh={onRefresh} />
    : page.name === 'admin' && user.role === 'admin' ? <Admin onRefresh={onRefresh} />
      : page.name === 'admin' ? <><PageHead title="Administrator access required" description="Your account does not have access to administration." /><a className="btn" href="#/overview">Back to overview</a></>
        : <Settings user={user} onRefresh={onRefresh} onLogout={onLogout} />}</div>;
}
