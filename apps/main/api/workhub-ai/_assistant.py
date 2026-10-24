"""학교 비서의 인증·근거·비용 예약·일회 호출·확정 저장 경계."""
import http.client
import json
import os
import re
import sys
import time
from pathlib import Path

# 기존 서버의 토큰 검증과 Supabase 호스트 제한을 그대로 재사용한다.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collections"))
from _hwpx_basic import SupabaseClient, CheckError, parse_json, _token

ASSETS = Path(__file__).parent / "_assets"
LIMITS = json.loads((ASSETS / "assistant-limits.json").read_text(encoding="utf-8"))
TASK_LIMITS = json.loads((ASSETS / "task-limits.json").read_text(encoding="utf-8"))
POLICY = (ASSETS / "assistant-policy.txt").read_text(encoding="utf-8")
CONTRACT = LIMITS["contract"]
RPCS = frozenset(("workhub_ai_prepare", "workhub_ai_start", "workhub_ai_finish", "workhub_ai_server_readiness"))
ERRORS = frozenset(("NOT_READY", "FORBIDDEN", "INACTIVE_MEMBERSHIP", "INVALID_INPUT", "NOT_FOUND", "CONFLICT", "IDEMPOTENCY_CONFLICT", "BUDGET_EXCEEDED"))
RESOURCE_KINDS = frozenset(("knowledge", "calendar", "task", "collection", "document"))
EVIDENCE_KINDS = frozenset(("observation", "assessment"))

class AiClient(SupabaseClient):
    def rpc(self, name, args):
        if name not in RPCS:
            raise CheckError("INVALID_INPUT", 400)
        return parse_json(self._request("POST", "/rest/v1/rpc/" + name, args, maximum=LIMITS["responseBytes"]))

def exact(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise CheckError("INVALID_RESPONSE", 502)
    return value

def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value):
        raise CheckError("INVALID_RESPONSE", 502)
    return value

def text(value, maximum, required=True):
    if (not isinstance(value, str) or len(value) > maximum or (required and not value.strip()) or
        re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]", value)):
        raise CheckError("INVALID_RESPONSE", 502)
    return value

def integer(value, minimum=0):
    if type(value) is not int or not minimum <= value <= 9007199254740991:
        raise CheckError("INVALID_RESPONSE", 502)
    return value

def enum(value, choices):
    if not isinstance(value, str) or value not in choices:
        raise CheckError("INVALID_RESPONSE", 502)
    return value

def items(value, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        raise CheckError("INVALID_RESPONSE", 502)
    return value

def date(value, empty=False):
    from datetime import date as Date
    if empty and value == "":
        return value
    try:
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value) or Date.fromisoformat(value).isoformat() != value:
            raise ValueError()
    except (ValueError, TypeError):
        raise CheckError("INVALID_RESPONSE", 502) from None
    return value

def timestamp(value):
    from datetime import datetime
    try:
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})", value):
            raise ValueError()
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise CheckError("INVALID_RESPONSE", 502) from None
    return value

def reference(value):
    if not isinstance(value, dict):
        raise CheckError("INVALID_RESPONSE", 502)
    if isinstance(value.get("kind"), str) and value["kind"] in RESOURCE_KINDS:
        exact(value, ("kind", "id", "version"))
        return {"kind": value["kind"], "id": identifier(value["id"]), "version": integer(value["version"], 1)}
    exact(value, ("kind", "id", "revisionId", "sourceHash", "epoch", "start", "end"))
    enum(value["kind"], EVIDENCE_KINDS)
    identifier(value["id"]); identifier(value["revisionId"])
    if not isinstance(value["sourceHash"], str) or not re.fullmatch(r"[0-9a-f]{64}", value["sourceHash"]):
        raise CheckError("INVALID_RESPONSE", 502)
    integer(value["epoch"]); integer(value["start"]); integer(value["end"], 1)
    if value["start"] >= value["end"]:
        raise CheckError("INVALID_RESPONSE", 502)
    return dict(value)

