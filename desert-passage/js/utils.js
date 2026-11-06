/* ==========================================================================
 *  Desert Passage — utils.js
 *  공통 수학·이징·트윈 유틸 (모든 연출이 같은 도구를 사용)
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

DP.Util = (function () {
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  const ease = {
    linear: (t) => t,
    inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t * t,
    outBack: (t) => {
      const c1 = 1.4;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
  };

  /**
   * duration(초) 동안 onUpdate(e, t)를 호출하고 끝나면 resolve
   * @returns {Promise<void>}
   */
  function tween(duration, onUpdate, easeFn = ease.inOut) {
    return new Promise((resolve) => {
      const start = performance.now();
      const ms = Math.max(1, duration * 1000);
      const step = (now) => {
        const t = clamp((now - start) / ms, 0, 1);
        onUpdate(easeFn(t), t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  const wait = (sec) => new Promise((r) => setTimeout(r, sec * 1000));

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 짧은 안내 문구 표시 */
  let toastTimer = null;
  function toast(text, sec = 2.2) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), sec * 1000);
  }

  return { lerp, clamp, smoothstep, wrapAngle, ease, tween, wait, mulberry32, toast };
})();
