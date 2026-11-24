import Base

# Object stores (S3 and S3-compatible): what an error from the store means for the storage
# contract, and when a refused key may be taken for absent. The wrapper reads the SDK's error and
# runs the listings; this module decides.

# The code of a store's error, sorted into what Davloom tells apart.
type Code is Data:
  # Not an answer of the store at all, such as a network failure.
  CNotStore{}
  # NoSuchKey or NotFound
  CNoSuchKey{}
  # EntityTooLarge
  CTooLarge{}
  # A code with which a store refuses an object key, such as InvalidArgument or KeyTooLongError.
  CRefusedKey{}
  # An answer without a code.
  CNoCode{}
  # RustFS's 500 for a refusal whose message it could not write as XML.
  CUnwritable{}
  # PreconditionFailed
  CPrecondition{}
  # A code that says the store is full.
  CFull{}
  COther{}

# The HTTP status of the store's answer, as far as it matters.
type Status is Data:
  S400{}
  S412{}
  S507{}
  SOther{}

type Failure is Data:
  ONotFound{}
  OTooLarge{}
  ONameRefused{}
  OExists{}
  OFull{}
  OUnavailable{}

def is_400(s: Status) -> Bool:
  match s:
    case S400{}:
      True{}
    case S412{}:
      False{}
    case S507{}:
      False{}
    case SOther{}:
      False{}

def by_status(s: Status) -> Failure:
  match s:
    case S412{}:
      OExists{}
    case S507{}:
      OFull{}
    case S400{}:
      OUnavailable{}
    case SOther{}:
      OUnavailable{}

def refused_or(refused: Bool, other: Failure) -> Failure:
  match refused:
    case True{}:
      ONameRefused{}
    case False{}:
      other

# A conditional write that found its key answers 412 whatever its code says.
def full_unless_412(s: Status) -> Failure:
  match s:
    case S412{}:
      OExists{}
    case S400{}:
      OFull{}
    case S507{}:
      OFull{}
    case SOther{}:
      OFull{}

def by_code(c: Code, +s: Status, head: Bool) -> Failure:
  match c:
    case CNotStore{}:
      OUnavailable{}
    case CNoSuchKey{}:
      ONotFound{}
    case CTooLarge{}:
      OTooLarge{}
    case CRefusedKey{}:
      refused_or(is_400(s), by_status(s))
    case CNoCode{}:
      refused_or(Bool.and(is_400(s), head), by_status(s))
    case CUnwritable{}:
      ONameRefused{}
    case CPrecondition{}:
      OExists{}
    case CFull{}:
      full_unless_412(s)
    case COther{}:
      by_status(s)

# The failure for a store's error with code `c` and status `s`, in answer to HEAD when `head`.
# Davloom builds every part of its requests but the key, so a 400 with a key-refusal code is about
# the key. A 400 without a code is a refusal only in answer to HEAD, which never has a body; to
# any other request it comes from something else, such as a proxy, and must not make the store
# look empty.
def classify(c: Code, +s: Status, head: Bool) -> Failure:
  by_code(c, s, head)

# What a listing of a refused key as a prefix, limited to one entry, showed.
type Listing is Data:
  # The key itself: the object exists, and the store refused to read it.
  LShowsKey{}
  # Anything else, or nothing: no longer key sorts before the key, so the object is absent.
  LNotKey{}
  # The store refused the prefix too.
  LRefused{}
  # The listing failed otherwise.
  LFailed{}

type Confirm is Data:
  # The key holds no object: the read finds nothing.
  Absent{}
  # 503: something is wrong with the store.
  Fault{}
  # The listing's own failure.
  ListingFailure{}

# Whether a key whose read the store refused is absent (a refused read of an object stored with a
# customer's key, or through a proxy, must not let a write replace it).
def confirm_absent(l: Listing) -> Confirm:
  match l:
    case LShowsKey{}:
      Fault{}
    case LNotKey{}:
      Absent{}
    case LRefused{}:
      Absent{}
    case LFailed{}:
      ListingFailure{}

type Page is Data:
  # The listing of the refused prefix is empty.
  EmptyPage{}
  PageFault{}

# A refused first page names a prefix that no key starts with; a refused later page was refused
# for its cursor, and taking it as the end would cut the listing short.
def refused_page(later: Bool) -> Page:
  match later:
    case False{}:
      EmptyPage{}
    case True{}:
      PageFault{}

type Refusal is Data:
  # Nothing changed.
  RNothingChanged{}
  # The destination the request was to replace is gone; nothing arrived in its place.
  RReplacedGone{}

# A copy or move that the store refused part-way, once the request took back what it wrote.
def copy_refused(replaces: Bool) -> Refusal:
  match replaces:
    case False{}:
      RNothingChanged{}
    case True{}:
      RReplacedGone{}
