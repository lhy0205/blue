# 로컬 개발용 서버 (Node 없이 확인용)
#   python dev-server.py            → 정적 서빙만. /api 없음 = 실제 배포 전 상태와 동일
#   python dev-server.py --mock-ai  → /api/config, /api/ai 를 가짜로 응답해 AI 배선을 검증
#
# 배포는 Vercel이 public/ 을 서빙하고 api/*.js 를 서버리스로 실행하므로
# 이 파일은 개발 편의용입니다. --mock-ai 응답은 절대 실제 AI가 아닙니다.
import http.server, json, os, sys, urllib.parse

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
PORT = 8777
MOCK_AI = "--mock-ai" in sys.argv

MOCK_TEXT = {
    "explain_blueprint": (
        "[MOCK] 목표 1억 원을 전부 현금으로 모을 필요는 없습니다. "
        "정책금융 8,000만 원을 상품상 최대한도 기준으로 활용하면 필요한 자기자본은 2,000만 원이고, "
        "이미 600만 원을 확보하셨으니 남은 1,400만 원을 24개월간 월 583,000원씩 모으는 것이 핵심 과제입니다. "
        "실제 한도는 신청 시점의 심사 기준에 따라 달라질 수 있습니다."
    ),
    "explain_verdict": (
        "[MOCK] 연령·소득·무주택·자산 요건을 모두 충족해 1차 자격검토를 통과했습니다. "
        "다만 이는 승인 확정이 아니라 상품 기준에 비추어 검토가 가능하다는 의미입니다. "
        "신청 전에 임차할 주택의 보증금 한도와 순자산 기준을 다시 확인하시는 것이 좋습니다."
    ),
    "explain_fintox": (
        "[MOCK] 이번 결제는 평소 결제액보다 크고 야간에 이루어졌습니다. "
        "금액 자체는 월 저축목표의 일부에 그치지만, 같은 패턴이 반복되면 목표 도달 시점이 뒤로 밀립니다. "
        "소비를 줄이기보다 지역화폐나 K-패스처럼 같은 소비를 더 싸게 하는 수단을 먼저 적용해 보세요."
    ),
}


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIR, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/config":
            if not MOCK_AI:
                return self._json({"error": "not_found"}, 404)
            return self._json({
                "supabaseUrl": None, "supabaseAnonKey": None,
                "hasAI": True, "hasPolicyApi": False,
                "policyDbBasedOn": "2026-09-03", "mock": True,
            })
        if path == "/api/policies":
            return self._json({"error": "no_api_key", "message": "로컬 개발 서버에는 정책 API가 없습니다."}, 503)
        return super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path != "/api/ai":
            return self._json({"error": "not_found"}, 404)
        if not MOCK_AI:
            return self._json({"error": "no_api_key"}, 503)
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        task = body.get("task")
        if task == "parse_goal":
            return self._json({})   # 규칙 파서 결과를 그대로 쓰게 둔다
        if task in MOCK_TEXT:
            return self._json({"text": MOCK_TEXT[task], "model": "mock-model"})
        return self._json({"error": "unknown_task"}, 400)


print("serving %s at http://127.0.0.1:%d%s" % (DIR, PORT, "  [MOCK AI 켜짐]" if MOCK_AI else ""))
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
