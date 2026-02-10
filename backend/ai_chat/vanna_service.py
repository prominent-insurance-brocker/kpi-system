"""
Core Vanna.ai service for text-to-SQL generation.
Uses a singleton pattern with lazy initialization and thread-safe locking.
"""

import logging
import threading

import pandas as pd
from django.conf import settings
from vanna.legacy.openai import OpenAI_Chat
from vanna.legacy.chromadb import ChromaDB_VectorStore

from .sql_validator import validate_sql_is_select_only
from .training_data import get_ddl_statements, get_documentation, get_example_queries

logger = logging.getLogger(__name__)

MAX_RESULT_ROWS = 500


class KPIVanna(ChromaDB_VectorStore, OpenAI_Chat):
    """Vanna subclass configured for this KPI system."""

    def __init__(self, config=None):
        ChromaDB_VectorStore.__init__(self, config=config)
        OpenAI_Chat.__init__(self, config=config)

    def run_sql(self, sql: str) -> pd.DataFrame:
        """Execute SQL using Django's database connection."""
        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute(sql)
            columns = [col[0] for col in cursor.description]
            rows = cursor.fetchall()
        return pd.DataFrame(rows, columns=columns)


# Singleton instance with thread-safe lazy initialization
_vanna_instance = None
_vanna_lock = threading.Lock()


def _train_vanna(vn: KPIVanna) -> None:
    """Load all training data into the Vanna instance."""
    logger.info("Training Vanna with DDL statements...")
    for ddl in get_ddl_statements():
        vn.train(ddl=ddl)

    logger.info("Training Vanna with documentation...")
    for doc in get_documentation():
        vn.train(documentation=doc)

    logger.info("Training Vanna with example queries...")
    for example in get_example_queries():
        vn.train(question=example["question"], sql=example["sql"])

    logger.info("Vanna training complete.")


def get_vanna_instance() -> KPIVanna:
    """Get or create the singleton Vanna instance (thread-safe)."""
    global _vanna_instance

    if _vanna_instance is not None:
        return _vanna_instance

    with _vanna_lock:
        # Double-check after acquiring lock
        if _vanna_instance is not None:
            return _vanna_instance

        logger.info("Initializing Vanna instance...")
        vn = KPIVanna(config={
            'api_key': settings.OPENAI_API_KEY,
            'model': 'gpt-4o',
            'path': settings.VANNA_CHROMADB_PATH,
        })
        _train_vanna(vn)
        _vanna_instance = vn
        return vn


def _generate_summary(vn: KPIVanna, question: str, sql: str, df: pd.DataFrame) -> str:
    """Generate a natural language summary of the query results."""
    # Build a condensed data representation for the LLM
    columns = list(df.columns)
    preview_rows = df.head(5).values.tolist()

    # Compute numeric aggregates for context
    numeric_stats = {}
    for col in df.select_dtypes(include=['number']).columns:
        numeric_stats[col] = {
            'min': float(df[col].min()) if not df[col].isna().all() else None,
            'max': float(df[col].max()) if not df[col].isna().all() else None,
            'mean': round(float(df[col].mean()), 2) if not df[col].isna().all() else None,
        }

    prompt = (
        f"The user asked: \"{question}\"\n\n"
        f"The SQL query was:\n{sql}\n\n"
        f"Results ({len(df)} rows total):\n"
        f"Columns: {columns}\n"
        f"First rows: {preview_rows}\n"
    )

    if numeric_stats:
        prompt += f"Numeric summaries: {numeric_stats}\n"

    prompt += (
        "\nProvide a clear, concise 2-4 sentence summary of these results "
        "in plain English. Focus on the key findings and numbers. "
        "Do not mention SQL or technical details."
    )

    try:
        summary = vn.submit_prompt(
            prompt=prompt,
        )
        return summary if summary else "Query executed successfully."
    except Exception as e:
        logger.warning("Failed to generate summary: %s", e)
        return "Query executed successfully. See the data below for details."


def ask_question(question: str) -> dict:
    """
    Main entry point: take a natural language question, generate SQL,
    execute it, and return results with a summary.
    """
    vn = get_vanna_instance()

    # Step 1: Generate SQL from the question
    sql = vn.generate_sql(question)

    if not sql or not sql.strip():
        return {
            'success': False,
            'error': "I couldn't generate a SQL query for that question. "
                     "Try rephrasing or ask about specific KPI data.",
        }

    # Clean up the SQL (remove markdown code fences if present)
    sql = sql.strip()
    if sql.startswith('```'):
        lines = sql.split('\n')
        # Remove first line (```sql) and last line (```)
        lines = [l for l in lines if not l.strip().startswith('```')]
        sql = '\n'.join(lines).strip()

    # Step 2: Validate SQL is SELECT-only
    try:
        validate_sql_is_select_only(sql)
    except ValueError as e:
        logger.warning("SQL validation failed: %s | SQL: %s", e, sql)
        return {
            'success': False,
            'error': "The generated query was not a safe read-only query. "
                     "Please try rephrasing your question.",
        }

    # Step 3: Execute the SQL
    try:
        df = vn.run_sql(sql)
    except Exception as e:
        logger.error("SQL execution failed: %s | SQL: %s", e, sql)
        return {
            'success': False,
            'error': "The query could not be executed. "
                     "Please try rephrasing your question.",
        }

    # Step 4: Cap results
    total_rows = len(df)
    if total_rows > MAX_RESULT_ROWS:
        df_response = df.head(MAX_RESULT_ROWS)
    else:
        df_response = df

    # Step 5: Generate natural language summary
    summary = _generate_summary(vn, question, sql, df)

    # Step 6: Build response
    columns = list(df_response.columns)
    data = df_response.values.tolist()

    # Convert any non-serializable types to strings
    clean_data = []
    for row in data:
        clean_row = []
        for val in row:
            if val is None or isinstance(val, (str, int, float, bool)):
                clean_row.append(val)
            else:
                clean_row.append(str(val))
        clean_data.append(clean_row)

    return {
        'success': True,
        'summary': summary,
        'sql': sql,
        'columns': columns,
        'data': clean_data,
        'total_rows': total_rows,
    }
