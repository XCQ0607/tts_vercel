// Microsoft TTS API Server for Vercel
const fetch = require('node-fetch');
const crypto = require('crypto');



// 基本变量定义
let expiredAt = null;
let endpoint = null;
// 添加缓存相关变量
let voiceListCache = null;
let voiceListCacheTime = null;
const VOICE_CACHE_DURATION = 4 * 60 * 60 * 1000; // 4小时，单位毫秒

// 定义需要保留的 SSML 标签模式
const preserveTags = [
  { name: 'break', pattern: /<break\s+[^>]*\/>/g },
  { name: 'speak', pattern: /<speak>|<\/speak>/g },
  { name: 'prosody', pattern: /<prosody\s+[^>]*>|<\/prosody>/g },
  { name: 'emphasis', pattern: /<emphasis\s+[^>]*>|<\/emphasis>/g },
  { name: 'voice', pattern: /<voice\s+[^>]*>|<\/voice>/g },
  { name: 'say-as', pattern: /<say-as\s+[^>]*>|<\/say-as>/g },
  { name: 'phoneme', pattern: /<phoneme\s+[^>]*>|<\/phoneme>/g },
  { name: 'audio', pattern: /<audio\s+[^>]*>|<\/audio>/g },
  { name: 'p', pattern: /<p>|<\/p>/g },
  { name: 's', pattern: /<s>|<\/s>/g },
  { name: 'sub', pattern: /<sub\s+[^>]*>|<\/sub>/g },
  { name: 'mstts', pattern: /<mstts:[^>]*>|<\/mstts:[^>]*>/g }
];

// 获取API密钥（从环境变量）
const API_KEY = process.env.API_KEY || "";

function uuid() {
  return crypto.randomUUID().replace(/-/g, '');
}

// EscapeSSML 转义 SSML 内容，但保留配置的标签
function escapeSSML(ssml) {
  // 使用占位符替换标签
  let placeholders = new Map();
  let processedSSML = ssml;
  let counter = 0;

  // 处理所有配置的标签
  for (const tag of preserveTags) {
    processedSSML = processedSSML.replace(tag.pattern, function(match) {
      const placeholder = `__SSML_PLACEHOLDER_${tag.name}_${counter++}__`;
      placeholders.set(placeholder, match);
      return placeholder;
    });
  }

  // 对处理后的文本进行HTML转义
  let escapedContent = escapeBasicXml(processedSSML);

  // 恢复所有标签占位符
  placeholders.forEach((tag, placeholder) => {
    escapedContent = escapedContent.replace(placeholder, tag);
  });

  return escapedContent;
}

// 基本 XML 转义功能，只处理基本字符
function escapeBasicXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
    return '';
  });
}

// API 密钥验证函数
function validateApiKey(apiKey) {
  // 从环境变量获取 API 密钥并进行验证
  return apiKey === API_KEY;
}

// 随机生成 X-UserId，格式为 16 位字符（字母+数字）
function generateUserId() {
  const chars = 'abcdef0123456789'; // 只使用16进制字符，与原格式一致
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function dateFormat() {
  const formattedDate = new Date().toUTCString().replace(/GMT/, '').trim() + 'GMT';
  return formattedDate.toLowerCase();
}

async function base64ToBytes(base64) {
  const binaryString = Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function hmacSha256(key, data) {
  const hmac = crypto.createHmac('sha256', Buffer.from(key));
  hmac.update(data);
  return new Uint8Array(hmac.digest());
}

async function sign(urlStr) {
  const url = urlStr.split('://')[1];
  const encodedUrl = encodeURIComponent(url);
  const uuidStr = uuid();
  const formattedDate = dateFormat();
  const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
  const decode = await base64ToBytes('oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==');
  const signData = await hmacSha256(decode, bytesToSign);
  const signBase64 = await bytesToBase64(signData);
  return `MSTranslatorAndroidApp::${signBase64}::${formattedDate}::${uuidStr}`;
}

async function getEndpoint() {
  const endpointUrl = 'https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0';
  const headers = {
    'Accept-Language': 'zh-Hans',
    'X-ClientVersion': '4.0.530a 5fe1dc6c',
    'X-UserId': generateUserId(), 
    'X-HomeGeographicRegion': 'zh-Hans-CN',
    'X-ClientTraceId': uuid(),
    'X-MT-Signature': await sign(endpointUrl),
    'User-Agent': 'okhttp/4.5.0',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': '0',
    'Accept-Encoding': 'gzip'
  };

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: headers
  });
  return await response.json();
}

function getSsml(text, voiceName, rate, pitch, style = 'general') {
  text = escapeSSML(text);
  return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"> <voice name="${voiceName}"> <mstts:express-as style="${style}" styledegree="1.0" role="default"> <prosody rate="${rate}%" pitch="${pitch}%" volume="50">${text}</prosody> </mstts:express-as> </voice> </speak>`;
}

function voiceList() {
  // 检查缓存是否有效
  if (voiceListCache && voiceListCacheTime && (Date.now() - voiceListCacheTime) < VOICE_CACHE_DURATION) {
    console.log('使用缓存的语音列表数据，剩余有效期：',
      Math.round((VOICE_CACHE_DURATION - (Date.now() - voiceListCacheTime)) / 60000), '分钟');
    return Promise.resolve(voiceListCache);
  }

  console.log('获取新的语音列表数据');
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.26',
    'X-Ms-Useragent': 'SpeechStudio/2021.05.001',
    'Content-Type': 'application/json',
    'Origin': 'https://azure.microsoft.com',
    'Referer': 'https://azure.microsoft.com'
  };

  return fetch('https://eastus.api.speech.microsoft.com/cognitiveservices/voices/list', {
    headers: headers,
  })
  .then(res => res.json())
  .then(data => {
    // 更新缓存
    voiceListCache = data;
    voiceListCacheTime = Date.now();
    return data;
  });
}

async function getVoice(
  text,
  voiceName = 'zh-CN-XiaoxiaoMultilingualNeural',
  rate = 0,
  pitch = 0,
  style = 'general',
  outputFormat = 'audio-24khz-48kbitrate-mono-mp3',
  download = false
) {
  // get expiredAt from endpoint.t (jwt token)
  if (!expiredAt || Date.now() / 1000 > expiredAt - 60) {
    endpoint = await getEndpoint();
    const jwt = endpoint.t.split('.')[1];
    const decodedJwt = JSON.parse(Buffer.from(jwt, 'base64').toString());
    expiredAt = decodedJwt.exp;
    const seconds = (expiredAt - Date.now() / 1000);
    console.log('getEndpoint, expiredAt:' + (seconds/ 60) + 'm left');
  } else {
    const seconds = (expiredAt - Date.now() / 1000);
    console.log('expiredAt:' + (seconds/ 60) + 'm left');
  }

  const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const headers = {
    'Authorization': endpoint.t,
    'Content-Type': 'application/ssml+xml',
    'User-Agent': 'okhttp/4.5.0',
    'X-Microsoft-OutputFormat': outputFormat
  };
  const ssml = getSsml(text, voiceName, rate, pitch, style);

  const response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: ssml
  });

  if(response.ok) {
    const buffer = await response.buffer();
    const headers_obj = {};

    if (download) {
      headers_obj['Content-Disposition'] = `attachment; filename="${uuid()}.mp3"`;
    }

    headers_obj['Content-Type'] = response.headers.get('content-type') || 'audio/mpeg';

    return {
      status: 200,
      headers: headers_obj,
      body: buffer
    };
  } else {
    return {
      status: response.status,
      body: response.statusText
    };
  }
}

// 处理 OpenAI 格式的文本转语音请求
async function handleOpenAITTS(req, res) {
  // 验证请求方法是否为 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 验证 API 密钥
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid API key' });
  }

  const apiKey = authHeader.replace('Bearer ', '');
  if (!validateApiKey(apiKey)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }

  try {
    // 解析请求体 JSON
    const requestData = req.body;

    // 验证必要参数
    if (!requestData.model || !requestData.input) {
      return res.status(400).json({ error: 'Bad request: Missing required parameters' });
    }

    // 提取参数
    const text = requestData.input;
    // 映射 voice 参数 (可选择添加 model 到 voice 的映射逻辑)
    let voiceName = 'zh-CN-XiaoxiaoMultilingualNeural'; // 默认声音
    if (requestData.voice) {
      // OpenAI的voice参数有alloy, echo, fable, onyx, nova, shimmer
      // 可以根据需要进行映射
      const voiceMap = {
        'alloy': 'zh-CN-XiaoxiaoMultilingualNeural',
        'echo': 'zh-CN-YunxiNeural',
        'fable': 'zh-CN-XiaomoNeural',
        'onyx': 'zh-CN-YunjianNeural',
        'nova': 'zh-CN-XiaochenNeural',
        'shimmer': 'en-US-AriaNeural'
      };
      voiceName = voiceMap[requestData.voice] || requestData.voice;
    }

    // 速度和音调映射 (OpenAI 使用 0.25-4.0，我们使用 -100 到 100)
    let rate = 0;
    if (requestData.speed) {
      // 映射 0.25-4.0 到 -100 到 100 范围
      // 1.0 是正常速度，对应 rate=0
      rate = Math.round((requestData.speed - 1.0) * 100);
      // 限制范围
      rate = Math.max(-100, Math.min(100, rate));
    }

    // 设置输出格式
    const outputFormat = requestData.response_format === 'opus' ?
      'audio-48khz-192kbitrate-mono-opus' :
      'audio-24khz-48kbitrate-mono-mp3';

    // 调用 TTS API
    const ttsResponse = await getVoice(text, voiceName, rate, 0, requestData.model, outputFormat, false);

    if (ttsResponse.status === 200) {
      res.setHeader('Content-Type', ttsResponse.headers['Content-Type']);
      if (ttsResponse.headers['Content-Disposition']) {
        res.setHeader('Content-Disposition', ttsResponse.headers['Content-Disposition']);
      }
      return res.status(200).send(ttsResponse.body);
    } else {
      return res.status(ttsResponse.status).send(ttsResponse.body);
    }
  } catch (error) {
    console.error('OpenAI TTS API error:', error);
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
}

