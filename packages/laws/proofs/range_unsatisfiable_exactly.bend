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
