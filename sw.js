// 앱 설치용 최소 서비스워커: 항상 최신 내용을 인터넷에서 받아옵니다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
