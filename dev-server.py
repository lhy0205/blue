# 로컬 개발용 정적 서버 (Node 없이 확인용)
#   python dev-server.py   →  http://127.0.0.1:8777
# 배포는 Vercel이 public/ 을 그대로 서빙하므로 이 파일은 개발 편의용입니다.
import http.server, os, sys

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
PORT = 8777


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIR, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))


print("serving %s at http://127.0.0.1:%d" % (DIR, PORT))
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
