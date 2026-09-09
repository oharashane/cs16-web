# Secrets to reset before anything goes public

*Shane's decision, 9 September 2026: none of these guard anything real while the family is
the only audience, so they are not rotated one at a time. All of them are reset together
before the site is opened to anyone else. This is the list, so nothing is missed then.*

| secret | where it lives | why it is on the list |
|---|---|---|
| `RCON_PASSWORD` | `cs-server/.env`; mirrored in darkoak's user secrets as `Cs16:Rcon:Password` | appeared in a session transcript on 9 September (a `docker logs` line with nested quotes) |
| `SV_PASSWORD` | `cs-server/.env` | the lobby password; it is `0hara`, which is in the repository's history and this file |
| `RELAY_USER` / `RELAY_PASSWORD` | `.relay.env` | the site's login, `ohara` / `0hara`; same |
| `RELAY_ADMIN_KEY` | `.relay.env` | printed into transcripts more than once; see `docs/proposals/auth-without-the-admin-key.md` |
| `SteamIdHashSalt` | `cs-server/shared/reunion.cfg` | a placeholder string, committed |
| invite tokens | `.relay-people.json` (from 9 September) | mint fresh ones for anyone outside the family |

How: generate each into its file with a tool (never type one into a chat), restart the
relay and the server, `dotnet user-secrets set` the rcon mirror, restart darkoak, and send
the family new invite links.
