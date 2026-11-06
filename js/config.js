/* ==========================================================================
 *  Desert Passage — config.js
 *  모든 수치·배치·색상·재질을 이 파일에서 관리합니다.
 *  (다른 파일은 이 값을 읽기만 합니다.)
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

DP.CONFIG = {
  debug: false, // true면 시작부터 디버그 패널 표시 (` 키로도 토글)

  /* ---------- 월드 / 지형 ---------- */
  world: {
    seed: 7,
    playRadius: 30,          // 플레이어가 걸을 수 있는 반경 (m)
    terrainSegments: 80,     // 지형 격자 분할 수
    terrainCore: 70,         // 중심부 셀 크기 계수 (중심 셀 ≈ core*2/segments m)
    terrainExtent: 140,      // 지형 반경 (m) — 시야가 좁아 넓게 만들 필요 없음
    duneNearAmp: 0.55,       // 플레이 영역 안 굴곡
    duneFarAmp: 13,          // 바깥 모래언덕 높이
    duneRampStart: 26,
    duneRampEnd: 95,
    ridgeSharpness: 1.6,     // 능선 날카로움 (낮을수록 둥근 언덕)
    plazaCenter: { x: 0, z: -8 },
    plazaRadius: 9,
  },

  /* ---------- 렌더링 (성능) ----------
   * 시야가 수 m밖에 되지 않으므로 먼 풍경·그림자·복잡한 셰이딩을 모두 생략합니다. */
  render: {
    material: 'lambert',     // 'lambert'(가벼움) | 'standard'(PBR, 무거움)
    pixelRatio: 0.9,         // 렌더 해상도 배율 — 낮을수록 빠르고 부드럽게(흐리게) 보임 (이전 0.75)
    screenBlur: 0.6,         // 화면 전체 CSS 흐림 (px) — 0이면 끔 (이전 1.6). 안개(가시거리)와는 별개
    cameraFar: 70,           // 최대로 그리는 거리 (m)
    cullFactor: 4,           // 실제로 그리는 거리 = 가시거리 × 이 값 (그 너머는 안개에 99.99% 묻힘)
    cullMin: 8,              // 그리는 거리 최소값
    distantScenery: false,   // 원경 산맥·유적, 하늘 셰이더 (시야가 넓을 때만 의미 있음)
  },

  lighting: {
    sunColor: '#ffcf96',
    sunIntensity: 2.2,       // 폭풍이 약할 때
    sunIntensityStorm: 1.5,  // 폭풍이 강할 때
    sunPosition: { x: -70, y: 38, z: -100 },
    hemiSky: '#ffd9a8',
    hemiGround: '#8a5a38',
    hemiIntensity: 1.25,
    shadows: false,          // 실시간 그림자 (시야가 좁아 효과가 거의 없고 비용이 큼)
    shadowMapSize: 1024,
    shadowRange: 16,
    shadowBias: -0.0005,
    shadowNormalBias: 0.03,
  },

  /* ---------- 대기: 안개 · 모래폭풍 ----------
   * 가시거리(visibility) = 사물이 안개에 절반쯤 묻히는 거리 (m)
   * 탐험 중에는 2m 안팎, 연출 중에는 바람이 잠시 잦아들어 장면이 보이도록 넓어짐 */
  atmosphere: {
    skyTop: '#8fb0c6',
    skyHorizon: '#ecc89a',
    fogClear: '#e29a4e',     // 폭풍이 약할 때 (주황)
    fogStorm: '#cf7a32',     // 폭풍이 강할 때 (짙은 주황)
    visibility: {
      exploreMax: 2.8,       // 탐험 중 가장 트였을 때
      exploreMin: 1.6,       // 탐험 중 가장 짙을 때
      interact: 6.5,         // 오브젝트 연출 (캐릭터와 오브젝트가 보여야 함)
      portal: 18,            // 포털 문양 연출 (먼 포털이 보여야 함)
      smoothing: 1.2,        // 가시거리 변화 속도 (클수록 빠름)
    },
    storm: {
      min: 0.3,
      max: 1.0,
      periods: [37, 17, 9],  // 강도 변화 주기 (초)
      weights: [0.55, 0.3, 0.15],
    },
    sand: {
      count: 700,
      area: 12,              // 카메라 주변 이 범위에서 순환 (가까이에서만 보이므로 좁게)
      height: 4,
      size: 0.03,
      opacity: 0.8,
      wind: { x: 3.2, z: 1.1 },
      cameraClearance: 0.45,
    },
    dustVeils: { count: 3, width: 80, height: 24, distance: 34, opacity: 0.32 }, // distantScenery일 때만
  },

  /* ---------- 색상 팔레트 ---------- */
  palette: {
    sand: ['#d99548', '#c77c3e', '#e5b66c'],
    sandShadow: ['#a96838', '#7c5038'],
    sandMound: '#d39a5a',
    stone: '#bfa07f',
    stoneDark: '#8c7158',
    stoneLight: '#d7bf9d',
    rock: '#946a4c',
    ruinFar: '#b78a62',
    mountain: '#b0805a',
    glyphOff: '#4a3a2e',     // 꺼진 문양 (어두운 석재)
    glyphOn: '#ffa63d',      // 켜진 문양 (따뜻한 황금빛)
    glyphPlate: '#a8916f',   // 문양이 새겨진 석판
    cloth: '#9a4430',
    clothDark: '#6a2f22',
    body: '#4a3a30',
    skin: '#d8b48c',
    wood: '#6e4c30',
    woodLight: '#8f6a45',
    brass: '#c09a52',
    metalDark: '#3c3a38',
    plastic: '#2d2b2a',
    plasticLight: '#4a4643',
    earphone: '#ece6da',
    knit: '#b07a2e',
    knitDark: '#8a5c20',
    canvas: '#e8dcc4',
    canvasStripe: '#a8482e',
    ledOff: '#3a1f1a',
    ledOn: '#ff6a3d',
    ledGreen: '#7dff9a',
    glass: '#9fb7b8',
    screenOff: '#1c1f1e',
    needleRed: '#c23a2a',
    needleWhite: '#efe7d8',
  },

  /* 재질 표 — flat: 각진 셰이딩 / smooth: 부드러운 셰이딩
   * 모든 재질은 무광 중심 (roughness 높음, metalness 낮음) */
  materials: {
    stone:       { roughness: 0.95, metalness: 0, flat: false },
    stoneDark:   { roughness: 0.97, metalness: 0, flat: true },
    stoneLight:  { roughness: 0.92, metalness: 0, flat: false },
    rock:        { roughness: 1.0, metalness: 0, flat: true },
    ruinFar:     { roughness: 1.0, metalness: 0, flat: false },
    mountain:    { roughness: 1.0, metalness: 0, flat: true },
    sandMound:   { roughness: 1.0, metalness: 0, flat: false },
    glyphOff:    { roughness: 0.9, metalness: 0, flat: true },
    glyphPlate:  { roughness: 0.95, metalness: 0, flat: true },
    cloth:       { roughness: 1.0, metalness: 0, flat: false },
    clothDark:   { roughness: 1.0, metalness: 0, flat: false },
    body:        { roughness: 1.0, metalness: 0, flat: false },
    skin:        { roughness: 0.9, metalness: 0, flat: true },
    wood:        { roughness: 0.9, metalness: 0, flat: true },
    woodLight:   { roughness: 0.88, metalness: 0, flat: true },
    brass:       { roughness: 0.55, metalness: 0.15, flat: false },
    metalDark:   { roughness: 0.7, metalness: 0.12, flat: true },
    plastic:     { roughness: 0.75, metalness: 0, flat: true },
    plasticLight:{ roughness: 0.75, metalness: 0, flat: true },
    earphone:    { roughness: 0.6, metalness: 0, flat: false },
    knit:        { roughness: 1.0, metalness: 0, flat: true },
    knitDark:    { roughness: 1.0, metalness: 0, flat: true },
    canvas:      { roughness: 0.95, metalness: 0, flat: true },
    canvasStripe:{ roughness: 0.95, metalness: 0, flat: true },
    ledOff:      { roughness: 0.5, metalness: 0, flat: false },
    screenOff:   { roughness: 0.35, metalness: 0, flat: true },
    glass:       { roughness: 0.2, metalness: 0, flat: true, transparent: true, opacity: 0.35 },
    needleRed:   { roughness: 0.7, metalness: 0, flat: true },
    needleWhite: { roughness: 0.7, metalness: 0, flat: true },
  },

  /* ---------- 플레이어 ---------- */
  player: {
    spawn: { x: 0, z: 17 },
    spawnYaw: 0,             // 0 = -Z 방향(포털 쪽)을 바라봄
    walkSpeed: 2.4,
    sprintSpeed: 4.6,
    acceleration: 10,
    turnSpeed: 10,
    radius: 0.35,
    stepSmoothing: 14,
    strideLength: 1.4,
  },

  /* ---------- 카메라 ---------- */
  camera: {
    fov: 70,
    eyeHeight: 1.6,          // 1인칭 눈높이
    headBob: 0.025,          // 걸을 때 시점 흔들림
    sensitivity: 0.0021,
    minPitch: -1.35,
    maxPitch: 1.35,
    collisionPadding: 0.3,   // 시네마틱 카메라가 유적에 박히지 않도록
    groundClearance: 0.35,
    avatarShowDistance: 0.55,// 카메라가 눈에서 이만큼 멀어지면 캐릭터 표시
    transition: 1.3,         // 기본 시네마틱 전환 시간 (초)
    returnDuration: 1.1,     // 1인칭 복귀 시간 (초)
    // 3인칭 추적 카메라 (낙원에서 사용) — 캐릭터 뒤에서 따라감, 마우스로 회전
    follow: { distance: 3.6, pivotHeight: 1.45, minPitch: -0.5, maxPitch: 0.9, defaultPitch: 0.22, smoothing: 10 },
  },

  /* ---------- 나침반 (C 키로 꺼내기/넣기) ----------
   * order: 안내 순서. 완료된 대상은 건너뛰고, 순서상 가장 앞선 미완료 대상을 가리킵니다.
   *        'portal'은 다섯 오브젝트를 모두 완료했을 때만 대상이 됩니다. */
  compass: {
    order: ['cube', 'speaker', 'dvd', 'glider', 'beanie', 'portal'],
    raiseDuration: 0.55,     // 꺼내는 시간 (초)
    lidDuration: 0.4,
    lowerDuration: 0.45,
    needleStiffness: 26,     // 바늘이 목표를 따라가는 힘
    needleDamping: 5.5,      // 바늘 흔들림 감쇠
    // 1인칭 화면 안 위치 (카메라 기준, m) / 기울기 (도)
    holdPos: { x: -0.07, y: -0.165, z: -0.42 },
    holdTilt: 58,
    lowPos: { x: -0.02, y: -0.62, z: -0.38 },
  },

  /* ---------- 상호작용 ---------- */
  interaction: {
    keys: { interact: 'KeyE', compass: 'KeyC', music: 'KeyM' },
    radius: 2.4,             // 기본 상호작용 거리
    facingDot: 0.45,         // 바라보는 방향과 대상 방향의 일치 정도 (1 = 정면)
  },

  /* 오브젝트 배치 — rotY: 오브젝트 정면(+Z)의 방향(도)
   * countsTowardPortal은 interaction 파일에서 고정 (핵심 5개만 true) */
  objects: {
    cube:    { x: -9.5, z: -2,   rotY: 90,  radius: 2.3, prompt: '큐브 맞추기' },
    speaker: { x: 10.4, z: 1.2,  rotY: -90, radius: 2.3, prompt: '스피커 켜기', promptOff: '스피커 끄기' },
    dvd:     { x: -16,  z: 11,   rotY: 125, radius: 2.4, prompt: 'DVD 재생하기', promptOff: 'DVD 끄기' },
    glider:  { x: 19,   z: 3,    rotY: -70, radius: 3.4, prompt: '글라이더 시동 걸기', promptOff: '시동 끄기' },
    beanie:  { x: -7,   z: -14,  rotY: 30,  radius: 2.2, prompt: '비니 쓰기' },
  },

  cube: {
    size: 0.42,              // 큐브 한 변 (m)
    scrambleMoves: 4,        // 섞는 횟수 (적을수록 쉬움)
    turnDuration: 0.28,      // 한 면 회전 시간 (초)
    // 관찰 카메라 (고정) — 큐브 정면에서 이 거리·높이에 멈춤
    inspectDistance: 1.0,
    inspectHeight: 0.32,
    dragSensitivity: 0.008,  // 마우스 드래그 → 큐브 전체 회전 (라디안/px)
    // 면 키 → 축/색 (색은 고정된 가운데 칸 기준)
    faces: {
      U: { axis: 'y', sign: 1,  color: '#ece6d6', name: '흰색' },
      D: { axis: 'y', sign: -1, color: '#e2b93b', name: '노랑' },
      R: { axis: 'x', sign: 1,  color: '#b8432f', name: '빨강' },
      L: { axis: 'x', sign: -1, color: '#d9792f', name: '주황' },
      F: { axis: 'z', sign: 1,  color: '#4f8a52', name: '초록' },
      B: { axis: 'z', sign: -1, color: '#3f6a9a', name: '파랑' },
    },
  },

  /* ---------- 포털 ---------- */
  portal: {
    center: { x: 0, z: -8 },
    platformRadius: 6,
    platformTop: 0.35,
    stepRadius: 6.8,
    stepTop: 0.17,
    ringRadius: 3.2,
    ringTube: 0.42,
    glyphs: ['cube', 'speaker', 'dvd', 'glider', 'beanie'],
    glyphAngles: [150, 115, 90, 65, 30], // 고리 위 문양 위치 (도)
    glyphSize: 0.78,         // 문양 석판 한 변 (m)
    glyphGlow: 1.15,         // 켜진 뒤 유지되는 발광 세기 (높으면 톤매핑 때문에 흰색에 가까워짐)
    shot: { distance: 12.5, height: 3.4, lookHeight: 2.9 },
    glyphShot: { distance: 4.4, below: 0.6 }, // 문양 클로즈업
    // 진입 판정: 고리 중심에서 좌우 halfWidth, 앞뒤 depth 안에 들어오면 낙원으로
    entry: { halfWidth: 1.8, depth: 0.45 },
  },

  /* ---------- 오디오 ----------
   * files에 경로를 넣으면 해당 파일을 사용하고, 비워 두면 브라우저에서 합성한 임시 사운드를 사용합니다.
   * 예) music: 'assets/audio/earphone-music.mp3' */
  audio: {
    volumes: { music: 0.25, ambience: 0.42, effects: 0.8 }, // ambience 이전 0.55
    files: { music: '', speaker: '', dvd: '', ambience: '', paradise: '' },
    duck: { near: 4, far: 14, amount: 0.35 }, // 스피커·TV 근처에서 이어폰 음악을 줄임
    // 사막 바람 (합성) — 폭풍 강도 0~1에 따라 min → min+range
    wind: {
      level: 0.7,            // 바람 전체 음량
      lowMin: 0.16, lowRange: 0.3,     // 낮은 바람 소리 (이전 0.18 + 0.55)
      hissMin: 0.004, hissRange: 0.022, // 모래 쓸리는 고음 (이전 0.02 + 0.12)
      hissFreq: 1700,        // 고음 대역 중심 (이전 2800Hz 이상 전체 → 좁은 대역으로)
      lowpass: 2600,         // 바람 전체의 날카로운 고주파 차단
      smoothing: 1.4,        // 강도 변화 보간 시간 (초)
    },
    crossfade: 3.0,          // 사막 → 낙원 환경음 전환 (초)
  },

  /* ---------- 낙원 (포털 너머) ---------- */
  paradise: {
    seed: 11,
    cameraMode: 'third',     // 'third'(캐릭터 뒤 3인칭) | 'first'
    spawn: { x: 0, z: 6 },
    spawnYaw: 0,             // 0 = -Z(개울·숲 쪽)
    playRadius: 46,
    terrainSize: 260,
    terrainSegments: 120,
    hillAmp: 1.4,            // 걷는 곳의 완만한 굴곡
    rimAmp: 22,              // 바깥 언덕 높이
    rimStart: 40,
    rimEnd: 115,
    // 개울 (제어점, 위에서 본 x,z)
    stream: { points: [[-120, -40], [-60, -28], [-30, -14], [-8, -16], [14, -6], [36, -12], [70, 4], [130, 10]], width: 2.6, depth: 0.85, water: 0.42 },
    // 오솔길
    paths: [
      { points: [[0, 9], [-2, 2], [-6, -6], [-7, -13], [-12, -22], [-15, -34]], width: 1.4 },
      { points: [[-2, 2], [8, -1], [16, 1], [24, 9], [30, 18]], width: 1.2 },
    ],
    trees: { near: 80, nearRadius: 44, far: 380, farMin: 46, farMax: 120 },
    grass: 2600,
    bushes: 110,
    flowers: 700,
    rocks: 38,
    branches: 22,
    hills: 26,
    pollen: 140,
    colors: {
      grass: ['#6F9D57', '#9DBB78', '#C4D69A'],
      grassDark: '#557f45',
      path: '#E7DBA6',
      water: '#7DBAC0',
      waterDeep: '#5f9ea8',
      bank: '#7b8f55',
      trunk: '#6b4e36',
      leaves: ['#5f8f4c', '#6F9D57', '#86ad63', '#9DBB78'],
      pine: ['#4f7c4a', '#5a8a55'],
      far: '#6d9a74',
      rock: ['#a6a99b', '#bdb6a2', '#959b8e'],
      flowers: ['#f6f2e6', '#f2d06b', '#eaa3b6', '#b9a8e2'],
      hill: ['#7fa77a', '#93b98a', '#7aa08c'],
      skyTop: '#9cc7e0',
      skyHorizon: '#e9efdf',
      fog: '#dde8dc',
    },
    lighting: { sun: '#fff0d4', sunIntensity: 1.5, sunPosition: { x: 60, y: 70, z: 40 }, hemiSky: '#cfe6f0', hemiGround: '#5d7a40', hemiIntensity: 0.8 },
    visibility: 110,         // 안개가 절반이 되는 거리 (m) — 아주 옅은 안개
    render: { pixelRatio: 1.0, screenBlur: 0.25, cameraFar: 420 },
    tour: { duration: 8.5, radius: 6.5, sweep: 200 }, // 도착 연출 (초 / m / 도)
    fadeOut: 1.5,            // 화면을 밝게 덮는 시간
    fadeIn: 2.6,             // 밝은 화면이 걷히는 시간
  },

  /* ---------- 유적 배치 (플레이 영역, 충돌 있음) ---------- */
  ruins: [
    { type: 'pillar', x: -13, z: -12, h: 6.6, r: 0.6 },
    { type: 'pillar', x: -13, z: -5, h: 3.6, r: 0.6, broken: true },
    { type: 'pillar', x: -13, z: 2, h: 6.6, r: 0.6 },
    { type: 'pillar', x: -13, z: 9, h: 1.9, r: 0.6, broken: true },
    { type: 'pillar', x: -13, z: 16, h: 5.4, r: 0.6, tilt: 6 },
    { type: 'pillar', x: 13, z: -11, h: 5.2, r: 0.6, broken: true },
    { type: 'pillar', x: 13, z: -3, h: 6.6, r: 0.6 },
    { type: 'pillar', x: 13, z: 5, h: 2.8, r: 0.6, broken: true },
    { type: 'pillar', x: 13, z: 13, h: 6.2, r: 0.6, tilt: -4 },
    { type: 'fallen', x: -8.5, z: 6, len: 4.6, r: 0.55, rotY: 28 },
    { type: 'fallen', x: 9, z: 9.5, len: 3.2, r: 0.55, rotY: -62 },
    { type: 'wall', x: 8, z: -19, len: 7, h: 2.6, rotY: 12 },
    { type: 'wall', x: -10, z: -21, len: 5.5, h: 1.8, rotY: -18 },
    { type: 'wall', x: 21, z: 11, len: 4.5, h: 1.4, rotY: 72 },
    { type: 'arch', x: 18, z: -16, w: 3.6, h: 4.6, rotY: -38 },
    { type: 'arch', x: -19, z: 15, w: 3.2, h: 4.0, rotY: 50, broken: true },
    { type: 'block', x: 5, z: 7, w: 1.2, h: 0.9, d: 1.0, rotY: 25 },
    { type: 'block', x: -4.5, z: -17, w: 1.6, h: 1.0, d: 1.2, rotY: -10, tilt: 8 },
    { type: 'block', x: 10, z: 17, w: 1.0, h: 0.7, d: 1.0, rotY: 40 },
    { type: 'block', x: -20, z: -4, w: 1.4, h: 1.2, d: 1.4, rotY: 15 },
    { type: 'block', x: 3, z: 22, w: 0.9, h: 0.6, d: 1.3, rotY: -30, tilt: 10 },
    { type: 'rock', x: 22, z: -5, s: 3.0, rotY: 20 },
    { type: 'rock', x: -24, z: 6, s: 2.6, rotY: 80 },
    { type: 'rock', x: 7, z: 25, s: 2.0, rotY: 140 },
    { type: 'rock', x: -7, z: 26, s: 2.8, rotY: 10 },
    { type: 'rock', x: 25, z: 19, s: 3.4, rotY: 60 },
    { type: 'rock', x: -25, z: -18, s: 3.0, rotY: 200 },
  ],

  /* 작은 암석·파편 (InstancedMesh, 충돌 없음) */
  debris: { count: 140, minDist: 3, maxDist: 36, seed: 21 },

  /* ---------- 원경 (충돌 없음, 안개로 흐려짐) ---------- */
  distant: {
    ruins: [
      { type: 'pillar', angle: 20, dist: 120, h: 26, r: 2.4 },
      { type: 'pillar', angle: 27, dist: 128, h: 18, r: 2.4, broken: true },
      { type: 'arch', angle: -35, dist: 150, w: 18, h: 28 },
      { type: 'pillar', angle: 160, dist: 110, h: 22, r: 2.0, broken: true },
      { type: 'pillar', angle: 210, dist: 140, h: 30, r: 2.6 },
      { type: 'arch', angle: 95, dist: 170, w: 22, h: 34, broken: true },
      { type: 'wall', angle: 250, dist: 125, len: 40, h: 9 },
      { type: 'pillar', angle: 300, dist: 155, h: 40, r: 1.8 },
    ],
    mountains: { count: 40, minDist: 330, maxDist: 440, minHeight: 45, maxHeight: 110 },
  },
};
