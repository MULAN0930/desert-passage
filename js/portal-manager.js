/* ==========================================================================
 *  Desert Passage — portal-manager.js
 *  · 처음 완료된 오브젝트의 문양을 포털 카메라 연출과 함께 점등
 *      포털 전경 → 해당 문양 클로즈업 → 발광 증가 + 맥동 + 공명음 → 켜진 채 유지
 *  · 다섯 문양이 모두 켜지면 포털 개방 (단 한 번)
 *      다섯 문양이 함께 맥동 → 안쪽 테 발광 → 중심부 빛 → 개방음 → 입구 막이 해제
 *  · 포털 통과(낙원 전환)는 environment-transition.js가 담당
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

(function () {
  const CFG = DP.CONFIG;
  const S = DP.STATES;
  const U = DP.Util;

  AFRAME.registerSystem('portal-manager', {
    init() {
      this.opened = false;
      this.opening = false;
      this.lit = []; // 켜진 문양 { id, mat, phase }
      this.glyphBusy = false;
    },

    camera() {
      return document.getElementById('camera').components['camera-director'];
    },

    portalShot(distance, height) {
      const P = CFG.portal;
      const sh = P.shot;
      const pos = new THREE.Vector3(P.center.x + 1.2, height != null ? height : sh.height, P.center.z + (distance || sh.distance));
      const look = new THREE.Vector3(P.center.x, sh.lookHeight, P.center.z);
      return { pos, look };
    },

    /** 문양 하나를 정면에서 크게 보는 샷 */
    glyphShot(glyphEl) {
      const G = CFG.portal.glyphShot;
      const look = glyphEl.object3D.getWorldPosition(new THREE.Vector3());
      const pos = look.clone();
      pos.z += G.distance; // 포털 정면(+Z)
      pos.y -= G.below; // 살짝 올려다봄
      pos.x += (CFG.portal.center.x - look.x) * 0.25; // 고리 안쪽도 함께 보이도록
      return { pos, look };
    },

    /** 문양 하나 점등 */
    async playSymbol(id) {
      const gs = this.el.systems['game-state'];
      gs.setState(S.PORTAL_CINEMATIC);
      const cam = this.camera();
      const glyph = document.getElementById(`glyph-${id}`);
      await cam.moveTo({ ...this.portalShot(), duration: 1.6, safe: false });
      if (glyph) await cam.moveTo({ ...this.glyphShot(glyph), duration: 1.3, safe: false });
      await U.wait(0.2);

      if (glyph && !this.lit.some((g) => g.id === id)) {
        const mesh = glyph.getObject3D('mesh');
        const mat = DP.World.emissiveMaterial('glyphOn', 0);
        mat.color.set(CFG.palette.glyphOff); // 어두운 석재 색에서 시작
        mesh.material = mat;
        const off = new THREE.Color(CFG.palette.glyphOff);
        const on = new THREE.Color(CFG.palette.glyphOn);
        const wp = glyph.object3D.getWorldPosition(new THREE.Vector3());
        DP.Audio.sfx('bell', wp);
        this.glyphBusy = true;
        // 1) 빛이 차오름
        await U.tween(1.1, (e) => {
          mat.emissiveIntensity = e * 2.8;
          mat.color.copy(off).lerp(on, e);
        }, U.ease.out);
        // 2) 맥동 두 번 → 유지 밝기로
        await U.tween(1.2, (e, t) => {
          const pulse = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
          mat.emissiveIntensity = U.lerp(2.8, CFG.portal.glyphGlow, e) + pulse * 0.9 * (1 - e);
          glyph.object3D.scale.setScalar(1 + Math.sin(t * Math.PI * 2) * 0.06 * (1 - e));
        }, U.ease.linear);
        glyph.object3D.scale.setScalar(1);
        this.lit.push({ id, mat, phase: this.lit.length * 1.3 });
        this.glyphBusy = false;
      }
      U.toast(`문양 ${gs.data.activated_symbols} / 5`);
      await U.wait(0.6);
      if (gs.allComplete() && !this.opened) await this.open();
    },

    /** 포털 개방 — 한 번만 실행 */
    async open() {
      if (this.opened || this.opening) return;
      this.opening = true;
      const cam = this.camera();
      const P = CFG.portal;
      await cam.moveTo({ ...this.portalShot(), duration: 1.4, safe: false });

      // 1) 다섯 문양이 함께 맥동
      this.glyphBusy = true;
      await U.tween(1.6, (e, t) => {
        const pulse = Math.sin(t * Math.PI * 3) * 0.5 + 0.5;
        for (const g of this.lit) g.mat.emissiveIntensity = P.glyphGlow + pulse * 1.4;
      }, U.ease.linear);

      // 2) 안쪽 테 + 중심부 + 개방음
      DP.Audio.sfx('awaken', new THREE.Vector3(P.center.x, 2.5, P.center.z));
      const rim = document.getElementById('portal-rim');
      const rimMat = DP.World.emissiveMaterial('glyphOn', 0);
      if (rim) rim.getObject3D('mesh').material = rimMat;
      const coreEl = document.getElementById('portal-core');
      const core = coreEl && coreEl.components['portal-core'];
      const push = this.portalShot(P.shot.distance * 0.7, P.shot.height * 0.9);
      const camMove = cam.moveTo({ ...push, duration: 3.2, ease: U.ease.inOut, safe: false });
      await U.tween(2.8, (e) => {
        rimMat.emissiveIntensity = e * 1.8;
        if (core) core.material.uniforms.uOpen.value = e;
        for (const g of this.lit) g.mat.emissiveIntensity = P.glyphGlow + Math.sin(e * Math.PI) * 0.8;
      });
      this.glyphBusy = false;
      await camMove;

      // 3) 통과 가능: 입구 막이 해제 + 낮은 울림
      if (DP.World.portalBarrier) DP.World.portalBarrier.disabled = true;
      this.opened = true;
      this.opening = false;
      this.el.emit('portal-opened');
      const sp = DP.Audio.createSpatial(new THREE.Vector3(P.center.x, 2.5, P.center.z), 'effects', 4);
      if (sp) DP.Audio.humLoop(sp);
      U.toast('포털이 열렸습니다', 3);
      await U.wait(1.0);
    },

    /** 켜진 문양은 계속 은은하게 숨 쉬듯 빛남 (연출 중에는 연출이 우선) */
    tick(t) {
      if (this.glyphBusy || !this.lit.length) return;
      const k = t / 1000;
      for (const g of this.lit) {
        g.mat.emissiveIntensity = CFG.portal.glyphGlow * (1 + Math.sin(k * 1.4 + g.phase) * 0.1);
      }
    },
  });
})();
