// 테스트 전용 미니 웹서버.
// 저장소 폴더의 파일을 http://localhost:8765 에서 보여 줍니다.
// 안전장치: index.html을 보낼 때 Firebase projectId를 비워서
// 테스트가 실제 데이터베이스(진짜 교인 정보)에 절대 닿지 않고 '체험 모드'로만 돌게 합니다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html')) {
    body = body.toString('utf8').replace(/projectId:\s*"[^"]*"/, 'projectId: ""');
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
}).listen(8765, () => console.log('test server on http://localhost:8765'));
