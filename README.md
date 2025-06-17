# 🎵 Microsoft TTS API - 文本转语音服务

[![GitHub stars](https://img.shields.io/github/stars/XCQ0607/tts_vercel?style=social)](https://github.com/XCQ0607/tts_vercel)
[![GitHub forks](https://img.shields.io/github/forks/XCQ0607/tts_vercel?style=social)](https://github.com/XCQ0607/tts_vercel)
[![GitHub issues](https://img.shields.io/github/issues/XCQ0607/tts_vercel)](https://github.com/XCQ0607/tts_vercel/issues)
[![GitHub license](https://img.shields.io/github/license/XCQ0607/tts_vercel)](https://github.com/XCQ0607/tts_vercel/blob/main/LICENSE)

一个基于 Microsoft Azure 认知服务的现代化文本转语音 (TTS) 服务，支持多种部署方式和丰富的语音选项。

## ✨ 特性

- 🌍 **多语言支持** - 支持中文、英文、日文、韩文等多种语言
- 🎭 **丰富的语音风格** - 支持愉快、悲伤、严肃等多种情感风格
- 🎛️ **精细调节** - 支持语速、音调的精确调节
- 📱 **响应式设计** - 完美适配桌面和移动设备
- 🎵 **现代化播放器** - 内置波形可视化和播放控制
- 📚 **历史记录** - 本地缓存，支持重播和管理
- 🔄 **多种部署方式** - 支持 Vercel、Cloudflare Workers、Deno Deploy
- 🎨 **美观界面** - 现代化 UI 设计，支持毛玻璃效果

## 🚀 技术栈

<div align="center">

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)
![Deno](https://img.shields.io/badge/Deno-000000?style=for-the-badge&logo=deno&logoColor=white)
![Microsoft Azure](https://img.shields.io/badge/Microsoft_Azure-0089D0?style=for-the-badge&logo=microsoft-azure&logoColor=white)

</div>

## 📸 预览

<div align="center">
  <img src="" alt="TTS 预览图" style="border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
</div>

## 🎯 快速开始

### 方式一：Vercel 部署（推荐）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/XCQ0607/tts_vercel)

1. **Fork 本仓库**

   ```bash
   git clone https://github.com/XCQ0607/tts_vercel.git
   cd tts_vercel
   ```
2. **安装依赖**

   ```bash
   npm install
   # 或
   yarn install
   # 或
   pnpm install
   ```
3. **本地开发**

   ```bash
   npm run dev
   # 或
   vercel dev
   ```
4. **部署到 Vercel**

   - 在 [Vercel](https://vercel.com) 创建新项目
   - 连接你的 GitHub 仓库
   - 点击部署即可

### 方式二：Cloudflare Workers 部署

本项目同时提供了 Cloudflare Workers 版本，适合需要全球 CDN 加速的场景。

1. **使用 Cloudflare Workers 代码**

   ```bash
   # 查看 index_cloudflare.js 文件
   cp index_cloudflare.js wrangler.toml
   ```
2. **配置 Wrangler**

   ```bash
   npm install -g wrangler
   wrangler login
   ```
3. **部署**

   ```bash
   wrangler publish
   ```

### 方式三：Deno Deploy 部署

项目还支持 Deno Deploy，提供现代化的 TypeScript 运行时。

1. **准备 Deno 代码**

   ```typescript
   // 查看项目中的 Deno 版本代码
   deno run --allow-net --allow-read server.ts
   ```
2. **部署到 Deno Deploy**

   - 访问 [Deno Deploy](https://deno.com/deploy)
   - 连接 GitHub 仓库
   - 选择入口文件并部署

## 🔧 配置说明

### 环境变量

|        变量名        | 说明               | 必需 | 默认值 |
| :------------------: | ------------------ | ---- | :----: |
|  `AZURE_TTS_KEY`  | Azure 认知服务密钥 | 否   |   -   |
| `AZURE_TTS_REGION` | Azure 服务区域     | 否   | eastus |
|     `API_KEY`     | 网页API请求密钥    | 否   |   无   |

### API 密钥获取

1. 访问 [Azure Portal](https://portal.azure.com)
2. 创建认知服务资源
3. 获取密钥和区域信息
4. 在环境变量中配置（可选）

> 💡 **提示**: 即使不配置 API 密钥，服务仍可正常使用，但可能有使用限制。

## 📖 API 文档

### 基本 TTS 接口

```http
GET /tts?t={text}&v={voice}&r={rate}&p={pitch}&s={style}
```

**参数说明:**

| 参数  | 类型    | 说明                   | 示例                     |
| ----- | ------- | ---------------------- | ------------------------ |
| `t` | string  | 要转换的文本           | `你好世界`             |
| `v` | string  | 语音ID                 | `zh-CN-XiaoxiaoNeural` |
| `r` | number  | 语速调节 (-100 到 100) | `0`                    |
| `p` | number  | 音调调节 (-100 到 100) | `0`                    |
| `s` | string  | 语音风格               | `cheerful`             |
| `d` | boolean | 是否下载文件           | `true`                 |

### OpenAI 兼容接口

```http
POST /v1/audio/speech
Content-Type: application/json

{
  "model": "tts-1",
  "input": "你好世界",
  "voice": "zh-CN-XiaoxiaoNeural",
  "response_format": "mp3",
  "speed": 1.0
}
```

### 语音列表接口

```http
GET /voices?l={language}
```

获取支持的语音列表，可按语言筛选。

### 其他接口

- `GET /docs` - 查看详细 API 文档
- `GET /reader.json` - 阅读器配置接口
- `GET /ifreetime.json` - IFreeTime 应用配置接口

## 🎭 支持的语音

### 中文语音

| 语音ID                   | 名称 | 性别 | 风格支持 |
| ------------------------ | ---- | ---- | -------- |
| `zh-CN-XiaoxiaoNeural` | 晓晓 | 女   | ✅       |
| `zh-CN-YunxiNeural`    | 云希 | 男   | ✅       |
| `zh-CN-YunyangNeural`  | 云扬 | 男   | ✅       |
| `zh-CN-XiaohanNeural`  | 晓涵 | 女   | ✅       |
| `zh-CN-XiaomengNeural` | 晓梦 | 女   | ✅       |
| `zh-CN-XiaomoNeural`   | 晓墨 | 女   | ✅       |

### 英文语音

| 语音ID                | 名称  | 性别 | 风格支持 |
| --------------------- | ----- | ---- | -------- |
| `en-US-AriaNeural`  | Aria  | 女   | ✅       |
| `en-US-GuyNeural`   | Guy   | 男   | ✅       |
| `en-US-JennyNeural` | Jenny | 女   | ✅       |

> 📝 **更多语音**: 查看 [完整语音列表](https://docs.microsoft.com/azure/cognitive-services/speech-service/language-support)

## 🎨 语音风格

| 风格ID              | 中文名称 | 适用场景 |
| ------------------- | -------- | -------- |
| `general`         | 标准     | 通用场景 |
| `cheerful`        | 愉快     | 积极内容 |
| `sad`             | 悲伤     | 情感表达 |
| `angry`           | 愤怒     | 强烈情感 |
| `gentle`          | 温柔     | 温馨内容 |
| `newscast`        | 新闻播报 | 正式场合 |
| `customerservice` | 客服     | 服务场景 |
| `assistant`       | 助理     | 智能助手 |

## 使用示例

### 基本使用

```bash
curl "https://your-domain.vercel.app/tts?t=你好世界&v=zh-CN-XiaoxiaoMultilingualNeural&api_key=your_key"
```

### JavaScript 调用

```javascript
const response = await fetch('/tts?t=你好世界&v=zh-CN-XiaoxiaoMultilingualNeural&api_key=your_key');
const audioBlob = await response.blob();
const audioUrl = URL.createObjectURL(audioBlob);
const audio = new Audio(audioUrl);
audio.play();
```

### OpenAI 格式调用

```javascript
const response = await fetch('/v1/audio/speech', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your_api_key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'tts-1',
    input: '你好世界',
    voice: 'alloy',
    speed: 1.0
  })
});
const audioBlob = await response.blob();
```

## 本地开发

1. 克隆项目

```bash
git clone https://github.com/your-username/microsoft-tts-api.git
cd microsoft-tts-api
```

2. 安装依赖

```bash
npm install
```

3. 设置环境变量（可选）

```bash
export API_KEY=your_api_key
```

4. 启动开发服务器

```bash
npm run dev
```

## 注意事项

- 本项目使用 Microsoft 的免费 TTS 服务，请遵守相关使用条款
- 建议设置 API 密钥以防止滥用
- 生产环境建议配置适当的速率限制

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
