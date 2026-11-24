def L.if_state_exact(present, parsed, cs):
  match present:
    case False{}:
      {==}
    case True{}:
      match parsed:
        case False{}:
          {==}
        case True{}:
          Lemma.state_of(K.header_true(cs))
