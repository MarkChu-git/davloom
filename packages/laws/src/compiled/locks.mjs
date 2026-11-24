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

function $conflicts(_held_0, _requested_0) {
  if (_held_0.$ === "Exclusive") {
    return true;
  } else {
    if (_requested_0.$ === "Exclusive") {
      return true;
    } else {
      return false;
    }
  }
}

function $reaches_down(_depth_0) {
  if (_depth_0.$ === "Shallow") {
    return false;
  } else {
    return true;
  }
}

function $covers(_depth_0, _place_0, _descendants_0) {
  if (_place_0.$ === "Same") {
    return true;
  } else if (_place_0.$ === "Above") {
    return $reaches_down(_depth_0);
  } else if (_place_0.$ === "Below") {
    return _descendants_0;
  } else {
    return false;
  }
}

function $refuses(_held_scope_0, _held_depth_0, _place_0, _scope_0, _depth_0) {
  return $Bool_and($$covers(_held_depth_0, _place_0, $$reaches_down(_depth_0)), $$conflicts(_held_scope_0, _scope_0));
}

function $condition_true(_c_0) {
  const _t_0 = _c_0["negated"];
  if (!_t_0) {
    const _holds_0 = _c_0["holds"];
    return _holds_0;
  } else {
    const _holds_1 = _c_0["holds"];
    return $Bool_not(_holds_1);
  }
}

function $conditions_go($0, $1) {
  for (;;) {
    {
      const _cs_0 = $0;
      const _acc_0 = $1;
      if (_cs_0.$ === "Nil") {
        return _acc_0;
      } else {
        const _h_0 = _cs_0["head"];
        const _t_0 = _cs_0["tail"];
        $0 = _t_0;
        $1 = $$Bool_and(_acc_0, $$condition_true(_h_0));
        continue;
      }
    }
  }
}

function $conditions_true(_cs_0) {
  return $conditions_go(_cs_0, true);
}

function $clause_true(_c_0) {
  const _resolved_0 = _c_0["resolved"];
  const _conditions_0 = _c_0["conditions"];
  return $Bool_and(_resolved_0, $$conditions_true(_conditions_0));
}

function $header_go($0, $1) {
  for (;;) {
    {
      const _cs_0 = $0;
      const _acc_0 = $1;
      if (_cs_0.$ === "Nil") {
        return _acc_0;
      } else {
        const _h_0 = _cs_0["head"];
        const _t_0 = _cs_0["tail"];
        const _x_0 = $$clause_true(_h_0);
        $0 = _t_0;
        $1 = (_acc_0 || _x_0);
        continue;
      }
    }
  }
}

function $header_true(_cs_0) {
  return $header_go(_cs_0, false);
}

function $state_of(_holds_0) {
  if (!_holds_0) {
    return {$: "NoneTrue"};
  } else {
    return {$: "SomeTrue"};
  }
}

function $if_state(_present_0, _parsed_0, _clauses_0) {
  if (!_present_0) {
    return {$: "NoHeader"};
  } else {
    if (!_parsed_0) {
      return {$: "Malformed"};
    } else {
      return $state_of($$header_true(_clauses_0));
    }
  }
}

function $locked_or_proceed(_blocked_0) {
  if (_blocked_0) {
    return {$: "Locked"};
  } else {
    return {$: "Proceed"};
  }
}

function $gate(_state_0, _blocked_0) {
  if (_state_0.$ === "Malformed") {
    return {$: "BadHeader"};
  } else if (_state_0.$ === "NoneTrue") {
    return {$: "Unmet"};
  } else if (_state_0.$ === "NoHeader") {
    return $locked_or_proceed(_blocked_0);
  } else {
    return $locked_or_proceed(_blocked_0);
  }
}

function $decide_unlock(_found_0, _may_lock_0) {
  if (!_found_0) {
    return {$: "NotHere"};
  } else {
    if (!_may_lock_0) {
      return {$: "NotYours"};
    } else {
      return {$: "Release"};
    }
  }
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

const $$reaches_down = $reaches_down;
const $$covers = $covers;
const $$conflicts = $conflicts;
const $$condition_true = $condition_true;
const $$Bool_and = $Bool_and;
const $$conditions_true = $conditions_true;
const $$clause_true = $clause_true;
const $$header_true = $header_true;export default {
  "conflicts": run_lib((a0,a1) => run_loop($conflicts(a0,a1)), 2),
  "reaches_down": run_lib((a0) => run_loop($reaches_down(a0)), 1),
  "covers": run_lib((a0,a1,a2) => run_loop($covers(a0,a1,a2)), 3),
  "refuses": run_lib((a0,a1,a2,a3,a4) => run_loop($refuses(a0,a1,a2,a3,a4)), 5),
  "condition_true": run_lib((a0) => run_loop($condition_true(a0)), 1),
  "conditions_go": run_lib((a0,a1) => run_loop($conditions_go(a0,a1)), 2),
  "conditions_true": run_lib((a0) => run_loop($conditions_true(a0)), 1),
  "clause_true": run_lib((a0) => run_loop($clause_true(a0)), 1),
  "header_go": run_lib((a0,a1) => run_loop($header_go(a0,a1)), 2),
  "header_true": run_lib((a0) => run_loop($header_true(a0)), 1),
  "state_of": run_lib((a0) => run_loop($state_of(a0)), 1),
  "if_state": run_lib((a0,a1,a2) => run_loop($if_state(a0,a1,a2)), 3),
  "locked_or_proceed": run_lib((a0) => run_loop($locked_or_proceed(a0)), 1),
  "gate": run_lib((a0,a1) => run_loop($gate(a0,a1)), 2),
  "decide_unlock": run_lib((a0,a1) => run_loop($decide_unlock(a0,a1)), 2),
};
