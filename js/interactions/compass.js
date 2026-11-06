/* ==========================================================================
 *  보조 도구 — 나침반 (C 키로 꺼내기 / 넣기, 포털 진행에 포함되지 않음)
 *
 *  상태
 *   · STOWED   : 캐릭터 왼쪽 허리에 매달려 있음
 *   · EQUIPPED : 1인칭 화면 앞쪽에 손에 든 나침반이 보임 (계속 유지, 자동 수납 없음)
 *
 *  STOWED → EQUIPPED : 1인칭으로 전환(3인칭이었다면) → 손이 나침반을 들어 올림 → 뚜껑 열림
 *  EQUIPPED → STOWED : 뚜껑 닫힘 → 나침반을 내림 → 이전 시점으로 복귀
 *
 *  · 꺼낸 상태에서도 WASD 이동·E 상호작용 가능
 *    (오브젝트 연출 중에는 잠시 화면에서 사라졌다가 1인칭으로 돌아오면 다시 보임)
 *  · 바늘은 매 프레임 목표 방향을 계산하고 스프링처럼 따라감 → 몸을 돌리면 바늘이 반응
 *  · 목표: config.compass.order 순서상 가장 앞선 미완료 오브젝트 (모두 완료 → 포털)
 * ========================================================================== */
'use strict';

