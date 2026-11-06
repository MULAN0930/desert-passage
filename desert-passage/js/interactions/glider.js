/* ==========================================================================
 *  기억 04 — 글라이더 (Glider.glb)
 *  · 하얀 개인용 비행체, 기수 중앙 전면에 파란 추진구 (GLB 그대로 사용, 프로펠러 없음)
 *  · 추진구 위치는 모델을 광선으로 측정해서 찾음 (기수 가운데 가장 앞쪽 면)
 *
 *  1. 3인칭: 손 뻗기(03) → 장치 조작(10)
 *  2. 1인칭: 기수 앞에서 추진구를 봄 (손은 보이지 않음)
 *  3. 추진구가 푸르게 빛나기 시작 → 낮은 시동음이 점점 커짐 → 기체가 미세하게 떨림
 *  4. 빛이 불안정하게 깜빡임 → 시동 실패 → 빛과 소리가 사그라듦
 *  5. 회상 텍스트 → 문양 점등 (interaction-manager 공통)
 *
 *  · 실패는 플레이어 잘못이 아니라 정해진 연출입니다. 글라이더는 절대 이륙하지 않습니다.
 * ========================================================================== */
'use strict';

(function () {
  const CFG = DP.CONFIG;
  const U = DP.Util;
  const K = DP.Kit;

  AFRAME.registerComponent('glider-object', {
    init() {
      this.cfg = K.place(this.el, 'glider');
      const root = this.el.object3D;
      this.done = false;
      this.ready = false;
      this.vibe = 0;

      K.mesh(root, new THREE.SphereGeometry(1, 12, 6), 'sandMound', { pos: [0.4, 0.0, 0.3], scale: [2.4, 0.2, 1.6], cast: false });
      K.mergeStatic(root, []);
      this.body = K.group(root, [0, 0, 0], [0, 0, 4]); // 한쪽 날개가 모래에 살짝 기움

      // 추진구 빛 (처음부터 만들어 두고 세기만 바꿈 → 조명 수 변화로 인한 셰이더 재컴파일 없음)
      const color = new THREE.Color(CFG.glider.thrusterColor);
      this.light = new THREE.PointLight(color, 0, 4, 2);
      this.glow = K.glowSprite(color, 0.9);
      this.core = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      this.thruster = K.group(this.body, [0, 0.45, 1]);
      this.thruster.add(this.light, this.glow, this.core); // 원판은 기본으로 정면(+Z)을 향함

      K.loadModel('glider').then((m) => {
        this.body.add(m.root);
        this.size = m.size;
        this.findThruster(m.root, m.size);
        this.ready = true;
      });

      // 충돌: 날개 + 동체 (모델 크기 기준)
      DP.World.addBox(this.cfg.x, this.cfg.z, 2.2, 0.45, this.cfg.rotY);
      DP.World.addBox(this.cfg.x, this.cfg.z, 0.45, 0.9, this.cfg.rotY);

      const self = this;
      K.register({
        id: 'glider',
        el: this.el,
        countsTowardPortal: true,
        radius: this.cfg.radius,
        prompt: () => self.cfg.prompt,
        enabled: () => self.ready && !self.done,
        focus: (out) => self.thruster.getWorldPosition(out),
        interact: (ctx) => self.interact(ctx),
      });
    },

    /** 기수 정면(+Z 쪽, 플레이어가 다가오는 쪽)에서 -Z로 광선을 쏴서 가장 앞으로 나온 중앙 지점 = 추진구 */
    findThruster(model, size) {
      this.body.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      const toLocal = new THREE.Matrix4().copy(this.body.matrixWorld).invert();
      const hits = [];
      for (let y = 0.1; y < size.y * 0.95; y += 0.025) {
        const o = new THREE.Vector3(0, y, size.z).applyMatrix4(this.body.matrixWorld);
        const d = new THREE.Vector3(0, 0, -1).transformDirection(this.body.matrixWorld);
        ray.set(o, d);
        const hit = ray.intersectObject(model, true)[0];
        if (hit) hits.push(hit.point.clone().applyMatrix4(toLocal));
      }
      if (hits.length) {
        // 기수 앞면(가장 앞에서 30cm 이내)의 위아래 가운데 = 추진구 중심 (구멍 안쪽은 움푹하므로 '가장 앞점'을 쓰지 않음)
        const maxZ = Math.max(...hits.map((h) => h.z));
        const nose = hits.filter((h) => h.z > maxZ - 0.3);
        const ys = nose.map((h) => h.y);
        this.thruster.position.set(0, (Math.min(...ys) + Math.max(...ys)) / 2, maxZ + 0.02);
      }
      const r = Math.max(0.12, size.y * 0.13);
      this.core.scale.setScalar(r);
      this.thrusterRadius = r;
    },

    setPower(k, flicker = 0) {
      const f = 1 - flicker * Math.random();
      const v = Math.max(0, k * f);
      this.light.intensity = v * 3.2;
      this.glow.material.opacity = Math.min(1, v * 0.95);
      this.glow.scale.setScalar(0.6 + v * 1.1);
      this.core.material.opacity = Math.min(0.9, v * 1.2);
    },

    async interact(ctx) {
      const { camera, cine } = ctx;
      const G = CFG.glider;
      const T = DP.NARRATIVE.memories.glider.situation;

      // 3인칭: 장치 조작(10)
      await DP.Character.action('MACHINE_OPERATE', { maxSec: 2.2 });

      // 1인칭: 기수 앞에서 추진구를 봄
      const look = this.thruster.getWorldPosition(new THREE.Vector3());
      const pos = K.worldPoint(this.body, 0.55, this.thruster.position.y + 0.55, this.thruster.position.z + G.viewDistance);
      pos.y = Math.max(pos.y, DP.World.groundAt(pos.x, pos.z) + 1.0);
      await camera.firstPersonAt(look, { pos, duration: 1.4 });
      await U.wait(0.4);

      // 시동 시도
      cine.caption(T.start, 2.6);
      const spatial = DP.Audio.ready ? DP.Audio.createSpatial(look, 'effects', 2.2) : null;
      const engine = spatial ? DP.Audio.gliderEngine(spatial.input) : null;
      if (engine) DP.Audio.sfx('ignite', look);
      await U.tween(G.attemptTime, (e, t) => {
        // 0~70%: 빛·소리가 차오름 / 70~100%: 불안정
        const unstable = U.smoothstep(0.6, 1, t);
        const k = U.smoothstep(0, 0.65, t) * (1 - unstable * 0.25);
        this.setPower(k, unstable * 0.8);
        if (engine) engine.setProgress(U.smoothstep(0, 0.75, t));
        this.vibe = 0.2 + t * 0.9;
      }, U.ease.linear);

      // 실패: 흔들리며 사그라듦
      if (engine) engine.fail(1.8);
      await U.tween(1.9, (e, t) => {
        const k = (1 - t) * (0.4 + Math.random() * 0.6) * (t < 0.6 ? 1 : 0.4);
        this.setPower(k * 0.8, 0.5);
        this.vibe = (1 - t) * 1.1;
      }, U.ease.linear);
      this.setPower(0);
      this.vibe = 0;
      if (T.fail) cine.caption(T.fail, 2);
      await U.wait(2.2);
      this.done = true;
      return { completed: true };
    },

    tick() {
      // 시동 중 기체 진동
      const k = this.vibe;
      if (k > 0.01) {
        this.body.position.set((Math.random() - 0.5) * 0.008 * k, (Math.random() - 0.5) * 0.01 * k, 0);
        this.body.rotation.x = (Math.random() - 0.5) * 0.004 * k;
      } else if (this.body.position.lengthSq() > 0) {
        this.body.position.set(0, 0, 0);
        this.body.rotation.x = 0;
      }
    },
  });
})();