// 主处理函数
module.exports = async (req, res) => {
  // 设置CORS头，允许所有来源访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const path = url.pathname;

  // 处理静态文件请求
  if (path === '/favicon.svg' || path === '/favicon-16x16.svg' || path === '/favicon-32x32.svg' || path === '/icon-192.svg' || path === '/icon-512.svg' || path === '/sw.js') {
    const fs = require('fs');
    const pathModule = require('path');

    try {
      const filePath = pathModule.join(process.cwd(), 'public', path.substring(1));
      const fileContent = fs.readFileSync(filePath, 'utf8');

      // 根据文件类型设置 Content-Type
      if (path === '/sw.js') {
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'no-cache'); // Service Worker 不缓存
      } else {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // 缓存一年
      }

      return res.status(200).send(fileContent);
    } catch (error) {
      console.error('Static file error:', error);
      return res.status(404).send('File not found');
    }
  }

  // 处理 manifest.json
  if (path === '/manifest.json') {
    const fs = require('fs');
    const pathModule = require('path');

    try {
      const filePath = pathModule.join(process.cwd(), 'manifest.json');
      const fileContent = fs.readFileSync(filePath, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 缓存一天
      return res.status(200).send(fileContent);
    } catch (error) {
      console.error('Manifest file error:', error);
      return res.status(404).send('File not found');
    }
  }

  // 添加 /docs 路径处理
  if (path === '/docs') {
    const docsHtml = `<!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Microsoft TTS API 文档</title>
        <meta name="description" content="Microsoft TTS API 详细文档和使用指南">

        <!-- 网站图标 -->
        <link rel="icon" type="image/svg+xml" href="/favicon.svg">
        <link rel="icon" type="image/svg+xml" sizes="32x32" href="/favicon-32x32.svg">

        <script src="https://cdn.tailwindcss.com"></script>
        <style>
          .gradient-bg {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .glass-effect {
            backdrop-filter: blur(10px);
            background: rgba(255, 255, 255, 0.9);
            border: 1px solid rgba(255, 255, 255, 0.2);
          }
          .code-block {
            background: #1e293b;
            color: #e2e8f0;
            border-radius: 8px;
            padding: 16px;
            overflow-x: auto;
          }
          .tech-badge {
            display: inline-flex;
            align-items: center;
            padding: 8px 16px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 20px;
            font-weight: 500;
            margin: 4px;
            transition: transform 0.2s ease;
          }
          .tech-badge:hover {
            transform: translateY(-2px);
          }
        </style>
      </head>
      <body class="gradient-bg min-h-screen">
        <div class="container mx-auto px-4 py-8 max-w-6xl">
          <!-- 头部 -->
          <div class="text-center mb-12">
            <h1 class="text-5xl font-bold mb-4 text-white drop-shadow-lg">Microsoft TTS API 文档</h1>
            <p class="text-xl text-white/90 mb-6">强大的文本转语音服务 API 接口文档</p>
            <div class="flex justify-center items-center space-x-4">
              <a href="https://github.com/XCQ0607/tts_vercel" target="_blank" class="inline-flex items-center px-6 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-all duration-200 shadow-lg hover:shadow-xl">
                <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                GitHub 仓库
              </a>
              <a href="/" class="inline-flex items-center px-6 py-3 bg-white/20 text-white rounded-xl hover:bg-white/30 transition-all duration-200 backdrop-blur-sm">
                <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
                </svg>
                返回首页
              </a>
            </div>
            <div class="w-24 h-1 bg-white/50 mx-auto rounded-full mt-6"></div>
          </div>

          <!-- 技术栈展示 -->
          <div class="glass-effect p-6 rounded-2xl shadow-2xl mb-8">
            <h2 class="text-2xl font-bold mb-4 text-gray-800 text-center">🚀 技术栈</h2>
            <div class="flex flex-wrap justify-center">
              <span class="tech-badge">
                <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M0 0h24v24H0V0zm22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873-.736-.345-1.554-.585-1.797-1.14-.091-.33-.105-.51-.046-.705.15-.646.915-.84 1.515-.66.39.12.75.42.976.9 1.034-.676 1.034-.676 1.755-1.125-.27-.42-.404-.601-.586-.78-.63-.705-1.469-1.065-2.834-1.034l-.705.089c-.676.165-1.32.525-1.71 1.005-1.14 1.291-.811 3.541.569 4.471 1.365 1.02 3.361 1.244 3.616 2.205.24 1.17-.87 1.545-1.966 1.41-.811-.18-1.26-.586-1.755-1.336l-1.83 1.051c.21.48.45.689.81 1.109 1.74 1.756 6.09 1.666 6.871-1.004.029-.09.24-.705.074-1.65l.046.067zm-8.983-7.245h-2.248c0 1.938-.009 3.864-.009 5.805 0 1.232.063 2.363-.138 2.711-.33.689-1.18.601-1.566.48-.396-.196-.597-.466-.83-.855-.063-.105-.11-.196-.127-.196l-1.825 1.125c.305.63.75 1.172 1.324 1.517.855.51 2.004.675 3.207.405.783-.226 1.458-.691 1.811-1.411.51-.93.402-2.07.397-3.346.012-2.054 0-4.109 0-6.179l.004-.056z"/>
                </svg>
                JavaScript
              </span>
              <span class="tech-badge">
                <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12.001 4.8c-3.2 0-5.2 1.6-6 4.8 1.2-1.6 2.6-2.2 4.2-1.8.913.228 1.565.89 2.288 1.624C13.666 10.618 15.027 12 18.001 12c3.2 0 5.2-1.6 6-4.8-1.2 1.6-2.6 2.2-4.2 1.8-.913-.228-1.565-.89-2.288-1.624C16.337 6.182 14.976 4.8 12.001 4.8zm-6 7.2c-3.2 0-5.2 1.6-6 4.8 1.2-1.6 2.6-2.2 4.2-1.8.913.228 1.565.89 2.288 1.624 1.177 1.194 2.538 2.576 5.512 2.576 3.2 0 5.2-1.6 6-4.8-1.2 1.6-2.6 2.2-4.2 1.8-.913-.228-1.565-.89-2.288-1.624C10.337 13.382 8.976 12 6.001 12z"/>
                </svg>
                Tailwind CSS
              </span>
              <span class="tech-badge">
                <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 22.525H0l12-21.05 12 21.05z"/>
                </svg>
                Vercel
              </span>
              <span class="tech-badge">
                <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.998 24c-6.627 0-12-5.373-12-12s5.373-12 12-12 12 5.373 12 12-5.373 12-12 12zm.084-23.731c-6.46 0-11.731 5.271-11.731 11.731s5.271 11.731 11.731 11.731S23.814 18.46 23.814 12 18.543.269 12.082.269z"/>
                </svg>
                Microsoft Azure
              </span>
              <span class="tech-badge">
                <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M1.5 0h21l-1.91 21.563L11.977 24l-8.564-2.438L1.5 0zm7.031 9.75l-.232-2.718 10.059.003.23-2.622L5.412 4.41l.698 8.01h9.126l-.326 3.426-2.91.804-2.955-.81-.188-2.11H6.248l.33 4.171L12 19.351l5.379-1.443.744-8.157H8.531z"/>
                </svg>
                HTML5
              </span>
              <span class="tech-badge">
                <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M14.23 12.004a2.236 2.236 0 0 1-2.235 2.236 2.236 2.236 0 0 1-2.236-2.236 2.236 2.236 0 0 1 2.235-2.236 2.236 2.236 0 0 1 2.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278zm-.005 1.09v.006c.225 0 .406.044.558.127.666.382.955 1.835.73 3.704-.054.46-.142.945-.25 1.44-.96-.236-2.006-.417-3.107-.534-.66-.905-1.345-1.727-2.035-2.447 1.592-1.48 3.087-2.292 4.105-2.295zm-9.77.02c1.012 0 2.514.808 4.11 2.28-.686.72-1.37 1.537-2.02 2.442-1.107.117-2.154.298-3.113.538-.112-.49-.195-.964-.254-1.42-.23-1.868.054-3.32.714-3.707.19-.09.4-.127.563-.132zm4.882 3.05c.455.468.91.992 1.36 1.564-.44-.02-.89-.034-1.36-.034-.47 0-.92.014-1.36.034.44-.572.895-1.096 1.36-1.564zM12 8.1c.74 0 1.477.034 2.202.093.406.582.802 1.203 1.183 1.86.372.64.71 1.29 1.018 1.946-.308.655-.646 1.31-1.013 1.95-.38.66-.773 1.288-1.18 1.87-.728.063-1.466.098-2.21.098-.74 0-1.477-.035-2.202-.093-.406-.582-.802-1.204-1.183-1.86-.372-.64-.71-1.29-1.018-1.946.303-.657.646-1.313 1.013-1.954.38-.66.773-1.286 1.18-1.868.728-.064 1.466-.098 2.21-.098zm-3.635.254c-.24.377-.48.763-.704 1.16-.225.39-.435.782-.635 1.174-.265-.656-.49-1.31-.676-1.947.64-.15 1.315-.283 2.015-.386zm7.26 0c.695.103 1.365.23 2.006.387-.18.632-.405 1.282-.66 1.933-.2-.39-.41-.783-.64-1.174-.225-.392-.465-.774-.705-1.146zm3.063.675c.484.15.944.317 1.375.498 1.732.74 2.852 1.708 2.852 2.476-.005.768-1.125 1.74-2.857 2.475-.42.18-.88.342-1.355.493-.28-.958-.646-1.956-1.1-2.98.45-1.017.81-2.01 1.085-2.964zm-13.395.004c.278.96.645 1.957 1.1 2.98-.45 1.017-.812 2.01-1.086 2.964-.484-.15-.944-.318-1.37-.5-1.732-.737-2.852-1.706-2.852-2.474 0-.768 1.12-1.742 2.852-2.476.42-.18.88-.342 1.356-.494zm11.678 4.28c.265.657.49 1.312.676 1.948-.64.157-1.316.29-2.016.39.24-.375.48-.762.705-1.158.225-.39.435-.788.636-1.18zm-9.945.02c.2.392.41.783.64 1.175.23.39.465.772.705 1.143-.695-.102-1.365-.23-2.006-.386.18-.63.406-1.282.66-1.933zM17.92 16.32c.112.493.2.968.254 1.423.23 1.868-.054 3.32-.714 3.708-.147.09-.338.128-.563.128-1.012 0-2.514-.807-4.11-2.28.686-.72 1.37-1.536 2.02-2.44 1.107-.118 2.154-.3 3.113-.54zm-11.83.01c.96.234 2.006.415 3.107.532.66.905 1.345 1.727 2.035 2.446-1.595 1.483-3.092 2.295-4.11 2.295-.22-.005-.406-.05-.553-.132-.666-.38-.955-1.834-.73-3.703.054-.46.142-.944.25-1.438zm4.56.64c.44.02.89.034 1.36.034.47 0 .92-.014 1.36-.034-.44.572-.895 1.095-1.36 1.56-.465-.467-.92-.992-1.36-1.56z"/>
                </svg>
                React
              </span>
            </div>
          </div>

          <!-- 基本 TTS 接口 -->
          <div class="glass-effect p-6 rounded-2xl shadow-2xl mb-8">
            <h2 class="text-2xl font-bold mb-6 text-gray-800 flex items-center">
              <svg class="w-6 h-6 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>
              </svg>
              基本 TTS 接口
            </h2>
            <div class="overflow-x-auto">
              <table class="min-w-full border-collapse">
                <thead>
                  <tr class="bg-gray-100">
                    <th class="border border-gray-300 px-4 py-2 text-left">参数</th>
                    <th class="border border-gray-300 px-4 py-2 text-left">描述</th>
                    <th class="border border-gray-300 px-4 py-2 text-left">示例</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="border border-gray-300 px-4 py-2 font-medium">URL</td>
                    <td class="border border-gray-300 px-4 py-2" colspan="2">/tts</td>
                  </tr>
                  <tr>
                    <td class="border border-gray-300 px-4 py-2 font-medium">t</td>
                    <td class="border border-gray-300 px-4 py-2">需要转换的文本</td>
                    <td class="border border-gray-300 px-4 py-2">t=你好世界</td>
                  </tr>
                  <tr>
                    <td class="border border-gray-300 px-4 py-2 font-medium">v</td>
                    <td class="border border-gray-300 px-4 py-2">语音名称</td>
                    <td class="border border-gray-300 px-4 py-2">v=zh-CN-XiaoxiaoMultilingualNeural</td>
                  </tr>
                  <tr>
                    <td class="border border-gray-300 px-4 py-2 font-medium">r</td>
                    <td class="border border-gray-300 px-4 py-2">语速调整 (-100 到 100)</td>
                    <td class="border border-gray-300 px-4 py-2">r=10</td>
                  </tr>
                  <tr>
                    <td class="border border-gray-300 px-4 py-2 font-medium">p</td>
                    <td class="border border-gray-300 px-4 py-2">音调调整 (-100 到 100)</td>
                    <td class="border border-gray-300 px-4 py-2">p=5</td>
                  </tr>
                  <tr>
                    <td class="border border-gray-300 px-4 py-2 font-medium">s</td>
                    <td class="border border-gray-300 px-4 py-2">说话风格</td>
                    <td class="border border-gray-300 px-4 py-2">s=cheerful</td>
                  </tr>
                  <tr>
                    <td class="border border-gray-300 px-4 py-2 font-medium">o</td>
                    <td class="border border-gray-300 px-4 py-2">输出格式</td>
                    <td class="border border-gray-300 px-4 py-2">o=audio-24khz-48kbitrate-mono-mp3</td>
                  </tr>
                  <tr>
                    <td class="border border-gray-300 px-4 py-2 font-medium">d</td>
                    <td class="border border-gray-300 px-4 py-2">是否作为下载文件</td>
                    <td class="border border-gray-300 px-4 py-2">d=true</td>
                  </tr>
                  <tr>
                    <td class="border border-gray-300 px-4 py-2 font-medium">api_key</td>
                    <td class="border border-gray-300 px-4 py-2">API密钥，用于认证</td>
                    <td class="border border-gray-300 px-4 py-2">api_key=your_api_key</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="bg-white p-6 rounded-lg shadow-md mb-6">
            <h2 class="text-xl font-semibold mb-4 text-gray-800">OpenAI 兼容接口</h2>
            <p class="mb-4">支持 OpenAI 格式的 TTS 请求，可用于与支持 OpenAI 的客户端集成。</p>
            <div class="bg-gray-100 p-4 rounded-md mb-4">
              <p class="text-sm font-mono">POST /v1/audio/speech</p>
              <p class="text-xs text-gray-600 mt-1">或 POST /audio/speech</p>
            </div>
            <p class="mb-2 font-medium">请求体示例：</p>
            <pre class="bg-gray-100 p-4 rounded-md overflow-x-auto text-sm">
{
  "model": "tts-1",
  "input": "你想要转换的文本",
  "voice": "alloy",
  "speed": 1.0,
  "response_format": "mp3"
}</pre>
          </div>

          <div class="bg-white p-6 rounded-lg shadow-md">
            <h2 class="text-xl font-semibold mb-4 text-gray-800">其他接口</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><span class="font-medium">/voices</span> - 获取可用语音列表</li>
              <li><span class="font-medium">/reader.json</span> - 阅读器配置接口</li>
              <li><span class="font-medium">/ifreetime.json</span> - IFreeTime 应用配置接口</li>
            </ul>
          </div>

          <p class="text-center mt-8">
            <a href="/" class="text-blue-600 hover:underline">返回主页</a>
          </p>
        </div>
      </body>
    </html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(docsHtml);
  }

  if (path === '/tts') {
    // 从请求参数获取 API 密钥
    const apiKey = url.searchParams.get('api_key');

    // 验证 API 密钥
    if (!validateApiKey(apiKey)) {
      // 改进 401 错误响应，提供更友好的错误信息
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(401).json({
        error: 'Unauthorized',
        message: '无效的 API 密钥，请确保您提供了正确的密钥。',
        status: 401
      });
    }

    const text = url.searchParams.get('t') || '';
    const voiceName = url.searchParams.get('v') || 'zh-CN-XiaoxiaoMultilingualNeural';
    const rate = Number(url.searchParams.get('r')) || 0;
    const pitch = Number(url.searchParams.get('p')) || 0;
    const style = url.searchParams.get('s') || 'general';
    const outputFormat = url.searchParams.get('o') || 'audio-24khz-48kbitrate-mono-mp3';
    const download = url.searchParams.get('d') === 'true';


    try {
      const response = await getVoice(text, voiceName, rate, pitch, style, outputFormat, download);

      if (response.status === 200) {
        // 正常返回音频数据
        res.setHeader('Content-Type', response.headers['Content-Type']);
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        if (response.headers['Content-Disposition']) {
          res.setHeader('Content-Disposition', response.headers['Content-Disposition']);
        }
        return res.status(200).send(response.body);
      } else {
        return res.status(response.status).send(response.body);
      }
    } catch (error) {
      console.error('TTS API error:', error);
      return res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
  }

  // 添加 reader.json 路径处理
  if (path === '/reader.json') {
    // 从请求参数获取 API 密钥
    const apiKey = url.searchParams.get('api_key');

    // 验证 API 密钥
    if (!validateApiKey(apiKey)) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(401).json({
        error: 'Unauthorized',
        message: '无效的 API 密钥，请确保您提供了正确的密钥。',
        status: 401
      });
    }

    // 从URL参数获取
    const voice = url.searchParams.get('v') || '';
    const rate = url.searchParams.get('r') || '';
    const pitch = url.searchParams.get('p') || '';
    const style = url.searchParams.get('s') || '';
    const displayName = url.searchParams.get('n') || 'Microsoft TTS';

    // 构建基本URL
    const baseUrl = `${url.protocol}//${url.host}`;

    // 构建URL参数
    const urlParams = ["t={{java.encodeURI(speakText)}}", "r={{speakSpeed*4}}"];

    // 只有有值的参数才添加
    if (voice) {
      urlParams.push(`v=${voice}`);
    }

    if (pitch) {
      urlParams.push(`p=${pitch}`);
    }

    if (style) {
      urlParams.push(`s=${style}`);
    }

    if (apiKey) {
      urlParams.push(`api_key=${apiKey}`);
    }

    const finalUrl = `${baseUrl}/tts?${urlParams.join('&')}`;

    // 返回 reader 响应
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({
      id: Date.now(),
      name: displayName,
      url: finalUrl
    });
  }

  // 添加 ifreetime.json 路径处理
  if (path === '/ifreetime.json') {
    // 从请求参数获取 API 密钥
    const apiKey = url.searchParams.get('api_key');

    // 验证 API 密钥
    if (!validateApiKey(apiKey)) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(401).json({
        error: 'Unauthorized',
        message: '无效的 API 密钥，请确保您提供了正确的密钥。',
        status: 401
      });
    }

    // 从URL参数获取
    const voice = url.searchParams.get('v') || '';
    const rate = url.searchParams.get('r') || '';
    const pitch = url.searchParams.get('p') || '';
    const style = url.searchParams.get('s') || '';
    const displayName = url.searchParams.get('n') || 'Microsoft TTS';

    // 构建基本URL
    const baseUrl = `${url.protocol}//${url.host}`;
    const finalUrl = `${baseUrl}/tts`;

    // 生成随机的唯一ID
    const ttsConfigID = crypto.randomUUID();

    // 构建请求参数
    const params = {
      "t": "%@", // %@ 是 IFreeTime 中的文本占位符
      "v": voice,
      "r": rate,
      "p": pitch,
      "s": style
    };

    // 如果需要API密钥认证，添加到请求参数
    if (apiKey) {
      params["api_key"] = apiKey;
    }

    // 构建响应
    const response = {
      loginUrl: "",
      maxWordCount: "",
      customRules: {},
      ttsConfigGroup: "Azure",
      _TTSName: displayName,
      _ClassName: "JxdAdvCustomTTS",
      _TTSConfigID: ttsConfigID,
      httpConfigs: {
        useCookies: 1,
        headers: {}
      },
      voiceList: [],
      ttsHandles: [
        {
          paramsEx: "",
          processType: 1,
          maxPageCount: 1,
          nextPageMethod: 1,
          method: 1,
          requestByWebView: 0,
          parser: {},
          nextPageParams: {},
          url: finalUrl,
          params: params,
          httpConfigs: {
            useCookies: 1,
            headers: {}
          }
        }
      ]
    };

    // 返回 IFreeTime 响应
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json(response);
  }

  // 添加 OpenAI 兼容接口路由
  if (path === '/v1/audio/speech' || path === '/audio/speech') {
    return await handleOpenAITTS(req, res);
  }

  // 添加语音列表接口
  if (path === '/voices') {
    try {
      const l = (url.searchParams.get('l') || '').toLowerCase();
      let response = await voiceList();

      if (l.length > 0) {
        response = response.filter(item => item.Locale.toLowerCase().includes(l));
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).json(response);
    } catch (error) {
      console.error('Voice list error:', error);
      return res.status(500).json({ error: 'Failed to fetch voice list' });
    }
  }



  // 默认主页
  const mainPageHtml = `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Microsoft TTS API - 智能文本转语音服务</title>
      <meta name="description" content="基于Microsoft Azure的现代化文本转语音服务，支持多种语言和语音风格">
      <meta name="keywords" content="TTS,文本转语音,Microsoft,Azure,语音合成,AI语音">

      <!-- 网站图标 -->
      <link rel="icon" type="image/svg+xml" href="/favicon.svg">
      <link rel="icon" type="image/svg+xml" sizes="16x16" href="/favicon-16x16.svg">
      <link rel="icon" type="image/svg+xml" sizes="32x32" href="/favicon-32x32.svg">
      <link rel="icon" type="image/svg+xml" sizes="192x192" href="/icon-192.svg">
      <link rel="apple-touch-icon" href="/icon-192.svg">

      <!-- PWA 支持 -->
      <link rel="manifest" href="/manifest.json">
      <meta name="theme-color" content="#667eea">
      <meta name="apple-mobile-web-app-capable" content="yes">
      <meta name="apple-mobile-web-app-status-bar-style" content="default">
      <meta name="apple-mobile-web-app-title" content="TTS API">

      <script src="https://cdn.tailwindcss.com"></script>

      <!-- Plyr.js 现代化音频播放器 -->
      <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
      <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>


      </script>
      <style>
        .loading-spinner {
          border: 3px solid #f3f4f6;
          border-top: 3px solid #3b82f6;
          border-radius: 50%;
          width: 20px;
          height: 20px;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .gradient-bg {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .glass-effect {
          backdrop-filter: blur(10px);
          background: rgba(255, 255, 255, 0.9);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .history-item {
          transition: all 0.3s ease;
        }
        .history-item:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
        }
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        }
        .slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        }
        input[type="checkbox"]:checked + div {
          background: linear-gradient(to right, #3b82f6, #8b5cf6) !important;
        }
        input[type="checkbox"]:checked + div .dot {
          transform: translateX(200%);
          background-color: #ffffff;
          border-color: #3b82f6;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        }
        input[type="checkbox"]:checked + div > div:last-child {
          opacity: 1;
        }
        .dot {
          transition: all 0.3s ease-in-out;
        }

        /* Plyr.js 播放器样式自定义 */
        .plyr {
          border-radius: 12px;
          overflow: visible; /* 允许菜单溢出 */
          position: relative;
        }

        .plyr--audio .plyr__controls {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 12px;
          padding: 16px;
          position: relative;
          overflow: visible; /* 允许菜单溢出 */
        }

        .plyr__control--overlaid {
          background: rgba(255, 255, 255, 0.9);
        }

        .plyr__control:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .plyr__progress__buffer {
          color: rgba(255, 255, 255, 0.3);
        }

        .plyr__progress__played {
          color: #fff;
        }

        .plyr__volume {
          color: #fff;
        }

        .plyr__time {
          color: rgba(255, 255, 255, 0.9);
        }

        /* 修复设置菜单显示问题 */
        .plyr__menu {
          z-index: 1000 !important;
          position: absolute !important;
          background: white !important;
          border-radius: 8px !important;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15) !important;
          border: 1px solid rgba(0, 0, 0, 0.1) !important;
          overflow: visible !important;
          /* 桌面版也放在上方 */
          bottom: 50px !important;
          top: auto !important;
          right: 8px !important;
          min-width: 120px !important;
        }

        .plyr__menu__container {
          background: white !important;
          border-radius: 8px !important;
          overflow: visible !important;
          backdrop-filter: blur(10px) !important;
          border: 1px solid rgba(255, 255, 255, 0.2) !important;
        }

        .plyr__control--pressed .plyr__menu {
          display: block !important;
          opacity: 1 !important;
          transform: translateY(0) !important;
          animation: menuSlideIn 0.2s ease-out !important;
        }

        /* 菜单动画 */
        @keyframes menuSlideIn {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        /* 菜单箭头指示器 */
        .plyr__menu::after {
          content: '';
          position: absolute;
          bottom: -8px;
          right: 20px;
          width: 0;
          height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-top: 8px solid white;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
        }

        .plyr__menu [role="menuitemradio"] {
          color: #374151 !important;
          padding: 10px 16px !important;
          font-size: 14px !important;
          transition: all 0.2s ease !important;
          border-radius: 4px !important;
          margin: 2px 4px !important;
        }

        .plyr__menu [role="menuitemradio"]:hover {
          background: #f3f4f6 !important;
          transform: translateX(2px) !important;
        }

        .plyr__menu [role="menuitemradio"][aria-checked="true"] {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
          color: white !important;
          font-weight: 500 !important;
        }

        /* 确保播放器容器不会裁剪菜单 */
        #modernAudioPlayer {
          overflow: visible !important;
          position: relative;
          z-index: 10;
        }

        #audioContainer {
          overflow: visible !important;
          position: relative;
        }

        /* 移动端菜单优化 */
        @media (max-width: 768px) {
          .plyr__menu {
            right: 8px !important;
            left: auto !important;
            top: auto !important;
            bottom: 55px !important; /* 在控制栏上方显示 */
            min-width: 100px !important;
            max-width: 140px !important;
            transform: none !important;
          }

          .plyr__menu [role="menuitemradio"] {
            padding: 12px 14px !important;
            font-size: 14px !important;
            touch-action: manipulation;
            white-space: nowrap !important;
            margin: 1px 2px !important;
          }

          /* 移动端隐藏音量控制，避免重叠 */
          .plyr--audio .plyr__controls .plyr__volume {
            display: none !important;
          }

          /* 调整移动端控制栏布局 */
          .plyr--audio .plyr__controls {
            padding: 12px 16px !important;
          }

          /* 确保设置按钮有足够的触摸区域 */
          .plyr__control--pressed,
          .plyr__control[aria-expanded="true"] {
            background: rgba(255, 255, 255, 0.3) !important;
          }
        }

        /* 确保菜单在所有容器之上 */
        .plyr__menu,
        .plyr__menu__container {
          z-index: 9999 !important;
        }

        /* 超小屏幕优化 */
        @media (max-width: 480px) {
          .plyr__menu {
            right: 4px !important;
            bottom: 55px !important;
            min-width: 90px !important;
            max-width: 120px !important;
          }

          .plyr__menu [role="menuitemradio"] {
            padding: 8px 10px !important;
            font-size: 13px !important;
          }

          .plyr--audio .plyr__controls {
            padding: 10px 12px !important;
          }

          /* 确保进度条在小屏幕上有足够的触摸区域 */
          .plyr__progress {
            height: 8px !important;
          }

          .plyr__progress input[type="range"] {
            height: 20px !important;
          }
        }

        /* 简化的样式 */
        #modernAudioPlayer {
          animation: fadeIn 0.5s ease-in-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* 通知样式 */
        .notification {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 9999;
          max-width: 400px;
          min-width: 300px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
          border-left: 4px solid;
          padding: 16px 20px;
          transform: translateX(100%);
          transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        }

        .notification.show {
          transform: translateX(0);
        }

        .notification.success {
          border-left-color: #10b981;
        }

        .notification.error {
          border-left-color: #ef4444;
        }

        .notification.warning {
          border-left-color: #f59e0b;
        }

        .notification.info {
          border-left-color: #3b82f6;
        }

          .mobile-download-container button {
            width: 48px;
            height: 48px;
            min-width: 48px;
          }

          /* 超小屏幕播放速度 */
          .mobile-speed-container {
            flex-direction: column;
            align-items: center;
            text-align: center;
            gap: 10px;
          }

          .mobile-speed-container select {
            padding: 10px 14px;
            font-size: 14px;
            min-width: 90px;
          }

          .mobile-speed-container > div:first-child {
            margin-bottom: 6px;
          }

          /* 超小屏幕播放按钮 */
          #playPauseBtn {
            width: 48px;
            height: 48px;
          }

          /* 超小屏幕静音按钮 */
          #muteBtn {
            min-width: 36px;
            min-height: 36px;
          }
        }
      </style>
    </head>
    <body class="gradient-bg min-h-screen">
      <div class="container mx-auto px-4 py-8 max-w-6xl">
        <div class="text-center mb-12">
          <h1 class="text-5xl font-bold mb-4 text-white drop-shadow-lg">Microsoft TTS API</h1>
          <p class="text-xl text-white/90 mb-6">智能文本转语音服务</p>
          <div class="w-24 h-1 bg-white/50 mx-auto rounded-full"></div>
        </div>

        <div class="max-w-6xl mx-auto space-y-6">
          <!-- 主要功能区 -->
          <div class="glass-effect p-6 rounded-2xl shadow-2xl">
            <h2 class="text-2xl font-bold mb-6 text-gray-800 flex items-center">
              <svg class="w-6 h-6 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>
              </svg>
              在线文本转语音
            </h2>

              <div class="mb-6">
                <label for="text" class="block text-sm font-semibold text-gray-700 mb-2">文本内容</label>
                <textarea id="text" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 resize-none" rows="4" placeholder="请输入要转换的文本..."></textarea>
                <div class="text-right text-sm text-gray-500 mt-1">
                  <span id="textCount">0</span> 字符
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <label for="voice" class="block text-sm font-semibold text-gray-700 mb-2">语音选择</label>
                  <div class="relative">
                    <select id="voice" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white appearance-none cursor-pointer hover:border-blue-300">
                      <!-- 多语言语音 -->
                      <optgroup label="🌍 多语言语音">
                        <option value="zh-CN-XiaoxiaoMultilingualNeural">晓晓 多语言 (女)</option>
                        <option value="zh-CN-YunfanMultilingualNeural">Yunfan 多语言 (男)</option>
                        <option value="zh-CN-YunxiaoMultilingualNeural">Yunxiao 多语言 (男)</option>
                      </optgroup>

                      <!-- 中文普通话 -->
                      <optgroup label="🇳 中文普通话">
                        <option value="zh-CN-XiaoxiaoNeural">晓晓 (女)</option>
                        <option value="zh-CN-YunxiNeural">云希 (男)</option>
                        <option value="zh-CN-YunjianNeural">云健 (男)</option>
                        <option value="zh-CN-XiaoyiNeural">晓伊 (女)</option>
                        <option value="zh-CN-YunyangNeural">云扬 (男)</option>
                        <option value="zh-CN-XiaochenNeural">晓辰 (女)</option>
                        <option value="zh-CN-XiaohanNeural">晓涵 (女)</option>
                        <option value="zh-CN-XiaomengNeural">晓梦 (女)</option>
                        <option value="zh-CN-XiaomoNeural">晓墨 (女)</option>
                        <option value="zh-CN-XiaoqiuNeural">晓秋 (女)</option>
                        <option value="zh-CN-XiaorouNeural">晓柔 (女)</option>
                        <option value="zh-CN-XiaoruiNeural">晓睿 (女)</option>
                        <option value="zh-CN-XiaoshuangNeural">晓双 (女)</option>
                        <option value="zh-CN-XiaoyanNeural">晓颜 (女)</option>
                        <option value="zh-CN-XiaoyouNeural">晓悠 (女)</option>
                        <option value="zh-CN-XiaozhenNeural">晓甄 (女)</option>
                        <option value="zh-CN-YunfengNeural">云枫 (男)</option>
                        <option value="zh-CN-YunhaoNeural">云皓 (男)</option>
                        <option value="zh-CN-YunjieNeural">云杰 (男)</option>
                        <option value="zh-CN-YunxiaNeural">云夏 (男)</option>
                        <option value="zh-CN-YunyeNeural">云野 (男)</option>
                        <option value="zh-CN-YunzeNeural">云泽 (男)</option>
                      </optgroup>

                      <!-- 中文方言 -->
                      <optgroup label="🏮 中文方言">
                        <option value="zh-CN-guangxi-YunqiNeural">云奇 广西 (男)</option>
                        <option value="zh-CN-henan-YundengNeural">云登 河南 (男)</option>
                        <option value="zh-CN-liaoning-XiaobeiNeural">晓北 辽宁 (女)</option>
                        <option value="zh-CN-liaoning-YunbiaoNeural">云彪 辽宁 (男)</option>
                        <option value="zh-CN-shaanxi-XiaoniNeural">晓妮 陕西 (女)</option>
                        <option value="zh-CN-shandong-YunxiangNeural">云翔 山东 (男)</option>
                        <option value="zh-CN-sichuan-YunxiNeural">云希 四川 (男)</option>
                      </optgroup>

                      <!-- 中文港台 -->
                      <optgroup label="🏙️ 中文港台">
                        <option value="zh-HK-HiuMaanNeural">曉曼 香港 (女)</option>
                        <option value="zh-HK-WanLungNeural">雲龍 香港 (男)</option>
                        <option value="zh-HK-HiuGaaiNeural">曉佳 香港 (女)</option>
                        <option value="zh-TW-HsiaoChenNeural">曉臻 台湾 (女)</option>
                        <option value="zh-TW-YunJheNeural">雲哲 台湾 (男)</option>
                        <option value="zh-TW-HsiaoYuNeural">曉雨 台湾 (女)</option>
                      </optgroup>

                      <!-- 英语 -->
                      <optgroup label="🇺🇸 英语">
                        <option value="en-US-AriaNeural">Aria 美国 (女)</option>
                        <option value="en-US-GuyNeural">Guy 美国 (男)</option>
                        <option value="en-US-JennyNeural">Jenny 美国 (女)</option>
                        <option value="en-US-DavisNeural">Davis 美国 (男)</option>
                        <option value="en-US-AmberNeural">Amber 美国 (女)</option>
                        <option value="en-US-AnaNeural">Ana 美国 (女)</option>
                        <option value="en-US-BrandonNeural">Brandon 美国 (男)</option>
                        <option value="en-US-ChristopherNeural">Christopher 美国 (男)</option>
                        <option value="en-US-CoraNeural">Cora 美国 (女)</option>
                        <option value="en-US-ElizabethNeural">Elizabeth 美国 (女)</option>
                        <option value="en-US-EricNeural">Eric 美国 (男)</option>
                        <option value="en-US-JacobNeural">Jacob 美国 (男)</option>
                        <option value="en-US-JaneNeural">Jane 美国 (女)</option>
                        <option value="en-US-JasonNeural">Jason 美国 (男)</option>
                        <option value="en-US-MichelleNeural">Michelle 美国 (女)</option>
                        <option value="en-US-MonicaNeural">Monica 美国 (女)</option>
                        <option value="en-US-NancyNeural">Nancy 美国 (女)</option>
                        <option value="en-US-RogerNeural">Roger 美国 (男)</option>
                        <option value="en-US-SaraNeural">Sara 美国 (女)</option>
                        <option value="en-US-SteffanNeural">Steffan 美国 (男)</option>
                        <option value="en-US-TonyNeural">Tony 美国 (男)</option>
                        <option value="en-GB-LibbyNeural">Libby 英国 (女)</option>
                        <option value="en-GB-MaisieNeural">Maisie 英国 (女)</option>
                        <option value="en-GB-RyanNeural">Ryan 英国 (男)</option>
                        <option value="en-GB-SoniaNeural">Sonia 英国 (女)</option>
                        <option value="en-GB-ThomasNeural">Thomas 英国 (男)</option>
                      </optgroup>

                      <!-- 日语 -->
                      <optgroup label="🇯🇵 日语">
                        <option value="ja-JP-NanamiNeural">Nanami (女)</option>
                        <option value="ja-JP-KeitaNeural">Keita (男)</option>
                        <option value="ja-JP-AoiNeural">Aoi (女)</option>
                        <option value="ja-JP-DaichiNeural">Daichi (男)</option>
                        <option value="ja-JP-MayuNeural">Mayu (女)</option>
                        <option value="ja-JP-NaokiNeural">Naoki (男)</option>
                        <option value="ja-JP-ShioriNeural">Shiori (女)</option>
                      </optgroup>

                      <!-- 其他语言 -->
                      <optgroup label="🌐 其他语言">
                        <option value="ko-KR-InJoonNeural">InJoon 韩语 (男)</option>
                        <option value="ko-KR-SunHiNeural">SunHi 韩语 (女)</option>
                        <option value="fr-FR-DeniseNeural">Denise 法语 (女)</option>
                        <option value="fr-FR-HenriNeural">Henri 法语 (男)</option>
                        <option value="de-DE-KatjaNeural">Katja 德语 (女)</option>
                        <option value="de-DE-ConradNeural">Conrad 德语 (男)</option>
                        <option value="es-ES-ElviraNeural">Elvira 西班牙语 (女)</option>
                        <option value="es-ES-AlvaroNeural">Alvaro 西班牙语 (男)</option>
                        <option value="it-IT-ElsaNeural">Elsa 意大利语 (女)</option>
                        <option value="it-IT-DiegoNeural">Diego 意大利语 (男)</option>
                        <option value="pt-BR-FranciscaNeural">Francisca 葡萄牙语 (女)</option>
                        <option value="pt-BR-AntonioNeural">Antonio 葡萄牙语 (男)</option>
                        <option value="ru-RU-SvetlanaNeural">Svetlana 俄语 (女)</option>
                        <option value="ru-RU-DmitryNeural">Dmitry 俄语 (男)</option>
                        <option value="ar-SA-ZariyahNeural">Zariyah 阿拉伯语 (女)</option>
                        <option value="ar-SA-HamedNeural">Hamed 阿拉伯语 (男)</option>
                        <option value="hi-IN-SwaraNeural">Swara 印地语 (女)</option>
                        <option value="hi-IN-MadhurNeural">Madhur 印地语 (男)</option>
                        <option value="th-TH-PremwadeeNeural">Premwadee 泰语 (女)</option>
                        <option value="th-TH-NiwatNeural">Niwat 泰语 (男)</option>
                        <option value="vi-VN-HoaiMyNeural">HoaiMy 越南语 (女)</option>
                        <option value="vi-VN-NamMinhNeural">NamMinh 越南语 (男)</option>
                      </optgroup>
                    </select>
                    <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                      </svg>
                    </div>
                  </div>
                </div>

                <div>
                  <label for="style" class="block text-sm font-semibold text-gray-700 mb-2">语音风格</label>
                  <div class="relative">
                    <select id="style" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white appearance-none cursor-pointer hover:border-blue-300">
                      <option value="general">😊 标准</option>
                      <option value="advertisement_upbeat">📢 广告热情</option>
                      <option value="affectionate">🥰 亲切</option>
                      <option value="angry">😠 愤怒</option>
                      <option value="assistant">🤖 助理</option>
                      <option value="calm">😌 平静</option>
                      <option value="chat">💬 随意</option>
                      <option value="cheerful">😄 愉快</option>
                      <option value="customerservice">📞 客服</option>
                      <option value="depressed">� 沮丧</option>
                      <option value="disgruntled">😤 不满</option>
                      <option value="documentary-narration">🎬 纪录片解说</option>
                      <option value="embarrassed">😳 尴尬</option>
                      <option value="empathetic">🤗 共情</option>
                      <option value="envious">� 羡慕</option>
                      <option value="excited">🤩 兴奋</option>
                      <option value="fearful">😨 恐惧</option>
                      <option value="friendly">😊 友好</option>
                      <option value="gentle">😌 温柔</option>
                      <option value="hopeful">🌟 希望</option>
                      <option value="lyrical">🎵 抒情</option>
                      <option value="narration-professional">🎙️ 专业叙述</option>
                      <option value="narration-relaxed">😎 轻松叙述</option>
                      <option value="newscast">📺 新闻播报</option>
                      <option value="newscast-casual">📻 随意新闻</option>
                      <option value="newscast-formal">📰 正式新闻</option>
                      <option value="poetry-reading">📖 诗朗诵</option>
                      <option value="sad">� 悲伤</option>
                      <option value="serious">😐 严肃</option>
                      <option value="shouting">📣 大喊</option>
                      <option value="sports_commentary">⚽ 体育解说</option>
                      <option value="sports_commentary_excited">🏆 激动体育解说</option>
                      <option value="whispering">� 低语</option>
                      <option value="terrified">😱 恐慌</option>
                      <option value="unfriendly">� 冷漠</option>
                    </select>
                    <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                      </svg>
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <label for="rate" class="block text-sm font-semibold text-gray-700 mb-2">语速调节: <span id="rateValue" class="text-blue-600 font-bold">0</span>%</label>
                  <input type="range" id="rate" min="-100" max="100" value="0" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider" oninput="document.getElementById('rateValue').textContent = this.value">
                  <div class="flex justify-between text-xs text-gray-500 mt-1">
                    <span>慢</span>
                    <span>正常</span>
                    <span>快</span>
                  </div>
                </div>

                <div>
                  <label for="pitch" class="block text-sm font-semibold text-gray-700 mb-2">音调调节: <span id="pitchValue" class="text-blue-600 font-bold">0</span>%</label>
                  <input type="range" id="pitch" min="-100" max="100" value="0" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider" oninput="document.getElementById('pitchValue').textContent = this.value">
                  <div class="flex justify-between text-xs text-gray-500 mt-1">
                    <span>低</span>
                    <span>正常</span>
                    <span>高</span>
                  </div>
                </div>
              </div>

              <div class="mb-6">
                <label for="apiKey" class="block text-sm font-semibold text-gray-700 mb-2">API 密钥</label>
                <input type="password" id="apiKey" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200" placeholder="输入 API 密钥（可选）">
              </div>

              <div class="flex flex-col sm:flex-row justify-between items-center gap-4">
                <button id="generateBtn" class="flex-1 sm:flex-none px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 focus:outline-none focus:ring-4 focus:ring-blue-300 transition-all duration-200 font-semibold text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-1 flex items-center justify-center">
                  <span id="btnText">🎵 生成语音</span>
                  <div id="loadingSpinner" class="loading-spinner ml-2 hidden"></div>
                </button>
                <div class="flex items-center">
                  <label class="modern-toggle flex items-center cursor-pointer group">
                    <input type="checkbox" id="download" class="sr-only">
                    <div class="toggle-bg relative w-14 h-7 bg-gray-300 rounded-full shadow-inner transition-all duration-300 ease-in-out">
                      <div class="toggle-dot absolute w-6 h-6 bg-white rounded-full shadow-lg top-0.5 left-0.5 transition-all duration-300 ease-in-out flex items-center justify-center">
                        <svg class="download-icon w-3 h-3 text-gray-400 transition-all duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3"></path>
                        </svg>
                      </div>
                    </div>
                    <span class="ml-3 text-gray-700 font-medium select-none flex items-center transition-colors duration-200">
                      <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                      </svg>
                      下载文件
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- 语音输出区域 -->
          <div class="glass-effect p-4 rounded-2xl shadow-2xl">
            <h3 class="text-lg font-bold mb-3 text-gray-800 flex items-center">
              <svg class="w-4 h-4 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
              </svg>
              语音输出
            </h3>
            <div id="audioContainer">
              <!-- 等待状态 -->
              <div id="audioPlaceholder" class="text-center py-8">
                <div class="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-100 to-purple-100 rounded-full mb-4">
                  <svg class="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
                  </svg>
                </div>
                <p class="text-gray-500 mb-2">等待生成语音...</p>
                <p class="text-sm text-gray-400">生成完成后将显示现代化播放器</p>
              </div>

              <!-- Plyr.js 现代化音频播放器 -->
              <div id="modernAudioPlayer" class="hidden">
                <audio id="audioElement" preload="metadata" controls crossorigin playsinline>
                  <source id="audioSource" src="" type="audio/mpeg">
                  您的浏览器不支持音频播放。
                </audio>

                <!-- 播放器控制区域 -->
                <div class="mt-4 flex flex-col sm:flex-row gap-3 items-center justify-between bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4 border border-blue-100">
                  <!-- 下载和格式选择 -->
                  <div class="flex items-center gap-3">
                    <select id="audioFormat" class="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" title="选择下载格式">
                      <option value="mp3">MP3</option>
                      <option value="wav">WAV</option>
                      <option value="ogg">OGG</option>
                      <option value="m4a">M4A</option>
                    </select>
                    <button id="downloadAudioBtn" class="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg hover:from-green-600 hover:to-emerald-600 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105" title="下载音频文件">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                      </svg>
                      下载
                    </button>
                  </div>

                  <!-- 音频信息 -->
                  <div id="audioInfo" class="text-sm text-gray-600"></div>
                </div>
              </div>
          </div>

          <!-- 快捷操作和历史记录区域 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- 快捷操作 -->
            <div class="glass-effect p-4 rounded-2xl shadow-2xl">
              <h3 class="text-lg font-bold mb-3 text-gray-800 flex items-center">
                <svg class="w-4 h-4 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                </svg>
                快捷操作
              </h3>
              <div class="space-y-2">
                <button id="clearForm" class="w-full px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm font-medium flex items-center justify-center">
                  <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                  </svg>
                  清空表单
                </button>
                <button id="randomText" class="w-full px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors text-sm font-medium flex items-center justify-center">
                  <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                  </svg>
                  随机示例
                </button>
              </div>
            </div>

            <!-- 历史记录 -->
            <div class="glass-effect p-4 rounded-2xl shadow-2xl">
              <h3 class="text-lg font-bold mb-3 text-gray-800 flex items-center">
                <svg class="w-4 h-4 mr-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                历史记录
                <button id="clearHistory" class="ml-auto text-red-500 hover:text-red-700 text-sm transition-colors">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                  </svg>
                </button>
              </h3>
              <div id="historyList" class="space-y-2 max-h-60 overflow-y-auto">
                <div class="text-center text-gray-500 py-6">
                  <svg class="w-8 h-8 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  <p class="text-sm">暂无历史记录</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>

        <!-- 底部链接 -->
        <div class="text-center mt-12">
          <a href="/docs" class="inline-flex items-center px-6 py-3 bg-white/20 text-white rounded-xl hover:bg-white/30 transition-all duration-200 backdrop-blur-sm">
            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            查看 API 文档
          </a>
        </div>
      </div>

      <script>
        // 现代化通知系统
        class NotificationSystem {
          constructor() {
            this.notifications = [];
          }

          show(message, type = 'info', duration = 5000) {
            const notification = this.createNotification(message, type);
            document.body.appendChild(notification);
            this.notifications.push(notification);

            // 触发显示动画
            setTimeout(() => {
              notification.classList.add('show');
            }, 10);

            // 自动隐藏
            setTimeout(() => {
              this.hide(notification);
            }, duration);

            return notification;
          }

          createNotification(message, type) {
            const notification = document.createElement('div');
            notification.className = 'notification ' + type;

            const iconMap = {
              success: '<svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
              error: '<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>',
              warning: '<svg class="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path></svg>',
              info: '<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
            };

            notification.innerHTML =
              '<div class="flex items-start">' +
                '<div class="flex-shrink-0">' +
                  (iconMap[type] || iconMap.info) +
                '</div>' +
                '<div class="ml-3 flex-1">' +
                  '<p class="text-sm font-medium text-gray-900">' + message + '</p>' +
                '</div>' +
                '<div class="ml-4 flex-shrink-0">' +
                  '<button class="close-btn inline-flex text-gray-400 hover:text-gray-600 focus:outline-none transition-colors duration-200">' +
                    '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>' +
                    '</svg>' +
                  '</button>' +
                '</div>' +
              '</div>';

            // 添加关闭按钮事件
            const closeBtn = notification.querySelector('.close-btn');
            closeBtn.addEventListener('click', () => this.hide(notification));

            return notification;
          }

          hide(notification) {
            notification.classList.remove('show');
            setTimeout(() => {
              if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
              }
              const index = this.notifications.indexOf(notification);
              if (index > -1) {
                this.notifications.splice(index, 1);
              }
            }, 300);
          }

          success(message, duration) {
            return this.show(message, 'success', duration);
          }

          error(message, duration) {
            return this.show(message, 'error', duration);
          }

          warning(message, duration) {
            return this.show(message, 'warning', duration);
          }

          info(message, duration) {
            return this.show(message, 'info', duration);
          }
        }

        // 创建全局通知实例
        const notify = new NotificationSystem();

        // 语音名称映射表
        const voiceNameMap = {
          // 多语言语音
          'zh-CN-XiaoxiaoMultilingualNeural': '晓晓 多语言 (女)',
          'zh-CN-YunfanMultilingualNeural': 'Yunfan 多语言 (男)',
          'zh-CN-YunxiaoMultilingualNeural': 'Yunxiao 多语言 (男)',

          // 中文普通话
          'zh-CN-XiaoxiaoNeural': '晓晓 (女)',
          'zh-CN-YunxiNeural': '云希 (男)',
          'zh-CN-YunjianNeural': '云健 (男)',
          'zh-CN-XiaoyiNeural': '晓伊 (女)',
          'zh-CN-YunyangNeural': '云扬 (男)',
          'zh-CN-XiaochenNeural': '晓辰 (女)',
          'zh-CN-XiaohanNeural': '晓涵 (女)',
          'zh-CN-XiaomengNeural': '晓梦 (女)',
          'zh-CN-XiaomoNeural': '晓墨 (女)',
          'zh-CN-XiaoqiuNeural': '晓秋 (女)',
          'zh-CN-XiaorouNeural': '晓柔 (女)',
          'zh-CN-XiaoruiNeural': '晓睿 (女)',
          'zh-CN-XiaoshuangNeural': '晓双 (女)',
          'zh-CN-XiaoyanNeural': '晓颜 (女)',
          'zh-CN-XiaoyouNeural': '晓悠 (女)',
          'zh-CN-XiaozhenNeural': '晓甄 (女)',
          'zh-CN-YunfengNeural': '云枫 (男)',
          'zh-CN-YunhaoNeural': '云皓 (男)',
          'zh-CN-YunjieNeural': '云杰 (男)',
          'zh-CN-YunxiaNeural': '云夏 (男)',
          'zh-CN-YunyeNeural': '云野 (男)',
          'zh-CN-YunzeNeural': '云泽 (男)',

          // 中文方言
          'zh-CN-guangxi-YunqiNeural': '云奇 广西 (男)',
          'zh-CN-henan-YundengNeural': '云登 河南 (男)',
          'zh-CN-liaoning-XiaobeiNeural': '晓北 辽宁 (女)',
          'zh-CN-liaoning-YunbiaoNeural': '云彪 辽宁 (男)',
          'zh-CN-shaanxi-XiaoniNeural': '晓妮 陕西 (女)',
          'zh-CN-shandong-YunxiangNeural': '云翔 山东 (男)',
          'zh-CN-sichuan-YunxiNeural': '云希 四川 (男)',

          // 中文港台
          'zh-HK-HiuMaanNeural': '曉曼 香港 (女)',
          'zh-HK-WanLungNeural': '雲龍 香港 (男)',
          'zh-HK-HiuGaaiNeural': '曉佳 香港 (女)',
          'zh-TW-HsiaoChenNeural': '曉臻 台湾 (女)',
          'zh-TW-YunJheNeural': '雲哲 台湾 (男)',
          'zh-TW-HsiaoYuNeural': '曉雨 台湾 (女)',

          // 英语
          'en-US-AriaNeural': 'Aria 美国 (女)',
          'en-US-GuyNeural': 'Guy 美国 (男)',
          'en-US-JennyNeural': 'Jenny 美国 (女)',
          'en-US-DavisNeural': 'Davis 美国 (男)',
          'en-US-AmberNeural': 'Amber 美国 (女)',
          'en-US-AnaNeural': 'Ana 美国 (女)',
          'en-US-BrandonNeural': 'Brandon 美国 (男)',
          'en-US-ChristopherNeural': 'Christopher 美国 (男)',
          'en-US-CoraNeural': 'Cora 美国 (女)',
          'en-US-ElizabethNeural': 'Elizabeth 美国 (女)',
          'en-US-EricNeural': 'Eric 美国 (男)',
          'en-US-JacobNeural': 'Jacob 美国 (男)',
          'en-US-JaneNeural': 'Jane 美国 (女)',
          'en-US-JasonNeural': 'Jason 美国 (男)',
          'en-US-MichelleNeural': 'Michelle 美国 (女)',
          'en-US-MonicaNeural': 'Monica 美国 (女)',
          'en-US-NancyNeural': 'Nancy 美国 (女)',
          'en-US-RogerNeural': 'Roger 美国 (男)',
          'en-US-SaraNeural': 'Sara 美国 (女)',
          'en-US-SteffanNeural': 'Steffan 美国 (男)',
          'en-US-TonyNeural': 'Tony 美国 (男)',
          'en-GB-LibbyNeural': 'Libby 英国 (女)',
          'en-GB-MaisieNeural': 'Maisie 英国 (女)',
          'en-GB-RyanNeural': 'Ryan 英国 (男)',
          'en-GB-SoniaNeural': 'Sonia 英国 (女)',
          'en-GB-ThomasNeural': 'Thomas 英国 (男)',

          // 日语
          'ja-JP-NanamiNeural': 'Nanami (女)',
          'ja-JP-KeitaNeural': 'Keita (男)',
          'ja-JP-AoiNeural': 'Aoi (女)',
          'ja-JP-DaichiNeural': 'Daichi (男)',
          'ja-JP-MayuNeural': 'Mayu (女)',
          'ja-JP-NaokiNeural': 'Naoki (男)',
          'ja-JP-ShioriNeural': 'Shiori (女)',

          // 其他语言
          'ko-KR-InJoonNeural': 'InJoon 韩语 (男)',
          'ko-KR-SunHiNeural': 'SunHi 韩语 (女)',
          'fr-FR-DeniseNeural': 'Denise 法语 (女)',
          'fr-FR-HenriNeural': 'Henri 法语 (男)',
          'de-DE-KatjaNeural': 'Katja 德语 (女)',
          'de-DE-ConradNeural': 'Conrad 德语 (男)',
          'es-ES-ElviraNeural': 'Elvira 西班牙语 (女)',
          'es-ES-AlvaroNeural': 'Alvaro 西班牙语 (男)',
          'it-IT-ElsaNeural': 'Elsa 意大利语 (女)',
          'it-IT-DiegoNeural': 'Diego 意大利语 (男)',
          'pt-BR-FranciscaNeural': 'Francisca 葡萄牙语 (女)',
          'pt-BR-AntonioNeural': 'Antonio 葡萄牙语 (男)',
          'ru-RU-SvetlanaNeural': 'Svetlana 俄语 (女)',
          'ru-RU-DmitryNeural': 'Dmitry 俄语 (男)',
          'ar-SA-ZariyahNeural': 'Zariyah 阿拉伯语 (女)',
          'ar-SA-HamedNeural': 'Hamed 阿拉伯语 (男)',
          'hi-IN-SwaraNeural': 'Swara 印地语 (女)',
          'hi-IN-MadhurNeural': 'Madhur 印地语 (男)',
          'th-TH-PremwadeeNeural': 'Premwadee 泰语 (女)',
          'th-TH-NiwatNeural': 'Niwat 泰语 (男)',
          'vi-VN-HoaiMyNeural': 'HoaiMy 越南语 (女)',
          'vi-VN-NamMinhNeural': 'NamMinh 越南语 (男)'
        };

        // 获取语音显示名称
        function getVoiceDisplayName(voiceId) {
          return voiceNameMap[voiceId] || voiceId;
        }

        // 现代化确认对话框
        function showConfirmDialog(title, message, onConfirm, onCancel = null) {
          // 创建遮罩层
          const overlay = document.createElement('div');
          overlay.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
          overlay.style.animation = 'fadeIn 0.2s ease-out';

          // 创建对话框
          const dialog = document.createElement('div');
          dialog.className = 'bg-white rounded-2xl shadow-2xl max-w-md w-full transform transition-all duration-200';
          dialog.style.animation = 'slideIn 0.2s ease-out';

          dialog.innerHTML = \`
            <div class="p-6">
              <div class="flex items-center mb-4">
                <div class="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mr-4">
                  <svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
                  </svg>
                </div>
                <div>
                  <h3 class="text-lg font-semibold text-gray-900">\${title}</h3>
                  <p class="text-sm text-gray-600 mt-1">\${message}</p>
                </div>
              </div>
              <div class="flex space-x-3 justify-end">
                <button id="cancelBtn" class="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium rounded-lg hover:bg-gray-100 transition-colors duration-200">
                  取消
                </button>
                <button id="confirmBtn" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors duration-200">
                  确定
                </button>
              </div>
            </div>
          \`;

          overlay.appendChild(dialog);
          document.body.appendChild(overlay);

          // 添加动画样式
          const style = document.createElement('style');
          style.textContent = \`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes slideIn {
              from { transform: scale(0.9) translateY(-10px); opacity: 0; }
              to { transform: scale(1) translateY(0); opacity: 1; }
            }
          \`;
          document.head.appendChild(style);

          // 绑定事件
          const confirmBtn = dialog.querySelector('#confirmBtn');
          const cancelBtn = dialog.querySelector('#cancelBtn');

          const closeDialog = () => {
            overlay.style.animation = 'fadeOut 0.2s ease-out';
            dialog.style.animation = 'slideOut 0.2s ease-out';
            setTimeout(() => {
              document.body.removeChild(overlay);
              document.head.removeChild(style);
            }, 200);
          };

          confirmBtn.addEventListener('click', () => {
            closeDialog();
            if (onConfirm) onConfirm();
          });

          cancelBtn.addEventListener('click', () => {
            closeDialog();
            if (onCancel) onCancel();
          });

          overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
              closeDialog();
              if (onCancel) onCancel();
            }
          });

          // 添加退出动画样式
          style.textContent += \`
            @keyframes fadeOut {
              from { opacity: 1; }
              to { opacity: 0; }
            }
            @keyframes slideOut {
              from { transform: scale(1) translateY(0); opacity: 1; }
              to { transform: scale(0.9) translateY(-10px); opacity: 0; }
            }
          \`;
        }

        // 简化的音频播放器类
        class SimpleAudioPlayer {
          constructor() {
            this.audio = document.getElementById('audioElement');
            this.player = null;
            this.currentAudioUrl = null;
            this.placeholder = document.getElementById('audioPlaceholder');
            this.modernPlayer = document.getElementById('modernAudioPlayer');
            this.downloadBtn = document.getElementById('downloadAudioBtn');
            this.audioFormat = document.getElementById('audioFormat');
            this.audioInfo = document.getElementById('audioInfo');

            this.initializePlyr();
            this.bindEvents();
            this.setupResponsiveHandler();
          }

          initializePlyr() {
            // 等待 Plyr.js 加载完成
            const initPlyr = () => {
              if (typeof Plyr !== 'undefined') {
                // 检测是否为移动设备
                const isMobile = window.innerWidth <= 768;

                // 根据设备类型配置控件
                const controls = isMobile
                  ? ['play-large', 'play', 'progress', 'current-time', 'duration', 'settings']
                  : ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings'];

                this.player = new Plyr(this.audio, {
                  controls: controls,
                  settings: ['speed'],
                  speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
                  volume: 1,
                  muted: false,
                  clickToPlay: true,
                  hideControls: false,
                  resetOnEnd: false,
                  keyboard: { focused: true, global: false }
                });

                // 监听播放器事件
                this.player.on('loadeddata', () => {
                  const duration = this.player.duration;
                  if (this.audioInfo) {
                    this.audioInfo.textContent = \`时长: \${this.formatTime(duration)}\`;
                  }
                });

                console.log('Plyr.js 播放器初始化成功');
              } else {
                console.warn('Plyr.js 未加载，使用原生音频控件');
                // 如果 Plyr.js 未加载，稍后重试
                setTimeout(initPlyr, 100);
              }
            };

            // 立即尝试初始化，如果失败则等待
            initPlyr();
          }

          bindEvents() {
            // 下载按钮事件
            if (this.downloadBtn) {
              this.downloadBtn.addEventListener('click', () => this.downloadAudio());
            }
          }

          setupResponsiveHandler() {
            // 监听窗口大小变化，重新配置播放器
            let resizeTimeout;
            window.addEventListener('resize', () => {
              clearTimeout(resizeTimeout);
              resizeTimeout = setTimeout(() => {
                if (this.player) {
                  const isMobile = window.innerWidth <= 768;
                  const currentControls = this.player.config.controls;
                  const newControls = isMobile
                    ? ['play-large', 'play', 'progress', 'current-time', 'duration', 'settings']
                    : ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings'];

                  // 如果控件配置需要改变，重新初始化播放器
                  if (JSON.stringify(currentControls) !== JSON.stringify(newControls)) {
                    const currentSrc = this.audio.src;
                    const currentTime = this.player.currentTime;
                    const wasPlaying = !this.player.paused;
                    const wasPlayerVisible = !this.modernPlayer.classList.contains('hidden');

                    // 销毁当前播放器
                    this.player.destroy();
                    this.player = null;

                    // 重新初始化
                    setTimeout(() => {
                      this.initializePlyr();
                      if (currentSrc && wasPlayerVisible) {
                        // 确保播放器容器可见
                        this.showPlayer();

                        // 重新加载音频
                        setTimeout(() => {
                          this.loadAudio(currentSrc);
                          setTimeout(() => {
                            if (this.player) {
                              this.player.currentTime = currentTime;
                              if (wasPlaying) {
                                this.player.play();
                              }
                            }
                          }, 200);
                        }, 100);
                      }
                    }, 100);
                  }
                }
              }, 300);
            });
          }

          loadAudio(url) {
            this.currentAudioUrl = url;

            // 设置音频源
            const audioSource = document.getElementById('audioSource');
            if (audioSource) {
              audioSource.src = url;
            }
            this.audio.src = url;

            // 如果有 Plyr 播放器，重新加载
            if (this.player) {
              this.player.source = {
                type: 'audio',
                sources: [{ src: url, type: 'audio/wav' }]
              };
            }

            this.showPlayer();
          }

          showPlayer() {
            this.placeholder.classList.add('hidden');
            this.modernPlayer.classList.remove('hidden');
          }

          hidePlayer() {
            this.placeholder.classList.remove('hidden');
            this.modernPlayer.classList.add('hidden');
          }

          formatTime(seconds) {
            if (!seconds || isNaN(seconds)) return '0:00';
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return \`\${mins}:\${secs.toString().padStart(2, '0')}\`;
          }

          async downloadAudio() {
            if (!this.currentAudioUrl) {
              notify.error('没有可下载的音频文件');
              return;
            }

            try {
              const selectedFormat = this.audioFormat ? this.audioFormat.value : 'wav';
              const timestamp = Date.now();

              // 直接下载 WAV 格式
              const a = document.createElement('a');
              a.href = this.currentAudioUrl;
              a.download = \`tts_\${timestamp}.\${selectedFormat}\`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);

              notify.success('文件下载完成');
            } catch (error) {
              console.error('下载失败:', error);
              notify.error('下载失败，请重试');
            }
          }
        }

        // 历史记录管理
        class TTSHistory {
          constructor() {
            this.storageKey = 'tts_history';
            this.audioStorageKey = 'tts_audio_cache';
            this.maxHistoryItems = 20;
            this.loadHistory();
            this.loadAudioCache();
          }

          loadHistory() {
            try {
              this.history = JSON.parse(localStorage.getItem(this.storageKey)) || [];
            } catch (e) {
              this.history = [];
            }
            this.renderHistory();
          }

          loadAudioCache() {
            try {
              this.audioCache = JSON.parse(localStorage.getItem(this.audioStorageKey)) || {};
            } catch (e) {
              this.audioCache = {};
            }
          }

          addToHistory(item) {
            const historyItem = {
              id: Date.now(),
              text: item.text,
              voice: item.voice,
              rate: item.rate,
              pitch: item.pitch,
              style: item.style,
              timestamp: new Date().toLocaleString(),
              audioKey: \`audio_\${Date.now()}\`
            };

            this.history.unshift(historyItem);
            if (this.history.length > this.maxHistoryItems) {
              const removed = this.history.pop();
              // 清理对应的音频缓存
              delete this.audioCache[removed.audioKey];
            }

            localStorage.setItem(this.storageKey, JSON.stringify(this.history));
            this.renderHistory();
            return historyItem.audioKey;
          }

          saveAudio(audioKey, audioBlob) {
            const reader = new FileReader();
            reader.onload = () => {
              this.audioCache[audioKey] = reader.result;
              localStorage.setItem(this.audioStorageKey, JSON.stringify(this.audioCache));
            };
            reader.readAsDataURL(audioBlob);
          }

          getAudio(audioKey) {
            return this.audioCache[audioKey];
          }

          clearHistory() {
            this.history = [];
            this.audioCache = {};
            localStorage.removeItem(this.storageKey);
            localStorage.removeItem(this.audioStorageKey);
            this.renderHistory();
          }

          renderHistory() {
            const historyList = document.getElementById('historyList');

            if (this.history.length === 0) {
              historyList.innerHTML = \`
                <div class="text-center text-gray-500 py-6">
                  <svg class="w-8 h-8 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  <p class="text-sm">暂无历史记录</p>
                </div>
              \`;
              return;
            }

            historyList.innerHTML = this.history.map(item => \`
              <div class="history-item bg-white/50 p-3 rounded-lg border border-white/20 cursor-pointer hover:bg-white/70 transition-all" data-id="\${item.id}">
                <div class="flex justify-between items-start mb-2">
                  <div class="text-xs font-medium text-gray-800 truncate flex-1 mr-2">
                    \${item.text.length > 25 ? item.text.substring(0, 25) + '...' : item.text}
                  </div>
                  <button class="delete-history text-red-400 hover:text-red-600 text-xs" data-id="\${item.id}">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                  </button>
                </div>
                <div class="text-xs text-gray-600 mb-1 flex flex-wrap gap-1">
                  <span class="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">\${this.getVoiceShortName(item.voice)}</span>
                  <span class="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-medium">\${this.getStyleName(item.style)}</span>
                  <span class="bg-purple-100 text-purple-800 px-2 py-1 rounded-full text-xs font-medium">\${item.rate > 0 ? '+' : ''}\${item.rate}%</span>
                  <span class="bg-orange-100 text-orange-800 px-2 py-1 rounded-full text-xs font-medium">\${item.pitch > 0 ? '+' : ''}\${item.pitch}%</span>
                </div>
                <div class="text-xs text-gray-500">\${item.timestamp.split(' ')[1]}</div>
              </div>
            \`).join('');

            // 绑定点击事件
            historyList.querySelectorAll('.history-item').forEach(item => {
              item.addEventListener('click', (e) => {
                if (!e.target.closest('.delete-history')) {
                  this.playFromHistory(parseInt(item.dataset.id));
                }
              });
            });

            // 绑定删除事件
            historyList.querySelectorAll('.delete-history').forEach(btn => {
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteHistoryItem(parseInt(btn.dataset.id));
              });
            });
          }

          getVoiceName(voice) {
            return getVoiceDisplayName(voice);
          }

          getVoiceShortName(voice) {
            const shortNameMap = {
              // 多语言语音
              'zh-CN-XiaoxiaoMultilingualNeural': '晓晓',
              'zh-CN-YunfanMultilingualNeural': '云帆',
              'zh-CN-YunxiaoMultilingualNeural': '云霄',

              // 中文普通话
              'zh-CN-XiaoxiaoNeural': '晓晓',
              'zh-CN-YunxiNeural': '云希',
              'zh-CN-YunjianNeural': '云健',
              'zh-CN-XiaoyiNeural': '晓伊',
              'zh-CN-YunyangNeural': '云扬',
              'zh-CN-XiaochenNeural': '晓辰',
              'zh-CN-XiaohanNeural': '晓涵',
              'zh-CN-XiaomengNeural': '晓梦',
              'zh-CN-XiaomoNeural': '晓墨',
              'zh-CN-XiaoqiuNeural': '晓秋',
              'zh-CN-XiaorouNeural': '晓柔',
              'zh-CN-XiaoruiNeural': '晓睿',
              'zh-CN-XiaoshuangNeural': '晓双',
              'zh-CN-XiaoyanNeural': '晓颜',
              'zh-CN-XiaoyouNeural': '晓悠',
              'zh-CN-XiaozhenNeural': '晓甄',
              'zh-CN-YunfengNeural': '云枫',
              'zh-CN-YunhaoNeural': '云皓',
              'zh-CN-YunjieNeural': '云杰',
              'zh-CN-YunxiaNeural': '云夏',
              'zh-CN-YunyeNeural': '云野',
              'zh-CN-YunzeNeural': '云泽',

              // 中文方言
              'zh-CN-guangxi-YunqiNeural': '云奇',
              'zh-CN-henan-YundengNeural': '云登',
              'zh-CN-liaoning-XiaobeiNeural': '晓北',
              'zh-CN-liaoning-YunbiaoNeural': '云彪',
              'zh-CN-shaanxi-XiaoniNeural': '晓妮',
              'zh-CN-shandong-YunxiangNeural': '云翔',
              'zh-CN-sichuan-YunxiNeural': '云希',

              // 中文港台
              'zh-HK-HiuMaanNeural': '曉曼',
              'zh-HK-WanLungNeural': '雲龍',
              'zh-HK-HiuGaaiNeural': '曉佳',
              'zh-TW-HsiaoChenNeural': '曉臻',
              'zh-TW-YunJheNeural': '雲哲',
              'zh-TW-HsiaoYuNeural': '曉雨',

              // 英语
              'en-US-AriaNeural': 'Aria',
              'en-US-GuyNeural': 'Guy',
              'en-US-JennyNeural': 'Jenny',
              'en-US-DavisNeural': 'Davis',
              'en-US-AmberNeural': 'Amber',
              'en-US-AnaNeural': 'Ana',
              'en-US-BrandonNeural': 'Brandon',
              'en-US-ChristopherNeural': 'Chris',
              'en-US-CoraNeural': 'Cora',
              'en-US-ElizabethNeural': 'Liz',
              'en-US-EricNeural': 'Eric',
              'en-US-JacobNeural': 'Jacob',
              'en-US-JaneNeural': 'Jane',
              'en-US-JasonNeural': 'Jason',
              'en-US-MichelleNeural': 'Michelle',
              'en-US-MonicaNeural': 'Monica',
              'en-US-NancyNeural': 'Nancy',
              'en-US-RogerNeural': 'Roger',
              'en-US-SaraNeural': 'Sara',
              'en-US-SteffanNeural': 'Steffan',
              'en-US-TonyNeural': 'Tony',
              'en-GB-LibbyNeural': 'Libby',
              'en-GB-MaisieNeural': 'Maisie',
              'en-GB-RyanNeural': 'Ryan',
              'en-GB-SoniaNeural': 'Sonia',
              'en-GB-ThomasNeural': 'Thomas',

              // 日语
              'ja-JP-NanamiNeural': 'Nanami',
              'ja-JP-KeitaNeural': 'Keita',
              'ja-JP-AoiNeural': 'Aoi',
              'ja-JP-DaichiNeural': 'Daichi',
              'ja-JP-MayuNeural': 'Mayu',
              'ja-JP-NaokiNeural': 'Naoki',
              'ja-JP-ShioriNeural': 'Shiori',

              // 其他语言
              'ko-KR-InJoonNeural': 'InJoon',
              'ko-KR-SunHiNeural': 'SunHi',
              'fr-FR-DeniseNeural': 'Denise',
              'fr-FR-HenriNeural': 'Henri',
              'de-DE-KatjaNeural': 'Katja',
              'de-DE-ConradNeural': 'Conrad',
              'es-ES-ElviraNeural': 'Elvira',
              'es-ES-AlvaroNeural': 'Alvaro',
              'it-IT-ElsaNeural': 'Elsa',
              'it-IT-DiegoNeural': 'Diego',
              'pt-BR-FranciscaNeural': 'Francisca',
              'pt-BR-AntonioNeural': 'Antonio',
              'ru-RU-SvetlanaNeural': 'Svetlana',
              'ru-RU-DmitryNeural': 'Dmitry',
              'ar-SA-ZariyahNeural': 'Zariyah',
              'ar-SA-HamedNeural': 'Hamed',
              'hi-IN-SwaraNeural': 'Swara',
              'hi-IN-MadhurNeural': 'Madhur',
              'th-TH-PremwadeeNeural': 'Premwadee',
              'th-TH-NiwatNeural': 'Niwat',
              'vi-VN-HoaiMyNeural': 'HoaiMy',
              'vi-VN-NamMinhNeural': 'NamMinh'
            };
            return shortNameMap[voice] || '未知';
          }

          getStyleName(style) {
            const styleMap = {
              'general': '标准',
              'advertisement_upbeat': '广告热情',
              'affectionate': '亲切',
              'angry': '愤怒',
              'assistant': '助理',
              'calm': '平静',
              'chat': '随意',
              'cheerful': '愉快',
              'customerservice': '客服',
              'depressed': '沮丧',
              'disgruntled': '不满',
              'documentary-narration': '纪录片解说',
              'embarrassed': '尴尬',
              'empathetic': '共情',
              'envious': '羡慕',
              'excited': '兴奋',
              'fearful': '恐惧',
              'friendly': '友好',
              'gentle': '温柔',
              'hopeful': '希望',
              'lyrical': '抒情',
              'narration-professional': '专业叙述',
              'narration-relaxed': '轻松叙述',
              'newscast': '新闻播报',
              'newscast-casual': '随意新闻',
              'newscast-formal': '正式新闻',
              'poetry-reading': '诗朗诵',
              'sad': '悲伤',
              'serious': '严肃',
              'shouting': '大喊',
              'sports_commentary': '体育解说',
              'sports_commentary_excited': '激动体育解说',
              'whispering': '低语',
              'terrified': '恐慌',
              'unfriendly': '冷漠'
            };
            return styleMap[style] || '标准';
          }

          playFromHistory(id) {
            const item = this.history.find(h => h.id === id);
            if (!item) return;

            const audioData = this.getAudio(item.audioKey);
            if (audioData) {
              modernPlayer.loadAudio(audioData);

              // 填充表单
              document.getElementById('text').value = item.text;
              document.getElementById('voice').value = item.voice;
              document.getElementById('rate').value = item.rate;
              document.getElementById('pitch').value = item.pitch;
              document.getElementById('style').value = item.style;
              document.getElementById('rateValue').textContent = item.rate;
              document.getElementById('pitchValue').textContent = item.pitch;
              updateTextCount();
            }
          }

          deleteHistoryItem(id) {
            const index = this.history.findIndex(h => h.id === id);
            if (index !== -1) {
              const item = this.history[index];
              delete this.audioCache[item.audioKey];
              this.history.splice(index, 1);
              localStorage.setItem(this.storageKey, JSON.stringify(this.history));
              localStorage.setItem(this.audioStorageKey, JSON.stringify(this.audioCache));
              this.renderHistory();
            }
          }
        }

        // 初始化简化播放器和历史记录管理器
        const modernPlayer = new SimpleAudioPlayer();
        const ttsHistory = new TTSHistory();



        // 工具函数
        function updateTextCount() {
          const text = document.getElementById('text').value;
          document.getElementById('textCount').textContent = text.length;
        }

        function setLoading(loading) {
          const btn = document.getElementById('generateBtn');
          const btnText = document.getElementById('btnText');
          const spinner = document.getElementById('loadingSpinner');

          if (loading) {
            btn.disabled = true;
            btn.classList.add('opacity-75', 'cursor-not-allowed');
            btnText.textContent = '生成中...';
            spinner.classList.remove('hidden');
          } else {
            btn.disabled = false;
            btn.classList.remove('opacity-75', 'cursor-not-allowed');
            btnText.textContent = '🎵 生成语音';
            spinner.classList.add('hidden');
          }
        }

        // 事件监听器
        document.getElementById('text').addEventListener('input', updateTextCount);

        document.getElementById('clearHistory').addEventListener('click', () => {
          showConfirmDialog('确定要清空所有历史记录吗？', '此操作不可撤销', () => {
            ttsHistory.clearHistory();
            notify.success('历史记录已清空');
          });
        });

        // 自定义复选框样式
        document.getElementById('download').addEventListener('change', function() {
          const dot = this.parentElement.querySelector('.dot');
          const bg = this.parentElement.querySelector('div');
          const gradientBg = this.parentElement.querySelector('div > div:last-child');

          if (this.checked) {
            dot.style.transform = 'translateX(200%)';
            bg.style.background = 'linear-gradient(to right, #3b82f6, #8b5cf6)';
            dot.style.borderColor = '#3b82f6';
            dot.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.4)';
          } else {
            dot.style.transform = 'translateX(0%)';
            bg.style.background = 'linear-gradient(to right, #e5e7eb, #d1d5db)';
            dot.style.borderColor = '#e5e7eb';
            dot.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
          }
        });

        // 快捷操作
        document.getElementById('clearForm').addEventListener('click', function() {
          document.getElementById('text').value = '';
          document.getElementById('voice').value = 'zh-CN-XiaoxiaoMultilingualNeural';
          document.getElementById('rate').value = 0;
          document.getElementById('pitch').value = 0;
          document.getElementById('style').value = 'general';
          document.getElementById('apiKey').value = '';
          document.getElementById('download').checked = false;
          document.getElementById('rateValue').textContent = '0';
          document.getElementById('pitchValue').textContent = '0';
          updateTextCount();

          // 重置下载开关样式
          const dot = document.querySelector('.dot');
          const bg = document.querySelector('#download').parentElement.querySelector('div');
          dot.style.transform = 'translateX(0%)';
          bg.style.background = 'linear-gradient(to right, #e5e7eb, #d1d5db)';
          dot.style.borderColor = '#e5e7eb';
          dot.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
        });

        document.getElementById('randomText').addEventListener('click', function() {
          const examples = [
            '你好，欢迎使用Microsoft TTS语音合成服务！',
            '今天天气真不错，适合出去走走。',
            '人工智能正在改变我们的生活方式。',
            '学习新技能永远不会太晚。',
            '保持积极的心态，迎接每一天的挑战。',
            '科技让世界变得更加美好。',
            '阅读是获取知识的最佳途径之一。'
          ];
          const randomExample = examples[Math.floor(Math.random() * examples.length)];
          document.getElementById('text').value = randomExample;
          updateTextCount();
        });

        // 主要的TTS生成函数
        document.getElementById('generateBtn').addEventListener('click', async function() {
          const text = document.getElementById('text').value.trim();
          if (!text) {
            notify.warning('请输入要转换的文本');
            return;
          }

          const voice = document.getElementById('voice').value;
          const rate = document.getElementById('rate').value;
          const pitch = document.getElementById('pitch').value;
          const style = document.getElementById('style').value;
          const apiKey = document.getElementById('apiKey').value;
          const download = document.getElementById('download').checked;

          // 构建请求 URL
          let url = \`/tts?t=\${encodeURIComponent(text)}&v=\${encodeURIComponent(voice)}&r=\${rate}&p=\${pitch}&s=\${style}\`;

          if (apiKey) {
            url += \`&api_key=\${encodeURIComponent(apiKey)}\`;
          }

          if (download) {
            url += '&d=true';
            window.location.href = url;
            return;
          }

          setLoading(true);

          try {
            // 直接请求音频
            const response = await fetch(url);

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(\`请求失败: \${response.status} \${errorText}\`);
            }

            // 获取音频数据
            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            // 添加到历史记录
            const audioKey = ttsHistory.addToHistory({
              text, voice, rate, pitch, style
            });

            // 保存音频到本地存储
            ttsHistory.saveAudio(audioKey, audioBlob);

            // 播放音频
            modernPlayer.loadAudio(audioUrl);

            // 使用 Plyr 播放器或原生音频播放
            setTimeout(() => {
              if (modernPlayer.player) {
                modernPlayer.player.play();
              } else {
                modernPlayer.audio.play();
              }
            }, 100);

            // 滚动到音频播放器
            document.getElementById('audioContainer').scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });

          } catch (error) {
            notify.error(\`生成语音失败: \${error.message}\`);
          } finally {
            setLoading(false);
          }
        });

        // Base64转Blob函数
        function base64ToBlob(base64, contentType) {
          const byteCharacters = atob(base64);
          const byteArrays = [];

          for (let offset = 0; offset < byteCharacters.length; offset += 512) {
            const slice = byteCharacters.slice(offset, offset + 512);
            const byteNumbers = new Array(slice.length);

            for (let i = 0; i < slice.length; i++) {
              byteNumbers[i] = slice.charCodeAt(i);
            }

            byteArrays.push(new Uint8Array(byteNumbers));
          }

          return new Blob(byteArrays, { type: contentType });
        }

        // 初始化文本计数
        updateTextCount();

        // 添加键盘快捷键支持
        document.addEventListener('keydown', function(e) {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            document.getElementById('generateBtn').click();
          }
        });

        // 注册 Service Worker
        if ('serviceWorker' in navigator) {
          window.addEventListener('load', function() {
            navigator.serviceWorker.register('/sw.js')
              .then(function(registration) {
                console.log('Service Worker 注册成功:', registration.scope);

                // 检查是否有更新
                registration.addEventListener('updatefound', function() {
                  console.log('Service Worker 有更新');
                });
              })
              .catch(function(error) {
                console.log('Service Worker 注册失败:', error);
              });
          });

          // 监听 PWA 安装提示
          let deferredPrompt;
          window.addEventListener('beforeinstallprompt', function(e) {
            console.log('PWA 安装提示触发');
            // 阻止默认的安装提示
            e.preventDefault();
            // 保存事件，以便稍后触发
            deferredPrompt = e;

            // 显示自定义安装按钮（可选）
            showInstallButton();
          });

          // 显示安装按钮的函数
          function showInstallButton() {
            // 创建安装提示
            const installBanner = document.createElement('div');
            installBanner.id = 'install-banner';
            installBanner.className = 'fixed top-0 left-0 right-0 bg-blue-600 text-white p-3 text-center z-50';
            installBanner.innerHTML = \`
              <div class="flex items-center justify-center space-x-4">
                <span>📱 安装 TTS API 应用到您的设备</span>
                <button id="install-btn" class="bg-white text-blue-600 px-4 py-1 rounded font-medium hover:bg-gray-100 transition-colors">
                  安装
                </button>
                <button id="dismiss-btn" class="text-white hover:text-gray-200 transition-colors">
                  ✕
                </button>
              </div>
            \`;

            document.body.appendChild(installBanner);

            // 安装按钮点击事件
            document.getElementById('install-btn').addEventListener('click', function() {
              if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then(function(choiceResult) {
                  if (choiceResult.outcome === 'accepted') {
                    console.log('用户接受了安装提示');
                  } else {
                    console.log('用户拒绝了安装提示');
                  }
                  deferredPrompt = null;
                  document.getElementById('install-banner').remove();
                });
              }
            });

            // 关闭按钮点击事件
            document.getElementById('dismiss-btn').addEventListener('click', function() {
              document.getElementById('install-banner').remove();
            });
          }

          // 监听应用安装完成
          window.addEventListener('appinstalled', function(e) {
            console.log('PWA 安装完成');
            // 移除安装横幅
            const banner = document.getElementById('install-banner');
            if (banner) {
              banner.remove();
            }
          });
        }
      </script>
    </body>
  </html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(mainPageHtml);
};
