import Base

# What a migration does with one entry of the source tree, given what the target holds at its path.
# A file counts as the same when its size and SHA-256 match.

type Source is Data:
  SFile{}
  SFolder{}

type Target is Data:
  TAbsent{}
  TSame{}
  TDiffers{}
  TFolder{}

type Action is Data:
  # Create the collection.
  Create{}
  # Write the file's content.
  Write{}
  # Leave the target as it is: it holds this entry already.
  Skip{}
  # Stop at this entry: the target holds something else there.
  Conflict{}

def folder_action(t: Target) -> Action:
  match t:
    case TAbsent{}:
      Create{}
    case TSame{}:
      Conflict{}
    case TDiffers{}:
      Conflict{}
    case TFolder{}:
      Skip{}

def file_action(t: Target, overwrite: Bool) -> Action:
  match t:
    case TAbsent{}:
      Write{}
    case TSame{}:
      Skip{}
    case TDiffers{}:
      Bool.pick(Action, overwrite, Write{}, Conflict{})
    case TFolder{}:
      Conflict{}

# The action for one entry. With `overwrite`, a file that differs is replaced; nothing else is.
def decide(s: Source, t: Target, overwrite: Bool) -> Action:
  match s:
    case SFile{}:
      file_action(t, overwrite)
    case SFolder{}:
      folder_action(t)