def request_input(value):
    exact(value, ("mode", "intent", "prompt", "threadId", "expectedVersion", "references", "studentContext"))
    enum(value["mode"], ("school", "personal")); enum(value["intent"], LIMITS["intents"])
    text(value["prompt"], LIMITS["promptChars"])
    integer(value["expectedVersion"])
    if value["threadId"] is None:
        if value["expectedVersion"] != 0:
            raise CheckError("INVALID_RESPONSE", 502)
    else:
        identifier(value["threadId"]); integer(value["expectedVersion"], 1)
    refs = [reference(row) for row in items(value["references"], LIMITS["references"])]
    if any(row["kind"] not in RESOURCE_KINDS for row in refs) or len({json.dumps(row, sort_keys=True) for row in refs}) != len(refs):
        raise CheckError("INVALID_RESPONSE", 502)
    student = value["studentContext"]
    if student is not None:
        exact(student, ("studentId", "courseId", "evidence")); identifier(student["studentId"]); identifier(student["courseId"])
        evidence = [reference(row) for row in items(student["evidence"], LIMITS["references"])]
        if not evidence or any(row["kind"] not in EVIDENCE_KINDS for row in evidence) or value["intent"] != "student_record_draft" or value["mode"] != "personal":
            raise CheckError("INVALID_RESPONSE", 502)
        if len({json.dumps(row, sort_keys=True) for row in evidence}) != len(evidence):
            raise CheckError("INVALID_RESPONSE", 502)
    elif value["intent"] == "student_record_draft":
        raise CheckError("INVALID_RESPONSE", 502)
    if value["intent"] == "personal_assistant" and value["mode"] != "personal":
        raise CheckError("INVALID_RESPONSE", 502)
    return json.loads(json.dumps(value))

def request(payload):
    try:
        if isinstance(payload, dict) and payload.get("action") == "readiness":
            exact(payload, ("action", "memberId")); identifier(payload["memberId"])
        else:
            exact(payload, ("action", "memberId", "input", "requestKey")); enum(payload["action"], ("ask",))
            identifier(payload["memberId"]); identifier(payload["requestKey"]); request_input(payload["input"])
            if len(payload["requestKey"]) < 8:
                raise CheckError("INVALID_INPUT", 400)
        return json.loads(json.dumps(payload))
    except CheckError:
        raise CheckError("INVALID_INPUT", 400) from None

def envelope(value, member_id, school_id=None):
    if not isinstance(value, dict) or set(value) not in ({"contract", "schoolId", "memberId", "data"}, {"contract", "schoolId", "memberId", "error"}):
        raise CheckError("INVALID_RESPONSE", 502)
    if value["contract"] != CONTRACT or value["memberId"] != member_id or (school_id is not None and value["schoolId"] != school_id):
        raise CheckError("INVALID_RESPONSE", 502)
    identifier(value["schoolId"])
    if "error" in value:
        exact(value["error"], ("code",)); code = value["error"]["code"]
        if not isinstance(code, str) or code not in ERRORS:
            raise CheckError("INVALID_RESPONSE", 502)
        raise CheckError(code, 403 if code in ("FORBIDDEN", "INACTIVE_MEMBERSHIP") else 409 if code in ("CONFLICT", "IDEMPOTENCY_CONFLICT") else 503 if code in ("NOT_READY", "BUDGET_EXCEEDED") else 422)
    return value["data"]

def public_envelope(school_id, member_id, data):
    return {"contract": CONTRACT, "schoolId": school_id, "memberId": member_id, "data": data}

def citation(value):
    exact(value, ("reference", "title", "locator"))
    return {"reference": reference(value["reference"]), "title": text(value["title"], 200), "locator": text(value["locator"], 500)}

def task_input(value, legacy_read=False):
    exact(value, ("title", "notes", "dueDate"))
    limits = TASK_LIMITS["legacyAssistantRead"] if legacy_read else TASK_LIMITS
    title = text(value["title"], limits["titleChars"], required=legacy_read)
    notes = text(value["notes"], limits["notesChars"], False)
    # 과거 제안은 원문 보존, 새 제안은 기존 업무의 ECMAScript trim과 동일하게 정규화한다.
    if not legacy_read:
        trim_chars = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
        title, notes = title.strip(trim_chars), notes.strip(trim_chars)
        if not title:
            raise CheckError("INVALID_RESPONSE", 502)
    return {"title": title, "notes": notes, "dueDate": date(value["dueDate"], True)}

