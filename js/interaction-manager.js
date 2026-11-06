/* ==========================================================================
 *  Desert Passage — interaction-manager.js
 *  · 근처 오브젝트 감지 + 안내 문구 ("E · 큐브 맞추기")
 *  · E(오브젝트), C(나침반 꺼내기/넣기), M(이어폰 음악) 키 처리
 *  · 나침반은 컷신이 아니라 들고 다니는 도구이므로 run()을 거치지 않고 toggle()만 호출
 *  · 모든 인터랙션을 같은 순서로 실행:
 *      이동 잠금 → 캐릭터가 대상을 향함 → 오브젝트 고유 연출(3인칭)
 *      → 완료 이벤트 → (처음 완료면) 포털 문양 연출 → 1인칭 복귀 → 잠금 해제
 *  · 실행 중에는 다른 인터랙션·연출이 겹치지 않음 (busy)
 *
 *  오브젝트 등록 형식 (DP.Interaction.register)
 *   { id, el, prompt(): string, radius, enabled(): bool, focus(): Vector3,
 *     interact(ctx): Promise<{ completed: boolean }>,
 *     countsTowardPortal: bool, introOnly?: bool, key?: 'compass' }
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
        avatarEl,
        audio: DP.Audio,
        U,
      };
    },

    /* ---------------- 대상 찾기 ---------------- */
    findCandidate() {
      const gs = this.el.systems['game-state'];
      const intro = gs.is(S.INTRO);
      if (!intro && !gs.canMove()) return null;
      if (gs.is(S.PARADISE)) return null; // 낙원에는 추가 인터랙션 없음
      const player = document.getElementById('player').object3D.position;
      const cam = document.getElementById('camera').components['camera-director'];
      const yaw = cam ? cam.yaw : 0;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      let best = null;
      let bestScore = Infinity;
      for (const it of this.items) {
        if (!!it.introOnly !== intro) continue;
        if (it.enabled && !it.enabled()) continue;
        if (intro) return it; // 인트로에서는 이어폰만
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
      const K = CFG.interaction.keys;
      const gs = this.el.systems['game-state'];
      if (e.code === K.interact && !this.busy) {
        const target = this.candidate || this.findCandidate(); // 안내가 갱신되기 직전에 눌러도 동작
        if (target) this.run(target);
      } else if (e.code === K.compass && !this.busy && gs.canMove() && this.keyItems.compass) {
        this.keyItems.compass.toggle(this.context());
      } else if (e.code === K.music) {
        if (!gs.data.earphones_worn) return;
        gs.data.music_enabled = !gs.data.music_enabled;
        DP.Audio.setMusicEnabled(gs.data.music_enabled);
        U.toast(gs.data.music_enabled ? '♪ 음악 켬' : '음악 끔');
      }
    },

    /* ---------------- 공통 실행 순서 ---------------- */
    async run(item) {
      if (this.busy) return;
      this.busy = true;
      const ctx = this.context();
      const { gs, camera, player, avatar, scene } = ctx;
      const intro = gs.is(S.INTRO);
      if (!intro) gs.setState(S.INTERACTING);
      gs.lockMovement('interaction');
      document.body.classList.add('cinematic');

      let result = { completed: false };
      try {
        if (item.focus && item.faceTarget !== false) {
          const f = item.focus(new THREE.Vector3());
          await player.faceTowards(f.x, f.z, 0.3);
        }
        result = (await item.interact(ctx)) || result;
      } catch (err) {
        console.error(`[interaction] ${item.id} 실행 중 오류`, err);
      }

      // 완료 → 중앙 상태가 중복 여부 판단 → 새로 켜질 문양만 연출
      if (result.completed && item.countsTowardPortal) {
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

      avatar.setPose('rest', 0.5);
      await camera.toBase(CFG.camera.returnDuration, player.facing);
      gs.unlockMovement('interaction');
      gs.setState(intro ? S.EXPLORATION : gs.baseState());
      document.body.classList.remove('cinematic');
      this.busy = false;
      if (item.after) item.after(ctx);
    },
  });
})();
