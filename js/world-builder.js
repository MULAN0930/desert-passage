/* ==========================================================================
 *  Desert Passage — world-builder.js
 *  사막 지형 · 하늘 · 안개 · 모래폭풍 · 원경 · 유적 · 포털 구조 · 환경 디테일
 *
 *  · 지형 높이는 heightAt(x, z) 하나로 정의 → 메시와 플레이어 높이에 함께 사용
 *  · 충돌 데이터(원·회전 사각형)를 함께 등록 → 물리 엔진 없이 충돌 처리
 *  · 움직이지 않는 유적은 로딩 후 재질별로 병합 → 드로우콜 절감
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

(function () {
  const CFG = DP.CONFIG;
  const { lerp, clamp, smoothstep, mulberry32 } = DP.Util;

  /* ------------------------------------------------------------------------
   * 1. 노이즈
   * ---------------------------------------------------------------------- */
  function hash2(ix, iz, seed) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function valueNoise(x, z, seed) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz, seed);
    const b = hash2(ix + 1, iz, seed);
    const c = hash2(ix, iz + 1, seed);
    const d = hash2(ix + 1, iz + 1, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
  }

  function fbm(x, z, octaves, seed) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1;
    for (let i = 0; i < octaves; i++) {
      sum += valueNoise(x * f, z * f, seed + i * 17) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }

  /** 위치 기반 고정 난수 (같은 유적은 항상 같은 변형) */
  const rngAt = (x, z, salt = 0) => mulberry32(CFG.world.seed * 9973 + Math.round(x * 31) * 7 + Math.round(z * 17) * 13 + salt);

  /* ------------------------------------------------------------------------
   * 2. 지형 높이 / 지면 / 충돌
   * ---------------------------------------------------------------------- */
  function heightAt(x, z) {
    const W = CFG.world;
    const r = Math.hypot(x, z);
    const amp = lerp(W.duneNearAmp, W.duneFarAmp, smoothstep(W.duneRampStart, W.duneRampEnd, r));
    const base = fbm(x * 0.045, z * 0.06, 3, W.seed);
    // 능선: |v| 대신 부드러운 절댓값 → 꼭대기가 둥글게 이어짐
    const v = fbm(x * 0.016 + 11.3, z * 0.028 - 4.1, 3, W.seed + 5) * 2 - 1;
    const ridge = Math.pow(clamp(1 - Math.sqrt(v * v + 0.012), 0, 1), W.ridgeSharpness);
    let h = (base * 0.55 + ridge * 0.75) * amp;
    const pd = Math.hypot(x - W.plazaCenter.x, z - W.plazaCenter.z);
    h *= lerp(0.12, 1, smoothstep(W.plazaRadius, W.plazaRadius + 10, pd));
    return h;
  }

  const groundOverrides = [];

  /* 활성 환경 — 낙원으로 전환되면 지면·충돌·카메라 장애물을 낙원 쪽에서 계산
   * (player-controller·camera-director는 수정 없이 DP.World.groundAt / isBlocked를 그대로 사용) */
  let activeEnv = null;
  function setEnvironment(env) {
    activeEnv = env || null;
  }

  function groundAt(x, z) {
    if (activeEnv) return activeEnv.groundAt(x, z);
    let g = heightAt(x, z);
    for (const o of groundOverrides) {
      if ((x - o.x) ** 2 + (z - o.z) ** 2 <= o.r * o.r) g = Math.max(g, o.top);
    }
    return g;
  }

  const colliders = { circles: [], boxes: [] };

  function addCircle(x, z, r) {
    colliders.circles.push({ x, z, r });
  }

  function addBox(x, z, hw, hd, rotDeg) {
    const b = { x, z, hw, hd, rot: THREE.MathUtils.degToRad(rotDeg || 0), disabled: false };
    colliders.boxes.push(b);
    return b; // disabled = true로 끌 수 있음 (포털 입구 막이)
  }

  /** 충돌체 내부인지 (반경 radius 포함) — 플레이 반경은 검사하지 않음 */
  function insideCollider(x, z, radius) {
    for (const c of colliders.circles) {
      const rr = c.r + radius;
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < rr * rr) return true;
    }
    for (const b of colliders.boxes) {
      if (b.disabled) continue;
      const dx = x - b.x;
      const dz = z - b.z;
      const cos = Math.cos(b.rot);
      const sin = Math.sin(b.rot);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const qx = Math.max(Math.abs(lx) - b.hw, 0);
      const qz = Math.max(Math.abs(lz) - b.hd, 0);
      if (qx * qx + qz * qz < radius * radius) return true;
    }
    return false;
  }

  /** (x, z)에 반경 radius의 플레이어가 설 수 없으면 true (Phase 1과 동일한 규칙) */
  function isBlocked(x, z, radius) {
    if (activeEnv) return activeEnv.isBlocked(x, z, radius);
    if (Math.hypot(x, z) > CFG.world.playRadius - radius) return true;
    return insideCollider(x, z, radius);
  }

  function toWorld(gx, gz, rotYDeg, lx, lz) {
    const a = THREE.MathUtils.degToRad(rotYDeg || 0);
    return { x: gx + lx * Math.cos(a) + lz * Math.sin(a), z: gz - lx * Math.sin(a) + lz * Math.cos(a) };
  }

  /* ------------------------------------------------------------------------
   * 3. 공유 재질 — config.materials 표 기준 (flat / smooth 선택)
   * ---------------------------------------------------------------------- */
  const MAT_CACHE = {};

  function getMaterial(key) {
    if (MAT_CACHE[key]) return MAT_CACHE[key];
    const P = CFG.palette;
    const M = CFG.materials[key] || { roughness: 0.95, metalness: 0, flat: true };
    const color = P[key] || key;
    const common = {
      color: Array.isArray(color) ? color[0] : color,
      flatShading: !!M.flat,
      transparent: !!M.transparent,
      opacity: M.opacity != null ? M.opacity : 1,
    };
    // lambert: 반사 계산이 단순한 무광 재질 (모래폭풍 속에서는 PBR과 차이가 거의 없고 훨씬 가벼움)
    const mat = CFG.render.material === 'standard'
      ? new THREE.MeshStandardMaterial({ ...common, roughness: M.roughness, metalness: M.metalness })
      : new THREE.MeshLambertMaterial(common);
    MAT_CACHE[key] = mat;
    return mat;
  }

  /** 빛나는 재질 (LED, 문양 등) — 강도를 개별 조절할 수 있도록 매번 새로 생성 */
  function emissiveMaterial(colorKey, intensity = 1.5) {
    const c = CFG.palette[colorKey] || colorKey;
    return new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: intensity, flatShading: true });
  }

  AFRAME.registerComponent('lp-mat', {
    schema: { type: 'string', default: 'stone' },
    init() {
      this.apply = this.apply.bind(this);
      this.el.addEventListener('object3dset', this.apply);
      this.apply();
    },
    update() {
      this.apply();
    },
    apply() {
      const mesh = this.el.getObject3D('mesh');
      if (mesh) mesh.material = getMaterial(this.data);
    },
    remove() {
      this.el.removeEventListener('object3dset', this.apply);
    },
  });

  /* ------------------------------------------------------------------------
   * 4. 엔티티 헬퍼
   * ---------------------------------------------------------------------- */
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const v3 = (x = 0, y = 0, z = 0) => ({ x: r3(x), y: r3(y), z: r3(z) });

  function group(parent, pos, rot, id, cls) {
    const el = document.createElement('a-entity');
    if (id) el.id = id;
    if (cls) el.className = cls;
    if (pos) el.setAttribute('position', pos);
    if (rot) el.setAttribute('rotation', rot);
    parent.appendChild(el);
    return el;
  }

  function prim(parent, geometry, pos, mat, rot, opts = {}) {
    const el = document.createElement('a-entity');
    el.setAttribute('geometry', geometry);
    el.setAttribute('lp-mat', mat);
    el.setAttribute('position', pos);
    if (rot) el.setAttribute('rotation', rot);
    if (opts.scale) el.setAttribute('scale', opts.scale);
    if (opts.camBlock) el.classList.add('cam-block');
    if (opts.cls) el.classList.add(...opts.cls.split(' '));
    if (opts.id) el.id = opts.id;
    parent.appendChild(el);
    return el;
  }

  const boxG = (w, h, d) => ({ primitive: 'box', width: r3(w), height: r3(h), depth: r3(d) });
  const cylG = (r, h, seg = 12) => ({ primitive: 'cylinder', radius: r3(r), height: r3(h), segmentsRadial: seg, segmentsHeight: 1 });
  const sphG = (r, w = 12, hgt = 6) => ({ primitive: 'sphere', radius: r3(r), segmentsWidth: w, segmentsHeight: hgt });

  /* ------------------------------------------------------------------------
   * 5. 지형 — 부드러운 곡면 + 꼭짓점 색 (능선은 밝게, 골은 어둡게)
   * ---------------------------------------------------------------------- */
  AFRAME.registerComponent('desert-terrain', {
    init() {
      const W = CFG.world;
      const N = W.terrainSegments;
      const E = W.terrainExtent;
      const A = W.terrainCore;
      const B = E - A;
      const map = (u) => Math.sign(u) * (A * Math.abs(u) + B * Math.pow(Math.abs(u), 7));
      const xs = [];
      for (let i = 0; i <= N; i++) xs.push(map(-1 + (2 * i) / N));
      const V = N + 1;
      const H = new Float32Array(V * V);
      for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) H[j * V + i] = heightAt(xs[i], xs[j]);

      const pos = new Float32Array(V * V * 3);
      const col = new Float32Array(V * V * 3);
      const sand = CFG.palette.sand.map((c) => new THREE.Color(c));
      const shadow = CFG.palette.sandShadow.map((c) => new THREE.Color(c));
      const c = new THREE.Color();
      const at = (i, j) => H[clamp(j, 0, N) * V + clamp(i, 0, N)];

      for (let j = 0; j < V; j++) {
        for (let i = 0; i < V; i++) {
          const k = j * V + i;
          const x = xs[i];
          const z = xs[j];
          const h = H[k];
          pos[k * 3] = x;
          pos[k * 3 + 1] = h;
          pos[k * 3 + 2] = z;
          const cell = Math.max(0.5, (xs[Math.min(i + 1, N)] - xs[Math.max(i - 1, 0)]) / 2);
          // 넓은 범위의 색 변화 (면 단위 무작위 없음)
          const n = fbm(x * 0.025, z * 0.025, 3, 99);
          c.copy(sand[1]).lerp(sand[0], smoothstep(0.32, 0.58, n)).lerp(sand[2], smoothstep(0.55, 0.8, n) * 0.6);
          // 곡률: 능선(+) 밝게, 골(-) 어둡게 → 가짜 AO
          const curv = (h - (at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1)) / 4) / cell;
          if (curv > 0) c.lerp(sand[2], clamp(curv * 3.5, 0, 0.45));
          else c.lerp(shadow[0], clamp(-curv * 3.0, 0, 0.5));
          // 경사 (아주 약하게)
          const slope = Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (2 * cell);
          c.lerp(shadow[1], clamp((slope - 0.35) * 0.5, 0, 0.25));
          col[k * 3] = c.r;
          col[k * 3 + 1] = c.g;
          col[k * 3 + 2] = c.b;
        }
      }

      const idx = new Uint32Array(N * N * 6);
      let o = 0;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const a = j * V + i;
          const b = a + 1;
          const cc = a + V;
          const d = cc + 1;
          idx[o++] = a; idx[o++] = cc; idx[o++] = b;
          idx[o++] = b; idx[o++] = cc; idx[o++] = d;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      this.el.setObject3D('mesh', mesh);
    },
    remove() {
      this.el.removeObject3D('mesh');
    },
  });

  /* ------------------------------------------------------------------------
   * 6. 하늘 — 안개 색과 같은 값으로 지평선을 덮음 (매 프레임 모래폭풍이 갱신)
   * ---------------------------------------------------------------------- */
  AFRAME.registerComponent('desert-sky', {
    init() {
      const A = CFG.atmosphere;
      const L = CFG.lighting;
      this.material = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(A.skyTop) },
          uHorizon: { value: new THREE.Color(A.skyHorizon) },
          uFog: { value: new THREE.Color(A.fogClear) },
          uSun: { value: new THREE.Color(L.sunColor) },
          uSunDir: { value: new THREE.Vector3(L.sunPosition.x, L.sunPosition.y, L.sunPosition.z).normalize() },
          uBand: { value: 0.1 },
        },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uFog; uniform vec3 uSun; uniform vec3 uSunDir; uniform float uBand;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.65, h));
            float s = max(dot(d, uSunDir), 0.0);
            col += uSun * (pow(s, 900.0) * 2.0 + pow(s, 10.0) * 0.22);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            // 지평선 띠는 안개 색 그대로 → 안개에 묻힌 지형과 같은 색으로 이어짐
            float band = 1.0 - smoothstep(-0.03, uBand, h);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uFog, band);
          }`,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), this.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = -1;
      this.el.setObject3D('mesh', mesh);
      DP.World.sky = this;
    },
    remove() {
      this.el.removeObject3D('mesh');
    },
  });

  /* 원거리 산맥 — 원뿔 수십 개를 하나의 메시로 */
  AFRAME.registerComponent('mountain-ring', {
    init() {
      const M = CFG.distant.mountains;
      const rand = mulberry32(CFG.world.seed + 31);
      const parts = [];
      const m = new THREE.Matrix4();
      for (let i = 0; i < M.count; i++) {
        const ang = (i / M.count) * Math.PI * 2 + rand() * 0.15;
        const dist = lerp(M.minDist, M.maxDist, rand());
        const h = lerp(M.minHeight, M.maxHeight, rand());
        const rad = h * lerp(1.6, 2.6, rand());
        const seg = 7 + Math.floor(rand() * 3);
        const cone = new THREE.ConeGeometry(rad, h, seg, 3);
        const pa = cone.attributes.position;
        const flatTop = rand() < 0.6 ? h * (0.1 + rand() * 0.15) : null;
        for (let k = 0; k < pa.count; k++) {
          const x0 = pa.getX(k);
          const y0 = pa.getY(k);
          const z0 = pa.getZ(k);
          const key1 = Math.round(x0 * 10);
          const key2 = Math.round(z0 * 10) + Math.round(y0 * 10) * 7919;
          const t = (y0 + h / 2) / h;
          const jr = 1 + (hash2(key1, key2, 3 + i) - 0.5) * 0.45 * (1 - t);
          pa.setX(k, x0 * jr);
          pa.setZ(k, z0 * jr);
          if (t > 0.01 && t < 0.99) pa.setY(k, y0 + (hash2(key1, key2, 9 + i) - 0.5) * h * 0.18);
          if (flatTop !== null && y0 > h * 0.49) pa.setY(k, flatTop);
        }
        const g = cone.toNonIndexed();
        cone.dispose();
        const x = Math.sin(ang) * dist;
        const z = -Math.cos(ang) * dist;
        m.makeRotationY(rand() * Math.PI);
        m.setPosition(x, h / 2 + heightAt(x, z) - 6, z);
        g.applyMatrix4(m);
        parts.push(g.attributes.position.array);
        g.dispose();
      }
      const total = parts.reduce((s, p) => s + p.length, 0);
      const arr = new Float32Array(total);
      let off = 0;
      for (const p of parts) {
        arr.set(p, off);
        off += p.length;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      geo.computeVertexNormals();
      this.el.setObject3D('mesh', new THREE.Mesh(geo, getMaterial('mountain')));
    },
    remove() {
      this.el.removeObject3D('mesh');
    },
  });

  /* ------------------------------------------------------------------------
   * 7. 모래폭풍 — 사용자가 조작할 수 없는 자동 변화
   *    강도(0~1)가 가시거리·안개 색·배경색·태양·모래 입자·바람 소리를 함께 움직임
   *    · 탐험 중: 가시거리 2m 안팎 (config.atmosphere.visibility)
   *    · 오브젝트 연출 / 포털 연출 중: 바람이 잠시 잦아들어 장면이 보이도록 넓어짐
   * ---------------------------------------------------------------------- */
  DP.storm = { intensity: 0.5, force: null, visibility: 2.2 };
  const LN2_SQRT = Math.sqrt(Math.LN2); // 지수 안개가 가시거리에서 정확히 50%가 되도록

  AFRAME.registerSystem('sandstorm', {
    init() {
      const A = CFG.atmosphere;
      this.fogClear = new THREE.Color(A.fogClear);
      this.fogStorm = new THREE.Color(A.fogStorm);
      this.horizon = new THREE.Color(A.skyHorizon);
      this.fogColor = new THREE.Color();
      this.time = 11;
      this.visibility = A.visibility.interact; // 인트로(3인칭)에서 시작
    },
    targetVisibility(i) {
      const V = CFG.atmosphere.visibility;
      const gs = this.el.systems['game-state'];
      const st = gs ? gs.state : 'BOOT';
      if (st === 'PORTAL_CINEMATIC') return V.portal;
      if (st === 'BOOT' || st === 'INTRO' || st === 'INTERACTING') return V.interact;
      return lerp(V.exploreMax, V.exploreMin, i);
    },
    tick(t, dt) {
      if (!dt || this.enabled === false) return; // 낙원에서는 정지
      const S = CFG.atmosphere.storm;
      const s = Math.min(dt, 100) / 1000;
      this.time += s;
      let wave = 0;
      S.periods.forEach((p, k) => {
        wave += Math.sin((this.time / p) * Math.PI * 2 + k * 1.7) * S.weights[k];
      });
      const auto = lerp(S.min, S.max, clamp(0.5 + wave * 0.62, 0, 1));
      const i = DP.storm.force != null ? DP.storm.force : auto;
      DP.storm.intensity = i;
      // 가시거리는 로그 공간에서 부드럽게 (짧은 거리 변화가 자연스럽게 보이도록)
      const target = this.targetVisibility(i);
      const a = Math.min(1, s * CFG.atmosphere.visibility.smoothing);
      this.visibility = Math.exp(lerp(Math.log(this.visibility), Math.log(target), a));
      DP.storm.visibility = this.visibility;
      this.apply(i);
      this.cullDistance();
    },
    /** 카메라가 그리는 거리를 가시거리에 맞춤 → 안개에 완전히 묻힌 물체는 아예 그리지 않음 */
    cullDistance() {
      const cam = this.el.camera;
      if (!cam) return;
      const R = CFG.render;
      const far = clamp(this.visibility * R.cullFactor, R.cullMin, R.cameraFar);
      if (Math.abs(cam.far - far) > 0.25) {
        cam.far = far;
        cam.updateProjectionMatrix();
      }
    },
    apply(i) {
      const scene = this.el.object3D;
      this.fogColor.copy(this.fogClear).lerp(this.fogStorm, i);
      if (scene.fog) {
        scene.fog.color.copy(this.fogColor);
        if ('density' in scene.fog) scene.fog.density = LN2_SQRT / this.visibility;
      }
      // 배경도 안개 색과 같게 → 먼 곳은 완전히 주황빛으로 덮임
      if (scene.background && scene.background.isColor) scene.background.copy(this.fogColor);
      const sky = DP.World.sky;
      if (sky) {
        const u = sky.material.uniforms;
        u.uFog.value.copy(this.fogColor);
        u.uBand.value = lerp(0.08, 0.42, i * i);
        u.uHorizon.value.copy(this.horizon).lerp(this.fogColor, i * 0.6);
      }
      const sun = DP.World.sunLight || (this.sunEl && this.sunEl.getObject3D('light'));
      if (!this.sunEl) this.sunEl = document.getElementById('sun-light');
      if (sun) sun.intensity = lerp(CFG.lighting.sunIntensity, CFG.lighting.sunIntensityStorm, i);
    },
  });

  /* 바람에 날리는 모래 — 플레이어 주변 순환, 카메라 근처 입자는 숨김 */
  AFRAME.registerComponent('drifting-sand', {
    schema: { target: { type: 'selector', default: '#player' } },
    init() {
      const S = CFG.atmosphere.sand;
      const rand = mulberry32(5);
      this.count = S.count;
      this.pos = new Float32Array(this.count * 3);
      this.speed = new Float32Array(this.count);
      for (let i = 0; i < this.count; i++) {
        this.pos[i * 3] = (rand() - 0.5) * S.area;
        this.pos[i * 3 + 1] = rand() * S.height;
        this.pos[i * 3 + 2] = (rand() - 0.5) * S.area;
        this.speed[i] = 0.6 + rand() * 0.8;
      }
      this.geo = new THREE.BufferGeometry();
      this.attr = new THREE.BufferAttribute(this.pos, 3);
      this.attr.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute('position', this.attr);
      this.mat = new THREE.PointsMaterial({
        color: CFG.palette.sand[2], size: S.size, transparent: true, opacity: S.opacity, depthWrite: false,
      });
      const pts = new THREE.Points(this.geo, this.mat);
      pts.frustumCulled = false;
      this.el.setObject3D('mesh', pts);
      this.cam = new THREE.Vector3();
    },
    tick(t, dt) {
      if (!dt || !this.data.target) return;
      const S = CFG.atmosphere.sand;
      const storm = DP.storm.intensity;
      const p = this.data.target.object3D.position;
      const camEl = this.el.sceneEl.camera && this.el.sceneEl.camera.el;
      if (camEl) camEl.object3D.getWorldPosition(this.cam);
      const s = (Math.min(dt, 100) / 1000) * (0.5 + storm * 1.3);
      this.mat.opacity = S.opacity * (0.35 + storm * 0.65);
      const half = S.area / 2;
      const clear2 = S.cameraClearance * S.cameraClearance;
      const P = this.pos;
      for (let i = 0; i < this.count; i++) {
        const k = i * 3;
        P[k] += S.wind.x * this.speed[i] * s;
        P[k + 2] += S.wind.z * this.speed[i] * s;
        P[k + 1] += Math.sin(t * 0.002 + i) * 0.15 * s;
        if (P[k] - p.x > half) P[k] -= S.area; else if (P[k] - p.x < -half) P[k] += S.area;
        if (P[k + 2] - p.z > half) P[k + 2] -= S.area; else if (P[k + 2] - p.z < -half) P[k + 2] += S.area;
        if (P[k + 1] - p.y > S.height) P[k + 1] -= S.height; else if (P[k + 1] - p.y < 0) P[k + 1] += S.height;
        // 카메라 바로 앞의 큰 점 방지
        const dx = P[k] - this.cam.x;
        const dy = P[k + 1] - this.cam.y;
        const dz = P[k + 2] - this.cam.z;
        if (dx * dx + dy * dy + dz * dz < clear2) P[k] += S.area * 0.5;
      }
      this.attr.needsUpdate = true;
    },
    remove() {
      this.el.removeObject3D('mesh');
    },
  });

  /* 먼지 막 — 플레이어 주변 중거리에 흐르는 반투명 면 (3장으로 제한) */
  function makeDustTexture() {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 128;
    const g = cv.getContext('2d');
    const rand = mulberry32(77);
    for (let i = 0; i < 90; i++) {
      const x = rand() * 256;
      const y = 30 + rand() * 80;
      const r = 12 + rand() * 40;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,240,215,0.22)');
      grad.addColorStop(1, 'rgba(255,240,215,0)');
      g.fillStyle = grad;
      for (const ox of [-256, 0, 256]) {
        g.beginPath();
        g.arc(x + ox, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    // 위·아래 가장자리를 부드럽게 지움 (면의 경계가 보이지 않도록)
    g.globalCompositeOperation = 'destination-in';
    const v = g.createLinearGradient(0, 0, 0, 128);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.35, 'rgba(0,0,0,1)');
    v.addColorStop(0.75, 'rgba(0,0,0,1)');
    v.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = v;
    g.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  AFRAME.registerComponent('dust-veils', {
    schema: { target: { type: 'selector', default: '#player' } },
    init() {
      const D = CFG.atmosphere.dustVeils;
      const base = makeDustTexture();
      this.veils = [];
      const geo = new THREE.PlaneGeometry(D.width, D.height);
      for (let i = 0; i < D.count; i++) {
        const tex = base.clone();
        tex.needsUpdate = true;
        tex.repeat.set(1.5, 1);
        const mat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, depthWrite: false, opacity: 0, color: CFG.atmosphere.fogStorm, side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        this.el.object3D.add(mesh);
        this.veils.push({ mesh, tex, angle: (i / D.count) * Math.PI * 2 + 0.4, speed: 0.006 + i * 0.003 });
      }
    },
    tick(t, dt) {
      if (!dt || !this.data.target) return;
      const D = CFG.atmosphere.dustVeils;
      const p = this.data.target.object3D.position;
      const storm = DP.storm.intensity;
      const s = Math.min(dt, 100) / 1000;
      for (const v of this.veils) {
        const x = p.x + Math.sin(v.angle) * D.distance;
        const z = p.z + Math.cos(v.angle) * D.distance;
        v.mesh.position.set(x, p.y + D.height * 0.32, z);
        v.mesh.lookAt(p.x, p.y + D.height * 0.32, p.z);
        v.tex.offset.x += v.speed * s * (0.5 + storm * 1.5);
        v.mesh.material.opacity = D.opacity * smoothstep(0.25, 0.9, storm);
      }
    },
  });

  /* 태양 그림자 — 플레이어 주변만 계산하도록 그림자 범위가 플레이어를 따라감 */
  AFRAME.registerComponent('sun-follow', {
    schema: { target: { type: 'selector', default: '#player' } },
    init() {
      const L = CFG.lighting;
      this.dir = new THREE.Vector3(L.sunPosition.x, L.sunPosition.y, L.sunPosition.z).normalize();
    },
    tick() {
      const light = this.el.getObject3D('light');
      if (!light || !this.data.target) return;
      DP.World.sunLight = light;
      const scene = this.el.sceneEl.object3D;
      if (light.target.parent !== scene) scene.add(light.target);
      const p = this.data.target.object3D.position;
      const L = CFG.lighting;
      const texel = (L.shadowRange * 2) / L.shadowMapSize;
      const tx = Math.round(p.x / texel) * texel;
      const tz = Math.round(p.z / texel) * texel;
      light.target.position.set(tx, p.y, tz);
      this.el.object3D.position.set(tx + this.dir.x * 90, p.y + this.dir.y * 90, tz + this.dir.z * 90);
    },
  });

  /* 작은 암석·파편 — InstancedMesh 3종 (드로우콜 3회) */
  AFRAME.registerComponent('desert-debris', {
    init() {
      const D = CFG.debris;
      const rand = mulberry32(D.seed);
      const kinds = [
        { geo: new THREE.DodecahedronGeometry(0.2, 0), mat: getMaterial('rock'), share: 0.45, s: [0.5, 1.7] },
        { geo: new THREE.IcosahedronGeometry(0.13, 0), mat: getMaterial('stoneDark'), share: 0.35, s: [0.6, 1.5] },
        { geo: new THREE.BoxGeometry(0.34, 0.1, 0.22), mat: getMaterial('stone'), share: 0.2, s: [0.6, 1.4] },
      ];
      const P = CFG.portal;
      const sp = CFG.player.spawn;
      const objs = Object.values(CFG.objects);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const sc = new THREE.Vector3();
      const ps = new THREE.Vector3();
      for (const k of kinds) {
        const count = Math.round(D.count * k.share);
        const mesh = new THREE.InstancedMesh(k.geo, k.mat, count);
        let placed = 0;
        let guard = 0;
        while (placed < count && guard++ < count * 30) {
          const a = rand() * Math.PI * 2;
          const r = Math.sqrt(lerp((D.minDist / D.maxDist) ** 2, 1, rand())) * D.maxDist;
          const x = Math.sin(a) * r;
          const z = Math.cos(a) * r;
          if (Math.hypot(x - P.center.x, z - P.center.z) < P.stepRadius + 0.5) continue;
          if (Math.hypot(x - sp.x, z - sp.z) < 3) continue;
          if (objs.some((o) => Math.hypot(x - o.x, z - o.z) < 2.8)) continue;
          if (insideCollider(x, z, 0.25)) continue;
          const s = lerp(k.s[0], k.s[1], rand() * rand());
          sc.set(s * lerp(0.8, 1.3, rand()), s * lerp(0.6, 1.0, rand()), s);
          e.set((rand() - 0.5) * 0.6, rand() * Math.PI * 2, (rand() - 0.5) * 0.6);
          q.setFromEuler(e);
          ps.set(x, heightAt(x, z) + 0.03 * s, z);
          m.compose(ps, q, sc);
          mesh.setMatrixAt(placed++, m);
        }
        mesh.count = placed;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        this.el.object3D.add(mesh);
      }
    },
  });

  /* ------------------------------------------------------------------------
   * 8. 유적 빌더 — 위치 기반 변형으로 반복이 드러나지 않게
   *    opts.collide=false → 원경용 / opts.mat → 재질 일괄 변경
   * ---------------------------------------------------------------------- */
  const matOf = (opts, key) => opts.mat || key;

  function mound(parent, x, y, z, sx, sy, sz, rotY) {
    prim(parent, sphG(1, 12, 6), v3(x, y, z), 'sandMound', rotY ? v3(0, rotY, 0) : null, { scale: v3(sx, sy, sz) });
  }

  function buildPillar(parent, d, opts = {}) {
    const collide = opts.collide !== false;
    const rnd = rngAt(d.x, d.z, 1);
    const r = d.r * (1 + (rnd() - 0.5) * 0.22);
    const hgt = d.h * (1 + (rnd() - 0.5) * 0.24);
    const k = r / 0.6;
    const gy = heightAt(d.x, d.z) - 0.18;
    const g = group(parent, v3(d.x, gy, d.z), v3(0, d.rotY != null ? d.rotY : rnd() * 360, d.tilt || 0));
    const block = { camBlock: collide };
    const baseH = 0.45 * k;
    const capH = d.broken ? 0 : 0.42 * k;
    const shaftH = hgt - baseH - capH;
    prim(g, boxG(r * 2.4, baseH, r * 2.4), v3(0, baseH / 2, 0), matOf(opts, 'stoneDark'), null, block);
    prim(g, cylG(r, shaftH, 12), v3(0, baseH + shaftH / 2, 0), matOf(opts, 'stone'), null, block);
    const bands = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < bands; i++) {
      prim(g, cylG(r * 1.08, 0.12 * k, 12), v3(0, baseH + shaftH * lerp(0.22, 0.8, rnd()), 0), matOf(opts, 'stoneDark'));
    }
    if (d.broken) {
      prim(g, boxG(r * 1.3, r * 0.8, r * 1.1), v3(r * 0.15, baseH + shaftH + r * 0.1, 0), matOf(opts, 'stone'),
        v3(15 + rnd() * 20, rnd() * 90, 10 + rnd() * 15), block);
      if (collide) prim(g, boxG(r * 1.4, r * 0.9, r * 1.2), v3(r * 2.6, r * 0.38, r * 1.4), matOf(opts, 'stoneDark'), v3(12, rnd() * 90, 8));
    } else if (rnd() < 0.5) {
      prim(g, boxG(r * 2.2, capH, r * 2.2), v3(0, hgt - capH / 2, 0), matOf(opts, 'stoneLight'), null, block);
    } else {
      prim(g, boxG(r * 1.75, capH * 0.45, r * 1.75), v3(0, hgt - capH * 0.78, 0), matOf(opts, 'stoneLight'), null, block);
      prim(g, boxG(r * 2.3, capH * 0.55, r * 2.3), v3(0, hgt - capH * 0.27, 0), matOf(opts, 'stoneLight'), v3(0, 8, 0), block);
    }
    if (collide) {
      mound(parent, d.x, gy + 0.14, d.z, r * 2.5, 0.28, r * 2.3, rnd() * 90);
      addCircle(d.x, d.z, r * 1.2);
    }
    return g;
  }

  function buildFallen(parent, d) {
    const y = heightAt(d.x, d.z) + d.r * 0.5;
    const g = group(parent, v3(d.x, y, d.z), v3(0, d.rotY, 0));
    prim(g, cylG(d.r, d.len, 12), v3(0, 0, 0), 'stone', v3(0, 0, 90), { camBlock: true });
    prim(g, cylG(d.r * 1.08, 0.13, 12), v3(-d.len * 0.2, 0, 0), 'stoneDark', v3(0, 0, 90));
    mound(g, d.len * 0.15, -d.r * 0.55, 0.15, d.len * 0.5, 0.3, d.r * 1.8);
    addBox(d.x, d.z, d.len / 2, d.r, d.rotY);
  }

  function buildWall(parent, d, opts = {}) {
    const collide = opts.collide !== false;
    const rand = rngAt(d.x, d.z, 2);
    const g = group(parent, v3(d.x, heightAt(d.x, d.z) - 0.2, d.z), v3(0, d.rotY, 0));
    const n = Math.max(2, Math.ceil(d.len / (collide ? 1.1 : d.len / 6)));
    const w = d.len / n;
    const depth = collide ? 0.8 : d.h * 0.2;
    for (let i = 0; i < n; i++) {
      const edge = i === 0 || i === n - 1;
      const h = d.h * (edge ? lerp(0.35, 0.6, rand()) : lerp(0.6, 1, rand()));
      prim(g, boxG(w - 0.04, h, depth), v3(-d.len / 2 + (i + 0.5) * w, h / 2, 0),
        matOf(opts, i % 2 ? 'stone' : 'stoneLight'), v3(0, 0, (rand() - 0.5) * 3), { camBlock: collide });
    }
    if (collide) {
      prim(g, boxG(0.9, 0.5, 0.7), v3(d.len * 0.3, 0.25, 0.95), 'stoneDark', v3(8, 30, 0));
      mound(g, 0, 0.15, 0.1, d.len * 0.58, 0.32, 1.0);
      addBox(d.x, d.z, d.len / 2, 0.45, d.rotY);
    }
  }

  function buildArch(parent, d, opts = {}) {
    const collide = opts.collide !== false;
    const s = d.w / 3.6;
    const g = group(parent, v3(d.x, heightAt(d.x, d.z) - 0.2, d.z), v3(0, d.rotY || 0, 0));
    const block = { camBlock: collide };
    const colW = 0.9 * s;
    const rightH = d.broken ? d.h * 0.55 : d.h;
    prim(g, boxG(colW, d.h, colW), v3(-d.w / 2, d.h / 2, 0), matOf(opts, 'stone'), null, block);
    prim(g, boxG(colW, rightH, colW), v3(d.w / 2, rightH / 2, 0), matOf(opts, 'stone'), null, block);
    if (d.broken) {
      prim(g, boxG(d.w * 0.6, 0.7 * s, 1.0 * s), v3(-d.w * 0.18, d.h + 0.3 * s, 0), matOf(opts, 'stoneLight'), v3(0, 0, -6), block);
    } else {
      prim(g, boxG(d.w + colW, 0.7 * s, 1.0 * s), v3(0, d.h + 0.35 * s, 0), matOf(opts, 'stoneLight'), null, block);
      prim(g, boxG(colW * 0.9, 0.5 * s, colW * 0.9), v3(0, d.h + 0.95 * s, 0), matOf(opts, 'stoneDark'), v3(0, 45, 0), block);
    }
    if (collide) {
      for (const sx of [-1, 1]) {
        mound(g, (sx * d.w) / 2, 0.15, 0, colW * 1.4, 0.3, colW * 1.4);
        const p = toWorld(d.x, d.z, d.rotY, (sx * d.w) / 2, 0);
        addCircle(p.x, p.z, colW * 0.75);
      }
    }
  }

  function buildBlock(parent, d) {
    const g = group(parent, v3(d.x, heightAt(d.x, d.z) + d.h / 2 - 0.12, d.z), v3(d.tilt || 0, d.rotY, 0));
    prim(g, boxG(d.w, d.h, d.d), v3(0, 0, 0), 'stoneDark', null, { camBlock: true });
    addBox(d.x, d.z, d.w / 2, d.d / 2, d.rotY);
  }

  function buildRock(parent, d) {
    const rnd = rngAt(d.x, d.z, 3);
    const y = heightAt(d.x, d.z);
    prim(parent, { primitive: 'dodecahedron', radius: r3(d.s * 0.5) }, v3(d.x, y + d.s * 0.12, d.z), 'rock',
      v3(10, d.rotY, 6), { scale: v3(1.25, 0.7, 1), camBlock: true });
    // 옆에 작은 바위 하나 (형태 다양화)
    const a = rnd() * Math.PI * 2;
    const ox = d.x + Math.sin(a) * d.s * 0.62;
    const oz = d.z + Math.cos(a) * d.s * 0.62;
    prim(parent, { primitive: 'icosahedron', radius: r3(d.s * 0.24) }, v3(ox, heightAt(ox, oz) + d.s * 0.04, oz), 'rock',
      v3(rnd() * 40, rnd() * 360, rnd() * 30), { scale: v3(1.2, 0.65, 1) });
    addCircle(d.x, d.z, d.s * 0.55);
  }

  /* ------------------------------------------------------------------------
   * 고대 문양 — 직선·호·점을 조합한 기하학적 룬 (오브젝트마다 다른 형태)
   *  좌표는 석판 한 변을 1로 본 단위 (-0.5 ~ 0.5), 위쪽 = +Y
   *  여러 획을 하나의 지오메트리로 합쳐 문양 하나 = 드로우콜 1회
   * ---------------------------------------------------------------------- */
  const RUNES = {
    // 큐브: 마름모 + 안쪽 작은 마름모 + 모서리 바깥 눈금
    cube: [
      ['bar', 0, 0.4, 0.4, 0], ['bar', 0.4, 0, 0, -0.4], ['bar', 0, -0.4, -0.4, 0], ['bar', -0.4, 0, 0, 0.4],
      ['bar', 0, 0.16, 0.16, 0], ['bar', 0.16, 0, 0, -0.16], ['bar', 0, -0.16, -0.16, 0], ['bar', -0.16, 0, 0, 0.16],
      ['bar', 0, 0.42, 0, 0.5], ['bar', 0, -0.42, 0, -0.5],
    ],
    // 무전기: 안테나(세로 기둥) + 퍼져 나가는 세 겹의 전파
    radio: [
      ['bar', -0.36, 0.34, -0.36, -0.34], ['dot', -0.36, 0, 0.07],
      ['arc', -0.36, 0, 0.17, -0.9, 0.9], ['arc', -0.36, 0, 0.32, -0.8, 0.8], ['arc', -0.36, 0, 0.47, -0.7, 0.7],
    ],
    // DVD: 두 겹의 원 + 가로지르는 선
    dvd: [
      ['arc', 0, 0, 0.36, 0, Math.PI * 2], ['dot', 0, 0, 0.08],
      ['bar', -0.48, 0, -0.22, 0], ['bar', 0.22, 0, 0.48, 0],
      ['bar', 0, 0.42, 0, 0.5],
    ],
    // 글라이더: 겹친 날개(꺾쇠) + 세로 줄기
    glider: [
      ['bar', -0.46, 0.02, 0, 0.3], ['bar', 0, 0.3, 0.46, 0.02],
      ['bar', -0.3, -0.16, 0, 0.04], ['bar', 0, 0.04, 0.3, -0.16],
      ['bar', 0, 0.3, 0, -0.44], ['dot', 0, -0.44, 0.06],
    ],
    // 비니: 둥근 덮개 + 받침선 + 두 줄기 + 꼭대기 점
    beanie: [
      ['arc', 0, -0.06, 0.34, 0, Math.PI], ['bar', -0.44, -0.06, 0.44, -0.06],
      ['bar', -0.17, -0.16, -0.17, -0.44], ['bar', 0.17, -0.16, 0.17, -0.44],
      ['dot', 0, 0.38, 0.06],
    ],
  };

  function runeGeometry(id, size, depth = 0.05, stroke = 0.075) {
    const parts = [];
    const w = stroke * size;
    for (const [kind, ...a] of RUNES[id] || RUNES.cube) {
      let g;
      if (kind === 'bar') {
        const [x1, y1, x2, y2] = a.map((v) => v * size);
        const len = Math.hypot(x2 - x1, y2 - y1) + w; // 끝을 살짝 겹쳐 이음매 없음
        g = new THREE.BoxGeometry(len, w, depth);
        g.rotateZ(Math.atan2(y2 - y1, x2 - x1));
        g.translate((x1 + x2) / 2, (y1 + y2) / 2, 0);
      } else if (kind === 'arc') {
        const [cx, cy, r, a0, a1] = a;
        g = new THREE.TorusGeometry(r * size, w / 2, 4, Math.max(8, Math.round((a1 - a0) * 9)), a1 - a0);
        g.scale(1, 1, depth / w);
        g.rotateZ(a0);
        g.translate(cx * size, cy * size, 0);
      } else {
        const [cx, cy, r] = a;
        g = new THREE.CylinderGeometry(r * size, r * size, depth, 10);
        g.rotateX(Math.PI / 2);
        g.translate(cx * size, cy * size, 0);
      }
      parts.push(g.index ? g.toNonIndexed() : g);
    }
    let count = 0;
    for (const g of parts) count += g.attributes.position.count;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    let off = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      off += g.attributes.position.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.computeBoundingSphere();
    return out;
  }

  /* 고대 포털 — 단상, 고리, 문양 5개(꺼진 상태), 중심부(개방 시 사용) */
  function buildPortal(parent) {
    const P = CFG.portal;
    const g = group(parent, v3(P.center.x, 0, P.center.z), null, 'portal');
    prim(g, cylG(P.stepRadius, 1.4, 20), v3(0, P.stepTop - 0.7, 0), 'stoneDark');
    prim(g, cylG(P.platformRadius, 1.6, 18), v3(0, P.platformTop - 0.8, 0), 'stone');
    groundOverrides.push({ x: P.center.x, z: P.center.z, r: P.platformRadius + 0.05, top: P.platformTop });
    groundOverrides.push({ x: P.center.x, z: P.center.z, r: P.stepRadius + 0.05, top: P.stepTop });

    const cy = P.platformTop + P.ringRadius * 0.75;
    const ring = group(g, v3(0, cy, 0), null, 'portal-ring');
    // 주의: A-Frame torus는 radiusTubular를 2배로 적용 → 실제 고리 두께(반지름) = ringTube * 2
    const tube = P.ringTube * 2;
    prim(ring, { primitive: 'torus', radius: P.ringRadius, radiusTubular: P.ringTube, segmentsRadial: 8, segmentsTubular: 28 },
      v3(0, 0, 0), 'stoneLight', null, { camBlock: true });
    // 안쪽 테 — 고리 안쪽 가장자리를 따라 (개방 시 빛나도록 병합 제외)
    prim(ring, { primitive: 'torus', radius: P.ringRadius - tube + 0.02, radiusTubular: 0.05, segmentsRadial: 4, segmentsTubular: 32 },
      v3(0, 0, 0), 'stoneDark', null, { id: 'portal-rim', cls: 'no-merge' });

    // 중심부 — 개방 연출용 (처음에는 보이지 않음)
    const core = group(ring, v3(0, 0, 0), null, 'portal-core', 'no-merge');
    core.setAttribute('portal-core', '');

    const footX = P.ringRadius * 0.66 + 0.55;
    for (const sx of [-1, 1]) {
      prim(g, boxG(1.1, 1.3, 1.4), v3(sx * footX, P.platformTop + 0.6, 0), 'stoneDark', null, { camBlock: true });
      addBox(P.center.x + sx * footX, P.center.z, 0.6, 0.75, 0);
    }

    // 입구 막이: 포털이 열리기 전에는 고리 안으로 걸어 들어갈 수 없음 (개방 시 해제)
    DP.World.portalBarrier = addBox(P.center.x, P.center.z, footX - 0.6, 0.2, 0);

    // 문양 석판 5개 — 고리 앞면에 바깥을 향해 새김 (문양은 빛나야 하므로 병합 제외)
    const size = P.glyphSize;
    P.glyphs.forEach((id, i) => {
      const deg = P.glyphAngles[i];
      const a = THREE.MathUtils.degToRad(deg);
      const x = P.ringRadius * Math.cos(a);
      const y = P.ringRadius * Math.sin(a);
      const slot = group(ring, v3(x, y, tube - 0.06), v3(0, 0, deg - 90)); // 고리 앞면에 반쯤 박힌 석판
      prim(slot, boxG(size * 1.08, size * 1.08, 0.1), v3(0, 0, -0.02), 'stoneDark');
      prim(slot, boxG(size, size, 0.12), v3(0, 0, 0), 'glyphPlate');
      const el = document.createElement('a-entity');
      el.id = `glyph-${id}`;
      el.className = 'portal-glyph no-merge';
      el.dataset.glyph = id;
      el.setAttribute('position', v3(0, 0, 0.085));
      slot.appendChild(el);
      el.setObject3D('mesh', new THREE.Mesh(runeGeometry(id, size * 0.78), getMaterial('glyphOff')));
    });
    return g;
  }

  /* 포털 중심부 — 부드러운 빛 (가산 혼합, 개방 전에는 숨김) */
  AFRAME.registerComponent('portal-core', {
    init() {
      const P = CFG.portal;
      this.material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        uniforms: { uTime: { value: 0 }, uOpen: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform float uTime; uniform float uOpen; varying vec2 vUv;
          void main(){
            vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
            float glow = 1.0 - smoothstep(0.0, 1.0, r);
            float swirl = 0.5 + 0.5 * sin(a * 5.0 - uTime * 0.7 + r * 9.0);
            float edge = 1.0 - smoothstep(0.88, 1.0, r);
            vec3 c = mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.95, 0.82), glow);
            float alpha = uOpen * edge * (0.25 + glow * 0.6 + swirl * 0.18 * glow);
            gl_FragColor = vec4(c * alpha, alpha);
          }`,
      });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(P.ringRadius - P.ringTube * 2 + 0.05, 40), this.material);
      mesh.visible = false;
      this.el.setObject3D('mesh', mesh);
    },
    tick(t) {
      this.material.uniforms.uTime.value = t / 1000;
      this.el.getObject3D('mesh').visible = this.material.uniforms.uOpen.value > 0.001;
    },
  });

  /* 원경 */
  function buildDistant(parent) {
    const g = group(parent, null, null, 'distant-ruins');
    for (const d of CFG.distant.ruins) {
      const a = THREE.MathUtils.degToRad(d.angle);
      const x = Math.sin(a) * d.dist;
      const z = -Math.cos(a) * d.dist;
      const opts = { collide: false, mat: 'ruinFar' };
      if (d.type === 'pillar') buildPillar(g, { x, z, h: d.h, r: d.r, broken: d.broken, rotY: d.angle }, opts);
      else if (d.type === 'wall') buildWall(g, { x, z, len: d.len, h: d.h, rotY: d.angle + 90 }, opts);
      else buildArch(g, { x, z, w: d.w, h: d.h, rotY: d.angle, broken: d.broken }, opts);
    }
    group(parent, null, null, 'mountains').setAttribute('mountain-ring', '');
    return g;
  }

  /* ------------------------------------------------------------------------
   * 9. 정적 메시 병합 — 재질이 같은 메시를 하나로 (원본 엔티티는 숨겨서 유지)
   *    카메라 충돌 레이캐스트는 숨겨진 원본으로 계속 동작합니다.
   * ---------------------------------------------------------------------- */
  function isExcluded(mesh, rootEl) {
    let el = mesh.el;
    while (el && el !== rootEl) {
      if (el.classList && el.classList.contains('no-merge')) return true;
      el = el.parentEl || el.parentNode;
    }
    return false;
  }

  function mergeStatic(rootEl, shadow = { cast: true, receive: true }) {
    if (!rootEl) return null;
    const root = rootEl.object3D;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const groups = new Map();
    const sources = [];
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.userData.merged || !o.el) return;
      if (!o.geometry || !o.geometry.attributes.position || o.material.isShaderMaterial) return;
      if (isExcluded(o, rootEl)) return;
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      if (!groups.has(o.material)) groups.set(o.material, []);
      groups.get(o.material).push({ geometry: o.geometry, matrix: m });
      sources.push(o);
    });
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    for (const [material, items] of groups) {
      let vc = 0;
      let ic = 0;
      for (const it of items) {
        vc += it.geometry.attributes.position.count;
        ic += it.geometry.index ? it.geometry.index.count : it.geometry.attributes.position.count;
      }
      const pos = new Float32Array(vc * 3);
      const nor = new Float32Array(vc * 3);
      const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
      let vo = 0;
      let io = 0;
      for (const it of items) {
        const g = it.geometry;
        const P = g.attributes.position;
        const N = g.attributes.normal;
        nm.getNormalMatrix(it.matrix);
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(it.matrix);
          pos.set([v.x, v.y, v.z], (vo + i) * 3);
          if (N) {
            v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
            nor.set([v.x, v.y, v.z], (vo + i) * 3);
          }
        }
        if (g.index) {
          for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
          io += g.index.count;
        } else {
          for (let i = 0; i < P.count; i++) idx[io + i] = vo + i;
          io += P.count;
        }
        vo += P.count;
      }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      merged.setIndex(new THREE.BufferAttribute(idx, 1));
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.userData.merged = true;
      mesh.castShadow = shadow.cast;
      mesh.receiveShadow = shadow.receive;
      root.add(mesh);
    }
    for (const o of sources) o.visible = false;
    return { sources: sources.length, merged: groups.size };
  }

  /* ------------------------------------------------------------------------
   * 10. 월드 생성
   * ---------------------------------------------------------------------- */
  function build(scene) {
    const A = CFG.atmosphere;
    const L = CFG.lighting;
    const R = CFG.render;
    scene.setAttribute('fog', { type: 'exponential', color: A.fogClear, density: Math.sqrt(Math.LN2) / A.visibility.interact });
    scene.object3D.background = new THREE.Color(A.fogClear);
    if (L.shadows) scene.setAttribute('shadow', { enabled: true, type: 'pcfsoft', autoUpdate: true });
    scene.renderer.shadowMap.enabled = !!L.shadows;

    // 렌더 해상도·화면 흐림·카메라 거리
    scene.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * R.pixelRatio);
    scene.canvas.style.filter = R.screenBlur > 0 ? `blur(${R.screenBlur}px)` : '';
    const camEl = document.getElementById('camera');
    if (camEl) camEl.setAttribute('camera', 'far', R.cameraFar);

    const sun = document.getElementById('sun-light');
    if (sun) {
      const light = { type: 'directional', color: L.sunColor, intensity: L.sunIntensity, castShadow: !!L.shadows };
      if (L.shadows) {
        Object.assign(light, {
          shadowMapWidth: L.shadowMapSize, shadowMapHeight: L.shadowMapSize,
          shadowCameraLeft: -L.shadowRange, shadowCameraRight: L.shadowRange,
          shadowCameraTop: L.shadowRange, shadowCameraBottom: -L.shadowRange,
          shadowCameraNear: 1, shadowCameraFar: 200, shadowBias: L.shadowBias,
        });
        sun.setAttribute('sun-follow', '');
      }
      sun.setAttribute('light', light);
      sun.setAttribute('position', L.sunPosition);
    }
    const hemi = document.getElementById('hemi-light');
    if (hemi) hemi.setAttribute('light', { type: 'hemisphere', color: L.hemiSky, groundColor: L.hemiGround, intensity: L.hemiIntensity });

    const world = document.createElement('a-entity');
    world.id = 'desert-world';
    if (R.distantScenery) group(world, null, null, 'sky').setAttribute('desert-sky', '');
    group(world, null, null, 'terrain').setAttribute('desert-terrain', '');
    const distant = R.distantScenery ? buildDistant(world) : null;

    const ruins = group(world, null, null, 'ruins');
    const builders = { pillar: buildPillar, fallen: buildFallen, wall: buildWall, arch: buildArch, block: buildBlock, rock: buildRock };
    for (const d of CFG.ruins) {
      const fn = builders[d.type];
      if (fn) fn(ruins, d);
      else console.warn('[world] 알 수 없는 유적 타입:', d.type);
    }
    const portal = buildPortal(world);

    group(world, null, null, 'interactables');
    group(world, null, null, 'sand-drift').setAttribute('drifting-sand', '');
    if (R.distantScenery) group(world, null, null, 'dust-veils').setAttribute('dust-veils', '');

    // 파편은 충돌 데이터가 모두 등록된 뒤에 배치
    group(world, null, null, 'debris').setAttribute('desert-debris', '');

    world.addEventListener('loaded', () => {
      requestAnimationFrame(() => {
        const info = {
          ruins: mergeStatic(ruins),
          portal: mergeStatic(portal),
          distant: distant ? mergeStatic(distant, { cast: false, receive: false }) : null,
        };
        console.info('[world] 정적 메시 병합', info);
      });
    }, { once: true });

    scene.appendChild(world);
    return world;
  }

  function getCameraBlockers() {
    if (activeEnv) return activeEnv.cameraBlockers || [];
    return Array.from(document.querySelectorAll('.cam-block')).map((el) => el.object3D);
  }

  DP.World = Object.assign(DP.World || {}, {
    build,
    heightAt,
    groundAt,
    isBlocked,
    insideCollider,
    addBox,
    addCircle,
    colliders,
    getCameraBlockers,
    getMaterial,
    emissiveMaterial,
    toWorld,
    setEnvironment,
    mulberry32,
    fbm,
  });
})();
