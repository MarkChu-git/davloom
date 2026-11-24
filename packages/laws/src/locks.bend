import Base

# Write locks (RFC 4918 §6, §7, §9.10, §10.4). The wrapper finds the locks and resolves each
# condition of an If header against the store; this module decides what those facts mean.

type Scope is Data:
  Exclusive{}
  Shared{}

type Depth is Data:
  Shallow{}
  Deep{}

# Where a lock is rooted, seen from a path.
type Place is Data:
  # At the path itself.
  Same{}
  # At an ancestor of the path.
  Above{}
  # Under the path.
  Below{}
  # Neither at, above nor under the path.
  Apart{}

# Two locks conflict unless both are shared (§6.1).
def conflicts(held: Scope, requested: Scope) -> Bool:
  match held:
    case Exclusive{}:
      True{}
    case Shared{}:
      match requested:
        case Exclusive{}:
          True{}
        case Shared{}:
          False{}

def reaches_down(depth: Depth) -> Bool:
  match depth:
    case Shallow{}:
      False{}
    case Deep{}:
      True{}

# Whether a lock rooted at `place` with `depth` covers the path: its root, and with Depth infinity
# everything under the root (§6.1, §9.10.3). With `descendants`, a lock rooted under the path counts
# too, as for a request that changes the path's whole tree.
def covers(depth: Depth, place: Place, descendants: Bool) -> Bool:
  match place:
    case Same{}:
      True{}
    case Above{}:
      reaches_down(depth)
    case Below{}:
      descendants
    case Apart{}:
      False{}

# Whether a held lock refuses a new one: it covers the new lock's root, or lies under that root
# when the new lock has Depth infinity, and the two conflict (§9.10.6).
def refuses(held_scope: Scope, held_depth: Depth, place: Place, scope: Scope, depth: Depth) -> Bool:
  Bool.and(covers(held_depth, place, reaches_down(depth)), conflicts(held_scope, scope))

# One condition of an If header: a state token or an entity tag, `Not` or not, and whether the
# token names a lock on the resource or the tag matches it.
type Condition is Data:
  Condition{negated: Bool, holds: Bool}

# One list of an If header: whether its resource is one the request may look at, and its conditions.
type Clause is Data:
  Clause{resolved: Bool, conditions: +List<Condition>}

def condition_true(c: Condition) -> Bool:
  match c:
    case Condition{negated, holds}:
      match negated:
        case False{}:
          holds
        case True{}:
          Bool.not(holds)

# A tail call per condition, so a long list runs as a loop rather than one stack frame each.
def conditions_go(cs: +List<Condition>, acc: Bool) -> Bool:
  match cs:
    case Nil{}:
      acc
    case Con{h, t}:
      conditions_go(t, Bool.and(acc, condition_true(h)))

def conditions_true(cs: +List<Condition>) -> Bool:
  conditions_go(cs, True{})

def clause_true(c: Clause) -> Bool:
  match c:
    case Clause{resolved, +conditions}:
      Bool.and(resolved, conditions_true(conditions))

# A tail call per list, as for conditions.
def header_go(cs: +List<Clause>, acc: Bool) -> Bool:
  match cs:
    case Nil{}:
      acc
    case Con{h, t}:
      header_go(t, Bool.or(acc, clause_true(h)))

# An If header holds when one of its lists does (§10.4.2).
def header_true(cs: +List<Clause>) -> Bool:
  header_go(cs, False{})

# What the If header of a request comes to.
type IfState is Data:
  NoHeader{}
  Malformed{}
  NoneTrue{}
  SomeTrue{}

def state_of(holds: Bool) -> IfState:
  match holds:
    case False{}:
      NoneTrue{}
    case True{}:
      SomeTrue{}

def if_state(present: Bool, parsed: Bool, +clauses: +List<Clause>) -> IfState:
  match present:
    case False{}:
      NoHeader{}
    case True{}:
      match parsed:
        case False{}:
          Malformed{}
        case True{}:
          state_of(header_true(clauses))

type Gate is Data:
  Proceed{}
  # 400 Bad Request
  BadHeader{}
  # 412 Precondition Failed
  Unmet{}
  # 423 Locked
  Locked{}

def locked_or_proceed(blocked: Bool) -> Gate:
  match blocked:
    case True{}:
      Locked{}
    case False{}:
      Proceed{}

# Whether a request that changes locked resources goes ahead. `blocked` holds when a lock on a
# resource it changes is one whose token the If header does not submit.
def gate(state: IfState, blocked: Bool) -> Gate:
  match state:
    case Malformed{}:
      BadHeader{}
    case NoneTrue{}:
      Unmet{}
    case NoHeader{}:
      locked_or_proceed(blocked)
    case SomeTrue{}:
      locked_or_proceed(blocked)

type Unlock is Data:
  Release{}
  # 409 with DAV:lock-token-matches-request-uri
  NotHere{}
  # 403
  NotYours{}

# UNLOCK (§9.11): the token must name a lock that covers the request URI, and the credential must
# be one that may change a lock rooted where that lock is.
def decide_unlock(found: Bool, may_lock: Bool) -> Unlock:
  match found:
    case False{}:
      NotHere{}
    case True{}:
      match may_lock:
        case False{}:
          NotYours{}
        case True{}:
          Release{}
