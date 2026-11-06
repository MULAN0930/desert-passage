/* ==========================================================================
 *  Desert Passage — player-controller.js
 *  · wanderer-avatar   : 임시 방랑자 모델(기본 도형) + 걷기 애니메이션 + 인터랙션 포즈
 *  · player-controller : WASD 이동(시점 기준), Shift, 지형 높이 추종, 충돌, 발소리
 *
 *  이동·충돌 규칙은 Phase 1과 동일합니다. 바뀐 점은 이동 방향의 기준이
 *  1인칭 시점(camera-director의 yaw)이 되었다는 것뿐입니다.
 *  Phase 6에서 GLB로 바꿀 때는 wanderer-avatar만 교체합니다.
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

(function () {
  const CFG = DP.CONFIG;
  const U = DP.Util;

  /* ------------------------------------------------------------------------
   * 임시 방랑자 모델 — 앞쪽 = -Z
   * ---------------------------------------------------------------------- */
  const POSES = {
    rest:      { armL: [0, 0], armR: [0, 0], head: 0 },
    reachR:    { armL: [0.15, 0], armR: [1.25, -0.12], head: 0.25 },
    reachBoth: { armL: [1.05, 0.18], armR: [1.05, -0.18], head: 0.3 },
    lookDown:  { armL: [0.95, 0.25], armR: [0.95, -0.25], head: 0.55 },
    compass:   { armL: [1.2, 0.42], armR: [0.25, 0], head: 0.6 },
    toHead:    { armL: [2.6, 0.38], armR: [0.35, -0.05], head: -0.05 }, // 오른손은 지팡이를 쥔 채
    pull:      { armL: [0.2, 0], armR: [0.55, -0.1], head: 0.15 },
  };

  AFRAME.registerComponent('wanderer-avatar', {
    init() {
      const el = this.el;
      const add = (parent, geometry, pos, mat, rot) => {
        const e = document.createElement('a-entity');
        e.setAttribute('geometry', geometry);
        e.setAttribute('lp-mat', mat);
        e.setAttribute('position', pos);
        if (rot) e.setAttribute('rotation', rot);
        parent.appendChild(e);
        return e;
      };
      const pivot = (parent, pos, id) => {
        const e = document.createElement('a-entity');
        e.setAttribute('position', pos);
        if (id) e.id = id;
        parent.appendChild(e);
        return e;
      };

      this.body = pivot(el, '0 0 0');
      this.legL = pivot(this.body, '-0.12 0.9 0');
      this.legR = pivot(this.body, '0.12 0.9 0');
      for (const leg of [this.legL, this.legR]) {
        add(leg, { primitive: 'cylinder', radius: 0.085, height: 0.86, segmentsRadial: 8 }, '0 -0.43 0', 'body');
        add(leg, { primitive: 'box', width: 0.16, height: 0.08, depth: 0.26 }, '0 -0.86 -0.05', 'clothDark');
      }

      this.torso = pivot(this.body, '0 0.9 0', 'avatar-torso');
      add(this.torso, { primitive: 'cone', radiusBottom: 0.25, radiusTop: 0.2, height: 0.6, segmentsRadial: 10 }, '0 0.32 0', 'body');
      add(this.torso, { primitive: 'cone', radiusBottom: 0.4, radiusTop: 0.21, height: 0.78, segmentsRadial: 12 }, '0 0.24 0.02', 'cloth');
      add(this.torso, { primitive: 'torus', radius: 0.2, radiusTubular: 0.06, segmentsRadial: 6, segmentsTubular: 12 }, '0 0.6 0', 'clothDark', '90 0 0');

      this.head = pivot(this.torso, '0 0.78 0', 'avatar-head');
      add(this.head, { primitive: 'icosahedron', radius: 0.17, detail: 0 }, '0 0 0', 'skin');
      add(this.head, { primitive: 'box', width: 0.2, height: 0.04, depth: 0.02 }, '0 0.01 -0.155', 'body');
      pivot(this.head, '0 0 0', 'head-anchor');     // 비니·이어폰
      pivot(this.torso, '-0.28 0.06 -0.06', 'hip-anchor'); // 나침반

      this.armL = pivot(this.torso, '-0.3 0.58 0');
      this.armR = pivot(this.torso, '0.3 0.58 0');
      for (const arm of [this.armL, this.armR]) {
        add(arm, { primitive: 'cylinder', radius: 0.06, height: 0.58, segmentsRadial: 8 }, '0 -0.29 0', 'cloth');
      }
      pivot(this.armL, '0 -0.6 -0.02', 'hand-left');

      this.stick = pivot(this.armR, '0 -0.56 -0.06');
      add(this.stick, { primitive: 'cylinder', radius: 0.024, height: 1.1, segmentsRadial: 6 }, '0 -0.4 0', 'wood');
      add(this.stick, { primitive: 'sphere', radius: 0.045, segmentsWidth: 6, segmentsHeight: 4 }, '0 0.16 0', 'wood');

      this.phase = 0;
      this.amount = 0;
      this.posed = false;
      this.poseState = { armL: [0, 0], armR: [0, 0], head: 0 };
    },

    /** 인터랙션 포즈로 전환 (팔·고개). rest로 돌아오면 걷기 애니메이션이 다시 팔을 움직임 */
    setPose(name, duration = 0.5) {
      const target = POSES[name] || POSES.rest;
      const from = JSON.parse(JSON.stringify(this.poseState));
      this.posed = true;
      return U.tween(duration, (e) => {
        const s = this.poseState;
        for (const k of ['armL', 'armR']) {
          s[k][0] = U.lerp(from[k][0], target[k][0], e);
          s[k][1] = U.lerp(from[k][1], target[k][1], e);
        }
        s.head = U.lerp(from.head, target.head, e);
        this.applyPose();
      }).then(() => {
        if (name === 'rest') this.posed = false;
      });
    },

    applyPose() {
      const s = this.poseState;
      this.armL.object3D.rotation.set(s.armL[0], 0, s.armL[1]);
      this.armR.object3D.rotation.set(s.armR[0], 0, s.armR[1]);
      this.head.object3D.rotation.x = s.head;
      this.stick.object3D.rotation.x = -s.armR[0] * 0.85; // 팔을 들어도 지팡이는 거의 수직
    },

    setVisible(v) {
      this.el.object3D.visible = v;
    },

    /** player-controller가 매 프레임 호출 */
    setMotion(speed01, dt, distance) {
      const s = Math.min(dt, 100) / 1000;
      this.amount += (speed01 - this.amount) * Math.min(1, s * 8);
      const k = this.amount;
      this.phase += (distance / CFG.player.strideLength) * Math.PI * 2;
      const ph = this.phase;
      const t = performance.now() / 1000;
      const swing = 0.55 * Math.min(k, 1.3);
      this.legL.object3D.rotation.x = Math.sin(ph) * swing;
      this.legR.object3D.rotation.x = -Math.sin(ph) * swing;
      this.body.object3D.position.y = Math.abs(Math.sin(ph)) * 0.045 * Math.min(k, 1.3);
      this.torso.object3D.rotation.x = -0.08 * k;
      this.torso.object3D.rotation.z = Math.sin(ph) * 0.03 * k;
      const breathe = 1 + Math.sin(t * 1.6) * 0.012 * (1 - Math.min(k, 1));
      this.torso.object3D.scale.set(1, breathe, 1);
      if (this.posed) return; // 인터랙션 중에는 팔·고개를 포즈가 담당
      this.armL.object3D.rotation.set(-Math.sin(ph) * swing * 0.7, 0, 0);
      this.armR.object3D.rotation.set(Math.sin(ph) * swing * 0.4 - 0.25 * Math.min(k, 1), 0, 0);
      this.stick.object3D.rotation.x = -Math.sin(ph) * swing * 0.3 + 0.15 * Math.min(k, 1);
      this.head.object3D.rotation.x = Math.sin(t * 0.5) * 0.04 * (1 - Math.min(k, 1));
    },
  });

  /* ------------------------------------------------------------------------
   * 이동 / 충돌 (Phase 1과 같은 규칙)
   * ---------------------------------------------------------------------- */
  const KEY = {
    forward: ['KeyW', 'ArrowUp'],
    back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'],
  };
  const ALL_KEYS = new Set(Object.values(KEY).flat());

  AFRAME.registerComponent('player-controller', {
    schema: {
      avatar: { type: 'selector', default: '#avatar' },
      camera: { type: 'selector', default: '#camera' },
    },

    init() {
      this.keys = new Set();
      this.velocity = new THREE.Vector2(0, 0);
      this.facing = CFG.player.spawnYaw;
      this.speed = 0;
      this.stepDist = 0;
      this.stepCount = 0;
      this.gameState = this.el.sceneEl.systems['game-state'];
      this.onKeyDown = (e) => {
        if (ALL_KEYS.has(e.code)) {
          this.keys.add(e.code);
          if (e.code.startsWith('Arrow')) e.preventDefault();
        }
      };
      this.onKeyUp = (e) => this.keys.delete(e.code);
      this.onBlur = () => this.keys.clear();
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.onBlur);
    },

    remove() {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
    },

    spawn() {
      const sp = CFG.player.spawn;
      this.el.object3D.position.set(sp.x, DP.World.groundAt(sp.x, sp.z), sp.z);
      this.facing = CFG.player.spawnYaw;
      this.velocity.set(0, 0);
      this.applyFacing();
    },

    avatar() {
      return this.data.avatar && this.data.avatar.components['wanderer-avatar'];
    },

    director() {
      return this.data.camera && this.data.camera.components['camera-director'];
    },

    pressed(list) {
      return list.some((k) => this.keys.has(k));
    },

    applyFacing() {
      if (this.data.avatar) this.data.avatar.object3D.rotation.y = this.facing;
    },

    /** 몸을 (x, z) 쪽으로 돌림 (인터랙션 시작 시) */
    faceTowards(x, z, duration = 0.4) {
      const p = this.el.object3D.position;
      const want = Math.atan2(-(x - p.x), -(z - p.z));
      const from = this.facing;
      const diff = U.wrapAngle(want - from);
      return U.tween(duration, (e) => {
        this.facing = from + diff * e;
        this.applyFacing();
      });
    },

    tick(time, dt) {
      if (!dt) return;
      const P = CFG.player;
      const s = Math.min(dt, 100) / 1000;
      const pos = this.el.object3D.position;
      const canMove = this.gameState.canMove();
      const dir = this.director();

      let f = 0;
      let r = 0;
      if (canMove) {
        if (this.pressed(KEY.forward)) f += 1;
        if (this.pressed(KEY.back)) f -= 1;
        if (this.pressed(KEY.right)) r += 1;
        if (this.pressed(KEY.left)) r -= 1;
      }
      const yaw = dir ? dir.yaw : 0;
      let dx = -Math.sin(yaw) * f + Math.cos(yaw) * r;
      let dz = -Math.cos(yaw) * f - Math.sin(yaw) * r;
      const len = Math.hypot(dx, dz);
      if (len > 0) {
        dx /= len;
        dz /= len;
      }

      const target = len > 0 ? (this.pressed(KEY.sprint) ? P.sprintSpeed : P.walkSpeed) : 0;
      const a = Math.min(1, s * P.acceleration);
      this.velocity.x += (dx * target - this.velocity.x) * a;
      this.velocity.y += (dz * target - this.velocity.y) * a;
      if (!canMove) this.velocity.multiplyScalar(1 - a);

      const startX = pos.x;
      const startZ = pos.z;
      const stepX = this.velocity.x * s;
      const stepZ = this.velocity.y * s;
      const n = Math.max(1, Math.ceil(Math.hypot(stepX, stepZ) / 0.05));
      for (let i = 0; i < n; i++) {
        const nx = pos.x + stepX / n;
        if (!DP.World.isBlocked(nx, pos.z, P.radius)) pos.x = nx;
        const nz = pos.z + stepZ / n;
        if (!DP.World.isBlocked(pos.x, nz, P.radius)) pos.z = nz;
      }
      const moved = Math.hypot(pos.x - startX, pos.z - startZ);
      this.speed = moved / s;

      const ground = DP.World.groundAt(pos.x, pos.z);
      pos.y += (ground - pos.y) * Math.min(1, s * P.stepSmoothing);
      if (pos.y < ground - 0.05) pos.y = ground - 0.05;

      // 1인칭에서는 몸이 시점 방향을 바라봄
      if (dir && dir.mode === 'first') {
        this.facing = yaw;
        this.applyFacing();
      } else if (dir && dir.mode === 'follow' && this.speed > 0.2) {
        // 3인칭: 몸이 걷는 방향으로 부드럽게 돌아감
        const want = Math.atan2(-this.velocity.x, -this.velocity.y);
        this.facing += U.wrapAngle(want - this.facing) * Math.min(1, s * P.turnSpeed);
        this.applyFacing();
      }

      // 발소리: 반 보폭마다, 두 걸음에 한 번 지팡이
      this.stepDist += moved;
      if (this.stepDist > P.strideLength / 2) {
        this.stepDist = 0;
        this.stepCount++;
        if (DP.Audio) DP.Audio.footstep(this.stepCount % 2 === 0);
      }

      const av = this.avatar();
      if (av) av.setMotion(this.speed / P.walkSpeed, dt, moved);
    },
  });
})();
