/* 자료 읽기: HWP(5.x) / 텍스트 → 문장·발음기호 짝 + 단어별 강세·끊어읽기
   브라우저와 Node 둘 다에서 동작 (DecompressionStream 'deflate-raw' 사용) */
(function (root) {
  'use strict';

  // ---------- HWP (OLE/CFB) ----------
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
  var END = 0xFFFFFFFA;

  function cfbStreams(buf) {
    var b = new Uint8Array(buf);
    var sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    for (var i = 0; i < 8; i++) if (b[i] !== sig[i]) throw new Error('한글(HWP) 파일 형식이 아니에요.');
    var ssz = 1 << u16(b, 30), mssz = 1 << u16(b, 32);
    var nFat = u32(b, 44), dirStart = u32(b, 48), miniCut = u32(b, 56);
    var miniFatStart = u32(b, 60), difatStart = u32(b, 68), nDifat = u32(b, 72);
    var difat = [];
    for (i = 0; i < 109; i++) difat.push(u32(b, 76 + i * 4));
    var s = difatStart;
    for (var k = 0; k < nDifat && s < END; k++) {
      var off = 512 + s * ssz, per = ssz / 4;
      for (i = 0; i < per - 1; i++) difat.push(u32(b, off + i * 4));
      s = u32(b, off + (per - 1) * 4);
    }
    var fat = [];
    for (i = 0; i < nFat; i++) {
      var o2 = 512 + difat[i] * ssz;
      for (var j = 0; j < ssz / 4; j++) fat.push(u32(b, o2 + j * 4));
    }
    function readChain(start) {
      var parts = [], cur = start, guard = 0;
      while (cur < END && guard++ < 200000) { parts.push(b.subarray(512 + cur * ssz, 512 + (cur + 1) * ssz)); cur = fat[cur]; }
      return concat(parts);
    }
    var dir = readChain(dirStart), ents = [];
    for (i = 0; i + 128 <= dir.length; i += 128) {
      var nlen = u16(dir, i + 64), name = '';
      for (j = 0; j < nlen - 2; j += 2) name += String.fromCharCode(u16(dir, i + j));
      ents.push({ name: name, type: dir[i + 66], left: u32(dir, i + 68), right: u32(dir, i + 72), child: u32(dir, i + 76), start: u32(dir, i + 116), size: u32(dir, i + 120) });
    }
    var rootE = ents[0];
    var mini = rootE.start < END ? readChain(rootE.start) : new Uint8Array(0);
    var miniFat = [];
    if (miniFatStart < END) { var mf = readChain(miniFatStart); for (i = 0; i + 4 <= mf.length; i += 4) miniFat.push(u32(mf, i)); }
    function readMini(start, size) {
      var parts = [], cur = start, got = 0, guard = 0;
      while (cur < END && got < size && guard++ < 200000) { parts.push(mini.subarray(cur * mssz, (cur + 1) * mssz)); got += mssz; cur = miniFat[cur]; }
      return concat(parts).subarray(0, size);
    }
    var out = {};
    function walk(idx, prefix) {
      if (idx === 0xFFFFFFFF || idx >= ents.length) return;
      var e = ents[idx];
      walk(e.left, prefix); walk(e.right, prefix);
      var p = prefix ? prefix + '/' + e.name : e.name;
      if (e.type === 2) out[p] = e.size < miniCut ? readMini(e.start, e.size) : readChain(e.start).subarray(0, e.size);
      else if (e.type === 1) walk(e.child, p);
    }
    walk(rootE.child, '');
    return out;
  }
  function concat(parts) {
    var n = 0, i; for (i = 0; i < parts.length; i++) n += parts[i].length;
    var r = new Uint8Array(n), o = 0;
    for (i = 0; i < parts.length; i++) { r.set(parts[i], o); o += parts[i].length; }
    return r;
  }
  function inflateRaw(u8) {
    // 압축 끝 뒤에 남는 바이트가 있으면 브라우저가 오류를 내므로, 받은 데까지는 그대로 사용
    var ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(), r = ds.readable.getReader(), out = [];
    w.write(u8).catch(function () { }); w.close().catch(function () { });
    function pump() {
      return r.read().then(function (x) { if (x.done) return concat(out); out.push(x.value); return pump(); })
        .catch(function (e) { if (out.length) return concat(out); throw e; });
    }
    return pump();
  }
  function paraTexts(b) {
    var out = [], i = 0;
    while (i + 4 <= b.length) {
      var h = u32(b, i); i += 4;
      var tag = h & 0x3FF, size = (h >>> 20) & 0xFFF;
      if (size === 0xFFF) { size = u32(b, i); i += 4; }
      if (tag === 67) out.push(decodeParaText(b.subarray(i, i + size)));
      i += size;
    }
    return out;
  }
  function decodeParaText(p) {
    var s = '', n = p.length >> 1, i = 0;
    while (i < n) {
      var c = u16(p, i * 2);
      if (c < 32) {
        if (c === 9) { s += ' '; i += 8; }
        else if (c === 10 || c === 13 || c === 0) { i += 1; }
        else if (c === 24 || c === 25 || c === 26 || c === 27 || c === 28 || c === 29 || c === 30 || c === 31) { i += 1; }
        else { i += 8; }
      } else { s += String.fromCharCode(c); i += 1; }
    }
    return s;
  }
  function readHwp(buf) {
    var st = cfbStreams(buf);
    var fh = st.FileHeader;
    var compressed = fh && fh.length >= 40 ? (u32(fh, 36) & 1) === 1 : true;
    var keys = Object.keys(st).filter(function (k) { return /^BodyText\/Section\d+$/.test(k); }).sort(function (a, b) {
      return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10);
    });
    if (!keys.length) {
      if (st.PrvText) return Promise.resolve(utf16(st.PrvText).split(/\r?\n/));
      throw new Error('본문을 찾지 못했어요.');
    }
    return keys.reduce(function (pr, k) {
      return pr.then(function (acc) {
        var raw = st[k];
        return (compressed ? inflateRaw(raw) : Promise.resolve(raw)).then(function (d) { return acc.concat(paraTexts(d)); });
      });
    }, Promise.resolve([]));
  }
  function utf16(u8) { var s = ''; for (var i = 0; i + 1 < u8.length; i += 2) s += String.fromCharCode(u16(u8, i)); return s; }

  // ---------- 줄 → 문장 짝 ----------
  var IPA_CH = /[ˈˌəɪʊæɑɒɔʃʒθðŋɝɚɛʌːɾɡ]/;
  var HANGUL = /[가-힣ㄱ-ㆎ]/;

  function classify(line) {
    var t = line.replace(/\s+/g, ' ').trim();
    if (!t) return { kind: 'blank' };
    var hasLatin = /[A-Za-z]/.test(t);
    var isIpa = (t.charAt(0) === '/' || t.charAt(t.length - 1) === '/') && (IPA_CH.test(t) || !/[A-Z]/.test(t));
    if (isIpa && !/[A-Z]{2,}/.test(t)) return { kind: 'ipa', text: t, partial: t.charAt(0) !== '/' };
    if (!hasLatin && HANGUL.test(t)) return { kind: 'memo', text: t };
    if (hasLatin) {
      // 줄 끝에 붙은 한글 메모 분리
      var m = line.match(/^(.*?[A-Za-z0-9.,!?'"’”)\]—–-])\s{2,}([가-힣ㄱ-ㆎ][^A-Za-z]*)$/);
      var en = line, memo = '';
      if (m) { en = m[1]; memo = m[2].trim(); }
      else {
        var m2 = line.match(/^(.*[A-Za-z].*?)\s+([가-힣ㄱ-ㆎ][가-힣ㄱ-ㆎ\s]*)$/);
        if (m2) { en = m2[1]; memo = m2[2].trim(); }
      }
      var gaps = [];
      var inner = en.trim();
      var re = /(\S+)\s{2,}(\S+)/g, mm;
      while ((mm = re.exec(inner))) { gaps.push(mm[2]); re.lastIndex = mm.index + mm[1].length; }
      return { kind: 'en', text: inner.replace(/\s+/g, ' '), memo: memo, gaps: gaps };
    }
    return { kind: 'other', text: t };
  }

  function pairLines(lines) {
    var items = [], pendingMemo = [], cur = null;
    function flush() { if (cur) { items.push(cur); cur = null; } }
    lines.forEach(function (raw) {
      var c = classify(raw);
      if (c.kind === 'blank' || c.kind === 'other') return;
      if (c.kind === 'memo') { pendingMemo.push(c.text); return; }
      if (c.kind === 'en') {
        if (cur && !cur.ipa && /[,;—–-]$|\b(the|a|an|of|and|to|in|for)$/i.test(cur.en)) {
          // 영어 문장이 다음 줄로 이어진 경우 (발음기호가 나오기 전)
          cur.en += ' ' + c.text; if (c.memo) cur.memo.push(c.memo); cur.gaps = cur.gaps.concat(c.gaps); return;
        }
        flush();
        cur = { en: c.text, ipa: '', ipaPartial: false, memo: pendingMemo.concat(c.memo ? [c.memo] : []), gaps: c.gaps };
        pendingMemo = [];
        return;
      }
      if (c.kind === 'ipa') {
        if (!cur) return;
        if (cur.ipa) { cur.ipa += ' ' + c.text; return; }
        cur.ipa = c.text; cur.ipaPartial = c.partial;
        flush();
      }
    });
    flush();
    return items.map(function (it, i) { return buildSentence(it, i); });
  }

  // ---------- 단어 ↔ 발음기호 정렬 ----------
  function cleanIpa(s) { return s.replace(/^\s*\/|\/\s*$/g, '').replace(/\//g, ' ').replace(/\s+/g, ' ').trim(); }

  function ipaTokens(ipa) {
    var t = cleanIpa(ipa).replace(/\|/g, ' | ').split(/\s+/).filter(Boolean);
    var out = [];
    t.forEach(function (w) { if (w === '|') { if (out.length) out[out.length - 1].pause = true; } else out.push({ ipa: w, pause: false }); });
    return out;
  }

  function enTokens(en) {
    var raw = en.split(/\s+/).filter(Boolean), out = [];
    raw.forEach(function (w) {
      var core = w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '');
      if (!core) { if (out.length) out[out.length - 1].text += ' ' + w; return; }
      out.push({ text: w, core: core });
    });
    return out;
  }

  function skelEn(word) {
    var w = word.toLowerCase().replace(/[^a-z0-9]/g, ''), s = '', i = 0;
    if (/^kn/.test(w)) w = w.slice(1);
    if (/^wr/.test(w)) w = w.slice(1);
    while (i < w.length) {
      var c = w[i], n = w[i + 1] || '', t3 = w.substr(i, 3), t2 = w.substr(i, 2);
      if (t3 === 'tch') { s += 'J'; i += 3; continue; }
      if (t2 === 'ph') { s += 'F'; i += 2; continue; }
      if (t2 === 'th') { s += 'H'; i += 2; continue; }
      if (t2 === 'sh' || t2 === 'ch') { s += 'J'; i += 2; continue; }
      if (t2 === 'ck') { s += 'K'; i += 2; continue; }
      if (t2 === 'wh') { s += 'W'; i += 2; continue; }
      if (t2 === 'gh') { i += 2; continue; }
      if (t2 === 'ng') { s += 'N'; i += 2; continue; }
      if (t2 === 'qu') { s += 'KW'; i += 2; continue; }
      if (c === 'x') { s += 'KS'; i++; continue; }
      if (c === 'c') { s += /[eiy]/.test(n) ? 'S' : 'K'; i++; continue; }
      if (c === 'g') { s += /[eiy]/.test(n) ? 'J' : 'K'; i++; continue; }
      if (c === 'y') { if (i === 0) s += 'Y'; i++; continue; }
      var map = { b: 'P', p: 'P', t: 'T', d: 'T', k: 'K', q: 'K', f: 'F', v: 'F', s: 'S', z: 'S', j: 'J', m: 'M', n: 'N', l: 'L', r: 'R', w: 'W' };
      if (map[c]) s += map[c];
      else if (/[0-9]/.test(c)) s += '#';
      i++;
    }
    return s.replace(/(.)\1+/g, '$1');
  }
  function skelIpa(ipa) {
    var w = ipa.replace(/[ˈˌː()]/g, ''), s = '', i = 0;
    while (i < w.length) {
      var c = w[i], n = w[i + 1] || '';
      if ((c === 't' && n === 'ʃ') || (c === 'd' && n === 'ʒ')) { s += 'J'; i += 2; continue; }
      var map = { p: 'P', b: 'P', t: 'T', d: 'T', 'ɾ': 'T', k: 'K', g: 'K', 'ɡ': 'K', f: 'F', v: 'F', 'θ': 'H', 'ð': 'H', s: 'S', z: 'S', 'ʃ': 'J', 'ʒ': 'J', m: 'M', n: 'N', 'ŋ': 'N', l: 'L', r: 'R', 'ɹ': 'R', 'ɝ': 'R', 'ɚ': 'R', w: 'W', j: 'Y' };
      if (map[c]) s += map[c];
      i++;
    }
    return s.replace(/(.)\1+/g, '$1');
  }
  function editDist(a, b) {
    if (!a.length && !b.length) return 0;
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (j = 0; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length] / Math.max(a.length, b.length);
  }

  function align(en, ip) {
    var n = en.length, m = ip.length, INF = 1e9;
    var D = [], B = [], i, j;
    var se = en.map(function (e) { return skelEn(e.core); });
    var si = ip.map(function (p) { return skelIpa(p.ipa); });
    for (i = 0; i <= n; i++) { D[i] = []; B[i] = []; for (j = 0; j <= m; j++) { D[i][j] = INF; B[i][j] = null; } }
    D[0][0] = 0;
    var SKIP_E = 0.7, SKIP_I = 0.9;
    for (i = 0; i <= n; i++) for (j = 0; j <= m; j++) {
      var v = D[i][j]; if (v >= INF) continue;
      function relax(ni, nj, cost, op) { if (ni <= n && nj <= m && v + cost < D[ni][nj]) { D[ni][nj] = v + cost; B[ni][nj] = [i, j, op]; } }
      if (i < n && j < m) relax(i + 1, j + 1, editDist(se[i], si[j]), 'm');
      if (i < n && j + 1 < m) relax(i + 1, j + 2, editDist(se[i], si[j] + si[j + 1]) + 0.15, 'm2');
      if (i + 1 < n && j < m) relax(i + 2, j + 1, editDist(se[i] + se[i + 1], si[j]) + 0.25, '2m');
      if (i < n) relax(i + 1, j, SKIP_E, 'se');
      if (j < m) relax(i, j + 1, SKIP_I, 'si');
    }
    var res = en.map(function (e) { return { text: e.text, core: e.core, ipa: [], pause: false }; });
    i = n; j = m;
    var unmatchedIpa = 0;
    while (i > 0 || j > 0) {
      var bk = B[i][j]; if (!bk) break;
      var pi = bk[0], pj = bk[1], op = bk[2];
      if (op === 'm') { res[pi].ipa = [ip[pj]]; }
      else if (op === 'm2') { res[pi].ipa = [ip[pj], ip[pj + 1]]; }
      else if (op === '2m') { res[pi].ipa = [ip[pj]]; res[pi + 1].ipa = []; res[pi + 1].joinPrev = true; }
      else if (op === 'si') unmatchedIpa++;
      i = pi; j = pj;
    }
    return { words: res, unmatchedIpa: unmatchedIpa };
  }

  function buildSentence(it, idx) {
    var en = enTokens(it.en), ip = ipaTokens(it.ipa || '');
    var al = align(en, ip);
    var warn = [];
    var words = al.words.map(function (w) {
      var ipaStr = w.ipa.map(function (x) { return x.ipa; }).join(' ');
      var pause = w.ipa.length ? w.ipa[w.ipa.length - 1].pause : false;
      var stress = /ˈ/.test(ipaStr) ? 2 : (/ˌ/.test(ipaStr) ? 1 : 0);
      return { w: w.text, ipa: ipaStr, s: stress, p: pause ? 1 : 0 };
    });
    var missing = words.filter(function (w) { return !w.ipa; }).length;
    if (!it.ipa) warn.push('발음기호가 없어요');
    else if (it.ipaPartial) warn.push('발음기호 앞부분이 빠져 있어요');
    else if (missing) warn.push('발음기호와 짝이 안 맞는 단어 ' + missing + '개');
    if (al.unmatchedIpa) warn.push('문장에 없는 발음기호 ' + al.unmatchedIpa + '개');
    (it.gaps || []).forEach(function (g) { warn.push('"' + g + '" 앞에 빈칸이 많아요 (글자가 빠졌는지 확인)'); });
    return { n: idx + 1, en: it.en, ipa: it.ipa ? cleanIpa(it.ipa) : '', memo: (it.memo || []).join(' / '), words: words, warn: warn };
  }

  // 관리자 화면에서 고친 한 문장 다시 정렬
  function buildOne(en, ipa, memo, n) {
    var c = classify(en || '');
    var text = c.kind === 'en' ? c.text : String(en || '').replace(/\s+/g, ' ').trim();
    var ip = String(ipa || '').trim();
    var partial = ip && ip.charAt(0) !== '/' && false;
    var s = buildSentence({ en: text, ipa: ip ? '/' + cleanIpa(ip) + '/' : '', ipaPartial: partial, memo: memo ? [memo] : [], gaps: c.gaps || [] }, (n || 1) - 1);
    return s;
  }

  // 텍스트로 붙여넣은 자료
  function readText(text) { return pairLines(String(text).split(/\r?\n/)); }

  // ---------- 발음기호 음절 강조용 분해 ----------
  var V = 'aeiouæɑɒɔəɚɝɛɪʊʌɐɜ';
  function stressSpans(ipa) {
    // [{t:'ə', st:0}, {t:'baʊt', st:2}] 형태로 나눔
    var out = [], i = 0, s = ipa;
    function isV(ch) { return V.indexOf(ch) >= 0; }
    while (i < s.length) {
      var ch = s[i];
      if (ch === 'ˈ' || ch === 'ˌ') {
        var lvl = ch === 'ˈ' ? 2 : 1, j = i + 1;
        while (j < s.length && !isV(s[j]) && s[j] !== ' ' && s[j] !== 'ˈ' && s[j] !== 'ˌ') j++; // onset
        while (j < s.length && (isV(s[j]) || s[j] === 'ː')) j++;                                 // nucleus
        var k = j; while (k < s.length && !isV(s[k]) && s[k] !== ' ' && s[k] !== 'ˈ' && s[k] !== 'ˌ') k++;
        var hasNext = k < s.length && isV(s[k]);
        var codaEnd = hasNext ? Math.max(j, k - 1) : k;
        out.push({ t: s.slice(i + 1, codaEnd), st: lvl });
        i = codaEnd;
      } else {
        var j2 = i; while (j2 < s.length && s[j2] !== 'ˈ' && s[j2] !== 'ˌ') j2++;
        out.push({ t: s.slice(i, j2), st: 0 }); i = j2;
      }
    }
    return out.filter(function (x) { return x.t; });
  }

  // 음절 수 (발음기호 모음 묶음 수, 없으면 철자로 추정)
  function syllables(word) {
    var s = word.ipa || '';
    if (s) { var m = s.replace(/[ˈˌː]/g, '').match(new RegExp('[' + V + ']+', 'g')); return m ? m.length : 1; }
    var e = word.w.toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '');
    var m2 = e.match(/[aeiouy]+/g); return Math.max(1, m2 ? m2.length : 1);
  }

  var api = { readHwp: readHwp, readText: readText, pairLines: pairLines, buildOne: buildOne, cleanIpa: cleanIpa, stressSpans: stressSpans, syllables: syllables, _skelEn: skelEn, _skelIpa: skelIpa };
  root.Hwp = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
