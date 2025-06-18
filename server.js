const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');

// 导入 API 处理函数
const apiHandler = require('./api/index.js');

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 处理静态文件
  if (pathname.startsWith('/public/') || pathname === '/favicon.svg' || pathname === '/favicon-16x16.svg' || pathname === '/favicon-32x32.svg' || pathname === '/icon-192.svg') {
    let filePath;
    if (pathname.startsWith('/public/')) {
      filePath = path.join(__dirname, pathname);
    } else {
      filePath = path.join(__dirname, 'public', pathname);
    }
    
    try {
      const fileContent = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      let contentType = 'text/plain';
      
      if (ext === '.svg') {
        contentType = 'image/svg+xml';
      } else if (ext === '.json') {
        contentType = 'application/json';
      }
      
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(fileContent);
      return;
    } catch (error) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
  }

  // 处理 manifest.json
  if (pathname === '/manifest.json') {
    try {
      const manifestPath = path.join(__dirname, 'manifest.json');
      const manifestContent = fs.readFileSync(manifestPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(manifestContent);
      return;
    } catch (error) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
  }

  // 使用 API 处理函数处理其他请求
  try {
    await apiHandler(req, res);
  } catch (error) {
    console.error('API error:', error);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
