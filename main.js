/* ==========================================================================
 *  Desert Passage — main.js
 *  시작 순서
 *   장면 로딩 → 월드 생성 → 오브젝트 배치 → 장비(이어폰·나침반) 장착
 *   → INTRO: 3인칭으로 캐릭터를 비춤 + 시작 화면
 *   → 시작 클릭: 오디오 시작(자동재생 정책), 포인터 잠금
 *   → E: 이어폰 착용 → 1인칭 전환 → EXPLORATION
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

    // 캐릭터 장비
    avatarEl.setAttribute('earphones-gear', '');
    avatarEl.setAttribute('compass-gear', '');

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
      startBtn.disabled = false;
      startBtn.textContent = '시작';
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
            `Earphones  ${d.earphones_worn ? 'on' : 'off'}  music ${d.music_enabled ? 'on' : 'off'}\n` +
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
