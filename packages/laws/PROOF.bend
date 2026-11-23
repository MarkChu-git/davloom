import Base
import ./LAWS.bend as L
import ./src/transfer.bend as T
import ./src/policy.bend as P
import ./src/preconditions.bend as C

def L.write_into_folder(target, parent):
  match target:
    case T.Absent{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case T.File{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case T.Folder{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}

def L.write_replaces_existing(target, parent):
  match target:
    case T.Absent{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case T.File{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case T.Folder{}:
      match parent:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}

def L.mkcol_creates_new(root, target, parent):
  match root:
    case False{}:
      match target:
        case T.Absent{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
        case T.File{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
        case T.Folder{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
    case True{}:
      match target:
        case T.Absent{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
        case T.File{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}
        case T.Folder{}:
          match parent:
            case T.Absent{}:
              {==}
            case T.File{}:
              {==}
            case T.Folder{}:
              {==}

def L.remove_keeps_root(root, target):
  match root:
    case False{}:
      match target:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}
    case True{}:
      match target:
        case T.Absent{}:
          {==}
        case T.File{}:
          {==}
        case T.Folder{}:
          {==}

def L.copy_decides_in_order(source, inside, dest_root, dest, parent, overwrite):
  match source:
    case T.Absent{}:
      match inside:
        case False{}:
          match dest_root:
            case False{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
        case True{}:
          match dest_root:
            case False{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
    case T.File{}:
      match inside:
        case False{}:
          match dest_root:
            case False{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
        case True{}:
          match dest_root:
            case False{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
    case T.Folder{}:
      match inside:
        case False{}:
          match dest_root:
            case False{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
        case True{}:
          match dest_root:
            case False{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
            case True{}:
              match dest:
                case T.Absent{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.File{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                case T.Folder{}:
                  match parent:
                    case T.Absent{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.File{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}
                    case T.Folder{}:
                      match overwrite:
                        case False{}:
                          {==}
                        case True{}:
                          {==}

def L.move_decides_in_order(source_root, source, inside, dest_root, dest, parent, overwrite):
  match source_root:
    case False{}:
      match source:
        case T.Absent{}:
          match inside:
            case False{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
            case True{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
        case T.File{}:
          match inside:
            case False{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
            case True{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
        case T.Folder{}:
          match inside:
            case False{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
            case True{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
    case True{}:
      match source:
        case T.Absent{}:
          match inside:
            case False{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
            case True{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
        case T.File{}:
          match inside:
            case False{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
            case True{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
        case T.Folder{}:
          match inside:
            case False{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
            case True{}:
              match dest_root:
                case False{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                case True{}:
                  match dest:
                    case T.Absent{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.File{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                    case T.Folder{}:
                      match parent:
                        case T.Absent{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.File{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}
                        case T.Folder{}:
                          match overwrite:
                            case False{}:
                              {==}
                            case True{}:
                              {==}

def L.authorize_matches_spec(a, m, target, dest):
  match a:
    case P.ReadOnly{}:
      match m:
        case P.MOptions{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MGet{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MHead{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MPropfind{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MPut{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MMkcol{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MDelete{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MProppatch{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MCopy{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MMove{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MLock{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MUnlock{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MOther{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
    case P.ReadWrite{}:
      match m:
        case P.MOptions{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MGet{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MHead{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MPropfind{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MPut{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MMkcol{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MDelete{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MProppatch{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MCopy{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MMove{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MLock{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MUnlock{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
        case P.MOther{}:
          match target:
            case False{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}
            case True{}:
              match dest:
                case False{}:
                  {==}
                case True{}:
                  {==}

def L.read_only_never_writes(m, target, dest):
  match m:
    case P.MOptions{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MGet{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MHead{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MPropfind{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MPut{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MMkcol{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MDelete{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MProppatch{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MCopy{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MMove{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MLock{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MUnlock{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.MOther{}:
      match target:
        case False{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case True{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}

def L.denied_outside_scope(a, m, dest):
  match a:
    case P.ReadOnly{}:
      match m:
        case P.MOptions{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MGet{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MHead{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MPropfind{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MPut{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MMkcol{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MDelete{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MProppatch{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MCopy{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MMove{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MLock{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MUnlock{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MOther{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
    case P.ReadWrite{}:
      match m:
        case P.MOptions{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MGet{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MHead{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MPropfind{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MPut{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MMkcol{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MDelete{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MProppatch{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MCopy{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MMove{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MLock{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MUnlock{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}
        case P.MOther{}:
          match dest:
            case False{}:
              {==}
            case True{}:
              {==}

def L.preconditions_in_rfc_order(read, if_match, if_unmodified, if_none_match, if_modified):
  match read:
    case False{}:
      match if_match:
        case C.Unset{}:
          match if_unmodified:
            case C.Unset{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Holds{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Fails{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
        case C.Holds{}:
          match if_unmodified:
            case C.Unset{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Holds{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Fails{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
        case C.Fails{}:
          match if_unmodified:
            case C.Unset{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Holds{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Fails{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
    case True{}:
      match if_match:
        case C.Unset{}:
          match if_unmodified:
            case C.Unset{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Holds{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Fails{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
        case C.Holds{}:
          match if_unmodified:
            case C.Unset{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Holds{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Fails{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
        case C.Fails{}:
          match if_unmodified:
            case C.Unset{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Holds{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
            case C.Fails{}:
              match if_none_match:
                case C.Unset{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Holds{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
                case C.Fails{}:
                  match if_modified:
                    case C.Unset{}:
                      {==}
                    case C.Holds{}:
                      {==}
                    case C.Fails{}:
                      {==}
