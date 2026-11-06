/* ==========================================================================
 *  Desert Passage — interactions/object-kit.js
 *  인터랙션 오브젝트가 공통으로 쓰는 도구
 *  · 메시 생성 (공유 재질 + 그림자 설정)
 *  · config.objects 기준 배치
 *  · 인터랙션 매니저 등록
 *  · GLB 모델 로딩 (config.models) — 실제 바운딩 박스로 크기·바닥·중심을 맞춤
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

DP.Kit = (function () {
  const CFG = DP.CONFIG;
  const D2R = THREE.MathUtils.degToRad;

  /**
   * THREE 메시 생성 후 parent에 추가
   * @param {THREE.Object3D} parent
   * @param {THREE.BufferGeometry} geometry
   * @param {string|THREE.Material} mat — 재질 키(config.materials) 또는 재질
   * @param {{pos?:number[], rot?:number[], scale?:number[]|number, cast?:boolean, receive?:boolean}} o — rot은 도 단위
   */
  function mesh(parent, geometry, mat, o = {}) {
    const m = new THREE.Mesh(geometry, typeof mat === 'string' ? DP.World.getMaterial(mat) : mat);
    if (o.pos) m.position.set(o.pos[0], o.pos[1], o.pos[2]);
    if (o.rot) m.rotation.set(D2R(o.rot[0]), D2R(o.rot[1]), D2R(o.rot[2]));
    if (o.scale != null) {
      if (Array.isArray(o.scale)) m.scale.set(o.scale[0], o.scale[1], o.scale[2]);
      else m.scale.setScalar(o.scale);
    }
    m.castShadow = o.cast !== false;
    m.receiveShadow = o.receive !== false;
    parent.add(m);
    return m;
  }

  function group(parent, pos, rot) {
    const g = new THREE.Group();
    if (pos) g.position.set(pos[0], pos[1], pos[2]);
    if (rot) g.rotation.set(D2R(rot[0]), D2R(rot[1]), D2R(rot[2]));
    parent.add(g);
    return g;
  }

  /** config.objects[id] 위치·방향으로 엔티티 배치 후 설정 반환 */
  function place(el, id) {
    const c = CFG.objects[id];
    el.object3D.position.set(c.x, DP.World.heightAt(c.x, c.z), c.z);
    el.object3D.rotation.y = D2R(c.rotY || 0);
    return c;
  }

  /** 오브젝트 로컬 좌표 → 월드 좌표 */
  function worldPoint(obj, x, y, z, out = new THREE.Vector3()) {
    obj.updateMatrixWorld(true);
    return out.set(x, y, z).applyMatrix4(obj.matrixWorld);
  }

  function register(def) {
    const im = AFRAME.scenes[0].systems['interaction-manager'];
    im.register(def);
  }

  /** 캐릭터 머리 위치와 정면 방향 (시네마틱 샷 계산용) */
  function headFrame() {
    const head = DP.Character ? DP.Character.headObject() : document.getElementById('avatar-head').object3D;
    const pos = head.getWorldPosition(new THREE.Vector3());
    const facing = document.getElementById('player').components['player-controller'].facing;
    const fwd = new THREE.Vector3(-Math.sin(facing), 0, -Math.cos(facing));
    const right = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
    return { pos, fwd, right, facing };
  }

  /**
   * 움직이지 않는 부품을 재질별로 하나의 메시로 합침 (드로우콜 절감)
   * keep에 넣은 오브젝트(와 그 하위)는 움직여야 하므로 합치지 않음
   */
  function mergeStatic(root, keep = []) {
    const keepSet = new Set(keep);
    const isKept = (o) => {
      for (let p = o; p && p !== root; p = p.parent) if (keepSet.has(p)) return true;
      return false;
    };
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const byMat = new Map();
    const remove = [];
    root.traverse((o) => {
      if (!o.isMesh || o === root || isKept(o) || o.material.vertexColors) return;
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(m);
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
      remove.push(o);
    });
    for (const o of remove) o.parent.remove(o);
    for (const [mat, geos] of byMat) {
      const count = geos.reduce((s, g) => s + g.attributes.position.count, 0);
      const pos = new Float32Array(count * 3);
      const nor = new Float32Array(count * 3);
      let off = 0;
      for (const g of geos) {
        pos.set(g.attributes.position.array, off * 3);
        if (g.attributes.normal) nor.set(g.attributes.normal.array, off * 3);
        off += g.attributes.position.count;
        g.dispose();
      }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      merged.computeBoundingSphere();
      root.add(new THREE.Mesh(merged, mat));
    }
    return { removed: remove.length, merged: byMat.size };
  }

  /* ------------------------------------------------------------------------
   * GLB 로딩
   *  · 같은 파일은 한 번만 내려받음 (캐시)
   *  · rotY로 정면 보정 → 바운딩 박스 측정 → axis 방향 길이를 size(m)에 맞춤
   *    → 바닥이 y=0, 가로 중심이 원점에 오도록 이동
   *  · 실패하면 콘솔·화면에 알리고 같은 크기의 임시 상자로 대체 (진행은 계속 가능)
   * ---------------------------------------------------------------------- */
  const cache = new Map();
  let loader = null;
  function fetchGLTF(file) {
    if (!cache.has(file)) {
      if (!loader) loader = new THREE.GLTFLoader();
      cache.set(file, new Promise((resolve, reject) => loader.load(file, resolve, undefined, reject)));
    }
    return cache.get(file);
  }

  function tuneMaterials(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        // 환경맵이 없는 사막 조명에서 금속 재질이 검게 보이지 않도록
        if ('metalness' in m) m.metalness = Math.min(m.metalness, 0.35);
        if (m.map) m.map.anisotropy = 4;
      }
    });
  }

  /**
   * @param {string} key — config.models의 키
   * @returns {Promise<{root:THREE.Group, size:THREE.Vector3, ok:boolean}>}
   *   root: 바닥 중심이 원점인 묶음 (위치·회전·스케일은 root에 주면 됨)
   */
  async function loadModel(key) {
    const def = CFG.models[key];
    const root = new THREE.Group();
    root.name = `model-${key}`;
    const pivot = new THREE.Group();
    root.add(pivot);
    let ok = true;
    try {
      const gltf = await fetchGLTF(def.file);
      const scene = cache.get(def.file).used ? gltf.scene.clone(true) : gltf.scene;
      cache.get(def.file).used = true;
      tuneMaterials(scene);
      pivot.add(scene);
    } catch (err) {
      ok = false;
      console.error(`[model] '${def.file}' 을(를) 불러오지 못했습니다. 임시 상자로 대체합니다.`, err);
      if (DP.Util && DP.Util.toast) DP.Util.toast(`모델을 불러오지 못했습니다: ${def.file}`, 4);
      const d = def.size;
      pivot.add(new THREE.Mesh(new THREE.BoxGeometry(d, d * 0.6, d * 0.6), DP.World.getMaterial('stoneDark')));
    }
    pivot.rotation.y = D2R(def.rotY || 0);
    pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pivot);
    const size = box.getSize(new THREE.Vector3());
    const s = ok ? def.size / Math.max(1e-6, size[def.axis || 'x']) : 1;
    pivot.scale.setScalar(s);
    pivot.updateMatrixWorld(true);
    box.setFromObject(pivot);
    const c = box.getCenter(new THREE.Vector3());
    pivot.position.set(-c.x, -box.min.y, -c.z);
    root.updateMatrixWorld(true);
    return { root, size: box.getSize(new THREE.Vector3()), ok };
  }

  /** 시작 전에 모든 모델을 미리 내려받음 (시작 버튼은 이게 끝난 뒤 활성화) */
  function preloadModels(onProgress) {
    const files = [...new Set(Object.values(CFG.models).map((m) => m.file))];
    let done = 0;
    return Promise.all(files.map((f) => fetchGLTF(f).catch((e) => e).finally(() => onProgress && onProgress(++done, files.length))));
  }

  /** 오브젝트를 은은하게 빛나게 하는 부드러운 빛 덩어리 (가산 혼합 스프라이트) */
  let glowTex = null;
  function glowSprite(color, size) {
    if (!glowTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      glowTex = new THREE.CanvasTexture(c);
    }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sp.scale.setScalar(size);
    return sp;
  }

  /** 1인칭 인터랙션: 카메라 앞 dist(m) 지점 (화면 중앙에서 down만큼 아래) */
  function frontOfCamera(cameraObj, dist, down = 0, out = new THREE.Vector3()) {
    const q = cameraObj.getWorldQuaternion(new THREE.Quaternion());
    const p = cameraObj.getWorldPosition(new THREE.Vector3());
    out.set(0, -down, -dist).applyQuaternion(q).add(p);
    return out;
  }

  /** 1인칭 인터랙션: 다음 좌클릭을 기다림 (minSec 전 클릭은 무시) */
  function waitClick(minSec = 0.25) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const h = (e) => {
        if (e.button !== 0 || (performance.now() - t0) / 1000 < minSec) return;
        document.removeEventListener('mousedown', h);
        resolve();
      };
      document.addEventListener('mousedown', h);
    });
  }

  /** 오브젝트의 정면(+Z)이 카메라를 향하는 월드 회전 */
  function facingCamera(cameraObj, out = new THREE.Quaternion()) {
    return cameraObj.getWorldQuaternion(out);
  }

  return { mesh, group, place, worldPoint, register, headFrame, mergeStatic, D2R, loadModel, preloadModels, glowSprite, frontOfCamera, waitClick, facingCamera };
})();
