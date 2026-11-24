import Base
import ./src/transfer.bend as T
import ./src/policy.bend as P
import ./src/preconditions.bend as C
import ./src/ranges.bend as R
import ./src/names.bend as N
import ./src/imports.bend as I
import ./src/copying.bend as M
import ./src/locks.bend as K
import ./src/statuses.bend as S
import ./src/properties.bend as F
import ./src/objects.bend as O
import ./src/mounts.bend as W
import ./src/framing.bend as H
import ./src/verification.bend as U

# The laws of Davloom's decision logic (PRD §4, Proven Domain Logic). Each law compares a shipped
# module with a specification written here, independently of the module, from the RFC text or the
# PRD. PROOF.bend proves every law; `bun run laws:check` runs both checkers.

def implies(a: Bool, b: Bool) -> Bool:
  Bool.or(Bool.not(a), b)

def exists(n: T.Node) -> Bool:
  match n:
    case T.Absent{}:
      False{}
    case T.File{}:
      True{}
    case T.Folder{}:
      True{}

def folder(n: T.Node) -> Bool:
  match n:
    case T.Absent{}:
      False{}
    case T.File{}:
      False{}
    case T.Folder{}:
      True{}

def proceeds(o: T.Outcome) -> Bool:
  match o:
    case T.Proceed{r}:
      True{}
    case T.Missing{}:
      False{}
    case T.NoParent{}:
      False{}
    case T.Exists{}:
      False{}
    case T.IsFolder{}:
      False{}
    case T.IntoItself{}:
      False{}
    case T.Root{}:
      False{}

def replaces(o: T.Outcome) -> Bool:
  match o:
    case T.Proceed{r}:
      r
    case T.Missing{}:
      False{}
    case T.NoParent{}:
      False{}
    case T.Exists{}:
      False{}
    case T.IsFolder{}:
      False{}
    case T.IntoItself{}:
      False{}
    case T.Root{}:
      False{}

# --- Namespace operations (RFC 4918 §9.3, §9.6 to §9.9) ----------------------------------------

# PUT never writes over a collection, and writes only into an existing collection.
law write_into_folder:
  for target: T.Node
  for parent: T.Node
  {implies(proceeds(T.decide_write(target, parent)), Bool.and(Bool.not(folder(target)), folder(parent))) == True{} : Bool}

# PUT reports a replacement exactly when a file was there.
law write_replaces_existing:
  for target: T.Node
  for parent: T.Node
  {implies(proceeds(T.decide_write(target, parent)), Bool.and(implies(replaces(T.decide_write(target, parent)), exists(target)), implies(exists(target), replaces(T.decide_write(target, parent))))) == True{} : Bool}

# MKCOL creates only where nothing is, never the root, and only inside a collection.
law mkcol_creates_new:
  for root: Bool
  for target: T.Node
  for parent: T.Node
  {implies(proceeds(T.decide_mkcol(root, target, parent)), Bool.and(Bool.not(root), Bool.and(Bool.not(exists(target)), folder(parent)))) == True{} : Bool}

# DELETE never removes the root, and removes only what exists.
law remove_keeps_root:
  for root: Bool
  for target: T.Node
  {implies(proceeds(T.decide_remove(root, target)), Bool.and(Bool.not(root), exists(target))) == True{} : Bool}

# The specification of COPY's outcome: its errors in the order the storage contract states.
def spec_copy(+source: T.Node, +inside: Bool, +dest_root: Bool, +dest: T.Node, +parent: T.Node, +overwrite: Bool) -> T.Outcome:
  Bool.pick(T.Outcome, Bool.not(exists(source)), T.Missing{},
    Bool.pick(T.Outcome, inside, T.IntoItself{},
      Bool.pick(T.Outcome, dest_root, T.Root{},
        Bool.pick(T.Outcome, Bool.and(exists(dest), Bool.not(overwrite)), T.Exists{},
          Bool.pick(T.Outcome, Bool.not(folder(parent)), T.NoParent{}, T.Proceed{exists(dest)})))))

# COPY decides as the specification does, for every set of facts.
law copy_decides_in_order:
  for source: T.Node
  for inside: Bool
  for dest_root: Bool
  for dest: T.Node
  for parent: T.Node
  for overwrite: Bool
  {T.decide_copy(source, inside, dest_root, dest, parent, overwrite) == spec_copy(source, inside, dest_root, dest, parent, overwrite) : T.Outcome}

# MOVE never moves the root, and otherwise decides as COPY does.
law move_decides_in_order:
  for source_root: Bool
  for source: T.Node
  for inside: Bool
  for dest_root: Bool
  for dest: T.Node
  for parent: T.Node
  for overwrite: Bool
  {T.decide_move(source_root, source, inside, dest_root, dest, parent, overwrite) == Bool.pick(T.Outcome, source_root, T.Root{}, spec_copy(source, inside, dest_root, dest, parent, overwrite)) : T.Outcome}

# --- The synchronous limit and recovery of moves (PRD §5) --------------------------------------

def spec_fits(+count: Nat, +limit: Nat) -> Bool:
  match count limit:
    case 0n _:
      True{}
    case 1n+c 0n:
      False{}
    case 1n+c 1n+l:
      spec_fits(c, l)

# A copy or move proceeds exactly when its entries are at most the limit.
law limit_exact:
  for +count: Nat
  for +limit: Nat
  {T.within_limit(count, limit) == spec_fits(count, limit) : Bool}

# A move resumes only into a collection, which an earlier move of the same source filled.
law resume_into_collection:
  for journal: Bool
  for dest: T.Node
  {implies(T.resume_move(journal, dest), folder(dest)) == True{} : Bool}

# A move resumes only when the source records the earlier move to this destination.
law resume_needs_journal:
  for journal: Bool
  for dest: T.Node
  {implies(T.resume_move(journal, dest), journal) == True{} : Bool}

# --- API Key permissions (PRD §6) ------------------------------------------------------------

# The methods that change their request target, per RFC 4918; COPY only reads its source.
def spec_writes_target(m: P.Method) -> Bool:
  match m:
    case P.MOptions{}:
      False{}
    case P.MGet{}:
      False{}
    case P.MHead{}:
      False{}
    case P.MPropfind{}:
      False{}
    case P.MCopy{}:
      False{}
    case P.MPut{}:
      True{}
    case P.MMkcol{}:
      True{}
    case P.MDelete{}:
      True{}
    case P.MProppatch{}:
      True{}
    case P.MMove{}:
      True{}
    case P.MLock{}:
      True{}
    case P.MUnlock{}:
      True{}
    case P.MOther{}:
      True{}

