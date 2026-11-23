function word_to_u32(w) {
  let x = 0;
  for (let i = 0; w.$ === "WCon"; i++) {
    x |= Number(w.head) << i;
    w = w.tail;
  }
  return x >>> 0;
}

function u32_to_word(x) {
  let w = {$: "WNil"};
  for (let i = 31; i >= 0; i--) {
    w = {$: "WCon", head: ((x >>> i) & 1) === 1, tail: w};
  }
  return w;
}

function cmp_new(a, b) {
  return {$: a < b ? "LT" : a === b ? "EQ" : "GT"};
}

function tup_new(a, b) {
  return {$: "Tuple", fst: a, snd: b};
}

function nat_divmod(a, b) {
  return tup_new(b && Math.trunc(a / b), b ? a % b : a);
}

function nat_chk(n) {
  if (n > 281474976710655) {
    throw "bend: a Nat past the largest immediate 2^48-1";
  }
  return n;
}

function nat_in(n) {
  if (!Number.isInteger(n) || n < 0 || n > 2 ** 53) {
    throw "bend: expected a Nat host number: an integer from 0 to 2^53";
  }
  return n;
}

function f32_show(x) {
  let s = "nan";
  for (let p = 1; x === x && p <= 9 && f32_round(s) !== x; p += 1) {
    s = String(Number(x.toExponential(p - 1)));
  }
  return (Object.is(x, -0) ? "-0" : s).replace("Infinity", "inf");
}

function f32_bits(x) {
  return new Uint32Array(new Float32Array([x]).buffer)[0];
}

function f32_from_bits(u) {
  return new Float32Array(new Uint32Array([u]).buffer)[0];
}

