# Desert Passage

한 치 앞도 보이지 않는 사막에서, 내가 붙잡아 왔던 것들을 지표 삼아 나아가는 여정.
A-Frame 1.6 (Three.js r164) 기반 3D 인터랙티브 작품입니다.

## 실행 방법 (VS Code + Live Server)

> `index.html`을 더블클릭해서 열면(`file://`) 브라우저 보안 정책 때문에 3D 모델(GLB)을 불러올 수 없습니다.
> 반드시 아래처럼 **로컬 서버**로 실행하세요.

1. VS Code에서 **이 폴더**(`index.html`이 있는 폴더)를 엽니다. — `파일 → 폴더 열기`
2. 오른쪽 아래에 *Live Server* 확장 설치 안내가 뜨면 설치합니다. (확장 ID: `ritwickdey.LiveServer`)
3. `index.html`을 우클릭 → **Open with Live Server**
4. 브라우저가 `http://127.0.0.1:5500/index.html` 로 열립니다. 코드를 저장하면 자동으로 새로고침됩니다.

## 조작

| 키 | 동작 |
|---|---|
| W A S D | 걷기 · Shift 빠르게 |
| 마우스 | 시점 (화면 클릭 시 마우스 잠금, Esc 해제) |
| E | 상호작용 |
| C | 나침반 꺼내기 / 넣기 |
| 클릭 · Space | 자막 넘기기 (Q 건너뛰기) |
| ` | 디버그 패널 (FPS, 상태, 드로우콜) |

## 폴더 구조

```text
index.html          스크립트 로딩 순서 (컴포넌트가 a-scene보다 먼저 등록되어야 함)
main.js             시작 순서 · 프롤로그 · 디버그 패널
style.css           UI · 레터박스 · 자막
js/
  config.js         모든 수치 (가시거리, 카메라, 오브젝트 위치, 모델 경로, 애니메이션 클립 이름)
  narrative.js      모든 문장 (프롤로그 · 회상 · 엔딩) ← 문장 수정은 이 파일만
  game-state.js     상태 머신 · 완료 처리 (중복 방지)
  character.js      wanderer.glb 캐릭터 · 애니메이션 별칭
  cinematic.js      레터박스 · 자막 · 회상 화면
  camera-controller.js / player-controller.js / interaction-manager.js
  audio-manager.js  합성 사운드 (config.audio.files에 경로를 넣으면 실제 파일 사용)
  world-builder.js  사막 · 유적 · 포털      paradise-builder.js  낙원
  portal-manager.js / environment-transition.js
  interactions/     나침반 · 큐브 · 무전기 · DVD/TV · 글라이더 · 비니
models/             웹용으로 최적화한 GLB (원본은 저장소에 올리지 않음)
.vscode/            Live Server 설정
```

## 임시 미디어 교체

- **TV 영상**: `js/narrative.js` → `dvdScenes[i].src`에 MP4/WebM 경로를 넣으면 노이즈 대신 재생
- **사운드**: `js/config.js` → `audio.files`에 MP3/WAV/OGG 경로를 넣으면 합성음 대신 재생

## GitHub로 공유

저장소 → Settings → Pages → Branch `main` / `(root)` → Save.
1~2분 뒤 `https://<아이디>.github.io/desert-passage/` 에서 누구나 실행할 수 있습니다.