def public_thread(value):
    exact(value, ("id", "mode", "version", "title", "exchanges", "nextCursor"))
    identifier(value["id"]); enum(value["mode"], ("school", "personal")); integer(value["version"], 1); text(value["title"], 200)
    if value["nextCursor"] is not None:
        text(value["nextCursor"], 2000)
    seen, keys = set(), set()
    for exchange in items(value["exchanges"], 50):
        exact(exchange, ("id", "requestKey", "intent", "prompt", "segments", "proposal", "createdAt", "studentContext"))
        identifier(exchange["id"]); identifier(exchange["requestKey"]); enum(exchange["intent"], LIMITS["intents"]); text(exchange["prompt"], LIMITS["promptChars"]); timestamp(exchange["createdAt"])
        if exchange["id"] in seen or exchange["requestKey"] in keys:
            raise CheckError("INVALID_RESPONSE", 502)
        seen.add(exchange["id"]); keys.add(exchange["requestKey"])
        segments = items(exchange["segments"], LIMITS["segments"])
        if not segments or sum(len(row.get("text", "")) for row in segments if isinstance(row, dict) and isinstance(row.get("text"), str)) > LIMITS["answerChars"]:
            raise CheckError("INVALID_RESPONSE", 502)
        for segment in segments:
            exact(segment, ("text", "citations")); text(segment["text"], LIMITS["segmentChars"])
            for source in items(segment["citations"], LIMITS["sources"]):
                citation(source)
            if exchange["intent"] == "student_record_draft" and not any(source["reference"]["kind"] in EVIDENCE_KINDS for source in segment["citations"]):
                raise CheckError("INVALID_RESPONSE", 502)
        proposal = exchange["proposal"]
        if proposal is not None:
            exact(proposal, ("id", "version", "kind", "input", "status", "resourceId"))
            identifier(proposal["id"]); integer(proposal["version"], 1); enum(proposal["kind"], ("create_personal_task",)); task_input(proposal["input"], legacy_read=True); enum(proposal["status"], ("pending", "applied"))
            if proposal["resourceId"] is not None:
                identifier(proposal["resourceId"])
            if (proposal["status"] == "applied") != (proposal["resourceId"] is not None) or value["mode"] != "personal" or exchange["intent"] != "personal_assistant":
                raise CheckError("INVALID_RESPONSE", 502)
        # 학생 문맥도 최초 요청과 같은 무손실 형식으로 검증한다.
        request_input({"mode": value["mode"], "intent": exchange["intent"], "prompt": exchange["prompt"], "threadId": None, "expectedVersion": 0, "references": [], "studentContext": exchange["studentContext"]})
        for segment in segments:
            for item in segment["citations"]:
                if item["reference"]["kind"] in EVIDENCE_KINDS and (exchange["studentContext"] is None or item["reference"] not in exchange["studentContext"]["evidence"]):
                    raise CheckError("INVALID_RESPONSE", 502)
    return value

def public_result(value, key, original=None):
    if not isinstance(value, dict) or value.get("requestKey") != key:
        raise CheckError("INVALID_RESPONSE", 502)
    if value.get("state") == "completed":
        exact(value, ("state", "requestKey", "thread")); public_thread(value["thread"])
        matches = [row for row in value["thread"]["exchanges"] if row["requestKey"] == key]
        if len(matches) != 1:
            raise CheckError("INVALID_RESPONSE", 502)
        if original is not None:
            row, thread = matches[0], value["thread"]
            if (thread["mode"] != original["mode"] or thread["version"] != original["expectedVersion"] + 1 or
                (original["threadId"] is not None and thread["id"] != original["threadId"]) or
                row["intent"] != original["intent"] or row["prompt"] != original["prompt"] or row["studentContext"] != original["studentContext"]):
                raise CheckError("INVALID_RESPONSE", 502)
    elif value.get("state") == "pending":
        exact(value, ("state", "requestKey", "reason")); enum(value["reason"], ("in_progress", "provider_unknown"))
    elif value.get("state") == "rejected":
        exact(value, ("state", "requestKey", "code")); enum(value["code"], ("OUTPUT_INVALID", "PROVIDER_REJECTED", "TRUNCATED"))
    else:
        raise CheckError("INVALID_RESPONSE", 502)
    return value

