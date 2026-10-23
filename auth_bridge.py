"""Same-origin account API proxy and explicit local-runner authorization."""
import http.client
import json
from urllib.parse import urlsplit


class BackendError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class AccountBridge:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.url = urlsplit(self.base)
        if (self.url.scheme not in ("http", "https") or not self.url.hostname
                or self.url.query or self.url.fragment or self.url.path
                or self.url.username or self.url.password):
            raise ValueError("MORROW_API_URL must be an HTTP(S) service origin")

    def request(self, handler, path, method="GET", body=None, headers=None):
        if not path.startswith("/api/v1/") or "\r" in path or "\n" in path:
            raise ValueError("Choose a supported account API path")
        forwarded = {key: handler.headers[key] for key in (
            "Cookie", "Authorization", "Content-Type", "Accept", "Origin",
            "X-CSRF-Token", "X-Admin-Reason", "Stripe-Signature", "Idempotency-Key",
        ) if handler.headers.get(key)}
        forwarded.update(headers or {})
        connection_type = http.client.HTTPSConnection if self.url.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(self.url.hostname, self.url.port, timeout=30)
        try:
            connection.request(method, path, body=body, headers=forwarded)
            response = connection.getresponse()
            return response.status, response.getheaders(), response.read()
        finally:
            connection.close()

    def json_request(self, handler, path, method="GET", data=None):
        body = None if data is None else json.dumps(data).encode()
        status, _, raw = self.request(handler, path, method, body, {"Content-Type": "application/json"})
        result = json.loads(raw or b"{}")
        if status >= 400:
            detail = result.get("detail", "The account service could not complete this request")
            raise BackendError(status, detail if isinstance(detail, str) else "Check the submitted fields")
        return result

    def identity(self, handler):
        try:
            return self.json_request(handler, "/api/v1/me")
        except BackendError as exc:
            if exc.status in (401, 403):
                return None
            raise

    @staticmethod
    def is_owner(handler, user):
        owner = getattr(handler.server, "workspace_owner_email", "")
        return bool(owner and user and user["role"] == "admin" and user["email"].lower() == owner.lower())

    @staticmethod
    def send_backend(handler, reply):
        status, headers, body = reply
        handler.send_response(status)
        skip = {"connection", "transfer-encoding", "keep-alive", "content-length", "server", "date"}
        for key, value in headers:
            if key.lower() not in skip:
                handler.send_header(key, value)
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        if handler.command != "HEAD":
            handler.wfile.write(body)

    def proxy(self, handler):
        if handler.headers.get("Transfer-Encoding"):
            handler.error(400, "Send a Content-Length for uploads")
            return
        try:
            length = int(handler.headers.get("Content-Length", "0"))
        except ValueError:
            handler.error(400, "Invalid Content-Length")
            return
        if not 0 <= length <= 10 * 1024 * 1024:
            handler.error(413, "Request exceeds the 10 MB limit")
            return
        body = handler.rfile.read(length) if length else None
        try:
            self.send_backend(handler, self.request(handler, handler.path, handler.command, body))
        except (OSError, http.client.HTTPException):
            handler.error(503, "The account service is unavailable. Try again shortly.")

    def guard(self, handler):
        """Protect owner-only legacy handlers; account UI uses the shared shell."""
        try:
            user = self.identity(handler)
        except (OSError, BackendError, http.client.HTTPException):
            handler.error(503, "The account service is unavailable. Try again shortly.")
            return True
        if user is None:
            handler.error(401, "Sign in to your Morrow account first.")
            return True
        if not self.is_owner(handler, user):
            handler.error(403, "This local automation is available only to its workspace owner.")
            return True
        return False
