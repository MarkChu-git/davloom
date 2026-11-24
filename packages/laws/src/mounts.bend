import Base

# The WebDAV namespace of Mounts (PRD §5): a virtual root whose members are the Mounts. The
# wrapper finds where a path lies; this module decides whether a request goes to the Mount's
# backend or is answered here, and with which failure.

# Where a path lies in the namespace.
type Where is Data:
  # The virtual root.
  WRoot{}
  # A member of the root that is no Mount.
  WUnknownTop{}
  # Under a member of the root that is no Mount.
  WUnknownDeep{}
  # A Mount's own root.
  WMountRoot{}
  # Inside a Mount.
  WInside{}

type Op is Data:
  OpStat{}
  OpList{}
  OpRead{}
  OpWrite{}
  OpMkcol{}
  OpRemove{}
  OpPatch{}
  OpQuota{}

type Route is Data:
  # The Mount's backend answers.
  Delegate{}
  # The namespace answers itself: the root's entry, or the list of Mounts.
  Virtual{}
  MNotFound{}
  MNoParent{}
  MExists{}
  MIsCollection{}
  MNotCollection{}
  MIntoItself{}
  MRoot{}
  MCrossBackend{}

# Creating outside every Mount: at the root's level a new member would be a new Mount, which
# WebDAV cannot make; deeper, its parent does not exist (RFC 4918 §9.3.1, §9.7.1).
def outside(w: Where) -> Route:
  match w:
    case WRoot{}:
      MRoot{}
    case WUnknownTop{}:
      MRoot{}
    case WUnknownDeep{}:
      MNoParent{}
    case WMountRoot{}:
      Delegate{}
    case WInside{}:
      Delegate{}

def route_stat(w: Where) -> Route:
  match w:
    case WRoot{}:
      Virtual{}
    case WUnknownTop{}:
      MNotFound{}
    case WUnknownDeep{}:
      MNotFound{}
    case WMountRoot{}:
      Delegate{}
    case WInside{}:
      Delegate{}

def route_read(w: Where) -> Route:
  match w:
    case WRoot{}:
      MIsCollection{}
    case WUnknownTop{}:
      MNotFound{}
    case WUnknownDeep{}:
      MNotFound{}
    case WMountRoot{}:
      Delegate{}
    case WInside{}:
      Delegate{}

def route_write(w: Where) -> Route:
  match w:
    case WMountRoot{}:
      MIsCollection{}
    case WRoot{}:
      outside(WRoot{})
    case WUnknownTop{}:
      outside(WUnknownTop{})
    case WUnknownDeep{}:
      outside(WUnknownDeep{})
    case WInside{}:
      Delegate{}

def route_mkcol(w: Where) -> Route:
  match w:
    case WRoot{}:
      MExists{}
    case WMountRoot{}:
      MExists{}
    case WUnknownTop{}:
      outside(WUnknownTop{})
    case WUnknownDeep{}:
      outside(WUnknownDeep{})
    case WInside{}:
      Delegate{}

def route_remove(w: Where) -> Route:
  match w:
    case WRoot{}:
      MRoot{}
    case WUnknownTop{}:
      MRoot{}
    case WUnknownDeep{}:
      MNotFound{}
    case WMountRoot{}:
      MRoot{}
    case WInside{}:
      Delegate{}

def route_patch(w: Where) -> Route:
  match w:
    case WRoot{}:
      MRoot{}
    case WUnknownTop{}:
      MNotFound{}
    case WUnknownDeep{}:
      MNotFound{}
    case WMountRoot{}:
      Delegate{}
    case WInside{}:
      Delegate{}

def route_quota(w: Where) -> Route:
  match w:
    case WRoot{}:
      MNotCollection{}
    case WUnknownTop{}:
      MNotFound{}
    case WUnknownDeep{}:
      MNotFound{}
    case WMountRoot{}:
      Delegate{}
    case WInside{}:
      Delegate{}

def route(op: Op, w: Where) -> Route:
  match op:
    case OpStat{}:
      route_stat(w)
    case OpList{}:
      route_stat(w)
    case OpRead{}:
      route_read(w)
    case OpWrite{}:
      route_write(w)
    case OpMkcol{}:
      route_mkcol(w)
    case OpRemove{}:
      route_remove(w)
    case OpPatch{}:
      route_patch(w)
    case OpQuota{}:
      route_quota(w)

def mounted(w: Where) -> Bool:
  match w:
    case WRoot{}:
      False{}
    case WUnknownTop{}:
      False{}
    case WUnknownDeep{}:
      False{}
    case WMountRoot{}:
      True{}
    case WInside{}:
      True{}

def is_mount_root(w: Where) -> Bool:
  match w:
    case WRoot{}:
      False{}
    case WUnknownTop{}:
      False{}
    case WUnknownDeep{}:
      False{}
    case WMountRoot{}:
      True{}
    case WInside{}:
      False{}

def transfer_unmounted_source(from: Where, move: Bool) -> Route:
  match from:
    case WRoot{}:
      match move:
        case True{}:
          MRoot{}
        case False{}:
          MIntoItself{}
    case WUnknownTop{}:
      MNotFound{}
    case WUnknownDeep{}:
      MNotFound{}
    case WMountRoot{}:
      MNotFound{}
    case WInside{}:
      MNotFound{}

def transfer_mounted(root_touched: Bool, same_backend: Bool) -> Route:
  match root_touched:
    case True{}:
      MRoot{}
    case False{}:
      match same_backend:
        case True{}:
          Delegate{}
        case False{}:
          MCrossBackend{}

def transfer_target(target_mounted: Bool, root_touched: Bool, same_backend: Bool) -> Route:
  match target_mounted:
    case False{}:
      MRoot{}
    case True{}:
      transfer_mounted(root_touched, same_backend)

def transfer_source(source_mounted: Bool, +from: Where, +to: Where, move: Bool, same_backend: Bool) -> Route:
  match source_mounted:
    case False{}:
      transfer_unmounted_source(from, move)
    case True{}:
      transfer_target(mounted(to), Bool.or(Bool.and(move, is_mount_root(from)), is_mount_root(to)), same_backend)

# COPY and MOVE between two paths of the namespace. The virtual root and a Mount's root are never
# moved or replaced, and nothing crosses from one backend to another.
def transfer(+from: Where, +to: Where, move: Bool, same_backend: Bool) -> Route:
  transfer_source(mounted(from), from, to, move, same_backend)
