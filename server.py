import argparse
import hmac
import json
import mimetypes
import secrets
import time
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "server_config.json"
COOKIE_NAME = "family_health_session"
PROTECTED_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
}

sessions = {}
server_config = {}


def load_config(path):
    if not path.exists():
        generated_key = secrets.token_urlsafe(18)
        default_config = {
            "access_keys": [generated_key],
            "max_active_sessions": 3,
            "session_ttl_minutes": 480,
        }
        path.write_text(
            json.dumps(default_config, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"已生成访问密钥配置：{path}")
        print(f"当前访问密钥：{generated_key}")
        return default_config

    config = json.loads(path.read_text(encoding="utf-8-sig"))
    keys = [key for key in config.get("access_keys", []) if key]
    if not keys:
        raise ValueError("server_config.json 必须包含至少一个 access_keys 密钥。")
    return {
        "access_keys": keys,
        "max_active_sessions": int(config.get("max_active_sessions", 3)),
        "session_ttl_minutes": int(config.get("session_ttl_minutes", 480)),
    }


def prune_sessions():
    ttl_seconds = server_config["session_ttl_minutes"] * 60
    now = time.time()
    expired = [
        token
        for token, session in sessions.items()
        if now - session["last_seen"] > ttl_seconds
    ]
    for token in expired:
        sessions.pop(token, None)


def is_valid_key(submitted_key):
    return any(
        hmac.compare_digest(submitted_key, configured_key)
        for configured_key in server_config["access_keys"]
    )


def html_page(title, body):
    return f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title}</title>
    <style>
      :root {{
        --bg: #f5f7f6;
        --surface: #ffffff;
        --text: #16211d;
        --muted: #62706a;
        --line: #d9e2de;
        --primary: #187760;
        --primary-dark: #0f5d4a;
        font-family: "Microsoft YaHei", system-ui, sans-serif;
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: var(--bg);
        color: var(--text);
        padding: 24px;
      }}
      main {{
        width: min(460px, 100%);
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--surface);
        box-shadow: 0 18px 45px rgba(22, 33, 29, 0.08);
        padding: 28px;
      }}
      h1 {{ margin: 0 0 10px; font-size: 26px; }}
      p {{ margin: 0 0 18px; color: var(--muted); line-height: 1.7; }}
      label {{ display: grid; gap: 8px; color: var(--muted); font-weight: 700; }}
      input {{
        width: 100%;
        height: 44px;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 0 12px;
        font: inherit;
      }}
      button {{
        width: 100%;
        min-height: 44px;
        margin-top: 16px;
        border: 0;
        border-radius: 8px;
        background: var(--primary);
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
      }}
      button:hover {{ background: var(--primary-dark); }}
      .error {{
        margin-bottom: 14px;
        border: 1px solid #efc8bf;
        border-radius: 8px;
        background: #fff5f2;
        color: #a43f22;
        padding: 10px 12px;
      }}
      code {{
        border-radius: 6px;
        background: #eef4f1;
        padding: 2px 6px;
      }}
    </style>
  </head>
  <body>{body}</body>
</html>"""


def login_page(error=""):
    error_html = f'<div class="error">{error}</div>' if error else ""
    return html_page(
        "家庭健康系统登录",
        f"""<main>
          <h1>家庭健康系统</h1>
          <p>请输入管理员提供的访问密钥。当前服务器最多允许 {server_config["max_active_sessions"]} 个有效会话同时访问。</p>
          {error_html}
          <form method="post" action="/login">
            <label>
              访问密钥
              <input name="access_key" type="password" autocomplete="current-password" required autofocus />
            </label>
            <button type="submit">进入系统</button>
          </form>
        </main>""",
    )


def message_page(title, message):
    return html_page(
        title,
        f"""<main>
          <h1>{title}</h1>
          <p>{message}</p>
          <form method="get" action="/login">
            <button type="submit">返回登录</button>
          </form>
        </main>""",
    )


class HealthServerHandler(BaseHTTPRequestHandler):
    server_version = "FamilyHealthServer/1.0"

    def do_GET(self):
        prune_sessions()
        request_path = urlparse(self.path).path
        if request_path == "/login":
            if self.is_authenticated():
                self.redirect("/")
                return
            self.write_html(login_page())
            return
        if request_path == "/logout":
            self.logout()
            return
        if request_path == "/health":
            self.write_text("ok")
            return
        if request_path not in PROTECTED_FILES:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not self.is_authenticated():
            self.redirect("/login")
            return
        self.serve_static(PROTECTED_FILES[request_path])

    def do_POST(self):
        prune_sessions()
        request_path = urlparse(self.path).path
        if request_path != "/login":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        form = parse_qs(body)
        submitted_key = form.get("access_key", [""])[0]

        if not is_valid_key(submitted_key):
            self.write_html(login_page("访问密钥不正确。"), HTTPStatus.UNAUTHORIZED)
            return

        if len(sessions) >= server_config["max_active_sessions"]:
            self.write_html(
                message_page(
                    "访问人数已满",
                    f"当前已有 {server_config['max_active_sessions']} 个有效会话正在访问。请让其他用户退出登录，或等待会话过期后再试。",
                ),
                HTTPStatus.FORBIDDEN,
            )
            return

        token = secrets.token_urlsafe(32)
        sessions[token] = {
            "created_at": time.time(),
            "last_seen": time.time(),
            "client": self.client_address[0],
        }
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", "/")
        self.send_header(
            "Set-Cookie",
            f"{COOKIE_NAME}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={server_config['session_ttl_minutes'] * 60}",
        )
        self.end_headers()

    def is_authenticated(self):
        cookie_header = self.headers.get("Cookie", "")
        if not cookie_header:
            return False
        cookie = SimpleCookie(cookie_header)
        token = cookie.get(COOKIE_NAME)
        if not token or token.value not in sessions:
            return False
        sessions[token.value]["last_seen"] = time.time()
        return True

    def logout(self):
        cookie_header = self.headers.get("Cookie", "")
        if cookie_header:
            cookie = SimpleCookie(cookie_header)
            token = cookie.get(COOKIE_NAME)
            if token:
                sessions.pop(token.value, None)
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", "/login")
        self.send_header(
            "Set-Cookie",
            f"{COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        )
        self.end_headers()

    def serve_static(self, filename):
        file_path = BASE_DIR / filename
        if not file_path.exists():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        body = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location):
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", location)
        self.end_headers()

    def write_html(self, content, status=HTTPStatus.OK):
        body = content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def write_text(self, content, status=HTTPStatus.OK):
        body = content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}")


def parse_args():
    parser = argparse.ArgumentParser(description="家庭健康信息管理系统本地服务器")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址，默认 0.0.0.0")
    parser.add_argument("--port", default=4174, type=int, help="监听端口，默认 4174")
    parser.add_argument("--config", default=str(CONFIG_PATH), help="密钥配置文件路径")
    return parser.parse_args()


def main():
    global server_config
    args = parse_args()
    config_path = Path(args.config).resolve()
    server_config = load_config(config_path)

    httpd = ThreadingHTTPServer((args.host, args.port), HealthServerHandler)
    print(f"家庭健康系统服务器已启动：http://127.0.0.1:{args.port}/")
    print("局域网访问：请使用本机局域网 IP 加端口，例如 http://192.168.x.x:%s/" % args.port)
    print("按 Ctrl+C 停止服务器。")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
