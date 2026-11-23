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
