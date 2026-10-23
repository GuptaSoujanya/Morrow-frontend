"""The dashboard adapter must never fall back to the shared local workspace."""

import copy
import io
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tenant_api import TenantAPI, now


class Handler:
    def __init__(self, body=None):
        self.headers = {"Cookie": "morrow_session=alice", "X-CSRF-Token": "alice-csrf"}
        self.payload = body
        self.result = None
        self.status = None
        self.response_headers = {}
        self.wfile = io.BytesIO()

    def json(self, value):
        self.status, self.result = 200, value

    def error(self, status, message):
        self.status, self.result = status, message

    def body(self):
        return self.payload

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.response_headers[name] = value

    def end_headers(self):
        pass


class Bridge:
    def __init__(self):
        self.profile = {
            "version": 1,
            "data": {"name": "Alice"},
            "updated_at": now().isoformat(),
        }
        self.items = {"applications": [], "artifacts": [], "records": []}
        self.content = {}
        self.calls = []

    def request(self, handler, path, method="GET", body=None, headers=None):
        assert handler.headers["Cookie"] == "morrow_session=alice"
        self.calls.append((path, method, body))
        url = urlsplit(path)
        query = parse_qs(url.query)
        if url.path == "/api/v1/profile":
            if method == "PUT":
                assert handler.headers["X-CSRF-Token"] == "alice-csrf"
                payload = json.loads(body)
                if payload["expected_version"] != self.profile["version"]:
                    return (
                        409,
                        [],
                        b'{"detail":"Profile changed. Reload before saving."}',
                    )
                self.profile = {
                    "version": self.profile["version"] + 1,
                    "data": payload["data"],
                }
            value = copy.deepcopy(self.profile)
        elif url.path.endswith("/content"):
            identifier = url.path.split("/")[-2]
            return 200, [], self.content[identifier]
        elif method == "PUT" and url.path.startswith("/api/v1/records/"):
            collection, key = url.path.split("/")[-2:]
            value = {
                "collection": collection,
                "key": key,
                "data": json.loads(body)["data"],
            }
            self.items["records"] = [
                r
                for r in self.items["records"]
                if (r["collection"], r.get("key")) != (collection, key)
            ] + [value]
        else:
            endpoint = url.path.split("/")[-1]
            rows = self.items[endpoint]
            if endpoint == "records" and "collection" in query:
                rows = [r for r in rows if r["collection"] == query["collection"][0]]
            offset, limit = (
                int(query.get("offset", [0])[0]),
                int(query.get("limit", [100])[0]),
            )
            value = {"items": copy.deepcopy(rows[offset : offset + limit])}
        return 200, [("Content-Type", "application/json")], json.dumps(value).encode()


def adapter(bridge, body=None, modules=None):
    handler = Handler(body)
    return TenantAPI(
        bridge,
        handler,
        {
            "name": "Alice",
            "email": "alice@example.test",
            "modules": modules
            or ["profile", "files", "applications", "learning", "research"],
        },
    ), handler


def artifact(bridge, name, body, media="text/markdown", category="legacy"):
    identifier = str(uuid4())
    bridge.items["artifacts"].append(
        {
            "id": identifier,
            "filename": name,
            "media_type": media,
            "category": category,
            "size_bytes": len(body),
            "created_at": now().isoformat(),
        }
    )
    bridge.content[identifier] = body
    return identifier


def application(job_id="hirist:123", status="applied_platform", **kwargs):
    return {
        "id": str(uuid4()),
        "external_job_id": job_id,
        "platform": "legacy",
        "status": status,
        "title": "",
        "company": "",
        "url": "",
        "detail": "",
        "occurred_at": now().isoformat(),
        "metadata": {},
        **kwargs,
    }


def test_bootstrap_contains_account_identity_and_no_shared_paths():
    bridge = Bridge()
    api, handler = adapter(bridge)
    for endpoint in ("meta", "status", "course"):
        assert api.handle("GET", "/api/" + endpoint, {})
        assert handler.status == 200
        serialized = json.dumps(handler.result)
        assert "/Users/" not in serialized and "data/inputs" not in serialized
    assert api.status({})["name"] == "Alice"
    assert api.course({})["tracks"] == []
    assert api.status({})["run"]["available"] is False
    assert not bridge.calls  # Bootstrap cannot read the legacy filesystem or runner.


