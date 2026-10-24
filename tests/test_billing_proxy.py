"""Signed webhook bytes and headers must survive the dashboard boundary."""

from test_account_proxy import account_dashboard as account_dashboard
from test_account_proxy import request


def test_razorpay_signature_and_original_body_reach_api(account_dashboard):
    raw = b'{ "event": "subscription.charged", "payload": {} }\n'
    request(
        account_dashboard,
        "/api/v1/billing/razorpay/webhook",
        method="POST",
        body=raw,
        headers={
            "Content-Type": "application/json",
            "X-Razorpay-Signature": "synthetic-test-signature",
            "X-Razorpay-Event-Id": "evt_synthetic",
        },
    )
    forwarded = account_dashboard.backend.received[-1]
    assert forwarded["path"] == "/api/v1/billing/razorpay/webhook"
    assert forwarded["method"] == "POST"
    assert forwarded["body"] == raw
    assert forwarded["headers"]["X-Razorpay-Signature"] == "synthetic-test-signature"
    assert forwarded["headers"]["X-Razorpay-Event-Id"] == "evt_synthetic"
