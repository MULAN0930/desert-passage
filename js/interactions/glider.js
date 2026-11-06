/* ==========================================================================
 *  핵심 상호작용 04 — 글라이더 (Mechanical Interaction)
 *  · 판타지 글라이더에서 영감을 받은 독자 디자인 (특정 작품의 기체를 복제하지 않음)
 *    넓은 천 날개 + 나무 골조 + 뒤쪽 엔진과 프로펠러
 *  · 시동: 점화음과 함께 프로펠러가 덜컥거리며 돌기 시작 → 엔진 소리 → 기체 진동 → 모래가 날림
 *  · 비행은 하지 않습니다. 다시 상호작용하면 시동이 꺼짐
 * ========================================================================== */
'use strict';

(function () {
  const U = DP.Util;
  const K = DP.Kit;
  const CFG = DP.CONFIG;

  AFRAME.registerComponent('glider-object', {
    init() {
      this.cfg = K.place(this.el, 'glider');
      const root = this.el.object3D;
      this.body = K.group(root, [0, 0.36, 0], [0, 0, 5]); // 한쪽 날개가 모래에 닿도록 살짝 기울임
      const b = this.body;

      // 날개 (위에서 본 윤곽을 압출)
      const s = new THREE.Shape();
      const pts = [[0, 0.55], [0.7, 0.42], [2.7, -0.12], [2.78, -0.42], [1.25, -0.56], [0.38, -0.78], [0, -0.64]];
      const full = pts.concat(pts.slice(1, -1).reverse().map(([x, y]) => [-x, y]));
      s.moveTo(full[0][0], full[0][1]);
      for (let i = 1; i < full.length; i++) s.lineTo(full[i][0], full[i][1]);
      s.closePath();
      const wingGeo = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false });
      wingGeo.rotateX(-Math.PI / 2);
      K.mesh(b, wingGeo, 'canvas', { pos: [0, 0.22, 0] });
      // 날개 끝 줄무늬
      for (const sx of [-1, 1]) {
        K.mesh(b, new THREE.BoxGeometry(0.5, 0.012, 0.06), 'canvasStripe', { pos: [sx * 2.2, 0.262, 0.2], rot: [0, sx * 14, 0] });
        K.mesh(b, new THREE.BoxGeometry(0.5, 0.012, 0.06), 'canvasStripe', { pos: [sx * 2.2, 0.262, 0.32], rot: [0, sx * 14, 0] });
      }
      // 날개 골조
      for (const sx of [-1, 1]) {
        for (const [x, rz] of [[0.9, 0], [1.8, 0]]) {
          K.mesh(b, new THREE.CylinderGeometry(0.014, 0.014, 0.85, 5), 'wood', { pos: [sx * x, 0.205, 0.05], rot: [90, 0, rz] });
        }
      }
      K.mesh(b, new THREE.CylinderGeometry(0.02, 0.02, 4.8, 6), 'wood', { pos: [0, 0.2, -0.05], rot: [0, 0, 90] });

      // 동체 + 기수
      K.mesh(b, new THREE.CylinderGeometry(0.13, 0.17, 2.0, 10), 'woodLight', { pos: [0, 0.05, 0.25], rot: [90, 0, 0] });
      K.mesh(b, new THREE.ConeGeometry(0.13, 0.42, 10), 'woodLight', { pos: [0, 0.05, -0.96], rot: [-90, 0, 0] });
      // 조종 손잡이
      K.mesh(b, new THREE.CylinderGeometry(0.012, 0.012, 0.6, 5), 'metalDark', { pos: [0, -0.06, -0.3], rot: [0, 0, 90] });
      for (const sx of [-1, 1]) K.mesh(b, new THREE.CylinderGeometry(0.01, 0.01, 0.2, 5), 'metalDark', { pos: [sx * 0.28, 0.02, -0.3] });
      // 썰매(스키드)
      for (const sx of [-1, 1]) K.mesh(b, new THREE.BoxGeometry(0.04, 0.04, 1.7), 'metalDark', { pos: [sx * 0.16, -0.3, 0.2] });
      for (const z of [-0.35, 0.75]) for (const sx of [-1, 1]) {
        K.mesh(b, new THREE.CylinderGeometry(0.012, 0.012, 0.26, 4), 'metalDark', { pos: [sx * 0.15, -0.17, z] });
      }

      // 엔진 + 프로펠러 (뒤쪽 위)
      this.engine = K.group(b, [0, 0.42, 0.8]);
      K.mesh(this.engine, new THREE.CylinderGeometry(0.16, 0.18, 0.55, 12), 'metalDark', { rot: [90, 0, 0] });
      K.mesh(this.engine, new THREE.TorusGeometry(0.15, 0.025, 4, 12), 'brass', { pos: [0, 0, 0.28] });
      for (const sx of [-1, 1]) K.mesh(this.engine, new THREE.BoxGeometry(0.03, 0.22, 0.05), 'metalDark', { pos: [sx * 0.08, -0.17, 0] });
      this.prop = K.group(this.engine, [0, 0, 0.36]);
      K.mesh(this.prop, new THREE.ConeGeometry(0.06, 0.12, 8), 'brass', { rot: [90, 0, 0] });
      for (let i = 0; i < 3; i++) {
        const blade = K.group(this.prop, [0, 0, 0], [0, 0, i * 120]);
        K.mesh(blade, new THREE.BoxGeometry(0.07, 0.56, 0.018), 'wood', { pos: [0, 0.3, 0], rot: [0, 18, 0] });
      }

      // 날리는 모래 (시동 중에만)
      this.puffCount = 160;
      this.puffPos = new Float32Array(this.puffCount * 3);
      this.puffVel = new Float32Array(this.puffCount * 3);
      this.puffLife = new Float32Array(this.puffCount);
      const pg = new THREE.BufferGeometry();
      this.puffAttr = new THREE.BufferAttribute(this.puffPos, 3);
      this.puffAttr.setUsage(THREE.DynamicDrawUsage);
      pg.setAttribute('position', this.puffAttr);
      this.puffMat = new THREE.PointsMaterial({ color: CFG.palette.sand[2], size: 0.09, transparent: true, opacity: 0, depthWrite: false });
      this.puff = new THREE.Points(pg, this.puffMat);
      this.puff.frustumCulled = false;
      root.add(this.puff);

      // 움직이지 않는 부품 병합 (기체 전체는 진동하므로 기체 안에서만, 프로펠러 제외)
      K.mergeStatic(b, [this.engine]);
      K.mergeStatic(this.engine, [this.prop]);

      // 충돌: 날개 + 동체
      DP.World.addBox(this.cfg.x, this.cfg.z, 2.8, 0.7, this.cfg.rotY);
      DP.World.addBox(this.cfg.x, this.cfg.z, 0.3, 1.3, this.cfg.rotY);

      this.running = false;
      this.spin = 0;
      this.shake = 0;
      const self = this;
      K.register({
        id: 'glider',
        el: this.el,
        countsTowardPortal: true,
        radius: this.cfg.radius,
        prompt: () => (self.running ? self.cfg.promptOff : self.cfg.prompt),
        enabled: () => true,
        focus: (out) => K.worldPoint(self.body, 0, 0.1, 0, out),
        interact: (ctx) => self.interact(ctx),
      });
    },

    async interact(ctx) {
      const { camera, avatar } = ctx;
      const center = K.worldPoint(this.body, 0, 0.1, 0.2);
      const enginePos = K.worldPoint(this.engine, 0, 0, 0);
      avatar.setPose('pull', 0.6);
      await camera.moveTo({ ...camera.sideShot({ target: center, distance: 4.4, height: 2.1, lookHeight: 0.75, bias: 0.15 }), duration: 1.4 });

      if (this.running) {
        this.running = false;
        if (this.engineSound) this.engineSound.stop(1.4);
        this.engineSound = null;
        await U.tween(1.6, (e) => (this.spin = U.lerp(38, 0, e)), U.ease.out);
        return { completed: false };
      }

      // 점화: 덜컥거리는 프로펠러
      await U.wait(0.25);
      DP.Audio.sfx('ignite', enginePos);
      avatar.setPose('reachR', 0.3).then(() => avatar.setPose('pull', 0.3));
      await U.tween(1.1, (e, t) => {
        this.spin = (Math.sin(t * 40) > 0.3 ? 14 : 2) * t;
        this.shake = 0.6 * t;
      }, U.ease.linear);
      // 엔진 가동
      this.running = true;
      if (DP.Audio.ready) {
        if (!this.spatial) this.spatial = DP.Audio.createSpatial(enginePos, 'effects', 2.5);
        this.engineSound = DP.Audio.engineLoop(this.spatial);
      }
      await U.tween(1.2, (e) => (this.spin = U.lerp(14, 38, e)));
      avatar.setPose('rest', 0.6);
      await U.wait(1.6);
      return { completed: true };
    },

    tick(t, dt) {
      if (!dt) return;
      const s = Math.min(dt, 100) / 1000;
      this.prop.rotation.z += this.spin * s;
      // 진동
      const targetShake = this.running ? 1 : 0;
      this.shake += (targetShake - this.shake) * Math.min(1, s * 2);
      const k = this.shake;
      this.body.position.y = 0.36 + (Math.random() - 0.5) * 0.008 * k;
      this.body.rotation.x = (Math.random() - 0.5) * 0.006 * k;
      this.engine.position.x = (Math.random() - 0.5) * 0.01 * k;

      // 모래 날림: 프로펠러 뒤에서 생성되어 뒤로 퍼짐
      this.puffMat.opacity = 0.55 * k;
      if (k < 0.02) return;
      const P = this.puffPos;
      const V = this.puffVel;
      for (let i = 0; i < this.puffCount; i++) {
        this.puffLife[i] -= s;
        const j = i * 3;
        if (this.puffLife[i] <= 0) {
          this.puffLife[i] = 0.6 + Math.random() * 1.2;
          P[j] = (Math.random() - 0.5) * 0.6;
          P[j + 1] = 0.05 + Math.random() * 0.2;
          P[j + 2] = 1.4 + Math.random() * 0.3;
          V[j] = (Math.random() - 0.5) * 1.6;
          V[j + 1] = 0.2 + Math.random() * 0.6;
          V[j + 2] = 2 + Math.random() * 2.5;
        }
        P[j] += V[j] * s;
        P[j + 1] = Math.max(0.02, P[j + 1] + V[j + 1] * s);
        P[j + 2] += V[j + 2] * s;
        V[j + 1] -= 0.9 * s;
      }
      this.puffAttr.needsUpdate = true;
    },
  });
})();
