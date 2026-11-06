/* ==========================================================================
 *  Desert Passage — main.js
 *  시작 순서
 *   장면 로딩 → 월드 생성 → 오브젝트 배치 → 캐릭터(GLB)·나침반 장착
 *   → GLB 모델 미리 내려받기 (시작 버튼에 진행도 표시)
 *   → INTRO: 캐릭터 정면 시점 + 시작 화면
 *   → 시작 클릭: 오디오 시작(자동재생 정책), 포인터 잠금
 *   → 프롤로그 독백 (이동 잠금, 카메라가 캐릭터 뒤로) → 나침반 안내 → EXPLORATION
 * ========================================================================== */
'use strict';

(function () {
  const S = DP.STATES;
  const CFG = DP.CONFIG;

  function boot(scene) {
    const gameState = scene.systems['game-state'];
    DP.World.build(scene);

    // 핵심 오브젝트 5개 배치 (각 파일의 '<id>-object' 컴포넌트)
    const container = document.getElementById('interactables');
    for (const id of Object.keys(CFG.objects)) {
      const el = document.createElement('a-entity');
      el.id = `object-${id}`;
      el.setAttribute(`${id}-object`, '');
      container.appendChild(el);
    }

    const playerEl = document.getElementById('player');
    const avatarEl = document.getElementById('avatar');
    const cameraEl = document.getElementById('camera');
    const startBtn = document.getElementById('start-button');
    const overlay = document.getElementById('start-overlay');
    const resumeHint = document.getElementById('resume-hint');

    // 캐릭터 (Meshy GLB, 없으면 도형 캐릭터) + 나침반
    avatarEl.setAttribute('character-model', '');
    avatarEl.setAttribute('compass-gear', '');

    // GLB 모델 미리 받기 → 끝나면 시작 버튼 활성화
    let sceneReady = false;
    let modelsReady = false;
    const enableStart = () => {
      if (!sceneReady || !modelsReady) return;
      startBtn.disabled = false;
      startBtn.textContent = '시작';
    };
    DP.Kit.preloadModels((done, total) => {
      startBtn.textContent = `불러오는 중… ${done}/${total}`;
    }).then(() => {
      modelsReady = true;
      enableStart();
    });

    requestAnimationFrame(() => {
      const pc = playerEl.components['player-controller'];
      pc.spawn();
      const cam = cameraEl.components['camera-director'];
      cam.refreshBlockers();
      // 인트로: 캐릭터 정면 3/4 시점
      const p = playerEl.object3D.position;
      const fwd = new THREE.Vector3(-Math.sin(pc.facing), 0, -Math.cos(pc.facing));
      const right = new THREE.Vector3(Math.cos(pc.facing), 0, -Math.sin(pc.facing));
      const camPos = p.clone().addScaledVector(fwd, 3.1).addScaledVector(right, -1.2);
      camPos.y += 1.75;
      const look = p.clone();
      look.y += 1.3;
      cam.setShot(camPos, look);
      gameState.setState(S.INTRO);
      sceneReady = true;
      enableStart();
    });

    const lockPointer = () => {
      const canvas = scene.canvas;
      if (!canvas || !canvas.requestPointerLock) return;
      try {
        const r = canvas.requestPointerLock();
        if (r && r.catch) r.catch(() => {});
      } catch (err) {
        /* 포인터 잠금 불가: 드래그로 시점 회전 */
      }
    };

    startBtn.addEventListener('click', () => {
      DP.Audio.init();
      DP.Audio.startAmbience();
      overlay.classList.add('hidden');
      document.body.classList.add('playing');
      lockPointer();
      prologue(scene, gameState);
    });

    scene.canvas.addEventListener('click', () => {
      if (!overlay.classList.contains('hidden')) return;
      if (document.pointerLockElement !== scene.canvas) lockPointer();
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === scene.canvas;
      resumeHint.classList.toggle('show', !locked && overlay.classList.contains('hidden'));
    });

    // 오디오: 청취자 위치·바람·음악 덕킹
    const audioLoop = () => {
      DP.Audio.update(cameraEl.object3D);
      requestAnimationFrame(audioLoop);
    };
    requestAnimationFrame(audioLoop);

    setupDebug(scene, gameState, playerEl);
  }

  /* ---------- 프롤로그: 독백이 끝나면 걸을 수 있음 ---------- */
  async function prologue(scene, gameState) {
    const cam = document.getElementById('camera').components['camera-director'];
    const pc = document.getElementById('player').components['player-controller'];
    gameState.lockMovement('prologue');
    DP.Cinematic.letterbox(true);
    await DP.Util.wait(1.2);
    // 독백과 함께 카메라가 천천히 캐릭터 뒤로 돌아감
    const lines = DP.Cinematic.monologue(DP.NARRATIVE.prologue);
    await DP.Util.wait(2.5);
    const back = cam.toBase(4.5, pc.facing);
    await Promise.all([lines, back]);
    DP.Cinematic.letterbox(false);
    gameState.unlockMovement('prologue');
    gameState.setState(S.EXPLORATION);
    await DP.Util.wait(0.8);
    DP.Cinematic.caption(DP.NARRATIVE.compassHint, 5);
  }

  /* ---------- 디버그 패널 ( ` 키 ) ---------- */
  function setupDebug(scene, gameState, playerEl) {
    const panel = document.getElementById('debug-panel');
    let visible = CFG.debug;
    panel.classList.toggle('show', visible);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') {
        visible = !visible;
        panel.classList.toggle('show', visible);
      }
    });
    let frames = 0;
    let last = performance.now();
    const loop = (now) => {
      frames++;
      if (now - last >= 500) {
        const fps = Math.round((frames * 1000) / (now - last));
        frames = 0;
        last = now;
        if (visible) {
          const p = playerEl.object3D.position;
          const pc = playerEl.components['player-controller'];
          const info = scene.renderer.info.render;
          const d = gameState.data;
          const done = DP.CORE_OBJECTS.map((k) => (d.completed_objects[k] ? '●' : '○') + k).join(' ');
          panel.textContent =
            `FPS        ${fps}\n` +
            `State      ${gameState.state}${gameState.locks.size ? ' (locked)' : ''}\n` +
            `Env        ${document.body.classList.contains('paradise') ? 'paradise' : 'desert'}\n` +
            `Position   ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}\n` +
            `Speed      ${pc ? pc.speed.toFixed(2) : '-'} m/s\n` +
            `Storm      ${DP.storm.intensity.toFixed(2)}  visibility ${DP.storm.visibility.toFixed(1)} m\n` +
            `Symbols    ${d.activated_symbols}/5  ${done}\n` +
            `Character  ${DP.Character && DP.Character.ready ? 'GLB' : 'primitive'}  beanie ${d.beanie_worn ? 'on' : 'off'}\n` +
            `DrawCalls  ${info.calls}\n` +
            `Triangles  ${info.triangles}`;
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const scene = document.querySelector('a-scene');
    if (scene.hasLoaded) boot(scene);
    else scene.addEventListener('loaded', () => boot(scene), { once: true });
  });
})();
