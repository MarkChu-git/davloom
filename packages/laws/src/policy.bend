import Base

# Permission decisions for WebDAV requests made with an API Key.

type Access is Data:
  ReadOnly{}
  ReadWrite{}

type Method is Data:
  MOptions{}
  MGet{}
  MHead{}
  MPropfind{}
  MPut{}
  MMkcol{}
  MDelete{}
  MProppatch{}
  MCopy{}
  MMove{}
  MLock{}
  MUnlock{}
  MOther{}

def can_write(access: Access) -> Bool:
  match access:
    case ReadOnly{}:
      False{}
    case ReadWrite{}:
      True{}

# Whether the method changes its request target.
def writes_target(m: Method) -> Bool:
  match m:
    case MOptions{}:
      False{}
    case MGet{}:
      False{}
    case MHead{}:
      False{}
    case MPropfind{}:
      False{}
    case MPut{}:
      True{}
    case MMkcol{}:
      True{}
    case MDelete{}:
      True{}
    case MProppatch{}:
      True{}
    case MCopy{}:
      False{}
    case MMove{}:
      True{}
    case MLock{}:
      True{}
    case MUnlock{}:
      True{}
    case MOther{}:
      True{}

# Whether the method has a Destination that it writes.
def has_destination(m: Method) -> Bool:
  match m:
    case MOptions{}:
      False{}
    case MGet{}:
      False{}
    case MHead{}:
      False{}
    case MPropfind{}:
      False{}
    case MPut{}:
      False{}
    case MMkcol{}:
      False{}
    case MDelete{}:
      False{}
    case MProppatch{}:
      False{}
    case MCopy{}:
      True{}
    case MMove{}:
      True{}
    case MLock{}:
      False{}
    case MUnlock{}:
      False{}
    case MOther{}:
      False{}

def is_known(m: Method) -> Bool:
  match m:
    case MOther{}:
      False{}
    case MOptions{}:
      True{}
    case MGet{}:
      True{}
    case MHead{}:
      True{}
    case MPropfind{}:
      True{}
    case MPut{}:
      True{}
    case MMkcol{}:
      True{}
    case MDelete{}:
      True{}
    case MProppatch{}:
      True{}
    case MCopy{}:
      True{}
    case MMove{}:
      True{}
    case MLock{}:
      True{}
    case MUnlock{}:
      True{}

def allows_target(+access: Access, +m: Method) -> Bool:
  Bool.or(Bool.not(writes_target(m)), can_write(access))

def allows_destination(+access: Access, +m: Method, dest_in_scope: Bool) -> Bool:
  Bool.or(Bool.not(has_destination(m)), Bool.and(dest_in_scope, can_write(access)))

# A request is allowed when the method is known, its target lies in the key's scope, the key may
# write when the method writes the target, and, for COPY and MOVE, the destination lies in the
# key's scope and the key may write.
def authorize(+access: Access, +m: Method, target_in_scope: Bool, dest_in_scope: Bool) -> Bool:
  Bool.and(
    Bool.and(is_known(m), target_in_scope),
    Bool.and(allows_target(access, m), allows_destination(access, m, dest_in_scope)))