def spec_has_destination(m: P.Method) -> Bool:
  match m:
    case P.MCopy{}:
      True{}
    case P.MMove{}:
      True{}
    case P.MOptions{}:
      False{}
    case P.MGet{}:
      False{}
    case P.MHead{}:
      False{}
    case P.MPropfind{}:
      False{}
    case P.MPut{}:
      False{}
    case P.MMkcol{}:
      False{}
    case P.MDelete{}:
      False{}
    case P.MProppatch{}:
      False{}
    case P.MLock{}:
      False{}
    case P.MUnlock{}:
      False{}
    case P.MOther{}:
      False{}

def spec_known(m: P.Method) -> Bool:
  match m:
    case P.MOther{}:
      False{}
    case P.MOptions{}:
      True{}
    case P.MGet{}:
      True{}
    case P.MHead{}:
      True{}
    case P.MPropfind{}:
      True{}
    case P.MPut{}:
      True{}
    case P.MMkcol{}:
      True{}
    case P.MDelete{}:
      True{}
    case P.MProppatch{}:
      True{}
    case P.MCopy{}:
      True{}
    case P.MMove{}:
      True{}
    case P.MLock{}:
      True{}
    case P.MUnlock{}:
      True{}

def writable(a: P.Access) -> Bool:
  match a:
    case P.ReadOnly{}:
      False{}
    case P.ReadWrite{}:
      True{}

# Access is denied unless a known method, inside the key's scope, needs only what the key grants.
def spec_authorize(+a: P.Access, +m: P.Method, target: Bool, dest: Bool) -> Bool:
  Bool.and(Bool.and(spec_known(m), target),
    Bool.and(implies(spec_writes_target(m), writable(a)),
      implies(spec_has_destination(m), Bool.and(dest, writable(a)))))

law authorize_matches_spec:
  for a: P.Access
  for m: P.Method
  for target: Bool
  for dest: Bool
  {P.authorize(a, m, target, dest) == spec_authorize(a, m, target, dest) : Bool}

# A Read Only key never makes a request that writes.
law read_only_never_writes:
  for m: P.Method
  for target: Bool
  for dest: Bool
  {implies(P.authorize(P.ReadOnly{}, m, target, dest), Bool.not(Bool.or(spec_writes_target(m), spec_has_destination(m)))) == True{} : Bool}

# Nothing outside a key's scope is ever allowed.
law denied_outside_scope:
  for a: P.Access
  for m: P.Method
  for dest: Bool
  {P.authorize(a, m, False{}, dest) == False{} : Bool}

# --- Conditional requests (RFC 9110 §13.2.2) -------------------------------------------------

def unset(c: C.Check) -> Bool:
  match c:
    case C.Unset{}:
      True{}
    case C.Holds{}:
      False{}
    case C.Fails{}:
      False{}

def holds(c: C.Check) -> Bool:
  match c:
    case C.Unset{}:
      False{}
    case C.Holds{}:
      True{}
    case C.Fails{}:
      False{}

def fails(c: C.Check) -> Bool:
  match c:
    case C.Unset{}:
      False{}
    case C.Holds{}:
      False{}
    case C.Fails{}:
      True{}

# Steps 1 to 4 of RFC 9110 §13.2.2, in order.
def spec_evaluate(+read: Bool, +if_match: C.Check, +if_unmodified: C.Check, +if_none_match: C.Check, +if_modified: C.Check) -> C.Verdict:
  Bool.pick(C.Verdict, fails(if_match), C.Failed{},
    Bool.pick(C.Verdict, Bool.and(unset(if_match), fails(if_unmodified)), C.Failed{},
      Bool.pick(C.Verdict, holds(if_none_match), Bool.pick(C.Verdict, read, C.NotModified{}, C.Failed{}),
        Bool.pick(C.Verdict, fails(if_none_match), C.Pass{},
          Bool.pick(C.Verdict, Bool.and(read, fails(if_modified)), C.NotModified{}, C.Pass{})))))

law preconditions_in_rfc_order:
  for read: Bool
  for if_match: C.Check
  for if_unmodified: C.Check
  for if_none_match: C.Check
  for if_modified: C.Check
  {C.evaluate(read, if_match, if_unmodified, if_none_match, if_modified) == spec_evaluate(read, if_match, if_unmodified, if_none_match, if_modified) : C.Verdict}

# --- Full specifications of PUT, MKCOL and DELETE --------------------------------------------

def spec_write(+target: T.Node, +parent: T.Node) -> T.Outcome:
  Bool.pick(T.Outcome, folder(target), T.IsFolder{},
    Bool.pick(T.Outcome, Bool.not(folder(parent)), T.NoParent{}, T.Proceed{exists(target)}))

law write_decides_in_order:
  for target: T.Node
  for parent: T.Node
  {T.decide_write(target, parent) == spec_write(target, parent) : T.Outcome}

def spec_mkcol(+root: Bool, +target: T.Node, +parent: T.Node) -> T.Outcome:
  Bool.pick(T.Outcome, Bool.or(root, exists(target)), T.Exists{},
    Bool.pick(T.Outcome, Bool.not(folder(parent)), T.NoParent{}, T.Proceed{False{}}))

law mkcol_decides_in_order:
  for root: Bool
  for target: T.Node
  for parent: T.Node
  {T.decide_mkcol(root, target, parent) == spec_mkcol(root, target, parent) : T.Outcome}

def spec_remove(+root: Bool, +target: T.Node) -> T.Outcome:
  Bool.pick(T.Outcome, root, T.Root{},
    Bool.pick(T.Outcome, Bool.not(exists(target)), T.Missing{}, T.Proceed{False{}}))

law remove_decides_in_order:
  for root: Bool
  for target: T.Node
  {T.decide_remove(root, target) == spec_remove(root, target) : T.Outcome}

# --- Mount and Path Prefix Scope (PRD §6) ----------------------------------------------------

def inside(r: P.Relation) -> Bool:
  match r:
    case P.Inside{}:
      True{}
    case P.Above{}:
      False{}
    case P.Outside{}:
      False{}

def spec_browses(m: P.Method) -> Bool:
  match m:
    case P.MOptions{}:
      True{}
    case P.MPropfind{}:
      True{}
    case P.MGet{}:
      False{}
    case P.MHead{}:
      False{}
    case P.MPut{}:
      False{}
    case P.MMkcol{}:
      False{}
    case P.MDelete{}:
      False{}
    case P.MProppatch{}:
      False{}
    case P.MCopy{}:
      False{}
    case P.MMove{}:
      False{}
    case P.MLock{}:
      False{}
    case P.MUnlock{}:
      False{}
    case P.MOther{}:
      False{}