def test_private_records_join_jobs_filter_sort_and_never_count_a_different_collection():
    bridge = Bridge()
    bridge.items["records"] = [
        {
            "collection": "legacy_jobs_seen",
            "data": {
                "job_id": "hirist:123",
                "title": "Platform engineer",
                "company": "Tenant company",
                "url": "https://jobs.test/123",
                "first_seen": now().isoformat(),
                "score": 93,
                "source": "hirist:search:platform",
            },
        },
        {
            "collection": "research",
            "data": {"job_id": "secret", "title": "Not an application"},
        },
    ]
    bridge.items["applications"] = [
        application(),
        application(
            job_id="naukri:2",
            status="abstained",
            title="Different role",
            url="javascript:alert(1)",
        ),
    ]
    api, handler = adapter(bridge)
    assert api.handle(
        "GET",
        "/api/records",
        {"days": "0", "q": "Tenant", "outcome": "submitted", "board": "hirist"},
    )
    assert handler.result["total"] == 1
    row = handler.result["rows"][0]
    assert row["title"] == "Platform engineer" and row["score"] == 93
    assert row["kind"] == "sent" and row["board"] == "hirist"
    assert api.applications()[1]["url"] == ""
    jobs = api.records({"kind": "jobs", "days": "0"})
    assert jobs["rows"][0]["status"] == "applied_platform"
    assert len(jobs["rows"]) == 1


def test_backend_pagination_is_complete_before_dashboard_filters():
    bridge = Bridge()
    bridge.items["applications"] = [
        application(job_id=f"hirist:{n}", title="Target" if n == 129 else "Other")
        for n in range(130)
    ]
    api, handler = adapter(bridge)
    api.handle("GET", "/api/records", {"q": "Target", "days": "0"})
    assert handler.result["total"] == 1
    assert handler.result["rows"][0]["job_id"] == "hirist:129"
    assert any("offset=100" in path for path, _, _ in bridge.calls)


def test_overview_uses_only_recorded_events_and_has_no_fabricated_automation():
    bridge = Bridge()
    bridge.items["applications"] = [application(), application(status="abstained")]
    api, handler = adapter(bridge)
    api.handle("GET", "/api/overview", {"days": "7"})
    result = handler.result
    assert result["sent"]["total"] == 1 and result["attempts"] == 2
    assert sum(r["waiting"] for r in result["daily"]) == 1
    assert result["quota"]["limit"] is None and result["quota"]["configured"] is False
    assert result["runs"] == [] and result["workspace"]["pipeline"]["stages"] == []
    assert result["automation_available"] is False


def test_profile_and_text_files_use_one_optimistic_version_and_hide_internal_fields():
    bridge = Bridge()
    bridge.profile["data"]["_dashboard_files"] = {"answers": "Private screening answer"}
    api, handler = adapter(bridge)
    api.handle("GET", "/api/file", {"name": "profile"})
    assert handler.result["revision"] == "1"
    assert "_dashboard_files" not in handler.result["text"]
    assert "Private screening answer" not in handler.result["text"]
    api, handler = adapter(
        bridge, {"name": "profile", "text": "name: Alice Updated\n", "revision": "1"}
    )
    api.handle("POST", "/api/file", {})
    assert handler.status == 200 and handler.result["revision"] == "2"
    assert (
        bridge.profile["data"]["_dashboard_files"]["answers"]
        == "Private screening answer"
    )
    api, handler = adapter(
        bridge, {"name": "answers", "text": "Stale overwrite", "revision": "1"}
    )
    api.handle("POST", "/api/file", {})
    assert handler.status == 409
    assert (
        bridge.profile["data"]["_dashboard_files"]["answers"]
        == "Private screening answer"
    )


def test_imported_answers_can_be_opened_and_saved_without_reading_source_file():
    bridge = Bridge()
    artifact(bridge, "answers.txt", b"Imported tenant answer", "text/plain")
    api, handler = adapter(bridge)
    api.handle("GET", "/api/file", {"name": "answers"})
    assert handler.result["text"] == "Imported tenant answer"
    api, handler = adapter(
        bridge, {"name": "answers", "text": "Updated tenant answer", "revision": "1"}
    )
    api.handle("POST", "/api/file", {})
    assert handler.status == 200
    assert (
        bridge.profile["data"]["_dashboard_files"]["answers"] == "Updated tenant answer"
    )


