Employee Performance Tracking Web Application
ROLE

You are a senior full-stack engineer building a production-ready internal web application with clean architecture, modern UI, and strict role-based access control.

1. TECH STACK & SETUP RULES
Tech Stack

Frontend: Next.js (App Router preferred)

Backend: Django

Auth: Passwordless (Magic Link)

DB: Your choice (PostgreSQL preferred)

Project Initialization (IMPORTANT)

❌ Do NOT manually scaffold projects

✅ Use official commands:

Next.js init command for frontend

Django startproject / startapp for backend

Backend environment variables must be managed using uv (already installed)

2. APPLICATION OVERVIEW

This is an Employee Performance Tracking Web App used internally to track operational metrics across departments.

Key principles:

Passwordless authentication

Role-based access (RBAC)

Module-based data entry

Admin-controlled users & roles

Aggregated dashboard analytics

Clean, modern UI with sidebar + tables + modals

3. AUTHENTICATION (PASSWORDLESS – MAGIC LINK)
Login Flow (NO PASSWORDS)

User enters email

Backend sends a magic login link via email

User clicks the link

User is authenticated and redirected into the app

Rules:

No passwords anywhere

Magic link must:

Be single-use

Expire (10–15 minutes)

Store last login time

4. USER ROLES & PERMISSIONS (RBAC)
Roles

Roles are admin-configurable, not hardcoded.

Initial roles may include:

Admin

General New

General Renewal

General Claim

Motor New

Motor Renewal

Motor Claim

Permissions Types

Each role defines:

Module Access

Data Visibility

Module Access Rules

Permissions are hierarchical

Category-level or module-level access is allowed

Example:

If Admin selects General (category):

User gets:

General New

General Renewal

General Claim

Admin can also select only individual modules

Data Visibility (Role-Level Setting)

Each role must define one:

🔘 See all data uploaded by everyone

⚪ See only their own uploaded data

This applies globally across:

Tables

Filters

Dashboard

5. SIDEBAR STRUCTURE (STRICT)

Sidebar must be category-based and collapsible.

Dashboard

General
 ├─ General New
 ├─ General Renewal
 ├─ General Claim (empty for now)

Motor
 ├─ Motor New
 ├─ Motor Renewal
 ├─ Motor Claim

User Management
 ├─ Users
 ├─ Roles


Rules:

Show only permitted modules

Hide unauthorized modules completely

If user has access to a child module, show its parent category

6. USER MANAGEMENT MODULE
Users Page (Admin Only)

Table columns:

Name

Email

Role (badge)

Status (Active / Inactive)

Created At

Updated At

Last Login

Action menu (⋮)

Actions:

Edit

Activate / Deactivate

Delete

Add User

Modal form

Fields:

Name

Email

Role

❌ No password field

7. ROLE MANAGEMENT MODULE
Create / Edit Role (Modal UI)

Fields:

Role Name (required)

Role Description (optional)

Module Permissions UI (Tree-Based)
[ ] Dashboard

[ ] General
    [ ] General New
    [ ] General Renewal
    [ ] General Claim

[ ] Motor
    [ ] Motor New
    [ ] Motor Renewal
    [ ] Motor Claim


Rules:

Selecting a category selects all children

Selecting individual children does not auto-select parent

Parent shows indeterminate state if partial selection

Data Visibility UI

Radio buttons:

See all data uploaded by everyone

See only their own uploaded data

8. MODULE BEHAVIOR (NON-DASHBOARD)

Each module contains:

Table View

Displays entries based on role permissions

Admin can filter by user

Others cannot

Add New Button

Opens modal form

Entry Metadata

Added by (User)

Date & Time

Edit Rules

Users can edit only their own entries

Editable for 30 minutes only

After 30 minutes → edit disabled

9. MODULE FORM FIELDS
General New

Date

No. of quotations

No. of quotes revised

No. of quotes converted

TAT

Accuracy

General Renewal

Date

No. of quotations

No. of quotes revised

No. of quotes converted

TAT

Accuracy

General Claim

Leave empty for now

Placeholder module only

Motor New

Date

No. of quotations

No. of quotes revised

TAT

Accuracy

Motor Renewal

Date

No. of quotations

Retention

TAT

Accuracy

Motor Claim

Date

No. of registered claims

No. of claims closed

No. of pending cases

TAT

10. TABLE REQUIREMENTS

Each table must include:

All module fields

Added by

Added time

Action: Edit (time-restricted)

11. NOTIFICATIONS (ADMIN)

Whenever any user adds an entry:

Admin receives in-app notification with:

User name

Module

Time

Entry details

12. DASHBOARD (ADMIN-FOCUSED)
Aggregations

Total quotations (module-wise)

Revised quotes

Conversions

Accuracy metrics

TAT averages

Claims:

Registered

Closed

Pending

Visualizations

Month-wise graphs

Module-wise performance charts

Top-performing users

Activity

Today’s entries

Recent activity feed

Filters

Date range

Department / Module

13. DJANGO IMPLEMENTATION GUIDANCE

Preferred approach:

Use Django’s built-in auth

Map:

Group → Role

Custom table for:

Role ↔ Module permissions

Data visibility flag

Implement magic links using:

Django signing or a simple token-based flow

Avoid:

Password-based auth

Hardcoded permissions

Flat permission structures

14. NON-GOALS (DO NOT BUILD)

No passwords

No public access

No multi-tenant orgs

No mobile app

No overly complex RBAC framework

15. CORE GOALS SUMMARY

Clean, scalable RBAC

Passwordless login

Admin-controlled users & roles

Category-based sidebar

Time-locked edits

Insightful dashboard

Simple, maintainable architecture