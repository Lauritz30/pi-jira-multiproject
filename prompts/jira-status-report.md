---
description: Generate a daily UAT status report from Jira
---
Run these JQL searches via jira_search_issues:

1. "UAT: All Open Defects" — `project = UAT AND issuetype = Defect AND statusCategory != Done ORDER BY priority DESC, created ASC`
2. "UAT: Ready for Retest" — `project = UAT AND issuetype = Defect AND status = "Ready for Retest" ORDER BY updated DESC`
3. "UAT: Tests to Execute (Phase)" — `project = UAT AND issuetype in (Test, Test Case) AND status in (To Do, In Progress) ORDER BY rank ASC`

Summarize into a daily report shape: burn-down, defect counts by severity, and blockers.
