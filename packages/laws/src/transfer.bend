import Base

# The outcome of a namespace operation, decided from facts that an adapter gathers from its storage.
# Every adapter calls these functions, so every backend answers the same way and in the same order.

# What a path reaches: nothing, a file or a collection.
type Node is Data:
  Absent{}
  File{}
  Folder{}

type Outcome is Data:
  # Proceed: the operation may run. `replaces` says whether it replaces an existing destination.
  Proceed{replaces: Bool}
  # The source, or the target of a read or a removal, does not exist.
  Missing{}
  # The parent of the target or the destination is missing or is a file.
  NoParent{}
  # The target already exists (MKCOL), or the destination exists and Overwrite is F.
  Exists{}
  # A collection is the target of a write.
  IsFolder{}
  # The source would be copied or moved into itself, onto itself, or over one of its ancestors.
  IntoItself{}
  # The operation targets the root, which never changes.
  Root{}

def node_exists(n: Node) -> Bool:
  match n:
    case Absent{}:
      False{}
    case File{}:
      True{}
    case Folder{}:
      True{}

def is_folder(n: Node) -> Bool:
  match n:
    case Absent{}:
      False{}
    case File{}:
      False{}
    case Folder{}:
      True{}

def write_parent(replaces: Bool, parent: Node) -> Outcome:
  match parent:
    case Folder{}:
      Proceed{replaces}
    case File{}:
      NoParent{}
    case Absent{}:
      NoParent{}

# A write (PUT) to `target`, whose parent is `parent`.
def decide_write(target: Node, parent: Node) -> Outcome:
  match target:
    case Folder{}:
      IsFolder{}
    case File{}:
      write_parent(True{}, parent)
    case Absent{}:
      write_parent(False{}, parent)

def mkcol_target(target: Node, parent: Node) -> Outcome:
  match target:
    case Absent{}:
      write_parent(False{}, parent)
    case File{}:
      Exists{}
    case Folder{}:
      Exists{}

# Creating a collection (MKCOL). `is_root` holds when the target is the root.
def decide_mkcol(is_root: Bool, target: Node, parent: Node) -> Outcome:
  match is_root:
    case True{}:
      Exists{}
    case False{}:
      mkcol_target(target, parent)

def remove_target(target: Node) -> Outcome:
  match target:
    case Absent{}:
      Missing{}
    case File{}:
      Proceed{False{}}
    case Folder{}:
      Proceed{False{}}

# Removing (DELETE) a target.
def decide_remove(is_root: Bool, target: Node) -> Outcome:
  match is_root:
    case True{}:
      Root{}
    case False{}:
      remove_target(target)

def copy_over(overwrite: Bool, dest_parent: Node) -> Outcome:
  match overwrite:
    case True{}:
      write_parent(True{}, dest_parent)
    case False{}:
      Exists{}

def copy_dest(dest: Node, dest_parent: Node, overwrite: Bool) -> Outcome:
  match dest:
    case Absent{}:
      write_parent(False{}, dest_parent)
    case File{}:
      copy_over(overwrite, dest_parent)
    case Folder{}:
      copy_over(overwrite, dest_parent)

def copy_root(dest_is_root: Bool, dest: Node, dest_parent: Node, overwrite: Bool) -> Outcome:
  match dest_is_root:
    case True{}:
      Root{}
    case False{}:
      copy_dest(dest, dest_parent, overwrite)

def copy_inside(
  folder: Bool, inside: Bool, dest_is_root: Bool, dest: Node, dest_parent: Node, overwrite: Bool
) -> Outcome:
  match inside:
    case True{}:
      IntoItself{}
    case False{}:
      copy_root(dest_is_root, dest, dest_parent, overwrite)

# Copying `source` to `dest`. `inside` holds when the destination equals the source, lies under it,
# or contains it: replacing an ancestor of the source would delete the source with it.
# `dest_parent` is what the destination's parent path reaches.
def decide_copy(
  source: Node, inside: Bool, dest_is_root: Bool, dest: Node, dest_parent: Node, overwrite: Bool
) -> Outcome:
  match source:
    case Absent{}:
      Missing{}
    case File{}:
      copy_inside(False{}, inside, dest_is_root, dest, dest_parent, overwrite)
    case Folder{}:
      copy_inside(True{}, inside, dest_is_root, dest, dest_parent, overwrite)

# Moving: the rules of copying, after the rule that the root never moves.
def decide_move(
  source_is_root: Bool, source: Node, inside: Bool, dest_is_root: Bool, dest: Node,
  dest_parent: Node, overwrite: Bool
) -> Outcome:
  match source_is_root:
    case True{}:
      Root{}
    case False{}:
      decide_copy(source, inside, dest_is_root, dest, dest_parent, overwrite)

# Whether a copy or move of `count` entries stays within the `limit` that a backend handles in
# one request. A request over the limit executes nothing.
def within_limit(+count: Nat, +limit: Nat) -> Bool:
  Nat.is_le(count, limit)

# Whether a move resumes rather than starts: an earlier move of the same source to the same
# destination stopped while it removed the source, after copying everything, so the destination
# is kept and only the rest of the source is copied over it and removed. `journal_matches` holds
# when the source records that move.
def resume_move(journal_matches: Bool, dest: Node) -> Bool:
  match journal_matches:
    case True{}:
      is_folder(dest)
    case False{}:
      False{}