# A key never reaches anything outside its roots.
law scope_outside_denied:
  for a: P.Access
  for m: P.Method
  for dest: P.Relation
  {P.authorize_scoped(a, m, P.Outside{}, dest) == False{} : Bool}

# Above its roots a key only browses: OPTIONS and PROPFIND, never a read of content or a write.
law scope_above_only_browses:
  for a: P.Access
  for m: P.Method
  for dest: P.Relation
  {implies(P.authorize_scoped(a, m, P.Above{}, dest), spec_browses(m)) == True{} : Bool}

# Inside its roots a key has exactly the rights of its access level.
law scope_inside_as_unscoped:
  for a: P.Access
  for m: P.Method
  for dest: P.Relation
  {P.authorize_scoped(a, m, P.Inside{}, dest) == spec_authorize(a, m, True{}, inside(dest)) : Bool}

# COPY and MOVE never leave a key's roots: an allowed one has its destination inside them.
law scope_destination_inside:
  for a: P.Access
  for m: P.Method
  for target: P.Relation
  for dest: P.Relation
  {implies(Bool.and(spec_has_destination(m), P.authorize_scoped(a, m, target, dest)), inside(dest)) == True{} : Bool}

# --- Byte ranges (RFC 9110 §14.1) ------------------------------------------------------------

# A range-spec is invalid when its last position is below its first (RFC 9110 §14.1.1); the
# parser rejects such a header, so only valid specs reach `resolve`.
def range_valid(spec: R.RangeSpec) -> Bool:
  match spec:
    case R.FromTo{first, last}:
      Nat.is_le(first, last)
    case R.From{first}:
      True{}
    case R.Suffix{length}:
      True{}

# Whether a resolved range lies inside a representation of `size` bytes and is not empty.
def span_ok(r: R.Resolved, +size: Nat) -> Bool:
  match r:
    case R.Span{start, +stop}:
      Bool.and(Nat.is_lt(start, stop), Nat.is_le(stop, size))
    case R.Unsatisfiable{}:
      True{}

# Every byte a valid range selects lies inside the representation, and it selects at least one.
law range_inside:
  for spec: R.RangeSpec
  for +size: Nat
  {implies(range_valid(spec), span_ok(R.resolve(spec, size), size)) == True{} : Bool}

def unsatisfiable(r: R.Resolved) -> Bool:
  match r:
    case R.Span{start, stop}:
      False{}
    case R.Unsatisfiable{}:
      True{}

def zero(n: Nat) -> Bool:
  match n:
    case 0n:
      True{}
    case 1n+p:
      False{}

# RFC 9110 §14.1.2: a range selects no byte when its first position is not below the size, and a
# suffix selects none when it is empty or the representation is.
def spec_unsatisfiable(spec: R.RangeSpec, +size: Nat) -> Bool:
  match spec:
    case R.FromTo{first, last}:
      Nat.is_ge(first, size)
    case R.From{first}:
      Nat.is_ge(first, size)
    case R.Suffix{length}:
      Bool.or(zero(length), zero(size))

# A range is unsatisfiable (416) exactly when it selects no byte.
law range_unsatisfiable_exactly:
  for spec: R.RangeSpec
  for +size: Nat
  {unsatisfiable(R.resolve(spec, size)) == spec_unsatisfiable(spec, size) : Bool}

# RFC 9110 §14.1.2, stated exactly: `first-last` selects first up to min(last, size - 1), `first-`
# selects first to the end, and `-length` the last min(length, size) bytes; a range that selects no
# byte is unsatisfiable. A span names its stop one past its last byte.
def spec_resolve(spec: R.RangeSpec, +size: Nat) -> R.Resolved:
  match spec:
    case R.FromTo{+first, last}:
      Bool.pick(R.Resolved, Nat.is_ge(first, size), R.Unsatisfiable{}, R.Span{first, 1n+Nat.min(last, Nat.sub(size, 1n))})
    case R.From{+first}:
      Bool.pick(R.Resolved, Nat.is_ge(first, size), R.Unsatisfiable{}, R.Span{first, size})
    case R.Suffix{+length}:
      Bool.pick(R.Resolved, Bool.or(zero(length), zero(size)), R.Unsatisfiable{}, R.Span{Nat.sub(size, length), size})

# `resolve` selects exactly the bytes RFC 9110 names, for every spec and size.
law range_exact:
  for spec: R.RangeSpec
  for +size: Nat
  {R.resolve(spec, size) == spec_resolve(spec, size) : R.Resolved}

# --- Names and paths (PRD §6) ----------------------------------------------------------------

# `.` and `..` are never names.
law name_rejects_dots:
  {Bool.or(N.name_ok([46n]), N.name_ok([46n, 46n])) == False{} : Bool}

def contains(xs: +List<Nat>, +n: Nat) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{h, t}:
      Bool.or(Nat.is_eq(h, n), contains(t, n))

# A name never holds NUL or `/`.
law name_rejects_separators:
  for +xs: +List<Nat>
  {implies(Bool.or(contains(xs, 0n), contains(xs, 47n)), Bool.not(N.name_ok(xs))) == True{} : Bool}

# The bytes a code point takes in UTF-8 (RFC 3629 §3).
def utf8_bytes(+c: Nat) -> Nat:
  Bool.pick(Nat, Nat.is_le(c, 127n), 1n,
    Bool.pick(Nat, Nat.is_le(c, 2047n), 2n,
      Bool.pick(Nat, Nat.is_le(c, 65535n), 3n, 4n)))

