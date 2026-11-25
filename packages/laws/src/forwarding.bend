import Base

# Which address a request came from, when proxies in front of a self-hosted instance forward it
# (PRD §12). The hops are read from the nearest: the socket's peer first, then the addresses of
# X-Forwarded-For from the right, each appended by the hop before it. A hop is trusted when the
# deployment names it as one of its proxies (DAVLOOM_TRUSTED_PROXIES), and invalid when it is no
# address. Only a trusted proxy's word about the hop before it counts, so the client is the
# nearest hop that is not a trusted proxy. An invalid hop says nothing, so the trusted proxy that
# wrote it stands for the client; and a chain of trusted proxies alone ends at its farthest one.

type Hop is Data:
  HTrusted{}
  HUntrusted{}
  HInvalid{}

type Pick is Data:
  PThis{}
  PNext{}
  PPrevious{}

# What to do at a hop: take it as the client, go on to the hop before it, or take the hop after it,
# the nearer one. `more` says whether the chain names a hop before this one.
def step(hop: Hop, more: Bool) -> Pick:
  match hop:
    case HTrusted{}:
      match more:
        case True{}:
          PNext{}
        case False{}:
          PThis{}
    case HUntrusted{}:
      PThis{}
    case HInvalid{}:
      PPrevious{}
