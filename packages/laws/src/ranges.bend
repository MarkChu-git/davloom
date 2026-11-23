import Base

# HTTP Range (RFC 9110 §14.1.2): one byte range resolved against the size of a representation.
# The TypeScript wrapper parses the header text; this module decides which bytes the range selects.

type RangeSpec is Data:
  # bytes=first-last
  FromTo{first: Nat, last: Nat}
  # bytes=first-
  From{first: Nat}
  # bytes=-length
  Suffix{length: Nat}

type Resolved is Data:
  # The bytes from `start` up to, not including, `stop`.
  Span{start: Nat, stop: Nat}
  # No byte of the representation lies in the range: 416.
  Unsatisfiable{}

def span_from(lt: Bool, +first: Nat, +size: Nat) -> Resolved:
  match lt:
    case True{}:
      Span{first, size}
    case False{}:
      Unsatisfiable{}

def span_to(lt: Bool, +first: Nat, +last: Nat, +size: Nat) -> Resolved:
  match lt:
    case True{}:
      Span{first, Nat.min(1n+last, size)}
    case False{}:
      Unsatisfiable{}

def span_suffix(empty: Bool, +length: Nat, +size: Nat) -> Resolved:
  match empty:
    case True{}:
      Unsatisfiable{}
    case False{}:
      Span{Nat.sub(size, Nat.min(length, size)), size}

def resolve(spec: RangeSpec, +size: Nat) -> Resolved:
  match spec:
    case FromTo{+first, +last}:
      span_to(Nat.is_lt(first, size), first, last, size)
    case From{+first}:
      span_from(Nat.is_lt(first, size), first, size)
    case Suffix{+length}:
      span_suffix(Bool.or(Nat.is_eq(length, 0n), Nat.is_eq(size, 0n)), length, size)
