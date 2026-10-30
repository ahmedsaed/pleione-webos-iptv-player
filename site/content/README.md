# Site content

The words of pleione.merope.dev that matter most, kept as markdown beside the code they
describe, so a change to what leaves the TV and a change to the policy land in the same PR.

| File | Becomes | Used by |
|---|---|---|
| [privacy.md](privacy.md) | `pleione.merope.dev/privacy/` | LG Seller Lounge › privacy policy URL |
| [terms.md](terms.md) | `pleione.merope.dev/terms/` | LG Seller Lounge › terms of use, if asked |
| [setup.md](setup.md) | `pleione.merope.dev/setup/` | the listing's long description links here |
| [support.md](support.md) | `pleione.merope.dev/support/` | LG Seller Lounge › support URL |
| [open-source.md](open-source.md) | `pleione.merope.dev/open-source/` | credits for upstream and TMDB |

**When to touch these:** any change that adds a network call, a third-party service, a new kind
of stored data, or changes the LAN setup service. `grep -rn "https\?://" src bundled-service/src`
lists every endpoint; `docs/storage-and-data.md` lists what is stored where. Button names in
`setup.md` and `support.md` come from `src/i18n/en.ts` — rename one there, rename it here.

**Placeholders** like `[SUPPORT EMAIL]` are allowed while drafting — the site builds — but the
deploy refuses to publish `privacy.md` while one remains.
