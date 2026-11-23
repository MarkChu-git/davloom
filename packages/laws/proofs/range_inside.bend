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
