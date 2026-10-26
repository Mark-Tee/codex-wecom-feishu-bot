# Legacy Feishu API

This directory keeps the opt-in Feishu Base Open API client for historical
reference and data conversion tests.

The default robot path does not import these modules. Production browser form
filling lives in `src/platforms/feishu-browser`, and the automatic E2E benchmark
lives in `src/scripts/benchmark-feishu-e2e.mjs`.

Do not enable the API path until a Feishu custom app has been explicitly
authorized for the target Base and its record permissions have been verified.
