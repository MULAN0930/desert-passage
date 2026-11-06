/* ==========================================================================
 *  Desert Passage — interaction-manager.js
 *  · 근처 오브젝트 감지 + 안내 문구 ("E · 큐브 살펴보기")
 *  · E(오브젝트), C(나침반 꺼내기/넣기) 키 처리
 *  · 나침반은 컷신이 아니라 들고 다니는 도구이므로 run()을 거치지 않고 toggle()만 호출
 *
 *  모든 기억 오브젝트의 공통 순서 (run)
 *    1. 접근 → 2. 안내 → 3. 3인칭: 손 뻗기(03) → 4. 1인칭 전환 → 5. 오브젝트별 인터랙션
 *    → 6. 완료 → 7~8. 회상 텍스트 (사용자가 끝까지 확인) → 9. 인터랙션 종료
 *    → 10. 포털 문양 점등 → 11. 3인칭 탐험 시점 복귀 → 12. 나침반이 다음 목표를 가리킴
 *  · 기억의 '완료'는 회상 텍스트를 닫은 뒤에만 기록 (game-state가 중복 차단)
 *  · 실행 중에는 다른 인터랙션·나침반·이동이 겹치지 않음 (busy + 이동 잠금)
 *
 *  오브젝트 등록 형식 (DP.Interaction.register)
 *   { id, el, prompt(): string, radius, enabled(): bool, focus(): Vector3,
 *     interact(ctx): Promise<{ completed: boolean }>,
 *     countsTowardPortal: bool, reach?: false(손 뻗기 생략), key?: 'compass' }
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

(function () {
  const CFG = DP.CONFIG;
  const S = DP.STATES;
  const U = DP.Util;

  AFRAME.registerSystem('interaction-manager', {
    init() {
      this.items = [];
      this.keyItems = {};
      this.busy = false;
      this.candidate = null;
      this.promptEl = null;
      this.tmp = new THREE.Vector3();
      this.onKey = this.onKey.bind(this);
      window.addEventListener('keydown', this.onKey);
      DP.Interaction = this;
    },

    register(item) {
      if (item.key) this.keyItems[item.key] = item;
      else this.items.push(item);
    },

    context() {
      const scene = this.el;
      const player = document.getElementById('player');
      const avatarEl = document.getElementById('avatar');
      return {
        scene,
        gs: scene.systems['game-state'],
        camera: document.getElementById('camera').components['camera-director'],
        player: player.components['player-controller'],
        playerEl: player,
        avatar: avatarEl.components['wanderer-avatar'],
        character: DP.Character,
        avatarEl,
        audio: DP.Audio,
        cine: DP.Cinematic,
        text: DP.NARRATIVE,
        U,
      };
    },

    /* ---------------- 대상 찾기 ---------------- */
    findCandidate() {
      const gs = this.el.systems['game-state'];
      if (!gs.canMove()) return null;
      if (gs.is(S.PARADISE)) return null; // 낙원에는 추가 인터랙션 없음
      const player = document.getElementById('player').object3D.position;
      const cam = document.getElementById('camera').components['camera-director'];
      const yaw = cam ? cam.yaw : 0;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      let best = null;
      let bestScore = Infinity;
      for (const it of this.items) {
        if (it.enabled && !it.enabled()) continue;
        const f = it.focus(this.tmp);
        const dx = f.x - player.x;
        const dz = f.z - player.z;
        const d = Math.hypot(dx, dz);
        if (d > (it.radius || CFG.interaction.radius)) continue;
        const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
        if (dot < CFG.interaction.facingDot && d > 1.1) continue;
        const score = d * (1.5 - dot);
        if (score < bestScore) {
          bestScore = score;
          best = it;
        }
      }
      return best;
    },

    tick() {
      if (!this.promptEl) this.promptEl = document.getElementById('prompt');
      if (!this.promptEl) return;
      const overlayOpen = !document.getElementById('start-overlay').classList.contains('hidden');
      const c = this.busy || overlayOpen ? null : this.findCandidate();
      this.candidate = c;
      if (c) {
        this.promptEl.innerHTML = `<kbd>E</kbd> ${c.prompt()}`;
        this.promptEl.classList.add('show');
      } else {
        this.promptEl.classList.remove('show');
      }
    },

    /* ---------------- 키 ---------------- */
    onKey(e) {
      if (e.repeat) return;
      if (!document.getElementById('start-overlay').classList.contains('hidden')) return; // 시작 화면에서는 무시
      if (DP.Cinematic && DP.Cinematic.isWaiting()) return; // 자막을 넘기는 중
      const K = CFG.interaction.keys;
      const gs = this.el.systems['game-state'];
      if (e.code === K.interact && !this.busy) {
        const target = this.candidate || this.findCandidate(); // 안내가 갱신되기 직전에 눌러도 동작
        if (target) this.run(target);
      } else if (e.code === K.compass && !this.busy && gs.canMove() && this.keyItems.compass) {
        this.keyItems.compass.toggle(this.context());
      }
    },

    /** 1인칭 인터랙션 안내 (화면 위쪽 작은 알약) */
    hint(text) {
      let el = document.getElementById('fp-hint');
      if (!el) {
        el = document.createElement('div');
        el.id = 'fp-hint';
        document.body.appendChild(el);
      }
      if (text) el.textContent = text;
      el.classList.toggle('show', !!text);
    },

    /* ---------------- 공통 실행 순서 ---------------- */
    async run(item) {
      if (this.busy) return;
      this.busy = true;
      const ctx = this.context();
      const { gs, camera, player, scene } = ctx;
      const firstTime = item.countsTowardPortal && !gs.data.completed_objects[item.id];
      gs.setState(S.INTERACTING);
      gs.lockMovement('interaction');
      DP.Cinematic.letterbox(true);
      DP.Audio.duckDesert(true);

      let result = { completed: false };
      try {
        // 3. 3인칭: 대상을 향해 돌아서서 손을 뻗음 (애니메이션 03)
        const f = item.focus(new THREE.Vector3());
        await player.faceTowards(f.x, f.z, 0.3);
        if (item.reach !== false) {
          const shot = camera.sideShot({ target: f, distance: 2.7, height: 1.75, lookHeight: Math.max(0.6, f.y - player.el.object3D.position.y) * 0.6 + 0.55 });
          const move = camera.moveTo({ ...shot, duration: 1.1 });
          await Promise.all([move, DP.Character.action('OBJECT_REACH', { maxSec: 2.4 })]);
        }
        // 4~6. 오브젝트별 인터랙션 (1인칭 전환은 각 오브젝트가 camera.firstPersonAt으로)
        result = (await item.interact(ctx)) || result;
      } catch (err) {
        console.error(`[interaction] ${item.id} 실행 중 오류`, err);
      }
      this.hint(null);
      DP.Character.release();

      // 7~10. 회상 → (이때 처음으로) 완료 기록 → 문양 점등
      if (result.completed && firstTime) {
        const mem = DP.NARRATIVE.memories[item.id];
        if (mem) {
          try {
            await DP.Cinematic.memory(mem);
          } catch (err) {
            console.error('[cinematic] 회상 표시 오류', err);
          }
        }
        if (item.afterMemory) await item.afterMemory(ctx);
        scene.emit('interaction-completed', { objectId: item.id });
        const portal = scene.systems['portal-manager'];
        for (const id of gs.takeNewSymbols()) {
          try {
            await portal.playSymbol(id);
          } catch (err) {
            console.error('[portal] 문양 연출 오류', err);
          }
        }
      }

      // 11. 3인칭 탐험 시점 복귀
      camera.hideAvatar = false;
      await camera.toBase(CFG.camera.returnDuration, player.facing);
      gs.unlockMovement('interaction');
      gs.setState(gs.baseState());
      DP.Cinematic.letterbox(false);
      DP.Audio.duckDesert(false);
      this.busy = false;
      if (item.after) item.after(ctx);
      // 12. 다음 목표를 향해 걸을 때의 짧은 독백 (한 번)
      if (result.completed && firstTime && DP.NARRATIVE.travel[item.id]) {
        U.wait(1.2).then(() => DP.Cinematic.caption(DP.NARRATIVE.travel[item.id]));
      }
    },
  });
})();
