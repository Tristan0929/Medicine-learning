/**
 * 医学复习网站 —— 轻量后端代理（零依赖，仅用 Node 内置模块）
 *
 * 作用：
 *  1) 静态托管 public/ 目录里的前端页面
 *  2) 作为「OpenAI 兼容接口」的中转代理，解决浏览器直连的 CORS 问题
 *
 * 重要：本服务器【不保存】任何 API Key。
 *      每次请求里由前端携带用户自己的 Key，用完即转发，不落库、不打印。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function normalizeBase(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return text; }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => resolve(data ? safeParse(data) : {}));
    req.on('error', reject);
  });
}

// ---- 读取模型： GET {baseUrl}/models ----
async function handleModels(req, res) {
  const { baseUrl, apiKey } = await readBody(req);
  const base = normalizeBase(baseUrl);
  if (!base || !apiKey) return sendJson(res, 400, { error: '缺少 baseUrl 或 apiKey' });
  try {
    const upstream = await fetch(`${base}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return sendJson(res, upstream.status, { error: '读取模型失败', status: upstream.status, detail: safeParse(text) });
    }
    return sendJson(res, 200, safeParse(text));
  } catch (err) {
    return sendJson(res, 502, { error: '无法连接服务商', detail: String(err) });
  }
}

// ---- 对话（流式）： POST {baseUrl}/chat/completions ----
async function handleChat(req, res) {
  const { baseUrl, apiKey, model, messages, temperature } = await readBody(req);
  const base = normalizeBase(baseUrl);
  if (!base || !apiKey || !model || !Array.isArray(messages)) {
    return sendJson(res, 400, { error: '缺少 baseUrl / apiKey / model / messages' });
  }
  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.6,
        stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      return sendJson(res, upstream.status || 502, { error: '调用模型失败', status: upstream.status, detail: safeParse(text) });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    });
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    if (!res.headersSent) sendJson(res, 502, { error: '无法连接服务商', detail: String(err) });
    else res.end();
  }
}

// ---- 静态文件 ----
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // 防目录穿越
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/models') return handleModels(req, res);
  if (req.method === 'POST' && req.url === '/api/chat') return handleChat(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`医学复习网站已启动： http://localhost:${PORT}`);
});