def utf8_size(xs: +List<Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      Nat.add(utf8_bytes(h), utf8_size(t))

def nonempty(xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{h, t}:
      True{}

# A name holds at least one code point and at most 255 bytes of UTF-8.
law name_bounded:
  for +xs: +List<Nat>
  {implies(N.name_ok(xs), Bool.and(nonempty(xs), Nat.is_le(utf8_size(xs), 255n))) == True{} : Bool}

# The bytes of a path written with a `/` before each name.
def path_size(xss: +List<+List<Nat>>) -> Nat:
  match xss:
    case Nil{}:
      0n
    case Con{h, t}:
      1n+Nat.add(utf8_size(h), path_size(t))

# A path takes at most 900 bytes.
law path_bounded:
  for +xss: +List<+List<Nat>>
  {implies(N.path_ok(xss), Nat.is_le(path_size(xss), 900n)) == True{} : Bool}

# Whether a name is `.` or `..`.
def dot_name(xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{a, t}:
      match t:
        case Nil{}:
          Nat.is_eq(a, 46n)
        case Con{b, u}:
          match u:
            case Nil{}:
              Bool.and(Nat.is_eq(a, 46n), Nat.is_eq(b, 46n))
            case Con{c, v}:
              False{}

# A code point a name may hold: not NUL, not `/`, not a surrogate (U+D800 to U+DFFF), and not past
# U+10FFFF.
def allowed(+c: Nat) -> Bool:
  Bool.not(Bool.or(
    Bool.or(Nat.is_eq(c, 0n), Nat.is_eq(c, 47n)),
    Bool.or(Bool.and(Nat.is_ge(c, 55296n), Nat.is_le(c, 57343n)), Nat.is_gt(c, 1114111n))))

def all_allowed(xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{h, t}:
      Bool.and(allowed(h), all_allowed(t))

# A name: at least one code point, not `.` or `..`, only allowed code points, at most 255 bytes.
def spec_name_ok(+xs: +List<Nat>) -> Bool:
  Bool.and(nonempty(xs),
    Bool.and(Bool.not(dot_name(xs)),
      Bool.and(all_allowed(xs), Nat.is_le(utf8_size(xs), 255n))))

# `name_ok` accepts exactly the names the specification describes.
law name_accepted:
  for +xs: +List<Nat>
  {N.name_ok(xs) == spec_name_ok(xs) : Bool}

# --- Imports (PRD §4, Phase 6) ---------------------------------------------------------------

# Every key of `xs` is one the target or an earlier entry defines.
def keys_known(xs: +List<Nat>, +known: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{h, t}:
      Bool.and(contains(known, h), keys_known(t, known))

# The keys defined so far, once an entry adds its own.
def extend(xs: +List<Nat>, +known: +List<Nat>) -> +List<Nat>:
  match xs:
    case Nil{}:
      known
    case Con{h, t}:
      Con{h, extend(t, known)}

# No key of `xs` is defined already, by the target, an earlier entry or `xs` itself.
def keys_fresh(xs: +List<Nat>, +known: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{+h, t}:
      Bool.and(Bool.not(contains(known, h)), keys_fresh(t, Con{h, known}))

# Each entry needs only keys that the target or an earlier entry defines.
def needs_met(+entries: +List<I.Entry>, +known: +List<Nat>) -> Bool:
  match entries:
    case Nil{}:
      True{}
    case Con{h, t}:
      match h:
        case I.Entry{+defines, +needs}:
          Bool.and(keys_known(needs, known), needs_met(t, extend(defines, known)))

# Each entry defines only keys that nothing defined before it.
def defines_fresh(+entries: +List<I.Entry>, +known: +List<Nat>) -> Bool:
  match entries:
    case Nil{}:
      True{}
    case Con{h, t}:
      match h:
        case I.Entry{+defines, +needs}:
          Bool.and(keys_fresh(defines, known), defines_fresh(t, extend(defines, known)))

def spec_valid(+entries: +List<I.Entry>, +known: +List<Nat>) -> Bool:
  Bool.and(needs_met(entries, known), defines_fresh(entries, known))

# An import applies every exported entry exactly once, in the export's order, when each one's
# references resolve and none of its keys exists already; otherwise it applies nothing, so a failed
# validation leaves the target unchanged.
law import_all_or_nothing:
  for +entries: +List<I.Entry>
  for +known: +List<Nat>
  {I.plan(entries, known) == Bool.pick(I.Plan, spec_valid(entries, known), I.Apply{entries}, I.Reject{}) : I.Plan}

def count_one(c: I.Count) -> Bool:
  match c:
    case I.CNone{}:
      False{}
    case I.COne{}:
      True{}
    case I.CMany{}:
      False{}

def count_none(c: I.Count) -> Bool:
  match c:
    case I.CNone{}:
      True{}
    case I.COne{}:
      False{}
    case I.CMany{}:
      False{}

# An export starts an instance only with exactly one user who can sign in with a password, so an
# import always closes registration: an export without a user, with two, or with a user who has no
# password is refused before anything is written.
law import_needs_one_owner:
  for users: I.Count
  for logins: I.Count
  {I.owned(users, logins) == Bool.and(count_one(users), Bool.not(count_none(logins))) : Bool}

# No count of logins makes an export without exactly one user acceptable.
law import_refuses_ownerless:
  for users: I.Count
  for logins: I.Count
  {implies(Bool.not(count_one(users)), Bool.not(I.owned(users, logins))) == True{} : Bool}

# --- Copying files between instances (PRD §7 Data Migration) ---------------------------------

def writes(a: M.Action) -> Bool:
  match a:
    case M.Create{}:
      False{}
    case M.Write{}:
      True{}
    case M.Skip{}:
      False{}
    case M.Conflict{}:
      False{}

def changes(a: M.Action) -> Bool:
  match a:
    case M.Create{}:
      True{}
    case M.Write{}:
      True{}
    case M.Skip{}:
      False{}
    case M.Conflict{}:
      False{}

def differs(t: M.Target) -> Bool:
  match t:
    case M.TAbsent{}:
      False{}
    case M.TSame{}:
      False{}
    case M.TDiffers{}:
      True{}
    case M.TFolder{}:
      False{}

def absent(t: M.Target) -> Bool:
  match t:
    case M.TAbsent{}:
      True{}
    case M.TSame{}:
      False{}
    case M.TDiffers{}:
      False{}
    case M.TFolder{}:
      False{}

def holds_folder(t: M.Target) -> Bool:
  match t:
    case M.TAbsent{}:
      False{}
    case M.TSame{}:
      False{}
    case M.TDiffers{}:
      False{}
    case M.TFolder{}:
      True{}

# A migration writes a file only where nothing is, or, when asked to overwrite, over a file that
# differs: never over a collection or over a different file it was not asked to replace.
law copy_writes_safely:
  for s: M.Source
  for t: M.Target
  for overwrite: Bool
  {implies(writes(M.decide(s, t, overwrite)), Bool.or(absent(t), Bool.and(overwrite, differs(t)))) == True{} : Bool}

# A migration changes the target only where it lacks the entry, never where it holds it already.
law copy_skips_what_is_there:
  for s: M.Source
  for t: M.Target
  for overwrite: Bool
  {implies(Bool.or(holds_folder(t), Bool.not(Bool.or(absent(t), differs(t)))), Bool.not(changes(M.decide(s, t, overwrite)))) == True{} : Bool}

# The action for each entry, written out: collections are created where nothing is and kept where
# a collection is; files are written where nothing is, kept where the same file is, and replaced
# only when they differ and overwrite is asked for. Anything else is a conflict.
def spec_copy_action(s: M.Source, t: M.Target, overwrite: Bool) -> M.Action:
  match s:
    case M.SFolder{}:
      match t:
        case M.TAbsent{}:
          M.Create{}
        case M.TFolder{}:
          M.Skip{}
        case M.TSame{}:
          M.Conflict{}
        case M.TDiffers{}:
          M.Conflict{}
    case M.SFile{}:
      match t:
        case M.TAbsent{}:
          M.Write{}
        case M.TSame{}:
          M.Skip{}
        case M.TFolder{}:
          M.Conflict{}
        case M.TDiffers{}:
          match overwrite:
            case True{}:
              M.Write{}
            case False{}:
              M.Conflict{}

# The action of every entry is the one written out above.
law copy_action_exact:
  for s: M.Source
  for t: M.Target
  for overwrite: Bool
  {M.decide(s, t, overwrite) == spec_copy_action(s, t, overwrite) : M.Action}

# --- Write locks (RFC 4918 §6, §9.10, §9.11, §10.4) -------------------------------------------

def shared(s: K.Scope) -> Bool:
  match s:
    case K.Exclusive{}:
      False{}
    case K.Shared{}:
      True{}

def deep(d: K.Depth) -> Bool:
  match d:
    case K.Shallow{}:
      False{}
    case K.Deep{}:
      True{}

def at(p: K.Place) -> Bool:
  match p:
    case K.Same{}:
      True{}
    case K.Above{}:
      False{}
    case K.Below{}:
      False{}
    case K.Apart{}:
      False{}

def above(p: K.Place) -> Bool:
  match p:
    case K.Same{}:
      False{}
    case K.Above{}:
      True{}
    case K.Below{}:
      False{}
    case K.Apart{}:
      False{}

def below(p: K.Place) -> Bool:
  match p:
    case K.Same{}:
      False{}
    case K.Above{}:
      False{}
    case K.Below{}:
      True{}
    case K.Apart{}:
      False{}

# §6.1: a shared lock is compatible only with other shared locks.
law lock_conflict_exact:
  for held: K.Scope
  for requested: K.Scope
  {K.conflicts(held, requested) == Bool.not(Bool.and(shared(held), shared(requested))) : Bool}

# A lock covers its root, and with Depth infinity every member under it; a request on a whole tree
# also meets the locks rooted inside the tree.
def spec_covers(+d: K.Depth, +p: K.Place, +descendants: Bool) -> Bool:
  Bool.or(at(p), Bool.or(Bool.and(above(p), deep(d)), Bool.and(below(p), descendants)))

law lock_covers_exact:
  for d: K.Depth
  for p: K.Place
  for descendants: Bool
  {K.covers(d, p, descendants) == spec_covers(d, p, descendants) : Bool}

# §9.10.6: a new lock is refused exactly when a conflicting lock covers its root, or, for a new
# Depth infinity lock, lies under its root.
law lock_refuses_exact:
  for hs: K.Scope
  for hd: K.Depth
  for p: K.Place
  for s: K.Scope
  for d: K.Depth
  {K.refuses(hs, hd, p, s, d) == Bool.and(spec_covers(hd, p, deep(d)), Bool.not(Bool.and(shared(hs), shared(s)))) : Bool}

# §10.4.2: a condition is true when its token or tag matches, or, under Not, when it does not.
law if_condition_exact:
  for negated: Bool
  for holds: Bool
  {K.condition_true(K.Condition{negated, holds}) == Bool.or(Bool.and(holds, Bool.not(negated)), Bool.and(Bool.not(holds), negated)) : Bool}

def some_false(+cs: +List<K.Condition>) -> Bool:
  match cs:
    case Nil{}:
      False{}
    case Con{h, t}:
      Bool.or(Bool.not(K.condition_true(h)), some_false(t))

# A list is true when its resource is one the request may see and none of its conditions is false.
law if_clause_exact:
  for resolved: Bool
  for +cs: +List<K.Condition>
  {K.clause_true(K.Clause{resolved, cs}) == Bool.and(resolved, Bool.not(some_false(cs))) : Bool}

def all_false(+cs: +List<K.Clause>) -> Bool:
  match cs:
    case Nil{}:
      True{}
    case Con{h, t}:
      Bool.and(Bool.not(K.clause_true(h)), all_false(t))

# An If header holds unless every one of its lists is false, so a header of no lists never holds.
law if_header_exact:
  for +cs: +List<K.Clause>
  {K.header_true(cs) == Bool.not(all_false(cs)) : Bool}

# What a header comes to: none, malformed, or whether one of its lists holds.
law if_state_exact:
  for present: Bool
  for parsed: Bool
  for +cs: +List<K.Clause>
  {K.if_state(present, parsed, cs) == Bool.pick(K.IfState, Bool.not(present), K.NoHeader{}, Bool.pick(K.IfState, Bool.not(parsed), K.Malformed{}, Bool.pick(K.IfState, K.header_true(cs), K.SomeTrue{}, K.NoneTrue{}))) : K.IfState}

def spec_gate(s: K.IfState, blocked: Bool) -> K.Gate:
  match s:
    case K.Malformed{}:
      K.BadHeader{}
    case K.NoneTrue{}:
      K.Unmet{}
    case K.NoHeader{}:
      Bool.pick(K.Gate, blocked, K.Locked{}, K.Proceed{})
    case K.SomeTrue{}:
      Bool.pick(K.Gate, blocked, K.Locked{}, K.Proceed{})

# A malformed If header answers 400 and a false one 412 before any lock is looked at (§10.4); a
# change to a locked resource then answers 423 unless the header submits every blocking lock's
# token (§7). No request goes ahead while a lock blocks it.
law lock_gate_in_order:
  for s: K.IfState
  for blocked: Bool
  {K.gate(s, blocked) == spec_gate(s, blocked) : K.Gate}

# §9.11.1: UNLOCK releases only a lock that covers the request URI, and only for a credential that
# may change it.
law unlock_exact:
  for found: Bool
  for may_lock: Bool
  {K.decide_unlock(found, may_lock) == Bool.pick(K.Unlock, Bool.not(found), K.NotHere{}, Bool.pick(K.Unlock, Bool.not(may_lock), K.NotYours{}, K.Release{})) : K.Unlock}

# --- The status of a failed operation (RFC 9110 §15, RFC 4918 §9) -----------------------------

# The failures that are the server's, not the request's: retrying later or elsewhere may succeed.
def server_fault(f: S.Failure) -> Bool:
  match f:
    case S.FInsufficientStorage{}:
      True{}
    case S.FUnavailable{}:
      True{}
    case S.FCrossBackend{}:
      True{}
    case S.FNotFound{}:
      False{}
    case S.FNoParent{}:
      False{}
    case S.FExists{}:
      False{}
    case S.FIsCollection{}:
      False{}
    case S.FNotCollection{}:
      False{}
    case S.FIntoItself{}:
      False{}
    case S.FRoot{}:
      False{}
    case S.FTooLarge{}:
      False{}
    case S.FSizeMismatch{}:
      False{}
    case S.FNameRefused{}:
      False{}
    case S.FNameRefusedReplaced{}:
      False{}
    case S.FHiddenObjects{}:
      False{}
    case S.FTooMany{}:
      False{}

# Every failure answers an error status: never a success or a redirect, which a client would take
# as done (RFC 9110 §15).
law failure_is_error:
  for f: S.Failure
  {Bool.and(Nat.is_le(400n, S.status(f)), Nat.is_lt(S.status(f), 600n)) == True{} : Bool}

# A failure answers 5xx exactly when it is the server's, so a client retries only those and
# changes the request for the others (RFC 9110 §15.5, §15.6).
law failure_class_exact:
  for f: S.Failure
  {Nat.is_le(500n, S.status(f)) == server_fault(f) : Bool}

# Each failure's status, with the section that sets it.
def spec_status(f: S.Failure) -> Nat:
  match f:
    # RFC 9110 §15.5.5
    case S.FNotFound{}:
      404n
    # RFC 4918 §9.3.1, §9.7.1, §9.8.5: a missing parent collection is 409.
    case S.FNoParent{}:
      409n
    # RFC 4918 §9.3.1: MKCOL on a mapped URL is 405; so is PUT on a collection.
    case S.FExists{}:
      405n
    case S.FIsCollection{}:
      405n
    case S.FNotCollection{}:
      409n
    # RFC 4918 §9.8.5: the source and destination are the same or nested.
    case S.FIntoItself{}:
      403n
    case S.FRoot{}:
      403n
    # RFC 4918 §11.5
    case S.FInsufficientStorage{}:
      507n
    # RFC 9110 §15.5.14
    case S.FTooLarge{}:
      413n
    # RFC 9110 §8.6: a body that differs from its Content-Length is a malformed request.
    case S.FSizeMismatch{}:
      400n
    # RFC 9110 §15.6.4
    case S.FUnavailable{}:
      503n
    # RFC 9110 §15.5.4: understood, and refused for good.
    case S.FNameRefused{}:
      403n
    case S.FNameRefusedReplaced{}:
      403n
    # RFC 9110 §15.5.10: the collection's state conflicts with the request.
    case S.FHiddenObjects{}:
      409n
    # RFC 9110 §15.6.3, as RFC 4918 §9.8.5 answers a destination on another server.
    case S.FCrossBackend{}:
      502n
    # PRD §5: refused in one request; nothing changed.
    case S.FTooMany{}:
      403n

law failure_status_exact:
  for f: S.Failure
  {S.status(f) == spec_status(f) : Nat}

# --- PROPFIND (RFC 4918 §9.1, RFC 4331) -------------------------------------------------------

# A prop query that names only DAV: properties.
def dav_only(q: F.Query) -> Bool:
  match q:
    case F.QAllProp{}:
      False{}
    case F.QPropName{}:
      False{}
    case F.QPropDav{}:
      True{}
    case F.QPropOther{}:
      False{}

# Dead properties are read exactly when the credential may see an entry and the body is not a
# prop query naming DAV: properties only.
law propfind_reads_dead_exact:
  for readable: Bool
  for q: F.Query
  {F.reads_dead(readable, q) == Bool.and(readable, Bool.not(dav_only(q))) : Bool}

# A requested property's value: the quota for a quota name on a collection whose quota is known,
# else a live property's value, else a dead property's, and live properties, the quota and no dead
# property are in DAV: (RFC 4918 §9.1, RFC 4331 §3).
def spec_source(+dav: Bool, +quota_name: Bool, +collection: Bool, +quota_value: Bool, +live_value: Bool, +dead_present: Bool) -> F.Source:
  Bool.pick(F.Source, Bool.and(dav, Bool.and(quota_name, Bool.and(collection, quota_value))), F.FromQuota{},
    Bool.pick(F.Source, Bool.and(dav, live_value), F.FromLive{},
      Bool.pick(F.Source, Bool.and(Bool.not(dav), dead_present), F.FromDead{}, F.NotFound{})))

law property_source_exact:
  for dav: Bool
  for quota_name: Bool
  for collection: Bool
  for quota_value: Bool
  for live_value: Bool
  for dead_present: Bool
  {F.source(dav, quota_name, collection, quota_value, live_value, dead_present) == spec_source(dav, quota_name, collection, quota_value, live_value, dead_present) : F.Source}

# Whatever the store holds, a DAV: property's answer is the same, so a request that names only
# DAV: properties loses nothing by not reading dead properties.
law propfind_dav_skip_sound:
  for quota_name: Bool
  for collection: Bool
  for quota_value: Bool
  for live_value: Bool
  {F.source(True{}, quota_name, collection, quota_value, live_value, True{}) == F.source(True{}, quota_name, collection, quota_value, live_value, False{}) : F.Source}

# --- Object stores: errors and refused keys ---------------------------------------------------

def code_index(c: O.Code) -> Nat:
  match c:
    case O.CNotStore{}:
      0n
    case O.CNoSuchKey{}:
      1n
    case O.CTooLarge{}:
      2n
    case O.CRefusedKey{}:
      3n
    case O.CNoCode{}:
      4n
    case O.CUnwritable{}:
      5n
    case O.CPrecondition{}:
      6n
    case O.CFull{}:
      7n
    case O.COther{}:
      8n

def status_index(s: O.Status) -> Nat:
  match s:
    case O.S400{}:
      400n
    case O.S412{}:
      412n
    case O.S507{}:
      507n
    case O.SOther{}:
      0n

def refused(f: O.Failure) -> Bool:
  match f:
    case O.ONameRefused{}:
      True{}
    case O.ONotFound{}:
      False{}
    case O.OTooLarge{}:
      False{}
    case O.OExists{}:
      False{}
    case O.OFull{}:
      False{}
    case O.OUnavailable{}:
      False{}

# The store's answer is about the key: a 400 with a key-refusal code, a codeless 400 to HEAD, or
# RustFS's unwritable refusal.
def about_key(+c: O.Code, +s: O.Status, +head: Bool) -> Bool:
  Bool.or(Nat.is_eq(code_index(c), 5n), Bool.and(Nat.is_eq(status_index(s), 400n), Bool.or(Nat.is_eq(code_index(c), 3n), Bool.and(Nat.is_eq(code_index(c), 4n), head))))

def spec_classify(+c: O.Code, +s: O.Status, +head: Bool) -> O.Failure:
  Bool.pick(O.Failure, Nat.is_eq(code_index(c), 0n), O.OUnavailable{},
    Bool.pick(O.Failure, Nat.is_eq(code_index(c), 1n), O.ONotFound{},
      Bool.pick(O.Failure, Nat.is_eq(code_index(c), 2n), O.OTooLarge{},
        Bool.pick(O.Failure, about_key(c, s, head), O.ONameRefused{},
          Bool.pick(O.Failure, Bool.or(Nat.is_eq(code_index(c), 6n), Nat.is_eq(status_index(s), 412n)), O.OExists{},
            Bool.pick(O.Failure, Bool.or(Nat.is_eq(code_index(c), 7n), Nat.is_eq(status_index(s), 507n)), O.OFull{}, O.OUnavailable{}))))))

# Each error of the store means what the specification says, checked in its order.
law object_error_exact:
  for c: O.Code
  for s: O.Status
  for head: Bool
  {O.classify(c, s, head) == spec_classify(c, s, head) : O.Failure}

# A key counts as refused only on the store's own word about the key, so no other failure can make
# the store look empty or let a write go ahead.
law object_refusal_about_key:
  for c: O.Code
  for s: O.Status
  for head: Bool
  {implies(refused(O.classify(c, s, head)), about_key(c, s, head)) == True{} : Bool}

# A codeless answer to anything but HEAD is never a refusal.
law object_codeless_not_refused:
  for s: O.Status
  {refused(O.classify(O.CNoCode{}, s, False{})) == False{} : Bool}

def spec_confirm(l: O.Listing) -> O.Confirm:
  match l:
    case O.LShowsKey{}:
      O.Fault{}
    case O.LNotKey{}:
      O.Absent{}
    case O.LRefused{}:
      O.Absent{}
    case O.LFailed{}:
      O.ListingFailure{}

# A refused read is absent only when a listing of the key as a prefix does not show the key, or
# refuses the prefix too; a listing that shows it is a fault, and one that fails passes its failure.
law refused_read_absent_exact:
  for l: O.Listing
  {O.confirm_absent(l) == spec_confirm(l) : O.Confirm}

# A refused later page of a listing is a fault, never the end of the listing.
law refused_page_exact:
  for later: Bool
  {O.refused_page(later) == Bool.pick(O.Page, later, O.PageFault{}, O.EmptyPage{}) : O.Page}

# A copy or move refused part-way says that the destination it replaced is gone, and only then.
law copy_refused_exact:
  for replaces: Bool
  {O.copy_refused(replaces) == Bool.pick(O.Refusal, replaces, O.RReplacedGone{}, O.RNothingChanged{}) : O.Refusal}

# --- The namespace of Mounts (PRD §5) ---------------------------------------------------------

def in_mount(w: W.Where) -> Bool:
  match w:
    case W.WRoot{}:
      False{}
    case W.WUnknownTop{}:
      False{}
    case W.WUnknownDeep{}:
      False{}
    case W.WMountRoot{}:
      True{}
    case W.WInside{}:
      True{}

def a_mount_root(w: W.Where) -> Bool:
  match w:
    case W.WRoot{}:
      False{}
    case W.WUnknownTop{}:
      False{}
    case W.WUnknownDeep{}:
      False{}
    case W.WMountRoot{}:
      True{}
    case W.WInside{}:
      False{}

def at_virtual_root(w: W.Where) -> Bool:
  match w:
    case W.WRoot{}:
      True{}
    case W.WUnknownTop{}:
      False{}
    case W.WUnknownDeep{}:
      False{}
    case W.WMountRoot{}:
      False{}
    case W.WInside{}:
      False{}

def delegated(r: W.Route) -> Bool:
  match r:
    case W.Delegate{}:
      True{}
    case W.Virtual{}:
      False{}
    case W.MNotFound{}:
      False{}
    case W.MNoParent{}:
      False{}
    case W.MExists{}:
      False{}
    case W.MIsCollection{}:
      False{}
    case W.MNotCollection{}:
      False{}
    case W.MIntoItself{}:
      False{}
    case W.MRoot{}:
      False{}
    case W.MCrossBackend{}:
      False{}

def virtual(r: W.Route) -> Bool:
  match r:
    case W.Delegate{}:
      False{}
    case W.Virtual{}:
      True{}
    case W.MNotFound{}:
      False{}
    case W.MNoParent{}:
      False{}
    case W.MExists{}:
      False{}
    case W.MIsCollection{}:
      False{}
    case W.MNotCollection{}:
      False{}
    case W.MIntoItself{}:
      False{}
    case W.MRoot{}:
      False{}
    case W.MCrossBackend{}:
      False{}

# Whether the operation creates, replaces or removes the entry at its path.
def replaces_entry(op: W.Op) -> Bool:
  match op:
    case W.OpStat{}:
      False{}
    case W.OpList{}:
      False{}
    case W.OpRead{}:
      False{}
    case W.OpWrite{}:
      True{}
    case W.OpMkcol{}:
      True{}
    case W.OpRemove{}:
      True{}
    case W.OpPatch{}:
      False{}
    case W.OpQuota{}:
      False{}

def lists_or_stats(op: W.Op) -> Bool:
  match op:
    case W.OpStat{}:
      True{}
    case W.OpList{}:
      True{}
    case W.OpRead{}:
      False{}
    case W.OpWrite{}:
      False{}
    case W.OpMkcol{}:
      False{}
    case W.OpRemove{}:
      False{}
    case W.OpPatch{}:
      False{}
    case W.OpQuota{}:
      False{}

# Only a path inside a Mount reaches a backend.
law mount_route_inside:
  for op: W.Op
  for w: W.Where
  {implies(delegated(W.route(op, w)), in_mount(w)) == True{} : Bool}

# A Mount's root is never written over, created or removed, as a backend's root is not.
law mount_root_kept:
  for op: W.Op
  {implies(replaces_entry(op), Bool.not(delegated(W.route(op, W.WMountRoot{})))) == True{} : Bool}

# The namespace answers by itself only a stat or listing of its root.
law mount_virtual_only_root:
  for op: W.Op
  for w: W.Where
  {implies(virtual(W.route(op, w)), Bool.and(at_virtual_root(w), lists_or_stats(op))) == True{} : Bool}

# A copy or move reaches a backend only between two paths inside Mounts of that one backend,
# never onto a Mount's root, and never moving one.
law mount_transfer_safe:
  for from: W.Where
  for to: W.Where
  for move: Bool
  for same: Bool
  {implies(delegated(W.transfer(from, to, move, same)), Bool.and(Bool.and(in_mount(from), in_mount(to)), Bool.and(same, Bool.and(Bool.not(a_mount_root(to)), Bool.not(Bool.and(move, a_mount_root(from))))))) == True{} : Bool}

# Between two Mounts of one backend, and off every root, a copy or move always reaches it.
law mount_transfer_reaches:
  for from: W.Where
  for to: W.Where
  for move: Bool
  {implies(Bool.and(Bool.and(in_mount(from), in_mount(to)), Bool.and(Bool.not(a_mount_root(to)), Bool.not(Bool.and(move, a_mount_root(from))))), delegated(W.transfer(from, to, move, True{}))) == True{} : Bool}

# --- HTTP framing at the servers' edges (RFC 9110 §6.4, §8.6, RFC 9112 §3.2) --------------------

def bodiless(k: H.StatusKind) -> Bool:
  match k:
    case H.KInformational{}:
      True{}
    case H.KNoContent{}:
      True{}
    case H.KNotModified{}:
      True{}
    case H.KOther{}:
      False{}

# A measured Content-Length is sent only for a body that ended, of an answer that named none and
# whose status may carry one: never for a 1xx, 204 or 304 (RFC 9110 §8.6).
law measured_length_exact:
  for given: Bool
  for ended: Bool
  for k: H.StatusKind
  {H.measured_length(given, ended, k) == Bool.and(Bool.not(given), Bool.and(ended, Bool.not(bodiless(k)))) : Bool}

# A body goes through a fixed-length stream only when it is a WebDAV body, uncompressed, with a
# Content-Length that is a number: the length the stream enforces is then the body's.
law fixed_length_exact:
  for has_body: Bool
  for has_header: Bool
  for webdav: Bool
  for encoded: Bool
  for numeric: Bool
  {implies(H.fixed_length(has_body, has_header, webdav, encoded, numeric), Bool.and(Bool.and(has_body, has_header), Bool.and(webdav, Bool.and(Bool.not(encoded), numeric)))) == True{} : Bool}

def url_host(u: H.Url) -> H.HostFrom:
  match u:
    case H.Url{p, h}:
      h

def url_path(u: H.Url) -> H.PathFrom:
  match u:
    case H.Url{p, h}:
      p

def from_header(h: H.HostFrom) -> Bool:
  match h:
    case H.HHeader{}:
      True{}
    case H.HNone{}:
      False{}

def names_resource(f: H.Form) -> Bool:
  match f:
    case H.FOrigin{}:
      True{}
    case H.FAbsolute{}:
      True{}
    case H.FAsterisk{}:
      False{}
    case H.FInvalid{}:
      False{}

def keeps_target(f: H.Form) -> Bool:
  match f:
    case H.FOrigin{}:
      True{}
    case H.FAbsolute{}:
      False{}
    case H.FAsterisk{}:
      False{}
    case H.FInvalid{}:
      False{}

def at_slash(p: H.PathFrom) -> Bool:
  match p:
    case H.PTarget{}:
      False{}
    case H.PAbsolute{}:
      False{}
    case H.PSlash{}:
      True{}

def as_target(p: H.PathFrom) -> Bool:
  match p:
    case H.PTarget{}:
      True{}
    case H.PAbsolute{}:
      False{}
    case H.PSlash{}:
      False{}

# A request's host is the Host header's exactly when that header names a host and the target
# names a resource; the request line never chooses it.
law url_host_from_header:
  for f: H.Form
  for host_ok: Bool
  {from_header(url_host(H.url_of(f, host_ok))) == Bool.and(host_ok, names_resource(f)) : Bool}

# The path is the target's own only for an origin-form target, an absolute-form target's path
# without its scheme and host, and the root for a target that names no resource.
law url_path_exact:
  for f: H.Form
  for host_ok: Bool
  {Bool.and(Bool.and(implies(as_target(url_path(H.url_of(f, host_ok))), keeps_target(f)), implies(keeps_target(f), as_target(url_path(H.url_of(f, host_ok))))), Bool.and(implies(at_slash(url_path(H.url_of(f, host_ok))), Bool.not(names_resource(f))), implies(Bool.not(names_resource(f)), at_slash(url_path(H.url_of(f, host_ok)))))) == True{} : Bool}

# --- Step-up verification of management actions (PRD §6) -------------------------------------

# Whether an action deletes, overwrites or discloses data, or touches a credential.
def sensitive(e: U.Effect) -> Bool:
  match e:
    case U.EffRead{}:
      False{}
    case U.EffChange{}:
      False{}
    case U.EffEndSelf{}:
      False{}
    case U.EffDestroy{}:
      True{}
    case U.EffCredential{}:
      True{}
    case U.EffDisclose{}:
      True{}

def is_step_up(l: U.Level) -> Bool:
  match l:
    case U.LNone{}:
      False{}
    case U.LConfirm{}:
      False{}
    case U.LStepUp{}:
      True{}

def is_none(l: U.Level) -> Bool:
  match l:
    case U.LNone{}:
      True{}
    case U.LConfirm{}:
      False{}
    case U.LStepUp{}:
      False{}

def reads_only(e: U.Effect) -> Bool:
  match e:
    case U.EffRead{}:
      True{}
    case U.EffChange{}:
      False{}
    case U.EffEndSelf{}:
      False{}
    case U.EffDestroy{}:
      False{}
    case U.EffCredential{}:
      False{}
    case U.EffDisclose{}:
      False{}

# Destructive, credential-changing and disclosing actions always ask for step-up verification,
# and exactly those do.
law step_up_exactly_sensitive:
  for e: U.Effect
  {is_step_up(U.level(e)) == sensitive(e) : Bool}

# No step-up action runs without a fresh verification.
law step_up_needs_fresh:
  for e: U.Effect
  for fresh: Bool
  {implies(Bool.and(is_step_up(U.level(e)), Bool.not(fresh)), Bool.not(U.permits(e, fresh))) == True{} : Bool}

# A fresh verification permits every action, so verifying again always unblocks the person.
law fresh_permits:
  for e: U.Effect
  {U.permits(e, True{}) == True{} : Bool}

# Only step-up actions are ever refused: freshness never matters to the others.
law only_step_up_refused:
  for e: U.Effect
  for fresh: Bool
  {implies(Bool.not(is_step_up(U.level(e))), U.permits(e, fresh)) == True{} : Bool}

# Reading asks for nothing.
law reads_ask_nothing:
  for e: U.Effect
  {implies(reads_only(e), is_none(U.level(e))) == True{} : Bool}

# Signing this browser out asks for a confirmation and never for step-up.
law end_self_confirms:
  {is_step_up(U.level(U.EffEndSelf{})) == False{} : Bool}
