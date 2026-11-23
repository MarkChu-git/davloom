import Base
import ./src/transfer.bend as T
import ./src/policy.bend as P
import ./src/preconditions.bend as C

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
