def L.if_clause_exact(resolved, cs):
  %Lemma.conditions(cs) : {Bool.and(resolved, _) == Bool.and(resolved, Bool.not(L.some_false(cs))) : Bool}
  {==}