function f32_read(s) {
  const re = /^[\t\n\v\f\r ]*[+-]?((\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?|inf(inity)?|nan)$/i;
  return re.test(s) ? {$: "Some", value: f32_round(
    s.replace(/inf\w*/i, "Infinity"))} : {$: "None"};
}

const f32_round = function f32_round(s) {
  const d = Number(s);
  const a = Math.abs(d);
  const f = Math.fround(a);
  const g = 2 * a - Math.min(f, 2 ** 128);
  if (g === f || Math.fround(g) !== g || g === Infinity) {
    return Math.sign(d) * f;
  }
  let k = 0;
  while (a * 2 ** k % 1 !== 0) {
    k += 1;
  }
  const [, i, r, e] = /(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(s);
  const n = Number(e ?? 0) - r.length;
  const x = BigInt(i + r) * 2n ** BigInt(k) * 10n ** BigInt(Math.max(n, 0));
  const y = BigInt(a * 2 ** k) * 10n ** BigInt(Math.max(-n, 0));
  return Math.sign(d) * (x === y || x > y !== g > f ? f : g);
};

const char_new = function char_new(c) {
  return c < 55296 || c >= 57344 && c <= 1114111 ? String.fromCodePoint(c) : String.fromCharCode(56320, c >>> 22, c >>> 11 & 2047, c & 2047);
};

function char_len(s, at = 0) {
  return s[at] === "\uDC00" ? 4 : s.codePointAt(at) > 0xFFFF ? 2 : 1;
}

function char_code(s) {
  return s.length < 4 ? s.codePointAt(0)
    : (s.charCodeAt(1) << 22 | s.charCodeAt(2) << 11 | s.charCodeAt(3)) >>> 0;
}

function string_contains(s, p) {
  // A match starts at a Char, not inside a packed U32 code.
  for (let at = 0; at <= s.length; at += char_len(s, at)) {
    if (s.startsWith(p, at)) {
      return true;
    }
  }
  return false;
}

function str_out(s) {
  return s.replace(/\uDC00[^]{3}/gu, "\uFFFD");
}

function str_in(s) {
  return s.replace(/\p{Cs}/gu, "\uFFFD");
}

// Array
// =====

function array_new(d, v, lgs) {
  if (d > 31 - lgs) {
    throw "bend: an array past the deepest block class 31 (depth + log2 words per cell)";
  }
  return Array(2 ** d).fill(v);
}

function array_node(a, b) {
  if (a.length !== b.length) {
    throw "bend: runtime fail-stop";
  }
  return a.concat(b);
}

function array_rmw(a, i, f) {
  const old = a[i %= a.length];
  a[i] = f(old);
  return tup_new(a, old);
}

// Run
// ===

function run_tail(f, x) {
  return {$: "$JMP", f: f.j?.f === f ? f.j : f, x};
}

function run_clo(j) {
  const f = (x) => run_loop(j(x));
  f.j = j;
  j.f = f;
  return f;
}

function run_loop(r) {
  while (r !== null && typeof r === "object" && r.$ === "$JMP") {
    r = r.f(r.x);
  }
  return r;
}

function run_lib(f, n) {
  return (...a) => a.length < n ? run_lib((...b) => f(...a, ...b), n - a.length)
    : run_loop(f(...a));
}

// Effect
// ======

const $0eff = Object.create(null);
const io_file_append = new Set();

function io_eff(k, run) {
  if (arguments.length > 2) {
    throw new Error("bend: " + k + " takes no need: an effect that waits parks itself");
  }
  if (k in $0eff) {
    throw new Error("bend: two effects register " + k);
  }
  $0eff[k] = run;
}
// Program
// =======

function $utf8_width_pick3(_c_0) {
  if (_c_0) {
    return 3;
  } else {
    return 4;
  }
}

function $utf8_width_pick2(_b_0, _c_0) {
  if (_b_0) {
    return 2;
  } else {
    return $utf8_width_pick3(_c_0);
  }
}

function $utf8_width_pick(_a_0, _b_0, _c_0) {
  if (_a_0) {
    return 1;
  } else {
    return $utf8_width_pick2(_b_0, _c_0);
  }
}

function $utf8_width(_c_0) {
  const _x_0 = (2048 );
  const _x_1 = (65536 );
  return $utf8_width_pick((_c_0 < 128), (_c_0 < _x_0), (_c_0 < _x_1));
}

function $utf8_length(_xs_0) {
  if (_xs_0.$ === "Nil") {
    return 0;
  } else {
    const _h_0 = _xs_0["head"];
    const _t_0 = _xs_0["tail"];
    const _x_0 = $$utf8_width(_h_0);
    const _x_1 = $$utf8_length(_t_0);
    return nat_chk(_x_0 + _x_1);
  }
}

function $char_ok(_c_0) {
  const _x_0 = (55296 );
  const _x_1 = (_c_0 < _x_0);
  const _x_2 = $$Nat_is_gt(_c_0, (57343 ));
  return $Bool_and($$Bool_and($$Nat_is_ne(_c_0, 0), $$Nat_is_ne(_c_0, 47)), $$Bool_and((_x_1 || _x_2), $$Nat_is_le(_c_0, (1114111 ))));
}

function $chars_ok(_xs_0) {
  if (_xs_0.$ === "Nil") {
    return true;
  } else {
    const _h_0 = _xs_0["head"];
    const _t_0 = _xs_0["tail"];
    return $Bool_and($$char_ok(_h_0), $$chars_ok(_t_0));
  }
}

function $is_dots_rest(_xs_0) {
  if (_xs_0.$ === "Nil") {
    return true;
  } else {
    const _b_0 = _xs_0["head"];
    const _t_0 = _xs_0["tail"];
    return $Bool_and($$Nat_is_eq(_b_0, 46), $$List_is_empty(_t_0));
  }
}

function $is_dots(_xs_0) {
  if (_xs_0.$ === "Nil") {
    return false;
  } else {
    const _a_0 = _xs_0["head"];
    const _t_0 = _xs_0["tail"];
    return $Bool_and($$Nat_is_eq(_a_0, 46), $$is_dots_rest(_t_0));
  }
}

function $name_ok(_xs_0) {
  return $Bool_and($$Bool_and($$Bool_not($$List_is_empty(_xs_0)), $$Bool_not($$is_dots(_xs_0))), $$Bool_and($$chars_ok(_xs_0), $$Nat_is_le($$utf8_length(_xs_0), 255)));
}

function $names_ok(_xss_0) {
  if (_xss_0.$ === "Nil") {
    return true;
  } else {
    const _h_0 = _xss_0["head"];
    const _t_0 = _xss_0["tail"];
    return $Bool_and($$name_ok(_h_0), $$names_ok(_t_0));
  }
}

function $path_length(_xss_0) {
  if (_xss_0.$ === "Nil") {
    return 0;
  } else {
    const _h_0 = _xss_0["head"];
    const _t_0 = _xss_0["tail"];
    const _x_0 = $$utf8_length(_h_0);
    const _x_1 = nat_chk(1 + _x_0);
    const _x_2 = $$path_length(_t_0);
    return nat_chk(_x_1 + _x_2);
  }
}

function $path_ok(_xss_0) {
  return $Bool_and($$names_ok(_xss_0), $$Nat_is_le($$path_length(_xss_0), (900 )));
}

function $Bool_and(_a_0, _b_0) {
  if (!_a_0) {
    return false;
  } else {
    return _b_0;
  }
}

function $Nat_is_ne(_a_0, _b_0) {
  return $Bool_not($$Cmp_is_eq(cmp_new(_a_0, _b_0)));
}

function $Nat_is_gt(_a_0, _b_0) {
  return $Cmp_is_gt(cmp_new(_a_0, _b_0));
}

function $Nat_is_le(_a_0, _b_0) {
  return $Cmp_is_le(cmp_new(_a_0, _b_0));
}

function $Nat_is_eq(_a_0, _b_0) {
  return $Cmp_is_eq(cmp_new(_a_0, _b_0));
}

function $List_is_empty(_xs_0) {
  if (_xs_0.$ === "Nil") {
    return true;
  } else {
    return false;
  }
}

function $Bool_not(_b_0) {
  if (!_b_0) {
    return true;
  } else {
    return false;
  }
}

function $Cmp_is_eq(_c_0) {
  if (_c_0.$ === "EQ") {
    return true;
  } else {
    return false;
  }
}

function $Cmp_is_gt(_c_0) {
  if (_c_0.$ === "GT") {
    return true;
  } else {
    return false;
  }
}

function $Cmp_is_le(_c_0) {
  if (_c_0.$ === "GT") {
    return false;
  } else {
    return true;
  }
}

const $$utf8_width = $utf8_width;
const $$utf8_length = $utf8_length;
const $$Nat_is_ne = $Nat_is_ne;
const $$Bool_and = $Bool_and;
const $$Nat_is_gt = $Nat_is_gt;
const $$Nat_is_le = $Nat_is_le;
const $$char_ok = $char_ok;
const $$chars_ok = $chars_ok;
const $$Nat_is_eq = $Nat_is_eq;
const $$List_is_empty = $List_is_empty;
const $$is_dots_rest = $is_dots_rest;
const $$Bool_not = $Bool_not;
const $$is_dots = $is_dots;
const $$name_ok = $name_ok;
const $$names_ok = $names_ok;
const $$path_length = $path_length;
const $$Cmp_is_eq = $Cmp_is_eq;export default {
  "utf8_width_pick3": run_lib((a0) => run_loop($utf8_width_pick3(a0)), 1),
  "utf8_width_pick2": run_lib((a0,a1) => run_loop($utf8_width_pick2(a0,a1)), 2),
  "utf8_width_pick": run_lib((a0,a1,a2) => run_loop($utf8_width_pick(a0,a1,a2)), 3),
  "utf8_width": run_lib((a0) => run_loop($utf8_width(nat_in(a0))), 1),
  "utf8_length": run_lib((a0) => run_loop($utf8_length(a0)), 1),
  "char_ok": run_lib((a0) => run_loop($char_ok(nat_in(a0))), 1),
  "chars_ok": run_lib((a0) => run_loop($chars_ok(a0)), 1),
  "is_dots_rest": run_lib((a0) => run_loop($is_dots_rest(a0)), 1),
  "is_dots": run_lib((a0) => run_loop($is_dots(a0)), 1),
  "name_ok": run_lib((a0) => run_loop($name_ok(a0)), 1),
  "names_ok": run_lib((a0) => run_loop($names_ok(a0)), 1),
  "path_length": run_lib((a0) => run_loop($path_length(a0)), 1),
  "path_ok": run_lib((a0) => run_loop($path_ok(a0)), 1),
};
