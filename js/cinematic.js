/* ==========================================================================
 *  Desert Passage — cinematic.js
 *  시네마틱 자막 시스템 (HTML/CSS 오버레이) — 모든 오브젝트가 재사용
 *
 *  DP.Cinematic.letterbox(on)          위아래 검정 띠
 *  DP.Cinematic.caption(text, sec)     상황 자막 한 줄 (자동으로 사라짐)
 *  DP.Cinematic.monologue(lines)       독백 여러 줄을 차례로 (자동 진행, 클릭·Space로 넘기기)
 *  DP.Cinematic.memory(mem)            회상 텍스트 — 제목 → 문장 → 완료 독백 → 확인
 *                                      (사용자가 넘김. 끝까지 확인하면 resolve)
 *
 *  · 넘기기: 클릭 / Space / Enter    · 건너뛰기: Q (남은 문장을 모두 넘기고 바로 확인 단계로)
 *  · 건너뛰어도 Promise는 정상적으로 끝나므로 게임 상태가 망가지지 않음
 *  · 포인터 락을 풀지 않아도 클릭으로 넘길 수 있음 (마우스 시점 조작이 끊기지 않음)
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

DP.Cinematic = (function () {
  const U = DP.Util;
  let els = null;
  let waiter = null; // 현재 입력을 기다리는 함수
  let skipAll = false;

  function build() {
    if (els) return els;
    const cap = document.createElement('div');
    cap.id = 'cine-caption';
    const mem = document.createElement('div');
    mem.id = 'cine-memory';
    mem.innerHTML = `
      <p class="mem-title"></p>
      <p class="mem-line"></p>
      <p class="mem-notice"></p>
      <p class="mem-hint"></p>`;
    document.body.append(cap, mem);
    els = {
      cap,
      mem,
      title: mem.querySelector('.mem-title'),
      line: mem.querySelector('.mem-line'),
      notice: mem.querySelector('.mem-notice'),
      hint: mem.querySelector('.mem-hint'),
    };
    // 입력: 클릭 / Space / Enter = 다음, Q = 건너뛰기
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0 && waiter) waiter('next');
    });
    window.addEventListener('keydown', (e) => {
      if (!waiter) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        waiter('next');
      } else if (e.code === 'KeyQ') {
        waiter('skip');
      }
    });
    return els;
  }

  /** 입력 대기 (minSec 전에는 무시 → 앞 단계 클릭이 넘어오지 않음). auto초가 지나면 자동 진행 */
  function waitInput(minSec = 0.6, auto = 0) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let timer = null;
      const finish = (kind) => {
        waiter = null;
        if (timer) clearTimeout(timer);
        resolve(kind);
      };
      waiter = (kind) => {
        if (kind === 'skip') {
          skipAll = true;
          finish('skip');
        } else if ((performance.now() - t0) / 1000 >= minSec) finish('next');
      };
      if (auto > 0) timer = setTimeout(() => finish('auto'), auto * 1000);
    });
  }

  function show(el, on) {
    el.classList.toggle('show', on);
  }

  /** 문장 길이에 맞춘 읽기 시간 */
  const readTime = (text) => U.clamp(1.6 + text.length * 0.075, 2.4, 6.5);

  async function setLine(el, text) {
    show(el, false);
    await U.wait(0.35);
    el.textContent = text;
    show(el, true);
  }

  return {
    letterbox(on) {
      document.body.classList.toggle('cinematic', !!on);
    },

    /** 상황 자막 한 줄 — 기다리지 않아도 됨 */
    async caption(text, sec) {
      const E = build();
      E.cap.classList.remove('monologue');
      await setLine(E.cap, text);
      const id = (this._capId = (this._capId || 0) + 1);
      await U.wait(sec || readTime(text));
      if (this._capId === id) show(E.cap, false);
    },

    hideCaption() {
      if (els) show(els.cap, false);
    },

    /** 독백 여러 줄 (자동 진행 · 클릭/Space로 다음 · Q로 건너뛰기) */
    async monologue(lines, opts = {}) {
      const E = build();
      skipAll = false;
      E.cap.classList.add('monologue');
      for (const text of lines) {
        if (skipAll) break;
        await setLine(E.cap, text);
        await waitInput(0.5, opts.manual ? 0 : readTime(text) + 0.6);
      }
      show(E.cap, false);
      await U.wait(0.4);
      E.cap.classList.remove('monologue');
    },

    /**
     * 회상 텍스트
     * @param {{title:string, body:string[], monologue?:string, notice?:string}} mem
     */
    async memory(mem) {
      const E = build();
      skipAll = false;
      this.hideCaption();
      E.title.textContent = mem.title || '';
      E.line.textContent = '';
      E.notice.textContent = mem.notice || '';
      E.hint.textContent = '';
      E.mem.classList.remove('final');
      show(E.mem, true);
      show(E.notice, !!mem.notice);
      await U.wait(0.6);
      show(E.title, true);
      await U.wait(0.5);
      for (const text of mem.body || []) {
        if (skipAll) break;
        await setLine(E.line, text);
        E.hint.textContent = '클릭 · Space  다음     Q  건너뛰기';
        show(E.hint, true);
        await waitInput(0.8);
      }
      // 완료 독백 + 확인
      if (mem.monologue) {
        E.mem.classList.add('final');
        await setLine(E.line, `“${mem.monologue}”`);
      }
      E.hint.textContent = '클릭 · Space  확인';
      show(E.hint, true);
      skipAll = false;
      await waitInput(1.0);
      show(E.mem, false);
      for (const k of ['title', 'line', 'notice', 'hint']) show(E[k], false);
      await U.wait(0.6);
    },

    /** 진행 중인 자막·회상이 있는지 (입력 충돌 방지용) */
    isWaiting() {
      return !!waiter;
    },
  };
})();