def claimed(value, original, key):
    exact(value, ("state", "requestKey", "leaseToken", "input", "history", "sources", "policy"))
    if value["state"] != "claimed" or value["requestKey"] != key or request_input(value["input"]) != original:
        raise CheckError("INVALID_RESPONSE", 502)
    identifier(value["leaseToken"])
    config = exact(value["policy"], ("approved", "configVersion", "model", "maxTokens", "budget"))
    if config["approved"] is not True or not isinstance(config["model"], str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,150}", config["model"]):
        raise CheckError("NOT_READY")
    integer(config["configVersion"], 1); integer(config["maxTokens"], 1)
    budget = exact(config["budget"], ("reservationId", "policyVersion", "currency", "reservedMicroUsd", "dailyLimitMicroUsd", "monthlyLimitMicroUsd"))
    identifier(budget["reservationId"]); integer(budget["policyVersion"], 1)
    if budget["currency"] != "USD" or not (integer(budget["reservedMicroUsd"], 1) <= integer(budget["dailyLimitMicroUsd"], 1) <= integer(budget["monthlyLimitMicroUsd"], 1)):
        raise CheckError("NOT_READY")
    for message in items(value["history"], LIMITS["historyMessages"]):
        exact(message, ("role", "content")); enum(message["role"], ("user", "assistant")); text(message["content"], LIMITS["historyChars"])
    seen = set()
    for source in items(value["sources"], LIMITS["sources"]):
        exact(source, ("key", "reference", "title", "locator", "classification", "body"))
        identifier(source["key"]); ref = reference(source["reference"]); text(source["title"], 200); text(source["locator"], 500); text(source["body"], LIMITS["sourceChars"])
        enum(source["classification"], ("school_public", "owner_private", "student_learning"))
        if source["key"] in seen or (original["mode"] == "school" and source["classification"] != "school_public"):
            raise CheckError("INVALID_RESPONSE", 502)
        seen.add(source["key"])
        if ref["kind"] in EVIDENCE_KINDS:
            student = original["studentContext"]
            if source["classification"] != "student_learning" or student is None or ref not in student["evidence"] or len(source["body"]) != ref["end"] - ref["start"]:
                raise CheckError("INVALID_RESPONSE", 502)
        elif source["classification"] == "student_learning" or (ref["kind"] == "task" and source["classification"] != "owner_private"):
            raise CheckError("INVALID_RESPONSE", 502)
    if original["intent"] == "student_record_draft" and not any(source["reference"]["kind"] in EVIDENCE_KINDS for source in value["sources"]):
        raise CheckError("NOT_FOUND", 404)
    return value

TOOL = {"name": "deliver_workhub_answer", "description": "교사가 검토할 답변과 근거, 선택적 개인 할 일 초안을 반환합니다. 작업을 실행하지 않습니다.", "input_schema": {
    "type": "object", "additionalProperties": False, "required": ["segments", "taskDraft"], "properties": {
        "segments": {"type": "array", "minItems": 1, "maxItems": LIMITS["segments"], "items": {"type": "object", "additionalProperties": False, "required": ["text", "sourceKeys"], "properties": {"text": {"type": "string"}, "sourceKeys": {"type": "array", "items": {"type": "string"}}}}},
        "taskDraft": {"anyOf": [{"type": "null"}, {"type": "object", "additionalProperties": False, "required": ["title", "notes", "dueDate"], "properties": {"title": {"type": "string", "minLength": 1, "maxLength": TASK_LIMITS["titleChars"], "description": "교사가 확인할 할 일 제목"}, "notes": {"type": "string", "maxLength": TASK_LIMITS["notesChars"], "description": "교사 개인 할 일의 메모"}, "dueDate": {"type": "string"}}}]}
    }}}

def provider_body(claim):
    # 지시문은 로컬 자산만 사용한다. 학교 자료와 사용자 입력은 JSON 데이터로 전달한다.
    # 판이 본문에 없어도 답할 수 있도록 인용 카드와 같은 서버 확정 reference를 함께 보낸다.
    sources = [{"sourceKey": row["key"], "reference": row["reference"], "title": row["title"], "locator": row["locator"], "body": row["body"]} for row in claim["sources"]]
    prompt = json.dumps({"mode": claim["input"]["mode"], "intent": claim["input"]["intent"], "request": claim["input"]["prompt"], "authorizedEvidence": sources}, ensure_ascii=False)
    return {"model": claim["policy"]["model"], "max_tokens": claim["policy"]["maxTokens"], "system": POLICY, "messages": claim["history"] + [{"role": "user", "content": prompt}], "tools": [TOOL], "tool_choice": {"type": "tool", "name": TOOL["name"]}, "stream": False}

