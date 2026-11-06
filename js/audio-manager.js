/* ==========================================================================
 *  Desert Passage — audio-manager.js
 *  채널: music(이어폰) / ambience(바람·발소리·지팡이) / effects(인터랙션·공간 음향)
 *
 *  · 브라우저 자동재생 정책 때문에 시작 버튼 클릭 시 init()으로 오디오를 시작합니다.
 *  · 음원 파일이 아직 없으므로 모든 소리는 Web Audio로 합성한 "임시 사운드"입니다.
 *    config.audio.files에 경로를 넣으면 그 파일이 우선 사용됩니다.
 *  · 이어폰 음악(M 토글)은 환경음과 완전히 분리되어 있습니다.
 * ========================================================================== */
'use strict';

window.DP = window.DP || {};

DP.Audio = (function () {
  const CFG = DP.CONFIG.audio;
  const U = DP.Util;
  const A = {
    ready: false,
    ctx: null,
    musicOn: false,
    duck: 1,
    spatialSources: new Set(), // 이어폰 음악을 줄이는 기준이 되는 월드 음원
  };

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /* ------------------------------------------------------------------------
   * 초기화 (사용자 입력 이후 호출)
   * ---------------------------------------------------------------------- */
  A.init = function () {
    if (A.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      console.warn('[audio] Web Audio를 지원하지 않는 브라우저입니다. 소리 없이 진행합니다.');
      return;
    }
    const ctx = (A.ctx = new Ctx());
    if (ctx.state === 'suspended') ctx.resume();
    A.master = ctx.createGain();
    A.master.connect(ctx.destination);
    A.bus = {};
    for (const name of ['music', 'ambience', 'effects']) {
      const g = ctx.createGain();
      g.gain.value = name === 'music' ? 0 : CFG.volumes[name];
      g.connect(A.master);
      A.bus[name] = g;
    }
    // 환경별 묶음 (사막 ↔ 낙원 크로스페이드용)
    //   desert.*  : 바람, 사막 오브젝트의 공간 음향(스피커·TV·엔진·포털 울림)
    //   paradise.*: 새·나뭇잎·개울·잔바람
    A.group = {};
    for (const env of ['desert', 'paradise']) {
      A.group[env] = {};
      for (const bus of ['ambience', 'effects']) {
        const g = ctx.createGain();
        g.gain.value = env === 'desert' ? 1 : 0;
        g.connect(A.bus[bus]);
        A.group[env][bus] = g;
      }
    }
    A.env = 'desert';
    A.loops = new Set(); // 환경 전환 시 정리할 반복 음원
    // 노이즈 버퍼 (발소리·잡음 공용: 백색 / 바람용: 고음이 적은 부드러운 노이즈)
    const len = ctx.sampleRate * 4;
    A.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    A.noiseSoft = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = A.noise.getChannelData(0);
    const ds = A.noiseSoft.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      d[i] = w;
      b = (b + 0.035 * w) / 1.035; // 적분(브라운 계열) → 고주파가 줄어든 부드러운 노이즈
      ds[i] = b * 7.5;
    }
    // 루프 이음매에서 '틱' 소리가 나지 않도록 끝을 처음 값으로 수렴
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      ds[len - fade + i] = ds[len - fade + i] * (1 - k) + ds[i] * k;
    }
    A.ready = true;
  };

  /* ------------------------------------------------------------------------
   * 공용 빌딩 블록
   * ---------------------------------------------------------------------- */
  function noiseSource(loop = true, soft = false) {
    const s = A.ctx.createBufferSource();
    s.buffer = soft ? A.noiseSoft : A.noise;
    s.loop = loop;
    return s;
  }

  function envGain(dest, t, peak, attack, hold, release) {
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(dest);
    return g;
  }

  function tone(dest, { freq, type = 'sine', t, peak = 0.2, attack = 0.005, hold = 0, release = 0.3, detune = 0, freqEnd = null }) {
    const o = A.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + hold + release);
    o.detune.value = detune;
    o.connect(envGain(dest, t, peak, attack, hold, release));
    o.start(t);
    o.stop(t + attack + hold + release + 0.05);
    return o;
  }

  function noiseBurst(dest, { t, peak = 0.3, attack = 0.003, hold = 0, release = 0.12, lp = 2000, hp = 80, bp = null, q = 1 }) {
    const s = noiseSource(false);
    let node = s;
    const chain = [];
    if (bp) {
      const f = A.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = bp;
      f.Q.value = q;
      chain.push(f);
    } else {
      const l = A.ctx.createBiquadFilter();
      l.type = 'lowpass';
      l.frequency.value = lp;
      const h = A.ctx.createBiquadFilter();
      h.type = 'highpass';
      h.frequency.value = hp;
      chain.push(l, h);
    }
    for (const f of chain) {
      node.connect(f);
      node = f;
    }
    node.connect(envGain(dest, t, peak, attack, hold, release));
    s.start(t, Math.random() * 1.5);
    s.stop(t + attack + hold + release + 0.05);
  }

  /** 3D 위치를 가진 음원 노드 (스피커, TV, 엔진 등) */
  A.createSpatial = function (position, bus = 'effects', refDistance = 2, env = A.env) {
    if (!A.ready) return null;
    const ctx = A.ctx;
    const input = ctx.createGain();
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = 60;
    panner.rolloffFactor = 1.3;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    input.connect(analyser);
    input.connect(panner);
    panner.connect(A.group[env] && A.group[env][bus] ? A.group[env][bus] : A.bus[bus]);
    const node = {
      input,
      panner,
      analyser,
      position: new THREE.Vector3(),
      buf: new Uint8Array(analyser.frequencyBinCount),
      setPosition(v) {
        this.position.copy(v);
        if (panner.positionX) {
          panner.positionX.value = v.x;
          panner.positionY.value = v.y;
          panner.positionZ.value = v.z;
        } else panner.setPosition(v.x, v.y, v.z);
      },
      /** 0~1 음량 (오브젝트 진동 표현용) */
      level() {
        analyser.getByteTimeDomainData(this.buf);
        let peak = 0;
        for (let i = 0; i < this.buf.length; i++) peak = Math.max(peak, Math.abs(this.buf[i] - 128));
        return peak / 128;
      },
    };
    node.setPosition(position);
    return node;
  };

  /* ------------------------------------------------------------------------
   * 파일 음원 (있으면 우선 사용)
   * ---------------------------------------------------------------------- */
  const bufferCache = {};
  async function loadBuffer(url) {
    if (!url) return null;
    if (bufferCache[url] !== undefined) return bufferCache[url];
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const arr = await res.arrayBuffer();
      bufferCache[url] = await A.ctx.decodeAudioData(arr);
    } catch (err) {
      console.warn(`[audio] ${url} 로딩 실패 → 합성 사운드로 대체합니다.`, err);
      bufferCache[url] = null;
    }
    return bufferCache[url];
  }

  function playBufferLoop(buffer, dest) {
    const s = A.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    const g = A.ctx.createGain();
    g.gain.value = 1;
    s.connect(g);
    g.connect(dest);
    s.start();
    return {
      stop(fade = 0.5) {
        const t = A.ctx.currentTime;
        g.gain.setTargetAtTime(0.0001, t, fade / 3);
        try {
          s.stop(t + fade + 0.1);
        } catch (err) {
          /* 이미 정지됨 */
        }
      },
    };
  }

  /* ------------------------------------------------------------------------
   * 생성형 음악 루프 (임시 음원)
   * preset: 'earphone' — 잔잔한 패드 + 아르페지오
   *         'radio'    — 스피커: 낡은 라디오 느낌 베이스 + 멜로디 + 잡음
   *         'musicbox' — TV(DVD): 높은 음역의 오르골 느낌
   * ---------------------------------------------------------------------- */
  const PRESETS = {
    earphone: {
      bpm: 70,
      chords: [[50, 53, 57, 60], [45, 48, 52, 55], [46, 50, 53, 57], [48, 52, 55, 62]],
      stepsPerChord: 16,
      pad: true,
      arpChance: 0.5,
      arpOctave: 24,
      arpType: 'triangle',
      lowpass: 1600,
      delay: 0.43,
      gain: 0.9,
    },
    radio: {
      bpm: 92,
      chords: [[45, 48, 52, 55], [43, 47, 50, 55], [41, 45, 48, 52], [43, 47, 50, 53]],
      stepsPerChord: 8,
      bass: true,
      arpChance: 0.62,
      arpOctave: 24,
      arpType: 'square',
      lofi: true,
      crackle: true,
      delay: 0.32,
      gain: 0.75,
    },
    musicbox: {
      bpm: 76,
      chords: [[60, 64, 67, 72], [57, 60, 64, 69], [65, 69, 72, 77], [67, 71, 74, 79]],
      stepsPerChord: 8,
      arpChance: 0.7,
      arpOctave: 12,
      arpType: 'sine',
      bell: true,
      delay: 0.5,
      gain: 0.7,
    },
  };

  function createGenerative(presetName, dest) {
    const P = PRESETS[presetName];
    const ctx = A.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.setTargetAtTime(P.gain, ctx.currentTime, 0.8);
    let tail = out;
    if (P.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = P.lowpass;
      tail.connect(lp);
      tail = lp;
    }
    if (P.lofi) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 280;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      tail.connect(hp);
      hp.connect(lp);
      tail = lp;
    }
    tail.connect(dest);
    // 딜레이 (공간감)
    const dl = ctx.createDelay(1.5);
    dl.delayTime.value = P.delay;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    out.connect(dl);
    dl.connect(fb);
    fb.connect(dl);
    dl.connect(wet);
    wet.connect(dest);

    const stepDur = 60 / P.bpm / 2; // 8분음표
    let step = 0;
    let next = ctx.currentTime + 0.1;
    let stopped = false;

    function schedule(t, s) {
      const chord = P.chords[Math.floor(s / P.stepsPerChord) % P.chords.length];
      const inChord = s % P.stepsPerChord;
      if (P.pad && inChord === 0) {
        const len = stepDur * P.stepsPerChord;
        for (const n of chord) {
          for (const det of [-7, 7]) {
            tone(out, { freq: mtof(n), type: 'triangle', t, peak: 0.045, attack: 1.4, hold: len - 1.6, release: 2.2, detune: det });
          }
        }
      }
      if (P.bass && inChord % 4 === 0) {
        tone(out, { freq: mtof(chord[0] - 12), type: 'square', t, peak: 0.07, attack: 0.01, hold: stepDur * 0.8, release: 0.15 });
      }
      if (Math.random() < P.arpChance) {
        const n = chord[Math.floor(Math.random() * chord.length)] + P.arpOctave;
        tone(out, { freq: mtof(n), type: P.arpType, t, peak: P.arpType === 'square' ? 0.03 : 0.07, attack: 0.004, release: P.bell ? 1.4 : 0.45 });
        if (P.bell) tone(out, { freq: mtof(n) * 2.76, type: 'sine', t, peak: 0.015, attack: 0.002, release: 0.6 });
      }
      if (P.crackle && Math.random() < 0.6) {
        noiseBurst(out, { t: t + Math.random() * stepDur, peak: 0.03, release: 0.01, lp: 6000, hp: 1500 });
      }
    }

    const timer = setInterval(() => {
      if (stopped) return;
      while (next < ctx.currentTime + 0.15) {
        schedule(next, step);
        next += stepDur;
        step++;
      }
    }, 30);

    return {
      stop(fade = 0.6) {
        stopped = true;
        clearInterval(timer);
        out.gain.setTargetAtTime(0.0001, ctx.currentTime, fade / 3);
        wet.gain.setTargetAtTime(0.0001, ctx.currentTime, fade / 3);
      },
    };
  }

  /** 루프 재생: 파일이 있으면 파일, 없으면 생성형 */
  A.playLoop = async function (fileKey, preset, dest) {
    if (!A.ready) return null;
    const buf = await loadBuffer(CFG.files[fileKey]);
    const loop = buf ? playBufferLoop(buf, dest) : createGenerative(preset, dest);
    if (dest !== A.bus.music) track(loop); // 이어폰 음악은 환경 전환과 무관
    return loop;
  };

  /** 사막 오브젝트의 반복 음원 등록 → 낙원으로 넘어갈 때 정리 */
  function track(loop) {
    if (!loop) return loop;
    loop.env = A.env;
    A.loops.add(loop);
    return loop;
  }

  /* ------------------------------------------------------------------------
   * 환경음: 바람 (모래폭풍 강도에 따라 변화)
   * ---------------------------------------------------------------------- */
  A.startAmbience = async function () {
    if (!A.ready || A.wind) return;
    const ctx = A.ctx;
    const W = CFG.wind;
    const dest = A.group.desert.ambience;
    const buf = await loadBuffer(CFG.files.ambience);
    if (buf) {
      A.wind = { file: track(playBufferLoop(buf, dest)) };
      return;
    }
    // 바람 전체 → 고주파 차단 → 전체 음량
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.setTargetAtTime(W.level, ctx.currentTime, 2.0); // 시작할 때도 서서히
    const lpAll = ctx.createBiquadFilter();
    lpAll.type = 'lowpass';
    lpAll.frequency.value = W.lowpass;
    lpAll.Q.value = 0.5;
    lpAll.connect(out);
    out.connect(dest);

    // 낮은 바람: 부드러운 노이즈 + 넓은 대역 (Q를 낮춰 '쉬익'보다 '우우'에 가깝게)
    const low = noiseSource(true, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380;
    bp.Q.value = 0.45;
    const lowGain = ctx.createGain();
    lowGain.gain.value = 0.0;
    low.connect(bp);
    bp.connect(lowGain);
    lowGain.connect(lpAll);

    // 모래 쓸리는 소리: 백색 노이즈의 좁은 중고음 대역만 아주 작게 (이전: 2.8kHz 이상 전체)
    const hiss = noiseSource();
    const hbp = ctx.createBiquadFilter();
    hbp.type = 'bandpass';
    hbp.frequency.value = W.hissFreq;
    hbp.Q.value = 0.8;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.0;
    hiss.connect(hbp);
    hbp.connect(hissGain);
    hissGain.connect(lpAll);

    low.start(0, Math.random() * 3);
    hiss.start(0, Math.random() * 3);
    A.wind = { bp, hbp, lowGain, hissGain, out, sources: [low, hiss], storm: 0.5 };
  };

  /* ------------------------------------------------------------------------
   * 이어폰 음악
   * ---------------------------------------------------------------------- */
  A.startMusic = async function () {
    if (!A.ready || A.music) return;
    A.music = await A.playLoop('music', 'earphone', A.bus.music);
  };

  A.setMusicEnabled = function (on) {
    A.musicOn = on;
  };

  /* ------------------------------------------------------------------------
   * 효과음 (모두 합성) — position을 주면 그 위치에서 들림
   * ---------------------------------------------------------------------- */
  A.sfx = function (name, position) {
    if (!A.ready) return;
    const ctx = A.ctx;
    const t = ctx.currentTime + 0.01;
    let dest = A.bus.effects;
    if (position) {
      const sp = A.createSpatial(position, 'effects', 2.5);
      dest = sp.input;
      setTimeout(() => sp.panner.disconnect(), 6000); // 일회성 음원 정리
    }
    switch (name) {
      case 'click':
        noiseBurst(dest, { t, peak: 0.35, release: 0.03, lp: 5000, hp: 900 });
        tone(dest, { freq: 1800, t, peak: 0.05, release: 0.03 });
        break;
      case 'turn':
        noiseBurst(dest, { t, peak: 0.22, release: 0.06, lp: 3500, hp: 600 });
        noiseBurst(dest, { t: t + 0.16, peak: 0.18, release: 0.04, lp: 4000, hp: 900 });
        break;
      case 'startup':
        tone(dest, { freq: 220, freqEnd: 880, type: 'square', t, peak: 0.05, attack: 0.02, hold: 0.25, release: 0.15 });
        tone(dest, { freq: 1320, t: t + 0.45, peak: 0.08, release: 0.25 });
        break;
      case 'tray':
        tone(dest, { freq: 160, freqEnd: 240, type: 'sawtooth', t, peak: 0.04, attack: 0.05, hold: 0.35, release: 0.1 });
        noiseBurst(dest, { t, peak: 0.08, attack: 0.05, hold: 0.35, release: 0.1, bp: 900, q: 2 });
        break;
      case 'clunk':
        noiseBurst(dest, { t, peak: 0.4, release: 0.08, lp: 700, hp: 60 });
        tone(dest, { freq: 110, t, peak: 0.15, release: 0.12 });
        break;
      case 'static':
        noiseBurst(dest, { t, peak: 0.12, attack: 0.02, hold: 0.7, release: 0.2, lp: 7000, hp: 1200 });
        break;
      case 'ignite':
        for (let i = 0; i < 6; i++) {
          noiseBurst(dest, { t: t + i * 0.17 + Math.random() * 0.05, peak: 0.35, release: 0.09, lp: 900, hp: 80 });
          tone(dest, { freq: 50 + i * 6, type: 'sawtooth', t: t + i * 0.17, peak: 0.08, release: 0.1 });
        }
        break;
      case 'whoosh':
        noiseBurst(dest, { t, peak: 0.25, attack: 0.35, release: 0.45, bp: 700, q: 0.8 });
        break;
      case 'plug':
        noiseBurst(dest, { t, peak: 0.25, release: 0.025, lp: 6000, hp: 1500 });
        noiseBurst(dest, { t: t + 0.12, peak: 0.2, release: 0.025, lp: 6000, hp: 1500 });
        break;
      case 'tick':
        tone(dest, { freq: 2400, t, peak: 0.04, release: 0.03 });
        break;
      case 'chime':
        [76, 81, 88].forEach((n, i) => tone(dest, { freq: mtof(n), t: t + i * 0.12, peak: 0.08, release: 1.6 }));
        break;
      case 'bell': // 포털 문양
        [1, 2.01, 2.76, 4.07].forEach((m, i) =>
          tone(dest, { freq: 196 * m, t, peak: 0.12 / (i + 1), attack: 0.004, release: 3.5 - i * 0.6 }));
        break;
      case 'knock': // 무전기 두드림: 둔탁한 금속 함 + 짧은 딸깍
        noiseBurst(dest, { t, peak: 0.5, attack: 0.002, release: 0.09, lp: 700, hp: 60 });
        tone(dest, { freq: 140, freqEnd: 80, type: 'triangle', t, peak: 0.25, release: 0.12 });
        noiseBurst(dest, { t: t + 0.01, peak: 0.12, release: 0.03, lp: 6000, hp: 2500 });
        break;
      case 'remote': // 리모컨 버튼 + 채널 바뀌는 '틱'
        noiseBurst(dest, { t, peak: 0.18, release: 0.02, lp: 7000, hp: 2000 });
        tone(dest, { freq: 2400, t: t + 0.05, peak: 0.03, release: 0.05 });
        noiseBurst(dest, { t: t + 0.08, peak: 0.12, attack: 0.01, release: 0.25, bp: 3000, q: 0.6 });
        break;
      case 'cubeSpin': // 큐브가 도는 바람 소리 + 조각 딸깍
        noiseBurst(dest, { t, peak: 0.14, attack: 0.08, release: 0.35, bp: 1400, q: 0.8 });
        for (let i = 0; i < 3; i++) noiseBurst(dest, { t: t + 0.05 + i * 0.07, peak: 0.1, release: 0.02, lp: 5000, hp: 1500 });
        break;
      case 'cubeComplete': // 완성: 맑은 세 음
        [76, 79, 84].forEach((n, i) => tone(dest, { freq: mtof(n), t: t + i * 0.11, peak: 0.06, attack: 0.01, release: 1.4 }));
        break;
      case 'portalEnter': // 포털 통과: 부드럽게 솟는 바람 + 밝은 화음
        noiseBurst(dest, { t, peak: 0.22, attack: 1.0, hold: 0.3, release: 1.6, bp: 900, q: 0.6 });
        [55, 62, 67, 71, 74].forEach((n, i) =>
          tone(dest, { freq: mtof(n), type: 'sine', t: t + 0.25 + i * 0.12, peak: 0.05, attack: 0.5, hold: 0.8, release: 2.8 }));
        break;
      case 'awaken':
        [0, 7, 12, 19].forEach((n, i) => tone(dest, { freq: mtof(43 + n), type: 'triangle', t: t + i * 0.35, peak: 0.07, attack: 0.6, hold: 1.2, release: 2.5 }));
        break;
      default:
        break;
    }
  };

  /** 엔진 루프 (글라이더) */
  A.engineLoop = function (spatial) {
    if (!A.ready || !spatial) return null;
    const ctx = A.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.32, t + 1.4);
    const trem = ctx.createGain();
    trem.gain.value = 0.75;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 18;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.25;
    lfo.connect(lfoGain);
    lfoGain.connect(trem.gain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.setValueAtTime(24, t);
    o1.frequency.exponentialRampToValueAtTime(52, t + 1.6);
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.setValueAtTime(48, t);
    o2.frequency.exponentialRampToValueAtTime(104, t + 1.6);
    const o2g = ctx.createGain();
    o2g.gain.value = 0.3;
    const n = noiseSource();
    const ng = ctx.createGain();
    ng.gain.value = 0.25;
    o1.connect(lp);
    o2.connect(o2g);
    o2g.connect(lp);
    n.connect(ng);
    ng.connect(lp);
    lp.connect(trem);
    trem.connect(out);
    out.connect(spatial.input);
    [o1, o2, lfo, n].forEach((s) => s.start());
    return track({
      stop(fade = 1.2) {
        const now = ctx.currentTime;
        o1.frequency.exponentialRampToValueAtTime(18, now + fade);
        out.gain.setTargetAtTime(0.0001, now, fade / 3);
        [o1, o2, lfo, n].forEach((s) => s.stop(now + fade + 0.5));
        A.loops.delete(this);
      },
    });
  };

  /** 포털 개방 후 낮은 울림 */
  A.humLoop = function (spatial) {
    if (!A.ready || !spatial) return null;
    const ctx = A.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.setTargetAtTime(0.18, ctx.currentTime, 1.2);
    const oscs = [55, 82.5, 110.3].map((f) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(out);
      o.start();
      return o;
    });
    out.connect(spatial.input);
    return track({
      gain: out,
      stop(fade = 1) {
        const now = ctx.currentTime;
        out.gain.setTargetAtTime(0.0001, now, fade / 3);
        oscs.forEach((o) => o.stop(now + fade + 0.3));
        A.loops.delete(this);
      },
    });
  };

  /** 발소리 (모래) + 지팡이 */
  A.footstep = function (withStick) {
    if (!A.ready) return;
    const t = A.ctx.currentTime + 0.005;
    const dest = A.bus.ambience;
    if (A.env === 'paradise') {
      // 풀밭: 더 작고 부드러운 바스락 소리
      noiseBurst(dest, { t, peak: 0.07 + Math.random() * 0.03, attack: 0.015, release: 0.12, lp: 2600 + Math.random() * 500, hp: 600 });
      if (withStick) tone(dest, { freq: 300, t: t + 0.09, peak: 0.015, release: 0.05 });
      return;
    }
    noiseBurst(dest, { t, peak: 0.16 + Math.random() * 0.06, attack: 0.01, release: 0.14, lp: 1100 + Math.random() * 300, hp: 150 });
    if (withStick) {
      noiseBurst(dest, { t: t + 0.09, peak: 0.08, release: 0.04, lp: 3000, hp: 700 });
      tone(dest, { freq: 420, t: t + 0.09, peak: 0.03, release: 0.05 });
    }
  };

  /* ------------------------------------------------------------------------
   * 조절 가능한 반복 음원 (모두 합성 — config.audio.files에 파일을 넣으면 그 파일 사용)
   *  각 함수는 { setLevel(0~1), stop(fade) } 등을 돌려줌
   * ---------------------------------------------------------------------- */

  /** 무전 잡음: 대역 노이즈 + 불규칙한 '지직' 크래클. dest = 공간 음원 입력 또는 버스 */
  A.radioStatic = async function (dest, fileKey = 'radioStatic') {
    if (!A.ready) return null;
    const ctx = A.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(dest || A.bus.effects);
    const buf = await loadBuffer(CFG.files[fileKey]);
    let srcs = [];
    let crackle = null;
    if (buf) {
      srcs.push(playBufferLoop(buf, out));
    } else {
      const n = noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700;
      bp.Q.value = 0.9;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 350;
      n.connect(hp);
      hp.connect(bp);
      bp.connect(out);
      n.start(0, Math.random() * 2);
      srcs.push(n);
      // 크래클: 짧은 잡음 터짐을 불규칙하게
      crackle = setInterval(() => {
        if (Math.random() < 0.55) noiseBurst(out, { t: ctx.currentTime + 0.01, peak: 0.6 + Math.random() * 0.6, release: 0.015 + Math.random() * 0.04, lp: 6000, hp: 1200 });
      }, 70);
    }
    const h = {
      level: 0,
      setLevel(v, tau = 0.15) {
        h.level = v;
        out.gain.setTargetAtTime(Math.max(0.0001, v * 0.14), ctx.currentTime, tau);
      },
      stop(fade = 0.5) {
        out.gain.setTargetAtTime(0.0001, ctx.currentTime, fade / 3);
        if (crackle) clearInterval(crackle);
        setTimeout(() => srcs.forEach((x) => (x.stop ? x.stop(0.1) : null)), (fade + 0.3) * 1000);
        A.loops.delete(h);
      },
    };
    return track(h);
  };

  /** 희미한 교신 신호: 잡음 속에서 떨리는 전자음 (사람 목소리 아님) */
  A.radioSignal = async function (dest) {
    if (!A.ready) return null;
    const ctx = A.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(dest || A.bus.effects);
    const buf = await loadBuffer(CFG.files.radioSignal);
    if (buf) {
      const l = playBufferLoop(buf, out);
      out.gain.setTargetAtTime(0.5, ctx.currentTime, 0.4);
      return track({ stop: (f = 0.6) => { out.gain.setTargetAtTime(0.0001, ctx.currentTime, f / 3); l.stop(f); } });
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = 1100;
    lp.Q.value = 2.5;
    lp.connect(out);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 620;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibG = ctx.createGain();
    vibG.gain.value = 18;
    vib.connect(vibG);
    vibG.connect(o.frequency);
    const am = ctx.createGain();
    am.gain.value = 0;
    o.connect(am);
    am.connect(lp);
    o.start();
    vib.start();
    // 말소리처럼 끊기는 음절 리듬 (의미 있는 대사가 아님)
    const t0 = ctx.currentTime + 0.1;
    for (let i = 0; i < 26; i++) {
      const st = t0 + i * 0.16 + Math.random() * 0.05;
      const on = Math.random() < 0.7;
      am.gain.setValueAtTime(on ? 0.5 + Math.random() * 0.5 : 0, st);
      o.frequency.setValueAtTime(520 + Math.random() * 260, st);
    }
    am.gain.setValueAtTime(0, t0 + 26 * 0.16 + 0.1);
    out.gain.setTargetAtTime(0.09, ctx.currentTime, 0.3);
    const h = {
      stop(fade = 0.6) {
        out.gain.setTargetAtTime(0.0001, ctx.currentTime, fade / 3);
        o.stop(ctx.currentTime + fade + 0.2);
        vib.stop(ctx.currentTime + fade + 0.2);
        A.loops.delete(h);
      },
    };
    return track(h);
  };

  /** TV 노이즈: 부드러운 '쏴—' (고음 줄인 백색 노이즈) */
  A.tvNoise = async function (dest) {
    if (!A.ready) return null;
    const ctx = A.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(dest || A.bus.effects);
    const buf = await loadBuffer(CFG.files.tvNoise);
    let src;
    if (buf) src = playBufferLoop(buf, out);
    else {
      src = noiseSource();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5200;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 500;
      src.connect(hp);
      hp.connect(lp);
      lp.connect(out);
      src.start(0, Math.random() * 2);
    }
    const h = {
      setLevel(v, tau = 0.12) {
        out.gain.setTargetAtTime(Math.max(0.0001, v * 0.07), ctx.currentTime, tau);
      },
      stop(fade = 0.4) {
        out.gain.setTargetAtTime(0.0001, ctx.currentTime, fade / 3);
        setTimeout(() => src.stop(), (fade + 0.3) * 1000);
        A.loops.delete(h);
      },
    };
    return track(h);
  };

  /** 글라이더 시동: 저주파 발진음. setProgress(0~1)로 음량·높이 상승, fail()로 흔들리며 꺼짐 */
  A.gliderEngine = function (dest) {
    if (!A.ready) return null;
    const ctx = A.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(dest || A.bus.effects);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    lp.Q.value = 2;
    lp.connect(out);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 38;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 76;
    const g2 = ctx.createGain();
    g2.gain.value = 0.6;
    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    whine.frequency.value = 420;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    whine.connect(wg);
    wg.connect(out);
    [o1, o2, whine].forEach((x) => x.start());
    const h = {
      setProgress(p) {
        const t = ctx.currentTime;
        o1.frequency.setTargetAtTime(38 + p * 46, t, 0.15);
        o2.frequency.setTargetAtTime(76 + p * 92, t, 0.15);
        lp.frequency.setTargetAtTime(240 + p * 900, t, 0.2);
        whine.frequency.setTargetAtTime(420 + p * 900, t, 0.2);
        wg.gain.setTargetAtTime(p * p * 0.05, t, 0.2);
        out.gain.setTargetAtTime(0.02 + p * 0.16, t, 0.2);
      },
      /** 실패: 불안정하게 흔들린 뒤 사그라듦 */
      fail(duration = 1.8) {
        const t = ctx.currentTime;
        for (let i = 0; i < 9; i++) {
          const st = t + i * 0.12;
          const k = 1 - i / 9;
          o1.frequency.setValueAtTime(30 + Math.random() * 60 * k, st);
          out.gain.setValueAtTime((0.05 + Math.random() * 0.12) * k, st);
        }
        const end = t + 1.1;
        o1.frequency.setTargetAtTime(22, end, duration / 4);
        o2.frequency.setTargetAtTime(40, end, duration / 4);
        whine.frequency.setTargetAtTime(150, end, duration / 4);
        wg.gain.setTargetAtTime(0.0001, end, 0.2);
        out.gain.setTargetAtTime(0.0001, end, duration / 4);
        noiseBurst(out, { t: t + 0.05, peak: 0.25, attack: 0.01, release: 0.5, bp: 300, q: 0.7 });
        setTimeout(() => h.stop(0.1), (1.1 + duration) * 1000);
      },
      stop(fade = 0.5) {
        const t = ctx.currentTime;
        out.gain.setTargetAtTime(0.0001, t, fade / 3);
        [o1, o2, whine].forEach((x) => {
          try {
            x.stop(t + fade + 0.3);
          } catch (e) {
            /* 이미 정지 */
          }
        });
        A.loops.delete(h);
      },
    };
    return track(h);
  };

  /** 인터랙션·회상 중 사막 배경(바람)을 낮춤 — 사막에서만 */
  A.duckDesert = function (on) {
    if (!A.ready || A.env !== 'desert') return;
    const g = A.group.desert.ambience.gain;
    g.setTargetAtTime(on ? CFG.interactionDuck : 1, A.ctx.currentTime, 0.6);
  };

  /* ------------------------------------------------------------------------
   * 매 프레임: 청취자 위치, 바람 세기, 음악 덕킹
   * ---------------------------------------------------------------------- */
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  A.update = function (cameraObj) {
    if (!A.ready) return;
    const ctx = A.ctx;
    const L = ctx.listener;
    const t = ctx.currentTime;
    cameraObj.getWorldPosition(camPos);
    fwd.set(0, 0, -1).applyQuaternion(cameraObj.getWorldQuaternion(new THREE.Quaternion()));
    up.set(0, 1, 0);
    if (L.positionX) {
      L.positionX.setTargetAtTime(camPos.x, t, 0.02);
      L.positionY.setTargetAtTime(camPos.y, t, 0.02);
      L.positionZ.setTargetAtTime(camPos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      L.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      L.setPosition(camPos.x, camPos.y, camPos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }

    // 바람: 모래폭풍 강도 (한 번 더 부드럽게 보간 → 급격한 변화 없음)
    const W = CFG.wind;
    const storm = DP.storm ? DP.storm.intensity : 0.5;
    if (A.wind && A.wind.lowGain) {
      const w = A.wind;
      w.storm += (storm - w.storm) * 0.02;
      const s2 = w.storm;
      const gust = 0.5 + 0.5 * Math.sin(t * 0.23) * Math.sin(t * 0.071 + 1.3); // 느린 돌풍
      const tau = W.smoothing;
      w.lowGain.gain.setTargetAtTime(W.lowMin + W.lowRange * s2 * (0.8 + gust * 0.2), t, tau);
      w.hissGain.gain.setTargetAtTime(W.hissMin + W.hissRange * s2 * s2 * gust, t, tau);
      w.bp.frequency.setTargetAtTime(280 + s2 * 260 + gust * 60, t, tau);
    }
    if (A.paradise) A.paradise.update(camPos, t);

    // 스피커·TV 근처에서는 이어폰 음악을 일시적으로 줄임
    let duck = 1;
    for (const s of A.spatialSources) {
      const d = camPos.distanceTo(s.position);
      duck = Math.min(duck, U.lerp(CFG.duck.amount, 1, U.smoothstep(CFG.duck.near, CFG.duck.far, d)));
    }
    A.duck = duck;
    const target = A.musicOn ? CFG.volumes.music * duck : 0;
    A.bus.music.gain.setTargetAtTime(target, t, A.musicOn ? 0.6 : 0.25);
  };

  /* ------------------------------------------------------------------------
   * 낙원 환경음 (합성) — 새소리 · 나뭇잎 · 잔바람 · 개울
   *  · 개울 소리는 청취자에게 가장 가까운 개울 지점에서 들림 (공간 음향)
   *  · config.audio.files.paradise에 파일을 넣으면 새·바람 대신 그 파일을 사용
   * ---------------------------------------------------------------------- */
  async function startParadiseAmbience(streamPoints) {
    const ctx = A.ctx;
    const dest = A.group.paradise.ambience;
    const P = { streamPoints: streamPoints || [], nodes: [] };
    const buf = await loadBuffer(CFG.files.paradise);
    if (buf) {
      P.file = playBufferLoop(buf, dest);
    } else {
      // 잔바람: 아주 낮고 작게
      const wind = noiseSource(true, true);
      const wlp = ctx.createBiquadFilter();
      wlp.type = 'lowpass';
      wlp.frequency.value = 520;
      const wg = ctx.createGain();
      wg.gain.value = 0.16;
      wind.connect(wlp);
      wlp.connect(wg);
      wg.connect(dest);
      wind.start(0, Math.random() * 3);
      // 나뭇잎: 부드러운 중고음 노이즈 + 느린 일렁임
      const leaf = noiseSource();
      const lbp = ctx.createBiquadFilter();
      lbp.type = 'bandpass';
      lbp.frequency.value = 2400;
      lbp.Q.value = 0.5;
      const llp = ctx.createBiquadFilter();
      llp.type = 'lowpass';
      llp.frequency.value = 4200;
      const lg = ctx.createGain();
      lg.gain.value = 0.0;
      leaf.connect(lbp);
      lbp.connect(llp);
      llp.connect(lg);
      lg.connect(dest);
      leaf.start(0, Math.random() * 3);
      P.leafGain = lg;
      P.nodes.push(wind, leaf);
    }
    // 개울: 졸졸 흐르는 소리 (대역 노이즈 두 겹 + 빠른 떨림)
    P.water = A.createSpatial(new THREE.Vector3(), 'ambience', 3.5, 'paradise');
    if (P.water) {
      P.water.panner.rolloffFactor = 1.1;
      const wn = noiseSource();
      const b1 = ctx.createBiquadFilter();
      b1.type = 'bandpass';
      b1.frequency.value = 1100;
      b1.Q.value = 1.2;
      const b2 = ctx.createBiquadFilter();
      b2.type = 'bandpass';
      b2.frequency.value = 520;
      b2.Q.value = 0.9;
      const wg1 = ctx.createGain();
      wg1.gain.value = 0.25;
      const wg2 = ctx.createGain();
      wg2.gain.value = 0.3;
      wn.connect(b1);
      wn.connect(b2);
      b1.connect(wg1);
      b2.connect(wg2);
      wg1.connect(P.water.input);
      wg2.connect(P.water.input);
      wn.start(0, Math.random() * 3);
      P.bubble = b1;
      P.nodes.push(wn);
    }
    // 새소리: 무작위 간격으로 짧은 지저귐 (좌우 위치도 무작위)
    P.nextBird = ctx.currentTime + 1.2;
    P.birds = !buf;
    P.update = function (cam, t) {
      if (P.leafGain) P.leafGain.gain.setTargetAtTime(0.035 + 0.03 * (0.5 + 0.5 * Math.sin(t * 0.31) * Math.sin(t * 0.13)), t, 0.8);
      if (P.bubble) P.bubble.frequency.setTargetAtTime(950 + Math.random() * 450, t, 0.05);
      if (P.water) {
        const near = nearestOnPolyline(P.streamPoints, cam);
        if (near) P.water.setPosition(near);
      }
      if (P.birds && t > P.nextBird) {
        chirp(t + 0.02);
        P.nextBird = t + 0.6 + Math.random() * (Math.random() < 0.3 ? 0.4 : 3.2);
      }
    };
    P.stop = function () {
      for (const n of P.nodes) n.stop();
      if (P.file) P.file.stop(1);
    };
    A.paradise = P;
  }

  function chirp(t) {
    const ctx = A.ctx;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const g = ctx.createGain();
    g.gain.value = 0.35 + Math.random() * 0.4;
    if (pan) {
      pan.pan.value = Math.random() * 1.6 - 0.8;
      g.connect(pan);
      pan.connect(A.group.paradise.ambience);
    } else g.connect(A.group.paradise.ambience);
    const base = 2600 + Math.random() * 1800;
    const notes = 2 + Math.floor(Math.random() * 4);
    const kind = Math.random();
    for (let i = 0; i < notes; i++) {
      const st = t + i * (0.09 + Math.random() * 0.05);
      const f0 = base * (kind < 0.5 ? 1 + Math.random() * 0.15 : 1.25 - i * 0.06);
      tone(g, { freq: f0, freqEnd: f0 * (kind < 0.5 ? 1.35 : 0.72), type: 'sine', t: st, peak: 0.05, attack: 0.008, release: 0.07 });
    }
    setTimeout(() => {
      g.disconnect();
      if (pan) pan.disconnect();
    }, 2500);
  }

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _out = new THREE.Vector3();
  function nearestOnPolyline(pts, p) {
    if (!pts || pts.length < 2) return null;
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      _a.set(pts[i][0], pts[i][2] || 0, pts[i][1]);
      _b.set(pts[i + 1][0], pts[i + 1][2] || 0, pts[i + 1][1]);
      const abx = _b.x - _a.x;
      const abz = _b.z - _a.z;
      const len2 = abx * abx + abz * abz || 1;
      const k = U.clamp(((p.x - _a.x) * abx + (p.z - _a.z) * abz) / len2, 0, 1);
      const x = _a.x + abx * k;
      const z = _a.z + abz * k;
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < best) {
        best = d;
        _out.set(x, U.lerp(_a.y, _b.y, k), z);
      }
    }
    return _out;
  }

  /**
   * 사막 → 낙원 환경음 크로스페이드
   * 사막 바람·오브젝트 음원은 서서히 줄인 뒤 정지, 낙원 환경음은 서서히 커짐.
   * 이어폰 음악(music 채널)은 건드리지 않음.
   */
  A.crossfadeToParadise = function (streamPoints, duration = CFG.crossfade) {
    if (!A.ready || A.env === 'paradise') return;
    const ctx = A.ctx;
    const t = ctx.currentTime;
    A.env = 'paradise';
    for (const bus of ['ambience', 'effects']) {
      const d = A.group.desert[bus].gain;
      d.cancelScheduledValues(t);
      d.setValueAtTime(d.value, t);
      d.linearRampToValueAtTime(0.0001, t + duration);
      const pg = A.group.paradise[bus].gain;
      pg.cancelScheduledValues(t);
      pg.setValueAtTime(0.0001, t);
      pg.linearRampToValueAtTime(1, t + duration);
    }
    startParadiseAmbience(streamPoints);
    // 완전히 줄어든 뒤 사막 음원 정지 (연산 절약)
    setTimeout(() => {
      for (const l of Array.from(A.loops)) {
        if (l.env !== 'paradise') {
          try {
            l.stop(0.2);
          } catch (err) {
            /* 이미 정지 */
          }
          A.loops.delete(l);
        }
      }
      if (A.wind && A.wind.sources) A.wind.sources.forEach((n) => n.stop());
      A.wind = null;
      A.spatialSources.clear();
    }, (duration + 0.4) * 1000);
  };

  return A;
})();
