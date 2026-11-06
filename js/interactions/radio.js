/* ==========================================================================
 *  기억 02 — PRC-999K 무전기 (Radio.glb) — 기존 스피커를 대체
 *
 *  1. 접근하면 무전기에서 미세한 잡음 (가까울수록 조금 커짐)
 *  2. 3인칭: 손 뻗기(03) → 장치 조작(10)
 *  3. 1인칭: 무전기가 떠올라 화면 앞에 나타남 (손은 보이지 않음)
 *  4. 좌클릭 = 두드리기 → 무전기가 흔들리고 잡음 세기가 출렁임, 상황 자막 한 줄씩
 *  5. 세 번째에 희미한 교신음 (합성 신호음 — 실제 음성 아님) + 자막
 *  6. 무전기는 제자리로 → 회상 텍스트 → 문양 점등 (interaction-manager 공통)
 * ========================================================================== */
'use strict';

(function () {
  const CFG = DP.CONFIG;
  const U = DP.Util;
  const K = DP.Kit;

  AFRAME.registerComponent('radio-object', {
    init() {
      this.cfg = K.place(this.el, 'radio');
      const root = this.el.object3D;
      this.done = false;
      this.ready = false;

      // 반쯤 묻힌 납작한 바위
      K.mesh(root, new THREE.DodecahedronGeometry(0.5, 0), 'stoneDark', { pos: [0, 0.12, 0], scale: [1.1, 0.42, 0.85], rot: [0, 18, 0] });
      K.mesh(root, new THREE.SphereGeometry(1, 12, 6), 'sandMound', { pos: [0, 0.02, 0], scale: [0.95, 0.18, 0.8], cast: false });
      DP.World.addCircle(this.cfg.x, this.cfg.z, 0.5);
      K.mergeStatic(root, []);
      this.restPos = new THREE.Vector3(0, 0.33, 0);

      this.holder = K.group(root, [0, 0.33, 0], [3, 0, -4]);
      K.loadModel('radio').then((m) => {
        this.holder.add(m.root);
        this.ready = true;
      });

      this.shake = 0;
      this.shakeVel = 0;
      this.near = null; // 근처 잡음 음원
      const self = this;
      K.register({
        id: 'radio',
        el: this.el,
        countsTowardPortal: true,
        radius: this.cfg.radius,
        prompt: () => self.cfg.prompt,
        enabled: () => self.ready && !self.done,
        focus: (out) => K.worldPoint(self.holder, 0, 0.1, 0, out),
        interact: (ctx) => self.interact(ctx),
      });
    },

    setWorld(p) {
      this.el.object3D.worldToLocal(this.holder.position.copy(p));
    },

    async ensureStatic() {
      if (this.near || this.creating || !DP.Audio.ready) return;
      this.creating = true;
      const pos = this.holder.getWorldPosition(new THREE.Vector3());
      this.spatial = DP.Audio.createSpatial(pos, 'effects', 1.6);
      this.near = await DP.Audio.radioStatic(this.spatial.input);
      this.creating = false;
    },

    async interact(ctx) {
      const { camera, cine } = ctx;
      const R = CFG.radio;
      const T = DP.NARRATIVE.memories.radio.situation;
      const im = DP.Interaction;
      await this.ensureStatic();

      // 3인칭: 장치 조작 (10)
      await DP.Character.action('MACHINE_OPERATE', { maxSec: 2.2 });

      // 1인칭: 무전기가 눈앞으로 떠오름 (정면이 카메라를 향함)
      const start = this.holder.getWorldPosition(new THREE.Vector3());
      const startQ = this.holder.quaternion.clone();
      await camera.firstPersonAt(start.clone().add(new THREE.Vector3(0, 0.12, 0)), { duration: 0.9 });
      const camObj = camera.el.object3D;
      const front = K.frontOfCamera(camObj, R.floatDistance, 0.12);
      const rootInv = this.el.object3D.getWorldQuaternion(new THREE.Quaternion()).invert();
      const faceQ = rootInv.multiply(K.facingCamera(camObj)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0, 0)));
      DP.Audio.sfx('whoosh', start);
      const p = new THREE.Vector3();
      await U.tween(1.2, (e, t) => {
        p.lerpVectors(start, front, e);
        p.y += Math.sin(t * Math.PI) * 0.1;
        this.setWorld(p);
        this.holder.quaternion.slerpQuaternions(startQ, faceQ, e);
        if (this.near) this.near.setLevel(U.lerp(0.25, 0.45, e));
      });
      this.baseQ = this.holder.quaternion.clone();

      // 두드리기
      im.hint(T.start);
      for (let i = 0; i < R.knocksToSignal; i++) {
        await K.waitClick(0.35);
        if (i === 0) im.hint(null);
        DP.Audio.sfx('knock', this.holder.getWorldPosition(new THREE.Vector3()));
        this.shakeVel += 9 + i * 2;
        // 잡음이 확 커졌다가 조금씩 가라앉음 (두드릴수록 덜 거칠어짐)
        if (this.near) {
          this.near.setLevel(1.0 - i * 0.15, 0.03);
          setTimeout(() => this.near && this.near.setLevel(0.5 - i * 0.12, 0.5), 250);
        }
        if (T.knocks[i]) cine.caption(T.knocks[i], 3.2);
      }

      // 희미한 교신음
      await U.wait(0.9);
      if (this.near) this.near.setLevel(0.18, 0.8);
      const signal = this.spatial ? await DP.Audio.radioSignal(this.spatial.input) : null;
      await U.wait(1.4);
      cine.caption(T.signal, 4.2);
      await U.wait(4.4);
      if (signal) signal.stop(1.0);

      // 제자리로
      const from = this.holder.getWorldPosition(new THREE.Vector3());
      const fromQ = this.holder.quaternion.clone();
      await U.tween(1.2, (e) => {
        p.lerpVectors(from, start, e);
        this.setWorld(p);
        this.holder.quaternion.slerpQuaternions(fromQ, startQ, e);
        if (this.near) this.near.setLevel(U.lerp(0.18, 0, e));
      });
      DP.Audio.sfx('clunk', start);
      if (this.near) {
        this.near.stop(0.6);
        this.near = null;
      }
      this.baseQ = null;
      this.done = true;
      return { completed: true };
    },

    tick(t, dt) {
      if (!dt) return;
      const s = Math.min(dt, 100) / 1000;
      // 두드릴 때 흔들림 (감쇠 스프링)
      this.shakeVel += (-this.shake * 180 - this.shakeVel * 9) * s;
      this.shake += this.shakeVel * s;
      if (this.baseQ) {
        this.holder.quaternion.copy(this.baseQ);
        this.holder.rotateZ(this.shake * 0.03);
        this.holder.rotateX(this.shake * 0.015);
      }
      if (this.spatial) this.spatial.setPosition(this.holder.getWorldPosition(this.tmp || (this.tmp = new THREE.Vector3())));
      // 근처 미세 잡음 (탐험 중, 아직 완료 전)
      if (this.done || !DP.Audio.ready || DP.Interaction.busy) return;
      const camEl = this.camEl || (this.camEl = document.getElementById('camera'));
      const d = camEl.object3D.position.distanceTo(this.el.object3D.position);
      const near = CFG.radio.nearStatic;
      if (d < near) {
        this.ensureStatic();
        if (this.near) this.near.setLevel((1 - d / near) * 0.3, 0.4);
      } else if (this.near) this.near.setLevel(0, 0.6);
    },
  });
})();
