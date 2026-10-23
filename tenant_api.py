"""Adapt the existing dashboard screens to the authenticated account API.

There are deliberately no imports of web.state, paths, environment settings or the
legacy Runner here. Every record and file is fetched using the requesting account's
session. This keeps the existing presentation while replacing its data boundary.
"""

import datetime as dt
import hashlib
import html
import json
import math
from collections import Counter
from urllib.parse import quote, urlencode, urlsplit
from uuid import UUID

import yaml

SUBMITTED = {"applied", "applied_platform", "applied_external"}
WAITING = {"external_manual", "abstained"}
SKIPPED = {"already_applied", "external_skipped", "no_apply_button", "not_attempted"}
BOARDS = {"all", "naukri", "hirist", "instahyre", "cutshort", "wellfound", "external"}
FILE_NAMES = {
    "profile": "profile.yaml",
    "answers": "answers.txt",
    "company_sites": "company_sites.md",
}
MAX_RECORDS = 20000
MIN_SCORE = 70


class TenantError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def now():
    return dt.datetime.now(dt.UTC)


def integer(value, default, low, high):
    try:
        result = int(default if value in (None, "") else value)
    except (TypeError, ValueError):
        raise TenantError(400, "Use whole numbers for period and pagination.") from None
    if not low <= result <= high:
        raise TenantError(400, f"Value must be between {low} and {high}.")
    return result


def moment(value):
    try:
        parsed = dt.datetime.fromisoformat(str(value))
        return parsed.replace(tzinfo=dt.UTC) if parsed.tzinfo is None else parsed
    except (TypeError, ValueError):
        return None


def kind(status):
    return (
        "sent"
        if status in SUBMITTED
        else "waiting"
        if status in WAITING
        else "skipped"
        if status in SKIPPED
        else "failed"
    )


def board(job_id, platform=""):
    if platform and platform != "legacy":
        return platform
    return str(job_id).split(":", 1)[0] if ":" in str(job_id) else "naukri"


def number(value):
    return (
        value
        if isinstance(value, (float, int))
        and not isinstance(value, bool)
        and math.isfinite(value)
        else None
    )


def idle_run():
    return {
        "running": False,
        "label": "",
        "shown": "",
        "action": "",
        "seconds": 0,
        "stopping": False,
        "last": None,
        "next": 0,
        "lines": [],
        "available": False,
    }


