def L.import_all_or_nothing(entries, known):
  %Lemma.valid(entries, known) : {I.decide(_, entries) == Bool.pick(I.Plan, L.spec_valid(entries, known), I.Apply{entries}, I.Reject{}) : I.Plan}
  Lemma.decide(L.spec_valid(entries, known), entries)
