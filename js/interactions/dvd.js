/* ==========================================================================
 *  기억 03 — DVD / TV (TV.glb + DVD.glb + Remote_Control.glb)
 *
 *  · 2010년대 초반 평면 TV, DVD 플레이어, 리모컨을 돌 탁자 위에 함께 배치
 *  · TV 화면: GLB의 실제 화면 위치를 측정해 그 바로 앞에 얇은 판을 붙이고
 *            매 프레임 바뀌는 아날로그 노이즈를 그림 (CanvasTexture)
 *  1. 3인칭: 손 뻗기(03) → 리모컨 조작(04) → TV가 켜짐
 *  2. 1인칭: TV 앞에서 화면을 봄 (손은 보이지 않음)
 *  3. 좌클릭 = 채널 전환 (임시 채널 3개 — 밝기·노이즈 결·흔들림이 조금씩 다름)
 *     채널마다 회상 자막 한 줄
 *  4. 세 채널을 모두 보면 TV가 꺼지고 회상 텍스트 ([제작 중] 안내 포함) → 문양 점등
 *
 *  실제 영상으로 교체: js/narrative.js의 dvdScenes[i].src에 MP4/WebM 경로를 넣으면
 *  해당 채널은 노이즈 대신 그 영상을 재생합니다.
 * ========================================================================== */
'use strict';

