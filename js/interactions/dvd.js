/* ==========================================================================
 *  핵심 상호작용 03 — DVD (Object Manipulation)
 *  · 트레이가 열림 → 디스크가 떠올라 트레이로 들어감 → 트레이가 닫힘
 *    → 플레이어 표시등 점등 → 브라운관 TV에 재생 화면
 *  · 화면 영상은 저작권 문제가 없도록 코드로 직접 그린 추상 애니메이션입니다.
 *  · 다시 상호작용하면 재생을 멈춤 (포털 진행도는 처음 재생했을 때만)
 * ========================================================================== */
'use strict';

(function () {
  const U = DP.Util;
  const K = DP.Kit;

  AFRAME.registerComponent('dvd-object', {
    init() {
      this.cfg = K.place(this.el, 'dvd');
      const root = this.el.object3D;

      // 돌 탁자
      for (const sx of [-1, 1]) K.mesh(root, new THREE.BoxGeometry(0.28, 0.6, 0.62), 'stoneDark', { pos: [sx * 0.55, 0.28, 0] });
      K.mesh(root, new THREE.BoxGeometry(1.55, 0.12, 0.82), 'stone', { pos: [0, 0.63, 0], rot: [0, 2, 0] });
      K.mesh(root, new THREE.SphereGeometry(1, 12, 6), 'sandMound', { pos: [0, 0.02, 0], scale: [1.0, 0.16, 0.6], cast: false });
      const top = 0.69;

      // 브라운관 TV
      this.tv = K.group(root, [-0.3, top, -0.04], [0, 6, 0]);
      K.mesh(this.tv, new THREE.BoxGeometry(0.66, 0.52, 0.46), 'plasticLight', { pos: [0, 0.26, -0.02] });
      K.mesh(this.tv, new THREE.BoxGeometry(0.44, 0.36, 0.2), 'plasticLight', { pos: [0, 0.26, -0.3] });
      K.mesh(this.tv, new THREE.BoxGeometry(0.58, 0.44, 0.02), 'plastic', { pos: [0, 0.27, 0.21] });
      for (const [rx, rz] of [[-0.12, 20], [0.12, -24]]) {
        K.mesh(this.tv, new THREE.CylinderGeometry(0.006, 0.006, 0.42, 4), 'metalDark', { pos: [rx, 0.68, -0.1], rot: [0, 0, rz] });
      }
      this.canvas = document.createElement('canvas');
      this.canvas.width = 192;
      this.canvas.height = 144;
      this.ctx2d = this.canvas.getContext('2d');
      this.tex = new THREE.CanvasTexture(this.canvas);
      this.tex.colorSpace = THREE.SRGBColorSpace;
      this.screenOn = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
      this.screen = K.mesh(this.tv, new THREE.PlaneGeometry(0.5, 0.37), 'screenOff', { pos: [0, 0.27, 0.222], cast: false });

      // DVD 플레이어 + 트레이
      this.player = K.group(root, [0.42, top, 0.12], [0, -4, 0]);
      K.mesh(this.player, new THREE.BoxGeometry(0.5, 0.075, 0.32), 'plastic', { pos: [0, 0.0375, 0] });
      this.tray = K.group(this.player, [0.06, 0.03, 0.04]);
      K.mesh(this.tray, new THREE.BoxGeometry(0.28, 0.012, 0.26), 'plasticLight', {});
      K.mesh(this.tray, new THREE.CylinderGeometry(0.068, 0.068, 0.004, 20), 'plastic', { pos: [0, 0.006, 0] });
      this.led = K.mesh(this.player, new THREE.SphereGeometry(0.008, 6, 4), 'ledOff', { pos: [-0.19, 0.04, 0.162], cast: false });
      this.ledOn = DP.World.emissiveMaterial('ledGreen', 2.0);
      this.trayIn = this.tray.position.z;

      // 디스크 (케이스 위)
      K.mesh(root, new THREE.BoxGeometry(0.15, 0.014, 0.13), 'plastic', { pos: [0.52, top + 0.007, -0.24], rot: [0, 18, 0] });
      this.disc = K.group(root, [0.52, top + 0.018, -0.24]);
      const discMat = new THREE.MeshStandardMaterial({ color: '#d8d2c8', roughness: 0.25, metalness: 0.15, flatShading: false });
      K.mesh(this.disc, new THREE.CylinderGeometry(0.06, 0.06, 0.003, 24), discMat, {});
      K.mesh(this.disc, new THREE.CylinderGeometry(0.008, 0.008, 0.004, 10), 'plastic', {});
      K.mesh(this.disc, new THREE.CylinderGeometry(0.045, 0.045, 0.0035, 20), 'canvasStripe', { pos: [0, 0.0003, 0] });

      DP.World.addBox(this.cfg.x, this.cfg.z, 0.82, 0.45, this.cfg.rotY);
      // 움직이지 않는 부품 병합 (화면·트레이·표시등·디스크 제외)
      K.mergeStatic(root, [this.tv, this.player, this.disc]);
      K.mergeStatic(this.tv, [this.screen]);
      K.mergeStatic(this.player, [this.tray, this.led]);

      this.discInside = false;
      this.playing = false;
      this.boot = 0;
      this.lastDraw = 0;
      const self = this;
      K.register({
        id: 'dvd',
        el: this.el,
        countsTowardPortal: true,
        radius: this.cfg.radius,
        prompt: () => (self.playing ? self.cfg.promptOff : self.cfg.prompt),
        enabled: () => true,
        focus: (out) => K.worldPoint(root, 0, top + 0.2, 0, out),
        interact: (ctx) => self.interact(ctx),
      });
    },

    async moveTray(open) {
      DP.Audio.sfx('tray', K.worldPoint(this.player, 0, 0, 0));
      const from = this.tray.position.z;
      const to = open ? this.trayIn + 0.22 : this.trayIn;
      await U.tween(0.55, (e) => (this.tray.position.z = U.lerp(from, to, e)));
    },

    async interact(ctx) {
      const { camera, avatar } = ctx;
      const focus = K.worldPoint(this.el.object3D, 0.05, 0.85, 0);
      avatar.setPose('reachR', 0.7);
      await camera.moveTo({ ...camera.sideShot({ target: focus, distance: 2.1, height: 1.5, lookHeight: 0.9, bias: 0.2 }), duration: 1.2 });

      if (this.playing) {
        DP.Audio.sfx('click', focus);
        this.stopPlayback();
        await U.wait(0.8);
        return { completed: false };
      }

      // 1) 트레이 열림
      await this.moveTray(true);
      // 2) 디스크가 트레이로
      if (!this.discInside) {
        const root = this.el.object3D;
        const from = this.disc.position.clone();
        const target = K.worldPoint(this.tray, 0, 0.01, 0);
        root.worldToLocal(target);
        const spin0 = this.disc.rotation.y;
        await U.tween(1.15, (e) => {
          this.disc.position.lerpVectors(from, target, e);
          this.disc.position.y += Math.sin(e * Math.PI) * 0.2;
          this.disc.rotation.y = spin0 + e * Math.PI * 2;
          this.disc.rotation.x = Math.sin(e * Math.PI) * 0.35;
        });
        this.tray.attach(this.disc);
        this.disc.position.set(0, 0.01, 0);
        this.disc.rotation.set(0, 0, 0);
        this.discInside = true;
      } else {
        await U.wait(0.3);
      }
      // 3) 트레이 닫힘 + 표시등
      await this.moveTray(false);
      DP.Audio.sfx('clunk', focus);
      this.led.material = this.ledOn;
      avatar.setPose('rest', 0.6);
      await U.wait(0.35);
      // 4) TV 켜짐
      const tvPos = K.worldPoint(this.tv, 0, 0.27, 0.2);
      DP.Audio.sfx('static', tvPos);
      this.screen.material = this.screenOn;
      this.playing = true;
      this.boot = performance.now();
      await camera.moveTo({ pos: K.worldPoint(this.tv, 0.35, 0.45, 1.25), look: K.worldPoint(this.tv, 0, 0.27, 0), duration: 1.4 });
      if (DP.Audio.ready) {
        if (!this.spatial) this.spatial = DP.Audio.createSpatial(tvPos, 'effects', 1.8);
        this.loop = await DP.Audio.playLoop('dvd', 'musicbox', this.spatial.input);
        DP.Audio.spatialSources.add(this.spatial);
      }
      await U.wait(2.2);
      return { completed: true };
    },

    stopPlayback() {
      this.playing = false;
      this.screen.material = DP.World.getMaterial('screenOff');
      this.led.material = DP.World.getMaterial('ledOff');
      if (this.loop) this.loop.stop(0.4);
      if (this.spatial) DP.Audio.spatialSources.delete(this.spatial);
      this.loop = null;
    },

    /* 화면: 부팅 잡음 → 직접 그린 사막 풍경 애니메이션 (12fps) */
    tick(t) {
      if (!this.playing || t - this.lastDraw < 83) return;
      this.lastDraw = t;
      const g = this.ctx2d;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const since = (performance.now() - this.boot) / 1000;
      if (since < 0.9) {
        const img = g.createImageData(W, H);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 255;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
      } else {
        const s = since - 0.9;
        const sky = g.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#2b2a4a');
        sky.addColorStop(0.55, '#c86b4a');
        sky.addColorStop(1, '#f2b46a');
        g.fillStyle = sky;
        g.fillRect(0, 0, W, H);
        // 해
        const sy = H * 0.55 + Math.sin(s * 0.25) * 10;
        g.fillStyle = 'rgba(255,226,170,0.95)';
        g.beginPath();
        g.arc(W * 0.68, sy, 16, 0, Math.PI * 2);
        g.fill();
        // 모래언덕 3겹 (시차 이동)
        const layers = [['#a4553a', 0.62, 6, 0.6], ['#7c3f2e', 0.74, 9, 1.2], ['#4e2a22', 0.86, 12, 2.2]];
        for (const [col, base, amp, speed] of layers) {
          g.fillStyle = col;
          g.beginPath();
          g.moveTo(0, H);
          for (let x = 0; x <= W; x += 6) {
            const y = H * base + Math.sin((x + s * 20 * speed) * 0.035) * amp + Math.sin((x + s * 9 * speed) * 0.09) * amp * 0.3;
            g.lineTo(x, y);
          }
          g.lineTo(W, H);
          g.fill();
        }
        // 걷는 작은 형체
        const wx = W * 0.32;
        const wy = H * 0.74 + Math.sin((wx + s * 24) * 0.035) * 9 - 10;
        g.fillStyle = '#2a1712';
        g.fillRect(wx - 2, wy, 4, 9);
        g.beginPath();
        g.arc(wx, wy - 2, 2.4, 0, Math.PI * 2);
        g.fill();
        // 주사선 + 비네팅
        g.fillStyle = 'rgba(0,0,0,0.12)';
        for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
        const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
        v.addColorStop(0, 'rgba(0,0,0,0)');
        v.addColorStop(1, 'rgba(0,0,0,0.55)');
        g.fillStyle = v;
        g.fillRect(0, 0, W, H);
      }
      this.tex.needsUpdate = true;
    },
  });
})();
