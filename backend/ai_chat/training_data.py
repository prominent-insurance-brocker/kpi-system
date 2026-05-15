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
                client_name VARCHAR(200) NOT NULL,
                agent_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                status VARCHAR(20) NOT NULL,         -- 'new' | 'converted' | 'lost'
                revisions INTEGER NOT NULL DEFAULT 0,
                quotes_compared INTEGER NOT NULL DEFAULT 0,
                status_changed_at TIMESTAMPTZ NULL,
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
                client_name VARCHAR(200) NOT NULL,
                agent_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                chassis_no VARCHAR(100) NOT NULL,
                status VARCHAR(20) NOT NULL,         -- 'new' | 'converted' | 'lost'
                revisions INTEGER NOT NULL DEFAULT 0,
                quotes_compared INTEGER NOT NULL DEFAULT 0,
                status_changed_at TIMESTAMPTZ NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
            """
            CREATE TABLE entries_motorrenewalentry (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                client_name VARCHAR(200) NOT NULL,
                agent_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                chassis_no VARCHAR(100) NOT NULL,
                status VARCHAR(20) NOT NULL,         -- 'new' | 'retained' | 'lost'
                revisions INTEGER NOT NULL DEFAULT 0,
                quotes_compared INTEGER NOT NULL DEFAULT 0,
                status_changed_at TIMESTAMPTZ NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
            """
            CREATE TABLE entries_motorrenewalmonthlytarget (
                id BIGSERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                calculated_date DATE NOT NULL,  -- first of (year, month), indexed
                clients_assigned INTEGER NULL,  -- retention target for the month
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL,
                UNIQUE (user_id, year, month)
            );
            """,
            """
            CREATE TABLE entries_motorclaimentry (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                client_name VARCHAR(200) NOT NULL,
                vehicle_number VARCHAR(50) NOT NULL,
                claim_number VARCHAR(100) NOT NULL,
                source_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                type_of_accident_id BIGINT NOT NULL REFERENCES entries_typeofaccident(id),
                insurance_company_id BIGINT NOT NULL REFERENCES entries_insurancecompany(id),
                next_call_date DATE NULL,
                garage_name VARCHAR(200) NOT NULL,
                garage_number VARCHAR(50) NOT NULL,
                status VARCHAR(20) NOT NULL,  -- claims_opened | claims_in_progress | claims_resolved | claims_rejected
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
            """
            CREATE TABLE entries_typeofaccident (
                id BIGSERIAL PRIMARY KEY,
                name VARCHAR(200) UNIQUE NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
            """
            CREATE TABLE entries_insurancecompany (
                id BIGSERIAL PRIMARY KEY,
                name VARCHAR(200) UNIQUE NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL,
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
            """
            -- Cross-module comments. One row per remark; `content_type` +
            -- `object_id` link to the parent entry (any of the 7 supported
            -- modules). To join, look up the content_type row in
            -- django_content_type by app_label='entries' + model name.
            CREATE TABLE entries_entryremark (
                id BIGSERIAL PRIMARY KEY,
                content_type_id INTEGER NOT NULL REFERENCES django_content_type(id),
                object_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                author_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
            """,
        ]
    else:
        return [
            """
            CREATE TABLE entries_generalnewentry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                client_name VARCHAR(200) NOT NULL,
                agent_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                status VARCHAR(20) NOT NULL,
                revisions INTEGER UNSIGNED NOT NULL DEFAULT 0,
                quotes_compared INTEGER UNSIGNED NOT NULL DEFAULT 0,
                status_changed_at DATETIME NULL,
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
                client_name VARCHAR(200) NOT NULL,
                agent_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                chassis_no VARCHAR(100) NOT NULL,
                status VARCHAR(20) NOT NULL,         -- 'new' | 'converted' | 'lost'
                revisions INTEGER UNSIGNED NOT NULL DEFAULT 0,
                quotes_compared INTEGER UNSIGNED NOT NULL DEFAULT 0,
                status_changed_at DATETIME NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
            """
            CREATE TABLE entries_motorrenewalentry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                client_name VARCHAR(200) NOT NULL,
                agent_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                chassis_no VARCHAR(100) NOT NULL,
                status VARCHAR(20) NOT NULL,         -- 'new' | 'retained' | 'lost'
                revisions INTEGER UNSIGNED NOT NULL DEFAULT 0,
                quotes_compared INTEGER UNSIGNED NOT NULL DEFAULT 0,
                status_changed_at DATETIME NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
            """
            CREATE TABLE entries_motorrenewalmonthlytarget (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                calculated_date DATE NOT NULL,
                clients_assigned INTEGER NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                UNIQUE (user_id, year, month)
            );
            """,
            """
            CREATE TABLE entries_motorclaimentry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                client_name VARCHAR(200) NOT NULL,
                vehicle_number VARCHAR(50) NOT NULL,
                claim_number VARCHAR(100) NOT NULL,
                source_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                type_of_accident_id INTEGER NOT NULL REFERENCES entries_typeofaccident(id),
                insurance_company_id INTEGER NOT NULL REFERENCES entries_insurancecompany(id),
                next_call_date DATE NULL,
                garage_name VARCHAR(200) NOT NULL,
                garage_number VARCHAR(50) NOT NULL,
                status VARCHAR(20) NOT NULL,
                added_by_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                added_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
            """
            CREATE TABLE entries_typeofaccident (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(200) UNIQUE NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
            """
            CREATE TABLE entries_insurancecompany (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(200) UNIQUE NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL,
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
            """
            -- Cross-module comments. content_type_id + object_id form a
            -- generic foreign key to any of the 7 supported entry modules.
            CREATE TABLE entries_entryremark (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_type_id INTEGER NOT NULL REFERENCES django_content_type(id),
                object_id INTEGER UNSIGNED NOT NULL,
                text TEXT NOT NULL,
                author_id INTEGER NOT NULL REFERENCES auth_app_customuser(id),
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            """,
        ]


def get_documentation():
    """Business context documentation — date syntax varies by database."""
    base_docs = [
        "This is an insurance company KPI (Key Performance Indicator) tracking system. "
        "It tracks daily metrics across General Insurance, Motor Insurance, and Sales departments.",

        "The 'General New' module (entries_generalnewentry) tracks new general insurance ENQUIRIES — one row per customer enquiry. "
        "Each row has client_name, an agent_id (the salesperson source), "
        "a status (one of 'new', 'converted', 'lost'), a revisions counter, quotes_compared, and a status_changed_at timestamp set when the status becomes terminal. "
        "TAT for an enquiry = status_changed_at - added_at (only meaningful when status != 'new'). "
        "Accuracy = 100 * (0.9 ^ revisions), only meaningful when status != 'new'. "
        "Same per-enquiry shape as Motor New but without chassis_no (general insurance has no chassis).",

        "The 'General Renewal' module (entries_generalrenewalentry) tracks renewal of existing general insurance policies: "
        "quotations issued, quotes revised, quotes converted, TAT, and accuracy. "
        "It has the same structure as General New.",

        "The 'Motor New' module (entries_motornewentry) tracks new motor insurance ENQUIRIES — one row per customer enquiry. "
        "Each row has client_name, an agent_id (the salesperson source), chassis_no, "
        "a status (one of 'new', 'converted', 'lost'), a revisions counter, and a status_changed_at timestamp set when the status becomes terminal. "
        "TAT for an enquiry = status_changed_at - added_at (only meaningful when status != 'new'). "
        "Accuracy = 100 * (0.9 ^ revisions), only meaningful when status != 'new'.",

        "The 'Motor Renewal' module (entries_motorrenewalentry) tracks renewal ENQUIRIES with the same per-enquiry shape "
        "as Motor New (client_name, agent_id, chassis_no, status, revisions, quotes_compared, status_changed_at). "
        "Critical difference: status is one of 'new', 'retained' (positive outcome), 'lost' — NOT 'converted'. "
        "A separate table entries_motorrenewalmonthlytarget tracks each user's monthly retention target (clients_assigned).",

        "The 'Motor Claim' module (entries_motorclaimentry) tracks motor insurance claims one row per claim: "
        "client_name, vehicle_number, claim_number, source_id (sales agent who originated the lead), "
        "type_of_accident_id (FK to entries_typeofaccident), insurance_company_id (FK to entries_insurancecompany), "
        "next_call_date (follow-up date), garage_name, garage_number, and status (one of 'claims_opened', "
        "'claims_in_progress', 'claims_resolved', 'claims_rejected'). The lookup tables entries_typeofaccident "
        "and entries_insurancecompany are admin-managed via the Settings page; both have name + is_active.",

        "The 'Sales KPI' module (entries_saleskpientry) tracks sales team performance: "
        "leads_to_ops_team, quotes_from_ops_team, quotes_to_client, total_conversions, "
        "new_clients_acquired, and gross_booked_premium (actual gross premium booked, decimal currency amount).",

        "The 'Medical Claim' module (entries_medicalclaimentry) tracks medical insurance claims: "
        "customer_name (name of the customer) and status (one of 'claims_opened', 'claims_in_progress', 'claims_resolved', 'claims_rejected').",

        "All entry tables have an added_by_id foreign key to auth_app_customuser. "
        "To find who entered data, JOIN with auth_app_customuser ON added_by_id = auth_app_customuser.id.",

        "Per-entry comments live in entries_entryremark (one row per remark, many remarks per entry). "
        "It uses a generic FK: content_type_id + object_id together identify the parent entry. "
        "To find remarks on a specific module, JOIN django_content_type ON content_type_id = django_content_type.id "
        "WHERE django_content_type.app_label = 'entries' AND django_content_type.model = 'motornewentry' "
        "(or 'generalnewentry', 'motorclaimentry', etc — lowercase model name). "
        "author_id is the user who wrote the comment; entries_entryremark.created_at is when they wrote it.",

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
                "question": "How many General New enquiries were created this month?",
                "sql": """
                    SELECT COUNT(*) AS total_enquiries
                    FROM entries_generalnewentry
                    WHERE date >= date_trunc('month', CURRENT_DATE)
                      AND date <= CURRENT_DATE;
                """,
            },
            {
                "question": "How many motor new enquiries are still open?",
                "sql": """
                    SELECT COUNT(*) AS open_enquiries
                    FROM entries_motornewentry
                    WHERE status = 'new';
                """,
            },
            {
                "question": "What is the conversion rate for motor new enquiries this month?",
                "sql": """
                    SELECT
                        COUNT(*) FILTER (WHERE status = 'converted') AS converted,
                        COUNT(*) FILTER (WHERE status IN ('converted','lost')) AS closed,
                        COUNT(*) AS total
                    FROM entries_motornewentry
                    WHERE date >= date_trunc('month', CURRENT_DATE)
                      AND date <= CURRENT_DATE;
                """,
            },
            {
                "question": "What is the total gross booked premium vs target for this year?",
                "sql": """
                    SELECT
                        SUM(gross_booked_premium) AS total_premium,
                        ROUND(SUM(gross_booked_premium), 2) AS total_premium_rounded
                    FROM entries_saleskpientry
                    WHERE date >= date_trunc('year', CURRENT_DATE)
                      AND date <= CURRENT_DATE;
                """,
            },
            {
                "question": "How many motor claims are currently in progress?",
                "sql": """
                    SELECT COUNT(*) AS total_in_progress_claims
                    FROM entries_motorclaimentry
                    WHERE status = 'claims_in_progress';
                """,
            },
            {
                "question": "How many medical claims are currently pending?",
                "sql": """
                    SELECT COUNT(*) AS total_pending_medical_claims
                    FROM entries_medicalclaimentry
                    WHERE status = 'claims_in_progress';
                """,
            },
            {
                "question": "What is the conversion rate for General New enquiries last month?",
                "sql": """
                    SELECT
                        COUNT(*) FILTER (WHERE status = 'converted') AS converted,
                        COUNT(*) FILTER (WHERE status IN ('converted','lost')) AS closed,
                        COUNT(*) AS total,
                        ROUND(COUNT(*) FILTER (WHERE status = 'converted')::FLOAT
                              / NULLIF(COUNT(*), 0) * 100, 2) AS conversion_rate_pct
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
                "question": "Compare General New vs General Renewal enquiry counts this month",
                "sql": """
                    SELECT
                        'General New' AS module,
                        COUNT(*) AS total_enquiries
                    FROM entries_generalnewentry
                    WHERE date >= date_trunc('month', CURRENT_DATE) AND date <= CURRENT_DATE
                    UNION ALL
                    SELECT
                        'General Renewal' AS module,
                        COUNT(*) AS total_enquiries
                    FROM entries_generalrenewalentry
                    WHERE date >= date_trunc('month', CURRENT_DATE) AND date <= CURRENT_DATE;
                """,
            },
        ]
    else:
        return [
            {
                "question": "How many General New enquiries were created this month?",
                "sql": """
                    SELECT COUNT(*) AS total_enquiries
                    FROM entries_generalnewentry
                    WHERE date >= date('now', 'start of month')
                      AND date <= date('now');
                """,
            },
            {
                "question": "How many motor new enquiries are still open?",
                "sql": """
                    SELECT COUNT(*) AS open_enquiries
                    FROM entries_motornewentry
                    WHERE status = 'new';
                """,
            },
            {
                "question": "What is the conversion rate for motor new enquiries this month?",
                "sql": """
                    SELECT
                        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted,
                        SUM(CASE WHEN status IN ('converted','lost') THEN 1 ELSE 0 END) AS closed,
                        COUNT(*) AS total
                    FROM entries_motornewentry
                    WHERE date >= date('now', 'start of month')
                      AND date <= date('now');
                """,
            },
            {
                "question": "What is the total gross booked premium for this year?",
                "sql": """
                    SELECT
                        SUM(gross_booked_premium) AS total_premium,
                        ROUND(SUM(gross_booked_premium), 2) AS total_premium_rounded
                    FROM entries_saleskpientry
                    WHERE date >= date('now', 'start of year')
                      AND date <= date('now');
                """,
            },
            {
                "question": "How many motor claims are currently in progress?",
                "sql": """
                    SELECT COUNT(*) AS total_in_progress_claims
                    FROM entries_motorclaimentry
                    WHERE status = 'claims_in_progress';
                """,
            },
            {
                "question": "How many medical claims are currently pending?",
                "sql": """
                    SELECT COUNT(*) AS total_pending_medical_claims
                    FROM entries_medicalclaimentry
                    WHERE status = 'claims_in_progress';
                """,
            },
            {
                "question": "What is the conversion rate for General New enquiries last month?",
                "sql": """
                    SELECT
                        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted,
                        SUM(CASE WHEN status IN ('converted','lost') THEN 1 ELSE 0 END) AS closed,
                        COUNT(*) AS total,
                        ROUND(CAST(SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS FLOAT)
                              / NULLIF(COUNT(*), 0) * 100, 2) AS conversion_rate_pct
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
                "question": "Compare General New vs General Renewal enquiry counts this month",
                "sql": """
                    SELECT
                        'General New' AS module,
                        COUNT(*) AS total_enquiries
                    FROM entries_generalnewentry
                    WHERE date >= date('now', 'start of month') AND date <= date('now')
                    UNION ALL
                    SELECT
                        'General Renewal' AS module,
                        COUNT(*) AS total_enquiries
                    FROM entries_generalrenewalentry
                    WHERE date >= date('now', 'start of month') AND date <= date('now');
                """,
            },
        ]
