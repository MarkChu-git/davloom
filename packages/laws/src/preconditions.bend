import Base

# Conditional requests (RFC 9110 §13.2.2). The wrapper evaluates each header against the resource
# and passes the result; this module applies the headers in the order the RFC sets.

type Check is Data:
  # The header is absent, or does not apply (a date header on a missing resource or a bad date).
  Unset{}
  # The condition holds: If-Match or If-None-Match lists a matching tag (or `*` on an existing
  # resource), If-Unmodified-Since or If-Modified-Since finds the resource not modified after it
  # (unmodified) or modified after it (modified).
  Holds{}
  Fails{}

type Verdict is Data:
  Pass{}
  # 412 Precondition Failed
  Failed{}
  # 304 Not Modified
  NotModified{}

def step_modified_read(if_modified: Check) -> Verdict:
  match if_modified:
    case Unset{}:
      Pass{}
    case Holds{}:
      Pass{}
    case Fails{}:
      NotModified{}

# Step 4: If-Modified-Since, for GET and HEAD only. Holds means modified after the date.
def step_modified(read: Bool, if_modified: Check) -> Verdict:
  match read:
    case False{}:
      Pass{}
    case True{}:
      step_modified_read(if_modified)

def none_matched(read: Bool) -> Verdict:
  match read:
    case True{}:
      NotModified{}
    case False{}:
      Failed{}

# Step 3: If-None-Match. Holds means a listed tag matches, which fails the condition.
def step_none_match(read: Bool, if_none_match: Check, if_modified: Check) -> Verdict:
  match if_none_match:
    case Unset{}:
      step_modified(read, if_modified)
    case Holds{}:
      none_matched(read)
    case Fails{}:
      Pass{}

# Step 2: If-Unmodified-Since, only when If-Match is absent.
def step_unmodified(
  read: Bool, if_unmodified: Check, if_none_match: Check, if_modified: Check
) -> Verdict:
  match if_unmodified:
    case Unset{}:
      step_none_match(read, if_none_match, if_modified)
    case Holds{}:
      step_none_match(read, if_none_match, if_modified)
    case Fails{}:
      Failed{}

# `read` holds for GET and HEAD.
def evaluate(
  read: Bool, if_match: Check, if_unmodified: Check, if_none_match: Check, if_modified: Check
) -> Verdict:
  match if_match:
    case Unset{}:
      step_unmodified(read, if_unmodified, if_none_match, if_modified)
    case Holds{}:
      step_none_match(read, if_none_match, if_modified)
    case Fails{}:
      Failed{}
