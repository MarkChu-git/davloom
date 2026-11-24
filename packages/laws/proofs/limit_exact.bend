def L.limit_exact(count, limit):
  match count limit:
    case 0n 0n:
      {==}
    case 0n 1n+l:
      {==}
    case 1n+c 0n:
      {==}
    case 1n+c 1n+l:
      L.limit_exact(c, l)