def anthropic(body, key, deadline, connection_factory=http.client.HTTPSConnection, clock=time.monotonic):
    connection = None
    try:
        remaining = deadline - clock() - 5
        if remaining <= 0:
            raise CheckError("RESULT_UNKNOWN")
        connection = connection_factory("api.anthropic.com", 443, timeout=min(LIMITS["providerTimeoutSeconds"], remaining))
        connection.request("POST", "/v1/messages", body=json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8"), headers={"Content-Type": "application/json", "Accept-Encoding": "identity", "x-api-key": key, "anthropic-version": "2023-06-01"})
        response = connection.getresponse()
        if response.status in (400, 401, 403, 404, 413, 422, 429):
            return {"rejected": True}
        if response.status != 200 or response.getheader("Content-Encoding", "identity").lower() not in ("", "identity"):
            raise CheckError("RESULT_UNKNOWN")
        declared = response.getheader("Content-Length")
        if declared is not None and (not declared.isdigit() or int(declared) > LIMITS["responseBytes"]):
            raise CheckError("RESULT_UNKNOWN")
        chunks, size = [], 0
        while True:
            remaining = deadline - clock() - 5
            if remaining <= 0:
                raise CheckError("RESULT_UNKNOWN")
            if getattr(connection, "sock", None) is not None:
                connection.sock.settimeout(min(LIMITS["providerTimeoutSeconds"], remaining))
            chunk = response.read1(min(16384, LIMITS["responseBytes"] + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > LIMITS["responseBytes"]:
                raise CheckError("RESULT_UNKNOWN")
            chunks.append(chunk)
        raw = b"".join(chunks)
        if declared is not None and len(raw) != int(declared):
            raise CheckError("RESULT_UNKNOWN")
        result = parse_json(raw)
        return {"response": result}
    except (OSError, TimeoutError, http.client.HTTPException):
        raise CheckError("RESULT_UNKNOWN") from None
    finally:
        if connection is not None:
            connection.close()

def restore_cited_linebreaks(content, cited_sources):
    """이중 이스케이프된 인용문만 확인한 원문과 대조하여 복원한다."""
    # 코드 설명·경로·일반 답변은 디코딩하지 않는다. 백틱이 섞인 문단도 그대로 둔다.
    if "\\n" not in content or "`" in content:
        return content
    bodies = [source["body"] for source in cited_sources]

    def restore(match):
        quote = match.group(0)
        original = quote[1:-1]
        if "\\n" not in original or any(original in body for body in bodies):
            return quote
        restored = original.replace("\\r\\n", "\r\n").replace("\\n", "\n")
        # 해당 문단이 인용한 자료 안에 인용문 전체가 있어야 한다. 단어가 비슷하다고 고치지 않는다.
        if any(restored in body for body in bodies):
            return quote[0] + restored + quote[-1]
        return quote

    return re.sub(r'"[^"]*"|“[^”]*”|「[^」]*」|『[^』]*』', restore, content)


def checked_output(provider_result, claim):
    if not isinstance(provider_result, dict):
        raise CheckError("INVALID_RESPONSE", 502)
    if provider_result.get("rejected") is True:
        return {"state": "rejected", "code": "PROVIDER_REJECTED", "usage": None, "providerMessageId": None}
    response = provider_result.get("response")
    if not isinstance(response, dict) or response.get("type") != "message" or response.get("role") != "assistant":
        raise CheckError("INVALID_RESPONSE", 502)
    identifier(response.get("id"))
    usage = response.get("usage")
    if not isinstance(usage, dict):
        raise CheckError("INVALID_RESPONSE", 502)
    usage = {"inputTokens": integer(usage.get("input_tokens")), "outputTokens": integer(usage.get("output_tokens"))}
    base = {"usage": usage, "providerMessageId": response["id"]}
    if response.get("stop_reason") == "max_tokens":
        return {**base, "state": "rejected", "code": "TRUNCATED"}
    try:
        blocks = response.get("content")
        if response.get("stop_reason") != "tool_use" or not isinstance(blocks, list) or len(blocks) != 1 or blocks[0].get("type") != "tool_use" or blocks[0].get("name") != TOOL["name"]:
            raise CheckError("INVALID_RESPONSE", 502)
        answer = exact(blocks[0].get("input"), ("segments", "taskDraft"))
        sources = {row["key"]: row for row in claim["sources"]}
        segments, total = [], 0
        for row in items(answer["segments"], LIMITS["segments"]):
            exact(row, ("text", "sourceKeys")); content = text(row["text"], LIMITS["segmentChars"]); total += len(content)
            keys = items(row["sourceKeys"], LIMITS["sources"])
            if len(set(keys)) != len(keys) or any(not isinstance(key, str) or key not in sources for key in keys):
                raise CheckError("INVALID_RESPONSE", 502)
            content = restore_cited_linebreaks(content, [sources[key] for key in keys])
            citations = [{key: sources[source_key][key] for key in ("reference", "title", "locator")} for source_key in keys]
            if claim["input"]["intent"] == "student_record_draft" and not any(item["reference"]["kind"] in EVIDENCE_KINDS for item in citations):
                raise CheckError("INVALID_RESPONSE", 502)
            segments.append({"text": content, "citations": citations})
        if not segments or total > LIMITS["answerChars"]:
            raise CheckError("INVALID_RESPONSE", 502)
        draft = answer["taskDraft"]
        if draft is not None:
            if claim["input"]["mode"] != "personal" or claim["input"]["intent"] != "personal_assistant":
                raise CheckError("INVALID_RESPONSE", 502)
            draft = task_input(draft)
        return {**base, "state": "completed", "segments": segments, "taskDraft": draft}
    except (CheckError, TypeError, KeyError, AttributeError):
        return {**base, "state": "rejected", "code": "OUTPUT_INVALID"}

def execute(payload, authorization, environ=None, client=None, provider=None):
    payload = request(payload); authorization = _token(authorization)
    env = os.environ if environ is None else environ
    key = env.get("ANTHROPIC_API_KEY")
    if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{20,4096}", key):
        raise CheckError("NOT_READY")
    client = client or AiClient(environ=env)
    actor = client.user(authorization)
    common = {"p_actor_user_id": actor, "p_member_id": payload["memberId"]}
    if payload["action"] == "readiness":
        response = client.rpc("workhub_ai_server_readiness", common)
        data = envelope(response, payload["memberId"])
        if data == {"available": True}:
            return response
        exact(data, ("available", "reason"))
        if data["available"] is not False:
            raise CheckError("INVALID_RESPONSE", 502)
        enum(data["reason"], ("not_configured", "not_allowed", "budget_exhausted"))
        return response
    prepared = client.rpc("workhub_ai_prepare", {**common, "p_input": payload["input"], "p_request_key": payload["requestKey"]})
    data = envelope(prepared, payload["memberId"])
    school_id, request_key = prepared["schoolId"], payload["requestKey"]
    if not isinstance(data, dict):
        raise CheckError("INVALID_RESPONSE", 502)
    if data.get("state") != "claimed":
        return public_envelope(school_id, payload["memberId"], public_result(data, request_key, payload["input"]))
    claim = claimed(data, payload["input"], request_key)
    lease = {**common, "p_request_key": request_key, "p_lease_token": claim["leaseToken"]}
    # DB가 이 요청의 첫 외부 호출권을 확정한 경우에만 딱 한 번 호출한다.
    started = envelope(client.rpc("workhub_ai_start", lease), payload["memberId"], school_id)
    exact(started, ("started",))
    if started["started"] is not True:
        if started["started"] is not False:
            raise CheckError("INVALID_RESPONSE", 502)
        return public_envelope(school_id, payload["memberId"], {"state": "pending", "requestKey": request_key, "reason": "in_progress"})
    result = None
    try:
        response = (provider or anthropic)(provider_body(claim), key, client.deadline)
        result = checked_output(response, claim)
    except (CheckError, ValueError, TypeError, KeyError):
        result = {"state": "provider_unknown", "usage": None, "providerMessageId": None}
    try:
        finished = client.rpc("workhub_ai_finish", {**lease, "p_result": result})
        value = public_result(envelope(finished, payload["memberId"], school_id), request_key, payload["input"])
        return public_envelope(school_id, payload["memberId"], value)
    except CheckError:
        # 완료 기록 응답이 사라져도 새 외부 요청을 만들지 않는다. prepare에서 원 접수증을 재조회한다.
        return public_envelope(school_id, payload["memberId"], {"state": "pending", "requestKey": request_key, "reason": "provider_unknown"})
