def L.name_bounded(xs):
  %Lemma.utf8(xs) : {L.implies(N.name_ok(xs), Bool.and(L.nonempty(xs), Nat.is_le(_, 255n))) == True{} : Bool}
  Lemma.name_bound(xs)
