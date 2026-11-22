# 테스트

앱의 핵심 기능(로그인, 권한, 출석 제출, 대시보드 집계, 보안)을 실제 브라우저로 자동 확인합니다.

- 테스트는 항상 **체험 모드**로 돌아요. 테스트용 서버(`serve.mjs`)가 Firebase 연결을 꺼 주기 때문에 실제 교인 데이터에는 닿지 않아요.
- 테스트에 쓰는 이름은 모두 가짜예요.

## 처음 한 번 준비
```
cd tests
npm install
npx playwright install chromium
```

## 테스트 돌리기
```
cd tests
npm test
```
모든 줄 앞에 ✓ 표시가 나오면 통과예요.
