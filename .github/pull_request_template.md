## What and why

<!-- What changes, and what problem it solves. -->

## Type

- [ ] Bug fix
- [ ] New tool or prompt
- [ ] Enhancement to existing behaviour
- [ ] Refactor / internal
- [ ] Docs

## Verification

- [ ] `npm run verify` passes locally

<!-- If behaviour changed, describe how you confirmed it — e.g. tested against a
     real workspace, exercised via `npm run inspector`, added unit tests. -->

## Safety checklist

<!-- Delete any line that genuinely does not apply. -->

- [ ] No raw error object is passed to `console.*` (use `logError`)
- [ ] Any query that could exceed 100 tasks uses `searchTasksWindowed`, and coverage is surfaced to the user
- [ ] Story data is read via `resource_subtype`, not by parsing `text`
- [ ] New write operations preview before acting, and were tested with `ASANA_DRY_RUN=true`
- [ ] New tools set `readOnly` correctly, and `destructive: true` where irreversible
- [ ] Rendered tasks include `permalink_url`
- [ ] Empty/zero-result cases produce a useful message

## User-visible changes

<!-- New commands, changed arguments, changed output, new env vars.
     Write "none" if internal only. Note anything breaking. -->
