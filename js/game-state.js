/* ==========================================================================
 *  Desert Passage — game-state.js
 *  중앙 상태 관리 (상태 머신 + 게임 데이터 + 이동 잠금 + 완료 처리)
 *
 *  모든 핵심 인터랙션은 scene.emit('interaction-completed', { objectId })로 완료를 알립니다.
 *  이 시스템이 중복 여부를 확인하고, 처음 완료된 오브젝트만 문양 활성화 대기열에 넣습니다.
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

DP.STATES = Object.freeze({
  BOOT: 'BOOT',
  INTRO: 'INTRO',
  EXPLORATION: 'EXPLORATION',
  INTERACTING: 'INTERACTING',
  PORTAL_CINEMATIC: 'PORTAL_CINEMATIC',
  PORTAL_READY: 'PORTAL_READY',
  PORTAL_TRANSITION: 'PORTAL_TRANSITION',
  PARADISE: 'PARADISE',
});

(function () {
  const S = DP.STATES;

  const TRANSITIONS = {
    [S.BOOT]: [S.INTRO],
    [S.INTRO]: [S.EXPLORATION],
    [S.EXPLORATION]: [S.INTERACTING, S.PORTAL_CINEMATIC, S.PORTAL_TRANSITION],
    [S.INTERACTING]: [S.EXPLORATION, S.PORTAL_CINEMATIC, S.PORTAL_READY],
    [S.PORTAL_CINEMATIC]: [S.EXPLORATION, S.PORTAL_READY],
    [S.PORTAL_READY]: [S.INTERACTING, S.PORTAL_CINEMATIC, S.PORTAL_TRANSITION],
    [S.PORTAL_TRANSITION]: [S.PARADISE],
    [S.PARADISE]: [],
  };

  const MOVABLE = new Set([S.EXPLORATION, S.PORTAL_READY, S.PARADISE]);
  const CORE_OBJECTS = ['cube', 'speaker', 'dvd', 'glider', 'beanie'];

  AFRAME.registerSystem('game-state', {
    init() {
      this.state = S.BOOT;
      this.locks = new Set();
      this.newSymbols = [];
      this.data = {
        earphones_worn: false,
        music_enabled: false,
        beanie_worn: false,
        completed_objects: { cube: false, speaker: false, dvd: false, glider: false, beanie: false },
        activated_symbols: 0,
        portal_active: false,
      };
      this.onCompleted = this.onCompleted.bind(this);
      this.el.addEventListener('interaction-completed', this.onCompleted);
    },

    /** 완료 이벤트 처리 — 서로 다른 오브젝트 기준으로만 진행도 증가 */
    onCompleted(e) {
      const id = e.detail && e.detail.objectId;
      if (!CORE_OBJECTS.includes(id)) return;
      if (this.data.completed_objects[id]) return; // 다시 해도 진행도는 그대로
      this.data.completed_objects[id] = true;
      this.data.activated_symbols = CORE_OBJECTS.filter((k) => this.data.completed_objects[k]).length;
      this.newSymbols.push(id);
      if (this.data.activated_symbols === CORE_OBJECTS.length) this.data.portal_active = true;
      this.el.emit('symbol-activated', { objectId: id, count: this.data.activated_symbols });
    },

    /** 이번에 새로 활성화될 문양 목록을 가져오고 비움 */
    takeNewSymbols() {
      const list = this.newSymbols.slice();
      this.newSymbols.length = 0;
      return list;
    },

    allComplete() {
      return this.data.activated_symbols === CORE_OBJECTS.length;
    },

    /** 이동 가능한 기본 상태 (인터랙션이 끝나면 돌아갈 상태) */
    baseState() {
      return this.data.portal_active ? S.PORTAL_READY : S.EXPLORATION;
    },

    setState(next) {
      if (next === this.state) return true;
      const allowed = TRANSITIONS[this.state] || [];
      if (!allowed.includes(next)) {
        console.warn(`[game-state] 허용되지 않은 전환: ${this.state} → ${next}`);
        return false;
      }
      const prev = this.state;
      this.state = next;
      this.el.emit('state-changed', { from: prev, to: next });
      return true;
    },

    is(state) {
      return this.state === state;
    },

    lockMovement(reason) {
      this.locks.add(reason);
    },

    unlockMovement(reason) {
      this.locks.delete(reason);
    },

    canMove() {
      return MOVABLE.has(this.state) && this.locks.size === 0;
    },
  });

  DP.CORE_OBJECTS = CORE_OBJECTS;
})();
