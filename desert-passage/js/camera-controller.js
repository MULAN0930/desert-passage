/* ==========================================================================
 *  Desert Passage — camera-controller.js
 *  camera-director: 공통 카메라 시스템
 *
 *  mode
 *   · 'first'  : 고정 1인칭 (마우스로 시점, 캐릭터 숨김)
 *   · 'follow' : 3인칭 추적 (캐릭터 뒤, 마우스로 회전) — 낙원에서 사용
 *   · 'move'   : 시네마틱 이동 중 (위치 보간 + 회전 구면 보간)
 *   · 'hold'   : 시네마틱 정지 화면
 *   · 'orbit'  : 대상 주위 회전 (낙원 도착 연출; locked면 마우스 무시)
 *
 *  baseMode: 연출이 끝나면 돌아갈 기본 시점 ('first' | 'follow')
 *  모든 오브젝트는 이 컴포넌트의 moveTo / toBase / orbit만 사용합니다.
 *  (오브젝트마다 카메라 코드를 따로 만들지 않음)
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

(function () {
  const CFG = DP.CONFIG;
  const U = DP.Util;
  const UP = new THREE.Vector3(0, 1, 0);

  AFRAME.registerComponent('camera-director', {
    schema: {
      target: { type: 'selector', default: '#player' },
      avatar: { type: 'selector', default: '#avatar' },
    },

    init() {
      this.mode = 'hold';
      this.baseMode = 'follow'; // 기본 탐험 시점: 3인칭
      this.hideAvatar = false;
      this.yaw = CFG.player.spawnYaw;
      this.pitch = 0;
      this.followPitch = CFG.camera.follow.defaultPitch;
      this.followPos = new THREE.Vector3();
      this.followLook = new THREE.Vector3();
      this.eye = new THREE.Vector3();
      this.tmpM = new THREE.Matrix4();
      this.raycaster = new THREE.Raycaster();
      this.blockers = [];
      this.move = null;
      this.orbitState = null;
      this.dragging = false;
      this.el.object3D.rotation.order = 'YXZ';

      this.onMouseMove = this.onMouseMove.bind(this);
      this.onMouseDown = (e) => {
        if (e.button === 0 && !this.isLocked()) this.dragging = true;
      };
      this.onMouseUp = () => (this.dragging = false);
      this.onWheel = (e) => {
        if (this.mode !== 'orbit') return;
        e.preventDefault();
        const o = this.orbitState;
        o.radius = U.clamp(o.radius + Math.sign(e.deltaY) * 0.12, o.minRadius, o.maxRadius);
      };
      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('mouseup', this.onMouseUp);
      const canvasReady = () => {
        this.canvas = this.el.sceneEl.canvas;
        this.canvas.addEventListener('mousedown', this.onMouseDown);
        this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
      };
      if (this.el.sceneEl.canvas) canvasReady();
      else this.el.sceneEl.addEventListener('render-target-loaded', canvasReady, { once: true });
    },

    remove() {
      document.removeEventListener('mousemove', this.onMouseMove);
      document.removeEventListener('mouseup', this.onMouseUp);
    },

    refreshBlockers() {
      this.blockers = DP.World.getCameraBlockers();
    },

    isLocked() {
      return this.canvas && document.pointerLockElement === this.canvas;
    },

    onMouseMove(e) {
      if (!(this.isLocked() || this.dragging)) return;
      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      if (Math.abs(mx) > 250 || Math.abs(my) > 250) return; // 포인터 잠금 직후 튀는 값 무시
      const C = CFG.camera;
      if (this.mode === 'first') {
        this.yaw -= mx * C.sensitivity;
        this.pitch = U.clamp(this.pitch - my * C.sensitivity, C.minPitch, C.maxPitch);
      } else if (this.mode === 'follow') {
        const F = C.follow;
        this.yaw -= mx * C.sensitivity;
        this.followPitch = U.clamp(this.followPitch + my * C.sensitivity, F.minPitch, F.maxPitch);
      } else if (this.mode === 'orbit' && !this.orbitState.locked) {
        const o = this.orbitState;
        o.yaw -= mx * C.sensitivity * 1.4;
        o.pitch = U.clamp(o.pitch + my * C.sensitivity * 1.4, o.minPitch, o.maxPitch);
      }
    },

    /* ---------------- 위치 계산 ---------------- */

    eyePosition(out = this.eye) {
      const p = this.data.target.object3D.position;
      const pc = this.data.target.components['player-controller'];
      const av = pc && pc.avatar();
      const bob = av ? Math.abs(Math.sin(av.phase)) * CFG.camera.headBob * Math.min(av.amount, 1.2) : 0;
      return out.set(p.x, p.y + CFG.camera.eyeHeight + bob, p.z);
    },

    /** 3인칭 추적 위치: 캐릭터 기준점에서 yaw/pitch 반대 방향으로 distance만큼 뒤 */
    followTarget() {
      const F = CFG.camera.follow;
      const p = this.data.target.object3D.position;
      const pivot = this.followLook.set(p.x, p.y + F.pivotHeight, p.z);
      const cp = Math.cos(this.followPitch);
      const want = this.followPos.set(
        pivot.x + Math.sin(this.yaw) * cp * F.distance,
        pivot.y + Math.sin(this.followPitch) * F.distance,
        pivot.z + Math.cos(this.yaw) * cp * F.distance
      );
      return { pos: this.safePosition(want, pivot), look: pivot };
    },

    lookQuaternion(pos, look, out = new THREE.Quaternion()) {
      this.tmpM.lookAt(pos, look, UP);
      return out.setFromRotationMatrix(this.tmpM);
    },

    /** 카메라가 유적을 뚫지 않도록 look → pos 사이 장애물 앞으로 당김 + 지면 위로 */
    safePosition(pos, look) {
      const C = CFG.camera;
      const out = pos.clone();
      if (this.blockers.length) {
        const dir = out.clone().sub(look);
        const dist = dir.length();
        dir.normalize();
        this.raycaster.set(look, dir);
        this.raycaster.far = dist + C.collisionPadding;
        const hit = this.raycaster.intersectObjects(this.blockers, true)[0];
        if (hit) out.copy(look).addScaledVector(dir, Math.max(0.5, hit.distance - C.collisionPadding));
      }
      const floor = DP.World.groundAt(out.x, out.z) + C.groundClearance;
      if (out.y < floor) out.y = floor;
      return out;
    },

    /**
     * 캐릭터(subject)와 대상(target)이 함께 보이는 옆모습 샷 계산
     * 양쪽 중 덜 가려지는 쪽을 자동 선택
     */
    sideShot({ target, distance = 3.2, height = 1.7, lookHeight = 1.15, bias = 0.35, side = 0 }) {
      const p = this.data.target.object3D.position;
      const mid = new THREE.Vector3((p.x + target.x) / 2, 0, (p.z + target.z) / 2);
      const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z).normalize();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x);
      const look = mid.clone();
      look.y = p.y + lookHeight;
      const candidates = (side ? [side] : [1, -1]).map((sd) => {
        const want = mid.clone().addScaledVector(perp, sd * distance).addScaledVector(dir, -distance * bias);
        want.y = p.y + height;
        const safe = this.safePosition(want, look);
        return { pos: safe, score: safe.distanceTo(look) };
      });
      candidates.sort((a, b) => b.score - a.score);
      return { pos: candidates[0].pos, look };
    },

    /* ---------------- 전환 ---------------- */

    /** 즉시 시네마틱 위치로 (인트로 첫 화면) */
    setShot(pos, look) {
      this.cancelMove();
      this.mode = 'hold';
      this.el.object3D.position.copy(pos);
      this.el.object3D.quaternion.copy(this.lookQuaternion(pos, look));
    },

    cancelMove() {
      if (this.move && this.move.resolve) this.move.resolve();
      this.move = null;
    },

    /** 시네마틱 이동 → Promise (도착하면 resolve) */
    moveTo({ pos, look, duration = CFG.camera.transition, ease = U.ease.inOut, safe = true }) {
      this.cancelMove();
      const to = safe ? this.safePosition(pos, look) : pos.clone();
      const o = this.el.object3D;
      return new Promise((resolve) => {
        this.move = {
          fromPos: o.position.clone(),
          fromQ: o.quaternion.clone(),
          toPos: to,
          toQ: this.lookQuaternion(to, look),
          t: 0,
          duration: Math.max(0.01, duration),
          ease,
          resolve,
          endMode: 'hold',
        };
        this.mode = 'move';
      });
    },

    /** 1인칭으로 복귀 (yaw: 돌아왔을 때 바라볼 방향 — 보통 캐릭터가 바라보는 방향) */
    toFirstPerson(duration = CFG.camera.returnDuration, yaw = null) {
      this.cancelMove();
      if (yaw != null) this.yaw = yaw;
      this.pitch = -0.08;
      const o = this.el.object3D;
      const toQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      return new Promise((resolve) => {
        this.move = {
          fromPos: o.position.clone(),
          fromQ: o.quaternion.clone(),
          toPos: null, // 매 프레임 눈 위치를 따라감
          toQ,
          t: 0,
          duration,
          ease: U.ease.inOut,
          resolve,
          endMode: 'first',
        };
        this.mode = 'move';
      });
    },

    /**
     * 1인칭 인터랙션 시점: 캐릭터 눈 위치에서 look을 바라봄 (캐릭터는 숨김)
     * @param {THREE.Vector3} look  바라볼 지점
     * @param {{pos?:THREE.Vector3, duration?:number}} o  pos를 주면 그 위치(예: TV 앞)에서 봄
     */
    firstPersonAt(look, o = {}) {
      this.hideAvatar = true;
      const pos = o.pos || this.eyePosition(new THREE.Vector3());
      return this.moveTo({ pos, look, duration: o.duration || 0.9, safe: false });
    },

    /** 3인칭 추적으로 전환 (매 프레임 목표 위치를 다시 계산) */
    toFollow(duration = CFG.camera.returnDuration, yaw = null) {
      this.cancelMove();
      if (yaw != null) this.yaw = yaw;
      const o = this.el.object3D;
      return new Promise((resolve) => {
        this.move = {
          fromPos: o.position.clone(),
          fromQ: o.quaternion.clone(),
          toPos: null,
          toQ: null,
          follow: true,
          t: 0,
          duration,
          ease: U.ease.inOut,
          resolve,
          endMode: 'follow',
        };
        this.mode = 'move';
      });
    },

    /** 기본 시점(baseMode)으로 복귀 — 인터랙션·연출이 끝날 때 공통 사용 */
    toBase(duration = CFG.camera.returnDuration, yaw = null) {
      return this.baseMode === 'follow' ? this.toFollow(duration, yaw) : this.toFirstPerson(duration, yaw);
    },

    /** 기본 시점 변경 (나침반: 3인칭 → 1인칭, 넣으면 원래대로) */
    setBaseMode(mode, duration = 0.7) {
      this.baseMode = mode;
      return this.toBase(duration);
    },

    /** 대상 주위 둘러보기 (마우스로 회전, 휠로 거리) */
    orbit({ center, radius = 1, yaw = 0, pitch = 0.4, minPitch = -0.15, maxPitch = 1.2, minRadius = 0.6, maxRadius = 2.2, locked = false, follow = 12 }) {
      this.cancelMove();
      this.orbitState = { center: center.clone(), radius, yaw, pitch, minPitch, maxPitch, minRadius, maxRadius, locked, follow };
      this.mode = 'orbit';
    },

    /** 현재 카메라 위치에서 orbit 각도 계산 (자연스럽게 이어지도록) */
    orbitAnglesFrom(center) {
      const d = this.el.object3D.position.clone().sub(center);
      const r = d.length();
      return { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(U.clamp(d.y / r, -1, 1)), radius: r };
    },

    /* ---------------- 매 프레임 ---------------- */

    tick(time, dt) {
      if (!dt || !this.data.target) return;
      const o = this.el.object3D;
      const s = Math.min(dt, 100) / 1000;

      if (this.mode === 'first') {
        o.position.copy(this.eyePosition());
        o.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      } else if (this.mode === 'move' && this.move) {
        const m = this.move;
        m.t += s / m.duration;
        const k = U.clamp(m.t, 0, 1);
        const e = m.ease(k);
        let toPos = m.toPos;
        let toQ = m.toQ;
        if (m.follow) {
          const ft = this.followTarget();
          toPos = ft.pos;
          toQ = this.lookQuaternion(ft.pos, ft.look);
        } else if (!toPos) toPos = this.eyePosition();
        o.position.lerpVectors(m.fromPos, toPos, e);
        o.quaternion.slerpQuaternions(m.fromQ, toQ, e);
        if (k >= 1) {
          this.mode = m.endMode;
          if (this.mode === 'first') o.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
          const r = m.resolve;
          this.move = null;
          r();
        }
      } else if (this.mode === 'orbit' && this.orbitState) {
        const st = this.orbitState;
        const cp = Math.cos(st.pitch);
        const want = new THREE.Vector3(
          st.center.x + Math.sin(st.yaw) * cp * st.radius,
          st.center.y + Math.sin(st.pitch) * st.radius,
          st.center.z + Math.cos(st.yaw) * cp * st.radius
        );
        const floor = DP.World.groundAt(want.x, want.z) + CFG.camera.groundClearance;
        if (want.y < floor) want.y = floor;
        o.position.lerp(want, Math.min(1, s * st.follow));
        o.quaternion.slerp(this.lookQuaternion(o.position, st.center), Math.min(1, s * (st.follow + 2)));
      } else if (this.mode === 'follow') {
        const ft = this.followTarget();
        o.position.lerp(ft.pos, Math.min(1, s * CFG.camera.follow.smoothing));
        o.quaternion.copy(this.lookQuaternion(o.position, ft.look));
      }
      document.body.classList.toggle('third-person', this.mode === 'follow');

      // 캐릭터 표시: 1인칭에서는 숨기고, 카메라가 눈에서 충분히 멀어지면 표시
      const av = this.data.avatar;
      if (av) {
        const far = o.position.distanceTo(this.eyePosition(new THREE.Vector3())) > CFG.camera.avatarShowDistance;
        // hideAvatar: 1인칭 인터랙션 중 (카메라가 눈 위치가 아니어도 손·몸이 화면에 보이지 않게)
        av.object3D.visible = this.mode !== 'first' && far && !this.hideAvatar;
      }
    },
  });
})();
