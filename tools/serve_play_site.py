"""Loopback-only static candidate server with exported response headers."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import argparse,json
parser=argparse.ArgumentParser()
parser.add_argument('--site',type=Path,required=True)
parser.add_argument('--headers',type=Path,required=True)
parser.add_argument('--port',type=int,default=5633)
args=parser.parse_args()
headers=json.loads(args.headers.read_text(encoding='utf-8'))
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(args.site.resolve()),**kw)
    def end_headers(self):
        for key,value in headers.items():self.send_header(key,value)
        self.send_header('Cache-Control','no-store')
        super().end_headers()
    def log_message(self,*a):pass
print(f'Candidate static preview http://127.0.0.1:{args.port}/',flush=True)
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
