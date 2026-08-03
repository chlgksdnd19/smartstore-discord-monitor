# 스마트스토어 디스코드 모니터

별도 앱이나 실행 프로그램 없이 GitHub Actions가 네이버 스마트스토어를 주기적으로 확인하고, 변경이 있을 때 Discord Webhook 채널로 알림을 보냅니다.

## 현재 설정

- 스토어: `https://smartstore.naver.com/lottegm42`
- 지정 상품: `https://smartstore.naver.com/lottegm42/products/12309955192`
- 확인 주기: 약 15분
- 감지 항목
  - 새 상품 등록
  - 할인율 및 판매가 변동
  - 재고 상태·공개 재고 수량 변동
  - 품절에서 판매 가능으로 바뀌는 리스탁

> 타 판매자 상품에서 실제 재고 숫자가 공개되지 않으면 `판매 가능` 또는 `품절` 상태만 비교합니다. 숫자를 임의로 추정하지 않습니다.

## 1. GitHub 저장소 만들기

1. GitHub에서 **New repository**를 누릅니다.
2. 저장소 이름은 예를 들어 `smartstore-discord-monitor`로 입력합니다.
3. 기본 권장은 **Public**입니다. 표준 GitHub Actions를 무료로 계속 사용할 수 있고, Webhook URL은 Secret에 저장되어 공개되지 않습니다.
   - Private 저장소도 가능하지만 계정별 Actions 무료 시간이 차감됩니다.
4. 압축을 푼 이 폴더의 파일과 폴더를 전부 업로드합니다.
   - `.github` 폴더도 반드시 포함되어야 합니다.

## 2. Discord Webhook 만들기

1. 알림을 받을 Discord 채널의 **채널 편집**을 엽니다.
2. **연동 → 웹후크 → 새 웹후크**를 선택합니다.
3. 알림 채널을 지정하고 **웹후크 URL 복사**를 누릅니다.
4. URL을 공개 저장소나 파일에 직접 넣지 마세요.

## 3. GitHub Secret 등록하기

1. GitHub 저장소에서 **Settings**를 누릅니다.
2. **Secrets and variables → Actions**로 들어갑니다.
3. **New repository secret**을 누릅니다.
4. Name: `DISCORD_WEBHOOK_URL`
5. Secret: Discord에서 복사한 Webhook URL
6. **Add secret**을 누릅니다.

## 4. 웹훅 테스트하기

1. 저장소 상단의 **Actions**를 누릅니다.
2. 왼쪽에서 **SmartStore Discord Monitor**를 선택합니다.
3. **Run workflow**를 누릅니다.
4. `mode`를 `test-webhook`으로 선택하고 실행합니다.
5. Discord 채널에 테스트 성공 메시지가 오면 연결 완료입니다.

## 5. 첫 기준값 저장하기

1. 다시 **Run workflow**를 누릅니다.
2. `mode`를 `reset-baseline`으로 선택하고 실행합니다.
3. Discord 채널에 `스마트스토어 모니터링 시작` 알림이 옵니다.
4. 이후 약 15분마다 자동 확인하며, 변경이 있을 때만 상품 알림을 전송합니다.

## 주요 파일

- `config.json`: 스토어 주소, 지정 상품, 수집 페이지 수 설정
- `monitor.js`: 이전 상태와 현재 상태 비교
- `src/`: 네이버 확인 및 Discord 전송 코드
- `data/state.json`: 이전 상품 상태 자동 저장
- `.github/workflows/monitor.yml`: GitHub 자동 실행 설정

## 설정 변경

`config.json`의 `pinnedProductUrls` 배열에 상품 URL을 추가하면 오래된 상품도 상세 상태를 직접 확인합니다.

```json
"pinnedProductUrls": [
  "https://smartstore.naver.com/lottegm42/products/12309955192",
  "https://smartstore.naver.com/lottegm42/products/추가상품번호"
]
```

스토어 목록 확인 범위를 넓히려면 `maxStorePages`를 늘릴 수 있습니다. 너무 크게 설정하면 네이버 요청량과 실행 시간이 증가하므로 기본값 5를 권장합니다.

## 주의

- 공개 페이지와 공개적으로 내려오는 응답만 확인합니다.
- 로그인, CAPTCHA 우회, 프록시 회전, 차단 회피 기능은 포함하지 않았습니다.
- 네이버 페이지 구조가 바뀌면 추출 코드를 수정해야 할 수 있습니다.
- GitHub 예약 실행은 서버 상황에 따라 예정 시각보다 늦게 실행될 수 있습니다.
- 상품 상태가 변하지 않으면 `state.json`을 커밋하지 않으며, 예약 실행 중지를 막기 위한 월 1회 기준 월 정보만 갱신합니다.
