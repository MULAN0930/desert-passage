/* ==========================================================================
 *  Desert Passage — paradise-builder.js
 *  포털 너머의 낙원 (Phase 5)
 *
 *  · 사막과 완전히 분리된 월드 엔티티(#paradise-world)로 생성
 *    포털을 통과하는 순간(화면이 밝게 덮였을 때) 처음 만들어지므로
 *    사막을 탐험하는 동안에는 메모리·렌더링 비용이 없음
 *  · 지형 높이 / 충돌 / 카메라 장애물 함수를 반환 → DP.World.setEnvironment()로 연결
 *  · 반복되는 자연물은 모두 InstancedMesh (나무·풀·덤불·꽃·바위·가지)
 *    → 식생 수천 개를 드로우콜 십여 회로 표현
 *  · 그림자는 실시간 계산 대신 나무 아래 지형 색을 어둡게 칠해서 표현
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

DP.Paradise = (function () {
  const CFG = DP.CONFIG;
  const U = DP.Util;
  const { lerp, clamp, smoothstep, mulberry32 } = U;

  /* ------------------------------------------------------------------------
   * 곡선 (개울·오솔길) — 제어점을 부드러운 곡선으로 샘플링
   * ---------------------------------------------------------------------- */
  function sampleCurve(points, step = 1.5) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const n = Math.max(8, Math.round(curve.getLength() / step));
    return curve.getSpacedPoints(n).map((v) => [v.x, v.z]);
  }

  /** 점에서 꺾은선까지 최단 거리 (+ 가장 가까운 점, 진행 비율) */
  function nearest(poly, x, z) {
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    let bi = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const ax = poly[i][0];
      const az = poly[i][1];
      const abx = poly[i + 1][0] - ax;
      const abz = poly[i + 1][1] - az;
      const len2 = abx * abx + abz * abz || 1;
      const k = clamp(((x - ax) * abx + (z - az) * abz) / len2, 0, 1);
      const px = ax + abx * k;
      const pz = az + abz * k;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < best) {
        best = d;
        bx = px;
        bz = pz;
        bi = i + k;
      }
    }
    return { d: Math.sqrt(best), x: bx, z: bz, i: bi };
  }

  function build(scene) {
    const P = CFG.paradise;
    const C = P.colors;
    const fbm = DP.World.fbm;
    const seed = P.seed;
    const stream = sampleCurve(P.stream.points, 1.2);
    const paths = P.paths.map((p) => ({ pts: sampleCurve(p.points, 1.0), w: p.width }));
    const SW = P.stream.width;

    /* ---------------- 지형 높이 ---------------- */
    function rawHeight(x, z) {
      const r = Math.hypot(x, z);
      let h = (fbm(x * 0.035, z * 0.035, 3, seed) - 0.5) * 2 * P.hillAmp;
      h += (fbm(x * 0.012 + 7, z * 0.012 - 3, 2, seed + 3) - 0.5) * 2 * P.hillAmp * 1.6;
      // 바깥쪽은 서서히 높아지는 언덕 → 시야 끝이 갑자기 끊기지 않음
      const rim = smoothstep(P.rimStart, P.rimEnd, r);
      h += rim * P.rimAmp * (0.55 + 0.45 * fbm(x * 0.018, z * 0.018, 3, seed + 9));
      return h;
    }

    function pathDistance(x, z) {
      let d = Infinity;
      for (const p of paths) d = Math.min(d, nearest(p.pts, x, z).d - p.w / 2);
      return d;
    }

    function heightAt(x, z) {
      let h = rawHeight(x, z);
      const n = nearest(stream, x, z);
      if (n.d < SW * 4) {
        // 개울 주변은 개울 중심 높이로 평평하게 → 물 높이와 둑이 자연스럽게 이어짐
        const hc = rawHeight(n.x, n.z);
        h = lerp(hc, h, smoothstep(SW * 1.2, SW * 4, n.d));
        h -= P.stream.depth * (1 - smoothstep(SW * 0.45, SW * 1.6, n.d));
      }
      return h;
    }

    /* ---------------- 충돌 (원형만, 물리 엔진 없음) ---------------- */
    const circles = [];
    function isBlocked(x, z, radius) {
      if (Math.hypot(x, z) > P.playRadius - radius) return true;
      for (const c of circles) {
        const rr = c.r + radius;
        if ((x - c.x) ** 2 + (z - c.z) ** 2 < rr * rr) return true;
      }
      return false;
    }

    /* ---------------- 배치 헬퍼 ---------------- */
    const rand = mulberry32(seed * 131 + 7);
    const spawn = P.spawn;
    const occupied = []; // 나무 간격 유지용
    const streamD = (x, z) => nearest(stream, x, z).d;
    const free = (x, z, gap) => occupied.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (gap + o.r) ** 2);

    const world = document.createElement('a-entity');
    world.id = 'paradise-world';
    const root = world.object3D;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const sc = new THREE.Vector3();
    const ps = new THREE.Vector3();
    const col = new THREE.Color();

    const lambert = (opts) => new THREE.MeshLambertMaterial({ flatShading: true, ...opts });
    function instanced(geo, mat, list, colorFn) {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      list.forEach((it, i) => {
        eul.set(it.rx || 0, it.ry || 0, it.rz || 0);
        q.setFromEuler(eul);
        ps.set(it.x, it.y, it.z);
        sc.set(it.sx, it.sy, it.sz);
        m4.compose(ps, q, sc);
        mesh.setMatrixAt(i, m4);
        if (colorFn) mesh.setColorAt(i, colorFn(it, i));
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
      return mesh;
    }
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const tint = (hex, amt) => col.set(hex).offsetHSL((rand() - 0.5) * 0.02, (rand() - 0.5) * 0.08, (rand() - 0.5) * amt);

    /* ---------------- 나무 (가까운 곳: 줄기 + 수관 / 먼 곳: 수관만) ---------------- */
    const trees = [];
    let guard = 0;
    while (trees.length < P.trees.near && guard++ < 6000) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(lerp(0.02, 1, rand())) * P.trees.nearRadius;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      // 숲이 모이는 곳과 빈터가 생기도록 노이즈로 밀도 조절 (규칙적인 반복 방지)
      if (rand() > 0.15 + 0.85 * smoothstep(0.38, 0.68, fbm(x * 0.045, z * 0.045, 2, seed + 21))) continue;
      if (Math.hypot(x - spawn.x, z - spawn.z) < 7) continue;
      if (streamD(x, z) < SW * 2.2 || pathDistance(x, z) < 1.4) continue;
      if (!free(x, z, 2.4)) continue;
      const pine = rand() < 0.38;
      const s = lerp(0.8, 1.35, rand());
      const t = { x, z, y: heightAt(x, z), s, pine, r: 0.3 };
      trees.push(t);
      occupied.push(t);
      circles.push({ x, z, r: 0.32 * s });
    }

    const trunkGeo = new THREE.CylinderGeometry(0.11, 0.18, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const trunkList = trees.map((t) => {
      const h = (t.pine ? 1.3 : 2.1) * t.s;
      return { x: t.x, y: t.y - 0.1, z: t.z, sx: t.s, sy: h + 0.1, sz: t.s, ry: rand() * 6, rz: (rand() - 0.5) * 0.08 };
    });
    const trunkMesh = instanced(trunkGeo, lambert({ color: C.trunk }), trunkList, () => tint(C.trunk, 0.06));

    const blobGeo = new THREE.IcosahedronGeometry(1, 0);
    const blobs = [];
    const cones = [];
    for (const t of trees) {
      if (t.pine) {
        const base = t.y + 1.0 * t.s;
        for (let k = 0; k < 3; k++) {
          const rr = (1.35 - k * 0.32) * t.s;
          cones.push({ x: t.x, y: base + k * 1.05 * t.s, z: t.z, sx: rr, sy: 1.9 * t.s, sz: rr, ry: rand() * 6, c: pick(C.pine) });
        }
      } else {
        const top = t.y + 2.1 * t.s;
        blobs.push({ x: t.x, y: top + 0.55 * t.s, z: t.z, sx: 1.55 * t.s, sy: 1.25 * t.s, sz: 1.5 * t.s, ry: rand() * 6, c: pick(C.leaves) });
        const n = 1 + Math.floor(rand() * 2);
        for (let k = 0; k < n; k++) {
          const a = rand() * Math.PI * 2;
          blobs.push({
            x: t.x + Math.sin(a) * 0.85 * t.s, y: top + (0.2 + rand() * 0.7) * t.s, z: t.z + Math.cos(a) * 0.85 * t.s,
            sx: 0.95 * t.s, sy: 0.8 * t.s, sz: 0.95 * t.s, ry: rand() * 6, c: pick(C.leaves),
          });
        }
      }
    }
    instanced(blobGeo, lambert({ color: '#ffffff' }), blobs, (b) => tint(b.c, 0.08));
    const coneGeo = new THREE.ConeGeometry(1, 1, 7);
    coneGeo.translate(0, 0.5, 0);
    instanced(coneGeo, lambert({ color: '#ffffff' }), cones, (c) => tint(c.c, 0.06));

    // 먼 숲: 낮은 디테일 (줄기 없이 수관만, 안개에 서서히 묻힘)
    const farCones = [];
    const farBlobs = [];
    guard = 0;
    while (farCones.length + farBlobs.length < P.trees.far && guard++ < 8000) {
      const a = rand() * Math.PI * 2;
      const r = lerp(P.trees.farMin, P.trees.farMax, Math.sqrt(rand()));
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (streamD(x, z) < SW * 3) continue;
      if (rand() > 0.25 + 0.75 * smoothstep(0.35, 0.6, fbm(x * 0.03, z * 0.03, 2, seed + 33))) continue;
      const y = heightAt(x, z);
      const s = lerp(1.6, 3.2, rand());
      if (rand() < 0.5) farCones.push({ x, y: y - 0.3, z, sx: s * 1.1, sy: s * 3.4, sz: s * 1.1, ry: rand() * 6 });
      else farBlobs.push({ x, y: y + s * 1.6, z, sx: s * 1.4, sy: s * 1.3, sz: s * 1.4, ry: rand() * 6 });
    }
    const farGeo = new THREE.ConeGeometry(1, 1, 5);
    farGeo.translate(0, 0.5, 0);
    instanced(farGeo, lambert({ color: '#ffffff' }), farCones, () => tint(C.pine[0], 0.07));
    instanced(blobGeo, lambert({ color: '#ffffff' }), farBlobs, () => tint(C.far, 0.07));

    /* ---------------- 지형 메시 (꼭짓점 색: 풀 / 오솔길 / 둑 / 나무 그늘) ---------------- */
    {
      const geo = new THREE.PlaneGeometry(P.terrainSize, P.terrainSize, P.terrainSegments, P.terrainSegments);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const g0 = new THREE.Color(C.grass[0]);
      const g1 = new THREE.Color(C.grass[1]);
      const g2 = new THREE.Color(C.grass[2]);
      const gd = new THREE.Color(C.grassDark);
      const pathC = new THREE.Color(C.path);
      const bank = new THREE.Color(C.bank);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const h = heightAt(x, z);
        pos.setY(i, h);
        const n = fbm(x * 0.06, z * 0.06, 2, seed + 4);
        c.copy(g0).lerp(g1, smoothstep(0.3, 0.6, n)).lerp(g2, smoothstep(0.6, 0.85, n) * 0.7);
        // 높은 언덕은 밝게, 먼 곳은 살짝 푸르게
        const r = Math.hypot(x, z);
        c.lerp(g2, smoothstep(P.rimStart, P.rimEnd, r) * 0.35);
        // 나무 아래 그늘 (실시간 그림자 대신)
        if (r < P.trees.nearRadius + 6) {
          let shade = 0;
          for (const t of trees) {
            const d2 = (t.x - x) ** 2 + (t.z - z) ** 2;
            const rr = 2.4 * t.s;
            if (d2 < rr * rr) shade = Math.max(shade, 1 - Math.sqrt(d2) / rr);
          }
          c.lerp(gd, shade * 0.75);
        }
        const sd = streamD(x, z);
        c.lerp(bank, 1 - smoothstep(SW * 0.6, SW * 1.7, sd));
        const pd = pathDistance(x, z);
        c.lerp(pathC, (1 - smoothstep(-0.2, 0.5, pd)) * 0.9);
        colors.set([c.r, c.g, c.b], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, lambert({ vertexColors: true }));
      root.add(mesh);
    }

    /* ---------------- 개울 (반투명 띠 + 천천히 흐르는 물결 무늬) ---------------- */
    const streamPoints = [];
    let water = null;
    {
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 128;
      const g = cv.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 64, 128);
      const r2 = mulberry32(3);
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(255,255,255,${0.25 + r2() * 0.3})`;
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = `rgba(200,230,232,${0.35 + r2() * 0.35})`;
        g.fillRect(r2() * 56, r2() * 128, 4 + r2() * 14, 1 + r2() * 2);
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      const half = SW * 1.15;
      const verts = [];
      const uvs = [];
      const idx = [];
      let dist = 0;
      for (let i = 0; i < stream.length; i++) {
        const [x, z] = stream[i];
        const [nx, nz] = stream[Math.min(i + 1, stream.length - 1)];
        const [px, pz] = stream[Math.max(i - 1, 0)];
        let tx = nx - px;
        let tz = nz - pz;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        if (i > 0) dist += Math.hypot(x - stream[i - 1][0], z - stream[i - 1][1]);
        const y = rawHeight(x, z) - P.stream.depth + P.stream.water;
        streamPoints.push([x, z, y]);
        verts.push(x - tz * half, y, z + tx * half, x + tz * half, y, z - tx * half);
        uvs.push(0, dist / 6, 1, dist / 6);
        if (i > 0) {
          const a = (i - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({
        color: C.water, map: tex, transparent: true, opacity: 0.82, emissive: C.waterDeep, emissiveIntensity: 0.18, side: THREE.DoubleSide,
      });
      water = new THREE.Mesh(geo, mat);
      water.renderOrder = 1;
      root.add(water);
    }

    /* ---------------- 풀 (잎 4장짜리 덤불 하나 = 삼각형 4개) ---------------- */
    {
      const blade = [];
      const shade = [];
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI + rand() * 0.4;
        const w = 0.05;
        const h = 0.32 + rand() * 0.2;
        const lean = 0.08 + rand() * 0.1;
        const cx = Math.cos(a);
        const cz = Math.sin(a);
        blade.push(-cx * w, 0, -cz * w, cx * w, 0, cz * w, -cz * lean, h, cx * lean);
        shade.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.95, 0.95, 0.95);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(blade, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(shade, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(blade.length / 3).fill([0, 1, 0]).flat(), 3));
      const list = [];
      guard = 0;
      while (list.length < P.grass && guard++ < P.grass * 6) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * (P.playRadius + 4);
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        if (rand() > 0.3 + 0.7 * fbm(x * 0.08, z * 0.08, 2, seed + 51)) continue;
        if (streamD(x, z) < SW * 1.05) continue;
        if (pathDistance(x, z) < 0.1 && rand() < 0.9) continue;
        const s = lerp(0.7, 1.5, rand());
        list.push({ x, y: heightAt(x, z) - 0.02, z, sx: s, sy: s * lerp(0.8, 1.3, rand()), sz: s, ry: rand() * 6 });
      }
      instanced(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), list, () => tint(pick(C.grass), 0.1));
    }

    /* ---------------- 덤불 ---------------- */
    {
      const list = [];
      guard = 0;
      while (list.length < P.bushes && guard++ < 4000) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * (P.playRadius + 6);
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        if (streamD(x, z) < SW * 1.6 || pathDistance(x, z) < 0.6) continue;
        if (Math.hypot(x - spawn.x, z - spawn.z) < 4) continue;
        const s = lerp(0.45, 1.0, rand());
        list.push({ x, y: heightAt(x, z) + s * 0.25, z, sx: s * 1.3, sy: s * 0.8, sz: s * 1.2, ry: rand() * 6, c: pick(C.leaves) });
      }
      instanced(new THREE.DodecahedronGeometry(1, 0), lambert({ color: '#ffffff' }), list, (b) => tint(b.c, 0.1));
    }

    /* ---------------- 작은 꽃 (무리 지어 핌) ---------------- */
    {
      const list = [];
      const patches = Math.round(P.flowers / 26);
      for (let p = 0; p < patches; p++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * P.playRadius;
        const cx = Math.sin(a) * r;
        const cz = Math.cos(a) * r;
        const main = pick(C.flowers);
        for (let k = 0; k < 26; k++) {
          const x = cx + (rand() - 0.5) * 4.5;
          const z = cz + (rand() - 0.5) * 4.5;
          if (streamD(x, z) < SW * 1.1 || pathDistance(x, z) < 0) continue;
          const s = lerp(0.7, 1.3, rand());
          list.push({ x, y: heightAt(x, z) + 0.16 + rand() * 0.14, z, sx: s, sy: s * 0.7, sz: s, ry: rand() * 6, c: rand() < 0.8 ? main : pick(C.flowers) });
        }
      }
      instanced(new THREE.OctahedronGeometry(0.055, 0), lambert({ color: '#ffffff', emissive: '#2a2a20' }), list, (f) => col.set(f.c));
    }

    /* ---------------- 둥근 바위 (+ 오솔길이 개울을 건너는 곳의 디딤돌) ---------------- */
    {
      const list = [];
      guard = 0;
      while (list.length < P.rocks && guard++ < 3000) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * (P.playRadius + 8);
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        const sd = streamD(x, z);
        if (sd < SW * 0.9 || pathDistance(x, z) < 0.5) continue;
        if (Math.hypot(x - spawn.x, z - spawn.z) < 5) continue;
        // 개울가에 더 많이
        if (sd > SW * 3 && rand() < 0.5) continue;
        const s = lerp(0.25, 1.3, rand() * rand());
        list.push({ x, y: heightAt(x, z) + s * 0.15, z, sx: s * 1.2, sy: s * 0.7, sz: s, ry: rand() * 6, rx: (rand() - 0.5) * 0.3 });
        if (s > 0.75) circles.push({ x, z, r: s * 0.9 });
      }
      // 디딤돌
      for (const p of paths) {
        for (let i = 0; i < p.pts.length; i += 1) {
          const [x, z] = p.pts[i];
          const sd = streamD(x, z);
          if (sd < SW * 1.1) {
            list.push({ x: x + (rand() - 0.5) * 0.3, y: heightAt(x, z) + 0.2, z: z + (rand() - 0.5) * 0.3, sx: 0.5, sy: 0.32, sz: 0.45, ry: rand() * 6 });
          }
        }
      }
      instanced(new THREE.IcosahedronGeometry(1, 1), lambert({ color: '#ffffff' }), list, () => tint(pick(C.rock), 0.06));
    }

    /* ---------------- 쓰러진 나뭇가지 ---------------- */
    {
      const list = [];
      guard = 0;
      while (list.length < P.branches && guard++ < 2000) {
        const t = trees[Math.floor(rand() * trees.length)];
        if (!t) break;
        const a = rand() * Math.PI * 2;
        const x = t.x + Math.sin(a) * (1.4 + rand() * 1.6);
        const z = t.z + Math.cos(a) * (1.4 + rand() * 1.6);
        if (pathDistance(x, z) < 0.3 || streamD(x, z) < SW) continue;
        const len = lerp(0.9, 2.1, rand());
        list.push({ x, y: heightAt(x, z) + 0.06, z, sx: 1, sy: len, sz: 1, rz: Math.PI / 2 + (rand() - 0.5) * 0.15, ry: rand() * 6 });
      }
      instanced(new THREE.CylinderGeometry(0.045, 0.075, 1, 5), lambert({ color: '#ffffff' }), list, () => tint(C.trunk, 0.08));
    }

    /* ---------------- 먼 언덕 (지형 바깥, 시야 끝을 감쌈) ---------------- */
    {
      const list = [];
      for (let i = 0; i < P.hills; i++) {
        const a = (i / P.hills) * Math.PI * 2 + rand() * 0.2;
        const r = lerp(140, 210, rand());
        const s = lerp(30, 60, rand());
        list.push({ x: Math.sin(a) * r, y: lerp(4, 12, rand()), z: Math.cos(a) * r, sx: s, sy: lerp(18, 38, rand()), sz: s * lerp(0.7, 1.1, rand()), ry: rand() * 6 });
      }
      instanced(new THREE.IcosahedronGeometry(1, 1), lambert({ color: '#ffffff' }), list, () => tint(pick(C.hill), 0.05));
    }

    /* ---------------- 하늘 (꼭짓점 색 그라데이션, 안개 영향 없음) + 구름 ---------------- */
    {
      const geo = new THREE.SphereGeometry(400, 24, 12);
      const top = new THREE.Color(C.skyTop);
      const hor = new THREE.Color(C.skyHorizon);
      const c = new THREE.Color();
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const k = smoothstep(-0.05, 0.55, pos.getY(i) / 400);
        c.copy(hor).lerp(top, k);
        colors.set([c.r, c.g, c.b], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
      sky.renderOrder = -1;
      sky.frustumCulled = false;
      root.add(sky);
      const clouds = [];
      for (let i = 0; i < 14; i++) {
        const a = rand() * Math.PI * 2;
        const r = lerp(120, 300, rand());
        const s = lerp(14, 34, rand());
        clouds.push({ x: Math.sin(a) * r, y: lerp(70, 120, rand()), z: Math.cos(a) * r, sx: s * 1.8, sy: s * 0.35, sz: s, ry: rand() * 6 });
      }
      const cloudMesh = instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#fbfaf4', fog: false, transparent: true, opacity: 0.85 }), clouds);
      cloudMesh.frustumCulled = false;
      world.dataset.clouds = '1';
      world._clouds = cloudMesh;
    }

    /* ---------------- 꽃가루 (플레이어 주변을 천천히 떠다님) ---------------- */
    const pollen = document.createElement('a-entity');
    pollen.setAttribute('paradise-pollen', '');
    world.appendChild(pollen);

    world._water = water;
    world.setAttribute('paradise-life', '');
    scene.appendChild(world);

    return {
      el: world,
      groundAt: heightAt,
      heightAt,
      isBlocked,
      cameraBlockers: [trunkMesh],
      streamPoints,
      stats: { trees: trees.length, grass: P.grass },
    };
  }

  /* 물결 흐름 + 구름 이동 (아주 가벼운 애니메이션) */
  AFRAME.registerComponent('paradise-life', {
    tick(t, dt) {
      if (!dt) return;
      const s = Math.min(dt, 100) / 1000;
      const w = this.el._water;
      if (w && w.material.map) w.material.map.offset.y -= s * 0.12;
      const c = this.el._clouds;
      if (c) c.rotation.y += s * 0.002;
    },
  });

  /* 꽃가루·작은 씨앗 — 사막 모래 입자의 낙원판 (적은 수, 느리게) */
  AFRAME.registerComponent('paradise-pollen', {
    init() {
      const N = CFG.paradise.pollen;
      const r = mulberry32(9);
      this.n = N;
      this.pos = new Float32Array(N * 3);
      this.ph = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        this.pos[i * 3] = (r() - 0.5) * 24;
        this.pos[i * 3 + 1] = r() * 4;
        this.pos[i * 3 + 2] = (r() - 0.5) * 24;
        this.ph[i] = r() * 10;
      }
      const geo = new THREE.BufferGeometry();
      this.attr = new THREE.BufferAttribute(this.pos, 3);
      this.attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', this.attr);
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#fff6d8', size: 0.05, transparent: true, opacity: 0.75, depthWrite: false }));
      pts.frustumCulled = false;
      this.el.setObject3D('mesh', pts);
      this.player = document.getElementById('player');
    },
    tick(t, dt) {
      if (!dt) return;
      const s = Math.min(dt, 100) / 1000;
      const p = this.player.object3D.position;
      const P = this.pos;
      const k = t / 1000;
      for (let i = 0; i < this.n; i++) {
        const j = i * 3;
        P[j] += (0.25 + Math.sin(k * 0.5 + this.ph[i]) * 0.2) * s;
        P[j + 1] += Math.sin(k * 0.8 + this.ph[i] * 2) * 0.08 * s;
        P[j + 2] += Math.cos(k * 0.3 + this.ph[i]) * 0.15 * s;
        if (P[j] - p.x > 12) P[j] -= 24; else if (P[j] - p.x < -12) P[j] += 24;
        if (P[j + 2] - p.z > 12) P[j + 2] -= 24; else if (P[j + 2] - p.z < -12) P[j + 2] += 24;
        if (P[j + 1] - p.y > 4) P[j + 1] -= 4; else if (P[j + 1] - p.y < 0.1) P[j + 1] += 3.8;
      }
      this.attr.needsUpdate = true;
    },
  });

  return { build };
})();
