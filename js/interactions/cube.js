/* ==========================================================================
 *  핵심 상호작용 01 — 큐브 (Puzzle)
 *  · 27칸(실제로는 바깥 26개) 큐브를 절차적으로 생성, 실제 면 회전으로 맞춤
 *  · 처음에는 config.cube.scrambleMoves만큼 섞여 있음
 *  · 조작: U D L R F B (Shift = 반대 방향), Backspace = 되돌리기, Q = 그만두기
 *          마우스 드래그 = 큐브 전체를 돌려 보기 (카메라는 고정)
 *  · 구조: view(전체 회전, 보기 전용) → cube(퍼즐 논리) → 조각 26개
 *          전체 회전은 view에만 적용되므로 조각의 위치·방향(퍼즐 데이터)은 바뀌지 않음
 *  · 완성 판정: 가운데 칸을 제외한 모든 조각이 원래 위치·방향일 때 (cube 기준 좌표)
 *  · 다시 상호작용하면 새로 섞여서 다시 맞출 수 있음 (포털 진행도는 증가하지 않음)
 * ========================================================================== */
'use strict';

(function () {
  const CFG = DP.CONFIG;
  const U = DP.Util;
  const K = DP.Kit;
  const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  const KEY_TO_FACE = { KeyU: 'U', KeyD: 'D', KeyL: 'L', KeyR: 'R', KeyF: 'F', KeyB: 'B' };
  const IDENTITY = new THREE.Quaternion();

  AFRAME.registerComponent('cube-object', {
    init() {
      this.cfg = K.place(this.el, 'cube');
      const root = this.el.object3D;
      const C = CFG.cube;
      this.sp = C.size / 3;

      // 받침돌
      K.mesh(root, new THREE.BoxGeometry(0.6, 0.92, 0.6), 'stone', { pos: [0, 0.42, 0] });
      K.mesh(root, new THREE.BoxGeometry(0.74, 0.08, 0.74), 'stoneLight', { pos: [0, 0.92, 0], rot: [0, 8, 0] });
      K.mesh(root, new THREE.SphereGeometry(1, 12, 6), 'sandMound', { pos: [0, 0.02, 0], scale: [0.7, 0.16, 0.7], cast: false });
      DP.World.addBox(this.cfg.x, this.cfg.z, 0.38, 0.38, this.cfg.rotY);

      // 큐브: view = 보기용 전체 회전 / cube = 퍼즐 (면 회전은 cube 좌표계에서만)
      this.baseY = 0.96 + C.size / 2 + 0.01;
      this.view = K.group(root, [0, this.baseY, 0]);
      this.cube = K.group(this.view, [0, 0, 0]);
      this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, flatShading: true });
      const inner = new THREE.Color('#1c1814');
      const faceColor = {};
      for (const [k, f] of Object.entries(C.faces)) faceColor[k] = new THREE.Color(f.color);
      // BoxGeometry 면 순서: +x, -x, +y, -y, +z, -z
      const faceOrder = [['x', 1], ['x', -1], ['y', 1], ['y', -1], ['z', 1], ['z', -1]];
      const faceKey = (axis, sign) => Object.keys(C.faces).find((k) => C.faces[k].axis === axis && C.faces[k].sign === sign);
      this.cubies = [];
      for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
          for (let z = -1; z <= 1; z++) {
            if (!x && !y && !z) continue;
            const geo = new THREE.BoxGeometry(this.sp * 0.94, this.sp * 0.94, this.sp * 0.94);
            const colors = new Float32Array(24 * 3);
            faceOrder.forEach(([axis, sign], fi) => {
              const coord = { x, y, z }[axis];
              const col = coord === sign ? faceColor[faceKey(axis, sign)] : inner;
              for (let v = 0; v < 4; v++) colors.set([col.r, col.g, col.b], (fi * 4 + v) * 3);
            });
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            const m = K.mesh(this.cube, geo, this.material, { pos: [x * this.sp, y * this.sp, z * this.sp] });
            m.userData.home = m.position.clone();
            m.userData.isCenter = Math.abs(x) + Math.abs(y) + Math.abs(z) === 1;
            this.cubies.push(m);
          }
        }
      }

      K.mergeStatic(root, [this.view]); // 받침돌 부품 병합

      this.solved = false;
      this.turning = false;
      this.history = [];
      this.scramble(C.scrambleMoves, true);

      this.onKey = this.onKey.bind(this);
      this.onDown = this.onDown.bind(this);
      this.onMove = this.onMove.bind(this);
      this.onUp = this.onUp.bind(this);
      this.onContext = (e) => e.preventDefault();
      this.dragging = false;
      this.qa = new THREE.Quaternion();
      this.qb = new THREE.Quaternion();
      this.axis = new THREE.Vector3();
      const self = this;
      K.register({
        id: 'cube',
        el: this.el,
        countsTowardPortal: true,
        radius: this.cfg.radius,
        prompt: () => (self.solved ? '큐브 다시 섞기' : self.cfg.prompt),
        enabled: () => true,
        focus: (out) => self.view.getWorldPosition(out),
        interact: (ctx) => self.interact(ctx),
      });
    },

    /* ---------------- 면 회전 ---------------- */
    layer(face) {
      const f = CFG.cube.faces[face];
      return this.cubies.filter((c) => Math.round(c.position[f.axis] / this.sp) === f.sign);
    },

    /** dir: 1 = 시계 방향(그 면을 바라볼 때), -1 = 반시계 */
    turn(face, dir, duration = CFG.cube.turnDuration) {
      const f = CFG.cube.faces[face];
      const angle = -(Math.PI / 2) * f.sign * dir;
      const pivot = new THREE.Group();
      this.cube.add(pivot);
      const members = this.layer(face);
      for (const c of members) pivot.attach(c);
      const q = new THREE.Quaternion();
      const finish = () => {
        pivot.quaternion.setFromAxisAngle(AXIS[f.axis], angle);
        pivot.updateMatrixWorld(true);
        for (const c of members) {
          this.cube.attach(c);
          this.snap(c);
        }
        this.cube.remove(pivot);
      };
      if (duration <= 0) {
        finish();
        return Promise.resolve();
      }
      return U.tween(duration, (e) => {
        pivot.quaternion.copy(q.setFromAxisAngle(AXIS[f.axis], angle * e));
      }).then(finish);
    },

    snap(c) {
      c.position.set(
        Math.round(c.position.x / this.sp) * this.sp,
        Math.round(c.position.y / this.sp) * this.sp,
        Math.round(c.position.z / this.sp) * this.sp
      );
      const m = new THREE.Matrix4().makeRotationFromQuaternion(c.quaternion);
      const e = m.elements;
      for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) e[i] = Math.round(e[i]);
      c.quaternion.setFromRotationMatrix(m);
    },

    isSolved() {
      return this.cubies.every((c) => c.userData.isCenter
        || (c.position.distanceTo(c.userData.home) < 1e-3 && Math.abs(c.quaternion.w) > 0.999));
    },

    scramble(n, instant) {
      const faces = Object.keys(CFG.cube.faces);
      let last = null;
      const moves = [];
      for (let i = 0; i < n; i++) {
        let f;
        do f = faces[Math.floor(Math.random() * faces.length)]; while (f === last);
        last = f;
        moves.push([f, Math.random() < 0.5 ? 1 : -1]);
      }
      this.history = [];
      this.solved = false;
      this.lastScramble = moves; // 디버그·테스트용 (콘솔에서 확인 가능)
      if (instant) {
        for (const [f, d] of moves) this.turn(f, d, 0);
        if (this.isSolved()) this.scramble(n, true); // 우연히 맞춰진 경우 다시
        return Promise.resolve();
      }
      return moves.reduce((p, [f, d]) => p.then(() => this.turn(f, d, 0.16)), Promise.resolve());
    },

    /* ---------------- 인터랙션 ---------------- */
    async interact(ctx) {
      const { camera, avatar, playerEl } = ctx;
      const C = CFG.cube;
      const center = this.view.getWorldPosition(new THREE.Vector3());
      avatar.setPose('reachBoth', 0.6);
      await camera.moveTo({ ...camera.sideShot({ target: center, distance: 2.3, height: 1.7, lookHeight: 1.1 }), duration: 1.2 });
      if (this.solved) {
        DP.Audio.sfx('turn', center);
        await this.scramble(C.scrambleMoves, false);
      }
      // 관찰 위치로 이동 후 고정: 큐브 정면(캐릭터 쪽)에서 약간 위
      const p = playerEl.object3D.position;
      const dir = new THREE.Vector3(p.x - center.x, 0, p.z - center.z).normalize();
      const camPos = center.clone().addScaledVector(dir, C.inspectDistance);
      camPos.y += C.inspectHeight;
      avatar.setPose('lookDown', 0.5);
      await camera.moveTo({ pos: camPos, look: center, duration: 0.9, safe: false });
      this.camObj = camera.el.object3D;

      this.showHelp(true);
      this.setDrag(true);
      const outcome = await new Promise((resolve) => {
        this.finish = resolve;
        window.addEventListener('keydown', this.onKey);
      });
      window.removeEventListener('keydown', this.onKey);
      this.setDrag(false);
      this.showHelp(false);

      if (outcome === 'solved') {
        this.solved = true;
        DP.Audio.sfx('chime', center);
        // 보기 회전을 정면으로 되돌리며 한 바퀴
        const fromQ = this.view.quaternion.clone();
        const spin = new THREE.Quaternion();
        await U.tween(1.3, (e, t) => {
          spin.setFromAxisAngle(AXIS.y, e * Math.PI * 2);
          this.view.quaternion.slerpQuaternions(fromQ, IDENTITY, Math.min(1, e * 1.6)).premultiply(spin);
          this.view.position.y = this.baseY + Math.sin(t * Math.PI) * 0.06;
        });
        this.view.quaternion.identity();
        await U.wait(0.3);
        return { completed: true };
      }
      await this.resetView(0.5);
      return { completed: false };
    },

    /* ---------------- 전체 회전 (마우스 드래그) ---------------- */
    setDrag(on) {
      const canvas = this.el.sceneEl.canvas;
      this.dragging = false;
      if (on) {
        canvas.addEventListener('mousedown', this.onDown);
        canvas.addEventListener('contextmenu', this.onContext);
        document.addEventListener('mousemove', this.onMove);
        document.addEventListener('mouseup', this.onUp);
      } else {
        canvas.removeEventListener('mousedown', this.onDown);
        canvas.removeEventListener('contextmenu', this.onContext);
        document.removeEventListener('mousemove', this.onMove);
        document.removeEventListener('mouseup', this.onUp);
      }
    },

    onDown(e) {
      if (e.button !== 0) return;
      e.preventDefault(); // 텍스트 선택 등 기본 동작 방지
      this.dragging = true;
    },

    onUp() {
      this.dragging = false;
    },

    onMove(e) {
      if (!this.dragging) return;
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      if (Math.abs(dx) > 250 || Math.abs(dy) > 250) return;
      this.rotateView(dx, dy);
    },

    /**
     * 화면 기준 회전: 좌우 드래그 = 세로축(Y), 상하 드래그 = 화면의 가로축
     * 쿼터니언을 앞에 곱해(premultiply) 어떤 자세에서도 화면 방향 그대로 돌아감 → 위아래 360° 가능
     */
    rotateView(dx, dy) {
      const k = CFG.cube.dragSensitivity;
      const parent = this.view.parent; // 오브젝트 루트 (Y축 회전만 있음)
      parent.updateMatrixWorld(true);
      const inv = parent.getWorldQuaternion(this.qb).invert();
      // 세로축: 월드 위쪽을 루트 좌표로
      this.axis.set(0, 1, 0).applyQuaternion(inv);
      this.qa.setFromAxisAngle(this.axis, dx * k);
      this.view.quaternion.premultiply(this.qa);
      // 가로축: 카메라 오른쪽 방향을 루트 좌표로
      this.axis.set(1, 0, 0).applyQuaternion(this.camObj.quaternion).applyQuaternion(inv).normalize();
      this.qa.setFromAxisAngle(this.axis, dy * k);
      this.view.quaternion.premultiply(this.qa).normalize();
    },

    resetView(duration) {
      const fromQ = this.view.quaternion.clone();
      return U.tween(duration, (e) => this.view.quaternion.slerpQuaternions(fromQ, IDENTITY, e));
    },

    onKey(e) {
      if (e.repeat || this.turning) return;
      if (e.code === 'KeyQ') {
        this.finish('quit');
        return;
      }
      if (e.code === 'Backspace') {
        e.preventDefault();
        const last = this.history.pop();
        if (last) this.doTurn(last[0], -last[1], false);
        return;
      }
      const face = KEY_TO_FACE[e.code];
      if (!face) return;
      this.doTurn(face, e.shiftKey ? -1 : 1, true);
    },

    async doTurn(face, dir, record) {
      this.turning = true;
      DP.Audio.sfx('turn', this.cube.getWorldPosition(new THREE.Vector3()));
      await this.turn(face, dir);
      if (record) this.history.push([face, dir]);
      this.updateHelp();
      this.turning = false;
      if (this.isSolved()) this.finish('solved');
    },

    /* ---------------- 안내 패널 ---------------- */
    showHelp(show) {
      const el = document.getElementById('cube-help');
      if (!el) return;
      if (show && !el.dataset.built) {
        const rows = Object.entries(CFG.cube.faces)
          .map(([k, f]) => `<span class="chip"><i style="background:${f.color}"></i><kbd>${k}</kbd>${f.name}</span>`)
          .join('');
        el.querySelector('.faces').innerHTML = rows;
        el.dataset.built = '1';
      }
      el.classList.toggle('show', show);
      this.updateHelp();
    },

    updateHelp() {
      const el = document.querySelector('#cube-help .moves');
      if (el) el.textContent = `회전 ${this.history.length}회`;
    },
  });
})();
