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

function $can_write(_access_0) {
  if (_access_0.$ === "ReadOnly") {
    return false;
  } else {
    return true;
  }
}

function $writes_target(_m_0) {
  if (_m_0.$ === "MOptions") {
    return false;
  } else if (_m_0.$ === "MGet") {
    return false;
  } else if (_m_0.$ === "MHead") {
    return false;
  } else if (_m_0.$ === "MPropfind") {
    return false;
  } else if (_m_0.$ === "MPut") {
    return true;
  } else if (_m_0.$ === "MMkcol") {
    return true;
  } else if (_m_0.$ === "MDelete") {
    return true;
  } else if (_m_0.$ === "MProppatch") {
    return true;
  } else if (_m_0.$ === "MCopy") {
    return false;
  } else if (_m_0.$ === "MMove") {
    return true;
  } else if (_m_0.$ === "MLock") {
    return true;
  } else if (_m_0.$ === "MUnlock") {
    return true;
  } else {
    return true;
  }
}

function $has_destination(_m_0) {
  if (_m_0.$ === "MOptions") {
    return false;
  } else if (_m_0.$ === "MGet") {
    return false;
  } else if (_m_0.$ === "MHead") {
    return false;
  } else if (_m_0.$ === "MPropfind") {
    return false;
  } else if (_m_0.$ === "MPut") {
    return false;
  } else if (_m_0.$ === "MMkcol") {
    return false;
  } else if (_m_0.$ === "MDelete") {
    return false;
  } else if (_m_0.$ === "MProppatch") {
    return false;
  } else if (_m_0.$ === "MCopy") {
    return true;
  } else if (_m_0.$ === "MMove") {
    return true;
  } else if (_m_0.$ === "MLock") {
    return false;
  } else if (_m_0.$ === "MUnlock") {
    return false;
  } else {
    return false;
  }
}

function $is_known(_m_0) {
  if (_m_0.$ === "MOther") {
    return false;
  } else if (_m_0.$ === "MOptions") {
    return true;
  } else if (_m_0.$ === "MGet") {
    return true;
  } else if (_m_0.$ === "MHead") {
    return true;
  } else if (_m_0.$ === "MPropfind") {
    return true;
  } else if (_m_0.$ === "MPut") {
    return true;
  } else if (_m_0.$ === "MMkcol") {
    return true;
  } else if (_m_0.$ === "MDelete") {
    return true;
  } else if (_m_0.$ === "MProppatch") {
    return true;
  } else if (_m_0.$ === "MCopy") {
    return true;
  } else if (_m_0.$ === "MMove") {
    return true;
  } else if (_m_0.$ === "MLock") {
    return true;
  } else {
    return true;
  }
}

function $allows_target(_access_0, _m_0) {
  const _x_0 = $$Bool_not($$writes_target(_m_0));
  const _x_1 = $$can_write(_access_0);
  return (_x_0 || _x_1);
}

function $allows_destination(_access_0, _m_0, _dest_in_scope_0) {
  const _x_0 = $$Bool_not($$has_destination(_m_0));
  const _x_1 = $$Bool_and(_dest_in_scope_0, $$can_write(_access_0));
  return (_x_0 || _x_1);
}

function $authorize(_access_0, _m_0, _target_in_scope_0, _dest_in_scope_0) {
  return $Bool_and($$Bool_and($$is_known(_m_0), _target_in_scope_0), $$Bool_and($$allows_target(_access_0, _m_0), $$allows_destination(_access_0, _m_0, _dest_in_scope_0)));
}

function $Bool_not(_b_0) {
  if (!_b_0) {
    return true;
  } else {
    return false;
  }
}

function $Bool_and(_a_0, _b_0) {
  if (!_a_0) {
    return false;
  } else {
    return _b_0;
  }
}

const $$writes_target = $writes_target;
const $$Bool_not = $Bool_not;
const $$can_write = $can_write;
const $$has_destination = $has_destination;
const $$Bool_and = $Bool_and;
const $$is_known = $is_known;
const $$allows_target = $allows_target;
const $$allows_destination = $allows_destination;export default {
  "can_write": run_lib((a0) => run_loop($can_write(a0)), 1),
  "writes_target": run_lib((a0) => run_loop($writes_target(a0)), 1),
  "has_destination": run_lib((a0) => run_loop($has_destination(a0)), 1),
  "is_known": run_lib((a0) => run_loop($is_known(a0)), 1),
  "allows_target": run_lib((a0,a1) => run_loop($allows_target(a0,a1)), 2),
  "allows_destination": run_lib((a0,a1,a2) => run_loop($allows_destination(a0,a1,a2)), 3),
  "authorize": run_lib((a0,a1,a2,a3) => run_loop($authorize(a0,a1,a2,a3)), 4),
};
