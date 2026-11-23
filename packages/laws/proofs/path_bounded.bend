def L.path_bounded(xss):
  %Lemma.path(xss) : {L.implies(N.path_ok(xss), Nat.is_le(_, 900n)) == True{} : Bool}
  Lemma.and_r(N.names_ok(xss), Nat.is_le(N.path_length(xss), 900n))
