"""
Hardcoded training data for Vanna.ai.
Loaded lazily on first request to train the RAG model.
Detects database engine (SQLite vs PostgreSQL) and provides matching SQL.
"""

from django.db import connection


def _is_postgres():
    return connection.vendor == 'postgresql'


def get_ddl_statements():
    """DDL statements — PostgreSQL-style if in prod, SQLite-style for dev."""
    if _is_postgres():
        return [
            """
            CREATE TABLE entries_generalnewentry (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                quotations INTEGER NOT NULL,
                quotes_revised INTEGER NOT NULL,
                quotes_converted INTEGER NOT NULL,
                tat INTEGER NOT NULL,
                accuracy NUMERIC(5, 2) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
            """
            CREATE TABLE entries_generalrenewalentry (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                quotations INTEGER NOT NULL,
                quotes_revised INTEGER NOT NULL,
                quotes_converted INTEGER NOT NULL,
                tat INTEGER NOT NULL,
                accuracy NUMERIC(5, 2) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
            """
            CREATE TABLE entries_motornewentry (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                quotations INTEGER NOT NULL,
                quotes_revised INTEGER NOT NULL,
                tat INTEGER NOT NULL,
                accuracy NUMERIC(5, 2) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
            """
            CREATE TABLE entries_motorrenewalentry (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                quotations INTEGER NOT NULL,
                retention INTEGER NOT NULL,
                tat INTEGER NOT NULL,
                accuracy NUMERIC(5, 2) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
            """
            CREATE TABLE entries_motorclaimentry (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                registered_claims INTEGER NOT NULL,
                claims_closed INTEGER NOT NULL,
                pending_cases INTEGER NOT NULL,
                tat INTEGER NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
            """
            CREATE TABLE entries_salespremiumdataentry (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                gross_booked_premium NUMERIC(15, 2) NOT NULL,
                target NUMERIC(15, 2) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
            """
            CREATE TABLE entries_saleskpientry (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                leads_to_ops_team INTEGER NOT NULL,
                quotes_from_ops_team INTEGER NOT NULL,
                quotes_to_client INTEGER NOT NULL,
                total_conversions INTEGER NOT NULL,
                new_clients_acquired INTEGER NOT NULL,
                gross_booked_premium DECIMAL(15,2) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
            """
            CREATE TABLE entries_medicalclaimentry (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                customer_name VARCHAR(255) NOT NULL,
                status VARCHAR(20) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
            """
            CREATE TABLE auth_app_customuser (
                id SERIAL PRIMARY KEY,
                email VARCHAR(254) UNIQUE NOT NULL,
                full_name VARCHAR(100) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                is_staff BOOLEAN NOT NULL DEFAULT FALSE,
                date_joined TIMESTAMPTZ NOT NULL,
                role_id INTEGER REFERENCES roles_role(id)
            );
            """,
        ]
    else:
        return [
            """
            CREATE TABLE entries_generalnewentry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                quotations INTEGER UNSIGNED NOT NULL,
                quotes_revised INTEGER UNSIGNED NOT NULL,
                quotes_converted INTEGER UNSIGNED NOT NULL,
                tat INTEGER UNSIGNED NOT NULL,
                accuracy DECIMAL(5, 2) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
            """
            CREATE TABLE entries_generalrenewalentry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                quotations INTEGER UNSIGNED NOT NULL,
                quotes_revised INTEGER UNSIGNED NOT NULL,
                quotes_converted INTEGER UNSIGNED NOT NULL,
                tat INTEGER UNSIGNED NOT NULL,
                accuracy DECIMAL(5, 2) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
            """
            CREATE TABLE entries_motornewentry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                quotations INTEGER UNSIGNED NOT NULL,
                quotes_revised INTEGER UNSIGNED NOT NULL,
                tat INTEGER UNSIGNED NOT NULL,
                accuracy DECIMAL(5, 2) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
            """
            CREATE TABLE entries_motorrenewalentry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                quotations INTEGER UNSIGNED NOT NULL,
                retention INTEGER UNSIGNED NOT NULL,
                tat INTEGER UNSIGNED NOT NULL,
                accuracy DECIMAL(5, 2) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
            """
            CREATE TABLE entries_motorclaimentry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                registered_claims INTEGER UNSIGNED NOT NULL,
                claims_closed INTEGER UNSIGNED NOT NULL,
                pending_cases INTEGER UNSIGNED NOT NULL,
                tat INTEGER UNSIGNED NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
            """
            CREATE TABLE entries_salespremiumdataentry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                gross_booked_premium DECIMAL(15, 2) NOT NULL,
                target DECIMAL(15, 2) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
            """
            CREATE TABLE entries_saleskpientry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                leads_to_ops_team INTEGER UNSIGNED NOT NULL,
                quotes_from_ops_team INTEGER UNSIGNED NOT NULL,
                quotes_to_client INTEGER UNSIGNED NOT NULL,
                total_conversions INTEGER UNSIGNED NOT NULL,
                new_clients_acquired INTEGER UNSIGNED NOT NULL,
                gross_booked_premium DECIMAL(15,2) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
            """
            CREATE TABLE entries_medicalclaimentry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                customer_name VARCHAR(255) NOT NULL,
                status VARCHAR(20) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
            """
            CREATE TABLE auth_app_customuser (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email VARCHAR(254) UNIQUE NOT NULL,
                full_name VARCHAR(100) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                is_staff BOOLEAN NOT NULL DEFAULT 0,
                date_joined DATETIME NOT NULL,
                role_id INTEGER REFERENCES roles_role(id)
            );
            """,
        ]


def get_documentation():
    """Business context documentation — date syntax varies by database."""
    base_docs = [
        "This is an insurance company KPI (Key Performance Indicator) tracking system. "
        "It tracks daily metrics across General Insurance, Motor Insurance, and Sales departments.",

        "The 'General New' module (entries_generalnewentry) tracks new general insurance business: "
        "quotations issued, quotes revised, quotes converted to policies, TAT (turnaround time in hours), "
        "and accuracy percentage.",

        "The 'General Renewal' module (entries_generalrenewalentry) tracks renewal of existing general insurance policies: "
        "quotations issued, quotes revised, quotes converted, TAT, and accuracy. "
        "It has the same structure as General New.",

        "The 'Motor New' module (entries_motornewentry) tracks new motor insurance business: "
        "quotations issued, quotes revised, TAT, and accuracy.",

        "The 'Motor Renewal' module (entries_motorrenewalentry) tracks motor insurance renewals: "
        "quotations issued, retention count (policies retained), TAT, and accuracy.",

        "The 'Motor Claim' module (entries_motorclaimentry) tracks motor insurance claims processing: "
        "registered_claims (new claims filed), claims_closed (resolved claims), "
        "pending_cases (currently open claims), and TAT.",

        "The 'Sales KPI' module (entries_saleskpientry) tracks sales team performance: "
        "leads_to_ops_team, quotes_from_ops_team, quotes_to_client, total_conversions, "
        "new_clients_acquired, and gross_booked_premium (actual gross premium booked, decimal currency amount).",

        "The 'Medical Claim' module (entries_medicalclaimentry) tracks medical insurance claims: "
        "customer_name (name of the customer) and status (one of 'claims_opened', 'claims_pending', 'claims_resolved').",

        "All entry tables have an added_by_id foreign key to auth_app_customuser. "
        "To find who entered data, JOIN with auth_app_customuser ON added_by_id = auth_app_customuser.id.",

        "The accuracy field is a percentage (0-100) stored as DECIMAL(5,2). "
        "TAT (turnaround time) is stored as a positive integer representing hours.",
    ]

    if _is_postgres():
        base_docs.append(
            "All entry tables have a 'date' field (DATE type) representing the business date of the entry. "
            "Use CURRENT_DATE for today, date_trunc('month', CURRENT_DATE) for first day of current month, "
            "date_trunc('year', CURRENT_DATE) for first day of current year. "
            "For filtering by month: WHERE date >= date_trunc('month', CURRENT_DATE) AND date <= CURRENT_DATE. "
            "For filtering by year: WHERE date >= date_trunc('year', CURRENT_DATE) AND date <= CURRENT_DATE. "
            "For last month: WHERE date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') "
            "AND date < date_trunc('month', CURRENT_DATE)."
        )
    else:
        base_docs.append(
            "All entry tables have a 'date' field (DATE type) representing the business date of the entry. "
            "For SQLite, use date('now') for today, date('now', 'start of month') for first day of current month, "
            "date('now', 'start of year') for first day of current year. "
            "For filtering by month: WHERE date >= date('now', 'start of month') AND date <= date('now'). "
            "For filtering by year: WHERE date >= date('now', 'start of year') AND date <= date('now')."
        )

    return base_docs


def get_example_queries():
    """Example question-SQL pairs — syntax matches the active database."""
    if _is_postgres():
        return [
            {
                "question": "What were the total quotations across all General New entries this month?",
                "sql": """
                    SELECT SUM(quotations) AS total_quotations
                    FROM entries_generalnewentry
                    WHERE date >= date_trunc('month', CURRENT_DATE)
                      AND date <= CURRENT_DATE;
                """,
            },
            {
                "question": "What is the average accuracy for Motor New entries?",
                "sql": """
                    SELECT ROUND(AVG(accuracy), 2) AS avg_accuracy
                    FROM entries_motornewentry;
                """,
            },
            {
                "question": "What is the total gross booked premium vs target for this year?",
                "sql": """
                    SELECT
                        SUM(gross_booked_premium) AS total_premium,
                        SUM(target) AS total_target,
                        ROUND(SUM(gross_booked_premium) - SUM(target), 2) AS variance
                    FROM entries_salespremiumdataentry
                    WHERE date >= date_trunc('year', CURRENT_DATE)
                      AND date <= CURRENT_DATE;
                """,
            },
            {
                "question": "How many motor claims are currently pending?",
                "sql": """
                    SELECT SUM(pending_cases) AS total_pending_claims
                    FROM entries_motorclaimentry;
                """,
            },
            {
                "question": "How many medical claims are currently pending?",
                "sql": """
                    SELECT COUNT(*) AS total_pending_medical_claims
                    FROM entries_medicalclaimentry
                    WHERE status = 'claims_pending';
                """,
            },
            {
                "question": "What is the conversion rate for General New entries last month?",
                "sql": """
                    SELECT
                        SUM(quotations) AS total_quotations,
                        SUM(quotes_converted) AS total_converted,
                        ROUND(SUM(quotes_converted)::FLOAT / NULLIF(SUM(quotations), 0) * 100, 2) AS conversion_rate_pct
                    FROM entries_generalnewentry
                    WHERE date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
                      AND date < date_trunc('month', CURRENT_DATE);
                """,
            },
            {
                "question": "Who entered the most data entries across all tables?",
                "sql": """
                    SELECT
                        u.email,
                        u.full_name,
                        COUNT(*) AS total_entries
                    FROM (
                        SELECT added_by_id FROM entries_generalnewentry
                        UNION ALL
                        SELECT added_by_id FROM entries_generalrenewalentry
                        UNION ALL
                        SELECT added_by_id FROM entries_motornewentry
                        UNION ALL
                        SELECT added_by_id FROM entries_motorrenewalentry
                        UNION ALL
                        SELECT added_by_id FROM entries_motorclaimentry
                        UNION ALL
                        SELECT added_by_id FROM entries_salespremiumdataentry
                        UNION ALL
                        SELECT added_by_id FROM entries_saleskpientry
                        UNION ALL
                        SELECT added_by_id FROM entries_medicalclaimentry
                    ) AS all_entries
                    JOIN auth_app_customuser u ON all_entries.added_by_id = u.id
                    GROUP BY u.id, u.email, u.full_name
                    ORDER BY total_entries DESC
                    LIMIT 10;
                """,
            },
            {
                "question": "Show me the daily new clients acquired this month",
                "sql": """
                    SELECT date, SUM(new_clients_acquired) AS daily_new_clients
                    FROM entries_saleskpientry
                    WHERE date >= date_trunc('month', CURRENT_DATE)
                      AND date <= CURRENT_DATE
                    GROUP BY date
                    ORDER BY date;
                """,
            },
            {
                "question": "Compare General New vs General Renewal quotations this month",
                "sql": """
                    SELECT
                        'General New' AS module,
                        SUM(quotations) AS total_quotations
                    FROM entries_generalnewentry
                    WHERE date >= date_trunc('month', CURRENT_DATE) AND date <= CURRENT_DATE
                    UNION ALL
                    SELECT
                        'General Renewal' AS module,
                        SUM(quotations) AS total_quotations
                    FROM entries_generalrenewalentry
                    WHERE date >= date_trunc('month', CURRENT_DATE) AND date <= CURRENT_DATE;
                """,
            },
        ]
    else:
        return [
            {
                "question": "What were the total quotations across all General New entries this month?",
                "sql": """
                    SELECT SUM(quotations) AS total_quotations
                    FROM entries_generalnewentry
                    WHERE date >= date('now', 'start of month')
                      AND date <= date('now');
                """,
            },
            {
                "question": "What is the average accuracy for Motor New entries?",
                "sql": """
                    SELECT ROUND(AVG(accuracy), 2) AS avg_accuracy
                    FROM entries_motornewentry;
                """,
            },
            {
                "question": "What is the total gross booked premium vs target for this year?",
                "sql": """
                    SELECT
                        SUM(gross_booked_premium) AS total_premium,
                        SUM(target) AS total_target,
                        ROUND(SUM(gross_booked_premium) - SUM(target), 2) AS variance
                    FROM entries_salespremiumdataentry
                    WHERE date >= date('now', 'start of year')
                      AND date <= date('now');
                """,
            },
            {
                "question": "How many motor claims are currently pending?",
                "sql": """
                    SELECT SUM(pending_cases) AS total_pending_claims
                    FROM entries_motorclaimentry;
                """,
            },
            {
                "question": "How many medical claims are currently pending?",
                "sql": """
                    SELECT COUNT(*) AS total_pending_medical_claims
                    FROM entries_medicalclaimentry
                    WHERE status = 'claims_pending';
                """,
            },
            {
                "question": "What is the conversion rate for General New entries last month?",
                "sql": """
                    SELECT
                        SUM(quotations) AS total_quotations,
                        SUM(quotes_converted) AS total_converted,
                        ROUND(CAST(SUM(quotes_converted) AS FLOAT) / NULLIF(SUM(quotations), 0) * 100, 2) AS conversion_rate_pct
                    FROM entries_generalnewentry
                    WHERE date >= date('now', 'start of month', '-1 month')
                      AND date < date('now', 'start of month');
                """,
            },
            {
                "question": "Who entered the most data entries across all tables?",
                "sql": """
                    SELECT
                        u.email,
                        u.full_name,
                        COUNT(*) AS total_entries
                    FROM (
                        SELECT added_by_id FROM entries_generalnewentry
                        UNION ALL
                        SELECT added_by_id FROM entries_generalrenewalentry
                        UNION ALL
                        SELECT added_by_id FROM entries_motornewentry
                        UNION ALL
                        SELECT added_by_id FROM entries_motorrenewalentry
                        UNION ALL
                        SELECT added_by_id FROM entries_motorclaimentry
                        UNION ALL
                        SELECT added_by_id FROM entries_salespremiumdataentry
                        UNION ALL
                        SELECT added_by_id FROM entries_saleskpientry
                        UNION ALL
                        SELECT added_by_id FROM entries_medicalclaimentry
                    ) AS all_entries
                    JOIN auth_app_customuser u ON all_entries.added_by_id = u.id
                    GROUP BY u.id, u.email, u.full_name
                    ORDER BY total_entries DESC
                    LIMIT 10;
                """,
            },
            {
                "question": "Show me the daily new clients acquired this month",
                "sql": """
                    SELECT date, SUM(new_clients_acquired) AS daily_new_clients
                    FROM entries_saleskpientry
                    WHERE date >= date('now', 'start of month')
                      AND date <= date('now')
                    GROUP BY date
                    ORDER BY date;
                """,
            },
            {
                "question": "Compare General New vs General Renewal quotations this month",
                "sql": """
                    SELECT
                        'General New' AS module,
                        SUM(quotations) AS total_quotations
                    FROM entries_generalnewentry
                    WHERE date >= date('now', 'start of month') AND date <= date('now')
                    UNION ALL
                    SELECT
                        'General Renewal' AS module,
                        SUM(quotations) AS total_quotations
                    FROM entries_generalrenewalentry
                    WHERE date >= date('now', 'start of month') AND date <= date('now');
                """,
            },
        ]