(function () {
  const CFG = DP.CONFIG;
  const U = DP.Util;
  const K = DP.Kit;
  const D2R = THREE.MathUtils.degToRad;
  const STOWED = 'STOWED';
  const EQUIPPED = 'EQUIPPED';

  /** 나침반 본체 (허리용·1인칭용 공용). 바늘 기준: 로컬 -Z = 다이얼 위쪽 */
  function buildDevice(parent) {
    const c = K.group(parent);
    K.mesh(c, new THREE.CylinderGeometry(0.066, 0.066, 0.026, 16), 'brass', {});
    K.mesh(c, new THREE.CylinderGeometry(0.057, 0.057, 0.004, 16), 'needleWhite', { pos: [0, 0.012, 0] });
    K.mesh(c, new THREE.BoxGeometry(0.008, 0.002, 0.014), 'needleRed', { pos: [0, 0.015, -0.048] }); // 위쪽 표시
    for (const a of [90, 180, 270]) {
      const r = D2R(a);
      K.mesh(c, new THREE.BoxGeometry(0.004, 0.002, 0.009), 'brass', { pos: [-Math.sin(r) * 0.048, 0.015, -Math.cos(r) * 0.048], rot: [0, a, 0] });
    }
    K.mesh(c, new THREE.TorusGeometry(0.012, 0.004, 4, 8), 'brass', { pos: [0, 0, 0.072], rot: [90, 0, 0] }); // 고리
    const needle = K.group(c, [0, 0.017, 0]);
    K.mesh(needle, new THREE.ConeGeometry(0.008, 0.05, 4), 'needleRed', { pos: [0, 0, -0.025], rot: [-90, 0, 0], cast: false });
    K.mesh(needle, new THREE.ConeGeometry(0.008, 0.04, 4), 'needleWhite', { pos: [0, 0, 0.02], rot: [90, 0, 0], cast: false });
    K.mesh(needle, new THREE.CylinderGeometry(0.005, 0.005, 0.006, 6), 'brass', { cast: false });
    K.mesh(c, new THREE.CylinderGeometry(0.056, 0.056, 0.002, 16), 'glass', { pos: [0, 0.021, 0], cast: false });
    // 뚜껑: 위쪽(-Z) 경첩 → 화면 안쪽으로 열림
    const lid = K.group(c, [0, 0.013, -0.066]);
    K.mesh(lid, new THREE.CylinderGeometry(0.066, 0.066, 0.012, 16), 'brass', { pos: [0, 0.006, 0.066] });
    K.mesh(lid, new THREE.CylinderGeometry(0.05, 0.05, 0.002, 12), 'brass', { pos: [0, 0.013, 0.066] });
    return { root: c, needle, lid };
  }

  AFRAME.registerComponent('compass-gear', {
    init() {
      const C = CFG.compass;
      this.torso = document.getElementById('avatar-torso').object3D;
      this.cameraEl = document.getElementById('camera');
      this.state = STOWED;
      this.animating = false;
      this.prevBase = null;
      this.target = null;
      this.needleAngle = 0;
      this.needleVel = 0;
      this.raise = 0; // 0 = 내림, 1 = 들어 올림
      this.lidOpen = 0;
      this.q = new THREE.Quaternion();
      this.e = new THREE.Euler(0, 0, 0, 'YXZ');
      this.wp = new THREE.Vector3();

      // 1) 허리에 매달린 나침반 (3인칭에서 보임)
      this.hip = buildDevice(this.torso);
      this.hip.root.position.set(-0.29, 0.06, -0.08);
      this.hip.root.rotation.set(0, 0, D2R(90));

      // 2) 1인칭 화면용 나침반 + 손 (카메라의 자식)
      const cam = this.cameraEl.object3D;
      this.vm = K.group(cam);
      this.vm.visible = false;
      this.device = buildDevice(this.vm);
      this.device.root.rotation.set(D2R(C.holdTilt), D2R(6), 0);
      // 손바닥 + 엄지 + 소매 (단순 로우폴리)
      // 손은 나침반 본체 아래(로컬 -Y)에 붙여 함께 기울어짐
      const hand = K.group(this.device.root, [0.006, -0.03, 0.03]);
      K.mesh(hand, new THREE.BoxGeometry(0.1, 0.032, 0.12), 'skin', { cast: false });
      K.mesh(hand, new THREE.BoxGeometry(0.026, 0.024, 0.058), 'skin', { pos: [0.064, 0.018, -0.02], rot: [0, -20, -35], cast: false }); // 엄지
      for (let i = 0; i < 3; i++) {
        K.mesh(hand, new THREE.BoxGeometry(0.024, 0.022, 0.03), 'skin', { pos: [-0.066, 0.016, -0.04 + i * 0.027], rot: [0, 0, 40], cast: false }); // 손가락
      }
      // 소매: 손목에서 화면 아래쪽으로
      K.mesh(this.vm, new THREE.CylinderGeometry(0.04, 0.05, 0.36, 8), 'cloth', { pos: [0.0, -0.17, 0.16], rot: [50, 0, -6], cast: false });
      this.vm.traverse((o) => {
        if (o.isMesh) o.frustumCulled = false;
      });

      const self = this;
      K.register({
        id: 'compass',
        key: 'compass',
        el: this.el,
        countsTowardPortal: false,
        toggle: (ctx) => self.toggle(ctx),
      });
    },

    /* ---------------- 목표 (순차 안내) ---------------- */

    /**
     * config.compass.order에서 아직 완료하지 않은 첫 대상
     * · 순서를 건너뛰어 먼저 완료한 오브젝트는 다시 요구하지 않음 (completed_objects 기준)
     * · 'portal'은 다섯 오브젝트를 모두 완료했을 때만 대상
     * · 중복 완료는 game-state가 걸러내므로 여기서는 상태만 읽음
     */
    findTarget() {
      const gs = this.el.sceneEl.systems['game-state'];
      if (gs.is(DP.STATES.PARADISE)) return null;
      const done = gs.data.completed_objects;
      const all = gs.allComplete();
      const portal = { id: 'portal', x: CFG.portal.center.x, z: CFG.portal.center.z };
      for (const id of CFG.compass.order) {
        if (id === 'portal') {
          if (all) return portal;
          continue;
        }
        const o = CFG.objects[id];
        if (o && DP.CORE_OBJECTS.includes(id) && !done[id]) return { id, x: o.x, z: o.z };
      }
      // 순서 목록에서 빠진 핵심 오브젝트가 있으면 그것도 안내
      for (const id of DP.CORE_OBJECTS) {
        if (!done[id]) return { id, x: CFG.objects[id].x, z: CFG.objects[id].z };
      }
      return portal;
    },

    /* ---------------- 꺼내기 / 넣기 ---------------- */

    toggle(ctx) {
      if (this.animating) return;
      if (this.state === STOWED) this.equip(ctx);
      else this.stow(ctx);
    },

    async equip(ctx) {
      const C = CFG.compass;
      const cam = ctx.camera;
      this.animating = true;
      this.state = EQUIPPED;
      // 3인칭이었다면 1인칭으로 (이전 시점 기억)
      this.prevBase = cam.baseMode;
      const camMove = cam.baseMode !== 'first' ? cam.setBaseMode('first', 0.7) : null;
      this.hip.root.visible = false;
      this.needleVel = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 4); // 꺼낼 때 바늘이 흔들림
      await U.tween(C.raiseDuration, (e) => (this.raise = e), U.ease.out);
      if (camMove) await camMove;
      DP.Audio.sfx('click');
      await U.tween(C.lidDuration, (e) => (this.lidOpen = e), U.ease.out);
      this.animating = false;
    },

    async stow(ctx) {
      const C = CFG.compass;
      const cam = ctx.camera;
      this.animating = true;
      await U.tween(C.lidDuration * 0.75, (e) => (this.lidOpen = 1 - e));
      DP.Audio.sfx('click');
      await U.tween(C.lowerDuration, (e) => (this.raise = 1 - e), U.ease.in);
      this.state = STOWED;
      this.hip.root.visible = true;
      if (this.prevBase && this.prevBase !== cam.baseMode) await cam.setBaseMode(this.prevBase, 0.8);
      this.prevBase = null;
      this.animating = false;
    },

    /** 즉시 수납 (포털 통과처럼 연출이 강제로 시작될 때) */
    forceStow() {
      this.state = STOWED;
      this.animating = false;
      this.raise = 0;
      this.lidOpen = 0;
      this.prevBase = null;
      this.vm.visible = false;
      this.hip.root.visible = true;
    },

    /* ---------------- 매 프레임 ---------------- */

    tick(t, dt) {
      if (!dt) return;
      const C = CFG.compass;
      const s = Math.min(dt, 100) / 1000;
      const cam = this.cameraEl.components['camera-director'];
      const active = this.state === EQUIPPED || this.animating;
      const show = active && cam && cam.mode === 'first' && !document.body.classList.contains('cinematic');
      this.vm.visible = show;
      if (!active) return;

      // 위치: 내림 ↔ 들어 올림 + 걸을 때 흔들림
      const lo = C.lowPos;
      const hi = C.holdPos;
      const k = this.raise;
      const pc = document.getElementById('player').components['player-controller'];
      const av = pc && pc.avatar();
      const amt = av ? Math.min(av.amount, 1.2) : 0;
      const ph = av ? av.phase : 0;
      const breathe = Math.sin(t / 1000 * 1.3) * 0.002;
      this.vm.position.set(
        U.lerp(lo.x, hi.x, k) + Math.sin(ph) * 0.008 * amt,
        U.lerp(lo.y, hi.y, k) - Math.abs(Math.sin(ph)) * 0.01 * amt + breathe,
        U.lerp(lo.z, hi.z, k)
      );
      this.vm.rotation.set(D2R(-25) * (1 - k), 0, Math.sin(ph) * 0.02 * amt);
      this.device.lid.rotation.x = -this.lidOpen * 1.95;

      // 바늘: 목표의 실제 방향 - 화면(카메라)이 향한 방향
      this.target = this.findTarget();
      let goal;
      if (this.target) {
        this.device.root.getWorldPosition(this.wp);
        const worldAngle = Math.atan2(-(this.target.x - this.wp.x), -(this.target.z - this.wp.z));
        this.cameraEl.object3D.getWorldQuaternion(this.q);
        this.e.setFromQuaternion(this.q, 'YXZ');
        goal = worldAngle - this.e.y - D2R(6);
      } else {
        goal = this.needleAngle + Math.sin(t / 1000 * 0.4) * 0.6; // 낙원: 목표 없이 천천히 떠돎
      }
      const diff = U.wrapAngle(goal - this.needleAngle);
      this.needleVel += (diff * C.needleStiffness - this.needleVel * C.needleDamping) * s;
      this.needleAngle = U.wrapAngle(this.needleAngle + this.needleVel * s);
      this.device.needle.rotation.y = this.needleAngle;
    },
  });
})();
