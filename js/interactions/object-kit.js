/* ==========================================================================
 *  Desert Passage — interactions/object-kit.js
 *  인터랙션 오브젝트가 공통으로 쓰는 도구
 *  · 메시 생성 (공유 재질 + 그림자 설정)
 *  · config.objects 기준 배치
 *  · 인터랙션 매니저 등록
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
    const head = document.getElementById('avatar-head');
    const pos = head.object3D.getWorldPosition(new THREE.Vector3());
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

  return { mesh, group, place, worldPoint, register, headFrame, mergeStatic, D2R };
})();
