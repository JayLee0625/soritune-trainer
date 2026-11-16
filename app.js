/* 소리튠 발음 트레이너 — 화면과 흐름 */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var APP = '소리튠 발음 트레이너';
  var app = document.getElementById('app');
  var S = { coach: '', pin: '', boot: null, mats: [], mat: null, idx: 0, best: {}, voice: 'ai', ipaOn: true, autoRec: false, screen: 'entry', tab: 'mat' };

  // ---------- 작은 도구 ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem('ipt_' + k); localStorage.setItem('ipt_' + k, v); } catch (e) { return null; } }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem('ipt_' + k); if (v === null) sessionStorage.removeItem('ipt_' + k); else sessionStorage.setItem('ipt_' + k, v); } catch (e) { return null; } }
  function toast(msg, ms) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 2600);
  }
  function scoreCls(v) { return v == null ? '' : (v >= 80 ? 'hi' : (v >= 60 ? 'mid' : 'lo')); }
  function b64ToBytes(b64) { var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function bytesToB64(u8) { var s = '', CH = 0x8000; for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }

  var IC = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    slow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/></svg>'
  };
  function logo(sz, anim) {
    return '<svg class="logo' + (anim ? ' anim' : '') + '" width="' + sz + '" height="' + sz + '" viewBox="0 0 64 64" aria-hidden="true">' +
      '<rect width="64" height="64" rx="16" fill="var(--navy-btn)"/>' +
      '<rect class="b b1" x="10" y="25.0" width="6" height="14" rx="3" fill="#fff"/>' +
      '<rect class="b b2" x="19.5" y="19.0" width="6" height="26" rx="3" fill="#fff"/>' +
      '<rect class="b b3" x="29" y="13.0" width="6" height="38" rx="3" fill="#E5604F"/>' +
      '<rect class="b b4" x="38.5" y="20.0" width="6" height="24" rx="3" fill="#fff"/>' +
      '<rect class="b b5" x="48" y="26.0" width="6" height="12" rx="3" fill="#fff"/>' +
      '</svg>';
  }

  // ---------- 서버 ----------
  function call(action, data) {
    if (window.__MOCK_API) return window.__MOCK_API(action, data || {});
    if (!CFG.api) return Promise.reject(new Error('서버 주소가 설정되지 않았어요.'));
    return fetch(CFG.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, data: data || {} }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || '서버 오류'); return j.data; });
  }
  var saveQ = [], saving = false;
  function queueSave(rec) { saveQ.push(rec); pump(); }
  function pump() {
    if (saving || !saveQ.length) return;
    saving = true;
    var rec = saveQ[0];
    call('attempt', rec).then(function () { saveQ.shift(); saving = false; pump(); })
      .catch(function () { saving = false; setTimeout(pump, 4000); });
  }

  // ---------- 화면 이동 ----------
  function go(screen, push) {
    S.screen = screen;
    if (push !== false) { try { history.pushState({ s: screen, i: S.idx }, ''); } catch (e) { } }
    stopAll();
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', function (e) {
    var st = e.state && e.state.s;
    if (!st) { st = S.coach ? 'home' : 'entry'; }
    if (st === 'practice' && e.state) S.idx = e.state.i || 0;
    S.screen = st; stopAll(); render();
  });
  function render() {
    var f = { entry: vEntry, home: vHome, list: vList, practice: vPractice, admin: vAdmin, adminEdit: vAdminEdit }[S.screen] || vEntry;
    f();
  }

  // ---------- 입장 ----------
  function vEntry() {
    app.innerHTML = '<div class="entry">' + kakaoBar() + logo(68, true) +
      '<h2>' + APP + '</h2><p class="muted">올린 자료 문장을 원어민처럼 — 듣고, 따라 말하고, 억양을 비교해요.</p>' +
      '<input id="nm" placeholder="코치 이름" autocomplete="off" list="coachList" value="' + esc(ls('name') || '') + '">' +
      '<datalist id="coachList"></datalist>' +
      '<button class="btn" id="enter">들어가기</button><div class="err" id="er"></div>' +
      '<p class="small muted center">관리자는 이름 칸에 <b>admin</b>을 입력해요.</p></div>';
    var nm = document.getElementById('nm'), er = document.getElementById('er');
    function bootThen(fn) {
      if (S.boot) return fn();
      call('boot').then(function (b) {
        S.boot = b; S.mats = b.materials || [];
        document.getElementById('coachList') && (document.getElementById('coachList').innerHTML = (b.coaches || []).map(function (c) { return '<option value="' + esc(c) + '">'; }).join(''));
        fn();
      }).catch(function (e) { er.textContent = e.message; });
    }
    bootThen(function () { });
    function enter() {
      var v = nm.value.trim(); if (!v) { er.textContent = '이름을 입력해 주세요.'; return; }
      er.textContent = '';
      if (v.toLowerCase() === 'admin') { bootThen(function () { adminGate(); }); return; }
      bootThen(function () {
        call('enter', { name: v }).then(function (r) {
          S.coach = r.name; S.best = r.best || {}; S.mats = r.materials || S.mats; ls('name', r.name);
          go('home');
        }).catch(function (e) { er.textContent = e.message; });
      });
    }
    document.getElementById('enter').onclick = enter;
    nm.onkeydown = function (e) { if (e.key === 'Enter') enter(); };
  }

  // ---------- 홈 ----------
  function vHome() {
    var h = '<div class="top">' + logo(36) + '<h1>' + esc(S.coach) + ' 코치님</h1><button class="ib" id="out" aria-label="나가기">' + IC.out + '</button></div>';
    h += '<p class="muted" style="margin:0 0 14px">연습할 자료를 골라 주세요.</p>';
    var mats = (S.mats || []).filter(function (m) { return m.open !== false; });
    if (!mats.length) h += '<div class="card empty">아직 올라온 자료가 없어요.</div>';
    mats.forEach(function (m) {
      var done = 0, sum = 0;
      (m.sids || []).forEach(function (sid) { if (S.best[sid] != null) { done++; sum += S.best[sid]; } });
      var avg = done ? Math.round(sum / done) : null;
      h += '<button class="card mat" data-m="' + esc(m.id) + '"><h3>' + esc(m.title) + '</h3>' +
        '<div class="small muted">' + m.count + '문장 · 연습 ' + done + '개' + (avg != null ? ' · 평균 ' + avg + '점' : '') + (m.voiced < m.count ? ' · AI 음성 준비 중' : '') + '</div>' +
        '<div class="bar"><i style="width:' + (m.count ? Math.round(done / m.count * 100) : 0) + '%"></i></div></button>';
    });
    app.innerHTML = h;
    document.getElementById('out').onclick = function () { S.coach = ''; S.best = {}; go('entry'); };
    Array.prototype.forEach.call(app.querySelectorAll('[data-m]'), function (b) { b.onclick = function () { openMat(b.getAttribute('data-m')); }; });
  }
  function openMat(id, then) {
    app.style.opacity = '.6';
    call('material', { id: id, coach: S.coach }).then(function (m) {
      app.style.opacity = '';
      S.mat = m; if (m.best) Object.keys(m.best).forEach(function (k) { S.best[k] = m.best[k]; });
      refCache = {};
      if (then) then(); else go('list');
    }).catch(function (e) { app.style.opacity = ''; toast(e.message); });
  }

  // ---------- 문장 목록 ----------
  function vList() {
    var m = S.mat; if (!m) return go('home', false);
    var h = '<div class="top"><button class="ib" id="bk" aria-label="뒤로">' + IC.back + '</button><h1>' + esc(m.title) + '</h1></div>';
    h += '<div class="card" style="padding:6px 14px">';
    m.sentences.forEach(function (s, i) {
      var b = S.best[s.id];
      h += '<button class="sl" data-i="' + i + '"><span class="no">' + s.n + '</span><span class="tx">' + esc(s.en) + '</span>' +
        '<span class="pill ' + scoreCls(b) + '">' + (b != null ? b : '—') + '</span></button>';
    });
    h += '</div><button class="btn" id="startAll">1번부터 연습하기</button>';
    app.innerHTML = h;
    document.getElementById('bk').onclick = function () { history.back(); };
    document.getElementById('startAll').onclick = function () { S.idx = 0; go('practice'); };
    Array.prototype.forEach.call(app.querySelectorAll('[data-i]'), function (b) { b.onclick = function () { S.idx = +b.getAttribute('data-i'); go('practice'); }; });
  }

  // ---------- 오디오 ----------
  var ctx = null, refCache = {}, player = null, playTimer = 0, recState = null, lastResult = null, myUrl = null;
  function ensureCtx() {
    if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; ctx = new AC(); }
    if (ctx.state === 'suspended') ctx.resume().catch(function () { });
    return ctx;
  }
  function voiceOf(s) {
    var v = s.voices || {};
    if (v[S.voice]) return S.voice;
    return v.ai ? 'ai' : (v.coach ? 'coach' : null);
  }
  function loadRef(s, vk) {
    if (!vk) return Promise.resolve(null);
    var key = s.id + ':' + vk;
    if (refCache[key]) return refCache[key];
    var v = s.voices[vk];
    var pr = call('audio', { file: v.file }).then(function (d) {
      var bytes = b64ToBytes(d.b64);
      var url = URL.createObjectURL(new Blob([bytes], { type: d.mime || 'audio/mpeg' }));
      var c = ensureCtx();
      return new Promise(function (res, rej) {
        var p = c.decodeAudioData(bytes.buffer.slice(0), res, rej);
        if (p && p.then) p.then(res, rej);
      }).then(function (buf) {
        var an = Pitch.analyze(Pitch.resample(buf.getChannelData(0), buf.sampleRate));
        var words = s.words.map(function (w) { return Object.assign({ syl: Hwp.syllables(w) }, w); });
        return { url: url, an: an, times: v.times || null, wf: Pitch.wordFrames(an, words, v.times), dur: buf.duration };
      });
    });
    pr.catch(function () { delete refCache[key]; });
    refCache[key] = pr;
    return pr;
  }
  function stopPlay() {
    if (player) { var pp = player; player = null; try { pp.pause(); } catch (e) { } if (pp.__stop) { var f = pp.__stop; pp.__stop = null; f(); } }
    if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) { }
    cancelAnimationFrame(playTimer); playTimer = 0;
    markNow(-1); drawPlayhead(null);
    Array.prototype.forEach.call(app.querySelectorAll('.ctl .playing'), function (b) { b.classList.remove('playing'); });
  }
  function stopAll() { stopPlay(); if (recState) cancelRec(); }

  // 재생은 하나의 audio 요소로 (아이폰은 처음 누를 때 허용된 요소만 나중에도 재생돼요)
  var AUD = null;
  function audioEl() { if (!AUD) { AUD = document.createElement('audio'); AUD.setAttribute('playsinline', ''); AUD.preload = 'auto'; document.body.appendChild(AUD); } return AUD; }
  function playUrl(url, rate, opts) {
    opts = opts || {};
    stopPlay();
    return new Promise(function (resolve) {
      var a = audioEl(); player = a;
      a.onended = null; a.onerror = null;
      if (a.getAttribute('data-src') !== url) { a.src = url; a.setAttribute('data-src', url); }
      a.preservesPitch = true; a.webkitPreservesPitch = true; a.playbackRate = rate || 1; a.defaultPlaybackRate = rate || 1;
      try { a.currentTime = opts.from || 0; } catch (e) { }
      var fin = false;
      function end(v) { if (fin) return; fin = true; a.__stop = null; if (player === a) stopPlay(); resolve(v); }
      a.__stop = function () { end(false); };
      a.onended = function () { end(true); };
      a.onerror = function () { end(false); };
      var p = a.play(); if (p && p.catch) p.catch(function () { toast('소리를 재생하지 못했어요. 한 번 더 눌러 주세요.'); end(false); });
      function tick() {
        if (player !== a) { end(true); return; }
        if (opts.until && a.currentTime >= opts.until) { end(true); return; }
        if (opts.track) opts.track(a.currentTime);
        playTimer = requestAnimationFrame(tick);
      }
      playTimer = requestAnimationFrame(tick);
    });
  }
  function speakFallback(text, rate) {
    stopPlay();
    return new Promise(function (res) {
      if (!window.speechSynthesis) { toast('이 기기에서는 음성을 재생할 수 없어요.'); return res(false); }
      var u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = (rate || 1) * 0.92;
      u.onend = function () { res(true); }; u.onerror = function () { res(false); };
      speechSynthesis.speak(u);
    });
  }

  // 녹음
  var IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var KAKAO = /KAKAOTALK/i.test(navigator.userAgent);
  function kakaoBar() {
    if (!KAKAO) return '';
    return '<div class="kbar">카카오톡 안에서는 녹음이 안 될 수 있어요.<a href="kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href) + '">다른 브라우저로 열기</a></div>';
  }
  var WORKLET = 'class R extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.n=0}process(i){var c=i[0]&&i[0][0];if(c){for(var k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===2048){this.port.postMessage(this.b.slice(0));this.n=0}}}return true}}registerProcessor("rec-proc",R);';
  var workletReady = null;
  function startCapture(onChunk) {
    var c = ensureCtx();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('이 브라우저는 녹음을 지원하지 않아요.'));
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } }).then(function (stream) {
      var src = c.createMediaStreamSource(stream), node;
      function viaWorklet() {
        if (!workletReady) workletReady = c.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
        return workletReady.then(function () {
          node = new AudioWorkletNode(c, 'rec-proc');
          node.port.onmessage = function (e) { onChunk(e.data); };
          src.connect(node); node.connect(c.destination);
        });
      }
      function viaScript() {
        node = c.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = function (e) { onChunk(new Float32Array(e.inputBuffer.getChannelData(0))); };
        src.connect(node); node.connect(c.destination);
        return Promise.resolve();
      }
      var p = (c.audioWorklet && window.AudioWorkletNode) ? viaWorklet().catch(viaScript) : viaScript();
      return p.then(function () {
        return {
          sr: c.sampleRate,
          stop: function () {
            try { src.disconnect(); } catch (e) { }
            try { node.disconnect(); } catch (e) { }
            if (node.port) node.port.onmessage = null; else node.onaudioprocess = null;
            stream.getTracks().forEach(function (t) { t.stop(); });
            if (IOS) { try { c.close(); } catch (e) { } if (ctx === c) { ctx = null; workletReady = null; } }
          }
        };
      });
    });
  }

  // ---------- 연습 화면 ----------
  function cur() { return S.mat && S.mat.sentences[S.idx]; }
  function vPractice() {
    var m = S.mat, s = cur(); if (!s) return go('list', false);
    lastResult = null;
    var vk = voiceOf(s);
    var voices = s.voices || {};
    var h = '<div class="top"><button class="ib" id="bk" aria-label="뒤로">' + IC.back + '</button><h1>' + esc(m.title) + '</h1>' +
      '<span class="small muted" style="flex:none">' + s.n + ' / ' + m.sentences.length + '</span><button class="ib" id="ls" aria-label="목록">' + IC.list + '</button></div>';
    h += '<div class="card">';
    h += '<div class="chips">';
    if (voices.ai || voices.coach) {
      if (voices.ai) h += '<button class="chip' + (vk === 'ai' ? ' on' : '') + '" data-v="ai">AI 원어민</button>';
      if (voices.coach) h += '<button class="chip' + (vk === 'coach' ? ' on' : '') + '" data-v="coach">대표 코치</button>';
    } else h += '<span class="chip">기기 음성 (AI 음성 준비 중)</span>';
    h += '<span style="flex:1"></span><button class="chip' + (S.ipaOn ? ' on' : '') + '" id="ipaT">발음기호</button></div>';
    h += '<div class="sent" id="sent">' + sentHtml(s, null) + '</div>';
    if (S.ipaOn && s.ipa) h += '<div class="ipa">/' + ipaHtml(s.ipa) + '/</div>';
    if (s.memo) h += '<div class="memo">메모 · ' + esc(s.memo) + '</div>';
    h += '<div class="graphwrap" style="margin-top:14px"><canvas class="graph" id="cv"></canvas></div>';
    h += '<div class="legend"><span><i style="background:var(--ref)"></i>원어민</span><span><i style="background:var(--coral)"></i>나</span><span style="flex:1"></span><span>그래프를 누르면 그 단어를 들려줘요</span></div>';
    h += '<div class="ctl"><button id="pl">' + IC.play + '듣기</button><button id="plS">' + IC.slow + '느리게</button><button id="plX" disabled style="opacity:.45">' + IC.swap + '번갈아</button></div>';
    h += '<div class="micwrap"><button class="mic" id="mic" aria-label="녹음">' + IC.mic + '</button><div class="hint" id="hint"></div>' +
      '<button class="chip' + (S.autoRec ? ' on' : '') + '" id="autoT">듣고 바로 따라 말하기</button></div>';
    h += '</div><div id="res"></div>';
    h += '<div class="nav"><button class="btn sec" id="prev"' + (S.idx === 0 ? ' disabled' : '') + '>이전 문장</button><button class="btn sec" id="next"' + (S.idx >= m.sentences.length - 1 ? ' disabled' : '') + '>다음 문장</button></div>';
    app.innerHTML = h;
    var hint = document.getElementById('hint');
    hint.textContent = '버튼을 누르고 문장을 말해 보세요';
    document.getElementById('bk').onclick = function () { history.back(); };
    document.getElementById('ls').onclick = function () { go('list'); };
    document.getElementById('prev').onclick = function () { if (S.idx > 0) { S.idx--; go('practice'); } };
    document.getElementById('next').onclick = function () { if (S.idx < m.sentences.length - 1) { S.idx++; go('practice'); } };
    document.getElementById('ipaT').onclick = function () { S.ipaOn = !S.ipaOn; ls('ipa', S.ipaOn ? '1' : '0'); render(); };
    document.getElementById('autoT').onclick = function () { S.autoRec = !S.autoRec; ls('auto', S.autoRec ? '1' : '0'); this.classList.toggle('on', S.autoRec); };
    Array.prototype.forEach.call(app.querySelectorAll('[data-v]'), function (b) { b.onclick = function () { S.voice = b.getAttribute('data-v'); ls('voice', S.voice); render(); }; });
    var G = { ref: null, wf: null, live: null, res: null, words: s.words, playhead: null };
    curG = G;
    var cv = document.getElementById('cv');
    function redraw() { drawGraph(cv, G); }
    redraw();
    window.onresize = redraw;
    var refP = loadRef(s, vk);
    refP.then(function (r) { if (curG !== G) return; if (r) { G.ref = r.an; G.wf = r.wf; G.refInfo = r; redraw(); } })
      .catch(function () { toast('원어민 음성을 불러오지 못했어요.'); });
    // 다음 문장 미리 받기
    var nx = m.sentences[S.idx + 1]; if (nx) refP.then(function () { loadRef(nx, voiceOf(nx)).catch(function () { }); });

    function track(t) {
      var r = G.refInfo; if (!r) return;
      var f = Pitch.t2f(t), wi = -1;
      for (var i = 0; i < r.wf.length; i++) if (f >= r.wf[i][0] - 2) wi = i;
      markNow(wi); G.playhead = f; redraw();
    }
    function listen(rate, btn) {
      if (btn.classList.contains('playing')) { stopPlay(); return Promise.resolve(); }
      ensureCtx();
      return refP.then(function (r) {
        btn.classList.add('playing');
        if (!r) return speakFallback(s.en, rate);
        return playUrl(r.url, rate, { track: track });
      }).catch(function () { return speakFallback(s.en, rate); }).then(function (v) { G.playhead = null; redraw(); btn.classList.remove('playing'); return v; });
    }
    var pl = document.getElementById('pl'), plS = document.getElementById('plS'), plX = document.getElementById('plX');
    pl.onclick = function () { listen(1, pl); };
    plS.onclick = function () { listen(0.72, plS); };
    plX.onclick = function () {
      if (!myUrl) return;
      if (plX.classList.contains('playing')) { stopPlay(); return; }
      refP.then(function (r) {
        plX.classList.add('playing');
        var first = r ? playUrl(r.url, 1, { track: track }) : speakFallback(s.en, 1);
        return first.then(function (ok) {
          if (!ok) return;
          plX.classList.add('playing');
          return new Promise(function (z) { setTimeout(z, 350); }).then(function () { return playUrl(myUrl, 1); });
        });
      }).then(function () { plX.classList.remove('playing'); });
    };
    cv.onclick = function (e) {
      var r = G.refInfo; if (!r || !r.times) return;
      var rect = cv.getBoundingClientRect(), x = e.clientX - rect.left;
      var f = xToFrame(G, x, rect.width), wi = -1;
      for (var i = 0; i < r.wf.length; i++) if (f >= r.wf[i][0] - 3) wi = i;
      if (wi < 0) return;
      var from = Math.max(0, r.times[wi] - 0.03), until = wi + 1 < r.times.length ? r.times[wi + 1] : r.dur;
      ensureCtx(); playUrl(r.url, 0.85, { from: from, until: until + 0.02, track: track });
    };

    var mic = document.getElementById('mic');
    mic.onclick = function () {
      if (recState && recState.on) { finishRec(); return; }
      if (recState) return;
      ensureCtx();
      var pre = Promise.resolve();
      if (S.autoRec) {
        hint.textContent = '먼저 원어민 소리를 들어요…';
        pre = listen(1, pl);
      }
      mic.classList.add('busy');
      pre.then(function () { return beginRec(G, s, refP, mic, hint, plX, redraw); }).catch(function (e) {
        mic.classList.remove('busy'); recState = null;
        hint.textContent = (e && e.name === 'NotAllowedError') ? '마이크 사용을 허용해 주세요 (브라우저 설정)' : ((e && e.message) || '녹음을 시작하지 못했어요');
      });
    };
  }
  var curG = null;

  function sentHtml(s, res) {
    var flags = {}, miss = {};
    if (res) { res.words.forEach(function (w, i) { if (w.flag) flags[i] = w.flag; }); res.missPause.forEach(function (i) { miss[i] = 1; }); }
    return s.words.map(function (w, i) {
      var c = 'w' + (w.s === 2 ? ' s2' : (w.s === 1 ? ' s1' : '')) + (flags[i] ? ' ' + flags[i] : '');
      return '<span class="' + c + '" data-wi="' + i + '">' + esc(w.w) + '</span>' + (w.p ? '<span class="pz' + (miss[i] ? ' miss' : '') + '">/</span>' : '');
    }).join(' ');
  }
  function ipaHtml(ipa) {
    return ipa.split(/\s+/).map(function (t) {
      if (t === '|') return '<span class="bar2">|</span>';
      return Hwp.stressSpans(t).map(function (sp) { return sp.st ? '<span class="st' + sp.st + '">' + (sp.st === 2 ? 'ˈ' : 'ˌ') + esc(sp.t) + '</span>' : esc(sp.t); }).join('');
    }).join(' ');
  }
  function markNow(wi) {
    Array.prototype.forEach.call(app.querySelectorAll('.sent .w'), function (el) { el.classList.toggle('now', +el.getAttribute('data-wi') === wi); });
  }

  function beginRec(G, s, refP, mic, hint, plX, redraw) {
    var tr = new Pitch.Tracker(), parts = [], rs = null, started = Date.now();
    recState = { on: false };
    return refP.catch(function () { return null; }).then(function (r) {
      var maxSec = r ? Math.max(6, r.dur * 2.6 + 2) : 15;
      return startCapture(function (chunk) {
        if (!recState || !recState.on) return;
        if (!rs) rs = new Pitch.Stream(recState.cap.sr);
        var y = rs.push(chunk); parts.push(y); tr.push(y);
        G.live = Pitch.liveSemitones(tr);
        if (!recState.raf) recState.raf = requestAnimationFrame(function () { if (recState) recState.raf = 0; redraw(); });
        // 자동 멈춤: 말한 뒤 1.3초 조용하면
        var n = tr.f0.length, v = 0, lastV = -1;
        for (var i = 0; i < n; i++) if (!isNaN(G.live[i])) { v++; lastV = i; }
        if ((v > 35 && n - lastV > 130) || (Date.now() - started) / 1000 > maxSec) finishRec();
      }).then(function (cap) {
        recState = { on: true, cap: cap, parts: parts, tr: tr, G: G, s: s, refP: refP, mic: mic, hint: hint, plX: plX, redraw: redraw };
        G.live = []; G.res = null; G.warp = null;
        document.getElementById('res').innerHTML = '';
        document.getElementById('sent').innerHTML = sentHtml(s, null);
        mic.classList.remove('busy'); mic.classList.add('rec'); mic.innerHTML = IC.stop;
        hint.textContent = '말하는 중… 다 말하면 잠시 기다리거나 버튼을 눌러요';
      });
    });
  }
  function cancelRec() {
    var r = recState; recState = null;
    if (r && r.cap) r.cap.stop();
  }
  function finishRec() {
    var r = recState; if (!r || !r.on) return;
    r.on = false; r.cap.stop(); recState = null;
    r.mic.classList.remove('rec'); r.mic.classList.add('busy'); r.mic.innerHTML = IC.mic;
    r.hint.textContent = '억양을 비교하는 중…';
    var n = 0; r.parts.forEach(function (p) { n += p.length; });
    var x = new Float32Array(n), o = 0; r.parts.forEach(function (p) { x.set(p, o); o += p.length; });
    setTimeout(function () {
      var usr = Pitch.analyze(x);
      if (myUrl) URL.revokeObjectURL(myUrl);
      myUrl = URL.createObjectURL(new Blob([Pitch.wav(x, Pitch.SR)], { type: 'audio/wav' }));
      r.plX.disabled = false; r.plX.style.opacity = '';
      r.refP.catch(function () { return null; }).then(function (ref) {
        r.mic.classList.remove('busy');
        r.hint.textContent = '다시 하려면 버튼을 눌러요';
        if (r.G !== curG) return;
        if (!ref) { r.G.live = null; r.G.usrOnly = usr; r.redraw(); showSoloResult(usr); return; }
        var res = Pitch.compare(ref.an, usr, r.s.words, ref.times);
        r.G.live = null; r.G.res = res; r.G.usr = usr; r.redraw();
        lastResult = res;
        document.getElementById('sent').innerHTML = sentHtml(r.s, res);
        showResult(res);
        var prev = S.best[r.s.id];
        if (prev == null || res.score > prev) S.best[r.s.id] = res.score;
        queueSave({ coach: S.coach, mid: S.mat.id, sid: r.s.id, score: res.score, voice: voiceOf(r.s), parts: { shape: +res.parts.shape.toFixed(2), stress: +res.parts.stress.toFixed(2), pause: +res.parts.pause.toFixed(2), end: res.parts.end, range: +res.parts.ratio.toFixed(2), speed: +res.parts.speed.toFixed(2) } });
      });
    }, 30);
  }
  function ck(label, v) { var c = v >= 0.85 ? 'ok' : (v >= 0.5 ? 'so' : 'no'); return '<div class="ck ' + c + '">' + (c === 'ok' ? '✓' : (c === 'so' ? '△' : '!')) + ' ' + label + '</div>'; }
  function showResult(res) {
    var sc = res.score, col = sc >= 80 ? 'var(--good)' : (sc >= 60 ? 'var(--warn)' : 'var(--bad)');
    var C = 2 * Math.PI * 40;
    var h = '<div class="card"><div class="score"><div class="ring"><svg viewBox="0 0 92 92"><circle cx="46" cy="46" r="40" fill="none" stroke="var(--chip)" stroke-width="9"/>' +
      '<circle cx="46" cy="46" r="40" fill="none" stroke="' + col + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + (C * sc / 100).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg><b>' + sc + '</b></div>' +
      '<div class="checks">' + ck('억양 흐름', res.parts.shape) + ck('강세', res.parts.stress) + ck('끊어 읽기', res.parts.pause) + ck('문장 끝', res.parts.end) + ck('억양 폭', res.parts.range) +
      ck('속도', res.parts.speed > 1.6 || res.parts.speed < 0.65 ? 0.4 : 1) + '</div></div>';
    if (res.tips.length) h += '<ul class="tips">' + res.tips.map(function (t) { return '<li>' + esc(t.t) + '</li>'; }).join('') + '</ul>';
    else h += '<ul class="tips"><li>아주 좋아요! 원어민과 억양이 거의 같아요.</li></ul>';
    if (res.goods.length) h += '<div class="goods">👍 ' + res.goods.map(esc).join(' · ') + '</div>';
    h += '<div class="nav"><button class="btn sec" id="mine">' + IC.me + '내 목소리</button><button class="btn coral" id="again">' + IC.mic + '다시 하기</button></div></div>';
    document.getElementById('res').innerHTML = h;
    document.getElementById('mine').onclick = function () { if (myUrl) playUrl(myUrl, 1); };
    document.getElementById('again').onclick = function () { document.getElementById('mic').click(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  }
  function showSoloResult(usr) {
    var h = '<div class="card"><b>내 억양 곡선이에요</b><p class="muted small" style="margin:6px 0 10px">AI 원어민 음성이 만들어지면 점수와 개선 코멘트가 함께 나와요.</p>' +
      '<div class="small">억양 폭 ' + usr.range.toFixed(1) + '반음 · 말한 시간 ' + ((usr.end - usr.start) / 100).toFixed(1) + '초</div>' +
      '<div class="nav"><button class="btn sec" id="mine">' + IC.me + '내 목소리</button></div></div>';
    document.getElementById('res').innerHTML = h;
    document.getElementById('mine').onclick = function () { if (myUrl) playUrl(myUrl, 1); };
  }

  // ---------- 그래프 ----------
  function cssv(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function domain(G) {
    if (G.ref) {
      var a = G.ref.start - 12, b = G.ref.end + 12;
      if (G.live && G.live.length) { var us = firstVoiced(G.live); if (us >= 0) b = Math.max(b, a + (G.live.length - us) + 24); }
      return [a, b];
    }
    var L = G.live || (G.usrOnly && G.usrOnly.st) || [];
    if (G.usrOnly) return [G.usrOnly.start - 12, G.usrOnly.end + 12];
    var s0 = firstVoiced(L); return [Math.max(0, s0 - 12), Math.max(300, L.length + 20)];
  }
  function firstVoiced(L) { for (var i = 0; i < L.length; i++) if (!isNaN(L[i])) return i; return -1; }
  function xToFrame(G, x, w) { var d = domain(G); return d[0] + (x / w) * (d[1] - d[0]); }
  var lastCanvas = null;
  function drawPlayhead(f) { if (curG) { curG.playhead = f; if (lastCanvas && document.body.contains(lastCanvas)) drawGraph(lastCanvas, curG); } }
  function drawGraph(cv, G) {
    lastCanvas = cv;
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 320, h = cv.clientHeight || 180;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    var col = { ref: cssv('--ref'), me: cssv('--coral'), line: cssv('--line'), mute: cssv('--mute'), bad: cssv('--bad'), good: cssv('--good'), warn: cssv('--warn'), sub: cssv('--sub'), coral: cssv('--coral') };
    var d = domain(G), top = 22, bot = h - 10;
    function X(f) { return (f - d[0]) / (d[1] - d[0]) * w; }
    function Y(st) { var v = Math.max(-10, Math.min(10, st)); return top + (bot - top) * (0.5 - v / 20); }
    // 기준선
    g.strokeStyle = col.line; g.lineWidth = 1; g.setLineDash([]);
    [0, 6, -6].forEach(function (v) { g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(w, Y(v)); g.stroke(); });
    // 단어 띠 (강세)
    var flags = {}; if (G.res) G.res.words.forEach(function (x, i) { flags[i] = x.flag; });
    var labels = [];
    if (G.wf) {
      G.words.forEach(function (wd, i) {
        var a = G.wf[i]; if (!a) return;
        var x0 = X(a[0]), x1 = X(a[1] + 1);
        if (wd.s === 2) {
          var fl = flags[i];
          g.fillStyle = fl === 'weak' ? hexA(col.bad, .16) : (fl === 'good' ? hexA(col.good, .12) : hexA(col.coral, .09));
          g.fillRect(x0, top - 4, Math.max(2, x1 - x0), bot - top + 8);
          labels.push({ x: (x0 + x1) / 2, t: wd.w.replace(/[^A-Za-z']/g, ''), c: fl === 'weak' ? col.bad : (fl === 'good' ? col.good : col.coral) });
        } else if (flags[i] === 'strong') {
          g.fillStyle = hexA(col.warn, .14); g.fillRect(x0, top - 4, Math.max(2, x1 - x0), bot - top + 8);
        }
        if (wd.p && G.wf[i + 1]) {
          var px = (X(a[1]) + X(G.wf[i + 1][0])) / 2, missed = G.res && G.res.missPause.indexOf(i) >= 0;
          g.strokeStyle = missed ? col.bad : col.mute; g.lineWidth = missed ? 2 : 1.2; g.setLineDash([4, 4]);
          g.beginPath(); g.moveTo(px, top); g.lineTo(px, bot); g.stroke(); g.setLineDash([]);
        }
      });
      if (G.res) G.res.extraPause.forEach(function (i) {
        var a = G.wf[i], b = G.wf[i + 1]; if (!a || !b) return;
        var px = (X(a[1]) + X(b[0])) / 2; g.fillStyle = col.warn; g.beginPath(); g.arc(px, bot - 4, 4, 0, 7); g.fill();
      });
    }
    // 라벨 (겹치면 생략)
    g.font = '600 11px -apple-system,BlinkMacSystemFont,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
    var lastR = -1e9;
    labels.forEach(function (l) { var tw = g.measureText(l.t).width; if (l.x - tw / 2 > lastR + 4) { g.fillStyle = l.c; g.fillText(l.t, Math.min(w - tw / 2, Math.max(tw / 2, l.x)), 4); lastR = l.x + tw / 2; } });
    function line(arr, off, color, width) {
      g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath();
      var pen = false;
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (v == null || isNaN(v)) { pen = false; continue; }
        var x = X(i + off), y = Y(v);
        if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
      }
      g.stroke();
    }
    if (G.ref) line(G.ref.st, 0, col.ref, 3);
    if (G.live && G.live.length) {
      var us = firstVoiced(G.live), off = G.ref ? (G.ref.start - Math.max(0, us)) : 0;
      line(G.live, off, col.me, 2.6);
    } else if (G.res) line(G.res.warped, 0, col.me, 2.6);
    else if (G.usrOnly) line(G.usrOnly.st, 0, col.me, 2.6);
    if (G.playhead != null) { g.strokeStyle = col.sub; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(G.playhead), top - 6); g.lineTo(X(G.playhead), bot + 4); g.stroke(); }
    if (!G.ref && !G.live && !G.usrOnly) {
      g.fillStyle = col.mute; g.font = '13px -apple-system,sans-serif'; g.textBaseline = 'middle';
      g.fillText('녹음하면 내 억양 곡선이 그려져요', w / 2, h / 2);
    }
  }
  function hexA(c, a) {
    c = c.trim();
    if (c[0] === '#') { var n = c.length === 4 ? c.slice(1).split('').map(function (x) { return x + x; }).join('') : c.slice(1); var v = parseInt(n, 16); return 'rgba(' + (v >> 16 & 255) + ',' + (v >> 8 & 255) + ',' + (v & 255) + ',' + a + ')'; }
    return c;
  }

  // ---------- 관리자 ----------
  function adminGate() {
    var has = S.boot && S.boot.hasPin;
    var saved = ss('pin');
    if (has && saved) { S.pin = saved; return adminLoad(function () { go('admin'); }, function () { ss('pin', null); S.pin = ''; adminGate(); }); }
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="sheet"><h3 style="margin:0 0 6px">' + (has ? '관리자 비밀번호' : '관리자 비밀번호 만들기') + '</h3>' +
      '<p class="small muted" style="margin:0 0 10px">' + (has ? '비밀번호를 입력해 주세요.' : 'AI 음성 키를 지키기 위해 처음 한 번 비밀번호를 정해요. (4자 이상)') + '</p>' +
      '<input id="p1" type="password" placeholder="비밀번호" autocomplete="off">' + (has ? '' : '<input id="p2" type="password" placeholder="한 번 더" autocomplete="off" style="margin-top:8px">') +
      '<div class="err" id="pe"></div><div class="row" style="margin-top:6px"><button class="btn sec" id="pc">취소</button><button class="btn" id="po">확인</button></div></div>';
    document.body.appendChild(m);
    var p1 = m.querySelector('#p1'), pe = m.querySelector('#pe'); p1.focus();
    m.querySelector('#pc').onclick = function () { m.remove(); };
    m.querySelector('#po').onclick = function () {
      var v = p1.value;
      if (v.length < 4) { pe.textContent = '4자 이상으로 해 주세요.'; return; }
      if (!has) {
        if (m.querySelector('#p2').value !== v) { pe.textContent = '두 번 입력한 비밀번호가 달라요.'; return; }
        call('adminSetPin', { pin: v }).then(function () { S.boot.hasPin = true; S.pin = v; ss('pin', v); m.remove(); adminLoad(function () { go('admin'); }); }).catch(function (e) { pe.textContent = e.message; });
      } else {
        S.pin = v;
        adminLoad(function () { ss('pin', v); m.remove(); go('admin'); }, function (e) { pe.textContent = e.message; });
      }
    };
  }
  var AD = null;
  function adminLoad(ok, fail) {
    call('adminState', { pin: S.pin }).then(function (d) { AD = d; if (ok) ok(); }).catch(function (e) { if (fail) fail(e); else toast(e.message); });
  }
  var VOICES = [
    ['en-US-Neural2-F', '여성 · Neural2-F (추천)'], ['en-US-Neural2-H', '여성 · Neural2-H'], ['en-US-Neural2-J', '남성 · Neural2-J'], ['en-US-Neural2-D', '남성 · Neural2-D'],
    ['en-US-Wavenet-F', '여성 · WaveNet-F'], ['en-US-Wavenet-D', '남성 · WaveNet-D']
  ];
  function vAdmin() {
    if (!AD) return adminLoad(render);
    var h = '<div class="top">' + logo(36) + '<h1>관리자</h1><button class="ib" id="out" aria-label="나가기">' + IC.out + '</button></div>';
    h += '<div class="tabs"><button data-t="mat" class="' + (S.tab === 'mat' ? 'on' : '') + '">자료</button><button data-t="tts" class="' + (S.tab === 'tts' ? 'on' : '') + '">AI 음성</button><button data-t="coach" class="' + (S.tab === 'coach' ? 'on' : '') + '">코치</button></div>';
    if (S.tab === 'mat') {
      h += '<button class="btn" id="newMat" style="margin-bottom:14px">+ 새 자료 올리기</button>';
      if (!AD.materials.length) h += '<div class="card empty">아직 자료가 없어요.</div>';
      AD.materials.forEach(function (m) {
        h += '<div class="card"><div class="row" style="align-items:flex-start"><div style="flex:1;min-width:0"><b>' + esc(m.title) + '</b><div class="small muted">' + m.count + '문장 · AI 음성 ' + m.voiced + '/' + m.count + (m.open === false ? ' · 숨김' : '') + '</div></div></div>' +
          '<div class="row" style="margin-top:12px;flex-wrap:wrap"><button class="btn sm" data-gen="' + esc(m.id) + '"' + (AD.hasKey ? '' : ' disabled') + '>' + (m.voiced < m.count ? 'AI 음성 만들기' : 'AI 음성 다시 만들기') + '</button>' +
          '<button class="btn sm sec" data-ed="' + esc(m.id) + '">수정</button><button class="btn sm sec" data-hide="' + esc(m.id) + '">' + (m.open === false ? '보이기' : '숨기기') + '</button><button class="btn sm sec" data-del="' + esc(m.id) + '">삭제</button></div></div>';
      });
      if (!AD.hasKey) h += '<p class="small muted">AI 음성을 만들려면 먼저 ‘AI 음성’ 탭에서 키를 등록해 주세요.</p>';
    } else if (S.tab === 'tts') {
      var st = AD.settings || {};
      h += '<div class="card"><b>구글 클라우드 API 키</b><div class="small muted" style="margin:4px 0 10px">' + (AD.hasKey ? '등록됨 (끝자리 ' + esc(AD.keyHint) + ')' : '아직 없어요') + '</div>' +
        '<input id="key" type="password" placeholder="API 키 붙여넣기" autocomplete="off"><button class="btn sm" id="saveKey" style="margin-top:8px">키 저장</button>' +
        '<p class="small muted" style="margin:10px 0 0">키는 서버에만 저장되고 화면에 다시 보이지 않아요.</p></div>';
      h += '<div class="card"><b>AI 음성 설정</b><label class="f">목소리</label><select id="vo">' + VOICES.map(function (v) { return '<option value="' + v[0] + '"' + (st.voice === v[0] ? ' selected' : '') + '>' + v[1] + '</option>'; }).join('') + '</select>' +
        '<label class="f">속도</label><select id="rt">' + [0.85, 0.9, 0.95, 1].map(function (r) { return '<option value="' + r + '"' + (+st.rate === r ? ' selected' : '') + '>' + (r === 1 ? '보통 (1.0)' : r) + '</option>'; }).join('') + '</select>' +
        '<div class="sw"><div><b style="font-size:15px">발음기호대로 읽기</b><div class="small muted">자료의 발음기호를 AI 음성에 적용해요. 맞지 않는 단어는 자동으로 일반 읽기.</div></div><button class="tg' + (st.phoneme !== false ? ' on' : '') + '" id="ph"></button></div>' +
        '<div class="row" style="margin-top:8px"><button class="btn sec" id="test"' + (AD.hasKey ? '' : ' disabled') + '>들어보기</button><button class="btn" id="saveSet">설정 저장</button></div>' +
        '<p class="small muted" style="margin:10px 0 0">설정을 바꾼 뒤에는 자료에서 ‘AI 음성 다시 만들기’를 눌러야 새 목소리로 바뀌어요.</p></div>';
    } else {
      h += '<div class="card"><b>코치 추가</b><div class="row" style="margin-top:10px"><input id="cn" placeholder="이름"><button class="btn sm" id="addC" style="flex:none">추가</button></div></div>';
      h += '<div class="card" style="padding:6px 16px">' + (AD.coaches.length ? AD.coaches.map(function (c) { return '<div class="sl"><span class="tx">' + esc(c) + '</span><button class="btn sm sec" data-rc="' + esc(c) + '">삭제</button></div>'; }).join('') : '<div class="empty">등록된 코치가 없어요.</div>') + '</div>';
    }
    app.innerHTML = h;
    document.getElementById('out').onclick = function () { S.pin = ''; ss('pin', null); AD = null; go('entry'); };
    Array.prototype.forEach.call(app.querySelectorAll('[data-t]'), function (b) { b.onclick = function () { S.tab = b.getAttribute('data-t'); render(); }; });
    function done(p, msg) { return p.then(function (d) { if (d && d.materials) AD = d; if (msg) toast(msg); render(); }).catch(function (e) { toast(e.message, 4000); }); }
    if (S.tab === 'mat') {
      document.getElementById('newMat').onclick = function () { ED = { id: '', title: '', sentences: [] }; go('adminEdit'); };
      Array.prototype.forEach.call(app.querySelectorAll('[data-ed]'), function (b) { b.onclick = function () { editMat(b.getAttribute('data-ed')); }; });
      Array.prototype.forEach.call(app.querySelectorAll('[data-del]'), function (b) {
        b.onclick = function () { confirmBox('이 자료를 삭제할까요? 문장과 AI 음성, 연습 기록 연결이 모두 지워져요.', '삭제', function () { done(call('adminDeleteMaterial', { pin: S.pin, id: b.getAttribute('data-del') }), '삭제했어요'); }); };
      });
      Array.prototype.forEach.call(app.querySelectorAll('[data-hide]'), function (b) { b.onclick = function () { done(call('adminToggleMaterial', { pin: S.pin, id: b.getAttribute('data-hide') })); }; });
      Array.prototype.forEach.call(app.querySelectorAll('[data-gen]'), function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-gen'), m = AD.materials.filter(function (x) { return x.id === id; })[0];
          if (m.voiced >= m.count) confirmBox('지금 설정으로 AI 음성을 모두 새로 만들까요?', '다시 만들기', function () { generate(id, true); });
          else generate(id, false);
        };
      });
    } else if (S.tab === 'tts') {
      document.getElementById('saveKey').onclick = function () {
        var k = document.getElementById('key').value.trim(); if (!k) return;
        done(call('adminSetKey', { pin: S.pin, key: k }), '키를 저장했어요');
      };
      var ph = document.getElementById('ph'); ph.onclick = function () { ph.classList.toggle('on'); };
      function settings() { return { voice: document.getElementById('vo').value, rate: +document.getElementById('rt').value, phoneme: ph.classList.contains('on') }; }
      document.getElementById('saveSet').onclick = function () { done(call('adminSettings', Object.assign({ pin: S.pin }, settings())), '설정을 저장했어요'); };
      document.getElementById('test').onclick = function () {
        var t = this; t.disabled = true; t.textContent = '만드는 중…'; ensureCtx();
        call('adminTestVoice', Object.assign({ pin: S.pin }, settings())).then(function (d) {
          t.disabled = false; t.textContent = '들어보기';
          var u = URL.createObjectURL(new Blob([b64ToBytes(d.b64)], { type: 'audio/mpeg' }));
          playUrl(u, 1);
          if (d.note) toast(d.note, 4000);
        }).catch(function (e) { t.disabled = false; t.textContent = '들어보기'; toast(e.message, 5000); });
      };
    } else {
      document.getElementById('addC').onclick = function () { var v = document.getElementById('cn').value.trim(); if (v) done(call('adminCoach', { pin: S.pin, add: v }), '추가했어요'); };
      Array.prototype.forEach.call(app.querySelectorAll('[data-rc]'), function (b) { b.onclick = function () { confirmBox(b.getAttribute('data-rc') + ' 코치를 삭제할까요? (연습 기록은 남아요)', '삭제', function () { done(call('adminCoach', { pin: S.pin, remove: b.getAttribute('data-rc') })); }); }; });
    }
  }
  function confirmBox(msg, okLabel, fn) {
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="sheet"><p style="margin:0 0 14px;font-weight:600">' + esc(msg) + '</p><div class="row"><button class="btn sec" id="c0">취소</button><button class="btn coral" id="c1">' + esc(okLabel) + '</button></div></div>';
    document.body.appendChild(m);
    m.querySelector('#c0').onclick = function () { m.remove(); };
    m.querySelector('#c1').onclick = function () { m.remove(); fn(); };
  }
  function generate(id, force) {
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="sheet"><b>AI 음성 만드는 중</b><div class="prog"><i id="pg" style="width:0"></i></div><div class="small muted" id="pt">준비 중…</div><div class="err" id="pe"></div><button class="btn sec" id="pclose" style="margin-top:10px;display:none">닫기</button></div>';
    document.body.appendChild(m);
    var pg = m.querySelector('#pg'), pt = m.querySelector('#pt'), pe = m.querySelector('#pe'), errs = [];
    function step(first) {
      call('adminGenerate', { pin: S.pin, id: id, force: !!(force && first) }).then(function (d) {
        var dn = d.total - d.remaining;
        pg.style.width = Math.round(dn / Math.max(1, d.total) * 100) + '%';
        pt.textContent = dn + ' / ' + d.total + ' 문장';
        (d.errors || []).forEach(function (e) { errs.push(e); });
        if (d.notes && d.notes.length) pe.style.color = 'var(--sub)';
        if (d.remaining > 0 && !d.stop) step(false);
        else {
          pt.textContent = d.remaining ? '일부 문장을 만들지 못했어요.' : '다 만들었어요! (' + d.total + '문장)';
          if (errs.length) pe.textContent = errs.slice(0, 3).join(' / ');
          m.querySelector('#pclose').style.display = '';
          adminLoad();
        }
      }).catch(function (e) { pe.textContent = e.message; m.querySelector('#pclose').style.display = ''; });
    }
    m.querySelector('#pclose').onclick = function () { m.remove(); render(); };
    step(true);
  }

  // 자료 올리기·수정
  var ED = null;
  function editMat(id) {
    call('material', { id: id, coach: '', admin: true }).then(function (m) {
      ED = { id: m.id, title: m.title, sentences: m.sentences.map(function (s) { return { id: s.id, en: s.en, ipa: s.ipa, memo: s.memo, words: s.words, warn: [] }; }) };
      go('adminEdit');
    }).catch(function (e) { toast(e.message); });
  }
  function vAdminEdit() {
    if (!ED) return go('admin', false);
    var h = '<div class="top"><button class="ib" id="bk" aria-label="뒤로">' + IC.back + '</button><h1>' + (ED.id ? '자료 수정' : '새 자료 올리기') + '</h1></div>';
    h += '<div class="card"><label class="f" style="margin-top:0">자료 이름</label><input id="ti" value="' + esc(ED.title) + '" placeholder="예: 인터뷰 문장 1">';
    h += '<label class="f">한글(HWP)·텍스트 파일</label><input id="fi" type="file" accept=".hwp,.txt,text/plain">';
    h += '<label class="f">또는 붙여넣기 (영어 문장 한 줄 + 발음기호 /…/ 한 줄)</label><textarea id="pa" placeholder="I really believe that.&#10;/aɪ ˈrɪəli bɪˈliːv ðæt/"></textarea>';
    h += '<button class="btn sec" id="rd" style="margin-top:10px">' + (ED.sentences.length ? '읽어서 뒤에 추가하기' : '읽기') + '</button><div class="err" id="re"></div></div>';
    if (ED.sentences.length) {
      var nw = ED.sentences.filter(function (s) { return s.warn && s.warn.length; }).length;
      h += '<p class="small muted" style="margin:0 0 8px">' + ED.sentences.length + '문장' + (nw ? ' · <b style="color:var(--warn)">확인할 곳 ' + nw + '개</b>' : '') + ' — 고친 뒤 저장해 주세요. 강세 단어는 주황색이에요.</p>';
      ED.sentences.forEach(function (s, i) { h += edCard(s, i); });
      h += '<button class="btn" id="sv">저장</button>';
    }
    app.innerHTML = h;
    document.getElementById('bk').onclick = function () { history.back(); };
    var re = document.getElementById('re');
    document.getElementById('ti').oninput = function () { ED.title = this.value; };
    document.getElementById('rd').onclick = function () {
      var f = document.getElementById('fi').files[0], pa = document.getElementById('pa').value.trim();
      re.textContent = '';
      var p;
      if (f) {
        p = f.arrayBuffer().then(function (ab) {
          if (/\.hwp$/i.test(f.name)) return Hwp.readHwp(ab).then(function (lines) { return Hwp.pairLines(lines); });
          return Hwp.readText(new TextDecoder('utf-8').decode(ab));
        });
        if (!ED.title) ED.title = f.name.replace(/\.[^.]+$/, '').replace(/^\S*TalkFile_+/i, '');
      } else if (pa) p = Promise.resolve(Hwp.readText(pa));
      else { re.textContent = '파일을 고르거나 문장을 붙여넣어 주세요.'; return; }
      p.then(function (list) {
        if (!list.length) { re.textContent = '문장을 찾지 못했어요. 영어 한 줄, 발음기호 한 줄 형식인지 확인해 주세요.'; return; }
        list.forEach(function (s) { ED.sentences.push({ id: '', en: s.en, ipa: s.ipa, memo: s.memo, words: s.words, warn: s.warn }); });
        render();
      }).catch(function (e) { re.textContent = '읽지 못했어요: ' + e.message; });
    };
    Array.prototype.forEach.call(app.querySelectorAll('.ed'), function (box) {
      var i = +box.getAttribute('data-i');
      function upd() {
        var s = ED.sentences[i], b = Hwp.buildOne(box.querySelector('.en').value, box.querySelector('.ip').value, box.querySelector('.me').value, i + 1);
        s.en = b.en; s.ipa = b.ipa; s.memo = b.memo; s.words = b.words; s.warn = b.warn;
        box.querySelector('.wchips').innerHTML = wchips(s); box.querySelector('.warn').innerHTML = warnHtml(s);
      }
      box.querySelector('.en').onchange = upd; box.querySelector('.ip').onchange = upd; box.querySelector('.me').onchange = upd;
      box.querySelector('.rm').onclick = function () { ED.sentences.splice(i, 1); render(); };
    });
    var sv = document.getElementById('sv');
    if (sv) sv.onclick = function () {
      if (!ED.title.trim()) { toast('자료 이름을 입력해 주세요.'); window.scrollTo(0, 0); return; }
      sv.disabled = true; sv.textContent = '저장 중…';
      call('adminSaveMaterial', { pin: S.pin, id: ED.id, title: ED.title.trim(), sentences: ED.sentences.map(function (s) { return { id: s.id, en: s.en, ipa: s.ipa, memo: s.memo, words: s.words }; }) })
        .then(function (d) { AD = d.state || AD; ED = null; S.tab = 'mat'; toast('저장했어요' + (AD && AD.hasKey ? ' — 이제 ‘AI 음성 만들기’를 눌러 주세요' : '')); go('admin'); })
        .catch(function (e) { sv.disabled = false; sv.textContent = '저장'; toast(e.message, 4000); });
    };
  }
  function wchips(s) {
    return (s.words || []).map(function (w) { return '<span class="wc' + (w.s === 2 ? ' s2' : '') + (w.ipa ? '' : ' no') + '">' + esc(w.w.replace(/[^\w'-]/g, '')) + (w.p ? '<span class="pp">/</span>' : '') + '</span>'; }).join('');
  }
  function warnHtml(s) { return (s.warn || []).map(function (x) { return '<span>' + esc(x) + '</span>'; }).join(''); }
  function edCard(s, i) {
    return '<div class="ed" data-i="' + i + '"><div class="h"><span>' + (i + 1) + '</span><button class="btn sm sec rm" style="height:30px">빼기</button></div>' +
      '<textarea class="en" rows="2">' + esc(s.en) + '</textarea><input class="ip ipa-in" value="' + esc(s.ipa) + '" placeholder="발음기호 (없으면 비워 두기)">' +
      '<input class="me" value="' + esc(s.memo || '') + '" placeholder="메모 (선택)"><div class="wchips">' + wchips(s) + '</div><div class="warn">' + warnHtml(s) + '</div></div>';
  }

  // ---------- 시작 ----------
  S.ipaOn = ls('ipa') !== '0'; S.autoRec = ls('auto') === '1'; S.voice = ls('voice') || 'ai';
  try { history.replaceState({ s: 'entry' }, ''); } catch (e) { }
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.__MOCK_API) navigator.serviceWorker.register('sw.js').catch(function () { });
  window.__app = { S: S, go: go, render: render };
})();
