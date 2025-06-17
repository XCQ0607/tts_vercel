// Microsoft TTS API Server for Deno
// 基本变量定义
let expiredAt: number | null = null;
let endpoint: any = null;
// 添加缓存相关变量
let voiceListCache: any[] | null = null;
let voiceListCacheTime: number | null = null;
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
const API_KEY = Deno.env.get("API_KEY") || "";

function uuid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

// EscapeSSML 转义 SSML 内容，但保留配置的标签
function escapeSSML(ssml: string): string {
  // 使用占位符替换标签
  let placeholders = new Map<string, string>();
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
function escapeBasicXml(unsafe: string): string {
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

async function handleRequest(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const path = requestUrl.pathname;

  // 添加 /docs 路径处理
  if (path === '/docs') {
    return new Response(`<!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Microsoft TTS API 文档</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-50">
        <div class="container mx-auto px-4 py-8 max-w-4xl">
          <h1 class="text-3xl font-bold text-center mb-8 text-blue-600">Microsoft TTS API 文档</h1>
          
          <div class="bg-white p-6 rounded-lg shadow-md mb-6">
            <h2 class="text-xl font-semibold mb-4 text-gray-800">基本 TTS 接口</h2>
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
    </html>`, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  if (path === '/tts') {
    // 从请求参数获取 API 密钥
    const apiKey = requestUrl.searchParams.get('api_key');

    // 验证 API 密钥
    if (!validateApiKey(apiKey)) {
      // 改进 401 错误响应，提供更友好的错误信息
      return new Response(JSON.stringify({
        error: 'Unauthorized',
        message: '无效的 API 密钥，请确保您提供了正确的密钥。',
        status: 401
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const text = requestUrl.searchParams.get('t') || '';
    const voiceName = requestUrl.searchParams.get('v') || 'zh-CN-XiaoxiaoMultilingualNeural';
    const rate = Number(requestUrl.searchParams.get('r')) || 0;
    const pitch = Number(requestUrl.searchParams.get('p')) || 0;
    const style = requestUrl.searchParams.get('s') || 'general';
    const outputFormat = requestUrl.searchParams.get('o') || 'audio-24khz-48kbitrate-mono-mp3';
    const download = requestUrl.searchParams.get('d') === 'true';
    const response = await getVoice(text, voiceName, rate, pitch, style, outputFormat, download);
    return response;
  }

  // 添加 reader.json 路径处理
  if (path === '/reader.json') {
    // 从请求参数获取 API 密钥
    const apiKey = requestUrl.searchParams.get('api_key');

    // 验证 API 密钥
    if (!validateApiKey(apiKey)) {
      return new Response(JSON.stringify({
        error: 'Unauthorized',
        message: '无效的 API 密钥，请确保您提供了正确的密钥。',
        status: 401
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 从URL参数获取
    const voice = requestUrl.searchParams.get('v') || '';
    const rate = requestUrl.searchParams.get('r') || '';
    const pitch = requestUrl.searchParams.get('p') || '';
    const style = requestUrl.searchParams.get('s') || '';
    const displayName = requestUrl.searchParams.get('n') || 'Microsoft TTS';

    // 构建基本URL
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;

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

    const url = `${baseUrl}/tts?${urlParams.join('&')}`;

    // 返回 reader 响应
    return new Response(JSON.stringify({
      id: Date.now(),
      name: displayName,
      url: url
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  // 添加 ifreetime.json 路径处理
  if (path === '/ifreetime.json') {
    // 从请求参数获取 API 密钥
    const apiKey = requestUrl.searchParams.get('api_key');

    // 验证 API 密钥
    if (!validateApiKey(apiKey)) {
      return new Response(JSON.stringify({
        error: 'Unauthorized',
        message: '无效的 API 密钥，请确保您提供了正确的密钥。',
        status: 401
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 从URL参数获取
    const voice = requestUrl.searchParams.get('v') || '';
    const rate = requestUrl.searchParams.get('r') || '';
    const pitch = requestUrl.searchParams.get('p') || '';
    const style = requestUrl.searchParams.get('s') || '';
    const displayName = requestUrl.searchParams.get('n') || 'Microsoft TTS';

    // 构建基本URL
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
    const url = `${baseUrl}/tts`;

    // 生成随机的唯一ID
    const ttsConfigID = crypto.randomUUID();

    // 构建请求参数
    const params: Record<string, string> = {
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
          url: url,
          params: params,
          httpConfigs: {
            useCookies: 1,
            headers: {}
          }
        }
      ]
    };

    // 返回 IFreeTime 响应
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  // 添加 OpenAI 兼容接口路由
  if (path === '/v1/audio/speech' || path === '/audio/speech') {
    return await handleOpenAITTS(request);
  }

  if(path === '/voices') {
    const l = (requestUrl.searchParams.get('l') || '').toLowerCase();
    const f = requestUrl.searchParams.get('f');
    let response = await voiceList();

    if(l.length > 0) {
      response = response.filter((item: any) => item.Locale.toLowerCase().includes(l));
    }

    return new Response(JSON.stringify(response), {
      headers:{
      'Content-Type': 'application/json; charset=utf-8'
      }
    });
  }

  const baseUrl = request.url.split('://')[0] + "://" + requestUrl.host;
  // 更新主界面，添加交互式 TTS 请求界面
  return new Response(`<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Microsoft TTS API</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-50">
      <div class="container mx-auto px-4 py-8 max-w-4xl">
        <h1 class="text-3xl font-bold text-center mb-2 text-blue-600">Microsoft TTS API</h1>
        <p class="text-center mb-8 text-gray-600">Deno 版文本转语音服务</p>
        
        <div class="bg-white p-6 rounded-lg shadow-md mb-6">
          <h2 class="text-xl font-semibold mb-4">在线文本转语音</h2>
          
          <div class="mb-4">
            <label for="text" class="block text-sm font-medium text-gray-700 mb-1">文本内容</label>
            <textarea id="text" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" rows="4" placeholder="请输入要转换的文本"></textarea>
          </div>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label for="voice" class="block text-sm font-medium text-gray-700 mb-1">语音</label>
              <select id="voice" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="zh-CN-XiaoxiaoMultilingualNeural">晓晓 - 女声</option>
                <option value="zh-CN-YunxiNeural">云希 - 男声</option>
                <option value="zh-CN-YunyangNeural">云扬 - 男声</option>
                <option value="zh-CN-XiaohanNeural">晓涵 - 女声</option>
                <option value="zh-CN-XiaomoNeural">晓墨 - 女声</option>
                <option value="zh-CN-XiaoxuanNeural">晓暄 - 女声</option>
              </select>
            </div>
            
            <div>
              <label for="style" class="block text-sm font-medium text-gray-700 mb-1">风格</label>
              <select id="style" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="general">默认</option>
                <option value="cheerful">愉快</option>
                <option value="sad">悲伤</option>
                <option value="angry">愤怒</option>
                <option value="fearful">恐惧</option>
                <option value="disgruntled">不满</option>
                <option value="serious">严肃</option>
                <option value="gentle">温柔</option>
                <option value="affectionate">深情</option>
                <option value="embarrassed">尴尬</option>
              </select>
            </div>
          </div>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label for="rate" class="block text-sm font-medium text-gray-700 mb-1">语速: <span id="rateValue">0</span>%</label>
              <input type="range" id="rate" min="-100" max="100" value="0" class="w-full" oninput="document.getElementById('rateValue').textContent = this.value">
            </div>
            
            <div>
              <label for="pitch" class="block text-sm font-medium text-gray-700 mb-1">音调: <span id="pitchValue">0</span>%</label>
              <input type="range" id="pitch" min="-100" max="100" value="0" class="w-full" oninput="document.getElementById('pitchValue').textContent = this.value">
            </div>
          </div>
          
          <div class="mb-4">
            <label for="apiKey" class="block text-sm font-medium text-gray-700 mb-1">API 密钥</label>
            <input type="text" id="apiKey" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="输入 API 密钥">
          </div>
          
          <div class="flex justify-between items-center">
            <button id="generateBtn" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
              生成语音
            </button>
            <div class="flex items-center">
              <input type="checkbox" id="download" class="mr-2">
              <label for="download" class="text-sm text-gray-700">下载音频文件</label>
            </div>
          </div>
        </div>
        
        <div id="audioContainer" class="bg-white p-6 rounded-lg shadow-md mb-6 hidden">
          <h2 class="text-xl font-semibold mb-4">语音输出</h2>
          <audio id="audioPlayer" controls class="w-full"></audio>
        </div>
        
        <div class="text-center">
          <a href="/docs" class="text-blue-600 hover:underline">查看 API 文档</a>
        </div>
      </div>
      
      <script>
        document.getElementById('generateBtn').addEventListener('click', async function() {
          const text = document.getElementById('text').value;
          if (!text) {
            alert('请输入要转换的文本');
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
          
          try {
            const response = await fetch(url);
            
            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(\`请求失败: \${response.status} \${errorText}\`);
            }
            
            const blob = await response.blob();
            const audioUrl = URL.createObjectURL(blob);
            
            const audioPlayer = document.getElementById('audioPlayer');
            audioPlayer.src = audioUrl;
            
            document.getElementById('audioContainer').classList.remove('hidden');
            audioPlayer.play();
          } catch (error) {
            alert(\`错误: \${error.message}\`);
          }
        });
      </script>
    </body>
  </html>`, { 
    status: 200, 
    headers: { 'Content-Type': 'text/html; charset=utf-8'}
  });
}

async function getEndpoint(): Promise<any> {
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

// 随机生成 X-UserId，格式为 16 位字符（字母+数字）
function generateUserId(): string {
  const chars = 'abcdef0123456789'; // 只使用16进制字符，与原格式一致
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function sign(urlStr: string): Promise<string> {
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

function dateFormat(): string {
  const formattedDate = new Date().toUTCString().replace(/GMT/, '').trim() + 'GMT';
  return formattedDate.toLowerCase();
}

function getSsml(text: string, voiceName: string, rate: number, pitch: number, style = 'general'): string {
  text = escapeSSML(text);
  return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"> <voice name="${voiceName}"> <mstts:express-as style="${style}" styledegree="1.0" role="default"> <prosody rate="${rate}%" pitch="${pitch}%" volume="50">${text}</prosody> </mstts:express-as> </voice> </speak>`;
}

function voiceList(): Promise<any[]> {
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

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

async function base64ToBytes(base64: string): Promise<Uint8Array> {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  const base64 = btoa(String.fromCharCode.apply(null, [...bytes]));
  return base64;
}

// API 密钥验证函数
function validateApiKey(apiKey: string | null): boolean {
  // 从环境变量获取 API 密钥并进行验证
  return apiKey === API_KEY;
}

async function getVoice(
  text: string, 
  voiceName: string = 'zh-CN-XiaoxiaoMultilingualNeural', 
  rate: number = 0, 
  pitch: number = 0, 
  style: string = 'general', 
  outputFormat: string = 'audio-24khz-48kbitrate-mono-mp3', 
  download: boolean = false
): Promise<Response> {
  // get expiredAt from endpoint.t (jwt token)
  if (!expiredAt || Date.now() / 1000 > expiredAt - 60) {
    endpoint = await getEndpoint();
    const jwt = endpoint.t.split('.')[1];
    const decodedJwt = JSON.parse(atob(jwt));
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
    if (!download) {
      return response;
    }
    const resp = new Response(response.body, response);
    resp.headers.set('Content-Disposition', `attachment; filename="${uuid()}.mp3"`);
    return resp;
  } else {
    return new Response(response.statusText, { status: response.status });
  }
}

// 处理 OpenAI 格式的文本转语音请求
async function handleOpenAITTS(request: Request): Promise<Response> {
  // 验证请求方法是否为 POST
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 验证 API 密钥
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Missing or invalid API key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiKey = authHeader.replace('Bearer ', '');
  if (!validateApiKey(apiKey)) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Invalid API key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 解析请求体 JSON
    const requestData = await request.json();

    // 验证必要参数
    if (!requestData.model || !requestData.input) {
      return new Response(JSON.stringify({ error: 'Bad request: Missing required parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 提取参数
    const text = requestData.input;
    // 映射 voice 参数 (可选择添加 model 到 voice 的映射逻辑)
    let voiceName = 'zh-CN-XiaoxiaoMultilingualNeural'; // 默认声音
    if (requestData.voice) {
      // OpenAI的voice参数有alloy, echo, fable, onyx, nova, shimmer
      // 可以根据需要进行映射
      const voiceMap: Record<string, string> = {
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

    return ttsResponse;
  } catch (error) {
    console.error('OpenAI TTS API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error: ' + (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Deno 服务器启动代码
Deno.serve(handleRequest); 