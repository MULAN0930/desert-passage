/* ==========================================================================
 *  Desert Passage — character.js
 *  방랑자 캐릭터 (Meshy GLB + Mixamo 애니메이션)
 *
 *  · config.character.file의 GLB를 불러와 #avatar 아래에 붙임
 *      실제 바운딩 박스 높이로 크기를 맞추고, 발바닥을 y=0에 둠
 *  · 걷기·달리기·대기는 이동 속도에 따라 자동 블렌딩
 *  · 일회성 동작은 의미 있는 별칭으로 호출 (GLB 안의 실제 클립 이름은 config에서 연결)
 *      DP.Character.action('OBJECT_REACH')  → Promise (끝나면 대기 동작으로 복귀)
 *  · GLB가 없거나 실패하면: 기존 도형 캐릭터(wanderer-avatar)의 포즈로 대체 → 진행은 그대로 가능
 *  · 루트 모션 제거: 클립 안의 엉덩이(hips) 수평 이동을 지워서 충돌체와 모델이 어긋나지 않게 함
 *
 *  콘솔에서 DP.Character.listClips() → GLB 안의 클립 이름·길이를 표로 확인
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

(function () {
  const CFG = DP.CONFIG;
  const U = DP.Util;
  const D2R = THREE.MathUtils.degToRad;

  // GLB가 없을 때 별칭 → 도형 캐릭터 포즈
  const FALLBACK_POSE = {
    COMPASS_TAKE_OUT: 'compass',
    OBJECT_REACH: 'reachBoth',
    REMOTE_PRESS: 'reachR',
    BEANIE_WEAR: 'toHead',
    MACHINE_OPERATE: 'pull',
  };
  const AUTO_NAMES = {
    IDLE: [/idle/i, /stand/i, /breath/i],
    WALK: [/walk/i],
    RUN: [/run/i, /jog/i, /sprint/i],
  };

  AFRAME.registerComponent('character-model', {
    init() {
      this.glb = null;
      this.mixer = null;
      this.clips = {};
      this.base = null; // 현재 이동 동작 (IDLE/WALK/RUN)
      this.oneShot = null; // 재생 중인 일회성 동작
      this.ready = false;
      this.failed = false;
      DP.Character = this;
      this.load();
    },

    primitive() {
      return this.el.components['wanderer-avatar'];
    },

    async load() {
      const C = CFG.character;
      if (!C.file) return this.fail('config.character.file 비어 있음');
      try {
        const head = await fetch(C.file, { method: 'HEAD' });
        if (!head.ok) return this.fail(`파일 없음 (${head.status}) — ${C.file}`);
      } catch (e) {
        /* HEAD를 지원하지 않는 서버 → 그냥 시도 */
      }
      let gltf;
      try {
        gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(C.file, res, undefined, rej));
      } catch (e) {
        return this.fail(e && e.message ? e.message : String(e));
      }
      this.setup(gltf);
    },

    fail(reason) {
      this.failed = true;
      console.warn(`[character] Meshy 캐릭터를 불러오지 못해 도형 캐릭터를 사용합니다: ${reason}`);
    },

    setup(gltf) {
      const C = CFG.character;
      const model = gltf.scene;
      const holder = new THREE.Group();
      holder.name = 'character-glb';
      const pivot = new THREE.Group();
      pivot.rotation.y = D2R(C.rotationY || 0);
      pivot.add(model);
      holder.add(pivot);
      model.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = false;
          o.frustumCulled = false; // 스킨 메시는 바운딩이 정확하지 않아 잘려 보일 수 있음
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) if ('metalness' in m) m.metalness = Math.min(m.metalness, 0.3);
        }
      });
      // 실제 크기 측정 → 키를 맞춤 → 발바닥 y=0, 가로 중심 원점
      pivot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(pivot);
      const size = box.getSize(new THREE.Vector3());
      const s = C.height / Math.max(1e-3, size.y);
      pivot.scale.setScalar(s);
      pivot.updateMatrixWorld(true);
      box.setFromObject(pivot);
      const c = box.getCenter(new THREE.Vector3());
      pivot.position.set(-c.x, -box.min.y, -c.z);
      this.el.object3D.add(holder);
      this.holder = holder;
      this.model = model;
      this.info = { rawSize: size.toArray().map((v) => +v.toFixed(3)), scale: +s.toFixed(4) };

      // 도형 캐릭터 숨김 (앵커 엔티티는 남겨 둠)
      const prim = this.primitive();
      if (prim) prim.body.object3D.visible = false;

      // 애니메이션
      this.mixer = new THREE.AnimationMixer(model);
      this.allClips = gltf.animations || [];
      const hips = this.findBone(/hips|pelvis|root/i);
      for (const clip of this.allClips) this.stripRootMotion(clip, hips);
      const byName = (name) => this.allClips.find((a) => a.name === name);
      for (const alias of Object.keys(C.clips)) {
        let clip = C.clips[alias] ? byName(C.clips[alias]) : null;
        if (!clip && AUTO_NAMES[alias]) {
          for (const re of AUTO_NAMES[alias]) {
            clip = this.allClips.find((a) => re.test(a.name));
            if (clip) break;
          }
        }
        if (C.clips[alias] && !clip) console.warn(`[character] 클립 '${C.clips[alias]}'(${alias})이 GLB에 없습니다.`);
        if (clip) this.clips[alias] = clip;
      }
      this.mixer.addEventListener('finished', (e) => this.onFinished(e));
      this.ready = true;
      this.glb = gltf;
      console.info('[character] GLB 적용', this.info, '연결된 클립:', Object.fromEntries(Object.entries(this.clips).map(([k, v]) => [k, v.name])));
      this.listClips();
      this.setBase('IDLE', 0);
      this.el.emit('character-ready');
    },

    /** 엉덩이 본의 수평 이동(x, z)을 첫 프레임 값으로 고정 → 제자리 동작 */
    stripRootMotion(clip, hips) {
      if (!hips) return;
      for (const track of clip.tracks) {
        if (!track.name.endsWith('.position')) continue;
        const node = track.name.split('.')[0];
        if (node !== hips.name && node !== hips.uuid) continue;
        const v = track.values;
        const x0 = v[0];
        const z0 = v[2];
        for (let i = 0; i < v.length; i += 3) {
          v[i] = x0;
          v[i + 2] = z0;
        }
      }
    },

    findBone(re, exclude = /end|top|nub/i) {
      let found = null;
      this.model &&
        this.model.traverse((o) => {
          if (!found && (o.isBone || o.type === 'Bone') && re.test(o.name) && !exclude.test(o.name)) found = o;
        });
      return found;
    },

    /** GLB 안의 모든 클립 (콘솔 확인용) */
    listClips() {
      const rows = (this.allClips || []).map((a, i) => ({ index: i, name: a.name, seconds: +a.duration.toFixed(2) }));
      if (rows.length) console.table(rows);
      return rows;
    },

    /** 머리 위치 (비니를 붙일 곳) — 본이 있으면 본, 없으면 도형 캐릭터의 앵커 */
    headObject() {
      if (this.ready) {
        const C = CFG.character;
        const bone = C.headBone ? this.model.getObjectByName(C.headBone) : this.findBone(/head/i);
        if (bone) return bone;
      }
      return document.getElementById('head-anchor').object3D;
    },

    /** 머리 꼭대기 위치 (HeadTop_End 본) — 비니 위치 계산용, 없으면 null */
    headTopPosition(out = new THREE.Vector3()) {
      if (!this.ready) return null;
      const top = this.findBone(/headtop/i, /^$/);
      return top ? top.getWorldPosition(out) : null;
    },

    /* ---------------- 이동 동작 (자동) ---------------- */
    setBase(alias, fade = CFG.character.fade) {
      if (!this.ready || this.baseAlias === alias) return;
      const clip = this.clips[alias] || this.clips.IDLE;
      if (!clip) return;
      const next = this.mixer.clipAction(clip);
      next.enabled = true;
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.reset().play();
      if (this.base && this.base !== next) {
        if (this.oneShot) {
          this.base.stop();
          next.setEffectiveWeight(0);
        } else this.base.crossFadeTo(next, fade, false);
      }
      this.base = next;
      this.baseAlias = alias;
    },

    /* ---------------- 일회성 동작 ---------------- */
    /**
     * @param {string} alias  COMPASS_TAKE_OUT | OBJECT_REACH | REMOTE_PRESS | BEANIE_WEAR | MACHINE_OPERATE
     * @param {{hold?:boolean, maxSec?:number}} o  hold: 끝 동작에서 멈춰 있기 (release()로 해제)
     * @returns {Promise<void>} 동작이 끝나면 (또는 maxSec 경과) resolve
     */
    action(alias, o = {}) {
      const fade = CFG.character.fade;
      if (!this.ready || !this.clips[alias]) {
        // 도형 캐릭터 포즈로 대체
        const prim = this.primitive();
        const pose = FALLBACK_POSE[alias] || 'reachR';
        if (prim) prim.setPose(pose, 0.6);
        return U.wait(Math.min(o.maxSec || 0.9, 0.9)).then(() => {
          if (!o.hold && prim) prim.setPose('rest', 0.5);
        });
      }
      // 같은 동작 연타 방지: 이전 일회성 동작을 정리하고 새로 시작
      if (this.oneShot) {
        this.oneShot.action.fadeOut(fade);
        this.oneShot.resolve();
      }
      const act = this.mixer.clipAction(this.clips[alias]);
      act.reset();
      act.setLoop(THREE.LoopOnce, 1);
      act.clampWhenFinished = true;
      act.enabled = true;
      act.setEffectiveWeight(1);
      act.fadeIn(fade).play();
      if (this.base) this.base.fadeOut(fade);
      return new Promise((resolve) => {
        const entry = { alias, action: act, hold: !!o.hold, resolve: null };
        let done = false;
        entry.resolve = () => {
          if (done) return;
          done = true;
          resolve();
        };
        this.oneShot = entry;
        if (o.maxSec) setTimeout(() => entry.resolve(), o.maxSec * 1000);
      });
    },

    onFinished(e) {
      const s = this.oneShot;
      if (!s || e.action !== s.action) return;
      s.resolve();
      if (!s.hold) this.release();
    },

    /** 일회성 동작을 끝내고 이동 동작으로 부드럽게 복귀 */
    release() {
      const fade = CFG.character.fade;
      const prim = this.primitive();
      if (!this.ready) {
        if (prim) prim.setPose('rest', 0.5);
        return;
      }
      const s = this.oneShot;
      this.oneShot = null;
      if (s) s.action.fadeOut(fade);
      if (this.base) {
        this.base.enabled = true;
        this.base.reset().setEffectiveWeight(1).fadeIn(fade).play();
      }
    },

    tick(t, dt) {
      if (!this.ready || !dt) return;
      const s = Math.min(dt, 100) / 1000;
      const pc = document.getElementById('player').components['player-controller'];
      const speed = pc ? pc.speed : 0;
      const C = CFG.character;
      if (!this.oneShot) this.setBase(speed > C.runThreshold ? 'RUN' : speed > C.walkThreshold ? 'WALK' : 'IDLE');
      this.mixer.update(s);
    },
  });
})();
