# hidden-spec-cli-01-run-20261122

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/jirolu16/hidden-spec-cli-01-run-20261122/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/jirolu16/hidden-spec-cli-01-run-20261122/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend is one command-line tool that applies the edits AI models write to a tree of text files. It reads all four formats models produce: unified diffs (with wrong line numbers, drift and whitespace damage repaired by three-tier line matching), SEARCH/REPLACE blocks, V4A patches, and text-editor tool calls as JSON. Every edit in a patch applies, or none of them do: the tree is written all-or-nothing, with the exact exit codes and output lines SPEC.md specifies, including create, delete, move, --check and --strict.

## Run it

```sh
node main.ts [options] [PATCH]
node check.ts practice.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=77d34c9m&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
