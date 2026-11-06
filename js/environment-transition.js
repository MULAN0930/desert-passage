/* ==========================================================================
 *  Desert Passage — environment-transition.js
 *  포털 진입 → 낙원 도착까지의 전환 (Phase 5)
 *
 *  1. 진입 판정: 포털이 열린 상태(PORTAL_READY)에서 고리 중앙에 걸어 들어가면
 *  2. 이동 잠금 (중복 진입 방지: active 플래그 + 상태 PORTAL_TRANSITION)
 *  3. 포털 통과음
 *  4. 화면을 따뜻한 흰빛으로 덮음 (카메라는 빛 속으로 조금 전진)
 *  5. 환경 전환: 사막 숨김·정지 → 낙원 생성 → 조명·안개·렌더 설정 교체 → 환경음 크로스페이드
 *  6. 낙원 시작 지점으로 이동
 *  7. 흰빛이 걷히며 짧은 도착 연출 (카메라가 주변을 한 바퀴 보여 줌)
 *  8. 카메라가 캐릭터 뒤로 돌아오고 이동 잠금 해제 → 자유 탐험
 *  9. 엔딩 독백 (js/narrative.js의 ending) — 걸으면서 볼 수 있음, 이후에도 게임은 멈추지 않음
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

(function () {
  const CFG = DP.CONFIG;
  const S = DP.STATES;
  const U = DP.Util;

  AFRAME.registerSystem('environment-transition', {
    init() {
      this.active = false;
      this.environment = 'desert';
      this.paradise = null;
    },

    els() {
      return {
        gs: this.el.systems['game-state'],
        portal: this.el.systems['portal-manager'],
        camera: document.getElementById('camera').components['camera-director'],
        playerEl: document.getElementById('player'),
        player: document.getElementById('player').components['player-controller'],
        avatar: document.getElementById('avatar').components['wanderer-avatar'],
      };
    },

    /** 1. 진입 판정 */
    tick() {
      if (this.active || this.environment !== 'desert') return;
      const { gs, portal, playerEl } = this.els();
      if (!gs || !portal || !portal.opened || !gs.is(S.PORTAL_READY) || !gs.canMove()) return;
      if (DP.Interaction && DP.Interaction.busy) return;
      const P = CFG.portal;
      const p = playerEl.object3D.position;
      if (Math.abs(p.x - P.center.x) < P.entry.halfWidth && Math.abs(p.z - P.center.z) < P.entry.depth) this.enter();
    },

    fade(to, duration) {
      const el = document.getElementById('fade');
      if (!el) return U.wait(duration);
      el.style.transition = `opacity ${duration}s ease-in-out`;
      void el.offsetWidth; // 전환 시작점 확정
      el.style.opacity = String(to);
      return U.wait(duration);
    },

    async enter() {
      if (this.active) return;
      this.active = true;
      const { gs, camera, playerEl, player, avatar } = this.els();
      const PD = CFG.paradise;
      const P = CFG.portal;

      // 2. 이동 잠금 + 상태 전환
      gs.lockMovement('portal-transition');
      gs.setState(S.PORTAL_TRANSITION);
      document.body.classList.add('transitioning');
      DP.Cinematic.letterbox(true);
      const compass = document.getElementById('avatar').components['compass-gear'];
      if (compass) compass.forceStow();

      // 3. 포털 통과음
      DP.Audio.sfx('portalEnter');

      // 4. 빛 속으로 전진 + 흰빛 페이드
      const p = playerEl.object3D.position;
      const dirZ = camera.yaw != null ? -Math.cos(camera.yaw) : -1;
      const sign = dirZ <= 0 ? -1 : 1; // 들어온 방향으로 계속
      const eye = new THREE.Vector3(p.x, p.y + CFG.camera.eyeHeight, p.z);
      const ahead = new THREE.Vector3(P.center.x, eye.y + 0.1, P.center.z + sign * 2.4);
      const look = new THREE.Vector3(P.center.x, eye.y + 0.2, P.center.z + sign * 8);
      camera.moveTo({ pos: ahead, look, duration: PD.fadeOut + 0.4, ease: U.ease.in, safe: false });
      await this.fade(1, PD.fadeOut);

      // 5. 환경 전환 (화면이 완전히 덮인 동안)
      this.switchToParadise();

      // 6. 낙원 시작 지점
      const sp = PD.spawn;
      p.set(sp.x, DP.World.groundAt(sp.x, sp.z), sp.z);
      player.velocity.set(0, 0);
      player.facing = PD.spawnYaw;
      player.applyFacing();
      camera.yaw = PD.spawnYaw;
      camera.followPitch = CFG.camera.follow.defaultPitch;
      camera.baseMode = PD.cameraMode === 'third' ? 'follow' : 'first';
      gs.setState(S.PARADISE);
      avatar.setPose('rest', 0.1);

      // 7. 도착 연출: 캐릭터 앞에서 시작해 주변을 돌며 숲과 개울을 보여 줌
      const T = PD.tour;
      const center = new THREE.Vector3(p.x, p.y + 1.3, p.z);
      const startYaw = PD.spawnYaw + Math.PI * 0.85;
      const startPitch = 0.32;
      const cp = Math.cos(startPitch);
      const startPos = new THREE.Vector3(
        center.x + Math.sin(startYaw) * cp * T.radius * 0.6,
        center.y + Math.sin(startPitch) * T.radius * 0.6,
        center.z + Math.cos(startYaw) * cp * T.radius * 0.6
      );
      camera.setShot(startPos, center);
      camera.orbit({ center, radius: T.radius * 0.6, yaw: startYaw, pitch: startPitch, minPitch: -1, maxPitch: 1.4, locked: true, follow: 3 });
      await U.wait(0.25);
      const fadeIn = this.fade(0, PD.fadeIn);
      const o = camera.orbitState;
      const sweep = THREE.MathUtils.degToRad(T.sweep);
      await U.tween(T.duration, (e) => {
        o.yaw = startYaw + sweep * e;
        o.radius = U.lerp(T.radius * 0.6, T.radius * 1.45, Math.sin(e * Math.PI) * 0.8 + e * 0.2);
        o.pitch = U.lerp(startPitch, 0.12, Math.sin(e * Math.PI)) + e * 0.05;
        o.center.y = center.y + Math.sin(e * Math.PI) * 1.2;
      }, U.ease.inOut);
      await fadeIn;

      // 8. 캐릭터 뒤로 복귀 → 자유 탐험
      await camera.toBase(1.8, player.facing);
      gs.unlockMovement('portal-transition');
      document.body.classList.remove('transitioning');
      DP.Cinematic.letterbox(false);
      this.active = false;

      // 9. 엔딩 독백 (이동을 막지 않음)
      await U.wait(1.5);
      await DP.Cinematic.monologue(DP.NARRATIVE.ending);
    },

    /** 사막 → 낙원: 두 공간을 동시에 그리지 않도록 사막은 숨기고 정지 */
    switchToParadise() {
      const scene = this.el;
      const PD = CFG.paradise;
      const L = PD.lighting;

      // 사막: 렌더링 제외 + 모든 하위 컴포넌트 tick 정지 (모래 입자·DVD 화면·글라이더 등)
      const desert = document.getElementById('desert-world');
      if (desert) {
        desert.object3D.visible = false;
        desert.pause();
      }
      const storm = scene.systems.sandstorm;
      if (storm) storm.enabled = false;

      // 낙원 생성 + 지면·충돌·카메라 장애물 연결
      this.paradise = DP.Paradise.build(scene);
      DP.World.setEnvironment(this.paradise);
      const cam = document.getElementById('camera').components['camera-director'];
      cam.refreshBlockers();
      this.environment = 'paradise';
      console.info('[paradise] 생성', this.paradise.stats);

      // 대기: 아주 옅은 안개
      const sceneObj = scene.object3D;
      const fogColor = new THREE.Color(PD.colors.fog);
      if (sceneObj.fog) {
        sceneObj.fog.color.copy(fogColor);
        if ('density' in sceneObj.fog) sceneObj.fog.density = Math.sqrt(Math.LN2) / PD.visibility;
      }
      sceneObj.background = new THREE.Color(PD.colors.skyHorizon);

      // 조명
      const sun = document.getElementById('sun-light');
      if (sun) {
        sun.setAttribute('light', { type: 'directional', color: L.sun, intensity: L.sunIntensity, castShadow: false });
        sun.setAttribute('position', L.sunPosition);
      }
      const hemi = document.getElementById('hemi-light');
      if (hemi) hemi.setAttribute('light', { type: 'hemisphere', color: L.hemiSky, groundColor: L.hemiGround, intensity: L.hemiIntensity });

      // 렌더: 맑은 공기 (블러 거의 없음, 멀리까지 그림)
      const R = PD.render;
      scene.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * R.pixelRatio);
      scene.canvas.style.filter = R.screenBlur > 0 ? `blur(${R.screenBlur}px)` : '';
      const camera = scene.camera;
      if (camera) {
        camera.far = R.cameraFar;
        camera.updateProjectionMatrix();
      }
      document.body.classList.add('paradise');
      CFG.camera.follow.distance = CFG.camera.follow.paradiseDistance; // 탁 트인 곳이라 조금 멀리서

      // 소리: 사막 바람·오브젝트 음원 페이드아웃 / 낙원 환경음 페이드인 (이어폰 음악은 유지)
      DP.Audio.crossfadeToParadise(this.paradise.streamPoints, CFG.audio.crossfade);
    },
  });
})();