(function () {
  const CFG = DP.CONFIG;
  const U = DP.Util;
  const K = DP.Kit;
  // 조사 결과: TV.glb 화면(검은 유리)은 본체 폭의 약 91%, 높이의 약 68%, 중심 높이는 본체 높이의 59%
  const SCREEN = { w: 0.885, h: 0.655, cy: 0.594 };

  AFRAME.registerComponent('dvd-object', {
    init() {
      this.cfg = K.place(this.el, 'dvd');
      const root = this.el.object3D;
      this.done = false;
      this.ready = false;
      this.on = false;
      this.channel = -1;

      // 돌 탁자
      for (const sx of [-1, 1]) K.mesh(root, new THREE.BoxGeometry(0.28, 0.6, 0.62), 'stoneDark', { pos: [sx * 0.6, 0.28, 0] });
      K.mesh(root, new THREE.BoxGeometry(1.6, 0.12, 0.82), 'stone', { pos: [0, 0.63, 0], rot: [0, 2, 0] });
      K.mesh(root, new THREE.SphereGeometry(1, 12, 6), 'sandMound', { pos: [0, 0.02, 0], scale: [1.05, 0.16, 0.62], cast: false });
      DP.World.addBox(this.cfg.x, this.cfg.z, 0.84, 0.45, this.cfg.rotY);
      K.mergeStatic(root, []);
      const top = 0.69;
      this.top = top;

      // 화면용 캔버스 (작게 그리고 늘려서 거친 아날로그 느낌)
      this.canvas = document.createElement('canvas');
      this.canvas.width = 160;
      this.canvas.height = 96;
      this.g = this.canvas.getContext('2d');
      this.img = this.g.createImageData(160, 96);
      this.tex = new THREE.CanvasTexture(this.canvas);
      this.tex.colorSpace = THREE.SRGBColorSpace;
      this.tex.magFilter = THREE.NearestFilter;
      this.screenMat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });

      this.tv = K.group(root, [0, top, -0.16]);
      this.player = K.group(root, [0.28, top, 0.2], [0, -6, 0]);
      this.remote = K.group(root, [-0.42, top + 0.012, 0.22], [-90, 0, 0]);
      Promise.all([K.loadModel('tv'), K.loadModel('dvdPlayer'), K.loadModel('remote')]).then(([tv, dvd, rc]) => {
        this.tv.add(tv.root);
        this.player.add(dvd.root);
        this.remote.add(rc.root);
        this.remote.rotation.z = THREE.MathUtils.degToRad(-25);
        this.buildScreen(tv.root, tv.size);
        // DVD 플레이어 표시등
        this.led = K.mesh(this.player, new THREE.SphereGeometry(0.006, 6, 4), new THREE.MeshBasicMaterial({ color: '#2a1a12' }), {
          pos: [-0.17, dvd.size.y * 0.55, dvd.size.z / 2 + 0.002],
        });
        this.ready = true;
      });

      const self = this;
      K.register({
        id: 'dvd',
        el: this.el,
        countsTowardPortal: true,
        radius: this.cfg.radius,
        prompt: () => self.cfg.prompt,
        enabled: () => self.ready && !self.done,
        focus: (out) => K.worldPoint(self.tv, 0, 0.32, 0, out),
        interact: (ctx) => self.interact(ctx),
      });
    },

    /** TV 앞면을 광선으로 찾아 화면 판을 붙임 (본체가 화면을 가리지 않도록 1.5mm 앞) */
    buildScreen(model, size) {
      model.updateMatrixWorld(true);
      const cy = size.y * SCREEN.cy;
      const ray = new THREE.Raycaster(new THREE.Vector3(0, cy, 2), new THREE.Vector3(0, 0, -1));
      const inv = new THREE.Matrix4().copy(this.tv.matrixWorld).invert();
      const o = new THREE.Vector3(0, cy, 2).applyMatrix4(this.tv.matrixWorld);
      const d = new THREE.Vector3(0, 0, -1).transformDirection(this.tv.matrixWorld);
      ray.set(o, d);
      const hit = ray.intersectObject(model, true)[0];
      const z = hit ? hit.point.clone().applyMatrix4(inv).z + 0.0015 : size.z / 2;
      this.screen = new THREE.Mesh(new THREE.PlaneGeometry(size.x * SCREEN.w, size.y * SCREEN.h), this.screenMat);
      this.screen.position.set(0, cy, z);
      this.screen.visible = false;
      this.tv.add(this.screen);
      this.screenInfo = { cy, z, w: size.x * SCREEN.w, h: size.y * SCREEN.h };
    },

    setChannel(i) {
      this.channel = i;
      const scene = DP.NARRATIVE.dvdScenes[i];
      this.look = (scene && scene.look) || { brightness: 0.8, grain: 1, roll: 0, tint: [1, 1, 1] };
      this.glitch = 0.35; // 채널이 바뀔 때 잠깐 하얗게 튐
      // 실제 영상이 지정된 채널이면 영상 텍스처
      if (this.video) {
        this.video.pause();
        this.video = null;
      }
      if (scene && scene.src) {
        const v = document.createElement('video');
        v.src = scene.src;
        v.loop = true;
        v.playsInline = true;
        v.crossOrigin = 'anonymous';
        v.play().catch((e) => console.warn('[dvd] 영상 재생 실패, 노이즈로 대체', e));
        this.video = v;
        this.screenMat.map = new THREE.VideoTexture(v);
      } else this.screenMat.map = this.tex;
      this.screenMat.needsUpdate = true;
      if (this.noise) this.noise.setLevel(scene && scene.src ? 0.1 : 0.55 + this.look.grain * 0.12);
    },

    async power(on) {
      this.on = on;
      if (this.screen) this.screen.visible = on;
      if (this.led) this.led.material.color.set(on ? '#5dff7a' : '#2a1a12');
      const pos = K.worldPoint(this.tv, 0, 0.3, 0.1);
      if (on) {
        DP.Audio.sfx('remote', pos);
        if (DP.Audio.ready && !this.noise) {
          this.spatial = DP.Audio.createSpatial(pos, 'effects', 1.4);
          this.noise = await DP.Audio.tvNoise(this.spatial.input);
          if (this.noise) this.noise.setLevel(0.5);
        }
      } else {
        DP.Audio.sfx('click', pos);
        if (this.noise) this.noise.stop(0.4);
        this.noise = null;
        if (this.video) this.video.pause();
      }
    },

    async interact(ctx) {
      const { camera, cine } = ctx;
      const im = DP.Interaction;
      const scenes = DP.NARRATIVE.dvdScenes;

      // 3인칭: 리모컨 조작(04) → TV가 켜짐
      const act = DP.Character.action('REMOTE_PRESS', { maxSec: 2.4 });
      await U.wait(0.6);
      this.setChannel(0);
      this.channel = -1; // 첫 화면은 채널 사이의 잡음
      this.look = { brightness: 0.75, grain: 1, roll: 0.2, tint: [1, 1, 1] };
      await this.power(true);
      await act;

      // 1인칭: TV 정면에서 화면을 봄
      const S = this.screenInfo;
      const look = K.worldPoint(this.tv, 0, S.cy, S.z);
      const pos = K.worldPoint(this.tv, 0, S.cy + 0.05, S.z + CFG.tv.viewDistance);
      await camera.firstPersonAt(look, { pos, duration: 1.3 });

      im.hint(DP.NARRATIVE.memories.dvd.situation.start);
      for (let i = 0; i < Math.min(CFG.tv.channels, scenes.length); i++) {
        await K.waitClick(0.4);
        if (i === 0) im.hint(null);
        DP.Audio.sfx('remote', look);
        this.setChannel(i);
        cine.caption(scenes[i].caption, 4.2);
        await U.wait(2.2);
      }
      await U.wait(2.4);
      await this.power(false);
      await U.wait(0.6);
      this.done = true;
      return { completed: true };
    },

    /** 노이즈 그리기 (TV가 켜져 있을 때만, 약 30fps) */
    tick(t) {
      if (!this.on || !this.screen || this.video || t - (this.lastDraw || 0) < 33) return;
      this.lastDraw = t;
      const L = this.look || { brightness: 0.8, grain: 1, roll: 0, tint: [1, 1, 1] };
      const W = 160;
      const H = 96;
      const d = this.img.data;
      const gs = L.grain; // 노이즈 알갱이 크기 (1~3)
      const roll = (t / 1000) * 40 * L.roll; // 위아래로 흐르는 띠
      this.glitch = Math.max(0, (this.glitch || 0) - 0.04);
      const flash = this.glitch;
      for (let y = 0; y < H; y += gs) {
        const band = Math.sin((y + roll) * 0.12) * 0.5 + 0.5;
        const shift = Math.random() < 0.03 * (1 + L.roll * 3) ? 1.4 : 1; // 가끔 한 줄이 밝게 튐
        for (let x = 0; x < W; x += gs) {
          let v = Math.random() * 255 * L.brightness * (0.75 + band * 0.25) * shift;
          v = Math.min(255, v + flash * 400);
          for (let yy = 0; yy < gs && y + yy < H; yy++) {
            for (let xx = 0; xx < gs && x + xx < W; xx++) {
              const i = ((y + yy) * W + x + xx) * 4;
              d[i] = v * L.tint[0];
              d[i + 1] = v * L.tint[1];
              d[i + 2] = v * L.tint[2];
              d[i + 3] = 255;
            }
          }
        }
      }
      this.g.putImageData(this.img, 0, 0);
      // 화면 흔들림: 가끔 화면 전체가 옆으로 밀림
      if (L.roll > 0 && Math.random() < 0.06 * L.roll) {
        this.g.drawImage(this.canvas, Math.round((Math.random() - 0.5) * 12), 0);
      }
      // 주사선
      this.g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < H; y += 2) this.g.fillRect(0, y, W, 1);
      this.tex.needsUpdate = true;
    },
  });
})();
