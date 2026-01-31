## 2024-05-23 - Brittle Regex for Sensitive Data
**Vulnerability:** The sensitive data redaction used `\b` (word boundaries) which failed to match keywords separated by underscores (e.g., `api_key`) because `_` is considered a word character in Regex `\w`.
**Learning:** Standard regex boundaries are insufficient for variable naming conventions like snake_case in input attributes.
**Prevention:** Use custom lookarounds `(?:^|[^a-zA-Z0-9])` to enforce boundaries based on alphanumeric characters instead of `\b`.
