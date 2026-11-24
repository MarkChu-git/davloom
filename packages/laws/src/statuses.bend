import Base

# The HTTP status that answers each way a storage operation can fail (RFC 9110 §15, RFC 4918 §9,
# §11, PRD §5). The wrapper maps the storage contract's failure names onto these constructors.

type Failure is Data:
  FNotFound{}
  FNoParent{}
  FExists{}
  FIsCollection{}
  FNotCollection{}
  FIntoItself{}
  FRoot{}
  FInsufficientStorage{}
  FTooLarge{}
  FSizeMismatch{}
  FUnavailable{}
  FNameRefused{}
  FNameRefusedReplaced{}
  FHiddenObjects{}
  FCrossBackend{}
  FTooMany{}

def status(f: Failure) -> Nat:
  match f:
    case FNotFound{}:
      404n
    case FNoParent{}:
      409n
    # MKCOL on a mapped URL, or PUT on a collection: the method is not allowed there.
    case FExists{}:
      405n
    case FIsCollection{}:
      405n
    case FNotCollection{}:
      409n
    case FIntoItself{}:
      403n
    case FRoot{}:
      403n
    case FInsufficientStorage{}:
      507n
    case FTooLarge{}:
      413n
    case FSizeMismatch{}:
      400n
    case FUnavailable{}:
      503n
    # A name the store refuses for good is the client's to change, not a fault to retry later.
    case FNameRefused{}:
      403n
    case FNameRefusedReplaced{}:
      403n
    case FHiddenObjects{}:
      409n
    case FCrossBackend{}:
      502n
    case FTooMany{}:
      403n
