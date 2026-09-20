#!/usr/bin/env python3
# world-playable package launcher — python3 standard library only.
# Serves THIS directory (the package root) on 127.0.0.1 at the given port
# (default 5411). A busy port is reported clearly and the launcher exits
# non-zero; it never kills or waits on whatever holds the port.
#   python3 start-world-playable.py [port]
import os
import socket
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # local candidate only: no caching surprises, no cross-origin use
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # quiet by default, errors still show
        if args and (" 4" in str(args[1][:3]) if len(args) > 1 and isinstance(args[1], int) else False):
            sys.stderr.write(" %s\n" % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5411
    host = "127.0.0.1"
    try:
        srv = ThreadingHTTPServer((host, port), Handler)
    except OSError as e:
        print(f"端口 {port} 无法使用（{e}）。"
              f"请换一个端口：python3 start-world-playable.py 5412", file=sys.stderr)
        return 1
    print(f"方浜市声 本地试玩包已启动：http://{host}:{port}/world-preview.html"
          f" （Ctrl+C 停止；本服务只在 {host} 上监听）")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
