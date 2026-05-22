# AgenticScore GitHub Action

Score your OpenAPI spec for AI agent readiness on every pull request.

## Usage

```yaml
- uses: slaterhaus/agenticscore-action@v1
  with:
    api-key: ${{ secrets.AGENTICSCORE_API_KEY }}
    spec-path: openapi.yaml
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Add `AGENTICSCORE_API_KEY` to your repository secrets (Settings → Secrets → Actions). A Pro plan API key is required.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api-key` | ✅ | — | Your AgenticScore API key (`ar_live_...`) |
| `spec-path` | ✅ | — | Path to your OpenAPI spec (JSON or YAML) |
| `fail-below` | — | _(never fail)_ | Fail the workflow if score drops below this threshold (0–100) |
| `api-url` | — | `https://api.agenticscore.dev` | Override the API base URL |

## Outputs

| Output | Description |
|---|---|
| `score` | Overall score (0–100) |
| `grade` | Letter grade (A–F) |
| `passed` | `true` if the score met the `fail-below` threshold |

## What you get

Every PR that touches your spec gets a comment like this:

---

## 🟡 AgenticScore — 62/100 (C)

`██████░░░░` **62** · `openapi.yaml`

**Pet Store API** v1.0.0 · 12 operations · 8 schemas

| Category | Score |
|---|---|
| examples | 🔴 12 |
| semantics | 🟢 100 |
| intent | 🟢 95 |
| errors | 🔴 0 |
| parameters | 🟢 88 |
| pagination | 🟡 67 |

**Top findings**

- 11/12 operations lack examples
- No error responses documented

<sub>Scored by [AgenticScore](https://agenticscore.dev) · [Improve your score](https://agenticscore.dev/docs)</sub>

---

## Full example workflow

```yaml
name: AgenticScore

on:
  pull_request:
    paths:
      - 'openapi.yaml'

jobs:
  score:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write

    steps:
      - uses: actions/checkout@v4

      - name: Score OpenAPI spec
        uses: slaterhaus/agenticscore-action@v1
        with:
          api-key: ${{ secrets.AGENTICSCORE_API_KEY }}
          spec-path: openapi.yaml
          fail-below: 70
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Get an API key

[agenticscore.dev/#pricing](https://agenticscore.dev/#pricing)
