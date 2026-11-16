/* 억양 분석 엔진: 음높이(YIN) · 크기 · MFCC · DTW 정렬 · 비교/코멘트
   브라우저와 Node 둘 다에서 동작 */
(function (root) {
  'use strict';
  var SR = 16000, HOP = 160, WIN = 480, FMIN = 65, FMAX = 500;
  var TAU_MIN = Math.floor(SR / FMAX), TAU_MAX = Math.ceil(SR / FMIN);
  var NEED = WIN + TAU_MAX + 2;

  // ---------- 리샘플 (저역통과 + 선형보간) ----------
  function biquadLP(x, sr, fc) {
    var w = 2 * Math.PI * fc / sr, c = Math.cos(w), s = Math.sin(w), q = Math.SQRT1_2, a = s / (2 * q);
    var b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    var y = new Float32Array(x.length), x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var i = 0; i < x.length; i++) {
      var v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  function resample(x, srIn) {
    if (srIn === SR) return Float32Array.from(x);
    var y = x;
    if (srIn > SR) { y = biquadLP(biquadLP(x, srIn, 7000), srIn, 7000); }
    var ratio = srIn / SR, n = Math.floor(y.length / ratio), out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var p = i * ratio, k = Math.floor(p), f = p - k;
      out[i] = (y[k] || 0) * (1 - f) + (y[k + 1] || 0) * f;
    }
    return out;
  }

  function Biq(sr, fc) {
    var w = 2 * Math.PI * fc / sr, c = Math.cos(w), s = Math.sin(w), a = s / (2 * Math.SQRT1_2), a0 = 1 + a;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - a) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  Biq.prototype.run = function (x) {
    var y = new Float32Array(x.length);
    for (var i = 0; i < x.length; i++) {
      var v = this.b0 * x[i] + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x[i]; this.y2 = this.y1; this.y1 = v; y[i] = v;
    }
    return y;
  };
  // 녹음 중 조각을 이어 받는 리샘플러 (필터 상태 유지)
  function Stream(srIn) {
    this.ratio = srIn / SR; this.same = srIn === SR;
    this.f1 = new Biq(srIn, 7000); this.f2 = new Biq(srIn, 7000);
    this.prev = 0; this.offset = 0; this.t = 0;
  }
  Stream.prototype.push = function (x) {
    if (this.same) return Float32Array.from(x);
    var y = this.f2.run(this.f1.run(x)), out = [], len = y.length;
    while (true) {
      var k = Math.floor(this.t), f = this.t - k, i0 = k - this.offset;
      if (i0 + 1 >= len) break;
      var a = i0 < 0 ? this.prev : y[i0], b = y[i0 + 1];
      out.push(a * (1 - f) + b * f);
      this.t += this.ratio;
    }
    this.prev = y[len - 1]; this.offset += len;
    return Float32Array.from(out);
  };

  // ---------- 프레임 단위 계산 ----------
  var dBuf = new Float32Array(TAU_MAX + 2);
  function yinAt(x, off) {
    var d = dBuf, tau, j, sum = 0;
    d[0] = 1;
    for (tau = 1; tau <= TAU_MAX; tau++) {
      var acc = 0;
      for (j = 0; j < WIN; j++) { var df = x[off + j] - x[off + j + tau]; acc += df * df; }
      sum += acc;
      d[tau] = sum > 0 ? acc * tau / sum : 1;
    }
    var best = -1;
    for (tau = TAU_MIN; tau < TAU_MAX; tau++) {
      if (d[tau] < 0.2) { while (tau + 1 < TAU_MAX && d[tau + 1] < d[tau]) tau++; best = tau; break; }
    }
    if (best < 0) {
      var mv = 1; for (tau = TAU_MIN; tau < TAU_MAX; tau++) if (d[tau] < mv) { mv = d[tau]; best = tau; }
      if (mv > 0.35) return { f0: 0, ap: mv };
    }
    var a = d[best - 1], b = d[best], c = d[best + 1], den = a - 2 * b + c;
    var t = den !== 0 ? best + 0.5 * (a - c) / den : best;
    return { f0: SR / t, ap: d[best] };
  }
  function energyDb(x, off) {
    var e = 0; for (var j = 0; j < WIN; j++) { var v = x[off + j]; e += v * v; }
    return 10 * Math.log10(e / WIN + 1e-10);
  }

  // FFT (radix-2)
  var N_FFT = 512, HALF = N_FFT / 2;
  var hann = new Float32Array(400); for (var hi = 0; hi < 400; hi++) hann[hi] = 0.5 - 0.5 * Math.cos(2 * Math.PI * hi / 399);
  var rev = new Uint16Array(N_FFT); (function () { var bits = 9; for (var i = 0; i < N_FFT; i++) { var r = 0; for (var b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; } })();
  var cosT = new Float32Array(HALF), sinT = new Float32Array(HALF);
  for (var ti = 0; ti < HALF; ti++) { cosT[ti] = Math.cos(2 * Math.PI * ti / N_FFT); sinT[ti] = -Math.sin(2 * Math.PI * ti / N_FFT); }
  var re = new Float32Array(N_FFT), im = new Float32Array(N_FFT);
  function powerSpec(x, off, out) {
    var i;
    for (i = 0; i < N_FFT; i++) { re[i] = 0; im[i] = 0; }
    for (i = 0; i < 400; i++) re[rev[i]] = (x[off + i] || 0) * hann[i];
    for (var size = 2; size <= N_FFT; size <<= 1) {
      var h = size >> 1, step = N_FFT / size;
      for (var st = 0; st < N_FFT; st += size) for (var k = 0; k < h; k++) {
        var a = st + k, b = a + h, wr = cosT[k * step], wi = sinT[k * step];
        var tr = re[b] * wr - im[b] * wi, tim = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - tim; re[a] += tr; im[a] += tim;
      }
    }
    for (i = 0; i <= HALF; i++) out[i] = re[i] * re[i] + im[i] * im[i];
  }
  var NMEL = 26, NCEP = 12;
  var melFb = (function () {
    function hz2mel(f) { return 2595 * Math.log10(1 + f / 700); }
    function mel2hz(m) { return 700 * (Math.pow(10, m / 2595) - 1); }
    var lo = hz2mel(80), hi = hz2mel(7600), pts = [];
    for (var i = 0; i < NMEL + 2; i++) pts.push(Math.floor((N_FFT + 1) * mel2hz(lo + (hi - lo) * i / (NMEL + 1)) / SR));
    var fb = [];
    for (var m = 1; m <= NMEL; m++) {
      var row = new Float32Array(HALF + 1);
      for (var k = pts[m - 1]; k < pts[m]; k++) row[k] = (k - pts[m - 1]) / Math.max(1, pts[m] - pts[m - 1]);
      for (k = pts[m]; k < pts[m + 1]; k++) row[k] = (pts[m + 1] - k) / Math.max(1, pts[m + 1] - pts[m]);
      fb.push(row);
    }
    return fb;
  })();
  var spec = new Float32Array(HALF + 1), logm = new Float32Array(NMEL);
  function mfcc(x, off) {
    powerSpec(x, off, spec);
    for (var m = 0; m < NMEL; m++) { var s = 0, row = melFb[m]; for (var k = 0; k <= HALF; k++) s += row[k] * spec[k]; logm[m] = Math.log(s + 1e-8); }
    var out = new Float32Array(NCEP);
    for (var c = 1; c <= NCEP; c++) { var v = 0; for (m = 0; m < NMEL; m++) v += logm[m] * Math.cos(Math.PI * c * (m + 0.5) / NMEL); out[c - 1] = v; }
    return out;
  }

  // ---------- 실시간 추적기 ----------
  function Tracker() { this.buf = new Float32Array(0); this.base = 0; this.f0 = []; this.ap = []; this.db = []; }
  Tracker.prototype.push = function (x16) {
    var nb = new Float32Array(this.buf.length + x16.length); nb.set(this.buf); nb.set(x16, this.buf.length); this.buf = nb;
    var added = 0;
    while ((this.f0.length * HOP) - this.base + NEED <= this.buf.length) {
      var off = this.f0.length * HOP - this.base;
      var r = yinAt(this.buf, off);
      this.f0.push(r.f0); this.ap.push(r.ap); this.db.push(energyDb(this.buf, off)); added++;
    }
    var keep = this.f0.length * HOP - this.base;
    if (keep > 8000) { this.buf = this.buf.slice(keep - 0); this.base += keep; }
    return added;
  };

  // ---------- 전체 분석 ----------
  function pct(arr, p) { if (!arr.length) return 0; var a = arr.slice().sort(function (x, y) { return x - y; }); return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))]; }
  function median(arr) { return pct(arr, 0.5); }

  function analyze(x16, opts) {
    opts = opts || {};
    var n = Math.max(0, Math.floor((x16.length - NEED) / HOP) + 1);
    var f0 = new Float32Array(n), ap = new Float32Array(n), db = new Float32Array(n), cep = [];
    for (var i = 0; i < n; i++) {
      var off = i * HOP, r = yinAt(x16, off);
      f0[i] = r.f0; ap[i] = r.ap; db[i] = energyDb(x16, off);
      cep.push(mfcc(x16, off));
    }
    return finish({ f0: f0, ap: ap, db: db, cep: cep, n: n, dur: x16.length / SR, samples: x16 });
  }

  function finish(a) {
    var n = a.n, i;
    var dbs = Array.prototype.slice.call(a.db);
    var floor = pct(dbs, 0.1), peak = pct(dbs, 0.98);
    var thr = Math.max(floor + 12, peak - 38, -58);
    var speech = new Uint8Array(n), voiced = new Uint8Array(n), f = new Float32Array(n);
    for (i = 0; i < n; i++) {
      speech[i] = a.db[i] > thr ? 1 : 0;
      voiced[i] = (speech[i] && a.f0[i] > 0 && a.ap[i] < 0.3) ? 1 : 0;
      f[i] = voiced[i] ? a.f0[i] : 0;
    }
    // 중앙값 필터
    var g = new Float32Array(n);
    for (i = 0; i < n; i++) {
      if (!voiced[i]) continue;
      var w = []; for (var k = i - 2; k <= i + 2; k++) if (k >= 0 && k < n && voiced[k]) w.push(f[k]);
      g[i] = median(w);
    }
    // 옥타브 오류 보정
    for (i = 0; i < n; i++) {
      if (!voiced[i]) continue;
      var w2 = []; for (k = i - 12; k <= i + 12; k++) if (k >= 0 && k < n && voiced[k]) w2.push(g[k]);
      var m = median(w2), rr = g[i] / m;
      if (rr > 1.75) g[i] /= 2; else if (rr < 0.58) g[i] *= 2;
    }
    // 짧은 유성 구간 제거
    i = 0;
    while (i < n) {
      if (!voiced[i]) { i++; continue; }
      var j = i; while (j < n && voiced[j]) j++;
      if (j - i < 4) for (k = i; k < j; k++) { voiced[k] = 0; g[k] = 0; }
      i = j;
    }
    // 발화 구간 (앞뒤 무음 제외)
    var s0 = -1, s1 = -1;
    for (i = 0; i < n; i++) if (speech[i]) { if (s0 < 0) s0 = i; s1 = i; }
    var vf = []; for (i = 0; i < n; i++) if (voiced[i]) vf.push(g[i]);
    var med = vf.length ? median(vf) : 150;
    var st = new Float32Array(n);
    for (i = 0; i < n; i++) st[i] = voiced[i] ? 12 * Math.log2(g[i] / med) : NaN;
    // 표시용 부드럽게
    var sm = new Float32Array(n);
    for (i = 0; i < n; i++) {
      if (!voiced[i]) { sm[i] = NaN; continue; }
      var s = 0, c = 0; for (k = i - 2; k <= i + 2; k++) if (k >= 0 && k < n && voiced[k]) { s += st[k]; c++; }
      sm[i] = s / c;
    }
    a.speech = speech; a.voiced = voiced; a.f0 = g; a.st = sm; a.medHz = med; a.thr = thr;
    a.start = s0 < 0 ? 0 : s0; a.end = s1 < 0 ? n - 1 : s1;
    var vst = []; for (i = 0; i < n; i++) if (voiced[i]) vst.push(sm[i]);
    a.range = vst.length ? pct(vst, 0.9) - pct(vst, 0.1) : 0;
    a.voicedCount = vst.length;
    return a;
  }

  // 실시간 곡선 (반음, 진행 중 중앙값 기준)
  function liveSemitones(tr) {
    var n = tr.f0.length, dbs = tr.db, peak = -100, i;
    for (i = 0; i < n; i++) if (dbs[i] > peak) peak = dbs[i];
    var thr = Math.max(peak - 35, -55);
    var vals = [], out = new Array(n);
    for (i = 0; i < n; i++) if (tr.f0[i] > 0 && tr.ap[i] < 0.3 && dbs[i] > thr) vals.push(tr.f0[i]);
    var med = vals.length ? median(vals) : 0;
    for (i = 0; i < n; i++) {
      var ok = med && tr.f0[i] > 0 && tr.ap[i] < 0.3 && dbs[i] > thr;
      var v = ok ? 12 * Math.log2(tr.f0[i] / med) : NaN;
      if (ok && (v > 14 || v < -14)) v = NaN;
      out[i] = v;
    }
    return out;
  }

  // ---------- DTW ----------
  function dtw(A, B, a0, a1, b0, b1) {
    var N = a1 - a0 + 1, M = b1 - b0 + 1, i, j;
    // 평균 빼기 (CMN)
    function norm(X, s, e) {
      var mean = new Float32Array(NCEP), out = [], k, c;
      for (k = s; k <= e; k++) for (c = 0; c < NCEP; c++) mean[c] += X[k][c];
      for (c = 0; c < NCEP; c++) mean[c] /= (e - s + 1);
      var sd = new Float32Array(NCEP);
      for (k = s; k <= e; k++) for (c = 0; c < NCEP; c++) { var d = X[k][c] - mean[c]; sd[c] += d * d; }
      for (c = 0; c < NCEP; c++) sd[c] = Math.sqrt(sd[c] / (e - s + 1)) + 1e-6;
      for (k = s; k <= e; k++) { var v = new Float32Array(NCEP); for (c = 0; c < NCEP; c++) v[c] = (X[k][c] - mean[c]) / sd[c]; out.push(v); }
      return out;
    }
    var X = norm(A, a0, a1), Y = norm(B, b0, b1);
    var band = Math.max(25, Math.round(0.3 * Math.max(N, M)));
    var INF = 1e18, D = new Float64Array(N * M).fill(INF), P = new Uint8Array(N * M);
    function dist(p, q) { var s = 0, x = X[p], y = Y[q]; for (var c = 0; c < NCEP; c++) { var d = x[c] - y[c]; s += d * d; } return Math.sqrt(s); }
    for (i = 0; i < N; i++) {
      var center = Math.round(i * (M - 1) / Math.max(1, N - 1));
      var jlo = Math.max(0, center - band), jhi = Math.min(M - 1, center + band);
      for (j = jlo; j <= jhi; j++) {
        var c = dist(i, j), best = INF, bp = 0;
        if (i === 0 && j === 0) { best = 0; bp = 0; }
        else {
          if (i > 0 && j > 0 && D[(i - 1) * M + j - 1] < best) { best = D[(i - 1) * M + j - 1]; bp = 1; }
          if (i > 0 && D[(i - 1) * M + j] + 0.15 < best) { best = D[(i - 1) * M + j] + 0.15; bp = 2; }
          if (j > 0 && D[i * M + j - 1] + 0.15 < best) { best = D[i * M + j - 1] + 0.15; bp = 3; }
        }
        if (best < INF) { D[i * M + j] = best + c; P[i * M + j] = bp; }
      }
    }
    var path = []; i = N - 1; j = M - 1;
    if (D[i * M + j] >= INF) { // 띠 밖이면 대각선으로
      for (i = 0; i < N; i++) path.push([a0 + i, b0 + Math.round(i * (M - 1) / Math.max(1, N - 1))]);
      return path;
    }
    while (i >= 0 && j >= 0) {
      path.push([a0 + i, b0 + j]);
      var p = P[i * M + j];
      if (p === 1) { i--; j--; } else if (p === 2) i--; else if (p === 3) j--; else break;
    }
    path.reverse();
    return path;
  }

  // ---------- 단어 시간 ----------
  // 프레임 i 는 [i*10ms, i*10ms+30ms] 구간 → 가운데 시각은 i*10ms+15ms
  var FOFF = WIN / 2 / SR;
  function t2f(t) { return Math.max(0, Math.round((t - FOFF) * SR / HOP)); }
  function f2t(f) { return f * HOP / SR + FOFF; }
  function wordFrames(a, words, times) {
    // times: 각 단어 시작 시각(초) 배열 (없으면 음절 수로 나눔)
    var n = words.length, res = [], i;
    if (times && times.length === n) {
      for (i = 0; i < n; i++) {
        var s = Math.max(a.start, t2f(times[i]));
        var e = i + 1 < n ? t2f(times[i + 1]) - 3 : a.end;
        e = Math.min(e, a.end);
        while (e > s && !a.speech[e]) e--;
        while (s < e && !a.speech[s]) s++;
        res.push([s, Math.max(s, e)]);
      }
      return res;
    }
    var syl = words.map(function (w) { return Math.max(1, w.syl || 1); }), tot = syl.reduce(function (x, y) { return x + y; }, 0);
    var span = a.end - a.start + 1, acc = 0;
    for (i = 0; i < n; i++) {
      var s2 = a.start + Math.round(span * acc / tot); acc += syl[i];
      var e2 = a.start + Math.round(span * acc / tot) - 1;
      res.push([s2, Math.max(s2, e2)]);
    }
    return res;
  }

  // ---------- 비교 ----------
  var FUNC = { a: 1, an: 1, the: 1, of: 1, to: 1, in: 1, on: 1, at: 1, for: 1, and: 1, but: 1, or: 1, as: 1, from: 1, with: 1, by: 1, is: 1, are: 1, was: 1, were: 1, am: 1, be: 1, been: 1, have: 1, has: 1, had: 1, do: 1, does: 1, did: 1, will: 1, would: 1, can: 1, could: 1, that: 1, i: 1, you: 1, he: 1, she: 1, it: 1, we: 1, they: 1, me: 1, him: 1, her: 1, us: 1, them: 1, my: 1, your: 1, his: 1, its: 1, our: 1, their: 1, so: 1, than: 1, there: 1 };
  function core(w) { return w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '').toLowerCase(); }
  function zs(arr) { var m = 0, i, n = arr.length; for (i = 0; i < n; i++) m += arr[i]; m /= n || 1; var v = 0; for (i = 0; i < n; i++) v += (arr[i] - m) * (arr[i] - m); var sd = Math.sqrt(v / (n || 1)) || 1; return arr.map(function (x) { return (x - m) / sd; }); }
  function slope(ts, vs) {
    var n = ts.length; if (n < 4) return 0;
    var mt = 0, mv = 0, i; for (i = 0; i < n; i++) { mt += ts[i]; mv += vs[i]; } mt /= n; mv /= n;
    var num = 0, den = 0; for (i = 0; i < n; i++) { num += (ts[i] - mt) * (vs[i] - mv); den += (ts[i] - mt) * (ts[i] - mt); }
    return den ? num / den : 0;
  }
  function corr(x, y) {
    var n = x.length; if (n < 8) return 0;
    var mx = 0, my = 0, i; for (i = 0; i < n; i++) { mx += x[i]; my += y[i]; } mx /= n; my /= n;
    var sxy = 0, sxx = 0, syy = 0; for (i = 0; i < n; i++) { var a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  }

  function compare(ref, usr, words, times) {
    words = words.map(function (w) { return w.syl ? w : Object.assign({}, w, { syl: root.Hwp ? root.Hwp.syllables(w) : 1 }); });
    var path = dtw(ref.cep, usr.cep, ref.start, ref.end, usr.start, usr.end);
    var nr = ref.n, uMin = new Int32Array(nr).fill(-1), uMax = new Int32Array(nr).fill(-1), i, k;
    path.forEach(function (p) { var r = p[0], u = p[1]; if (uMin[r] < 0 || u < uMin[r]) uMin[r] = u; if (u > uMax[r]) uMax[r] = u; });
    for (i = 0; i < nr; i++) { if (uMin[i] < 0) { uMin[i] = i < ref.start ? usr.start : usr.end; uMax[i] = uMin[i]; } }
    // 사용자 곡선을 원어민 시간축으로
    var warped = new Float32Array(nr).fill(NaN);
    for (i = ref.start; i <= ref.end; i++) {
      var vals = []; for (k = uMin[i]; k <= uMax[i]; k++) if (usr.voiced[k]) vals.push(usr.st[k]);
      if (vals.length) warped[i] = median(vals);
    }
    // 1) 억양 모양
    var xs = [], ys = [];
    for (i = ref.start; i <= ref.end; i++) if (ref.voiced[i] && !isNaN(warped[i])) { xs.push(ref.st[i]); ys.push(warped[i]); }
    var r = corr(xs, ys), coverage = xs.length / Math.max(1, ref.voicedCount);
    var se = 0; for (i = 0; i < xs.length; i++) se += (xs[i] - ys[i]) * (xs[i] - ys[i]);
    var rmse = xs.length ? Math.sqrt(se / xs.length) : 9;
    var shape = (0.5 * Math.max(0, Math.min(1, (r - 0.15) / 0.6)) + 0.5 * Math.max(0, Math.min(1, 1 - (rmse - 0.8) / 3.5))) * Math.min(1, coverage / 0.5);

    // 단어별
    var wf = wordFrames(ref, words, times);
    var W = words.map(function (w, wi) {
      var rs = wf[wi][0], re2 = wf[wi][1];
      var us = uMin[rs], ue = uMax[re2];
      function stats(a, s, e) {
        var pk = -99, ek = -200, vc = 0;
        for (var q = s; q <= e; q++) { if (a.voiced[q]) { vc++; if (a.st[q] > pk) pk = a.st[q]; } if (a.db[q] > ek) ek = a.db[q]; }
        return { pk: vc ? pk : NaN, ek: ek, dur: (e - s + 1) * HOP / SR };
      }
      return { w: w.w, ipa: w.ipa, s: w.s, p: w.p, syl: Math.max(1, w.syl || 1), rs: rs, re: re2, us: us, ue: ue, R: stats(ref, rs, re2), U: stats(usr, us, ue) };
    });
    function prom(side) {
      var pk = W.map(function (w) { return isNaN(w[side].pk) ? null : w[side].pk; });
      var fill = pk.filter(function (v) { return v !== null; }), mpk = fill.length ? median(fill) : 0;
      var zp = zs(pk.map(function (v) { return v === null ? mpk - 2 : v; }));
      var ze = zs(W.map(function (w) { return w[side].ek; }));
      var zd = zs(W.map(function (w) { return w[side].dur / w.syl; }));
      return W.map(function (w, q) { return 0.5 * zp[q] + 0.3 * ze[q] + 0.2 * zd[q]; });
    }
    var pr = prom('R'), pu = prom('U');
    var weak = [], strongFn = [], good = [], targets = 0;
    W.forEach(function (w, q) {
      w.pr = pr[q]; w.pu = pu[q];
      var c = core(w.w);
      if (w.s === 2 && pr[q] > 0.2) {
        targets++;
        if (pu[q] < pr[q] - 0.9 && pu[q] < 0.35) { weak.push(q); w.flag = 'weak'; }
        else { good.push(q); w.flag = 'good'; }
      } else if (w.s === 0 && FUNC[c] && pr[q] < 0 && pu[q] > 0.9) { strongFn.push(q); w.flag = 'strong'; }
    });
    var stress = targets ? (targets - weak.length) / targets : 1;
    stress = Math.max(0, stress - 0.1 * strongFn.length);

    // 2) 끊어 읽기
    function silRun(a, s, e) {
      var best = 0, run = 0; for (var q = Math.max(0, s); q <= Math.min(a.n - 1, e); q++) { if (!a.speech[q]) { run++; if (run > best) best = run; } else run = 0; }
      return best * HOP / SR;
    }
    var missPause = [], extraPause = [], pauseChecks = 0, pauseOk = 0;
    for (var q = 0; q + 1 < W.length; q++) {
      var rp = silRun(ref, W[q].re - 2, W[q + 1].rs + 2);
      var up = silRun(usr, uMin[Math.max(ref.start, W[q].re - 3)], uMax[Math.min(ref.end, W[q + 1].rs + 3)]);
      W[q].rp = rp; W[q].up = up;
      var marked = W[q].p === 1 || rp >= 0.18;
      if (marked) { pauseChecks++; if (up >= 0.08) pauseOk++; else missPause.push(q); }
      else if (up >= 0.3 && rp < 0.08) { pauseChecks++; extraPause.push(q); }
    }
    var pause = pauseChecks ? Math.max(0, (pauseOk - 0.5 * extraPause.length) / Math.max(1, pauseOk + missPause.length)) : 1;
    if (!pauseChecks) pause = 1;

    // 3) 문장 끝 억양
    function endSlope(a, s, e) {
      // 마지막 단어의 끝부분 유성음 최대 22프레임(약 0.2초)
      var ts = [], vs = [], q2; for (q2 = s; q2 <= e; q2++) if (a.voiced[q2]) { ts.push(q2 * HOP / SR); vs.push(a.st[q2]); }
      if (ts.length < 6) return 0;
      var cut = Math.max(0, ts.length - 22);
      return slope(ts.slice(cut), vs.slice(cut));
    }
    var last = W.length - 1; while (last > 0 && isNaN(W[last].R.pk)) last--;
    var rEnd = endSlope(ref, W[last].rs, W[last].re), uEnd = endSlope(usr, W[last].us, Math.max(W[last].ue, usr.end));
    var rDir = rEnd < -3 ? -1 : (rEnd > 3 ? 1 : 0), uDir = uEnd < -3 ? -1 : (uEnd > 3 ? 1 : 0);
    var endOk = rDir === uDir || rDir === 0;
    var endSoft = !endOk && rDir === -1 && uDir === 0;
    var endScore = endOk ? 1 : (endSoft ? 0.6 : 0.2);

    // 4) 억양 폭
    var ratio = ref.range ? usr.range / ref.range : 1;
    var rangeScore = ratio < 1 ? Math.max(0, Math.min(1, ratio / 0.75)) : (ratio > 1.8 ? 0.8 : 1);

    // 5) 속도
    var spdRatio = ((usr.end - usr.start + 1) / Math.max(1, ref.end - ref.start + 1));

    var score = Math.round(100 * (0.4 * shape + 0.2 * stress + 0.15 * pause + 0.1 * endScore + 0.15 * rangeScore));
    if (spdRatio > 1.5) score -= Math.min(10, Math.round((spdRatio - 1.5) * 12));
    if (spdRatio < 0.65) score -= 5;
    if (usr.voicedCount < 15) score = Math.min(score, 10);

    // 코멘트
    var tips = [], goods = [];
    function nm(q3) { return '‘' + core(W[q3].w) + '’'; }
    function syllOf(q3) {
      var sp = (root.Hwp && W[q3].ipa) ? root.Hwp.stressSpans(W[q3].ipa).filter(function (x) { return x.st === 2; })[0] : null;
      return sp ? ' (ˈ' + sp.t + ')' : '';
    }
    if (usr.voicedCount < 15) tips.push({ k: 'voice', t: '목소리가 잘 들리지 않았어요. 휴대폰을 입 가까이 두고 다시 말해 보세요.' });
    weak.slice(0, 2).forEach(function (q3) { tips.push({ k: 'stress', w: q3, t: nm(q3) + syllOf(q3) + '의 강세가 약해요. 그 음절을 더 높고, 크고, 길게 말해 보세요.' }); });
    if (strongFn.length) tips.push({ k: 'fn', w: strongFn[0], t: strongFn.slice(0, 3).map(nm).join(', ') + '처럼 작은 단어에 힘이 들어갔어요. 약하고 빠르게 지나가세요.' });
    missPause.slice(0, 2).forEach(function (q3) { tips.push({ k: 'pause', w: q3, t: nm(q3) + ' 뒤에서 잠깐 끊어 읽어 주세요.' }); });
    extraPause.slice(0, 1).forEach(function (q3) { tips.push({ k: 'link', w: q3, t: '끊지 말고 이어서 말해 보세요: ‘' + core(W[q3].w) + ' ' + core(W[q3 + 1].w) + '’' }); });
    if (!endOk) tips.push({ k: 'end', t: endSoft ? '문장 끝을 조금 더 확실하게 내려 주세요.' : (rDir === -1 ? '문장 끝을 올리지 말고 내려 주세요.' : '문장 끝을 살짝 올려 주세요.') });
    if (ratio < 0.6 && usr.voicedCount >= 15) tips.push({ k: 'range', t: '억양이 평평해요. 강세 단어에서 더 높이 올렸다가 내려 보세요.' });
    else if (ratio > 1.9) tips.push({ k: 'range', t: '억양 폭이 너무 커요. 조금 더 자연스럽게 말해 보세요.' });
    if (spdRatio > 1.6) tips.push({ k: 'speed', t: '원어민보다 ' + spdRatio.toFixed(1) + '배 느려요. 단어를 이어서 조금 더 빠르게 말해 보세요.' });
    else if (spdRatio < 0.65) tips.push({ k: 'speed', t: '너무 빨라요. 강세 단어를 충분히 늘여 말해 보세요.' });
    if (targets && !weak.length) goods.push('강세 위치가 잘 맞아요');
    if (pauseChecks && !missPause.length && !extraPause.length) goods.push('끊어 읽기가 정확해요');
    if (endOk && rDir !== 0) goods.push('문장 끝 억양이 맞아요');
    if (shape > 0.75) goods.push('억양 흐름이 원어민과 비슷해요');

    return {
      score: Math.max(0, Math.min(100, score)),
      parts: { shape: shape, r: r, rmse: rmse, stress: stress, pause: pause, end: endScore, range: rangeScore, ratio: ratio, speed: spdRatio, coverage: coverage },
      words: W.map(function (w) { return { w: w.w, s: w.s, p: w.p, flag: w.flag || '', rs: w.rs, re: w.re, us: w.us, ue: w.ue, pr: +w.pr.toFixed(2), pu: +w.pu.toFixed(2), rp: w.rp, up: w.up }; }),
      warped: warped, path: path, tips: tips.slice(0, 4), goods: goods,
      missPause: missPause, extraPause: extraPause, weak: weak, strongFn: strongFn, endDir: [rDir, uDir]
    };
  }

  // 기준 음성(단어 시간 있음)의 단어 시작 시각을 다른 음성으로 옮기기 (DTW)
  function mapTimes(src, times, dst) {
    var path = dtw(src.cep, dst.cep, src.start, src.end, dst.start, dst.end);
    var mn = new Int32Array(src.n).fill(-1), i;
    path.forEach(function (p) { if (mn[p[0]] < 0 || p[1] < mn[p[0]]) mn[p[0]] = p[1]; });
    var last = dst.start;
    for (i = 0; i < src.n; i++) { if (mn[i] < 0) mn[i] = i < src.start ? dst.start : (i > src.end ? dst.end : last); else last = mn[i]; }
    var out = times.map(function (t) { var f = Math.min(src.n - 1, Math.max(src.start, t2f(t))); return Math.round(f2t(mn[f]) * 1000) / 1000; });
    for (i = 1; i < out.length; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
    return out;
  }

  // WAV 만들기 (내 목소리 다시 듣기)
  function wavBlobBytes(x, sr) {
    var n = x.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), i;
    function ws(o, s) { for (var q = 0; q < s.length; q++) v.setUint8(o + q, s.charCodeAt(q)); }
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * 2, true);
    for (i = 0; i < n; i++) { var s = Math.max(-1, Math.min(1, x[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); }
    return buf;
  }

  var api = { SR: SR, HOP: HOP, t2f: t2f, f2t: f2t, Stream: Stream, mapTimes: mapTimes, resample: resample, analyze: analyze, Tracker: Tracker, liveSemitones: liveSemitones, compare: compare, wordFrames: wordFrames, wav: wavBlobBytes };
  root.Pitch = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
