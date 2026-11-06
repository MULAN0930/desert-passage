/* ==========================================================================
 *  보조 상호작용 — 유선 이어폰 (프롤로그, 포털 진행에 포함되지 않음)
 *  · 처음에는 목에 걸쳐져 가슴 앞에 늘어져 있음
 *  · E: 카메라가 캐릭터에게 다가감 → 이어폰이 귀로 이동해 꽂힘 → 음악이 서서히 시작
 *       → 카메라가 머리 속으로 들어가 1인칭으로 전환, 탐험 시작
 *  · 이후 M 키로 음악만 켜고 끔 (바람·발소리 등 환경음은 계속 들림)
 * ========================================================================== */
'use strict';

(function () {
  const U = DP.Util;
  const K = DP.Kit;

  AFRAME.registerComponent('earphones-gear', {
    init() {
      const torsoEl = document.getElementById('avatar-torso');
      this.torso = torsoEl.object3D;
      this.buds = [];
      // 몸통 로컬 좌표 — 가슴 앞(늘어짐) / 귀(착용)
      this.hang = [new THREE.Vector3(-0.09, 0.4, -0.29), new THREE.Vector3(0.08, 0.36, -0.3)];
      this.ear = [new THREE.Vector3(-0.172, 0.79, -0.01), new THREE.Vector3(0.172, 0.79, -0.01)];
      for (let i = 0; i < 2; i++) {
        const b = K.group(this.torso, this.hang[i].toArray());
        K.mesh(b, new THREE.SphereGeometry(0.024, 8, 6), 'earphone', {});
        K.mesh(b, new THREE.CylinderGeometry(0.008, 0.01, 0.045, 6), 'earphone', { pos: [0, -0.03, 0] });
        this.buds.push(b);
      }
      this.yoke = new THREE.Vector3(0, 0.2, -0.3);
      this.pocket = new THREE.Vector3(0.21, -0.06, -0.3);
      this.cable = [];
      this.buildCable();
      // 줄기 (변하지 않음)
      const main = new THREE.CatmullRomCurve3([this.yoke, new THREE.Vector3(0.1, 0.08, -0.33), this.pocket]);
      K.mesh(this.torso, new THREE.TubeGeometry(main, 10, 0.005, 4), 'earphone', { cast: false });

      this.worn = false;
      const self = this;
      K.register({
        id: 'earphones',
        el: this.el,
        introOnly: true,
        countsTowardPortal: false,
        faceTarget: false,
        prompt: () => '이어폰 착용',
        enabled: () => !self.worn,
        interact: (ctx) => self.interact(ctx),
        after: () => U.toast('M 키로 음악을 켜고 끌 수 있습니다', 3.2),
      });
    },

    /** 이어폰 위치에 맞춰 양쪽 줄을 다시 그림 */
    buildCable() {
      for (const m of this.cable) {
        this.torso.remove(m);
        m.geometry.dispose();
      }
      this.cable = this.buds.map((b, i) => {
        const p = b.position.clone().add(new THREE.Vector3(0, -0.05, 0));
        const mid = p.clone().lerp(this.yoke, 0.5);
        mid.y -= 0.04;
        mid.z -= 0.02;
        mid.x += i ? 0.02 : -0.02;
        const curve = new THREE.CatmullRomCurve3([p, mid, this.yoke]);
        return K.mesh(this.torso, new THREE.TubeGeometry(curve, 12, 0.005, 4), 'earphone', { cast: false });
      });
    },

    async interact(ctx) {
      const { camera, avatar, gs } = ctx;
      // 카메라가 캐릭터에게 다가감
      const hf = K.headFrame();
      const camPos = hf.pos.clone().addScaledVector(hf.fwd, 1.25).addScaledVector(hf.right, -0.45);
      const look = hf.pos.clone();
      look.y -= 0.1;
      const camMove = camera.moveTo({ pos: camPos, look, duration: 1.8 });
      await U.wait(0.6);
      avatar.setPose('toHead', 0.9);
      await U.wait(0.4);

      // 이어폰이 귀로
      const from = this.buds.map((b) => b.position.clone());
      await U.tween(1.1, (e, t) => {
        this.buds.forEach((b, i) => {
          b.position.lerpVectors(from[i], this.ear[i], e);
          b.position.z -= Math.sin(t * Math.PI) * 0.08;
        });
        this.buildCable();
      });
      DP.Audio.sfx('plug');
      await camMove;
      this.worn = true;
      gs.data.earphones_worn = true;
      gs.data.music_enabled = true;
      DP.Audio.startMusic();
      DP.Audio.setMusicEnabled(true);
      avatar.setPose('rest', 0.8);
      await U.wait(1.6); // 음악이 서서히 들어오는 시간
      return { completed: false };
    },
  });
})();
