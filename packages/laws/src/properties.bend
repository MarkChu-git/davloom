import Base

# PROPFIND (RFC 4918 §9.1): which reads a request needs, and where each requested property's
# value comes from. The wrapper reads the store and the live properties; this module decides.

# The body of a PROPFIND: allprop, propname, or prop naming only DAV: properties or some others.
type Query is Data:
  QAllProp{}
  QPropName{}
  QPropDav{}
  QPropOther{}

# Whether the request reads dead properties: allprop and propname list them, and a prop query
# needs them only when it names a property outside DAV:, where no live property is. Nothing is
# read when the credential may see none of the entries.
def reads_dead(any_readable: Bool, q: Query) -> Bool:
  match any_readable:
    case False{}:
      False{}
    case True{}:
      match q:
        case QAllProp{}:
          True{}
        case QPropName{}:
          True{}
        case QPropDav{}:
          False{}
        case QPropOther{}:
          True{}

type Source is Data:
  # The RFC 4331 quota of the collection's backend.
  FromQuota{}
  FromLive{}
  FromDead{}
  # 404 in its own propstat.
  NotFound{}

def from_dead(dav: Bool, dead_present: Bool) -> Source:
  match dav:
    case True{}:
      NotFound{}
    case False{}:
      match dead_present:
        case True{}:
          FromDead{}
        case False{}:
          NotFound{}

def pick_live(live: Bool, dav: Bool, dead_present: Bool) -> Source:
  match live:
    case True{}:
      FromLive{}
    case False{}:
      from_dead(dav, dead_present)

def from_live(+dav: Bool, live_value: Bool, dead_present: Bool) -> Source:
  pick_live(Bool.and(dav, live_value), dav, dead_present)

def pick_quota(quota: Bool, dav: Bool, live_value: Bool, dead_present: Bool) -> Source:
  match quota:
    case True{}:
      FromQuota{}
    case False{}:
      from_live(dav, live_value, dead_present)

# Where a property named in a prop query comes from. `quota_name` holds for a quota name in any
# namespace, `quota_value` when the backend gave the entry's quota, `live_value` when a live
# property of that local name has a value for the entry, and `dead_present` when the entry holds
# a dead property of that exact name. Live properties and the quota live in DAV: only; no dead
# property does, since PROPPATCH refuses that namespace.
def source(
  +dav: Bool, quota_name: Bool, collection: Bool, quota_value: Bool, live_value: Bool, dead_present: Bool
) -> Source:
  pick_quota(Bool.and(dav, Bool.and(quota_name, Bool.and(collection, quota_value))), dav, live_value, dead_present)