@pytest.mark.parametrize("name", ["env", "../../.env", "cookies", "/etc/passwd"])
def test_server_credentials_and_paths_are_not_workspace_files(name):
    api, handler = adapter(Bridge())
    api.handle("GET", "/api/file", {"name": name})
    assert handler.status == 403
    assert api.bridge.calls == []


def test_download_requires_listed_tenant_artifact_and_forces_active_content_attachment():
    bridge = Bridge()
    identifier = artifact(
        bridge, "note.html", b"<script>alert(1)</script>", "text/html"
    )
    api, handler = adapter(bridge)
    api.handle("GET", "/api/resume-file", {"file": str(uuid4()), "preview": "1"})
    assert handler.status == 404 and not handler.wfile.getvalue()
    api, handler = adapter(bridge)
    api.handle("GET", "/api/resume-file", {"file": identifier, "preview": "1"})
    assert handler.response_headers["Content-Type"] == "application/octet-stream"
    assert handler.response_headers["Content-Disposition"].startswith("attachment;")
    assert handler.response_headers["Cache-Control"] == "no-store"
    assert handler.wfile.getvalue() == bridge.content[identifier]

    api, handler = adapter(bridge)
    handler.command = "HEAD"
    api.handle("GET", "/api/resume-file", {"file": identifier})
    assert handler.status == 200
    assert handler.wfile.getvalue() == b""
    assert handler.response_headers["Content-Length"] == str(
        len(bridge.content[identifier])
    )


def test_reader_escapes_html_omits_images_and_rejects_internal_paths():
    bridge = Bridge()
    identifier = artifact(
        bridge,
        "research.md",
        b"# Private note\n<script>alert(1)</script>\n\n![secret](https://tracker.test/pixel)\n\n[local](../../.env) [external](https://docs.test)",
    )
    api, handler = adapter(bridge)
    api.handle("GET", "/api/document", {"id": "artifact/" + identifier})
    rendered = handler.result["html"]
    assert (
        "<script>" not in rendered
        and "<img" not in rendered
        and "tracker.test" not in rendered
    )
    assert 'href="#"' in rendered and 'rel="noopener noreferrer"' in rendered
    api.handle("GET", "/api/document", {"id": "research/../../.env"})
    assert handler.status == 404


def test_reading_progress_is_written_through_authenticated_backend():
    bridge = Bridge()
    identifier = artifact(bridge, "research.md", b"# Read me")
    api, handler = adapter(bridge, {"id": "artifact/" + identifier, "read": True})
    api.handle("POST", "/api/research/read", {})
    assert handler.status == 200 and handler.result["read"] is True
    api, handler = adapter(bridge)
    api.handle("GET", "/api/research/learning", {})
    assert handler.result["notes_read"] == 1
    assert len(handler.result["completed_today"]) == 1
    assert handler.result["history"]["items"] == []  # No invented event history.


def test_backend_denial_stays_denied_and_unsupported_routes_never_fall_back():
    bridge = Bridge()
    bridge.request = lambda *args, **kwargs: (
        403,
        [],
        b'{"detail":{"message":"Plan required"}}',
    )
    api, handler = adapter(bridge)
    api.handle("GET", "/api/records", {})
    assert handler.status == 403 and handler.result == "Plan required"
    for path in ("/api/preview", "/api/run", "/api/action", "/api/schedules"):
        assert api.handle("POST", path, {}) is False


def test_invalid_profile_and_filters_produce_reviewable_errors():
    bridge = Bridge()
    api, handler = adapter(
        bridge, {"name": "profile", "text": "- list\n- not mapping", "revision": "1"}
    )
    api.handle("POST", "/api/file", {})
    assert handler.status == 400
    assert not any(method == "PUT" for _, method, _ in bridge.calls)
    for query in ({"days": "-1"}, {"page": "0"}, {"kind": "secrets"}, {"sort": "sql"}):
        api, handler = adapter(Bridge())
        api.handle("GET", "/api/records", query)
        assert handler.status == 400
