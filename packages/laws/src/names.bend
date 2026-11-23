import Base

# The rules of names and paths. A name is passed as its list of code points.

def utf8_width_pick3(c: Bool) -> Nat:
  match c:
    case True{}:
      3n
    case False{}:
      4n

def utf8_width_pick2(b: Bool, c: Bool) -> Nat:
  match b:
    case True{}:
      2n
    case False{}:
      utf8_width_pick3(c)

def utf8_width_pick(a: Bool, b: Bool, c: Bool) -> Nat:
  match a:
    case True{}:
      1n
    case False{}:
      utf8_width_pick2(b, c)

# The bytes a code point takes in UTF-8.
def utf8_width(+c: Nat) -> Nat:
  utf8_width_pick(Nat.is_lt(c, 128n), Nat.is_lt(c, 2048n), Nat.is_lt(c, 65536n))

def utf8_length(xs: +List<Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      Nat.add(utf8_width(h), utf8_length(t))

# A code point a name may hold: not NUL, not `/`, not a surrogate, and at most U+10FFFF.
def char_ok(+c: Nat) -> Bool:
  Bool.and(
    Bool.and(Nat.is_ne(c, 0n), Nat.is_ne(c, 47n)),
    Bool.and(
      Bool.or(Nat.is_lt(c, 55296n), Nat.is_gt(c, 57343n)),
      Nat.is_le(c, 1114111n)))

def chars_ok(xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{h, t}:
      Bool.and(char_ok(h), chars_ok(t))

def is_dots_rest(xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{b, t}:
      Bool.and(Nat.is_eq(b, 46n), List.is_empty(&2, Nat, t))

# Whether a name is `.` or `..`.
def is_dots(xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{a, t}:
      Bool.and(Nat.is_eq(a, 46n), is_dots_rest(t))

def name_ok(+xs: +List<Nat>) -> Bool:
  Bool.and(
    Bool.and(Bool.not(List.is_empty(&2, Nat, xs)), Bool.not(is_dots(xs))),
    Bool.and(chars_ok(xs), Nat.is_le(utf8_length(xs), 255n)))

def names_ok(xss: +List<+List<Nat>>) -> Bool:
  match xss:
    case Nil{}:
      True{}
    case Con{h, t}:
      Bool.and(name_ok(h), names_ok(t))

# The bytes of a path's names joined by `/`, with the separators.
def path_length(xss: +List<+List<Nat>>) -> Nat:
  match xss:
    case Nil{}:
      0n
    case Con{h, t}:
      Nat.add(Nat.add(1n, utf8_length(h)), path_length(t))

# A path: every name is valid, and the path takes at most 900 bytes with a `/` before each name.
def path_ok(+xss: +List<+List<Nat>>) -> Bool:
  Bool.and(names_ok(xss), Nat.is_le(path_length(xss), 900n))
