def L.name_accepted(xs):
  %Lemma.nonempty(xs) : {N.name_ok(xs) == Bool.and(_, Bool.and(Bool.not(L.dot_name(xs)), Bool.and(L.all_allowed(xs), Nat.is_le(L.utf8_size(xs), 255n)))) : Bool}
  %Lemma.dots(xs) : {N.name_ok(xs) == Bool.and(Bool.not(List.is_empty(&2, Nat, xs)), Bool.and(Bool.not(_), Bool.and(L.all_allowed(xs), Nat.is_le(L.utf8_size(xs), 255n)))) : Bool}
  %Lemma.chars(xs) : {N.name_ok(xs) == Bool.and(Bool.not(List.is_empty(&2, Nat, xs)), Bool.and(Bool.not(N.is_dots(xs)), Bool.and(_, Nat.is_le(L.utf8_size(xs), 255n)))) : Bool}
  %Lemma.utf8(xs) : {N.name_ok(xs) == Bool.and(Bool.not(List.is_empty(&2, Nat, xs)), Bool.and(Bool.not(N.is_dots(xs)), Bool.and(N.chars_ok(xs), Nat.is_le(_, 255n)))) : Bool}
  Lemma.name_bool(Bool.not(List.is_empty(&2, Nat, xs)), Bool.not(N.is_dots(xs)), N.chars_ok(xs), Nat.is_le(N.utf8_length(xs), 255n))
