import Base

# The plan of an import (PRD §4, Phase 6). An export lists its entries in the order they are
# imported. Each entry defines keys, such as its id and its name, and needs keys that other entries
# define, such as the backend a Mount publishes. The caller turns every key into a Nat, with a
# different number for each kind of key. An import applies every entry or none: it is valid when
# each entry needs only keys that the target or an earlier entry defines, and defines only keys
# that neither the target nor an earlier entry, nor itself, defined before.

type Entry is Data:
  Entry{defines: +List<Nat>, needs: +List<Nat>}

type Plan is Data:
  Apply{entries: +List<Entry>}
  Reject{}

# Whether `n` is one of `xs`, or `found` already. A tail call per key, so long lists run as a loop.
def member_go(xs: +List<Nat>, +n: Nat, found: Bool) -> Bool:
  match xs:
    case Nil{}:
      found
    case Con{h, t}:
      member_go(t, n, Bool.or(found, Nat.is_eq(h, n)))

def member(xs: +List<Nat>, +n: Nat) -> Bool:
  member_go(xs, n, False{})

# Every key of `xs` is one of `known`.
def all_known(xs: +List<Nat>, +known: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{h, t}:
      Bool.and(member(known, h), all_known(t, known))

def prepend(xs: +List<Nat>, +known: +List<Nat>) -> +List<Nat>:
  match xs:
    case Nil{}:
      known
    case Con{h, t}:
      Con{h, prepend(t, known)}

# Every key of `xs` is new: not one of `known`, and not repeated in `xs`.
def all_new(xs: +List<Nat>, +known: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{+h, t}:
      Bool.and(Bool.not(member(known, h)), all_new(t, Con{h, known}))

# Whether the entries can be imported, in order, into a target that holds the keys `known`, and
# `ok` holds. A tail call per entry, so an export of any size runs as a loop.
def valid_go(+entries: +List<Entry>, +known: +List<Nat>, ok: Bool) -> Bool:
  match entries:
    case Nil{}:
      ok
    case Con{h, t}:
      match h:
        case Entry{+defines, +needs}:
          valid_go(t, prepend(defines, known),
            Bool.and(ok, Bool.and(all_known(needs, known), all_new(defines, known))))

def valid(+entries: +List<Entry>, +known: +List<Nat>) -> Bool:
  valid_go(entries, known, True{})

def decide(ok: Bool, entries: +List<Entry>) -> Plan:
  match ok:
    case True{}:
      Apply{entries}
    case False{}:
      Reject{}

# The plan of an import: every entry, in order, or nothing.
def plan(+entries: +List<Entry>, +known: +List<Nat>) -> Plan:
  decide(valid(entries, known), entries)

# How many of something an export holds, as far as the rule about its owner cares.
type Count is Data:
  CNone{}
  COne{}
  CMany{}

# Whether an export can start an instance: it holds exactly one user, the owner, with at least one
# login that has a password. Without an owner the import would leave registration open, and the
# first visitor would become the owner of the imported backends and Mounts.
def owned(users: Count, logins: Count) -> Bool:
  match users:
    case CNone{}:
      False{}
    case COne{}:
      match logins:
        case CNone{}:
          False{}
        case COne{}:
          True{}
        case CMany{}:
          True{}
    case CMany{}:
      False{}
