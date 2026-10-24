import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

// Every account/payment response and the hosted SDK are mocked. No provider
// credentials, real checkout, external payment calls, or stored accounts are used.
const core = ['profile', 'applications', 'files'];
const plus = [...core, 'resumes', 'research'];
const all = [...plus, 'automations', 'outreach', 'analytics', 'learning'];
const sdk = `window.__paymentSDK = { opens: 0, closes: 0, instances: [] };
window.Razorpay = class {
  constructor(options) { this.options = options; this.events = {}; window.__paymentSDK.instances.push(this); }
  on(name, callback) { this.events[name] = callback; }
  open() { window.__paymentSDK.opens++; }
  close() { window.__paymentSDK.closes++; this.options.modal.ondismiss(); }
};`;
const callback = { razorpay_payment_id: 'pay_synthetic', razorpay_subscription_id: 'sub_synthetic', razorpay_signature: 'synthetic-signature' };
const paidSubscription = () => ({ status: 'active', plan_slug: 'plus', plan_name: 'Plus', current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(), cancel_at_period_end: false, can_cancel: true, can_resume_checkout: false });
const planCard = (page, name) => page.locator('.account-plan').filter({ has: page.getByRole('heading', { name, exact: true }) });

async function fixture(page, { administrator = false } = {}) {
  const state = {
    user: { id: 'synthetic-payment-user', name: 'Payment Preview', email: 'preview.payment@example.com', role: administrator ? 'admin' : 'user', effective_plan: 'free', plan_name: 'Free', modules: administrator ? all : core, subscription_status: 'none', ai_provider: 'claude' },
    plans: { billing_provider: 'razorpay', billing_available: true, payment_methods: ['UPI AutoPay', 'Cards'], items: [
      { slug: 'free', name: 'Free', description: 'Your workspace essentials.', monthly_amount: 0, currency: 'inr', modules: core, checkout_available: false, stripe_price_id: null, razorpay_plan_id: null },
      { slug: 'plus', name: 'Plus', description: 'More preparation for your next move.', monthly_amount: 49900, currency: 'inr', modules: plus, checkout_available: true, stripe_price_id: 'price_plus', razorpay_plan_id: 'plan_plus' },
      { slug: 'pro', name: 'Pro', description: 'Your complete workspace.', monthly_amount: 99900, currency: 'inr', modules: all, checkout_available: true, stripe_price_id: 'price_pro', razorpay_plan_id: 'plan_pro' },
    ] },
    billing: { provider: 'razorpay', configured: true, subscription: null },
    calls: [], handlers: {}, scriptRequests: 0,
  };
  await page.route('https://checkout.razorpay.com/v1/checkout.js', async route => {
    state.scriptRequests++;
    if (state.sdkFailure) await route.abort(); else await route.fulfill({ contentType: 'text/javascript', body: sdk });
  });
  await page.route('https://billing.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic billing portal</h1>' }));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? route.request().postDataJSON() : null;
    state.calls.push({ path, method, body });
    if (state.handlers[path]) return state.handlers[path](route, body);
    let value;
    if (path === '/api/session') value = { mode: 'accounts', legacy_access: false, user: state.user };
    else if (path === '/api/v1/plans') value = state.plans;
    else if (path === '/api/v1/billing/status' || path === '/api/v1/billing/refresh') value = state.billing;
    else if (path === '/api/v1/billing/checkout') {
      state.billing.subscription ||= { ...paidSubscription(), status: 'created', current_period_end: null, can_resume_checkout: true };
      value = { provider: 'razorpay', key_id: 'rzp_test_synthetic', subscription_id: 'sub_synthetic', plan_name: 'Plus', name: 'Morrow', description: 'Plus monthly', prefill: { name: state.user.name, email: state.user.email } };
    } else if (path === '/api/v1/billing/razorpay/verify') value = {};
    else if (path === '/api/v1/billing/portal') value = { provider: 'stripe', url: 'https://billing.stripe.com/p/session/synthetic' };
    else if (path === '/api/v1/billing/cancel') {
      state.billing.subscription = { ...state.billing.subscription, can_cancel: false, cancel_at_period_end: Boolean(state.billing.subscription.current_period_end), status: 'cancelled', can_resume_checkout: false, cancellation_pending: false };
      value = state.billing;
    } else if (path === '/api/v1/admin/users' || path === '/api/v1/admin/audit-events') value = { items: [] };
    else if (path === '/api/v1/admin/plans') value = { billing_provider: state.plans.billing_provider, items: state.plans.items };
    else if (path.startsWith('/api/v1/admin/plans/') && method === 'PUT') {
      Object.assign(state.plans.items.find(plan => plan.slug === path.split('/').at(-1)), body); value = {};
    } else return route.fulfill({ status: 404, json: { detail: 'No external API access is allowed in payment tests.' } });
    return route.fulfill({ json: value });
  });
  return state;
}

