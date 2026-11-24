import Base
import ./LAWS.bend as L
import ./src/transfer.bend as T
import ./src/policy.bend as P
import ./src/preconditions.bend as C
import ./src/ranges.bend as R
import ./src/names.bend as N
import ./src/imports.bend as I
import ./src/copying.bend as M

# Lemmas the hand-written proofs share.

# --- Bool and Nat ---

# Modus ponens on Bool-valued claims.
def Lemma.mp(-x: Bool, -y: Bool, h: {x == True{} : Bool}, i: {L.implies(x, y) == True{} : Bool}) -> {y == True{} : Bool}:
  %h : {L.implies(_, y) == True{} : Bool}
  i

def Lemma.implies_true(x: Bool) -> {L.implies(x, True{}) == True{} : Bool}:
  match x:
    case False{}:
      {==}
    case True{}:
      {==}

def Lemma.and_intro(-x: Bool, -y: Bool, hx: {x == True{} : Bool}, hy: {y == True{} : Bool}) -> {Bool.and(x, y) == True{} : Bool}:
  %Equal.sym(Bool, x, True{}, hx) : {Bool.and(_, y) == True{} : Bool}
  hy

def Lemma.le_refl(n: Nat) -> {Nat.is_le(n, n) == True{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      Lemma.le_refl(p)

def Lemma.lt_succ(n: Nat) -> {Nat.is_lt(n, 1n+n) == True{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      Lemma.lt_succ(p)

def Lemma.lt_mono(x: Nat, y: Nat) -> {L.implies(Nat.is_lt(x, y), Nat.is_lt(x, 1n+y)) == True{} : Bool}:
  match x y:
    case 0n 0n:
      {==}
    case 0n 1n+yp:
      {==}
    case 1n+xp 0n:
      {==}
    case 1n+xp 1n+yp:
      Lemma.lt_mono(xp, yp)

def Lemma.not_lt_ge(x: Nat, y: Nat) -> {Bool.not(Nat.is_lt(x, y)) == Nat.is_ge(x, y) : Bool}:
  match x y:
    case 0n 0n:
      {==}
    case 0n 1n+yp:
      {==}
    case 1n+xp 0n:
      {==}
    case 1n+xp 1n+yp:
      Lemma.not_lt_ge(xp, yp)

def Lemma.min_le_r(l: Nat, s: Nat) -> {Nat.is_le(Nat.min(l, s), s) == True{} : Bool}:
  match l s:
    case 0n 0n:
      {==}
    case 0n 1n+sp:
      {==}
    case 1n+lp 0n:
      {==}
    case 1n+lp 1n+sp:
      Lemma.min_le_r(lp, sp)

# Subtracting never gives more than one starts with.
def Lemma.sub_lt(+b: Nat, +a: Nat) -> {Nat.is_lt(Nat.sub(b, a), 1n+b) == True{} : Bool}:
  match b a:
    case 0n _:
      {==}
    case 1n+bp 0n:
      Lemma.lt_succ(bp)
    case 1n+bp 1n+ap:
      Lemma.mp(Nat.is_lt(Nat.sub(bp, ap), 1n+bp), Nat.is_lt(Nat.sub(bp, ap), 2n+bp), Lemma.sub_lt(bp, ap), Lemma.lt_mono(Nat.sub(bp, ap), 1n+bp))

# --- Byte ranges ---

# Each `span_*` helper of the ranges module, with its test abstracted as `c`.
def Lemma.to_pick(c: Bool, -f: Nat, -l: Nat, -s: Nat) -> {L.implies(Nat.is_le(f, l), L.implies(c, Bool.and(Nat.is_lt(f, Nat.min(1n+l, s)), Nat.is_le(Nat.min(1n+l, s), s)))) == L.implies(Nat.is_le(f, l), L.span_ok(R.span_to(c, f, l, s), s)) : Bool}:
  match c:
    case True{}:
      {==}
    case False{}:
      {==}

def Lemma.from_pick(c: Bool, -f: Nat, -s: Nat) -> {L.implies(c, Bool.and(Nat.is_lt(f, s), Nat.is_le(s, s))) == L.span_ok(R.span_from(c, f, s), s) : Bool}:
  match c:
    case True{}:
      {==}
    case False{}:
      {==}

def Lemma.suffix_pick(c: Bool, -n: Nat, -s: Nat) -> {L.implies(Bool.not(c), Bool.and(Nat.is_lt(Nat.sub(s, Nat.min(n, s)), s), Nat.is_le(s, s))) == L.span_ok(R.span_suffix(c, n, s), s) : Bool}:
  match c:
    case True{}:
      {==}
    case False{}:
      {==}

def Lemma.to_inside(f: Nat, l: Nat, s: Nat) -> {L.implies(Nat.is_le(f, l), L.implies(Nat.is_lt(f, s), Bool.and(Nat.is_lt(f, Nat.min(1n+l, s)), Nat.is_le(Nat.min(1n+l, s), s)))) == True{} : Bool}:
  match f l s:
    case 0n 0n 0n:
      {==}
    case 0n 0n 1n+sp:
      Lemma.min_le_r(0n, sp)
    case 0n 1n+lp 0n:
      {==}
    case 0n 1n+lp 1n+sp:
      Lemma.min_le_r(1n+lp, sp)
    case 1n+fp 0n _:
      {==}
    case 1n+fp 1n+lp 0n:
      Lemma.implies_true(Nat.is_le(fp, lp))
    case 1n+fp 1n+lp 1n+sp:
      Lemma.to_inside(fp, lp, sp)

def Lemma.from_inside(f: Nat, s: Nat) -> {L.implies(Nat.is_lt(f, s), Bool.and(Nat.is_lt(f, s), Nat.is_le(s, s))) == True{} : Bool}:
  match f s:
    case 0n 0n:
      {==}
    case 0n 1n+sp:
      Lemma.le_refl(sp)
    case 1n+fp 0n:
      {==}
    case 1n+fp 1n+sp:
      Lemma.from_inside(fp, sp)

def Lemma.suffix_inside(+n: Nat, +s: Nat) -> {L.implies(Bool.not(Bool.or(Nat.is_eq(n, 0n), Nat.is_eq(s, 0n))), Bool.and(Nat.is_lt(Nat.sub(s, Nat.min(n, s)), s), Nat.is_le(s, s))) == True{} : Bool}:
  match n s:
    case 0n _:
      {==}
    case 1n+np 0n:
      {==}
    case 1n+np 1n+sp:
      Lemma.and_intro(Nat.is_lt(Nat.sub(sp, Nat.min(np, sp)), 1n+sp), Nat.is_le(sp, sp), Lemma.sub_lt(sp, Nat.min(np, sp)), Lemma.le_refl(sp))

def Lemma.to_unsatisfiable(c: Bool, -f: Nat, -l: Nat, -s: Nat) -> {Bool.not(c) == L.unsatisfiable(R.span_to(c, f, l, s)) : Bool}:
  match c:
    case True{}:
      {==}
    case False{}:
      {==}

def Lemma.from_unsatisfiable(c: Bool, -f: Nat, -s: Nat) -> {Bool.not(c) == L.unsatisfiable(R.span_from(c, f, s)) : Bool}:
  match c:
    case True{}:
      {==}
    case False{}:
      {==}

def Lemma.suffix_unsatisfiable(c: Bool, -n: Nat, -s: Nat) -> {c == L.unsatisfiable(R.span_suffix(c, n, s)) : Bool}:
  match c:
    case True{}:
      {==}
    case False{}:
      {==}

def Lemma.suffix_empty(n: Nat, s: Nat) -> {Bool.or(Nat.is_eq(n, 0n), Nat.is_eq(s, 0n)) == Bool.or(L.zero(n), L.zero(s)) : Bool}:
  match n s:
    case 0n _:
      {==}
    case 1n+np 0n:
      {==}
    case 1n+np 1n+sp:
      {==}

# --- Names and paths ---

# A code point that is NUL or `/` fails char_ok.
def Lemma.sep_char(e0: Bool, e47: Bool, r: Bool) -> {L.implies(Bool.or(e0, e47), Bool.not(Bool.and(Bool.and(Bool.not(e0), Bool.not(e47)), r))) == True{} : Bool}:
  match e0:
    case False{}:
      match e47:
        case False{}:
          {==}
        case True{}:
          {==}
    case True{}:
      {==}

def Lemma.char_sep(+h: Nat) -> {L.implies(Bool.or(Nat.is_eq(h, 0n), Nat.is_eq(h, 47n)), Bool.not(N.char_ok(h))) == True{} : Bool}:
  Lemma.sep_char(Nat.is_eq(h, 0n), Nat.is_eq(h, 47n), Bool.and(Bool.or(Nat.is_lt(h, 55296n), Nat.is_gt(h, 57343n)), Nat.is_le(h, 1114111n)))

def Lemma.sep_step(e0: Bool, c0: Bool, e47: Bool, c47: Bool, a: Bool, b: Bool) -> {L.implies(L.implies(Bool.or(e0, e47), Bool.not(a)), L.implies(L.implies(Bool.or(c0, c47), Bool.not(b)), L.implies(Bool.or(Bool.or(e0, c0), Bool.or(e47, c47)), Bool.not(Bool.and(a, b))))) == True{} : Bool}:
  match e0:
    case False{}:
      match c0:
        case False{}:
          match e47:
            case False{}:
              match c47:
                case False{}:
                  {==}
                case True{}:
                  match a:
                    case False{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case True{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match c47:
                case False{}:
                  match a:
                    case False{}:
                      {==}
                    case True{}:
                      {==}
                case True{}:
                  match a:
                    case False{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case True{}:
                      {==}
        case True{}:
          match e47:
            case False{}:
              match c47:
                case False{}:
                  match a:
                    case False{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case True{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case True{}:
                  match a:
                    case False{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case True{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match c47:
                case False{}:
                  match a:
                    case False{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case True{}:
                      {==}
                case True{}:
                  match a:
                    case False{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case True{}:
                      {==}
    case True{}:
      match c0:
        case False{}:
          match e47:
            case False{}:
              match c47:
                case False{}:
                  match a:
                    case False{}:
                      {==}
                    case True{}:
                      {==}
                case True{}:
                  match a:
                    case False{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case True{}:
                      {==}
            case True{}:
              match c47:
                case False{}:
                  match a:
                    case False{}:
                      {==}
                    case True{}:
                      {==}
                case True{}:
                  match a:
                    case False{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case True{}:
                      {==}
        case True{}:
          match e47:
            case False{}:
              match c47:
                case False{}:
                  match a:
                    case False{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case True{}:
                      {==}
                case True{}:
                  match a:
                    case False{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case True{}:
                      {==}
            case True{}:
              match c47:
                case False{}:
                  match a:
                    case False{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case True{}:
                      {==}
                case True{}:
                  match a:
                    case False{}:
                      match b:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case True{}:
                      {==}

# A list holding NUL or `/` fails chars_ok.
def Lemma.chars_sep(+xs: +List<Nat>) -> {L.implies(Bool.or(L.contains(xs, 0n), L.contains(xs, 47n)), Bool.not(N.chars_ok(xs))) == True{} : Bool}:
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      Lemma.mp(
        L.implies(Bool.or(L.contains(t, 0n), L.contains(t, 47n)), Bool.not(N.chars_ok(t))),
        L.implies(Bool.or(Bool.or(Nat.is_eq(h, 0n), L.contains(t, 0n)), Bool.or(Nat.is_eq(h, 47n), L.contains(t, 47n))), Bool.not(Bool.and(N.char_ok(h), N.chars_ok(t)))),
        Lemma.chars_sep(t),
        Lemma.mp(
          L.implies(Bool.or(Nat.is_eq(h, 0n), Nat.is_eq(h, 47n)), Bool.not(N.char_ok(h))),
          L.implies(L.implies(Bool.or(L.contains(t, 0n), L.contains(t, 47n)), Bool.not(N.chars_ok(t))), L.implies(Bool.or(Bool.or(Nat.is_eq(h, 0n), L.contains(t, 0n)), Bool.or(Nat.is_eq(h, 47n), L.contains(t, 47n))), Bool.not(Bool.and(N.char_ok(h), N.chars_ok(t))))),
          Lemma.char_sep(h),
          Lemma.sep_step(Nat.is_eq(h, 0n), L.contains(t, 0n), Nat.is_eq(h, 47n), L.contains(t, 47n), N.char_ok(h), N.chars_ok(t))))

def Lemma.sep_name(s: Bool, a: Bool, b: Bool, c: Bool, d: Bool) -> {L.implies(L.implies(s, Bool.not(c)), L.implies(s, Bool.not(Bool.and(Bool.and(a, b), Bool.and(c, d))))) == True{} : Bool}:
  match s:
    case False{}:
      {==}
    case True{}:
      match a:
        case False{}:
          match b:
            case False{}:
              match c:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match c:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case True{}:
          match b:
            case False{}:
              match c:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match c:
                case False{}:
                  {==}
                case True{}:
                  {==}

def Lemma.and_r(x: Bool, y: Bool) -> {L.implies(Bool.and(x, y), y) == True{} : Bool}:
  match x:
    case False{}:
      {==}
    case True{}:
      match y:
        case False{}:
          {==}
        case True{}:
          {==}

def Lemma.name_bound_bool(x: Bool, y: Bool, z: Bool) -> {L.implies(Bool.and(x, Bool.and(y, z)), z) == True{} : Bool}:
  match x:
    case False{}:
      {==}
    case True{}:
      match y:
        case False{}:
          {==}
        case True{}:
          match z:
            case False{}:
              {==}
            case True{}:
              {==}

# The module's `utf8_width` and the specification's `utf8_bytes` agree.
def Lemma.lt_zero(c: Nat) -> {Nat.is_lt(c, 0n) == False{} : Bool}:
  match c:
    case 0n:
      {==}
    case 1n+p:
      {==}

def Lemma.lt_le(+c: Nat, +n: Nat) -> {Nat.is_lt(c, 1n+n) == Nat.is_le(c, n) : Bool}:
  match c n:
    case 0n 0n:
      {==}
    case 0n 1n+np:
      {==}
    case 1n+cp 0n:
      Lemma.lt_zero(cp)
    case 1n+cp 1n+np:
      Lemma.lt_le(cp, np)

def Lemma.width_pick(x: Bool, y: Bool, z: Bool) -> {N.utf8_width_pick(x, y, z) == Bool.pick(Nat, x, 1n, Bool.pick(Nat, y, 2n, Bool.pick(Nat, z, 3n, 4n))) : Nat}:
  match x y z:
    case True{} _ _:
      {==}
    case False{} True{} _:
      {==}
    case False{} False{} True{}:
      {==}
    case False{} False{} False{}:
      {==}

def Lemma.width(+c: Nat) -> {N.utf8_width(c) == L.utf8_bytes(c) : Nat}:
  %Lemma.lt_le(c, 127n) : {N.utf8_width(c) == Bool.pick(Nat, _, 1n, Bool.pick(Nat, Nat.is_le(c, 2047n), 2n, Bool.pick(Nat, Nat.is_le(c, 65535n), 3n, 4n))) : Nat}
  %Lemma.lt_le(c, 2047n) : {N.utf8_width(c) == Bool.pick(Nat, Nat.is_lt(c, 1n+127n), 1n, Bool.pick(Nat, _, 2n, Bool.pick(Nat, Nat.is_le(c, 65535n), 3n, 4n))) : Nat}
  %Lemma.lt_le(c, 65535n) : {N.utf8_width(c) == Bool.pick(Nat, Nat.is_lt(c, 1n+127n), 1n, Bool.pick(Nat, Nat.is_lt(c, 1n+2047n), 2n, Bool.pick(Nat, _, 3n, 4n))) : Nat}
  Lemma.width_pick(Nat.is_lt(c, 128n), Nat.is_lt(c, 2048n), Nat.is_lt(c, 65536n))

def Lemma.utf8(+xs: +List<Nat>) -> {N.utf8_length(xs) == L.utf8_size(xs) : Nat}:
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      %Lemma.utf8(t) : {Nat.add(N.utf8_width(h), N.utf8_length(t)) == Nat.add(L.utf8_bytes(h), _) : Nat}
      %Lemma.width(h) : {Nat.add(N.utf8_width(h), N.utf8_length(t)) == Nat.add(_, N.utf8_length(t)) : Nat}
      {==}

def Lemma.path(+xss: +List<+List<Nat>>) -> {N.path_length(xss) == L.path_size(xss) : Nat}:
  match xss:
    case Nil{}:
      {==}
    case Con{h, t}:
      %Lemma.path(t) : {1n+Nat.add(N.utf8_length(h), N.path_length(t)) == 1n+Nat.add(L.utf8_size(h), _) : Nat}
      %Lemma.utf8(h) : {1n+Nat.add(N.utf8_length(h), N.path_length(t)) == 1n+Nat.add(_, N.path_length(t)) : Nat}
      {==}

def Lemma.name_bound(+xs: +List<Nat>) -> {L.implies(N.name_ok(xs), Bool.and(L.nonempty(xs), Nat.is_le(N.utf8_length(xs), 255n))) == True{} : Bool}:
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      Lemma.name_bound_bool(Bool.not(N.is_dots(h <> t)), N.chars_ok(h <> t), Nat.is_le(N.utf8_length(h <> t), 255n))

# --- Exact byte ranges ---

def Lemma.sub_zero(n: Nat) -> {n == Nat.sub(n, 0n) : Nat}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      {==}

# Truncated subtraction of min(n, s) from s is truncated subtraction of n.
def Lemma.sub_min(+s: Nat, +n: Nat) -> {Nat.sub(s, Nat.min(n, s)) == Nat.sub(s, n) : Nat}:
  match s n:
    case 0n _:
      {==}
    case 1n+sp 0n:
      {==}
    case 1n+sp 1n+np:
      Lemma.sub_min(sp, np)

def Lemma.to_exact_pick(c: Bool, -f: Nat, -l: Nat, -sp: Nat) -> {R.span_to(c, f, l, 1n+sp) == Bool.pick(R.Resolved, Bool.not(c), R.Unsatisfiable{}, R.Span{f, 1n+Nat.min(l, sp)}) : R.Resolved}:
  match c:
    case True{}:
      {==}
    case False{}:
      {==}

def Lemma.to_exact_empty(f: Nat, -l: Nat) -> {R.span_to(Nat.is_lt(f, 0n), f, l, 0n) == Bool.pick(R.Resolved, Nat.is_ge(f, 0n), R.Unsatisfiable{}, R.Span{f, 1n+Nat.min(l, Nat.sub(0n, 1n))}) : R.Resolved}:
  match f:
    case 0n:
      {==}
    case 1n+p:
      {==}

def Lemma.to_exact(+s: Nat, +f: Nat, +l: Nat) -> {R.span_to(Nat.is_lt(f, s), f, l, s) == Bool.pick(R.Resolved, Nat.is_ge(f, s), R.Unsatisfiable{}, R.Span{f, 1n+Nat.min(l, Nat.sub(s, 1n))}) : R.Resolved}:
  match s:
    case 0n:
      Lemma.to_exact_empty(f, l)
    case 1n+sp:
      %Lemma.sub_zero(sp) : {R.span_to(Nat.is_lt(f, 1n+sp), f, l, 1n+sp) == Bool.pick(R.Resolved, Nat.is_ge(f, 1n+sp), R.Unsatisfiable{}, R.Span{f, 1n+Nat.min(l, _)}) : R.Resolved}
      %Lemma.not_lt_ge(f, 1n+sp) : {R.span_to(Nat.is_lt(f, 1n+sp), f, l, 1n+sp) == Bool.pick(R.Resolved, _, R.Unsatisfiable{}, R.Span{f, 1n+Nat.min(l, sp)}) : R.Resolved}
      Lemma.to_exact_pick(Nat.is_lt(f, 1n+sp), f, l, sp)

def Lemma.from_exact(c: Bool, -f: Nat, -s: Nat) -> {R.span_from(c, f, s) == Bool.pick(R.Resolved, Bool.not(c), R.Unsatisfiable{}, R.Span{f, s}) : R.Resolved}:
  match c:
    case True{}:
      {==}
    case False{}:
      {==}

def Lemma.suffix_exact(c: Bool, -n: Nat, -s: Nat) -> {R.span_suffix(c, n, s) == Bool.pick(R.Resolved, c, R.Unsatisfiable{}, R.Span{Nat.sub(s, Nat.min(n, s)), s}) : R.Resolved}:
  match c:
    case True{}:
      {==}
    case False{}:
      {==}

# --- Exact names ---

def Lemma.and_true(x: Bool) -> {Bool.and(x, True{}) == x : Bool}:
  match x:
    case False{}:
      {==}
    case True{}:
      {==}

def Lemma.dots2(x: Bool, y: Bool) -> {Bool.and(x, Bool.and(y, True{})) == Bool.and(x, y) : Bool}:
  match x:
    case False{}:
      {==}
    case True{}:
      match y:
        case False{}:
          {==}
        case True{}:
          {==}

def Lemma.dots3(x: Bool, y: Bool) -> {Bool.and(x, Bool.and(y, False{})) == False{} : Bool}:
  match x:
    case False{}:
      {==}
    case True{}:
      match y:
        case False{}:
          {==}
        case True{}:
          {==}

def Lemma.char_bool(e0: Bool, e47: Bool, lt1: Bool, gt1: Bool, le2: Bool) -> {Bool.and(Bool.and(Bool.not(e0), Bool.not(e47)), Bool.and(Bool.or(lt1, gt1), le2)) == Bool.not(Bool.or(Bool.or(e0, e47), Bool.or(Bool.and(Bool.not(lt1), Bool.not(gt1)), Bool.not(le2)))) : Bool}:
  match e0:
    case False{}:
      match e47:
        case False{}:
          match lt1:
            case False{}:
              match gt1:
                case False{}:
                  {==}
                case True{}:
                  match le2:
                    case False{}:
                      {==}
                    case True{}:
                      {==}
            case True{}:
              match gt1:
                case False{}:
                  match le2:
                    case False{}:
                      {==}
                    case True{}:
                      {==}
                case True{}:
                  match le2:
                    case False{}:
                      {==}
                    case True{}:
                      {==}
        case True{}:
          {==}
    case True{}:
      {==}

def Lemma.name_bool(a: Bool, b: Bool, c: Bool, d: Bool) -> {Bool.and(Bool.and(a, b), Bool.and(c, d)) == Bool.and(a, Bool.and(b, Bool.and(c, d))) : Bool}:
  match a:
    case False{}:
      {==}
    case True{}:
      match b:
        case False{}:
          {==}
        case True{}:
          match c:
            case False{}:
              {==}
            case True{}:
              match d:
                case False{}:
                  {==}
                case True{}:
                  {==}

def Lemma.not_gt_le(x: Nat, y: Nat) -> {Bool.not(Nat.is_gt(x, y)) == Nat.is_le(x, y) : Bool}:
  match x y:
    case 0n 0n:
      {==}
    case 0n 1n+yp:
      {==}
    case 1n+xp 0n:
      {==}
    case 1n+xp 1n+yp:
      Lemma.not_gt_le(xp, yp)

def Lemma.not_le_gt(x: Nat, y: Nat) -> {Bool.not(Nat.is_le(x, y)) == Nat.is_gt(x, y) : Bool}:
  match x y:
    case 0n 0n:
      {==}
    case 0n 1n+yp:
      {==}
    case 1n+xp 0n:
      {==}
    case 1n+xp 1n+yp:
      Lemma.not_le_gt(xp, yp)

def Lemma.dots(+xs: +List<Nat>) -> {N.is_dots(xs) == L.dot_name(xs) : Bool}:
  match xs:
    case Nil{}:
      {==}
    case Con{a, t}:
      match t:
        case Nil{}:
          Lemma.and_true(Nat.is_eq(a, 46n))
        case Con{b, u}:
          match u:
            case Nil{}:
              Lemma.dots2(Nat.is_eq(a, 46n), Nat.is_eq(b, 46n))
            case Con{c, v}:
              Lemma.dots3(Nat.is_eq(a, 46n), Nat.is_eq(b, 46n))

def Lemma.char(+c: Nat) -> {N.char_ok(c) == L.allowed(c) : Bool}:
  %Lemma.not_lt_ge(c, 55296n) : {N.char_ok(c) == Bool.not(Bool.or(Bool.or(Nat.is_eq(c, 0n), Nat.is_eq(c, 47n)), Bool.or(Bool.and(_, Nat.is_le(c, 57343n)), Nat.is_gt(c, 1114111n)))) : Bool}
  %Lemma.not_gt_le(c, 57343n) : {N.char_ok(c) == Bool.not(Bool.or(Bool.or(Nat.is_eq(c, 0n), Nat.is_eq(c, 47n)), Bool.or(Bool.and(Bool.not(Nat.is_lt(c, 55296n)), _), Nat.is_gt(c, 1114111n)))) : Bool}
  %Lemma.not_le_gt(c, 1114111n) : {N.char_ok(c) == Bool.not(Bool.or(Bool.or(Nat.is_eq(c, 0n), Nat.is_eq(c, 47n)), Bool.or(Bool.and(Bool.not(Nat.is_lt(c, 55296n)), Bool.not(Nat.is_gt(c, 57343n))), _))) : Bool}
  Lemma.char_bool(Nat.is_eq(c, 0n), Nat.is_eq(c, 47n), Nat.is_lt(c, 55296n), Nat.is_gt(c, 57343n), Nat.is_le(c, 1114111n))

def Lemma.chars(+xs: +List<Nat>) -> {N.chars_ok(xs) == L.all_allowed(xs) : Bool}:
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      %Lemma.chars(t) : {Bool.and(N.char_ok(h), N.chars_ok(t)) == Bool.and(L.allowed(h), _) : Bool}
      %Lemma.char(h) : {Bool.and(N.char_ok(h), N.chars_ok(t)) == Bool.and(_, N.chars_ok(t)) : Bool}
      {==}

def Lemma.nonempty(+xs: +List<Nat>) -> {Bool.not(List.is_empty(&2, Nat, xs)) == L.nonempty(xs) : Bool}:
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      {==}

# --- Imports ---

def Lemma.or_assoc(f: Bool, e: Bool, c: Bool) -> {Bool.or(f, Bool.or(e, c)) == Bool.or(Bool.or(f, e), c) : Bool}:
  match f:
    case False{}:
      {==}
    case True{}:
      {==}

def Lemma.or_false(f: Bool) -> {Bool.or(f, False{}) == f : Bool}:
  match f:
    case False{}:
      {==}
    case True{}:
      {==}

def Lemma.member_go(+xs: +List<Nat>, +n: Nat, +f: Bool) -> {Bool.or(f, L.contains(xs, n)) == I.member_go(xs, n, f) : Bool}:
  match xs:
    case Nil{}:
      Lemma.or_false(f)
    case Con{h, t}:
      %Lemma.member_go(t, n, Bool.or(f, Nat.is_eq(h, n))) : {Bool.or(f, L.contains(Con{h, t}, n)) == _ : Bool}
      Lemma.or_assoc(f, Nat.is_eq(h, n), L.contains(t, n))

def Lemma.member(+xs: +List<Nat>, +n: Nat) -> {L.contains(xs, n) == I.member(xs, n) : Bool}:
  Lemma.member_go(xs, n, False{})

def Lemma.known(+xs: +List<Nat>, +k: +List<Nat>) -> {L.keys_known(xs, k) == I.all_known(xs, k) : Bool}:
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      %Lemma.known(t, k) : {L.keys_known(Con{h, t}, k) == Bool.and(I.member(k, h), _) : Bool}
      %Lemma.member(k, h) : {L.keys_known(Con{h, t}, k) == Bool.and(_, L.keys_known(t, k)) : Bool}
      {==}

def Lemma.fresh(+xs: +List<Nat>, +k: +List<Nat>) -> {L.keys_fresh(xs, k) == I.all_new(xs, k) : Bool}:
  match xs:
    case Nil{}:
      {==}
    case Con{+h, t}:
      %Lemma.fresh(t, Con{h, k}) : {L.keys_fresh(Con{h, t}, k) == Bool.and(Bool.not(I.member(k, h)), _) : Bool}
      %Lemma.member(k, h) : {L.keys_fresh(Con{h, t}, k) == Bool.and(Bool.not(_), L.keys_fresh(t, Con{h, k})) : Bool}
      {==}

def Lemma.extend(+xs: +List<Nat>, +k: +List<Nat>) -> {L.extend(xs, k) == I.prepend(xs, k) : +List<Nat>}:
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      %Lemma.extend(t, k) : {L.extend(Con{h, t}, k) == Con{h, _} : +List<Nat>}
      {==}

def Lemma.swap(a: Bool, b: Bool, c: Bool, d: Bool) -> {Bool.and(Bool.and(a, c), Bool.and(b, d)) == Bool.and(Bool.and(a, b), Bool.and(c, d)) : Bool}:
  match a:
    case False{}:
      {==}
    case True{}:
      match b:
        case False{}:
          match c:
            case False{}:
              {==}
            case True{}:
              match d:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case True{}:
          {==}

def Lemma.swap2(ok: Bool, a: Bool, b: Bool, c: Bool, d: Bool) -> {Bool.and(ok, Bool.and(Bool.and(a, c), Bool.and(b, d))) == Bool.and(Bool.and(ok, Bool.and(a, b)), Bool.and(c, d)) : Bool}:
  match ok:
    case False{}:
      {==}
    case True{}:
      Lemma.swap(a, b, c, d)

def Lemma.valid_go(+e: +List<I.Entry>, +k: +List<Nat>, +ok: Bool) -> {Bool.and(ok, L.spec_valid(e, k)) == I.valid_go(e, k, ok) : Bool}:
  match e:
    case Nil{}:
      Lemma.and_true(ok)
    case Con{h, t}:
      match h:
        case I.Entry{+d, +n}:
          %Lemma.valid_go(t, I.prepend(d, k), Bool.and(ok, Bool.and(I.all_known(n, k), I.all_new(d, k)))) : {Bool.and(ok, L.spec_valid(Con{I.Entry{d, n}, t}, k)) == _ : Bool}
          %Lemma.extend(d, k) : {Bool.and(ok, L.spec_valid(Con{I.Entry{d, n}, t}, k)) == Bool.and(Bool.and(ok, Bool.and(I.all_known(n, k), I.all_new(d, k))), L.spec_valid(t, _)) : Bool}
          %Lemma.known(n, k) : {Bool.and(ok, L.spec_valid(Con{I.Entry{d, n}, t}, k)) == Bool.and(Bool.and(ok, Bool.and(_, I.all_new(d, k))), L.spec_valid(t, L.extend(d, k))) : Bool}
          %Lemma.fresh(d, k) : {Bool.and(ok, L.spec_valid(Con{I.Entry{d, n}, t}, k)) == Bool.and(Bool.and(ok, Bool.and(L.keys_known(n, k), _)), L.spec_valid(t, L.extend(d, k))) : Bool}
          Lemma.swap2(ok, L.keys_known(n, k), L.keys_fresh(d, k), L.needs_met(t, L.extend(d, k)), L.defines_fresh(t, L.extend(d, k)))

def Lemma.valid(+e: +List<I.Entry>, +k: +List<Nat>) -> {L.spec_valid(e, k) == I.valid(e, k) : Bool}:
  Lemma.valid_go(e, k, True{})

def Lemma.decide(b: Bool, +e: +List<I.Entry>) -> {I.decide(b, e) == Bool.pick(I.Plan, b, I.Apply{e}, I.Reject{}) : I.Plan}:
  match b:
    case False{}:
      {==}
    case True{}:
      {==}

def L.write_into_folder(target, parent):
  match target:
    case T.Absent{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case T.File{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case T.Folder{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}

def L.write_replaces_existing(target, parent):
  match target:
    case T.Absent{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case T.File{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case T.Folder{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}

def L.mkcol_creates_new(root, target, parent):
  match root:
    case False{}:
      match target:
        case T.Absent{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
        case T.File{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
        case T.Folder{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
    case True{}:
      match target:
        case T.Absent{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
        case T.File{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
        case T.Folder{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}

def L.remove_keeps_root(root, target):
  match root:
    case False{}:
      match target:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case True{}:
      match target:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}

def L.copy_decides_in_order(source, inside, dest_root, dest, parent, overwrite):
  match source:
    case T.Absent{}:
      match inside:
        case False{}:
          match dest_root:
            case False{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
        case True{}:
          match dest_root:
            case False{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
    case T.File{}:
      match inside:
        case False{}:
          match dest_root:
            case False{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
        case True{}:
          match dest_root:
            case False{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
    case T.Folder{}:
      match inside:
        case False{}:
          match dest_root:
            case False{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
        case True{}:
          match dest_root:
            case False{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}

def L.move_decides_in_order(source_root, source, inside, dest_root, dest, parent, overwrite):
  match source_root:
    case False{}:
      match source:
        case T.Absent{}:
          match inside:
            case False{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
            case True{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
        case T.File{}:
          match inside:
            case False{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
            case True{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
        case T.Folder{}:
          match inside:
            case False{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
            case True{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
    case True{}:
      match source:
        case T.Absent{}:
          match inside:
            case False{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
            case True{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
        case T.File{}:
          match inside:
            case False{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
            case True{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
        case T.Folder{}:
          match inside:
            case False{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
            case True{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}

def L.limit_exact(count, limit):
  match count limit:
    case 0n 0n:
      {==}
    case 0n 1n+l:
      {==}
    case 1n+c 0n:
      {==}
    case 1n+c 1n+l:
      L.limit_exact(c, l)

def L.resume_into_collection(journal, dest):
  match journal:
    case False{}:
      match dest:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case True{}:
      match dest:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}

def L.resume_needs_journal(journal, dest):
  match journal:
    case False{}:
      match dest:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case True{}:
      match dest:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}

def L.authorize_matches_spec(a, m, target, dest):
  match a:
    case P.ReadOnly{}:
      match m:
        case P.MOptions{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MGet{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MHead{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MPropfind{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MPut{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MMkcol{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MDelete{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MProppatch{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MCopy{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MMove{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MLock{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MUnlock{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MOther{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
    case P.ReadWrite{}:
      match m:
        case P.MOptions{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MGet{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MHead{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MPropfind{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MPut{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MMkcol{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MDelete{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MProppatch{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MCopy{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MMove{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MLock{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MUnlock{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MOther{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}

def L.read_only_never_writes(m, target, dest):
  match m:
    case P.MOptions{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MGet{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MHead{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MPropfind{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MPut{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MMkcol{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MDelete{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MProppatch{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MCopy{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MMove{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MLock{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MUnlock{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MOther{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}

def L.denied_outside_scope(a, m, dest):
  match a:
    case P.ReadOnly{}:
      match m:
        case P.MOptions{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MGet{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MHead{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MPropfind{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MPut{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MMkcol{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MDelete{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MProppatch{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MCopy{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MMove{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MLock{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MUnlock{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MOther{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.ReadWrite{}:
      match m:
        case P.MOptions{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MGet{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MHead{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MPropfind{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MPut{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MMkcol{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MDelete{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MProppatch{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MCopy{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MMove{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MLock{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MUnlock{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MOther{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}

def L.preconditions_in_rfc_order(read, if_match, if_unmodified, if_none_match, if_modified):
  match read:
    case False{}:
      match if_match:
        case C.Unset{}:
          match if_unmodified:
            case C.Unset{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Holds{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Fails{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
        case C.Holds{}:
          match if_unmodified:
            case C.Unset{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Holds{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Fails{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
        case C.Fails{}:
          match if_unmodified:
            case C.Unset{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Holds{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Fails{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
    case True{}:
      match if_match:
        case C.Unset{}:
          match if_unmodified:
            case C.Unset{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Holds{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Fails{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
        case C.Holds{}:
          match if_unmodified:
            case C.Unset{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Holds{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Fails{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
        case C.Fails{}:
          match if_unmodified:
            case C.Unset{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Holds{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Fails{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}

def L.write_decides_in_order(target, parent):
  match target:
    case T.Absent{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case T.File{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case T.Folder{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}

def L.mkcol_decides_in_order(root, target, parent):
  match root:
    case False{}:
      match target:
        case T.Absent{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
        case T.File{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
        case T.Folder{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
    case True{}:
      match target:
        case T.Absent{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
        case T.File{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
        case T.Folder{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}

def L.remove_decides_in_order(root, target):
  match root:
    case False{}:
      match target:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case True{}:
      match target:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}

def L.scope_outside_denied(a, m, dest):
  match a:
    case P.ReadOnly{}:
      match m:
        case P.MOptions{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MGet{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MHead{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MPropfind{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MPut{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MMkcol{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MDelete{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MProppatch{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MCopy{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MMove{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MLock{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MUnlock{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MOther{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
    case P.ReadWrite{}:
      match m:
        case P.MOptions{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MGet{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MHead{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MPropfind{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MPut{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MMkcol{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MDelete{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MProppatch{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MCopy{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MMove{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MLock{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MUnlock{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MOther{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}

def L.scope_above_only_browses(a, m, dest):
  match a:
    case P.ReadOnly{}:
      match m:
        case P.MOptions{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MGet{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MHead{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MPropfind{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MPut{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MMkcol{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MDelete{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MProppatch{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MCopy{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MMove{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MLock{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MUnlock{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MOther{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
    case P.ReadWrite{}:
      match m:
        case P.MOptions{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MGet{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MHead{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MPropfind{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MPut{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MMkcol{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MDelete{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MProppatch{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MCopy{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MMove{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MLock{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MUnlock{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MOther{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}

def L.scope_inside_as_unscoped(a, m, dest):
  match a:
    case P.ReadOnly{}:
      match m:
        case P.MOptions{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MGet{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MHead{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MPropfind{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MPut{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MMkcol{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MDelete{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MProppatch{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MCopy{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MMove{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MLock{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MUnlock{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MOther{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
    case P.ReadWrite{}:
      match m:
        case P.MOptions{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MGet{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MHead{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MPropfind{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MPut{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MMkcol{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MDelete{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MProppatch{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MCopy{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MMove{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MLock{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MUnlock{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}
        case P.MOther{}:
          match dest:
            case P.Inside{}:
              {==}
            case P.Above{}:
              {==}
            case P.Outside{}:
              {==}

def L.scope_destination_inside(a, m, target, dest):
  match a:
    case P.ReadOnly{}:
      match m:
        case P.MOptions{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MGet{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MHead{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MPropfind{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MPut{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MMkcol{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MDelete{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MProppatch{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MCopy{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MMove{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MLock{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MUnlock{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MOther{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
    case P.ReadWrite{}:
      match m:
        case P.MOptions{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MGet{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MHead{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MPropfind{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MPut{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MMkcol{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MDelete{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MProppatch{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MCopy{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MMove{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MLock{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MUnlock{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
        case P.MOther{}:
          match target:
            case P.Inside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Above{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}
            case P.Outside{}:
              match dest:
                case P.Inside{}:
                  {==}
                case P.Above{}:
                  {==}
                case P.Outside{}:
                  {==}

def L.range_inside(spec, size):
  match spec:
    case R.FromTo{+first, +last}:
      %Lemma.to_pick(Nat.is_lt(first, size), first, last, size) : {_ == True{} : Bool}
      Lemma.to_inside(first, last, size)
    case R.From{+first}:
      %Lemma.from_pick(Nat.is_lt(first, size), first, size) : {_ == True{} : Bool}
      Lemma.from_inside(first, size)
    case R.Suffix{+length}:
      %Lemma.suffix_pick(Bool.or(Nat.is_eq(length, 0n), Nat.is_eq(size, 0n)), length, size) : {_ == True{} : Bool}
      Lemma.suffix_inside(length, size)

def L.range_unsatisfiable_exactly(spec, size):
  match spec:
    case R.FromTo{+first, +last}:
      %Lemma.to_unsatisfiable(Nat.is_lt(first, size), first, last, size) : {_ == Nat.is_ge(first, size) : Bool}
      Lemma.not_lt_ge(first, size)
    case R.From{+first}:
      %Lemma.from_unsatisfiable(Nat.is_lt(first, size), first, size) : {_ == Nat.is_ge(first, size) : Bool}
      Lemma.not_lt_ge(first, size)
    case R.Suffix{+length}:
      %Lemma.suffix_unsatisfiable(Bool.or(Nat.is_eq(length, 0n), Nat.is_eq(size, 0n)), length, size) : {_ == Bool.or(L.zero(length), L.zero(size)) : Bool}
      Lemma.suffix_empty(length, size)

def L.range_exact(spec, size):
  match spec:
    case R.FromTo{+first, +last}:
      Lemma.to_exact(size, first, last)
    case R.From{+first}:
      %Lemma.not_lt_ge(first, size) : {R.span_from(Nat.is_lt(first, size), first, size) == Bool.pick(R.Resolved, _, R.Unsatisfiable{}, R.Span{first, size}) : R.Resolved}
      Lemma.from_exact(Nat.is_lt(first, size), first, size)
    case R.Suffix{+length}:
      %Lemma.sub_min(size, length) : {R.span_suffix(Bool.or(Nat.is_eq(length, 0n), Nat.is_eq(size, 0n)), length, size) == Bool.pick(R.Resolved, Bool.or(L.zero(length), L.zero(size)), R.Unsatisfiable{}, R.Span{_, size}) : R.Resolved}
      %Lemma.suffix_empty(length, size) : {R.span_suffix(Bool.or(Nat.is_eq(length, 0n), Nat.is_eq(size, 0n)), length, size) == Bool.pick(R.Resolved, _, R.Unsatisfiable{}, R.Span{Nat.sub(size, Nat.min(length, size)), size}) : R.Resolved}
      Lemma.suffix_exact(Bool.or(Nat.is_eq(length, 0n), Nat.is_eq(size, 0n)), length, size)

def L.name_rejects_dots():
  {==}

def L.name_rejects_separators(xs):
  Lemma.mp(
    L.implies(Bool.or(L.contains(xs, 0n), L.contains(xs, 47n)), Bool.not(N.chars_ok(xs))),
    L.implies(Bool.or(L.contains(xs, 0n), L.contains(xs, 47n)), Bool.not(N.name_ok(xs))),
    Lemma.chars_sep(xs),
    Lemma.sep_name(Bool.or(L.contains(xs, 0n), L.contains(xs, 47n)), Bool.not(List.is_empty(&2, Nat, xs)), Bool.not(N.is_dots(xs)), N.chars_ok(xs), Nat.is_le(N.utf8_length(xs), 255n)))

def L.name_bounded(xs):
  %Lemma.utf8(xs) : {L.implies(N.name_ok(xs), Bool.and(L.nonempty(xs), Nat.is_le(_, 255n))) == True{} : Bool}
  Lemma.name_bound(xs)

def L.path_bounded(xss):
  %Lemma.path(xss) : {L.implies(N.path_ok(xss), Nat.is_le(_, 900n)) == True{} : Bool}
  Lemma.and_r(N.names_ok(xss), Nat.is_le(N.path_length(xss), 900n))

def L.name_accepted(xs):
  %Lemma.nonempty(xs) : {N.name_ok(xs) == Bool.and(_, Bool.and(Bool.not(L.dot_name(xs)), Bool.and(L.all_allowed(xs), Nat.is_le(L.utf8_size(xs), 255n)))) : Bool}
  %Lemma.dots(xs) : {N.name_ok(xs) == Bool.and(Bool.not(List.is_empty(&2, Nat, xs)), Bool.and(Bool.not(_), Bool.and(L.all_allowed(xs), Nat.is_le(L.utf8_size(xs), 255n)))) : Bool}
  %Lemma.chars(xs) : {N.name_ok(xs) == Bool.and(Bool.not(List.is_empty(&2, Nat, xs)), Bool.and(Bool.not(N.is_dots(xs)), Bool.and(_, Nat.is_le(L.utf8_size(xs), 255n)))) : Bool}
  %Lemma.utf8(xs) : {N.name_ok(xs) == Bool.and(Bool.not(List.is_empty(&2, Nat, xs)), Bool.and(Bool.not(N.is_dots(xs)), Bool.and(N.chars_ok(xs), Nat.is_le(_, 255n)))) : Bool}
  Lemma.name_bool(Bool.not(List.is_empty(&2, Nat, xs)), Bool.not(N.is_dots(xs)), N.chars_ok(xs), Nat.is_le(N.utf8_length(xs), 255n))

def L.import_all_or_nothing(entries, known):
  %Lemma.valid(entries, known) : {I.decide(_, entries) == Bool.pick(I.Plan, L.spec_valid(entries, known), I.Apply{entries}, I.Reject{}) : I.Plan}
  Lemma.decide(L.spec_valid(entries, known), entries)

def L.copy_writes_safely(s, t, overwrite):
  match s:
    case M.SFile{}:
      match t:
        case M.TAbsent{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TSame{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TDiffers{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TFolder{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
    case M.SFolder{}:
      match t:
        case M.TAbsent{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TSame{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TDiffers{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TFolder{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}

def L.copy_skips_what_is_there(s, t, overwrite):
  match s:
    case M.SFile{}:
      match t:
        case M.TAbsent{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TSame{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TDiffers{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TFolder{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
    case M.SFolder{}:
      match t:
        case M.TAbsent{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TSame{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TDiffers{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TFolder{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}

def L.copy_action_exact(s, t, overwrite):
  match s:
    case M.SFile{}:
      match t:
        case M.TAbsent{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TSame{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TDiffers{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TFolder{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
    case M.SFolder{}:
      match t:
        case M.TAbsent{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TSame{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TDiffers{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
        case M.TFolder{}:
          match overwrite:
            case False{}:
              {==}
            case True{}:
              {==}
