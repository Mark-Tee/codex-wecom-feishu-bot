# Contributing

1. Keep credentials and real business data out of commits.
2. Add tests for parser, task number, Feishu field, or workflow changes.
3. Run checks appropriate to the change: behavior changes need `npm test` and `npm run check`; documentation-only changes need relative-link/module-path checks. Doctor may inspect a real deployment and is not a substitute for offline tests.
4. Update both READMEs, relevant module docs and `/help`/HELP_ENTRIES whenever commands or user-visible behavior change. Do not present an untested target as an accepted result.
5. Keep browser automation opt-in and preserve the "never reuse another open
   record card" safety rule.
6. Run `npm run scan:secrets` before committing.

By contributing, you agree that your contribution is licensed under the MIT
License.

Keep private/public source boundaries explicit. Publish only sanitized generic changes, never whole private history or runtime data. Branch pushes and draft pull requests are reviewable delivery; merging the default branch or deploying a service is a separate action.
