# Tab Steward — 브라우저 탭 관리자

[![check](https://github.com/HSwiterZ/tab-steward/actions/workflows/ci.yml/badge.svg)](https://github.com/HSwiterZ/tab-steward/actions/workflows/ci.yml)

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **한국어**

빌드 단계도 의존성도 없는 Manifest V3 확장 프로그램입니다. 모든 코드는 순수 ES 모듈이라
폴더를 그대로 “압축 풀리지 않은 확장 프로그램 로드하기”로 실행할 수 있습니다.

<table>
  <tr>
    <td><img src="docs/screenshots/dashboard-tabs.png" width="430" alt="대시보드: 창별로 묶은 사이트 카드"></td>
    <td><img src="docs/screenshots/dashboard-analytics.png" width="430" alt="사용 분석: 사이트별 포그라운드 시간 순위"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/dashboard-tabs-dark.png" width="430" alt="대시보드 다크 테마"></td>
    <td><img src="docs/screenshots/popup.png" width="270" alt="툴바 팝업"></td>
  </tr>
</table>

> **확장 프로그램 UI는 현재 중국어 단일 언어입니다.** 문서는 번역되어 있지만 UI는 아직 아닙니다.
> 위 스크린샷도 실제 중국어 UI입니다.

Tab Steward는 각 탭이 얼마나 오래 방치되었는지를 측정하고, 오래된 탭을 절전시키고, 탭 묶음에 이름을
붙여 컬렉션으로 임시 보관하고, 중복을 처리하고, 워크스페이스 전체를 스냅샷으로 저장하고 복원하고,
시간 지정 알림을 걸고, 탭 / 임시 보관 / 북마크 / 방문 기록 / 최근 닫은 탭을 하나의 `Ctrl`/`⌘K`
팔레트에서 검색합니다. “열린 탭 관리”, “임시 보관함”, “사용 분석” 세 가지를 제외하고 나머지는 전부 끌 수 있습니다.
모든 데이터는내 컴퓨터의 `chrome.storage.local`에만 남고, 선택 사항인 LLM 도우미는 기본으로 꺼져 있으며
당신이 입력한 Base URL하고만 통신합니다. 아이콘과 스타일의 출처는
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)를 보세요.

## 데모

아래 영상은 모두 실제 화면을 녹화한 것입니다. 데이터는 내장 mock 시드(`src/dev/mock-chrome.js`)이며, 누구의 실제 방문 기록도 포함되어 있지 않습니다.

<table>
  <tr>
    <td><img src="docs/demos/search.gif" width="460" alt="통합 검색"><br><b>통합 검색</b><br><code>⌘K</code> 팔레트 하나로 탭 / 임시 보관 / 북마크 / 방문 기록 / 최근 닫은 탭을 한꺼번에.</td>
    <td><img src="docs/demos/stash-drag.gif" width="460" alt="드래그로 임시 보관"><br><b>드래그로 임시 보관</b><br>탭을 컬렉션에 놓으면 그대로 보관됩니다. 접힌 컬렉션도 받으며, 탭은 닫히지 않습니다.</td>
  </tr>
  <tr>
    <td><img src="docs/demos/sleep.gif" width="460" alt="절전"><br><b>절전</b><br>사이트마다 유휴 점수를 표시합니다. 한 개만, 또는 그룹째로.</td>
    <td><img src="docs/demos/duplicates.gif" width="460" alt="중복 탭"><br><b>중복 탭</b><br>중복만 걸러 봅니다. 알려만 되지 임의로 닫지는 않습니다.</td>
  </tr>
  <tr>
    <td><img src="docs/demos/organize.gif" width="460" alt="자동 정리"><br><b>자동 정리</b><br>사이트 인접 배치 또는 컬렉션별 그룹화를 한 번에.</td>
    <td><img src="docs/demos/snapshots.gif" width="460" alt="워크스페이스 스냅샷"><br><b>워크스페이스 스냅샷</b><br>창의 탭 구성과 순서를 저장했다가 그대로 복원.</td>
  </tr>
  <tr>
    <td><img src="docs/demos/reminders.gif" width="460" alt="시간 지정 알림"><br><b>시간 지정 알림</b><br>대상은 열려 있는 탭에서 고르고 시간을 설정하면, 버튼이 있는 알림으로 도착합니다.</td>
    <td><img src="docs/demos/analytics.gif" width="460" alt="사용 분석"><br><b>사용 분석</b><br>사이트별·페이지별 포그라운드 시간과 활성 횟수, 전부 로컬에 남습니다.</td>
  </tr>
</table>

### 오른쪽 클릭 메뉴

영상으로 담을 수 없는 유일한 기능입니다. 이 메뉴는 페이지가 아니라 브라우저 소속이라서요. 아무 페이지에서나
오른쪽 클릭하면 “Tab Steward — 标签页管理器” 항목이 생기고(아래 사진의 테두리 부분), 하위 메뉴는
컬렉션과 창이 바뀔 때마다 자동으로 다시 만들어집니다.

<img src="docs/context-menu.png" width="420" alt="브라우저 오른쪽 클릭 메뉴와 펼쳐진 Tab Steward 하위 메뉴">

브라우저의 네이티브 메뉴에는 항목별 아이콘 필드가 없어서, 각 동작은 제목 맨 앞에 emoji 한 글자로
그림을 싣고 OS의 emoji 폰트가 이를 그립니다. 값만 나열하는 항목(미리 정의된 시간, 컬렉션 이름,
창 제목)은 일반 텍스트 그대로입니다.

- **⏰ 设定提醒** — 미리 정의된 시간. 페이지 단위에도, 사이트 단위에도 걸 수 있습니다
- **📥 暂存到…** / **📦 暂存并关闭到…** — 둘 다 모든 컬렉션을 나열합니다
- **🌙 休眠此标签** — 이 탭을 절전
- **🪟 移动到窗口** — 다른 일반 창으로
- **🧹 整理所有标签 (站点 + 收藏区分组)** — 사이트 인접 배치 + 컬렉션별 그룹화
- **🛡️ 保护此站点（不自动休眠）** — 이 사이트는 자동 절전 대상에서 제외
- **📊 打开 Dashboard**

## 설치

1. `chrome://extensions`(Chrome) 또는 `edge://extensions`(Edge) 열기
2. **개발자 모드** 켜기 (Chrome은 오른쪽 위, Edge는 왼쪽 사이드바 아래)
3. **압축 풀리지 않은 확장 프로그램 로드하기**를 눌러 이 폴더 선택
4. 툴바에 아이콘이 보이면 완료 — 클릭하면 팝업, `Alt+Shift+T`는 대시보드

## 화면

| 화면 | 위치 | 내용 |
|---|---|---|
| 툴바 팝업 | `src/popup/` | 통합 검색(탭 / 임시 보관 / 북마크 / 방문 기록 / 최근 닫은 탭). 아래는 “현재 탭 / 임시 보관함” 두 칸. 사이트별 접기, 임시 보관·절전·닫기, 중복 정리 |
| 대시보드 | `src/dashboard/` | 상단 바 = 로고 + 검색창 + 기능 버튼. 본문 = 현재 탭(정렬 / 창별 그룹화 / 필터 칩 / 창 구분 / 사이트 카드). 오른쪽 칸 = 상시 표시 컬렉션 패널. 알림·스냅샷·분석·휴지통은 상단 바 아이콘으로 전환 |
| 새 탭 | `src/newtab/` | 기본은 최소형 시작 페이지. 그 Dashboard 타일을 누르면 같은 탭 안이 그대로 전체 대시보드로 바뀝니다(탭이 늘지 않고 주소도 dashboard 페이지 URL로 바뀌지 않습니다). 설정에서 대시보드를 기본 시작 페이지로 지정할 수도 있습니다 |
| 설정 | `src/options/` | 모든 토글과 LLM 구성 |

단축키: `Alt+T` 팝업, `Alt+Shift+T` 대시보드, `Ctrl/⌘+K` 통합 검색.

페이지에서 마우스 오른쪽 버튼을 누르면 “Tab Steward — 标签页管理器” 항목이 생깁니다. 하위 메뉴의
항목별 설명과 화면은 위 “데모 → 오른쪽 클릭 메뉴”에 있습니다.

## 기능 모듈과 기본값

세 가지 핵심 기능(열린 탭 관리 · 임시 보관함 · 사용 분석)을 제외한 모든 기능은 끌 수 있는 모듈이며,
설정 페이지 맨 위의 “기능 모듈” 목록에 모여 있습니다(단일 진실 공급원: `src/core/modules.js`).
**모듈을 끄면 팝업, 대시보드, 오른쪽 클릭 메뉴, 통합 검색, 설정 페이지에 있는 그 모듈의 모든 진입점이
사라지고 백그라운드 동작도 멈춥니다. 데이터는 절대 지우지 않으니 다시 켜면 그대로 돌아옵니다.**

사용 분석은 핵심 쪽에 속합니다: 유휴 점수도 대시보드의 모든 정렬도 이 수집 값에서 계산되므로,
끄면 정렬이 퇴화합니다. 그래서 토글을 두지 않았습니다.

| 모듈 | 기본값 |
|---|---|
| 열린 탭 관리, 임시 보관함, 사용 분석 | 핵심. 비활성화 불가 |
| 컬렉션, 중복 탭 처리, 절전, 시간 지정 알림, 워크스페이스 스냅샷, 자동 정리, 북마크 및 방문 기록 검색, 휴지통과 백업 | 켜짐 |
| LLM 정리 도우미, 탭 호버 스크린샷 | 꺼짐(모델 엔드포인트와 키는 직접 준비 / 페이지 권한은 필요할 때 허용) |

중복을 발견해도 알려만 되지, 임의로 탭을 닫지는 않습니다. 같은 페이지를 한 장 더 여는 것은 흔한
상황(폼을 하나 더, 나란히 비교)이므로 닫을지는 당신이 정합니다. 알림과 대시보드 배너 모두에
“이 탭을 닫고 이동”과 “기존 탭으로 전환” 두 버튼을 두고, 아무것도 고르지 않으면 둘 다 그대로 남습니다.
알림은 10초 뒤 스스로 사라지므로 클릭을 기다리며 화면에 머물지 않습니다. 일괄 정리(팝업과 대시보드의
“중복 정리”)는 클릭한 뒤에 실행되고 되돌리기(Undo)가 붙어 있으며, 정리하는 동안에는 중복 감지를 잠시
멈추므로 닫힌 탭 대신 다시 로드된 이웃 탭이 새 중복으로 잘못 보고되지 않습니다.

알림이 화면에 남는지(sticky)는 알림 리마인더에만 적용되는 설정이며 기본은 켜짐입니다. 상시 표시하지
않으면 Windows가 당신이 보기 전에 알림을 접어버려 “10분 미룸”을 클릭할 수 없게 됩니다.

`chrome.processes`는 Chrome 개발자 채널에서만 있고 안정 버전에서는 동작하지 않으므로 “렌더러 프로세스
메모리” 모듈은 제공하지 않고, manifest에서도 `processes` 권한을 요청하지 않습니다.

## 기능과 코드 대응

| 기능 | 주요 파일 |
|---|---|
| 모듈 토글 | `src/core/modules.js`(레지스트리), `src/ui/shared.js`의 `featureOn()`(모든 화면이 여기서 읽음) |
| 저장과 마이그레이션 | `src/core/storage.js`, `src/core/defaults.js` |
| 사용 분석과 유휴 점수 | `src/core/stats.js`, `src/background/tracker.js` |
| 절전과 보호 | `src/background/sleep.js`, `src/core/actions.js` |
| 중복 탭 처리 | `src/core/dupes.js`, `src/background/index.js` |
| 자동 정리와 탭 그룹 | `src/core/organize.js` |
| 통합 검색 | `src/core/search.js`, `src/ui/shared.js`(⌘K 팔레트) |
| 임시 보관과 컬렉션 | `src/core/collections.js` |
| 북마크와 방문 기록 | `src/core/bookmarks.js`, `src/core/history.js` |
| 시간 지정 알림 | `src/core/reminders.js` |
| 워크스페이스 스냅샷 | `src/core/snapshots.js` |
| 휴지통과 백업 | `src/core/trash.js`, `src/core/backup.js` |
| LLM 도우미 | `src/core/llm.js` |
| 호버 스크린샷 | `src/background/screenshots.js`(촬영과 캐시), `src/ui/shared.js`의 `installHoverPreview()`(표시) |
| UI 프리미티브 | `src/ui/kit.js`, `src/ui/icons.js`, `src/ui/styles/*` |

## LLM 도우미

OpenAI의 `/chat/completions` 프로토콜을 사용합니다. 먼저 설정 페이지의 “기능 모듈”에서 LLM 정리 도우미를
켠 다음 Base URL, API Key, 모델명을 입력하세요. 키는내 컴퓨터의 `chrome.storage.local`에만 저장됩니다.
요청 본문에는 탭 제목, 도메인, 유휴 분, 상태만 담기고 전체 URL이나 방문 기록은 보내지 않습니다.
모델이 주제별 그룹화와 절전 제안을 돌려주면 미리 보기를 먼저 보여 주고, 당신이 확인해야만 적용됩니다.
확인하지 않으면 아무것도 바뀌지 않습니다.

## 권한

| 권한 | 용도 |
|---|---|
| tabs / tabGroups / windows | 탭과 그룹의 읽기, 이동, 절전, 그룹화 |
| storage / unlimitedStorage | 컬렉션, 스냅샷, 통계 등 로컬 데이터 |
| bookmarks / history / sessions | 북마크 저장, 방문 기록 검색, 최근 닫은 탭 복원 |
| notifications / alarms | 알림과 자동 절전의 트리거 |
| favicon | 사이트 아이콘 |
| contextMenus | 오른쪽 클릭의 임시 보관 / 보호 / 알림 |
| activeTab | 당신이 직접 동작했을 때 현재 탭 접근 |
| optional_host_permissions `<all_urls>` | “탭 호버 스크린샷” 모듈을 켤 때만 필요할 때 요청 |

## 개인정보

서버가 없습니다: 텔레메트리, 분석, 광고, 크래시 리포팅을 일절 쓰지 않고, 저자가 운영하는 엔드포인트도
없습니다. 컬렉션, 스냅샷, 사용 통계, 알림, 휴지통은 모두내 컴퓨터의 `chrome.storage.local`에 저장되며,
확장 프로그램을 제거하면 저장소와 함께 사라집니다.

외부 요청은 딱 하나, 게다가 기본으로 꺼져 있습니다: LLM 정리 도우미. 켜기 전에 Base URL과 API Key를
직접 입력해야 합니다(키도 로컬에만 저장). 요청 본문에는 탭 제목, 도메인, 유휴 분, 상태만 담기고
전체 URL이나 방문 기록은 담기지 않습니다. 호버 스크린샷의 `<all_urls>`는 필요할 때 허용을 받는 방식이라,
허용하지 않으면 설치되지 않습니다.

북마크와 방문 기록은 검색을 위해 로컬에서만 읽으며, 그 결과는 브라우저를 벗어나지 않습니다.

## 개발

의존성을 설치할 필요가 없습니다.

```bash
node tools/serve.mjs          # 로컬 정적 서버, 기본 포트 8787
node tools/check-imports.mjs  # 모든 기명 import에 대응하는 export가 있는지
node tools/scan-undefined-refs.mjs  # 반대 방향: import하지 않고 쓴 식별자(예: Button)
node tools/make-icons.mjs     # 아이콘 재생성(픽셀 자기 검사 포함, 투명 이미지가 나오면 즉시 실패)
node tests/run.mjs            # 핵심 로직 자동 테스트(48개)
node tools/record-demo.mjs    # 데모 GIF 재생성(Chrome과 ffmpeg 필요)
```

`package.json`에는 스크립트만 있고 의존성이 없으니 `npm test`와 `npm run check`(import 검사 +
import 누락 식별자 스캔 + 테스트)이 그대로 동작합니다. 테스트는 `tests/chrome-stub.mjs`라는 chrome
테스트 더블 위에서 돌립니다. 이 더블은 실제 API와 같은 강도로 구현했습니다(인자 검증,
`storage.onChanged`를 쓰는 쪽에도 발화, `alarms`의 이름과 조회 의미, `tabs.query`는 알 수 없는
필터에서 즉시 오류, 알림의 `priority`가 음수면 Windows/Linux/macOS 각자의 실제 동작대로 거부).
그래서 통과 여부에 의미가 있습니다.

`http://localhost:8787/src/dashboard/index.html` 같은 페이지를 브라우저로 열면
`src/dev/mock-chrome.js`가 시드 데이터를 담은 `chrome.*` 구현(탭, 창, 그룹, 북마크, 방문 기록,
최근 닫은 탭, 저장소)을 주입하므로, 확장 프로그램을 설치하지 않아도 모든 화면이 실행되고
스크린샷을 찍을 수 있습니다. 페이지 아래에 MOCK 배너가 뜨고 한 번의 클릭으로 탭을 추가하거나 시드를
초기화할 수 있습니다. 아무 페이지에나 `?theme=dark`(mock에서만 유효)를 붙이면 다크 테마가 강제되어
네 화면을 나란히 비교할 수 있고, `?nobanner`는 배너를 지우는 옵션으로 위 문서용 스크린샷이 이 방식으로
찍혔습니다.

## 디자인 토큰

색, 모서리 반지름, 여백, 그림자, 애니메이션 시간은 모두 `src/ui/styles/tokens.css`에 모으고,
라이트/다크는 토큰 값만 바꿉니다. 브랜드 색은 indigo→violet 그라데이션이며, `--primary`는 동작과
구조(주 버튼, 스위치, 체크박스, 활성 탭 밑줄, 필터 칩, 진행률 바, 현재 행 표시)에만 쓰고
`--gradient-brand`는 아이콘과 통계 카드 테두리에 씁니다. 사이트 favicon 문자 타일과 브라우저 탭 그룹 색은
데이터 쪽 색이므로 `TILE_HUES`는 225–285 색상 대역을 의도적으로 피합니다. 사이트 아이콘이 UI 컨트롤처럼
보이지 않게 하기 위해서입니다. UI를 추가할 때는 토큰을 읽으세요. 색이나 `ms` 값을 하드코딩하지 마세요.

헤드리스 스크린샷 예시:

```bash
chrome --headless=new --window-size=1440,900 --virtual-time-budget=4500 \
  --screenshot=out.png "http://localhost:8787/src/dashboard/index.html#tabs"
```

참고: 헤드리스 모드는 `transform`으로 가운데 정렬한 요소(검색 팔레트 등)의 위치를 불안정하게 그리므로,
레이아웃 확인은 화면에 띄운 실제 브라우저에서 하세요.

## 라이선스

소스 코드에는 [MIT](./LICENSE) 라이선스가 적용됩니다. UI 아이콘의 경로 데이터는 Phosphor(MIT)에서
가져왔고, 상단 작업 아이콘은 Fluent Emoji(MIT, Microsoft)를 사용하며, 스타일 프리미티브는
shadcn/ui(MIT)를 참고했습니다. 완전한 허락 조건과 저작권 표시는
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)에 있으며, 재배포할 때도 함께 유지해야 합니다.
