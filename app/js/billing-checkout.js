// Checkout is loaded only after the user chooses a paid plan. Subscription
// access is always decided by the API; this module only collects its response.
const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
let loading;

export function waitForBilling(milliseconds, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, milliseconds);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

function loadCheckout() {
  if (typeof window.Razorpay === 'function') return Promise.resolve(window.Razorpay);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let timer;
    const failed = () => {
      clearTimeout(timer); script.remove(); loading = null;
      reject(new Error('Secure checkout could not load. Check your connection and try again.'));
    };
    script.src = CHECKOUT_SCRIPT; script.async = true;
    script.addEventListener('load', () => {
      clearTimeout(timer);
      if (typeof window.Razorpay === 'function') resolve(window.Razorpay); else failed();
    }, { once: true });
    script.addEventListener('error', failed, { once: true });
    timer = setTimeout(failed, 15000);
    document.head.append(script);
  });
  return loading;
}

export async function openRazorpayCheckout(checkout, signal) {
  signal.throwIfAborted();
  const Razorpay = await new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    loadCheckout().then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
  signal.throwIfAborted();
  if (!checkout.key_id || !checkout.subscription_id) throw new Error('Checkout is missing its subscription details. Please refresh billing.');
  return new Promise((resolve, reject) => {
    let instance, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', aborted);
      if (error) { try { instance?.close(); } catch { /* Still reject when provider cleanup fails. */ } reject(error); } else resolve(value);
    };
    const aborted = () => finish(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    try {
      instance = new Razorpay({
        key: checkout.key_id, subscription_id: checkout.subscription_id,
        name: checkout.name || 'Morrow', description: checkout.description || checkout.plan_name,
        prefill: checkout.prefill || {}, theme: { color: '#b9a5ff' }, retry: { enabled: false },
        handler: response => {
          if (signal.aborted) return;
          if (!response?.razorpay_payment_id || !response.razorpay_signature || response.razorpay_subscription_id !== checkout.subscription_id) {
            finish(new Error('The payment response could not be verified. Refresh billing before trying again.')); return;
          }
          finish(null, { razorpay_payment_id: response.razorpay_payment_id,
            razorpay_subscription_id: response.razorpay_subscription_id, razorpay_signature: response.razorpay_signature });
        },
        modal: { ondismiss: () => finish(Object.assign(new Error('Checkout closed. If you completed a payment, refresh billing to check its status.'), { code: 'checkout_cancelled' })) },
      });
      instance.on('payment.failed', () => finish(new Error('Payment could not be completed. Refresh billing before trying again.')));
      instance.open();
    } catch (error) { finish(error); }
  });
}

export function stripeDestination(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) {
    throw new Error('The billing service returned an invalid checkout address. Please try again.');
  }
  return url.href;
}
