import Base

# HTTP message framing at the servers' edges (RFC 9110 §6.4, §7.1, §8.6). The wrappers read the
# request line, the headers and the body; this module decides.

# A response status, as far as its framing goes.
type StatusKind is Data:
  # 1xx
  KInformational{}
  # 204
  KNoContent{}
  # 304
  KNotModified{}
  KOther{}

def may_have_length(k: StatusKind) -> Bool:
  match k:
    case KInformational{}:
      False{}
    case KNoContent{}:
      False{}
    case KNotModified{}:
      False{}
    case KOther{}:
      True{}

# Whether the self-hosted server gives a body the Content-Length it measured: when the answer
# names none, its body ended within the measured bytes, and its status may carry one.
def measured_length(given: Bool, ended: Bool, +k: StatusKind) -> Bool:
  match given:
    case True{}:
      False{}
    case False{}:
      Bool.and(ended, may_have_length(k))

# Whether the Workers entry sends a WebDAV body through a stream of the length its Content-Length
# names: only an uncompressed body whose header is a decimal number below 2^53, since otherwise
# the header does not count the bytes the stream holds.
def fixed_length(has_body: Bool, has_header: Bool, webdav: Bool, encoded: Bool, numeric: Bool) -> Bool:
  Bool.and(has_body, Bool.and(has_header, Bool.and(webdav, Bool.and(Bool.not(encoded), numeric))))

# The form of a request target (RFC 9112 §3.2).
type Form is Data:
  # /path?query
  FOrigin{}
  # http://host/path?query
  FAbsolute{}
  # OPTIONS *
  FAsterisk{}
  # Anything else, which names no resource.
  FInvalid{}

type PathFrom is Data:
  # The target as it is.
  PTarget{}
  # The path and query of an absolute-form target, without its scheme and host.
  PAbsolute{}
  # The root.
  PSlash{}

type HostFrom is Data:
  # The Host header.
  HHeader{}
  # A host that names nothing, never a loopback name.
  HNone{}

type Url is Data:
  Url{path: PathFrom, host: HostFrom}

def host_from(ok: Bool) -> HostFrom:
  match ok:
    case True{}:
      HHeader{}
    case False{}:
      HNone{}

# The URL of a request. The scheme is always http: and the host is the Host header's or none: an
# absolute-form target cannot choose either, so it cannot pass the HTTPS-only check or pick the
# origin. `host_ok` holds for a Host header that names a host and nothing else.
def url_of(f: Form, host_ok: Bool) -> Url:
  match f:
    case FOrigin{}:
      Url{PTarget{}, host_from(host_ok)}
    case FAbsolute{}:
      Url{PAbsolute{}, host_from(host_ok)}
    case FAsterisk{}:
      Url{PSlash{}, HNone{}}
    case FInvalid{}:
      Url{PSlash{}, HNone{}}

# A request to the root path `/`, by its method. The Dashboard answers there and WebDAV under
# /dav/, yet a WebDAV client given the bare address of the instance, as Finder's Connect to
# Server is, sends its OPTIONS and PROPFIND to `/`.
type RootMethod is Data:
  # GET and HEAD, which a browser sends to open the Dashboard.
  RRead{}
  # A WebDAV method other than GET and HEAD: OPTIONS, PROPFIND, PROPPATCH, MKCOL, PUT, DELETE,
  # COPY, MOVE, LOCK and UNLOCK (RFC 4918 §9).
  RDav{}
  # Any other method.
  ROther{}

type RootAnswer is Data:
  # The Dashboard's page.
  ADashboard{}
  # 308 Permanent Redirect to /dav/, which keeps the method and the body (RFC 9110 §15.4.9).
  AToDav{}
  # 405 Method Not Allowed.
  ARefuse{}

def root_answer(m: RootMethod) -> RootAnswer:
  match m:
    case RRead{}:
      ADashboard{}
    case RDav{}:
      AToDav{}
    case ROther{}:
      ARefuse{}
