/* ==========================================================================
 *  기억 01 — 큐브 (cube_unsolved.glb → cube_solved.glb)
 *
 *  1. 섞인 큐브를 발견 (낮은 돌 받침 위)
 *  2. 3인칭: 손 뻗기(03) — interaction-manager 공통
 *  3. 1인칭 진입 → 큐브가 떠올라 카메라 앞에 머묾 (손은 보이지 않음)
 *  4. 사용자가 클릭·드래그로 반응하면 정해진 순서로 자동 완성
 *     빙글빙글 회전이 빨라짐 → 은은한 빛이 차오름 → 빛이 가장 밝은 순간 완성된 큐브로 교체
 *     → 회전이 잦아들며 정면을 보여 줌 → 받침 위로 내려앉음
 *  5. 회상 텍스트 (사진 없이 글만) → 문양 점등 — interaction-manager 공통
 *
 *  · 사용자는 실제로 큐브를 풀지 않습니다. (이전의 직접 풀이 시스템은 사용하지 않음)
 *  · 완료 후에는 받침 위에 완성된 큐브가 남고, 다시 상호작용할 수 없습니다.
 * ========================================================================== */
'use strict';

(function () {
  const CFG = DP.CONFIG;
  const U = DP.Util;
  const K = DP.Kit;

  AFRAME.registerComponent('cube-object', {
    init() {
      this.cfg = K.place(this.el, 'cube');
      const root = this.el.object3D;
      this.done = false;
      this.ready = false;

      // 낮은 돌 받침
      K.mesh(root, new THREE.CylinderGeometry(0.3, 0.38, 0.9, 7), 'stone', { pos: [0, 0.45, 0] });
      K.mesh(root, new THREE.CylinderGeometry(0.36, 0.3, 0.1, 7), 'stoneDark', { pos: [0, 0.95, 0] });
      K.mesh(root, new THREE.SphereGeometry(1, 12, 6), 'sandMound', { pos: [0, 0.03, 0], scale: [0.85, 0.2, 0.8], cast: false });
      DP.World.addCircle(this.cfg.x, this.cfg.z, 0.45);
      K.mergeStatic(root, []);
      this.restY = 1.0;

      // 큐브 묶음 (섞인 것 / 완성된 것 + 빛)
      this.holder = K.group(root, [0, this.restY, 0], [0, 25, 0]);
      this.glow = K.glowSprite('#ffe2a8', 0.3);
      this.glow.position.y = 0.04;
      this.holder.add(this.glow);
      Promise.all([K.loadModel('cubeUnsolved'), K.loadModel('cubeSolved')]).then(([a, b]) => {
        this.unsolved = a.root;
        this.solved = b.root;
        this.solved.visible = false;
        this.holder.add(this.unsolved, this.solved);
        this.ready = true;
      });

      this.onDown = this.onDown.bind(this);
      this.onUp = this.onUp.bind(this);
      this.onMove = this.onMove.bind(this);
      this.spin = 0;
      const self = this;
      K.register({
        id: 'cube',
        el: this.el,
        countsTowardPortal: true,
        radius: this.cfg.radius,
        prompt: () => self.cfg.prompt,
        enabled: () => self.ready && !self.done,
        focus: (out) => self.holder.getWorldPosition(out),
        interact: (ctx) => self.interact(ctx),
      });
    },

    /** 월드 좌표 지점으로 holder 이동 (오브젝트 루트 좌표로 변환) */
    setWorld(p) {
      this.el.object3D.worldToLocal(this.holder.position.copy(p));
    },

    async interact(ctx) {
      const { camera } = ctx;
      const C = CFG.cube;
      const im = DP.Interaction;
      const start = this.holder.getWorldPosition(new THREE.Vector3());

      // 1인칭: 받침 위 큐브를 내려다봄 → 큐브가 떠올라 눈앞으로
      await camera.firstPersonAt(start, { duration: 0.9 });
      const front = K.frontOfCamera(camera.el.object3D, C.floatDistance, 0.03);
      DP.Audio.sfx('whoosh', start);
      const p = new THREE.Vector3();
      await U.tween(1.1, (e, t) => {
        p.lerpVectors(start, front, e);
        p.y += Math.sin(t * Math.PI) * 0.12;
        this.setWorld(p);
        this.holder.scale.setScalar(U.lerp(1, C.floatScale, e));
        this.holder.rotation.y += 0.02;
      });

      // 사용자 반응(클릭 또는 드래그)을 기다림
      im.hint(DP.NARRATIVE.memories.cube.situation.start);
      this.spin = 0;
      this.started = false;
      document.addEventListener('mousedown', this.onDown);
      document.addEventListener('mouseup', this.onUp);
      document.addEventListener('mousemove', this.onMove);
      await new Promise((resolve) => {
        this.startResolve = resolve;
        if (this.started) resolve();
      });
      im.hint(null);

      // 자동 완성 시퀀스
      let swapped = false;
      let lastSfx = 0;
      const axis = new THREE.Vector3(0.35, 1, 0.2).normalize();
      const q = new THREE.Quaternion();
      await U.tween(C.spinTime, (e, t) => {
        const speed = U.lerp(2, 16, Math.min(1, t * 1.3)) * (t < 0.82 ? 1 : U.lerp(1, 0.15, (t - 0.82) / 0.18));
        q.setFromAxisAngle(axis, speed * 0.016 + this.spin * 0.01);
        this.holder.quaternion.premultiply(q);
        this.spin *= 0.9;
        // 빛: 서서히 차오르다 교체 순간 가장 밝게 (교체를 가림)
        const g = t < 0.72 ? t / 0.72 : 1 - (t - 0.72) / 0.28;
        this.glow.material.opacity = 0.15 + g * 0.85;
        this.glow.scale.setScalar(0.12 + g * 0.3);
        if (!swapped && t >= 0.72) {
          swapped = true;
          this.unsolved.visible = false;
          this.solved.visible = true;
          this.holder.scale.setScalar(C.floatScale * 1.18);
          DP.Audio.sfx('cubeComplete');
        }
        if (swapped) this.holder.scale.setScalar(U.lerp(this.holder.scale.x, C.floatScale, 0.12));
        const now = performance.now();
        if (t < 0.7 && now - lastSfx > 380 - t * 250) {
          lastSfx = now;
          DP.Audio.sfx('cubeSpin');
        }
      }, U.ease.linear);
      this.detachInput();

      // 정면을 보여 주며 멈춤
      const fromQ = this.holder.quaternion.clone();
      const camQ = camera.el.object3D.getWorldQuaternion(new THREE.Quaternion());
      const rootQ = this.el.object3D.getWorldQuaternion(new THREE.Quaternion()).invert();
      const toQ = rootQ.multiply(camQ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0.62, 0)));
      await U.tween(0.9, (e) => {
        this.holder.quaternion.slerpQuaternions(fromQ, toQ, e);
        this.glow.material.opacity = U.lerp(this.glow.material.opacity, 0.25, 0.1);
      });
      await U.wait(0.8);

      // 받침 위로 내려앉음
      const from = this.holder.getWorldPosition(new THREE.Vector3());
      const fromQ2 = this.holder.quaternion.clone();
      const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(25), 0));
      const s0 = this.holder.scale.x;
      await U.tween(1.3, (e) => {
        p.lerpVectors(from, start, e);
        this.setWorld(p);
        this.holder.quaternion.slerpQuaternions(fromQ2, restQ, e);
        this.holder.scale.setScalar(U.lerp(s0, 1, e));
        this.glow.material.opacity = U.lerp(0.25, 0.1, e);
      });
      DP.Audio.sfx('clunk', start);
      this.done = true;
      return { completed: true };
    },

    onDown(e) {
      if (e.button !== 0) return;
      this.dragging = true;
      this.begin();
    },
    onUp() {
      this.dragging = false;
    },
    onMove(e) {
      if (!this.dragging) return;
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      if (Math.abs(dx) > 250 || Math.abs(dy) > 250) return;
      // 드래그: 화면 방향 그대로 큐브를 돌림 (시퀀스 중에는 회전에 힘을 더함)
      const k = CFG.cube.dragSensitivity;
      const qa = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * k);
      const qb = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * k);
      this.holder.quaternion.premultiply(qa).premultiply(qb);
      this.spin += Math.abs(dx) * 0.02;
      this.begin();
    },
    begin() {
      if (this.started) return;
      this.started = true;
      if (this.startResolve) this.startResolve();
    },
    detachInput() {
      document.removeEventListener('mousedown', this.onDown);
      document.removeEventListener('mouseup', this.onUp);
      document.removeEventListener('mousemove', this.onMove);
      this.dragging = false;
    },
  });
})();
