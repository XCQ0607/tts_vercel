// Service Worker for Microsoft TTS API PWA
const CACHE_NAME = 'tts-api-v1';
const urlsToCache = [
  '/',
  '/favicon.svg',
  '/favicon-16x16.svg',
  '/favicon-32x32.svg',
  '/icon-192.svg',
  '/manifest.json',
  'https://cdn.tailwindcss.com/'
];

// 安装事件 - 缓存资源
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching files');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('Service Worker: Installed');
        return self.skipWaiting();
      })
  );
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker: Activated');
      return self.clients.claim();
    })
  );
});

// 拦截网络请求
self.addEventListener('fetch', event => {
  // 只处理 GET 请求
  if (event.request.method !== 'GET') {
    return;
  }

  // 对于 API 请求，使用网络优先策略
  if (event.request.url.includes('/tts') || 
      event.request.url.includes('/voices') || 
      event.request.url.includes('/docs') ||
      event.request.url.includes('/reader.json') ||
      event.request.url.includes('/ifreetime.json') ||
      event.request.url.includes('/v1/audio/speech') ||
      event.request.url.includes('/audio/speech')) {
    
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          // 如果网络失败，返回离线页面或错误信息
          return new Response(JSON.stringify({
            error: 'Network unavailable',
            message: '网络连接不可用，请检查网络连接后重试'
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // 对于静态资源，使用缓存优先策略
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 如果缓存中有，直接返回
        if (response) {
          return response;
        }
        
        // 否则从网络获取
        return fetch(event.request)
          .then(response => {
            // 检查是否是有效响应
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // 克隆响应，因为响应流只能使用一次
            const responseToCache = response.clone();

            // 将响应添加到缓存
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return response;
          });
      })
  );
});

// 处理推送通知（可选）
self.addEventListener('push', event => {
  console.log('Service Worker: Push received');
  
  const options = {
    body: event.data ? event.data.text() : 'TTS API 有新消息',
    icon: '/icon-192.svg',
    badge: '/favicon-32x32.svg',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: '查看详情',
        icon: '/favicon-16x16.svg'
      },
      {
        action: 'close',
        title: '关闭',
        icon: '/favicon-16x16.svg'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Microsoft TTS API', options)
  );
});

// 处理通知点击
self.addEventListener('notificationclick', event => {
  console.log('Service Worker: Notification clicked');
  event.notification.close();

  if (event.action === 'explore') {
    // 打开应用
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});
