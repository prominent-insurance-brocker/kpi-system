"""
SQL validation to ensure only SELECT queries are executed.
Two-layer validation: sqlparse structural check + keyword blocklist.
"""

import sqlparse


# Keywords that indicate non-SELECT operations
BLOCKED_KEYWORDS = {
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE',
    'TRUNCATE', 'REPLACE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE',
}


def validate_sql_is_select_only(sql: str) -> None:
    """
    Validate that the SQL is a SELECT-only query.
    Raises ValueError if the SQL contains non-SELECT operations.
    """
    if not sql or not sql.strip():
        raise ValueError("Empty SQL query")

    cleaned = sql.strip().rstrip(';').strip()

    # Layer 1: sqlparse structural check
    parsed = sqlparse.parse(cleaned)
    if not parsed:
        raise ValueError("Could not parse SQL query")

    for statement in parsed:
        stmt_type = statement.get_type()
        if stmt_type and stmt_type.upper() != 'SELECT':
            raise ValueError(
                f"Only SELECT queries are allowed. Got: {stmt_type}"
            )

    # Layer 2: Keyword blocklist on the first meaningful token
    first_token = cleaned.split()[0].upper() if cleaned.split() else ''
    if first_token in BLOCKED_KEYWORDS:
        raise ValueError(
            f"Blocked SQL operation: {first_token}. Only SELECT queries are allowed."
        )

    # Layer 3: Check for blocked keywords at statement boundaries (after semicolons)
    # This catches cases like "SELECT 1; DROP TABLE ..."
    for statement in parsed:
        tokens = [t for t in statement.tokens if not t.is_whitespace]
        if tokens:
            first_meaningful = str(tokens[0]).strip().upper()
            if first_meaningful in BLOCKED_KEYWORDS:
                raise ValueError(
                    f"Blocked SQL operation: {first_meaningful}. Only SELECT queries are allowed."
                )
