/* ==========================================================================
 *  핵심 상호작용 02 — 오래된 스피커 (Audio Interaction)
 *  · 전원을 켜면: 표시등 점등 → 시작음 → 공간 음향으로 음악 재생 → 콘 진동
 *  · 스피커 소리는 스피커 위치에서 들리며(거리 감쇠), 가까이 가면 이어폰 음악이 잠시 줄어듦
 *  · 다시 상호작용하면 꺼짐 (포털 진행도는 처음 켰을 때만)
 * ========================================================================== */
'use strict';

(function () {
  const U = DP.Util;
  const K = DP.Kit;

  AFRAME.registerComponent('speaker-object', {
    init() {
      this.cfg = K.place(this.el, 'speaker');
      const root = this.el.object3D;

      // 받침돌
      K.mesh(root, new THREE.BoxGeometry(0.95, 0.45, 0.72), 'stoneDark', { pos: [0, 0.2, 0], rot: [0, -4, 0] });
      K.mesh(root, new THREE.SphereGeometry(1, 12, 6), 'sandMound', { pos: [0, 0.02, 0], scale: [0.85, 0.16, 0.7], cast: false });

      // 캐비닛
      this.cab = K.group(root, [0, 0.43, 0]);
      const cab = this.cab;
      K.mesh(cab, new THREE.BoxGeometry(0.62, 0.8, 0.42), 'wood', { pos: [0, 0.4, 0] });
      K.mesh(cab, new THREE.BoxGeometry(0.56, 0.74, 0.02), 'plastic', { pos: [0, 0.4, 0.21] });
      // 손잡이
      K.mesh(cab, new THREE.BoxGeometry(0.34, 0.03, 0.05), 'metalDark', { pos: [0, 0.88, 0] });
      for (const sx of [-1, 1]) K.mesh(cab, new THREE.BoxGeometry(0.03, 0.08, 0.05), 'metalDark', { pos: [sx * 0.16, 0.84, 0] });

      // 콘 2개 (진동하는 부분)
      this.cones = [];
      const makeCone = (y, r) => {
        const g = K.group(cab, [0, y, 0.22]);
        K.mesh(g, new THREE.TorusGeometry(r, r * 0.12, 4, 16), 'metalDark', {});
        const cone = K.group(g, [0, 0, 0]);
        K.mesh(cone, new THREE.ConeGeometry(r * 0.92, r * 0.45, 16, 1, true), 'plasticLight', { rot: [-90, 0, 0], pos: [0, 0, -r * 0.2] });
        K.mesh(cone, new THREE.SphereGeometry(r * 0.25, 8, 4), 'plastic', { pos: [0, 0, -r * 0.05], scale: [1, 1, 0.5] });
        this.cones.push(cone);
      };
      makeCone(0.26, 0.17);
      makeCone(0.6, 0.075);

      // 조작부: 다이얼 + 표시등
      K.mesh(cab, new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), 'brass', { pos: [0.17, 0.73, 0.225], rot: [90, 0, 0] });
      this.led = K.mesh(cab, new THREE.SphereGeometry(0.016, 8, 6), 'ledOff', { pos: [-0.17, 0.73, 0.222], cast: false });
      this.ledOn = DP.World.emissiveMaterial('ledOn', 2.2);
      // 뒤로 늘어진 전선
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.2, 0.1, -0.21), new THREE.Vector3(0.28, -0.05, -0.4), new THREE.Vector3(0.1, -0.42, -0.7),
      ]);
      K.mesh(cab, new THREE.TubeGeometry(curve, 10, 0.008, 4), 'plastic', { cast: false });

      DP.World.addBox(this.cfg.x, this.cfg.z, 0.5, 0.4, this.cfg.rotY);
      // 움직이지 않는 부품 병합 (콘·표시등 제외)
      K.mergeStatic(root, [this.cab]);
      K.mergeStatic(this.cab, [...this.cones, this.led]);

      this.on = false;
      this.level = 0;
      this.spatial = null;
      this.loop = null;
      const self = this;
      K.register({
        id: 'speaker',
        el: this.el,
        countsTowardPortal: true,
        radius: this.cfg.radius,
        prompt: () => (self.on ? self.cfg.promptOff : self.cfg.prompt),
        enabled: () => true,
        focus: (out) => K.worldPoint(self.cab, 0, 0.4, 0, out),
        interact: (ctx) => self.interact(ctx),
      });
    },

    async interact(ctx) {
      const { camera, avatar } = ctx;
      const center = K.worldPoint(this.cab, 0, 0.4, 0.2);
      avatar.setPose('reachR', 0.7);
      await camera.moveTo({ ...camera.sideShot({ target: center, distance: 2.9, height: 1.6, lookHeight: 0.9, bias: 0.15 }), duration: 1.2 });
      await U.wait(0.25);
      DP.Audio.sfx('click', center);

      if (this.on) {
        this.on = false;
        this.led.material = DP.World.getMaterial('ledOff');
        if (this.loop) this.loop.stop(0.4);
        if (this.spatial) DP.Audio.spatialSources.delete(this.spatial);
        this.loop = null;
        await U.wait(0.9);
        return { completed: false };
      }

      this.on = true;
      this.led.material = this.ledOn;
      DP.Audio.sfx('startup', center);
      await U.wait(0.8);
      if (DP.Audio.ready) {
        if (!this.spatial) this.spatial = DP.Audio.createSpatial(center, 'effects', 2.2);
        this.loop = await DP.Audio.playLoop('speaker', 'radio', this.spatial.input);
        DP.Audio.spatialSources.add(this.spatial);
      }
      avatar.setPose('rest', 0.6);
      await U.wait(1.8); // 진동하는 스피커를 잠시 보여줌
      return { completed: true };
    },

    tick(t, dt) {
      if (!dt) return;
      let target = 0;
      if (this.on) {
        target = this.spatial ? this.spatial.level() * 1.6 : 0.3 + Math.sin(t * 0.02) * 0.2;
      }
      this.level += (target - this.level) * Math.min(1, dt / 50);
      const lv = this.level;
      this.cones[0].position.z = lv * 0.02;
      this.cones[0].scale.setScalar(1 + lv * 0.05);
      this.cones[1].position.z = lv * 0.012;
      // 캐비닛의 미세한 진동
      this.cab.position.x = (Math.random() - 0.5) * lv * 0.004;
      this.cab.rotation.z = (Math.random() - 0.5) * lv * 0.006;
    },
  });
})();