async function openPlans(page) {
  await page.goto('/#/plans');
  await expect(page.getByRole('heading', { level: 1, name: 'Plans & billing' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Subscription and payments' })).not.toContainText('Checking your subscription');
}
async function completeCheckout(page) {
  await page.evaluate(response => window.__paymentSDK.instances.at(-1).options.handler(response), callback);
}
const callsTo = (state, path) => state.calls.filter(call => call.path === '/api/v1' + path);

test.beforeEach(async ({ baseURL }) => {
  const url = new URL(baseURL);
  expect(['localhost', '127.0.0.1']).toContain(url.hostname);
  expect(url.port, 'Payment tests require the isolated dashboard on port 8102.').toBe('8102');
});

test('UPI checkout loads on demand, prevents duplicate starts, and waits for server-confirmed access', async ({ page }) => {
  const state = await fixture(page);
  let verification, refreshes = 0;
  state.handlers['/api/v1/billing/razorpay/verify'] = route => { verification = route; };
  state.handlers['/api/v1/billing/refresh'] = route => {
    refreshes++;
    state.billing.subscription = { ...paidSubscription(), status: refreshes === 1 ? 'authenticated' : 'active' };
    if (refreshes > 1) Object.assign(state.user, { effective_plan: 'plus', plan_name: 'Plus', modules: plus });
    return route.fulfill({ json: state.billing });
  };
  await openPlans(page);
  await expect(page.getByText('Secure monthly payments · UPI AutoPay · Cards', { exact: true })).toBeVisible();
  expect(state.scriptRequests).toBe(0);
  await mkdir('artifacts/payments', { recursive: true });
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await page.screenshot({ path: 'artifacts/payments/plans-free-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('button', { name: 'More sections', exact: true })).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: 'artifacts/payments/plans-free-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await planCard(page, 'Plus').getByRole('button', { name: 'Choose Plus' }).evaluate(button => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => window.__paymentSDK?.opens)).toBe(1);
  expect(callsTo(state, '/billing/checkout')).toHaveLength(1);
  await completeCheckout(page);
  await expect.poll(() => Boolean(verification)).toBe(true);
  await expect(page.getByRole('region', { name: 'Your current access' })).toContainText('You’re on Free');
  expect(callsTo(state, '/billing/refresh')).toHaveLength(0);
  expect(callsTo(state, '/billing/razorpay/verify')[0].body).toEqual(callback);
  await verification.fulfill({ json: {} });
  await expect(page.getByRole('status').filter({ hasText: 'Subscription confirmed.' })).toBeVisible();
  expect(refreshes).toBe(2);
  await expect(page.getByRole('region', { name: 'Your current access' })).toContainText('You’re on Plus');
});

test('dismissed and failed payments stay Free and pending checkout can be resumed or cancelled', async ({ page }) => {
  const state = await fixture(page); await openPlans(page);
  await planCard(page, 'Plus').getByRole('button').click();
  await expect.poll(() => page.evaluate(() => window.__paymentSDK?.opens)).toBe(1);
  await page.evaluate(() => window.__paymentSDK.instances.at(-1).options.modal.ondismiss());
  await expect(page.getByRole('status').filter({ hasText: 'Checkout closed.' })).toBeVisible();
  await expect(planCard(page, 'Plus').getByRole('button', { name: 'Finish checkout' })).toBeEnabled();
  await planCard(page, 'Plus').getByRole('button').click();
  await expect.poll(() => page.evaluate(() => window.__paymentSDK.opens)).toBe(2);
  await page.evaluate(() => window.__paymentSDK.instances.at(-1).events['payment.failed']({ error: { description: 'Synthetic bank rejection' } }));
  await expect(page.getByRole('alert')).toContainText('Payment could not be completed.');
  expect(callsTo(state, '/billing/razorpay/verify')).toHaveLength(0);
  await expect(page.getByRole('region', { name: 'Your current access' })).toContainText('You’re on Free');
  await page.getByRole('button', { name: 'Cancel checkout', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Confirm subscription cancellation' })).toContainText('Cancel this checkout?');
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pending checkout cancelled.' })).toBeVisible();
  await expect(planCard(page, 'Plus').getByRole('button', { name: 'Choose Plus' })).toBeEnabled();
});

test('checkout and verification API failures surface clearly without granting access', async ({ page }) => {
  const state = await fixture(page);
  state.handlers['/api/v1/billing/checkout'] = route => route.fulfill({ status: 503, json: { detail: 'Payments are temporarily unavailable.' } });
  await openPlans(page); await planCard(page, 'Plus').getByRole('button').click();
  await expect(page.getByRole('alert')).toContainText('Payments are temporarily unavailable.');
  expect(state.scriptRequests).toBe(0);
  delete state.handlers['/api/v1/billing/checkout'];
  state.handlers['/api/v1/billing/razorpay/verify'] = route => route.fulfill({ status: 422, json: { detail: 'Payment verification failed.' } });
  await expect(planCard(page, 'Plus').getByRole('button')).toBeEnabled();
  await planCard(page, 'Plus').getByRole('button').click();
  await expect.poll(() => page.evaluate(() => window.__paymentSDK?.opens)).toBe(1);
  await completeCheckout(page);
  await expect(page.getByRole('alert')).toContainText('Payment verification failed.');
  expect(callsTo(state, '/billing/refresh')).toHaveLength(0);
  await expect(page.getByRole('region', { name: 'Your current access' })).toContainText('You’re on Free');
});

test('Razorpay renewal cancellation requires confirmation and retains paid-period access', async ({ page }) => {
  const state = await fixture(page);
  state.billing.subscription = paidSubscription(); Object.assign(state.user, { effective_plan: 'plus', plan_name: 'Plus', modules: plus });
  await openPlans(page);
  await expect(planCard(page, 'Pro').getByRole('button')).toBeDisabled();
  await expect(page.getByText('To change plans, cancel renewal below and choose another plan after your current paid period ends.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel renewal', exact: true }).click();
  expect(callsTo(state, '/billing/cancel')).toHaveLength(0);
  await page.getByRole('button', { name: 'Keep subscription' }).click();
  await page.getByRole('button', { name: 'Cancel renewal', exact: true }).click();
  await mkdir('artifacts/payments', { recursive: true });
  await page.locator('main').evaluate(element => element.focus({ preventScroll: true }));
  await page.evaluate(async () => { window.scrollTo(0, 0); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await page.screenshot({ path: 'artifacts/payments/cancel-renewal-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('group', { name: 'Confirm subscription cancellation' }).scrollIntoViewIfNeeded();
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => item.id)).toEqual([]);
  await mkdir('artifacts/payments', { recursive: true });
  await page.locator('main').evaluate(element => element.focus({ preventScroll: true }));
  await page.screenshot({ path: 'artifacts/payments/cancel-renewal-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cancellation confirmed.' })).toBeVisible();
  expect(callsTo(state, '/billing/cancel')).toHaveLength(1);
  await expect(page.getByRole('region', { name: 'Your current access' })).toContainText('You’re on Plus');
  expect(callsTo(state, '/billing/portal')).toHaveLength(0);
});

for (const provider of ['razorpay', 'stripe']) {
  test(`unavailable ${provider} checkout explains owner setup and keeps purchases disabled`, async ({ page }) => {
    const state = await fixture(page);
    state.plans.billing_provider = provider; state.plans.billing_available = false;
    for (const plan of state.plans.items) plan.checkout_available = false;
    state.billing = { provider, configured: false, subscription: null };
    await openPlans(page);
    const providerName = provider === 'razorpay' ? 'Razorpay' : 'Stripe';
    await expect(page.getByText(`Payments aren’t set up yet. The app owner needs to finish ${providerName} setup before you can subscribe. Your current access remains available.`, { exact: true })).toBeVisible();
    for (const name of ['Plus', 'Pro']) await expect(planCard(page, name).getByRole('button', { name: 'Not available yet', exact: true })).toBeDisabled();
    expect(callsTo(state, '/billing/checkout')).toHaveLength(0);
    expect(state.scriptRequests).toBe(0);
  });
}

test('legacy Stripe billing stays usable when new Razorpay checkout is unavailable', async ({ page }) => {
  const state = await fixture(page);
  state.billing = { provider: 'stripe', configured: true, subscription: paidSubscription() };
  state.plans.billing_available = false; for (const plan of state.plans.items) plan.checkout_available = false;
  Object.assign(state.user, { effective_plan: 'plus', plan_name: 'Plus', modules: plus, subscription_status: 'active' });
  await openPlans(page);
  await expect(page.getByText('The app owner needs to finish Razorpay setup', { exact: false })).toBeVisible();
  await expect(planCard(page, 'Pro').getByRole('button', { name: 'Change plan in billing' })).toBeEnabled();
  await page.getByRole('button', { name: 'Manage billing', exact: true }).click();
  await expect(page).toHaveURL('https://billing.stripe.com/p/session/synthetic');
  expect(callsTo(state, '/billing/portal')).toHaveLength(1);
  expect(callsTo(state, '/billing/checkout')).toHaveLength(0);
});

test('account switching closes checkout and ignores its late success callback', async ({ page }) => {
  const state = await fixture(page); await openPlans(page);
  await planCard(page, 'Plus').getByRole('button').click();
  await expect.poll(() => page.evaluate(() => window.__paymentSDK?.opens)).toBe(1);
  state.user = { ...state.user, id: 'different-synthetic-admin', role: 'admin', name: 'Another account', modules: all };
  state.billing.subscription = null;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('region', { name: 'Your current access' })).toContainText('Administrator · all modules included');
  await expect(page.getByRole('region', { name: 'Your current access' })).toContainText('To test a payment, use a regular account after payment setup is complete.');
  await expect.poll(() => page.evaluate(() => window.__paymentSDK.closes)).toBe(1);
  await completeCheckout(page);
  expect(callsTo(state, '/billing/razorpay/verify')).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Included in your access', exact: true })).toHaveCount(3);
  for (const button of await page.getByRole('button', { name: 'Included in your access', exact: true }).all()) await expect(button).toBeDisabled();
});

test('administrators edit Razorpay plan IDs without losing existing Stripe prices', async ({ page }) => {
  const state = await fixture(page, { administrator: true });
  await page.goto('/#/admin');
  await page.getByLabel('Reason for access', { exact: true }).fill('Synthetic payment configuration review');
  await page.getByRole('button', { name: 'Open administration', exact: true }).click();
  await expect(page.getByText('Razorpay handles new subscriptions.', { exact: false })).toBeVisible();
  const form = page.locator('.account-admin-plans form').nth(1);
  await form.getByLabel('Razorpay monthly plan ID', { exact: true }).fill('plan_replacement');
  await form.getByRole('button', { name: 'Save Plus', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Plan updated.' })).toBeVisible();
  const saved = callsTo(state, '/admin/plans/plus').find(call => call.method === 'PUT');
  expect(saved.body.razorpay_plan_id).toBe('plan_replacement'); expect(saved.body.stripe_price_id).toBe('price_plus');
  expect(saved.body.modules).toEqual(plus);
});

test('a blocked checkout script gives a retry path and never verifies a payment', async ({ page }) => {
  const state = await fixture(page); state.sdkFailure = true; await openPlans(page);
  await planCard(page, 'Plus').getByRole('button').click();
  await expect(page.getByRole('alert')).toContainText('Secure checkout could not load.');
  await expect(planCard(page, 'Plus').getByRole('button', { name: 'Finish checkout' })).toBeEnabled();
  expect(callsTo(state, '/billing/razorpay/verify')).toHaveLength(0);
});

test('an active provider status without a verified paid period never claims paid access', async ({ page }) => {
  const state = await fixture(page);
  state.handlers['/api/v1/billing/refresh'] = route => {
    state.billing.subscription = { ...paidSubscription(), current_period_end: null, can_resume_checkout: false };
    return route.fulfill({ json: state.billing });
  };
  await openPlans(page); await planCard(page, 'Plus').getByRole('button').click();
  await expect.poll(() => page.evaluate(() => window.__paymentSDK?.opens)).toBe(1);
  await completeCheckout(page);
  await expect(page.getByRole('status').filter({ hasText: 'Your payment is still being confirmed.' })).toBeVisible({ timeout: 12000 });
  expect(callsTo(state, '/billing/refresh')).toHaveLength(5);
  await expect(page.getByRole('region', { name: 'Your current access' })).toContainText('You’re on Free');
  await expect(page.getByRole('region', { name: 'Subscription and payments' })).toContainText('Payment confirmation pending');
  await expect(page.getByRole('status').filter({ hasText: 'Subscription confirmed.' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh billing', exact: true })).toBeEnabled();
});

test('a definitively rejected checkout creation is retryable', async ({ page }) => {
  const state = await fixture(page);
  state.handlers['/api/v1/billing/checkout'] = route => {
    state.billing.subscription = { ...paidSubscription(), status: 'creation_failed', current_period_end: null, can_cancel: false, can_resume_checkout: false };
    return route.fulfill({ status: 502, json: { detail: 'Checkout could not be created. Please try again.' } });
  };
  await openPlans(page); await planCard(page, 'Plus').getByRole('button').click();
  await expect(page.getByRole('alert')).toContainText('Checkout could not be created.');
  await expect(planCard(page, 'Plus').getByRole('button', { name: 'Choose Plus' })).toBeEnabled();
  delete state.handlers['/api/v1/billing/checkout']; state.billing.subscription = null;
  await planCard(page, 'Plus').getByRole('button').click();
  await expect.poll(() => page.evaluate(() => window.__paymentSDK?.opens)).toBe(1);
  expect(callsTo(state, '/billing/checkout')).toHaveLength(2);
});

test('uncertain cancellation never claims success or permits another cancellation or checkout', async ({ page }) => {
  const state = await fixture(page);
  state.billing.subscription = paidSubscription(); Object.assign(state.user, { effective_plan: 'plus', plan_name: 'Plus', modules: plus });
  state.handlers['/api/v1/billing/cancel'] = route => {
    state.billing.subscription.cancellation_pending = true;
    return route.fulfill({ status: 503, json: { detail: 'The billing service is checking your cancellation.' } });
  };
  await openPlans(page); await page.getByRole('button', { name: 'Cancel renewal', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cancellation is being confirmed.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel renewal', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Confirm cancellation', exact: true })).toHaveCount(0);
  await expect(planCard(page, 'Pro').getByRole('button')).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Cancellation confirmed.' })).toHaveCount(0);
  expect(callsTo(state, '/billing/cancel')).toHaveLength(1);
});

test('administrator-managed plans cannot purchase but can manage existing paid billing', async ({ page }) => {
  const state = await fixture(page);
  Object.assign(state.user, { plan_source: 'admin', effective_plan: 'plus', plan_name: 'Plus', modules: plus });
  state.billing.subscription = paidSubscription();
  await openPlans(page);
  await expect(page.getByText('Your plan is managed by an administrator. Contact them before purchasing.', { exact: true })).toBeVisible();
  await expect(planCard(page, 'Pro').getByRole('button', { name: 'Managed by administrator' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel renewal', exact: true })).toBeEnabled();
  expect(callsTo(state, '/billing/checkout')).toHaveLength(0);
});

test('an empty historical Stripe customer does not prevent a new Razorpay subscription', async ({ page }) => {
  const state = await fixture(page);
  state.billing = { provider: 'stripe', configured: true, subscription: { status: 'none', plan_slug: 'free', plan_name: 'Free', current_period_end: null, can_cancel: false, can_resume_checkout: false } };
  await openPlans(page);
  await expect(planCard(page, 'Plus').getByRole('button', { name: 'Choose Plus' })).toBeEnabled();
  await planCard(page, 'Plus').getByRole('button').click();
  await expect.poll(() => page.evaluate(() => window.__paymentSDK?.opens)).toBe(1);
  expect(callsTo(state, '/billing/checkout')).toHaveLength(1);
  expect(callsTo(state, '/billing/portal')).toHaveLength(0);
});

test('checkout waits for billing status and stays disabled while a failed status load retries', async ({ page }) => {
  const state = await fixture(page); let pendingStatus;
  state.handlers['/api/v1/billing/status'] = route => { pendingStatus = route; };
  await page.goto('/#/plans');
  await expect(planCard(page, 'Plus').getByRole('button', { name: 'Choose Plus' })).toBeDisabled();
  await expect.poll(() => Boolean(pendingStatus)).toBe(true);
  await pendingStatus.fulfill({ status: 503, json: { detail: 'Subscription status is temporarily unavailable.' } });
  await expect(page.getByRole('alert')).toContainText('Billing status could not load.');
  pendingStatus = null;
  await page.getByRole('button', { name: 'Retry billing', exact: true }).click();
  await expect.poll(() => Boolean(pendingStatus)).toBe(true);
  await expect(planCard(page, 'Plus').getByRole('button', { name: 'Choose Plus' })).toBeDisabled();
  await pendingStatus.fulfill({ json: state.billing });
  await expect(planCard(page, 'Plus').getByRole('button', { name: 'Choose Plus' })).toBeEnabled();
  expect(callsTo(state, '/billing/checkout')).toHaveLength(0);
});
