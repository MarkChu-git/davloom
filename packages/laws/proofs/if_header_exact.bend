def L.if_header_exact(cs):
  %Lemma.clauses(cs) : {_ == Bool.not(L.all_false(cs)) : Bool}
  {==}
