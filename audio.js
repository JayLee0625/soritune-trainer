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
  function resample(x, srIn, srOut) {
    srOut = srOut || SR;
    if (srIn === srOut) return Float32Array.from(x);
    var y = x, cut = srOut === SR ? 7000 : Math.round(srOut * 0.44);
    if (srIn > srOut) { y = biquadLP(biquadLP(x, srIn, cut), srIn, cut); }
    var ratio = srIn / srOut, n = Math.floor(y.length / ratio), out = new Float32Array(n);
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

  // ---------- 긴 녹음에서 문장 위치 찾기 ----------
  // 소리 특징만 빠르게 계산 (억양은 계산하지 않음): 10ms마다 MFCC와 소리 크기
  // 배경음악 줄이기: 밴드마다 앞뒤 0.75초 동안의 중앙값(오래 이어지는 소리 = 음악·잡음)을 빼고 남은 소리로 계산
  function features(x16, onProg, opts) {
    opts = opts || {};
    var n = Math.max(0, Math.floor((x16.length - NEED) / HOP) + 1), M = new Array(n), cep = new Array(n), db = new Float32Array(n), i = 0, m;
    var clean = opts.clean !== false, W = 75, D = 4;
    return new Promise(function (res) {
      (function step() {
        var t0 = Date.now();
        for (; i < n && Date.now() - t0 < 40; i++) {
          powerSpec(x16, i * HOP, spec);
          var e = new Float32Array(NMEL);
          for (m = 0; m < NMEL; m++) { var sm = 0, row = melFb[m]; for (var k = 0; k <= HALF; k++) sm += row[k] * spec[k]; e[m] = sm; }
          M[i] = e;
        }
        if (onProg) onProg(0.6 * i / Math.max(1, n));
        if (i < n) return setTimeout(step, 0);
        var B = null;
        if (clean && n > 2 * W) {
          // 4프레임마다 중앙값을 구하고 사이는 이어 붙임
          var G = Math.ceil(n / D) + 1, grid = new Array(G), g = 0, buf = [];
          (function med() {
            var t1 = Date.now();
            for (; g < G && Date.now() - t1 < 40; g++) {
              var c = Math.min(n - 1, g * D), a = Math.max(0, c - W), b = Math.min(n - 1, c + W), out = new Float32Array(NMEL);
              for (m = 0; m < NMEL; m++) { buf.length = 0; for (var j = a; j <= b; j += 3) buf.push(M[j][m]); buf.sort(function (x, y) { return x - y; }); out[m] = buf[buf.length >> 1]; }
              grid[g] = out;
            }
            if (onProg) onProg(0.6 + 0.3 * g / G);
            if (g < G) return setTimeout(med, 0);
            B = grid; finish();
          })();
        } else finish();
        function finish() {
          for (var q = 0; q < n; q++) {
            var e = M[q], lm = new Float32Array(NMEL), tot = 0;
            var gi = Math.floor(q / D), fr = (q - gi * D) / D, b0 = B && B[gi], b1 = B && (B[gi + 1] || b0);
            for (m = 0; m < NMEL; m++) {
              var v = e[m];
              if (b0) { var bg = b0[m] * (1 - fr) + b1[m] * fr; v = Math.max(v - bg, 0.02 * v); }
              tot += v; lm[m] = Math.log(v + 1e-8);
            }
            var o = new Float32Array(NCEP);
            for (var c2 = 1; c2 <= NCEP; c2++) { var s2 = 0; for (m = 0; m < NMEL; m++) s2 += lm[m] * Math.cos(Math.PI * c2 * (m + 0.5) / NMEL); o[c2 - 1] = s2; }
            cep[q] = o; db[q] = 10 * Math.log10(tot / (HALF + 1) + 1e-10);
          }
          if (onProg) onProg(1);
          res({ cep: cep, db: db, n: n, clean: !!B });
        }
      })();
    });
  }
  function normCep(X, s, e) {
    var mean = new Float32Array(NCEP), sd = new Float32Array(NCEP), out = new Array(e - s + 1), k, c, n = e - s + 1;
    for (k = s; k <= e; k++) for (c = 0; c < NCEP; c++) mean[c] += X[k][c];
    for (c = 0; c < NCEP; c++) mean[c] /= n;
    for (k = s; k <= e; k++) for (c = 0; c < NCEP; c++) { var d = X[k][c] - mean[c]; sd[c] += d * d; }
    for (c = 0; c < NCEP; c++) sd[c] = Math.sqrt(sd[c] / n) + 1e-6;
    for (k = s; k <= e; k++) { var v = new Float32Array(NCEP); for (c = 0; c < NCEP; c++) v[c] = (X[k][c] - mean[c]) / sd[c]; out[k - s] = v; }
    return out;
  }
  // 기준 문장 Q 가 긴 녹음 R(r0~r1 프레임) 안 어디에 있는지 (시작·끝을 자유롭게 두는 DTW)
  function findSegment(Q, R, r0, r1, from, jump, dims, SP) {
    var N = Q.length, INF = 1e18, pen = 0.15, i, j, c, D = dims || NCEP;
    var pD = new Float64Array(N).fill(INF), pS = new Int32Array(N), cD = new Float64Array(N), cS = new Int32Array(N);
    var best = { score: INF, cost: INF, s: r0, e: Math.min(r1, r0 + N) }, minL = Math.round(0.45 * N), maxL = Math.round(3.2 * N);
    for (j = r0; j <= r1; j++) {
      var y = R[j];
      for (i = 0; i < N; i++) {
        var x = Q[i], d = 0; for (c = 0; c < D; c++) { var t = x[c] - y[c]; d += t * t; } d = Math.sqrt(d * NCEP / D);
        var b, st;
        if (i === 0) { b = 0; st = j; }
        else {
          b = pD[i - 1]; st = pS[i - 1];
          if (cD[i - 1] + pen < b) { b = cD[i - 1] + pen; st = cS[i - 1]; }
          if (pD[i] + pen < b) { b = pD[i] + pen; st = pS[i]; }
        }
        cD[i] = b + d; cS[i] = st;
      }
      var L = j - cS[N - 1] + 1;
      // 대부분 조용한 구간(쉼·잡음)은 문장으로 보지 않음
      if (L >= minL && L <= maxL && (!SP || (SP[j + 1] - SP[cS[N - 1]]) >= 0.5 * L)) { var raw = cD[N - 1] / (N + L), nc = raw + (jump || 0) * Math.max(0, cS[N - 1] - (from || r0)) / 100; if (nc < best.score) best = { score: nc, cost: raw, s: cS[N - 1], e: j }; }
      var tD = pD; pD = cD; cD = tD; var tS = pS; pS = cS; cS = tS;
    }
    return best;
  }
  // 음절 수 세기: 말소리 크기가 솟는 곳(모음)을 센다. 말 빠르기·쉼에 덜 흔들림
  function nucleiPrefix(F, thr) {
    var n = F.n, sm = new Float32Array(n), i, j, NC = new Int32Array(n + 1);
    for (i = 0; i < n; i++) { var a = 0, c = 0; for (j = i - 3; j <= i + 3; j++) if (j >= 0 && j < n) { a += F.db[j]; c++; } sm[i] = a / c; }
    for (i = 0; i < n; i++) {
      var pk = 0;
      if (i >= 5 && i < n - 5 && sm[i] > thr + 3) {
        pk = 1;
        for (j = i - 8; j <= i + 8; j++) if (j !== i && j >= 0 && j < n && sm[j] > sm[i]) { pk = 0; break; }
        if (pk) { var l = sm[i], r = sm[i]; for (j = i; j >= Math.max(0, i - 25); j--) l = Math.min(l, sm[j]); for (j = i; j <= Math.min(n - 1, i + 25); j++) r = Math.min(r, sm[j]); if (sm[i] - Math.max(l, r) < 2.5) pk = 0; }
      }
      NC[i + 1] = NC[i] + pk;
    }
    return NC;
  }
  // 구간 안에서 말소리 시작·끝: 남은 음악보다 확실히 큰 소리(기준+6dB)가 이어지는 곳을 찾고, 앞뒤 약한 소리만 조금 붙임
  function trimSpeech(F, thr, b0, b1) {
    var hi = thr + 6, s0 = -1, e0 = -1, run = 0, f, lim;
    for (f = b0; f <= b1; f++) { run = F.db[f] > hi ? run + 1 : 0; if (run >= 6) { s0 = f - 5; break; } }
    if (s0 < 0) { s0 = b0; while (s0 < b1 && F.db[s0] <= thr) s0++; e0 = b1; while (e0 > s0 && F.db[e0] <= thr) e0--; return [s0, e0]; }
    run = 0; for (f = b1; f >= s0; f--) { run = F.db[f] > hi ? run + 1 : 0; if (run >= 6) { e0 = f + 5; break; } }
    lim = Math.max(b0, s0 - 10); while (s0 > lim && F.db[s0 - 1] > thr) s0--;
    lim = Math.min(b1, e0 + 15); while (e0 < lim && F.db[e0 + 1] > thr) e0++;
    return [s0, e0];
  }
  function dbThr(F) { var d = Array.prototype.slice.call(F.db); return Math.max(pct(d, 0.1) + 12, pct(d, 0.98) - 38, -58); }
  // 기준(AI) 음성 한 문장의 말소리 길이·음절 수
  function refStats(F, start, end) {
    var thr = dbThr(F), NC = nucleiPrefix(F, thr), sp = 0;
    for (var f = Math.max(0, start); f <= Math.min(F.n - 1, end); f++) if (F.db[f] > thr) sp++;
    return { sp: sp, syl: NC[Math.min(F.n, end + 1)] - NC[Math.max(0, start)] };
  }

  // 문장 길이 + 쉼으로 나누기 (녹음이 자료 문장만 차례로 읽은 경우에 잘 맞음)
  // refs[i].sp: 기준 음성의 말소리 프레임 수. 쉼 후보 중에서, 문장 길이 비율이 맞고 쉼이 긴 곳을 경계로 고름
  var TUNE = { wd: 0.5, sy: 0.22 };
  function splitByPauses(refs, F, thr, S, E) {
    var n = refs.length, f, SP = new Int32Array(F.n + 1);
    for (f = 0; f < F.n; f++) SP[f + 1] = SP[f] + (F.db[f] > thr ? 1 : 0);
    var a = refs.map(function (r) { return Math.max(5, r.sp || (r.end - r.start + 1)); }), aSum = a.reduce(function (x, y) { return x + y; }, 0);
    var hum = SP[E + 1] - SP[S], k = hum / aSum;
    var NC = nucleiPrefix(F, thr), useSyl = refs.every(function (r) { return r.syl > 0; });
    var y = refs.map(function (r) { return r.syl || 1; }), ySum = y.reduce(function (x, v) { return x + v; }, 0), ky = (NC[E + 1] - NC[S]) / ySum;
    // 쉼 후보 (0.08초 이상 조용한 곳의 가운데)
    var cand = [], str = [], run = 0;
    for (f = S; f <= E + 1; f++) {
      if (f <= E && F.db[f] <= thr) run++;
      else { if (run >= 8) { cand.push(f - Math.ceil(run / 2)); str.push(Math.min(run, 80) / 100); } run = 0; }
    }
    // 쉼이 너무 적으면 소리가 작아지는 곳도 약한 후보로
    if (cand.length < n * 2) {
      for (f = S + 15; f < E - 15; f += 5) {
        var lo = true; for (var g = f - 15; g <= f + 15; g += 3) if (F.db[g] < F.db[f]) { lo = false; break; }
        if (lo) { cand.push(f); str.push(0); }
      }
      var ord = cand.map(function (c, i) { return i; }).sort(function (x, y) { return cand[x] - cand[y]; });
      cand = ord.map(function (i) { return cand[i]; }); str = ord.map(function (i) { return str[i]; });
    }
    var C = cand.length, P = [S].concat(cand, [E + 1]), ST = [0].concat(str, [0]), NP = P.length, SIG = 0.25, BETA = 2, WD = TUNE.wd, SY = TUNE.sy;
    if (C < n - 1) return null;
    // 음절 수 비율(주)과 말소리 길이 비율(보조)이 기준 음성과 비슷할수록 좋음
    function cost(i, p0, p1) {
      var h = SP[P[p1]] - SP[P[p0]]; if (h < 3) return 1e9;
      var r = Math.log((h + 20) / (k * a[i] + 20)), c = r * r / (SIG * SIG);
      if (useSyl) { var hy = NC[P[p1]] - NC[P[p0]], ry = Math.log((hy + 1.5) / (ky * y[i] + 1.5)); c = WD * c + ry * ry / (SY * SY); }
      return c;
    }
    var INF = 1e18, dp = [], bk = [], i, p, q;
    for (i = 0; i < n; i++) { dp.push(new Float64Array(NP).fill(INF)); bk.push(new Int32Array(NP).fill(-1)); }
    for (p = 1; p < NP; p++) { dp[0][p] = cost(0, 0, p) - (p < NP - 1 ? BETA * ST[p] : 0); bk[0][p] = 0; }
    for (i = 1; i < n; i++) for (p = i + 1; p < NP; p++) {
      if (i === n - 1 && p !== NP - 1) continue;
      var best = INF, bq = -1;
      for (q = i; q < p; q++) { if (dp[i - 1][q] >= INF) continue; var v = dp[i - 1][q] + cost(i, q, p); if (v < best) { best = v; bq = q; } }
      dp[i][p] = best - (p < NP - 1 ? BETA * ST[p] : 0); bk[i][p] = bq;
    }
    if (n === 1) { dp[0][NP - 1] = cost(0, 0, NP - 1); bk[0][NP - 1] = 0; }
    var bounds = new Array(n + 1); bounds[n] = NP - 1;
    for (i = n - 1; i >= 0; i--) { bounds[i] = bk[i][bounds[i + 1]]; if (bounds[i] < 0) return null; }
    var out = [];
    for (i = 0; i < n; i++) {
      var b0 = P[bounds[i]], b1 = P[bounds[i + 1]] - 1, se = trimSpeech(F, thr, b0, b1), s0 = se[0], e0 = se[1];
      var h = SP[b1 + 1] - SP[b0], dev = Math.abs(Math.log(h / (k * a[i])));
      if (useSyl) dev = Math.max(dev * 0.7, Math.abs(Math.log((NC[b1 + 1] - NC[b0] + 1.5) / (ky * y[i] + 1.5))));
      out.push({ s: s0, e: e0, L: b0, R: b1, cost: dev, check: dev > 0.35 || (i > 0 && ST[bounds[i]] === 0) });
    }
    return out;
  }

  // refs: 문장별 기준 음성 분석 [{cep, start, end}], F: 긴 녹음 features() 결과
  // → 문장별 [{t0, t1, cost, check}] (초, 앞뒤 여유 포함)
  function splitLong(refs, F, onProg, opts) {
    opts = opts || {};
    var JUMP = opts.jump == null ? 0.04 : opts.jump, DIMS = opts.dims || 8; // 앞쪽 MFCC 8개만 (목소리 높낮이 차이에 덜 흔들림), 멀리 건너뛸수록 불리하게
    var R = normCep(F.cep, 0, F.n - 1), dbs = Array.prototype.slice.call(F.db);
    var thr = Math.max(pct(dbs, 0.1) + 12, pct(dbs, 0.98) - 38, -58), out = [], k = 0, from = 0;
    var tempo = [];
    var SP = new Int32Array(F.n + 1); for (var z = 0; z < F.n; z++) SP[z + 1] = SP[z] + (F.db[z] > thr ? 1 : 0);
    return new Promise(function (res) {
        // 녹음 전체가 자료 문장 길이와 비슷하면 '길이 + 쉼' 방식으로 (배경음악·빠른 말에도 잘 맞음)
        var S = 0, E = F.n - 1, run2 = 0, z2;
        for (z2 = 0; z2 < F.n; z2++) { run2 = F.db[z2] > thr ? run2 + 1 : 0; if (run2 >= 5) { S = z2 - 4; break; } }
        run2 = 0; for (z2 = F.n - 1; z2 >= 0; z2--) { run2 = F.db[z2] > thr ? run2 + 1 : 0; if (run2 >= 5) { E = z2 + 4; break; } }
        var aSum2 = refs.reduce(function (x, r) { return x + Math.max(5, r.sp || (r.end - r.start + 1)); }, 0), ratio = (SP[E + 1] - SP[S]) / aSum2;
        if (opts.mode !== 'dtw' && ratio > 0.5 && ratio < 2.2) {
          var dpo = splitByPauses(refs, F, thr, S, E);
          if (dpo) {
            return res(dpo.map(function (o, i) {
              var f0 = i === 0 ? Math.max(0, o.s - 15) : Math.max(o.L, o.s - 15), f1 = i === dpo.length - 1 ? Math.min(F.n - 1, o.e + 20) : Math.min(o.R, o.e + 20);
              return { t0: Math.max(0, f0 * HOP / SR), t1: f1 * HOP / SR + WIN / SR, cost: o.cost, check: o.check, how: 'pause' };
            }));
          }
        }
      (function step() {
        if (k >= refs.length) return finishUp();
        var r = refs[k], Q = normCep(r.cep, r.start, r.end), N = Q.length;
        var r0 = Math.max(0, from), r1 = k === 0 ? F.n - 1 : Math.min(F.n - 1, from + Math.max(4 * N, 6000));
        var m = findSegment(Q, R, r0, r1, from, k === 0 ? 0 : JUMP, DIMS, SP);
        out.push({ s: m.s, e: m.e, cost: m.cost });
        // 잘 맞은 문장만 다음 찾기의 출발점으로 (잘 안 맞은 문장 하나 때문에 뒤가 다 밀리지 않게)
        var good = out.filter(function (o) { return o.ok; }).map(function (o) { return o.cost; });
        var ref = good.length >= 3 ? median(good) : m.cost;
        m.ok = k === 0 || m.cost <= ref * 1.3 + 0.1; out[k].ok = m.ok;
        if (m.ok) { from = Math.max(r0, m.e - 10); tempo.push((m.e - m.s + 1) / N); }
        else { var tp = tempo.length ? median(tempo) : 1.1; from = Math.max(r0, from + Math.round(0.5 * N * tp)); }
        k++; if (onProg) onProg(k / refs.length);
        setTimeout(step, 0);
      })();
      function finishUp() {
        var costs = out.map(function (o) { return o.cost; }), med = median(costs), n = out.length, q, f;
        function sp(fr) { return F.db[fr] > thr; }
        // 이웃한 두 문장 사이에서 가장 긴 쉼을 경계로 (그 사이 말소리는 가까운 문장에 붙임, 최대 1.5초)
        var bound = [];
        for (q = 0; q + 1 < n; q++) {
          var a = Math.min(out[q].e, out[q + 1].s), b = Math.max(out[q].e, out[q + 1].s);
          var lo = Math.max(0, a - 20), hi = Math.min(F.n - 1, b + 20), bestLen = 0, bestMid = Math.round((out[q].e + out[q + 1].s) / 2), run = 0;
          for (f = lo; f <= hi + 1; f++) {
            if (f <= hi && !sp(f)) run++;
            else { if (run > bestLen) { bestLen = run; bestMid = f - Math.ceil(run / 2); } run = 0; }
          }
          bound.push(bestMid);
        }
        out.forEach(function (o, k2) {
          var L = k2 > 0 ? bound[k2 - 1] : Math.max(0, o.s - 150), Rb = k2 < n - 1 ? bound[k2] : Math.min(F.n - 1, o.e + 100);
          var s0 = Math.max(L, Math.min(o.s, o.s - 150 > L ? o.s : L)), e0 = Math.min(Rb, o.e);
          // 경계 안쪽에서 말소리가 시작·끝나는 곳
          // 이어지는 말소리는 이 문장에 붙임 (최대 3초, 0.35초 넘게 조용하면 멈춤, 이웃 문장과의 경계는 넘지 않음)
          var st = o.s, en = o.e, gap = 0;
          for (f = o.s - 1; f >= Math.max(L, o.s - 300); f--) { if (sp(f)) { st = f; gap = 0; } else if (++gap >= 35) break; }
          gap = 0;
          for (f = o.e + 1; f <= Math.min(Rb, o.e + 300); f++) { if (sp(f)) { en = f; gap = 0; } else if (++gap >= 35) break; }
          o.f0 = Math.max(L, st - 15); o.f1 = Math.min(Rb, en + 20);
          if (o.f1 <= o.f0) { o.f0 = s0; o.f1 = Math.max(e0, s0 + 10); }
          o.check = o.cost > med * 1.25 + 0.1;
        });
        res(out.map(function (o) { return { t0: Math.max(0, o.f0 * HOP / SR), t1: o.f1 * HOP / SR + WIN / SR, cost: o.cost, check: o.check }; }));
      }
    });
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

  var api = { SR: SR, HOP: HOP, t2f: t2f, f2t: f2t, Stream: Stream, mapTimes: mapTimes, resample: resample, analyze: analyze, Tracker: Tracker, liveSemitones: liveSemitones, compare: compare, wordFrames: wordFrames, wav: wavBlobBytes, features: features, splitLong: splitLong, refStats: refStats, dbThr: dbThr, trimSpeech: trimSpeech, TUNE: TUNE };
  root.Pitch = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
