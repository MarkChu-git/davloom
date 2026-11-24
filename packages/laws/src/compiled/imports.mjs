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

function $member_go($0, $1, $2) {
  for (;;) {
    {
      const _xs_0 = $0;
      const _n_0 = $1;
      const _found_0 = $2;
      if (_xs_0.$ === "Nil") {
        return _found_0;
      } else {
        const _h_0 = _xs_0["head"];
        const _t_0 = _xs_0["tail"];
        const _x_0 = $$Nat_is_eq(_h_0, _n_0);
        $0 = _t_0;
        $1 = _n_0;
        $2 = (_found_0 || _x_0);
        continue;
      }
    }
  }
}

function $member(_xs_0, _n_0) {
  return $member_go(_xs_0, _n_0, false);
}

function $all_known(_xs_0, _known_0) {
  if (_xs_0.$ === "Nil") {
    return true;
  } else {
    const _h_0 = _xs_0["head"];
    const _t_0 = _xs_0["tail"];
    return $Bool_and($$member(_known_0, _h_0), $$all_known(_t_0, _known_0));
  }
}

function $prepend(_xs_0, _known_0) {
  if (_xs_0.$ === "Nil") {
    return _known_0;
  } else {
    const _h_0 = _xs_0["head"];
    const _t_0 = _xs_0["tail"];
    return {$: "Con", "head": _h_0, "tail": $$prepend(_t_0, _known_0)};
  }
}

function $all_new(_xs_0, _known_0) {
  if (_xs_0.$ === "Nil") {
    return true;
  } else {
    const _h_0 = _xs_0["head"];
    const _t_0 = _xs_0["tail"];
    return $Bool_and($$Bool_not($$member(_known_0, _h_0)), $$all_new(_t_0, {$: "Con", "head": _h_0, "tail": _known_0}));
  }
}

function $valid_go($0, $1, $2) {
  for (;;) {
    {
      const _entries_0 = $0;
      const _known_0 = $1;
      const _ok_0 = $2;
      if (_entries_0.$ === "Nil") {
        return _ok_0;
      } else {
        const _t_0 = _entries_0["head"];
        const _defines_0 = _t_0["defines"];
        const _needs_0 = _t_0["needs"];
        const _t_1 = _entries_0["tail"];
        $0 = _t_1;
        $1 = $$prepend(_defines_0, _known_0);
        $2 = $$Bool_and(_ok_0, $$Bool_and($$all_known(_needs_0, _known_0), $$all_new(_defines_0, _known_0)));
        continue;
      }
    }
  }
}

function $valid(_entries_0, _known_0) {
  return $valid_go(_entries_0, _known_0, true);
}

function $decide(_ok_0, _entries_0) {
  if (_ok_0) {
    return {$: "Apply", "entries": _entries_0};
  } else {
    return {$: "Reject"};
  }
}

function $plan(_entries_0, _known_0) {
  return $decide($$valid(_entries_0, _known_0), _entries_0);
}

function $owned(_users_0, _logins_0) {
  if (_users_0.$ === "CNone") {
    return false;
  } else if (_users_0.$ === "COne") {
    if (_logins_0.$ === "CNone") {
      return false;
    } else if (_logins_0.$ === "COne") {
      return true;
    } else {
      return true;
    }
  } else {
    return false;
  }
}

function $Nat_is_eq(_a_0, _b_0) {
  return $Cmp_is_eq(cmp_new(_a_0, _b_0));
}

function $Bool_and(_a_0, _b_0) {
  if (!_a_0) {
    return false;
  } else {
    return _b_0;
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

const $$Nat_is_eq = $Nat_is_eq;
const $$member = $member;
const $$all_known = $all_known;
const $$prepend = $prepend;
const $$Bool_not = $Bool_not;
const $$all_new = $all_new;
const $$Bool_and = $Bool_and;
const $$valid = $valid;export default {
  "member_go": run_lib((a0,a1,a2) => run_loop($member_go(a0,nat_in(a1),a2)), 3),
  "member": run_lib((a0,a1) => run_loop($member(a0,nat_in(a1))), 2),
  "all_known": run_lib((a0,a1) => run_loop($all_known(a0,a1)), 2),
  "prepend": run_lib((a0,a1) => run_loop($prepend(a0,a1)), 2),
  "all_new": run_lib((a0,a1) => run_loop($all_new(a0,a1)), 2),
  "valid_go": run_lib((a0,a1,a2) => run_loop($valid_go(a0,a1,a2)), 3),
  "valid": run_lib((a0,a1) => run_loop($valid(a0,a1)), 2),
  "decide": run_lib((a0,a1) => run_loop($decide(a0,a1)), 2),
  "plan": run_lib((a0,a1) => run_loop($plan(a0,a1)), 2),
  "owned": run_lib((a0,a1) => run_loop($owned(a0,a1)), 2),
};
