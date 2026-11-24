import Base

# How much proof of presence a management action asks for. Every route of the management API, and
# every sensitive path of Better Auth, names the effect of its action; this module turns the effect
# into a level, and the level and the session's freshness into a decision.

# What an action does.
type Effect is Data:
  # Reads, and changes nothing.
  EffRead{}
  # Changes records in a way that is easy to undo, such as a display name or a new Mount.
  EffChange{}
  # Ends this browser's own session.
  EffEndSelf{}
  # Deletes or overwrites data: files, folders, Mounts, backends, locks of another client.
  EffDestroy{}
  # Creates, changes or removes a credential: the password, the username, two-step verification,
  # passkeys, API Keys, the sessions of other devices, the secrets of a backend.
  EffCredential{}
  # Takes the instance's data out, as an export does, or puts another instance's in.
  EffDisclose{}

# What the person must do before the action runs.
type Level is Data:
  # Nothing more than being signed in.
  LNone{}
  # Confirm in a dialog; the Dashboard asks, the server does not check.
  LConfirm{}
  # Prove presence again, with the password (and the authenticator code when two-step
  # verification is on) or a passkey, within the last few minutes.
  LStepUp{}

def level(e: Effect) -> Level:
  match e:
    case EffRead{}:
      LNone{}
    case EffChange{}:
      LNone{}
    case EffEndSelf{}:
      LConfirm{}
    case EffDestroy{}:
      LStepUp{}
    case EffCredential{}:
      LStepUp{}
    case EffDisclose{}:
      LStepUp{}

# Whether an action at a level may run, given whether the session proved presence recently.
def allows(l: Level, fresh: Bool) -> Bool:
  match l:
    case LNone{}:
      True{}
    case LConfirm{}:
      True{}
    case LStepUp{}:
      fresh

def permits(e: Effect, fresh: Bool) -> Bool:
  allows(level(e), fresh)
