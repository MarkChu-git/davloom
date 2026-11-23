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

function $node_exists(_n_0) {
  if (_n_0.$ === "Absent") {
    return false;
  } else if (_n_0.$ === "File") {
    return true;
  } else {
    return true;
  }
}

function $is_folder(_n_0) {
  if (_n_0.$ === "Absent") {
    return false;
  } else if (_n_0.$ === "File") {
    return false;
  } else {
    return true;
  }
}

function $write_parent(_replaces_0, _parent_0) {
  if (_parent_0.$ === "Folder") {
    return {$: "Proceed", "replaces": _replaces_0};
  } else if (_parent_0.$ === "File") {
    return {$: "NoParent"};
  } else {
    return {$: "NoParent"};
  }
}

function $decide_write(_target_0, _parent_0) {
  if (_target_0.$ === "Folder") {
    return {$: "IsFolder"};
  } else if (_target_0.$ === "File") {
    return $write_parent(true, _parent_0);
  } else {
    return $write_parent(false, _parent_0);
  }
}

function $mkcol_target(_target_0, _parent_0) {
  if (_target_0.$ === "Absent") {
    return $write_parent(false, _parent_0);
  } else if (_target_0.$ === "File") {
    return {$: "Exists"};
  } else {
    return {$: "Exists"};
  }
}

function $decide_mkcol(_is_root_0, _target_0, _parent_0) {
  if (_is_root_0) {
    return {$: "Exists"};
  } else {
    return $mkcol_target(_target_0, _parent_0);
  }
}

function $remove_target(_target_0) {
  if (_target_0.$ === "Absent") {
    return {$: "Missing"};
  } else if (_target_0.$ === "File") {
    return {$: "Proceed", "replaces": false};
  } else {
    return {$: "Proceed", "replaces": false};
  }
}

function $decide_remove(_is_root_0, _target_0) {
  if (_is_root_0) {
    return {$: "Root"};
  } else {
    return $remove_target(_target_0);
  }
}

function $copy_over(_overwrite_0, _dest_parent_0) {
  if (_overwrite_0) {
    return $write_parent(true, _dest_parent_0);
  } else {
    return {$: "Exists"};
  }
}

function $copy_dest(_dest_0, _dest_parent_0, _overwrite_0) {
  if (_dest_0.$ === "Absent") {
    return $write_parent(false, _dest_parent_0);
  } else if (_dest_0.$ === "File") {
    return $copy_over(_overwrite_0, _dest_parent_0);
  } else {
    return $copy_over(_overwrite_0, _dest_parent_0);
  }
}

function $copy_root(_dest_is_root_0, _dest_0, _dest_parent_0, _overwrite_0) {
  if (_dest_is_root_0) {
    return {$: "Root"};
  } else {
    return $copy_dest(_dest_0, _dest_parent_0, _overwrite_0);
  }
}

function $copy_inside(_folder_0, _inside_0, _dest_is_root_0, _dest_0, _dest_parent_0, _overwrite_0) {
  if (_inside_0) {
    return {$: "IntoItself"};
  } else {
    return $copy_root(_dest_is_root_0, _dest_0, _dest_parent_0, _overwrite_0);
  }
}

function $decide_copy(_source_0, _inside_0, _dest_is_root_0, _dest_0, _dest_parent_0, _overwrite_0) {
  if (_source_0.$ === "Absent") {
    return {$: "Missing"};
  } else if (_source_0.$ === "File") {
    return $copy_inside(false, _inside_0, _dest_is_root_0, _dest_0, _dest_parent_0, _overwrite_0);
  } else {
    return $copy_inside(true, _inside_0, _dest_is_root_0, _dest_0, _dest_parent_0, _overwrite_0);
  }
}

function $decide_move(_source_is_root_0, _source_0, _inside_0, _dest_is_root_0, _dest_0, _dest_parent_0, _overwrite_0) {
  if (_source_is_root_0) {
    return {$: "Root"};
  } else {
    return $decide_copy(_source_0, _inside_0, _dest_is_root_0, _dest_0, _dest_parent_0, _overwrite_0);
  }
}
export default {
  "node_exists": run_lib((a0) => run_loop($node_exists(a0)), 1),
  "is_folder": run_lib((a0) => run_loop($is_folder(a0)), 1),
  "write_parent": run_lib((a0,a1) => run_loop($write_parent(a0,a1)), 2),
  "decide_write": run_lib((a0,a1) => run_loop($decide_write(a0,a1)), 2),
  "mkcol_target": run_lib((a0,a1) => run_loop($mkcol_target(a0,a1)), 2),
  "decide_mkcol": run_lib((a0,a1,a2) => run_loop($decide_mkcol(a0,a1,a2)), 3),
  "remove_target": run_lib((a0) => run_loop($remove_target(a0)), 1),
  "decide_remove": run_lib((a0,a1) => run_loop($decide_remove(a0,a1)), 2),
  "copy_over": run_lib((a0,a1) => run_loop($copy_over(a0,a1)), 2),
  "copy_dest": run_lib((a0,a1,a2) => run_loop($copy_dest(a0,a1,a2)), 3),
  "copy_root": run_lib((a0,a1,a2,a3) => run_loop($copy_root(a0,a1,a2,a3)), 4),
  "copy_inside": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($copy_inside(a0,a1,a2,a3,a4,a5)), 6),
  "decide_copy": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($decide_copy(a0,a1,a2,a3,a4,a5)), 6),
  "decide_move": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($decide_move(a0,a1,a2,a3,a4,a5,a6)), 7),
};
