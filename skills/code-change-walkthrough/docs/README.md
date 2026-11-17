# docs/ — background, not runtime

This directory holds material about the skill that the agent does **not** need in order to run it: design rationale, research, and notes for maintainers. `SKILL.md` lists this directory only as background, and nothing tells the agent to read it.

The Agent Skills specification recommends only `scripts/`, `references/`, and `assets/`, and allows any other directory. None of those three is meant for non-runtime material, so it lives here.

| File | Contents |
|---|---|
| `cognitive-foundations.md` | The research basis and bibliography behind each rule in `references/design-rules.md` |

When you change a rule in `references/design-rules.md`, update its rationale here as well.
