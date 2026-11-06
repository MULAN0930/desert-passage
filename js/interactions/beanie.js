/* ==========================================================================
 *  핵심 상호작용 05 — 비니 (Wearable Interaction)
 *  · 부서진 기둥 위에 놓인 비니 → 캐릭터 상반신 클로즈업 → 비니가 머리로 이동해 씌워짐
 *  · 착용 후에는 캐릭터 머리(head-anchor)에 계속 남아 있음
 *  · 한 번 쓰면 다시 상호작용 대상이 되지 않음
 * ========================================================================== */
'use strict';

(function () {
  const U = DP.Util;
  const K = DP.Kit;

  AFRAME.registerComponent('beanie-object', {
    init() {
      this.cfg = K.place(this.el, 'beanie');
      const root = this.el.object3D;

      // 부서진 낮은 기둥
      K.mesh(root, new THREE.BoxGeometry(0.85, 0.22, 0.85), 'stoneDark', { pos: [0, 0.08, 0], rot: [0, 12, 0] });
      K.mesh(root, new THREE.CylinderGeometry(0.32, 0.34, 0.86, 12), 'stone', { pos: [0, 0.6, 0] });
      K.mesh(root, new THREE.BoxGeometry(0.42, 0.14, 0.32), 'stone', { pos: [-0.08, 1.06, 0.04], rot: [8, 30, 12] });
      K.mesh(root, new THREE.SphereGeometry(1, 12, 6), 'sandMound', { pos: [0, 0.03, 0], scale: [0.75, 0.18, 0.7], cast: false });
      DP.World.addCircle(this.cfg.x, this.cfg.z, 0.45);

      // 비니 (로우폴리 니트)
      this.beanie = K.group(root, [0.08, 1.07, -0.02], [-8, 20, 6]);
      K.mesh(this.beanie, new THREE.SphereGeometry(0.19, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 'knit', { scale: [1, 1.05, 1] });
      K.mesh(this.beanie, new THREE.CylinderGeometry(0.197, 0.2, 0.075, 14, 1, true), 'knitDark', { pos: [0, 0.03, 0] });
      K.mesh(this.beanie, new THREE.CylinderGeometry(0.02, 0.03, 0.03, 6), 'knitDark', { pos: [0, 0.205, 0] });

      K.mergeStatic(root, [this.beanie]); // 기둥 부품 병합

      this.worn = false;
      const self = this;
      K.register({
        id: 'beanie',
        el: this.el,
        countsTowardPortal: true,
        radius: this.cfg.radius,
        prompt: () => self.cfg.prompt,
        enabled: () => !self.worn,
        focus: (out) => self.beanie.getWorldPosition(out),
        interact: (ctx) => self.interact(ctx),
      });
    },

    async interact(ctx) {
      const { camera, avatar, gs } = ctx;
      const target = this.beanie.getWorldPosition(new THREE.Vector3());
      avatar.setPose('reachBoth', 0.7);
      await camera.moveTo({ ...camera.sideShot({ target, distance: 2.4, height: 1.75, lookHeight: 1.25 }), duration: 1.2 });
      await U.wait(0.2);

      // 상반신 정면 클로즈업으로 이동하며, 비니가 머리 위로 날아감
      const hf = K.headFrame();
      const camPos = hf.pos.clone().addScaledVector(hf.fwd, 1.55).addScaledVector(hf.right, 0.55);
      camPos.y += 0.05;
      const look = hf.pos.clone();
      look.y -= 0.12;
      const camMove = camera.moveTo({ pos: camPos, look, duration: 1.6 });

      const head = document.getElementById('head-anchor').object3D;
      head.attach(this.beanie); // 월드 위치를 유지한 채 머리에 붙임
      const fromP = this.beanie.position.clone();
      const fromQ = this.beanie.quaternion.clone();
      const toP = new THREE.Vector3(0, 0.035, 0.005);
      const toQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0, 0));
      DP.Audio.sfx('whoosh', target);
      avatar.setPose('toHead', 1.1);
      await U.tween(1.4, (e, t) => {
        this.beanie.position.lerpVectors(fromP, toP, e);
        this.beanie.position.y += Math.sin(t * Math.PI) * 0.35;
        this.beanie.quaternion.slerpQuaternions(fromQ, toQ, e);
      });
      // 눌러 쓰는 느낌
      await U.tween(0.35, (e, t) => {
        const sq = Math.sin(t * Math.PI) * 0.08;
        this.beanie.scale.set(1 + sq, 1 - sq, 1 + sq);
      });
      await camMove;
      this.worn = true;
      gs.data.beanie_worn = true;
      avatar.setPose('rest', 0.7);
      await U.wait(1.1);
      return { completed: true };
    },
  });
})();