def page(rows, params, key, size=12):
    count = len(rows)
    size = integer(params.get("size"), size, 1, 100)
    pages = max(1, (count + size - 1) // size)
    selected = min(integer(params.get("page"), 1, 1, 1000000), pages)
    return {
        key: rows[(selected - 1) * size : selected * size],
        "total": count,
        "page": selected,
        "pages": pages,
        "size": size,
    }


class TenantAPI:
    def __init__(self, bridge, handler, user):
        self.bridge, self.handler, self.user = bridge, handler, user
        self._cache = {}

    def request(self, path, method="GET", data=None):
        body = None if data is None else json.dumps(data, allow_nan=False).encode()
        status, _headers, content = self.bridge.request(
            self.handler,
            path,
            method=method,
            body=body,
            headers={"Content-Type": "application/json"} if body is not None else None,
        )
        if status >= 400:
            try:
                detail = json.loads(content).get(
                    "detail", "The account service could not complete this request."
                )
                if isinstance(detail, dict):
                    detail = detail.get(
                        "message", "Your plan does not include this module."
                    )
                if not isinstance(detail, str):
                    detail = "The account service could not complete this request."
            except (ValueError, AttributeError):
                detail = "The account service could not complete this request."
            raise TenantError(status, detail)
        return content

    def json(self, path, method="GET", data=None):
        try:
            return json.loads(self.request(path, method, data))
        except (ValueError, UnicodeDecodeError) as exc:
            if isinstance(exc, TenantError):
                raise
            raise TenantError(
                502, "The account service returned an unreadable response."
            ) from None

    def all(self, endpoint, collection=None):
        cache_key = (endpoint, collection)
        if cache_key not in self._cache:
            rows = []
            for offset in range(0, MAX_RECORDS + 100, 100):
                query = {"limit": 100, "offset": offset}
                if collection:
                    query["collection"] = collection
                batch = self.json("/api/v1/" + endpoint + "?" + urlencode(query)).get(
                    "items", []
                )
                rows.extend(batch)
                if len(rows) > MAX_RECORDS:
                    raise TenantError(
                        413,
                        "This collection is too large for this dashboard view. Use the paginated account API to export it.",
                    )
                if len(batch) < 100:
                    break
            self._cache[cache_key] = rows
        return self._cache[cache_key]

    def profile(self):
        if "profile" not in self._cache:
            self._cache["profile"] = self.json("/api/v1/profile")
        return self._cache["profile"]

    def handle(self, method, path, query, *, data=None):
        gets = {
            "/api/meta": self.meta,
            "/api/status": self.status,
            "/api/course": self.course,
            "/api/overview": self.overview,
            "/api/records": self.records,
            "/api/file": self.file,
            "/api/data": self.inventory,
            "/api/library": self.library,
            "/api/document": self.document,
            "/api/research/learning": self.learning,
        }
        if method == "GET" and path == "/api/resume-file":
            try:
                self.download(query)
            except TenantError as exc:
                self.handler.error(exc.status, str(exc))
            return True
        if method == "GET" and path in gets:
            try:
                self.handler.json(gets[path](query))
            except TenantError as exc:
                self.handler.error(exc.status, str(exc))
            return True
        if method == "POST" and path in ("/api/file", "/api/research/read"):
            try:
                if data is None:
                    data = self.handler.body()
                if not isinstance(data, dict):
                    raise TenantError(400, "Send a JSON object.")
                result = (
                    self.save_file(data)
                    if path == "/api/file"
                    else self.mark_read(data)
                )
                self.handler.json(result)
            except TenantError as exc:
                self.handler.error(exc.status, str(exc))
            return True
        return False

    def meta(self, query):
        return {
            "answer_modes": [],
            "linkedin_modes": [],
            "files": {
                key: "Private workspace / " + name for key, name in FILE_NAMES.items()
            },
            "apply": "Private workspace",
            "course": "/course/",
            "storage": "account",
            "account": self.user,
            "automation_available": False,
        }

    def course(self, query):
        # A shared course directory and another account's progress are never read.
        return {"today": None, "read": 0, "total": 0, "tracks": [], "available": False}

    def status(self, query):
        current = now()
        name = self.user.get("name") or self.user.get("email", "").split("@")[0]
        return {
            "greeting": "Good morning"
            if current.hour < 12
            else "Good afternoon"
            if current.hour < 17
            else "Good evening",
            "name": str(name).split(" ")[0],
            "date": current.date().isoformat(),
            "date_long": current.strftime("%A, %d %B %Y"),
            "report": {"ready": False, "days": []},
            "questions": [],
            "facts": [],
            "sites": [],
            "study": {"today": None, "read": 0, "total": 0},
            "run": idle_run(),
            "storage": "account",
        }

    def jobs(self):
        rows = []
        for record in self.all("records", "legacy_jobs_seen"):
            raw = record["data"]
            source = str(raw.get("source") or "")
            source_board = source.split(":", 1)[0]
            rows.append(
                self.row(
                    {
                        **raw,
                        "at": raw.get("first_seen"),
                        "board": board(raw.get("job_id"))
                        if source_board in ("", "search", "recommended")
                        else source_board,
                    }
                )
            )
        return rows

    def applications(self):
        jobs = {str(row["job_id"]): row for row in self.jobs()}
        result = []
        for item in self.all("applications"):
            metadata = item.get("metadata") or {}
            legacy = metadata.get("legacy") or {}
            job_id = item.get("external_job_id", "")
            job = jobs.get(str(job_id), {})
            result.append(
                self.row(
                    {
                        "id": item["id"],
                        "job_id": job_id,
                        "title": item.get("title") or job.get("title", ""),
                        "company": item.get("company") or job.get("company", ""),
                        "url": item.get("url") or job.get("url", ""),
                        "status": item.get("status"),
                        "detail": item.get("detail", ""),
                        "at": item.get("occurred_at"),
                        "score": metadata.get("score", job.get("score")),
                        "quota_consumed": legacy.get(
                            "quota_consumed", metadata.get("quota_consumed", False)
                        ),
                        "board": board(job_id, item.get("platform")),
                    }
                )
            )
        return result

    @staticmethod
    def row(raw):
        item = dict(raw)
        item["job_id"] = str(item.get("job_id") or "")
        item["status"] = item.get("status") or "not_attempted"
        item["label"] = item["status"].replace("_", " ").capitalize()
        item["kind"] = kind(item["status"])
        item["score"] = number(item.get("score"))
        stamp = moment(item.get("at"))
        item["at"] = stamp.isoformat() if stamp else ""
        url = str(item.get("url") or "")
        parsed = urlsplit(url)
        item["url"] = (
            url if parsed.scheme in ("http", "https") and parsed.netloc else ""
        )
        item.setdefault("board", board(item["job_id"]))
        return item

    def records(self, query):
        record_kind = query.get("kind", "applications")
        if record_kind not in ("applications", "jobs"):
            raise TenantError(400, "Choose applications or jobs.")
        selected_board = query.get("board", "all")
        if selected_board not in BOARDS:
            raise TenantError(400, "Choose a supported board.")
        sort = query.get("sort", "recent")
        if sort not in ("recent", "score"):
            raise TenantError(400, "Choose recent or score sorting.")
        days = integer(query.get("days"), 14, 0, 36500)
        today = now().date()
        start = today - dt.timedelta(days=days - 1) if days else dt.date.min
        outcome = query.get("outcome", "all")
        search = str(query.get("q", "")).strip().casefold()
        rows, statuses = [], set()
        apps = self.applications()
        source = apps if record_kind == "applications" else self.jobs()
        if record_kind == "jobs":
            latest = {}
            for item in sorted(apps, key=lambda r: r["at"]):
                latest[item["job_id"]] = item["status"]
            source = [
                self.row({**r, "status": latest.get(r["job_id"], r["status"])})
                for r in source
            ]
        for item in source:
            date = moment(item["at"])
            if not date or not start <= date.date() <= today:
                continue
            if selected_board != "all" and selected_board != item["board"]:
                continue
            statuses.add(item["status"])
            if outcome == "submitted" and item["status"] not in SUBMITTED:
                continue
            if outcome == "matched" and (
                item["score"] is None or item["score"] < MIN_SCORE
            ):
                continue
            if (
                outcome not in ("all", "submitted", "matched")
                and outcome != item["status"]
            ):
                continue
            if (
                search
                and search
                not in " ".join(
                    str(item.get(k) or "")
                    for k in ("title", "company", "detail", "job_id")
                ).casefold()
            ):
                continue
            rows.append(item)
        rows.sort(
            key=lambda r: (
                ((r["score"] if r["score"] is not None else -1), r["at"])
                if sort == "score"
                else (r["at"], str(r.get("id", "")))
            ),
            reverse=True,
        )
        return {
            **page(rows, query, "rows", 20),
            "kind": record_kind,
            "days": days,
            "statuses": sorted(statuses),
            "updated_at": now().isoformat(),
        }

    def overview(self, query):
        days = integer(query.get("days"), 14, 0, 36500)
        today = now().date()
        apps, jobs = self.applications(), self.jobs()
        dates = [
            stamp.date()
            for item in apps + jobs
            if (stamp := moment(item["at"])) and stamp.date() <= today
        ]
        first = min(dates) if dates else None
        start = (first or today) if days == 0 else today - dt.timedelta(days=days - 1)
        daily = {
            start + dt.timedelta(days=n): {
                "day": (start + dt.timedelta(days=n)).isoformat(),
                **dict.fromkeys(
                    ("naukri", "boards", "company", "waiting", "skipped", "failed"), 0
                ),
            }
            for n in range((today - start).days + 1)
        }
        included = [
            r
            for r in apps
            if (stamp := moment(r["at"])) and start <= stamp.date() <= today
        ]
        selected_jobs = [
            r
            for r in jobs
            if (stamp := moment(r["at"])) and start <= stamp.date() <= today
        ]
        outcomes = Counter(r["status"] for r in included)
        sent = Counter()
        for row in included:
            channel = {
                "applied": "naukri",
                "applied_platform": "boards",
                "applied_external": "company",
            }.get(row["status"], row["kind"])
            daily[moment(row["at"]).date()][channel] += 1
            if row["kind"] == "sent":
                sent[channel] += 1
        scored = [r["score"] for r in selected_jobs if r["score"] is not None]
        bins = Counter(min(19, max(0, int(score // 5))) for score in scored)
        board_rows = []
        for key in sorted({r["board"] for r in selected_jobs + included}):
            items = [r for r in selected_jobs if r["board"] == key]
            scores = [r["score"] for r in items if r["score"] is not None]
            board_rows.append(
                {
                    "key": key,
                    "name": key.title(),
                    "found": len(items),
                    "over": sum(s >= MIN_SCORE for s in scores),
                    "average": round(sum(scores) / len(scores), 1) if scores else None,
                    "sent": sum(
                        r["board"] == key and r["status"] in SUBMITTED for r in included
                    ),
                }
            )
        funnel = {"runs": 0, "steps": [], "dropped": [], "unsent": []}
        cutoff = now() - dt.timedelta(hours=24)
        return {
            "days": days,
            "start": start.isoformat(),
            "end": today.isoformat(),
            "first": first.isoformat() if first else None,
            "min_score": MIN_SCORE,
            "daily": list(daily.values()),
            "sent": {
                "total": sum(sent.values()),
                **{k: sent[k] for k in ("naukri", "boards", "company")},
                "before": None,
            },
            "found": {
                "total": len(selected_jobs),
                "over": sum(s >= MIN_SCORE for s in scored),
                "unscored": len(selected_jobs) - len(scored),
                "before": None,
            },
            "quota": {
                "used": sum(
                    bool(r.get("quota_consumed"))
                    and bool((stamp := moment(r["at"])) and stamp >= cutoff)
                    for r in apps
                ),
                "limit": None,
                "configured": False,
            },
            "attempts": len(included),
            "outcomes": [
                {
                    "status": k,
                    "label": k.replace("_", " ").capitalize(),
                    "kind": kind(k),
                    "count": v,
                }
                for k, v in outcomes.most_common()
            ],
            "scores": [
                {"from": n * 5, "to": n * 5 + 5, "count": bins[n]} for n in range(20)
            ],
            "boards": board_rows,
            "searches": [],
            "runs": [],
            "funnel": {
                "all": funnel,
                "boards": funnel,
                "naukri": funnel,
                "left_out": {"practice": 0, "older": 0, "unfinished": 0},
            },
            "recent": sorted(included, key=lambda r: r["at"], reverse=True)[:6],
            "source": {
                "database": "Private account",
                "updated_at": now().isoformat(),
                "timezone": "UTC",
            },
            "workspace": {
                "date": today.isoformat(),
                "pipeline": {"total": 0, "done": 0, "stages": []},
                "learning_done": 0,
                "research_count": len(self.documents()),
                "configured_boards": [],
            },
            "automation_available": False,
        }

    def file(self, query):
        name = query.get("name", "")
        if name not in FILE_NAMES:
            raise TenantError(
                403, "Server credentials and settings are not workspace files."
            )
        saved = self.profile()
        data = saved["data"]
        if name == "profile":
            content = yaml.safe_dump(
                {k: v for k, v in data.items() if k != "_dashboard_files"},
                sort_keys=False,
                allow_unicode=True,
            )
            exists = bool(saved["version"])
        else:
            private_files = data.get("_dashboard_files", {})
            content = private_files.get(name)
            if content is None:
                item = next(
                    (
                        r
                        for r in self.all("artifacts")
                        if r["filename"] == FILE_NAMES[name]
                    ),
                    None,
                )
                content = (
                    self.request(
                        "/api/v1/artifacts/" + str(item["id"]) + "/content"
                    ).decode("utf-8", errors="replace")
                    if item
                    else ""
                )
                exists = item is not None
            else:
                exists = True
        return {
            "name": name,
            "path": "Private workspace / " + FILE_NAMES[name],
            "text": content,
            "exists": exists,
            "line": None,
            "revision": str(saved["version"]),
        }

    def save_file(self, data):
        name, content = data.get("name"), data.get("text")
        if name not in FILE_NAMES or not isinstance(content, str):
            raise TenantError(
                400, "Choose an editable workspace file and send its text."
            )
        expected = integer(data.get("revision"), -1, 0, 2**31 - 1)
        saved = self.profile()
        payload = dict(saved["data"])
        if name == "profile":
            try:
                parsed = yaml.safe_load(content) or {}
                if not isinstance(parsed, dict) or any(
                    not isinstance(k, str) for k in parsed
                ):
                    raise ValueError()
                parsed = json.loads(json.dumps(parsed, default=str, allow_nan=False))
            except (ValueError, TypeError, yaml.YAMLError, RecursionError):
                raise TenantError(
                    400, "The profile must be a valid YAML mapping with named fields."
                ) from None
            parsed.pop("_dashboard_files", None)
            if "_dashboard_files" in payload:
                parsed["_dashboard_files"] = payload["_dashboard_files"]
            payload = parsed
        else:
            payload["_dashboard_files"] = {
                **payload.get("_dashboard_files", {}),
                name: content,
            }
        result = self.json(
            "/api/v1/profile", "PUT", {"expected_version": expected, "data": payload}
        )
        return {"ok": True, "revision": str(result["version"])}

    @staticmethod
    def artifact_category(item):
        filename = item["filename"].lower()
        category = item.get("category", "").lower()
        if filename.endswith(".pdf") or category == "resumes":
            return "Resumes"
        if filename == "report.md" or category == "reports":
            return "Reports"
        if filename.endswith(".eml") or category in ("outreach", "drafts"):
            return "Drafts"
        if filename in FILE_NAMES.values():
            return "Profile"
        if filename.endswith(".md") or category in ("research", "learning"):
            return "Research"
        if filename.endswith(".json"):
            return "Automation"
        return "Files"

    def documents(self):
        result = []
        for item in self.all("artifacts"):
            category = self.artifact_category(item)
            if category not in ("Research", "Drafts"):
                continue
            result.append(
                {
                    "id": "artifact/" + str(item["id"]),
                    "title": item["filename"],
                    "category": "Email drafts"
                    if category == "Drafts"
                    else "Learning"
                    if item.get("category") == "learning"
                    else "Briefing",
                    "path": item["filename"],
                    "updated_at": item["created_at"],
                    "read": False,
                }
            )
        return result

    def inventory(self, query):
        artifacts = self.all("artifacts")
        files = [
            {
                "title": r["filename"],
                "category": self.artifact_category(r),
                "path": "Private workspace / " + r["filename"],
                "href": "/api/resume-file?file=" + quote(str(r["id"])),
                "bytes": r["size_bytes"],
                "updated_at": r["created_at"],
            }
            for r in artifacts
        ]
        search, category = (
            str(query.get("q", "")).strip().casefold(),
            query.get("category", ""),
        )
        matched = [
            r
            for r in files
            if (not category or category == r["category"])
            and (not search or search in r["title"].casefold())
        ]
        sources = [
            {
                "id": "applications",
                "title": "Application attempts",
                "href": "#/records",
                "art": 26,
                "count": len(self.all("applications")),
            },
            {
                "id": "jobs",
                "title": "Discovered jobs",
                "href": "#/records/jobs/all/0",
                "art": 26,
                "count": len(self.jobs()),
            },
            {
                "id": "profile",
                "title": "Profile & answers",
                "href": "#/files/profile",
                "art": 20,
                "count": int(bool(self.profile()["version"])),
            },
            {
                "id": "resumes",
                "title": "Resume PDFs",
                "href": "#/data/resumes",
                "art": 21,
                "count": sum(r["category"] == "Resumes" for r in files),
            },
            {
                "id": "research",
                "title": "Research notes",
                "href": "#/research?view=library",
                "art": 25,
                "count": sum(r["category"] == "Research" for r in files),
            },
        ]
        return {
            **page(matched, query, "files"),
            "sources": sources,
            "updated_at": now().isoformat(),
            "storage": "account",
        }

    def library(self, query):
        items = self.documents()
        progress = (
            self.reading_progress()
            if "learning" in self.user.get("modules", [])
            else {}
        )
        for item in items:
            item["read"] = bool(progress.get(item["id"], {}).get("done"))
        total_research = sum(item["category"] != "Email drafts" for item in items)
        category = query.get("category", "")
        search = str(query.get("q", "")).strip().casefold()
        matched = [
            i
            for i in items
            if (not category or i["category"] == category)
            and (not search or search in i["title"].casefold())
        ]
        return {**page(matched, query, "items"), "research_count": total_research}

    def selected_artifact(self, identifier):
        try:
            identifier = str(UUID(str(identifier)))
        except (ValueError, TypeError):
            raise TenantError(
                400, "Choose a file from your private workspace."
            ) from None
        item = next(
            (r for r in self.all("artifacts") if str(r["id"]) == identifier), None
        )
        if item is None:
            raise TenantError(404, "This file is not available in your workspace.")
        return item

    def download(self, query):
        item = self.selected_artifact(query.get("file"))
        content = self.request("/api/v1/artifacts/" + str(item["id"]) + "/content")
        media = (
            item["media_type"]
            if item["media_type"] in ("application/pdf", "text/plain")
            else "application/octet-stream"
        )
        disposition = (
            "inline"
            if query.get("preview") == "1" and media == "application/pdf"
            else "attachment"
        )
        handler = self.handler
        handler.send_response(200)
        handler.send_header("Content-Type", media)
        handler.send_header("Content-Length", str(len(content)))
        handler.send_header(
            "Content-Disposition",
            disposition + "; filename*=UTF-8''" + quote(item["filename"], safe=""),
        )
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.end_headers()
        if getattr(handler, "command", "GET") != "HEAD":
            handler.wfile.write(content)

    def document(self, query):
        identifier = str(query.get("id", ""))
        if not identifier.startswith("artifact/"):
            raise TenantError(404, "Choose a document from your private library.")
        item = self.selected_artifact(identifier.removeprefix("artifact/"))
        if not any(r["id"] == identifier for r in self.documents()):
            raise TenantError(404, "This file is not a readable library document.")
        content = self.request(
            "/api/v1/artifacts/" + str(item["id"]) + "/content"
        ).decode("utf-8", errors="replace")
        from markdown_it import MarkdownIt

        md = MarkdownIt("commonmark", {"html": False}).enable(
            ["table", "strikethrough"]
        )
        tokens = md.parse(content)
        for token in tokens:
            for child in token.children or []:
                if child.type == "image":
                    (
                        child.type,
                        child.tag,
                        child.content,
                        child.children,
                        child.attrs,
                    ) = "text", "", "[Image omitted]", None, {}
                if child.type == "link_open":
                    target = child.attrGet("href") or ""
                    if urlsplit(target).scheme not in ("http", "https", "mailto"):
                        child.attrSet("href", "#")
                    else:
                        child.attrSet("target", "_blank")
                        child.attrSet("rel", "noopener noreferrer")
        rendered = md.renderer.render(tokens, md.options, {})
        if item["filename"].endswith(".eml"):
            from email import policy
            from email.parser import Parser

            message = Parser(policy=policy.default).parsestr(content)
            body = message.get_body(preferencelist=("plain",))
            rendered = (
                "<h1>"
                + html.escape(str(message.get("Subject", "Email draft")))
                + "</h1><pre>"
                + html.escape(body.get_content() if body else "No plain text body.")
                + "</pre>"
            )
        progress = (
            self.reading_progress()
            if "learning" in self.user.get("modules", [])
            else {}
        )
        return {
            "id": identifier,
            "title": item["filename"],
            "html": rendered,
            "read": bool(progress.get(identifier, {}).get("done")),
            "day": None,
        }

    def reading_progress(self):
        return {
            r["data"].get("id", ""): r["data"]
            for r in self.all("records", "learning")
            if r["data"].get("id", "").startswith("artifact/")
        }

    def mark_read(self, data):
        identifier = str(data.get("id", ""))
        if not isinstance(data.get("read"), bool):
            raise TenantError(400, "read must be true or false.")
        doc = next((r for r in self.documents() if r["id"] == identifier), None)
        if doc is None:
            raise TenantError(404, "Choose a document from your private library.")
        stamp = now().isoformat()
        value = {
            "id": identifier,
            "title": doc["title"],
            "done": data["read"],
            "updated_at": stamp,
            "completed_at": stamp if data["read"] else None,
        }
        self.json(
            "/api/v1/records/learning/"
            + hashlib.sha256(identifier.encode()).hexdigest(),
            "PUT",
            {"data": value},
        )
        return {"ok": True, "read": data["read"], "storage": "your private account"}

    def learning(self, query):
        today = now().date().isoformat()
        try:
            selected = dt.date.fromisoformat(query.get("date") or today).isoformat()
        except ValueError:
            raise TenantError(
                400, "Choose a research date in YYYY-MM-DD format."
            ) from None
        docs = self.documents()
        progress = self.reading_progress()
        completed = [
            {"id": key, "kind": "research", **value}
            for key, value in progress.items()
            if value.get("done")
        ]
        for doc in docs:
            doc["read"] = bool(progress.get(doc["id"], {}).get("done"))
        return {
            "date": today,
            "selected_date": selected,
            "focus": None,
            "missing": "No learning plan has been generated for this account yet.",
            "queue": [
                {**r, "caption": "Saved in your private library"}
                for r in docs
                if not r["read"]
            ][:3],
            "briefing": {
                "date": selected,
                "available_dates": [],
                "latest": None,
                "sections": [],
                "ready": 0,
                "total": 0,
                "additional": [],
                "references": docs[:6],
            },
            "resume": {"topics": [], "index": None},
            "weeks": [],
            "plan_done": 0,
            "plan_total": 90,
            "plan_complete": False,
            "notes_read": sum(r["read"] for r in docs),
            "notes_total": len(docs),
            "course_done": 0,
            "course_total": 0,
            "completed_today": [
                r for r in completed if str(r.get("completed_at", ""))[:10] == today
            ],
            "completed_selected_date": [
                r for r in completed if str(r.get("completed_at", ""))[:10] == selected
            ],
            "imported": [],
            "legacy_plan_days": [],
            "history": {"items": [], "page": 1, "pages": 1, "total": 0, "size": 15},
            "storage": "your private account",
        }
