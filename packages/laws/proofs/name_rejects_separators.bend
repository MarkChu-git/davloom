def L.name_rejects_separators(xs):
  Lemma.mp(
    L.implies(Bool.or(L.contains(xs, 0n), L.contains(xs, 47n)), Bool.not(N.chars_ok(xs))),
    L.implies(Bool.or(L.contains(xs, 0n), L.contains(xs, 47n)), Bool.not(N.name_ok(xs))),
    Lemma.chars_sep(xs),
    Lemma.sep_name(Bool.or(L.contains(xs, 0n), L.contains(xs, 47n)), Bool.not(List.is_empty(&2, Nat, xs)), Bool.not(N.is_dots(xs)), N.chars_ok(xs), Nat.is_le(N.utf8_length(xs), 255n)))
